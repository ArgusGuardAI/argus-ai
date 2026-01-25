# ArgusGuard

**AI-Powered Automated Trading System for Solana Tokens**

ArgusGuard is an automated trading system that scans new tokens on Raydium, Meteora, and DexScreener, analyzes them for risk using AI, and automatically executes trades on approved tokens.

---

## Features

### AI Trading Dashboard (Argus)
- **Real-time Token Feed:** Live stream of new tokens with AI risk scores
- **Automated Trading:** Buy/sell based on configurable risk thresholds
- **Position Tracking:** Real-time P&L with take profit, stop loss, and trailing stop
- **Dedicated Trading Wallet:** Instant execution without popup confirmations
- **3-Column Layout:** Dashboard, positions, settings with activity log

### Risk Analysis Engine
- **8 Risk Categories:** Liquidity, Ownership, Contract, Social, Deployer, Bundle, Holders, Trading
- **4 Severity Levels:** Low, Medium, High, Critical
- **Score Range:** 0-100 (higher = more risk)
- **Risk Levels:** SAFE (0-49), SUSPICIOUS (50-69), DANGEROUS (70-89), SCAM (90-100)

### Token Discovery Sources
- **Raydium:** Real-time pool creation listener via Helius WebSocket
- **Meteora:** DLMM and AMM pool creation detection
- **DexScreener:** Trending tokens and boosted tokens scanner

### Launch Filter (New Pool Protection)
- **Spam Detection:** Filters spam names (test, aaa, scam patterns)
- **Liquidity Bounds:** $400 - $100K for new pools
- **Creator Tracking:** Rejects serial launchers (>3 tokens in 24h)
- **Auto-Blacklist:** Blacklists creators when tokens rug

---

## Project Structure

```
packages/
├── argus/           # AI Trading Dashboard (React + Vite)
│   ├── src/App.tsx      # Main dashboard UI
│   ├── src/hooks/       # useAutoTrade hook
│   └── src/lib/         # Jupiter swap, trading wallet
├── sniper/          # Token Scanner Backend
│   ├── src/engine/      # Scanner, analyzer, launch-filter
│   ├── src/listeners/   # Raydium, Meteora, DexScreener
│   ├── src/trading/     # Trade executor
│   └── src/server.ts    # WebSocket server
└── workers/         # Cloudflare Workers API
    ├── src/routes/      # API endpoints
    └── src/services/    # Helius, DexScreener, Together AI
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- API Keys: Together AI, Helius

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/argusguard.git
cd argusguard

# Install dependencies
pnpm install
```

### Environment Setup

Create `packages/sniper/.env`:

```env
HELIUS_API_KEY=your-helius-api-key
TOGETHER_AI_API_KEY=your-together-ai-key
```

### Development

```bash
# Start the Scanner Backend (Terminal 1)
cd packages/sniper
pnpm dev
# Runs at http://localhost:8788

# Start the Trading Dashboard (Terminal 2)
cd packages/argus
pnpm dev
# Runs at http://localhost:3000
```

---

## Data Flow

```
Raydium WebSocket ──┐
                    │
Meteora WebSocket ──┼──▶ Launch Filter ──▶ AI Analysis ──▶ Dashboard
                    │
DexScreener API ────┘
        │
        ▼
┌───────────────┐
│   Sniper      │ ──▶ Pre-filter (fast checks)
│   Backend     │ ──▶ Launch filter (new pools)
└───────┬───────┘ ──▶ AI Analysis (risk score)
        │ WebSocket
        ▼
┌───────────────┐
│   Argus       │ ──▶ Display in Live Feed
│  Dashboard    │ ──▶ Auto-trade if approved
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Jupiter     │ ──▶ Execute swap
│     API       │ ──▶ Return signature
└───────────────┘
```

---

## Trading System

### Auto-Trade Flow
```
1. Listener detects new pool (Raydium/Meteora) or trending token (DexScreener)
2. Launch filter checks (spam, liquidity, creator reputation)
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

### Safety Limits
- `maxRiskScore` - Only trade low-risk tokens (default: 40)
- `reserveBalanceSol` - Always keep minimum SOL
- `maxTradesPerSession` - Limit trades (0 = unlimited)

### Auto-Sell Settings
- **Take Profit**: Sell when position up X%
- **Stop Loss**: Sell when position down X%
- **Trailing Stop**: Sell when drops X% from peak

---

## Risk Scoring

### Base Score Factors
| Factor | Score Impact |
|--------|--------------|
| Token age <1 day | +20 |
| Unknown deployer | +15 |
| Missing socials | +10 |
| Single wallet >50% | +25 |
| Bundle detected | +10-20 |

### Score Caps (Established Tokens)
| Market Cap | Age | Max Score |
|------------|-----|-----------|
| $100M+ | 30+ days | 35 |
| $50M+ | 14+ days | 45 |
| $10M+ | 7+ days | 55 |

---

## API Reference

### WebSocket Events (ws://localhost:8788/ws)

```typescript
// Server → Client
{ type: 'NEW_TOKEN', data: { address, name, analysis } }
{ type: 'ANALYSIS_RESULT', data: { tokenAddress, riskScore, riskLevel } }
{ type: 'STATS_UPDATE', data: { tokensAnalyzed, approved, rejected } }

// Client → Server
{ type: 'SUBSCRIBE', channels: ['tokens', 'analysis'] }
```

### REST API

```
GET    /api/status              # Scanner status
GET    /api/stats               # Analysis statistics
POST   /api/analyze             # Manual token analysis
GET    /api/launch-filter/stats # Launch filter statistics
```

---

## Configuration

### Sniper Environment Variables

```env
HELIUS_API_KEY=          # Required for RPC and WebSocket
TOGETHER_AI_API_KEY=     # Required for AI analysis
```

### Dashboard Settings (via UI)

| Setting | Default | Description |
|---------|---------|-------------|
| Buy Amount | 0.01 SOL | Amount per trade |
| Slippage | 15% | Max slippage tolerance |
| Max Risk Score | 40 | Only buy if score <= this |
| Take Profit | 50% | Sell when up this % |
| Stop Loss | 20% | Sell when down this % |
| Trailing Stop | 15% | Sell when drops from peak |

---

## Security

- Dedicated trading wallet (separate from main wallet)
- Private key encrypted in localStorage
- Never commit API keys or secrets
- Use `.env` for local development (gitignored)

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Links

- [Whitepaper](./WHITEPAPER.md)
- [Development Guide](./CLAUDE.md)

**Built by ArgusGuard**
