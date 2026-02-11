#!/usr/bin/env npx tsx
/**
 * Test Hybrid Classification: BitNet (fast) + LLM (deep)
 */

import 'dotenv/config';

// Test tokens - mix of known rugs and survivors
const TEST_TOKENS = [
  // Known survivors (high liquidity, old)
  { address: 'So11111111111111111111111111111111111111112', name: 'SOL', expected: 'SAFE' },
  { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC', expected: 'SAFE' },
  
  // Simulate risky tokens with features
  { address: 'FAKE1111111111111111111111111111111111111', name: 'RUGPULL', expected: 'RISKY', 
    features: { liquidity: 500, bundleDetected: true, freshWallets: 0.8, creatorRugs: 2 } },
  { address: 'FAKE2222222222222222222222222222222222222', name: 'SCAMCOIN', expected: 'RISKY',
    features: { liquidity: 100, top10Concentration: 0.95, mintEnabled: true } },
  { address: 'FAKE3333333333333333333333333333333333333', name: 'HONEYPOT', expected: 'RISKY',
    features: { liquidity: 2000, freezeEnabled: true, bundleControl: 0.6 } },
];

// Simulate BitNet classification
function bitnetClassify(features: number[]): { score: number; verdict: string; confidence: number } {
  // Simple heuristic based on key features
  const liquidityLog = features[0] || 0;
  const bundleDetected = features[15] || 0;
  const freshWalletRatio = features[8] || 0;
  const mintDisabled = features[11] || 0;
  const freezeDisabled = features[12] || 0;
  const creatorRugHistory = features[27] || 0;
  
  let score = 50; // Start neutral
  
  // Liquidity impact
  if (liquidityLog < 0.4) score += 30; // Low liquidity = risky
  else if (liquidityLog > 0.7) score -= 20; // High liquidity = safer
  
  // Bundle detection
  if (bundleDetected > 0.5) score += 25;
  
  // Fresh wallets
  if (freshWalletRatio > 0.5) score += 15;
  
  // Security
  if (mintDisabled < 0.5) score += 10;
  if (freezeDisabled < 0.5) score += 10;
  
  // Creator history
  if (creatorRugHistory > 0.3) score += 30;
  
  score = Math.max(0, Math.min(100, score));
  
  let verdict: string;
  if (score < 35) verdict = 'SAFE';
  else if (score < 55) verdict = 'SUSPICIOUS';
  else if (score < 75) verdict = 'DANGEROUS';
  else verdict = 'SCAM';
  
  return { score, verdict, confidence: 0.7 + Math.random() * 0.2 };
}

// Generate features from token data
function generateFeatures(token: typeof TEST_TOKENS[0]): number[] {
  const features = new Array(29).fill(0.5); // Default mid-range
  
  if (token.features) {
    const f = token.features as any;
    // liquidityLog (index 0)
    features[0] = f.liquidity ? Math.min(Math.log10(f.liquidity + 1) / 7, 1) : 0.5;
    // top10Concentration (index 6)
    features[6] = f.top10Concentration || 0.3;
    // freshWalletRatio (index 8)
    features[8] = f.freshWallets || 0.2;
    // mintDisabled (index 11)
    features[11] = f.mintEnabled ? 0 : 1;
    // freezeDisabled (index 12)
    features[12] = f.freezeEnabled ? 0 : 1;
    // bundleDetected (index 15)
    features[15] = f.bundleDetected ? 1 : 0;
    // bundleControl (index 17)
    features[17] = f.bundleControl || 0;
    // creatorRugHistory (index 27)
    features[27] = f.creatorRugs ? Math.min(f.creatorRugs / 5, 1) : 0;
  } else {
    // Real tokens (SOL, USDC) - assume safe characteristics
    features[0] = 1.0;  // High liquidity
    features[6] = 0.1;  // Low concentration
    features[8] = 0.1;  // Few fresh wallets
    features[11] = 1;   // Mint disabled
    features[12] = 1;   // Freeze disabled
    features[15] = 0;   // No bundles
    features[27] = 0;   // No rug history
  }
  
  return features;
}

// Test LLM availability
async function checkLLM(): Promise<boolean> {
  const endpoint = process.env.LLM_ENDPOINT;
  if (!endpoint) {
    console.log('[LLM] No LLM_ENDPOINT configured');
    return false;
  }
  
  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { models?: Array<{ name: string }> };
      console.log(`[LLM] Connected: ${data.models?.map(m => m.name).join(', ')}`);
      return true;
    }
  } catch (e) {
    console.log(`[LLM] Not available: ${e instanceof Error ? e.message : e}`);
  }
  return false;
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Hybrid Classification Test                    ║');
  console.log('║     BitNet (fast) + LLM (deep analysis)                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  const llmAvailable = await checkLLM();
  console.log('');
  
  console.log('Testing tokens...\n');
  
  let correct = 0;
  let total = 0;
  
  for (const token of TEST_TOKENS) {
    const features = generateFeatures(token);
    const result = bitnetClassify(features);
    
    const isRisky = result.verdict !== 'SAFE';
    const expectedRisky = token.expected === 'RISKY';
    const match = isRisky === expectedRisky;
    
    if (match) correct++;
    total++;
    
    const icon = match ? '✓' : '✗';
    const matchText = match ? 'CORRECT' : 'WRONG';
    
    console.log(`${icon} ${token.name.padEnd(12)} | Score: ${result.score.toString().padStart(3)} | ${result.verdict.padEnd(10)} | Expected: ${token.expected.padEnd(5)} | ${matchText}`);
    
    // If borderline (score 35-65) and LLM available, would escalate to deep analysis
    if (result.score >= 35 && result.score <= 65 && llmAvailable) {
      console.log(`  └─ Would escalate to LLM for deep analysis (borderline score)`);
    }
  }
  
  console.log('');
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`Accuracy: ${correct}/${total} (${(correct/total*100).toFixed(1)}%)`);
  console.log(`LLM available for deep analysis: ${llmAvailable ? 'YES' : 'NO'}`);
  console.log(`═══════════════════════════════════════════════════════════════`);
}

main().catch(console.error);
