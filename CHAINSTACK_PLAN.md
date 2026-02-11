# Argus AI - Chainstack Infrastructure Plan

## Overview

This document outlines how Argus AI operates using Chainstack's infrastructure at $98/month, enabling 24/7 autonomous agent monitoring without running our own RPC node.

---

## Cost Summary

| Service | What It Does | Monthly Cost |
|---------|--------------|--------------|
| Chainstack Growth | RPC endpoint (20M requests) | $49 |
| Chainstack Yellowstone | gRPC streaming (real-time pools) | $49 |
| DexScreener API | Price, volume, market data | FREE |
| RugCheck API | Holders, security checks | FREE |
| Jupiter API | Swap quotes & transactions | FREE |
| BitNet (local) | Agent AI inference | FREE |
| Cloudflare Workers | API hosting | FREE tier |
| Cloudflare Pages | Frontend hosting | FREE tier |
| Hetzner agents server | Runs agents 24/7 | Already paying |
| **TOTAL** | | **$98/mo** |

---

## Part 1: Real-Time Pool Detection (Yellowstone gRPC)

**What happens:**
```
Chainstack Yellowstone Server
         │
         │ (persistent gRPC connection - stays open 24/7)
         │
         ▼
Your Monitor Process (on 46.XXX.X.XXX)
         │
         │ subscribed to program accounts:
         │   - Raydium: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK
         │   - Pump.fun: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
         │   - Orca: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
         │   - Meteora: LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
         │
         ▼
When Raydium creates a new pool, Chainstack PUSHES data to you
         │
         │ (you don't ask for it - it comes to you)
         │
         ▼
Monitor receives: "New pool created: token XYZ, mint ABC"
```

**Cost:** $49/mo flat. No per-message charge. Unlimited events pushed to you.

**Catch:** Limited to 50 accounts per stream. But program IDs count as 1 account each, so 4 DEX programs = 4 accounts. Plenty of room.

---

## Part 2: What Happens When a New Pool is Detected

```
Monitor receives new pool event
         │
         ▼
Extract token mint address from pool data
         │
         ▼
Scout Agent triggered via MessageBus
         │
         ├──▶ Call DexScreener API (FREE)
         │    GET https://api.dexscreener.com/latest/dex/tokens/{mint}
         │    Returns: price, volume, liquidity, market cap, pair address
         │
         ├──▶ Call RugCheck API (FREE)
         │    GET https://api.rugcheck.xyz/v1/tokens/{mint}/report
         │    Returns: top holders, mint authority, freeze authority, LP status
         │
         └──▶ If suspicious → Analyst Agent
                    │
                    ▼
              Analyst needs deeper data
                    │
                    ├──▶ getTokenLargestAccounts (Chainstack RPC - 1 request)
                    │    Returns: top 20 holders with balances
                    │
                    ├──▶ getTokenSupply (Chainstack RPC - 1 request)
                    │    Returns: total supply, decimals
                    │
                    └──▶ Bundle detection (pattern matching on holder data)
                               │
                               ▼
                         Risk Score Generated (BitNet - LOCAL)
                               │
                               ▼
                    If high risk → Hunter Agent
                               │
                               ├──▶ Check creator wallet against known scammers (PostgreSQL - FREE)
                               │
                               └──▶ If new scammer pattern → store in DB
```

**RPC calls per new pool:** ~5-10 calls
**Pools per day:** ~200
**Daily RPC usage:** ~2,000 calls
**Monthly RPC usage:** ~60,000 calls
**Growth plan limit:** 20,000,000 calls
**Usage:** 0.3%

---

## Part 3: User Analyzes a Token (Dashboard)

```
User visits app.argusguard.io
         │
         ▼
Pastes token address, clicks "Analyze"
         │
         ▼
Frontend calls Workers API
POST https://argusguard-api.workers.dev/sentinel/analyze
Body: { "tokenAddress": "..." }
         │
         ▼
Workers API (Cloudflare - FREE tier)
         │
         ├──▶ DexScreener API (FREE)
         │    Price, volume, liquidity, market cap
         │
         ├──▶ RugCheck API (FREE)
         │    Holders, security flags
         │
         ├──▶ Chainstack RPC (~5 calls)
         │    getTokenSupply, getTokenLargestAccounts
         │
         ├──▶ BitNet or Together AI
         │    Risk scoring
         │
         └──▶ Bundle detection (pattern matching)
                    │
                    ▼
              Return full analysis to frontend
                    │
                    ▼
              User sees results + can buy
```

**Cost per user scan:** ~5 RPC calls (fraction of a cent)

---

## Part 4: User Buys a Token

```
User clicks "Buy 0.1 SOL"
         │
         ▼
Frontend (tradingWallet.ts)
         │
         ├──▶ Creates unsigned swap transaction
         │    via Jupiter API (FREE)
         │
         └──▶ Sends to Vault iframe (secure.argusguard.io)
                    │
                    ▼
Vault signs transaction with stored private key
                    │
                    ▼
Signed transaction returned to frontend
                    │
                    ▼
Frontend submits to Solana via Chainstack RPC
         │
         ▼
Transaction confirmed
         │
         ▼
Position stored in localStorage + displayed
```

**Cost:** 1 RPC call (sendTransaction) + Solana network fee (~0.000005 SOL)

---

## Part 5: Agent Communication (MessageBus)

```
┌─────────────────────────────────────────────────────────────┐
│  All agents run in SAME Node.js process                     │
│                                                             │
│  Scout ──publish──▶ MessageBus ──subscribe──▶ Analyst       │
│                          │                                  │
│                          └──subscribe──▶ Hunter             │
│                          │                                  │
│                          └──subscribe──▶ Trader             │
│                                                             │
│  Message types:                                             │
│  - "token:suspicious" → Analyst picks up                    │
│  - "token:high_risk" → Hunter tracks creator                │
│  - "trade:opportunity" → Trader evaluates                   │
└─────────────────────────────────────────────────────────────┘
```

**Cost:** $0 - it's in-memory pub/sub, no external service

---

## Part 6: BitNet Local AI

The agents use BitNet for AI inference, not cloud APIs:

```
packages/agents/src/reasoning/BitNetEngine.ts
         │
         ├── 1-bit quantized weights (-1, 0, +1)
         ├── 29-dimensional feature vectors
         ├── Pattern matching via cosine similarity
         ├── Runs on CPU (no GPU needed)
         └── Inference time: ~13ms
```

**Where AI runs:**

| Component | AI Engine | Cost |
|-----------|-----------|------|
| Agents (Scout, Analyst, Hunter, Trader) | **BitNet** (local) | $0 |
| Dashboard user analysis | BitNet or Together AI | $0 or ~$0.0001/call |

---

## Part 7: What's the Catch?

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| 50 accounts per Yellowstone stream | Can only watch 50 program/accounts | 4 DEX programs = 4 accounts, plenty |
| 20M RPC requests/month | Heavy queries could hit limit | DexScreener/RugCheck handle most data |
| 250 req/sec rate limit | Burst traffic could throttle | Agents don't burst, they process sequentially |
| Yellowstone = mainnet only | No devnet testing | Test with RPC, deploy with Yellowstone |
| gRPC requires always-on connection | If connection drops, miss events | Reconnect logic + historical replay (3000 slots) |

---

## Part 8: What You CAN'T Do

1. **Full wallet network mapping** - Tracking every transaction of every wallet forever. Too many RPC calls.

2. **Historical backfill** - Yellowstone only replays last 3000 slots (~20 min). No "analyze all pools from last month."

3. **Infinite autonomous scanning** - You react to events, you don't poll everything.

4. **Run your own validator** - That's $2,900+/mo with Triton or massive hardware.

---

## Part 9: What You CAN Do

1. **24/7 new pool detection** - Every new Raydium/Pump.fun/Orca/Meteora pool triggers your agents

2. **Instant risk analysis** - DexScreener + RugCheck + pattern matching in <2 seconds

3. **Scammer tracking** - Store known scammers in PostgreSQL, alert when they launch new tokens

4. **User dashboard** - Full token analysis on demand

5. **One-click trading** - Jupiter swaps with Vault security

6. **Telegram alerts** - Push notifications for high-risk launches

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CHAINSTACK ($98/mo)                            │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐   │
│  │   Solana RPC Endpoint       │  │   Yellowstone gRPC Stream           │   │
│  │   (20M requests/month)      │  │   (unlimited events pushed)         │   │
│  └──────────────┬──────────────┘  └──────────────────┬──────────────────┘   │
└─────────────────┼────────────────────────────────────┼──────────────────────┘
                  │                                    │
                  │                                    │ persistent connection
                  ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AGENTS SERVER (46.XXX.X.XXX)                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Monitor Process                              │   │
│  │                   (Yellowstone gRPC subscriber)                      │   │
│  └─────────────────────────────────┬───────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          MessageBus                                  │   │
│  └───────┬───────────┬───────────┬───────────┬─────────────────────────┘   │
│          │           │           │           │                              │
│          ▼           ▼           ▼           ▼                              │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐                   │
│  │   Scout   │ │  Analyst  │ │  Hunter   │ │  Trader   │                   │
│  │   Agent   │ │   Agent   │ │   Agent   │ │   Agent   │                   │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘                   │
│        │             │             │             │                          │
│        └─────────────┴──────┬──────┴─────────────┘                          │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      BitNet Engine (LOCAL AI)                        │   │
│  │              1-bit quantized, 29 features, 13ms inference            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    PostgreSQL (pattern storage)                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FREE EXTERNAL APIs                                │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │   DexScreener   │  │    RugCheck     │  │    Jupiter      │             │
│  │   (prices)      │  │   (holders)     │  │    (swaps)      │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE (FREE TIER)                                 │
│                                                                             │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐   │
│  │   Workers API               │  │   Pages (Frontend)                  │   │
│  │   /sentinel/analyze         │  │   app.argusguard.io                 │   │
│  │   /agents/*                 │  │   argusguard.io                     │   │
│  └─────────────────────────────┘  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Request Budget Analysis

**Growth Plan: 20,000,000 requests/month**

| Source | Requests/Day | Requests/Month | % of Limit |
|--------|--------------|----------------|------------|
| Yellowstone pool detection | 0 (streaming) | 0 | 0% |
| Scout quick checks (200 pools × 10) | 2,000 | 60,000 | 0.3% |
| Analyst deep dives (100 × 10) | 1,000 | 30,000 | 0.15% |
| Hunter wallet tracking (50 wallets) | 200 | 6,000 | 0.03% |
| User scans (100 × 5) | 500 | 15,000 | 0.075% |
| Trading transactions | 100 | 3,000 | 0.015% |
| **TOTAL** | **~3,800** | **~114,000** | **0.57%** |

**Verdict:** Using less than 1% of available requests. Massive headroom.

---

## Next Steps

1. Create Chainstack account
2. Deploy Solana Global Node (Growth plan)
3. Enable Yellowstone gRPC add-on
4. Update agents server `.env` with Chainstack endpoints
5. Update monitor to use Yellowstone gRPC
6. Restart PM2 processes
7. Disable maintenance mode
8. Go live

---

## Configuration Changes Required

### Agents Server (.env)
```env
RPC_ENDPOINT=https://solana-mainnet.core.chainstack.com/YOUR_API_KEY
YELLOWSTONE_ENDPOINT=YOUR_CHAINSTACK_GRPC_ENDPOINT
YELLOWSTONE_TOKEN=YOUR_CHAINSTACK_TOKEN
```

### Workers API (wrangler secrets)
```bash
wrangler secret put SOLANA_RPC_URL
# Enter: https://solana-mainnet.core.chainstack.com/YOUR_API_KEY
```

### Monitor (Yellowstone connection)
```typescript
// Update to use Chainstack Yellowstone gRPC
const client = new YellowstoneClient({
  endpoint: process.env.YELLOWSTONE_ENDPOINT,
  token: process.env.YELLOWSTONE_TOKEN,
});
```
