# 🧠 MEME AI - Solana Meme Token Intelligence

AI-powered discovery, risk analysis, and trading signals for Solana meme tokens. Combines real-time on-chain analysis with Claude AI to surface opportunities and avoid rug pulls.

## Features

- **Real-time Token Scanning** - Pulls trending and new tokens from DexScreener
- **On-Chain Security Analysis** - Checks mint/freeze authority, holder concentration via Solana RPC
- **Hybrid AI Analysis** - Claude evaluates promising tokens with full reasoning
- **Pump & Dump Filtering** - Automatically excludes suspicious price movements
- **React Dashboard** - Clean UI showing opportunities with AI insights

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         SCANNER (Node.js)                        │
├─────────────────────────────────────────────────────────────────┤
│  DexScreener API ──► Heuristic Scoring ──► AI Analysis ──► JSON │
│        │                    │                   │                │
│   Trending/New         On-Chain RPC        Claude API           │
│     Tokens          (Helius/Solana)      (Hybrid Tiers)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    scan-results.json
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DASHBOARD (React + Vite)                    │
├─────────────────────────────────────────────────────────────────┤
│  Token Table ◄── Live Refresh ◄── scan-results.json             │
│      │                                                           │
│  Click Token ──► Modal with AI Analysis, On-Chain, Signals      │
└─────────────────────────────────────────────────────────────────┘
```

## AI Analysis Tiers

| Tier | Score Range | Analysis Type | Cost/Token |
|------|-------------|---------------|------------|
| 1 | All tokens | Heuristics only (free) | $0 |
| 2 | ≥50 | Full AI analysis with reasoning | ~$0.004 |
| 3 | 30-49 | Quick AI "hidden gem" check | ~$0.001 |

**Estimated monthly cost**: $5-15 (scanning every 60 seconds)

## Prerequisites

- Node.js 18+
- Solana RPC endpoint (Helius recommended for rate limits)
- Anthropic API key (for AI analysis)

## Installation

```bash
# Clone or copy the project
cd meme-token-intelligence

# Install dependencies
npm install
```

## Configuration

Set environment variables:

```bash
# Required: Solana RPC (Helius recommended)
export SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY"

# Required for AI: Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-api03-YOUR_KEY"
```

### Scanner Configuration

Edit `scanner.js` CONFIG section:

```javascript
const CONFIG = {
  scanInterval: 60000,        // Scan every 60 seconds
  minLiquidity: 1000,         // Minimum $1k liquidity
  minScore: 30,               // Minimum score to include
  maxResults: 20,             // Top N results to save
  enableOnChain: true,        // Enable Solana RPC checks
  enableAI: true,             // Enable Claude AI analysis
  maxPriceChange1h: 500,      // Filter >500% pumps (likely manipulation)
  minAge: 5,                  // Skip tokens <5 minutes old
  aiFullThreshold: 50,        // Full AI analysis threshold
  aiQuickThreshold: 30,       // Quick AI check threshold
};
```

## Usage

### Terminal 1: Start the Scanner

```bash
npm run scan
```

Output:
```
🧠 Meme Token Scanner + AI Analysis
=====================================
Filters: Min score 30 | Min liq $1000
AI Tiers: Full (>=50) | Quick (30-49)

🔗 RPC: https://mainnet.helius-rpc.com/?api-key=...
🧠 AI: ENABLED

============================================================
🔍 SCANNING... 10:30:45 AM
============================================================

📡 Fetching trending Solana tokens...
   Found 25 trending
📡 Searching recent activity...
   Found 30 pairs

🔬 Analyzing with on-chain checks...
....................

🧠 AI ANALYSIS =============================================

   🔮 Full analysis: $PEPE (score 67)...
      → BUY (risk 4/10, confidence 78%)
      "Solid liquidity and revoked authorities suggest legitimate project"

   ⚡ Quick check: $WOJAK (score 42)...
      → 👀 Watch: Decent setup, monitor volume

   💰 AI tokens used: 1,247 (~$0.0125)

🏆 TOP OPPORTUNITIES =======================================

[BUY] $PEPE — Score: 67/100
   💰 $0.00000123 | +24.5% (1h) | Liq: $45.2k
   🔗 ✅Mint | ✅Freeze | Top10: 34%
   🧠 AI: Risk 4/10 | Solid liquidity and revoked authorities
   📊 ✅ Mint revoked | ✅ Liq $45k | 🚀 +24% (1h)
   🕐 2h old | raydium | https://dexscreener.com/solana/...

⏱️  12.4s | 8 passed | 3 filtered | 25 scanned
💾 Saved to scan-results.json
```

### Terminal 2: Start the Dashboard

```bash
npm run dev
```

Open http://localhost:5173

## Dashboard Features

### Main View
- **Scanned** - Total tokens analyzed
- **Active Signals** - BUY + STRONG_BUY count
- **AI Analyzed** - Tokens with AI insights
- **Status** - AI Active / Scanning / Offline

### Token Table
- Token symbol with DEX
- Risk score (color-coded)
- Price and 1h change
- Liquidity
- Security indicators (green/red dots)
- Signal badge
- AI badge (purple) with confidence %

### Token Detail Modal
Click any row to see:
- **AI Analysis Card** (if available)
  - Risk level (1-10)
  - AI signal recommendation
  - Confidence percentage
  - Verdict quote
  - Red flags / Green flags
  - Full reasoning
- **Heuristic Score**
- **Price Stats** (price, 1h, liquidity, volume)
- **On-Chain Security** (mint, freeze, holder distribution)
- **Analysis Factors** (what contributed to the score)
- **Quick Links** (DexScreener, Solscan)

## Scoring System

### Heuristic Score (0-100)

| Factor | Max Points | Criteria |
|--------|------------|----------|
| On-Chain Security | 40 | Mint revoked (+), Freeze revoked (+), Whale concentration (-) |
| Liquidity | 20 | >$100k (20), >$30k (15), >$10k (10) |
| Volume | 15 | >$100k (15), >$30k (10), >$5k (5) |
| Momentum | 15 | +10-100% 1h (15), +0-10% (8), <-20% (-5) |
| Buy/Sell Ratio | 10 | >60% buys (10), <35% buys (-5) |

### Signal Mapping

| Score | Signal |
|-------|--------|
| 75+ | STRONG_BUY |
| 60-74 | BUY |
| 45-59 | WATCH |
| 30-44 | HOLD |
| <30 | AVOID |

### AI Override Rules
- AI can override signal if confidence >70%
- Quick check can promote HOLD → WATCH if AI says "watch: true"

## Pump & Dump Detection

Tokens are automatically filtered if:
- Price change >500% in 1 hour
- Price change >200% in 5 minutes
- Token age <5 minutes

## On-Chain Checks

Using Solana RPC (works with Token Program and Token-2022):

- **Mint Authority** - Can new tokens be minted? (Revoked = safe)
- **Freeze Authority** - Can accounts be frozen? (Revoked = safe)
- **Top Holder %** - Single wallet concentration (>50% = whale risk)
- **Top 10 Holders %** - Distribution check (>80% = concentrated)

## API Integrations

| Service | Purpose | Rate Limits |
|---------|---------|-------------|
| DexScreener | Token data, prices, volume | Free tier available |
| Solana RPC | On-chain security checks | Use Helius for better limits |
| Claude API | AI analysis | Pay per token (~$3/1M input) |

## File Structure

```
meme-token-intelligence/
├── scanner.js              # Main scanner with AI integration
├── scan-results.json       # Output (auto-generated)
├── package.json
├── vite.config.js
├── postcss.config.js
├── tailwind.config.js
├── index.html
└── src/
    ├── main.jsx
    ├── index.css
    ├── dashboard.jsx       # React dashboard
    └── api/
        ├── ai-analyzer.js  # Standalone AI module
        ├── dexscreener.js
        ├── goplus-security.js
        ├── pumpfun.js
        └── solana-onchain.js
```

## Troubleshooting

### "Scanner not running" in dashboard
Make sure `npm run scan` is running in another terminal.

### AI analysis not working
Check that `ANTHROPIC_API_KEY` is set correctly:
```bash
echo $ANTHROPIC_API_KEY
```

### On-chain checks failing
- Verify `SOLANA_RPC_URL` is set
- Check RPC rate limits (Helius free tier: 10 req/s)
- Public RPC (`api.mainnet-beta.solana.com`) has strict limits

### Tailwind styles not loading
Make sure you have `@tailwindcss/postcss` installed:
```bash
npm install @tailwindcss/postcss --save-dev
```

### Module errors
Ensure `"type": "module"` is in package.json (already set).

## Cost Estimation

| Scan Frequency | Tokens/Scan | AI Analyzed | Monthly Cost |
|----------------|-------------|-------------|--------------|
| Every 1 min | ~20 | ~8 | ~$10-15 |
| Every 5 min | ~20 | ~8 | ~$2-3 |
| Every 15 min | ~20 | ~8 | ~$1 |

## Disclaimer

This tool is for educational and research purposes only. Meme tokens are extremely high risk. The AI analysis and signals are not financial advice. Always do your own research and never invest more than you can afford to lose.

## License

ISC
