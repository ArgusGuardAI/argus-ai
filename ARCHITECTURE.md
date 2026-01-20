# ArgusGuard Architecture

Technical architecture documentation for the ArgusGuard security platform.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    ArgusGuard Extension (Plasmo)                    │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │Content Script│  │    Popup     │  │   Background Service     │  │    │
│  │  │ (DOM Inject) │  │  (Wallet UI) │  │   (RPC, Storage)         │  │    │
│  │  └──────┬───────┘  └──────────────┘  └──────────────────────────┘  │    │
│  └─────────┼───────────────────────────────────────────────────────────┘    │
└────────────┼────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE EDGE NETWORK                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Workers API (Hono Router)                         │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │    │
│  │  │  /analyze   │  │  /graffiti  │  │   /health   │                  │    │
│  │  └──────┬──────┘  └─────────────┘  └─────────────┘                  │    │
│  │         │                                                            │    │
│  │  ┌──────┴──────────────────────────────────────────────────────┐    │    │
│  │  │                    Analysis Engine                           │    │    │
│  │  │  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │    │    │
│  │  │  │Data Fetcher│  │AI Analyzer │  │ Hardcoded Rules Engine │ │    │    │
│  │  │  └─────┬──────┘  └─────┬──────┘  └────────────────────────┘ │    │    │
│  │  └────────┼───────────────┼────────────────────────────────────┘    │    │
│  │           │               │                                          │    │
│  │  ┌────────┴───────┐  ┌────┴────┐                                    │    │
│  │  │   KV Cache     │  │Supabase │                                    │    │
│  │  │ (1hr TTL)      │  │  (DB)   │                                    │    │
│  │  └────────────────┘  └─────────┘                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL DATA SOURCES                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ DexScreener │  │   Helius    │  │  Pump.fun   │  │ Together AI │        │
│  │  (Market)   │  │ (On-chain)  │  │ (Bonding)   │  │    (LLM)    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Analysis Pipeline

```
                              Token Address Input
                                      │
                                      ▼
                          ┌───────────────────────┐
                          │   Check KV Cache      │
                          └───────────┬───────────┘
                                      │
                         ┌────────────┴────────────┐
                         │                         │
                    Cache Hit                 Cache Miss
                         │                         │
                         ▼                         ▼
                  Return Cached          ┌─────────────────┐
                    Result               │ PHASE 1: Fetch  │
                                         │  Market Data    │
                                         └────────┬────────┘
                                                  │
                          ┌───────────────────────┼───────────────────────┐
                          │                       │                       │
                          ▼                       ▼                       ▼
                   ┌────────────┐          ┌────────────┐          ┌────────────┐
                   │DexScreener │          │  Pump.fun  │          │  Helius    │
                   │  - Price   │          │ - Bonding  │          │ - Metadata │
                   │  - Volume  │          │ - Creator  │          │ - Auth     │
                   │  - Age     │          │ - Reserves │          │ - Supply   │
                   └─────┬──────┘          └─────┬──────┘          └─────┬──────┘
                         │                       │                       │
                         └───────────────────────┴───────────────────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │ PHASE 2: Fetch  │
                                         │  On-chain Data  │
                                         └────────┬────────┘
                                                  │
                          ┌───────────────────────┼───────────────────────┐
                          │                       │                       │
                          ▼                       ▼                       ▼
                   ┌────────────┐          ┌────────────┐          ┌────────────┐
                   │  Holder    │          │  Creator   │          │Transaction │
                   │  Analysis  │          │  History   │          │  Analysis  │
                   │ - Top 10   │          │ - Rug count│          │ - Bundles  │
                   │ - Non-LP % │          │ - Age      │          │ - Patterns │
                   └─────┬──────┘          └─────┬──────┘          └─────┬──────┘
                         │                       │                       │
                         └───────────────────────┴───────────────────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │ PHASE 3: Build  │
                                         │ Context String  │
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │ PHASE 4: AI     │
                                         │   Analysis      │
                                         │  (Together AI)  │
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │ PHASE 5: Apply  │
                                         │ Hardcoded Rules │
                                         │  (Caps, Mins)   │
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │ PHASE 6: Cache  │
                                         │   & Return      │
                                         └─────────────────┘
```

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           PUMP.FUN / DEXSCREENER                          │
│                                                                          │
│   User visits token page ───────────────────────────────────────┐        │
│                                                                  │        │
└──────────────────────────────────────────────────────────────────┼────────┘
                                                                   │
                                                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           BROWSER EXTENSION                               │
│                                                                          │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│   │  Content Script │───▶│ Extract Token   │───▶│ Check Wallet    │     │
│   │   (Injected)    │    │    Address      │    │  Balance (RPC)  │     │
│   └─────────────────┘    └─────────────────┘    └────────┬────────┘     │
│                                                          │               │
│                                                 ┌────────┴────────┐      │
│                                                 │                 │      │
│                                            < 1000            >= 1000     │
│                                            tokens            tokens      │
│                                                 │                 │      │
│                                                 ▼                 ▼      │
│                                          ┌──────────┐     ┌──────────┐  │
│                                          │Gray Mode │     │ Request  │  │
│                                          │(Disabled)│     │ Analysis │  │
│                                          └──────────┘     └─────┬────┘  │
│                                                                 │       │
└─────────────────────────────────────────────────────────────────┼───────┘
                                                                  │
                                                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           CLOUDFLARE WORKERS                              │
│                                                                          │
│   POST /analyze { tokenAddress: "...", forceRefresh: false }            │
│                                    │                                     │
│                                    ▼                                     │
│                          ┌─────────────────┐                            │
│                          │   KV Cache      │                            │
│                          │   Lookup        │                            │
│                          └────────┬────────┘                            │
│                                   │                                      │
│                     ┌─────────────┴─────────────┐                       │
│                     │                           │                       │
│                Cache Hit                   Cache Miss                   │
│                     │                           │                       │
│                     ▼                           ▼                       │
│              Return JSON              ┌─────────────────┐               │
│                                       │  Full Analysis  │               │
│                                       │    Pipeline     │               │
│                                       └────────┬────────┘               │
│                                                │                        │
│                                                ▼                        │
│                                       ┌─────────────────┐               │
│                                       │  Cache Result   │               │
│                                       │  (KV + Supabase)│               │
│                                       └────────┬────────┘               │
│                                                │                        │
└────────────────────────────────────────────────┼────────────────────────┘
                                                 │
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           BROWSER EXTENSION                               │
│                                                                          │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│   │ Receive Result  │───▶│ Determine Paint │───▶│ Inject Overlay  │     │
│   │    (JSON)       │    │    Color        │    │   into DOM      │     │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘     │
│                                                                          │
│   Paint Colors:                                                          │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                           │
│   │ GREEN  │ │ YELLOW │ │ ORANGE │ │  RED   │                           │
│   │ 0-49   │ │ 50-69  │ │ 70-89  │ │ 90-100 │                           │
│   │ SAFE   │ │SUSPICI-│ │DANGER- │ │ SCAM   │                           │
│   │        │ │  OUS   │ │  OUS   │ │        │                           │
│   └────────┘ └────────┘ └────────┘ └────────┘                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Service Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        WORKERS API (analyze.ts)                          │
└─────────────────────────────────────────────────────────────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐
│  dexscreener.ts │ │ pumpfun.ts  │ │  helius.ts  │ │ together-ai.ts  │
│                 │ │             │ │             │ │                 │
│ fetchDexScreen- │ │fetchPumpFun-│ │fetchHelius- │ │analyzeForHoney- │
│ erData()        │ │Data()       │ │TokenMeta-   │ │pot()            │
│                 │ │             │ │data()       │ │                 │
│ buildMarket-    │ │buildPumpFun-│ │             │ │parseAIResponse()│
│ Context()       │ │Context()    │ │analyzeCrea- │ │                 │
│                 │ │             │ │torWallet()  │ │callTogetherAI() │
│                 │ │isPumpFun-   │ │             │ │                 │
│                 │ │Token()      │ │analyzeToken-│ │                 │
│                 │ │             │ │Transactions │ │                 │
│                 │ │             │ │()           │ │                 │
│                 │ │             │ │             │ │                 │
│                 │ │             │ │buildHelius- │ │                 │
│                 │ │             │ │Context()    │ │                 │
└────────┬────────┘ └──────┬──────┘ └──────┬──────┘ └────────┬────────┘
         │                 │               │                  │
         ▼                 ▼               ▼                  ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐
│  DexScreener    │ │  Pump.fun   │ │   Helius    │ │   Together AI   │
│     API         │ │    API      │ │   DAS API   │ │      API        │
│                 │ │             │ │             │ │                 │
│ api.dexscreener │ │frontend-api │ │ mainnet.    │ │ api.together.   │
│ .com/latest/dex │ │.pump.fun    │ │ helius-rpc  │ │ xyz/v1/chat     │
└─────────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘
```

---

## Risk Scoring Logic

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI ANALYSIS (Together AI)                        │
│                                                                          │
│   Context String ─────▶ System Prompt ─────▶ JSON Response              │
│                                                                          │
│   Output:                                                                │
│   {                                                                      │
│     risk_score: 0-100,                                                  │
│     risk_level: "SAFE|SUSPICIOUS|DANGEROUS|SCAM",                       │
│     confidence: 0-100,                                                  │
│     flags: [...],                                                       │
│     summary: "..."                                                      │
│   }                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    HARDCODED RULES ENGINE (analyze.ts)                   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                      SCORE ADJUSTMENTS                           │   │
│   │                                                                  │   │
│   │  Creator has rugs?  ────▶  min score 70-95                      │   │
│   │  Brand new wallet?  ────▶  min score 65                         │   │
│   │  Token age < 1 day? ────▶  min score 50-60                      │   │
│   │  Zero liquidity?    ────▶  min score 90                         │   │
│   │  Low liquidity?     ────▶  min score 70-80                      │   │
│   │  Mint authority?    ────▶  min score 50                         │   │
│   │  Freeze authority?  ────▶  min score 55                         │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                        SCORE CAPS                                │   │
│   │                                                                  │   │
│   │  $100M+ MC, 30+ days, no rugs  ────▶  max score 35              │   │
│   │  $50M+ MC, 14+ days, no rugs   ────▶  max score 45              │   │
│   │  $10M+ MC, 7+ days, no rugs    ────▶  max score 55              │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FINAL RISK LEVEL                               │
│                                                                          │
│   Score >= 90  ─────▶  SCAM       (Red)                                 │
│   Score >= 70  ─────▶  DANGEROUS  (Orange)                              │
│   Score >= 50  ─────▶  SUSPICIOUS (Yellow)                              │
│   Score < 50   ─────▶  SAFE       (Green)                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              SUPABASE                                    │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        graffiti_notes                              │  │
│  ├───────────────┬─────────────┬─────────────────────────────────────┤  │
│  │ Column        │ Type        │ Description                         │  │
│  ├───────────────┼─────────────┼─────────────────────────────────────┤  │
│  │ id            │ UUID (PK)   │ Unique note identifier              │  │
│  │ token_address │ TEXT        │ Solana token mint address           │  │
│  │ author_wallet │ TEXT        │ Note author's wallet address        │  │
│  │ content       │ TEXT        │ Note content (encrypted)            │  │
│  │ note_type     │ ENUM        │ WARNING | INFO | POSITIVE           │  │
│  │ upvotes       │ INTEGER     │ Community upvote count              │  │
│  │ downvotes     │ INTEGER     │ Community downvote count            │  │
│  │ created_at    │ TIMESTAMPTZ │ Note creation timestamp             │  │
│  └───────────────┴─────────────┴─────────────────────────────────────┘  │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        scan_results                                │  │
│  ├───────────────┬─────────────┬─────────────────────────────────────┤  │
│  │ Column        │ Type        │ Description                         │  │
│  ├───────────────┼─────────────┼─────────────────────────────────────┤  │
│  │ token_address │ TEXT (PK)   │ Solana token mint address           │  │
│  │ risk_score    │ INTEGER     │ 0-100 risk score                    │  │
│  │ risk_level    │ TEXT        │ SAFE|SUSPICIOUS|DANGEROUS|SCAM      │  │
│  │ flags         │ JSONB       │ Array of risk flags                 │  │
│  │ summary       │ TEXT        │ AI-generated summary                │  │
│  │ checked_at    │ TIMESTAMPTZ │ Last analysis timestamp             │  │
│  └───────────────┴─────────────┴─────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           CLOUDFLARE KV                                  │
│                                                                          │
│  Namespace: SCAN_CACHE                                                  │
│  Key Format: scan:{token_address}                                       │
│  TTL: 3600 seconds (1 hour)                                             │
│  Value: JSON (HoneypotResult)                                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Security Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          TOKEN GATING                                    │
│                                                                          │
│   User Wallet ────▶ RPC Balance Check ────▶ >= 1000 $ARGUSGUARD?       │
│                                                    │                     │
│                                         ┌─────────┴─────────┐           │
│                                         │                   │           │
│                                        YES                  NO          │
│                                         │                   │           │
│                                         ▼                   ▼           │
│                                   ┌──────────┐        ┌──────────┐     │
│                                   │  Shield  │        │   Gray   │     │
│                                   │  Active  │        │   Mode   │     │
│                                   │          │        │          │     │
│                                   │- Analysis│        │- Limited │     │
│                                   │- Graffiti│        │- No notes│     │
│                                   │- History │        │- No paint│     │
│                                   └──────────┘        └──────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Plasmo + React | Browser extension framework |
| Styling | Tailwind CSS | UI styling |
| API Gateway | Cloudflare Workers | Serverless edge compute |
| Router | Hono | Lightweight web framework |
| AI | Together AI | LLM inference |
| On-chain Data | Helius | Solana RPC + DAS API |
| Market Data | DexScreener | Price, volume, liquidity |
| Database | Supabase (Postgres) | Persistent storage |
| Cache | Cloudflare KV | Edge caching |
| Monorepo | pnpm workspaces | Package management |
| Language | TypeScript | Type safety |
