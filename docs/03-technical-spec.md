# AgentRepScore — 技术规格 (v2.3)

> 更新说明：v2.3 将剩余工作收敛为 P2 主线：**proof-backed evidence、adaptive weights、cross-module correlation**；P3 愿景保留但暂不纳入当前实现范围。

---

## 1. 技术栈

| 层级 | 技术 | 版本/说明 |
|------|------|-----------|
| 智能合约 | Solidity | ^0.8.20 |
| 合约框架 | Hardhat / Foundry | 双工具并用：Hardhat 主部署，Foundry 主测试 |
| 测试网 | X Layer Sepolia | chainId: 195 |
| 主网 | X Layer | chainId: 196（代码已支持，待主网部署） |
| 链下服务 | TypeScript / Node.js | v20+ |
| 包管理 | pnpm | 推荐 |
| 外部 SDK | viem | ^2.x，链上读写与事件解析 |
| 外部 SDK | ethers.js | ^6.x，Hardhat 部署脚本 |
| 集成 SDK | `@okxweb3/onchainos` | OnchainOS 技能调用（设计中有，代码尚未实际集成） |

---

## 2. 目录结构

```
AgentRepScore/
├── contracts/                        # Solidity 合约
│   ├── interfaces/
│   │   ├── IScoreModule.sol
│   │   ├── IERC8004.sol
│   │   └── IAgentRepValidator.sol
│   ├── modules/
│   │   ├── UniswapScoreModule.sol
│   │   ├── AaveScoreModule.sol
│   │   └── BaseActivityModule.sol
│   ├── AgentRepValidator.sol
│   ├── ScoreConstants.sol
│   └── mocks/                        # 测试用 mock
├── scripts/                          # 部署与治理脚本
│   ├── deploy-validator.ts
│   ├── deploy-modules.ts
│   ├── deploy-mainnet.ts
│   ├── redeploy-validator-testnet.ts
│   └── verify-contracts.ts
├── src/                              # TypeScript Skill 实现
│   ├── skill/
│   │   ├── commands/
│   │   │   ├── register.ts
│   │   │   ├── evaluate.ts
│   │   │   ├── query.ts
│   │   │   ├── compare.ts
│   │   │   └── modules.ts
│   │   ├── abis.ts                   # 共享 ABI 定义（v2.2 新增）
│   │   ├── index.ts
│   │   └── types.ts
│   ├── integrations/
│   │   ├── onchainos.ts
│   │   ├── uniswap-ai.ts
│   │   └── merkle.ts
│   ├── utils/
│   │   ├── score-decay.ts
│   │   └── format.ts
│   └── config.ts
├── test/                             # 测试
│   ├── foundry/
│   │   ├── AgentRepValidator.t.sol
│   │   ├── AgentRepValidator.invariants.t.sol   # 不变量测试（v2.2 新增）
│   │   ├── UniswapScoreModule.t.sol
│   │   ├── AaveScoreModule.t.sol
│   │   └── BaseActivityModule.t.sol
│   ├── hardhat/
│   │   └── integration.test.ts
│   └── skill/                        # TypeScript 单元测试（v2.2 新增）
│       ├── score-decay.test.ts
│       └── compare.test.ts
├── .env.example
├── hardhat.config.ts
├── foundry.toml
├── tsconfig.json
├── package.json
├── SKILL.md
├── DESIGN.md
└── README.md
```
│   │   ├── uniswap-ai.ts
│   │   └── erc8004.ts
│   ├── utils/
│   │   ├── merkle.ts
│   │   ├── score-decay.ts
│   │   └── format.ts
│   └── config.ts
├── test/                             # 测试
│   ├── foundry/
│   │   ├── AgentRepValidator.t.sol
│   │   ├── UniswapScoreModule.t.sol
│   │   ├── AaveScoreModule.t.sol
│   │   └── BaseActivityModule.t.sol
│   └── hardhat/
│       └── integration.test.ts
├── .env.example
├── hardhat.config.ts
├── foundry.toml
├── tsconfig.json
├── package.json
├── SKILL.md
└── README.md
```

---

## 3. 接口定义

### 3.1 IScoreModule

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IScoreModule {
    /// @notice 模块名称，如 "UniswapScoreModule"
    function name() external view returns (string memory);

    /// @notice 模块类别，如 "dex", "lending", "activity"
    function category() external view returns (string memory);

    /// @notice 评估指定钱包地址
    /// @param wallet 被评估的 Agent 钱包地址
    /// @return score 分数，范围 [-10000, 10000]
    /// @return confidence 置信度，范围 [0, 100]，决定该模块权重实际生效比例
    /// @return evidence 链上可验证的证据哈希（通常为 keccak256 聚合值）
    function evaluate(address wallet)
        external
        view
        returns (int256 score, uint256 confidence, bytes32 evidence);

    /// @notice 返回该模块输出的指标名称列表
    function metricNames() external view returns (string[] memory);
}
```

**设计决策：**
- `score` 使用 `int256` 以支持负分（严重违约、清算等）。
- `confidence` 使用 `uint256`（0-100），解决新 Agent 或无历史数据时的公平性问题。
- `evidence` 使用 `bytes32`，平衡链上存储成本与可验证性；完整证据 JSON 存储链下/IPFS。

### 3.2 IAgentRepValidator

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentRepValidator {
    struct ModuleConfig {
        address module;
        uint256 weight;      // basis points, e.g. 3000 = 30%
        bool active;
    }

    event ModuleRegistered(address indexed module, uint256 weight);
    event ModuleUpdated(uint256 indexed index, uint256 newWeight, bool active);
    event AgentEvaluated(uint256 indexed agentId, int256 score, int128 normalizedScore, uint8 valueDecimals, bytes32 evidenceHash);

    function evaluateAgent(uint256 agentId)
        external
        returns (int256 score, bytes32 evidenceHash);

    function getLatestScore(uint256 agentId)
        external
        view
        returns (int256 score, uint256 timestamp, bytes32 evidenceHash);

    function getModuleScores(uint256 agentId)
        external
        view
        returns (
            string[] memory names,
            int256[] memory scores,
            uint256[] memory confidences,
            bytes32[] memory evidences
        );

    function modules(uint256 index) external view returns (ModuleConfig memory);
    function moduleCount() external view returns (uint256);
}
```

---

## 4. 核心合约技术规格

### 4.1 AgentRepValidator（主合约）

#### 存储布局

```solidity
contract AgentRepValidator {
    // ERC-8004 注册表地址（不可变）
    address public immutable identityRegistry;
    address public immutable reputationRegistry;
    address public immutable validationRegistry;

    // Validation Registry 请求去重
    mapping(bytes32 => bool) public validationHandled;

    // 治理地址（已支持 2-step transfer，Production 建议迁移到 Timelock / Multisig）
    address public governance;
    address public pendingGovernance;

    // Evaluator 角色：governance + 授权的 keeper/operator
    mapping(address => bool) public evaluators;

    struct ModuleConfig {
        IScoreModule module;
        uint256 weight;
        bool active;
    }

    ModuleConfig[] public modules;

    struct AgentScore {
        int256 score;
        uint256 timestamp;
        bytes32 evidenceHash;
        uint256 confidence;
    }

    // agentId => 最新评分
    mapping(uint256 => AgentScore) public agentScores;

    // agentId => (moduleIndex => 单模块评分)
    mapping(uint256 => mapping(uint256 => AgentScore)) public moduleScores;

    // 评估冷却期，防止频繁调用消耗 gas
    uint256 public evaluationCooldown = 1 days;
    mapping(uint256 => uint256) public lastEvaluationTime;

    // Reentrancy Guard (简化版，无 OZ 依赖)
    uint256 private _status;

    // 自定义错误
    error CooldownNotElapsed(uint256 remaining);
    error AgentWalletNotSet(uint256 agentId);
    error ModuleIndexOutOfBounds(uint256 index);
    error UnauthorizedGovernance(address caller);
    error UnauthorizedEvaluator(address caller);
    error TotalWeightExceeded(uint256 totalWeight);
    error ValidationRequestNotFound(bytes32 requestHash);
}
```

#### 关键函数

| 函数 | 访问控制 | 说明 |
|------|----------|------|
| `constructor(...)` | — | 设置 registry 地址与 governance |
| `registerModule(module, weight)` | `onlyGovernance` | 注册新模块，权重为 basis points |
| `updateWeight(index, weight)` | `onlyGovernance` | 更新已有模块权重 |
| `setModuleActive(index, active)` | `onlyGovernance` | 启停模块 |
| `evaluateAgent(agentId)` | `onlyEvaluator` | 核心评估函数，结果写入 Reputation Registry |
| `getLatestScore(agentId)` | `view` | 读取最新总分 |
| `getModuleScores(agentId)` | `view` | 读取各模块最近一次评分（含实际 confidence） |
| `setCooldown(seconds)` | `onlyGovernance` | 调整评估冷却期 |
| `setEvaluator(addr, allowed)` | `onlyGovernance` | 授权/撤销 evaluator 角色 |
| `initiateGovernanceTransfer(newGov)` | `onlyGovernance` | 发起两步治理转移 |
| `acceptGovernanceTransfer()` | `pendingGovernance` | 接受治理转移 |
| `handleValidationRequest(requestHash, agentId)` | `onlyEvaluator` | 处理 Validation Registry 请求；若配置了 validationRegistry，会先校验 requestHash 存在性 |

#### P2 扩展目标：Adaptive Weights / Correlation / Commitment

P2 阶段主合约将从“静态权重聚合器”升级为“运行时策略驱动的聚合器”。建议增加如下运行时状态：

```solidity
struct WeightPolicy {
    bool enabled;
    uint16 minWeightBps;
    uint16 decayStepBps;
    uint16 recoveryStepBps;
    uint8 zeroConfidenceThreshold;
}

struct ModuleRuntimeState {
    uint256 zeroConfidenceStreak;
    uint256 effectiveBaseWeight;
    uint256 lastUpdatedAt;
}

struct CorrelationAssessment {
    int256 penalty;
    bytes32 evidenceHash;
    uint8 ruleCount;
}

struct EvidenceCommitment {
    bytes32 root;
    bytes32 leafHash;
    bytes32 summaryHash;
    uint64 epoch;
    uint64 blockNumber;
    uint8 proofType; // 0=summary-only, 1=merkle, 2=receipt/storage proof
}
```

建议新增 / 扩展的接口：

- `setWeightPolicy(...)`：治理配置 adaptive weight 策略
- `getEffectiveWeights()`：读取 nominal weight 与 runtime effective base weight
- `getModuleRuntimeState(moduleIndex)`：读取 zero-confidence streak / recovery 状态
- `getCorrelationAssessment(agentId)`：读取最近一次关联惩罚结果
- `getEvidenceCommitment(module, wallet)`：读取模块最新 commitment 元数据

**聚合规则目标：**

```solidity
uint256 effectiveBaseWeight = resolveAdaptiveWeight(moduleIndex, confidence);
uint256 effectiveWeight = effectiveBaseWeight * confidence / 100;
CorrelationAssessment memory correlation = computeCorrelationPenalty(wallet, moduleOutputs);
finalScore = weightedAverage(moduleOutputs, effectiveWeight) - correlation.penalty;
```

即：
- nominal weight 仍是治理层配置；
- adaptive weight 是运行时修正层；
- correlation penalty 是聚合后的额外风控层；
- verified commitment 是模块数据进入聚合前的 acceptance gate。

#### handleValidationRequest

```solidity
function handleValidationRequest(bytes32 requestHash, uint256 agentId) external onlyEvaluator nonReentrant {
    if (validationHandled[requestHash]) revert ValidationAlreadyHandled(requestHash);
    // 若配置了 validationRegistry，先校验请求存在性
    if (validationRegistry != address(0)) {
        bool exists = IValidationRegistry(validationRegistry).validationRequestExists(requestHash);
        if (!exists) revert ValidationRequestNotFound(requestHash);
    }
    validationHandled[requestHash] = true;
    (int256 score, bytes32 evidenceHash) = _evaluateAgent(agentId);
    emit ValidationResponded(requestHash, agentId, score, evidenceHash);
}
```

#### evaluateAgent 执行流程

```solidity
function evaluateAgent(uint256 agentId) public returns (int256 score, bytes32 evidenceHash) {
    if (block.timestamp < lastEvaluationTime[agentId] + evaluationCooldown) {
        revert CooldownNotElapsed(lastEvaluationTime[agentId] + evaluationCooldown - block.timestamp);
    }

    address wallet = IERC8004Identity(identityRegistry).getAgentWallet(agentId);
    if (wallet == address(0)) revert AgentWalletNotSet(agentId);

    int256 totalScore = 0;
    uint256 totalWeight = 0;
    bytes32[] memory evidenceHashes = new bytes32[](modules.length);

    for (uint256 i = 0; i < modules.length; i++) {
        if (!modules[i].active) continue;

        (int256 modScore, uint256 confidence, bytes32 evidence) = modules[i].module.evaluate(wallet);

        uint256 effectiveWeight = modules[i].weight * confidence / 100;
        if (effectiveWeight > 0) {
            totalScore += modScore * int256(effectiveWeight);
            totalWeight += effectiveWeight;
        }

        moduleScores[agentId][i] = AgentScore({
            score: modScore,
            timestamp: block.timestamp,
            evidenceHash: evidence
        });
        evidenceHashes[i] = evidence;
    }

    if (totalWeight > 0) {
        totalScore = totalScore / int256(totalWeight);
    }

    evidenceHash = keccak256(abi.encodePacked(evidenceHashes));

    agentScores[agentId] = AgentScore({
        score: totalScore,
        timestamp: block.timestamp,
        evidenceHash: evidenceHash
    });
    lastEvaluationTime[agentId] = block.timestamp;

    // 写入 ERC-8004 Reputation Registry
    // 注意：ReputationRegistry 会检查 isAuthorizedOrOwner(msg.sender, agentId)
    // AgentRepValidator 合约本身不是 agent owner，因此可以正常调用
    int128 normalizedScore = int128(totalScore);
    uint8 valueDecimals = 0; // 原始整数分，无小数位
    IERC8004Reputation(reputationRegistry).giveFeedback(
        agentId,
        normalizedScore,
        valueDecimals,
        "agent-rep-score",
        "",
        "",
        "",
        evidenceHash
    );

    emit AgentEvaluated(agentId, totalScore, normalizedScore, valueDecimals, evidenceHash);
}
```

**注意：** 具体 `giveFeedback` 的函数签名需以 ERC-8004 实际 ABI 为准；若参数不匹配，通过链下 Skill 做适配层调用。

---

### 4.2 AaveScoreModule

#### 依赖合约

```solidity
interface IPool {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}
```

#### 评估逻辑

```solidity
function evaluate(address wallet)
    external
    view
    override
    returns (int256 score, uint256 confidence, bytes32 evidence)
{
    (uint256 totalCollateralBase,
     uint256 totalDebtBase,
     uint256 availableBorrowsBase,
     uint256 currentLiquidationThreshold,
     uint256 ltv,
     uint256 healthFactor) = aavePool.getUserAccountData(wallet);

    // 若无抵押品且无债务，说明从未使用 Aave
    if (totalCollateralBase == 0 && totalDebtBase == 0) {
        return (0, 0, bytes32(0));
    }

    // 基础分 5000
    score = 5000;

    // 健康因子加分/减分：基准 1.0 = 10000（Aave 精度为 1e18）
    if (healthFactor >= 2e18) {
        score += 2500;
    } else if (healthFactor >= 15e17) {
        score += 1500;
    } else if (healthFactor >= 1e18) {
        score += 500;
    } else {
        // 低于 1.0，高危
        score -= 3000;
    }

    // 清算历史扣分
    uint256 liquidationCount = getLiquidationCount(wallet);
    score -= int256(liquidationCount * 1500);

    // 利用率加分
    if (totalCollateralBase > 0) {
        uint256 utilization = totalDebtBase * 10000 / totalCollateralBase;
        if (utilization >= 3000 && utilization <= 7000) {
            score += 1000;
        } else if (utilization > 7000) {
            score -= 500;
        }
    }

    // 资产多样性
    uint256 assetCount = getSuppliedAssetCount(wallet);
    if (assetCount >= 3) {
        score += 1000;
    } else if (assetCount >= 2) {
        score += 500;
    }

    // 上限限制
    if (score > 10000) score = 10000;
    if (score < -10000) score = -10000;

    confidence = 100;
    evidence = keccak256(abi.encodePacked(healthFactor, liquidationCount, utilization, assetCount));
}
```

**清算计数实现方案：**
- 由于 Aave 的 `LiquidationCall` 事件是日志，合约无法直接读取历史。
- **当前实现：** keeper 调用 `submitWalletMeta(wallet, liquidationCount, suppliedAssetCount)` 将摘要写入链上，`evaluate` 时直接读取。
- **P2 目标：** Aave 也迁移到统一的 `EvidenceCommitment` 模型：链下索引器输出 `summaryHash + leafHash + root + proof`，模块仅接受已验证 commitment 对应的摘要；如 Aave 暂未进入主路径，也必须保持与 Uniswap / BaseActivity 同构的数据面接口。

---

### 4.3 UniswapScoreModule

#### 设计约束

- Uniswap V3 swap 历史无法通过纯合约调用直接获取。
- **当前实现：** 受信 keeper 提交聚合摘要，`UniswapScoreModule.evaluate(wallet)` 读取链上摘要数据。
- **P2 目标：** 迁移到统一的 commitment-first 数据面：keeper / indexer 先生成摘要，再生成 `summaryHash + leafHash + root + proof bundle`，合约仅在 commitment 被接受后使用该摘要评分。

#### P2 目标接口（Commitment + Proof）

```solidity
struct SwapCommitment {
    bytes32 root;
    bytes32 leafHash;
    bytes32 summaryHash;
    uint64 epoch;
    uint64 blockNumber;
    uint8 proofType;
}

function submitSwapCommitment(
    address wallet,
    SwapSummary calldata summary,
    SwapCommitment calldata commitment,
    bytes calldata proof,
    bytes calldata keeperSignature
) external;

function getLatestSwapCommitment(address wallet)
    external
    view
    returns (SwapCommitment memory);
```

**分阶段实现：**
- Phase A：保持当前摘要评分逻辑，但强制摘要与 `summaryHash / leafHash / root` 对齐。
- Phase B：对 proof bundle 做 onchain acceptance gate，只有验证通过的 commitment 可被 `evaluate()` 使用。
- Phase C：默认走 verified commitment；`submitSwapSummary` 降级为兼容接口。

#### Keeper 接口

```solidity
error UnauthorizedKeeper(address caller);

mapping(address => bool) public keepers;

modifier onlyKeeper() {
    if (!keepers[msg.sender]) revert UnauthorizedKeeper(msg.sender);
    _;
}

function setKeeper(address keeper, bool allowed) external onlyGovernance {
    keepers[keeper] = allowed;
}

struct SwapSummary {
    uint256 swapCount;
    uint256 volumeUSD;      // 1e6 precision
    int256 netPnL;          // 1e6 precision
    uint256 avgSlippageBps;
    uint256 feeToPnlRatioBps;
    bool washTradeFlag;
    uint256 timestamp;
    bytes32 evidenceHash;
}

mapping(address => SwapSummary) public latestSwapSummary;

function submitSwapSummary(address wallet, SwapSummary calldata summary) external onlyKeeper {
    latestSwapSummary[wallet] = summary;
}
```

#### evaluate 逻辑（基于 keeper 摘要）

```solidity
struct SwapSummary {
    uint256 swapCount;
    uint256 volumeUSD;      // 以 1e6 为精度
    int256 netPnL;          // 以 1e6 为精度
    uint256 avgSlippageBps; // 平均滑点，单位为 bps
    uint256 feeToPnlRatioBps;
    bool washTradeFlag;
    uint256 timestamp;
    bytes32 evidenceHash;
}

mapping(address => SwapSummary) public latestSwapSummary;

function evaluate(address wallet)
    external
    view
    override
    returns (int256 score, uint256 confidence, bytes32 evidence)
{
    SwapSummary memory s = latestSwapSummary[wallet];

    if (s.swapCount == 0 || block.timestamp > s.timestamp + 7 days) {
        return (0, 0, bytes32(0));
    }

    score = 5000;

    // 交易量
    if (s.volumeUSD >= 100_000e6) {
        score += 1500;
    } else if (s.volumeUSD >= 10_000e6) {
        score += 800;
    } else if (s.volumeUSD >= 1_000e6) {
        score += 300;
    }

    // 净盈亏
    if (s.netPnL > 0) {
        score += 1500;
    } else if (s.netPnL > -10_000e6) {
        score -= 500;
    } else {
        score -= 2000;
    }

    // 滑点
    if (s.avgSlippageBps <= 10) {
        score += 1000;
    } else if (s.avgSlippageBps <= 50) {
        score += 500;
    } else {
        score -= 500;
    }

    // 刷量惩罚
    if (s.washTradeFlag) {
        score -= 3000;
    }

    if (score > 10000) score = 10000;
    if (score < -10000) score = -10000;

    confidence = 100;
    evidence = s.evidenceHash;
}
```

---

### 4.4 BaseActivityModule

#### Keeper 接口

```solidity
error UnauthorizedKeeper(address caller);

mapping(address => bool) public keepers;

modifier onlyKeeper() {
    if (!keepers[msg.sender]) revert UnauthorizedKeeper(msg.sender);
    _;
}

function setKeeper(address keeper, bool allowed) external onlyGovernance {
    keepers[keeper] = allowed;
}

struct ActivitySummary {
    uint256 txCount;
    uint256 firstTxTimestamp;
    uint256 lastTxTimestamp;
    uint256 uniqueCounterparties;
    uint256 timestamp;
    bytes32 evidenceHash;
}

mapping(address => ActivitySummary) public latestActivitySummary;

function submitActivitySummary(address wallet, ActivitySummary calldata summary) external onlyKeeper {
    latestActivitySummary[wallet] = summary;
}
```

#### 评估逻辑

```solidity
function evaluate(address wallet)
    external
    view
    override
    returns (int256 score, uint256 confidence, bytes32 evidence)
{
    ActivitySummary memory s = latestActivitySummary[wallet];
    uint256 txCount = s.txCount;
    uint256 walletAgeDays = (block.timestamp - s.firstTxTimestamp) / 1 days;
    uint256 uniqueCounterparties = s.uniqueCounterparties;

    if (txCount == 0 || block.timestamp > s.timestamp + 7 days) {
        return (0, 0, bytes32(0));
    }

    score = 4000;

    // 钱包年龄
    if (walletAgeDays >= 365) {
        score += 1500;
    } else if (walletAgeDays >= 90) {
        score += 800;
    } else if (walletAgeDays >= 30) {
        score += 300;
    }

    // 交易数量
    if (txCount >= 1000) {
        score += 1500;
    } else if (txCount >= 100) {
        score += 800;
    } else if (txCount >= 10) {
        score += 300;
    }

    // 独立交互方
    if (uniqueCounterparties >= 50) {
        score += 1500;
    } else if (uniqueCounterparties >= 10) {
        score += 800;
    } else if (uniqueCounterparties >= 3) {
        score += 300;
    } else {
        score -= 1000;
    }

    // 不活跃惩罚
    uint256 daysSinceLastTx = (block.timestamp - s.lastTxTimestamp) / 1 days;
    if (daysSinceLastTx > 30) {
        score -= int256((daysSinceLastTx / 30) * 500);
    }

    if (score > 10000) score = 10000;
    if (score < -10000) score = -10000;

    confidence = 100;
    evidence = s.evidenceHash;
}
```

**链下数据注记：** `txCount`、`firstTxTimestamp`、`lastTxTimestamp`、`counterparties` 由 keeper 通过 OKLink/X Layer explorer API 获取并提交到合约。

---

## 5. TypeScript Skill 技术规格

### 5.1 命令接口

```typescript
// src/skill/types.ts

export interface RegisterInput {
  wallet: `0x${string}`;
  /** @deprecated 当前实现未使用 capabilities */
  capabilities?: string[];
  uri: string;
}

export interface EvaluateInput {
  agentId: string;
}

export interface QueryInput {
  agentId: string;
}

export interface CompareInput {
  agentIds: string[];
}

export interface ModulesOutput {
  modules: {
    name: string;
    category: string;
    address: `0x${string}`;
    weight: number;
    active: boolean;
  }[];
}

export interface ScoreOutput {
  agentId: string;
  wallet: `0x${string}`;
  rawScore: number;
  decayedScore: number;
  trustTier: "untrusted" | "basic" | "verified" | "elite";
  timestamp: number;
  moduleBreakdown: {
    name: string;
    score: number;
    confidence: number;
    weight: number;
  }[];
}
```

### 5.2 evaluate 命令流程

```typescript
// src/skill/commands/evaluate.ts

export async function evaluate(input: EvaluateInput): Promise<ScoreOutput> {
  // 1. 检查 agentId 是否存在
  // 2. 调用 AgentRepValidator.evaluateAgent(agentId) 交易
  // 3. 等待交易确认
  // 4. 读取 agentScores[agentId]
  // 5. 读取 moduleScores[agentId]
  // 6. 计算衰减分数
  // 7. 组装输出
}
```

### 5.3 衰减计算

```typescript
// src/utils/score-decay.ts

export function applyDecay(rawScore: number, evaluationTimestamp: number): number {
  const daysElapsed = (Date.now() / 1000 - evaluationTimestamp) / 86400;
  const decayFactor = Math.max(0.1, 1.0 - 0.02 * daysElapsed);
  return Math.round(rawScore * decayFactor);
}

export function trustTier(score: number): ScoreOutput["trustTier"] {
  if (score <= 2000) return "untrusted";
  if (score <= 5000) return "basic";
  if (score <= 8000) return "verified";
  return "elite";
}
```

---

## 6. 外部依赖规格

### 6.1 ERC-8004 合约 ABI

需引入以下接口的最小 ABI：

```solidity
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
    function register(string calldata agentURI) external returns (uint256 agentId);
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function unsetAgentWallet(uint256 agentId) external;
}

interface IERC8004Reputation {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}
```

> 实际 ABI 以 [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) 仓库为准。

### 6.2 Aave V3 Pool（X Layer）

- **Pool:** `0xE3F3Caefdd7180F884c01E57f65Df979Af84f116`
- **PoolAddressesProvider:** `0xdFf435BCcf782f11187D3a4454d96702eD78e092`
- **PoolDataProvider:** `0x6C505C31714f14e8af2A03633EB2Cdfb4959138F`
- 来源：[aave-dao/aave-address-book/src/AaveV3XLayer.sol](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3XLayer.sol)
- ABI：使用标准 Aave V3 `IPool` 接口。

### 6.3 Uniswap V3（X Layer）

- Factory 地址：通过 Uniswap 官方部署文档或链上 `PoolCreated` 事件确认。
- 本模块仅需要 `Swap` 事件日志，因此核心依赖是链下事件索引器（The Graph / OKLink / Alchemy）。

### 6.4 OnchainOS Skills

```typescript
// src/integrations/onchainos.ts

import { OnchainOSClient } from "@okxweb3/onchainos";

export const onchainOS = new OnchainOSClient({
  apiKey: process.env.OKX_API_KEY!,
  apiSecret: process.env.OKX_API_SECRET!,
  passphrase: process.env.OKX_PASSPHRASE!,
  baseURL: "https://www.okx.com",
});
```

---

## 7. 部署与配置

### 7.1 环境变量

```bash
# .env.example
PRIVATE_KEY=0x...
XLAYER_RPC=https://xlayerrpc.okx.com
XLAYER_TESTNET_RPC=https://testrpc.xlayer.tech

OKX_API_KEY=...
OKX_API_SECRET=...
OKX_PASSPHRASE=...

IDENTITY_REGISTRY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
REPUTATION_REGISTRY=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
VALIDATION_REGISTRY=0x...
AAVE_POOL=0x...
```

### 7.2 部署顺序

1. 部署 `AaveScoreModule`（参数：Aave Pool 地址）
2. 部署 `UniswapScoreModule`（参数：可选的受信 keeper 地址）
3. 部署 `BaseActivityModule`
4. 部署 `AgentRepValidator`（参数：3 个 Registry 地址）
5. 在主合约上调用 `registerModule` 注册 3 个模块，配置权重（4000, 3500, 2500）
6. （可选）设置 keeper 地址，赋予其提交 swap/activity 摘要的权限
7. 验证合约源码（Hardhat verify / OKLink verify）

---

## 8. 测试策略

### 8.1 单元测试（Foundry）

- `AgentRepValidator.t.sol`：模块注册、evaluateAgent 积分聚合、冷却期、权重校验、访问控制、治理转移
- `AaveScoreModule.t.sol`：mock Aave Pool，测试健康因子、利用率、资产数、清算场景
- `UniswapScoreModule.t.sol`：keeper 提交流程、刷量标记、feeToPnlRatio 惩罚、分数边界
- `BaseActivityModule.t.sol`：钱包年龄、交互方数量、不活跃惩罚
- `AgentRepValidator.invariants.t.sol`：不变量测试——总活跃权重永远 ≤ 10000、评估分数永远 ∈ [-10000, 10000]

### 8.2 Fuzz 测试（Foundry）

- `testFuzz_TotalWeightNeverExceeds10000`：任意权重组合注册时总权重不溢出
- `testFuzz_EvaluatedScoreWithinBounds`：任意模块分数组合时最终分数在合法边界内

### 8.3 集成测试（Hardhat + TypeScript）

- 完整流程：注册 ERC-8004 身份 → evaluateAgent → 查询 Reputation Registry 反馈
- Skill 命令端到端：evaluate、query、compare、modules

### 8.4 TypeScript 单元测试（Vitest）

- `test/skill/score-decay.test.ts`：时间衰减计算、信任等级分类
- `test/skill/compare.test.ts`：Promise.allSettled 容错、排序逻辑

### 8.5 测试覆盖率目标

- 合约行覆盖率：≥ 80%
- 关键路径（evaluateAgent、模块注册、分数聚合）：100%
- Foundry fuzz：每个 fuzz 函数 ≥ 256 runs
- Foundry invariant：每个 invariant ≥ 128,000 calls

---

## 9. 安全与 Gas 优化

### 9.1 安全清单（MVP 已实现 vs Production 待补齐）

| 项目 | 状态 | 说明 |
|------|------|------|
| `onlyGovernance` 访问控制 | 🟢 已实现 | 模块注册、权重变更等均已保护 |
| `onlyEvaluator` 访问控制 | 🟢 已实现 | `evaluateAgent` 和 `handleValidationRequest` 限治理或授权 keeper 调用 |
| ReentrancyGuard | 🟢 已实现 | `evaluateAgent` 和 `handleValidationRequest` 已加 `nonReentrant` |
| 评估冷却期 | 🟢 已实现 | 默认 1 天，可治理调整 |
| 权重总和校验 | 🟢 已实现 | `registerModule`、`updateWeight`、`setModuleActive(true)` 均校验 ≤ 10000 |
| 2-step 治理转移 | 🟢 已实现 | `initiateGovernanceTransfer` + `acceptGovernanceTransfer` |
| 紧急 Pause | 🟢 已实现 | `AgentRepValidator` + 3 个模块均已实现 `Pausable`；`evaluateAgent`、keeper 提交、治理函数均已加 `whenNotPaused` |
| Timelock | 🟢 已实现 | `scheduleRegisterModule` / `executeRegisterModule`、`scheduleUpdateWeight` / `executeUpdateWeight` 已实现 24h 延迟；opHash 在 execute 时重新验证参数一致性 |
| Multisig | 🟢 已实现 | 部署脚本支持 `GOVERNANCE_SAFE`，测试中有 `MockMultisig` 覆盖治理场景 |
| 第三方安全审计 | 🔴 未实现 | 正式大规模上线前仍建议完成 |
| keeper 签名（EIP-712） | 🟢 已实现 | Uniswap / BaseActivity / Aave 的 `submit*` 接口均已要求 per-wallet nonce 的 EIP-712 签名 |
| proof-backed evidence acceptance gate | 🔴 未实现 | 属于 P2 主线：verified commitment 成为默认数据入口前必须补齐 |

### 9.2 Gas 优化

- `evaluateAgent()` 预估 gas（3 个模块，其中 1 个涉及外部 view 调用）：约 180k–250k（主要取决于 `giveFeedback` 的 string 参数长度和存储写入量）
- 使用 `immutable` 存储 registry 地址
- `AgentScore` 中 `score` 使用 `int256`，但聚合计算时避免频繁类型转换
- 模块数量预期 < 20，线性遍历是可接受的 O(n)
- `evidenceHash` 使用 `bytes32` 而非 `string`，减少存储开销

---

## 10. 未决问题与风险

| 问题 | 风险 | 应对策略 |
|------|------|----------|
| keeper / indexer 仍有信任假设 | 中 | 通过 P2 的 commitment + proof + acceptance gate 消减该假设 |
| 静态权重对模块健康状态响应不足 | 中 | 通过 P2 adaptive weights 让低 confidence 模块自动降权 |
| 单模块评分难识别组合式操纵 | 中 | 通过 P2 cross-module correlation 在聚合层追加惩罚 |

---

## 11. 评分常量参考

所有评分阈值应集中定义，避免魔法数字散落：

```solidity
library ScoreConstants {
    int256 public constant MAX_SCORE = 10000;
    int256 public constant MIN_SCORE = -10000;
    int256 public constant BASE_AAVE_SCORE = 5000;
    int256 public constant BASE_UNISWAP_SCORE = 5000;
    int256 public constant BASE_ACTIVITY_SCORE = 4000;

    uint256 public constant HEALTH_FACTOR_SAFE = 2e18;
    uint256 public constant HEALTH_FACTOR_GOOD = 15e17;
    uint256 public constant HEALTH_FACTOR_MIN = 1e18;

    uint256 public constant COOLDOWN_DEFAULT = 1 days;
    uint256 public constant DATA_STALE_WINDOW = 7 days;
    uint256 public constant INACTIVITY_PENALTY_WINDOW = 30 days;
}
```

---

## 12. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-11 | 从架构设计拆分出独立技术规格文档 |
| v2.0 | 2026-04-11 | 完善接口定义、合约伪代码、部署顺序、测试策略 |
| v2.1 | 2026-04-11 | 修正 ERC-8004 ABI、增加 keeper 接口与自定义错误、移除风险模块权重缺口 |
| v2.2 | 2026-04-11 | 基于 Hackathon MVP 完成后的差距分析更新：标记 ReentrancyGuard/onlyEvaluator/治理转移/validationRegistry 调用为已实现；标记 Merkle 证明/Pausable/Timelock/Multisig 为未实现；补充 fuzz/invariant/vitest 测试策略 |
| v2.3 | 2026-04-14 | 将剩余实现范围收敛为 P2 主线：新增 adaptive weights / correlation / evidence commitment 目标规格；同步 Multisig、keeper EIP-712 等已实现状态 |
