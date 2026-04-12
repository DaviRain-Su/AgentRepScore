# AgentRepScore

> DeFi Agent 的链上 eval 系统 —— 基于 ERC-8004 的 X Layer 声誉评分 Skill

## X Layer Sepolia 测试网部署

| 合约 | 地址 |
|------|------|
| IdentityRegistry (ERC-8004) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry (ERC-8004) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
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

# Integration test (testnet)
npx vitest run test/hardhat/integration.test.ts
```

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
npx ts-node scripts/demo-compare.ts 8 10
```

### `rep:modules`
列出已注册的评分模块及权重：

```ts
import { modules } from "./src/skill";

const { modules: list } = await modules();
```

## E2E 测试网流程

一键跑通完整端到端测试：

```bash
npx ts-node scripts/e2e-test.ts
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

- `AgentRepValidator.sol` — 主合约，模块管理与评分聚合
- `UniswapScoreModule.sol` — Uniswap 交易评分
- `BaseActivityModule.sol` — 链上活动评分

## 许可证

MIT
