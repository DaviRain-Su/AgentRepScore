---
name: agent-rep-score
description: Register, evaluate, query, compare, and simulate ERC-8004 agent reputation on X Layer using this repository's CLI, keeper scripts, and HTTP API. Use when working on AgentRepScore demos, on-chain reputation scoring, keeper operations, or module inspection.
---

# AgentRepScore

Use this skill for tasks in the AgentRepScore repository.

## Read first

- `../../README.md` has the canonical deployed contract addresses.
- `../../AGENTS.md` has project-specific coding rules and quality gates.
- `../../src/config.ts` selects `mainnet` vs `testnet` from `NETWORK`.
- `../../src/cli.ts` is the CLI entrypoint behind `../../bin/rep.mjs`.
- `../../src/server.ts` exposes the HTTP API and `../../openapi.json` is the schema source of truth.

## Setup

```bash
pnpm install
cp .env.example .env
# fill in PRIVATE_KEY and any required contract/module addresses
```

## Common commands

```bash
./bin/rep.mjs register https://example.com/agent.json --wallet 0x...
./bin/rep.mjs evaluate 8
./bin/rep.mjs query 8
./bin/rep.mjs compare 8 10
./bin/rep.mjs modules
./bin/rep.mjs simulate --agent-id 8
./bin/rep.mjs keeper run-once
./bin/rep.mjs keeper health
node --import tsx src/server.ts
```

## Working rules

- Treat `../../README.md` as the source of truth for deployed addresses; `.env` can drift.
- Prefer batched validator view functions over N+1 RPC loops; update `../../src/skill/abis.ts` when adding new validator views.
- Use `../../src/skill/keeper-utils.ts` for keeper submission retries, deduplication, and state persistence.
- Keep `../../src/server.ts` and `../../openapi.json` in sync when the API changes.
- Run `pnpm test:all` before finishing code changes.
