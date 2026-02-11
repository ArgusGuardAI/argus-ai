#!/usr/bin/env npx tsx
/**
 * ARGUS AI - Dry Run Tracker
 *
 * Monitors live tokens, makes predictions, and tracks outcomes
 * to validate model accuracy with real-world data.
 *
 * Usage:
 *   npx tsx scripts/dry-run.ts                    # Start monitoring
 *   npx tsx scripts/dry-run.ts --check-outcomes   # Check pending outcomes
 *   npx tsx scripts/dry-run.ts --stats            # Show accuracy stats
 */

import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const PREDICTIONS_FILE = './data/dry-run-predictions.jsonl';
const OUTCOMES_FILE = './data/dry-run-outcomes.jsonl';
const STATS_FILE = './data/dry-run-stats.json';

// How long to wait before checking outcome (hours)
const OUTCOME_CHECK_HOURS = [2, 6, 12, 24];

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  liquidity?: { usd: number };
  volume?: { h24: number; m5?: number };
  priceChange?: { h24: number; h1?: number; m5?: number };
  txns?: { h24: { buys: number; sells: number }; h1?: { buys: number; sells: number }; m5?: { buys: number; sells: number } };
  pairCreatedAt?: number;
  fdv?: number;
}

interface Prediction {
  id: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  predictedAt: number;
  prediction: {
    score: number;
    level: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
    isRisky: boolean;  // score >= 50
  };
  initialData: {
    liquidity: number;
    volume24h: number;
    priceUsd: number;
    ageHours: number;
    priceChange5m?: number;
    priceChange1h?: number;
    buys5m?: number;
    sells5m?: number;
  };
  // NEW: Creator and holder tracking
  creatorData?: {
    creatorAddress?: string;
    creatorHoldsPercent?: number;
    top10Concentration?: number;
    holderCount?: number;
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    lpLocked?: boolean;
  };
  outcomeChecked: boolean;
  outcome?: {
    checkedAt: number;
    hoursAfter: number;
    liquidity: number;
    priceChange: number;
    isRug: boolean;
    wasCorrect: boolean;
  };
}

interface Stats {
  totalPredictions: number;
  outcomesChecked: number;
  truePositives: number;   // Predicted risky, was rug
  trueNegatives: number;   // Predicted safe, survived
  falsePositives: number;  // Predicted risky, survived
  falseNegatives: number;  // Predicted safe, was rug
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  lastUpdated: string;
}

// Extract features for BitNet (simplified version)
function extractFeatures(pair: DexPair): Float32Array {
  const liquidity = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const fdv = pair.fdv || 0;
  const priceChange = pair.priceChange?.h24 || 0;
  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / 3600000;

  const liquidityLog = Math.min(Math.log10(liquidity + 1) / 7, 1);
  const volumeToLiquidity = liquidity > 0 ? Math.min(volume24h / liquidity, 1) : 0;
  const marketCapLog = Math.min(Math.log10(fdv + 1) / 9, 1);
  const priceVelocity = Math.min(Math.max((priceChange + 100) / 200, 0), 1);
  const volumeLog = Math.min(Math.log10(volume24h + 1) / 7, 1);
  const totalTxns = buys + sells;
  const holderCountLog = Math.min(Math.log10(totalTxns + 1) / 4, 1);
  const buyRatio = totalTxns > 0 ? buys / totalTxns : 0.5;
  const ageDecay = Math.exp(-ageHours / 24);

  return new Float32Array([
    liquidityLog, volumeToLiquidity, marketCapLog, priceVelocity, volumeLog,
    holderCountLog, 0.6, 0.7, 0.5, Math.min(totalTxns / 100, 1),
    0.4, 1, 1, 0, 0,
    0, 0, 0, 0, 0.5,
    buyRatio, buyRatio, Math.min(totalTxns / 1000, 1), priceVelocity, ageDecay,
    totalTxns > 0 ? 1 : 0, 0, 0, 0
  ]);
}

// Simple rule-based prediction (matches BitNet rule-based logic)
function predict(pair: DexPair): { score: number; level: string } {
  const liquidity = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const priceChange = pair.priceChange?.h24 || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / 3600000;

  let score = 30;

  // Dead liquidity
  if (liquidity === 0) {
    score = 100;
    return { score, level: 'SCAM' };
  }

  // Very low liquidity
  if (liquidity < 1000) score += 40;
  else if (liquidity < 5000) score += 25;
  else if (liquidity < 10000) score += 15;

  // Very new
  if (ageHours < 1) score += 20;
  else if (ageHours < 6) score += 10;

  // Price crash
  if (priceChange < -80) score += 30;
  else if (priceChange < -50) score += 20;
  else if (priceChange < -30) score += 10;

  // Suspicious volume
  if (liquidity > 0 && volume24h / liquidity > 10) score += 15;

  score = Math.min(100, score);

  let level: string;
  if (score >= 80) level = 'SCAM';
  else if (score >= 60) level = 'DANGEROUS';
  else if (score >= 40) level = 'SUSPICIOUS';
  else level = 'SAFE';

  return { score, level };
}

// Determine if token rugged based on current state
function determineOutcome(original: Prediction, current: DexPair | null): {
  isRug: boolean;
  liquidity: number;
  priceChange: number;
} {
  if (!current) {
    // Token not found = likely rugged
    return { isRug: true, liquidity: 0, priceChange: -100 };
  }

  const liquidity = current.liquidity?.usd || 0;
  const originalLiquidity = original.initialData.liquidity;
  const originalPrice = original.initialData.priceUsd;
  const currentPrice = parseFloat(current.priceUsd) || 0;

  // Calculate price change from prediction time
  let priceChange = 0;
  if (originalPrice > 0) {
    priceChange = ((currentPrice - originalPrice) / originalPrice) * 100;
  }

  // Rug criteria
  const isRug =
    liquidity === 0 ||
    liquidity < 500 ||
    (originalLiquidity > 0 && liquidity < originalLiquidity * 0.1) ||
    priceChange < -90;

  return { isRug, liquidity, priceChange };
}

// Load predictions from file
function loadPredictions(): Prediction[] {
  if (!existsSync(PREDICTIONS_FILE)) return [];
  return readFileSync(PREDICTIONS_FILE, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// Save prediction
function savePrediction(prediction: Prediction): void {
  appendFileSync(PREDICTIONS_FILE, JSON.stringify(prediction) + '\n');
}

// Update prediction with outcome
function updatePrediction(prediction: Prediction): void {
  const predictions = loadPredictions();
  const updated = predictions.map(p =>
    p.id === prediction.id ? prediction : p
  );
  writeFileSync(PREDICTIONS_FILE, updated.map(p => JSON.stringify(p)).join('\n') + '\n');
}

// Load stats
function loadStats(): Stats {
  if (!existsSync(STATS_FILE)) {
    return {
      totalPredictions: 0,
      outcomesChecked: 0,
      truePositives: 0,
      trueNegatives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      lastUpdated: new Date().toISOString()
    };
  }
  return JSON.parse(readFileSync(STATS_FILE, 'utf-8'));
}

// Save stats
function saveStats(stats: Stats): void {
  stats.lastUpdated = new Date().toISOString();
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// Calculate accuracy metrics
function calculateStats(predictions: Prediction[]): Stats {
  const withOutcomes = predictions.filter(p => p.outcomeChecked && p.outcome);

  let tp = 0, tn = 0, fp = 0, fn = 0;

  for (const p of withOutcomes) {
    const predictedRisky = p.prediction.isRisky;
    const wasRug = p.outcome!.isRug;

    if (predictedRisky && wasRug) tp++;
    else if (!predictedRisky && !wasRug) tn++;
    else if (predictedRisky && !wasRug) fp++;
    else if (!predictedRisky && wasRug) fn++;
  }

  const total = tp + tn + fp + fn;
  const accuracy = total > 0 ? (tp + tn) / total : 0;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const f1Score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  return {
    totalPredictions: predictions.length,
    outcomesChecked: withOutcomes.length,
    truePositives: tp,
    trueNegatives: tn,
    falsePositives: fp,
    falseNegatives: fn,
    accuracy,
    precision,
    recall,
    f1Score,
    lastUpdated: new Date().toISOString()
  };
}

// Fetch token data
async function fetchToken(address: string): Promise<DexPair | null> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${address}`);
    if (!response.ok) return null;
    const data = await response.json() as { pairs?: DexPair[] };
    return data.pairs?.find(p => p.chainId === 'solana') || null;
  } catch {
    return null;
  }
}

// Fetch creator and holder data from RugCheck
interface RugCheckData {
  creatorAddress?: string;
  creatorHoldsPercent?: number;
  top10Concentration?: number;
  holderCount?: number;
  mintAuthorityDisabled?: boolean;
  freezeAuthorityDisabled?: boolean;
  lpLocked?: boolean;
}

async function fetchRugCheckData(address: string): Promise<RugCheckData | null> {
  try {
    // Use full /report endpoint (not /report/summary which doesn't have creator data)
    const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${address}/report`);
    if (!response.ok) return null;
    const data = await response.json() as {
      creator?: string;
      creatorBalance?: number;
      token?: { supply?: number; decimals?: number };
      topHolders?: Array<{ pct: number }>;
      totalHolders?: number;
      markets?: Array<{ lp?: { lpLocked?: number } }>;
      risks?: Array<{ name: string }>;
      mintAuthority?: string;
      freezeAuthority?: string;
    };

    // Calculate creator holdings percentage
    let creatorHoldsPercent = 0;
    if (data.creatorBalance && data.token?.supply && data.token.supply > 0) {
      // RugCheck returns balance in raw units, supply in raw units
      creatorHoldsPercent = (data.creatorBalance / data.token.supply) * 100;
    }

    // Calculate top 10 concentration
    let top10Concentration = 0;
    if (data.topHolders && data.topHolders.length > 0) {
      top10Concentration = data.topHolders.slice(0, 10).reduce((sum, h) => sum + (h.pct || 0), 0);
    }

    // Check LP lock
    const lpLocked = data.markets?.some(m => m.lp?.lpLocked && m.lp.lpLocked > 0) || false;

    return {
      creatorAddress: data.creator,
      creatorHoldsPercent,
      top10Concentration,
      holderCount: data.totalHolders || data.topHolders?.length || 0,
      mintAuthorityDisabled: !data.mintAuthority || data.mintAuthority === '11111111111111111111111111111111',
      freezeAuthorityDisabled: !data.freezeAuthority || data.freezeAuthority === '11111111111111111111111111111111',
      lpLocked,
    };
  } catch {
    return null;
  }
}

// Fetch latest tokens
async function fetchLatestTokens(): Promise<DexPair[]> {
  const pairs: DexPair[] = [];

  // Fetch from boosted/trending
  try {
    const response = await fetch(`${DEXSCREENER_API}/token-boosts/top/v1`);
    if (response.ok) {
      const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;
      const solanaTokens = data.filter(t => t.chainId === 'solana').slice(0, 20);

      for (const t of solanaTokens) {
        const pair = await fetchToken(t.tokenAddress);
        if (pair) pairs.push(pair);
        await new Promise(r => setTimeout(r, 100));
      }
    }
  } catch {}

  // Fetch from latest profiles
  try {
    const response = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
    if (response.ok) {
      const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;
      const solanaTokens = data.filter(t => t.chainId === 'solana').slice(0, 20);

      for (const t of solanaTokens) {
        if (!pairs.find(p => p.baseToken.address === t.tokenAddress)) {
          const pair = await fetchToken(t.tokenAddress);
          if (pair) pairs.push(pair);
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }
  } catch {}

  return pairs;
}

// Check outcomes for pending predictions
async function checkOutcomes(): Promise<void> {
  console.log('\n[Checking Outcomes]');

  const predictions = loadPredictions();
  const pending = predictions.filter(p => !p.outcomeChecked);

  console.log(`  Total predictions: ${predictions.length}`);
  console.log(`  Pending outcomes: ${pending.length}`);

  let checked = 0;
  for (const prediction of pending) {
    const hoursElapsed = (Date.now() - prediction.predictedAt) / 3600000;

    // Only check if enough time has passed
    if (hoursElapsed < 2) continue;

    const current = await fetchToken(prediction.tokenAddress);
    const outcome = determineOutcome(prediction, current);

    prediction.outcomeChecked = true;
    prediction.outcome = {
      checkedAt: Date.now(),
      hoursAfter: hoursElapsed,
      liquidity: outcome.liquidity,
      priceChange: outcome.priceChange,
      isRug: outcome.isRug,
      wasCorrect: prediction.prediction.isRisky === outcome.isRug
    };

    updatePrediction(prediction);
    checked++;

    const status = prediction.outcome.wasCorrect ? '✓' : '✗';
    const predicted = prediction.prediction.isRisky ? 'RISKY' : 'SAFE';
    const actual = outcome.isRug ? 'RUG' : 'ALIVE';
    console.log(`  ${status} ${prediction.symbol}: predicted ${predicted}, was ${actual} (${hoursElapsed.toFixed(1)}h)`);

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`  Checked: ${checked} outcomes`);

  // Update stats
  const updatedPredictions = loadPredictions();
  const stats = calculateStats(updatedPredictions);
  saveStats(stats);
}

// Show stats
function showStats(): void {
  const predictions = loadPredictions();
  const stats = calculateStats(predictions);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Dry Run Statistics                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total Predictions:    ${stats.totalPredictions}`);
  console.log(`  Outcomes Checked:     ${stats.outcomesChecked}`);
  console.log('');
  console.log('  Confusion Matrix:');
  console.log('  ─────────────────────────────────────');
  console.log(`                        Actual`);
  console.log(`                    RUG      ALIVE`);
  console.log(`  Predicted RISKY   ${String(stats.truePositives).padStart(4)}     ${String(stats.falsePositives).padStart(4)}   (TP/FP)`);
  console.log(`  Predicted SAFE    ${String(stats.falseNegatives).padStart(4)}     ${String(stats.trueNegatives).padStart(4)}   (FN/TN)`);
  console.log('');
  console.log('  Metrics:');
  console.log(`    Accuracy:   ${(stats.accuracy * 100).toFixed(1)}%`);
  console.log(`    Precision:  ${(stats.precision * 100).toFixed(1)}%  (of predicted risky, how many rugged)`);
  console.log(`    Recall:     ${(stats.recall * 100).toFixed(1)}%  (of actual rugs, how many we caught)`);
  console.log(`    F1 Score:   ${(stats.f1Score * 100).toFixed(1)}%`);
  console.log('');

  // Show recent predictions
  const recent = predictions.slice(-10).reverse();
  if (recent.length > 0) {
    console.log('  Recent Predictions:');
    console.log('  ─────────────────────────────────────');
    for (const p of recent) {
      const age = ((Date.now() - p.predictedAt) / 3600000).toFixed(1);
      const status = p.outcomeChecked
        ? (p.outcome?.wasCorrect ? '✓' : '✗')
        : '⏳';
      const outcome = p.outcomeChecked
        ? (p.outcome?.isRug ? 'RUG' : 'ALIVE')
        : 'pending';
      console.log(`    ${status} ${p.symbol.padEnd(12)} ${p.prediction.score}/100 ${p.prediction.level.padEnd(10)} → ${outcome} (${age}h ago)`);
    }
  }

  // Show creator analysis (for tokens with creator data)
  const withCreatorData = predictions.filter(p => p.creatorData?.creatorAddress && p.outcomeChecked && p.outcome);
  if (withCreatorData.length > 0) {
    // Group by creator
    const creatorStats = new Map<string, { total: number; rugs: number }>();
    for (const p of withCreatorData) {
      const creator = p.creatorData!.creatorAddress!;
      const existing = creatorStats.get(creator) || { total: 0, rugs: 0 };
      existing.total++;
      if (p.outcome?.isRug) existing.rugs++;
      creatorStats.set(creator, existing);
    }

    // Find repeat offenders (creators with multiple rugs)
    const repeatOffenders = Array.from(creatorStats.entries())
      .filter(([_, s]) => s.rugs >= 2)
      .sort((a, b) => b[1].rugs - a[1].rugs);

    if (repeatOffenders.length > 0) {
      console.log('');
      console.log('  Repeat Rug Creators (2+ rugs):');
      console.log('  ─────────────────────────────────────');
      for (const [creator, stats] of repeatOffenders.slice(0, 5)) {
        console.log(`    ${creator.slice(0, 8)}... ${stats.rugs}/${stats.total} rugged (${((stats.rugs / stats.total) * 100).toFixed(0)}%)`);
      }
    }
  }
  console.log('');
}

// Monitor loop
async function monitor(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Dry Run Monitor                               ║');
  console.log('║     Tracking predictions vs reality                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');

  const seenTokens = new Set<string>();

  // Load existing predictions to avoid duplicates
  const existing = loadPredictions();
  existing.forEach(p => seenTokens.add(p.tokenAddress));
  console.log(`[Init] Loaded ${existing.length} existing predictions`);

  let cycle = 0;
  while (true) {
    cycle++;
    console.log(`\n[Cycle ${cycle}] ${new Date().toLocaleTimeString()}`);

    // Fetch new tokens
    console.log('  Fetching latest tokens...');
    const tokens = await fetchLatestTokens();
    const newTokens = tokens.filter(t => !seenTokens.has(t.baseToken.address));

    console.log(`  Found ${tokens.length} tokens, ${newTokens.length} new`);

    // Make predictions for new tokens
    for (const token of newTokens) {
      const ageHours = token.pairCreatedAt
        ? (Date.now() - token.pairCreatedAt) / 3600000
        : 999;

      // Only track tokens < 24h old
      if (ageHours > 24) continue;

      seenTokens.add(token.baseToken.address);

      const { score, level } = predict(token);

      // Fetch creator and holder data from RugCheck (async, but don't block)
      let creatorData: RugCheckData | undefined;
      try {
        const rugData = await fetchRugCheckData(token.baseToken.address);
        if (rugData) {
          creatorData = rugData;
        }
      } catch {
        // RugCheck fetch failed, continue without creator data
      }

      const prediction: Prediction = {
        id: `${token.baseToken.address}-${Date.now()}`,
        tokenAddress: token.baseToken.address,
        symbol: token.baseToken.symbol,
        name: token.baseToken.name,
        predictedAt: Date.now(),
        prediction: {
          score,
          level: level as any,
          isRisky: score >= 50
        },
        initialData: {
          liquidity: token.liquidity?.usd || 0,
          volume24h: token.volume?.h24 || 0,
          priceUsd: parseFloat(token.priceUsd) || 0,
          ageHours,
          priceChange5m: token.priceChange?.m5 || 0,
          priceChange1h: token.priceChange?.h1 || 0,
          buys5m: token.txns?.m5?.buys || 0,
          sells5m: token.txns?.m5?.sells || 0
        },
        creatorData, // NEW: creator and holder tracking
        outcomeChecked: false
      };

      savePrediction(prediction);

      const riskIcon = score >= 80 ? '🔴' : score >= 60 ? '🟠' : score >= 40 ? '🟡' : '🟢';
      const creatorInfo = creatorData?.creatorAddress ? ` creator:${creatorData.creatorAddress.slice(0, 6)}` : '';
      console.log(`  ${riskIcon} ${token.baseToken.symbol.padEnd(12)} ${score}/100 ${level.padEnd(10)} liq:$${(token.liquidity?.usd || 0).toFixed(0)} age:${ageHours.toFixed(1)}h${creatorInfo}`);

      // Small delay to respect RugCheck rate limits
      await new Promise(r => setTimeout(r, 150));
    }

    // Check outcomes every 5 cycles
    if (cycle % 5 === 0) {
      await checkOutcomes();

      // Show current stats
      const predictions = loadPredictions();
      const stats = calculateStats(predictions);
      if (stats.outcomesChecked > 0) {
        console.log(`\n  [Stats] Accuracy: ${(stats.accuracy * 100).toFixed(1)}% | TP:${stats.truePositives} TN:${stats.trueNegatives} FP:${stats.falsePositives} FN:${stats.falseNegatives}`);
      }
    }

    // Wait 2 minutes between cycles
    console.log('  Waiting 2 minutes...');
    await new Promise(r => setTimeout(r, 120000));
  }
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--check-outcomes')) {
    await checkOutcomes();
    showStats();
  } else if (args.includes('--stats')) {
    showStats();
  } else {
    await monitor();
  }
}

main().catch(console.error);
