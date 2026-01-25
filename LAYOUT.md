solana-safeguard-ai/
├── .env.example                # Environment variables template
├── .gitignore
├── package.json                # Root package.json (workspaces)
├── pnpm-workspace.yaml         # Workspace config
├── turbo.json                  # Turborepo config
├── README.md                   # Project README
├── CLAUDE.md                   # AI development guidance
├── WHITEPAPER.md               # Project whitepaper
├── LAYOUT.md                   # This file
├── LICENSE
│
├── packages/
│   ├── argus/                  # Token Research Dashboard (React + Vite)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── index.html              # Entry HTML
│   │   ├── public/
│   │   │   └── favicon.svg         # Triangle + eye logo
│   │   └── src/
│   │       ├── main.tsx             # Entry point, subdomain-aware routing
│   │       ├── App.tsx              # Main dashboard (token input, analysis, trading)
│   │       ├── index.css            # Global styles + Tailwind
│   │       ├── vite-env.d.ts
│   │       ├── pages/
│   │       │   └── Landing.tsx      # Marketing landing page
│   │       ├── hooks/
│   │       │   └── useAutoTrade.ts  # Trading logic, wallet, positions
│   │       ├── lib/
│   │       │   ├── jupiter.ts       # Jupiter swap integration
│   │       │   └── tradingWallet.ts # Encrypted trading wallet
│   │       └── contexts/
│   │           └── AuthContext.tsx   # Wallet connection + auth tiers
│   │
│   ├── sniper/                 # Token Scanner Backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts             # Main entry
│   │       ├── server.ts            # HTTP + WebSocket server
│   │       ├── cli.ts               # CLI interface
│   │       ├── types.ts             # Type definitions
│   │       ├── engine/
│   │       │   ├── sniper.ts        # Main scanner engine
│   │       │   ├── analyzer.ts      # AI risk analysis
│   │       │   ├── pre-filter.ts    # Trending token pre-filter
│   │       │   ├── launch-filter.ts # New pool launch filter
│   │       │   ├── heuristic-scorer.ts   # Heuristic scoring
│   │       │   ├── onchain-security.ts   # On-chain security checks
│   │       │   └── token-security-api.ts # Token security API
│   │       ├── listeners/
│   │       │   ├── raydium.ts       # Raydium AMM pool listener
│   │       │   ├── meteora.ts       # Meteora DLMM pool listener
│   │       │   ├── dexscreener.ts   # DexScreener trending tokens
│   │       │   ├── pumpfun.ts       # PumpFun token listener
│   │       │   └── geckoterminal.ts # GeckoTerminal listener
│   │       ├── trading/
│   │       │   └── executor.ts      # Trade execution
│   │       └── utils/
│   │           └── helius-budget.ts # Helius API budget tracking
│   │
│   ├── workers/                # Cloudflare Workers API (production)
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts             # Main worker entry + routing
│   │       ├── routes/
│   │       │   ├── sentinel.ts      # /sentinel/analyze (main endpoint)
│   │       │   ├── analyze.ts       # Token analysis logic
│   │       │   ├── jupiter.ts       # Jupiter swap proxy
│   │       │   ├── auth.ts          # Authentication
│   │       │   ├── scores.ts        # Score management
│   │       │   ├── trends.ts        # Trending tokens
│   │       │   ├── graffiti.ts      # Graffiti feature
│   │       │   ├── subscription.ts  # Subscription management
│   │       │   └── wallet-history.ts # Wallet history
│   │       ├── services/
│   │       │   ├── helius.ts        # Helius RPC service
│   │       │   ├── dexscreener.ts   # DexScreener data
│   │       │   ├── together-ai.ts   # Together AI integration
│   │       │   ├── pumpfun.ts       # PumpFun service
│   │       │   ├── solana-data.ts   # Solana data fetching
│   │       │   ├── auth.ts          # Auth service
│   │       │   ├── rate-limit.ts    # Rate limiting
│   │       │   └── supabase.ts      # Supabase client
│   │       ├── prompts/
│   │       │   └── honeypot-prompt.ts # AI analysis prompt
│   │       └── db/
│   │           └── schema.sql       # Database schema
│   │
│   ├── shared/                 # Shared Types & Constants
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/
│   │       │   ├── token.ts         # Token interfaces
│   │       │   ├── ai.ts           # AI response types
│   │       │   ├── honeypot.ts     # Honeypot detection types
│   │       │   ├── graffiti.ts     # Graffiti types
│   │       │   ├── subscription.ts # Subscription types
│   │       │   └── wallet-reputation.ts # Wallet reputation types
│   │       └── constants/
│   │           └── chains.ts       # Chain constants
│
