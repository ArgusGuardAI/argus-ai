#!/usr/bin/env npx tsx
/**
 * Fix Training Labels
 * 
 * Reality: 90%+ of pump.fun tokens rug within 24 hours
 * DexScreener bias: only shows surviving tokens
 * 
 * New labeling criteria (realistic):
 * - SAFE: Liquidity > $50K AND age > 7 days AND price stable
 * - SUSPICIOUS: Liquidity $10K-$50K OR age 2-7 days
 * - DANGEROUS: Liquidity $1K-$10K OR price dropped 50%+
 * - SCAM: Liquidity < $1K OR price dropped 80%+ OR known rug signals
 */

import { readFileSync, writeFileSync } from 'fs';

interface TrainingRecord {
  features: number[];
  target: { score: number; level: string; label: number };
  meta: { id: string; symbol: string; wasOverridden?: boolean; outcomeKnown?: boolean; outcome?: string; priceDropPercent?: number };
}

const inputFile = './data/training-large.jsonl';
const outputFile = './data/training-realistic.jsonl';

// Read existing data
const lines = readFileSync(inputFile, 'utf-8').trim().split('\n').filter(Boolean);
const records: TrainingRecord[] = lines.map(line => JSON.parse(line));

console.log(`Loaded ${records.length} records`);

// Relabel based on realistic criteria
let safeCnt = 0, suspCnt = 0, dangCnt = 0, scamCnt = 0;

const relabeled = records.map(record => {
  const features = record.features;
  
  // Extract key features
  const liquidityLog = features[0] || 0;     // log10(liquidity) / 7
  const liquidity = Math.pow(10, liquidityLog * 7);
  
  const top10Conc = features[6] || 0;        // top 10 holder concentration
  const freshWalletRatio = features[8] || 0; // fresh wallets
  const bundleDetected = features[15] || 0;  // bundle flag
  const bundleControl = features[17] || 0;   // bundle control %
  const ageDecay = features[24] || 0;        // 1 = new, 0 = old
  const creatorRugHistory = features[27] || 0;
  
  const priceDropPercent = record.meta.priceDropPercent || 0;
  
  // Realistic labeling
  let level: string;
  let score: number;
  let label: number;
  
  // SCAM: Dead or very suspicious
  if (liquidity < 1000 || priceDropPercent >= 80 || creatorRugHistory > 0.5) {
    level = 'SCAM';
    score = 85 + Math.floor(Math.random() * 15);
    label = 3;
    scamCnt++;
  }
  // DANGEROUS: Low liquidity or big drop or bundles
  else if (liquidity < 10000 || priceDropPercent >= 50 || bundleControl > 0.3 || freshWalletRatio > 0.5) {
    level = 'DANGEROUS';
    score = 65 + Math.floor(Math.random() * 20);
    label = 2;
    dangCnt++;
  }
  // SUSPICIOUS: Medium liquidity or somewhat new
  else if (liquidity < 50000 || ageDecay > 0.7 || top10Conc > 0.5) {
    level = 'SUSPICIOUS';
    score = 40 + Math.floor(Math.random() * 25);
    label = 1;
    suspCnt++;
  }
  // SAFE: High liquidity, old, stable
  else {
    level = 'SAFE';
    score = 10 + Math.floor(Math.random() * 30);
    label = 0;
    safeCnt++;
  }
  
  return {
    features: record.features,
    target: { score, level, label },
    meta: { ...record.meta, wasOverridden: true }
  };
});

// Write output
const output = relabeled.map(r => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(outputFile, output);

console.log(`\nRelabeled distribution:`);
console.log(`  SAFE:       ${safeCnt} (${(safeCnt/records.length*100).toFixed(1)}%)`);
console.log(`  SUSPICIOUS: ${suspCnt} (${(suspCnt/records.length*100).toFixed(1)}%)`);
console.log(`  DANGEROUS:  ${dangCnt} (${(dangCnt/records.length*100).toFixed(1)}%)`);
console.log(`  SCAM:       ${scamCnt} (${(scamCnt/records.length*100).toFixed(1)}%)`);
console.log(`\nWritten to ${outputFile}`);
