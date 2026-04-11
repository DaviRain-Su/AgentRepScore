import express, { Request, Response, NextFunction } from "express";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { register, evaluate, query, compare, modules } from "./skill/index.ts";
import { loadKeeperHealth } from "./skill/keeper-utils.ts";
import { logger } from "./skill/logger.ts";

const app: express.Application = express();
app.use(express.json());

const openApiSpec = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json"), "utf-8")
);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/api-docs.json", (_req, res) => {
  res.json(openApiSpec);
});

app.get("/health", (_req, res) => {
  const keeper = loadKeeperHealth();
  const alertThreshold = Number(process.env.KEEPER_ALERT_THRESHOLD || "3");
  const keeperHealthy = keeper.consecutiveFailures < alertThreshold;
  res.json({
    ok: keeperHealthy,
    keeper: {
      lastSuccessBlock: keeper.lastSuccessBlock,
      lastSuccessTimestamp: keeper.lastSuccessTimestamp,
      lastRunTimestamp: keeper.lastRunTimestamp,
      consecutiveFailures: keeper.consecutiveFailures,
      alertThreshold,
      healthy: keeperHealthy,
    },
  });
});

app.post("/register", async (req, res, next) => {
  try {
    const result = await register(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/evaluate", async (req, res, next) => {
  try {
    const result = await evaluate(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/query", async (req, res, next) => {
  try {
    const result = await query(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/compare", async (req, res, next) => {
  try {
    const result = await compare(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/modules", async (_req, res, next) => {
  try {
    const result = await modules();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error("HTTP request failed", { err });
  res.status(400).json({ error: err.message });
});

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

export { app };

if (isMainModule()) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`AgentRepScore API listening on port ${PORT}`);
    logger.info(`Docs available at http://localhost:${PORT}/docs`);
  });
}
