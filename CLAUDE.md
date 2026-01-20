# CLAUDE.md

Development guidance for AI assistants working on the ArgusGuard codebase.

---

## Project Overview

**ArgusGuard** is an AI-powered browser extension that provides security analysis for Solana tokens on Pump.fun and DexScreener. It detects honeypots, rug pulls, and scam indicators using Together AI for analysis and Helius for on-chain data.

### Core Value Proposition
- Instant risk scoring (0-100) for any Solana token
- Community "Graffiti" notes visible to token holders
- Creator wallet history tracking
- Bundle detection for coordinated attacks

---

## Architecture

```
packages/
├── extension/       # Plasmo browser extension (React)
│   ├── src/contents/   # Content scripts for Pump.fun, DexScreener
│   ├── src/popup/      # Extension popup UI
│   └── src/background/ # Service worker
├── workers/         # Cloudflare Workers API (Hono)
│   ├── src/routes/     # API endpoints
│   ├── src/services/   # External API integrations
│   └── src/prompts/    # AI system prompts
└── shared/          # Shared types and constants
    └── src/types/      # TypeScript interfaces
```

---

## Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm dev:workers          # Start Workers locally
pnpm dev:extension        # Start extension dev server
pnpm dev                  # Start all packages

# Build & Deploy
pnpm build                # Build all packages
pnpm deploy:workers       # Deploy to Cloudflare
```

---

## Key Files

### Workers Package (`packages/workers/`)

| File | Purpose |
|------|---------|
| `src/routes/analyze.ts` | Main analysis endpoint, orchestrates all data fetching and AI analysis |
| `src/services/together-ai.ts` | Together AI integration, response parsing, retry logic |
| `src/services/helius.ts` | Helius DAS API for token metadata, creator analysis, bundle detection |
| `src/services/dexscreener.ts` | Market data: price, volume, liquidity, age, socials |
| `src/services/pumpfun.ts` | Pump.fun bonding curve data, creator info |
| `src/services/solana-data.ts` | On-chain holder analysis via Solana RPC |
| `src/prompts/honeypot-prompt.ts` | AI system prompt with scoring rules |

### Analysis Pipeline (analyze.ts)

```
1. Receive token address
2. Check KV cache (return if hit)
3. Fetch data in parallel:
   - DexScreener (market data)
   - Pump.fun (bonding curve)
   - Helius (metadata, authorities)
4. Analyze creator wallet history
5. Detect bundle patterns
6. Build context string
7. Call Together AI
8. Apply hardcoded rules (caps, minimums)
9. Cache result (KV + Supabase)
```

---

## Risk Analysis System

### Risk Levels
| Level | Score | Color | Meaning |
|-------|-------|-------|---------|
| SAFE | 0-49 | Green | Low risk |
| SUSPICIOUS | 50-69 | Yellow | Caution |
| DANGEROUS | 70-89 | Orange | High risk |
| SCAM | 90-100 | Red | Critical |

### Flag Types
```typescript
type FlagType =
  | 'LIQUIDITY'   // LP locks, liquidity depth
  | 'OWNERSHIP'   // Mint/freeze authority
  | 'CONTRACT'    // Bonding curve, program issues
  | 'SOCIAL'      // Website, Twitter, Telegram
  | 'DEPLOYER'    // Wallet age, history, rug count
  | 'BUNDLE'      // Coordinated transactions
  | 'HOLDERS'     // Concentration risk
  | 'TRADING';    // Buy/sell patterns

type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
```

### Scoring Rules

**Base Score Factors:**
- Token age <1 day: +20
- Unknown deployer: +15
- Missing socials: +10
- Single wallet >50%: +25
- Bundle detected: +10-20

**Score Caps (established tokens):**
- $100M+ MC, 30+ days: max 35
- $50M+ MC, 14+ days: max 45
- $10M+ MC, 7+ days: max 55

---

## Environment Variables

### Workers (.dev.vars)
```env
TOGETHER_AI_API_KEY=     # Required
TOGETHER_AI_MODEL=       # Default: meta-llama/Llama-3.3-70B-Instruct-Turbo
SUPABASE_URL=            # Required
SUPABASE_ANON_KEY=       # Required
HELIUS_API_KEY=          # Required for full analysis
```

### Setting Production Secrets
```bash
wrangler secret put TOGETHER_AI_API_KEY
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put HELIUS_API_KEY
```

---

## AI Prompt Engineering

Located in `src/prompts/honeypot-prompt.ts`:

### Anti-Hallucination Rules
- Only cite data explicitly in context
- Say "UNKNOWN" for missing data
- Never invent percentages or statistics

### User-Facing Messages
- No internal scoring formulas
- Human-readable flag messages
- Good: "Deployer wallet could not be identified"
- Bad: "Unknown deployer = +15 to score"

### Social Link Verification
- Check for "Website:", "Twitter:", "Telegram:" with URLs
- Only flag missing socials if NO URLs present

---

## Data Sources

| Source | Data Provided |
|--------|---------------|
| **DexScreener** | Market cap, liquidity, volume, age, socials |
| **Helius DAS** | Token metadata, authorities, supply |
| **Helius Transactions** | Creator history, bundle detection |
| **Solana RPC** | Holder distribution, concentration |
| **Pump.fun** | Bonding curve, creator address |

---

## Common Issues & Fixes

### "Analysis Failed" Response
- Check Together AI API key validity
- Verify model ID exists (try `meta-llama/Llama-3.3-70B-Instruct-Turbo`)
- Check `together-ai.ts` parsing logic

### Missing/Zero Holder Data
- Requires HELIUS_API_KEY for accurate data
- Without Helius, falls back to basic RPC (less accurate)

### AI Hallucination
- Check `honeypot-prompt.ts` for missing rules
- Verify context string contains cited data
- Add explicit "DO NOT" instructions if needed

### False "No Social Links" Flag
- AI may ignore socials in context
- Check SOCIAL LINKS section in prompt
- Verify DexScreener is returning social URLs

---

## Testing

```bash
# Test analysis endpoint
curl -X POST http://localhost:8787/analyze \
  -H "Content-Type: application/json" \
  -d '{"tokenAddress": "TOKEN_ADDRESS", "forceRefresh": true}'

# Check health
curl http://localhost:8787/health
```

### Test Tokens
- **BONK** (established): `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`
- **ARC** (pump.fun graduated): `61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump`

---

## Database Schema (Supabase)

```sql
CREATE TABLE graffiti_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address TEXT NOT NULL,
  author_wallet TEXT NOT NULL,
  content TEXT NOT NULL,
  note_type TEXT CHECK (note_type IN ('WARNING', 'INFO', 'POSITIVE')),
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scan_results (
  token_address TEXT PRIMARY KEY,
  risk_score INTEGER,
  risk_level TEXT,
  flags JSONB,
  summary TEXT,
  checked_at TIMESTAMPTZ
);
```

---

## Code Style

- TypeScript strict mode
- Hono for Workers routing
- React + Tailwind for extension UI
- pnpm workspaces monorepo
- No emojis in code unless user requests

---

## Security

- Never commit `.dev.vars` or API keys
- Use `wrangler secret` for production
- Validate token addresses (base58, correct length)
- Rate limit endpoints in production
