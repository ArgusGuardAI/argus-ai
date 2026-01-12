solana-safeguard-ai/
├── .env.example                # Environment variables template
├── .gitignore
├── package.json                # Root package.json (scripts/workspaces)
├── pnpm-workspace.yaml         # Workspace config
├── turbo.json                  # Turborepo config (optional)
├── README.md
├── LICENSE
│
├── packages/
│   ├── shared/                 # Shared code between Bot and Web
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types/
│   │       │   ├── token.ts    # Token interfaces
│   │       │   └── ai.ts       # AI Response interfaces (LegitimacyScore, etc.)
│   │       ├── constants/
│   │       │   └── chains.ts
│   │       └── utils/
│   │
│   ├── backend/                # The Core "Bot" Logic
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts        # Main entry point
│   │       ├── config.ts       # Loads env vars
│   │       │
│   │       ├── services/
│   │       │   ├── discovery.ts
│   │       │   │   # Connects to DexScreener/GeckoTerminal APIs
│   │       │   │   # Emits "NewTokenFound" events
│   │       │   │
│   │       │   ├── vetting.ts
│   │       │   │   # The "Brain": Fetches website HTML, calls Together AI
│   │       │   │   # Prompts: "Is this a rug?"
│   │       │   │   # Returns: Legitimacy Score
│   │       │   │
│   │       │   ├── execution.ts
│   │       │   │   # The "Hands": Solana Web3.js / Jupiter integration
│   │       │   │   # Constructs and signs transactions
│   │       │   │
│   │       │   └── rpc.ts
│   │       │       # Wrapper for Helius/QuickNode connection
│   │       │
│   │       ├── db/
│   │       │   # SQLite or Postgres for caching scores (don't re-scan)
│   │       │
│   │       └── prompts/
│   │           ├── system-prompt.txt
│   │           # The "You are a crypto security expert..." text
│   │
│   └── frontend/               # The Dashboard (Next.js)
│       ├── package.json
│       ├── next.config.js
│       └── src/
│           ├── app/
│           │   ├── page.tsx              # Landing page
│           │   ├── check-token/
│           │   │   └── page.tsx          # Manual check UI
│           │   ├── dashboard/
│           │   │   └── page.tsx          # Automation UI
│           │   └── api/
│           │       └── analyze/
│           │           └── route.ts       # Proxy to Backend Vetting Service
│           │
│           ├── components/
│           │   ├── TokenCard.tsx         # Displays Score/Red Flags
│           │   └── ScoreGauge.tsx        # Visual meter
│           │
│           └── hooks/
│               └── useWallet.ts          # Phantom connection
│
├── infra/
│   ├── docker/
│   │   └── Dockerfile.backend
│   └── helm/                     # Kubernetes charts (optional for later)