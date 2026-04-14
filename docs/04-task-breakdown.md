# AgentRepScore — Production Roadmap & Task Breakdown

> 版本：v2.4
> 日期：2026-04-14
> 状态：P0 / P1 基本完成，当前主线切换为 **P2 全量推进**；P3 保留为愿景池，暂不排期

---

## 1. 当前状态总览

| 维度 | 完成度 | 说明 |
|------|--------|------|
| 合约核心逻辑 | ~95% | 模块化架构、权重聚合、访问控制、治理转移、Timelock、UUPS Proxy、EIP-712 keeper 签名验证已补齐 |
| 反作弊深度 | ~85% | wash trade、counterparty 集中度、sybil 资金源集群已实现；剩余主要是 **跨模块关联惩罚**（P2-05） |
| 数据基础设施 | ~85% | Uniswap 索引器、keeper daemon、重试、去重、健康检查已实现；剩余主要是 **proof-backed evidence pipeline**（P2-02 / P2-03） |
| Skill / 集成层 | ~95% | CLI、HTTP API、OpenAPI、simulate 沙盒、主网支持均已实现 |
| 运维 / DevOps | ~90% | CI、deploy workflow、verify workflow、结构化日志、metrics dashboard 已实现 |
| 安全 / 治理 | ~95% | Pausable、Timelock、Multisig、EIP-712、Proxy upgrade gate 已实现；剩余为第三方审计 |

**总体完成度：~88%（项目已具备可提交 / 可部署形态；当前主要剩余工作集中在 P2 生产级增强）**

---

## 2. 任务分级原则

- **P0 — 阻塞上线**：没有这些，系统无法安全地处理真实用户或真实资金。
- **P1 — 上线必备**：缺失会显著降低系统可信度、用户体验或被攻击风险。
- **P2 — 短期增强 / 当前主线**：在现有架构之上补齐可验证性、自适应性与跨模块分析，形成 Production 级闭环。
- **P3 — 中长期愿景（冻结）**：根据产品市场反馈再决定是否投入，当前版本不排期。

---

## 3. P0 任务（阻塞上线）

### 3.1 数据基础设施：从手工 keeper 到自动化管道

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P0-01 | 实现链下自动索引器服务 | 🟢 已完成 | BaseActivity: `keeper-rpc.ts` + `keeper-oklink.ts` 已实现。`scripts/indexer-uniswap.ts` 实现 Uniswap V3 Swap 事件索引，支持 `UNISWAP_POOLS` 配置 | 3-5 天 |
| P0-02 | 索引器自动提交摘要到链上 | 🟢 已完成 | `scripts/keeper-daemon.ts` 实现 `setInterval` 常驻服务，每 5 分钟自动运行 Swap/Activity keeper 提交（间隔可通过 `DAEMON_INTERVAL_MS` 配置）。Aave 模块已移除主路径 | 2-3 天 |
| P0-03 | 增加提交重试、去重、幂等机制 | 🟢 已完成 | `src/skill/keeper-utils.ts` 提供 `submitWithRetry`（指数退避）、`isAlreadySubmitted` 证据哈希去重、本地状态持久化（`.keeper-state.json`） | 1-2 天 |
| P0-04 | Keeper 服务监控与告警 | 🟢 已完成 | `keeper-health.json` 记录最后成功提交的 blockNumber/timestamp；`/health` 端点和 `rep keeper health` CLI 暴露健康状态；daemon 连续失败超阈值时告警 | 1 天 |

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
| P1-03 | 实现资金源集群检测 | 🟢 已完成 | `src/skill/sybil-detector.ts` 实现 `detectFundingClusters`：检测 ≥3 个钱包共享同一最早入金地址；keeper runner 在 Activity 提交前自动运行检测并标记 `sybilClusterFlag`；`BaseActivityModule.evaluate()` 对 sybil 标记扣 2000 分；测试覆盖 | 2-3 天 |
| P1-04 | 在 `UniswapScoreModule.evaluate` 中利用链上实时状态做二次校验 | 🟢 已完成 | `evaluate()` 已读取链上 Pool `slot0` sqrtPriceX96，与 `referenceSqrtPriceX96` 对比，偏差 >10% 时返回 0 分；5 个 Foundry 测试覆盖 | 1-2 天 |
| P1-11 | Keeper 提交增加链下 EIP-712 签名验证 | 🟢 已完成 | `contracts/lib/EIP712Lib.sol` 提供签名工具；Uniswap + Activity 两个模块的 `submit*` 函数均验证 EIP-712 签名 + nonce；`src/skill/eip712.ts` 提供 viem 签名封装。Aave 模块保留兼容实现 | 1-2 天 |
| P1-12 | 修复测试自欺问题 + 文档过时 | 🟢 已修复 | `compare.test.ts` 已重写为测试真实 `compare.ts` 源码（使用 `vi.mock`）；`DESIGN.md` 和 `README.md` 中的过时内容已更新 | 0.5 天 |

### 4.2 运维与 DevOps

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P1-05 | CI 添加 vitest TypeScript 测试步骤 | 🟢 已实现 | `.github/workflows/test.yml` 已添加 vitest 步骤 | 0.5 天 |
| P1-06 | CI 添加 solhint / Slither SAST 检查 | 🟢 已完成 | `.github/workflows/test.yml` 新增 `slither` job，使用 `crytic/slither-action@v0.4.0`，`fail-on: high` | 1 天 |
| P1-07 | 建立测试网 + 主网自动部署流水线 | 🟢 已完成 | `.github/workflows/deploy.yml`：tag push 自动部署测试网；workflow_dispatch 手动触发部署主网；带 dry_run 选项和 environment 保护 | 1-2 天 |
| P1-08 | 合约部署后自动验证源码 | 🟢 已完成 | `scripts/verify-contracts.ts` 使用 `forge verify-contract` 支持 OKLink + Blockscout；部署流水线自动触发验证 | 0.5 天 |

### 4.3 可观测性

| # | 任务 | 状态 | 说明 | 预估工作量 |
|---|------|------|------|------------|
| P1-09 | 添加结构化 logging | 🟢 已完成 | `src/skill/logger.ts` 输出 NDJSON 结构化日志；已替换 server/cli/keeper 中所有 console.log 调用 | 1 天 |
| P1-10 | 建立链上指标看板 | 🟢 已完成 | `scripts/metrics-dashboard.ts` 读取链上事件（AgentEvaluated / SwapSummarySubmitted / ActivitySummarySubmitted），输出 evaluateAgent 调用频率、平均 gas、模块分数分布、trust tier 占比、反作弊触发率；支持 `--from-block` 参数；自动分块并发读取以适配 RPC 100 区块限制 | 1-2 天 |

---

## 5. P2 任务（当前主线：全量推进）

### 5.1 P2 目标与边界

**目标：** 在不引入新链 / 新模块的前提下，把现有 V2 架构补齐为 Production 级闭环：

1. **可验证性**：从“keeper 摘要可信”升级到“证据可验证 / 可追溯”。
2. **自适应性**：权重不再是完全静态配置，而是可根据模块置信度与治理策略动态调整。
3. **跨模块分析**：从单模块独立评分，升级为聚合层的关联风险识别。

**当前 P2 的非目标：**
- 不新增 P3 模块（跨链桥、yield、zkML、A2A 等）
- 不扩展到多链声誉聚合
- 不在本阶段引入复杂的跨链消息或新的外部依赖系统

**实现优先级：**
- 主路径以 **Uniswap + BaseActivity** 为先
- Aave 作为兼容扩展路径；若恢复主路径接入，可沿用同一套 commitment / correlation 框架

---

### 5.2 WP-A：Proof-backed Storage & Verification（覆盖 P2-02 / P2-03）

> 目标：把当前 `submit*Summary()` 的“受信摘要”路径，升级为“摘要 + 承诺 + 证明”的双层模型。短期保留兼容摘要接口，长期以 proof-backed commitment 为主路径。

| ID | 子任务 | 状态 | 交付物 | 验收标准 | 预估 |
|----|--------|------|--------|----------|------|
| P2-02A | 定义统一 `EvidenceCommitment` 数据模型 | 🔴 未开始 | 文档、TS 类型、Solidity struct | 定义 `moduleKey / wallet / epoch / summaryHash / root / leafHash / blockRef / proofType`，Uniswap / Activity / Aave 三类证据可复用 | 0.5-1 天 |
| P2-02B | 设计压缩存储布局 | 🔴 未开始 | Validator / module 存储方案 | 链上仅保留 latest commitment、必要窗口索引与 summary hash，不再为历史明细做全量平铺存储 | 1 天 |
| P2-03A | 实现链下 proof bundle 构建器 | 🔴 未开始 | `scripts/` proof builder、JSON schema | 可从 indexer 输出 leaf、proof、root、summary payload，并能离线重算 root | 1-2 天 |
| P2-03B | 为模块增加 commitment 提交接口 | 🔴 未开始 | `submit*Commitment` / `submit*Proof` 接口 | 合约可接受 commitment 元数据、summary payload 与 proof bytes；接口与 EIP-712 keeper 签名兼容 | 1-2 天 |
| P2-03C | 实现 proof 验证与 acceptance gate | 🔴 未开始 | 合约验证逻辑 | 无效 leaf / proof / root / signer / epoch 一律拒绝；仅验证通过的 commitment 可进入 evaluate 路径 | 2-3 天 |
| P2-03D | 将 validator / skill / keeper 切换到 verified evidence 读取路径 | 🔴 未开始 | `evaluate` / CLI / HTTP / keeper 更新 | `query` / `evaluate` / `simulate` 可显示 evidence mode（summary vs verified）；verified commitment 成为默认推荐路径 | 1-2 天 |
| P2-03E | 补齐 mock E2E / Foundry / Vitest | 🔴 未开始 | 测试与回归用例 | 覆盖 root 重建、proof 成功 / 失败、兼容旧摘要接口、迁移回退路径 | 1-2 天 |

**设计说明：**
- 优先落地 **commitment-first**：先上统一 commitment 和压缩存储，再补 proof verifier。
- proof 方案允许阶段性演进：
  - Phase A：Merkle leaf + off-chain root consistency
  - Phase B：receipt/log proof onchain verify
- 兼容策略：保留现有 `submitSwapSummary` / `submitActivitySummary`，但新增 `evidenceMode` 与 deprecation plan。

---

### 5.3 WP-B：Adaptive Weights（覆盖 P2-04）

> 目标：让模块权重从“静态配置”升级为“治理基线 + runtime 自适应”，在模块数据失真、缺失或长期无 confidence 时自动降权。

| ID | 子任务 | 状态 | 交付物 | 验收标准 | 预估 |
|----|--------|------|--------|----------|------|
| P2-04A | 定义权重策略与存储结构 | 🔴 未开始 | `WeightPolicy` / `ModuleRuntimeState` | 至少支持 `minWeightBps`、`decayStepBps`、`recoveryStepBps`、`zeroConfidenceThreshold`、`enabled` | 0.5-1 天 |
| P2-04B | 实现零置信度降权 | 🔴 未开始 | Validator runtime 逻辑 | 连续 `confidence == 0` 达阈值后，模块 effective base weight 自动下降，但不影响治理配置的 nominal weight | 1 天 |
| P2-04C | 实现恢复机制 | 🔴 未开始 | 权重恢复算法 | 模块恢复非零 confidence 后可逐轮或按阈值恢复，且不超过治理配置值 | 0.5-1 天 |
| P2-04D | 暴露可观测接口 | 🔴 未开始 | view、事件、CLI 输出 | 提供 `getEffectiveWeights()`、`getWeightPolicy()`、runtime streak / recovery 状态；dashboard / API 可读 | 0.5-1 天 |
| P2-04E | 与 simulate / tests 对齐 | 🔴 未开始 | simulate 输入扩展、测试用例 | simulate 可离线复现 adaptive weight 结果；Foundry fuzz / invariant 保证 effective total weight bounded | 1-2 天 |

**设计说明：**
- **治理权重（nominal weight）** 仍然是制度层配置。
- **运行时权重（effective base weight）** 是 P2 引入的新层，用于按模块健康状态修正聚合结果。
- `effectiveWeight = effectiveBaseWeight * confidence / 100`，避免只靠 `confidence` 一次性缩放。

---

### 5.4 WP-C：Cross-Module Correlation（覆盖 P2-05）

> 目标：在聚合层识别“单模块看起来正常，但跨模块组合后高度可疑”的行为。当前优先做 **Uniswap + BaseActivity**，Aave 保留扩展钩子。

| ID | 子任务 | 状态 | 交付物 | 验收标准 | 预估 |
|----|--------|------|--------|----------|------|
| P2-05A | 定义跨模块风险信号 | 🔴 未开始 | `CorrelationSignal` 文档与类型 | 首批信号至少覆盖：高 swap 活跃 + 极低 counterparties、wash/concentration + sybilCluster 共振、短龄钱包 + 异常高成交量 | 0.5-1 天 |
| P2-05B | 在 validator 聚合层实现关联惩罚 | 🔴 未开始 | `_computeCorrelationPenalty()` | 关联惩罚基于最新模块摘要 / commitment 生成，可独立输出 penalty 与 evidence hash | 1-2 天 |
| P2-05C | 增加可配置开关与阈值 | 🔴 未开始 | 治理参数、事件 | 风险规则支持 enable/disable 与阈值调参，避免写死在合约里难以治理 | 0.5-1 天 |
| P2-05D | 对齐 metrics / query / compare 输出 | 🔴 未开始 | API / CLI / dashboard 扩展 | `evaluate`、`query`、`compare` 可显示 correlation penalty 与触发原因摘要 | 0.5-1 天 |
| P2-05E | Aave 扩展预留接口 | 🔴 未开始 | adapter / hook 设计 | 当 Aave 重新进入主路径时，可复用 correlation framework，而无需重写 validator 聚合逻辑 | 0.5 天 |
| P2-05F | 测试与回归样本 | 🔴 未开始 | Foundry + vitest + mock E2E | 至少覆盖 3 类正例、3 类反例，防止对正常高频 agent 误伤 | 1-2 天 |

**建议首批规则：**
- `washTradeFlag && sybilClusterFlag` → 高强度惩罚
- `counterpartyConcentrationFlag && uniqueCounterparties` 极低 → 中强度惩罚
- 钱包年龄很短但 `volumeUSD` / `swapCount` 极高 → 中强度惩罚
- proof mode 缺失且模块置信度长时间为零 → 通过 adaptive weight + correlation 双重降级

---

### 5.5 P2 任务总表（保留原编号映射）

| # | 任务 | 状态 | 当前实现策略 |
|---|------|------|--------------|
| P2-01 | 引入 UUPS Proxy 可升级架构 | 🟢 已完成 | `AgentRepValidatorV2` + `ERC1967Proxy` 已上线并有测试覆盖 |
| P2-02 | 将 `AgentScore` 模块化存储改为 Merkle 化/压缩存储 | 🔴 未开始 | 由 **WP-A / P2-02A~B** 承接 |
| P2-03 | 实现链上历史证据 Merkle 验证 | 🔴 未开始 | 由 **WP-A / P2-03A~E** 承接 |
| P2-04 | 引入动态权重调整（基于治理投票或链上指标） | 🔴 未开始 | 由 **WP-B / P2-04A~E** 承接 |
| P2-05 | 增加跨模块关联行为分析 | 🔴 未开始 | 由 **WP-C / P2-05A~F** 承接；先做 Uniswap + BaseActivity |
| P2-06 | 增加评分模型的链下仿真沙盒 | 🟢 已完成 | `src/skill/commands/simulate.ts` + CLI + HTTP `/simulate` |
| P2-07 | Skill 层 N+1 RPC 优化 + DRY 重构 | 🟢 已完成 | Skill 已切换到 batched view / `getModulesWithNames()` |
| P2-08 | 增加 `getModulesWithNames()` view 函数 | 🟢 已实现 | 主合约已提供一次性读取接口 |

---

## 6. P3 任务（已冻结，不纳入当前里程碑）

以下方向仍然保留产品价值，但 **本轮不排期、不拆开发任务、不纳入验收目标**：

- P3-01：StargateModule（跨链桥）
- P3-02：YieldVaultModule（收益策略）
- P3-03：GHOStableModule（稳定币风险管理）
- P3-04：跨链声誉聚合
- P3-05：Agent-to-Agent (A2A) 社会信任网络
- P3-06：MEV 行为分析模块
- P3-07：zkML 验证链下评分模型

**冻结原则：**
- 仅保留文档愿景，不创建实现分支
- 不因为 P3 需求打断 P2 主线
- 若 P2 全量完成后仍有资源，再重新评估 ROI 与优先级

---

## 7. P2 执行建议（建议按波次推进）

### Wave 1：Adaptive Weights（低风险、高收益）
- P2-04A 定义策略结构与事件
- P2-04B 连续零置信度自动降权
- P2-04C 恢复机制
- P2-04D 观测接口 + simulate 对齐

**完成标志：** 权重系统从“静态 + confidence”升级为“治理基线 + runtime 自适应”。

### Wave 2：Cross-Module Correlation（增强反作弊闭环）
- P2-05A 定义 Uniswap + BaseActivity 风险信号
- P2-05B 在 validator 聚合层落地惩罚
- P2-05C 阈值治理化
- P2-05D API / CLI / metrics 透出

**完成标志：** 项目不再只依赖单模块分数，而具备跨模块联动风控能力。

### Wave 3：Commitment-first Storage（先压缩、后验证）
- P2-02A 统一 commitment schema
- P2-02B 链上压缩存储
- P2-03A 链下 proof bundle builder
- P2-03B commitment submit 接口

**完成标志：** 数据平面从“latest summary only”升级为“latest summary + commitment root / leaf”。

### Wave 4：Proof Verification & Migration（生产级收口）
- P2-03C onchain acceptance gate
- P2-03D skill / keeper 切换 verified path
- P2-03E 测试、回滚、兼容旧摘要接口

**完成标志：** verified evidence 成为默认推荐路径，旧摘要接口进入兼容 / 迁移模式。

---

## 8. 任务状态图例

| 图例 | 含义 |
|------|------|
| 🟢 已完成 | 代码已合并，测试通过 |
| 🟡 部分完成 | 有基础实现，但还不够 Production 级别 |
| 🔴 未开始 | 完全空白，需要新开发 |
| ⏸️ 已冻结 | 保留愿景，但当前版本不排期 |

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-11 | 4 天 Hackathon 任务拆解 |
| v2.0 | 2026-04-11 | 重写为 Production Roadmap，按 P0/P1/P2/P3 分级，覆盖差距分析中的所有任务 |
| v2.1 | 2026-04-11 | 根据第二轮 Code Review 更新：标记 Pausable/Timelock/TS 编译一致性/deploy-mainnet 对齐/compare 测试/docs 更新为已完成；新增 P1-11 EIP-712 keeper 签名、P2-07 N+1 RPC 优化、P2-08 getModulesWithNames |
| v2.2 | 2026-04-12 | 同步 US-001~US-009 完成状态：P0-01/02/03/09、P1-01/02/06/09/11 标记为已完成；更新总览完成度至 ~80% |
| v2.3 | 2026-04-14 | 同步当前代码状态：P2-01 UUPS Proxy、P2-06 仿真沙盒标记为已完成；与 `AgentRepValidatorV2`、`simulate` CLI/API 实现保持一致 |
| v2.4 | 2026-04-14 | 将路线图切换为 **P2 全量推进版**：把剩余 P2 拆为 WP-A（proof-backed storage & verification）、WP-B（adaptive weights）、WP-C（cross-module correlation）；明确 P3 冻结，不纳入当前里程碑 |
