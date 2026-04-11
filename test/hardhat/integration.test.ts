import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  createWalletClient,
  createPublicClient,
  http,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || "";
const REPUTATION_REGISTRY = process.env.REPUTATION_REGISTRY || "";
const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || "";

// Skip if env vars are missing
const hasEnv =
  PRIVATE_KEY && IDENTITY_REGISTRY && REPUTATION_REGISTRY && VALIDATOR_ADDRESS;

const TEST_TIMEOUT = 120_000;

const identityRegistryAbi = [
  {
    inputs: [{ internalType: "string", name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "address", name: "newWallet", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "setAgentWallet",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "agentId", type: "uint256" },
      { indexed: false, internalType: "string", name: "agentURI", type: "string" },
      { indexed: true, internalType: "address", name: "owner", type: "address" },
    ],
    name: "Registered",
    type: "event",
  },
] as const;

const validatorAbi = [
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "evaluateAgent",
    outputs: [
      { internalType: "int256", name: "score", type: "int256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getLatestScore",
    outputs: [
      { internalType: "int256", name: "score", type: "int256" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const reputationAbi = [
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "address[]", name: "clientAddresses", type: "address[]" },
      { internalType: "string", name: "tag1", type: "string" },
      { internalType: "string", name: "tag2", type: "string" },
    ],
    name: "getSummary",
    outputs: [
      { internalType: "uint64", name: "count", type: "uint64" },
      { internalType: "int128", name: "summaryValue", type: "int128" },
      { internalType: "uint8", name: "summaryValueDecimals", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

vi.setConfig({ testTimeout: TEST_TIMEOUT, hookTimeout: TEST_TIMEOUT });

describe.skipIf(!hasEnv)("INT-001: register -> evaluate -> query", () => {
  let agentId: bigint = 0n;
  let wallet: `0x${string}`;

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const transport = http(
    process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech"
  );
  const walletClient = createWalletClient({
    account,
    chain: xLayerTestnet,
    transport,
  });
  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport,
  });

  beforeAll(async () => {
    wallet = account.address;

    // 1. Register agent
    const registerHash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "register",
      args: ["https://example.com/agent.json"],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

    let parsedAgentId = 0n;
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({
          abi: identityRegistryAbi,
          eventName: "Registered",
          data: log.data,
          topics: log.topics,
        });
        parsedAgentId = event.args.agentId;
        break;
      } catch {
        continue;
      }
    }
    expect(parsedAgentId).toBeGreaterThan(0n);
    agentId = parsedAgentId;

    // 2. Set agent wallet with EIP-712 signature
    const owner = await publicClient.readContract({
      address: IDENTITY_REGISTRY as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId],
    });

    const block = await publicClient.getBlock({ blockTag: "latest" });
    const deadline = block.timestamp + 300n;

    const signature = await walletClient.signTypedData({
      domain: {
        name: "ERC8004IdentityRegistry",
        version: "1",
        chainId: 1952,
        verifyingContract: IDENTITY_REGISTRY as `0x${string}`,
      },
      types: {
        AgentWalletSet: [
          { name: "agentId", type: "uint256" },
          { name: "newWallet", type: "address" },
          { name: "owner", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "AgentWalletSet",
      message: {
        agentId,
        newWallet: wallet,
        owner,
        deadline,
      },
    });

    const setWalletHash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "setAgentWallet",
      args: [agentId, wallet, deadline, signature],
    });
    await publicClient.waitForTransactionReceipt({ hash: setWalletHash });
  });

  it("evaluates the agent", async () => {
    const hash = await walletClient.writeContract({
      address: VALIDATOR_ADDRESS as `0x${string}`,
      abi: validatorAbi,
      functionName: "evaluateAgent",
      args: [agentId],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  });

  it("queries the latest score", async () => {
    const latest = await publicClient.readContract({
      address: VALIDATOR_ADDRESS as `0x${string}`,
      abi: validatorAbi,
      functionName: "getLatestScore",
      args: [agentId],
    });

    expect(Number(latest[0])).toBeTypeOf("number");
    expect(Number(latest[1])).toBeGreaterThan(0);
  });

  it("verifies ERC-8004 ReputationRegistry feedback", async () => {
    const summary = await publicClient.readContract({
      address: REPUTATION_REGISTRY as `0x${string}`,
      abi: reputationAbi,
      functionName: "getSummary",
      args: [agentId, [VALIDATOR_ADDRESS as `0x${string}`], "agent-rep-score", ""],
    });

    expect(Number(summary[0])).toBeGreaterThan(0);
    const latest = await publicClient.readContract({
      address: VALIDATOR_ADDRESS as `0x${string}`,
      abi: validatorAbi,
      functionName: "getLatestScore",
      args: [agentId],
    });
    expect(Number(summary[1])).toBe(Number(latest[0]));
  });
});
