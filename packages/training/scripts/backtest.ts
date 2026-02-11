#!/usr/bin/env npx tsx
/**
 * Local Backtest Script
 *
 * Evaluates AI predictions against known outcomes from local training data.
 * No API calls needed - uses the JSONL files directly.
 *
 * Usage:
 *   npx tsx scripts/backtest.ts
 */

import { readFileSync } from 'fs';

interface TrainingRecord {
  features: number[];
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
    outcome?: 'rug' | 'stable';
    priceDropPercent?: number;
  };
}

// Load and parse JSONL
function loadData(path: string): TrainingRecord[] {
  const content = readFileSync(path, 'utf-8');
  return content.trim().split('\n').map(line => JSON.parse(line));
}

// Evaluate predictions
function runBacktest(records: TrainingRecord[], threshold: number = 70) {
  // Filter to records with known outcomes
  const labeled = records.filter(r => r.meta.outcomeKnown);

  if (labeled.length === 0) {
    console.log('No labeled data found. Run collect-outcomes first.');
    return;
  }

  // Calculate metrics
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const falseNegatives: TrainingRecord[] = [];
  const falsePositives: TrainingRecord[] = [];

  for (const record of labeled) {
    const predictedRug = record.target.score >= threshold;
    const actualRug = record.meta.outcome === 'rug';

    if (predictedRug && actualRug) tp++;
    else if (!predictedRug && !actualRug) tn++;
    else if (predictedRug && !actualRug) {
      fp++;
      falsePositives.push(record);
    }
    else {
      fn++;
      falseNegatives.push(record);
    }
  }

  const total = labeled.length;
  const accuracy = (tp + tn) / total;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = 2 * (precision * recall) / (precision + recall) || 0;

  // Count actual outcomes
  const actualRugs = labeled.filter(r => r.meta.outcome === 'rug').length;
  const actualStable = labeled.filter(r => r.meta.outcome === 'stable').length;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              ARGUS AI - BACKTEST RESULTS                     ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Threshold: score >= ${threshold} → predicted rug                      ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('=== DATASET ===');
  console.log(`Total records:    ${records.length}`);
  console.log(`With outcomes:    ${labeled.length}`);
  console.log(`  - Rugged:       ${actualRugs} (${(actualRugs/labeled.length*100).toFixed(1)}%)`);
  console.log(`  - Stable:       ${actualStable} (${(actualStable/labeled.length*100).toFixed(1)}%)`);
  console.log('');

  console.log('=== CONFUSION MATRIX ===');
  console.log(`                    Predicted`);
  console.log(`                    RUG      SAFE`);
  console.log(`Actual  RUG       ${String(tp).padStart(4)}     ${String(fn).padStart(4)}  ← ${fn} missed rugs!`);
  console.log(`        SAFE      ${String(fp).padStart(4)}     ${String(tn).padStart(4)}  ← ${fp} false alarms`);
  console.log('');

  console.log('=== PERFORMANCE METRICS ===');
  console.log(`Accuracy:   ${(accuracy * 100).toFixed(1)}%  (correctly predicted ${tp + tn}/${total})`);
  console.log(`Precision:  ${(precision * 100).toFixed(1)}%  (of predicted rugs, ${(precision*100).toFixed(0)}% were real)`);
  console.log(`Recall:     ${(recall * 100).toFixed(1)}%  (caught ${tp}/${actualRugs} actual rugs)`);
  console.log(`F1 Score:   ${(f1 * 100).toFixed(1)}%`);
  console.log('');

  // The critical question: Would we have been profitable?
  console.log('=== PROFITABILITY ANALYSIS ===');

  // If we AVOIDED all high-score tokens (predicted rugs)
  const predictedRugs = labeled.filter(r => r.target.score >= threshold);
  const correctlyAvoided = predictedRugs.filter(r => r.meta.outcome === 'rug').length;
  const wronglyAvoided = predictedRugs.filter(r => r.meta.outcome === 'stable').length;

  console.log(`Tokens flagged as risky (score >= ${threshold}): ${predictedRugs.length}`);
  console.log(`  - Actually rugged:  ${correctlyAvoided} ✓ (saved from loss)`);
  console.log(`  - Were stable:      ${wronglyAvoided} ✗ (missed opportunity)`);
  console.log('');

  // If we BOUGHT all low-score tokens (predicted safe)
  const predictedSafe = labeled.filter(r => r.target.score < threshold);
  const wronglyBought = predictedSafe.filter(r => r.meta.outcome === 'rug').length;
  const correctlyBought = predictedSafe.filter(r => r.meta.outcome === 'stable').length;

  console.log(`Tokens flagged as safe (score < ${threshold}): ${predictedSafe.length}`);
  console.log(`  - Were stable:      ${correctlyBought} ✓ (potential profit)`);
  console.log(`  - Actually rugged:  ${wronglyBought} ✗ (LOSS - missed ${wronglyBought} rugs!)`);
  console.log('');

  // Score distribution analysis
  console.log('=== SCORE DISTRIBUTION BY OUTCOME ===');
  const rugScores = labeled.filter(r => r.meta.outcome === 'rug').map(r => r.target.score);
  const stableScores = labeled.filter(r => r.meta.outcome === 'stable').map(r => r.target.score);

  const avgRugScore = rugScores.reduce((a,b) => a+b, 0) / rugScores.length;
  const avgStableScore = stableScores.reduce((a,b) => a+b, 0) / stableScores.length;

  console.log(`Rugged tokens:  avg score = ${avgRugScore.toFixed(1)} (should be HIGH)`);
  console.log(`Stable tokens:  avg score = ${avgStableScore.toFixed(1)} (should be LOW)`);
  console.log(`Separation:     ${(avgRugScore - avgStableScore).toFixed(1)} points`);
  console.log('');

  // Find optimal threshold
  console.log('=== OPTIMAL THRESHOLD SEARCH ===');
  let bestF1 = 0;
  let bestThreshold = 0;

  for (let t = 20; t <= 90; t += 5) {
    let tTp = 0, tFp = 0, tFn = 0;
    for (const r of labeled) {
      const predRug = r.target.score >= t;
      const actRug = r.meta.outcome === 'rug';
      if (predRug && actRug) tTp++;
      else if (predRug && !actRug) tFp++;
      else if (!predRug && actRug) tFn++;
    }
    const tPrecision = tTp / (tTp + tFp) || 0;
    const tRecall = tTp / (tTp + tFn) || 0;
    const tF1 = 2 * (tPrecision * tRecall) / (tPrecision + tRecall) || 0;

    if (tF1 > bestF1) {
      bestF1 = tF1;
      bestThreshold = t;
    }

    console.log(`Threshold ${t}: P=${(tPrecision*100).toFixed(0)}% R=${(tRecall*100).toFixed(0)}% F1=${(tF1*100).toFixed(0)}% | Missed=${tFn} FalseAlarms=${tFp}`);
  }
  console.log('');
  console.log(`OPTIMAL THRESHOLD: ${bestThreshold} (F1=${(bestF1*100).toFixed(1)}%)`);
  console.log('');

  // Show missed rugs (false negatives)
  if (falseNegatives.length > 0) {
    console.log('=== MISSED RUGS (FALSE NEGATIVES) ===');
    console.log('These tokens RUGGED but we predicted them as SAFE:');
    for (const r of falseNegatives.slice(0, 10)) {
      console.log(`  ${r.meta.symbol.padEnd(12)} score=${r.target.score.toString().padStart(3)} level=${r.target.level}`);
    }
    if (falseNegatives.length > 10) {
      console.log(`  ... and ${falseNegatives.length - 10} more`);
    }
    console.log('');
  }

  // Show false positives
  if (falsePositives.length > 0) {
    console.log('=== FALSE ALARMS (FALSE POSITIVES) ===');
    console.log('These tokens were STABLE but we flagged them as RISKY:');
    for (const r of falsePositives.slice(0, 10)) {
      console.log(`  ${r.meta.symbol.padEnd(12)} score=${r.target.score.toString().padStart(3)} level=${r.target.level}`);
    }
    if (falsePositives.length > 10) {
      console.log(`  ... and ${falsePositives.length - 10} more`);
    }
    console.log('');
  }

  // Verdict
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                       VERDICT                                ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  if (recall >= 0.9 && precision >= 0.7) {
    console.log('║  ✓ EXCELLENT - High recall catches most rugs, good precision ║');
  } else if (recall >= 0.8) {
    console.log('║  ~ GOOD - Catching most rugs but some false alarms           ║');
  } else if (recall >= 0.6) {
    console.log('║  ⚠ MODERATE - Missing too many rugs, needs improvement       ║');
  } else {
    console.log('║  ✗ POOR - Model is missing most rugs, not safe to use        ║');
  }

  if (fn > 5) {
    console.log(`║  ⚠ WARNING: ${fn} rugs would slip through and cause losses!       ║`);
  }

  console.log('╚══════════════════════════════════════════════════════════════╝');
}

// Main
console.log('Loading training data...');
const records = loadData('./data/training-v2.jsonl');
runBacktest(records, 70);
