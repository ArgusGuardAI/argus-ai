#!/usr/bin/env npx tsx
/**
 * Training Data Export Script
 *
 * Exports training data from the API in various formats for model training.
 *
 * Usage:
 *   ADMIN_SECRET=xxx pnpm export --format jsonl --output ./data/training.jsonl
 */

import { Command } from 'commander';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const TRAINING_API = 'https://argusguard-api.hermosillo-jessie.workers.dev/training';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

interface TrainingExample {
  id: string;
  timestamp: number;
  input: {
    token: { address: string; name: string; symbol: string; ageHours: number };
    market: { marketCap: number; liquidity: number; volume24h: number; priceChange24h: number };
    security: { mintRevoked: boolean; freezeRevoked: boolean; lpLockedPercent: number };
    trading: { buys24h: number; sells24h: number; buys1h: number; sells1h: number };
    holders: { count: number; top10Percent: number; whaleCount: number; topWhalePercent: number };
    bundle: {
      detected: boolean;
      count: number;
      confidence: string;
      controlPercent: number;
      qualityScore: number;
      qualityAssessment: string;
      avgWalletAgeDays: number;
    };
    creator: {
      identified: boolean;
      walletAgeDays: number;
      tokensCreated: number;
      ruggedTokens: number;
      currentHoldingsPercent: number;
    } | null;
    devActivity: {
      hasSold: boolean;
      percentSold: number;
      currentHoldingsPercent: number;
    } | null;
    washTrading: {
      detected: boolean;
      percent: number;
      bundleBuys: number;
      organicBuys: number;
    } | null;
  };
  aiOutput: {
    riskScore: number;
    riskLevel: string;
    confidence: number;
    summary: string;
    flags: Array<{ type: string; severity: string; message: string }>;
  };
  finalOutput: {
    riskScore: number;
    riskLevel: string;
    wasOverridden: boolean;
    overrideReason?: string;
  };
  outcome?: {
    rugged: boolean;
    ruggedAt?: number;
    priceDropPercent?: number;
    liquidityDropPercent?: number;
  };
}

// Fetch training data
async function fetchTrainingData(options: {
  limit?: number;
  outcomeKnown?: boolean;
}): Promise<TrainingExample[]> {
  if (!ADMIN_SECRET) {
    throw new Error('ADMIN_SECRET environment variable required');
  }

  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.outcomeKnown !== undefined) params.set('outcomeKnown', String(options.outcomeKnown));

  const url = `${TRAINING_API}/export?${params.toString()}`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${await response.text()}`);
  }

  return await response.json() as TrainingExample[];
}

// Convert to JSONL for fine-tuning
function toJSONL(examples: TrainingExample[]): string {
  return examples.map(ex => {
    // Simplified training format
    const record = {
      // Input features (numerical)
      features: extractFeatures(ex.input),

      // Target outputs
      target: {
        score: ex.finalOutput.riskScore,
        level: ex.finalOutput.riskLevel,
        // Use outcome if known, otherwise use guardrails score as proxy
        label: ex.outcome?.rugged !== undefined
          ? (ex.outcome.rugged ? 1 : 0)
          : (ex.finalOutput.riskScore >= 70 ? 1 : 0),
      },

      // Metadata (not used in training, but useful for analysis)
      meta: {
        id: ex.id,
        symbol: ex.input.token.symbol,
        wasOverridden: ex.finalOutput.wasOverridden,
        outcomeKnown: !!ex.outcome,
      },
    };

    return JSON.stringify(record);
  }).join('\n');
}

// Extract numerical features from input
function extractFeatures(input: TrainingExample['input']): number[] {
  return [
    // Token age (normalized 0-1 over 7 days)
    Math.min(input.token.ageHours / 168, 1),

    // Market features (log-scaled)
    Math.log10(Math.max(1, input.market.marketCap)) / 10,
    Math.log10(Math.max(1, input.market.liquidity)) / 8,
    Math.log10(Math.max(1, input.market.volume24h)) / 8,
    (input.market.priceChange24h + 100) / 200,

    // Security (binary)
    input.security.mintRevoked ? 1 : 0,
    input.security.freezeRevoked ? 1 : 0,
    input.security.lpLockedPercent / 100,

    // Trading ratios
    input.trading.buys24h / Math.max(1, input.trading.buys24h + input.trading.sells24h),
    Math.min(1, input.trading.buys24h / 1000),

    // Holder concentration
    Math.min(1, input.holders.count / 1000),
    input.holders.top10Percent / 100,
    input.holders.whaleCount / 10,
    input.holders.topWhalePercent / 100,

    // Bundle features
    input.bundle.detected ? 1 : 0,
    input.bundle.count / 50,
    input.bundle.controlPercent / 100,
    input.bundle.qualityScore / 100,
    input.bundle.avgWalletAgeDays / 30,
    encodeConfidence(input.bundle.confidence),
    encodeAssessment(input.bundle.qualityAssessment),

    // Creator features
    input.creator ? 1 : 0,
    input.creator?.walletAgeDays ? Math.min(1, input.creator.walletAgeDays / 365) : 0,
    input.creator?.tokensCreated ? Math.min(1, input.creator.tokensCreated / 20) : 0,
    input.creator?.ruggedTokens ? Math.min(1, input.creator.ruggedTokens / 5) : 0,
    input.creator?.currentHoldingsPercent ? input.creator.currentHoldingsPercent / 100 : 0,

    // Dev activity
    input.devActivity?.hasSold ? 1 : 0,
    input.devActivity?.percentSold ? input.devActivity.percentSold / 100 : 0,
    input.devActivity?.currentHoldingsPercent ? input.devActivity.currentHoldingsPercent / 100 : 0,

    // Wash trading
    input.washTrading?.detected ? 1 : 0,
    input.washTrading?.percent ? input.washTrading.percent / 100 : 0,
  ];
}

function encodeConfidence(confidence: string): number {
  switch (confidence) {
    case 'HIGH': return 1;
    case 'MEDIUM': return 0.66;
    case 'LOW': return 0.33;
    default: return 0;
  }
}

function encodeAssessment(assessment: string): number {
  switch (assessment) {
    case 'LIKELY_LEGIT': return 0;
    case 'NEUTRAL': return 0.33;
    case 'SUSPICIOUS': return 0.66;
    case 'VERY_SUSPICIOUS': return 1;
    default: return 0.5;
  }
}

// Convert to CSV for analysis
function toCSV(examples: TrainingExample[]): string {
  const headers = [
    'id', 'symbol', 'timestamp',
    'age_hours', 'market_cap', 'liquidity', 'volume_24h', 'price_change_24h',
    'mint_revoked', 'freeze_revoked', 'lp_locked_pct',
    'buys_24h', 'sells_24h', 'buy_ratio',
    'holder_count', 'top10_pct', 'whale_count', 'top_whale_pct',
    'bundle_detected', 'bundle_count', 'bundle_control_pct', 'bundle_quality',
    'creator_known', 'creator_rugs',
    'wash_trading', 'wash_pct',
    'ai_score', 'final_score', 'was_overridden',
    'outcome_known', 'rugged',
  ];

  const rows = examples.map(ex => [
    ex.id,
    ex.input.token.symbol,
    ex.timestamp,
    ex.input.token.ageHours,
    ex.input.market.marketCap,
    ex.input.market.liquidity,
    ex.input.market.volume24h,
    ex.input.market.priceChange24h,
    ex.input.security.mintRevoked ? 1 : 0,
    ex.input.security.freezeRevoked ? 1 : 0,
    ex.input.security.lpLockedPercent,
    ex.input.trading.buys24h,
    ex.input.trading.sells24h,
    ex.input.trading.sells24h > 0 ? ex.input.trading.buys24h / ex.input.trading.sells24h : 0,
    ex.input.holders.count,
    ex.input.holders.top10Percent,
    ex.input.holders.whaleCount,
    ex.input.holders.topWhalePercent,
    ex.input.bundle.detected ? 1 : 0,
    ex.input.bundle.count,
    ex.input.bundle.controlPercent,
    ex.input.bundle.qualityScore,
    ex.input.creator ? 1 : 0,
    ex.input.creator?.ruggedTokens || 0,
    ex.input.washTrading?.detected ? 1 : 0,
    ex.input.washTrading?.percent || 0,
    ex.aiOutput.riskScore,
    ex.finalOutput.riskScore,
    ex.finalOutput.wasOverridden ? 1 : 0,
    ex.outcome ? 1 : 0,
    ex.outcome?.rugged ? 1 : 0,
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// Print statistics
function printStats(examples: TrainingExample[]): void {
  const stats = {
    total: examples.length,
    withOutcome: examples.filter(e => e.outcome).length,
    rugged: examples.filter(e => e.outcome?.rugged).length,
    overridden: examples.filter(e => e.finalOutput.wasOverridden).length,
    byLevel: { SAFE: 0, SUSPICIOUS: 0, DANGEROUS: 0, SCAM: 0 },
    bundleDetected: examples.filter(e => e.input.bundle.detected).length,
    washTrading: examples.filter(e => e.input.washTrading?.detected).length,
  };

  for (const ex of examples) {
    const level = ex.finalOutput.riskLevel as keyof typeof stats.byLevel;
    if (stats.byLevel[level] !== undefined) {
      stats.byLevel[level]++;
    }
  }

  console.log('\n=== TRAINING DATA STATISTICS ===\n');
  console.log(`Total examples:     ${stats.total}`);
  console.log(`With outcome:       ${stats.withOutcome}`);
  console.log(`Known rugged:       ${stats.rugged}`);
  console.log(`Guardrails override: ${stats.overridden}`);
  console.log(`Bundle detected:    ${stats.bundleDetected}`);
  console.log(`Wash trading:       ${stats.washTrading}`);
  console.log(`\nBy risk level:`);
  console.log(`  SAFE:       ${stats.byLevel.SAFE}`);
  console.log(`  SUSPICIOUS: ${stats.byLevel.SUSPICIOUS}`);
  console.log(`  DANGEROUS:  ${stats.byLevel.DANGEROUS}`);
  console.log(`  SCAM:       ${stats.byLevel.SCAM}`);
}

// Main export function
async function exportData(options: {
  format: string;
  output: string;
  limit?: number;
  outcomeOnly: boolean;
  stats: boolean;
}) {
  console.log('='.repeat(50));
  console.log('ARGUS AI - TRAINING DATA EXPORT');
  console.log('='.repeat(50));

  // Fetch data
  console.log('\nFetching training data...');
  const examples = await fetchTrainingData({
    limit: options.limit,
    outcomeKnown: options.outcomeOnly ? true : undefined,
  });

  console.log(`Fetched ${examples.length} examples`);

  if (examples.length === 0) {
    console.log('\nNo training data found. Run backfill first.');
    return;
  }

  // Print stats
  if (options.stats) {
    printStats(examples);
  }

  // Convert to format
  let content: string;
  switch (options.format) {
    case 'jsonl':
      content = toJSONL(examples);
      break;
    case 'csv':
      content = toCSV(examples);
      break;
    case 'json':
    default:
      content = JSON.stringify(examples, null, 2);
      break;
  }

  // Write output
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, content);
    console.log(`\nExported to: ${options.output}`);
  } else {
    console.log('\n' + content);
  }
}

// CLI
const program = new Command();

program
  .name('export-data')
  .description('Export training data for model training')
  .option('-f, --format <type>', 'Output format: json, jsonl, csv', 'jsonl')
  .option('-o, --output <path>', 'Output file path')
  .option('-l, --limit <number>', 'Limit number of examples')
  .option('--outcome-only', 'Only export examples with known outcomes', false)
  .option('-s, --stats', 'Print statistics', true)
  .action(async (options) => {
    await exportData({
      format: options.format,
      output: options.output,
      limit: options.limit ? parseInt(options.limit) : undefined,
      outcomeOnly: options.outcomeOnly,
      stats: options.stats,
    });
  });

program.parse();
