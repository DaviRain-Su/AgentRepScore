import express, { Request, Response, NextFunction } from "express";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { register, evaluate, query, compare, modules } from "./skill/index.ts";

const app: express.Application = express();
app.use(express.json());

const openApiSpec = JSON.parse(readFileSync("./openapi.json", "utf-8"));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/api-docs.json", (_req, res) => {
  res.json(openApiSpec);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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
    console.log(`AgentRepScore API listening on port ${PORT}`);
    console.log(`Docs available at http://localhost:${PORT}/docs`);
  });
}
