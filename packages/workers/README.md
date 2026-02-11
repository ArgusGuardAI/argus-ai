# Argus Workers API

Cloudflare Workers API for Argus AI token analysis and trading.

## Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Health check |
| `/sentinel/analyze` | POST | Token analysis (main endpoint) |
| `/agents/status` | GET | Agent system status |
| `/agents/activity` | GET | Recent agent events |
| `/agents/stats` | GET | Aggregate statistics |
| `/agents/command` | POST | Send command to agents |
| `/onchain/analyze/:token` | GET | Pure on-chain analysis |
| `/onchain/holders/:token` | GET | Top token holders |
| `/onchain/pools/:token` | GET | Liquidity pools |
| `/onchain/bundle/:token` | GET | Bundle detection |
| `/jupiter/*` | * | Jupiter swap proxy |
| `/auth/*` | * | Wallet authentication |
| `/training/*` | POST | Training data collection |

## Token Analysis

```bash
curl -X POST https://argusguard-api.hermosillo-jessie.workers.dev/sentinel/analyze \
  -H "Content-Type: application/json" \
  -H "X-Wallet-Address: YOUR_WALLET" \
  -d '{"tokenAddress": "TOKEN_MINT_ADDRESS"}'
```

### Response

```json
{
  "tokenInfo": {
    "name": "Token Name",
    "symbol": "TKN",
    "address": "...",
    "decimals": 9
  },
  "analysis": {
    "score": 75,
    "signal": "CAUTION",
    "verdict": "Medium risk token...",
    "risks": ["High holder concentration", "New token"],
    "positives": ["LP locked", "Mint disabled"]
  },
  "holderDistribution": {
    "top10Percent": 45.2,
    "holders": [...]
  },
  "bundleInfo": {
    "detected": true,
    "confidence": "MEDIUM",
    "walletCount": 5
  }
}
```

## Rate Limiting

| Tier | Limit | Requirement |
|------|-------|-------------|
| Free | 10/day | Default |
| Holder | Unlimited | 1,000+ $ARGUS |
| Pro | Unlimited | 10,000+ $ARGUS |

Response headers:
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1706486400000
X-User-Tier: free
```

## Environment Variables

### Required

```bash
wrangler secret put TOGETHER_AI_API_KEY   # AI analysis
wrangler secret put SOLANA_RPC_URL        # http://144.XX.XX.XXX:8899
```

### Optional

```bash
wrangler secret put HELIUS_API_KEY        # DAS API (creator detection)
wrangler secret put JUPITER_API_KEY       # Jupiter swap
wrangler secret put TELEGRAM_BOT_TOKEN    # Alerts
wrangler secret put TELEGRAM_CHANNEL_ID
wrangler secret put ADMIN_SECRET          # Training data access
```

## Local Development

```bash
# Create .dev.vars with secrets
cp .dev.vars.example .dev.vars

# Start dev server
pnpm dev  # localhost:8787
```

## Deployment

```bash
# Deploy to Cloudflare
pnpm deploy
# or
npx wrangler deploy
```

## KV Namespace

Bind `SCAN_CACHE` for caching:

```bash
wrangler kv:namespace create SCAN_CACHE
wrangler kv:namespace create SCAN_CACHE --preview
```

Update `wrangler.toml` with the returned IDs.

## D1 Database

Bundle network tracking:

```bash
wrangler d1 create argus-bundle-network
wrangler d1 execute argus-bundle-network --file=./src/db/bundle-network.sql
```

## Cron Jobs

Rug detection runs every 6 hours:

```toml
[triggers]
crons = ["0 */6 * * *"]
```

## Feature Compression

See [FEATURE-COMPRESSION.md](./FEATURE-COMPRESSION.md) for the 17,000x compression engine.

## Architecture

```
src/
├── index.ts           # Main entry, route mounting
├── routes/
│   ├── sentinel.ts    # Token analysis
│   ├── agents.ts      # Agent status/commands
│   ├── onchain.ts     # Pure on-chain analysis
│   ├── jupiter.ts     # Swap proxy
│   ├── auth.ts        # Wallet auth
│   └── training.ts    # ML data collection
└── services/
    ├── multi-rpc.ts       # Smart RPC routing
    ├── onchain-analyzer.ts # On-chain data extraction
    ├── feature-extractor.ts # 29-dim feature vectors
    ├── ai-provider.ts      # Together AI / BitNet
    ├── rate-limit.ts       # Rate limiting
    └── helius.ts           # DAS API (optional)
```
