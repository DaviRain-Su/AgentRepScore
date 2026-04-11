# AgentRepScore — 任务拆解 (Phase 4)

> 版本：v1.1
> 日期：2026-04-11
> 基于技术规格 v2.1，覆盖 4 天 Hackathon 全流程

---

## 原则

1. **文档先行**：每个 Phase 的文档先于代码完成，减少返工。
2. **day-by-day  checkpoint**：每天结束时有可运行/可演示的 milestone。
3. **风险前置**：不确定的外部依赖（ERC-8004 ABI、OnchainOS SDK、Keeper 数据）在 Day 1 上午解决。
4. **测试驱动**：合约写完后 2 小时内必须有 Foundry 测试覆盖核心路径。

---

## Day 1（4 月 12 日）— 搭建基础

**目标：项目骨架 + AaveScoreModule + 测试网首次部署**

### 上午：环境 & 外部依赖确认

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 1.1 | 初始化仓库：pnpm + Hardhat + Foundry | Davirain | `forge build` 和 `npx hardhat compile` 均成功 | 1h |
| 1.2 | 安装依赖：OpenZeppelin Contracts, viem, ethers@6 | Davirain | `package.json` 和 `foundry.toml` 正确配置 | 0.5h |
| 1.3 | 确认 ERC-8004 合约调用路径 | Davirain | 用 viem 读取 X Layer 上 ReputationRegistry 的 `getVersion()`，验证 ABI 可用 | 0.5h |
| 1.4 | 确认 OnchainOS SDK 包名与认证方式 | Davirain | 能成功调用一次 test API（如获取 xETH 价格） | 1h |
| 1.5 | 确认 Aave V3 Pool `getUserAccountData` 在 X Layer 上可调用 | Davirain | 用脚本读取一个已知地址的 account data | 0.5h |

### 下午：合约骨架 & Aave 模块

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 1.6 | 编写 `IScoreModule.sol` 和 `ScoreConstants.sol` | Davirain | 编译通过 | 0.5h |
| 1.7 | 编写 `AgentRepValidator.sol` 骨架（存储 + 模块管理 + evaluateAgent 空壳 + handleValidationRequest stub） | Davirain | 编译通过 | 1.5h |
| 1.8 | 编写 `AaveScoreModule.sol` | Davirain | 评分逻辑符合技术规格第 4.2 节 | 1.5h |
| 1.9 | 编写 Foundry 测试：`AaveScoreModule.t.sol` | Davirain | 覆盖健康因子、利用率、资产数的加分/减分支 | 1h |
| 1.10 | 编写 Hardhat 部署脚本 `deploy-aave-module.ts` | Davirain | 成功部署到 X Layer Sepolia | 1h |

### Day 1 Checkpoint

- [ ] 仓库可编译（Hardhat + Foundry）
- [ ] `AaveScoreModule` 已部署到 X Layer Sepolia 并有测试覆盖
- [ ] 外部依赖（ERC-8004 ABI、Aave Pool、OnchainOS SDK）全部验证通过

---

## Day 2（4 月 13 日）— 核心集成

**目标：Uniswap + BaseActivity 模块 + Skill 核心命令 + 测试网完整部署**

### 上午：剩余评分模块

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 2.1 | 编写 `UniswapScoreModule.sol`（含 keeper 接口 + evaluate 逻辑） | Davirain | 编译通过；`submitSwapSummary` 有 `onlyKeeper` | 2h |
| 2.2 | 编写 `BaseActivityModule.sol`（含 keeper 接口 + evaluate 逻辑） | Davirain | 编译通过；`submitActivitySummary` 有 `onlyKeeper` | 1.5h |
| 2.3 | Foundry 测试：`UniswapScoreModule.t.sol` | Davirain | 覆盖刷量标记、数据过期、分数边界 | 1h |
| 2.4 | Foundry 测试：`BaseActivityModule.t.sol` | Davirain | 覆盖不活跃惩罚、交互方阈值 | 0.5h |

### 下午：主合约集成 + TypeScript Skill

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 2.5 | 完成 `AgentRepValidator.sol` 的 `evaluateAgent`、`giveFeedback` 调用和 `handleValidationRequest` stub | Davirain | Foundry 集成测试：模拟 3 个模块，验证加权聚合和 ERC-8004 mock 调用 | 2h |
| 2.6 | 部署脚本：一键部署全部合约并注册模块（权重 4000/3500/2500），并设置 keeper 地址 | Davirain | 运行脚本后，链上可查询 modules 列表 | 1h |
| 2.6a | 编写最小 keeper mock 脚本（Hardhat/TS）：向 Uniswap/BaseActivity 模块提交预设摘要 | Davirain | 成功让 `rep:evaluate` 产生非零分数，支持 Day 2 Skill 测试 | 0.5h |
| 2.7 | TypeScript Skill：`rep:register`（封装 ERC-8004 register + setAgentWallet） | Davirain | CLI 可调，返回 agentId 和 tx hash | 1h |
| 2.8 | TypeScript Skill：`rep:evaluate`（调用 evaluateAgent 并等待回执） | Davirain | CLI 可调，返回总分和模块细分；Day 2 可先用 mock keeper 数据验证 | 1h |
| 2.9 | TypeScript Skill：`rep:query`（读取 agentScores + 应用时间衰减） | Davirain | CLI 可调，返回 rawScore、decayedScore、trustTier | 1h |

### Day 2 Checkpoint

- [ ] 3 个模块 + 主合约全部部署到 X Layer Sepolia
- [ ] `rep:register`、`rep:evaluate`、`rep:query` 三个命令 CLI 可运行
- [ ] Foundry 集成测试覆盖 evaluateAgent 的加权聚合逻辑

---

## Day 3（4 月 14 日）— 反作恶 + 打磨 + 端到端测试

**目标：完整的反作恶演示 + Skill 补全 + README + 测试网跑通全流程**

### 上午：反作恶与 Skill 补全

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 3.1 | 实现 keeper 脚本（TypeScript）：从 OKLink/OnchainOS 获取 swap/activity 摘要并提交链上 | Davirain | 能成功向已部署的 `UniswapScoreModule` 和 `BaseActivityModule` 提交一次摘要 | 2h |
| 3.1a | （MVP 备注）evidence 的完整 JSON 链下生成，feedbackURI 留空字符串 | Davirain | evaluate 输出的 evidenceHash 与本地 JSON 的 keccak256 一致即可 | — |
| 3.2 | 在 keeper 脚本中加入刷量检测启发式（手续费占盈亏比） | Davirain | 输出 flagged/unflagged | 1h |
| 3.3 | TypeScript Skill：`rep:compare` | Davirain | 输入多个 agentId，输出排名表 | 1h |
| 3.4 | TypeScript Skill：`rep:modules` | Davirain | 读取链上模块注册表并格式化 | 0.5h |

### 下午：端到端测试与文档

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 3.5 | 完整端到端流程测试网跑通：注册 agent → keeper 提交数据 → evaluate → query | Davirain | 每一步有交易哈希和链上可验证结果 | 2h |
| 3.6 | 反作恶演示场景：构造一个刷量地址，keeper 标记为 washTrade，evaluate 后分数显著降低 | Davirain | 对比正常地址和刷量地址的评分结果 | 1.5h |
| 3.7 | 编写 `README.md`（安装、配置环境变量、运行命令） | Davirain | 第三方可复制运行 | 1h |
| 3.8 | 编写 `SKILL.md`（trigger、输入输出示例） | Davirain | 符合项目说明书第 8 节定义 | 0.5h |

### Day 3 Checkpoint

- [ ] 测试网上完成至少 2 个 agent 的注册-评估-查询全流程
- [ ] 刷量检测有真实对比数据
- [ ] README 和 SKILL.md 完成

---

## Day 4（4 月 15 日）— 发布

**目标：主网部署（可选）+ Demo 视频 + 提交**

### 上午：主网部署与最终打磨

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 4.1 | 评估主网部署风险：gas 费用、部署顺序、验证源码 | Davirain | 决策：主网部署 or 仅展示测试网 | 0.5h |
| 4.2 | 如决策通过，执行主网部署并验证合约 | Davirain | OKLink 上可见已验证源码 | 1.5h |
| 4.3 | 整理演示脚本（注册 → 提交数据 → evaluate → query → compare） | Davirain | 所有命令预先测试好，录屏无卡顿 | 1h |

### 下午：Demo 视频与提交

| # | 任务 | 负责人 | 验收标准 | 预估时间 |
|---|------|--------|----------|----------|
| 4.4 | 录制 2 分钟 Demo 视频 | Davirain | 涵盖：模块化架构说明、Aave 评分、keeper 刷量检测、ERC-8004 查询 | 1h |
| 4.5 | 剪辑与字幕（突出 Skills Arena 和 Uniswap 集成亮点） | Davirain | MP4，<100MB，2 分钟内 | 1h |
| 4.6 | 填写 Hackathon 提交表单 | Davirain | Google Form 在 23:59 UTC 前提交成功 | 0.5h |
| 4.7 | 发布 Twitter / Moltbook | Davirain | 链接可访问 | 0.5h |

### Day 4 Checkpoint

- [ ] Demo 视频已上传
- [ ] Hackathon 表单已提交
- [ ] 公开页面（GitHub + Moltbook）可读

---

## 任务总览图

```
Day 1: 环境 + AaveModule + 测试网部署
   ↓
Day 2: Uniswap + BaseActivity + 主合约集成 + Skill 3命令
   ↓
Day 3: keeper脚本 + 反作恶演示 + README + 端到端测试网跑通
   ↓
Day 4: 主网部署(可选) + Demo视频 + 提交
```

---

## 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| X Layer Sepolia 不稳定 | 高 | Day 1 上午立即测试 RPC；备用本地 Anvil + fork |
| keeper 数据来源延迟 | 中 | Day 3 前如无法获取真实数据，用脚本生成可控的 mock 数据上链 |
| OnchainOS SDK 不可用 | 中 | fallback 到直接 viem + OKLink API 读取链上数据 |
| 合约部署 gas 不足 | 低 | 提前准备 XLAYER 测试币/主网代币 |
| Demo 视频文件过大 | 低 | 使用命令行录屏（asciinema/terminalizer）+ 后期倍速剪辑 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-11 | 初版，按 4 天 Hackathon 拆解任务 |
| v1.1 | 2026-04-11 | 增加 ScoreConstants、handleValidationRequest stub、keeper mock 脚本、feedbackURI 备注 |
