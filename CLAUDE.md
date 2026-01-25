# CLAUDE.md

Development guidance for AI assistants working on the Solana Safeguard AI codebase.

---

## Project Overview

**Argus AI** is a manual token research tool for Solana. Users paste a token address, get comprehensive AI-powered analysis (security, market data, holder distribution, bundle detection), and can execute one-click trades.

### Live URLs
- **Landing Page**: https://argusguard.io
- **App Dashboard**: https://app.argusguard.io
- **Workers API**: https://argusguard-api.hermosillo-jessie.workers.dev

### Core Components
- **Argus** (`packages/argus`) - Token Research Dashboard (React + Vite)
- **Sniper** (`packages/sniper`) - Token scanner backend (local dev)
- **Workers** (`packages/workers`) - Cloudflare Workers API (production)

### Key Features
- Manual token address input with analysis
- AI-powered risk scoring (0-100, inverted from API)
- Security checks (mint/freeze authority, LP lock)
- Holder distribution with top 10 visualization
- Bundle detection (coordinated wallet clusters)
- Market data (price, market cap, liquidity, volume)
- Trading activity (buy/sell counts, ratio)
- One-click buy via Jupiter swap
- Position tracking with P&L
- Dedicated trading wallet with backup safety
- Watchlist and recent searches
- Dark theme UI

---

## Architecture

```
packages/
├── argus/           # Token Research Dashboard (React + Vite)
│   ├── src/App.tsx      # Main single-page dashboard
│   ├── src/main.tsx     # Subdomain-aware routing
│   ├── src/pages/       # Landing page
│   ├── src/hooks/       # useAutoTrade hook (trading logic)
│   ├── src/lib/         # Jupiter swap, trading wallet
│   └── src/contexts/    # Wallet auth context
├── sniper/          # Token Scanner Backend (local dev)
│   ├── src/server.ts    # HTTP + WebSocket server
│   ├── src/engine/      # Analyzer, pre-filter, launch-filter
│   └── src/listeners/   # Raydium, Meteora, DexScreener
└── workers/         # Cloudflare Workers API (production)
    ├── src/index.ts     # Main worker entry
    ├── src/routes/      # sentinel, analyze, jupiter, etc.
    └── src/services/    # Helius, DexScreener, Together AI
```

---

## Deployment

```bash
# Argus Dashboard (app.argusguard.io)
cd packages/argus
pnpm build
npx wrangler pages deploy dist --project-name argusguard-app

# Landing Page (argusguard.io) - same build, separate project
npx wrangler pages deploy dist --project-name argusguard-website

# Workers API
cd packages/workers
npx wrangler deploy
```

### Cloudflare Projects
| Project | Domain | Purpose |
|---------|--------|---------|
| `argusguard-app` | app.argusguard.io | Dashboard app |
| `argusguard-website` | argusguard.io | Landing page |
| Workers | argusguard-api.hermosillo-jessie.workers.dev | API |

---

## Commands

```bash
# Development
pnpm install              # Install dependencies

# Argus (Dashboard)
cd packages/argus
pnpm dev                  # Start dashboard at localhost:3000

# Sniper (Local Backend)
cd packages/sniper
pnpm dev                  # Start backend at localhost:8788

# Workers (API)
cd packages/workers
pnpm dev                  # Start workers at localhost:8787
```

---

## Key Files

### Argus Package (`packages/argus/`)

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main dashboard: token input, analysis display, buy controls, positions, settings |
| `src/main.tsx` | Subdomain-aware routing (app.* = dashboard, root = landing) |
| `src/pages/Landing.tsx` | Marketing landing page with feature showcase |
| `src/hooks/useAutoTrade.ts` | Trading logic: buy, sell, position tracking, wallet management |
| `src/lib/jupiter.ts` | Jupiter swap integration for buys/sells |
| `src/lib/tradingWallet.ts` | Dedicated trading wallet (encrypted localStorage) |
| `src/contexts/AuthContext.tsx` | Wallet connection and auth tier management |

### Sniper Package (`packages/sniper/`)

| File | Purpose |
|------|---------|
| `src/server.ts` | HTTP server with `/api/analyze-full` endpoint |
| `src/engine/analyzer.ts` | AI risk analysis via Sentinel API |
| `src/engine/pre-filter.ts` | Pre-filtering for trending tokens |
| `src/engine/launch-filter.ts` | Launch filter for new pools |

### Workers Package (`packages/workers/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Main worker entry, route handling |
| `src/routes/sentinel.ts` | `/sentinel/analyze` endpoint (production) |
| `src/routes/analyze.ts` | Token analysis logic |
| `src/routes/jupiter.ts` | Jupiter swap proxy |

---

## API Endpoints

### Local Development (sniper at localhost:8788)
```
POST /api/analyze-full
Body: { "address": "<token_address>" }
Returns: AnalysisResult (direct format)
```

### Production (Workers API)
```
POST /sentinel/analyze
Body: { "tokenAddress": "<token_address>" }
Returns: { tokenInfo, analysis, holderDistribution, bundleInfo, network, creatorInfo }
```

The App.tsx `analyzeToken()` function maps the Workers API response to the local `AnalysisResult` interface format.

---

## Token Analysis Flow

```
User pastes token address
       │
       ▼
┌─────────────┐
│   Argus     │ ──▶ POST to API (local or Workers)
│  Dashboard  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Workers API │ ──▶ DexScreener (price, volume, txns)
│  /sentinel  │ ──▶ RugCheck (holders, security)
│   /analyze  │ ──▶ Together AI (risk analysis)
└──────┬──────┘ ──▶ Bundle detection (coordinated wallets)
       │
       ▼
┌─────────────┐
│   Display   │ ──▶ Security panel
│  Analysis   │ ──▶ Market data panel
│   Results   │ ──▶ Trading activity panel
└──────┬──────┘ ──▶ Holder distribution chart
       │        ──▶ Bundle detection warnings
       │        ──▶ AI verdict + score
       ▼
┌─────────────┐
│  Buy/Sell   │ ──▶ Jupiter swap execution
│   Action    │ ──▶ Position tracking
└─────────────┘
```

---

## Trading Wallet

- Dedicated wallet stored encrypted in browser localStorage
- Signs transactions instantly (no popup confirmations)
- User's main wallet stays safe
- Backup modal shown on creation (must confirm)
- Export/Import private key support
- Delete confirmation with styled modal

---

## Dashboard UI

Single-page dark theme layout:

### Header
- Logo (triangle + eye) + "ARGUS AI"
- Wallet name + balance
- Connected wallet dropdown

### Main Content
- Token address input + Analyze button
- Recent searches dropdown (localStorage)
- Analysis results (when analyzed):
  - Security panel (mint/freeze authority, LP lock)
  - Market panel (price, market cap, liquidity, volume, price changes)
  - Trading panel (buy/sell counts, buy ratio)
  - Holder distribution (top 10 bar chart with bundle highlighting)
  - Bundle detection warnings
  - AI verdict (signal badge, score, reasoning)
  - Social links (website, twitter, telegram, DexScreener)
- Buy controls (preset amounts + custom + buy button)
- Active positions table with sell buttons
- Trade history (expandable)
- Settings (trading wallet, buy settings, auto-sell)

---

## Routing

`main.tsx` detects subdomain for conditional routing:

```typescript
const isAppSubdomain = window.location.hostname.startsWith('app.');
// app.argusguard.io → App component (dashboard) directly
// argusguard.io → Landing page at /, with links to app.argusguard.io
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

| Key | Purpose |
|-----|---------|
| `argus_trading_wallet` | Encrypted trading wallet keypair |
| `argus_trading_state` | Positions, P&L, trade history |
| `argus_recent_searches` | Last 10 analyzed tokens |
| `argus_watchlist` | Saved tokens to watch |
| `argus_wallet_backup_confirmed` | Whether user confirmed wallet backup |
| `argus_wallet_name` | Custom name for trading wallet |

---

## Code Style

- TypeScript strict mode
- React functional components with hooks
- Tailwind CSS for styling (dark theme, zinc color palette)
- pnpm workspaces monorepo
- No emojis in code unless user requests

---

## Common Issues

### Token analysis fails
- Check browser console for API errors
- Verify Workers API is deployed and reachable
- Check if token address is valid Solana address

### "User rejected the request"
- Normal - user declined wallet connection in browser extension
- Not a bug

### Position stuck
- Token may have been sold via Phantom externally
- Use "Clear All" to remove stale positions

### Landing page links going to /dashboard
- Links should point to https://app.argusguard.io
- If not, update Landing.tsx href values
