#!/usr/bin/env npx tsx
/**
 * Collect tokens using random 2-3 letter combinations
 * to find tokens we haven't discovered yet
 */

import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const OUTPUT_FILE = './data/training-large.jsonl';
const RAW_FILE = './data/raw-pumpfun.jsonl';

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: string;
  priceNative: string;
  liquidity?: { usd: number };
  volume?: { h24: number };
  priceChange?: { h24: number };
  txns?: { h24: { buys: number; sells: number } };
  pairCreatedAt?: number;
  fdv?: number;
}

interface CollectedToken {
  address: string;
  symbol: string;
  name: string;
  collectedAt: number;
  pairCreatedAt: number;
  ageHours: number;
  liquidity: number;
  volume24h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  fdv: number;
  outcome: 'RUG' | 'ALIVE' | 'PENDING';
  features: number[];
}

function loadExisting(): Set<string> {
  const seen = new Set<string>();
  if (existsSync(RAW_FILE)) {
    const lines = readFileSync(RAW_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const t = JSON.parse(line);
        seen.add(t.address);
      } catch {}
    }
  }
  return seen;
}

function extractFeatures(pair: DexPair): number[] {
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
  const top10Concentration = 0.6;
  const giniCoefficient = 0.7;
  const freshWalletRatio = 0.5;
  const whaleCount = Math.min(totalTxns / 100, 1);
  const topWhalePercent = 0.4;
  const mintDisabled = 1;
  const freezeDisabled = 1;
  const lpLocked = 0;
  const lpBurned = 0;
  const bundleDetected = 0;
  const bundleCountNorm = 0;
  const bundleControlPercent = 0;
  const bundleConfidence = 0;
  const bundleQuality = 0.5;
  const buyRatio24h = buyRatio;
  const buyRatio1h = buyRatio;
  const activityLevel = Math.min(totalTxns / 1000, 1);
  const momentum = priceVelocity;
  const ageDecay = Math.exp(-ageHours / 24);
  const tradingRecency = totalTxns > 0 ? 1 : 0;
  const creatorIdentified = 0;
  const creatorRugHistory = 0;
  const creatorHoldings = 0;

  return [
    liquidityLog, volumeToLiquidity, marketCapLog, priceVelocity, volumeLog,
    holderCountLog, top10Concentration, giniCoefficient, freshWalletRatio, whaleCount,
    topWhalePercent, mintDisabled, freezeDisabled, lpLocked, lpBurned,
    bundleDetected, bundleCountNorm, bundleControlPercent, bundleConfidence, bundleQuality,
    buyRatio24h, buyRatio1h, activityLevel, momentum, ageDecay,
    tradingRecency, creatorIdentified, creatorRugHistory, creatorHoldings,
  ];
}

function determineOutcome(pair: DexPair): 'RUG' | 'ALIVE' | 'PENDING' {
  const liquidity = pair.liquidity?.usd || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / 3600000;
  const priceChange = pair.priceChange?.h24 || 0;
  const volume = pair.volume?.h24 || 0;

  if (ageHours >= 2 && liquidity === 0) return 'RUG';
  if (ageHours >= 4 && liquidity < 500) return 'RUG';
  if (ageHours >= 6 && liquidity < 1000 && priceChange < -80) return 'RUG';
  if (ageHours >= 12 && liquidity < 5000) return 'RUG';
  if (ageHours >= 24 && liquidity >= 10000) return 'ALIVE';
  if (ageHours >= 48 && volume > 1000) return 'ALIVE';
  if (ageHours < 2) return 'PENDING';
  if (liquidity >= 5000) return 'ALIVE';
  return 'RUG';
}

async function fetchTokens(query: string): Promise<DexPair[]> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const data = await response.json() as { pairs?: DexPair[] };
    return (data.pairs || []).filter(p =>
      p.chainId === 'solana' &&
      (p.dexId === 'pumpswap' || p.dexId === 'raydium')
    );
  } catch {
    return [];
  }
}

// Generate random 2-3 letter combinations
function generateQueries(): string[] {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const queries: string[] = [];

  // 2-letter combinations
  for (let i = 0; i < letters.length; i++) {
    for (let j = 0; j < letters.length; j++) {
      queries.push(letters[i] + letters[j]);
    }
  }

  // Shuffle
  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queries[i], queries[j]] = [queries[j], queries[i]];
  }

  return queries;
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Random Query Data Collection                  ║');
  console.log('║     Searching with 2-letter combinations                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const seen = loadExisting();
  console.log(`[Existing] ${seen.size} tokens already collected\n`);

  const allPairs: DexPair[] = [];
  const queries = generateQueries();

  console.log(`[Searching] ${queries.length} random queries...\n`);

  let queryCount = 0;
  for (const query of queries) {
    const pairs = await fetchTokens(query);
    const newPairs = pairs.filter(p => !seen.has(p.baseToken.address));
    allPairs.push(...newPairs);
    newPairs.forEach(p => seen.add(p.baseToken.address));

    if (newPairs.length > 0) {
      process.stdout.write(`  ${query}: +${newPairs.length} `);
    }

    queryCount++;
    if (queryCount % 50 === 0) {
      console.log(`\n  Progress: ${queryCount}/${queries.length} queries, ${allPairs.length} new tokens`);
    }

    await new Promise(r => setTimeout(r, 100));

    // Stop if we have enough
    if (allPairs.length >= 1000) {
      console.log('\n  Reached 1000 new tokens, stopping early');
      break;
    }
  }

  console.log(`\n\n[Processing] ${allPairs.length} total pairs...\n`);

  let rugs = 0, alive = 0, pending = 0;
  const collected: CollectedToken[] = [];

  for (const pair of allPairs) {
    const outcome = determineOutcome(pair);
    const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 0;

    if (outcome === 'RUG') rugs++;
    else if (outcome === 'ALIVE') alive++;
    else pending++;

    if (outcome !== 'PENDING') {
      const features = extractFeatures(pair);
      collected.push({
        address: pair.baseToken.address,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        collectedAt: Date.now(),
        pairCreatedAt: pair.pairCreatedAt || 0,
        ageHours,
        liquidity: pair.liquidity?.usd || 0,
        volume24h: pair.volume?.h24 || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        buys24h: pair.txns?.h24?.buys || 0,
        sells24h: pair.txns?.h24?.sells || 0,
        fdv: pair.fdv || 0,
        outcome,
        features,
      });
    }
  }

  console.log(`  RUG:     ${rugs}`);
  console.log(`  ALIVE:   ${alive}`);
  console.log(`  PENDING: ${pending} (skipped)\n`);

  if (collected.length > 0) {
    const rawLines = collected.map(t => JSON.stringify(t)).join('\n') + '\n';
    writeFileSync(RAW_FILE, rawLines, { flag: 'a' });
    console.log(`[Saved] ${collected.length} tokens to ${RAW_FILE}`);
  }

  console.log('\n[Building] Training data...\n');

  const trainingRecords: Array<{
    features: number[];
    target: { score: number; level: string; label: number };
    meta: { address: string; symbol: string; outcome: string };
  }> = [];

  for (const token of collected) {
    let score: number, level: string, label: number;

    if (token.outcome === 'RUG') {
      if (token.liquidity === 0) {
        score = 95; level = 'SCAM';
      } else if (token.liquidity < 1000) {
        score = 85; level = 'SCAM';
      } else {
        score = 70; level = 'DANGEROUS';
      }
      label = 1;
    } else {
      if (token.liquidity > 100000) {
        score = 15; level = 'SAFE';
      } else if (token.liquidity > 50000) {
        score = 25; level = 'SAFE';
      } else {
        score = 35; level = 'SUSPICIOUS';
      }
      label = 0;
    }

    trainingRecords.push({
      features: token.features,
      target: { score, level, label },
      meta: { address: token.address, symbol: token.symbol, outcome: token.outcome }
    });
  }

  let existingCount = 0;
  if (existsSync(OUTPUT_FILE)) {
    existingCount = readFileSync(OUTPUT_FILE, 'utf-8').trim().split('\n').filter(Boolean).length;
  }

  if (trainingRecords.length > 0) {
    const trainingLines = trainingRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(OUTPUT_FILE, trainingLines, { flag: 'a' });
  }

  const newTotal = existingCount + trainingRecords.length;
  console.log(`  Added:  ${trainingRecords.length} new examples`);
  console.log(`  Total:  ${newTotal} training examples`);

  const rugCount = trainingRecords.filter(r => r.meta.outcome === 'RUG').length;
  const aliveCount = trainingRecords.filter(r => r.meta.outcome === 'ALIVE').length;
  console.log(`\n  Distribution (new): ${rugCount} rugs, ${aliveCount} alive`);

  if (newTotal >= 5000) {
    console.log('\n[OK] Ready for training! Run: npx tsx scripts/train.ts');
  } else {
    console.log(`\n[!] Need ${5000 - newTotal} more examples`);
  }
}

main().catch(console.error);
