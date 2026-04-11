import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRegister = vi.fn();
const mockEvaluate = vi.fn();
const mockQuery = vi.fn();
const mockCompare = vi.fn();
const mockModules = vi.fn();
const mockLoadKeeperHealth = vi.fn();

vi.mock("../../src/skill/index", () => ({
  register: (...args: any[]) => mockRegister(...args),
  evaluate: (...args: any[]) => mockEvaluate(...args),
  query: (...args: any[]) => mockQuery(...args),
  compare: (...args: any[]) => mockCompare(...args),
  modules: (...args: any[]) => mockModules(...args),
}));

vi.mock("../../src/skill/keeper-utils", () => ({
  loadKeeperHealth: (...args: any[]) => mockLoadKeeperHealth(...args),
}));

import { app } from "../../src/server.ts";

describe("HTTP API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("GET /health returns ok with keeper health when healthy", async () => {
    mockLoadKeeperHealth.mockReturnValueOnce({
      lastSuccessBlock: "100",
      lastSuccessTimestamp: "2026-04-12T00:00:00.000Z",
      lastRunTimestamp: "2026-04-12T00:05:00.000Z",
      consecutiveFailures: 0,
    });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.keeper.healthy).toBe(true);
    expect(res.body.keeper.consecutiveFailures).toBe(0);
    expect(res.body.keeper.lastSuccessBlock).toBe("100");
  });

  it("GET /health returns ok=false when keeper failures exceed threshold", async () => {
    mockLoadKeeperHealth.mockReturnValueOnce({
      lastSuccessBlock: "50",
      lastSuccessTimestamp: "2026-04-11T00:00:00.000Z",
      lastRunTimestamp: "2026-04-12T00:05:00.000Z",
      consecutiveFailures: 5,
    });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.keeper.healthy).toBe(false);
    expect(res.body.keeper.consecutiveFailures).toBe(5);
  });

  it("GET /api-docs.json returns the OpenAPI spec", async () => {
    const res = await request(app).get("/api-docs.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.info.title).toBe("AgentRepScore API");
  });

  it("GET /docs serves Swagger UI (redirect or html)", async () => {
    const res = await request(app).get("/docs").redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });

  it("POST /register calls register skill and returns result", async () => {
    mockRegister.mockResolvedValueOnce({ agentId: "123", txHash: "0xabc" });
    const res = await request(app)
      .post("/register")
      .send({ wallet: "0x1234567890abcdef1234567890abcdef12345678", uri: "https://example.com/agent.json" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ agentId: "123", txHash: "0xabc" });
    expect(mockRegister).toHaveBeenCalledWith({
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      uri: "https://example.com/agent.json",
    });
  });

  it("POST /evaluate calls evaluate skill and returns result", async () => {
    mockEvaluate.mockResolvedValueOnce({
      agentId: "42",
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      rawScore: 8807,
      decayedScore: 8805,
      trustTier: "elite",
      timestamp: 1712822400,
      evidenceHash: "0xdeadbeef",
      moduleBreakdown: [
        { name: "UniswapScoreModule", score: 9000, confidence: 100, weight: 4000 },
      ],
    });
    const res = await request(app).post("/evaluate").send({ agentId: "42" });

    expect(res.status).toBe(200);
    expect(res.body.trustTier).toBe("elite");
    expect(mockEvaluate).toHaveBeenCalledWith({ agentId: "42" });
  });

  it("POST /query calls query skill and returns result", async () => {
    mockQuery.mockResolvedValueOnce({
      agentId: "7",
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      rawScore: 5000,
      decayedScore: 4999,
      trustTier: "basic",
      timestamp: 1712822400,
      moduleBreakdown: [],
    });
    const res = await request(app).post("/query").send({ agentId: "7" });

    expect(res.status).toBe(200);
    expect(res.body.rawScore).toBe(5000);
    expect(mockQuery).toHaveBeenCalledWith({ agentId: "7" });
  });

  it("POST /compare calls compare skill and returns sorted result", async () => {
    mockCompare.mockResolvedValueOnce([
      { agentId: "2", decayedScore: 9000, trustTier: "elite" },
      { agentId: "1", decayedScore: 5000, trustTier: "basic" },
    ]);
    const res = await request(app).post("/compare").send({ agentIds: ["1", "2"] });

    expect(res.status).toBe(200);
    expect(res.body[0].agentId).toBe("2");
    expect(mockCompare).toHaveBeenCalledWith({ agentIds: ["1", "2"] });
  });

  it("GET /modules calls modules skill and returns list", async () => {
    mockModules.mockResolvedValueOnce({
      modules: [
        { name: "UniswapScoreModule", category: "dex", address: "0xA", weight: 4000, active: true },
      ],
    });
    const res = await request(app).get("/modules");

    expect(res.status).toBe(200);
    expect(res.body.modules[0].name).toBe("UniswapScoreModule");
    expect(mockModules).toHaveBeenCalledWith();
  });

  it("returns 400 with error message on skill failure", async () => {
    mockQuery.mockRejectedValueOnce(new Error("VALIDATOR_ADDRESS not set"));
    const res = await request(app).post("/query").send({ agentId: "99" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATOR_ADDRESS not set");
  });
});
