import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRegister = vi.fn();
const mockEvaluate = vi.fn();
const mockQuery = vi.fn();
const mockCompare = vi.fn();
const mockModules = vi.fn();

vi.mock("../../src/skill/commands/register", () => ({
  register: (...args: any[]) => mockRegister(...args),
}));

vi.mock("../../src/skill/commands/evaluate", () => ({
  evaluate: (...args: any[]) => mockEvaluate(...args),
}));

vi.mock("../../src/skill/commands/query", () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

vi.mock("../../src/skill/commands/compare", () => ({
  compare: (...args: any[]) => mockCompare(...args),
}));

vi.mock("../../src/skill/commands/modules", () => ({
  modules: (...args: any[]) => mockModules(...args),
}));

import { program } from "../../src/cli.ts";

describe("CLI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  });

  it("register calls skill register with wallet and uri", async () => {
    mockRegister.mockResolvedValueOnce({ agentId: "123", txHash: "0xabc" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync([
      "node",
      "rep",
      "register",
      "https://example.com/agent.json",
      "--wallet",
      "0x1234567890abcdef",
    ]);

    expect(mockRegister).toHaveBeenCalledWith({
      uri: "https://example.com/agent.json",
      wallet: "0x1234567890abcdef",
    });
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ agentId: "123", txHash: "0xabc" }, null, 2)
    );

    logSpy.mockRestore();
  });

  it("register requires --wallet", async () => {
    await expect(
      program.parseAsync(["node", "rep", "register", "https://example.com"])
    ).rejects.toThrow();
  });

  it("evaluate calls skill evaluate with agentId", async () => {
    mockEvaluate.mockResolvedValueOnce({
      agentId: "42",
      rawScore: 5000,
      trustTier: "basic",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "rep", "evaluate", "42"]);

    expect(mockEvaluate).toHaveBeenCalledWith({ agentId: "42" });
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.agentId).toBe("42");

    logSpy.mockRestore();
  });

  it("query calls skill query with agentId", async () => {
    mockQuery.mockResolvedValueOnce({
      agentId: "7",
      rawScore: 8000,
      trustTier: "elite",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "rep", "query", "7"]);

    expect(mockQuery).toHaveBeenCalledWith({ agentId: "7" });
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.trustTier).toBe("elite");

    logSpy.mockRestore();
  });

  it("compare calls skill compare with agent ids", async () => {
    mockCompare.mockResolvedValueOnce([
      { agentId: "2", decayedScore: 9000, trustTier: "elite" },
      { agentId: "1", decayedScore: 5000, trustTier: "basic" },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "rep", "compare", "1", "2"]);

    expect(mockCompare).toHaveBeenCalledWith({ agentIds: ["1", "2"] });
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output[0].agentId).toBe("2");

    logSpy.mockRestore();
  });

  it("modules calls skill modules", async () => {
    mockModules.mockResolvedValueOnce({
      modules: [{ name: "Activity", weight: 30 }],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "rep", "modules"]);

    expect(mockModules).toHaveBeenCalledWith();
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.modules[0].name).toBe("Activity");

    logSpy.mockRestore();
  });

  it("outputs actionable errors without stack traces on skill failure", async () => {
    mockQuery.mockRejectedValueOnce(new Error("VALIDATOR_ADDRESS not set"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      program.parseAsync(["node", "rep", "query", "99"])
    ).rejects.toThrow("VALIDATOR_ADDRESS not set");

    errSpy.mockRestore();
  });
});
