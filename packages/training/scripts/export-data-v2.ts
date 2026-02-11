#!/usr/bin/env npx tsx
/**
 * Training Data V2 Export — 29-Feature ScoutAgent-Aligned Layout
 *
 * Remaps existing 31-feature training data to the 29-feature layout
 * that ScoutAgent.extractFeatures() produces at runtime.
 *
 * Old 31-feature layout (export-data.ts):
 *   [0]  tokenAge          [1] marketCapLog     [2] liquidityLog    [3] volumeLog
 *   [4]  priceChangeNorm   [5] mintRevoked      [6] freezeRevoked   [7] lpLocked
 *   [8]  buyRatio24h       [9] activityLevel    [10] holderCountNorm
 *   [11] top10Pct          [12] whaleCountNorm  [13] topWhalePct
 *   [14] bundleDetected    [15] bundleCountNorm [16] bundleControlPct
 *   [17] bundleQuality     [18] bundleAvgAge    [19] bundleConfidence
 *   [20] bundleAssessment  [21] creatorKnown    [22] creatorWalletAge
 *   [23] creatorTokens     [24] creatorRugs     [25] creatorHoldings
 *   [26] devHasSold        [27] devPercentSold  [28] devCurrentHoldings
 *   [29] washDetected      [30] washPercent
 *
 * New 29-feature layout (ScoutAgent.extractFeatures()):
 *   [0-4]   Market:   liquidityLog, volumeToLiquidity, marketCapLog, priceVelocity, volumeLog
 *   [5-10]  Holders:  holderCountLog, top10Concentration, gini, freshWalletRatio, whaleCount, topWhalePercent
 *   [11-14] Security: mintDisabled, freezeDisabled, lpLocked, lpBurned
 *   [15-19] Bundle:   detected, countNorm, controlPercent, confidence, quality
 *   [20-23] Trading:  buyRatio24h, buyRatio1h, activityLevel, momentum
 *   [24-25] Time:     ageDecay, tradingRecency
 *   [26-28] Creator:  identified, rugHistory, holdings
 *
 * Dropped from old: devActivity (3), washTrading (2), bundleAvgAge, bundleAssessment
 * Added (as defaults): gini, freshWalletRatio, lpBurned, tradingRecency
 *
 * Usage:
 *   npx tsx scripts/export-data-v2.ts --input data/training-20260129.jsonl --output data/training-v2.jsonl
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface OldRecord {
  features: number[]; // 31 features
  target: {
    score: number;
    level: string;
    label: number;
  };
  meta: {
    id: string;
    symbol: string;
    wasOverridden: boolean;
    outcomeKnown: boolean;
  };
}

/**
 * Remap a 31-feature vector to the 29-feature ScoutAgent layout.
 *
 * Where exact data isn't available, we use reasonable defaults
 * that match ScoutAgent's own defaults/placeholders.
 */
function remapFeatures(old: number[]): number[] {
  if (old.length !== 31) {
    throw new Error(`Expected 31 features, got ${old.length}`);
  }

  const features = new Array(29).fill(0);

  // ==========================================
  // Market features (0-4)
  // ==========================================

  // [0] liquidityLog: old[2] is already log10(liquidity)/8
  features[0] = old[2];

  // [1] volumeToLiquidity: derive from log-scaled volume and liquidity
  //     volume = 10^(old[3]*8), liquidity = 10^(old[2]*8)
  //     ratio = min(volume/liquidity, 5) / 5
  const volumeRaw = Math.pow(10, old[3] * 8);
  const liquidityRaw = Math.pow(10, old[2] * 8);
  features[1] = Math.min(volumeRaw / Math.max(liquidityRaw, 1), 5) / 5;

  // [2] marketCapLog: old[1] is already log10(marketCap)/10
  features[2] = old[1];

  // [3] priceVelocity: old[4] = (priceChange + 100) / 200
  //     priceChange = old[4]*200 - 100
  //     priceVelocity = clamp(priceChange/100, -1, 1)
  const priceChange = old[4] * 200 - 100;
  features[3] = Math.max(-1, Math.min(1, priceChange / 100));

  // [4] volumeLog: old[3] is already log10(volume)/8
  features[4] = old[3];

  // ==========================================
  // Holder features (5-10)
  // ==========================================

  // [5] holderCountLog: old[10] = min(holderCount/1000, 1)
  //     holderCount ~ old[10]*1000 (approximate inverse)
  //     holderCountLog = min(log10(holderCount+1)/5, 1)
  const holderCount = old[10] * 1000;
  features[5] = Math.min(1, Math.log10(holderCount + 1) / 5);

  // [6] top10Concentration: old[11] = top10Percent/100
  features[6] = old[11];

  // [7] giniCoefficient: not available in old data
  //     Use 0.5 (neutral) — will learn around this center
  features[7] = 0.5;

  // [8] freshWalletRatio: not available
  //     ScoutAgent also uses 0.2 placeholder at runtime
  features[8] = 0.2;

  // [9] whaleCount: old[12] = whaleCount/10
  features[9] = old[12];

  // [10] topWhalePercent: old[13] = topWhalePercent/100
  features[10] = old[13];

  // ==========================================
  // Security features (11-14)
  // ==========================================

  // [11] mintDisabled: old[5] = mintRevoked (1 = revoked = disabled)
  features[11] = old[5];

  // [12] freezeDisabled: old[6] = freezeRevoked (1 = revoked = disabled)
  features[12] = old[6];

  // [13] lpLocked: old[7] = lpLockedPercent/100
  //      ScoutAgent: lpLockedPct > 50 ? 1 : lpLockedPct/100
  //      Apply same threshold transform
  features[13] = old[7] > 0.5 ? 1 : old[7];

  // [14] lpBurned: not available in old data, use 0
  features[14] = 0;

  // ==========================================
  // Bundle features (15-19)
  // ==========================================

  // [15] bundleDetected: old[14]
  features[15] = old[14];

  // [16] bundleCountNorm: old[15] = bundleCount/50
  //      ScoutAgent: totalWallets/20 (different denominator, similar concept)
  //      Rescale: old[15]*50 gives count, /20 gives new scale, cap at 1
  features[16] = Math.min(1, old[15] * 2.5);

  // [17] bundleControlPercent: old[16] = controlPercent/100
  features[17] = old[16];

  // [18] bundleConfidence: old[19] = HIGH=1, MED=0.66, LOW=0.33
  //      ScoutAgent: HIGH=1, MED=0.6, LOW=0.3 (close enough)
  features[18] = old[19];

  // [19] bundleQuality: ScoutAgent = 1 - (controlPercent/100)
  //      No bundles = quality 1
  features[19] = old[14] === 0 ? 1 : (1 - old[16]);

  // ==========================================
  // Trading features (20-23)
  // ==========================================

  // [20] buyRatio24h: old[8] = buys/(buys+sells)
  features[20] = old[8];

  // [21] buyRatio1h: ScoutAgent approximates with 24h data
  features[21] = old[8];

  // [22] activityLevel: old[9] = min(buys/1000, 1)
  //      ScoutAgent: min(totalTxns/100, 1)
  //      Estimate: buys = old[9]*1000, total = buys/buyRatio
  const buyRatio = old[8] > 0 ? old[8] : 0.5;
  const estimatedBuys = old[9] * 1000;
  const estimatedTotal = buyRatio > 0 ? estimatedBuys / buyRatio : estimatedBuys * 2;
  features[22] = Math.min(1, estimatedTotal / 100);

  // [23] momentum: ScoutAgent = (buys - sells) / total = 2*buyRatio - 1
  features[23] = 2 * old[8] - 1;

  // ==========================================
  // Time features (24-25)
  // ==========================================

  // [24] ageDecay: old[0] = min(ageHours/168, 1)
  //      ageHours = old[0]*168
  //      ageDecay = exp(-ageHours/24) = exp(-old[0]*7)
  features[24] = Math.exp(-old[0] * 7);

  // [25] tradingRecency: not available
  //      ScoutAgent defaults to 0.5 when no transaction data
  features[25] = 0.5;

  // ==========================================
  // Creator features (26-28)
  // ==========================================

  // [26] creatorIdentified: old[21] = creatorKnown
  features[26] = old[21];

  // [27] creatorRugHistory: old[24] = ruggedTokens/5
  features[27] = old[24];

  // [28] creatorHoldings: old[25] = currentHoldingsPercent/100
  features[28] = old[25];

  return features;
}

function remapData(inputPath: string, outputPath: string): void {
  console.log('');
  console.log('==========================================================');
  console.log('  ARGUS AI - Training Data V2 Export (29 features)');
  console.log('  Remapping 31-feature layout → ScoutAgent 29-feature layout');
  console.log('==========================================================');
  console.log('');

  // Load existing data
  const content = readFileSync(inputPath, 'utf-8');
  const records: OldRecord[] = content.trim().split('\n').map(line => JSON.parse(line));
  console.log(`[Input] Loaded ${records.length} records from ${inputPath}`);
  console.log(`[Input] Feature count: ${records[0].features.length}`);

  // Validate
  const invalidRecords = records.filter(r => r.features.length !== 31);
  if (invalidRecords.length > 0) {
    console.error(`[Error] ${invalidRecords.length} records have wrong feature count`);
    process.exit(1);
  }

  // Remap
  let successCount = 0;
  const outputLines: string[] = [];

  for (const record of records) {
    const newFeatures = remapFeatures(record.features);

    // Validate: no NaN or Infinity
    const hasInvalid = newFeatures.some(f => !isFinite(f));
    if (hasInvalid) {
      console.warn(`[Warn] Skipping ${record.meta.symbol} (${record.meta.id}) — invalid feature values`);
      continue;
    }

    outputLines.push(JSON.stringify({
      features: newFeatures,
      target: record.target,
      meta: record.meta,
    }));
    successCount++;
  }

  // Write output
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, outputLines.join('\n') + '\n');

  console.log(`[Output] Wrote ${successCount} records to ${outputPath}`);
  console.log(`[Output] Feature count: 29`);

  // Print feature statistics for sanity check
  console.log('');
  console.log('[Stats] Feature ranges (min — max — mean):');

  const featureNames = [
    'liquidityLog', 'volumeToLiquidity', 'marketCapLog', 'priceVelocity', 'volumeLog',
    'holderCountLog', 'top10Concentration', 'gini', 'freshWalletRatio', 'whaleCount', 'topWhalePercent',
    'mintDisabled', 'freezeDisabled', 'lpLocked', 'lpBurned',
    'bundleDetected', 'bundleCountNorm', 'bundleControlPercent', 'bundleConfidence', 'bundleQuality',
    'buyRatio24h', 'buyRatio1h', 'activityLevel', 'momentum',
    'ageDecay', 'tradingRecency',
    'creatorIdentified', 'creatorRugHistory', 'creatorHoldings',
  ];

  const allFeatures = outputLines.map(l => JSON.parse(l).features as number[]);

  for (let i = 0; i < 29; i++) {
    const vals = allFeatures.map(f => f[i]);
    const min = Math.min(...vals).toFixed(3);
    const max = Math.max(...vals).toFixed(3);
    const mean = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3);
    console.log(`  [${String(i).padStart(2)}] ${featureNames[i].padEnd(22)} ${min.padStart(7)} — ${max.padStart(7)} — ${mean.padStart(7)}`);
  }

  // Class distribution
  console.log('');
  console.log('[Stats] Class distribution:');
  const classCounts: Record<string, number> = {};
  for (const line of outputLines) {
    const r = JSON.parse(line);
    classCounts[r.target.level] = (classCounts[r.target.level] || 0) + 1;
  }
  for (const [level, count] of Object.entries(classCounts)) {
    console.log(`  ${level.padEnd(12)} ${count}`);
  }

  console.log('');
  console.log('Done. Train with:');
  console.log(`  npx tsx scripts/train.ts --data ${outputPath} --output ../agents/src/reasoning/bitnet-weights.json`);
}

// CLI
const program = new Command();

program
  .name('export-data-v2')
  .description('Remap 31-feature training data to 29-feature ScoutAgent layout')
  .option('-i, --input <path>', 'Input JSONL file (31 features)', './data/training-20260129.jsonl')
  .option('-o, --output <path>', 'Output JSONL file (29 features)', './data/training-v2.jsonl')
  .action((options) => {
    remapData(options.input, options.output);
  });

program.parse();
