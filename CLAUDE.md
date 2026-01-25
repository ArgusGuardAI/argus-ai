# CLAUDE.md

Development guidance for AI assistants working on the Solana Safeguard AI codebase.

---

## Project Overview

**Solana Safeguard AI** is an automated AI-powered trading system for Solana tokens. It scans new token launches on Raydium and Meteora in real-time, analyzes them for risk using AI, and automatically executes trades on approved tokens.

### Core Components
- **Argus** (`packages/argus`) - AI Trading Dashboard (React + Vite)
- **Sniper** (`packages/sniper`) - Token scanner and analysis backend
- **Workers** (`packages/workers`) - Cloudflare Workers API for analysis

### Key Features
- Real-time Raydium AMM pool detection (Helius WebSocket)
- Real-time Meteora DLMM pool detection (Helius WebSocket)
- DexScreener trending tokens (backup source)
- AI-powered risk analysis (0-100 score)
- Launch filter (spam detection, creator tracking, auto-blacklist)
- Fully automated trading with dedicated wallet
- Auto-sell: Take profit, stop loss, trailing stop
- Position tracking with P&L

---

## Architecture

```
packages/
├── argus/           # AI Trading Dashboard (React + Vite)
│   ├── src/App.tsx      # Main dashboard UI (3-column layout)
│   ├── src/hooks/       # useAutoTrade hook
│   └── src/lib/         # Jupiter swap, trading wallet
├── sniper/          # Token Scanner Backend
│   ├── src/listeners/   # Raydium, Meteora, DexScreener listeners
│   ├── src/engine/      # Sniper, analyzer, pre-filter, launch-filter
│   ├── src/trading/     # Trade executor
│   └── src/server.ts    # WebSocket server
└── workers/         # Cloudflare Workers API
    ├── src/routes/      # API endpoints
    └── src/services/    # Helius, DexScreener, Together AI
```

---

## Commands

```bash
# Development
pnpm install              # Install dependencies

# Argus (Trading Dashboard)
cd packages/argus
pnpm dev                  # Start dashboard at localhost:3000

# Sniper (Scanner Backend)
cd packages/sniper
pnpm dev                  # Start scanner at localhost:8788

# Workers (API)
cd packages/workers
pnpm dev                  # Start workers at localhost:8787
```

---

## Key Files

### Argus Package (`packages/argus/`)

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main dashboard with 3-column layout (sidebar, main, right panel) |
| `src/hooks/useAutoTrade.ts` | Core trading logic: buy, sell, position tracking |
| `src/lib/jupiter.ts` | Jupiter swap integration for buys/sells |
| `src/lib/tradingWallet.ts` | Dedicated trading wallet (encrypted localStorage) |

### Sniper Package (`packages/sniper/`)

| File | Purpose |
|------|---------|
| `src/server.ts` | WebSocket server, broadcasts token events |
| `src/engine/sniper.ts` | Main scanner engine, orchestrates all listeners |
| `src/engine/analyzer.ts` | AI risk analysis via Sentinel API |
| `src/engine/pre-filter.ts` | Pre-filtering for trending tokens (age, liquidity, etc.) |
| `src/engine/launch-filter.ts` | Launch filter for new pools (spam, creator tracking) |
| `src/listeners/raydium.ts` | Raydium AMM pool creation listener (Helius WebSocket) |
| `src/listeners/meteora.ts` | Meteora DLMM pool creation listener (Helius WebSocket) |
| `src/listeners/dexscreener.ts` | DexScreener trending/boosted tokens (backup) |

---

## Token Discovery Sources

### 1. Raydium Listener (Primary)
- Connects to Helius WebSocket
- Subscribes to Raydium AMM program: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- Detects new pool creation transactions (initialize2)
- Catches tokens at launch (second 0)

### 2. Meteora Listener (Primary)
- Connects to Helius WebSocket
- Subscribes to Meteora DLMM program: `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`
- Subscribes to Meteora AMM program: `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB`
- Catches DLMM pool creations at launch

### 3. DexScreener (Backup)
- Polls trending/boosted tokens every 60s
- Catches tokens that already have momentum
- Used as backup source when real-time listeners miss tokens

---

## Trading System

### Auto-Trade Flow (New Pools)
```
1. Raydium/Meteora detects new pool creation
2. Launch Filter checks:
   - Spam patterns in name/symbol
   - Liquidity bounds ($400 - $100K)
   - Creator reputation (blacklist, token count)
3. AI analyzes for risk score (0-100)
4. If score <= maxRiskScore AND auto-trade enabled:
   - Execute buy via Jupiter
   - Create position for tracking
5. Price monitoring loop (every 10s):
   - Check take profit condition
   - Check stop loss condition
   - Check trailing stop condition
6. Execute sell when condition met
7. If token rugs (>90% drop), auto-blacklist creator
```

### Auto-Trade Flow (Trending Tokens)
```
1. DexScreener detects trending/boosted token
2. Pre-filter checks:
   - Market cap bounds ($5K - $500K)
   - Buy count (min 10)
   - Sell ratio (not dumping)
   - Price trend (not crashing)
3. AI analyzes for risk score (0-100)
4. If approved, execute trade
```

### Trading Wallet
- Dedicated wallet stored encrypted in localStorage
- Signs transactions instantly (no popup confirmations)
- User's main wallet stays safe
- Can import/export private key

### Safety Limits
- `reserveBalanceSol` - Always keep minimum SOL
- `maxTradesPerSession` - Limit trades (0 = unlimited)
- `maxRiskScore` - Only trade low-risk tokens

### Auto-Sell Settings
- **Take Profit**: Sell when position up X%
- **Stop Loss**: Sell when position down X%
- **Trailing Stop**: Sell when drops X% from peak

---

## Launch Filter (New Pools)

The Launch Filter handles brand new pools from Raydium/Meteora that have no trading history.

### Spam Filter
Rejects tokens with names matching:
- `test`, `aaa`, `xxx`, `zzz`
- Pure numbers, 1-2 character names
- `scam`, `rug`, `honeypot`
- Offensive terms

### Suspicious Flags (warnings, not rejections)
- `elon`, `musk`, `trump`
- `moon`, `rocket`, `1000x`
- `safe`, `official`

### Creator Tracking
- Tracks tokens created per wallet (24h window)
- Rejects if creator launched >3 tokens in 24h
- Auto-blacklists creators when their tokens rug

### SOL Price
- Fetches real-time SOL price from Jupiter/CoinGecko
- Calculates accurate USD liquidity values

---

## Risk Analysis System

### Risk Levels
| Level | Score | Meaning |
|-------|-------|---------|
| SAFE | 0-49 | Low risk, tradeable |
| SUSPICIOUS | 50-69 | Caution |
| DANGEROUS | 70-89 | High risk |
| SCAM | 90-100 | Do not trade |

### Pre-Filter Checks (Trending Tokens)
- Token age (2-60 minutes)
- Liquidity ($5K - $500K)
- Market cap ($5K - $500K)
- Buy activity (min 10 buys)
- Sell ratio (20-90%)
- Holder concentration

---

## Data Flow

```
Raydium/Meteora (Helius WebSocket)
       │
       ▼ (instant)
┌─────────────┐
│   Sniper    │ ──▶ Launch Filter (spam, creator, liquidity)
│   Backend   │ ──▶ AI Analysis (risk score)
└──────┬──────┘
       │ WebSocket
       ▼
┌─────────────┐
│   Argus     │ ──▶ Display in Live Feed
│  Dashboard  │ ──▶ Auto-trade if approved
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Jupiter    │ ──▶ Execute swap
│    API      │ ──▶ Return signature
└─────────────┘
```

---

## Environment Variables

### Sniper (.env)
```env
HELIUS_API_KEY=          # Required for WebSocket listeners and RPC
TOGETHER_AI_API_KEY=     # Required for AI analysis
```

### Workers (.dev.vars)
```env
TOGETHER_AI_API_KEY=     # Required
HELIUS_API_KEY=          # Required
SUPABASE_URL=            # Optional
SUPABASE_ANON_KEY=       # Optional
```

---

## LocalStorage Keys

Argus stores data in browser localStorage:

| Key | Purpose |
|-----|---------|
| `argus_trading_wallet` | Encrypted trading wallet keypair |
| `argus_trading_state` | Positions, P&L, trade history |

---

## Dashboard UI

The Argus dashboard uses a 3-column layout with a light theme:

### Left Sidebar
- Logo (triangle + eye)
- Navigation: Dashboard, Positions, Settings
- Connection status

### Main Content
- Stats grid (Balance, Positions, P&L, Scanned)
- Token feed table (Token, Risk, Liquidity, Market Cap, Action)
- Positions table
- Settings panels

### Right Panel
- Auto-trade toggle
- Trading wallet card (black)
- Activity log

---

## Code Style

- TypeScript strict mode
- React functional components with hooks
- Tailwind CSS for styling (light theme)
- pnpm workspaces monorepo
- No emojis in code unless user requests

---

## Common Issues

### "Auto-trade disabled, skipping"
- Auto-trade toggle is OFF
- Enable in Dashboard or Settings

### No pools detected
- Raydium/Meteora listeners are connected but waiting
- Pool creations are sporadic (can be quiet for 10-15 minutes)
- Check logs for "WebSocket connected" and "Subscribed"

### Duplicate trades
- Fixed with triple protection:
  1. `isBuyingRef` - blocks during buy
  2. `tradedTokensRef` - tracks all attempts
  3. Position check - verifies no existing position

### Sell not working
- Check browser console for errors
- May need higher slippage for volatile tokens
- Use "Clear All" if tokens were sold externally

### Position stuck
- Token may have been sold via Phantom
- Use "Clear All" to remove stale positions
