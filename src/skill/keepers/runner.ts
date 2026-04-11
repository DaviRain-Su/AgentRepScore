import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet, xLayer } from "viem/chains";
import { config } from "../../config.ts";
import { logger } from "../logger.ts";
import { updateKeeperHealth } from "../keeper-utils.ts";
import { detectFundingClusters, type TxRecord } from "../sybil-detector.ts";
import { indexAndSubmit, parsePools } from "./uniswap.ts";
import {
  fetchAndSubmitActivity as fetchAndSubmitActivityRpc,
  fetchTransactionsForSybilDetection as fetchTransactionsForSybilDetectionRpc,
} from "./activity-rpc.ts";
import {
  fetchAndSubmitActivity as fetchAndSubmitActivityOklink,
  fetchTransactionsForSybilDetection as fetchTransactionsForSybilDetectionOklink,
  type OkxCredentials,
} from "./activity-oklink.ts";
import { submitWalletMeta } from "./aave.ts";

export interface KeeperConfig {
  wallets: Address[];
  privateKey: string;
  uniswapModule?: string;
  uniswapPools?: string;
  baseModule?: string;
  aaveModule?: string;
  okxCredentials?: OkxCredentials;
  intervalMs: number;
  alertThreshold: number;
}

export function parseWallets(env: string): Address[] {
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("0x") && s.length === 42) as Address[];
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const okxKey = env.OKX_API_KEY || "";
  const okxSecret = env.OKX_API_SECRET || "";
  const okxPassphrase = env.OKX_PASSPHRASE || "";
  const okxProjectId = env.OKX_PROJECT_ID || "";
  const hasOkx = !!(okxKey && okxSecret && okxPassphrase);

  return {
    wallets: parseWallets(env.WALLETS || ""),
    privateKey: env.PRIVATE_KEY || "",
    uniswapModule: env.UNISWAP_MODULE || undefined,
    uniswapPools: env.UNISWAP_POOLS || undefined,
    baseModule: env.BASE_MODULE || undefined,
    aaveModule: env.AAVE_MODULE || undefined,
    okxCredentials: hasOkx ? { apiKey: okxKey, apiSecret: okxSecret, passphrase: okxPassphrase, projectId: okxProjectId } : undefined,
    intervalMs: Number(env.DAEMON_INTERVAL_MS || "300000"),
    alertThreshold: Number(env.KEEPER_ALERT_THRESHOLD || "3"),
  };
}

function createClients(privateKey: string): { publicClient: PublicClient; walletClient: WalletClient } {
  const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const transport = http(config.rpc);
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const walletClient = createWalletClient({ account, chain, transport });
  return { publicClient, walletClient };
}

export async function runRound(
  publicClient: PublicClient,
  walletClient: WalletClient,
  cfg: KeeperConfig
): Promise<boolean> {
  let allSuccess = true;
  const pools = cfg.uniswapPools ? parsePools(cfg.uniswapPools) : [];
  const hasUniswap = cfg.uniswapModule && pools.length > 0;
  const hasBase = !!cfg.baseModule;
  const hasAave = !!cfg.aaveModule;

  let sybilFlags = new Map<Address, boolean>();
  if (hasBase && cfg.wallets.length > 0) {
    const allRecords: TxRecord[] = [];
    for (const wallet of cfg.wallets) {
      try {
        const records = cfg.okxCredentials
          ? await fetchTransactionsForSybilDetectionOklink(wallet, cfg.okxCredentials)
          : await fetchTransactionsForSybilDetectionRpc(publicClient, wallet);
        allRecords.push(...records);
      } catch (err) {
        logger.warn("[keeper] Failed to fetch transactions for sybil detection", { wallet, err });
      }
    }
    const flagged = detectFundingClusters(
      cfg.wallets.map((w) => w.toLowerCase()),
      allRecords.map((r) => ({ ...r, from: r.from.toLowerCase(), to: r.to.toLowerCase() }))
    );
    for (const wallet of cfg.wallets) {
      sybilFlags.set(wallet, flagged.has(wallet.toLowerCase()));
    }
  }

  for (const wallet of cfg.wallets) {
    logger.info(`[keeper] Processing wallet ${wallet}`);

    if (hasUniswap) {
      try {
        await indexAndSubmit(publicClient, walletClient, wallet, pools, cfg.uniswapModule as Address);
      } catch (err) {
        logger.error("[keeper] Uniswap submission failed", { wallet, err });
        allSuccess = false;
      }
    }

    if (hasBase) {
      try {
        const sybilClusterFlag = sybilFlags.get(wallet) ?? false;
        if (cfg.okxCredentials) {
          await fetchAndSubmitActivityOklink(publicClient, walletClient, wallet, cfg.baseModule as Address, cfg.okxCredentials, { sybilClusterFlag });
        } else {
          await fetchAndSubmitActivityRpc(publicClient, walletClient, wallet, cfg.baseModule as Address, { sybilClusterFlag });
        }
      } catch (err) {
        logger.error("[keeper] Activity submission failed", { wallet, err });
        allSuccess = false;
      }
    }

    if (hasAave) {
      try {
        await submitWalletMeta(publicClient, walletClient, wallet, cfg.aaveModule as Address, 0n, 1n);
      } catch (err) {
        logger.error("[keeper] Aave submission failed", { wallet, err });
        allSuccess = false;
      }
    }
  }

  return allSuccess;
}

export async function runOnce(cfg: KeeperConfig): Promise<boolean> {
  if (!cfg.privateKey) throw new Error("PRIVATE_KEY not set");
  if (cfg.wallets.length === 0) throw new Error("No wallets configured (set WALLETS env var)");

  const { publicClient, walletClient } = createClients(cfg.privateKey);
  const success = await runRound(publicClient, walletClient, cfg);
  updateKeeperHealth(success);
  return success;
}

export async function startDaemon(cfg: KeeperConfig): Promise<void> {
  if (!cfg.privateKey) throw new Error("PRIVATE_KEY not set");
  if (cfg.wallets.length === 0) throw new Error("No wallets configured (set WALLETS env var)");
  if (cfg.intervalMs < 1000) throw new Error("DAEMON_INTERVAL_MS must be at least 1000");

  const { publicClient, walletClient } = createClients(cfg.privateKey);

  logger.info("[keeper] Starting daemon", {
    wallets: cfg.wallets,
    intervalMs: cfg.intervalMs,
    modules: {
      uniswap: !!cfg.uniswapModule,
      activity: !!cfg.baseModule,
      aave: !!cfg.aaveModule,
    },
  });

  let stopping = false;
  let runningRound = false;

  const handleSignal = (signal: string) => {
    logger.info(`[keeper] Received ${signal}, shutting down gracefully...`);
    stopping = true;
    if (!runningRound) process.exit(0);
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));

  const executeRound = async () => {
    if (stopping) return;
    runningRound = true;
    try {
      const success = await runRound(publicClient, walletClient, cfg);
      const health = updateKeeperHealth(success);
      if (health.consecutiveFailures >= cfg.alertThreshold) {
        logger.error(
          `[keeper] ALERT: ${health.consecutiveFailures} consecutive failures (threshold: ${cfg.alertThreshold})`,
          { consecutiveFailures: health.consecutiveFailures, alertThreshold: cfg.alertThreshold }
        );
      }
    } catch (err) {
      logger.error("[keeper] Round failed", { err });
      updateKeeperHealth(false);
    }
    runningRound = false;
    if (stopping) process.exit(0);
  };

  // Run immediately
  await executeRound();

  // Schedule subsequent rounds
  setInterval(executeRound, cfg.intervalMs);
  logger.info("[keeper] Daemon running. Press Ctrl+C to stop.");
}
