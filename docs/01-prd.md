# AgentRepScore：基于 ERC-8004 的 X Layer DeFi 声誉评估 Skill

> Build X Hackathon — Skills Arena 赛道
> 作者：Davirain
> 日期：2026 年 4 月
> 版本：v3.0

---

## 1. 项目概述

AgentRepScore 本质上是 **DeFi Agent 的链上 eval 系统**——将 AI 开发中的 eval 范式（Promptfoo、LangSmith）从链下合成测试升级为链上真实数据验证，从开发者自报升级为合约强制执行。

作为一个可复用的 AI Agent Skill，它为 X Layer 上运行的 DeFi Agent 提供**链上声誉评分**。它将 ERC-8004 的信任注册表与来自 OnchainOS、Uniswap、Aave 的实时 DeFi 数据相结合，生成可验证、防篡改的声誉分数。

核心创新点：部署在 X Layer 上的 **Validator 合约**作为唯一可信的评价者。它直接读取链上状态（而非 Agent 自报数据），确定性地计算分数，并将结果写入 ERC-8004 的 Reputation Registry。由于每条反馈记录的 `clientAddress` 都是合约地址，消费方可以过滤出仅由合约验证的评分——从根本上消除自我上报造假。

合约采用**模块化评分架构**——每个 DeFi 协议作为独立的评分模块，通过统一的 `IScoreModule` 接口注册到主合约中。未来新增协议无需重新部署，只需注册新模块。

**目标奖项：**

- Skills Arena 一等奖（2,000 USDT）
- 最佳 Uniswap 集成特别奖（400 USDT）

---

## 2. 问题陈述

随着 AI Agent 成为自主的 DeFi 参与者——在 Uniswap 上交易、在 Aave 上借贷、通过 OnchainOS 管理投资组合——一个关键的信任缺口浮现出来：

**Agent B 在委托资金或协作之前，如何判断 Agent A 是否称职且值得信赖？**

当前方案的失败之处：

1. **自报指标极易造假。** Agent 可以声称“95% 胜率”却无任何证明。
2. **链下声誉系统可被绕过。** 如果评分逻辑运行在脚本中，恶意 Agent 可以直接跳过脚本，向 ERC-8004 提交伪造的高分反馈。
3. **L2 上的女巫攻击成本极低。** X Layer 每笔交易费用约 $0.0005，批量创建虚假评价者身份几乎零成本。
4. **刷量交易虚增指标。** Agent 可以与自己交易，制造出色的交易量和胜率假象。

AgentRepScore 的解决方案是将评分规则**强制写入智能合约**，合约直接读取链上状态。Agent 无法伪造 Uniswap 的 swap 历史记录或 Aave 的健康因子数据——这些都是链上不可篡改的。

---

## 3. 竞品分析

### 3.1 bond.credit

bond.credit 是目前最相近的项目，定位为“Agent 经济的信用层”。在其 Genesis 赛季（2025 年 11 月至 2026 年 2 月）中，他们部署了 5 个自主 yield Agent，每个分配 $2,000 真实资金，在 Ethereum 主网和 Base 上运行 107 天。他们也使用了 ERC-8004，在 Synthesis Hackathon 中将获胜者的信用分数写入了 Arbitrum 上的 ERC-8004 身份。

其 Bond Score 公式为：`0.30×Performance + 0.25×Risk + 0.20×Stability + 0.15×Sentiment + 0.10×Provenance`。

### 3.2 关键差异

| 维度 | bond.credit | AgentRepScore（本项目） |
|------|-------------|------------------------|
| 产品形态 | 中心化平台/产品 | 开源可复用 Skill 模块 |
| 评分执行 | 私有信用引擎（链下） | 链上 Validator 合约（开源透明） |
| 目标网络 | Ethereum / Base / Arbitrum | X Layer |
| 适用范围 | Yield Agent 专用 | 通用 DeFi（交易 + 借贷 + LP） |
| 商业目标 | 信用额度分配、Agent 银行 | Agent 间信任发现与协作 |
| 可集成性 | 需加入其平台 | 任何 Agent 平台可集成 |
| 反作恶方式 | 平台管控（准入制） | 合约强制（无许可但防篡改） |
| 可扩展性 | 平台控制评分维度 | 模块化 IScoreModule，社区可贡献新模块 |

### 3.3 竞争定位

bond.credit 做的是**“评级机构”**——一个中心化实体给 Agent 打分，据此分配信贷。

AgentRepScore 做的是**“评级基础设施”**——一个任何人都能集成的开源工具，评分逻辑透明可审计，在合约层强制执行。

这种定位差异使得两者互补而非竞争：bond.credit 未来可以集成 AgentRepScore 作为其信用引擎的数据源之一。

---

## 4. 目标用户

- 在 X Layer DeFi 上运营的 AI Agent（Uniswap、Aave）
- 需要在委托前评估 Agent 可信度的运营者
- 希望基于 Agent 声誉进行准入控制的 DeFi 协议
- 集成信任评估的 Agent 平台（OpenClaw、Claude Code、自定义平台）

---

## 5. 范围

### 范围内（MVP）

- 模块化评分架构（IScoreModule 接口）
- 3 个核心评分模块：UniswapScoreModule、AaveScoreModule、BaseActivityModule
- 通过 AgentRepValidator 主合约实现链上声誉评分
- ERC-8004 Identity / Reputation / Validation Registry 集成
- 反作恶：刷量检测、循环流转检测、女巫惩罚
- TypeScript Skill 封装：rep:register、rep:evaluate、rep:query、rep:compare、rep:modules
- OnchainOS + Uniswap AI Skill 集成
- 分数时间衰减（链下）

### 范围外（v1）

- 跨链声誉
- 防女巫身份（无许可系统的固有局限）
- 完整历史链上数据访问（依赖链下索引器获取 swap 历史）
- 治理 / DAO 权重调整
- 跨模块关联行为分析

---

## 6. 成功指标

- 成功将 AgentRepValidator + 3 个评分模块部署至 X Layer（测试网或主网）
- 端到端演示：注册 Agent -> 在 Uniswap 上交易 -> 在 Aave 上存款 -> 评估 -> 查询分数 -> 查看模块细分
- 反作恶机制在测试场景中可检测刷量交易
- 演示模块化架构——展示“如果未来添加新协议模块会怎样”
- Skill 可被第三方 Agent 平台独立集成，无需运行自己的后端——直接呼应 Skills Arena 赛道对“可复用”的核心要求
- 2 分钟 Demo 视频在 4 月 15 日 23:59 UTC 前提交

---

## 7. 核心技术摘要：模块化评分接口

模块化架构的核心是 `IScoreModule` 接口，每个 DeFi 协议实现该接口即可作为独立评分模块插入主合约：

```solidity
interface IScoreModule {
    /// 模块名称，如 "uniswap-swap", "aave-lending"
    function name() external view returns (string memory);

    /// 评估某个钱包在该协议上的表现
    /// 返回：分数 (0-10000)、置信度 (0-100)、链上证据哈希
    function evaluate(address wallet)
        external view
        returns (int256 score, uint256 confidence, bytes32 evidence);

    /// 该模块采集的指标列表（用于链下展示）
    function metricNames() external view returns (string[] memory);
}
```

MVP 包含 3 个模块：`UniswapScoreModule`（交易评估）、`AaveScoreModule`（借贷评估）、`BaseActivityModule`（链上活动）。未来新增协议只需实现该接口并注册，无需重新部署主合约。

---

## 8. 交付物

| 交付物 | 格式 | 用途 |
|--------|------|------|
| `IScoreModule.sol` | Solidity 接口 | 模块化评分标准接口 |
| `AgentRepValidator.sol` | Solidity 合约 | 主合约：模块管理 + ERC-8004 写入 |
| `UniswapScoreModule.sol` | Solidity 合约 | Uniswap 交易评估模块 |
| `AaveScoreModule.sol` | Solidity 合约 | Aave 借贷评估模块 |
| `BaseActivityModule.sol` | Solidity 合约 | 通用链上活动评估模块 |
| `SKILL.md` | Skill 定义文件 | AI Agent 接口规范 |
| `src/` | TypeScript | 链下 Skill 逻辑、OnchainOS + Uniswap 集成 |
| `README.md` | 文档 | 配置指南、使用示例 |
| `DESIGN.md` | 设计文档 | 架构设计与决策依据 |
| Demo 视频 | 2 分钟 MP4 | 端到端演示 |
| Moltbook 提交 | 链接 | 公开项目页面 |

---

## 9. 开发路线图（4 天 Hackathon）

### 第 1 天（4 月 12 日）：搭建基础

- [ ] 初始化项目仓库，建立模块化目录结构
- [ ] 编写 SKILL.md 及触发条件定义
- [ ] 编写 `IScoreModule` 接口和 `AgentRepValidator` 主合约骨架
- [ ] 实现 `AaveScoreModule`（最简单的链上集成）
- [ ] 部署至 X Layer 测试网
- [ ] 配置 OnchainOS CLI 和 API 凭证

### 第 2 天（4 月 13 日）：核心集成

- [ ] 实现 `UniswapScoreModule`（链下索引器 + Merkle 证明）
- [ ] 实现 `BaseActivityModule`
- [ ] 在主合约中完成模块注册和加权聚合逻辑
- [ ] 构建 TypeScript Skill 封装：`rep:register`、`rep:evaluate`、`rep:query`
- [ ] 对接 OnchainOS skills 获取钱包/行情数据

### 第 3 天（4 月 14 日）：反作恶 + 打磨

- [ ] 在 UniswapScoreModule 中实现刷量交易检测启发式
- [ ] 添加 Uniswap AI Skill 集成用于 swap 分析
- [ ] 实现 `rep:compare` 和 `rep:modules` 命令
- [ ] 编写完善的 README 和使用示例
- [ ] 在 X Layer 测试网上进行端到端测试

### 第 4 天（4 月 15 日）：发布

- [ ] 将合约部署至 X Layer 主网（如准备就绪）或打磨测试网演示
- [ ] 录制 2 分钟 Demo 视频
- [ ] 在 23:59 UTC 前通过 Google Form 提交
- [ ] 在 X（Twitter）和 Moltbook 上发布

---

## 10. 为什么这个项目能赢

1. **真正的 Skill，而非应用。** 可复用模块，任何 Agent 平台可集成。
2. **深度 Uniswap 集成。** 使用 swap-integration 和 liquidity-planner skill 分析交易模式。
3. **前沿标准。** ERC-8004 于 2026 年 1 月上线主网。
4. **Aave 时效性。** Aave 仅在 12 天前登陆 X Layer。
5. **解决真实问题。** 声誉是 Agent 经济的关键基础设施。
6. **反作恶是一等特性。** 合约即评价者模式和刷量检测。
7. **模块化可扩展。** `IScoreModule` 接口支持未来新增 DeFi 协议。
8. **差异化竞争优势。** 对比 bond.credit，我们是开源、链上强制、去中心化的信用评估基础设施。
9. **链上 eval 范式创新。** 将 AI 开发中的 eval 概念（Promptfoo、LangSmith）应用于 DeFi Agent 场景，从链下合成测试升级为链上真实数据验证——这是 bond.credit 没有的独特叙事角度。

---

## 附录 A：ERC-8004 合约地址

### 以太坊主网

- Identity Registry：`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry：`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

### Base

- Identity Registry：`0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Reputation Registry：`0x8004B663056A597Dffe9eCcC1965A193B7388713`

### X Layer (chainId: 196)

- Identity Registry：`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` [查看](https://www.oklink.com/x-layer/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)
- Reputation Registry：`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` [查看](https://www.oklink.com/x-layer/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63)
- Agents：120 | Feedbacks：51

> 注：ERC-8004 使用 CREATE2 确定性部署，所有 EVM 链上的合约地址相同。目前已部署在 25+ 条链上，全网络总计超过 113,000 个 Agent 和 160,000+ 条 Feedback。

## 附录 B：参考链接

- [ERC-8004 规范](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 合约（GitHub）](https://github.com/erc-8004/erc-8004-contracts)
- [OnchainOS 开发者文档](https://web3.okx.com/onchainos/dev-docs/home/what-is-onchainos)
- [OnchainOS Skills（GitHub）](https://github.com/okx/onchainos-skills)
- [Uniswap AI Skills（GitHub）](https://github.com/Uniswap/uniswap-ai)
- [Aave 上线 X Layer 公告](https://web3.okx.com/learn/aave-xla)
- [X Layer 开发者文档](https://web3.okx.com/xlayer/docs/developer/build-on-xlayer/about-xlayer)
- [Build X Hackathon](https://web3.okx.com/xlayer/build-x-hackathon)
- [Hackathon 提交表单](https://docs.google.com/forms/d/e/1FAIpQLSfEjzs4ny2yH04tfDXs14Byye1KYhXv6NeytpqSKhrqTtgKqg/viewform)
- [8004scan（ERC-8004 浏览器）](https://8004scan.io)
- [8004scan X Layer](https://8004scan.io/agents?chain=196)
- [bond.credit（竞品参考）](https://www.bond.credit)
