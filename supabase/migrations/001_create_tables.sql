-- Token analysis scores cache
CREATE TABLE IF NOT EXISTS token_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token_address TEXT UNIQUE NOT NULL,
  score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  red_flags TEXT[] DEFAULT '{}',
  positive_indicators TEXT[] DEFAULT '{}',
  summary TEXT,
  data_sources TEXT[] DEFAULT '{}',
  raw_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trade history for executed buys/sells
CREATE TABLE IF NOT EXISTS trade_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token_address TEXT NOT NULL,
  action TEXT NOT NULL,
  amount_sol DECIMAL NOT NULL,
  amount_tokens DECIMAL,
  signature TEXT NOT NULL,
  score_at_trade INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_token_scores_address ON token_scores(token_address);
CREATE INDEX IF NOT EXISTS idx_token_scores_updated ON token_scores(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_history_created ON trade_history(created_at DESC);
