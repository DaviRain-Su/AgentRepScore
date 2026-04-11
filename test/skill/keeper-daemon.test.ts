import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseWallets, buildKeeperCommands } from "../../scripts/keeper-daemon";

const wallet = "0x1111111111111111111111111111111111111111" as const;

describe("parseWallets", () => {
  it("parses comma-separated addresses", () => {
    const env =
      "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222";
    const result = parseWallets(env);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("0x1111111111111111111111111111111111111111");
    expect(result[1]).toBe("0x2222222222222222222222222222222222222222");
  });

  it("returns empty array for empty string", () => {
    expect(parseWallets("")).toEqual([]);
  });

  it("filters invalid addresses", () => {
    const env =
      "0x1111111111111111111111111111111111111111,not-an-address,0x2222";
    const result = parseWallets(env);
    expect(result).toHaveLength(1);
  });
});

describe("buildKeeperCommands", () => {
  const baseEnv = {
    UNISWAP_MODULE: "",
    UNISWAP_POOLS: "",
    BASE_MODULE: "",
    OKX_API_KEY: "",
    OKX_API_SECRET: "",
    OKX_PASSPHRASE: "",
  };

  it("builds uniswap command when module and pools are set", () => {
    const cmds = buildKeeperCommands(wallet, {
      ...baseEnv,
      UNISWAP_MODULE: "0x1234",
      UNISWAP_POOLS: "0xabcd,0xef01",
    });
    expect(cmds.some((c) => c.includes("scripts/indexer-uniswap.ts"))).toBe(true);
  });

  it("builds oklink command when base module and okx credentials are set", () => {
    const cmds = buildKeeperCommands(wallet, {
      ...baseEnv,
      BASE_MODULE: "0x1234",
      OKX_API_KEY: "key",
      OKX_API_SECRET: "secret",
      OKX_PASSPHRASE: "pass",
    });
    expect(cmds.some((c) => c.includes("scripts/keeper-oklink.ts"))).toBe(true);
  });

  it("falls back to rpc keeper when okx credentials are missing", () => {
    const cmds = buildKeeperCommands(wallet, {
      ...baseEnv,
      BASE_MODULE: "0x1234",
    });
    expect(cmds.some((c) => c.includes("scripts/keeper-rpc.ts"))).toBe(true);
  });

  it("returns empty array when no modules are configured", () => {
    const cmds = buildKeeperCommands(wallet, baseEnv);
    expect(cmds).toEqual([]);
  });
});
