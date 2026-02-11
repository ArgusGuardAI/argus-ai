#!/usr/bin/env npx tsx
/**
 * Collect training data at EXTREMES
 * Focus on clear rugs and clear survivors to improve model discrimination
 */

import { appendFileSync, existsSync, readFileSync } from 'fs';

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';
const OUTPUT_FILE = './data/training-extremes.jsonl';

// Rate limiting
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let lastRequest = 0;
async function rateLimitedFetch(url: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequest;
  if (elapsed < 300) await sleep(300 - elapsed);
  lastRequest = Date.now();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Load existing tokens to avoid duplicates
function loadExistingTokens(): Set<string> {
  const existing = new Set<string>();
  const files = [
    './data/training-large.jsonl',
    './data/training-extremes.jsonl',
    './data/training-binary.jsonl'
  ];

  for (const file of files) {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          existing.add(data.tokenAddress);
        } catch {}
      }
    }
  }

  console.log(`Loaded ${existing.size} existing tokens`);
  return existing;
}

// Extract features from token data
function extractFeatures(pair: any): Record<string, number> {
  const liquidity = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const marketCap = pair.marketCap || pair.fdv || 0;
  const priceChange24h = pair.priceChange?.h24 || 0;
  const priceChange1h = pair.priceChange?.h1 || 0;
  const txns24h = pair.txns?.h24 || { buys: 0, sells: 0 };
  const txns1h = pair.txns?.h1 || { buys: 0, sells: 0 };

  const ageMs = Date.now() - (pair.pairCreatedAt || Date.now());
  const ageHours = ageMs / 3600000;

  return {
    liquidity,
    volume24h,
    marketCap,
    priceChange24h,
    priceChange1h,
    buys24h: txns24h.buys || 0,
    sells24h: txns24h.sells || 0,
    buys1h: txns1h.buys || 0,
    sells1h: txns1h.sells || 0,
    ageHours,
    volumeToLiquidity: liquidity > 0 ? volume24h / liquidity : 0,
    buyRatio24h: (txns24h.buys + txns24h.sells) > 0
      ? txns24h.buys / (txns24h.buys + txns24h.sells)
      : 0.5,
  };
}

interface TokenData {
  tokenAddress: string;
  symbol: string;
  features: Record<string, number>;
  label: 'RUG' | 'ALIVE';
  collectedAt: number;
}

async function findDeadTokens(existing: Set<string>): Promise<TokenData[]> {
  console.log('\n🔍 Searching for DEAD tokens (confirmed rugs)...\n');
  const results: TokenData[] = [];

  // Search for tokens that were popular but now have 0 liquidity
  const queries = ['pump', 'moon', 'pepe', 'doge', 'shib', 'inu', 'elon', 'ai', 'gpt', 'meme'];

  for (const query of queries) {
    try {
      console.log(`  Searching: ${query}`);
      const data = await rateLimitedFetch(`${DEXSCREENER_API}/search?q=${query}`);

      if (!data.pairs) continue;

      // Filter for Solana tokens with near-zero liquidity (rugged)
      const deadTokens = data.pairs.filter((p: any) => {
        if (p.chainId !== 'solana') return false;
        if (existing.has(p.baseToken?.address)) return false;

        const liquidity = p.liquidity?.usd || 0;
        const ageMs = Date.now() - (p.pairCreatedAt || Date.now());
        const ageHours = ageMs / 3600000;

        // Dead: very low liquidity, was created at least 6h ago
        return liquidity < 100 && ageHours > 6;
      });

      for (const pair of deadTokens.slice(0, 5)) {
        const tokenAddress = pair.baseToken?.address;
        if (!tokenAddress || existing.has(tokenAddress)) continue;

        const features = extractFeatures(pair);
        results.push({
          tokenAddress,
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          features,
          label: 'RUG',
          collectedAt: Date.now()
        });
        existing.add(tokenAddress);

        console.log(`    ✗ RUG: ${pair.baseToken?.symbol} - $${features.liquidity.toFixed(0)} liq`);
      }

      await sleep(500);
    } catch (error) {
      console.error(`  Error searching ${query}:`, error);
    }
  }

  return results;
}

async function findSurvivorTokens(existing: Set<string>): Promise<TokenData[]> {
  console.log('\n🔍 Searching for SURVIVOR tokens (confirmed alive)...\n');
  const results: TokenData[] = [];

  // Search for tokens with good liquidity that have been around for a while
  const queries = ['sol', 'jup', 'ray', 'bonk', 'wen', 'jto', 'pyth', 'tensor'];

  for (const query of queries) {
    try {
      console.log(`  Searching: ${query}`);
      const data = await rateLimitedFetch(`${DEXSCREENER_API}/search?q=${query}`);

      if (!data.pairs) continue;

      // Filter for healthy Solana tokens
      const aliveTokens = data.pairs.filter((p: any) => {
        if (p.chainId !== 'solana') return false;
        if (existing.has(p.baseToken?.address)) return false;

        const liquidity = p.liquidity?.usd || 0;
        const volume24h = p.volume?.h24 || 0;
        const ageMs = Date.now() - (p.pairCreatedAt || Date.now());
        const ageHours = ageMs / 3600000;

        // Alive: good liquidity, active trading, been around for 24h+
        return liquidity > 50000 && volume24h > 10000 && ageHours > 24;
      });

      for (const pair of aliveTokens.slice(0, 5)) {
        const tokenAddress = pair.baseToken?.address;
        if (!tokenAddress || existing.has(tokenAddress)) continue;

        const features = extractFeatures(pair);
        results.push({
          tokenAddress,
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          features,
          label: 'ALIVE',
          collectedAt: Date.now()
        });
        existing.add(tokenAddress);

        console.log(`    ✓ ALIVE: ${pair.baseToken?.symbol} - $${features.liquidity.toLocaleString()} liq, ${features.ageHours.toFixed(0)}h old`);
      }

      await sleep(500);
    } catch (error) {
      console.error(`  Error searching ${query}:`, error);
    }
  }

  return results;
}

async function findRecentRugs(existing: Set<string>): Promise<TokenData[]> {
  console.log('\n🔍 Searching for RECENT rugs (pump.fun style)...\n');
  const results: TokenData[] = [];

  // Get recently created tokens that already died
  const data = await rateLimitedFetch(`${DEXSCREENER_API}/tokens/solana/new`);

  if (!data.pairs) return results;

  for (const pair of data.pairs) {
    if (existing.has(pair.baseToken?.address)) continue;

    const liquidity = pair.liquidity?.usd || 0;
    const ageMs = Date.now() - (pair.pairCreatedAt || Date.now());
    const ageHours = ageMs / 3600000;

    // Recent rug: created 2-12h ago, liquidity is now <$500
    if (ageHours >= 2 && ageHours <= 12 && liquidity < 500) {
      const tokenAddress = pair.baseToken?.address;
      if (!tokenAddress) continue;

      const features = extractFeatures(pair);
      results.push({
        tokenAddress,
        symbol: pair.baseToken?.symbol || 'UNKNOWN',
        features,
        label: 'RUG',
        collectedAt: Date.now()
      });
      existing.add(tokenAddress);

      console.log(`  ✗ RECENT RUG: ${pair.baseToken?.symbol} - ${ageHours.toFixed(1)}h old, $${liquidity.toFixed(0)} liq`);
    }

    if (results.length >= 20) break;
  }

  return results;
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  ARGUS AI - Extreme Training Data Collection         ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  const existing = loadExistingTokens();
  const allResults: TokenData[] = [];

  // Collect dead tokens (confirmed rugs)
  const deadTokens = await findDeadTokens(existing);
  allResults.push(...deadTokens);

  // Collect survivor tokens (confirmed alive)
  const survivorTokens = await findSurvivorTokens(existing);
  allResults.push(...survivorTokens);

  // Collect recent rugs
  const recentRugs = await findRecentRugs(existing);
  allResults.push(...recentRugs);

  // Save to file
  console.log(`\n📁 Saving ${allResults.length} examples to ${OUTPUT_FILE}...\n`);

  for (const result of allResults) {
    appendFileSync(OUTPUT_FILE, JSON.stringify(result) + '\n');
  }

  // Summary
  const rugCount = allResults.filter(r => r.label === 'RUG').length;
  const aliveCount = allResults.filter(r => r.label === 'ALIVE').length;

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total collected:   ${allResults.length}`);
  console.log(`  Rugs:              ${rugCount}`);
  console.log(`  Survivors:         ${aliveCount}`);
  console.log(`  Balance:           ${(rugCount / allResults.length * 100).toFixed(1)}% rugs`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
