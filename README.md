<p align="center">
  <img src="assets/logo.svg" alt="Argus AI" width="120" height="120" />
</p>

<h1 align="center">Argus AI</h1>

<p align="center"><strong>AI-Powered Token Research Tool for Solana</strong></p>

Argus AI is a comprehensive token research tool that provides instant AI analysis, security checks, bundle detection, and one-click trading for Solana tokens.

**Live**: [app.argusguard.io](https://app.argusguard.io) | **Landing**: [argusguard.io](https://argusguard.io) | **X**: [@ArgusPanoptes7z](https://x.com/ArgusPanoptes7z)

---

## Features

### Token Research Tool
- **Manual Analysis**: Paste any token address for comprehensive research
- **AI Risk Scoring**: 0-100 score with STRONG_BUY, BUY, WATCH, HOLD, AVOID signals
- **Bundle Detection**: Identifies coordinated wallet clusters holding tokens
- **24h Sparkline**: Visual price chart in the Market card
- **One-Click Trading**: Buy tokens directly with configurable amounts

### Analysis Dashboard
- **Security Panel**: Mint/Freeze authority status, LP lock percentage
- **Market Data**: Price, market cap, liquidity, 24h volume, price changes
- **Trading Activity**: Buy/sell counts, buy ratio, transaction volume
- **Top Holders**: Visual bar chart with bundle highlighting (red)
- **AI Verdict**: Written analysis with bundle warnings

### Auto-Sell System
- **Take Profit**: Automatically sell when position reaches target gain
- **Stop Loss**: Exit position when loss threshold is hit
- **Trailing Stop**: Lock in profits by selling when price drops from peak

### Trading Wallet
- **Dedicated Wallet**: Separate from your main wallet for safety
- **Instant Execution**: No popup confirmations needed
- **Full Control**: Create, import, export, withdraw, delete

---

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- API Keys: Helius (optional), Together AI or Groq

### Installation

```bash
git clone https://github.com/ArgusGuardAI/argus-ai.git
cd argus-ai
pnpm install
```

### Environment Setup

Create `packages/sniper/.env`:

```env
HELIUS_API_KEY=your-helius-key      # Optional - for real-time pool detection
TOGETHER_AI_API_KEY=your-key        # For AI analysis
GROQ_API_KEY=your-groq-key          # Alternative FREE AI (recommended)
```

### Development

```bash
# Terminal 1: Start Backend
cd packages/sniper
pnpm dev
# Runs at http://localhost:8788

# Terminal 2: Start Dashboard
cd packages/argus
pnpm dev
# Runs at http://localhost:3000
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  ARGUS AI                                    [Wallet: 2.5 SOL]  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Enter token address...                       [Analyze]  │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Recent: BONK, WIF, POPCAT                                      │
├─────────────────────────────────────────────────────────────────┤
│  TOKEN: $EXAMPLE                              Score: 72 [BUY]   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  SECURITY    │  │   MARKET     │  │   ACTIVITY   │          │
│  │ ✓ Mint Rev   │  │ $45.2M MC    │  │ 1,234 buys   │          │
│  │ ✓ Freeze Rev │  │ $824K Liq    │  │   456 sells  │          │
│  │ ⚠ LP: 0%     │  │ [sparkline]  │  │ 2.7:1 ratio  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  TOP HOLDERS                              [2 BUNDLES]    │   │
│  │  ████████████████████ 45.2%  - Holder                   │   │
│  │  ██████ 12.1%  - Whale                                   │   │
│  │  ████ 8.3%  - [Bundle #1]                               │   │
│  │  ████ 8.2%  - [Bundle #1]                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [ 0.05 SOL ] [ 0.1 SOL ] [ 0.25 SOL ]    [BUY $EXAMPLE]       │
└─────────────────────────────────────────────────────────────────┘
```

### Analysis Flow

1. **Paste Token Address** → Enter any Solana token mint
2. **Fetch Data** → DexScreener (market) + RugCheck (security)
3. **Detect Bundles** → Algorithm finds coordinated wallets
4. **AI Analysis** → Groq/Together generates verdict
5. **Display Results** → All panels update with comprehensive data
6. **Trade** → One-click buy with Jupiter aggregator

---

## Bundle Detection

Argus detects coordinated wallet clusters that may indicate:
- Insider accumulation
- Coordinated pump groups
- Potential dump risk

**How it works:**
- Analyzes top 10 holders
- Groups wallets with similar holdings (within 1% difference)
- Flags clusters of 3+ wallets as "bundles"
- Displays total bundle percentage and wallet count

---

## Project Structure

```
packages/
├── argus/              # Token Research Dashboard (React + Vite)
│   ├── src/App.tsx         # Main single-page application
│   ├── src/main.tsx        # Subdomain-aware routing
│   ├── src/pages/          # Landing page
│   ├── src/hooks/          # useAutoTrade hook (trading, positions)
│   └── src/lib/            # Jupiter swap, trading wallet
├── sniper/             # Analysis Backend (local dev)
│   ├── src/server.ts       # REST API + WebSocket server
│   ├── src/engine/         # Analyzer, launch-filter, sniper
│   └── src/listeners/      # Raydium, Meteora, DexScreener, Pumpfun
├── workers/            # Cloudflare Workers API (production)
│   ├── src/routes/         # sentinel, analyze, jupiter endpoints
│   └── src/services/       # Helius, DexScreener, Together AI
└── shared/             # Shared types & constants
```

---

## API Reference

### POST /api/analyze-full

Comprehensive token analysis endpoint.

**Request:**
```json
{ "address": "TokenMintAddress123..." }
```

**Response:**
```json
{
  "token": { "address": "...", "name": "Example", "symbol": "EX" },
  "security": {
    "mintAuthorityRevoked": true,
    "freezeAuthorityRevoked": true,
    "lpLockedPercent": 100
  },
  "market": {
    "price": 0.00123,
    "marketCap": 45200000,
    "liquidity": 824000,
    "volume24h": 1200000,
    "priceChange24h": 12.5,
    "sparkline": [0.001, 0.0011, ...]
  },
  "trading": {
    "buys1h": 1234,
    "sells1h": 456,
    "buyRatio": 2.7
  },
  "holders": {
    "total": 5420,
    "top10": [
      { "address": "...", "percent": 45.2, "isBundle": false },
      { "address": "...", "percent": 8.3, "isBundle": true, "bundleId": 1 }
    ]
  },
  "bundles": {
    "detected": true,
    "count": 2,
    "totalPercent": 16.5,
    "wallets": ["addr1", "addr2", ...]
  },
  "ai": {
    "signal": "BUY",
    "score": 72,
    "verdict": "Strong security with revoked authorities..."
  },
  "links": {
    "dexscreener": "https://dexscreener.com/solana/..."
  }
}
```

---

## Configuration

### Settings Panel (UI)

| Setting | Options | Description |
|---------|---------|-------------|
| **Auto-Sell** | On/Off | Enable automatic selling |
| Take Profit | 50%, 100%, 200%, 500% | Sell when up this % |
| Stop Loss | 20%, 30%, 50%, 70% | Sell when down this % |
| Trailing Stop | Off, 10%, 20%, 30% | Sell when drops from peak |
| **Buy Settings** | | |
| Default Amount | 0.01-0.25 SOL | Amount per trade |
| Max Slippage | 1%, 3%, 5%, 10% | Slippage tolerance |
| Reserve Balance | 0.05-0.5 SOL | Keep minimum SOL |

---

## Data Sources (All FREE)

| Data | Source | Cost |
|------|--------|------|
| Price, Volume, Liquidity | DexScreener | FREE |
| Buy/Sell Counts | DexScreener | FREE |
| Mint/Freeze Authority | RugCheck | FREE |
| Top 10 Holders | RugCheck | FREE |
| AI Analysis | Groq | FREE |
| AI Analysis (fallback) | Together AI | Paid |

---

## Security

- **Dedicated Trading Wallet**: Separate from main wallet
- **Encrypted Storage**: Private key encrypted in localStorage
- **0.5% Fee**: Small fee on trades supports development
- **No Backend Secrets**: All keys stay client-side

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Deployment

```bash
# Build and deploy dashboard (app.argusguard.io)
cd packages/argus
pnpm build
npx wrangler pages deploy dist --project-name argusguard-app

# Deploy landing page (argusguard.io) - same build
npx wrangler pages deploy dist --project-name argusguard-website

# Deploy Workers API
cd packages/workers
npx wrangler deploy
```

---

## Links

- [Whitepaper](./WHITEPAPER.md)
- [Development Guide](./CLAUDE.md)
- [File Structure](./LAYOUT.md)
- [X (Twitter)](https://x.com/ArgusPanoptes7z)

**Built with Argus AI**
