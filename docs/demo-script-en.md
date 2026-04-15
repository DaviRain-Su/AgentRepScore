# AgentRepScore Demo Script (English)

> Duration: ~5 minutes  
> Use case: Scale Demo / Project pitch / Investor presentation

---

## 1. Hook (30 seconds)

**【Visual】** Fade from black to the project logo, then immediately cut to a CLI terminal showing two wallet scores side-by-side: one `8807 elite`, the other `2876 basic`.

**【Script】**
> Hi, I'm the developer of AgentRepScore. Today I want to show you something critical in the age of AI Agents: **how to verify an Agent's on-chain reputation using the smart contract itself**, instead of trusting anyone who says "my data is real."
> 
> Here are two profiles for the same wallet: the good profile scores elite, while the wash-trading profile drops to basic. The difference isn't my opinion — **it's calculated directly by the contract reading real Uniswap and Aave on-chain data.**

---

## 2. Problem & Solution (45 seconds)

**【Visual】** Simple slide or diagram: left side "Traditional off-chain eval" with a red cross, right side "AgentRepScore on-chain validation" with a green check.

**【Script】**
> Most AI Agent evaluations today rely on off-chain synthetic data. Developers can easily fake transaction histories, wash-trade, or manipulate PnL.
> 
> Our solution is simple: **move the eval onto the chain.** The AgentRepValidator contract reads live Uniswap and Aave data, computes the score, and writes it to an ERC-8004 Reputation Registry.
> 
> Consumers only need to check one thing: `clientAddress == contract address`. Only scores computed by the contract itself are trusted. This eliminates fraud at the root.

---

## 3. Architecture (60 seconds)

**【Visual】** Architecture diagram (text version is fine):
- Wallet → Uniswap / Aave / BaseActivity
- ↓
- AgentRepValidator (on-chain computation)
- ↓
- ERC-8004 ReputationRegistry
- ↓
- Skill API / CLI / any consumer

**【Script】**
> Our architecture has three layers:
> 
> **First, data-source modules.** Every DeFi protocol is an independent `IScoreModule`. We currently have a Uniswap trading module, an on-chain base-activity module, and a newly integrated Aave module. Adding a new protocol only requires deploying a new module — the main validator contract never needs to change.
> 
> **Second, the validation layer.** The `AgentRepValidator` contract reads summarized data from all modules and performs three anti-cheat checks: wash-trade loop detection, counterparty concentration penalty, and sybil funding-cluster detection. Any cheating behavior is penalized directly in the score.
> 
> **Third, the consumption layer.** We provide a Skill API and CLI. Anyone can `query` a wallet's score, `evaluate` a fresh computation, or `compare` multiple Agents side-by-side.
> 
> And the most important part: **every output includes an evidence status.** If the on-chain evidence commitment is accepted, the API returns `verifiedEvidence: true` along with the on-chain commitment data.

---

## 4. Live Demo (2 minutes 30 seconds)

### 4.1 Environment setup (15 seconds)

**【Visual】** Terminal window. Show `.env` or confirm the environment is ready.

**【Script】**
> We're running on X Layer Sepolia testnet. All contracts are deployed and the API is live. Let me start with a normal high-score wallet.

### 4.2 Evaluate — Good Wallet (45 seconds)

**【Visual】** Run in terminal:
```bash
pnpm cli evaluate --agent-id 8 --wallet 0x...
```

**【Script】**
> This is Agent 8, the good profile. Running evaluate forces the contract to re-read on-chain data and compute the score.
> 
> 【Wait for output】We see: raw score 9200, decayed score 8807, trust tier elite. No correlation penalty was triggered. The module breakdown shows high Uniswap volume, positive PnL, and diversified counterparties.
> 
> Most importantly: **verifiedEvidence is true**, evidenceMode is `accepted-commitment`, meaning the on-chain evidence commitment has been accepted by the contract. This `commitment.root` field is the actual Merkle root stored on-chain.

### 4.3 Evaluate — Wash Wallet (45 seconds)

**【Visual】** Run the same command with agent-id 10 (wash profile).

**【Script】**
> Now let's look at the wash profile for the same wallet, Agent 10.
> 
> 【Wait for output】The score collapses to 2876, trust tier basic. Why? The module breakdown shows high slippage, negative PnL, and critically — the correlation penalty was triggered because the system detected a wash-trading loop pattern.
> 
> Also notice verifiedEvidence is false and evidenceMode falls back to legacy-summary, because there is no valid on-chain evidence commitment.

### 4.4 Compare — Side-by-side (45 seconds)

**【Visual】** Run in terminal:
```bash
pnpm cli compare --agents 8,10 --wallet 0x...
```

**【Script】**
> Finally, I'll use compare to put both Agents side-by-side. The output is stark: elite vs basic, correlation penalty 0 vs positive, verifiedEvidence true vs false.
> 
> For consumers, the decision is trivial: just look at the trust tier and evidence status.

---

## 5. Results Interpretation (45 seconds)

**【Visual】** Back to a slide showing a comparison table:
| Metric | Good | Wash |
|--------|------|------|
| Raw Score | 9200 | 3400 |
| Decayed Score | 8807 | 2876 |
| Trust Tier | elite | basic |
| Correlation Penalty | 0 | >0 |
| Verified Evidence | ✅ | ❌ |

**【Script】**
> What does this comparison prove?
> 
> First, **on-chain data cannot be faked.** All the negative signals in the wash profile are read directly from the chain by the contract.
> 
> Second, **anti-cheat is real-time.** Correlation and sybil detection don't require manual review; the contract deducts points automatically during computation.
> 
> Third, **evidence commitments provide verifiability.** Consumers don't just get a score — they can verify that the on-chain commitment actually exists.

---

## 6. Mainnet Roadmap & Closing (30 seconds)

**【Visual】** Simple roadmap slide:
- ✅ Testnet Demo (Done)
- 🔄 Security Audit (Planned)
- 🔄 Mainnet Deployment (Planned)
- 🔄 Keeper Network Decentralization (Long-term)

**【Script】**
> Right now we've completed a full testnet deployment on X Layer Sepolia, and every feature is working end-to-end.
> 
> The path to mainnet is clear: security audit → parameter review → mainnet contract deployment → decentralized keeper network. There are no unknown technical risks, only time and funding.
> 
> Thank you. If you also believe AI Agent reputation should live on-chain, we'd love to talk.

---

## Appendix: Recording Tips

1. **Use a large terminal font** (18pt+) so the JSON output is readable on video.
2. **Highlight key fields** with `jq` filters, e.g. `jq '.trustTier, .verifiedEvidence, .decayedScore'`.
3. **Run a warm-up demo** before recording to avoid network latency during the live demo.
4. **Background music**: light electronic / tech vibe, volume lower than voice.
