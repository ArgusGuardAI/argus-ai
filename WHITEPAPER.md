# Argus AI: The Research-to-Trade Protocol

**Version:** 3.0
**Date:** January 2026
**Status:** Live on Solana

---

## Abstract

The Solana memecoin ecosystem -- driven by platforms like Pump.fun, Raydium, and Meteora -- represents the fastest, most volatile financial market in history. However, this speed comes with a catastrophic cost: **The Information Vacuum.**

Retail investors navigate a minefield of sophisticated smart contract scams, honeypots, and anonymous serial rug-pullers. Traditional due diligence tools are fragmented across five or more separate platforms, too slow and disconnected for the high-velocity trading environment of 2026.

**Argus AI** fills this vacuum as the first **Research-to-Trade platform** -- combining instant AI-powered analysis, bundle detection, security checks, and one-click trading in a single interface. Analyze a token and act on it instantly, with auto-sell protecting your position.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Threat Landscape](#2-the-threat-landscape)
3. [The Solution: Research-to-Trade](#3-the-solution-research-to-trade)
4. [Risk Analysis Engine](#4-risk-analysis-engine)
5. [Bundle Detection](#5-bundle-detection)
6. [Technical Architecture](#6-technical-architecture)
7. [Tokenomics](#7-tokenomics)
8. [Roadmap](#8-roadmap)
9. [Conclusion](#9-conclusion)

---

## 1. Introduction

### 1.1 The State of the Market

In 2026, the memecoin market is no longer a niche; it is the primary onboarding mechanism for retail liquidity. Platforms like Pump.fun allow for the deployment of thousands of tokens daily.

**The Problem:**
- **Information Asymmetry:** Professional traders have bot networks to scan contract bytecode. Retail users rely on "vibes" and Twitter hype.
- **Tool Fragmentation:** Traders juggle RugCheck, DexScreener, Bubble Maps, a DEX, and a price tracker just to evaluate a single token.
- **Velocity vs. Accuracy:** By the time a scam is exposed on Twitter, the liquidity has already been drained.
- **The "Rug" Cycle:** Malicious actors deploy, drain, and redeploy with impunity. There is no "reputation cost" in anonymous memecoins.

### 1.2 The Argus Thesis

We posit that **Context is Currency** and **Speed is Survival.**

Other traders use five separate tools to research one token. Argus replaces them all in a single interface. By combining AI-powered analysis with one-click execution, we compress the research-to-trade pipeline from minutes to seconds.

---

## 2. The Threat Landscape

### 2.1 The Honeypot (The Silent Killer)

The most devastating scam in the memecoin ecosystem is the **Honeypot**.

- **The Mechanism:** A user purchases a token. The price rises. When the user attempts to sell, the smart contract returns an error or applies a 100% tax.
- **The Reality:** The contract contains hidden `modifyTax` functions or hardcoded sell restrictions. The user can buy, but cannot sell. They are trapped.
- **Argus Detection:** Checks mint authority and freeze authority status. If either is active, the token can be rugpulled at any time.

### 2.2 The Serial Rugger

Anonymous developers launch multiple tokens under different tickers.

- **The Pattern:** Developer A deploys `COIN_1`, rugs the liquidity.
- **The Rebirth:** Developer A immediately deploys `COIN_2` using the same wallet address.
- **The Blind Spot:** Standard block explorers do not link these events visually.
- **Argus Detection:** Creator wallet history tracking, automatic blacklisting of rug creators.

### 2.3 The Bundle Attack

Coordinated wallet networks artificially inflate token metrics:

- Multiple wallets buy simultaneously in the same block
- Creates false appearance of organic demand
- Wallets often funded from the same source
- Difficult to detect without holder analysis
- **Argus Detection:** Proprietary bundle detection algorithm identifies coordinated wallet clusters.

### 2.4 Structural Risk (New Tokens)

Brand new tokens with thin liquidity present extreme risk:

- Tokens under 6 hours old with less than $10K liquidity are high risk regardless of other signals
- Volume/liquidity ratios above 8x indicate potential wash trading
- "Clean" holder distributions can still mask rug risk in very new tokens
- **Argus Detection:** Structural risk guardrails enforce minimum risk scores based on age and liquidity depth.

---

## 3. The Solution: Research-to-Trade

Argus AI mitigates these threats through a unified platform with four integrated layers.

### 3.1 Layer 1: AI Sentinel (Analysis)

Powered by **Together AI** (production) and **Groq** (local development, free) with on-chain data from Helius RPC.

**What It Does:**
- Generates a risk score from 0-100 for any Solana token
- Produces trading signals: STRONG_BUY, BUY, WATCH, HOLD, AVOID
- Provides written analysis explaining the verdict
- Applies structural risk guardrails (token age, liquidity depth, volume ratios)

**Visual Signals:**
- **STRONG_BUY (75-100):** Strong fundamentals, low risk
- **BUY (60-74):** Good setup, acceptable risk
- **WATCH (45-59):** Mixed signals, proceed with caution
- **HOLD (30-44):** Elevated risk, caution advised
- **AVOID (0-29):** High risk, multiple red flags

### 3.2 Layer 2: Security Analysis

Instant on-chain security checks:

- **Mint Authority:** Can the developer mint infinite tokens? (Revoked = safe)
- **Freeze Authority:** Can the developer freeze your wallet? (Revoked = safe)
- **LP Lock:** What percentage of liquidity is locked? (Higher = safer)
- **Holder Distribution:** Visual bar chart of top 10 holders with concentration warnings

### 3.3 Layer 3: Bundle Detection

Proprietary algorithm that exposes coordinated wallet clusters:

- Fetches top 20 holders and transaction history via Helius RPC
- Detects same-block transactions (wallets buying in the same block = HIGH confidence)
- Analyzes holder percentage patterns for additional coordination signals
- Assigns confidence levels: HIGH, MEDIUM, LOW, NONE
- Displays total bundle percentage, wallet count, and confidence level
- Red highlighting in holder distribution chart

### 3.4 Layer 4: One-Click Trading

Execute directly from the research interface:

- **Dedicated Trading Wallet:** Separate from your main wallet for safety
- **Instant Execution:** No popup confirmations, Jupiter aggregator for best pricing
- **Configurable Amounts:** 0.01, 0.05, 0.1, 0.25 SOL presets or custom
- **Auto-Sell Protection:** Take profit, stop loss, and trailing stop conditions
- **Position Tracking:** Real-time P&L monitoring with easy sell controls

---

## 4. Risk Analysis Engine

### 4.1 Risk Categories

| Category | What It Analyzes |
|----------|------------------|
| **LIQUIDITY** | LP locks, liquidity depth, rug pull vectors |
| **OWNERSHIP** | Mint authority, freeze authority, admin functions |
| **CONTRACT** | Bonding curve status, program verification |
| **SOCIAL** | Website, Twitter, Telegram presence |
| **DEPLOYER** | Wallet age, deployment history, rug count |
| **BUNDLE** | Same-block transactions, coordinated holder clusters |
| **HOLDERS** | Concentration risk, whale distribution, holder count |
| **TRADING** | Buy/sell ratio, wash trading indicators |
| **STRUCTURAL** | Token age, liquidity depth, volume/liquidity ratio |
| **PRICE_CRASH** | 24h price drops indicating dumps or rugs |
| **SELL_PRESSURE** | Sell-heavy trading patterns on new tokens |
| **COMBO_RISK** | Multiple moderate flags compounding simultaneously |

### 4.2 Risk Guardrails

Hard-coded minimum scores that override AI analysis, applied deterministically after the AI generates its base score:

#### Price Crash Guardrails (Highest Priority)

| Condition | Minimum Score |
|-----------|---------------|
| Price crashed >80% in 24h | 75 (SCAM) |
| Price dropped >50% in 24h | 65 (DANGEROUS) |
| Price dropped >30% in 24h | 55 (SUSPICIOUS) |

#### Structural Guardrails

| Condition | Minimum Score |
|-----------|---------------|
| $0 liquidity | 70 (DANGEROUS) |
| Token < 6h old AND liquidity < $10K | 55 (SUSPICIOUS) |
| Token < 24h old AND liquidity < $5K | 55 (SUSPICIOUS) |
| Token < 6h old (any liquidity) | 50 (SUSPICIOUS) |
| Token < 24h old (any liquidity) | 40 (SAFE) |
| Liquidity < $5K (any age) | 50 (SUSPICIOUS) |
| Volume/Liquidity > 8x on token < 24h | 50 (SUSPICIOUS) |

#### Sell Pressure Guardrails

| Condition | Minimum Score |
|-----------|---------------|
| Buy ratio < 0.7, >100 sells, token < 24h | 60 (DANGEROUS) |
| Buy ratio < 0.5, >50 sells | 55 (SUSPICIOUS) |

#### Low Holder Count

| Condition | Minimum Score |
|-----------|---------------|
| < 25 holders on < 6h token | 55 (SUSPICIOUS) |

#### Combo Signal Escalation

When multiple moderate risk signals are detected simultaneously, compound risk is enforced:

| Condition | Minimum Score |
|-----------|---------------|
| 4+ combined risk signals | 65 (DANGEROUS) |
| 3+ combined risk signals | 60 (DANGEROUS) |

Risk signals counted: token age < 6h, liquidity < $10K, sells > buys, low holders, bundles detected, new/unknown creator wallet, price crash > 30%.

### 4.3 Score Caps (Established Tokens)

Established tokens receive lower maximum risk scores:

- $100M+ market cap, 30+ days old: Max score 35
- $50M+ market cap, 14+ days old: Max score 45
- $10M+ market cap, 7+ days old: Max score 55

### 4.4 Price Crash Detection

Tokens that have already crashed are flagged regardless of other signals:

| Price Drop (24h) | Minimum Score | Severity |
|------------------|---------------|----------|
| > 80% | 75 (SCAM) | CRITICAL |
| > 50% | 65 (DANGEROUS) | HIGH |
| > 30% | 55 (SUSPICIOUS) | MEDIUM |

A revoked mint authority does not offset a price crash — the rug has already happened.

### 4.5 Sell Pressure Detection

Abnormal sell-to-buy ratios on new tokens indicate dump risk:

- Buy ratio < 0.7 with >100 sells on a <24h token: minimum score 60
- Buy ratio < 0.5 with >50 sells: minimum score 55

### 4.6 Combo Signal Escalation

When multiple moderate risk signals appear simultaneously, compound risk is enforced. Seven signals are tracked: token age < 6h, liquidity < $10K, sells > buys, low holders (< 30), bundles detected, new/unknown creator wallet, and price crash > 30%.

- 4+ signals: minimum score 65 (DANGEROUS)
- 3+ signals: minimum score 60 (DANGEROUS)

This prevents tokens with several "yellow flags" from receiving a clean score.

### 4.7 Anti-Hallucination Safeguards

The AI engine includes strict guardrails:
- Only cites data explicitly present in context
- Reports "UNKNOWN" for missing data instead of inventing values
- All guardrails are enforced deterministically (not AI-dependent)
- Validated against actual on-chain data
- Fallback heuristic scoring activates when AI API fails, applying the same guardrails

---

## 5. Bundle Detection

### 5.1 The Problem

Coordinated wallet networks are invisible to standard tools. A token can appear to have healthy, distributed holders while in reality a single actor controls 30%+ of supply through multiple wallets.

### 5.2 Detection Algorithm

1. Fetch top 20 holder addresses and balances via Helius RPC
2. Resolve token account owners and exclude known LP/bonding curve addresses
3. Fetch transaction signatures for non-LP holders
4. **Same-block detection:** Identify wallets that purchased tokens in the same block (HIGH confidence)
5. **Holder pattern analysis:** Group wallets with similar holdings for additional pattern matching
6. Assign confidence levels: HIGH (same-block transactions), MEDIUM (holder pattern), LOW, NONE
7. Calculate total bundle percentage of supply and wallet count

### 5.3 Bundle Scoring Impact

- HIGH confidence bundle: minimum risk score 55
- MEDIUM confidence bundle: minimum risk score 50
- Bundle + active mint/freeze authority + new wallet ("triple threat"): minimum risk score 60
- AI verdict explicitly warns about detected bundles with confidence level

---

## 6. Technical Architecture

### 6.1 The Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Dashboard** | React + Vite | Token research UI, position tracking |
| **Scanner** | Node.js + Hono | Token detection, WebSocket server |
| **API** | Cloudflare Workers | Production analysis endpoint |
| **AI Engine** | Together AI / Groq | Risk scoring, written analysis |
| **Token Discovery** | Helius WebSocket | Real-time pool creation (Raydium, Meteora) |
| **Market Data** | DexScreener API | Price, volume, liquidity, trending |
| **On-Chain Data** | Helius RPC | Holders, authorities, transaction history |
| **Trading** | Jupiter API | Swap execution, best price routing |

### 6.2 Data Flow

```
User pastes token address
       |
       v
+-------------+
|   Argus     | --> POST /sentinel/analyze
|  Dashboard  |
+------+------+
       |
       v
+-------------+
| Workers API | --> DexScreener (price, volume, txns)
|  /sentinel  | --> Helius RPC (holders, security, txns)
|   /analyze  | --> Together AI (risk analysis)
+------+------+ --> Bundle detection (same-block analysis)
       |
       v
+-------------+
|   Display   | --> Security panel (mint/freeze, LP lock)
|  Analysis   | --> Market data (price, MC, liquidity, volume)
|   Results   | --> Trading activity (buys/sells, ratio)
+------+------+ --> Holder distribution (bar chart + bundles)
       |        --> AI verdict (signal, score, reasoning)
       v
+-------------+
|  Buy/Sell   | --> Jupiter swap execution
|   Action    | --> Position tracking + auto-sell
+-------------+
```

### 6.3 Auto-Sell System

Automated position protection runs in a 10-second monitoring loop:

- **Take Profit:** Sell when position gains reach target (50%, 100%, 200%, 500%)
- **Stop Loss:** Exit when loss exceeds threshold (20%, 30%, 50%, 70%)
- **Trailing Stop:** Sell when price drops from peak by threshold (10%, 20%, 30%)

### 6.4 Feature Compression (17,000x)

Raw token analysis data is compressed into 116-byte feature vectors for efficient storage and pattern matching:

| Category | Features | Description |
|----------|----------|-------------|
| **Market (5)** | liquidityLog, volumeToLiquidity, marketCapLog, priceVelocity, volumeLog | Price and liquidity metrics |
| **Holders (6)** | holderCountLog, top10Concentration, giniCoefficient, freshWalletRatio, whaleCount, topWhalePercent | Distribution analysis |
| **Security (4)** | mintDisabled, freezeDisabled, lpLocked, lpBurned | Authority checks |
| **Bundle (5)** | bundleDetected, bundleCountNorm, bundleControlPercent, bundleConfidence, bundleQuality | Coordination detection |
| **Trading (4)** | buyRatio24h, buyRatio1h, activityLevel, momentum | Buy/sell patterns |
| **Time (2)** | ageDecay, tradingRecency | Temporal signals |
| **Creator (3)** | creatorIdentified, creatorRugHistory, creatorHoldings | Developer risk |

**Compression Result:** 2MB raw data → 116 bytes (Float32Array of 29 dimensions)

### 6.5 BitNet 1-bit AI

The risk classification engine uses quantized weights for edge-native inference:

- **Ternary Weights:** -1, 0, +1 instead of 32-bit floats (20x smaller models)
- **Inference Time:** 13ms on CPU (no GPU required)
- **Monthly Cost:** $0 (no cloud AI APIs for classification)
- **Deployment:** Runs directly on Cloudflare Workers

### 6.6 Multi-Agent Swarm

Four autonomous AI agents coordinate via pub/sub MessageBus:

| Agent | Role | Capabilities |
|-------|------|--------------|
| **Scout** | Mempool Patrol | Monitors new launches, extracts 29-feature vectors in <100ms |
| **Analyst** | Deep Investigation | Fetches top 50 holders, traces funding sources, builds threat profiles |
| **Hunter** | Network Tracker | Maintains scammer database, alerts on repeat offenders |
| **Trader** | Position Guardian | Executes trades with stop-loss, take-profit, trailing stops |

### 6.7 Origin Vault

The trading wallet uses cross-origin key isolation for security:

- **Separate Domain:** Private keys stored on `secure.argusguard.io`
- **Main App:** UI and trading logic on `app.argusguard.io`
- **Communication:** postMessage only (never exposes raw keys)
- **Protection:** Immune to XSS, malicious extensions, supply chain attacks

This is the **first trading tool** with this architecture, enabling fully autonomous trading without wallet popups.

---

## 7. Tokenomics

### 7.1 Token Details

- **Name:** $ARGUS
- **Chain:** Solana (SPL)
- **Total Supply:** 1,000,000,000
- **Buy/Sell Tax:** 0%
- **Mint Authority:** Revoked
- **LP:** 100% Locked

### 7.2 Distribution

| Allocation | Percentage | Purpose |
|------------|------------|---------|
| Community | 50% | Public distribution |
| Liquidity | 25% | DEX liquidity pools |
| Development | 15% | Platform development |
| Team | 10% | Core team allocation |

### 7.3 Utility

- **Premium Features:** Advanced analytics, unlimited scans, priority support
- **Revenue Share:** Holders earn from platform trading fees
- **Governance:** Vote on protocol upgrades and feature priorities

### 7.4 Revenue Model

- **0.5% Trading Fee:** Applied on trades executed through the platform
- **Fee Distribution:** Supports development and holder rewards

---

## 8. Roadmap

### Phase 1: Foundation (Q1 2026) -- COMPLETE
- Bundle detection with same-block transaction analysis (HIGH/MEDIUM confidence)
- AI-powered risk analysis (Together AI + Groq)
- Security analysis (mint/freeze authority, LP lock)
- One-click trading via Jupiter
- Auto-sell protection (take profit, stop loss, trailing stop)
- Position tracking with P&L
- Dedicated trading wallet
- Deterministic risk guardrails (price crash, sell pressure, combo signals)
- Creator wallet tracking and blacklisting

### Phase 2: Token Launch (Q1 2026) -- CURRENT
- $ARGUS token launch
- Wallet tracking features
- Price alerts
- Enhanced swap error handling
- Live market cap ticker on landing page

### Phase 3: Expansion (Q2 2026)
- Mobile app
- Advanced bundle detection models
- Multi-chain support
- DAO governance

### Phase 4: Enterprise (Q3 2026)
- Enterprise features
- API access for third-party integrations
- Advanced portfolio analytics
- Institutional risk reporting

---

## 9. Conclusion

The Solana ecosystem is a financial engine room, but it operates in the dark. Retail traders use five separate tools to research one token, losing precious seconds while insiders dump.

**Argus AI turns on the lights.**

By combining AI analysis, bundle detection, security checks, and one-click trading in a single interface, we compress the entire research-to-trade pipeline into seconds. No more tab-hopping between RugCheck, DexScreener, Bubble Maps, a DEX, and a price tracker.

**Argus is not just a tool. It is the Research-to-Trade standard.**

---

## Infrastructure

### Self-Hosted Solana Infrastructure

Argus runs on dedicated Hetzner infrastructure with zero third-party RPC dependencies:

| Server | Purpose | Cost |
|--------|---------|------|
| **RPC Node** | All Solana RPC calls | $0/month (self-hosted) |
| **Agents Server** | Multi-agent AI system + PostgreSQL | $0/month (self-hosted) |
| **Yellowstone Node** | Real-time Geyser streaming | $0/month (self-hosted) |

This eliminates:
- Helius RPC costs ($0 vs $500+/month at scale)
- Rate limiting from third-party providers
- Single points of failure

## Data Sources

| Data | Source | Cost |
|------|--------|------|
| RPC Calls | Self-hosted Solana node | $0 |
| Price, Volume, Liquidity, Market Cap | DexScreener API | FREE |
| Buy/Sell Counts, Trading Activity | DexScreener API | FREE |
| Creator Detection (optional) | Helius DAS API | Optional |
| AI Risk Analysis | BitNet + Self-hosted LLM (DeepSeek, Qwen) | $0 |
| Swap Execution | Jupiter API | FREE |
| Real-time Streaming | Yellowstone/Geyser | $0 (self-hosted) |

---

## Disclaimer

*Argus AI is a software tool designed for educational and informational purposes only. It does not guarantee safety, and users should always perform their own due diligence (DYOR). Argus AI is not responsible for any financial losses incurred while trading. The $ARGUS token is a utility token with no implied promise of profit or financial return.*

**Copyright 2026 Argus AI.**
