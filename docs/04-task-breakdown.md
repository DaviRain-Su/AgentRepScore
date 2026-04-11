# AgentRepScore — Production Roadmap & Task Breakdown

> 版本：v2.0
> 日期：2026-04-11
> 状态：基于 Hackathon MVP 完成后的差距分析，定义从 Demo 到 Production 的完整任务清单

---

## 1. 当前状态总览

| 维度 | 完成度 | 说明 |
|------|--------|------|
| 合约核心逻辑 | ~90% | 模块化架构、权重聚合、访问控制、治理转移、ReentrancyGuard、EIP-712 签名验证、counterparty 集中度惩罚已补齐 |
| 反作弊深度 | ~70% | wash trade 循环流转 + counterparty 集中度检测已实现；尚缺资金源集群检测（P1-03） |
| 数据基础设施 | ~80% | Uniswap 索引器 + keeper-daemon 常驻服务 + 重试/去重/幂等机制已实现；尚缺监控告警（P0-04） |
| Skill / 集成层 | ~95% | CLI + HTTP API + OpenAPI + 主网支持 + 结构化日志均已实现 |
| 运维 / DevOps | ~60% | CI 已有 vitest + Slither SAST；尚缺自动部署流水线（P1-07）和源码验证（P1-08） |
| 安全 / 治理 | ~90% | Pausable + Timelock + Multisig + EIP-712 keeper 签名已实现；仍缺第三方审计 |

**总体完成度：~80%（P0 任务基本完成，剩余主要是 P1 运维/可观测性 + P2/P3 优化项）**

---

## 2. 任务分级原则

- **P0 — 阻塞上线**：没有这些，系统无法安全地处理真实用户或真实资金。
- **P1 — 上线必备**：缺失会显著降低系统可信度、用户体验或被攻击风险。
- **P2 — 短期优化**：上线后 1-2 个月内应补齐，提升竞争力。
- **P3 — 中长期愿景**：根据产品市场反馈再决定是否投入（对应设计文档 Phase 2/3）。

---

## 3. P0 任务（阻塞上线）

### 3.1 数据基础设施：从手工 keeper 到自动化管道

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P0-01 | 实现链下自动索引器服务 | 🟢 已完成 | BaseActivity: `keeper-rpc.ts` + `keeper-oklink.ts` 已实现。`scripts/indexer-uniswap.ts` 实现 Uniswap V3 Swap 事件索引，支持 `UNISWAP_POOLS` 配置 | 3-5 天 |
| P0-02 | 索引器自动提交摘要到链上 | 🟢 已完成 | `scripts/keeper-daemon.ts` 实现 `setInterval` 常驻服务，每 5 分钟自动运行 Swap/Activity keeper 提交（间隔可通过 `DAEMON_INTERVAL_MS` 配置）。Aave 模块已移除 | 2-3 天 |
| P0-03 | 增加提交重试、去重、幂等机制 | 🟢 已完成 | `src/skill/keeper-utils.ts` 提供 `submitWithRetry`（指数退避）、`isAlreadySubmitted` 证据哈希去重、本地状态持久化（`.keeper-state.json`） | 1-2 天 |
| P0-04 | Keeper 服务监控与告警 | 🔴 未开始 | 记录最后一次成功提交的 blockNumber/timestamp，异常时告警 | 1 天 |

### 3.2 Skill / 集成层：主网支持与可调用入口

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P0-05 | 添加 X Layer 主网支持（chainId 196） | 🟢 已实现 | `config.ts` 支持 `NETWORK=mainnet\|testnet` 切换，自动选择 RPC、chainId、合约地址 | 0.5-1 天 |
| P0-06 | 暴露 CLI / HTTP API 入口 | 🟢 已实现 | `src/cli.ts`（CLI 路由）+ `src/server.ts`（HTTP API）已实现 | 1-2 天 |
| P0-07 | 添加 OpenAPI / Swagger 文档 | 🟢 已实现 | `openapi.json` 已生成 | 0.5 天 |

### 3.3 合约安全：紧急控制与权限硬化

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P0-08 | 为主合约和各模块添加 `Pausable` | 🟢 已实现 | `AgentRepValidator` + 3 个模块均已支持 `pause`/`unpause`；evaluate/keeper 提交等关键函数已加 `whenNotPaused` | 0.5-1 天 |
| P0-09 | 将 governance 从单个 EOA 迁移到 Multisig | 🟢 已完成 | `MockMultisig.sol` 2-of-3 多签测试合约已实现；部署脚本支持 `GOVERNANCE_SAFE` 环境变量作为初始 governance 地址 | 0.5 天 |
| P0-10 | 引入 Timelock 延迟关键操作 | 🟢 已实现 | `scheduleRegisterModule` / `executeRegisterModule`、`scheduleUpdateWeight` / `executeUpdateWeight` 已实现 24h Timelock；opHash 在 execute 时重新验证参数一致性；部署脚本通过 `bootstrapModules` 支持初始化注册 | 1 天 |
| P0-11 | TypeScript 层编译一致性修复 | 🟢 已修复 | `src/skill/commands/*.ts` 统一使用 `config.rpc`；`integration.test.ts` / `e2e-test.ts` 的 EIP-712 chainId 改为动态读取 `xLayerTestnet.id` | 0.5 天 |
| P0-12 | 部署脚本与合约 Timelock 对齐 | 🟢 已修复 | `deploy-mainnet.ts` 改用 `bootstrapModules` 完成初始化注册，避免调用已删除的 `registerModule` | 0.5 天 |

---

## 4. P1 任务（上线必备）

### 4.1 反作弊机制补齐

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P1-01 | 实现 A→B→A 循环流转检测（< 10 区块） | 🟢 已完成 | `scripts/indexer-uniswap.ts` 中 `detectWashTrade` 检测同一钱包 ≤10 区块内的 amount0/amount1 符号翻转，标记 `washTradeFlag`；`UniswapScoreModule` 扣 3000 分 | 1-2 天 |
| P1-02 | 实现 Counterparty 集中度检测 | 🟢 已完成 | `detectCounterpartyConcentration` 检测 ≤2 个 counterparty 且 >70% swap 活动；合约新增 `counterpartyConcentrationFlag` 字段，扣 1500 分 | 1-2 天 |
| P1-03 | 实现资金源集群检测 | 🔴 未开始 | 检测多个 Agent 钱包是否来自同一 faucet/同一笔资金的子地址分发 | 2-3 天 |
| P1-04 | 在 `UniswapScoreModule.evaluate` 中利用链上实时状态做二次校验 | 🟢 已完成 | `evaluate()` 已读取链上 Pool `slot0` sqrtPriceX96，与 `referenceSqrtPriceX96` 对比，偏差 >10% 时返回 0 分；5 个 Foundry 测试覆盖 | 1-2 天 |
| P1-11 | Keeper 提交增加链下 EIP-712 签名验证 | 🟢 已完成 | `contracts/lib/EIP712Lib.sol` 提供签名工具；Uniswap + Activity 两个模块的 `submit*` 函数均验证 EIP-712 签名 + nonce；`src/skill/eip712.ts` 提供 viem 签名封装。Aave 模块已移除 | 1-2 天 |
| P1-12 | 修复测试自欺问题 + 文档过时 | 🟢 已修复 | `compare.test.ts` 已重写为测试真实 `compare.ts` 源码（使用 `vi.mock`）；`DESIGN.md` 和 `README.md` 中的过时内容已更新 | 0.5 天 |

### 4.2 运维与 DevOps

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P1-05 | CI 添加 vitest TypeScript 测试步骤 | 🟢 已实现 | `.github/workflows/test.yml` 已添加 vitest 步骤 | 0.5 天 |
| P1-06 | CI 添加 solhint / Slither SAST 检查 | 🟢 已完成 | `.github/workflows/test.yml` 新增 `slither` job，使用 `crytic/slither-action@v0.4.0`，`fail-on: high` | 1 天 |
| P1-07 | 建立测试网 + 主网自动部署流水线 | 🔴 未开始 | 通过 GitHub Actions + foundry `forge script` 实现 tag push 自动部署到测试网，manual trigger 部署主网 | 1-2 天 |
| P1-08 | 合约部署后自动验证源码 | 🔴 未开始 | 集成 OKLink / Etherscan verify API | 0.5 天 |

### 4.3 可观测性

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P1-09 | 添加结构化 logging | 🟢 已完成 | `src/skill/logger.ts` 输出 NDJSON 结构化日志；已替换 server/cli/keeper 中所有 console.log 调用 | 1 天 |
| P1-10 | 建立链上指标看板 | 🔴 未开始 | 监控 evaluateAgent 调用频率、平均 gas、各模块分数分布、washTradeFlag 触发率 | 1-2 天 |

---

## 5. P2 任务（短期优化）

### 5.1 合约架构升级

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P2-01 | 引入 UUPS Proxy 可升级架构 | 🔴 未开始 | 当前合约不可升级，任何逻辑 bug 都需要重新部署并迁移模块注册。使用 OpenZeppelin UUPS 可降低长期运维成本 | 1-2 天 |
| P2-02 | 将 `AgentScore` 模块化存储改为 Merkle 化/压缩存储 | 🔴 未开始 | 降低链上存储成本，支持更多历史记录 | 2-3 天 |
| P2-03 | 实现链上历史证据 Merkle 验证 | 🟡 部分 | 技术规格中写了方案 A，实际 MVP 用了 keeper 摘要模式。如果要真正去信任，需要实现 receipt/log Merkle 证明验证 | 3-5 天 |

### 5.2 评分模型优化

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P2-04 | 引入动态权重调整（基于治理投票或链上指标） | 🔴 未开始 | 例如某模块长期 confidence 为 0，可自动降低其权重 | 2-3 天 |
| P2-05 | 增加跨模块关联行为分析 | 🔴 未开始 | 检测同一钱包在 Uniswap 和 Aave 上的协同操纵（如闪电贷 + 自交易） | 2-3 天 |
| P2-06 | 增加评分模型的链下仿真沙盒 | 🔴 未开始 | 在真正写入 Reputation Registry 前，允许运营方在链下模拟不同权重配置的效果 | 2 天 |
| P2-07 | Skill 层 N+1 RPC 优化 + DRY 重构 | 🟢 已完成 | `evaluate.ts` 与 `query.ts` 中通过循环读取 `modules(i)` 和 `module.name()` 产生 N+1 次 RPC 调用；应引入 multicall 或增加 `getModulesWithNames()` view 函数以减少调用次数 | 1 天 |
| P2-08 | 增加 `getModulesWithNames()` view 函数 | 🟢 已实现 | 在 `AgentRepValidator` 中增加一个函数，一次性返回所有模块的地址、权重、active 状态和名称，消除 Skill 层 N+1 查询 | 0.5 天 |

---

## 6. P3 任务（中长期愿景 / Phase 2+）

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P3-01 | 新评分模块：StargateModule（跨链桥） | 🔴 未开始 | 评估 Agent 的跨链操作成功率、滑点损失 | 3-5 天 |
| P3-02 | 新评分模块：YieldVaultModule（收益策略） | 🔴 未开始 | 夏普比率、最大回撤、年化收益 | 3-5 天 |
| P3-03 | 新评分模块：GHOStableModule（稳定币风险管理） | 🔴 未开始 | 稳定币持仓比例、脱锚风险应对 | 2-3 天 |
| P3-04 | 跨链声誉聚合 | 🔴 未开始 | 聚合同一 Agent 在 Ethereum / Base / Arbitrum / X Layer 上的 ERC-8004 分数 | 5-7 天 |
| P3-05 | Agent-to-Agent (A2A) 社会信任网络 | 🔴 未开始 | Agent 之间互相评价，构建递归信任图 | 5-7 天 |
| P3-06 | MEV 行为分析模块 | 🔴 未开始 | 检测 sandwich attack、frontrunning 等恶意 MEV | 5-7 天 |
| P3-07 | zkML 验证链下评分模型 | 🔴 未开始 | 用零知识机器学习证明keeper/索引器的评分计算是正确的 | 数周 |

---

## 7. 近期执行建议（Next 30 Days）

如果你是唯一开发者，建议按以下顺序推进：

### Week 1：安全与主网
- ~~P0-08 Pausable~~ ✅
- ~~P0-10 Timelock~~ ✅
- ~~P0-09 Multisig~~ ✅
- ~~P0-05 主网支持~~ ✅

### Week 2：自动化 keeper
- ~~P0-01 自动索引器（先只做 Uniswap Swap 事件）~~ ✅
- ~~P0-02 自动提交到链上~~ ✅
- ~~P0-03 重试/去重~~ ✅

### Week 3：反作弊 + CI
- ~~P1-01 循环流转检测~~ ✅
- ~~P1-02 Counterparty 集中度~~ ✅
- ~~P1-05 CI 添加 vitest~~ ✅
- ~~P1-06 CI 添加 Slither~~ ✅

### Week 4：入口与观测
- ~~P0-06 CLI / HTTP API~~ ✅
- ~~P0-07 OpenAPI 文档~~ ✅
- ~~P1-09 结构化 logging~~ ✅
- P1-10 指标看板

---

## 8. 任务状态图例

| 图例 | 含义 |
|------|------|
| 🟢 已完成 | 代码已合并，测试通过 |
| 🟡 部分完成 | 有基础实现，但还不够 Production 级别 |
| 🔴 未开始 | 完全空白，需要新开发 |

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-11 | 4 天 Hackathon 任务拆解 |
| v2.0 | 2026-04-11 | 重写为 Production Roadmap，按 P0/P1/P2/P3 分级，覆盖差距分析中的所有任务 |
| v2.1 | 2026-04-11 | 根据第二轮 Code Review 更新：标记 Pausable/Timelock/TS 编译一致性/deploy-mainnet 对齐/compare 测试/docs 更新为已完成；新增 P1-11 EIP-712 keeper 签名、P2-07 N+1 RPC 优化、P2-08 getModulesWithNames |
| v2.2 | 2026-04-12 | 同步 US-001~US-009 完成状态：P0-01/02/03/09、P1-01/02/06/09/11 标记为已完成；更新总览完成度至 ~80% |
