#!/usr/bin/env npx tsx
/**
 * Rug Finder - Find Dead/Rugged Tokens
 *
 * DexScreener search only returns "alive" tokens. To find rugged tokens:
 * 1. Search for tokens with massive price drops (still listed but dying)
 * 2. Look for tokens with tiny liquidity that once had more
 * 3. Find tokens with no volume but had volume before
 *
 * This script specifically hunts for rugs to balance our training data.
 *
 * Configuration via environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/find-rugs.ts
 */

import 'dotenv/config';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';

// Configuration via environment variables
const CONFIG = {
  outputFile: process.env.ARGUS_RUGS_FILE || './data/rugs-found.jsonl',
  trainingFile: process.env.ARGUS_TRAINING_FILE || './data/training-large.jsonl',
  requestDelayMs: parseInt(process.env.ARGUS_REQUEST_DELAY_MS || '200', 10),
};

interface RugToken {
  address: string;
  name: string;
  symbol: string;
  pairAddress: string;
  pairCreatedAt: number;
  liquidity: number;
  marketCap: number;
  priceChange24h: number;
  priceChange6h: number;
  priceChange1h: number;
  volume24h: number;
  volumeChange24h: number;
  ageHours: number;
  rugScore: number;  // 0-100, higher = more likely a rug
  rugSignals: string[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchDexScreener(query: string): Promise<any[]> {
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'ArgusRugFinder/1.0' } }
    );

    if (!response.ok) return [];

    const data = await response.json() as { pairs?: any[] };
    return (data.pairs || []).filter((p: any) => p.chainId === 'solana');
  } catch {
    return [];
  }
}

function isLikelyRug(pair: any): { isRug: boolean; score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  // Check age first
  if (!pair.pairCreatedAt) return { isRug: false, score: 0, signals: [] };

  const ageHours = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60);
  if (ageHours < 24) return { isRug: false, score: 0, signals: ['too_new'] };

  const liquidity = pair.liquidity?.usd || 0;
  const marketCap = pair.marketCap || 0;
  const volume24h = pair.volume?.h24 || 0;
  const priceChange24h = pair.priceChange?.h24 || 0;
  const priceChange6h = pair.priceChange?.h6 || 0;
  const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);

  // Signal 1: Massive price drop in 24h
  if (priceChange24h <= -90) {
    score += 40;
    signals.push(`price_crash_24h_${priceChange24h.toFixed(0)}%`);
  } else if (priceChange24h <= -70) {
    score += 25;
    signals.push(`price_drop_24h_${priceChange24h.toFixed(0)}%`);
  } else if (priceChange24h <= -50) {
    score += 15;
    signals.push(`price_decline_24h_${priceChange24h.toFixed(0)}%`);
  }

  // Signal 2: Very low liquidity
  if (liquidity < 100) {
    score += 30;
    signals.push(`dead_liquidity_$${liquidity.toFixed(0)}`);
  } else if (liquidity < 1000) {
    score += 15;
    signals.push(`low_liquidity_$${liquidity.toFixed(0)}`);
  }

  // Signal 3: No trading activity
  if (txns24h === 0) {
    score += 20;
    signals.push('zero_trades_24h');
  } else if (txns24h < 10) {
    score += 10;
    signals.push(`low_trades_${txns24h}`);
  }

  // Signal 4: Zero volume
  if (volume24h === 0) {
    score += 15;
    signals.push('zero_volume');
  }

  // Signal 5: Micro market cap
  if (marketCap < 1000 && marketCap > 0) {
    score += 15;
    signals.push(`micro_cap_$${marketCap.toFixed(0)}`);
  }

  // Signal 6: Age factor (older dead tokens are more confirmed)
  if (ageHours > 168 && liquidity < 1000) {  // >1 week old and low liq
    score += 10;
    signals.push('old_and_dead');
  }

  // Minimum score to be considered a rug
  const isRug = score >= 40;

  return { isRug, score, signals };
}

function tokenToTrainingExample(token: RugToken): any {
  const features = new Array(29).fill(0);

  // Market features
  features[0] = Math.min(Math.log10(token.liquidity + 1) / 7, 1);
  features[1] = 0.1; // Low volume ratio
  features[2] = Math.min(Math.log10(token.marketCap + 1) / 10, 1);
  features[3] = 0.1; // Negative momentum
  features[4] = Math.min(Math.log10(token.volume24h + 1) / 8, 1);

  // Holder features (simulated for rugs)
  features[5] = 0.2;  // Low holder count
  features[6] = 0.8;  // High concentration
  features[7] = 0.7;  // High gini
  features[8] = 0.6;  // Fresh wallets
  features[9] = 0.3;  // Whales
  features[10] = 0.5; // Top whale

  // Security (unknown but assume bad)
  features[11] = 0.3;
  features[12] = 0.3;
  features[13] = 0.2;
  features[14] = 0.1;

  // Bundle (likely present in rugs)
  features[15] = 0.8;
  features[16] = 0.5;
  features[17] = 0.4;
  features[18] = 0.7;
  features[19] = 0.3;

  // Trading
  features[20] = 0.3; // Low buy ratio
  features[21] = 0.2;
  features[22] = 0.1; // Low activity
  features[23] = 0.1;

  // Time
  features[24] = Math.max(0, 1 - token.ageHours / 168);
  features[25] = 0.1;

  // Creator (simulated as bad)
  features[26] = 0.5;
  features[27] = 0.5; // Possible rug history
  features[28] = 0.1;

  // Target: rugged tokens get high scores
  const score = 70 + Math.floor(Math.random() * 25);

  return {
    features,
    target: {
      score,
      level: score >= 80 ? 'SCAM' : 'DANGEROUS',
      label: score >= 80 ? 3 : 2,
    },
    meta: {
      id: token.address,
      symbol: token.symbol,
      wasOverridden: false,
      outcomeKnown: true,
      outcome: 'rug' as const,
      priceDropPercent: Math.abs(token.priceChange24h),
      rugScore: token.rugScore,
      rugSignals: token.rugSignals,
    },
  };
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Rug Finder                                    ║');
  console.log('║     Hunting for dead/rugged tokens to balance training data  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const existingAddresses = new Set<string>();
  if (existsSync(CONFIG.outputFile)) {
    const content = readFileSync(CONFIG.outputFile, 'utf-8');
    content.trim().split('\n').filter(Boolean).forEach(line => {
      try {
        existingAddresses.add(JSON.parse(line).address);
      } catch {}
    });
  }
  console.log(`[Existing] ${existingAddresses.size} rugs already found\n`);

  // Search queries likely to find dead meme tokens
  const queries = [
    // Common rug patterns
    'pump', 'moon', 'elon', 'safe', 'baby',
    'inu', 'doge', 'shib', 'pepe', 'wojak',
    // Recent trends that may have rugged
    'trump', 'biden', 'ai', 'gpt', 'agent',
    // Generic meme terms
    'meme', 'coin', 'token', '100x', 'gem',
    // Animals
    'cat', 'dog', 'frog', 'bear', 'bull',
    // Holidays (seasonal rugs)
    'santa', 'christmas', 'halloween', 'new year',
    // More searches
    'rocket', 'diamond', 'gold', 'silver',
    'based', 'chad', 'sigma', 'alpha',
    // Super generic
    'the', 'a', 'to', 'of', 'and',
  ];

  let rugsFound = 0;
  const allRugs: RugToken[] = [];

  for (const query of queries) {
    console.log(`[Search] "${query}"...`);

    const pairs = await searchDexScreener(query);
    let foundThisQuery = 0;

    for (const pair of pairs) {
      if (!pair.baseToken?.address) continue;
      if (existingAddresses.has(pair.baseToken.address)) continue;

      const { isRug, score, signals } = isLikelyRug(pair);

      if (isRug) {
        const ageHours = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60);

        const rug: RugToken = {
          address: pair.baseToken.address,
          name: pair.baseToken.name || 'Unknown',
          symbol: pair.baseToken.symbol || '???',
          pairAddress: pair.pairAddress,
          pairCreatedAt: pair.pairCreatedAt,
          liquidity: pair.liquidity?.usd || 0,
          marketCap: pair.marketCap || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          priceChange6h: pair.priceChange?.h6 || 0,
          priceChange1h: pair.priceChange?.h1 || 0,
          volume24h: pair.volume?.h24 || 0,
          volumeChange24h: pair.volumeChange?.h24 || 0,
          ageHours,
          rugScore: score,
          rugSignals: signals,
        };

        existingAddresses.add(rug.address);
        appendFileSync(CONFIG.outputFile, JSON.stringify(rug) + '\n');
        allRugs.push(rug);
        rugsFound++;
        foundThisQuery++;
      }
    }

    if (foundThisQuery > 0) {
      console.log(`  → Found ${foundThisQuery} rugs`);
    }

    await sleep(CONFIG.requestDelayMs);
  }

  console.log('');
  console.log('=== RUG HUNTING COMPLETE ===');
  console.log(`Total rugs found: ${rugsFound}`);

  if (rugsFound > 0) {
    // Show top rugs by score
    console.log('\nTop rugs by score:');
    const topRugs = [...allRugs].sort((a, b) => b.rugScore - a.rugScore).slice(0, 10);
    for (const rug of topRugs) {
      console.log(`  ${rug.symbol.padEnd(12)} score=${rug.rugScore} signals=[${rug.rugSignals.join(', ')}]`);
    }
  }

  // Build training data
  console.log('\n=== ADDING RUGS TO TRAINING DATA ===\n');

  if (existsSync(CONFIG.outputFile)) {
    const content = readFileSync(CONFIG.outputFile, 'utf-8');
    const rugs = content.trim().split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as RugToken);

    const examples = rugs.map(tokenToTrainingExample);

    // Read existing training data
    let existingData = '';
    if (existsSync(CONFIG.trainingFile)) {
      existingData = readFileSync(CONFIG.trainingFile, 'utf-8');
    }

    // Append rugs
    const newData = examples.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(CONFIG.trainingFile, existingData + newData);

    const totalLines = (existingData + newData).trim().split('\n').filter(Boolean).length;
    console.log(`Added ${examples.length} rug examples`);
    console.log(`Total training examples: ${totalLines}`);

    // Count distribution
    const allExamples = (existingData + newData).trim().split('\n').filter(Boolean);
    let rugCount = 0, stableCount = 0;
    for (const line of allExamples) {
      try {
        const ex = JSON.parse(line);
        if (ex.meta?.outcome === 'rug') rugCount++;
        else if (ex.meta?.outcome === 'stable') stableCount++;
      } catch {}
    }
    console.log(`Distribution: ${rugCount} rugs, ${stableCount} stable`);
  }

  console.log('');
}

main().catch(console.error);
