#!/usr/bin/env npx tsx
/**
 * Create a balanced training dataset with more rugs
 * Takes training-large.jsonl and duplicates rugs to achieve ~50% rug rate
 */

import { readFileSync, writeFileSync } from 'fs';

const INPUT_FILE = './data/training-large.jsonl';
const OUTPUT_FILE = './data/training-balanced.jsonl';

function main() {
  console.log('Loading training data...');

  const lines = readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean);
  const records = lines.map(l => JSON.parse(l));

  // Separate by outcome
  const rugs = records.filter(r => r.meta?.outcome === 'rug');
  const stable = records.filter(r => r.meta?.outcome === 'stable');

  console.log(`Original: ${rugs.length} rugs, ${stable.length} stable`);

  // Target ~50% rug rate by oversampling rugs
  const targetRugs = stable.length; // Match stable count
  const rugMultiplier = Math.ceil(targetRugs / rugs.length);

  console.log(`Multiplying rugs ${rugMultiplier}x to balance...`);

  // Create balanced dataset
  const balanced: any[] = [];

  // Add all stable tokens
  for (const r of stable) {
    balanced.push(r);
  }

  // Oversample rugs to match
  for (let i = 0; i < rugMultiplier; i++) {
    for (const r of rugs) {
      // Slight noise to prevent exact duplicates causing overfitting
      const noisyRecord = JSON.parse(JSON.stringify(r));
      if (i > 0) {
        // Add tiny noise to features on copies (0.1% perturbation)
        noisyRecord.features = noisyRecord.features.map((f: number) =>
          f * (1 + (Math.random() - 0.5) * 0.002)
        );
      }
      balanced.push(noisyRecord);
      if (balanced.length >= stable.length * 2) break;
    }
    if (balanced.length >= stable.length * 2) break;
  }

  // Shuffle
  for (let i = balanced.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [balanced[i], balanced[j]] = [balanced[j], balanced[i]];
  }

  // Count final distribution
  const finalRugs = balanced.filter(r => r.meta?.outcome === 'rug').length;
  const finalStable = balanced.filter(r => r.meta?.outcome === 'stable').length;

  console.log(`Balanced: ${finalRugs} rugs, ${finalStable} stable`);
  console.log(`Rug rate: ${(finalRugs / balanced.length * 100).toFixed(1)}%`);

  // Write
  const output = balanced.map(r => JSON.stringify(r)).join('\n');
  writeFileSync(OUTPUT_FILE, output + '\n');

  console.log(`\nWritten ${balanced.length} records to ${OUTPUT_FILE}`);
}

main();
