#!/usr/bin/env npx tsx
/**
 * Calculate simulated P&L from dry-run predictions
 */

import { readFileSync, existsSync } from 'fs';

const PREDICTIONS_FILE = './data/dry-run-predictions.jsonl';

interface Prediction {
  tokenAddress: string;
  symbol: string;
  prediction: {
    score: number;
    level: string;
    isRisky: boolean;
  };
  initialData: {
    liquidity: number;
    priceUsd: number;
    priceChange5m?: number;
    priceChange1h?: number;
    buys5m?: number;
    sells5m?: number;
  };
  outcomeChecked: boolean;
  outcome?: {
    isRug: boolean;
    priceChange: number;
    liquidity: number;
  };
}

function main() {
  if (!existsSync(PREDICTIONS_FILE)) {
    console.log('No predictions file found');
    return;
  }

  const predictions: Prediction[] = readFileSync(PREDICTIONS_FILE, 'utf-8')
    .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

  // DEDUPE: Only use first prediction per token (avoid double-counting)
  const seenTokens = new Set<string>();
  const deduped = predictions.filter(p => {
    if (seenTokens.has(p.tokenAddress)) return false;
    seenTokens.add(p.tokenAddress);
    return true;
  });

  const checked = deduped.filter(p => p.outcomeChecked && p.outcome);

  // Simulate trades with tiered sizing
  const BASE_POSITION = 0.1; // SOL

  let totalInvested = 0;
  let totalReturned = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let rugsAvoided = 0;
  let rugsBought = 0;

  const tradeLog: string[] = [];

  for (const p of checked) {
    const score = p.prediction.score;
    const liquidity = p.initialData?.liquidity || 0;

    // LIQUIDITY FILTER: Skip if liquidity < $15K (optimized from FP analysis)
    if (liquidity < 15000) {
      if (p.outcome!.isRug) rugsAvoided++;
      continue;
    }

    // Apply tiered sizing - skip score 60+ (too risky based on dry-run data)
    if (score >= 60) {
      if (p.outcome!.isRug) rugsAvoided++;
      continue;
    }

    // MOMENTUM FILTER: Only buy if price is trending up
    const priceChange5m = p.initialData?.priceChange5m ?? 0;
    const priceChange1h = p.initialData?.priceChange1h ?? 0;
    const buys5m = p.initialData?.buys5m ?? 0;
    const sells5m = p.initialData?.sells5m ?? 0;
    const hasMomentum = priceChange5m > 0 || (priceChange1h > 0 && buys5m > sells5m);

    if (!hasMomentum) {
      if (p.outcome!.isRug) rugsAvoided++;
      continue;
    }

    // CAP EXTREME MOMENTUM: Skip if pumping too fast (likely dump)
    if (priceChange5m > 100) {
      if (p.outcome!.isRug) rugsAvoided++;
      continue;
    }

    // AGE FILTER: Skip tokens < 10 min old (optimized from FP analysis)
    const ageHours = p.initialData?.ageHours ?? 0;
    if (ageHours < 0.167) { // 10 minutes = 0.167 hours
      if (p.outcome!.isRug) rugsAvoided++;
      continue;
    }

    // VOLUME FILTER: Require decent trading activity relative to liquidity
    const volume24h = p.initialData?.volume24h ?? 0;
    // Relaxed to 25% - still filters dead tokens but allows more opportunities
    if (volume24h < liquidity * 0.25) {
      if (p.outcome!.isRug) rugsAvoided++;
      continue;
    }

    // MAX VOLUME FILTER: Skip if volume too high (late entry = worse results)
    // Analysis showed losers avg $231K vol vs winners $89K
    if (volume24h > 150000) {
      if (p.outcome!.isRug) rugsAvoided++;
      continue;
    }

    // Determine position size
    let positionSize = BASE_POSITION;
    let tier = 'FULL';
    if (score >= 40) {
      positionSize = BASE_POSITION * 0.5;
      tier = 'HALF';
    }

    trades++;
    totalInvested += positionSize;

    if (p.outcome!.isRug) {
      // Lost everything
      totalReturned += 0;
      losses++;
      rugsBought++;
      tradeLog.push(`  ✗ ${p.symbol.padEnd(12)} ${score}/100 → RUG     -${positionSize.toFixed(3)} SOL`);
    } else {
      // Survived - estimate return based on price change
      const priceChange = p.outcome!.priceChange || 0;

      // STOP LOSS: -15%
      const STOP_LOSS_PERCENT = -15;

      // TRAILING STOP: If was up 50%+, floor at +30%
      const TRAILING_TRIGGER = 50;
      const TRAILING_FLOOR = 30;

      let finalChange = priceChange;
      let exitNote = '';

      if (priceChange < STOP_LOSS_PERCENT) {
        // Stop loss triggered
        finalChange = STOP_LOSS_PERCENT;
        exitNote = ' (SL)';
      } else if (priceChange >= TRAILING_TRIGGER) {
        // Was up big, let it run (no cap)
        finalChange = priceChange;
        exitNote = ' (TP)';
      } else if (priceChange < TRAILING_FLOOR && priceChange > STOP_LOSS_PERCENT) {
        // Could have been up 50%+ and dropped - simulate trailing stop
        // Note: We don't have peak data, so this is approximate
        finalChange = priceChange;
      }
      // No cap - let winners run

      const multiplier = 1 + (finalChange / 100);
      const returned = positionSize * multiplier;
      totalReturned += returned;

      const pnl = returned - positionSize;
      if (pnl >= 0) wins++;
      else losses++;

      const sign = pnl >= 0 ? '+' : '';
      tradeLog.push(`  ${pnl >= 0 ? '✓' : '✗'} ${p.symbol.padEnd(12)} ${score}/100 → ${finalChange >= 0 ? '+' : ''}${finalChange.toFixed(0)}%${exitNote}    ${sign}${pnl.toFixed(3)} SOL`);
    }
  }

  const pnl = totalReturned - totalInvested;
  const pnlPercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
  const winRate = trades > 0 ? (wins / trades) * 100 : 0;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Simulated P&L (Paper Trading)                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Base position:      ${BASE_POSITION} SOL`);
  console.log(`  Tiered sizing:      FULL < 40 | HALF 40-60 | SKIP 60+`);
  console.log(`  Liquidity filter:   >= $15K`);
  console.log(`  Momentum filter:    5m > 0% OR (1h > 0% AND buys > sells)`);
  console.log(`  Momentum cap:       Skip if 5m > 100% (extreme pump)`);
  console.log(`  Age filter:         >= 10 min old`);
  console.log(`  Volume filter:      24h volume >= 25% of liquidity`);
  console.log(`  Max volume:         <= $150K (avoid late entries)`);
  console.log(`  Stop loss:          -15% (auto-sell)`);
  console.log(`  Trailing stop:      Floor at +30% if was up 50%+`);
  console.log(`  Profit cap:         None (let winners run)`);

  console.log('');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Trades executed:    ${trades}`);
  console.log(`  Wins:               ${wins} (${winRate.toFixed(1)}%)`);
  console.log(`  Losses:             ${losses}`);
  console.log(`  Rugs avoided:       ${rugsAvoided} (filters)`);
  console.log(`  Rugs bought:        ${rugsBought}`);
  console.log('  ─────────────────────────────────────────');
  console.log(`  Total invested:     ${totalInvested.toFixed(3)} SOL`);
  console.log(`  Total returned:     ${totalReturned.toFixed(3)} SOL`);
  console.log(`  P&L:                ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} SOL`);
  console.log(`  P&L %:              ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%`);
  console.log('');

  // Show recent trades
  console.log('  Recent trades:');
  console.log('  ─────────────────────────────────────────');
  tradeLog.slice(-10).forEach(t => console.log(t));
  console.log('');
}

main();
