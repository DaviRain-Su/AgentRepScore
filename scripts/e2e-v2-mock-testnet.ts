import { JsonRpcProvider, Wallet, ContractFactory, Contract, Interface, NonceManager } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";

function loadFoundryArtifact(name: string, subdir = ""): { abi: any; bytecode: string } {
  const contractPath = subdir ? subdir : `${name}.sol`;
  const artifactPath = path.join(__dirname, "../out", contractPath, `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function deployContract(wallet: Wallet, name: string, args: any[] = [], subdir = ""): Promise<string> {
  const { abi, bytecode } = loadFoundryArtifact(name, subdir);
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name} deployed to: ${address}`);
  await new Promise((r) => setTimeout(r, 3000));
  return address;
}

async function main() {
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const baseWallet = new Wallet(PRIVATE_KEY, provider);
  const wallet = new NonceManager(baseWallet);
  const deployer = wallet.address;
  console.log("Running V2 E2E with Mock Registries on X Layer Sepolia");
  console.log("Deployer:", deployer);

  // 1. Deploy mock registries
  const mockIdentity = await deployContract(wallet, "MockIdentityRegistry");
  const mockReputation = await deployContract(wallet, "MockReputationRegistry");

  // 2. Re-use existing modules (or deploy new if preferred)
  const uniModule = await deployContract(wallet, "UniswapScoreModule", [deployer], "UniswapScoreModule.sol");
  const baseModule = await deployContract(wallet, "BaseActivityModule", [deployer], "BaseActivityModule.sol");

  // 3. Deploy V2 implementation + proxy
  const v2Impl = await deployContract(wallet, "AgentRepValidatorV2");
  const v2Abi = loadFoundryArtifact("AgentRepValidatorV2").abi;
  const iface = new Interface(v2Abi);
  const initData = iface.encodeFunctionData("initialize", [
    mockIdentity,
    mockReputation,
    "0x0000000000000000000000000000000000000000",
    deployer,
  ]);

  const { abi: proxyAbi, bytecode: proxyBytecode } = loadFoundryArtifact("ERC1967Proxy", "ERC1967Proxy.sol");
  const proxyFactory = new ContractFactory(proxyAbi, proxyBytecode, wallet);
  const proxy = await proxyFactory.deploy(v2Impl, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log("V2 Proxy deployed to:", proxyAddress);

  const validator = new Contract(proxyAddress, v2Abi, wallet);

  // 4. Bootstrap modules
  const bootstrapTx = await validator.bootstrapModules([uniModule, baseModule], [4000n, 2500n]);
  await bootstrapTx.wait();
  console.log("Bootstrapped modules");

  // 5. Set keeper on modules
  const uniAbi = loadFoundryArtifact("UniswapScoreModule", "UniswapScoreModule.sol").abi;
  const baseAbi = loadFoundryArtifact("BaseActivityModule", "BaseActivityModule.sol").abi;
  const uniContract = new Contract(uniModule, uniAbi, wallet);
  const baseContract = new Contract(baseModule, baseAbi, wallet);
  await (await uniContract.setKeeper(deployer, true)).wait();
  await (await baseContract.setKeeper(deployer, true)).wait();
  console.log("Set keeper on modules");

  // 6. Prepare mock identity agent
  const mockIdentityAbi = loadFoundryArtifact("MockIdentityRegistry").abi;
  const identity = new Contract(mockIdentity, mockIdentityAbi, wallet);
  const agentId = 42n;
  await (await identity.setAgentWallet(agentId, deployer)).wait();
  console.log(`Set agent ${agentId} wallet to ${deployer}`);

  // 7. Submit mock swap summary to Uniswap module (so evaluate has data)
  const mockPool = await deployContract(wallet, "MockSwapPool", [], "MockSwapPool.sol");
  await (await (new Contract(mockPool, loadFoundryArtifact("MockSwapPool").abi, wallet)).emitSwap(
    deployer, deployer, 1000000, -950000, 79228162514264337593543950336n, 1000000n, 0
  )).wait();

  // Build and submit swap summary manually via keeper util pattern
  const { fetchNonce, signSwapSummary } = await import("../src/skill/eip712.ts");
  const { submitWithRetry } = await import("../src/skill/keeper-utils.ts");
  const { createPublicClient, createWalletClient, http, keccak256, toBytes } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { xLayerTestnet } = await import("viem/chains");

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const transport = http(RPC_URL);
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport }) as any;
  const walletClient = createWalletClient({ account, chain: xLayerTestnet, transport });

  const summary = {
    swapCount: 1n,
    volumeUSD: 1000000n,
    netPnL: 50000n,
    avgSlippageBps: 10n,
    feeToPnlRatioBps: 100n,
    washTradeFlag: false,
    counterpartyConcentrationFlag: false,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    evidenceHash: keccak256(toBytes("e2e-test-swap")),
    pool: mockPool as `0x${string}`,
  };

  const nonce = await fetchNonce(publicClient, uniModule as `0x${string}`, deployer as `0x${string}`);
  const signature = await signSwapSummary(walletClient, uniModule as `0x${string}`, deployer as `0x${string}`, summary, nonce);

  const submitAbi = [
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
        chain: xLayerTestnet,
        account,
        address: uniModule as `0x${string}`,
        abi: submitAbi,
        functionName: "submitSwapSummary",
        args: [deployer as `0x${string}`, summary, signature],
      });
      return publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    },
    { label: "submitSwapSummary", maxRetries: 3 }
  );
  console.log("Submitted swap summary");

  // 8. Submit mock activity summary to Base module
  const { signActivitySummary } = await import("../src/skill/eip712.ts");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const activitySummary = {
    txCount: 50n,
    firstTxTimestamp: now - 86400n * 30n,
    lastTxTimestamp: now,
    uniqueCounterparties: 10n,
    timestamp: now,
    evidenceHash: keccak256(toBytes("e2e-test-activity")),
    sybilClusterFlag: false,
  };
  const actNonce = await fetchNonce(publicClient, baseModule as `0x${string}`, deployer as `0x${string}`);
  const actSig = await signActivitySummary(walletClient, baseModule as `0x${string}`, deployer as `0x${string}`, activitySummary, actNonce);

  const baseSubmitAbi = [
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
        chain: xLayerTestnet,
        account,
        address: baseModule as `0x${string}`,
        abi: baseSubmitAbi,
        functionName: "submitActivitySummary",
        args: [deployer as `0x${string}`, activitySummary, actSig],
      });
      return publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    },
    { label: "submitActivitySummary", maxRetries: 3 }
  );
  console.log("Submitted activity summary");

  // 9. Evaluate agent
  const evalTx = await validator.evaluateAgent(agentId);
  await evalTx.wait();
  console.log("evaluateAgent called");

  // 10. Query results
  const latest = await validator.getLatestScore(agentId);
  console.log("Latest score:", latest.score.toString());

  const modScores = await validator.getModuleScores(agentId);
  for (let i = 0; i < modScores.names.length; i++) {
    console.log(`  ${modScores.names[i]}: score=${modScores.scores[i]}, conf=${modScores.confidences[i]}`);
  }

  console.log("\n=== V2 Mock E2E PASSED ===");
  console.log(`Proxy: ${proxyAddress}`);
  console.log(`AgentId: ${agentId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
