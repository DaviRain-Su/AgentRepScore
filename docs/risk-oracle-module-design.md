# RiskOracleModule 设计文档

> 版本：v1.0  
> 日期：2026-04-13  
> 状态：设计草案，待实现

---

## 1. 背景与动机

当前 AgentRepScore 的评分体系中，反作弊和风险控制逻辑分散在 Keeper 层和各模块内部（`sybil-detector.ts`、`indexer-uniswap.ts` 等）。这些逻辑虽然能检测特定欺诈模式，但存在三个核心问题：

1. **不可见性**：风险判断结果没有统一的链上出口，消费方无法直接读取"这个地址是否可疑"。
2. **不可扩展性**：新增风险信号（如混币器关联、MEV 行为）需要改动多个模块的 Keeper 脚本。
3. **权重缺失**：现有反作弊只能以"固定扣分"形式存在，不能动态调整风险维度在总分中的影响力。

**RiskOracleModule 的目标是将"地址风险画像"提升为与 UniswapScoreModule、BaseActivityModule 并列的一级评分维度**，通过统一的 `IScoreModule` 接口插入 Validator，实现链上可审计、可迭代、可配置的风险评估。

---

## 2. 架构定位

```
AgentRepValidatorV2 (主合约)
├── UniswapScoreModule      ← 交易能力评分
├── BaseActivityModule      ← 链上活跃度评分
└── RiskOracleModule        ← 地址风险画像评分 (NEW)
```

RiskOracleModule 完全遵循已有的 `IScoreModule` 接口，不需要改动 Validator 合约的核心架构。

---

## 3. 接口设计

### 3.1 Solidity 合约

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";

contract RiskOracleModule is IScoreModule {
    address public governance;
    bool public paused;

    // Risk thresholds (basis points of score)
    uint256 public lowRiskThreshold = 8000;      // 8000-10000
    uint256 public mediumRiskThreshold = 5000;   // 5000-7999
    uint256 public highRiskThreshold = 2000;     // 2000-4999
    // < 2000 = critical risk

    // Supported metric names for off-chain display
    string[] private _metrics = [
        "walletAgeDays",
        "txScriptedRatioBps",
        "sybilClusterFlag",
        "washTradeFlag",
        "counterpartyConcentrationFlag",
        "blacklistAssociationFlag"
    ];

    modifier onlyGovernance() {
        require(msg.sender == governance, "Unauthorized");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address governance_) {
        governance = governance_;
    }

    function name() external pure returns (string memory) {
        return "RiskOracleModule";
    }

    function category() external pure returns (string memory) {
        return "risk-assessment";
    }

    function metricNames() external view returns (string[] memory) {
        return _metrics;
    }

    function setThresholds(
        uint256 low,
        uint256 medium,
        uint256 high
    ) external onlyGovernance {
        require(low > medium && medium > high, "Invalid ordering");
        lowRiskThreshold = low;
        mediumRiskThreshold = medium;
        highRiskThreshold = high;
    }

    function pause() external onlyGovernance {
        paused = true;
    }

    function unpause() external onlyGovernance {
        paused = false;
    }

    function evaluate(address wallet) external view whenNotPaused returns (int256 score, uint256 confidence, bytes32 evidence) {
        // This module DOES NOT compute on-chain.
        // It expects the keeper to submit a RiskSummary via EIP-712 signature,
        // similar to UniswapScoreModule and BaseActivityModule.
        // The evaluate() function reads the last submitted summary and its validity window.
        // If no valid summary exists, returns confidence = 0.
        
        // (Implementation TBD based on keeper submission storage pattern.)
    }
}
```

### 3.2  Keeper 提交摘要结构

```solidity
struct RiskSummary {
    uint256 walletAgeDays;                // days since first tx
    uint256 txScriptedRatioBps;           // % of txs that look scripted (0-10000)
    bool sybilClusterFlag;                // from sybil-detector.ts
    bool washTradeFlag;                   // from indexer-uniswap.ts
    bool counterpartyConcentrationFlag;   // from activity / uniswap indexer
    bool blacklistAssociationFlag;        // tornado cash / known exploit contracts
    uint256 timestamp;                    // submission timestamp
    bytes32 evidenceHash;                 // keccak256 of all source signals
}
```

Keeper 使用 `signRiskSummary()`（EIP-712）签名后，调用 `submitRiskSummary(address wallet, RiskSummary calldata summary, bytes calldata signature)`。

---

## 4. 风险评分算法（链下Aggregator + 链上校验）

### 4.1 信号来源

| 信号 | 来源 | 说明 |
|---|---|---|
| `walletAgeDays` | `activity-rpc.ts` 二分查找首笔交易 | 越久风险越低 |
| `txScriptedRatioBps` | `activity-rpc.ts` / `activity-oklink.ts` | Gas price 规律性、目标合约集中度、调用数据相似度 |
| `sybilClusterFlag` | `sybil-detector.ts` | 多个钱包共享最早入金地址 |
| `washTradeFlag` | `indexer-uniswap.ts` | ≤10 区块 A→B→A 循环 |
| `counterpartyConcentrationFlag` | `indexer-uniswap.ts` / `activity` | ≤2 对手方且 >70% 活动集中度 |
| `blacklistAssociationFlag` | 可配置地址列表 + 未来外部 API | 与 Tornado Cash、已知黑客地址有直接交互 |

### 4.2 链下聚合逻辑（`risk-aggregator.ts`）

```typescript
function computeRiskScore(signals: RiskSignals): number {
  let score = 10000;

  // Wallet age
  if (signals.walletAgeDays < 7) score -= 1500;
  else if (signals.walletAgeDays < 30) score -= 500;

  // Scripted transactions
  score -= (signals.txScriptedRatioBps * 0.8);

  // Sybil cluster
  if (signals.sybilClusterFlag) score -= 3000;

  // Wash trade
  if (signals.washTradeFlag) score -= 2500;

  // Counterparty concentration
  if (signals.counterpartyConcentrationFlag) score -= 1500;

  // Blacklist association
  if (signals.blacklistAssociationFlag) score -= 4000;

  if (score > 10000) score = 10000;
  if (score < 0) score = 0;

  return score;
}
```

> **设计原则**：RiskOracleModule 不是二元的"通过/拒绝"闸门，而是输出 **0-10000 的梯度风险分**。主合约按权重将其纳入总分。消费方可自行决定"只和 low-risk Agent 交互"。

### 4.3 风险等级映射

| 分数区间 | 等级 | 含义 |
|---|---|---|
| 8001 - 10000 | Low Risk | 成熟钱包，交易模式自然，无异常信号 |
| 5001 - 8000 | Medium-Low Risk | 钱包较新或数据不足，但无明显恶意 |
| 2001 - 5000 | Medium Risk | 存在部分可疑模式，需要谨慎 |
| 1001 - 2000 | High Risk | 明显的反作弊信号触发 |
| 0 - 1000 | Critical Risk | 黑名单关联、多重欺诈标记 |

---

## 5. Keeper Runner 集成

修改 `src/skill/keepers/runner.ts` 的 `runRound` 流程：

```typescript
// Before submitting individual module data:
const riskSummary = await buildRiskSummary(wallet);
const riskScore = computeRiskScore(riskSummary);

// Optionally: log and skip critically risky wallets
if (riskScore < 1000) {
  logger.warn(`[risk] Skipping wallet ${wallet} due to critical risk score: ${riskScore}`);
  continue;
}

// Submit RiskOracleModule summary
await submitRiskSummary(publicClient, walletClient, wallet, riskModuleAddress, riskSummary);

// Then proceed with Uniswap / Activity submissions
```

---

## 6. 部署与权重配置

### 阶段一 MVP（黑客松后短期）

```solidity
// Validator bootstrap
RiskOracleModule riskModule = new RiskOracleModule(deployer);

validator.bootstrapModules([
    uniswapModule,      // 3500
    baseActivityModule, // 2500
    riskModule          // 2000
], [3500, 2500, 2000]);
```

MVP 版 `RiskOracleModule` 只读取已有信号（walletAge + sybil + wash + counterparty），不引入新的复杂分析。

### 阶段二 完整版（中长期）

- 引入 `txScriptedRatioBps` 的链下聚类算法
- 接入第三方风险数据 API
- 增加 `riskModule` 权重到 3000-4000，使其与交易能力维度相当

---

## 7. 待实现清单

| # | 任务 | 优先级 | 预估工作量 |
|---|---|---|---|
| 1 | `contracts/modules/RiskOracleModule.sol` | P0 | 2-3h |
| 2 | `src/skill/keepers/risk-aggregator.ts` | P0 | 2-3h |
| 3 | `src/skill/eip712.ts` 增加 `signRiskSummary` | P0 | 1h |
| 4 | `test/foundry/RiskOracleModule.t.sol` | P0 | 2h |
| 5 | `src/skill/keepers/runner.ts` 集成 Risk 提交流程 | P1 | 1h |
| 6 | 测试网部署 + 注册到 V2 Proxy | P1 | 1-2h |

---

## 8. 与其他模块的差异

| 维度 | UniswapScoreModule | BaseActivityModule | **RiskOracleModule** |
|---|---|---|---|
| 评估对象 | DeFi 交易能力 | 链上活跃度 | **地址可信度** |
| 数据源 | Uniswap Pool Swap 事件 | RPC / OKX 钱包交易 | **聚合所有模块的风险信号** |
| 反作弊 | 模块内局部检测（wash trade） | 模块内局部检测（sybil） | **全局统一画像** |
| 输出 | 能力分数 | 活跃度分数 | **风险分数** |
| 扩展方式 | 新增 DeFi 协议模块 | 增强链上行为分析 | **新增风险信号** |

---

## 9. 结论

RiskOracleModule 是 AgentRepScore 从"评分工具"升级为"声誉基础设施"的关键组件。它将目前分散在 Keeper 层的反作弊逻辑：

- **产品化**（作为一个可插拔模块）
- **链上化**（分数和证据哈希写入合约）
- **可配置化**（权重和阈值可治理调整）

建议按 **MVP → 完整版** 两阶段推进，短期先聚合已有信号上线，中长期逐步引入更复杂的链上行为分析。
