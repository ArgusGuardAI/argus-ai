# CLAUDE.md

Development guidance for AI assistants working on the Solana Safeguard AI codebase.

---

## Project Overview

**Solana Safeguard AI** is an automated AI-powered trading system for Solana tokens. It scans new tokens on Pump.fun, analyzes them for risk using AI, and automatically executes trades on approved tokens.

### Core Components
- **Argus** (`packages/argus`) - AI Trading Dashboard (React + Vite)
- **Sniper** (`packages/sniper`) - Token scanner and analysis backend
- **Workers** (`packages/workers`) - Cloudflare Workers API for analysis

### Key Features
- Real-time Pump.fun token scanning
- AI-powered risk analysis (0-100 score)
- Fully automated trading with dedicated wallet
- Auto-sell: Take profit, stop loss, trailing stop
- Position tracking with P&L

---

## Architecture

```
packages/
├── argus/           # AI Trading Dashboard (React + Vite)
│   ├── src/App.tsx      # Main dashboard UI
│   ├── src/hooks/       # useAutoTrade hook
│   └── src/lib/         # Jupiter swap, trading wallet
├── sniper/          # Token Scanner Backend
│   ├── src/engine/      # Scanner, analyzer, pre-filter
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
| `src/App.tsx` | Main dashboard with pages: Dashboard, Positions, Settings |
| `src/hooks/useAutoTrade.ts` | Core trading logic: buy, sell, position tracking |
| `src/lib/jupiter.ts` | Jupiter swap integration for buys/sells |
| `src/lib/tradingWallet.ts` | Dedicated trading wallet (encrypted localStorage) |
| `src/contexts/AuthContext.tsx` | Wallet adapter context provider |

### Sniper Package (`packages/sniper/`)

| File | Purpose |
|------|---------|
| `src/server.ts` | WebSocket server, broadcasts token events |
| `src/engine/sniper.ts` | Main scanner engine |
| `src/engine/analyzer.ts` | AI risk analysis |
| `src/engine/pre-filter.ts` | Fast pre-filtering (age, liquidity, etc.) |

---

## Trading System

### Auto-Trade Flow
```
1. Sniper detects new token on Pump.fun
2. Pre-filter checks (age, liquidity, market cap)
3. AI analyzes for risk score (0-100)
4. If score <= maxRiskScore AND auto-trade enabled:
   - Execute buy via Jupiter
   - Create position for tracking
5. Price monitoring loop (every 10s):
   - Check take profit condition
   - Check stop loss condition
   - Check trailing stop condition
6. Execute sell when condition met
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

## Risk Analysis System

### Risk Levels
| Level | Score | Meaning |
|-------|-------|---------|
| SAFE | 0-49 | Low risk, tradeable |
| SUSPICIOUS | 50-69 | Caution |
| DANGEROUS | 70-89 | High risk |
| SCAM | 90-100 | Do not trade |

### Pre-Filter Checks
- Token age (minimum age requirement)
- Liquidity (minimum liquidity)
- Market cap (min/max bounds)
- Holder concentration

---

## Data Flow

```
Pump.fun WebSocket
       │
       ▼
┌─────────────┐
│   Sniper    │ ──▶ Pre-filter (fast checks)
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
HELIUS_API_KEY=          # Required for RPC
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

## Code Style

- TypeScript strict mode
- React functional components with hooks
- Tailwind CSS for styling
- pnpm workspaces monorepo
- No emojis in code unless user requests

---

## Common Issues

### "Auto-trade disabled, skipping"
- Auto-trade toggle is OFF
- Enable in Dashboard or Settings

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
