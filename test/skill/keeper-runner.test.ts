import { describe, it, expect } from "vitest";
import { parseWallets, loadConfigFromEnv } from "../../src/skill/keepers/runner";

describe("keeper runner", () => {
  describe("parseWallets", () => {
    it("parses comma-separated addresses", () => {
      const result = parseWallets(
        "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222"
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("0x1111111111111111111111111111111111111111");
    });

    it("returns empty array for empty string", () => {
      expect(parseWallets("")).toEqual([]);
    });

    it("filters invalid addresses", () => {
      const result = parseWallets("0x1111111111111111111111111111111111111111,bad,0x22");
      expect(result).toHaveLength(1);
    });
  });

  describe("loadConfigFromEnv", () => {
    it("loads config from env vars", () => {
      const cfg = loadConfigFromEnv({
        WALLETS: "0x1111111111111111111111111111111111111111",
        PRIVATE_KEY: "0xabc",
        UNISWAP_MODULE: "0xUni",
        UNISWAP_POOLS: "0xPool1,0xPool2",
        BASE_MODULE: "0xBase",
        DAEMON_INTERVAL_MS: "60000",
        KEEPER_ALERT_THRESHOLD: "5",
      });
      expect(cfg.wallets).toHaveLength(1);
      expect(cfg.privateKey).toBe("0xabc");
      expect(cfg.uniswapModule).toBe("0xUni");
      expect(cfg.baseModule).toBe("0xBase");
      expect(cfg.intervalMs).toBe(60000);
      expect(cfg.alertThreshold).toBe(5);
      expect(cfg.okxCredentials).toBeUndefined();
    });

    it("loads OKX credentials when all three are present", () => {
      const cfg = loadConfigFromEnv({
        WALLETS: "",
        OKX_API_KEY: "key",
        OKX_API_SECRET: "secret",
        OKX_PASSPHRASE: "pass",
        OKX_PROJECT_ID: "proj",
      });
      expect(cfg.okxCredentials).toBeDefined();
      expect(cfg.okxCredentials!.apiKey).toBe("key");
    });

    it("uses defaults when env vars are missing", () => {
      const cfg = loadConfigFromEnv({});
      expect(cfg.wallets).toEqual([]);
      expect(cfg.intervalMs).toBe(300000);
      expect(cfg.alertThreshold).toBe(3);
      expect(cfg.okxCredentials).toBeUndefined();
    });
  });
});
