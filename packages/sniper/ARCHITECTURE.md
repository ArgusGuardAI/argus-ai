# ArgusGuard Sniper Architecture

## Overview

A real-time token scanner that monitors Raydium, Meteora, and DexScreener for new tokens, filters them through AI analysis, and provides a WebSocket feed to the Argus trading dashboard.

## Core Differentiator

**Traditional Sniper:** Buys blindly at launch -> Gets rugged
**ArgusGuard Sniper:** Filter -> Analyze -> Buy only SAFE tokens -> Avoid rugs

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARGUS DASHBOARD (Frontend)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Token    │ │ Positions│ │ Settings │ │ Activity │           │
│  │ Feed     │ │ Manager  │ │ Panel    │ │ Log      │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket (ws://localhost:8788/ws)
┌─────────────────────────────────────────────────────────────────┐
│                     SNIPER ENGINE (Backend)                      │
│                                                                  │
│  ┌────────────────┐    ┌────────────────┐    ┌───────────────┐ │
│  │  Listeners     │───▶│   Filters      │───▶│  AI Analyzer  │ │
│  │                │    │                │    │               │ │
│  │ • Raydium      │    │ • LaunchFilter │    │ • Together AI │ │
│  │ • Meteora      │    │ • PreFilter    │    │ • Risk Score  │ │
│  │ • DexScreener  │    │ • SpamFilter   │    │ • Flags       │ │
│  └────────────────┘    └────────────────┘    └───────────────┘ │
│           │                    │                     │          │
│           ▼                    ▼                     ▼          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    WEBSOCKET BROADCAST                       ││
│  │         Real-time events to all connected clients           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA SOURCES                                │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Helius   │ │ Jupiter  │ │ CoinGecko│ │DexScreener│          │
│  │ WebSocket│ │ Price API│ │ Price API│ │ API      │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/sniper/
├── package.json
├── ARCHITECTURE.md        # This file
├── src/
│   ├── index.ts           # Exports for external use
│   ├── cli.ts             # CLI entry point
│   ├── server.ts          # HTTP/WebSocket server (Hono)
│   ├── types.ts           # TypeScript interfaces
│   │
│   ├── listeners/         # Token discovery sources
│   │   ├── raydium.ts     # Raydium AMM pool listener (Helius WS)
│   │   ├── meteora.ts     # Meteora DLMM/AMM listener (Helius WS)
│   │   └── dexscreener.ts # DexScreener trending/boosted scanner
│   │
│   ├── engine/            # Core processing logic
│   │   ├── sniper.ts      # Main orchestrator
│   │   ├── analyzer.ts    # AI risk analysis (Together AI)
│   │   ├── pre-filter.ts  # Fast checks for trending tokens
│   │   └── launch-filter.ts # Specialized filter for new pools
│   │
│   └── trading/           # Trade execution
│       └── executor.ts    # Jupiter swap integration
```

---

## Listeners

### Raydium Listener (`listeners/raydium.ts`)

Monitors Raydium AMM program for new pool creation via Helius WebSocket.

```typescript
// Program ID
const RAYDIUM_AMM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// Connection
wss://atlas-mainnet.helius-rpc.com?api-key={HELIUS_API_KEY}

// Subscription
{
  "jsonrpc": "2.0",
  "method": "transactionSubscribe",
  "params": [{
    "accountInclude": ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"]
  }]
}
```

**Detection:** Looks for `initialize2` instruction in transaction logs.

### Meteora Listener (`listeners/meteora.ts`)

Monitors Meteora DLMM and AMM programs for new pool creation.

```typescript
// Program IDs
const METEORA_DLMM_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const METEORA_AMM_PROGRAM = 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB';
```

**Detection:** Looks for `InitializeLbPair`, `initializePermissionlessPool`, or `initialize` instructions.

### DexScreener Listener (`listeners/dexscreener.ts`)

Polls DexScreener API for trending and boosted tokens.

```typescript
// Endpoints
GET https://api.dexscreener.com/token-boosts/latest/v1
GET https://api.dexscreener.com/token-profiles/latest/v1

// Poll interval: 30 seconds
```

**Detection:** Filters for Solana tokens matching criteria (market cap, age, buys).

---

## Filters

### Launch Filter (`engine/launch-filter.ts`)

Specialized filter for brand new pools (Raydium/Meteora) with no trading history.

**Checks:**

| Check | Criteria | Action |
|-------|----------|--------|
| Spam Filter | Name matches spam patterns | REJECT |
| Suspicious Patterns | Elon, moon, safe, etc. | FLAG (not reject) |
| Liquidity | $400 - $100,000 | REJECT if outside |
| Creator Reputation | >3 tokens in 24h | REJECT |
| Blacklist | Creator rugged before | REJECT |

**Spam Patterns:**
```typescript
const SPAM_PATTERNS = [
  /^test/i, /^aaa+/i, /^xxx/i, /^zzz/i,
  /^\d+$/, /^.{1,2}$/, /scam/i, /rug/i, /honeypot/i
];
```

**Creator Tracking:**
- Records tokens created per address
- Auto-blacklists on rug (>90% drop)
- Rejects if >3 tokens in 24 hours

### Pre-Filter (`engine/pre-filter.ts`)

Fast filter for DexScreener trending tokens (have trading history).

**Checks:**
- Market cap bounds ($5K - $500K)
- Minimum liquidity ($2K)
- Price change (not dumping >15%)
- Buy/sell ratio (buys > sells)
- Holder concentration

---

## AI Analysis (`engine/analyzer.ts`)

Uses Together AI (Llama 3.3 70B) to analyze token safety.

**Input Context:**
- Token metadata (name, symbol, supply)
- Market data (price, volume, liquidity)
- Holder distribution (top 10 wallets)
- Transaction patterns (buy/sell ratio)
- Creator history (previous tokens)

**Output:**
```typescript
interface AnalysisResult {
  riskScore: number;      // 0-100
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  flags: RiskFlag[];      // Specific risk indicators
  summary: string;        // Human-readable explanation
}
```

---

## Data Flow

### 1. New Pool Detection (Raydium/Meteora)

```
Helius WebSocket ──▶ Transaction Event
                            │
                            ▼
                    Parse Transaction
                            │
                            ▼
              ┌─────────────────────────┐
              │    Is Pool Creation?    │
              └─────────────────────────┘
                     │           │
                    Yes          No
                     │           │
                     ▼           ▼
             Extract Token    Ignore
                     │
                     ▼
              Launch Filter
                     │
            ┌────────┴────────┐
            ▼                 ▼
          PASS             REJECT
            │                 │
            ▼                 ▼
       AI Analysis         Log reason
            │
       ┌────┴────┐
       ▼         ▼
     SAFE     RISKY
       │         │
       ▼         ▼
   Broadcast   Skip
```

### 2. Trending Token Detection (DexScreener)

```
DexScreener API ──▶ Poll every 30s
                           │
                           ▼
                   Filter Solana tokens
                           │
                           ▼
                      Pre-Filter
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
                PASS             REJECT
                  │                 │
                  ▼                 ▼
             AI Analysis        Log reason
                  │
             ┌────┴────┐
             ▼         ▼
           SAFE     RISKY
             │         │
             ▼         ▼
         Broadcast   Skip
```

---

## WebSocket Events

### Server -> Client

```typescript
// New token discovered and analyzed
{
  type: 'NEW_TOKEN',
  data: {
    address: string;
    symbol: string;
    name: string;
    source: 'raydium' | 'meteora' | 'dexscreener-boost' | 'dexscreener-trending';
    marketCap: number;
    liquidity: number;
    analysis?: {
      riskScore: number;
      riskLevel: string;
      flags: RiskFlag[];
      summary: string;
    };
  }
}

// Statistics update
{
  type: 'STATS_UPDATE',
  data: {
    tokensAnalyzed: number;
    approved: number;
    rejected: number;
    aiApproved: number;
    aiRejected: number;
  }
}
```

### Client -> Server

```typescript
// Subscribe to events
{ type: 'SUBSCRIBE', channels: ['tokens', 'analysis'] }

// Request manual analysis
{ type: 'ANALYZE', tokenAddress: string }
```

---

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Scanner status and uptime |
| GET | `/api/stats` | Analysis statistics |
| POST | `/api/analyze` | Manual token analysis |
| GET | `/api/launch-filter/stats` | Launch filter statistics |
| POST | `/api/blacklist` | Add creator to blacklist |

---

## Configuration

### Environment Variables

```env
# Required
HELIUS_API_KEY=xxx           # Helius API key for WebSocket
TOGETHER_AI_API_KEY=xxx      # Together AI for analysis

# Optional
PORT=8788                    # Server port
WATCH_ONLY=true              # No trading, just analysis
```

### Launch Filter Config

```typescript
interface LaunchFilterConfig {
  minLiquiditySol: number;     // Min liquidity (default: 2 SOL)
  maxLiquiditySol: number;     // Max liquidity (default: 500 SOL)
  minLiquidityUsd: number;     // Min liquidity USD (default: $400)
  maxLiquidityUsd: number;     // Max liquidity USD (default: $100K)
  maxCreatorTokens: number;    // Max tokens per creator/24h (default: 3)
  autoBlacklistOnRug: boolean; // Auto-blacklist ruggers (default: true)
}
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js + Hono |
| WebSocket | ws |
| Blockchain | @solana/web3.js |
| AI | Together AI (Llama 3.3 70B) |
| Price Data | Jupiter, CoinGecko |
| Market Data | DexScreener |

---

## Security Considerations

1. **API Key Protection**
   - Never commit keys to git
   - Use environment variables
   - Rate limit API calls

2. **Creator Blacklisting**
   - Auto-blacklist on rug detection
   - Manual blacklist via API
   - Persisted in memory (reset on restart)

3. **Spam Prevention**
   - Pattern-based spam detection
   - Unusual character filtering
   - Long name filtering

4. **Liquidity Bounds**
   - Reject tokens with <$400 liquidity (too risky)
   - Reject tokens with >$100K liquidity (suspicious for new launch)
