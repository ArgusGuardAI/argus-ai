# WhaleShield

**AI-Powered Security Layer for Solana Memecoins**

WhaleShield is a browser extension that protects traders from honeypots, rug pulls, and scams on Pump.fun and DexScreener. It combines real-time AI analysis with community-driven intelligence to provide instant risk assessment before you trade.

---

## Features

### Risk Analysis Engine
- **8 Risk Categories:** Liquidity, Ownership, Contract, Social, Deployer, Bundle, Holders, Trading
- **4 Severity Levels:** Low, Medium, High, Critical
- **Score Range:** 0-100 (higher = more risk)
- **Risk Levels:** SAFE (0-49), SUSPICIOUS (50-69), DANGEROUS (70-89), SCAM (90-100)

### Data Sources
- **DexScreener:** Market cap, liquidity, volume, age, socials
- **Helius DAS API:** Token metadata, authorities, transaction history
- **On-chain RPC:** Holder distribution, supply concentration
- **Pump.fun API:** Bonding curve status, creator info

### Detection Capabilities
- Holder concentration analysis (non-LP wallets)
- Bundle detection (coordinated same-slot transactions)
- Creator wallet history (previous rugs)
- Authority status (mint/freeze)
- Social presence verification

---

## Project Structure

```
packages/
├── extension/     # @whaleshield/extension - Plasmo browser extension
├── workers/       # @whaleshield/workers - Cloudflare Workers API
├── shared/        # @whaleshield/shared - Types and constants
└── sniper/        # Trading bot dashboard (experimental)
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- Cloudflare account (for Workers)
- API Keys: Together AI, Helius, Supabase

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/whaleshield.git
cd whaleshield

# Install dependencies
pnpm install

# Copy environment files
cp packages/workers/.dev.vars.example packages/workers/.dev.vars
```

### Environment Setup

Edit `packages/workers/.dev.vars`:

```env
TOGETHER_AI_API_KEY=your-together-ai-key
TOGETHER_AI_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
HELIUS_API_KEY=your-helius-api-key
```

### Development

```bash
# Start Cloudflare Workers locally
pnpm dev:workers

# Start browser extension (in separate terminal)
pnpm dev:extension

# Run all packages
pnpm dev
```

### Testing the API

```bash
# Analyze a token
curl -X POST http://localhost:8787/analyze \
  -H "Content-Type: application/json" \
  -d '{"tokenAddress": "YOUR_TOKEN_ADDRESS"}'

# Force refresh (bypass cache)
curl -X POST http://localhost:8787/analyze \
  -H "Content-Type: application/json" \
  -d '{"tokenAddress": "YOUR_TOKEN_ADDRESS", "forceRefresh": true}'
```

### Production Deployment

```bash
# Deploy Workers to Cloudflare
pnpm deploy:workers

# Build extension for production
pnpm build:extension
```

---

## API Reference

### POST /analyze

Analyzes a Solana token for risk indicators.

**Request:**
```json
{
  "tokenAddress": "string (required)",
  "forceRefresh": "boolean (optional, bypasses cache)"
}
```

**Response:**
```json
{
  "tokenAddress": "string",
  "riskLevel": "SAFE | SUSPICIOUS | DANGEROUS | SCAM",
  "riskScore": "number (0-100)",
  "confidence": "number (0-100)",
  "flags": [
    {
      "type": "LIQUIDITY | OWNERSHIP | CONTRACT | SOCIAL | DEPLOYER | BUNDLE | HOLDERS | TRADING",
      "severity": "LOW | MEDIUM | HIGH | CRITICAL",
      "message": "string"
    }
  ],
  "summary": "string",
  "checkedAt": "number (timestamp)",
  "cached": "boolean"
}
```

### GET /analyze/:tokenAddress

Returns cached analysis result without triggering new analysis.

### GET /health

Health check endpoint.

---

## Configuration

### Cloudflare Workers Secrets

```bash
wrangler secret put TOGETHER_AI_API_KEY
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put HELIUS_API_KEY
```

### KV Namespace

```bash
wrangler kv:namespace create SCAN_CACHE
wrangler kv:namespace create SCAN_CACHE --preview
```

Update `wrangler.toml` with the returned namespace IDs.

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system diagrams.

**Key Components:**
- **Extension:** Content scripts inject risk overlays on Pump.fun/DexScreener
- **Workers API:** Serverless analysis engine with KV caching
- **AI Engine:** Together AI for intelligent risk assessment
- **Data Layer:** Helius for on-chain data, DexScreener for market data

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

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Run `pnpm lint` before committing
- Add tests for new features
- Update documentation as needed

---

## Security

- Never commit API keys or secrets
- Use `.dev.vars` for local development (gitignored)
- Use `wrangler secret` for production secrets
- Report vulnerabilities to security@whaleshield.io

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Links

- [Whitepaper](./WHITEPAPER.md)
- [Architecture](./ARCHITECTURE.md)
- [Development Guide](./CLAUDE.md)

**Built by the WhaleShield Protocol**
