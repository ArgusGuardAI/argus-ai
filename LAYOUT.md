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
│   ├── monitor/                # WebSocket Pool Detection ($0/month)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts             # Main entry
│   │       ├── pool-monitor.ts      # Yellowstone gRPC subscriptions
│   │       ├── quick-analyzer.ts    # Fast 2-call token assessment
│   │       ├── alert-manager.ts     # Telegram + Workers alerts
│   │       └── scammer-db.ts        # Local scammer database
│   │
│   ├── agents/                 # Multi-Agent AI System
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts             # Main exports
│   │       ├── start.ts             # Standalone agent runner
│   │       ├── agents/              # Scout, Analyst, Hunter, Trader
│   │       ├── core/                # Coordinator, MessageBus, Memory
│   │       ├── reasoning/           # BitNetEngine, DebateProtocol
│   │       ├── learning/            # PatternLibrary, OutcomeLearner
│   │       └── services/            # LLM, Database, WorkersSync
│   │
│   ├── vault/                  # Secure Key Vault (isolated origin)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       └── vault.ts             # Key storage, signing via postMessage
│   │
│   ├── training/               # ML Training Data Collection
│   │   ├── package.json
│   │   ├── scripts/                 # Data collection scripts
│   │   └── data/                    # Training datasets
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
│   │       │   ├── subscription.ts # Subscription types
│   │       │   └── wallet-reputation.ts # Wallet reputation types
│   │       └── constants/
│   │           └── chains.ts       # Chain constants
│
