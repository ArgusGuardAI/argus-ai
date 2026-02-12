#!/usr/bin/env npx tsx
/**
 * Mass Data Collection Pipeline
 *
 * Collects thousands of Solana token samples from DexScreener:
 * 1. Fetches new token launches continuously
 * 2. Records their initial state (features)
 * 3. Checks outcomes after 24-48 hours
 * 4. Builds labeled training data at scale
 *
 * Data sources:
 * - DexScreener API (free, rate-limited)
 * - Token profiles endpoint
 * - Pair/token data endpoint
 *
 * Configuration via environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/mass-collect.ts --mode fetch     # Fetch new tokens
 *   npx tsx scripts/mass-collect.ts --mode outcomes  # Label with outcomes
 *   npx tsx scripts/mass-collect.ts --mode both      # Do both
 *   npx tsx scripts/mass-collect.ts --mode stats     # Show statistics
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';

// ============================================
// CONFIGURATION (via environment variables)
// ============================================

function parseEnvInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : defaultVal;
}

function parseEnvFloat(key: string, defaultVal: number): number {
  const val = process.env[key];
  return val ? parseFloat(val) : defaultVal;
}

function parseEnvString(key: string, defaultVal: string): string {
  return process.env[key] || defaultVal;
}

const CONFIG = {
  // File paths (env: ARGUS_RAW_TOKENS_FILE, ARGUS_LABELED_FILE, ARGUS_TRAINING_FILE)
  rawTokensFile: parseEnvString('ARGUS_RAW_TOKENS_FILE', './data/raw-pumpfun.jsonl'),
  labeledDataFile: parseEnvString('ARGUS_LABELED_FILE', './data/labeled-tokens.jsonl'),
  trainingFile: parseEnvString('ARGUS_TRAINING_FILE', './data/training-large.jsonl'),

  // DexScreener rate limits (env: ARGUS_REQUEST_DELAY_MS, ARGUS_BATCH_SIZE)
  // Default: 200ms = 5 req/sec, well under DexScreener's 300 req/min limit
  requestDelayMs: parseEnvInt('ARGUS_REQUEST_DELAY_MS', 200),
  batchSize: parseEnvInt('ARGUS_BATCH_SIZE', 50),

  // Outcome thresholds (env: ARGUS_RUG_PRICE_DROP, ARGUS_RUG_LIQ_MIN, etc.)
  rugPriceDropPercent: parseEnvFloat('ARGUS_RUG_PRICE_DROP', 90),
  rugLiquidityMin: parseEnvFloat('ARGUS_RUG_LIQ_MIN', 100),
  stableMinAgeHours: parseEnvFloat('ARGUS_STABLE_AGE_HOURS', 48),
  stableMinLiquidity: parseEnvFloat('ARGUS_STABLE_LIQ_MIN', 1000),

  // Loop timing (env: ARGUS_LOOP_FETCH_DELAY, ARGUS_LOOP_CYCLE_DELAY)
  loopFetchDelayMs: parseEnvInt('ARGUS_LOOP_FETCH_DELAY', 30000),
  loopCycleDelayMs: parseEnvInt('ARGUS_LOOP_CYCLE_DELAY', 120000),
};

// ============================================
// DATA STRUCTURES
// ============================================

interface RawToken {
  address: string;
  name: string;
  symbol: string;
  discoveredAt: number;
  source: 'profiles' | 'boosts' | 'search';
  initialData?: {
    priceUsd: number;
    liquidity: number;
    marketCap: number;
    volume24h: number;
    txns24h: { buys: number; sells: number };
    holders?: number;
    pairAddress?: string;
  };
}

interface LabeledToken extends RawToken {
  checkedAt: number;
  outcome: 'rug' | 'stable' | 'unknown';
  outcomeData: {
    currentPrice?: number;
    priceDropPercent?: number;
    currentLiquidity?: number;
    liquidityDropPercent?: number;
    ageHours: number;
  };
}

interface TrainingExample {
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
  };
}

// ============================================
// DEXSCREENER API
// ============================================

async function fetchLatestProfiles(): Promise<RawToken[]> {
  console.log('[Fetch] Getting latest token profiles from DexScreener...');

  try {
    const response = await fetch(
      'https://api.dexscreener.com/token-profiles/latest/v1',
      { headers: { 'User-Agent': 'ArgusTraining/1.0' } }
    );

    if (!response.ok) {
      console.error(`[Fetch] Profiles API error: ${response.status}`);
      return [];
    }

    const profiles = await response.json() as any[];
    const solanaProfiles = profiles.filter((p: any) => p.chainId === 'solana');

    console.log(`[Fetch] Found ${solanaProfiles.length} Solana tokens in profiles`);

    return solanaProfiles.map((p: any) => ({
      address: p.tokenAddress,
      name: p.description || 'Unknown',
      symbol: p.tokenAddress.slice(0, 6),
      discoveredAt: Date.now(),
      source: 'profiles' as const,
    }));
  } catch (error) {
    console.error('[Fetch] Profiles error:', error);
    return [];
  }
}

async function fetchBoostedTokens(): Promise<RawToken[]> {
  console.log('[Fetch] Getting boosted tokens from DexScreener...');

  try {
    const response = await fetch(
      'https://api.dexscreener.com/token-boosts/top/v1',
      { headers: { 'User-Agent': 'ArgusTraining/1.0' } }
    );

    if (!response.ok) {
      console.error(`[Fetch] Boosts API error: ${response.status}`);
      return [];
    }

    const boosts = await response.json() as any[];
    const solanaBoosts = boosts.filter((b: any) => b.chainId === 'solana');

    console.log(`[Fetch] Found ${solanaBoosts.length} Solana tokens in boosts`);

    return solanaBoosts.map((b: any) => ({
      address: b.tokenAddress,
      name: b.description || 'Unknown',
      symbol: b.tokenAddress.slice(0, 6),
      discoveredAt: Date.now(),
      source: 'boosts' as const,
    }));
  } catch (error) {
    console.error('[Fetch] Boosts error:', error);
    return [];
  }
}

async function fetchTokenDetails(addresses: string[]): Promise<Map<string, any>> {
  const details = new Map<string, any>();

  // Batch in groups of 30
  for (let i = 0; i < addresses.length; i += CONFIG.batchSize) {
    const batch = addresses.slice(i, i + CONFIG.batchSize);
    const addressList = batch.join(',');

    try {
      const response = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${addressList}`,
        { headers: { 'User-Agent': 'ArgusTraining/1.0' } }
      );

      if (!response.ok) {
        console.log(`[Fetch] Token details batch error: ${response.status}`);
        await sleep(CONFIG.requestDelayMs);
        continue;
      }

      const pairs = await response.json() as any[];

      for (const pair of pairs) {
        if (pair.baseToken) {
          details.set(pair.baseToken.address, {
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            priceUsd: parseFloat(pair.priceUsd) || 0,
            liquidity: pair.liquidity?.usd || 0,
            marketCap: pair.marketCap || 0,
            volume24h: pair.volume?.h24 || 0,
            txns24h: {
              buys: pair.txns?.h24?.buys || 0,
              sells: pair.txns?.h24?.sells || 0,
            },
            pairAddress: pair.pairAddress,
            pairCreatedAt: pair.pairCreatedAt,
          });
        }
      }

      await sleep(CONFIG.requestDelayMs);
    } catch (error) {
      console.error('[Fetch] Token details error:', error);
    }
  }

  return details;
}

// Expanded search queries for maximum token discovery
const SEARCH_QUERIES = [
  // Core meme terms
  'pump', 'meme', 'moon', 'rocket', 'lambo', 'ape', 'degen',
  // Animals
  'dog', 'cat', 'frog', 'pepe', 'doge', 'shib', 'inu', 'bear', 'bull', 'monkey', 'whale',
  // Political
  'trump', 'biden', 'elon', 'musk', 'obama', 'politics',
  // Tech/AI
  'ai', 'gpt', 'agent', 'bot', 'neural', 'quantum', 'cyber',
  // Finance
  'gold', 'diamond', 'gem', 'rich', 'money', 'cash', 'bank',
  // Modifiers
  'baby', 'mini', 'mega', 'super', 'ultra', 'king', 'queen',
  // Crypto terms
  'sol', 'solana', 'token', 'coin', 'swap', 'yield', 'stake',
  // Seasonal
  'santa', 'christmas', 'halloween', 'easter', 'valentine',
  // Trending
  'wojak', 'chad', 'sigma', 'alpha', 'based', 'goat',
  // Random high-volume
  '100x', '1000x', 'safe', 'fair', 'launch',
];

async function searchNewTokens(query: string = ''): Promise<RawToken[]> {
  console.log(`[Fetch] Searching for tokens: "${query || 'recent'}"...`);

  try {
    // Search for recent Solana tokens
    const searchTerms = query || 'pump sol meme';
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchTerms)}`,
      { headers: { 'User-Agent': 'ArgusTraining/1.0' } }
    );

    if (!response.ok) {
      console.error(`[Fetch] Search API error: ${response.status}`);
      return [];
    }

    const data = await response.json() as { pairs?: any[] };
    const solanaPairs = (data.pairs || []).filter((p: any) => p.chainId === 'solana');

    console.log(`[Fetch] Found ${solanaPairs.length} Solana pairs in search`);

    return solanaPairs.map((p: any) => ({
      address: p.baseToken?.address || '',
      name: p.baseToken?.name || 'Unknown',
      symbol: p.baseToken?.symbol || '???',
      discoveredAt: Date.now(),
      source: 'search' as const,
      initialData: {
        priceUsd: parseFloat(p.priceUsd) || 0,
        liquidity: p.liquidity?.usd || 0,
        marketCap: p.marketCap || 0,
        volume24h: p.volume?.h24 || 0,
        txns24h: {
          buys: p.txns?.h24?.buys || 0,
          sells: p.txns?.h24?.sells || 0,
        },
        pairAddress: p.pairAddress,
      },
    })).filter(t => t.address);
  } catch (error) {
    console.error('[Fetch] Search error:', error);
    return [];
  }
}

// ============================================
// DATA STORAGE
// ============================================

function loadRawTokens(): RawToken[] {
  if (!existsSync(CONFIG.rawTokensFile)) return [];

  const content = readFileSync(CONFIG.rawTokensFile, 'utf-8');
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function saveRawToken(token: RawToken): void {
  appendFileSync(CONFIG.rawTokensFile, JSON.stringify(token) + '\n');
}

function loadLabeledTokens(): LabeledToken[] {
  if (!existsSync(CONFIG.labeledDataFile)) return [];

  const content = readFileSync(CONFIG.labeledDataFile, 'utf-8');
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function saveLabeledToken(token: LabeledToken): void {
  appendFileSync(CONFIG.labeledDataFile, JSON.stringify(token) + '\n');
}

// ============================================
// OUTCOME CLASSIFICATION
// ============================================

function classifyOutcome(
  initial: RawToken['initialData'],
  current: { priceUsd: number; liquidity: number },
  ageHours: number
): { outcome: 'rug' | 'stable' | 'unknown'; priceDropPercent: number; liquidityDropPercent: number } {
  const initialPrice = initial?.priceUsd || 0;
  const initialLiquidity = initial?.liquidity || 0;

  const priceDropPercent = initialPrice > 0
    ? ((initialPrice - current.priceUsd) / initialPrice) * 100
    : 0;

  const liquidityDropPercent = initialLiquidity > 0
    ? ((initialLiquidity - current.liquidity) / initialLiquidity) * 100
    : 0;

  // Rug conditions
  if (priceDropPercent >= CONFIG.rugPriceDropPercent) {
    return { outcome: 'rug', priceDropPercent, liquidityDropPercent };
  }
  if (current.liquidity < CONFIG.rugLiquidityMin && initialLiquidity > 1000) {
    return { outcome: 'rug', priceDropPercent, liquidityDropPercent };
  }

  // Stable conditions
  if (ageHours >= CONFIG.stableMinAgeHours && current.liquidity >= CONFIG.stableMinLiquidity) {
    return { outcome: 'stable', priceDropPercent, liquidityDropPercent };
  }

  return { outcome: 'unknown', priceDropPercent, liquidityDropPercent };
}

// ============================================
// FEATURE EXTRACTION (Simplified for training)
// ============================================

function extractFeatures(token: LabeledToken): number[] {
  const data = token.initialData;
  if (!data) return new Array(29).fill(0);

  // Normalize features to 0-1 range
  const features = [
    // Market (5)
    Math.min(Math.log10(data.liquidity + 1) / 7, 1),           // liquidityLog
    Math.min((data.volume24h / Math.max(data.liquidity, 1)) / 10, 1), // volumeToLiquidity
    Math.min(Math.log10(data.marketCap + 1) / 10, 1),          // marketCapLog
    0.5,                                                        // priceVelocity (unknown at discovery)
    Math.min(Math.log10(data.volume24h + 1) / 8, 1),           // volumeLog

    // Holders (6) - mostly unknown at discovery
    0.3,  // holderCountLog
    0.5,  // top10Concentration
    0.5,  // giniCoefficient
    0.5,  // freshWalletRatio
    0.1,  // whaleCount
    0.2,  // topWhalePercent

    // Security (4) - assume worst case for training
    0.5,  // mintDisabled (unknown)
    0.5,  // freezeDisabled (unknown)
    0.3,  // lpLocked
    0.2,  // lpBurned

    // Bundle (5) - unknown at discovery
    0,    // bundleDetected
    0,    // bundleCountNorm
    0,    // bundleControlPercent
    0.5,  // bundleConfidence
    0.5,  // bundleQuality

    // Trading (4)
    data.txns24h ? Math.min(data.txns24h.buys / (data.txns24h.buys + data.txns24h.sells + 1), 1) : 0.5, // buyRatio24h
    0.5,  // buyRatio1h
    Math.min((data.txns24h?.buys || 0 + data.txns24h?.sells || 0) / 1000, 1), // activityLevel
    0.5,  // momentum

    // Time (2)
    1.0,  // ageDecay (new token)
    1.0,  // tradingRecency

    // Creator (3) - unknown
    0,    // creatorIdentified
    0,    // creatorRugHistory
    0.5,  // creatorHoldings
  ];

  return features;
}

function generateTrainingScore(token: LabeledToken): { score: number; level: string; label: number } {
  // Generate a score based on outcome
  // This creates the "ground truth" for training
  if (token.outcome === 'rug') {
    // Rugs should have high risk scores (70-95)
    const basScore = 75 + Math.random() * 20;
    return {
      score: Math.round(basScore),
      level: basScore >= 80 ? 'SCAM' : 'DANGEROUS',
      label: basScore >= 80 ? 3 : 2, // SCAM=3, DANGEROUS=2
    };
  } else if (token.outcome === 'stable') {
    // Stable tokens should have low risk scores (20-50)
    const baseScore = 20 + Math.random() * 30;
    return {
      score: Math.round(baseScore),
      level: baseScore >= 40 ? 'SUSPICIOUS' : 'SAFE',
      label: baseScore >= 40 ? 1 : 0, // SUSPICIOUS=1, SAFE=0
    };
  } else {
    // Unknown - middle ground
    return {
      score: 50,
      level: 'SUSPICIOUS',
      label: 1,
    };
  }
}

// ============================================
// MAIN FUNCTIONS
// ============================================

async function fetchNewTokens(): Promise<number> {
  console.log('\n=== FETCHING NEW TOKENS ===\n');

  const existingTokens = new Set(loadRawTokens().map(t => t.address));
  console.log(`[Storage] ${existingTokens.size} tokens already in database`);

  let newCount = 0;

  // Fetch from multiple sources
  const sources = [
    fetchLatestProfiles(),
    fetchBoostedTokens(),
    searchNewTokens('pump'),
    searchNewTokens('meme'),
    searchNewTokens('sol'),
    searchNewTokens('ai'),
    searchNewTokens('dog'),
    searchNewTokens('cat'),
  ];

  const results = await Promise.all(sources);
  const allTokens = results.flat();

  // Dedupe and filter new tokens
  const newTokens = allTokens.filter(t => !existingTokens.has(t.address));
  const uniqueNew = [...new Map(newTokens.map(t => [t.address, t])).values()];

  console.log(`[Fetch] Found ${uniqueNew.length} new unique tokens`);

  // Get details for new tokens
  if (uniqueNew.length > 0) {
    const addresses = uniqueNew.map(t => t.address);
    const details = await fetchTokenDetails(addresses);

    for (const token of uniqueNew) {
      const detail = details.get(token.address);
      if (detail) {
        token.name = detail.name || token.name;
        token.symbol = detail.symbol || token.symbol;
        token.initialData = {
          priceUsd: detail.priceUsd,
          liquidity: detail.liquidity,
          marketCap: detail.marketCap,
          volume24h: detail.volume24h,
          txns24h: detail.txns24h,
          pairAddress: detail.pairAddress,
        };
      }

      saveRawToken(token);
      newCount++;
    }
  }

  console.log(`[Storage] Saved ${newCount} new tokens`);
  return newCount;
}

async function collectOutcomes(): Promise<{ rugs: number; stable: number; unknown: number }> {
  console.log('\n=== COLLECTING OUTCOMES ===\n');

  const rawTokens = loadRawTokens();
  const labeledAddresses = new Set(loadLabeledTokens().map(t => t.address));

  // Find tokens that are old enough to check but not yet labeled
  const now = Date.now();
  const minAgeMs = CONFIG.stableMinAgeHours * 60 * 60 * 1000;

  const tokensToCheck = rawTokens.filter(t =>
    !labeledAddresses.has(t.address) &&
    (now - t.discoveredAt) >= minAgeMs
  );

  console.log(`[Outcomes] ${tokensToCheck.length} tokens ready to check (>${CONFIG.stableMinAgeHours}h old)`);

  let rugs = 0, stable = 0, unknown = 0;

  // Check in batches
  for (let i = 0; i < tokensToCheck.length; i += CONFIG.batchSize) {
    const batch = tokensToCheck.slice(i, i + CONFIG.batchSize);
    const addresses = batch.map(t => t.address);

    console.log(`[Outcomes] Checking batch ${Math.floor(i / CONFIG.batchSize) + 1}/${Math.ceil(tokensToCheck.length / CONFIG.batchSize)}...`);

    const details = await fetchTokenDetails(addresses);

    for (const token of batch) {
      const detail = details.get(token.address);
      const ageHours = (now - token.discoveredAt) / (60 * 60 * 1000);

      const currentData = {
        priceUsd: detail?.priceUsd || 0,
        liquidity: detail?.liquidity || 0,
      };

      const { outcome, priceDropPercent, liquidityDropPercent } = classifyOutcome(
        token.initialData,
        currentData,
        ageHours
      );

      const labeled: LabeledToken = {
        ...token,
        checkedAt: now,
        outcome,
        outcomeData: {
          currentPrice: currentData.priceUsd,
          priceDropPercent,
          currentLiquidity: currentData.liquidity,
          liquidityDropPercent,
          ageHours,
        },
      };

      saveLabeledToken(labeled);

      if (outcome === 'rug') rugs++;
      else if (outcome === 'stable') stable++;
      else unknown++;
    }

    await sleep(CONFIG.requestDelayMs);
  }

  console.log(`[Outcomes] Results: ${rugs} rugs, ${stable} stable, ${unknown} unknown`);
  return { rugs, stable, unknown };
}

function buildTrainingData(): number {
  console.log('\n=== BUILDING TRAINING DATA ===\n');

  const labeled = loadLabeledTokens().filter(t => t.outcome !== 'unknown');
  console.log(`[Training] ${labeled.length} labeled tokens (excluding unknowns)`);

  const examples: TrainingExample[] = [];

  for (const token of labeled) {
    const features = extractFeatures(token);
    const target = generateTrainingScore(token);

    examples.push({
      features,
      target,
      meta: {
        id: token.address,
        symbol: token.symbol,
        wasOverridden: false,
        outcomeKnown: true,
        outcome: token.outcome,
        priceDropPercent: token.outcomeData.priceDropPercent,
      },
    });
  }

  // Write training file
  writeFileSync(
    CONFIG.trainingFile,
    examples.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  console.log(`[Training] Wrote ${examples.length} examples to ${CONFIG.trainingFile}`);

  // Stats
  const rugs = examples.filter(e => e.meta.outcome === 'rug').length;
  const stable = examples.filter(e => e.meta.outcome === 'stable').length;
  console.log(`[Training] Distribution: ${rugs} rugs (${(rugs/examples.length*100).toFixed(1)}%), ${stable} stable (${(stable/examples.length*100).toFixed(1)}%)`);

  return examples.length;
}

function showStats(): void {
  console.log('\n=== DATA STATISTICS ===\n');

  const raw = loadRawTokens();
  const labeled = loadLabeledTokens();

  console.log(`Raw tokens collected:     ${raw.length}`);
  console.log(`Tokens with outcomes:     ${labeled.length}`);

  if (labeled.length > 0) {
    const rugs = labeled.filter(t => t.outcome === 'rug').length;
    const stable = labeled.filter(t => t.outcome === 'stable').length;
    const unknown = labeled.filter(t => t.outcome === 'unknown').length;

    console.log(`  - Rugged:               ${rugs} (${(rugs/labeled.length*100).toFixed(1)}%)`);
    console.log(`  - Stable:               ${stable} (${(stable/labeled.length*100).toFixed(1)}%)`);
    console.log(`  - Unknown:              ${unknown} (${(unknown/labeled.length*100).toFixed(1)}%)`);
  }

  // Pending (can be checked)
  const now = Date.now();
  const minAgeMs = CONFIG.stableMinAgeHours * 60 * 60 * 1000;
  const labeledAddresses = new Set(labeled.map(t => t.address));
  const pending = raw.filter(t =>
    !labeledAddresses.has(t.address) &&
    (now - t.discoveredAt) >= minAgeMs
  );
  const tooNew = raw.filter(t =>
    !labeledAddresses.has(t.address) &&
    (now - t.discoveredAt) < minAgeMs
  );

  console.log(`\nPending outcome check:    ${pending.length}`);
  console.log(`Too new (<${CONFIG.stableMinAgeHours}h):           ${tooNew.length}`);

  if (existsSync(CONFIG.trainingFile)) {
    const training = readFileSync(CONFIG.trainingFile, 'utf-8').trim().split('\n').length;
    console.log(`\nTraining examples:        ${training}`);
  }
}

// ============================================
// UTILITIES
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// CLI
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find(a => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'stats';

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Mass Data Collection Pipeline                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  switch (mode) {
    case 'fetch':
      await fetchNewTokens();
      break;

    case 'outcomes':
      await collectOutcomes();
      break;

    case 'build':
      buildTrainingData();
      break;

    case 'both':
      await fetchNewTokens();
      await sleep(1000);
      await collectOutcomes();
      buildTrainingData();
      break;

    case 'loop':
      // Continuous collection loop
      console.log('[Loop] Starting continuous collection (Ctrl+C to stop)...');
      console.log(`[Loop] Config: fetchDelay=${CONFIG.loopFetchDelayMs}ms, cycleDelay=${CONFIG.loopCycleDelayMs}ms`);
      console.log(`[Loop] Rate: requestDelay=${CONFIG.requestDelayMs}ms, batchSize=${CONFIG.batchSize}\n`);
      while (true) {
        await fetchNewTokens();
        await sleep(CONFIG.loopFetchDelayMs);
        await collectOutcomes();
        buildTrainingData();
        showStats();
        console.log(`\n[Loop] Sleeping ${CONFIG.loopCycleDelayMs / 1000}s before next cycle...\n`);
        await sleep(CONFIG.loopCycleDelayMs);
      }
      break;

    case 'stats':
    default:
      showStats();
      break;
  }

  console.log('');
}

main().catch(console.error);
