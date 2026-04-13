# Simulate 沙盒权重分析 —— good vs wash profile 区分度优化

> 分析日期: 2026-04-12  
> 分析工具: `src/skill/commands/simulate.ts`  
> 目标: 在 X Layer 测试网环境下，优化 AgentRepScore 的模块权重分配，最大化 good/wash profile 的区分度。

---

## 测试 Profile

| Profile | UniswapScoreModule | BaseActivityModule | 说明 |
|---------|-------------------|-------------------|------|
| **good** | 9000 | 8500 | 高交易量+正PnL+低滑点；长钱包龄+高交易数+多对手方 |
| **wash** | 1800 | 4600 | 负PnL+高滑点+洗盘标记；低对手方+近期不活跃 |
| **medium-risk** | 8000 | 3000 | 正常交易但 sybil/counterparty 异常 |

---

## 2-Module 权重对比（当前仅部署 Uniswap + BaseActivity）

| Uniswap | BaseActivity | good | wash | delta | medium-risk | 结论 |
|--------:|-------------:|-----:|-----:|------:|------------:|------|
| 4000 | 2500 | **8807** | **2876** | **5931** | 6076 | 当前配置，delta 最大 |
| 5000 | 1500 | 8884 | 2446 | 6438 | 6846 | 区分度更高，但会放大 medium-risk 分数（过于看重 Uniswap） |
| 5000 | 5000 | 8750 | 3200 | 5550 | 6153 | 加入 future module 前的过渡配置 |

### 关键洞察

1. **当前 `4000/2500` 已经是 2-module 场景下的最优解之一**。good/wash delta 达到 5931，wash 分数 2876 刚好落在 `basic` tier，good 8807 落在 `elite` tier。
2. 如果强行把 Uniswap 提高到 5000、Base 降到 1500，虽然 delta 提升到 6438，但 **medium-risk profile 的分数会从 6076 跳到 6846**，意味着反作弊维度（sybil、counterparty 集中度）的权重被过度稀释，可能「放过」有问题的 Agent。
3. Uniswap 分数虽然 hardest-to-fake，但 BaseActivity 中的 **sybilClusterFlag** 和 **counterpartyConcentrationFlag** 是重要的第一道防线，不应过度削弱。

---

## 3-Module 规划（预留 FutureModule / YieldVaultModule）

假设未来加入第三个模块（如 YieldVaultModule），推荐预留权重：

| 模块 | 权重 | 说明 |
|------|------|------|
| UniswapScoreModule | 4000 | 维持交易维度主导地位 |
| BaseActivityModule | 2500 | 保留反作弊影响力 |
| FutureModule | 3500 | 新维度（收益策略 / 跨链桥） |

3-module 场景下：
- good: 8525
- wash: 3620
- delta: 4905

分数会被 10000 完全归一化，区分度依然健康。

---

## 推荐结论

- **短期（2 模块）**: 保持 `Uniswap=4000, BaseActivity=2500`。
- **中期（3 模块）**: 按 `4000 / 2500 / 3500` 分配，无需改动现有权重。
- simulate 沙盒已验证：**无需调整当前权重**，现有配置已经能为 good/wash profile 提供极强的 tier 区分度。
