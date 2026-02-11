/**
 * Database - PostgreSQL Persistence Layer
 *
 * Provides persistent storage for:
 * - Token scan vectors (AgentMemory persistence)
 * - Scammer profiles (HunterAgent persistence)
 * - Predictions (OutcomeLearner tracking)
 * - Learned weights (OutcomeLearner persistence)
 * - Pattern stats (PatternLibrary persistence)
 *
 * PostgreSQL runs on the same server (agents-n-database).
 * Zero network latency for DB queries.
 */

import pg from 'pg';
const { Pool } = pg;

// ============================================================
// Types
// ============================================================

export interface StoredTokenVector {
  token_address: string;
  features: Float32Array; // 29 floats = 116 bytes
  score: number;
  verdict: string;
  creator: string | null;
  flags: string[];
  scanned_at: Date;
}

export interface StoredScammerProfile {
  wallet: string;
  pattern: string;
  confidence: number;
  tokens: string[];
  rugged_tokens: string[];
  connected_wallets: string[];
  evidence: string[];
  first_seen: Date;
  last_seen: Date;
}

export interface StoredPrediction {
  id: string;
  token: string;
  risk_score: number;
  verdict: string;
  features: Float32Array;
  predicted_at: Date;
  outcome: string | null;
  outcome_at: Date | null;
}

export interface StoredWeights {
  feature_weights: number[];
  samples_used: number;
  updated_at: Date;
}

export interface StoredPatternStats {
  pattern_id: string;
  detection_count: number;
  rug_rate: number;
  examples: string[];
  updated_at: Date;
}

// ============================================================
// Database Service
// ============================================================

export class Database {
  private pool: pg.Pool;
  private initialized = false;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL || 'postgresql://localhost:5432/argus_agents',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Log connection errors but don't crash
    this.pool.on('error', (err) => {
      console.error('[Database] Pool error:', err.message);
    });
  }

  /**
   * Initialize database tables (CREATE TABLE IF NOT EXISTS)
   */
  async initialize(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS token_vectors (
          token_address TEXT PRIMARY KEY,
          features BYTEA NOT NULL,
          score REAL NOT NULL DEFAULT 0,
          verdict TEXT NOT NULL DEFAULT 'UNKNOWN',
          creator TEXT,
          flags TEXT[] DEFAULT '{}',
          scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_token_vectors_scanned
          ON token_vectors (scanned_at DESC);

        CREATE INDEX IF NOT EXISTS idx_token_vectors_creator
          ON token_vectors (creator) WHERE creator IS NOT NULL;

        CREATE TABLE IF NOT EXISTS scammer_profiles (
          wallet TEXT PRIMARY KEY,
          pattern TEXT NOT NULL DEFAULT 'UNKNOWN',
          confidence REAL NOT NULL DEFAULT 0,
          tokens TEXT[] DEFAULT '{}',
          rugged_tokens TEXT[] DEFAULT '{}',
          connected_wallets TEXT[] DEFAULT '{}',
          evidence TEXT[] DEFAULT '{}',
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS predictions (
          id TEXT PRIMARY KEY,
          token TEXT NOT NULL,
          risk_score REAL NOT NULL,
          verdict TEXT NOT NULL,
          features BYTEA NOT NULL,
          predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          outcome TEXT,
          outcome_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_predictions_pending
          ON predictions (predicted_at DESC) WHERE outcome IS NULL;

        CREATE INDEX IF NOT EXISTS idx_predictions_token
          ON predictions (token);

        CREATE TABLE IF NOT EXISTS learned_weights (
          id INTEGER PRIMARY KEY DEFAULT 1,
          feature_weights REAL[] NOT NULL,
          samples_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pattern_stats (
          pattern_id TEXT PRIMARY KEY,
          detection_count INTEGER NOT NULL DEFAULT 0,
          rug_rate REAL NOT NULL DEFAULT 0,
          examples TEXT[] DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS positions (
          id TEXT PRIMARY KEY,
          token_address TEXT NOT NULL,
          token_symbol TEXT,
          pool_address TEXT NOT NULL,
          entry_price REAL NOT NULL,
          entry_sol_amount REAL NOT NULL,
          token_amount REAL NOT NULL,
          stop_loss_price REAL NOT NULL,
          take_profit_price REAL NOT NULL,
          current_price REAL,
          status TEXT NOT NULL DEFAULT 'active',
          entry_time BIGINT NOT NULL,
          exit_time BIGINT,
          exit_reason TEXT,
          pnl_sol REAL,
          tx_signature TEXT NOT NULL,
          exit_tx_signature TEXT,
          strategy TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_positions_status
          ON positions (status);

        CREATE INDEX IF NOT EXISTS idx_positions_token
          ON positions (token_address);

        CREATE INDEX IF NOT EXISTS idx_positions_pool
          ON positions (pool_address) WHERE status = 'active';
      `);

      this.initialized = true;
      console.log('[Database] Tables initialized');
    } catch (err) {
      console.error('[Database] Failed to initialize:', (err as Error).message);
      throw err;
    }
  }

  /**
   * Check if database is connected and initialized
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Execute a raw query (for PositionStore and other services)
   */
  async query(text: string, params?: any[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  // ============================================================
  // Token Vectors (AgentMemory persistence)
  // ============================================================

  /**
   * Store or update a token scan vector
   */
  async upsertTokenVector(token: StoredTokenVector): Promise<void> {
    const featuresBuf = Buffer.from(token.features.buffer);

    await this.pool.query(`
      INSERT INTO token_vectors (token_address, features, score, verdict, creator, flags, scanned_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (token_address) DO UPDATE SET
        features = $2, score = $3, verdict = $4, creator = $5, flags = $6, scanned_at = $7
    `, [
      token.token_address,
      featuresBuf,
      token.score,
      token.verdict,
      token.creator,
      token.flags,
      token.scanned_at,
    ]);
  }

  /**
   * Load recent token vectors for memory hydration
   */
  async loadRecentTokenVectors(limit: number = 10000): Promise<StoredTokenVector[]> {
    const { rows } = await this.pool.query(`
      SELECT token_address, features, score, verdict, creator, flags, scanned_at
      FROM token_vectors
      ORDER BY scanned_at DESC
      LIMIT $1
    `, [limit]);

    return rows.map(row => ({
      token_address: row.token_address,
      features: new Float32Array(row.features.buffer, row.features.byteOffset, 29),
      score: row.score,
      verdict: row.verdict,
      creator: row.creator,
      flags: row.flags || [],
      scanned_at: row.scanned_at,
    }));
  }

  /**
   * Find tokens by creator wallet
   */
  async findTokensByCreator(creator: string): Promise<StoredTokenVector[]> {
    const { rows } = await this.pool.query(`
      SELECT token_address, features, score, verdict, creator, flags, scanned_at
      FROM token_vectors
      WHERE creator = $1
      ORDER BY scanned_at DESC
    `, [creator]);

    return rows.map(row => ({
      token_address: row.token_address,
      features: new Float32Array(row.features.buffer, row.features.byteOffset, 29),
      score: row.score,
      verdict: row.verdict,
      creator: row.creator,
      flags: row.flags || [],
      scanned_at: row.scanned_at,
    }));
  }

  /**
   * Get token count
   */
  async getTokenCount(): Promise<number> {
    const { rows } = await this.pool.query('SELECT COUNT(*) as count FROM token_vectors');
    return parseInt(rows[0].count, 10);
  }

  // ============================================================
  // Scammer Profiles (HunterAgent persistence)
  // ============================================================

  /**
   * Store or update a scammer profile
   */
  async upsertScammerProfile(profile: StoredScammerProfile): Promise<void> {
    await this.pool.query(`
      INSERT INTO scammer_profiles (wallet, pattern, confidence, tokens, rugged_tokens, connected_wallets, evidence, first_seen, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (wallet) DO UPDATE SET
        pattern = $2, confidence = $3,
        tokens = $4, rugged_tokens = $5,
        connected_wallets = $6, evidence = $7,
        last_seen = $9
    `, [
      profile.wallet,
      profile.pattern,
      profile.confidence,
      profile.tokens,
      profile.rugged_tokens,
      profile.connected_wallets,
      profile.evidence,
      profile.first_seen,
      profile.last_seen,
    ]);
  }

  /**
   * Get a scammer profile by wallet
   */
  async getScammerProfile(wallet: string): Promise<StoredScammerProfile | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM scammer_profiles WHERE wallet = $1',
      [wallet]
    );
    return rows[0] || null;
  }

  /**
   * Get all scammer profiles
   */
  async getAllScammerProfiles(): Promise<StoredScammerProfile[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM scammer_profiles ORDER BY last_seen DESC'
    );
    return rows;
  }

  /**
   * Get scammer count
   */
  async getScammerCount(): Promise<number> {
    const { rows } = await this.pool.query('SELECT COUNT(*) as count FROM scammer_profiles');
    return parseInt(rows[0].count, 10);
  }

  // ============================================================
  // Predictions (OutcomeLearner tracking)
  // ============================================================

  /**
   * Store a prediction for later outcome tracking
   */
  async storePrediction(prediction: Omit<StoredPrediction, 'outcome' | 'outcome_at'>): Promise<void> {
    const featuresBuf = Buffer.from(prediction.features.buffer);

    await this.pool.query(`
      INSERT INTO predictions (id, token, risk_score, verdict, features, predicted_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
    `, [
      prediction.id,
      prediction.token,
      prediction.risk_score,
      prediction.verdict,
      featuresBuf,
      prediction.predicted_at,
    ]);
  }

  /**
   * Update prediction with outcome
   */
  async updatePredictionOutcome(predictionId: string, outcome: string): Promise<void> {
    await this.pool.query(`
      UPDATE predictions SET outcome = $2, outcome_at = NOW()
      WHERE id = $1
    `, [predictionId, outcome]);
  }

  /**
   * Get predictions pending outcome check (older than minAge, no outcome yet)
   */
  async getPendingPredictions(minAgeMs: number = 24 * 60 * 60 * 1000, limit: number = 10): Promise<StoredPrediction[]> {
    const cutoff = new Date(Date.now() - minAgeMs);

    const { rows } = await this.pool.query(`
      SELECT id, token, risk_score, verdict, features, predicted_at, outcome, outcome_at
      FROM predictions
      WHERE outcome IS NULL AND predicted_at < $1
      ORDER BY predicted_at ASC
      LIMIT $2
    `, [cutoff, limit]);

    return rows.map(row => ({
      id: row.id,
      token: row.token,
      risk_score: row.risk_score,
      verdict: row.verdict,
      features: new Float32Array(row.features.buffer, row.features.byteOffset, 29),
      predicted_at: row.predicted_at,
      outcome: row.outcome,
      outcome_at: row.outcome_at,
    }));
  }

  // ============================================================
  // Learned Weights (OutcomeLearner persistence)
  // ============================================================

  /**
   * Save learned feature weights
   */
  async saveWeights(weights: number[], samplesUsed: number): Promise<void> {
    await this.pool.query(`
      INSERT INTO learned_weights (id, feature_weights, samples_used, updated_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        feature_weights = $1, samples_used = $2, updated_at = NOW()
    `, [weights, samplesUsed]);
  }

  /**
   * Load learned feature weights
   */
  async loadWeights(): Promise<StoredWeights | null> {
    const { rows } = await this.pool.query(
      'SELECT feature_weights, samples_used, updated_at FROM learned_weights WHERE id = 1'
    );

    if (rows.length === 0) return null;

    return {
      feature_weights: rows[0].feature_weights.map(Number),
      samples_used: rows[0].samples_used,
      updated_at: rows[0].updated_at,
    };
  }

  // ============================================================
  // Pattern Stats (PatternLibrary persistence)
  // ============================================================

  /**
   * Save pattern detection stats
   */
  async savePatternStats(stats: StoredPatternStats): Promise<void> {
    await this.pool.query(`
      INSERT INTO pattern_stats (pattern_id, detection_count, rug_rate, examples, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (pattern_id) DO UPDATE SET
        detection_count = $2, rug_rate = $3, examples = $4, updated_at = NOW()
    `, [
      stats.pattern_id,
      stats.detection_count,
      stats.rug_rate,
      stats.examples.slice(0, 100), // Cap at 100 examples
    ]);
  }

  /**
   * Load all pattern stats
   */
  async loadAllPatternStats(): Promise<StoredPatternStats[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM pattern_stats ORDER BY pattern_id'
    );
    return rows;
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Close database connections
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('[Database] Connection pool closed');
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
