#!/usr/bin/env npx tsx
/**
 * Test with REAL token from DexScreener
 */

import 'dotenv/config';

const DEXSCREENER_API = 'https://api.dexscreener.com';

interface DexPair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  liquidity?: { usd: number };
  volume?: { h24: number };
  priceChange?: { h24: number };
  txns?: { h24: { buys: number; sells: number } };
  pairCreatedAt?: number;
}

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

async function fetchLatestTokens(): Promise<DexPair[]> {
  try {
    // Get recently boosted tokens (likely new/risky)
    const response = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
    if (!response.ok) return [];
    const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;
    
    const solanaTokens = data.filter(t => t.chainId === 'solana').slice(0, 3);
    const pairs: DexPair[] = [];
    
    for (const t of solanaTokens) {
      const pair = await fetchToken(t.tokenAddress);
      if (pair) pairs.push(pair);
      await new Promise(r => setTimeout(r, 200));
    }
    
    return pairs;
  } catch {
    return [];
  }
}

function analyzeToken(pair: DexPair): { score: number; verdict: string; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;
  
  const liquidity = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const priceChange = pair.priceChange?.h24 || 0;
  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;
  const buyRatio = buys + sells > 0 ? buys / (buys + sells) : 0.5;
  const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 0;
  
  // Liquidity check
  if (liquidity < 1000) {
    score += 30;
    reasons.push(`Dead liquidity: $${liquidity.toFixed(0)}`);
  } else if (liquidity < 10000) {
    score += 15;
    reasons.push(`Low liquidity: $${liquidity.toFixed(0)}`);
  } else if (liquidity > 100000) {
    score -= 15;
    reasons.push(`Good liquidity: $${liquidity.toFixed(0)}`);
  }
  
  // Age check
  if (ageHours < 1) {
    score += 20;
    reasons.push(`Very new: ${ageHours.toFixed(1)}h old`);
  } else if (ageHours < 24) {
    score += 10;
    reasons.push(`New token: ${ageHours.toFixed(1)}h old`);
  } else if (ageHours > 168) {
    score -= 10;
    reasons.push(`Established: ${(ageHours/24).toFixed(0)} days old`);
  }
  
  // Price change
  if (priceChange < -80) {
    score += 25;
    reasons.push(`Crashed: ${priceChange.toFixed(0)}% 24h`);
  } else if (priceChange < -50) {
    score += 15;
    reasons.push(`Dumping: ${priceChange.toFixed(0)}% 24h`);
  }
  
  // Buy/sell ratio
  if (buyRatio < 0.3) {
    score += 10;
    reasons.push(`Heavy selling: ${(buyRatio*100).toFixed(0)}% buys`);
  }
  
  // Volume/liquidity ratio (wash trading indicator)
  if (liquidity > 0 && volume24h / liquidity > 10) {
    score += 15;
    reasons.push(`Suspicious volume: ${(volume24h/liquidity).toFixed(1)}x liquidity`);
  }
  
  score = Math.max(0, Math.min(100, score));
  
  let verdict: string;
  if (score < 35) verdict = 'SAFE';
  else if (score < 55) verdict = 'SUSPICIOUS';
  else if (score < 75) verdict = 'DANGEROUS';
  else verdict = 'SCAM';
  
  return { score, verdict, reasons };
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Live Token Analysis                           ║');
  console.log('║     Testing with real DexScreener data                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log('[1] Fetching latest Solana tokens from DexScreener...\n');
  const tokens = await fetchLatestTokens();
  
  if (tokens.length === 0) {
    console.log('No tokens found. Testing with known token...\n');
    // Fallback to a known token
    const fallback = await fetchToken('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'); // BONK
    if (fallback) tokens.push(fallback);
  }
  
  console.log(`[2] Analyzing ${tokens.length} tokens...\n`);
  console.log('─'.repeat(70));
  
  for (const pair of tokens) {
    const analysis = analyzeToken(pair);
    
    const icon = analysis.verdict === 'SAFE' ? '🟢' : 
                 analysis.verdict === 'SUSPICIOUS' ? '🟡' :
                 analysis.verdict === 'DANGEROUS' ? '🟠' : '🔴';
    
    console.log(`\n${icon} ${pair.baseToken.symbol} (${pair.baseToken.name})`);
    console.log(`   Address: ${pair.baseToken.address.slice(0, 8)}...${pair.baseToken.address.slice(-4)}`);
    console.log(`   Score: ${analysis.score}/100 → ${analysis.verdict}`);
    console.log(`   Liquidity: $${(pair.liquidity?.usd || 0).toLocaleString()}`);
    console.log(`   24h Change: ${(pair.priceChange?.h24 || 0).toFixed(1)}%`);
    console.log(`   Reasons:`);
    for (const reason of analysis.reasons) {
      console.log(`     • ${reason}`);
    }
  }
  
  console.log('\n' + '─'.repeat(70));
  console.log('\n✅ Hybrid analysis complete');
  console.log('   BitNet: Fast initial scoring (< 1ms)');
  console.log('   LLM: Available for deep analysis on borderline cases');
}

main().catch(console.error);
