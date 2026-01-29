-- Bundle Network Map Schema for Cloudflare D1
-- Tracks bundle wallets across all token scans to identify repeat offenders

-- Track individual wallet addresses flagged as bundle participants
CREATE TABLE IF NOT EXISTS bundle_wallets (
  address TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,      -- Unix timestamp (seconds)
  token_count INTEGER DEFAULT 1,        -- How many tokens this wallet appeared in
  rug_count INTEGER DEFAULT 0,          -- How many of those tokens rugged
  total_holdings_pct REAL DEFAULT 0,    -- Sum of holdings % across all tokens
  last_seen_at INTEGER NOT NULL,
  risk_score INTEGER DEFAULT 50         -- Calculated: (rug_count / token_count) * 100
);

-- Track wallet <-> token associations
CREATE TABLE IF NOT EXISTS bundle_wallet_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  holdings_pct REAL,                    -- % of supply this wallet held at detection
  confidence TEXT,                       -- HIGH/MEDIUM/LOW
  detected_at INTEGER NOT NULL,          -- Unix timestamp (seconds)
  rugged INTEGER DEFAULT 0,              -- 0=unknown, 1=rugged, 2=safe
  rugged_at INTEGER,                     -- When it rugged (if known)
  FOREIGN KEY (wallet_address) REFERENCES bundle_wallets(address),
  UNIQUE(wallet_address, token_address)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_wallet_tokens_wallet ON bundle_wallet_tokens(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_tokens_token ON bundle_wallet_tokens(token_address);
CREATE INDEX IF NOT EXISTS idx_wallets_risk ON bundle_wallets(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_token_count ON bundle_wallets(token_count DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tokens_detected ON bundle_wallet_tokens(detected_at DESC);
