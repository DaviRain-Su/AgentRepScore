# AgentRepScore — 架构设计 (v2.1)

---

## 1. 系统概览

AgentRepScore 本质上是 **DeFi Agent 的链上 eval 系统**。传统 AI eval（如 Promptfoo、LangSmith）使用合成测试用例在链下评估 agent 能力；AgentRepScore 则使用真实链上交易数据，通过智能合约强制执行评估，并将结果写入 ERC-8004，成为不可篡改的公共信用记录。

系统分为两层：

```
┌──────────────────────────────────────────────────┐
│                    链下层                         │
│                                                  │
│   SKILL.md             CLI / TypeScript           │
│   （AI Agent            （触发合约调用、             │
│    交互接口）             查询结果、                 │
│                         为用户呈现数据）            │
│                                                  │
│   OnchainOS Skills      Uniswap AI Skills         │
│   （钱包、行情、           （swap 集成、              │
│    DEX 数据）              流动性规划）               │
└───────────────────────────┬──────────────────────┘
                            │ 调用
┌───────────────────────────▼──────────────────────┐
│                 链上层 (X Layer)                   │
│                                                  │
│   AgentRepValidator（主合约）                      │
│   ├── 模块注册表：IScoreModule[]                   │
│   │   ├── UniswapScoreModule                     │
│   │   ├── AaveScoreModule                        │
│   │   └── ... (可扩展)                            │
│   ├── 计算：加权聚合各模块分数                      │
│   └── 写入：ERC-8004 Reputation Registry          │
│                                                  │
│   ERC-8004 注册表（已有合约）                       │
│   ├── Identity Registry（Agent 身份 NFT）          │
│   ├── Reputation Registry（反馈存储）              │
│   └── Validation Registry（验证证明记录）          │
└──────────────────────────────────────────────────┘
```

---

## 2. 为什么需要合约，而不仅仅是脚本

Reputation Registry 的 `giveFeedback()` 是无许可的——任何人都可以调用。如果我们仅使用脚本，恶意 Agent 可以绕过脚本直接调用 `giveFeedback()`，提交伪造的高分。

**合约本身就是评价者。** 当我们的 `AgentRepValidator` 合约调用 `giveFeedback()` 时，链上记录的 `clientAddress` 就是合约地址。消费方据此过滤：「只信任 `clientAddress == 0xAgentRepValidator` 的反馈」。

| 方案 | Agent 能否伪造分数 | 原因 |
|------|-------------------|------|
| 纯链下脚本 | 能 | 直接调用 `giveFeedback()` 即可绕过脚本 |
| 链上合约 | 不能 | 合约直接读取链上状态；Agent 无法修改 Uniswap/Aave 历史记录 |

---

## 3. 模块化评分架构

### 3.1 IScoreModule 接口

合约的核心可扩展性来自一个统一的模块接口。每个 DeFi 协议实现这个接口，作为独立的评分模块部署：

```solidity
interface IScoreModule {
    function name() external view returns (string memory);
    function category() external view returns (string memory);
    function evaluate(address wallet)
        external view
        returns (int256 score, uint256 confidence, bytes32 evidence);
    function metricNames() external view returns (string[] memory);
}
```

### 3.2 主合约的模块管理

```solidity
contract AgentRepValidator {
    struct ModuleConfig {
        IScoreModule module;
        uint256 weight;         // basis points, 总和 = 10000
        bool active;
    }

    ModuleConfig[] public modules;

    function registerModule(IScoreModule module, uint256 weight) external onlyGovernance;
    function updateWeight(uint256 moduleIndex, uint256 newWeight) external onlyGovernance;
    function setModuleActive(uint256 moduleIndex, bool active) external onlyGovernance;

    function evaluateAgent(uint256 agentId) external {
        address wallet = identityRegistry.getAgentWallet(agentId);
        int256 totalScore = 0;
        uint256 totalWeight = 0;

        for (uint i = 0; i < modules.length; i++) {
            if (!modules[i].active) continue;
            (int256 score, uint256 confidence, bytes32 evidence)
                = modules[i].module.evaluate(wallet);
            uint256 effectiveWeight = modules[i].weight * confidence / 100;
            totalScore += score * int256(effectiveWeight);
            totalWeight += effectiveWeight;
        }

        if (totalWeight > 0) {
            totalScore = totalScore / int256(totalWeight);
        }

        reputationRegistry.giveFeedback(agentId, totalScore, ...);
        agentScores[agentId] = AgentScore({
            score: totalScore,
            timestamp: block.timestamp,
            ...
        });
    }
}
```

### 3.3 置信度加权的意义

`confidence` 参数解决了一个关键问题：当新模块刚注册时，很多 Agent 在该协议上可能还没有足够的活动数据。如果一个 Agent 从未在 Aave 上借贷过，Aave 模块应该返回 `confidence = 0`，使该维度对总分无影响。

这确保了评分的公平性：Agent 只在有真实链上行为记录的维度上被评分。

---

## 4. Agent 身份注册

Agent 在被评分之前，必须先在 X Layer 上拥有 ERC-8004 身份。

**流程：**

1. Agent（或其运营者）调用 `Identity Registry.register()` 铸造 ERC-721 身份 NFT。
2. Agent 设置 `agentURI`，指向一个注册文件（托管在 IPFS 或 HTTPS 上）。
3. Agent 可选地通过 `setAgentWallet()` 配合 EIP-712 签名证明设置 `agentWallet`。

---

## 5. MVP 评分模块

### 5.1 UniswapScoreModule

| 指标 | 数据源 | 用途 |
|------|--------|------|
| Swap 次数 | Uniswap Router 事件 | 活跃度 |
| 总交易量（USD） | Swap 事件 + 池子价格 | 运营规模 |
| 净盈亏 | 各 swap 的代币余额变化 | 交易能力 |
| 平均滑点 | 预期 vs 实际执行价格 | 执行质量 |
| 手续费占盈亏比 | 已付手续费 vs 利润 | 刷量检测 |

### 5.2 AaveScoreModule

| 指标 | 数据源 | 用途 |
|------|--------|------|
| 健康因子 | `getUserAccountData()` | 风险管理 |
| 清算历史 | Liquidation 事件 | 失败追踪 |
| 利用率 | 借款 / 抵押品 | 资金效率 |
| 持仓时长 | 区块时间戳 | 持仓稳定性 |
| 资产多样性 | 供应/借贷资产类型 | 策略成熟度 |

### 5.3 BaseActivityModule

| 指标 | 数据源 | 用途 |
|------|--------|------|
| 钱包年龄 | 首笔交易区块 | 账户成熟度 |
| 交易总数 | 地址发出的总交易数 | 整体活跃度 |
| 独立交互方数量 | 不重复的交互地址 | 网络广度 |
| Gas 效率 | Gas used vs Gas limit | 技术能力 |

---

## 6. 评分算法

每个模块独立计算 [0, 10000] 范围的分数，主合约按权重聚合。

**MVP 默认权重配置：**

| 模块 | 权重 | 说明 |
|------|------|------|
| UniswapScoreModule | 4000 (40%) | Swap 盈亏、滑点控制、交易量、刷量风险 |
| AaveScoreModule | 3500 (35%) | 健康因子维护、资金利用率、清算风险 |
| BaseActivityModule | 2500 (25%) | 持续性、持仓时长、交互方多样性、账户成熟度 |

**各模块内的扣分项：**

| 扣分项 | 所属模块 | 触发条件 | 扣分 |
|--------|----------|----------|------|
| 清算 | AaveScoreModule | 任何 Aave 清算事件 | 每次 -1500 |
| 刷量标记 | UniswapScoreModule | 手续费占盈亏比 > 0.8 | 相关交易评分为 0 |
| 不活跃 | BaseActivityModule | 超过 30 天无活动 | 每 30 天窗口 -500 |
| 交互方过少 | BaseActivityModule | 独立交互方 < 3 个 | -1000 |

---

## 7. 反作恶机制

### 7.1 第一层：链上数据验证（合约强制执行）

合约直接从 Uniswap 和 Aave 合约读取状态。它**绝不接受外部参数**作为评分输入。

### 7.2 第二层：刷量交易检测

- **启发式 1：手续费占盈亏比。** 费用超过总交易量变化的 80% 时，交易评分权重置零。
- **启发式 2：循环流转检测。** A→B→A 代币循环（< 10 个区块内）被惩罚。
- **启发式 3：交互方集中度。** >70% 活动涉及相同 2 个地址时触发女巫惩罚。

### 7.3 第三层：经济权重

评分是**质押加权**的：真实资金风险敞口越高，分数的置信度乘数越大。

### 7.4 第四层：时间衰减（链下，在 Skill 中执行）

```
有效分数 = 原始分数 × 衰减因子(距反馈天数)
衰减因子(d) = max(0.1, 1.0 - 0.02 × d)  // 每天衰减 2%，最低保留 10%
```

### 7.5 Validation Registry 集成

1. Agent 在 Validation Registry 上调用 `validationRequest()`，指定我们的合约作为验证者。
2. 我们的合约运行完整评估。
3. 合约调用 `validationResponse()` 记录结果 + IPFS 证据。

---

## 8. Skill 接口设计

### 8.1 SKILL.md 定义

```yaml
name: agent-rep-score
description: >
  基于 ERC-8004 在 X Layer 上评估和查询 AI Agent 声誉。
  模块化架构支持扩展更多 DeFi 协议。
triggers:
  - "agent reputation"
  - "trust score"
  - "evaluate agent"
  - "Agent 声誉"
  - "信任评分"
  - "评估 Agent"
tools_required:
  - OnchainOS (okx-wallet-portfolio, okx-dex-market, okx-onchain-gateway)
  - Uniswap AI (swap-integration)
chain: X Layer (chainId: 196)
```

### 8.2 Skill 命令

| 命令 | 输入 | 输出 | 动作 |
|------|------|------|------|
| `rep:register` | 钱包地址、能力列表、URI | Agent ID、交易哈希 | 铸造 Agent NFT |
| `rep:evaluate` | Agent ID | 分数、各模块分解、证据哈希 | 调用 evaluateAgent() |
| `rep:query` | Agent ID | 分数、历史、信任等级、衰减分数、模块细分 | 读取 Registry + 衰减 |
| `rep:compare` | Agent ID 列表 | 排名表、各模块分数 | 批量查询 + 排名 |
| `rep:modules` | 无 | 已注册模块列表 | 读取合约模块注册表 |

### 8.3 信任等级

| 等级 | 分数范围 | 含义 |
|------|---------|------|
| 不可信 | 0 - 2000 | 新注册或表现不佳的 Agent |
| 基础 | 2001 - 5000 | 有一定记录，可靠性中等 |
| 已验证 | 5001 - 8000 | 持续良好的表现 |
| 精英 | 8001 - 10000 | 出色的历史记录，高资金风险敞口 |

---

## 9. 智能合约规格

### 9.1 合约架构

```
AgentRepValidator (主合约)
├── IScoreModule[] modules
├── evaluateAgent(agentId)
├── getLatestScore(agentId)
├── getModuleScores(agentId)
├── registerModule(module, weight)
└── handleValidationRequest(...)

UniswapScoreModule (implements IScoreModule)
├── evaluate(wallet)
├── _getSwapHistory(wallet)
├── _calculatePnL(swaps)
├── _detectWashTrading(swaps)
└── _computeSlippage(swaps)

AaveScoreModule (implements IScoreModule)
├── evaluate(wallet)
├── _getHealthFactor(wallet)
├── _checkLiquidationHistory(wallet)
├── _assessRiskExposure(wallet)
└── _detectSelfLending(wallet)

BaseActivityModule (implements IScoreModule)
├── evaluate(wallet)
├── _getWalletAge(wallet)
├── _countUniqueCounterparties(wallet)
└── _assessActivityConsistency(wallet)
```

### 9.2 部署信息

```
部署网络：X Layer 主网（chainId: 196）
Solidity 版本：^0.8.20
依赖：
  - ERC-8004 Identity Registry：0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
  - ERC-8004 Reputation Registry：0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
  - ERC-8004 Validation Registry（已部署）
  - Uniswap V3 Router / Factory（X Layer 上）
  - Aave V3 Pool（X Layer 上）
```

### 9.3 核心接口

```solidity
interface IAgentRepValidator {
    function evaluateAgent(uint256 agentId)
        external returns (int256 score, bytes32 evidenceHash);
    function getLatestScore(uint256 agentId)
        external view returns (int256 score, uint256 timestamp);
    function getModuleScores(uint256 agentId)
        external view returns (string[] memory names, int256[] memory scores, uint256[] memory confidences);
    function checkWashTrading(address wallet)
        external view returns (bool flagged, uint256 confidence);
    function handleValidationRequest(bytes32 requestHash, uint256 agentId)
        external;
}
```

### 9.4 实现细节

**读取 Uniswap swap 历史：** 当前实现为链下索引器 / keeper 聚合摘要后提交到链上；P2 将把该路径升级为 `summary + commitment + proof` 的 verified evidence 模式。

**读取 Aave 状态：** `aavePool.getUserAccountData()` 直接链上调用。

### 9.5 合约存储

```solidity
struct AgentScore {
    int256 score;
    uint256 timestamp;
    bytes32 evidenceHash;
    uint256 swapCount;
    uint256 volumeUSD;
    uint256 healthFactor;
    bool washTradeFlag;
}

struct ModuleScore {
    int256 score;
    uint256 confidence;
    bytes32 evidence;
    uint256 timestamp;
}

mapping(uint256 => AgentScore) public agentScores;
mapping(uint256 => mapping(uint256 => ModuleScore)) public moduleScores;
mapping(uint256 => uint256) public evaluationCount;
```

---

## 10. 集成关系图

### 10.1 OnchainOS 集成

| OnchainOS Skill | 用途 |
|-----------------|------|
| `okx-wallet-portfolio` | 读取 Agent 钱包余额、交易历史 |
| `okx-dex-market` | 获取代币价格，用于 USD 计价评分 |
| `okx-dex-token` | 代币元数据、风险扫描 |
| `okx-onchain-gateway` | 向 X Layer 广播评估交易 |
| `okx-dex-swap` | 参考 swap 路由数据 |
| `okx-defi-invest` | 通过 OnchainOS DeFi 层查询 Aave 仓位 |

### 10.2 Uniswap AI 集成

| Uniswap Skill | 用途 |
|---------------|------|
| `swap-integration` | 分析 Agent 的 swap 模式、执行质量 |
| `liquidity-planner` | 评估 LP 仓位 |
| `viem-integration` | 链上合约调用以获取池子状态 |

### 10.3 Aave 集成（X Layer 原生）

Aave V3.6 于 2026 年 3 月 30 日在 X Layer 上线。

- 供应：USDT0、USDG、GHO、xBTC、xETH、xSOL、xBETH、xOKSOL
- 借款：USDT0、USDG、GHO、xBTC、xETH、xSOL
- 6 个效率模式（eMode），流动质押对最高 88% LTV

---

## 11. 扩展路线图

### Phase 1：MVP（Hackathon，2026 年 4 月）

部署 3 个核心模块，实现端到端流程。

### Phase 2：Production Hardening（当前主线）

| 工作包 | 目标 | 产出 |
|--------|------|------|
| Proof-backed Evidence | 将 keeper 摘要升级为 `summary + commitment + proof` | 统一 `EvidenceCommitment` 模型、压缩存储、verified evidence acceptance gate |
| Adaptive Weights | 根据模块 runtime 健康度自动调整权重 | `WeightPolicy`、effective weight、zero-confidence decay、recovery |
| Cross-Module Correlation | 在聚合层识别组合式可疑行为 | Uniswap + BaseActivity 关联惩罚、可治理阈值、可观测输出 |

### Phase 3：生态扩展与高级信号（当前冻结）

| 方向 | 说明 |
|------|------|
| 新协议模块 | 跨链桥、收益策略、稳定币风险管理等新增模块 |
| 跨链声誉聚合 | 聚合同一 Agent 在多链上的 ERC-8004 分数 |
| A2A 社会信任 | Agent-to-Agent 反馈构建递归信任网络 |
| MEV / zkML / 保险 | 更高级别的行为证明与风险覆盖能力 |

---

## 12. 安全考量

### 12.1 威胁模型

| 威胁 | 严重度 | 缓解措施 |
|------|--------|----------|
| 女巫刷评 | 高 | 合约即评价者模式；消费方按 clientAddress 过滤 |
| 刷量交易 | 高 | 手续费占盈亏比检查、循环流转检测 |
| Aave 自借自还 | 中 | 零风险仓位检测 |
| 选择性上报 | 高 | 合约扫描完整历史 |
| 合约被操控 | 低 | 对 Uniswap/Aave 仅有只读访问 |
| 恶意模块注册 | 中 | 模块注册需治理审批；代码开源可审计 |
| 数据过期 | 中 | 分数时间衰减；激励重新评估 |
| 预言机操纵 | 中 | 使用链上池子状态，不依赖外部预言机 |

### 12.2 诚实说明局限性

- **历史数据深度：** 当前实现依赖 keeper 摘要；P2 将升级到 `summary + commitment + proof` 的 verified evidence 模式。
- **跨链声誉：** 本版本仅 X Layer（Phase 3 冻结项）。
- **防女巫身份：** 能检测集群，不能阻止新身份创建。
- **模块独立性：** 当前已具备单模块反作弊，但跨模块关联惩罚仍待 P2 落地。
