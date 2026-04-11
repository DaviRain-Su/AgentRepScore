import { createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const UNISWAP_MODULE = process.env.UNISWAP_MODULE || "";
const BASE_MODULE = process.env.BASE_MODULE || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

function makeEvidence(label: string) {
  return keccak256(toBytes(label));
}

function parseFlag(name: string, fallback: boolean): boolean {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const val = arg.split("=")[1].toLowerCase();
  return val === "true" || val === "1";
}

function parseBigInt(name: string, fallback: bigint): bigint {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return BigInt(arg.split("=")[1]);
}

const profiles: Record<string, { swap: any; activity: any }> = {
  good: {
    swap: {
      swapCount: 120n,
      volumeUSD: 250_000n * 1_000_000n,
      netPnL: 15_000n * 1_000_000n,
      avgSlippageBps: 8n,
      feeToPnlRatioBps: 1500n,
      washTradeFlag: false,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      evidenceHash: makeEvidence("good-swap-evidence"),
    },
    activity: {
      txCount: 2500n,
      firstTxTimestamp: BigInt(Math.floor(Date.now() / 1000) - 400 * 86400),
      lastTxTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      uniqueCounterparties: 80n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      evidenceHash: makeEvidence("good-activity-evidence"),
    },
  },
  wash: {
    swap: {
      swapCount: 500n,
      volumeUSD: 50_000n * 1_000_000n,
      netPnL: -5_000n * 1_000_000n,
      avgSlippageBps: 120n,
      feeToPnlRatioBps: 8500n,
      washTradeFlag: true,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      evidenceHash: makeEvidence("wash-swap-evidence"),
    },
    activity: {
      txCount: 800n,
      firstTxTimestamp: BigInt(Math.floor(Date.now() / 1000) - 200 * 86400),
      lastTxTimestamp: BigInt(Math.floor(Date.now() / 1000) - 5 * 86400),
      uniqueCounterparties: 2n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      evidenceHash: makeEvidence("wash-activity-evidence"),
    },
  },
};

const uniswapAbi = [
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
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
        ],
        internalType: "struct UniswapScoreModule.SwapSummary",
        name: "summary",
        type: "tuple",
      },
    ],
    name: "submitSwapSummary",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const baseAbi = [
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
        ],
        internalType: "struct BaseActivityModule.ActivitySummary",
        name: "summary",
        type: "tuple",
      },
    ],
    name: "submitActivitySummary",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function printUsage() {
  console.log(`
Usage:
  npx ts-node scripts/keeper-mock.ts --wallet=0x... --profile=good|wash
  npx ts-node scripts/keeper-mock.ts --wallet=0x... --profile=good --swapCount=200 --volumeUSD=50000

Profiles:
  good  - High-volume, profitable, organic trader
  wash  - Wash-trading, low counterparties, inactive

Override flags (applied on top of profile):
  --swapCount=<n>
  --volumeUSD=<n>           (in USD, will be multiplied by 1e6)
  --netPnL=<n>              (in USD, will be multiplied by 1e6)
  --avgSlippageBps=<n>
  --feeToPnlRatioBps=<n>
  --washTradeFlag=true|false
  --txCount=<n>
  --firstTxTimestamp=<unix>
  --lastTxTimestamp=<unix>
  --uniqueCounterparties=<n>
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set");
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: xLayerTestnet,
    transport: http(process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech"),
  });

  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  const profileArg = process.argv.find((a) => a.startsWith("--profile="));

  if (!walletArg) {
    console.error("Missing --wallet argument");
    printUsage();
    process.exit(1);
  }

  const wallet = walletArg.split("=")[1] as `0x${string}`;
  const profileName = profileArg ? profileArg.split("=")[1] : "good";
  const baseProfile = profiles[profileName] || profiles.good;

  const now = BigInt(Math.floor(Date.now() / 1000));

  const swap = {
    swapCount: parseBigInt("swapCount", baseProfile.swap.swapCount),
    volumeUSD: parseBigInt("volumeUSD", baseProfile.swap.volumeUSD / 1_000_000n) * 1_000_000n,
    netPnL: parseBigInt("netPnL", baseProfile.swap.netPnL / 1_000_000n) * 1_000_000n,
    avgSlippageBps: parseBigInt("avgSlippageBps", baseProfile.swap.avgSlippageBps),
    feeToPnlRatioBps: parseBigInt("feeToPnlRatioBps", baseProfile.swap.feeToPnlRatioBps),
    washTradeFlag: parseFlag("washTradeFlag", baseProfile.swap.washTradeFlag),
    timestamp: now,
    evidenceHash: makeEvidence(`${profileName}-swap-evidence-${now}`),
  };

  const activity = {
    txCount: parseBigInt("txCount", baseProfile.activity.txCount),
    firstTxTimestamp: parseBigInt("firstTxTimestamp", baseProfile.activity.firstTxTimestamp),
    lastTxTimestamp: parseBigInt("lastTxTimestamp", baseProfile.activity.lastTxTimestamp),
    uniqueCounterparties: parseBigInt("uniqueCounterparties", baseProfile.activity.uniqueCounterparties),
    timestamp: now,
    evidenceHash: makeEvidence(`${profileName}-activity-evidence-${now}`),
  };

  if (!UNISWAP_MODULE || !BASE_MODULE) {
    console.error("Set UNISWAP_MODULE and BASE_MODULE in .env");
    process.exit(1);
  }

  console.log(`Submitting ${profileName} profile for wallet ${wallet}...`);
  console.log("Swap summary:", swap);
  console.log("Activity summary:", activity);

  const tx1 = await walletClient.writeContract({
    address: UNISWAP_MODULE as `0x${string}`,
    abi: uniswapAbi,
    functionName: "submitSwapSummary",
    args: [wallet, swap],
  });
  console.log("Swap summary submitted:", tx1);

  const tx2 = await walletClient.writeContract({
    address: BASE_MODULE as `0x${string}`,
    abi: baseAbi,
    functionName: "submitActivitySummary",
    args: [wallet, activity],
  });
  console.log("Activity summary submitted:", tx2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
