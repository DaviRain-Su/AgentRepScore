# Skill Layer Notes

## ABI Maintenance
- `src/skill/abis.ts` is the single source of truth for viem ABIs used in the skill layer.
- When adding a new view function to `AgentRepValidator.sol`, add it to `validatorAbi` here and refactor commands to use single-call batching instead of N+1 loops.

## N+1 Patterns to Avoid
- **Don't** loop `moduleCount` → `modules(index)` → `module.name()` / `module.category()`.
- **Do** use `getModulesWithNames()` which returns addresses, names, categories, weights, and active states in one RPC call.
- `evaluate.ts` and `query.ts` should use `getModulesWithNames()` to build the `weights` map, then align with `getModuleScores()` results by name.
