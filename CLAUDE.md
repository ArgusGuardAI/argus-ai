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
- **Agents** (`packages/agents`) - Multi-agent AI system for autonomous analysis
- **Workers** (`packages/workers`) - Cloudflare Workers API (production)
- **Vault** (`packages/vault`) - Secure key management (isolated origin)
- **Training** (`packages/training`) - ML training data collection
- **Sniper** (`packages/sniper`) - Token scanner backend (deprecated, use Workers)

### Technical Innovations
- **17,000x Compression**: 2MB raw data → 116-byte feature vectors (29 dimensions)
- **BitNet 1-bit AI**: Ternary weights (-1, 0, +1), CPU-only inference in 13ms
- **Multi-Agent Swarm**: Scout, Analyst, Hunter, Trader communicating via pub/sub MessageBus
- **Origin Vault**: Cross-origin key isolation — first trading tool with this architecture
- **Smart Multi-RPC**: Intelligent routing across 5+ endpoints with auto-failover
- **8 Scam Patterns**: Pattern matching with cosine similarity scoring
- **Outcome Learning**: Self-improving AI through prediction tracking

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
│   ├── src/hooks/       # useAutoTrade, useAgentStatus hooks
│   ├── src/components/  # SwarmStatusPanel, ActivityFeed
│   ├── src/lib/         # Jupiter swap, trading wallet (vault client)
│   └── src/contexts/    # Wallet auth context
├── agents/          # Multi-Agent AI System
│   ├── src/agents/      # ScoutAgent, AnalystAgent, HunterAgent, TraderAgent
│   ├── src/core/        # AgentCoordinator, MessageBus, BaseAgent, AgentMemory
│   ├── src/reasoning/   # BitNetEngine (1-bit quantized AI inference)
│   ├── src/learning/    # PatternLibrary (8 scam patterns), OutcomeLearner
│   └── src/tools/       # OnChainTools, AnalysisTools, TradingTools
├── vault/           # Secure Key Vault (secure.argusguard.io)
│   ├── src/vault.ts     # Isolated key management, signing
│   └── public/_headers  # Strict CSP for origin isolation
├── workers/         # Cloudflare Workers API (production)
│   ├── src/index.ts     # Main worker entry
│   ├── src/routes/      # sentinel, agents, analyze, jupiter, etc.
│   └── src/services/    # multi-rpc, helius, agent-events, rate-limit
├── monitor/         # WebSocket Pool Monitor ($0/month)
│   ├── src/pool-monitor.ts    # WebSocket subscriptions to DEX programs
│   ├── src/quick-analyzer.ts  # 2-call quick analysis
│   ├── src/alert-manager.ts   # Telegram + Workers API alerts
│   └── src/scammer-db.ts      # Local scammer database
├── training/        # ML Training Data Collection
│   └── scripts/         # Data collection and feature extraction
└── sniper/          # Token Scanner (DEPRECATED - uses heavy RPC)
    └── ...              # Use Workers API instead
```

---

## Deployment

```bash
# 1. Vault (secure.argusguard.io) - deploy first for new installs
cd packages/vault
pnpm build
npx wrangler pages deploy dist --project-name argusguard-vault

# 2. Argus Dashboard (app.argusguard.io)
cd packages/argus
pnpm build
npx wrangler pages deploy dist --project-name argusguard-app

# 3. Landing Page (argusguard.io) - same build, separate project
npx wrangler pages deploy dist --project-name argusguard-website

# 4. Workers API
cd packages/workers
npx wrangler deploy
```

### Cloudflare Projects
| Project | Domain | Purpose |
|---------|--------|---------|
| `argusguard-app` | app.argusguard.io | Dashboard app |
| `argusguard-website` | argusguard.io | Landing page |
| `argusguard-vault` | secure.argusguard.io | Key vault (isolated origin) |
| Workers | (see wrangler.toml) | API |

---

## Commands

```bash
# Development
pnpm install              # Install dependencies

# Argus (Dashboard)
cd packages/argus
pnpm dev                  # Start dashboard at localhost:3000

# Vault (Key Management) - required for trading wallet to work
cd packages/vault
pnpm dev                  # Start vault at localhost:3001

# Sniper (Local Backend)
cd packages/sniper
pnpm dev                  # Start backend at localhost:8788

# Workers (API)
cd packages/workers
pnpm dev                  # Start workers at localhost:8787

# Monitor (WebSocket Pool Detection) - $0/month
cd packages/monitor
pnpm install
RPC_ENDPOINT=ws://144.XX.XX.XXX:8900 pnpm dev
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
| `src/lib/tradingWallet.ts` | VaultClient - communicates with vault via postMessage for key operations |
| `src/contexts/AuthContext.tsx` | Wallet connection and auth tier management |

### Vault Package (`packages/vault/`)

| File | Purpose |
|------|---------|
| `src/vault.ts` | Isolated key management: stores encrypted keys, handles signing via postMessage |
| `public/_headers` | Strict CSP headers for Cloudflare Pages (script-src 'self' only) |

### Workers Package (`packages/workers/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Main worker entry, route handling, CORS config |
| `src/routes/sentinel.ts` | `/sentinel/analyze` endpoint with structural risk guardrails |
| `src/routes/agents.ts` | `/agents/*` endpoints (status, activity, stats, command) |
| `src/routes/jupiter.ts` | Jupiter swap proxy |
| `src/services/multi-rpc.ts` | Smart RPC routing across multiple providers |
| `src/services/agent-events.ts` | KV storage for agent events from scans |
| `src/services/rate-limit.ts` | Rate limiting (10/day free, unlimited for holders) |
| `src/services/helius.ts` | Helius API integration (DAS, transactions) |

### Agents Package (`packages/agents/`)

| File | Purpose |
|------|---------|
| `src/agents/ScoutAgent.ts` | Monitors for new token launches, quick scans |
| `src/agents/AnalystAgent.ts` | Deep investigation of flagged tokens |
| `src/agents/HunterAgent.ts` | Tracks scammer wallets and networks |
| `src/agents/TraderAgent.ts` | Position management and trade execution |
| `src/core/AgentCoordinator.ts` | Orchestrates all agents, system status |
| `src/core/MessageBus.ts` | Pub/sub inter-agent communication |
| `src/reasoning/BitNetEngine.ts` | Rule-based AI classification (29 features) |
| `src/learning/PatternLibrary.ts` | 8 known scam patterns with feature weights |

### Monitor Package (`packages/monitor/`) - FREE

WebSocket-based pool monitoring at $0/month. Runs locally or on a cheap VPS.

| File | Purpose |
|------|---------|
| `src/index.ts` | Main entry point, orchestrates all components |
| `src/pool-monitor.ts` | WebSocket subscriptions to Raydium, Orca, Pump.fun, Meteora |
| `src/quick-analyzer.ts` | 2-call quick analysis (getTokenSupply, getLargestAccounts) |
| `src/alert-manager.ts` | Push alerts to Workers API, Telegram, console |
| `src/scammer-db.ts` | Local scammer database with caching |

### Sniper Package (`packages/sniper/`) - DEPRECATED

**WARNING:** Sniper uses WebSocket subscriptions that consume RPC credits rapidly. Use Monitor package instead.

| File | Purpose |
|------|---------|
| `src/server.ts` | HTTP server with `/api/analyze-full` endpoint |
| `src/listeners/` | Real-time pool listeners (expensive) |

---

## API Endpoints

### Local Development (sniper at localhost:8788)
```
POST /api/analyze-full
Body: { "address": "<token_address>" }
Returns: AnalysisResult (direct format)
```

### Production (Workers API)

**Token Analysis:**
```
POST /sentinel/analyze
Body: { "tokenAddress": "<token_address>" }
Returns: { tokenInfo, analysis, holderDistribution, bundleInfo, network, creatorInfo }
```

**Agent Status (polling):**
```
GET /agents/status     → { online, agents[], health, lastUpdate }
GET /agents/activity   → { events[], lastEventId } (cursor: ?after=eventId)
GET /agents/stats      → { scans, alerts, hunters, traders }
POST /agents/command   → { type: 'analyze'|'track_wallet', tokenAddress?, walletAddress? }
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

## AI Agent System (`packages/agents`)

A multi-agent AI system for autonomous token analysis and scam detection.

### Agent Types

| Agent | Role | Capabilities |
|-------|------|--------------|
| **ScoutAgent** | Monitor | Watch for new token launches, perform quick scans, flag suspicious tokens |
| **AnalystAgent** | Investigate | Deep investigation of flagged tokens, generate risk reports |
| **HunterAgent** | Track | Build scammer profiles, detect repeat offenders, map wallet networks |
| **TraderAgent** | Execute | Position sizing, execute trades based on agent consensus |

### Core Components

| Component | Purpose |
|-----------|---------|
| `BitNetEngine` | 1-bit quantized AI for CPU inference, risk classification |
| `PatternLibrary` | Knowledge base of 8 known scam patterns with rug rates |
| `AgentMemory` | Vector storage with 17,000x compression for past tokens |
| `MessageBus` | Pub/sub communication between agents |
| `AgentCoordinator` | Orchestrates agent lifecycle and inter-agent routing |
| `OutcomeLearner` | Self-improvement through outcome tracking |

### Known Scam Patterns

| Pattern | Severity | Rug Rate | Description |
|---------|----------|----------|-------------|
| `BUNDLE_COORDINATOR` | HIGH | 75% | Multiple wallets coordinating supply distribution |
| `RUG_PULLER` | CRITICAL | 90% | Creator holds large supply with intent to dump |
| `WASH_TRADER` | MEDIUM | 60% | Self-trading to inflate volume artificially |
| `INSIDER` | HIGH | 50% | Wallets with privileged access accumulating early |
| `PUMP_AND_DUMP` | HIGH | 80% | Coordinated price inflation followed by sell-off |
| `HONEYPOT` | CRITICAL | 100% | Contract designed to prevent selling |
| `MICRO_CAP_TRAP` | MEDIUM | 55% | Very low liquidity, easy to manipulate |
| `LEGITIMATE_VC` | LOW | 5% | Healthy distribution, locked LP (positive pattern) |

### Agent Integration (Event-Driven)

Agents react to user scans without extra RPC calls:

```
User scans token
       │
       ▼
Workers API fetches data (DexScreener, RugCheck, Helius)
       │
       ├──▶ processTokenScan() via waitUntil()
       │           │
       │           ├──▶ SCOUT event logged
       │           ├──▶ ANALYST alert if score < 40
       │           └──▶ HUNTER alert if bundle/syndicate detected
       │
       └──▶ Response returned to user (not blocked)
```

**Cost:** $0 - reuses data already fetched for the scan.

---

## Feature Compression (17,000x)

Tokens are compressed to 116-byte feature vectors for efficient storage and pattern matching.

### Compression Specs

```
Raw token data:     ~2 MB (holders, txns, metadata)
Compressed vector:  116 bytes (29 features × 4 bytes)
Compression ratio:  17,000x
Memory per 100K:    11.6 MB
```

### Feature Vector (29 Dimensions)

| Index | Feature | Description |
|-------|---------|-------------|
| 0-4 | Market | liquidityLog, volumeToLiquidity, marketCapLog, priceVelocity, volumeLog |
| 5-10 | Holders | holderCountLog, top10Concentration, giniCoefficient, freshWalletRatio, whaleCount, topWhalePercent |
| 11-14 | Security | mintDisabled, freezeDisabled, lpLocked, lpBurned |
| 15-19 | Bundle | bundleDetected, bundleCountNorm, bundleControlPercent, bundleConfidence, bundleQuality |
| 20-23 | Trading | buyRatio24h, buyRatio1h, activityLevel, momentum |
| 24-25 | Time | ageDecay, tradingRecency |
| 26-28 | Creator | creatorIdentified, creatorRugHistory, creatorHoldings |

### Usage

```typescript
import { FEATURE_CONSTANTS } from '@argus/agents';

// 116 bytes per token = store millions in KV
const features = new Float32Array(29);
// ... extract features from token data
await memory.storeToken(tokenAddress, features, metadata);

// Fast similarity search
const similar = await memory.findSimilar(features, 5, 0.85);
```

---

## Infrastructure

### Hetzner Servers

| Server | IP | Specs | Purpose |
|--------|-----|-------|---------|
| **RPC Node** | 144.XX.XX.XXX:8899 | Dedicated | Solana RPC - all API calls |
| **agents-n-database** | 46.XXX.X.XXX | CPX32, 160 GB | Agents + PostgreSQL |
| **yellowstone-streaming-node** | 46.XXX.XXX.XXX | CPX22, 80 GB | Geyser/Yellowstone streaming |

All servers in Nuremberg, eu-central.

### RPC Configuration

**YOUR OWN NODE ONLY** - No third-party RPC providers.

```bash
# Workers API
wrangler secret put SOLANA_RPC_URL  # http://144.XX.XX.XXX:8899

# Agents (.env on agents-n-database server)
RPC_ENDPOINT=http://144.XX.XX.XXX:8899
RPC_WS_ENDPOINT=ws://144.XX.XX.XXX:8900
```

### External APIs Still Used

| API | Purpose | Required |
|-----|---------|----------|
| Helius DAS | Token creator detection, metadata | Optional |
| DexScreener | Price, volume, market data | Yes |
| Together AI | AI risk analysis | Yes |
| Jupiter | Swap execution | Yes |

### Method Classification

```typescript
// Light methods
LIGHT: getSlot, getBalance, getLatestBlockhash, getBlockTime

// Medium methods
MEDIUM: getAccountInfo, getMultipleAccounts, getTokenSupply, getTokenLargestAccounts

// Heavy methods
HEAVY: getProgramAccounts, getSignaturesForAddress, getTokenAccountsByOwner
```

---

## Cost-Free Monitoring Architecture

Strategy for 24/7 autonomous monitoring at $0/month using WebSocket subscriptions.

### Why WebSockets Are Free

- WebSocket = persistent connection, not per-call billing
- Your node WSS: `ws://144.XX.XX.XXX:8900`
- Yellowstone streaming: `46.XXX.XXX.XXX` (Geyser plugin)

### Monitoring Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│  WebSocket Subscriptions (FREE)                                 │
│                                                                 │
│  Subscribe to DEX program accounts:                             │
│  - Raydium AMM: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK   │
│  - Orca Whirlpool: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc │
│  - Pump.fun: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P       │
│  - Meteora: LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  New Pool Detection (~100-200/day)                              │
│                                                                 │
│  On new pool event:                                             │
│  1. Quick analysis (2 RPC calls: getTokenSupply, getLargest)    │
│  2. If suspicious → flag for investigation                       │
│  3. Check local scammer DB (0 RPC calls)                        │
│  4. Alert if known scammer                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cost Breakdown                                                 │
│                                                                 │
│  WebSocket subscriptions:     0 calls     $0                    │
│  Quick analysis (200 pools):  400 calls   $0 (free tier)        │
│  Deep investigation (5%):     30 calls    $0 (free tier)        │
│  Position monitoring:         288 calls   $0 (batched)          │
│  ─────────────────────────────────────────────────────────────  │
│  TOTAL:                       718/day     $0/month              │
│  Free tier limit:             2.16M/day                         │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Notes

1. **Don't poll** - Use WebSocket `onProgramAccountChange`
2. **Filter early** - Only analyze pools with >$1K liquidity
3. **Batch RPC calls** - Use `getMultipleAccountsInfo` for positions
4. **Cache aggressively** - Cloudflare KV has 24h TTL on scans
5. **Local scammer DB** - D1 database lookup is free

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

## Vault Security Architecture

The trading wallet uses **Origin Isolation** (the "Vault Pattern") to protect private keys from malicious browser extensions and XSS attacks.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  app.argusguard.io (Main App)                                   │
│                                                                 │
│  ┌───────────────────┐     postMessage      ┌─────────────────┐│
│  │  tradingWallet.ts │ ◄──────────────────► │  Hidden iframe  ││
│  │  (VaultClient)    │                      │  to vault       ││
│  └───────────────────┘                      └─────────────────┘│
│                                                      │          │
│  - Creates unsigned transactions                     │          │
│  - Manages UI, positions, settings                   │          │
│  - Makes API calls                                   │          │
│  - NEVER sees private key                            │          │
└─────────────────────────────────────────────────────────────────┘
                                                       │
                                               Cross-Origin
                                                       │
┌─────────────────────────────────────────────────────────────────┐
│  secure.argusguard.io (Vault)                                   │
│                                                                 │
│  - Stores encrypted private key in localStorage                 │
│  - Decrypts key in memory when needed                          │
│  - Signs transactions, returns signature                        │
│  - Strict CSP: script-src 'self' only                          │
│  - No third-party scripts, no analytics                        │
└─────────────────────────────────────────────────────────────────┘
```

### Security Benefits

| Attack Vector | Protection |
|---------------|------------|
| Malicious browser extension on app | Cannot access vault iframe's memory (cross-origin) |
| XSS on main app | Cannot execute code in vault context |
| Supply chain attack (npm package) | Vault has no dependencies to compromise |
| Content script injection | Blocked by strict CSP headers |

### Packages

```
packages/
├── argus/           # Main app (app.argusguard.io)
│   └── src/lib/tradingWallet.ts  # VaultClient - communicates via postMessage
└── vault/           # Key vault (secure.argusguard.io)
    ├── src/vault.ts              # Message handler, signing logic
    └── public/_headers           # CSP headers for Cloudflare Pages
```

### Deployment

```bash
# Deploy vault (must be done first for new installs)
cd packages/vault
pnpm build
npx wrangler pages deploy dist --project-name argusguard-vault

# Then deploy main app
cd packages/argus
pnpm build
npx wrangler pages deploy dist --project-name argusguard-app
```

### Local Development

Run both the app and vault dev servers:

```bash
# Terminal 1: Main app (port 3000)
cd packages/argus && pnpm dev

# Terminal 2: Vault (port 3001)
cd packages/vault && pnpm dev
```

The tradingWallet.ts automatically connects to `localhost:3001` in development.

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

### Workers Secrets (production)

Set via `wrangler secret put <KEY>`:

```bash
# Required
TOGETHER_AI_API_KEY      # AI risk analysis
SOLANA_RPC_URL           # Your Hetzner node (http://144.XX.XX.XXX:8899)

# Optional
HELIUS_API_KEY           # DAS API only (for creator detection)
JUPITER_API_KEY          # Jupiter swap API
TWITTER_API_KEY          # Auto-tweet high-risk tokens
TWITTER_API_SECRET
TWITTER_ACCESS_TOKEN
TWITTER_ACCESS_TOKEN_SECRET
TELEGRAM_BOT_TOKEN       # Telegram alerts
TELEGRAM_CHANNEL_ID
ADMIN_SECRET             # Training data API access
```

### Workers Local Development (.dev.vars)

```env
TOGETHER_AI_API_KEY=your-together-ai-api-key
SOLANA_RPC_URL=http://144.XX.XX.XXX:8899
HELIUS_API_KEY=your-helius-api-key  # Optional, for DAS API only
```

### Argus Dashboard (.env)

```env
VITE_HELIUS_API_KEY=your-helius-api-key
```

---

## LocalStorage Keys

### Main App (app.argusguard.io)
| Key | Purpose |
|-----|---------|
| `argus_trading_wallet_name` | Custom name for trading wallet |
| `argus_trading_state` | Positions, P&L, trade history |
| `argus_recent_searches` | Last 10 analyzed tokens |
| `argus_watchlist` | Saved tokens to watch |
| `argus_wallet_backup_confirmed` | Whether user confirmed wallet backup |

### Vault (secure.argusguard.io)
| Key | Purpose |
|-----|---------|
| `argus_vault_key` | Encrypted trading wallet keypair (isolated origin) |
| `argus_vault_name` | Wallet name (synced with main app) |

---

## Cloudflare Storage

### KV Namespace: `SCAN_CACHE`

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `scan:{tokenAddress}` | Cached token analysis results | 24h |
| `rate:{identifier}` | Rate limit counters | 24h |
| `agents:events` | Recent agent activity events | 24h |
| `agents:stats` | Aggregate agent statistics | 7d |

### D1 Database: `BUNDLE_DB`

Stores bundle network data for scammer tracking:

```sql
-- Wallets involved in bundles
CREATE TABLE bundle_wallets (
  wallet TEXT PRIMARY KEY,
  tokens_involved INTEGER,
  first_seen INTEGER,
  last_seen INTEGER,
  rug_count INTEGER DEFAULT 0
);

-- Token rug outcomes for learning
CREATE TABLE token_outcomes (
  token TEXT PRIMARY KEY,
  launched_at INTEGER,
  rugged_at INTEGER,
  creator TEXT,
  bundle_detected BOOLEAN
);
```

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

### RPC credits depleting quickly
- Check if sniper is running (uses WebSocket subscriptions that burn credits)
- Stop sniper: `pkill -f sniper` or kill the process
- Use Workers API instead of sniper for production
- **Helius webhooks cost 1 credit per push** - don't use for monitoring
- Use WebSocket subscriptions for free monitoring

### Agent events not showing
- Ensure `SCAN_CACHE` KV namespace is bound in wrangler.toml
- Check `c.executionCtx.waitUntil()` is being called in sentinel.ts
- Events are only generated from real user scans, not simulated

### RPC connection issues
- Verify SOLANA_RPC_URL secret is set: `wrangler secret list`
- Check your Hetzner node is running: `curl http://144.XX.XX.XXX:8899 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
- WebSocket endpoint is port 8900: `ws://144.XX.XX.XXX:8900`
