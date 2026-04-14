# AgentRepScore

> **DeFi Agent 的链上 eval 系统 —— 基于 ERC-8004 的 X Layer 声誉评分 Skill**

AgentRepScore 是 X Layer 上首个基于 **ERC-8004** 的链上 DeFi Agent 声誉评估基础设施。它将 AI 开发的 eval 范式从链下合成测试，升级为用**智能合约强制执行的链上真实数据验证**。

**核心创新：** `AgentRepValidator` 合约直接读取 Uniswap / 链上活动数据，计算分数后写入 ERC-8004 Reputation Registry。消费方只信任 `clientAddress == 合约地址` 的反馈，从根本上消除伪造。

**多维度反作弊：** Wash trade 循环流转检测 · Counterparty 集中度惩罚 · Sybil 资金源集群检测。

**模块化架构：** 每个 DeFi 协议是一个 `IScoreModule`，未来新增协议无需重新部署主合约。

---

## 为什么选 X Layer？

- **Uniswap** 于 2026 年 1 月正式上线 X Layer
- **Aave V3** 于 2026 年 3 月登陆 X Layer
- 我们是首批将 **Agent 声誉基础设施** 带到 X Layer 生态的项目

---

## 测试网 Demo 结果

| Agent | Profile | Raw Score | Trust Tier |
|-------|---------|-----------|------------|
| 8 | good | **8807** | elite |
| 10 | wash | **2876** | basic |

同一钱包，good profile 凭借高交易量+正PnL+多对手方获得 **elite**；wash profile 因负PnL+高滑点+洗盘标记跌至 **basic**。

---

## X Layer Sepolia 测试网部署

### V2 (UUPS Proxy) — 推荐

| 合约 | 地址 |
|------|------|
| IdentityRegistry (ERC-8004) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry (ERC-8004) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| AgentRepValidatorV2 (Proxy) | `0x8B66EaD3b6A444528b62bC9B0d79a7314269dbfB` |
| AgentRepValidatorV2 (Impl) | `0x05728030B3e63aaA0964e63c041C0c99cD9AC453` |
| UniswapScoreModule | `0xf99FFbfab2cb4B8a02464D92DAC67f9F91e76f8A` |
| BaseActivityModule | `0xf0BF570B4B68Ee7844895BdAC0C7f0615faC2996` |

### V1 (Legacy — 已弃用)

| 合约 | 地址 |
|------|------|
| AgentRepValidator | `0x8A924C10fD2f789c323BbB06bf747caEfE9F6efb` |
| UniswapScoreModule | `0xe982007093F0A7f50a9dA0e4361A7311E2FbCdB5` |
| BaseActivityModule | `0xfD8755EeBb6E879562037fdf0aA087FC43A0fe83` |

## 快速开始

```bash
pnpm install
# 配置 .env
cp .env.example .env
# 编辑 .env，填入 PRIVATE_KEY
```

## 编译与测试

```bash
# Foundry
forge build
forge test

# Hardhat
npx hardhat compile

# Integration test (mainnet / fully functional ERC-8004 env)
npx vitest run test/hardhat/integration.test.ts

# Mock end-to-end flow on testnet
npx tsx scripts/e2e-v2-mock-testnet-viem.ts
```

> 注意：`test/hardhat/integration.test.ts` 在 `NETWORK=testnet` 时会跳过，因为当前 X Layer testnet 上的 ERC-8004 IdentityRegistry 行为与主网不完全一致（注册事件/`ownerOf` 行为不稳定）。测试网联调建议优先使用 mock E2E 脚本验证 `V2 proxy + modules + keeper signatures + evaluate` 全链路。

## Keeper 脚本

我们提供两种 keeper 脚本向链上模块提交 DeFi 数据：

### 1. keeper-oklink.ts（推荐）

使用 OKX OnchainOS API 获取真实的链上 Swap/Activity 数据并提交：

```bash
PRIVATE_KEY=0x... \
UNISWAP_MODULE=0x... \
BASE_MODULE=0x... \
npx tsx scripts/keeper-oklink.ts --wallet=0xYOUR_WALLET
```

### 2. keeper-rpc.ts

直接从 X Layer RPC 读取钱包交易数据并提交到 BaseActivityModule：

```bash
PRIVATE_KEY=0x... \
BASE_MODULE=0x... \
npx tsx scripts/keeper-rpc.ts --wallet=0xYOUR_WALLET [--dry-run]
```

### 3. keeper-daemon.ts（定时调度）

定时自动执行所有 Keeper 提交（Swap / Activity）。

配置 `.env`：

```bash
WALLETS=0xWALLET1,0xWALLET2
DAEMON_INTERVAL_MS=300000   # 默认 5 分钟
UNISWAP_MODULE=0x...
UNISWAP_POOLS=0x...,0x...
BASE_MODULE=0x...
OKX_API_KEY=...
OKX_API_SECRET=...
OKX_PASSPHRASE=...
```

启动 Daemon：

```bash
npx tsx scripts/keeper-daemon.ts
```

停止 Daemon：

```bash
# 按 Ctrl+C 终止进程
# 或使用 pm2 / nohup 等进程管理工具后台运行
```

Daemon 启动后会立即执行一轮，随后按 `DAEMON_INTERVAL_MS` 定时循环。日志直接输出到 stdout，可被重定向到文件或日志收集系统。

### 健康检查

Daemon 会在每轮成功后写入 `keeper-health.json`（路径可通过 `KEEPER_HEALTH_PATH` 覆盖），记录 `lastSuccessBlock`、`lastSuccessTimestamp` 和 `consecutiveFailures`。当连续 3 轮失败时会发出 ERROR 级别告警日志。

快速检查 Daemon 健康状态：

```bash
pnpm keeper:health
# 或
npx tsx scripts/keeper-health.ts
```

- 退出码 `0` = 健康
- 退出码 `1` = 不健康（连续失败 ≥3 次或从未成功）

## Skill 命令示例

### `rep:register`
注册新 Agent（MVP 仅支持 self-registration，即 wallet 必须等于调用者地址）：

```ts
import { register } from "./src/skill";

const { agentId, txHash } = await register({
  wallet: "0x067aBc270C4638869Cd347530Be34cBdD93D0EA1",
  capabilities: ["swap"],
  uri: "https://example.com/agent.json",
});
```

### `rep:evaluate`
触发链上评估并返回最新评分：

```ts
import { evaluate } from "./src/skill";

const result = await evaluate({ agentId: "8" });
// result.rawScore = 8807
// result.decayedScore = 8805
// result.trustTier = "elite"
// result.moduleBreakdown = [
//   { name: "UniswapScoreModule", score: 9000, weight: 4000 },
//   { name: "BaseActivityModule", score: 8500, weight: 2500 },
// ]
```

### `rep:query`
查询存储分数并应用时间衰减：

```ts
import { query } from "./src/skill";

const result = await query({ agentId: "8" });
```

### `rep:compare`
多 Agent 对比排序：

```ts
import { compare } from "./src/skill";

const ranked = await compare({ agentIds: ["8", "10"] });
// Agent 8:  decayed=8805, tier=elite
// Agent 10: decayed=2876, tier=basic
```

也可用脚本直接运行：

```bash
npx tsx scripts/demo-compare.ts 8 10
```

### `rep:modules`
列出已注册的评分模块及权重：

```ts
import { modules } from "./src/skill";

const { modules: list } = await modules();
```

## E2E 测试网流程

一键跑通完整端到端测试（使用 V1 验证环境）：

```bash
npx tsx scripts/e2e-test.ts
```

输出示例（Agent 8，good profile）：

```
1. Registering agent on IdentityRegistry...
   Agent ID: 8
2. Setting agent wallet...
3. Calling evaluateAgent...
4. Querying latest score...
   Score: 8807
5. Querying module scores...
   UniswapScoreModule: score=9000, conf=100
   BaseActivityModule: score=8500, conf=100
6. Verifying ReputationRegistry feedback...
   Feedback count: 1
   Summary value: 8807
✅ End-to-end test PASSED
```

## Demo 结果

已验证的评分对比（同一钱包，不同 Keeper 资料）：

| Agent | Profile | Raw Score | Tier |
|-------|---------|-----------|------|
| 8 | good | **8807** | elite |
| 10 | wash | **2876** | basic |

模块评分拆解：
- **good**: Uniswap=9000 (高交易量+正PnL+低滑点), Activity=8500 (长钱包龄+高交易数+多对手方)
- **wash**: Uniswap=1800 (负PnL+高滑点+洗盘标记), Activity=4600 (低对手方+近期不活跃)

## 目录结构

```
contracts/       # Solidity 合约
src/             # TypeScript Skill 实现
scripts/         # 部署脚本 + E2E + Demo
test/            # Foundry + vitest 集成测试
```

## 核心合约

- `AgentRepValidatorV2.sol` — 主合约（UUPS Proxy 可升级），模块管理与评分聚合
- `UniswapScoreModule.sol` — Uniswap 交易评分
- `BaseActivityModule.sol` — 链上活动评分

> **当前测试网部署为 V2 Proxy 架构**（地址见上方「V2 (UUPS Proxy)」表格）。V1 的端到端 Demo 结果（Agent 8 vs 10）已验证评分逻辑正确性，V2 保持相同评分模型与接口。

## 相关链接

- GitHub: `https://github.com/davirain/AgentRepScore`
- 8004scan X Layer: `https://8004scan.io/agents?chain=196`

## 许可证

MIT
