<p align="center">
  <img src="assets/logo.svg" alt="Argus AI" width="120" height="120" />
</p>

<h1 align="center">Argus AI</h1>

<p align="center"><strong>AI-Powered Token Research Tool for Solana</strong></p>

Argus AI is a comprehensive token research tool that provides instant AI analysis, security checks, bundle detection, and one-click trading for Solana tokens.

**Live**: [app.argusguard.io](https://app.argusguard.io) | **Landing**: [argusguard.io](https://argusguard.io) | **X**: [@ArgusPanoptes7z](https://x.com/ArgusPanoptes7z) | **Telegram**: [@ArgusAIAlerts](https://t.me/ArgusAIAlerts)

---

## Pricing

| Tier | Requirement | Scans | Features |
|------|-------------|-------|----------|
| **Free** | None | 10/day | Full analysis, trading, bundle detection |
| **Holder** | 1,000+ $ARGUS | Unlimited | All features + priority support |
| **Pro** | 10,000+ $ARGUS | Unlimited | All features + early access |

**No subscriptions.** Just hold $ARGUS tokens in your wallet to unlock unlimited access.

---

## Features

### Token Research Tool
- **Manual Analysis**: Paste any token address for comprehensive research
- **AI Risk Scoring**: 0-100 score with STRONG_BUY, BUY, WATCH, HOLD, AVOID signals
- **Bundle Detection**: Same-block transaction analysis with HIGH/MEDIUM/LOW confidence levels
- **Price Crash Detection**: Automatic flagging of tokens with >30%, >50%, or >80% price drops
- **Sell Pressure Analysis**: Detects sell-heavy trading patterns on new tokens
- **Dev Activity Tracking**: Creator wallet history and deployment pattern analysis
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

## Technical Innovations

| Innovation | Description |
|------------|-------------|
| **17,000x Compression** | 2MB raw token data → 116-byte feature vectors (29 dimensions) |
| **BitNet 1-bit AI** | Ternary weights (-1, 0, +1), 13ms inference, CPU-only, $0/month |
| **Multi-Agent Swarm** | Scout, Analyst, Hunter, Trader communicating via pub/sub |
| **Origin Vault** | Cross-origin key isolation — first trading tool with this |
| **Smart Multi-RPC** | Intelligent routing across 5+ endpoints with auto-failover |
| **8 Scam Patterns** | BUNDLE_COORDINATOR, RUG_PULLER, WASH_TRADER, and more |
| **Outcome Learning** | Self-improving AI that tracks predictions vs reality |

---

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- Self-hosted Solana RPC node
- Self-hosted LLM server (Ollama with DeepSeek/Qwen)
- Helius API key (optional, for DAS API)

### Installation

```bash
git clone https://github.com/ArgusGuardAI/argus-ai.git
cd argus-ai
pnpm install
```

### Environment Setup

Create `packages/workers/.dev.vars`:

```env
SOLANA_RPC_URL=http://YOUR_RPC_NODE:8899  # Your Solana RPC node
LLM_ENDPOINT=http://YOUR_LLM_SERVER:11434 # Your Ollama server
HELIUS_API_KEY=your-helius-key            # Optional - for DAS API only
```

### Development

```bash
# Terminal 1: Start Workers API
cd packages/workers
pnpm dev
# Runs at http://localhost:8787

# Terminal 2: Start Dashboard
cd packages/argus
pnpm dev
# Runs at http://localhost:3000

# Terminal 3: Start Vault (for trading)
cd packages/vault
pnpm dev
# Runs at http://localhost:3001
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
2. **Fetch Data** → DexScreener (market) + RPC (holders, security)
3. **Detect Bundles** → Transaction analysis finds coordinated wallets
4. **AI Analysis** → BitNet + Self-hosted LLM generates risk score and verdict
5. **Guardrails** → Deterministic checks enforce minimum risk floors
6. **Display Results** → All panels update with comprehensive data
7. **Trade** → One-click buy with Jupiter aggregator

---

## Bundle Detection

Argus detects coordinated wallet clusters that may indicate:
- Insider accumulation
- Coordinated pump groups
- Potential dump risk

**How it works:**
- Fetches top holders and their transaction history via Helius RPC
- Detects same-block transactions (wallets buying in the same block = HIGH confidence)
- Analyzes holder percentage patterns for coordinated accumulation
- Assigns confidence levels: HIGH, MEDIUM, LOW, NONE
- Displays total bundle percentage, wallet count, and confidence level
- Red highlighting in holder distribution chart

**Scoring Impact:**
- HIGH confidence bundle: minimum risk score 55
- MEDIUM confidence bundle: minimum risk score 50
- Bundle holding > 20% supply: additional risk penalty
- AI verdict explicitly warns about detected bundles

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
├── workers/            # Cloudflare Workers API (production)
│   ├── src/routes/         # sentinel, analyze, jupiter endpoints
│   └── src/services/       # Helius, DexScreener, Together AI
├── monitor/            # WebSocket Pool Detection ($0/month)
│   ├── src/pool-monitor.ts # Real-time DEX subscriptions
│   └── src/quick-analyzer.ts # Fast 2-call token assessment
├── agents/             # Multi-Agent AI System
│   └── src/agents/         # Scout, Analyst, Hunter, Trader
└── training/           # ML Training Data Collection
```

---

## API Reference

### Rate Limiting

The API enforces rate limits based on user tier:

| Tier | Daily Limit | Identified By |
|------|-------------|---------------|
| Free | 10 scans | IP address or wallet |
| Holder (1K+ $ARGUS) | Unlimited | Wallet address |
| Pro (10K+ $ARGUS) | Unlimited | Wallet address |

**Response Headers:**
- `X-RateLimit-Limit`: Maximum scans allowed
- `X-RateLimit-Remaining`: Scans remaining today
- `X-RateLimit-Reset`: UTC timestamp when limit resets
- `X-User-Tier`: Current user tier (free/holder/pro)

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

## Risk Guardrails

Deterministic checks that enforce minimum risk scores regardless of AI output:

| Guardrail | Minimum Score |
|-----------|---------------|
| Price crashed >80% | 75 (SCAM) |
| Price dropped >50% | 65 (DANGEROUS) |
| Price dropped >30% | 55 (SUSPICIOUS) |
| $0 liquidity | 70 (DANGEROUS) |
| Token <6h + liquidity <$10K | 55 (SUSPICIOUS) |
| Token <24h + liquidity <$5K | 55 (SUSPICIOUS) |
| Token <6h old | 50 (SUSPICIOUS) |
| Token <24h old | 40 (SAFE) |
| Liquidity <$5K | 50 (SUSPICIOUS) |
| Sell-heavy trading on <24h token | 60 (DANGEROUS) |
| <25 holders on <6h token | 55 (SUSPICIOUS) |
| 4+ combined risk signals | 65 (DANGEROUS) |
| 3+ combined risk signals | 60 (DANGEROUS) |

---

## Data Sources

| Data | Source | Cost |
|------|--------|------|
| RPC Calls | Your own Solana node | $0 (self-hosted) |
| Price, Volume, Liquidity | DexScreener API | FREE |
| Buy/Sell Counts | DexScreener API | FREE |
| Creator Detection | Helius DAS API | Optional |
| AI Risk Analysis | BitNet + Self-hosted LLM | $0 (self-hosted) |
| Swap Execution | Jupiter API | FREE |
| Real-time Streaming | Yellowstone/Geyser | $0 (self-hosted) |

### Self-Hosted LLM Models

| Model | Purpose | Speed |
|-------|---------|-------|
| `deepseek-r1:32b` | Deep reasoning / analysis | ~5-10s |
| `qwen3:8b` | Fast inference / council votes | ~1-2s |
| `argus-sentinel-v1.bitnet` | Risk classification | ~13ms |

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
