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

Powered by **Groq** (primary, free) and **Together AI** (fallback) with on-chain data from Helius.

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

- Analyzes top 10 token holders
- Groups wallets with similar holdings (within 1% threshold)
- Flags clusters of 3+ wallets as "bundles"
- Displays total bundle percentage and wallet count
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
| **BUNDLE** | Coordinated holder clusters |
| **HOLDERS** | Concentration risk, whale distribution |
| **TRADING** | Buy/sell ratio, wash trading indicators |
| **STRUCTURAL** | Token age, liquidity depth, volume/liquidity ratio |

### 4.2 Structural Risk Guardrails

Hard-coded minimum scores that override AI analysis:

| Condition | Minimum Score |
|-----------|---------------|
| Token < 6h old AND liquidity < $10K | 50 (WATCH) |
| Token < 24h old AND liquidity < $5K | 50 (WATCH) |
| Token < 6h old (any liquidity) | 35 (HOLD) |
| Liquidity < $5K (any age) | 40 (HOLD) |
| Volume/Liquidity > 8x on token < 24h | 45 (WATCH) |

### 4.3 Score Caps (Established Tokens)

Established tokens receive lower maximum risk scores:

- $100M+ market cap, 30+ days old: Max score 35
- $50M+ market cap, 14+ days old: Max score 45
- $10M+ market cap, 7+ days old: Max score 55

### 4.4 Anti-Hallucination Safeguards

The AI engine includes strict guardrails:
- Only cites data explicitly present in context
- Reports "UNKNOWN" for missing data instead of inventing values
- Structural risk is enforced deterministically (not AI-dependent)
- Validated against actual on-chain data

---

## 5. Bundle Detection

### 5.1 The Problem

Coordinated wallet networks are invisible to standard tools. A token can appear to have healthy, distributed holders while in reality a single actor controls 30%+ of supply through multiple wallets.

### 5.2 Detection Algorithm

1. Fetch top 10 holder addresses and percentages
2. Exclude known LP/bonding curve addresses
3. Compare remaining holder percentages pairwise
4. Group wallets with holdings within 1% of each other
5. Flag groups of 3+ wallets as a "bundle"
6. Calculate total bundle percentage of supply

### 5.3 Bundle Scoring Impact

- Bundle detected: +10 to risk score
- Bundle holding > 20% supply: +20 to risk score
- Multiple bundles: Additional +5 per extra bundle
- AI verdict explicitly warns about detected bundles

---

## 6. Technical Architecture

### 6.1 The Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Dashboard** | React + Vite | Token research UI, position tracking |
| **Scanner** | Node.js + Hono | Token detection, WebSocket server |
| **API** | Cloudflare Workers | Production analysis endpoint |
| **AI Engine** | Groq (free) / Together AI | Risk scoring, written analysis |
| **Token Discovery** | Helius WebSocket | Real-time pool creation (Raydium, Meteora) |
| **Market Data** | DexScreener API | Price, volume, liquidity, trending |
| **Security Data** | RugCheck API | Holder distribution, authorities |
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
|  /sentinel  | --> RugCheck (holders, security)
|   /analyze  | --> Groq/Together AI (risk analysis)
+------+------+ --> Bundle detection (coordinated wallets)
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
- Bundle detection system
- AI-powered risk analysis (Groq + Together AI)
- Security analysis (mint/freeze authority, LP lock)
- One-click trading via Jupiter
- Auto-sell protection (take profit, stop loss, trailing stop)
- Position tracking with P&L
- Dedicated trading wallet
- Structural risk guardrails

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

## Data Sources (All FREE)

| Data | Source | Cost |
|------|--------|------|
| Price, Volume, Liquidity, Market Cap | DexScreener API | FREE |
| Buy/Sell Counts, Trading Activity | DexScreener API | FREE |
| Mint/Freeze Authority, LP Lock | RugCheck API | FREE |
| Top 10 Holders | RugCheck API | FREE |
| AI Risk Analysis | Groq API | FREE |
| AI Risk Analysis (fallback) | Together AI | Paid |
| Swap Execution | Jupiter API | FREE |
| Real-time Pool Detection | Helius WebSocket | Free tier |
| SOL Price | Jupiter / CoinGecko | FREE |

---

## Disclaimer

*Argus AI is a software tool designed for educational and informational purposes only. It does not guarantee safety, and users should always perform their own due diligence (DYOR). Argus AI is not responsible for any financial losses incurred while trading. The $ARGUS token is a utility token with no implied promise of profit or financial return.*

**Copyright 2026 Argus AI.**
