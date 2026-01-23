# Argus AI Trading Dashboard

Automated AI-powered trading dashboard for Solana tokens.

## Features

- Real-time token scanning from Pump.fun
- AI-powered risk analysis (0-100 score)
- Fully automated trading with dedicated wallet
- Auto-sell: Take profit, stop loss, trailing stop
- Position tracking with live P&L
- SaaS-style dashboard UI

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the dashboard
pnpm dev
```

Dashboard runs at `http://localhost:3000`

**Note:** Requires the sniper backend running at `localhost:8788`

## Pages

### Dashboard
- Start/Stop scanner
- Toggle Auto-Trade ON/OFF
- View balance, positions, P&L
- Live token feed with risk scores
- Activity log

### Positions
- Active positions with live P&L
- Manual sell button per position
- Sell All / Clear All buttons
- Sold positions history

### Settings
- Trading wallet management (create/import/export)
- Buy settings (amount, slippage, risk score)
- Auto-sell settings (take profit, stop loss, trailing stop)

## Trading Wallet

Argus uses a dedicated trading wallet for automated trades:

- Stored encrypted in browser localStorage
- Signs transactions instantly (no popups)
- Your main wallet stays completely safe
- Export private key anytime for backup

## Auto-Trade Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Buy Amount | 0.05 SOL | Amount per trade |
| Max Slippage | 5% | Maximum slippage tolerance |
| Max Risk Score | 40 | Only trade tokens scoring <= this |
| Reserve Balance | 0.1 SOL | Always keep this amount |
| Max Trades | Unlimited | Set to 0 for unlimited |

## Auto-Sell Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Take Profit | 100% | Sell when up this percentage |
| Stop Loss | 30% | Sell when down this percentage |
| Trailing Stop | 20% | Sell when drops this % from peak |

## Tech Stack

- React 18
- Vite
- Tailwind CSS
- Jupiter API (swaps)
- Solana Web3.js
