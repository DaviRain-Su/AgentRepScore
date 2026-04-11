# AgentRepScore — 测试规格 (Phase 5)

> 版本：v2.2
> 日期：2026-04-11
> 目标：Hackathon MVP 完成后的测试状态更新，标记已实现测试与 Production 待补齐项

---

## 1. 测试原则

1. **合约优先**：核心评分逻辑和资金安全相关代码在 Foundry 中 100% 覆盖。
2. **集成其次**：链下 Skill 与链上合约的交互流在 Hardhat + TypeScript 中验证。
3. **边界优先**：针对分数边界、冷却期、访问控制、数据过期等边界条件做重点测试。
4. **自动化测试持续扩展**：MVP 阶段已实现 fuzz 与 invariant 测试，后续应保持覆盖。

---

## 2. 测试矩阵

| 组件 | 测试框架 | 测试文件 | 覆盖目标 | 状态 |
|------|----------|----------|----------|------|
| AgentRepValidator 单元 | Foundry | `AgentRepValidator.t.sol` | 模块管理、加权聚合、冷却期、ERC-8004 交互、访问控制、治理转移 | 🟢 已实现 |
| AgentRepValidator Fuzz | Foundry | `AgentRepValidator.t.sol` | 任意权重组合不溢出、任意模块分数边界合法 | 🟢 已实现（256 runs） |
| AgentRepValidator Invariant | Foundry | `AgentRepValidator.invariants.t.sol` | 总活跃权重 ≤ 10000、任意评估分数 ∈ [-10000, 10000] | 🟢 已实现（128k calls） |
| AaveScoreModule | Foundry | `AaveScoreModule.t.sol` | 健康因子分支、利用率、资产数、清算扣分、治理转移 | 🟢 已实现 |
| UniswapScoreModule | Foundry | `UniswapScoreModule.t.sol` | keeper 提交流程、刷量标记、数据过期、分数边界 | 🟢 已实现 |
| BaseActivityModule | Foundry | `BaseActivityModule.t.sol` | 钱包年龄、交易数、交互方、不活跃惩罚 | 🟢 已实现 |
| 端到端集成 | Hardhat + TS | `integration.test.ts` | register → evaluate → query → compare 完整流 | 🟢 已实现 |
| Skill 命令（衰减/信任等级） | Vitest | `test/skill/score-decay.test.ts` | 时间衰减计算、信任等级边界分类 | 🟢 已实现 |
| Skill 命令（compare 容错） | Vitest | `test/skill/compare.test.ts` | Promise.allSettled 容错、排序逻辑 | 🟢 已实现 |
| Keeper 自动化测试 | — | — | 自动索引器提交摘要的正确性、重试逻辑 | 🔴 未实现 |
| 反作弊模拟测试 | — | — | 构造刷量地址并验证评分降低的端到端自动化 | 🟡 部分（手动演示可行，无自动化） |

---

## 3. Foundry 单元测试

### 3.1 AgentRepValidator.t.sol

#### 3.1.1 模块管理

| 用例 ID | 描述 | 前置条件 | 输入 | 预期结果 |
|---------|------|----------|------|----------|
| VAL-001 | 治理地址注册模块 | 合约已部署 | `registerModule(aaveModule, 3500)` | `modules[0].weight == 3500`，事件 `ModuleRegistered` 抛出 |
| VAL-002 | 非治理地址注册模块应失败 | 合约已部署 | `registerModule(...)` from `address(0x1234)` | revert `UnauthorizedGovernance` |
| VAL-003 | 更新权重 | aaveModule 已注册 | `updateWeight(0, 4000)` | `modules[0].weight == 4000` |
| VAL-004 | 启停模块 | aaveModule 已注册 | `setModuleActive(0, false)` | `modules[0].active == false` |
| VAL-005 | 权重总和溢出检查 | 多个模块已注册 | 注册第 4 个模块使总和 > 10000 | revert `TotalWeightExceeded` |

#### 3.1.2 evaluateAgent 核心逻辑

| 用例 ID | 描述 | 前置条件 | 输入 | 预期结果 |
|---------|------|----------|------|----------|
| VAL-010 | 正常评估 + 写入 ERC-8004 | 3 个 mock 模块已注册，agent 有 wallet | `evaluateAgent(agentId)` | 返回加权平均分；`agentScores[agentId]` 更新；mock ReputationRegistry 收到 `giveFeedback` 调用 |
| VAL-011 | 冷却期内重复评估应失败 | 刚执行过 `evaluateAgent(agentId)` | 再次调用 `evaluateAgent(agentId)` | revert `CooldownNotElapsed` |
| VAL-012 | agent 未设置 wallet | identityRegistry 返回 `address(0)` | `evaluateAgent(agentId)` | revert `AgentWalletNotSet` |
| VAL-013 | 部分模块 confidence 为 0 | mock 模块 2 返回 confidence=0 | `evaluateAgent(agentId)` | 仅模块 1 和 3 参与加权；总分 = (s1*w1 + s3*w3)/(w1+w3) |
| VAL-014 | 所有 active 模块 confidence 为 0 | 所有模块返回 confidence=0 | `evaluateAgent(agentId)` | totalScore = 0，totalWeight = 0，giveFeedback 仍被调用（value=0） |

#### 3.1.3 getModuleScores / getLatestScore

| 用例 ID | 描述 | 前置条件 | 输入 | 预期结果 |
|---------|------|----------|------|----------|
| VAL-020 | 读取最新总分 | VAL-010 已执行 | `getLatestScore(agentId)` | 返回与 VAL-010 相同的 score 和 timestamp |
| VAL-021 | 读取各模块分数 | VAL-010 已执行 | `getModuleScores(agentId)` | 返回 3 个模块的名称、分数、confidence、evidence |
| VAL-022 | 设置冷却期 | 合约已部署 | `setCooldown(12 hours)` from governance | `evaluationCooldown == 12 hours` |
| VAL-023 | 非治理地址设置冷却期应失败 | 合约已部署 | `setCooldown(...)` from `address(0x1234)` | revert `UnauthorizedGovernance` |
| VAL-024 | evaluateAgent 访问控制 | 合约已部署，非 evaluator 地址 | `evaluateAgent(agentId)` from `address(0xdead)` | revert `UnauthorizedEvaluator` |
| VAL-025 | handleValidationRequest 访问控制 | 合约已部署，非 evaluator 地址 | `handleValidationRequest(hash, agentId)` from `address(0xdead)` | revert `UnauthorizedEvaluator` |
| VAL-026 | 设置 evaluator | governance 地址 | `setEvaluator(keeper, true)` | `evaluators(keeper) == true` |
| VAL-027 | 治理转移两步确认 | governance 地址发起 | `initiateGovernanceTransfer(newGov)` + `acceptGovernanceTransfer()` from newGov | `governance == newGov`，`pendingGovernance == address(0)` |
| VAL-030 | handleValidationRequest 触发 evaluateAgent | mock 模块已注册 | `handleValidationRequest(hash, agentId)` | `validationHandled[hash] == true`；mock ReputationRegistry 收到 giveFeedback；事件 `ValidationResponded` 抛出 |
| VAL-031 | handleValidationRequest 重复调用应失败 | VAL-030 已执行 | 再次调用相同 `requestHash` | revert `ValidationAlreadyHandled` |
| VAL-032 | handleValidationRequest 校验 registry 存在性 | validationRegistry 已配置且 requestHash 不存在 | `handleValidationRequest(hash, agentId)` | revert `ValidationRequestNotFound` |
| VAL-040 | 加权聚合产生负总分 | 3 个 mock 模块均返回负分 | `evaluateAgent(agentId)` | totalScore < 0 且等于加权平均值；giveFeedback 的 value 为负 int128 |
| VAL-050 | getModuleScores 返回实际 confidence | mock 模块 2 返回 confidence=50 | `getModuleScores(agentId)` | confidences[1] == 50（非硬编码 100） |

---

### 3.2 AaveScoreModule.t.sol

| 用例 ID | 描述 | mock 数据 | 预期输出 |
|---------|------|-----------|----------|
| AAVE-001 | 从未使用 Aave | collateral=0, debt=0 | score=0, confidence=0 |
| AAVE-002 | 健康因子极佳 | healthFactor=2.5e18 | score 含 +2500 加分 |
| AAVE-003 | 健康因子良好 | healthFactor=1.6e18 | score 含 +1500 加分 |
| AAVE-004 | 健康因子及格 | healthFactor=1.1e18 | score 含 +500 加分 |
| AAVE-005 | 健康因子低于 1.0 | healthFactor=0.9e18 | score 含 -3000 扣分 |
| AAVE-006 | 利用率理想区间 | utilization=5000 | score 含 +1000 加分 |
| AAVE-007 | 利用率过高 | utilization=8500 | score 含 -500 扣分 |
| AAVE-008 | 多次清算 | liquidationCount=2 | score 含 -3000 扣分 |
| AAVE-009 | 资产多样性高 | assetCount=3 | score 含 +1000 加分 |
| AAVE-010 | 分数边界上限 | 所有正向条件触发 | score == 10000 |
| AAVE-011 | 分数下界保护 | 多次清算 + 健康因子极低 | score == -10000 |

---

### 3.3 UniswapScoreModule.t.sol

| 用例 ID | 描述 | 前置条件 | 输入 | 预期输出 |
|---------|------|----------|------|----------|
| UNI-001 | 无 swap 历史 | - | wallet 无 summary | score=0, confidence=0 |
| UNI-002 | 数据过期 | keeper 提交时间 8 天前 | `evaluate(wallet)` | score=0, confidence=0 |
| UNI-003 | keeper 提交正常数据 | summary.swapCount=10, volumeUSD=5_000e6, netPnL=+1_000e6, slippage=5 | score > 5000, confidence=100 |
| UNI-004 | 高交易量 + 低滑点 | volumeUSD=200_000e6, slippage=5, netPnL>0 | score 接近上限（~9000） |
| UNI-005 | 净亏损较大 | netPnL=-20_000e6 | score 显著下降（含 -2000 扣分） |
| UNI-006 | 刷量标记 | washTradeFlag=true | score 额外 -3000 |
| UNI-007 | 分数边界上限 | 所有理想条件 | score == 10000 |
| UNI-008 | 分数下界保护 | 刷量 + 高滑点 + 大亏损 | score == -10000 |
| UNI-009 | keeper 权限控制 | 非 keeper 地址 | `submitSwapSummary(...)` | revert `UnauthorizedKeeper` |

---

### 3.4 BaseActivityModule.t.sol

| 用例 ID | 描述 | 前置条件 | 输入 | 预期输出 |
|---------|------|----------|------|----------|
| BASE-001 | 无链上活动 | - | wallet 无 summary | score=0, confidence=0 |
| BASE-002 | 数据过期 | keeper 提交时间 8 天前 | `evaluate(wallet)` | score=0, confidence=0 |
| BASE-003 | 新钱包（30-89 天） | txCount=20, age=60, counterparties=5 | score 中等（~5000-6000） |
| BASE-004 | 成熟活跃钱包 | txCount=1200, age=400, counterparties=60 | score 接近上限 |
| BASE-005 | 交互方过少 | counterparties=2 | score 额外 -1000 |
| BASE-006 | 长期不活跃 | lastTxTimestamp=90 天前 | score 额外 -750（1.5 个 30 天窗口） |
| BASE-007 | 分数边界下限 | 极端不活跃 + 低交互 | score == -10000 |
| BASE-008 | keeper 权限控制 | 非 keeper 地址 | `submitActivitySummary(...)` | revert `UnauthorizedKeeper` |

---

## 4. Hardhat + TypeScript 集成测试

### 4.1 文件：`test/hardhat/integration.test.ts`

#### 4.1.1 完整流程测试

| 用例 ID | 描述 | 步骤 | 断言 |
|---------|------|------|------|
| INT-001 | register → evaluate → query | 1. `rep:register` 创建 agent<br>2. keeper 提交 Aave mock 数据<br>3. `rep:evaluate` 调用<br>4. `rep:query` 读取 | agentId 存在；evaluate 返回 score > 0；query 的 decayedScore >= rawScore * 0.98（允许微小时间差） |
| INT-002 | compare 排名 | 1. 注册 3 个 agent<br>2. 分别赋予不同 Aave 数据<br>3. `rep:compare` | 返回按 decayedScore 降序排列的列表 |
| INT-003 | modules 查询 | 已部署合约 | `rep:modules` 返回 3 个模块，权重和为 10000 |

#### 4.1.2 ERC-8004 集成

| 用例 ID | 描述 | 步骤 | 断言 |
|---------|------|------|------|
| INT-010 | evaluate 后链上 feedback 可验证 | 执行 INT-001 的 evaluate | 用 viem 读取 ReputationRegistry `getSummary(agentId, [validatorAddress], "agent-rep-score", "")`，summaryValue == evaluate 返回的 normalizedScore |

---

## 5. Skill 单元测试（TypeScript）

### 5.1 文件：`test/skill/commands.test.ts`

| 用例 ID | 描述 | 输入 | 预期输出 |
|---------|------|------|----------|
| SKILL-001 | applyDecay 衰减计算 | rawScore=8000, 30 天前 | decayedScore == 8000 * max(0.1, 1.0 - 0.02 * 30) = 3200 |
| SKILL-002 | applyDecay 下限保护 | rawScore=5000, 100 天前 | decayedScore == 500（最低 10%） |
| SKILL-003 | trustTier 边界 | 2000, 2001, 5001, 8001 | untrusted, basic, verified, elite |
| SKILL-004 | formatScore 小数位 | 整数分 8534 | 显示为 "85.34" 或 "8534/10000"（依 UI 约定） |

---

## 6. 测试环境

### 6.1 Foundry 测试网配置

```toml
# foundry.toml
[profile.default]
src = "contracts"
out = "out"
libs = ["node_modules", "lib"]

# X Layer Sepolia fork 测试
[profile.xlayer]
fork_url = "https://testrpc.xlayer.tech"
eth_rpc_url = "https://testrpc.xlayer.tech"
```

### 6.2 Hardhat 网络配置

```typescript
// hardhat.config.ts
networks: {
  xlayerSepolia: {
    url: process.env.XLAYER_TESTNET_RPC,
    accounts: [process.env.PRIVATE_KEY],
    chainId: 195,
  },
}
```

### 6.3 Mock 依赖

- **MockAavePool**：实现 `getUserAccountData`，返回可控的 collateral/debt/healthFactor。
- **MockReputationRegistry**：记录 `giveFeedback` 调用参数，用于验证 AgentRepValidator 写入正确性。
- **MockIdentityRegistry**：实现 `getAgentWallet`，返回预设地址。

---

## 7. 测试执行清单（CI / 本地）

```bash
# 1. Foundry 单元测试
forge test --watch

# 2. Hardhat 集成测试（需配置 .env）
npx hardhat test test/hardhat/integration.test.ts --network xlayerSepolia

# 3. Skill 单元测试
npx vitest run test/skill/commands.test.ts
```

---

## 8. 验收标准

- [ ] Foundry 测试行覆盖率 ≥ 80%
- [ ] `AgentRepValidator.evaluateAgent` 路径覆盖 100%（所有分支至少一次）
- [ ] Hardhat 集成测试在 X Layer Sepolia 上全部通过
- [ ] Skill 单元测试全部通过
- [ ] 无编译警告、无 slither 高危告警（如使用时间运行静态分析）

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-11 | 初版，覆盖 Foundry/Hardhat/TypeScript 三层测试策略 |
