#!/usr/bin/env npx tsx
/**
 * Collect pump.fun tokens with REALISTIC timeframes
 *
 * Reality: pump.fun tokens rug in HOURS, not days
 * - Token >2h old with $0 liquidity = RUG
 * - Token >6h old with <$1K liquidity = RUG
 * - Token >24h old with stable liquidity = SURVIVOR
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
  liquidity?: { usd: number; base: number; quote: number };
  volume?: { h24: number; h6: number; h1: number };
  priceChange?: { h24: number; h6: number; h1: number };
  txns?: { h24: { buys: number; sells: number }; h6: { buys: number; sells: number } };
  pairCreatedAt?: number;
  fdv?: number;
  marketCap?: number;
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

// Load existing tokens
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

// Extract 29 features from pair data
function extractFeatures(pair: DexPair): number[] {
  const liquidity = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const fdv = pair.fdv || 0;
  const priceChange = pair.priceChange?.h24 || 0;
  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / 3600000;

  // Normalize to 0-1 range
  const liquidityLog = Math.min(Math.log10(liquidity + 1) / 7, 1); // $10M = 1.0
  const volumeToLiquidity = liquidity > 0 ? Math.min(volume24h / liquidity, 1) : 0;
  const marketCapLog = Math.min(Math.log10(fdv + 1) / 9, 1); // $1B = 1.0
  const priceVelocity = Math.min(Math.max((priceChange + 100) / 200, 0), 1); // -100% to +100%
  const volumeLog = Math.min(Math.log10(volume24h + 1) / 7, 1);

  // Holder features (estimated from tx patterns)
  const totalTxns = buys + sells;
  const holderCountLog = Math.min(Math.log10(totalTxns + 1) / 4, 1);
  const buyRatio = totalTxns > 0 ? buys / totalTxns : 0.5;

  // For pump.fun, assume high concentration (no holder data available)
  const top10Concentration = 0.6; // Typical pump.fun
  const giniCoefficient = 0.7;
  const freshWalletRatio = 0.5;
  const whaleCount = Math.min(totalTxns / 100, 1);
  const topWhalePercent = 0.4;

  // Security (pump.fun defaults)
  const mintDisabled = 1; // pump.fun disables mint
  const freezeDisabled = 1; // pump.fun disables freeze
  const lpLocked = 0; // pump.fun LP not locked
  const lpBurned = 0;

  // Bundle detection (none available)
  const bundleDetected = 0;
  const bundleCountNorm = 0;
  const bundleControlPercent = 0;
  const bundleConfidence = 0;
  const bundleQuality = 0.5;

  // Trading activity
  const buyRatio24h = buyRatio;
  const buyRatio1h = buyRatio;
  const activityLevel = Math.min(totalTxns / 1000, 1);
  const momentum = priceVelocity;

  // Time features
  const ageDecay = Math.exp(-ageHours / 24); // Decays over 24h
  const tradingRecency = Math.min(totalTxns > 0 ? 1 : 0, 1);

  // Creator (unknown for pump.fun)
  const creatorIdentified = 0;
  const creatorRugHistory = 0;
  const creatorHoldings = 0;

  return [
    liquidityLog,        // 0
    volumeToLiquidity,   // 1
    marketCapLog,        // 2
    priceVelocity,       // 3
    volumeLog,           // 4
    holderCountLog,      // 5
    top10Concentration,  // 6
    giniCoefficient,     // 7
    freshWalletRatio,    // 8
    whaleCount,          // 9
    topWhalePercent,     // 10
    mintDisabled,        // 11
    freezeDisabled,      // 12
    lpLocked,            // 13
    lpBurned,            // 14
    bundleDetected,      // 15
    bundleCountNorm,     // 16
    bundleControlPercent,// 17
    bundleConfidence,    // 18
    bundleQuality,       // 19
    buyRatio24h,         // 20
    buyRatio1h,          // 21
    activityLevel,       // 22
    momentum,            // 23
    ageDecay,            // 24
    tradingRecency,      // 25
    creatorIdentified,   // 26
    creatorRugHistory,   // 27
    creatorHoldings,     // 28
  ];
}

// Determine outcome based on pump.fun reality
function determineOutcome(pair: DexPair): 'RUG' | 'ALIVE' | 'PENDING' {
  const liquidity = pair.liquidity?.usd || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / 3600000;
  const priceChange = pair.priceChange?.h24 || 0;
  const volume = pair.volume?.h24 || 0;

  // Token >2h with $0 liquidity = definite rug
  if (ageHours >= 2 && liquidity === 0) {
    return 'RUG';
  }

  // Token >4h with <$500 liquidity = rug
  if (ageHours >= 4 && liquidity < 500) {
    return 'RUG';
  }

  // Token >6h with <$1K liquidity and price crashed = rug
  if (ageHours >= 6 && liquidity < 1000 && priceChange < -80) {
    return 'RUG';
  }

  // Token >12h with <$5K liquidity = likely dead
  if (ageHours >= 12 && liquidity < 5000) {
    return 'RUG';
  }

  // Token >24h with decent liquidity = survivor
  if (ageHours >= 24 && liquidity >= 10000) {
    return 'ALIVE';
  }

  // Token >48h with any activity = survivor
  if (ageHours >= 48 && volume > 1000) {
    return 'ALIVE';
  }

  // Token <2h = too early
  if (ageHours < 2) {
    return 'PENDING';
  }

  // Default: check liquidity threshold
  if (liquidity >= 5000) {
    return 'ALIVE';
  }

  return 'RUG';
}

// Fetch tokens from DexScreener
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

// Fetch boosted/trending tokens
async function fetchBoosted(): Promise<DexPair[]> {
  const pairs: DexPair[] = [];

  // Boosted tokens
  try {
    const response = await fetch(`${DEXSCREENER_API}/token-boosts/top/v1`);
    if (response.ok) {
      const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;
      const solanaTokens = data.filter(t => t.chainId === 'solana').slice(0, 100);

      for (const t of solanaTokens) {
        try {
          const res = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${t.tokenAddress}`);
          if (res.ok) {
            const d = await res.json() as { pairs?: DexPair[] };
            const solanaPair = d.pairs?.find(p => p.chainId === 'solana');
            if (solanaPair) pairs.push(solanaPair);
          }
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
    }
  } catch {}

  // Latest token profiles
  try {
    const response = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
    if (response.ok) {
      const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;
      const solanaTokens = data.filter(t => t.chainId === 'solana').slice(0, 100);

      for (const t of solanaTokens) {
        try {
          const res = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${t.tokenAddress}`);
          if (res.ok) {
            const d = await res.json() as { pairs?: DexPair[] };
            const solanaPair = d.pairs?.find(p => p.chainId === 'solana');
            if (solanaPair) pairs.push(solanaPair);
          }
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
    }
  } catch {}

  return pairs;
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Pump.fun Data Collection                      ║');
  console.log('║     Realistic timeframes: rugs happen in HOURS               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const seen = loadExisting();
  console.log(`[Existing] ${seen.size} tokens already collected\n`);

  const allPairs: DexPair[] = [];

  // Search queries targeting pump.fun memes
  const queries = [
    // Meme culture
    'pepe', 'doge', 'shib', 'wojak', 'chad', 'gigachad', 'npc', 'based',
    'sigma', 'grindset', 'cope', 'seethe', 'wagmi', 'ngmi', 'gm', 'gn',
    // Politics
    'trump', 'maga', 'biden', 'obama', 'kamala', 'javier', 'milei', 'putin',
    // Celebrities
    'elon', 'musk', 'bezos', 'zuck', 'drake', 'kanye', 'ye', 'taylor',
    // Animals
    'cat', 'dog', 'frog', 'monkey', 'ape', 'bear', 'bull', 'penguin',
    'panda', 'tiger', 'lion', 'wolf', 'fox', 'owl', 'bird', 'fish',
    // Tech
    'ai', 'gpt', 'agent', 'bot', 'llm', 'neural', 'cyber', 'quantum',
    'defi', 'nft', 'meta', 'web3', 'dao', 'dex', 'swap',
    // Value
    'gold', 'diamond', 'platinum', 'ruby', 'gem', 'crystal', 'treasure',
    '100x', '1000x', '10000x', 'millionaire', 'billionaire', 'whale',
    // Solana ecosystem
    'pump', 'fun', 'bonk', 'wif', 'popcat', 'bome', 'myro', 'wen',
    'jup', 'ray', 'orca', 'sol', 'solana', 'jupiter', 'raydium',
    // Meme modifiers
    'baby', 'mini', 'mega', 'super', 'ultra', 'hyper', 'king', 'queen',
    'lord', 'god', 'jesus', 'satan', 'devil', 'angel', 'demon', 'holy',
    // Geography
    'usa', 'america', 'china', 'japan', 'korea', 'india', 'brazil', 'russia',
    // Emotions
    'love', 'hate', 'happy', 'sad', 'angry', 'based', 'cringe',
    // Objects
    'moon', 'mars', 'rocket', 'lambo', 'ferrari', 'yacht', 'mansion',
    // Random popular
    'inu', 'coin', 'token', 'cash', 'money', 'dollar', 'euro',
    'santa', 'christmas', 'new year', 'valentine', 'halloween',
    // Trending 2024-2025
    'hawk', 'tuah', 'skibidi', 'rizz', 'ohio', 'grimace', 'barbie',
    'oppenheimer', 'barbenheimer', 'squid', 'game',
    // Extra searches
    'rich', 'poor', 'fast', 'slow', 'big', 'small', 'hot', 'cold',
    // More animals
    'hamster', 'rabbit', 'duck', 'goose', 'chicken', 'pig', 'cow', 'horse',
    'shark', 'whale', 'dolphin', 'octopus', 'crab', 'shrimp', 'lobster',
    // Food
    'pizza', 'burger', 'taco', 'sushi', 'ramen', 'coffee', 'beer', 'wine',
    'banana', 'apple', 'orange', 'lemon', 'grape', 'strawberry', 'peach',
    // Colors
    'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'black', 'white',
    // Numbers
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    // Internet culture
    'kek', 'lol', 'lmao', 'rofl', 'bruh', 'sus', 'yeet', 'vibe', 'mood',
    'karen', 'chad', 'stacy', 'boomer', 'zoomer', 'doomer', 'bloomer',
    // Sports
    'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'boxing',
    // Music
    'rock', 'pop', 'hip', 'hop', 'jazz', 'metal', 'punk', 'techno', 'house',
    // Gaming
    'mario', 'sonic', 'zelda', 'pokemon', 'minecraft', 'fortnite', 'roblox',
    // More modifiers
    'pro', 'max', 'plus', 'prime', 'elite', 'premium', 'vip', 'og',
    'new', 'old', 'first', 'last', 'best', 'worst', 'top', 'bottom'
  ];

  console.log(`[Searching] ${queries.length} queries...\n`);

  for (const query of queries) {
    const pairs = await fetchTokens(query);
    const newPairs = pairs.filter(p => !seen.has(p.baseToken.address));
    allPairs.push(...newPairs);
    newPairs.forEach(p => seen.add(p.baseToken.address));

    if (newPairs.length > 0) {
      process.stdout.write(`  ${query}: +${newPairs.length} `);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n\n[Boosted] Fetching trending tokens...');
  const boosted = await fetchBoosted();
  const newBoosted = boosted.filter(p => !seen.has(p.baseToken.address));
  allPairs.push(...newBoosted);
  console.log(`  +${newBoosted.length} new boosted tokens\n`);

  // Process and classify
  console.log(`[Processing] ${allPairs.length} total pairs...\n`);

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
  console.log(`  PENDING: ${pending} (skipped, too new)\n`);

  // Save raw data
  if (collected.length > 0) {
    const rawLines = collected.map(t => JSON.stringify(t)).join('\n') + '\n';
    writeFileSync(RAW_FILE, rawLines, { flag: 'a' });
    console.log(`[Saved] ${collected.length} tokens to ${RAW_FILE}`);
  }

  // Build training data
  console.log('\n[Building] Training data...\n');

  const trainingRecords: Array<{
    features: number[];
    target: { score: number; level: string; label: number };
    meta: { address: string; symbol: string; outcome: string };
  }> = [];

  for (const token of collected) {
    let score: number, level: string, label: number;

    if (token.outcome === 'RUG') {
      // Score based on how bad the rug was
      if (token.liquidity === 0) {
        score = 95;
        level = 'SCAM';
      } else if (token.liquidity < 1000) {
        score = 85;
        level = 'SCAM';
      } else {
        score = 70;
        level = 'DANGEROUS';
      }
      label = 1; // RISKY
    } else {
      // ALIVE - score based on health
      if (token.liquidity > 100000) {
        score = 15;
        level = 'SAFE';
      } else if (token.liquidity > 50000) {
        score = 25;
        level = 'SAFE';
      } else {
        score = 35;
        level = 'SUSPICIOUS';
      }
      label = 0; // SAFE
    }

    trainingRecords.push({
      features: token.features,
      target: { score, level, label },
      meta: { address: token.address, symbol: token.symbol, outcome: token.outcome }
    });
  }

  // Load existing training data
  let existingCount = 0;
  if (existsSync(OUTPUT_FILE)) {
    existingCount = readFileSync(OUTPUT_FILE, 'utf-8').trim().split('\n').filter(Boolean).length;
  }

  // Append new training data
  if (trainingRecords.length > 0) {
    const trainingLines = trainingRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(OUTPUT_FILE, trainingLines, { flag: 'a' });
  }

  const newTotal = existingCount + trainingRecords.length;
  console.log(`  Added:  ${trainingRecords.length} new examples`);
  console.log(`  Total:  ${newTotal} training examples`);

  // Distribution
  const rugCount = trainingRecords.filter(r => r.meta.outcome === 'RUG').length;
  const aliveCount = trainingRecords.filter(r => r.meta.outcome === 'ALIVE').length;
  console.log(`\n  Distribution (new): ${rugCount} rugs, ${aliveCount} alive`);
  console.log(`  Rug rate: ${(rugCount / (rugCount + aliveCount) * 100).toFixed(1)}%`);

  if (newTotal < 5000) {
    console.log(`\n[!] Need ${5000 - newTotal} more examples for reliable training`);
    console.log('    Run this script multiple times over several hours');
  } else {
    console.log('\n[✓] Ready for training! Run: npx tsx scripts/train.ts');
  }
}

main().catch(console.error);
