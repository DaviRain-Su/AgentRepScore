# AgentRepScore — Agent Notes

## Codebase Patterns

- **Contract addresses**: `README.md` maintains the canonical list of deployed testnet/mainnet contracts. If integration tests fail against testnet due to address mismatches, check `README.md` first — `.env` can drift from actual deployments.
- **Multi-framework tests**: Foundry tests cover Solidity logic (unit/fuzz/invariant). vitest covers TypeScript skill code and on-chain integration tests against X Layer testnet.
- **Quality gate**: Always run `pnpm test:all` before committing. It runs both `vitest run` and `forge test`.
- **Config layering**: `src/config.ts` uses `NETWORK` env var (`mainnet` | `testnet`, defaults to `testnet`) and switches RPC, chainId, and default registry addresses accordingly. Contract-specific env vars (VALIDATOR_ADDRESS, AAVE_POOL, etc.) are read directly from `.env` without network switching.
