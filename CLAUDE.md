# CLAUDE.md

Development guidance for AI assistants working on the Solana Safeguard AI codebase.

---

## Project Overview

**Argus AI** is a manual token research tool for Solana. Users paste a token address, get comprehensive AI-powered analysis (security, market data, holder distribution, bundle detection), and can execute one-click trades.

### Live URLs
- **Landing Page**: https://argusguard.io
- **App Dashboard**: https://app.argusguard.io
- **X (Twitter)**: https://x.com/ArgusPanoptes7z

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
- Rate limiting (10 free scans/day, unlimited for $ARGUS holders)

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
| Workers | (see wrangler.toml) | API |

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
| `src/pages/Landing.tsx` | Marketing landing page with feature showcase, live $ARGUS token ticker |
| `src/hooks/useAutoTrade.ts` | Trading logic: buy, sell, position tracking, wallet management |
| `src/lib/jupiter.ts` | Jupiter swap integration for buys/sells, parseSwapError for human-readable errors |
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
| `src/index.ts` | Main worker entry, route handling, CORS config |
| `src/routes/sentinel.ts` | `/sentinel/analyze` endpoint (production) with structural risk guardrails |
| `src/routes/analyze.ts` | Token analysis logic |
| `src/routes/jupiter.ts` | Jupiter swap proxy |
| `src/services/rate-limit.ts` | Rate limiting logic (10/day free, unlimited for holders) |

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

## Rate Limiting

The `/sentinel/analyze` endpoint enforces rate limits:

| Tier | Daily Limit | How to Unlock |
|------|-------------|---------------|
| Free | 10 scans | Default for all users |
| Holder | Unlimited | Hold 1,000+ $ARGUS tokens |
| Pro | Unlimited | Hold 10,000+ $ARGUS tokens |

**Implementation:**
- `packages/workers/src/services/rate-limit.ts` - Rate limit logic
- Users identified by `X-Wallet-Address` header (if connected) or IP address
- Limits stored in Cloudflare KV (`SCAN_CACHE` namespace)
- Resets daily at midnight UTC

**Response Headers:**
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1706486400000
X-User-Tier: free
```

**Frontend handling:**
- `App.tsx` sends `X-Wallet-Address` header when trading wallet is loaded
- Shows "X scans left today" when under 10 remaining
- Deep links from Telegram show confirmation dialog before using a scan

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

## Structural Risk Guardrails

The Workers API (`sentinel.ts`) enforces hard minimum scores that override AI analysis:

| Condition | Minimum Score |
|-----------|---------------|
| Token < 6h AND liquidity < $10K | 50 |
| Token < 24h AND liquidity < $5K | 50 |
| Token < 6h (any liquidity) | 35 |
| Liquidity < $5K (any age) | 40 |
| Volume/Liquidity > 8x on token < 24h | 45 |

These are applied **only on the backend** to avoid double-counting with AI prompt guidance. The frontend (`App.tsx`) does NOT apply additional structural penalties.

---

## Trading Wallet

- Dedicated wallet stored encrypted in browser localStorage
- Signs transactions instantly (no popup confirmations)
- User's main wallet stays safe
- Backup modal shown on creation (must confirm)
- Export/Import private key support
- Delete confirmation with styled modal
- 0.5% fee on trades supports development (sent to fee wallet)

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

### Swap error (Custom: 6005)
- jupiter.ts `parseSwapError()` maps Solana program error codes to human-readable messages
- Code 6005 = "Slippage exceeded" — price moved too fast
- Other common codes: 6000 (slippage), 6003 (insufficient liquidity), 6022/6023 (output too low)

### "User rejected the request"
- Normal - user declined wallet connection in browser extension
- Not a bug

### Position stuck
- Token may have been sold via Phantom externally
- Use "Clear All" to remove stale positions

### All scores are 0 or too low
- Check sentinel.ts structural guardrails — they enforce minimum scores
- Structural penalties are applied ONLY on the backend (not frontend) to avoid double-counting
- Frontend App.tsx has a comment explaining this: "Structural risk handled by backend guardrails"

### Landing page links going to /dashboard
- Links should point to https://app.argusguard.io
- If not, update Landing.tsx href values
