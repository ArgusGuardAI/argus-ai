# WhaleShield Sniper Bot Architecture

## Overview

A web-based "smart sniper" that combines WhaleShield's AI safety analysis with automated trading. Only snipes tokens that pass honeypot detection.

## Core Differentiator

**Traditional Sniper:** Buys blindly → Gets rugged
**WhaleShield Sniper:** Analyze first → Buy only if SAFE → Avoid rugs

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        WEB DASHBOARD                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Wallet   │ │ Token    │ │ Active   │ │ Trade    │           │
│  │ Connect  │ │ Discovery│ │ Snipes   │ │ History  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SNIPER ENGINE (Backend)                      │
│                                                                  │
│  ┌────────────────┐    ┌────────────────┐    ┌───────────────┐ │
│  │ Token Listener │───▶│ Safety Filter  │───▶│ Trade Executor│ │
│  │                │    │ (WhaleShield)  │    │               │ │
│  │ • New pools    │    │ • AI Analysis  │    │ • Jupiter SDK │ │
│  │ • Pump.fun     │    │ • Liquidity    │    │ • Priority tx │ │
│  │ • Raydium      │    │ • Holder check │    │ • Jito bundles│ │
│  └────────────────┘    └────────────────┘    └───────────────┘ │
│           │                    │                     │          │
│           ▼                    ▼                     ▼          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    WEBSOCKET FEED                           ││
│  │         Real-time updates to dashboard                      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA SOURCES                                │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Helius   │ │ Jupiter  │ │ Pump.fun │ │ Raydium  │           │
│  │ RPC/WS   │ │ API      │ │ WebSocket│ │ Events   │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/
├── sniper/                    # NEW PACKAGE
│   ├── package.json
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── listeners/
│   │   │   ├── pump-fun.ts    # Listen for new pump.fun tokens
│   │   │   ├── raydium.ts     # Listen for new Raydium pools
│   │   │   └── token-stream.ts# Unified token stream
│   │   ├── engine/
│   │   │   ├── analyzer.ts    # Calls WhaleShield API
│   │   │   ├── decision.ts    # Buy/pass logic
│   │   │   └── executor.ts    # Trade execution
│   │   ├── trading/
│   │   │   ├── jupiter.ts     # Jupiter swap integration
│   │   │   ├── wallet.ts      # Wallet management
│   │   │   └── priority.ts    # Priority fees & Jito
│   │   └── api/
│   │       ├── routes.ts      # REST endpoints
│   │       └── websocket.ts   # Real-time updates
│   └── web/                   # Dashboard (React)
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           ├── components/
│           └── hooks/
├── workers/                   # Existing - reuse analyze endpoint
├── extension/                 # Existing
└── shared/                    # Existing - add sniper types
```

---

## Data Flow

### 1. Token Discovery
```
Pump.fun WebSocket ──┐
                     ├──▶ Token Stream ──▶ New Token Event
Raydium Events ──────┘
```

### 2. Safety Analysis (< 2 seconds)
```
New Token ──▶ WhaleShield API ──▶ Risk Score + Flags
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
              SAFE (< 50)                           DANGEROUS (≥ 50)
                    │                                       │
                    ▼                                       ▼
              Continue to buy                         Skip token
```

### 3. Trade Execution
```
SAFE Token ──▶ Check user settings ──▶ Build swap tx ──▶ Sign & Send
                    │                        │
                    ▼                        ▼
              • Max buy amount         • Jupiter quote
              • Slippage              • Priority fee
              • Token filters         • Jito bundle (optional)
```

### 4. Position Management
```
Open Position ──▶ Monitor ──▶ Exit conditions met? ──▶ Sell
                     │
                     ├── Take profit (e.g., 2x)
                     ├── Stop loss (e.g., -30%)
                     ├── Time limit (e.g., 1 hour)
                     └── WhaleShield re-scan (risk increased?)
```

---

## User Configuration

```typescript
interface SniperConfig {
  // Wallet
  walletPrivateKey: string;      // Encrypted, stored securely

  // Buy settings
  buyAmountSol: number;          // e.g., 0.1 SOL per snipe
  maxSlippageBps: number;        // e.g., 1000 = 10%
  priorityFeeLamports: number;   // e.g., 100000 = 0.0001 SOL
  useJito: boolean;              // Use Jito bundles for speed

  // Safety filters (WhaleShield)
  maxRiskScore: number;          // e.g., 40 = only buy if score < 40
  requireLiquidity: number;      // e.g., 5000 = min $5k liquidity

  // Token filters
  allowPumpFun: boolean;
  allowRaydium: boolean;
  blacklistCreators: string[];   // Known scammer wallets

  // Exit strategy
  takeProfitPercent: number;     // e.g., 100 = sell at 2x
  stopLossPercent: number;       // e.g., 30 = sell if down 30%
  maxHoldTimeMinutes: number;    // e.g., 60 = auto-sell after 1 hour
}
```

---

## API Endpoints

### REST API

```
POST   /api/sniper/start         # Start sniping
POST   /api/sniper/stop          # Stop sniping
GET    /api/sniper/status        # Current status
GET    /api/sniper/positions     # Open positions
POST   /api/sniper/sell/:token   # Manual sell
GET    /api/sniper/history       # Trade history
PUT    /api/sniper/config        # Update settings
```

### WebSocket Events

```typescript
// Server → Client
{ type: 'NEW_TOKEN', data: { address, name, analysis } }
{ type: 'SNIPE_ATTEMPT', data: { token, status, txSignature } }
{ type: 'POSITION_UPDATE', data: { token, pnl, currentPrice } }
{ type: 'TRADE_EXECUTED', data: { type: 'BUY'|'SELL', details } }

// Client → Server
{ type: 'SUBSCRIBE', channels: ['tokens', 'positions'] }
{ type: 'MANUAL_SELL', tokenAddress: '...' }
```

---

## Security Considerations

1. **Private Key Handling**
   - Never store raw private keys
   - Use encrypted storage (e.g., Web Crypto API)
   - Consider hardware wallet support (Ledger)

2. **Rate Limiting**
   - Prevent rapid-fire buys draining wallet
   - Max X snipes per minute

3. **Spending Limits**
   - Max daily spend in SOL
   - Max per-token allocation

4. **Audit Trail**
   - Log all decisions and trades
   - Track why each token was bought/skipped

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js + Hono (or Fastify) |
| WebSocket | ws or Socket.io |
| Database | SQLite (local) or Supabase |
| Blockchain | @solana/web3.js |
| DEX | @jup-ag/api |
| Frontend | React + TailwindCSS |
| Real-time | WebSocket + React Query |

---

## MVP Scope (v0.1)

### Phase 1: Core Engine
- [ ] Pump.fun token listener
- [ ] WhaleShield analysis integration
- [ ] Jupiter swap execution
- [ ] Basic CLI interface

### Phase 2: Web Dashboard
- [ ] Wallet connect (Phantom)
- [ ] Real-time token feed
- [ ] Manual buy/sell buttons
- [ ] Position tracking

### Phase 3: Automation
- [ ] Auto-snipe based on config
- [ ] Take profit / stop loss
- [ ] Notifications (Telegram/Discord)

---

## Revenue Model Options

1. **$WHALESHIELD token gate** - Hold X tokens to access sniper
2. **Subscription** - Monthly fee for sniper access
3. **Performance fee** - Small % of profitable trades
4. **Freemium** - Free manual mode, paid auto-snipe

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| User loses funds | Clear warnings, spending limits, paper trading mode |
| Bot gets frontrun | Jito bundles, private mempools |
| API rate limits | Caching, multiple RPC endpoints |
| Legal concerns | Clear ToS, user responsible for trades |
