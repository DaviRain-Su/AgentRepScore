import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { fetchNonce, signSwapSummary, signActivitySummary } from "../src/skill/eip712.ts";
import { submitWithRetry } from "../src/skill/keeper-utils.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIVATE_KEY = (process.env.PRIVATE_KEY || "") as `0x${string}`;
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";

const account = privateKeyToAccount(PRIVATE_KEY);
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: xLayerTestnet, transport });
const walletClient = createWalletClient({ account, chain: xLayerTestnet, transport });

function loadFoundryArtifact(name: string, subdir = ""): { abi: any; bytecode: `0x${string}` } {
  const contractPath = subdir ? subdir : `${name}.sol`;
  const artifactPath = path.join(__dirname, "../out", contractPath, `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object as `0x${string}` };
}

async function waitForNonce(expectedNonce: number, maxWait = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const current = await publicClient.getTransactionCount({ address: account.address });
    if (current >= expectedNonce) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Nonce did not reach ${expectedNonce} in ${maxWait}ms`);
}

async function deploy(name: string, args: any[] = [], subdir = ""): Promise<Address> {
  const { abi, bytecode } = loadFoundryArtifact(name, subdir);
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  await waitForNonce(nonce);
  const hash = await walletClient.deployContract({ abi, bytecode, args, nonce });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (!receipt.contractAddress) throw new Error(`Deploy ${name} failed`);
  console.log(`${name} deployed to: ${receipt.contractAddress}`);
  await waitForNonce(nonce + 1);
  return receipt.contractAddress;
}

async function main() {
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  console.log("Deployer:", account.address);

  // 1. Mock registries
  const mockIdentity = await deploy("MockIdentityRegistry");
  const mockReputation = await deploy("MockReputationRegistry");

  // 2. Modules
  const uniModule = await deploy("UniswapScoreModule", [account.address], "UniswapScoreModule.sol");
  const baseModule = await deploy("BaseActivityModule", [account.address], "BaseActivityModule.sol");

  // 3. V2 implementation
  const v2Impl = await deploy("AgentRepValidatorV2");

  // 4. Proxy
  const { abi: proxyAbi, bytecode: proxyBytecode } = loadFoundryArtifact("ERC1967Proxy", "ERC1967Proxy.sol");
  const v2Abi = loadFoundryArtifact("AgentRepValidatorV2").abi;
  const iface = new (await import("ethers")).Interface(v2Abi);
  const encodedInit = iface.encodeFunctionData("initialize", [
    mockIdentity,
    mockReputation,
    "0x0000000000000000000000000000000000000000",
    account.address,
  ]);

  const proxyHash = await walletClient.deployContract({
    abi: proxyAbi,
    bytecode: proxyBytecode,
    args: [v2Impl, encodedInit],
  });
  const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash, timeout: 120_000 });
  if (!proxyReceipt.contractAddress) throw new Error("Proxy deploy failed");
  const proxyAddress = proxyReceipt.contractAddress;
  console.log("V2 Proxy deployed to:", proxyAddress);

  // 5. Bootstrap modules
  const bootstrapHash = await walletClient.writeContract({
    address: proxyAddress,
    abi: v2Abi,
    functionName: "bootstrapModules",
    args: [[uniModule, baseModule], [4000n, 2500n]],
  });
  await publicClient.waitForTransactionReceipt({ hash: bootstrapHash });
  console.log("Bootstrapped modules");

  // 6. Set keepers
  const uniModAbi = loadFoundryArtifact("UniswapScoreModule", "UniswapScoreModule.sol").abi;
  const baseModAbi = loadFoundryArtifact("BaseActivityModule", "BaseActivityModule.sol").abi;
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address:uniModule,abi:uniModAbi,functionName:"setKeeper",args:[account.address,true]
    })
  });
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address:baseModule,abi:baseModAbi,functionName:"setKeeper",args:[account.address,true]
    })
  });
  console.log("Set keepers");

  // 7. Mock identity set wallet
  const mockIdAbi = loadFoundryArtifact("MockIdentityRegistry").abi;
  const agentId = 42n;
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: mockIdentity, abi: mockIdAbi, functionName: "setAgentWallet", args: [agentId, account.address]
    })
  });
  console.log(`Set agent ${agentId} wallet`);

  // 8. Submit swap summary to Uniswap module
  const mockPool = await deploy("MockSwapPool", [], "MockSwapPool.sol");
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: mockPool,
      abi: loadFoundryArtifact("MockSwapPool").abi,
      functionName: "emitSwap",
      args: [account.address, account.address, 1000000n, -950000n, 79228162514264337593543950336n, 1000000n, 0],
    })
  });

  const swapSummary = {
    swapCount: 1n,
    volumeUSD: 1000000n,
    netPnL: 50000n,
    avgSlippageBps: 10n,
    feeToPnlRatioBps: 100n,
    washTradeFlag: false,
    counterpartyConcentrationFlag: false,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    evidenceHash: keccak256(toBytes("e2e-test-swap")),
    pool: mockPool,
  };
  const uniNonce = await fetchNonce(publicClient as any, uniModule, account.address);
  const uniSig = await signSwapSummary(walletClient as any, uniModule, account.address, swapSummary, uniNonce);
  const submitSwapAbi = [
    {
      inputs: [
        { internalType: "address", name: "wallet", type: "address" },
        {
          components: [
            { internalType: "uint256", name: "swapCount", type: "uint256" },
            { internalType: "uint256", name: "volumeUSD", type: "uint256" },
            { internalType: "int256", name: "netPnL", type: "int256" },
            { internalType: "uint256", name: "avgSlippageBps", type: "uint256" },
            { internalType: "uint256", name: "feeToPnlRatioBps", type: "uint256" },
            { internalType: "bool", name: "washTradeFlag", type: "bool" },
            { internalType: "bool", name: "counterpartyConcentrationFlag", type: "bool" },
            { internalType: "uint256", name: "timestamp", type: "uint256" },
            { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
            { internalType: "address", name: "pool", type: "address" },
          ],
          internalType: "struct UniswapScoreModule.SwapSummary",
          name: "summary",
          type: "tuple",
        },
        { internalType: "bytes", name: "signature", type: "bytes" },
      ],
      name: "submitSwapSummary",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ] as const;
  await submitWithRetry(
    async () => {
      const hash = await walletClient.writeContract({
        chain: xLayerTestnet as Chain,
        account,
        address: uniModule,
        abi: submitSwapAbi,
        functionName: "submitSwapSummary",
        args: [account.address, swapSummary, uniSig],
      });
      return publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    },
    { label: "submitSwapSummary", maxRetries: 3 }
  );
  console.log("Submitted swap summary");

  // 9. Submit activity summary to Base module
  const now = BigInt(Math.floor(Date.now() / 1000));
  const actSummary = {
    txCount: 50n,
    firstTxTimestamp: now - 86400n * 30n,
    lastTxTimestamp: now,
    uniqueCounterparties: 10n,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-activity")),
    sybilClusterFlag: false,
  };
  const baseNonce = await fetchNonce(publicClient as any, baseModule, account.address);
  const baseSig = await signActivitySummary(walletClient as any, baseModule, account.address, actSummary, baseNonce);
  const submitActAbi = [
    {
      inputs: [
        { internalType: "address", name: "wallet", type: "address" },
        {
          components: [
            { internalType: "uint256", name: "txCount", type: "uint256" },
            { internalType: "uint256", name: "firstTxTimestamp", type: "uint256" },
            { internalType: "uint256", name: "lastTxTimestamp", type: "uint256" },
            { internalType: "uint256", name: "uniqueCounterparties", type: "uint256" },
            { internalType: "uint256", name: "timestamp", type: "uint256" },
            { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
            { internalType: "bool", name: "sybilClusterFlag", type: "bool" },
          ],
          internalType: "struct BaseActivityModule.ActivitySummary",
          name: "summary",
          type: "tuple",
        },
        { internalType: "bytes", name: "signature", type: "bytes" },
      ],
      name: "submitActivitySummary",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ] as const;
  await submitWithRetry(
    async () => {
      const hash = await walletClient.writeContract({
        chain: xLayerTestnet as Chain,
        account,
        address: baseModule,
        abi: submitActAbi,
        functionName: "submitActivitySummary",
        args: [account.address, actSummary, baseSig],
      });
      return publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    },
    { label: "submitActivitySummary", maxRetries: 3 }
  );
  console.log("Submitted activity summary");

  // 10. Evaluate
  const evalHash = await walletClient.writeContract({
    address: proxyAddress,
    abi: v2Abi,
    functionName: "evaluateAgent",
    args: [agentId],
  });
  await publicClient.waitForTransactionReceipt({ hash: evalHash });
  console.log("evaluateAgent called");

  // 11. Query
  const latest = await publicClient.readContract({
    address: proxyAddress,
    abi: v2Abi,
    functionName: "getLatestScore",
    args: [agentId],
  }) as readonly [bigint, bigint, `0x${string}`];
  console.log("Latest score:", latest[0].toString());

  const modScores = await publicClient.readContract({
    address: proxyAddress,
    abi: v2Abi,
    functionName: "getModuleScores",
    args: [agentId],
  }) as readonly [readonly string[], readonly bigint[], readonly bigint[], readonly `0x${string}`[]];
  for (let i = 0; i < modScores[0].length; i++) {
    console.log(`  ${modScores[0][i]}: score=${modScores[1][i]}, conf=${modScores[2][i]}`);
  }

  console.log("\n=== V2 Mock E2E PASSED ===");
  console.log(`Proxy: ${proxyAddress}`);
  console.log(`AgentId: ${agentId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
