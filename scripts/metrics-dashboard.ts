/**
 * AgentRepScore On-Chain Metrics Dashboard
 *
 * Reads event logs from AgentRepValidator, UniswapScoreModule and
 * BaseActivityModule to produce a summary of system health, scoring
 * distribution and anti-gaming trigger rates.
 *
 * Usage:
 *   npx tsx scripts/metrics-dashboard.ts [--from-block=NUMBER]
 */
import { createPublicClient, http, type Address } from "viem";
import { xLayerTestnet, xLayer } from "viem/chains";
import * as dotenv from "dotenv";
import { config } from "../src/config.ts";
import { logger } from "../src/skill/logger.ts";
import {
  agentEvaluatedEventAbi,
  swapSummarySubmittedEventAbi,
  activitySummarySubmittedEventAbi,
} from "../src/skill/abis.ts";

dotenv.config();

const VALIDATOR_ADDRESS = (process.env.VALIDATOR_ADDRESS || "") as Address;
const UNISWAP_MODULE = (process.env.UNISWAP_MODULE || "") as Address;
const BASE_MODULE = (process.env.BASE_MODULE || "") as Address;
const RPC_URL = config.rpc;

interface DashboardMetrics {
  evaluateCount: number;
  avgGasUsed: number | null;
  medianGasUsed: number | null;
  uniswap: {
    submissions: number;
    avgSwapCount: number;
    washTradeRate: number;
    counterpartyConcentrationRate: number;
  };
  activity: {
    submissions: number;
    avgTxCount: number;
    sybilClusterRate: number;
  };
  trustTierDistribution: {
    untrusted: number;
    basic: number;
    verified: number;
    elite: number;
  };
  recentAgents: { agentId: string; score: number; tier: string; timestamp: number }[];
}

function trustTier(score: number): "untrusted" | "basic" | "verified" | "elite" {
  if (score <= 2000) return "untrusted";
  if (score <= 5000) return "basic";
  if (score <= 8000) return "verified";
  return "elite";
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MAX_LOGS_BLOCK_RANGE = 100n;
const BATCH_CONCURRENCY = 10;

function buildBatches(fromBlock: bigint, toBlock: bigint): { fromBlock: bigint; toBlock: bigint }[] {
  const batches: { fromBlock: bigint; toBlock: bigint }[] = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const to = cursor + MAX_LOGS_BLOCK_RANGE > toBlock ? toBlock : cursor + MAX_LOGS_BLOCK_RANGE;
    batches.push({ fromBlock: cursor, toBlock: to });
    cursor = to + 1n;
  }
  return batches;
}

async function fetchBatchedLogs(
  publicClient: ReturnType<typeof createPublicClient>,
  address: Address,
  event: any,
  fromBlock: bigint,
  toBlock: bigint
): Promise<any[]> {
  const batches = buildBatches(fromBlock, toBlock);
  const results: any[] = [];
  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    const slice = batches.slice(i, i + BATCH_CONCURRENCY);
    const settled = await Promise.all(
      slice.map((b) =>
        publicClient
          .getLogs({ address, event, fromBlock: b.fromBlock, toBlock: b.toBlock })
          .catch(() => [])
      )
    );
    for (const batch of settled) results.push(...batch);
  }
  return results;
}

async function fetchEvents() {
  const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const latestBlock = await publicClient.getBlockNumber();

  const fromBlockArg = process.argv.find((a) => a.startsWith("--from-block="));
  const fromBlock = fromBlockArg ? BigInt(fromBlockArg.split("=")[1]) : (latestBlock > 5000n ? latestBlock - 5000n : 0n);

  logger.info(`[dashboard] Scanning blocks ${fromBlock} to ${latestBlock} on ${config.network}`);

  const [evaluatedLogs, swapLogs, activityLogs] = await Promise.all([
    VALIDATOR_ADDRESS
      ? fetchBatchedLogs(publicClient, VALIDATOR_ADDRESS, agentEvaluatedEventAbi, fromBlock, latestBlock)
      : Promise.resolve([]),
    UNISWAP_MODULE
      ? fetchBatchedLogs(publicClient, UNISWAP_MODULE, swapSummarySubmittedEventAbi, fromBlock, latestBlock)
      : Promise.resolve([]),
    BASE_MODULE
      ? fetchBatchedLogs(publicClient, BASE_MODULE, activitySummarySubmittedEventAbi, fromBlock, latestBlock)
      : Promise.resolve([]),
  ]);

  return { publicClient, evaluatedLogs, swapLogs, activityLogs };
}

async function computeMetrics(): Promise<DashboardMetrics> {
  const { publicClient, evaluatedLogs, swapLogs, activityLogs } = await fetchEvents();

  logger.info(`[dashboard] Found ${evaluatedLogs.length} evaluations, ${swapLogs.length} swap summaries, ${activityLogs.length} activity summaries`);

  const evaluateCount = evaluatedLogs.length;
  const gasUsages: number[] = [];
  const trustTierDistribution = { untrusted: 0, basic: 0, verified: 0, elite: 0 };
  const recentAgents: DashboardMetrics["recentAgents"] = [];

  for (const log of evaluatedLogs) {
    const score = Number(log.args.score);
    const tier = trustTier(score);
    trustTierDistribution[tier]++;
    const [block, receipt] = await Promise.all([
      publicClient.getBlock({ blockNumber: log.blockNumber }),
      publicClient.getTransactionReceipt({ hash: log.transactionHash }),
    ]);
    if (receipt?.gasUsed) {
      gasUsages.push(Number(receipt.gasUsed));
    }
    recentAgents.push({
      agentId: log.args.agentId!.toString(),
      score,
      tier,
      timestamp: Number(block.timestamp),
    });
  }

  recentAgents.sort((a, b) => b.timestamp - a.timestamp);

  let totalSwapCount = 0;
  let washTradeCount = 0;
  let counterpartyConcentrationCount = 0;
  for (const log of swapLogs) {
    totalSwapCount += Number(log.args.swapCount);
    if (log.args.washTradeFlag) washTradeCount++;
    if (log.args.counterpartyConcentrationFlag) counterpartyConcentrationCount++;
  }

  let totalTxCount = 0;
  let sybilCount = 0;
  for (const log of activityLogs) {
    totalTxCount += Number(log.args.txCount);
    if (log.args.sybilClusterFlag) sybilCount++;
  }

  return {
    evaluateCount,
    avgGasUsed: gasUsages.length > 0 ? Math.round(gasUsages.reduce((a, b) => a + b, 0) / gasUsages.length) : null,
    medianGasUsed: median(gasUsages),
    uniswap: {
      submissions: swapLogs.length,
      avgSwapCount: swapLogs.length > 0 ? Math.round(totalSwapCount / swapLogs.length) : 0,
      washTradeRate: swapLogs.length > 0 ? Math.round((washTradeCount / swapLogs.length) * 100) : 0,
      counterpartyConcentrationRate: swapLogs.length > 0 ? Math.round((counterpartyConcentrationCount / swapLogs.length) * 100) : 0,
    },
    activity: {
      submissions: activityLogs.length,
      avgTxCount: activityLogs.length > 0 ? Math.round(totalTxCount / activityLogs.length) : 0,
      sybilClusterRate: activityLogs.length > 0 ? Math.round((sybilCount / activityLogs.length) * 100) : 0,
    },
    trustTierDistribution,
    recentAgents: recentAgents.slice(0, 10),
  };
}

function renderDashboard(m: DashboardMetrics) {
  const tierData = [
    { label: "Untrusted", value: m.trustTierDistribution.untrusted, color: "#ff6b6b" },
    { label: "Basic", value: m.trustTierDistribution.basic, color: "#feca57" },
    { label: "Verified", value: m.trustTierDistribution.verified, color: "#48dbfb" },
    { label: "Elite", value: m.trustTierDistribution.elite, color: "#1dd1a1" },
  ].filter((d) => d.value > 0);

  const totalEvaluations = m.evaluateCount || 1;

  console.log("<json-render>");
  console.log(
    JSON.stringify({
      root: "dashboard",
      elements: {
        dashboard: {
          type: "Box",
          props: { flexDirection: "column", padding: 1, gap: 1 },
          children: ["title", "metricsBox", "tierChart", "recentTable"],
        },
        title: {
          type: "Heading",
          props: { text: "AgentRepScore On-Chain Metrics", level: "h1" },
          children: [],
        },
        metricsBox: {
          type: "Box",
          props: { flexDirection: "row", gap: 2 },
          children: ["evalCard", "uniswapCard", "activityCard"],
        },
        evalCard: {
          type: "Card",
          props: { title: "Evaluations", padding: 1 },
          children: ["evalCount", "evalGas"],
        },
        evalCount: {
          type: "Metric",
          props: { label: "Total evaluateAgent calls", value: String(m.evaluateCount) },
          children: [],
        },
        evalGas: {
          type: "Metric",
          props: { label: "Avg Gas", value: m.avgGasUsed != null ? String(m.avgGasUsed) : "N/A" },
          children: [],
        },
        uniswapCard: {
          type: "Card",
          props: { title: "Uniswap Module", padding: 1 },
          children: ["uniSubmissions", "uniWash", "uniCp"],
        },
        uniSubmissions: {
          type: "Metric",
          props: { label: "Submissions", value: String(m.uniswap.submissions) },
          children: [],
        },
        uniWash: {
          type: "Metric",
          props: { label: "Wash Trade Rate", value: `${m.uniswap.washTradeRate}%` },
          children: [],
        },
        uniCp: {
          type: "Metric",
          props: { label: "Counterparty Conc. Rate", value: `${m.uniswap.counterpartyConcentrationRate}%` },
          children: [],
        },
        activityCard: {
          type: "Card",
          props: { title: "Activity Module", padding: 1 },
          children: ["actSubmissions", "actSybil"],
        },
        actSubmissions: {
          type: "Metric",
          props: { label: "Submissions", value: String(m.activity.submissions) },
          children: [],
        },
        actSybil: {
          type: "Metric",
          props: { label: "Sybil Cluster Rate", value: `${m.activity.sybilClusterRate}%` },
          children: [],
        },
        tierChart: {
          type: "BarChart",
          props: {
            data: tierData.map((d) => ({ label: d.label, value: d.value, color: d.color })),
            showPercentage: true,
          },
          children: [],
        },
        recentTable: {
          type: "Table",
          props: {
            columns: [
              { header: "Agent ID", key: "agentId", width: 12 },
              { header: "Score", key: "score", width: 10 },
              { header: "Tier", key: "tier", width: 12 },
              { header: "Time", key: "time", width: 20 },
            ],
            rows: m.recentAgents.map((a) => ({
              agentId: a.agentId,
              score: String(a.score),
              tier: a.tier,
              time: new Date(a.timestamp * 1000).toISOString(),
            })),
          },
          children: [],
        },
      },
    })
  );
  console.log("</json-render>");
}

async function main() {
  logger.info("[dashboard] Starting metrics collection...");
  const metrics = await computeMetrics();
  renderDashboard(metrics);
}

main().catch((err) => {
  logger.error("[dashboard] Fatal error", { err });
  process.exit(1);
});
