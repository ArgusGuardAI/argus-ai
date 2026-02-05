#!/usr/bin/env npx tsx
/**
 * Outcome Collection Script
 *
 * Checks DexScreener for token price changes to auto-label training data.
 * Tokens that dropped >90% from peak → rugged = true
 * Tokens that maintained price over 48h → rugged = false
 *
 * Usage:
 *   pnpm collect-outcomes
 *   pnpm collect-outcomes --data ./data/training-20260129.jsonl
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';

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
    checkedAt?: string;
  };
}

interface DexScreenerPair {
  baseToken: { address: string; symbol: string };
  priceUsd: string;
  priceChange: { h24?: number; h6?: number; h1?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  volume?: { h24?: number };
  pairCreatedAt?: number;
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

// Extract token address from the ID format: "address-timestamp"
function extractAddress(id: string): string {
  const dashIdx = id.lastIndexOf('-');
  return dashIdx > 0 ? id.substring(0, dashIdx) : id;
}

// Fetch token data from DexScreener
async function fetchDexScreener(address: string): Promise<DexScreenerPair | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    if (!response.ok) return null;

    const data = (await response.json()) as DexScreenerResponse;
    if (!data.pairs || data.pairs.length === 0) return null;

    // Return the pair with highest liquidity
    return data.pairs.sort((a, b) =>
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];
  } catch {
    return null;
  }
}

// Determine if token has rugged based on current state
function classifyOutcome(pair: DexScreenerPair | null, ageHours: number): {
  outcome: 'rug' | 'stable' | 'unknown';
  priceDropPercent: number;
  reason: string;
} {
  // No pair data found at all — token is likely dead
  if (!pair) {
    return { outcome: 'rug', priceDropPercent: 100, reason: 'Token no longer tradeable' };
  }

  const price = parseFloat(pair.priceUsd || '0');
  const liquidity = pair.liquidity?.usd || 0;
  const priceChange24h = pair.priceChange?.h24 || 0;
  const createdAt = pair.pairCreatedAt || 0;
  const pairAgeHours = createdAt > 0
    ? (Date.now() - createdAt) / (1000 * 60 * 60)
    : ageHours;

  // Too new to judge — need at least 24h
  if (pairAgeHours < 24) {
    return { outcome: 'unknown', priceDropPercent: 0, reason: 'Too new (<24h)' };
  }

  // Dead token: no liquidity left
  if (liquidity < 100) {
    return { outcome: 'rug', priceDropPercent: 100, reason: `Liquidity dried up ($${liquidity.toFixed(0)})` };
  }

  // Price crashed >90% in 24h
  if (priceChange24h < -90) {
    return { outcome: 'rug', priceDropPercent: Math.abs(priceChange24h), reason: `Price dropped ${priceChange24h.toFixed(0)}% in 24h` };
  }

  // Price crashed >80% and liquidity very low
  if (priceChange24h < -80 && liquidity < 5000) {
    return { outcome: 'rug', priceDropPercent: Math.abs(priceChange24h), reason: `Price dropped ${priceChange24h.toFixed(0)}% with $${liquidity.toFixed(0)} liquidity` };
  }

  // Stable enough — survived 24h+ with reasonable liquidity
  if (pairAgeHours >= 48 && liquidity > 5000 && priceChange24h > -50) {
    return { outcome: 'stable', priceDropPercent: Math.max(0, -priceChange24h), reason: `Survived ${Math.round(pairAgeHours)}h with $${liquidity.toFixed(0)} liquidity` };
  }

  // Price dropped significantly but not dead yet
  if (priceChange24h < -70) {
    return { outcome: 'rug', priceDropPercent: Math.abs(priceChange24h), reason: `Price dropped ${priceChange24h.toFixed(0)}%` };
  }

  // Not enough signal
  return { outcome: 'unknown', priceDropPercent: Math.max(0, -priceChange24h), reason: 'Insufficient signal' };
}

async function collectOutcomes(options: {
  data: string;
  output?: string;
  delay: number;
  dryRun: boolean;
}) {
  console.log('');
  console.log('=== ARGUS AI - OUTCOME COLLECTOR ===');
  console.log('');

  // Read JSONL file
  const content = readFileSync(options.data, 'utf-8');
  const records: TrainingRecord[] = content.trim().split('\n').map(line => JSON.parse(line));

  console.log(`Loaded ${records.length} training records from ${options.data}`);

  // Filter to records without known outcomes
  const pending = records.filter(r => !r.meta.outcomeKnown);
  const alreadyLabeled = records.length - pending.length;
  console.log(`Already labeled: ${alreadyLabeled}`);
  console.log(`Pending check:   ${pending.length}`);
  console.log('');

  if (pending.length === 0) {
    console.log('All records already have outcomes. Nothing to do.');
    return;
  }

  let rugged = 0;
  let stable = 0;
  let unknown = 0;
  let errors = 0;

  for (let i = 0; i < pending.length; i++) {
    const record = pending[i];
    const address = extractAddress(record.meta.id);
    const ageFeature = record.features[0]; // First feature is normalized age
    const ageHours = ageFeature * 168; // Denormalize (was ageHours/168)

    process.stdout.write(`[${i + 1}/${pending.length}] ${record.meta.symbol} (${address.slice(0, 8)}...) `);

    try {
      const pair = await fetchDexScreener(address);
      const result = classifyOutcome(pair, ageHours);

      if (result.outcome === 'rug') {
        record.meta.outcomeKnown = true;
        record.meta.outcome = 'rug';
        record.meta.priceDropPercent = result.priceDropPercent;
        record.meta.checkedAt = new Date().toISOString();
        record.target.label = 1;
        rugged++;
        console.log(`RUG - ${result.reason}`);
      } else if (result.outcome === 'stable') {
        record.meta.outcomeKnown = true;
        record.meta.outcome = 'stable';
        record.meta.priceDropPercent = result.priceDropPercent;
        record.meta.checkedAt = new Date().toISOString();
        record.target.label = 0;
        stable++;
        console.log(`STABLE - ${result.reason}`);
      } else {
        unknown++;
        console.log(`UNKNOWN - ${result.reason}`);
      }
    } catch (err) {
      errors++;
      console.log(`ERROR - ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // Rate limit DexScreener (300 req/min free tier)
    if (i < pending.length - 1) {
      await new Promise(resolve => setTimeout(resolve, options.delay));
    }
  }

  console.log('');
  console.log('=== RESULTS ===');
  console.log(`Rugged:  ${rugged}`);
  console.log(`Stable:  ${stable}`);
  console.log(`Unknown: ${unknown}`);
  console.log(`Errors:  ${errors}`);
  console.log(`Total labeled: ${alreadyLabeled + rugged + stable} / ${records.length}`);

  // Write updated records
  if (!options.dryRun) {
    const outputPath = options.output || options.data;
    const outputContent = records.map(r => JSON.stringify(r)).join('\n');
    writeFileSync(outputPath, outputContent + '\n');
    console.log(`\nUpdated ${outputPath}`);
  } else {
    console.log('\n(dry run — no files written)');
  }
}

// CLI
const program = new Command();

program
  .name('collect-outcomes')
  .description('Auto-label training data by checking DexScreener prices')
  .option('-d, --data <path>', 'Training data JSONL file', './data/training-20260129.jsonl')
  .option('-o, --output <path>', 'Output file (default: overwrite input)')
  .option('--delay <ms>', 'Delay between API calls in ms', '250')
  .option('--dry-run', 'Don\'t write output file', false)
  .action(async (options) => {
    await collectOutcomes({
      data: options.data,
      output: options.output,
      delay: parseInt(options.delay),
      dryRun: options.dryRun,
    });
  });

program.parse();
