# AgentRepScore Demo 演讲脚本（中文）

> 总时长：约 5 分钟  
> 适用场景：Scale Demo / 项目路演 / 投资人演示

---

## 1. 开场钩子（30 秒）

**【画面】** 黑屏切入项目 Logo，然后直接切到 CLI 输出：一个钱包评分 `6692 verified`，另一个评分 `0 untrusted`。

**【台词】**
> 大家好，我是 AgentRepScore 的开发者。今天我要展示的是：在 AI Agent 泛滥的时代，如何**用智能合约 itself 来验证 Agent 的链上声誉**，而不是相信任何人说的"我的数据是真的"。
> 
> 这是同一个钱包的两个画像：good profile 拿到 verified，wash profile 直接跌到 untrusted。区别不是我说了算，是**链上合约直接读取 Uniswap 和链上活动的真实数据算出来的**。

---

## 2. 问题与方案（45 秒）

**【画面】** 简单的架构图或 PPT：左侧"传统链下 eval"打叉，右侧"AgentRepScore 链上验证"打勾。

**【台词】**
> 现在的 AI Agent 评测大多是链下合成数据，开发者可以随便伪造交易记录、刷单、做假 PnL。
> 
> 我们的方案是：**把 eval 放到链上**。AgentRepValidator 合约直接读取 Uniswap 和链上活动数据，计算分数后写入 ERC-8004 Reputation Registry。
> 
> 消费方只看一件事：`clientAddress == 合约地址`。只有合约自己算出来的分数才被信任。这就是从根本上消除伪造。

---

## 3. 架构简介（60 秒）

**【画面】** 展示架构图（可用文字版）：
- Wallet → Uniswap / BaseActivity
- ↓
- AgentRepValidator (链上计算)
- ↓
- ERC-8004 ReputationRegistry
- ↓
- CLI Skill / 任意消费方

**【台词】**
> 我们的架构分成三层：
> 
> **第一层是数据源模块**：每个 DeFi 协议都是一个独立的 `IScoreModule`。目前有 Uniswap 交易模块和链上基础活动模块。新增协议（如 Aave）只需要部署一个新模块，主合约不用改。
> 
> **第二层是验证层**：`AgentRepValidator` 合约读取所有模块的汇总数据，做三件事：wash trade 循环检测、counterparty 集中度惩罚、sybil 资金源集群检测。任何作弊行为都会直接扣分。
> 
> **第三层是消费层**：我们提供 CLI Skill，Code Agent 可以直接通过 shell 执行。任何人都可以 `query` 一个钱包的评分，`evaluate` 重新计算，`compare` 对比多个 Agent。

---

## 4. 实机演示（2 分 30 秒）

### 4.1 演示环境准备（15 秒）

**【画面】** 终端窗口。执行 `.env` 配置或展示已配置好的环境。

**【台词】**
> 我们现在在 X Layer Sepolia 测试网运行。所有合约已经部署，API 可以直接调用。我先展示一个正常的高分钱包。

### 4.2 Evaluate — Good Wallet（45 秒）

**【画面】** 终端执行：
```bash
rep query 8
```

**【台词】**
> 这是 Agent 8，good profile。运行 query，读取链上当前分数。
> 
> 【等待输出】我们看到：原始分 6692，trust tier 是 verified。module breakdown 显示 Uniswap 评分 7500、BaseActivity 评分 5400，置信度都是 100%。
> 
> 这说明这个钱包的链上行为是健康的：交易量高、PnL 为正、对手方分散。

### 4.3 Evaluate — Wash Wallet（45 秒）

**【画面】** 终端执行同样的命令，换 agent-id 10（wash profile）。

**【台词】**
> 现在看同一个钱包的 wash profile，Agent 10。
> 
> 【等待输出】分数直接跌到 0，trust tier 是 untrusted。为什么？module breakdown 显示：Uniswap 和 BaseActivity 的评分都是 0，置信度也是 0%——系统检测到了 wash trade 模式和 sybil 集群标记，直接拒绝给分。

### 4.4 Compare — 横向对比（45 秒）

**【画面】** 终端执行：
```bash
rep compare 8 10
```

**【台词】**
> 最后我用 compare 把两个 Agent 放在一起对比。输出很直观：verified vs untrusted，score 6692 vs 0。
> 
> 消费方决策成本极低：直接看 trust tier 就够了。

---

## 5. 结果解读（45 秒）

**【画面】** 回到 PPT，展示一个对比表格：
| 指标 | Good | Wash |
|------|------|------|
| Raw Score | 6692 | 0 |
| Decayed Score | 6692 | 0 |
| Trust Tier | verified | untrusted |
| Correlation Penalty | 0 | 0 |
| Evidence Mode | legacy-summary | legacy-summary |

**【台词】**
> 这个对比说明了什么？
> 
> 第一，**链上数据无法伪造**。wash profile 的所有负向指标都是合约从链上直接读出来的。
> 
> 第二，**反作弊是实时的**。correlation 和 sybil 检测不需要人工审核，合约在计算时直接扣分。
> 
> 第三，**模块化可扩展**。未来增加 Aave 等新协议，只需部署新模块，主合约不用改。

---

## 6. 主网路线图 & 收尾（30 秒）

**【画面】** 简单的 Roadmap 图：
- ✅ Testnet Demo（已完成）
- 🔄 Security Audit（计划中）
- 🔄 Mainnet Deployment（计划中）
- 🔄 Keeper Network Decentralization（长期）

**【台词】**
> 目前我们在 X Layer Sepolia 完成了完整测试网部署，所有功能都已经跑通。
> 
> 主网路径非常清晰：安全审计 → 参数复核 → 主网合约部署 → keeper 去中心化网络。技术上没有未知风险，只是需要时间和资金。
> 
> 谢谢大家。如果你也想让 AI Agent 的声誉真正上链，欢迎联系我们。

---

## 附录：录屏建议

1. **终端字体调大**（建议 18pt+），确保观众能看清 JSON 输出。
2. **高亮关键字段**：可以用 `jq` 过滤输出，比如 `jq '.trustTier, .verifiedEvidence, .decayedScore'`。
3. **演示前跑一次暖身**，避免 live demo 时网络延迟。
4. **背景音乐**：建议轻电子/科技感，音量低于人声。
