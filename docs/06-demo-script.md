# AgentRepScore Demo Script

> 目标：给 `AgentRepScore` 准备一套 **可直接录屏** 的 demo 材料，包括：
> - 测试网 demo 交付口径
> - 中文讲稿
> - English script
> - 屏幕录制步骤
> - 主网表述边界

---

## 1. Demo Positioning

### 当前最稳妥的对外口径

- **当前可交付**：`X Layer Sepolia testnet` 上的可复现 demo
- **当前可演示**：
  - 链上注册 / 评分 / 查询 / 对比
  - evidence / commitment 状态输出
  - 模块化评分结构
- **主网状态**：
  - 代码路径已支持主网
  - 但当前不建议承诺“主网 live demo 已 ready”
  - 更适合作为下一阶段路线图来讲

### 推荐的一句话版本

- 中文：
  - `我们当前交付的是 X Layer Sepolia 测试网上可复现的端到端 demo，主网路径代码已支持，但主网发布作为下一阶段里程碑。`
- English:
  - `Our current deliverable is a reproducible end-to-end demo on X Layer Sepolia testnet. Mainnet is supported in code, but production launch is positioned as the next milestone rather than this demo’s scope.`

---

## 2. Suggested Demo Structure

推荐录成 **3-5 分钟**。

### 结构

1. 背景与问题：30s
2. 系统架构：45-60s
3. 实机演示：2-3 min
4. 结果解释：45-60s
5. 主网路线图：30-45s

---

## 3. Demo Checklist

录屏前建议准备：

### 环境

1. 打开项目目录
2. 准备好 `.env`
3. 确认测试网配置
4. 确认 CLI 可直接运行

### 建议打开的窗口

1. 终端窗口
2. README 或架构图窗口
3. 可选：浏览器打开 Swagger / Block Explorer

### 录屏时建议展示的内容

1. `README.md` 中的测试网部署信息
2. `rep query`
3. `rep evaluate`
4. `rep compare`
5. 返回结果中的：
   - `rawScore`
   - `decayedScore`
   - `trustTier`
   - `verifiedEvidence`
   - `evidenceMode`
   - `moduleBreakdown`

---

## 4. Recommended Live Demo Flow

### Option A: CLI Demo

推荐优先用 CLI，最稳。

#### Step 1: 说明当前是测试网

可展示：
- `README.md` 中 `X Layer Sepolia 测试网部署`

#### Step 2: 查询单个 Agent

```bash
rep query 8
```

#### Step 3: 触发评分

```bash
rep evaluate 8
```

#### Step 4: 对比两个 Agent

```bash
rep compare 8 10
```

#### Step 5: 可选展示模块

```bash
rep modules
```

### Option B: HTTP API Demo

如果你想看起来更像产品，可以开 HTTP 服务：

```bash
npm run server
```

然后演示：

```bash
curl -X POST http://localhost:3000/query \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"8"}'
```

```bash
curl -X POST http://localhost:3000/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"8"}'
```

```bash
curl -X POST http://localhost:3000/compare \
  -H 'Content-Type: application/json' \
  -d '{"agentIds":["8","10"]}'
```

---

## 5. Chinese Demo Script

下面是一版可以直接照着念的中文稿。

### 5.1 Opening

大家好，这个项目叫 **AgentRepScore**。

它解决的问题是：今天很多 AI Agent 的“能力评估”依然停留在链下、中心化、可伪造的测试环境里。  
而我们做的是把 Agent 的声誉评估搬到链上，用 **ERC-8004** 和真实 DeFi 行为数据，生成可验证、可追溯的链上评分。

当前这套 demo 运行在 **X Layer Sepolia 测试网**，这样可以稳定复现完整流程，同时把主网发布保留为下一阶段。

### 5.2 Architecture

AgentRepScore 的核心结构有三层：

第一层是 **IdentityRegistry / ReputationRegistry**，负责 Agent 身份和评分结果的链上登记。  
第二层是 **Validator + Modules**，不同协议的数据通过模块化方式进入统一评分逻辑。  
第三层是 **Skill / CLI / API**，方便上层应用直接调用 `evaluate`、`query`、`compare`。

关键点不只是“算一个分”，而是：  
这个分数来自链上真实行为，而且能附带 evidence 状态，告诉消费方这份结果是传统 summary，还是已经进入 accepted commitment 模式。

### 5.3 Live Demo

现在我先查询一个 Agent 的当前结果：

```bash
rep query 8
```

这里可以看到原始分数、衰减后的分数、信任等级，以及 evidence 相关字段。

接着我触发一次实时评估：

```bash
rep evaluate 8
```

这一步会走链上评估逻辑，重新计算并返回结果。

然后我做一个对比：

```bash
rep compare 8 10
```

这里可以看到两个 Agent 的排序差异。  
这类结果不是单纯“谁高谁低”，还体现了：
- trust tier
- correlation penalty
- verified evidence status

这也是 AgentRepScore 最有价值的部分：  
我们不是只给一个总分，而是给出一套可解释、可验证的评分结构。

### 5.4 Why This Matters

对生态来说，这种能力有两个直接价值：

第一，**可验证的 Agent 声誉**。  
调用方不需要盲信 Agent 自己上报的能力，而是可以直接用链上结果过滤风险。

第二，**模块化扩展**。  
未来增加新的协议模块，不需要推翻整个系统，而是可以继续把新的数据源接进现有框架。

### 5.5 Mainnet Positioning

关于主网，这套代码已经支持主网配置，但当前 demo 的交付重点是测试网可复现性。  
主网发布会作为下一阶段推进，重点包括：
- 主网部署
- 运维稳定性
- 数据源稳定性验证
- 以及必要的安全审查

所以今天这个 demo 的重点，不是“已经主网上线”，而是：  
**我们已经在测试网上把这套链上声誉评估路径完整跑通了。**

### 5.6 Closing

总结一下，AgentRepScore 展示的是：
- 链上真实数据驱动的 Agent 评分
- 基于 ERC-8004 的可验证声誉输出
- 可通过 CLI / API 直接消费
- 并且具备向主网迁移的清晰路径

谢谢大家。

---

## 6. English Demo Script

### 6.1 Opening

Hi everyone, this project is called **AgentRepScore**.

The problem we are solving is that many AI agent evaluations are still off-chain, centralized, and easy to fake.  
What we built is an on-chain reputation scoring system that uses **ERC-8004** plus real DeFi activity data to produce verifiable agent reputation.

For this demo, we are using **X Layer Sepolia testnet**, which gives us a reproducible and stable environment, while keeping mainnet launch as the next milestone.

### 6.2 Architecture

The system has three layers:

First, **IdentityRegistry and ReputationRegistry**, which store agent identity and reputation on-chain.  
Second, **Validator plus modular score modules**, which turn protocol-specific activity into structured reputation signals.  
Third, a **Skill / CLI / API** layer, which makes the system easy to consume through commands like `evaluate`, `query`, and `compare`.

What matters here is not just producing a score.  
It is producing a score that is tied to on-chain evidence, and that can expose whether the evidence is a legacy summary or an accepted commitment.

### 6.3 Live Demo

First, I query the current score of one agent:

```bash
rep query 8
```

Here we can see the raw score, decayed score, trust tier, and evidence-related fields.

Next, I trigger a fresh evaluation:

```bash
rep evaluate 8
```

This executes the on-chain evaluation flow and returns the updated score.

Then I compare two agents:

```bash
rep compare 8 10
```

This shows a ranked comparison between agents.  
It is not only about who scores higher; it also shows:
- trust tier
- correlation penalty
- verified evidence status

That is one of the main strengths of AgentRepScore:  
we are not outputting only a single number, but an explainable and verifiable reputation surface.

### 6.4 Why This Matters

This matters for two reasons.

First, it gives the ecosystem **verifiable agent reputation**.  
Consumers do not need to trust self-reported claims from agents; they can rely on on-chain reputation outputs instead.

Second, the architecture is **modular**.  
As new DeFi protocols are integrated, new score modules can be added without redesigning the whole system.

### 6.5 Mainnet Positioning

About mainnet: the codebase already supports mainnet configuration, but the current deliverable is a stable and reproducible testnet demo.  
Mainnet launch is positioned as the next milestone, including:
- mainnet deployment
- operational hardening
- data-source reliability checks
- and security review where needed

So the point of this demo is not “we are already live on mainnet.”  
The point is:  
**we have already proven the end-to-end on-chain reputation flow on testnet.**

### 6.6 Closing

To summarize, AgentRepScore demonstrates:
- on-chain agent scoring backed by real activity
- ERC-8004-based verifiable reputation outputs
- CLI and API usability for downstream consumers
- and a clear path toward mainnet rollout

Thank you.

---

## 7. Fast Recording Guide

### 3-Minute Version

1. 15s: 打开 README，指出测试网部署
2. 30s: 简述架构
3. 30s: `rep query 8`
4. 30s: `rep evaluate 8`
5. 30s: `rep compare 8 10`
6. 45s: 讲 verified evidence / trust tier / modularity

### 5-Minute Version

1. 30s: 背景
2. 60s: 架构
3. 120s: 实机演示
4. 45s: 结果解释
5. 45s: 主网路线图

---

## 8. Demo Talking Boundaries

### 可以说

- `The demo is running on X Layer Sepolia testnet.`
- `The codebase already supports mainnet configuration.`
- `Mainnet is the next milestone after demo validation.`

### 不建议现在说

- `We are already live on mainnet.`
- `Mainnet deployment is complete.`
- `This demo is running on mainnet.`

---

## 9. One-Slide Summary

### 中文

AgentRepScore 是一个基于 ERC-8004 的链上 Agent 声誉评分系统。  
它通过 Validator + Modules 读取真实 DeFi 行为数据，在 X Layer 上生成可验证、可解释、可扩展的 Agent Reputation。  
当前 demo 已在 X Layer Sepolia 测试网可复现，主网作为下一阶段推进。

### English

AgentRepScore is an ERC-8004-based on-chain reputation system for AI agents.  
It uses validators and modular DeFi data sources to generate verifiable, explainable, and extensible reputation on X Layer.  
The current demo is reproducible on X Layer Sepolia testnet, with mainnet positioned as the next milestone.
