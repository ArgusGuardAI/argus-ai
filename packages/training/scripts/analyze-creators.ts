#!/usr/bin/env npx tsx
/**
 * ARGUS AI - Creator Analysis
 *
 * Analyzes dry-run predictions to find patterns in:
 * - Repeat rug creators
 * - Creator holdings vs rug likelihood
 * - Top 10 concentration vs outcomes
 * - LP lock status vs outcomes
 */

import { readFileSync, existsSync } from 'fs';

const PREDICTIONS_FILE = './data/dry-run-predictions.jsonl';

interface Prediction {
  id: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  predictedAt: number;
  prediction: {
    score: number;
    level: string;
    isRisky: boolean;
  };
  initialData: {
    liquidity: number;
    volume24h: number;
    priceUsd: number;
    ageHours: number;
  };
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
    isRug: boolean;
    priceChange: number;
  };
}

function loadPredictions(): Prediction[] {
  if (!existsSync(PREDICTIONS_FILE)) return [];
  return readFileSync(PREDICTIONS_FILE, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function main(): void {
  const predictions = loadPredictions();
  const withOutcomes = predictions.filter(p => p.outcomeChecked && p.outcome);
  const withCreatorData = predictions.filter(p => p.creatorData?.creatorAddress);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Creator Pattern Analysis                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log(`Total predictions: ${predictions.length}`);
  console.log(`With outcomes: ${withOutcomes.length}`);
  console.log(`With creator data: ${withCreatorData.length}`);
  console.log('');

  // Analyze creator patterns for those with both creator data AND outcomes
  const analyzable = withOutcomes.filter(p => p.creatorData?.creatorAddress);

  if (analyzable.length === 0) {
    console.log('No predictions with both creator data and outcomes yet.');
    console.log('Keep the dry-run running to collect more data.');
    return;
  }

  console.log(`Analyzable (creator data + outcomes): ${analyzable.length}`);
  console.log('');

  // 1. Repeat rug creators
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REPEAT RUG CREATORS');
  console.log('═══════════════════════════════════════════════════════════════');

  const creatorStats = new Map<string, { total: number; rugs: number; tokens: string[] }>();
  for (const p of analyzable) {
    const creator = p.creatorData!.creatorAddress!;
    const existing = creatorStats.get(creator) || { total: 0, rugs: 0, tokens: [] };
    existing.total++;
    if (p.outcome?.isRug) existing.rugs++;
    existing.tokens.push(p.symbol);
    creatorStats.set(creator, existing);
  }

  const sortedCreators = Array.from(creatorStats.entries())
    .sort((a, b) => b[1].rugs - a[1].rugs);

  const repeatRuggers = sortedCreators.filter(([_, s]) => s.rugs >= 2);
  if (repeatRuggers.length > 0) {
    console.log(`Found ${repeatRuggers.length} creators with 2+ rugs:`);
    for (const [creator, stats] of repeatRuggers.slice(0, 10)) {
      const rate = ((stats.rugs / stats.total) * 100).toFixed(0);
      console.log(`  ${creator.slice(0, 12)}... ${stats.rugs}/${stats.total} rugged (${rate}%) - ${stats.tokens.slice(0, 3).join(', ')}`);
    }
  } else {
    console.log('No repeat rug creators found yet.');
  }
  console.log('');

  // 2. Creator holdings vs rug likelihood
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CREATOR HOLDINGS vs RUG RATE');
  console.log('═══════════════════════════════════════════════════════════════');

  const holdingBuckets = [
    { name: '0-5%', min: 0, max: 5, rugs: 0, total: 0 },
    { name: '5-10%', min: 5, max: 10, rugs: 0, total: 0 },
    { name: '10-20%', min: 10, max: 20, rugs: 0, total: 0 },
    { name: '20-50%', min: 20, max: 50, rugs: 0, total: 0 },
    { name: '50%+', min: 50, max: 100, rugs: 0, total: 0 },
  ];

  for (const p of analyzable) {
    const holdings = p.creatorData?.creatorHoldsPercent || 0;
    for (const bucket of holdingBuckets) {
      if (holdings >= bucket.min && holdings < bucket.max) {
        bucket.total++;
        if (p.outcome?.isRug) bucket.rugs++;
        break;
      }
    }
  }

  for (const bucket of holdingBuckets) {
    const rate = bucket.total > 0 ? ((bucket.rugs / bucket.total) * 100).toFixed(0) : '-';
    console.log(`  ${bucket.name.padEnd(8)} ${String(bucket.rugs).padStart(3)}/${String(bucket.total).padStart(3)} rugged (${rate}%)`);
  }
  console.log('');

  // 3. Top 10 concentration vs rug likelihood
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOP 10 CONCENTRATION vs RUG RATE');
  console.log('═══════════════════════════════════════════════════════════════');

  const concBuckets = [
    { name: '0-30%', min: 0, max: 30, rugs: 0, total: 0 },
    { name: '30-50%', min: 30, max: 50, rugs: 0, total: 0 },
    { name: '50-70%', min: 50, max: 70, rugs: 0, total: 0 },
    { name: '70-90%', min: 70, max: 90, rugs: 0, total: 0 },
    { name: '90%+', min: 90, max: 100, rugs: 0, total: 0 },
  ];

  for (const p of analyzable) {
    const conc = p.creatorData?.top10Concentration || 0;
    for (const bucket of concBuckets) {
      if (conc >= bucket.min && conc < bucket.max) {
        bucket.total++;
        if (p.outcome?.isRug) bucket.rugs++;
        break;
      }
    }
  }

  for (const bucket of concBuckets) {
    const rate = bucket.total > 0 ? ((bucket.rugs / bucket.total) * 100).toFixed(0) : '-';
    console.log(`  ${bucket.name.padEnd(8)} ${String(bucket.rugs).padStart(3)}/${String(bucket.total).padStart(3)} rugged (${rate}%)`);
  }
  console.log('');

  // 4. Security features vs rug likelihood
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SECURITY FEATURES vs RUG RATE');
  console.log('═══════════════════════════════════════════════════════════════');

  const features = [
    { name: 'Mint disabled', check: (p: Prediction) => p.creatorData?.mintAuthorityDisabled === true },
    { name: 'Freeze disabled', check: (p: Prediction) => p.creatorData?.freezeAuthorityDisabled === true },
    { name: 'LP locked', check: (p: Prediction) => p.creatorData?.lpLocked === true },
  ];

  for (const feature of features) {
    const with_feature = analyzable.filter(p => feature.check(p));
    const without_feature = analyzable.filter(p => !feature.check(p));

    const withRugs = with_feature.filter(p => p.outcome?.isRug).length;
    const withoutRugs = without_feature.filter(p => p.outcome?.isRug).length;

    const withRate = with_feature.length > 0 ? ((withRugs / with_feature.length) * 100).toFixed(0) : '-';
    const withoutRate = without_feature.length > 0 ? ((withoutRugs / without_feature.length) * 100).toFixed(0) : '-';

    console.log(`  ${feature.name}:`);
    console.log(`    YES: ${withRugs}/${with_feature.length} rugged (${withRate}%)`);
    console.log(`    NO:  ${withoutRugs}/${without_feature.length} rugged (${withoutRate}%)`);
  }
  console.log('');

  // 5. Recommendations
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log('Based on current data:');
  console.log('');

  // Find the bucket with highest rug rate
  const highestRiskHolding = holdingBuckets.reduce((a, b) =>
    (b.total > 0 && b.rugs/b.total > (a.total > 0 ? a.rugs/a.total : 0)) ? b : a
  );
  if (highestRiskHolding.total > 5) {
    const rate = ((highestRiskHolding.rugs / highestRiskHolding.total) * 100).toFixed(0);
    console.log(`  ⚠️  Creator holdings of ${highestRiskHolding.name} = ${rate}% rug rate`);
  }

  const highestRiskConc = concBuckets.reduce((a, b) =>
    (b.total > 0 && b.rugs/b.total > (a.total > 0 ? a.rugs/a.total : 0)) ? b : a
  );
  if (highestRiskConc.total > 5) {
    const rate = ((highestRiskConc.rugs / highestRiskConc.total) * 100).toFixed(0);
    console.log(`  ⚠️  Top 10 concentration of ${highestRiskConc.name} = ${rate}% rug rate`);
  }

  if (repeatRuggers.length > 0) {
    console.log(`  ⚠️  ${repeatRuggers.length} known repeat rug creators identified`);
    console.log(`      Consider blacklisting these wallet addresses`);
  }

  console.log('');
  console.log('Keep collecting data to improve pattern recognition.');
  console.log('');
}

main();
