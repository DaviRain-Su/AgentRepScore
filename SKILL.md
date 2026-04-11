# AgentRepScore Skill Definition

> agent-rep-score: Evaluate and query AI agent reputation on X Layer using ERC-8004

## Metadata

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

## Commands

### `rep:register`

Register a new agent identity on ERC-8004 and bind its wallet.

**Input:**
```json
{
  "wallet": "0x...",
  "capabilities": ["swap", "lend"],
  "uri": "https://example.com/agent.json"
}
```

**Output:**
```json
{
  "agentId": "123",
  "txHash": "0x..."
}
```

---

### `rep:evaluate`

Trigger an on-chain evaluation for a given agent.

**Input:**
```json
{
  "agentId": "123"
}
```

**Output:**
```json
{
  "agentId": "123",
  "score": 8534,
  "evidenceHash": "0x...",
  "timestamp": 1700000000,
  "moduleBreakdown": [
    { "name": "AaveScoreModule", "score": 9000, "weight": 3500 },
    { "name": "UniswapScoreModule", "score": 7500, "weight": 4000 },
    { "name": "BaseActivityModule", "score": 6000, "weight": 2500 }
  ]
}
```

---

### `rep:query`

Query the latest score with time-decay applied.

**Input:**
```json
{
  "agentId": "123"
}
```

**Output:**
```json
{
  "agentId": "123",
  "rawScore": 8534,
  "decayedScore": 7680,
  "trustTier": "verified",
  "timestamp": 1700000000,
  "moduleBreakdown": [...]
}
```

---

### `rep:compare`

Compare multiple agents and rank them by decayed score.

**Input:**
```json
{
  "agentIds": ["123", "456", "789"]
}
```

**Output:**
```json
[
  { "agentId": "123", "decayedScore": 8200, "trustTier": "verified" },
  { "agentId": "456", "decayedScore": 6100, "trustTier": "verified" },
  { "agentId": "789", "decayedScore": 3400, "trustTier": "basic" }
]
```

---

### `rep:modules`

List registered scoring modules and their weights.

**Output:**
```json
{
  "modules": [
    { "name": "AaveScoreModule", "category": "lending", "address": "0x...", "weight": 3500, "active": true },
    { "name": "UniswapScoreModule", "category": "dex", "address": "0x...", "weight": 4000, "active": true },
    { "name": "BaseActivityModule", "category": "activity", "address": "0x...", "weight": 2500, "active": true }
  ]
}
```
