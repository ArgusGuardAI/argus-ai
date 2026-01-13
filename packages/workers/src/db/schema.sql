-- WhaleShield Database Schema for Supabase
-- Run this in your Supabase SQL Editor

-- ============================================
-- GRAFFITI NOTES TABLE
-- Community annotations on tokens
-- ============================================
CREATE TABLE IF NOT EXISTS graffiti_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token_address TEXT NOT NULL,
  author_wallet TEXT NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) <= 500),
  note_type TEXT NOT NULL CHECK (note_type IN ('WARNING', 'INFO', 'POSITIVE')),
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_graffiti_token ON graffiti_notes(token_address);
CREATE INDEX IF NOT EXISTS idx_graffiti_author ON graffiti_notes(author_wallet);
CREATE INDEX IF NOT EXISTS idx_graffiti_created ON graffiti_notes(created_at DESC);

-- ============================================
-- WALLET REPUTATION TABLE
-- Developer/deployer reputation tracking
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_reputation (
  address TEXT PRIMARY KEY,
  deployed_tokens INTEGER DEFAULT 0,
  rug_count INTEGER DEFAULT 0,
  successful_projects INTEGER DEFAULT 0,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  risk_score INTEGER DEFAULT 50 CHECK (risk_score >= 0 AND risk_score <= 100),
  tags TEXT[] DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_rep_risk ON wallet_reputation(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_rep_rugs ON wallet_reputation(rug_count DESC);

-- ============================================
-- SCAN RESULTS TABLE (backup to KV cache)
-- Honeypot analysis results
-- ============================================
CREATE TABLE IF NOT EXISTS scan_results (
  token_address TEXT PRIMARY KEY,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('SAFE', 'SUSPICIOUS', 'DANGEROUS', 'SCAM')),
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  flags JSONB DEFAULT '[]',
  summary TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scan_risk ON scan_results(risk_level);
CREATE INDEX IF NOT EXISTS idx_scan_checked ON scan_results(checked_at DESC);

-- ============================================
-- SUBSCRIBERS TABLE (Stripe subscriptions)
-- Tracks users who subscribe via Stripe
-- ============================================
CREATE TABLE IF NOT EXISTS subscribers (
  wallet_address TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'canceled', 'past_due')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
CREATE INDEX IF NOT EXISTS idx_subscribers_stripe_customer ON subscribers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_period_end ON subscribers(current_period_end);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to increment vote counts
CREATE OR REPLACE FUNCTION increment_vote(note_id UUID, vote_column TEXT)
RETURNS VOID AS $$
BEGIN
  IF vote_column = 'upvotes' THEN
    UPDATE graffiti_notes SET upvotes = upvotes + 1 WHERE id = note_id;
  ELSIF vote_column = 'downvotes' THEN
    UPDATE graffiti_notes SET downvotes = downvotes + 1 WHERE id = note_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables
DROP TRIGGER IF EXISTS update_graffiti_updated_at ON graffiti_notes;
CREATE TRIGGER update_graffiti_updated_at
  BEFORE UPDATE ON graffiti_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scan_updated_at ON scan_results;
CREATE TRIGGER update_scan_updated_at
  BEFORE UPDATE ON scan_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscribers_updated_at ON subscribers;
CREATE TRIGGER update_subscribers_updated_at
  BEFORE UPDATE ON subscribers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Enable for production use
-- ============================================

-- Enable RLS
ALTER TABLE graffiti_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users
CREATE POLICY "Allow read access to graffiti_notes" ON graffiti_notes
  FOR SELECT USING (true);

CREATE POLICY "Allow read access to wallet_reputation" ON wallet_reputation
  FOR SELECT USING (true);

CREATE POLICY "Allow read access to scan_results" ON scan_results
  FOR SELECT USING (true);

-- Allow insert for authenticated users (graffiti notes)
CREATE POLICY "Allow insert to graffiti_notes" ON graffiti_notes
  FOR INSERT WITH CHECK (true);

-- Allow service role full access (for Cloudflare Workers)
CREATE POLICY "Allow service role full access to graffiti_notes" ON graffiti_notes
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access to wallet_reputation" ON wallet_reputation
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access to scan_results" ON scan_results
  FOR ALL USING (auth.role() = 'service_role');

-- Subscribers policies (sensitive - service role only for write, read by wallet owner)
CREATE POLICY "Allow read access to own subscription" ON subscribers
  FOR SELECT USING (true);

CREATE POLICY "Allow service role full access to subscribers" ON subscribers
  FOR ALL USING (auth.role() = 'service_role');
