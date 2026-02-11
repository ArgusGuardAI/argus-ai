#!/usr/bin/env npx tsx
/**
 * Convert to binary classification (SAFE vs RISKY)
 * Simpler, more robust to quantization
 */

import { readFileSync, writeFileSync } from 'fs';

interface TrainingRecord {
  features: number[];
  target: { score: number; level: string; label: number };
  meta: any;
}

const inputFile = './data/training-realistic.jsonl';
const outputFile = './data/training-binary.jsonl';

const lines = readFileSync(inputFile, 'utf-8').trim().split('\n').filter(Boolean);
const records: TrainingRecord[] = lines.map(line => JSON.parse(line));

console.log(`Loaded ${records.length} records`);

let safeCnt = 0, riskyCnt = 0;

const relabeled = records.map(record => {
  const oldLevel = record.target.level;
  
  // Binary: SAFE or RISKY
  let level: string;
  let score: number;
  let label: number;
  
  if (oldLevel === 'SAFE') {
    level = 'SAFE';
    score = record.target.score;
    label = 0;
    safeCnt++;
  } else {
    level = 'RISKY';
    // Map old scores: SUSPICIOUS 40-65, DANGEROUS 65-85, SCAM 85-100
    score = record.target.score;
    label = 1;
    riskyCnt++;
  }
  
  return {
    features: record.features,
    target: { score, level, label },
    meta: record.meta
  };
});

const output = relabeled.map(r => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(outputFile, output);

console.log(`\nBinary distribution:`);
console.log(`  SAFE:  ${safeCnt} (${(safeCnt/records.length*100).toFixed(1)}%)`);
console.log(`  RISKY: ${riskyCnt} (${(riskyCnt/records.length*100).toFixed(1)}%)`);
console.log(`\nWritten to ${outputFile}`);
