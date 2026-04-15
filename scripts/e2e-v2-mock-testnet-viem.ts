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


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deploy(name: string, args: any[] = [], subdir = ""): Promise<Address> {
  const { abi, bytecode } = loadFoundryArtifact(name, subdir);
  // X Layer testnet RPC has slow nonce propagation; retry on nonce conflicts
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const hash = await walletClient.deployContract({ abi, bytecode, args });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (!receipt.contractAddress) throw new Error(`Deploy ${name} failed`);
      console.log(`${name} deployed to: ${receipt.contractAddress}`);
      // Wait for RPC nonce to catch up before next deploy
      await sleep(3000);
      return receipt.contractAddress;
    } catch (err: any) {
      if (attempt < 4 && (err.message?.includes("underpriced") || err.message?.includes("nonce"))) {
        console.log(`Deploy ${name} nonce conflict, retrying in 5s (attempt ${attempt + 1})...`);
        await sleep(5000);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Deploy ${name} failed after retries`);
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

  // 6. Set keepers (with retry for nonce conflicts)
  const uniModAbi = loadFoundryArtifact("UniswapScoreModule", "UniswapScoreModule.sol").abi;
  const baseModAbi = loadFoundryArtifact("BaseActivityModule", "BaseActivityModule.sol").abi;

  async function sendTx(opts: any, label: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const hash = await walletClient.writeContract(opts);
        await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        console.log(`${label} confirmed`);
        await sleep(3000);
        return;
      } catch (err: any) {
        if (attempt < 4 && (err.message?.includes("underpriced") || err.message?.includes("nonce"))) {
          console.log(`${label} nonce conflict, retrying in 5s (attempt ${attempt + 1})...`);
          await sleep(5000);
          continue;
        }
        throw err;
      }
    }
  }

  await sendTx({address:uniModule,abi:uniModAbi,functionName:"setKeeper",args:[account.address,true]}, "setKeeper(uniModule)");
  await sendTx({address:baseModule,abi:baseModAbi,functionName:"setKeeper",args:[account.address,true]}, "setKeeper(baseModule)");

  // 7. Mock identity set wallets for agents 8 (good), 10 (wash), 42 (legacy)
  const mockIdAbi = loadFoundryArtifact("MockIdentityRegistry").abi;
  const WASH_WALLET = "0x000000000000000000000000000000000000dEaD" as Address;
  const walletGood = account.address;
  const walletWash = WASH_WALLET;
  const walletDefault = account.address;
  const agentProfiles = [
    { id: 8n, wallet: walletGood, label: "good" },
    { id: 10n, wallet: walletWash, label: "wash" },
    { id: 42n, wallet: walletDefault, label: "legacy" },
  ] as const;
  for (const agent of agentProfiles) {
    await sendTx(
      { address: mockIdentity, abi: mockIdAbi, functionName: "setAgentWallet", args: [agent.id, agent.wallet] },
      `setAgentWallet(${agent.id}, ${agent.label})`
    );
  }

  // 8. Submit swap summaries to Uniswap module
  const mockPool = await deploy("MockSwapPool", [], "MockSwapPool.sol");
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

  async function submitSwapForWallet(wallet: Address, summary: any) {
    const nonce = await fetchNonce(publicClient as any, uniModule, wallet);
    const sig = await signSwapSummary(walletClient as any, uniModule, wallet, summary, nonce);
    await submitWithRetry(
      async () => {
        const hash = await walletClient.writeContract({
          chain: xLayerTestnet as Chain,
          account,
          address: uniModule,
          abi: submitSwapAbi,
          functionName: "submitSwapSummary",
          args: [wallet, summary, sig],
        });
        return publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      },
      { label: `submitSwapSummary-${wallet.slice(0, 6)}`, maxRetries: 3 }
    );
    console.log(`Submitted swap summary for ${wallet}`);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  // Good profile swap (agent 8)
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: mockPool,
      abi: loadFoundryArtifact("MockSwapPool").abi,
      functionName: "emitSwap",
      args: [walletGood, walletGood, 1000000n, -950000n, 79228162514264337593543950336n, 1000000n, 0],
    })
  });
  await submitSwapForWallet(walletGood, {
    swapCount: 1n,
    volumeUSD: 1000000n,
    netPnL: 50000n,
    avgSlippageBps: 10n,
    feeToPnlRatioBps: 100n,
    washTradeFlag: false,
    counterpartyConcentrationFlag: false,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-swap-good")),
    pool: mockPool,
  });

  // Wash profile swap (agent 10)
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: mockPool,
      abi: loadFoundryArtifact("MockSwapPool").abi,
      functionName: "emitSwap",
      args: [walletWash, walletWash, 1000000n, -1100000n, 79228162514264337593543950336n, 1000000n, 0],
    })
  });
  await submitSwapForWallet(walletWash, {
    swapCount: 1n,
    volumeUSD: 1000000n,
    netPnL: -100000n,
    avgSlippageBps: 800n,
    feeToPnlRatioBps: 100n,
    washTradeFlag: true,
    counterpartyConcentrationFlag: false,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-swap-wash")),
    pool: mockPool,
  });

  // Default profile swap (agent 42)
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: mockPool,
      abi: loadFoundryArtifact("MockSwapPool").abi,
      functionName: "emitSwap",
      args: [walletDefault, walletDefault, 1000000n, -950000n, 79228162514264337593543950336n, 1000000n, 0],
    })
  });
  await submitSwapForWallet(walletDefault, {
    swapCount: 1n,
    volumeUSD: 1000000n,
    netPnL: 50000n,
    avgSlippageBps: 10n,
    feeToPnlRatioBps: 100n,
    washTradeFlag: false,
    counterpartyConcentrationFlag: false,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-swap-default")),
    pool: mockPool,
  });

  // 9. Submit activity summaries to Base module
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

  async function submitActivityForWallet(wallet: Address, summary: any) {
    const nonce = await fetchNonce(publicClient as any, baseModule, wallet);
    const sig = await signActivitySummary(walletClient as any, baseModule, wallet, summary, nonce);
    await submitWithRetry(
      async () => {
        const hash = await walletClient.writeContract({
          chain: xLayerTestnet as Chain,
          account,
          address: baseModule,
          abi: submitActAbi,
          functionName: "submitActivitySummary",
          args: [wallet, summary, sig],
        });
        return publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      },
      { label: `submitActivitySummary-${wallet.slice(0, 6)}`, maxRetries: 3 }
    );
    console.log(`Submitted activity summary for ${wallet}`);
  }

  // Good activity (agent 8): mature wallet, many counterparties
  await submitActivityForWallet(walletGood, {
    txCount: 50n,
    firstTxTimestamp: now - 86400n * 30n,
    lastTxTimestamp: now,
    uniqueCounterparties: 10n,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-activity-good")),
    sybilClusterFlag: false,
  });

  // Wash activity (agent 10): new wallet, few counterparties, sybil flagged
  await submitActivityForWallet(walletWash, {
    txCount: 5n,
    firstTxTimestamp: now - 86400n * 3n,
    lastTxTimestamp: now,
    uniqueCounterparties: 2n,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-activity-wash")),
    sybilClusterFlag: true,
  });

  // Default activity (agent 42)
  await submitActivityForWallet(walletDefault, {
    txCount: 50n,
    firstTxTimestamp: now - 86400n * 30n,
    lastTxTimestamp: now,
    uniqueCounterparties: 10n,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-activity-default")),
    sybilClusterFlag: false,
  });

  // 10. Evaluate agents 8, 10, 42
  for (const agent of agentProfiles) {
    const evalHash = await walletClient.writeContract({
      address: proxyAddress,
      abi: v2Abi,
      functionName: "evaluateAgent",
      args: [agent.id],
    });
    await publicClient.waitForTransactionReceipt({ hash: evalHash });
    console.log(`evaluateAgent(${agent.id}) [${agent.label}] called`);
  }

  // 11. Query all agents
  for (const agent of agentProfiles) {
    const latest = await publicClient.readContract({
      address: proxyAddress,
      abi: v2Abi,
      functionName: "getLatestScore",
      args: [agent.id],
    }) as readonly [bigint, bigint, `0x${string}`];
    console.log(`\nAgent ${agent.id} (${agent.label}): score=${latest[0]}`);

    const modScores = await publicClient.readContract({
      address: proxyAddress,
      abi: v2Abi,
      functionName: "getModuleScores",
      args: [agent.id],
    }) as readonly [readonly string[], readonly bigint[], readonly bigint[], readonly `0x${string}`[]];
    for (let i = 0; i < modScores[0].length; i++) {
      console.log(`  ${modScores[0][i]}: score=${modScores[1][i]}, conf=${modScores[2][i]}`);
    }
  }

  console.log("\n=== V2 Mock E2E PASSED ===");
  console.log(`Proxy: ${proxyAddress}`);
  console.log(`MockIdentityRegistry: ${mockIdentity}`);
  console.log(`MockReputationRegistry: ${mockReputation}`);
  console.log(`UniswapModule: ${uniModule}`);
  console.log(`BaseModule: ${baseModule}`);
  console.log(`\n.env update:`);
  console.log(`IDENTITY_REGISTRY=${mockIdentity}`);
  console.log(`REPUTATION_REGISTRY=${mockReputation}`);
  console.log(`VALIDATOR_ADDRESS=${proxyAddress}`);
  console.log(`UNISWAP_MODULE=${uniModule}`);
  console.log(`BASE_MODULE=${baseModule}`);
  console.log(`\nRegistered agents: 8 (good), 10 (wash), 42 (legacy)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
