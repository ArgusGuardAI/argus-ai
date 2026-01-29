/**
 * Training Data Collection Service
 *
 * Collects Sentinel analysis data for BitNet fine-tuning:
 * - Input features (token data, bundles, holders, etc.)
 * - AI output (initial score, flags)
 * - Guardrails output (adjusted score)
 * - Outcomes (did it rug?)
 */

import { TokenAnalysisInput, TokenAnalysisOutput, TrainingExample } from './ai-provider';

// ============================================
// DATABASE SCHEMA (for D1)
// ============================================

export const TRAINING_DATA_SCHEMA = `
-- Training examples for BitNet fine-tuning
CREATE TABLE IF NOT EXISTS training_examples (
  id TEXT PRIMARY KEY,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  timestamp INTEGER NOT NULL,

  -- Serialized input/output as JSON
  input_json TEXT NOT NULL,
  ai_output_json TEXT NOT NULL,
  final_score INTEGER NOT NULL,
  final_level TEXT NOT NULL,
  was_overridden INTEGER DEFAULT 0,
  override_reason TEXT,

  -- Outcome tracking (updated later)
  outcome_known INTEGER DEFAULT 0,
  rugged INTEGER,
  rugged_at INTEGER,
  price_drop_percent REAL,
  liquidity_drop_percent REAL,

  -- Metadata
  provider TEXT DEFAULT 'together',
  model TEXT,
  inference_time_ms INTEGER,

  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_training_token ON training_examples(token_address);
CREATE INDEX IF NOT EXISTS idx_training_timestamp ON training_examples(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_training_outcome ON training_examples(outcome_known, rugged);
CREATE INDEX IF NOT EXISTS idx_training_score ON training_examples(final_score);
`;

// ============================================
// SAVE TRAINING EXAMPLE
// ============================================

export async function saveTrainingExample(
  db: D1Database,
  tokenAddress: string,
  tokenSymbol: string,
  input: TokenAnalysisInput,
  aiOutput: TokenAnalysisOutput,
  finalScore: number,
  finalLevel: string,
  wasOverridden: boolean,
  overrideReason: string | undefined,
  provider: string,
  model: string,
  inferenceTimeMs: number
): Promise<string> {
  const id = `${tokenAddress}-${Date.now()}`;
  const timestamp = Date.now();

  await db.prepare(`
    INSERT INTO training_examples (
      id, token_address, token_symbol, timestamp,
      input_json, ai_output_json,
      final_score, final_level, was_overridden, override_reason,
      provider, model, inference_time_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    tokenAddress,
    tokenSymbol,
    timestamp,
    JSON.stringify(input),
    JSON.stringify(aiOutput),
    finalScore,
    finalLevel,
    wasOverridden ? 1 : 0,
    overrideReason || null,
    provider,
    model,
    inferenceTimeMs
  ).run();

  console.log(`[TrainingData] Saved example ${id}`);
  return id;
}

// ============================================
// UPDATE OUTCOME (when we learn if token rugged)
// ============================================

export async function updateOutcome(
  db: D1Database,
  tokenAddress: string,
  rugged: boolean,
  priceDropPercent?: number,
  liquidityDropPercent?: number
): Promise<number> {
  const result = await db.prepare(`
    UPDATE training_examples
    SET outcome_known = 1,
        rugged = ?,
        rugged_at = CASE WHEN ? = 1 THEN strftime('%s', 'now') * 1000 ELSE NULL END,
        price_drop_percent = ?,
        liquidity_drop_percent = ?,
        updated_at = strftime('%s', 'now')
    WHERE token_address = ? AND outcome_known = 0
  `).bind(
    rugged ? 1 : 0,
    rugged ? 1 : 0,
    priceDropPercent || null,
    liquidityDropPercent || null,
    tokenAddress
  ).run();

  const updated = result.meta?.changes || 0;
  console.log(`[TrainingData] Updated ${updated} examples for ${tokenAddress} - rugged: ${rugged}`);
  return updated;
}

// ============================================
// EXPORT TRAINING DATA AS JSONL
// ============================================

export interface ExportOptions {
  minScore?: number;
  maxScore?: number;
  outcomeKnown?: boolean;
  rugged?: boolean;
  limit?: number;
  offset?: number;
  startDate?: number;
  endDate?: number;
}

export async function exportTrainingData(
  db: D1Database,
  options: ExportOptions = {}
): Promise<TrainingExample[]> {
  let query = `SELECT * FROM training_examples WHERE 1=1`;
  const params: (string | number | null)[] = [];

  if (options.minScore !== undefined) {
    query += ` AND final_score >= ?`;
    params.push(options.minScore);
  }

  if (options.maxScore !== undefined) {
    query += ` AND final_score <= ?`;
    params.push(options.maxScore);
  }

  if (options.outcomeKnown !== undefined) {
    query += ` AND outcome_known = ?`;
    params.push(options.outcomeKnown ? 1 : 0);
  }

  if (options.rugged !== undefined) {
    query += ` AND rugged = ?`;
    params.push(options.rugged ? 1 : 0);
  }

  if (options.startDate !== undefined) {
    query += ` AND timestamp >= ?`;
    params.push(options.startDate);
  }

  if (options.endDate !== undefined) {
    query += ` AND timestamp <= ?`;
    params.push(options.endDate);
  }

  query += ` ORDER BY timestamp DESC`;

  if (options.limit !== undefined) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  if (options.offset !== undefined) {
    query += ` OFFSET ?`;
    params.push(options.offset);
  }

  const stmt = db.prepare(query);
  const result = await stmt.bind(...params).all();

  const examples: TrainingExample[] = [];

  for (const row of result.results as Array<{
    id: string;
    token_address: string;
    timestamp: number;
    input_json: string;
    ai_output_json: string;
    final_score: number;
    final_level: string;
    was_overridden: number;
    override_reason: string | null;
    outcome_known: number;
    rugged: number | null;
    rugged_at: number | null;
    price_drop_percent: number | null;
    liquidity_drop_percent: number | null;
  }>) {
    const example: TrainingExample = {
      id: row.id,
      timestamp: row.timestamp,
      input: JSON.parse(row.input_json),
      aiOutput: JSON.parse(row.ai_output_json),
      finalOutput: {
        riskScore: row.final_score,
        riskLevel: row.final_level,
        wasOverridden: row.was_overridden === 1,
        overrideReason: row.override_reason || undefined,
      },
    };

    if (row.outcome_known === 1) {
      example.outcome = {
        rugged: row.rugged === 1,
        ruggedAt: row.rugged_at || undefined,
        priceDropPercent: row.price_drop_percent || undefined,
        liquidityDropPercent: row.liquidity_drop_percent || undefined,
      };
    }

    examples.push(example);
  }

  return examples;
}

// ============================================
// EXPORT AS JSONL (for fine-tuning)
// ============================================

export async function exportAsJSONL(
  db: D1Database,
  options: ExportOptions = {}
): Promise<string> {
  const examples = await exportTrainingData(db, options);

  // Convert to JSONL format suitable for fine-tuning
  const lines = examples.map(ex => {
    // Simplified format for training
    const trainingRecord = {
      input: ex.input,
      output: {
        riskScore: ex.finalOutput.riskScore,
        riskLevel: ex.finalOutput.riskLevel,
        flags: ex.aiOutput.flags,
        summary: ex.aiOutput.summary,
      },
      // Include outcome as label if known
      label: ex.outcome?.rugged !== undefined
        ? (ex.outcome.rugged ? 'RUGGED' : 'SAFE')
        : 'UNKNOWN',
    };
    return JSON.stringify(trainingRecord);
  });

  return lines.join('\n');
}

// ============================================
// GET TRAINING STATS
// ============================================

export async function getTrainingStats(db: D1Database): Promise<{
  total: number;
  withOutcome: number;
  rugged: number;
  safe: number;
  byScoreRange: { range: string; count: number }[];
  byProvider: { provider: string; count: number }[];
  recentCount: number;
}> {
  const totalResult = await db.prepare(`SELECT COUNT(*) as count FROM training_examples`).first();
  const outcomeResult = await db.prepare(`SELECT COUNT(*) as count FROM training_examples WHERE outcome_known = 1`).first();
  const ruggedResult = await db.prepare(`SELECT COUNT(*) as count FROM training_examples WHERE rugged = 1`).first();
  const safeResult = await db.prepare(`SELECT COUNT(*) as count FROM training_examples WHERE rugged = 0 AND outcome_known = 1`).first();

  const scoreRanges = await db.prepare(`
    SELECT
      CASE
        WHEN final_score < 40 THEN 'SAFE (0-39)'
        WHEN final_score < 60 THEN 'SUSPICIOUS (40-59)'
        WHEN final_score < 80 THEN 'DANGEROUS (60-79)'
        ELSE 'SCAM (80-100)'
      END as range,
      COUNT(*) as count
    FROM training_examples
    GROUP BY range
    ORDER BY MIN(final_score)
  `).all();

  const providers = await db.prepare(`
    SELECT provider, COUNT(*) as count
    FROM training_examples
    GROUP BY provider
  `).all();

  const recentResult = await db.prepare(`
    SELECT COUNT(*) as count FROM training_examples
    WHERE timestamp > ?
  `).bind(Date.now() - 24 * 60 * 60 * 1000).first();

  return {
    total: (totalResult as { count: number })?.count || 0,
    withOutcome: (outcomeResult as { count: number })?.count || 0,
    rugged: (ruggedResult as { count: number })?.count || 0,
    safe: (safeResult as { count: number })?.count || 0,
    byScoreRange: (scoreRanges.results as Array<{ range: string; count: number }>).map(r => ({
      range: r.range,
      count: r.count,
    })),
    byProvider: (providers.results as Array<{ provider: string; count: number }>).map(r => ({
      provider: r.provider,
      count: r.count,
    })),
    recentCount: (recentResult as { count: number })?.count || 0,
  };
}

// ============================================
// INITIALIZE DATABASE SCHEMA
// ============================================

export async function initTrainingDataSchema(db: D1Database): Promise<void> {
  const statements = TRAINING_DATA_SCHEMA.split(';').filter(s => s.trim());

  for (const statement of statements) {
    if (statement.trim()) {
      await db.prepare(statement).run();
    }
  }

  console.log('[TrainingData] Schema initialized');
}
