# Argus AI - Token Research Dashboard

Manual token research tool for Solana with AI-powered analysis and one-click trading.

## Live

- **Dashboard**: https://app.argusguard.io
- **Landing Page**: https://argusguard.io

## Features

- **Token Analysis**: Paste any token address for comprehensive research
- **Security Checks**: Mint/freeze authority status, LP lock percentage
- **Market Data**: Price, market cap, liquidity, volume, price changes with sparkline
- **Holder Distribution**: Top 10 holders with visual bar chart
- **Bundle Detection**: Identifies coordinated wallet clusters (highlighted in red)
- **Trading Activity**: Buy/sell counts and ratio
- **AI Verdict**: Risk score (0-100) with STRONG_BUY/BUY/WATCH/HOLD/AVOID signal
- **One-Click Buy**: Jupiter swap with configurable amounts
- **Position Tracking**: Active positions with P&L, auto-sell support
- **Trading Wallet**: Dedicated encrypted wallet with backup safety
- **Watchlist**: Save tokens for later
- **Recent Searches**: Last 10 analyzed tokens

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the dashboard
pnpm dev
```

Dashboard runs at `http://localhost:3000`

For full local development:
```bash
# Terminal 1: Start Workers API
cd ../workers && pnpm dev    # localhost:8787

# Terminal 2: Start Vault (for trading)
cd ../vault && pnpm dev      # localhost:3001

# Terminal 3: Start dashboard
pnpm dev                     # localhost:3000
```

In production, the dashboard uses the Cloudflare Workers API.

## Deployment

```bash
pnpm build
npx wrangler pages deploy dist --project-name argusguard-app
```

## Trading Wallet

- Stored encrypted in browser localStorage
- Signs transactions instantly (no popup confirmations)
- Backup modal shown on wallet creation (must confirm)
- Export/Import private key support
- Styled delete confirmation modal

## Auto-Sell Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Take Profit | 100% | Sell when up this percentage |
| Stop Loss | 30% | Sell when down this percentage |
| Trailing Stop | 20% | Sell when drops this % from peak |

## Tech Stack

- React 18
- Vite
- Tailwind CSS (dark theme)
- TypeScript
- Jupiter API (swaps)
- Solana Web3.js
- Cloudflare Pages (hosting)
