#!/usr/bin/env npx tsx
/**
 * Historical Token Backfill
 *
 * Fetches historical Solana tokens that are OLD ENOUGH to have known outcomes.
 * These can be immediately labeled and used for training.
 *
 * Strategy:
 * 1. Search DexScreener for tokens with various filters
 * 2. Only keep tokens older than 48 hours
 * 3. Check their current state to determine outcome
 * 4. Build training data
 *
 * Configuration via environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/backfill-historical.ts
 *   npx tsx scripts/backfill-historical.ts --pages 50  # More pages
 */

import 'dotenv/config';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';

// Configuration via environment variables
const CONFIG = {
  outputFile: process.env.ARGUS_HISTORICAL_FILE || './data/historical-labeled.jsonl',
  trainingFile: process.env.ARGUS_TRAINING_FILE || './data/training-large.jsonl',
  requestDelayMs: parseInt(process.env.ARGUS_REQUEST_DELAY_MS || '200', 10),
  minAgeHours: parseFloat(process.env.ARGUS_STABLE_AGE_HOURS || '48'),
  rugPriceDropPercent: parseFloat(process.env.ARGUS_RUG_PRICE_DROP || '90'),
  rugLiquidityMin: parseFloat(process.env.ARGUS_RUG_LIQ_MIN || '100'),
};

interface TokenData {
  address: string;
  name: string;
  symbol: string;
  pairAddress: string;
  pairCreatedAt: number;
  initialPrice: number;
  initialLiquidity: number;
  initialMarketCap: number;
  initialVolume24h: number;
  currentPrice: number;
  currentLiquidity: number;
  ageHours: number;
  priceDropPercent: number;
  outcome: 'rug' | 'stable' | 'unknown';
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchTokens(query: string, minLiquidity: number = 0): Promise<any[]> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ArgusTraining/1.0' }
    });

    if (!response.ok) return [];

    const data = await response.json() as { pairs?: any[] };
    return (data.pairs || [])
      .filter((p: any) => p.chainId === 'solana')
      .filter((p: any) => (p.liquidity?.usd || 0) >= minLiquidity);
  } catch {
    return [];
  }
}

async function getPairsByToken(addresses: string[]): Promise<Map<string, any>> {
  const results = new Map<string, any>();

  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30).join(',');
    try {
      const response = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${batch}`,
        { headers: { 'User-Agent': 'ArgusTraining/1.0' } }
      );

      if (response.ok) {
        const pairs = await response.json() as any[];
        for (const pair of pairs) {
          if (pair.baseToken?.address) {
            results.set(pair.baseToken.address, pair);
          }
        }
      }
    } catch {}

    await sleep(CONFIG.requestDelayMs);
  }

  return results;
}

function classifyToken(pair: any): TokenData | null {
  if (!pair.pairCreatedAt) return null;

  const now = Date.now();
  const createdAt = pair.pairCreatedAt;
  const ageHours = (now - createdAt) / (1000 * 60 * 60);

  // Only process tokens old enough
  if (ageHours < CONFIG.minAgeHours) return null;

  const currentPrice = parseFloat(pair.priceUsd) || 0;
  const currentLiquidity = pair.liquidity?.usd || 0;

  // We don't have initial price, so estimate from price changes
  const priceChange24h = pair.priceChange?.h24 || 0;
  const priceChange6h = pair.priceChange?.h6 || 0;

  // Estimate initial price from 24h change (rough)
  const initialPrice = priceChange24h !== 0
    ? currentPrice / (1 + priceChange24h / 100)
    : currentPrice;

  const priceDropPercent = initialPrice > 0
    ? ((initialPrice - currentPrice) / initialPrice) * 100
    : 0;

  // Classify outcome
  let outcome: 'rug' | 'stable' | 'unknown' = 'unknown';

  if (priceDropPercent >= CONFIG.rugPriceDropPercent || currentLiquidity < CONFIG.rugLiquidityMin) {
    outcome = 'rug';
  } else if (ageHours >= 48 && currentLiquidity >= 1000) {
    outcome = 'stable';
  }

  return {
    address: pair.baseToken?.address || '',
    name: pair.baseToken?.name || 'Unknown',
    symbol: pair.baseToken?.symbol || '???',
    pairAddress: pair.pairAddress || '',
    pairCreatedAt: createdAt,
    initialPrice,
    initialLiquidity: pair.liquidity?.usd || 0, // Approximate
    initialMarketCap: pair.marketCap || 0,
    initialVolume24h: pair.volume?.h24 || 0,
    currentPrice,
    currentLiquidity,
    ageHours,
    priceDropPercent,
    outcome,
  };
}

function tokenToTrainingExample(token: TokenData): any {
  // Generate features (simplified - using available data)
  const features = new Array(29).fill(0);

  // Market features
  features[0] = Math.min(Math.log10(token.currentLiquidity + 1) / 7, 1);
  features[1] = token.initialVolume24h > 0 ? Math.min(token.initialVolume24h / token.currentLiquidity / 10, 1) : 0.5;
  features[2] = Math.min(Math.log10(token.initialMarketCap + 1) / 10, 1);
  features[3] = 0.5;
  features[4] = Math.min(Math.log10(token.initialVolume24h + 1) / 8, 1);

  // Holder features (unknown)
  features[5] = 0.3;
  features[6] = 0.5;
  features[7] = 0.5;
  features[8] = 0.5;
  features[9] = 0.1;
  features[10] = 0.2;

  // Security (unknown)
  features[11] = 0.5;
  features[12] = 0.5;
  features[13] = 0.3;
  features[14] = 0.2;

  // Bundle (unknown)
  features[15] = 0;
  features[16] = 0;
  features[17] = 0;
  features[18] = 0.5;
  features[19] = 0.5;

  // Trading
  features[20] = 0.5;
  features[21] = 0.5;
  features[22] = 0.5;
  features[23] = 0.5;

  // Time
  features[24] = Math.max(0, 1 - token.ageHours / 168); // Decay over 7 days
  features[25] = 0.5;

  // Creator (unknown)
  features[26] = 0;
  features[27] = 0;
  features[28] = 0.5;

  // Target based on outcome
  let score: number, level: string, label: number;

  if (token.outcome === 'rug') {
    score = 70 + Math.floor(Math.random() * 25);
    level = score >= 80 ? 'SCAM' : 'DANGEROUS';
    label = score >= 80 ? 3 : 2;
  } else if (token.outcome === 'stable') {
    score = 20 + Math.floor(Math.random() * 35);
    level = score >= 55 ? 'SUSPICIOUS' : 'SAFE';
    label = score >= 55 ? 1 : 0;
  } else {
    score = 50;
    level = 'SUSPICIOUS';
    label = 1;
  }

  return {
    features,
    target: { score, level, label },
    meta: {
      id: token.address,
      symbol: token.symbol,
      wasOverridden: false,
      outcomeKnown: true,
      outcome: token.outcome,
      priceDropPercent: token.priceDropPercent,
    },
  };
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Historical Token Backfill                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Load existing addresses to avoid duplicates
  const existingAddresses = new Set<string>();
  if (existsSync(CONFIG.outputFile)) {
    const content = readFileSync(CONFIG.outputFile, 'utf-8');
    content.trim().split('\n').filter(Boolean).forEach(line => {
      try {
        const data = JSON.parse(line);
        existingAddresses.add(data.address);
      } catch {}
    });
  }
  console.log(`[Existing] ${existingAddresses.size} tokens already collected\n`);

  // Search queries to find diverse tokens
  const searchQueries = [
    // Popular meme categories
    'pepe', 'doge', 'shib', 'wojak', 'chad',
    'trump', 'elon', 'biden', 'obama',
    'cat', 'dog', 'frog', 'monkey', 'bear', 'bull',
    'ai', 'gpt', 'agent', 'bot',
    'moon', 'rocket', 'diamond', 'gold',
    'baby', 'mini', 'mega', 'super',
    'sol', 'solana', 'pump', 'fun',
    // Trending categories
    'meme', 'coin', 'token', 'inu',
    'santa', 'christmas', 'new year',
    // Random searches
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
  ];

  let totalProcessed = 0;
  let rugs = 0;
  let stable = 0;
  let skipped = 0;

  for (const query of searchQueries) {
    console.log(`[Search] Query: "${query}"...`);

    const pairs = await searchTokens(query, 100);
    console.log(`  Found ${pairs.length} Solana pairs`);

    for (const pair of pairs) {
      const token = classifyToken(pair);

      if (!token) {
        skipped++;
        continue;
      }

      if (existingAddresses.has(token.address)) {
        continue;
      }

      existingAddresses.add(token.address);
      appendFileSync(CONFIG.outputFile, JSON.stringify(token) + '\n');
      totalProcessed++;

      if (token.outcome === 'rug') rugs++;
      else if (token.outcome === 'stable') stable++;
    }

    await sleep(CONFIG.requestDelayMs);
  }

  console.log('');
  console.log('=== COLLECTION COMPLETE ===');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`  Rugs:   ${rugs} (${(rugs/Math.max(1,totalProcessed)*100).toFixed(1)}%)`);
  console.log(`  Stable: ${stable} (${(stable/Math.max(1,totalProcessed)*100).toFixed(1)}%)`);
  console.log(`  Skipped (too new): ${skipped}`);

  // Build training data
  console.log('\n=== BUILDING TRAINING DATA ===\n');

  if (existsSync(CONFIG.outputFile)) {
    const content = readFileSync(CONFIG.outputFile, 'utf-8');
    const tokens = content.trim().split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as TokenData)
      .filter(t => t.outcome !== 'unknown');

    const examples = tokens.map(tokenToTrainingExample);

    // Append to training file
    const newData = examples.map(e => JSON.stringify(e)).join('\n') + '\n';

    // Merge with existing training data if present
    let existingData = '';
    if (existsSync(CONFIG.trainingFile)) {
      existingData = readFileSync(CONFIG.trainingFile, 'utf-8');
    }

    writeFileSync(CONFIG.trainingFile, existingData + newData);

    console.log(`Added ${examples.length} training examples to ${CONFIG.trainingFile}`);

    // Count total
    const totalLines = (existingData + newData).trim().split('\n').filter(Boolean).length;
    console.log(`Total training examples: ${totalLines}`);
  }

  console.log('');
}

main().catch(console.error);
