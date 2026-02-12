#!/usr/bin/env npx tsx
/**
 * ARGUS AI - FULL AGI Paper Trading with Yellowstone Real-Time Feed
 *
 * FULL AGI STACK:
 * - Yellowstone gRPC for instant pool detection
 * - BitNet 29-feature neural classifier (80.6% accuracy)
 * - DeepSeek-R1 32B for deep chain-of-thought reasoning
 * - Qwen 3 8B for fast classification
 * - PatternLibrary with 8 known scam patterns
 * - OutcomeLearner for self-improvement
 * - Database persistence for learning
 */

import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { PoolMonitor } from '../../monitor/dist/pool-monitor.js';
import type { PoolEvent } from '../../monitor/dist/pool-monitor.js';
import {
  BitNetEngine,
  LLMService,
  PatternLibrary,
  OutcomeLearner,
  type ClassifierOutput,
  type PatternMatch,
} from '../../agents/dist/index.mjs';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const POSITIONS_FILE = './data/paper-agi-positions.json';
const TRADES_FILE = './data/paper-agi-trades.jsonl';
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://144.XX.XX.XXX:8899';
const WORKERS_API_URL = process.env.WORKERS_API_URL || 'https://argusguard-api.hermosillo-jessie.workers.dev';
const WORKERS_API_SECRET = process.env.WORKERS_API_SECRET || '';

// Trading config - Using Yellowstone data directly
const CONFIG = {
  BASE_POSITION: 0.1,
  MAX_POSITIONS: 5,
  MONITOR_INTERVAL: 15000,
  // Entry filters - SOL-based (3 SOL = ~$450)
  MIN_LIQUIDITY: 900,          // $900 min (~3 SOL * $150 * 2)
  MIN_SOL_RESERVES: 3,         // 3 SOL minimum in pool
  MAX_PUMP_5M: 100,            // Reject if already pumped >100% in 5m
  MAX_RISK_SCORE: 75,          // BitNet threshold - bonding curves score higher (that's fine)
  // Activity filters - don't waste LLM on dead tokens
  MIN_VOLUME_24H: 100,         // At least $100 volume
  MIN_TXNS_5M: 2,              // At least 2 transactions in 5m (shows life)
};

interface Position {
  tokenAddress: string;
  symbol: string;
  entryPrice: number;
  entryTime: number;
  size: number;
  highPrice: number;
  currentPrice: number;
  pnlPercent: number;
  llmReasoning?: string;
  isBondingCurve?: boolean;  // True if bought on bonding curve (not graduated)
}

interface Trade {
  tokenAddress: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  pnlPercent?: number;
  pnlSol?: number;
  reason?: string;
  timestamp: number;
}

interface DexPair {
  chainId: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd: string;
  liquidity?: { usd: number };
  volume?: { h24: number };
  priceChange?: { m5?: number; h1?: number; h24?: number };
  txns?: {
    m5?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  pairCreatedAt?: number;
  fdv?: number;
}

// State
let positions: Position[] = [];
let totalPnl = 0;
let totalTrades = 0;
let wins = 0;
let losses = 0;
let llmAvailable = false;
let llmCalls = 0;
let poolsDetected = 0;
let poolMonitor: PoolMonitor | null = null;

// AGI Stack
let bitnetEngine: BitNetEngine | null = null;
let llmService: LLMService | null = null;
let patternLibrary: PatternLibrary | null = null;
let outcomeLearner: OutcomeLearner | null = null;

// AGI Stats
let bitnetClassifications = 0;
let rejectedByBitnet = 0;
let rejectedByPump = 0;
let patternsMatched = 0;
let predictionsRecorded = 0;

// Queue of new pools to evaluate
const poolQueue: PoolEvent[] = [];

/**
 * Extract 29-dimensional feature vector from DexScreener data
 * This is the CORE intelligence - not random LLM guessing
 */
function extractFeatures(pair: DexPair, poolEvent?: PoolEvent): Float32Array {
  const features = new Float32Array(29);

  // Market features (0-4)
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const mcap = pair.fdv || 0;

  features[0] = Math.min(1, Math.log10(Math.max(1, liq)) / 7);  // liquidityLog (0-1, log scale up to $10M)
  features[1] = Math.min(1, vol / Math.max(1, liq));             // volumeToLiquidity ratio
  features[2] = Math.min(1, Math.log10(Math.max(1, mcap)) / 9);  // marketCapLog
  features[3] = Math.min(1, Math.max(0, ((pair.priceChange?.m5 || 0) + 100) / 200)); // priceVelocity (normalized -100% to +100%)
  features[4] = Math.min(1, Math.log10(Math.max(1, vol)) / 7);   // volumeLog

  // Holder features (5-10) - estimate from trading activity
  const buys24h = pair.txns?.h24?.buys || 0;
  const sells24h = pair.txns?.h24?.sells || 0;
  const totalTxns = buys24h + sells24h;
  const estimatedHolders = Math.min(1000, Math.max(10, totalTxns / 5)); // Rough estimate

  features[5] = Math.min(1, Math.log10(Math.max(1, estimatedHolders)) / 4); // holderCountLog
  features[6] = 0.5;  // top10Concentration - unknown from DexScreener, assume medium
  features[7] = 0.5;  // giniCoefficient - unknown, assume medium
  features[8] = 0.5;  // freshWalletRatio - unknown
  features[9] = 0.1;  // whaleCount - unknown
  features[10] = 0.2; // topWhalePercent - unknown, assume 20%

  // Security features (11-14) - assume safe unless we know otherwise
  features[11] = 1;   // mintDisabled - assume yes (1 = good)
  features[12] = 1;   // freezeDisabled - assume yes (1 = good)
  features[13] = 0;   // lpLocked - unknown
  features[14] = 0;   // lpBurned - unknown

  // Bundle features (15-19) - from Yellowstone if available
  const isGraduated = poolEvent?.enrichedData?.complete || false;
  features[15] = 0;   // bundleDetected - assume no
  features[16] = 0;   // bundleCountNorm
  features[17] = 0;   // bundleControlPercent
  features[18] = 0;   // bundleConfidence
  features[19] = isGraduated ? 0.9 : 0.5; // bundleQuality - graduated = higher quality

  // Trading features (20-23)
  const buyRatio = totalTxns > 0 ? buys24h / totalTxns : 0.5;
  const buys1h = pair.txns?.m5?.buys || 0; // Using m5 as proxy for 1h
  const sells1h = pair.txns?.m5?.sells || 0;
  const buyRatio1h = (buys1h + sells1h) > 0 ? buys1h / (buys1h + sells1h) : 0.5;

  features[20] = buyRatio;     // buyRatio24h
  features[21] = buyRatio1h;   // buyRatio1h
  features[22] = Math.min(1, totalTxns / 500); // activityLevel
  features[23] = Math.min(1, Math.max(0, ((pair.priceChange?.m5 || 0) + 50) / 100)); // momentum

  // Time features (24-25)
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / (1000 * 60 * 60);
  features[24] = Math.max(0, 1 - (ageHours / 24)); // ageDecay (1 = brand new, 0 = 24h old)
  features[25] = 0.8; // tradingRecency - assume recent

  // Creator features (26-28) - unknown from DexScreener
  features[26] = 0;   // creatorIdentified - no
  features[27] = 0;   // creatorRugHistory - unknown, assume clean
  features[28] = 0;   // creatorHoldings - unknown

  return features;
}

/**
 * Check for anti-pump signals (buying the top)
 */
function checkAntiPump(pair: DexPair): { reject: boolean; reason: string } {
  const pc5m = pair.priceChange?.m5 || 0;
  const pc1h = pair.priceChange?.h1 || 0;

  // Already pumped >100% in 5 minutes = buying the top
  if (pc5m > CONFIG.MAX_PUMP_5M) {
    return { reject: true, reason: `Already pumped ${pc5m.toFixed(0)}% in 5m - buying the top` };
  }

  // Dumping hard = momentum lost
  if (pc5m < -30) {
    return { reject: true, reason: `Dumping ${pc5m.toFixed(0)}% in 5m - momentum lost` };
  }

  // Massive pump in 1h followed by cooling = distribution phase
  if (pc1h > 200 && pc5m < 10) {
    return { reject: true, reason: `Pumped ${pc1h.toFixed(0)}% in 1h but cooling - distribution phase` };
  }

  return { reject: false, reason: '' };
}

// Single event type for sync
type SyncAlert = {
  agent: 'SCOUT' | 'ANALYST' | 'HUNTER' | 'TRADER';
  type: 'scan' | 'alert' | 'discovery' | 'analysis' | 'council';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  data?: {
    mint?: string;
    symbol?: string;
    dex?: string;
    pnl?: number;
    decision?: string;
    confidence?: number;
  };
};

// Sync single event to Workers API for dashboard visibility
async function syncToWorkers(alert: SyncAlert): Promise<void> {
  if (!WORKERS_API_URL) return;
  try {
    await fetch(`${WORKERS_API_URL}/agents/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKERS_API_SECRET ? { 'Authorization': `Bearer ${WORKERS_API_SECRET}` } : {}),
      },
      body: JSON.stringify({
        type: 'monitor_alert',
        alert,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    // Silently fail - dashboard sync is non-critical
  }
}

// Batch sync multiple events to Workers API (avoids KV race condition)
async function syncBatchToWorkers(alerts: SyncAlert[]): Promise<void> {
  if (!WORKERS_API_URL || alerts.length === 0) return;
  try {
    await fetch(`${WORKERS_API_URL}/agents/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKERS_API_SECRET ? { 'Authorization': `Bearer ${WORKERS_API_SECRET}` } : {}),
      },
      body: JSON.stringify({
        type: 'monitor_alert_batch',
        alerts,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    // Silently fail - dashboard sync is non-critical
  }
}

// Check LLM availability
async function checkLLM(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      llmAvailable = true;
      return true;
    }
  } catch {}
  llmAvailable = false;
  return false;
}

// Fetch token data from DexScreener (for price/volume after detection)
async function fetchToken(address: string): Promise<DexPair | null> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${address}`);
    if (!response.ok) return null;
    const data = await response.json() as { pairs?: DexPair[] };
    return data.pairs?.find(p => p.chainId === 'solana') || null;
  } catch {
    return null;
  }
}

// Build context for LLM
function buildTokenContext(pair: DexPair, poolEvent?: PoolEvent): string {
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const pc5m = pair.priceChange?.m5 || 0;
  const pc1h = pair.priceChange?.h1 || 0;
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageSec = ageMs / 1000;

  let enriched = '';
  if (poolEvent?.enrichedData) {
    const e = poolEvent.enrichedData;
    const liqSol = e.liquiditySol || 30;
    const bondingProgress = Math.min(100, (liqSol / 85) * 100);

    enriched = `
YELLOWSTONE BONDING CURVE:
- Status: ${e.complete ? 'GRADUATED (on Raydium)' : 'BONDING CURVE (pre-graduation)'}
- Liquidity: ${liqSol.toFixed(1)} SOL
- Progress to Graduation: ${bondingProgress.toFixed(0)}% (graduates at ~85 SOL)

BONDING CURVE SIGNALS:
- Progress > 50% = halfway to graduation, gaining momentum
- Progress > 70% = approaching graduation, higher chance of pump
- Progress > 90% = imminent graduation, Raydium listing soon
- complete = true = already graduated to Raydium`;
  }

  return `TOKEN: ${pair.baseToken.symbol} (${pair.baseToken.name})
ADDRESS: ${pair.baseToken.address.slice(0, 8)}...
DEX: ${poolEvent?.dex || 'unknown'}

METRICS:
- Age: ${ageSec.toFixed(0)} seconds (FRESH!)
- Liquidity: $${liq.toFixed(0)}
- 24h Volume: $${vol.toFixed(0)}

PRICE ACTION:
- 5m change: ${pc5m >= 0 ? '+' : ''}${pc5m.toFixed(1)}%
- 1h change: ${pc1h >= 0 ? '+' : ''}${pc1h.toFixed(1)}%

TRADING:
- 5m buys: ${buys5m} | sells: ${sells5m}
${enriched}`;
}

// Council decision (BitNet + LLM)
async function councilDecision(pair: DexPair, poolEvent?: PoolEvent): Promise<{
  decision: 'TRADE' | 'SKIP';
  confidence: number;
  reasoning: string;
  bitnetScore?: number;
  bitnetFlags?: string[];
} | null> {
  // ════════════════════════════════════════════════════════════════════
  // STEP 1: BitNet Classification (ACTUAL INTELLIGENCE)
  // ════════════════════════════════════════════════════════════════════

  const features = extractFeatures(pair, poolEvent);
  let bitnetResult: ClassifierOutput | null = null;

  if (bitnetEngine) {
    try {
      bitnetResult = await bitnetEngine.classify(features);
      bitnetClassifications++;

      console.log(`  [BITNET] ${pair.baseToken.symbol}: Score ${bitnetResult.riskScore}/100 | ${bitnetResult.riskLevel}`);
      if (bitnetResult.flags.length > 0) {
        console.log(`    Flags: ${bitnetResult.flags.map(f => f.type).join(', ')}`);
      }

      // AUTO-REJECT based on BitNet analysis
      if (bitnetResult.riskScore > CONFIG.MAX_RISK_SCORE) {
        rejectedByBitnet++;
        console.log(`  [BITNET] REJECT: Score ${bitnetResult.riskScore} > ${CONFIG.MAX_RISK_SCORE} threshold`);
        syncToWorkers({
          agent: 'ANALYST',
          type: 'analysis',
          message: `REJECTED $${pair.baseToken.symbol}: Risk score ${bitnetResult.riskScore}/100 (${bitnetResult.riskLevel})`,
          severity: 'warning',
          data: { mint: pair.baseToken.address, symbol: pair.baseToken.symbol },
        });
        return { decision: 'SKIP', confidence: 0, reasoning: `BitNet risk score ${bitnetResult.riskScore} too high` };
      }

      // Check for critical flags
      const criticalFlags = bitnetResult.flags.filter(f => f.severity === 'CRITICAL');
      if (criticalFlags.length > 0) {
        rejectedByBitnet++;
        console.log(`  [BITNET] REJECT: Critical flags: ${criticalFlags.map(f => f.type).join(', ')}`);
        syncToWorkers({
          agent: 'HUNTER',
          type: 'alert',
          message: `BLOCKED $${pair.baseToken.symbol}: ${criticalFlags.map(f => f.type).join(', ')}`,
          severity: 'critical',
          data: { mint: pair.baseToken.address, symbol: pair.baseToken.symbol },
        });
        return { decision: 'SKIP', confidence: 0, reasoning: `Critical flags: ${criticalFlags.map(f => f.type).join(', ')}` };
      }
    } catch (e) {
      console.log(`  [BITNET] Error: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // STEP 2: Pattern Matching (8 Known Scam Patterns)
  // ════════════════════════════════════════════════════════════════════

  let matchedPatterns: PatternMatch[] = [];
  if (patternLibrary) {
    try {
      matchedPatterns = patternLibrary.matchPatterns(features, {
        minSimilarity: 0.5,
        maxResults: 3,
        activeOnly: true,
      });

      if (matchedPatterns.length > 0) {
        patternsMatched++;
        const topMatch = matchedPatterns[0];
        console.log(`  [PATTERNS] ${pair.baseToken.symbol}: Top match: ${topMatch.pattern.name} (${(topMatch.confidence * 100).toFixed(0)}%)`);

        // AUTO-REJECT high-severity patterns with high confidence
        if (topMatch.pattern.severity === 'CRITICAL' && topMatch.confidence > 0.7) {
          console.log(`  [PATTERNS] REJECT: Critical pattern ${topMatch.pattern.name} (${(topMatch.confidence * 100).toFixed(0)}% confidence)`);
          syncToWorkers({
            agent: 'HUNTER',
            type: 'alert',
            message: `BLOCKED $${pair.baseToken.symbol}: ${topMatch.pattern.name} pattern (${(topMatch.confidence * 100).toFixed(0)}% match)`,
            severity: 'critical',
            data: { mint: pair.baseToken.address, symbol: pair.baseToken.symbol },
          });
          return { decision: 'SKIP', confidence: 0, reasoning: `Critical pattern: ${topMatch.pattern.name}` };
        }

        // Warn on high-severity patterns
        if (topMatch.pattern.severity === 'HIGH' && topMatch.confidence > 0.6) {
          console.log(`  [PATTERNS] WARNING: High-severity pattern ${topMatch.pattern.name}`);
          syncToWorkers({
            agent: 'HUNTER',
            type: 'alert',
            message: `⚠️ $${pair.baseToken.symbol}: ${topMatch.pattern.name} pattern detected (${(topMatch.confidence * 100).toFixed(0)}%)`,
            severity: 'warning',
            data: { mint: pair.baseToken.address, symbol: pair.baseToken.symbol },
          });
        }
      }
    } catch (e) {
      console.log(`  [PATTERNS] Error: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // STEP 3: Anti-Pump Detection (Don't Buy the Top)
  // ════════════════════════════════════════════════════════════════════

  const pumpCheck = checkAntiPump(pair);
  if (pumpCheck.reject) {
    rejectedByPump++;
    console.log(`  [PUMP] REJECT: ${pumpCheck.reason}`);
    syncToWorkers({
      agent: 'TRADER',
      type: 'analysis',
      message: `SKIP $${pair.baseToken.symbol}: ${pumpCheck.reason}`,
      severity: 'warning',
      data: { mint: pair.baseToken.address, symbol: pair.baseToken.symbol },
    });
    return { decision: 'SKIP', confidence: 0, reasoning: pumpCheck.reason };
  }

  // ════════════════════════════════════════════════════════════════════
  // STEP 4: LLM Council (with FULL AGI context)
  // ════════════════════════════════════════════════════════════════════

  if (!llmAvailable) return null;

  const context = buildTokenContext(pair, poolEvent);
  console.log(`  [COUNCIL] Evaluating ${pair.baseToken.symbol}...`);

  // Build BitNet context for LLM
  const bitnetContext = bitnetResult ? `
BITNET AI ANALYSIS:
- Risk Score: ${bitnetResult.riskScore}/100 (${bitnetResult.riskLevel})
- Confidence: ${bitnetResult.confidence}%
- Flags: ${bitnetResult.flags.length > 0 ? bitnetResult.flags.map(f => `${f.type}(${f.severity})`).join(', ') : 'NONE'}
- Feature Importance: ${Object.entries(bitnetResult.featureImportance).filter(([,v]) => v > 0.1).map(([k,v]) => `${k}:${(v*100).toFixed(0)}%`).join(', ')}
` : '';

  // Build Pattern context for LLM
  const patternContext = matchedPatterns.length > 0 ? `
SCAM PATTERN ANALYSIS:
${matchedPatterns.map(m => `- ${m.pattern.name} (${m.pattern.severity}): ${(m.confidence * 100).toFixed(0)}% match, ${(m.pattern.rugRate * 100).toFixed(0)}% historical rug rate
  Indicators: ${m.matchedIndicators.join(', ') || 'none matched'}`).join('\n')}
` : '';

  // Extract bonding curve metrics for prompt
  const isGraduatedToken = poolEvent?.enrichedData?.complete === true;
  const liqSol = poolEvent?.enrichedData?.liquiditySol || 30;
  const bondingProg = Math.min(100, (liqSol / 85) * 100); // 85 SOL to graduate

  const prompt = `ARGUS TRADING COUNCIL - Analyze this ${isGraduatedToken ? 'GRADUATED' : 'BONDING CURVE'} token.

===== TOKEN: $${pair.baseToken.symbol} =====
${context}
${bitnetContext}
${patternContext}

===== BONDING CURVE STRATEGY =====
${isGraduatedToken ?
  'This token has GRADUATED to Raydium. Evaluate based on liquidity and trading activity.' :
  `This is a PRE-GRADUATION bonding curve token. Early entry opportunity!
- Liquidity: ${liqSol.toFixed(1)} SOL
- Progress: ${bondingProg.toFixed(0)}% toward graduation (needs ~85 SOL)
- ${bondingProg > 70 ? 'STRONG momentum - approaching graduation!' : bondingProg > 50 ? 'Good traction - halfway there' : 'Building momentum'}
- OPPORTUNITY: Getting in before graduation can mean massive gains`}

===== YOUR TASK =====
Each agent evaluates THIS token using the YELLOWSTONE DATA above.
For bonding curves: Focus on progress %, tokens bought %, SOL momentum.

AGENTS:
- SCOUT: Evaluate bonding curve progress and liquidity. Is this gaining traction?
- ANALYST: Analyze the token distribution and momentum signals. Risk vs reward?
- HUNTER: Check for rug indicators in the bonding curve data. Any red flags?
- TRADER: Entry timing - is this a good entry point before graduation?

Respond JSON:
{
  "scout": { "vote": "YES|NO", "dialogue": "your analysis using the actual numbers" },
  "analyst": { "vote": "YES|NO", "dialogue": "your analysis using the actual numbers" },
  "hunter": { "vote": "YES|NO", "dialogue": "your analysis using the actual numbers" },
  "trader": { "vote": "YES|NO", "dialogue": "your analysis using the actual numbers" },
  "decision": "TRADE|SKIP"
}

CRITICAL: Reference the ACTUAL bonding curve data. 3+ YES votes = TRADE.`;

  try {
    llmCalls++;
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:8b',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0.5, num_predict: 500 },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) return null;
    const data = await response.json() as { message?: { content: string } };
    if (!data.message?.content) return null;

    const result = JSON.parse(data.message.content);

    let yesVotes = 0;
    for (const agent of ['scout', 'analyst', 'hunter', 'trader']) {
      if (result[agent]?.vote === 'YES') yesVotes++;
      const dialogue = result[agent]?.dialogue || result[agent]?.why || '';
      console.log(`    ${agent.toUpperCase()}: ${result[agent]?.vote || '?'} - "${dialogue}"`);
    }

    const decision = result.decision === 'TRADE' ? 'TRADE' : 'SKIP';
    console.log(`  [COUNCIL] ${decision} (${yesVotes}/4 YES)`);

    // Sync all council votes + verdict in a single batch (avoids KV race condition)
    const symbol = pair.baseToken.symbol;
    const agents = ['scout', 'analyst', 'hunter', 'trader'] as const;
    const agentMap = { scout: 'SCOUT', analyst: 'ANALYST', hunter: 'HUNTER', trader: 'TRADER' } as const;

    // Build batch of all council votes
    const batchAlerts: SyncAlert[] = [];

    for (const agent of agents) {
      const vote = result[agent]?.vote || '?';
      const dialogue = result[agent]?.dialogue || result[agent]?.why || '';
      if (dialogue) {
        batchAlerts.push({
          agent: agentMap[agent],
          type: 'council',
          message: `→ COUNCIL: [${vote}] ${dialogue}`,
          severity: vote === 'NO' ? 'warning' : 'info',
          data: {
            mint: pair.baseToken.address,
            symbol,
          },
        });
      }
    }

    // Add verdict to batch
    batchAlerts.push({
      agent: 'TRADER',
      type: 'council',
      message: `VERDICT on $${symbol}: ${decision} (${yesVotes}/4 YES)`,
      severity: decision === 'TRADE' ? 'info' : 'warning',
      data: {
        mint: pair.baseToken.address,
        symbol,
        decision,
        confidence: yesVotes / 4,
      },
    });

    // Send all council votes in a single batch (no race condition)
    await syncBatchToWorkers(batchAlerts);

    // STRICT: Require 3+ YES votes (override LLM decision)
    const strictDecision = yesVotes >= 3 ? 'TRADE' : 'SKIP';
    if (decision === 'TRADE' && yesVotes < 3) {
      console.log(`  [COUNCIL] OVERRIDE: LLM said TRADE but only ${yesVotes}/4 YES votes - SKIP`);
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 5: Record Prediction with OutcomeLearner
    // ════════════════════════════════════════════════════════════════════

    if (outcomeLearner && bitnetResult) {
      try {
        const verdict = bitnetResult.riskScore > 60 ? 'DANGEROUS' :
                        bitnetResult.riskScore > 40 ? 'SUSPICIOUS' : 'SAFE';
        outcomeLearner.recordPrediction({
          token: pair.baseToken.address,
          timestamp: Date.now(),
          riskScore: bitnetResult.riskScore,
          verdict,
          confidence: yesVotes / 4,
          features,
          patterns: matchedPatterns.map(m => m.pattern.id),
          source: 'paper-trade-agi',
        });
        predictionsRecorded++;
      } catch (e) {
        console.log(`  [LEARNER] Error recording prediction: ${e instanceof Error ? e.message : e}`);
      }
    }

    return {
      decision: strictDecision,
      confidence: yesVotes / 4,
      reasoning: result.reasoning || `${yesVotes}/4 voted YES`,
      bitnetScore: bitnetResult?.riskScore,
      bitnetFlags: bitnetResult?.flags.map(f => f.type),
    };
  } catch (e) {
    console.log(`  [COUNCIL] Error: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// Fast exit check (local, no LLM)
function fastExitCheck(position: Position, pair: DexPair): { exit: boolean; reason: string } | null {
  const buys = pair.txns?.m5?.buys || 0;
  const sells = pair.txns?.m5?.sells || 0;
  const momentumPositive = buys > sells;
  const peakPnl = ((position.highPrice - position.entryPrice) / position.entryPrice) * 100;

  // Take profit at +8%
  if (position.pnlPercent >= 8) {
    return { exit: true, reason: 'PROFIT-8%' };
  }

  // Gave back gains (was up >5%, now flat)
  if (peakPnl >= 5 && position.pnlPercent <= 1) {
    return { exit: true, reason: 'GAVE-BACK' };
  }

  // Hard stop at -12%
  if (position.pnlPercent <= -12) {
    return { exit: true, reason: 'STOP-LOSS' };
  }

  // Momentum stop at -8%
  if (position.pnlPercent <= -8 && !momentumPositive) {
    return { exit: true, reason: 'MOMENTUM-STOP' };
  }

  // Time stop (held >5 min, down, momentum dead)
  const holdMin = (Date.now() - position.entryTime) / 60000;
  if (position.pnlPercent <= -5 && holdMin > 5 && !momentumPositive) {
    return { exit: true, reason: 'TIME-STOP' };
  }

  return null;
}

// Log trade
function logTrade(trade: Trade): void {
  appendFileSync(TRADES_FILE, JSON.stringify(trade) + '\n');
}

// Save/load state
function saveState(): void {
  writeFileSync(POSITIONS_FILE, JSON.stringify({
    positions,
    totalPnl,
    totalTrades,
    wins,
    losses,
    llmCalls,
    poolsDetected,
    bitnetClassifications,
    rejectedByBitnet,
    rejectedByPump,
  }, null, 2));
}

function loadState(): void {
  if (existsSync(POSITIONS_FILE)) {
    const data = JSON.parse(readFileSync(POSITIONS_FILE, 'utf-8'));
    positions = data.positions || [];
    totalPnl = data.totalPnl || 0;
    totalTrades = data.totalTrades || 0;
    wins = data.wins || 0;
    losses = data.losses || 0;
    llmCalls = data.llmCalls || 0;
    poolsDetected = data.poolsDetected || 0;
    bitnetClassifications = data.bitnetClassifications || 0;
    rejectedByBitnet = data.rejectedByBitnet || 0;
    rejectedByPump = data.rejectedByPump || 0;
  }
}

// Enter position
function enterPosition(pair: DexPair, llmResult: { reasoning: string; confidence: number }, isBondingCurve: boolean = false): void {
  const price = parseFloat(pair.priceUsd) || 0;
  if (price === 0) {
    console.log(`    SKIP: Price is $0 - can't enter`);
    return;
  }

  const size = CONFIG.BASE_POSITION * llmResult.confidence;

  const position: Position = {
    tokenAddress: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    entryPrice: price,
    entryTime: Date.now(),
    size,
    highPrice: price,
    currentPrice: price,
    pnlPercent: 0,
    llmReasoning: llmResult.reasoning,
    isBondingCurve,
  };

  positions.push(position);

  logTrade({
    tokenAddress: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    side: 'BUY',
    price,
    size,
    reason: 'COUNCIL-APPROVED',
    timestamp: Date.now(),
  });

  console.log(`  \x1b[32m>>> BUY ${pair.baseToken.symbol}\x1b[0m @ $${price.toFixed(8)} | ${size.toFixed(3)} SOL`);
  console.log(`      ${llmResult.reasoning}`);
  saveState();

  // Sync buy to dashboard
  syncToWorkers({
    agent: 'TRADER',
    type: 'alert',
    message: `BUY $${pair.baseToken.symbol} @ $${price.toFixed(8)} | ${size.toFixed(3)} SOL | ${llmResult.reasoning}`,
    severity: 'info',
    data: {
      mint: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
    },
  });
}

// Exit position
function exitPosition(position: Position, reason: string, currentPrice: number): void {
  const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  const pnlSol = position.size * (pnlPercent / 100);

  totalPnl += pnlSol;
  totalTrades++;
  if (pnlSol >= 0) wins++;
  else losses++;

  // Record outcome for learning
  if (outcomeLearner) {
    // Determine outcome type
    let outcome: 'RUG' | 'DUMP' | 'STABLE' | 'MOON' | 'UNKNOWN' = 'UNKNOWN';
    if (reason === 'RUG' || currentPrice === 0) {
      outcome = 'RUG';
    } else if (pnlPercent < -30) {
      outcome = 'DUMP';
    } else if (pnlPercent > 50) {
      outcome = 'MOON';
    } else {
      outcome = 'STABLE';
    }

    // Try to find and record prediction outcome
    const pending = outcomeLearner.getPendingOutcomes();
    const pred = pending.find(p => p.token === position.tokenAddress);
    if (pred) {
      outcomeLearner.recordOutcome(pred.id, {
        token: position.tokenAddress,
        outcome,
        priceChange: pnlPercent,
        liquidityChange: 0, // Unknown
        timeToOutcome: Date.now() - position.entryTime,
        details: `Exit reason: ${reason}, P&L: ${pnlPercent.toFixed(1)}%`,
      }).catch(e => {
        console.log(`  [LEARNER] Error recording outcome: ${e instanceof Error ? e.message : e}`);
      });
    }
  }

  logTrade({
    tokenAddress: position.tokenAddress,
    symbol: position.symbol,
    side: 'SELL',
    price: currentPrice,
    size: position.size,
    pnlPercent,
    pnlSol,
    reason,
    timestamp: Date.now(),
  });

  const color = pnlSol >= 0 ? '\x1b[32m' : '\x1b[31m';
  const sign = pnlSol >= 0 ? '+' : '';
  console.log(`  ${color}<<< SELL ${position.symbol}\x1b[0m | ${reason} | ${sign}${pnlPercent.toFixed(1)}% | ${sign}${pnlSol.toFixed(4)} SOL`);

  // Sync sell to dashboard
  syncToWorkers({
    agent: 'TRADER',
    type: 'alert',
    message: `SELL $${position.symbol} | ${reason} | ${sign}${pnlPercent.toFixed(1)}% | ${sign}${pnlSol.toFixed(4)} SOL`,
    severity: pnlSol >= 0 ? 'info' : 'warning',
    data: {
      mint: position.tokenAddress,
      symbol: position.symbol,
      pnl: pnlSol,
    },
  });

  positions = positions.filter(p => p.tokenAddress !== position.tokenAddress);
  saveState();
}

// Monitor positions
async function monitorPositions(): Promise<void> {
  for (const position of [...positions]) {
    const pair = await fetchToken(position.tokenAddress);
    const holdMin = (Date.now() - position.entryTime) / 60000;

    // Handle bonding curve tokens (DexScreener won't have them)
    if (!pair && position.isBondingCurve) {
      // Bonding curve token not on DexScreener yet - this is expected
      // After 10 min, if still no data, close at entry (no gain/no loss simulation)
      if (holdMin > 10) {
        console.log(`    [${position.symbol}] Bonding curve timeout - closing at entry`);
        exitPosition(position, 'BC-TIMEOUT', position.entryPrice);
      } else {
        // Still waiting for graduation
        console.log(`    [${position.symbol}] \x1b[33mBONDING\x1b[0m @ ${holdMin.toFixed(0)}m | waiting for graduation...`);
      }
      continue;
    }

    if (!pair) {
      // Graduated token disappeared from DexScreener = rug
      exitPosition(position, 'RUG', 0);
      continue;
    }

    const currentPrice = parseFloat(pair.priceUsd) || 0;
    const liquidity = pair.liquidity?.usd || 0;

    // If we found DexScreener data, token has graduated - update flag
    if (position.isBondingCurve && currentPrice > 0) {
      position.isBondingCurve = false;
      console.log(`    [${position.symbol}] \x1b[32mGRADUATED!\x1b[0m Now tracking via DexScreener`);
    }

    if (liquidity < 500 || currentPrice === 0) {
      exitPosition(position, 'RUG', currentPrice);
      continue;
    }

    position.currentPrice = currentPrice;
    position.pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    if (currentPrice > position.highPrice) {
      position.highPrice = currentPrice;
    }

    const fastExit = fastExitCheck(position, pair);
    if (fastExit) {
      exitPosition(position, fastExit.reason, currentPrice);
      continue;
    }

    const buys = pair.txns?.m5?.buys || 0;
    const sells = pair.txns?.m5?.sells || 0;
    const color = position.pnlPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const sign = position.pnlPercent >= 0 ? '+' : '';
    console.log(`    [${position.symbol}] ${color}${sign}${position.pnlPercent.toFixed(1)}%\x1b[0m @ ${holdMin.toFixed(0)}m | b:${buys} s:${sells}`);
  }
  saveState();
}

// Process new pool from Yellowstone - NO DEXSCREENER, PURE ON-CHAIN
async function processNewPool(event: PoolEvent): Promise<void> {
  poolsDetected++;
  const mint = event.baseMint;
  if (!mint) return;

  // Skip if already have position
  if (positions.find(p => p.tokenAddress === mint)) return;

  // Skip if at max positions
  if (positions.length >= CONFIG.MAX_POSITIONS) return;

  const symbol = event.tokenSymbol || mint.slice(0, 6);
  console.log(`\n  [YELLOWSTONE] New ${event.dex} pool: ${symbol}`);

  // ════════════════════════════════════════════════════════════════════
  // USE YELLOWSTONE DATA DIRECTLY - NO DEXSCREENER WAIT
  // ════════════════════════════════════════════════════════════════════

  if (!event.enrichedData) {
    console.log(`    SKIP: No enriched data`);
    return;
  }

  const e = event.enrichedData;
  // Use pre-calculated liquiditySol if available, otherwise calculate from reserves
  const solReserves = e.liquiditySol ?? ((e.virtualSolReserves || 0) / 1e9);
  const tokenReserves = e.virtualTokenReserves || e.realTokenReserves || 0;
  const isGraduated = e.complete === true;

  console.log(`    SOL: ${solReserves.toFixed(2)} | ${isGraduated ? 'GRADUATED' : 'bonding'}`);

  // Filter: Need at least 3 SOL ($450+ at $150/SOL)
  if (solReserves < 3) {
    console.log(`    SKIP: ${solReserves.toFixed(2)} SOL < 3 minimum`);
    return;
  }

  // ════════════════════════════════════════════════════════════════════
  // YELLOWSTONE BONDING CURVE INTELLIGENCE
  // ════════════════════════════════════════════════════════════════════

  const SOL_PRICE_USD = 150;

  // Use liquiditySol (already sanitized in pool-monitor, capped at 1000 SOL)
  const liquiditySol = e.liquiditySol || solReserves;

  // Progress = how far toward graduation (30 SOL start, 85 SOL to graduate)
  const GRADUATION_TARGET = 85;
  const bondingProgress = Math.min(100, (liquiditySol / GRADUATION_TARGET) * 100);

  // ════════════════════════════════════════════════════════════════════
  // BONDING CURVE PRICE CALCULATION (matches Pump.fun exactly)
  // price = virtualSolReserves / virtualTokenReserves
  // ════════════════════════════════════════════════════════════════════
  const virtualSolLamports = e.virtualSolReserves || 0;
  const virtualTokens = e.virtualTokenReserves || 1; // Avoid div by 0

  // Price per token in SOL (lamports / tokens, then convert to SOL)
  // Pump.fun tokens have 6 decimals typically
  const TOKEN_DECIMALS = 1e6;
  const priceInSol = (virtualSolLamports / 1e9) / (virtualTokens / TOKEN_DECIMALS);
  const priceUsd = priceInSol * SOL_PRICE_USD;
  const liquidityUsd = liquiditySol * SOL_PRICE_USD * 2;

  console.log(`    Price: $${priceUsd.toExponential(2)} (${priceInSol.toExponential(2)} SOL)`);


  console.log(`    Liquidity: ${liquiditySol.toFixed(1)} SOL | Progress: ${bondingProgress.toFixed(0)}%`);

  // All Pump.fun tokens start at 30 SOL virtual = 35% progress
  // Only skip if they somehow have LESS than starting (data error)
  if (!isGraduated && bondingProgress < 30) {
    console.log(`    SKIP: Data error - ${bondingProgress.toFixed(0)}% progress < starting`);
    return;
  }

  // Build pair with YELLOWSTONE metrics + calculated bonding curve price
  const estimatedBuys = Math.floor(bondingProgress);
  const pair: DexPair = {
    chainId: 'solana',
    baseToken: { address: mint, symbol, name: symbol },
    priceUsd: priceUsd.toString(),  // Calculated from bonding curve!
    liquidity: { usd: liquidityUsd },
    volume: { h24: liquiditySol * SOL_PRICE_USD },
    priceChange: {
      m5: bondingProgress > 35 ? (bondingProgress - 35) : 0,
      h1: bondingProgress - 35,
      h24: bondingProgress
    },
    txns: {
      m5: { buys: estimatedBuys, sells: Math.floor(estimatedBuys / 5) },
      h24: { buys: estimatedBuys * 3, sells: Math.floor(estimatedBuys / 2) },
    },
    pairCreatedAt: Date.now(),
    fdv: liquidityUsd,
  };

  console.log(`    Liquidity: $${liquidityUsd.toFixed(0)} | Price: $${priceUsd.toExponential(2)}`);

  // Pre-filter on liquidity
  if (liquidityUsd < CONFIG.MIN_LIQUIDITY) {
    console.log(`    SKIP: Liquidity $${liquidityUsd.toFixed(0)} < $${CONFIG.MIN_LIQUIDITY}`);
    return;
  }

  // BitNet + LLM Council decision
  const decision = await councilDecision(pair, event);
  if (!decision) {
    console.log(`    SKIP: Council unavailable`);
    return;
  }

  // STRICT: Require 3+ YES votes (confidence >= 0.75)
  if (decision.decision === 'TRADE' && decision.confidence >= 0.75) {
    enterPosition(pair, decision, !isGraduated);  // Pass bonding curve flag
  } else if (decision.decision === 'TRADE') {
    console.log(`    SKIP: Only ${Math.round(decision.confidence * 4)}/4 votes - need 3+`);
  }
}

// Display status
function displayStatus(): void {
  const bitnetStatus = bitnetEngine ? '\x1b[32mON\x1b[0m' : '\x1b[31mOFF\x1b[0m';
  const llmStatus = llmService && llmAvailable ? '\x1b[32mON\x1b[0m' : '\x1b[31mOFF\x1b[0m';
  const patternStatus = patternLibrary ? '\x1b[32mON\x1b[0m' : '\x1b[31mOFF\x1b[0m';
  const learnerStatus = outcomeLearner ? '\x1b[32mON\x1b[0m' : '\x1b[31mOFF\x1b[0m';
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(0) : 'N/A';

  // Get learner stats if available
  let learnerAccuracy = 'N/A';
  if (outcomeLearner) {
    const stats = outcomeLearner.getStats();
    if (stats.totalOutcomes > 0) {
      learnerAccuracy = `${(stats.accuracy.overall * 100).toFixed(0)}%`;
    }
  }

  console.log('');
  console.log('─'.repeat(80));
  console.log(`  \x1b[1mAGI STACK:\x1b[0m BitNet ${bitnetStatus} | LLM ${llmStatus} | Patterns ${patternStatus} | Learner ${learnerStatus}`);
  console.log(`  BitNet: ${bitnetClassifications} scans | Patterns: ${patternsMatched} matched | Predictions: ${predictionsRecorded}`);
  console.log(`  Rejected: ${rejectedByBitnet} by BitNet | ${rejectedByPump} by anti-pump | Pools: ${poolsDetected}`);
  console.log(`  Positions: ${positions.length}/${CONFIG.MAX_POSITIONS} | Trades: ${totalTrades} | Win Rate: ${winRate}% | Learner: ${learnerAccuracy}`);
  console.log(`  \x1b[1mTotal P&L: ${totalPnl >= 0 ? '\x1b[32m+' : '\x1b[31m'}${totalPnl.toFixed(4)} SOL\x1b[0m`);
  console.log('─'.repeat(80));
}

// Main
async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AGI v3 - FULL STACK Paper Trading                             ║');
  console.log('║                                                                          ║');
  console.log('║     • BitNet 29-feature neural classifier (80.6% accuracy)              ║');
  console.log('║     • DeepSeek-R1 32B deep reasoning + Qwen 3 8B fast classification    ║');
  console.log('║     • 8 scam pattern detection (Bundle, Rug, Honeypot, etc.)            ║');
  console.log('║     • Self-improving OutcomeLearner with LLM analysis                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const yellowstoneEndpoint = process.env.YELLOWSTONE_ENDPOINT;
  const yellowstoneToken = process.env.YELLOWSTONE_TOKEN;

  if (!yellowstoneEndpoint || !yellowstoneToken) {
    console.error('ERROR: Set YELLOWSTONE_ENDPOINT and YELLOWSTONE_TOKEN in .env');
    console.log('Get these from your Chainstack dashboard');
    process.exit(1);
  }

  console.log(`  Yellowstone: ${yellowstoneEndpoint}`);
  console.log(`  LLM: ${OLLAMA_ENDPOINT}`);
  console.log('');

  loadState();

  // ════════════════════════════════════════════════════════════════════
  // FULL AGI STACK INITIALIZATION
  // ════════════════════════════════════════════════════════════════════

  // 1. BitNet Engine (29-feature neural classifier)
  console.log('  Loading BitNet AI Engine...');
  try {
    bitnetEngine = new BitNetEngine();
    await bitnetEngine.loadModel();
    const info = bitnetEngine.getModelInfo();
    console.log(`  BitNet: \x1b[32m${info.mode}\x1b[0m mode`);
    if (info.architecture) {
      console.log(`    Architecture: ${info.architecture.join(' → ')}`);
      console.log(`    Accuracy: ${((info.accuracy || 0) * 100).toFixed(1)}%`);
    }
  } catch (e) {
    console.log(`  BitNet: \x1b[33mFailed to load\x1b[0m - ${e instanceof Error ? e.message : e}`);
    bitnetEngine = null;
  }

  // 2. LLM Service (DeepSeek-R1 32B + Qwen 3 8B)
  console.log('  Initializing LLM Service...');
  try {
    llmService = new LLMService({
      endpoint: OLLAMA_ENDPOINT,
      reasoningModel: 'deepseek-r1:32b',  // Deep chain-of-thought reasoning
      fastModel: 'qwen3:8b',               // Fast classification
      reasoningTimeout: 300000,            // 5 min for DeepSeek
      fastTimeout: 60000,                  // 60s for Qwen
    });
    const available = await llmService.isAvailable();
    if (available) {
      const info = llmService.getInfo();
      console.log(`  LLMService: \x1b[32mConnected\x1b[0m`);
      console.log(`    Reasoning: ${info.reasoningModel}`);
      console.log(`    Fast: ${info.fastModel}`);
      llmAvailable = true;
    } else {
      console.log(`  LLMService: \x1b[33mOffline\x1b[0m - using fallback`);
    }
  } catch (e) {
    console.log(`  LLMService: \x1b[33mFailed\x1b[0m - ${e instanceof Error ? e.message : e}`);
    llmService = null;
  }

  // 3. Pattern Library (8 known scam patterns)
  console.log('  Loading Pattern Library...');
  try {
    patternLibrary = new PatternLibrary();
    const stats = patternLibrary.getStats();
    console.log(`  PatternLibrary: \x1b[32m${stats.totalPatterns} patterns\x1b[0m loaded`);
    const highSev = patternLibrary.getHighSeverityPatterns();
    console.log(`    High severity: ${highSev.map(p => p.name).join(', ')}`);
  } catch (e) {
    console.log(`  PatternLibrary: \x1b[33mFailed\x1b[0m - ${e instanceof Error ? e.message : e}`);
    patternLibrary = null;
  }

  // 4. Outcome Learner (self-improvement)
  console.log('  Initializing Outcome Learner...');
  try {
    outcomeLearner = new OutcomeLearner();
    // Connect LLM for intelligent outcome analysis
    if (llmService) {
      outcomeLearner.setLLM(llmService);
      console.log(`  OutcomeLearner: \x1b[32mInitialized\x1b[0m with LLM-enhanced learning`);
    } else {
      console.log(`  OutcomeLearner: \x1b[32mInitialized\x1b[0m (rule-based only)`);
    }
    const importance = outcomeLearner.getFeatureImportance().slice(0, 5);
    console.log(`    Top features: ${importance.map(f => f.featureName).join(', ')}`);
  } catch (e) {
    console.log(`  OutcomeLearner: \x1b[33mFailed\x1b[0m - ${e instanceof Error ? e.message : e}`);
    outcomeLearner = null;
  }

  // Legacy LLM check (for backwards compatibility)
  if (!llmAvailable) {
    console.log('  Checking fallback LLM...');
    await checkLLM();
    console.log(`  Fallback LLM: ${llmAvailable ? '\x1b[32mConnected\x1b[0m' : '\x1b[33mOffline\x1b[0m'}`);
  }
  console.log('');

  // Start Yellowstone monitor
  console.log('  Connecting to Yellowstone...');

  poolMonitor = new PoolMonitor({
    yellowstoneEndpoint,
    yellowstoneToken,
    enabledDexs: ['RAYDIUM_CPMM', 'PUMP_FUN'],  // Focus on high-volume DEXs
    onPoolEvent: async (event) => {
      if (event.type === 'new_pool') {
        poolQueue.push(event);
      }
    },
    onConnect: () => {
      console.log('  \x1b[32mYellowstone connected!\x1b[0m');
      console.log('  Listening for new pools...');
      console.log('  Press Ctrl+C to stop');
      console.log('');
    },
    onDisconnect: () => {
      console.log('  \x1b[31mYellowstone disconnected\x1b[0m');
    },
    onError: (error, context) => {
      console.log(`  [ERROR] ${context}: ${error.message}`);
    },
  });

  await poolMonitor.start();

  // Main loop
  while (true) {
    // Process pool queue
    while (poolQueue.length > 0) {
      const event = poolQueue.shift();
      if (event) {
        await processNewPool(event);
      }
    }

    // Monitor positions
    if (positions.length > 0) {
      await monitorPositions();
    }

    // Re-check LLM periodically
    if (Math.random() < 0.05) {
      await checkLLM();
    }

    displayStatus();

    await new Promise(r => setTimeout(r, CONFIG.MONITOR_INTERVAL));
  }
}

main().catch(console.error);
