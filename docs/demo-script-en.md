# AgentRepScore Demo Script (English)

> Duration: ~5 minutes  
> Use case: Scale Demo / Project pitch / Investor presentation

---

## 1. Hook (30 seconds)

**【Visual】** Fade from black to the project logo, then immediately cut to a CLI terminal showing two wallet scores side-by-side: one `6692 verified`, the other `0 untrusted`.

**【Script】**
> Hi, I'm the developer of AgentRepScore. Today I want to show you something critical in the age of AI Agents: **how to verify an Agent's on-chain reputation using the smart contract itself**, instead of trusting anyone who says "my data is real."
> 
> Here are two profiles for the same wallet: the good profile scores verified, while the wash-trading profile drops to untrusted. The difference isn't my opinion — **it's calculated directly by the contract reading real Uniswap and on-chain activity data.**

---

## 2. Problem & Solution (45 seconds)

**【Visual】** Simple slide or diagram: left side "Traditional off-chain eval" with a red cross, right side "AgentRepScore on-chain validation" with a green check.

**【Script】**
> Most AI Agent evaluations today rely on off-chain synthetic data. Developers can easily fake transaction histories, wash-trade, or manipulate PnL.
> 
> Our solution is simple: **move the eval onto the chain.** The AgentRepValidator contract reads live Uniswap and on-chain activity data, computes the score, and writes it to an ERC-8004 Reputation Registry.
> 
> Consumers only need to check one thing: `clientAddress == contract address`. Only scores computed by the contract itself are trusted. This eliminates fraud at the root.

---

## 3. Architecture (60 seconds)

**【Visual】** Architecture diagram (text version is fine):
- Wallet → Uniswap / BaseActivity
- ↓
- AgentRepValidator (on-chain computation)
- ↓
- ERC-8004 ReputationRegistry
- ↓
- CLI Skill / any consumer

**【Script】**
> Our architecture has three layers:
> 
> **First, data-source modules.** Every DeFi protocol is an independent `IScoreModule`. We currently have a Uniswap trading module and an on-chain base-activity module. Adding a new protocol (like Aave) only requires deploying a new module — the main validator contract never needs to change.
> 
> **Second, the validation layer.** The `AgentRepValidator` contract reads summarized data from all modules and performs three anti-cheat checks: wash-trade loop detection, counterparty concentration penalty, and sybil funding-cluster detection. Any cheating behavior is penalized directly in the score.
> 
> **Third, the consumption layer.** We provide a CLI that a Code Agent can execute directly. Anyone can `query` a wallet's score, `evaluate` a fresh computation, or `compare` multiple Agents side-by-side.

---

## 4. Live Demo (2 minutes 30 seconds)

### 4.1 Environment setup (15 seconds)

**【Visual】** Terminal window. Show `.env` or confirm the environment is ready.

**【Script】**
> We're running on X Layer Sepolia testnet. All contracts are deployed and the API is live. Let me start with a normal high-score wallet.

### 4.2 Evaluate — Good Wallet (45 seconds)

**【Visual】** Run in terminal:
```bash
rep query 8
```

**【Script】**
> This is Agent 8, the good profile. Running query reads the current on-chain score.
> 
> 【Wait for output】We see: raw score 6692, trust tier verified. No correlation penalty was triggered. The module breakdown shows Uniswap score 7500 at 100% confidence, and BaseActivity score 5400 at 100% confidence.
> 
> This tells us the wallet has healthy on-chain behavior: high volume, positive PnL, and diversified counterparties.

### 4.3 Evaluate — Wash Wallet (45 seconds)

**【Visual】** Run the same command with agent-id 10 (wash profile).

**【Script】**
> Now let's look at the wash profile, Agent 10.
> 
> 【Wait for output】The score drops to 0, trust tier untrusted. Why? The module breakdown shows Uniswap and BaseActivity scores are both 0 with 0% confidence — the system detected wash trade patterns and sybil cluster flags, and refused to give any score at all.

### 4.4 Compare — Side-by-side (45 seconds)

**【Visual】** Run in terminal:
```bash
rep compare 8 10
```

**【Script】**
> Finally, I'll use compare to put both Agents side-by-side. The output is stark: verified vs untrusted, score 6692 vs 0.
> 
> For consumers, the decision is trivial: just look at the trust tier.

---

## 5. Results Interpretation (45 seconds)

**【Visual】** Back to a slide showing a comparison table:
| Metric | Good | Wash |
|--------|------|------|
| Raw Score | 6692 | 0 |
| Decayed Score | 6692 | 0 |
| Trust Tier | verified | untrusted |
| Correlation Penalty | 0 | 0 |
| Evidence Mode | legacy-summary | legacy-summary |

**【Script】**
> What does this comparison prove?
> 
> First, **on-chain data cannot be faked.** All the negative signals in the wash profile are read directly from the chain by the contract.
> 
> Second, **anti-cheat is real-time.** Correlation and sybil detection don't require manual review; the contract deducts points automatically during computation.
> 
> Third, **the architecture is modular and extensible.** Adding new protocols like Aave only requires deploying a new module — the validator contract never needs to change.

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
