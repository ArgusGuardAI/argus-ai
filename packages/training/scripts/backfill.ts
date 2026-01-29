#!/usr/bin/env npx tsx
/**
 * Training Data Backfill Script
 *
 * Fetches tokens from DexScreener and analyzes them via Sentinel API
 * to build up training data for BitNet fine-tuning.
 *
 * Usage:
 *   pnpm backfill --count 100 --delay 2000
 */

import { Command } from 'commander';

const SENTINEL_API = 'https://argusguard-api.hermosillo-jessie.workers.dev/sentinel/analyze';
const DEXSCREENER_API = 'https://api.dexscreener.com';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const TRAINING_API = 'https://argusguard-api.hermosillo-jessie.workers.dev/training';

interface TokenResult {
  address: string;
  symbol: string;
  score: number;
  level: string;
  bundleDetected: boolean;
  error?: string;
}

interface DexPair {
  chainId: string;
  baseToken: {
    address: string;
    symbol: string;
    name: string;
  };
  liquidity?: { usd: number };
  pairCreatedAt?: number;
}

// Fetch recent Solana tokens from DexScreener
async function fetchTokens(query: string, limit: number): Promise<string[]> {
  console.log(`\n[Backfill] Fetching tokens with query: "${query}"...`);

  const response = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`);

  if (!response.ok) {
    throw new Error(`DexScreener error: ${response.status}`);
  }

  const data = await response.json() as { pairs: DexPair[] };

  // Filter for Solana tokens and deduplicate
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const pair of data.pairs || []) {
    if (pair.chainId !== 'solana') continue;
    if (seen.has(pair.baseToken.address)) continue;

    seen.add(pair.baseToken.address);
    tokens.push(pair.baseToken.address);

    if (tokens.length >= limit) break;
  }

  console.log(`[Backfill] Found ${tokens.length} unique Solana tokens`);
  return tokens;
}

// Fetch token profiles (recently updated tokens)
async function fetchRecentTokens(limit: number): Promise<string[]> {
  console.log(`\n[Backfill] Fetching recent token profiles...`);

  const response = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);

  if (!response.ok) {
    throw new Error(`DexScreener profiles error: ${response.status}`);
  }

  const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;

  const tokens = data
    .filter(t => t.chainId === 'solana')
    .map(t => t.tokenAddress)
    .slice(0, limit);

  console.log(`[Backfill] Found ${tokens.length} recent Solana tokens`);
  return tokens;
}

// Analyze a token via Sentinel API
async function analyzeToken(address: string): Promise<TokenResult> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Add admin auth to bypass rate limiting
    if (ADMIN_SECRET) {
      headers['Authorization'] = `Bearer ${ADMIN_SECRET}`;
    }

    const response = await fetch(SENTINEL_API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tokenAddress: address }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        address,
        symbol: '???',
        score: -1,
        level: 'ERROR',
        bundleDetected: false,
        error: `HTTP ${response.status}: ${error.slice(0, 100)}`,
      };
    }

    const data = await response.json() as {
      tokenInfo: { symbol: string };
      analysis: { riskScore: number; riskLevel: string };
      bundleInfo: { detected: boolean };
    };

    return {
      address,
      symbol: data.tokenInfo?.symbol || '???',
      score: data.analysis?.riskScore || 0,
      level: data.analysis?.riskLevel || 'UNKNOWN',
      bundleDetected: data.bundleInfo?.detected || false,
    };
  } catch (error) {
    return {
      address,
      symbol: '???',
      score: -1,
      level: 'ERROR',
      bundleDetected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Get current training stats
async function getTrainingStats(): Promise<{ total: number; recentCount: number }> {
  if (!ADMIN_SECRET) {
    return { total: 0, recentCount: 0 };
  }

  try {
    const response = await fetch(`${TRAINING_API}/stats`, {
      headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
    });

    if (response.ok) {
      return await response.json() as { total: number; recentCount: number };
    }
  } catch (e) {
    // Ignore errors
  }

  return { total: 0, recentCount: 0 };
}

// Main backfill function
async function backfill(options: {
  count: number;
  delay: number;
  query: string;
  recent: boolean;
}) {
  console.log('='.repeat(60));
  console.log('ARGUS AI - TRAINING DATA BACKFILL');
  console.log('='.repeat(60));
  console.log(`Target: ${options.count} tokens`);
  console.log(`Delay: ${options.delay}ms between requests`);
  console.log(`Query: ${options.query}`);
  console.log(`Recent mode: ${options.recent}`);

  // Get initial stats
  const initialStats = await getTrainingStats();
  console.log(`\nInitial training examples: ${initialStats.total}`);

  // Fetch tokens
  let tokens: string[];
  if (options.recent) {
    tokens = await fetchRecentTokens(options.count);
  } else {
    tokens = await fetchTokens(options.query, options.count);
  }

  if (tokens.length === 0) {
    console.log('\nNo tokens found. Try a different query.');
    return;
  }

  // Process tokens
  const results: TokenResult[] = [];
  const stats = {
    total: 0,
    success: 0,
    errors: 0,
    bundles: 0,
    byLevel: { SAFE: 0, SUSPICIOUS: 0, DANGEROUS: 0, SCAM: 0, ERROR: 0, UNKNOWN: 0 },
  };

  console.log(`\n[Backfill] Processing ${tokens.length} tokens...\n`);

  for (let i = 0; i < tokens.length; i++) {
    const address = tokens[i];
    const progress = `[${i + 1}/${tokens.length}]`;

    process.stdout.write(`${progress} Analyzing ${address.slice(0, 8)}...`);

    const result = await analyzeToken(address);
    results.push(result);
    stats.total++;

    if (result.error) {
      stats.errors++;
      stats.byLevel.ERROR++;
      console.log(` ERROR: ${result.error.slice(0, 50)}`);
    } else {
      stats.success++;
      stats.byLevel[result.level as keyof typeof stats.byLevel]++;
      if (result.bundleDetected) stats.bundles++;

      const levelColor =
        result.level === 'SAFE' ? '\x1b[32m' :
        result.level === 'SUSPICIOUS' ? '\x1b[33m' :
        result.level === 'DANGEROUS' ? '\x1b[31m' :
        result.level === 'SCAM' ? '\x1b[35m' : '\x1b[0m';

      console.log(` ${result.symbol.padEnd(10)} ${levelColor}${result.level.padEnd(12)}\x1b[0m Score: ${result.score}${result.bundleDetected ? ' [BUNDLE]' : ''}`);
    }

    // Delay between requests
    if (i < tokens.length - 1) {
      await new Promise(resolve => setTimeout(resolve, options.delay));
    }
  }

  // Final stats
  const finalStats = await getTrainingStats();

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`\nTokens processed: ${stats.total}`);
  console.log(`Successful: ${stats.success}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Bundles detected: ${stats.bundles}`);
  console.log(`\nBy risk level:`);
  console.log(`  SAFE:       ${stats.byLevel.SAFE}`);
  console.log(`  SUSPICIOUS: ${stats.byLevel.SUSPICIOUS}`);
  console.log(`  DANGEROUS:  ${stats.byLevel.DANGEROUS}`);
  console.log(`  SCAM:       ${stats.byLevel.SCAM}`);
  console.log(`\nTraining examples: ${initialStats.total} → ${finalStats.total} (+${finalStats.total - initialStats.total})`);
}

// CLI
const program = new Command();

program
  .name('backfill')
  .description('Backfill training data by analyzing tokens')
  .option('-c, --count <number>', 'Number of tokens to analyze', '50')
  .option('-d, --delay <ms>', 'Delay between requests in ms', '2000')
  .option('-q, --query <string>', 'Search query for DexScreener', 'solana pump')
  .option('-r, --recent', 'Use recent token profiles instead of search', false)
  .action(async (options) => {
    await backfill({
      count: parseInt(options.count),
      delay: parseInt(options.delay),
      query: options.query,
      recent: options.recent,
    });
  });

program.parse();
