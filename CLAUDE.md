# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhaleShield is an AI-powered browser extension that provides a security overlay for Pump.fun and Crypto Twitter. It uses Together AI to analyze Solana smart contracts for honeypots and scams, combined with a community "Graffiti" annotation system. Access requires holding 1,000 $WHALESHIELD tokens.

## Build & Run Commands

```bash
# Install dependencies
pnpm install

# Run extension in development mode
pnpm dev

# Build extension for production
pnpm build

# Run Cloudflare Workers locally
pnpm dev:workers

# Deploy Workers to Cloudflare
pnpm deploy:workers
```

## Architecture

**Project Structure:**
```
packages/
├── extension/       # @whaleshield/extension - Plasmo browser extension
├── workers/         # @whaleshield/workers - Cloudflare Workers API
└── shared/          # @whaleshield/shared - Types and constants
```

**Extension (`packages/extension/`):**
- `src/contents/` - Content scripts for Pump.fun and Twitter DOM injection
- `src/background/` - Service worker for wallet connection and RPC calls
- `src/components/` - React components for overlays (Paint, Graffiti notes)
- `src/popup/` - Extension popup UI (wallet connect, status)

**Cloudflare Workers (`packages/workers/`):**
- `src/routes/analyze.ts` - Contract analysis endpoint (calls Together AI)
- `src/routes/graffiti.ts` - CRUD for community annotations
- `src/routes/wallet-history.ts` - Developer wallet reputation lookup
- `src/lib/cache.ts` - Cloudflare KV caching logic

**Shared (`packages/shared/`):**
- `src/types/` - TypeScript interfaces for API responses
- `src/constants/` - Token mint address, thresholds

## The Triple-Layer Shield

1. **AI Sentinel** - Together AI analyzes contracts for hidden sell taxes (honeypots)
2. **Graffiti Layer** - Encrypted community notes on tokens (stored in Supabase)
3. **Identity Layer** - Wallet history showing developer's previous rugs

## Data Flow

1. User visits Pump.fun token page
2. Extension checks wallet for 1,000 $WHALESHIELD balance via RPC
3. If verified, extension fetches Graffiti notes from Supabase
4. Extension sends contract address to Cloudflare Worker
5. Worker checks KV cache; if miss, calls Together AI for analysis
6. Extension paints UI (Green = safe, Red = honeypot) and overlays notes

## Key Environment Variables

```bash
# Extension (in .env or extension storage)
WHALESHIELD_MINT=<token-mint-address>
MIN_BALANCE=1000

# Cloudflare Workers (in wrangler.toml or secrets)
TOGETHER_AI_API_KEY=your-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Cloudflare KV namespace binding
KV_CACHE=whaleshield-cache
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/shared/src/types/analysis.ts` | HoneypotResult, GraffitiNote interfaces |
| `packages/workers/src/routes/analyze.ts` | Core AI honeypot detection logic |
| `packages/workers/src/prompts/system-prompt.txt` | Together AI system prompt |
| `packages/extension/src/contents/pumpfun.tsx` | Pump.fun DOM overlay injection |
| `packages/extension/src/components/PaintOverlay.tsx` | Visual Red/Green paint component |
| `packages/extension/src/background/balance.ts` | Token balance verification |

## Database (Supabase)

- `graffiti_notes` table - Encrypted community annotations
- `wallet_reputation` table - Cached developer history
- `scan_results` table - Backup of AI analysis results
