---
theme: default
title: AgentRepScore
info: |
  On-Chain Reputation Scoring for AI Agents
  Based on ERC-8004 Standard
class: text-center
highlighter: shiki
drawings:
  persist: false
transition: slide-left
mdc: true
---

# AgentRepScore

**On-Chain Reputation Scoring for AI Agents**

基于 ERC-8004 的链上 Agent 声誉评分系统

<div class="abs-br m-6 flex gap-2">
  <span class="text-sm opacity-50">X Layer Sepolia Testnet Demo</span>
</div>

---

# The Problem / 问题

<div class="grid grid-cols-2 gap-8">
<div>

### Off-Chain Eval is Broken

- AI agents self-report capabilities
- Synthetic test data is easy to fake
- Wash trading, fake PnL, Sybil attacks
- **No verifiable trust signal**

</div>
<div>

### 链下评估已经失效

- Agent 自己上报能力数据
- 合成测试数据容易伪造
- 刷单、假盈利、女巫攻击
- **没有可验证的信任信号**

</div>
</div>

<br>

<div class="text-center text-2xl font-bold text-red-500">
  "Trust me, my data is real" is not a security model.
</div>

---

# The Solution / 方案

<div class="text-center text-xl mb-8">
  <strong>Move evaluation on-chain. Let smart contracts read real DeFi data.</strong>
</div>

<div class="grid grid-cols-3 gap-4 text-center">
<div class="border rounded p-4">

### ERC-8004
Agent Identity +<br>Reputation Registry

</div>
<div class="border rounded p-4">

### Smart Contract
Reads Uniswap / Aave<br>real on-chain activity

</div>
<div class="border rounded p-4">

### Verifiable Output
Trust tier + evidence<br>commitment on-chain

</div>
</div>

<br>

<div class="text-center opacity-70">
  Consumers check: <code>clientAddress == contract address</code> → only contract-computed scores are trusted.
</div>

---

# Architecture / 架构

```
┌─────────────────────────────────────────────────┐
│                  Consumer Layer                  │
│          CLI / Skill API / HTTP Server           │
│      rep query · rep evaluate · rep compare      │
├─────────────────────────────────────────────────┤
│               Validator Layer                    │
│          AgentRepValidatorV2 (UUPS)              │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│   │ Uniswap  │ │  Base    │ │   Aave   │       │
│   │  Module   │ │ Activity │ │  Module  │       │
│   └──────────┘ └──────────┘ └──────────┘       │
│   Wash Trade Detection · Sybil Clustering       │
│   Correlation Penalties · Score Decay            │
├─────────────────────────────────────────────────┤
│               Registry Layer                     │
│   ERC-8004 IdentityRegistry (Agent NFT)          │
│   ERC-8004 ReputationRegistry (Feedback)         │
└─────────────────────────────────────────────────┘
```

---

# Scoring Modules / 评分模块

| Module | What it reads | Key signals |
|--------|--------------|-------------|
| **UniswapScoreModule** | Swap history on Uniswap | Volume, PnL, slippage, wash trade cycles |
| **BaseActivityModule** | Wallet on-chain activity | Wallet age, tx count, counterparty diversity |
| **AaveModule** | Aave V3 positions | Supply/borrow health, liquidation history |

<br>

### Anti-Fraud Detection / 反作弊检测

- **Wash Trade Cycles** — Detect circular trading patterns
- **Counterparty Concentration** — Penalize trading with few addresses
- **Sybil Clustering** — Identify common funding sources
- **Score Decay** — `rawScore × max(0.1, 1 - 0.02 × daysElapsed)`

---

# Live Demo: Good Agent / 正常钱包

```bash
$ rep evaluate 8
```

<div class="grid grid-cols-2 gap-8 mt-4">
<div>

### Results

| Field | Value |
|-------|-------|
| Raw Score | **9200** |
| Decayed Score | **8807** |
| Trust Tier | **elite** |
| Correlation Penalty | 0 |
| Verified Evidence | ✅ |
| Evidence Mode | accepted-commitment |

</div>
<div>

### Module Breakdown

| Module | Score | Confidence |
|--------|-------|-----------|
| Uniswap | 9000 | 92% |
| BaseActivity | 8500 | 88% |

**High volume, positive PnL, diverse counterparties**

</div>
</div>

---

# Live Demo: Wash Agent / 刷单钱包

```bash
$ rep evaluate 10
```

<div class="grid grid-cols-2 gap-8 mt-4">
<div>

### Results

| Field | Value |
|-------|-------|
| Raw Score | **3400** |
| Decayed Score | **2876** |
| Trust Tier | **basic** |
| Correlation Penalty | > 0 |
| Verified Evidence | ❌ |
| Evidence Mode | legacy-summary |

</div>
<div>

### Module Breakdown

| Module | Score | Confidence |
|--------|-------|-----------|
| Uniswap | 1800 | 45% |
| BaseActivity | 4600 | 62% |

**Negative PnL, high slippage, wash trade detected**

</div>
</div>

---

# Side-by-Side Comparison / 横向对比

```bash
$ rep compare 8 10
```

<br>

| Metric | Agent 8 (Good) | Agent 10 (Wash) |
|--------|---------------|----------------|
| Raw Score | 9200 | 3400 |
| Decayed Score | 8807 | 2876 |
| Trust Tier | **elite** | **basic** |
| Correlation Penalty | 0 | > 0 |
| Verified Evidence | ✅ | ❌ |
| Evidence Mode | accepted-commitment | legacy-summary |

<br>

<div class="text-center text-lg">
  Same wallet, different behavior profiles.<br>
  <strong>The contract sees through the data — no human review needed.</strong>
</div>

---

# Why This Matters / 核心价值

<div class="grid grid-cols-2 gap-8">
<div>

### Verifiable Reputation
- On-chain data cannot be faked
- Anti-fraud detection is real-time
- Evidence commitment provides cryptographic proof
- Consumers filter by `clientAddress`

</div>
<div>

### Modular & Extensible
- New protocols = new `IScoreModule`
- No validator contract redeployment needed
- Weighted aggregation adapts automatically
- Any consumer can integrate via API/CLI

</div>
</div>

<br>

<div class="text-center text-xl font-bold">
  From "trust me" to "verify on-chain"
</div>

---

# Testnet Deployment / 测试网部署

**Network: X Layer Sepolia (chainId: 195)**

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x8004A169FB4a...9A432` |
| ReputationRegistry | `0x8004BAa17C55...9b63` |
| AgentRepValidatorV2 | `0x8B66EaD3b6A4...dbfB` |
| UniswapScoreModule | `0xf99FFbfab2cb...76f8A` |
| BaseActivityModule | `0xf0BF570B4B68...2996` |

<br>

### Quick Start

```bash
pnpm install
cp .env.example .env  # Configure RPC + wallet
rep query 8            # Query agent score
rep evaluate 8         # Trigger on-chain evaluation
rep compare 8 10       # Compare agents
```

---

# Roadmap / 路线图

<div class="grid grid-cols-4 gap-4 text-center mt-8">
<div class="border rounded p-4 bg-green-50">

### ✅ Phase 1
Testnet Demo

Sepolia deployment<br>
Full E2E flow<br>
CLI + API

</div>
<div class="border rounded p-4">

### 🔄 Phase 2
Security Audit

Contract review<br>
Parameter tuning<br>
Risk assessment

</div>
<div class="border rounded p-4">

### 🔄 Phase 3
Mainnet Launch

X Layer mainnet<br>
(chainId: 196)<br>
Production RPC

</div>
<div class="border rounded p-4">

### 🔄 Phase 4
Ecosystem

Keeper network<br>
More DeFi modules<br>
Cross-chain

</div>
</div>

<br>

<div class="text-center opacity-70">
  Mainnet config is ready in code — deployment is the next milestone.
</div>

---
layout: center
class: text-center
---

# Thank You

**AgentRepScore — On-Chain Reputation for AI Agents**

<div class="mt-8 text-lg opacity-70">

Built on ERC-8004 · Deployed on X Layer Sepolia

Verifiable · Explainable · Extensible

</div>

<br>

<div class="text-sm opacity-50">
  GitHub: github.com/DaviRain-Su/AgentRepScore
</div>
