#!/usr/bin/env npx tsx
/**
 * Compare neural vs rule-based classification
 * Shows that neural model is broken
 */

import { BitNetEngine } from './src/reasoning/BitNetEngine';

// Manually trigger rule-based vs neural
async function main() {
  console.log('Comparing Neural vs Rule-Based Classification\n');
  console.log('='.repeat(70));

  // RISKY token features
  const riskyFeatures = new Float32Array([
    0.2, 0.8, 0.3, 0.5, 0.5,   // market: low liq, high vol ratio
    0.3, 0.8, 0.7, 0.6, 0.3,   // holders: high concentration
    0.6,                        // topWhalePercent: 60%
    0, 0, 0, 0,                 // security: ALL BAD
    1, 0.5, 0.6, 0.8, 0.5,     // bundle: detected
    0.3, 0.4, 0.7, 0.8,        // trading
    0.9, 0.5,                   // time: very new
    0, 0.5, 0.3                 // creator: has rug history
  ]);

  // SAFE token features
  const safeFeatures = new Float32Array([
    0.9, 0.3, 0.8, 0.5, 0.6,   // market: high liq
    0.7, 0.2, 0.3, 0.1, 0.1,   // holders: low concentration
    0.1,                        // topWhalePercent: 10%
    1, 1, 1, 1,                 // security: ALL GOOD
    0, 0, 0, 0, 0.8,           // bundle: not detected
    0.6, 0.5, 0.4, 0.3,        // trading
    0.1, 0.3,                   // time: old
    1, 0, 0.1                   // creator: clean
  ]);

  // Test with neural model (trained weights)
  console.log('\n[1] NEURAL MODEL (trained ternary weights):\n');
  const neuralEngine = new BitNetEngine();
  await neuralEngine.loadModel();

  const neuralRisky = await neuralEngine.classify(riskyFeatures);
  const neuralSafe = await neuralEngine.classify(safeFeatures);

  console.log(`    RISKY token: ${neuralRisky.riskScore}/100 ${neuralRisky.riskLevel}`);
  console.log(`    SAFE token:  ${neuralSafe.riskScore}/100 ${neuralSafe.riskLevel}`);
  console.log(`    Difference:  ${Math.abs(neuralRisky.riskScore - neuralSafe.riskScore)} points`);

  if (neuralRisky.riskScore === neuralSafe.riskScore) {
    console.log('\n    >>> BROKEN: Same score for both! <<<');
  }

  // Test with rule-based (no trained weights)
  console.log('\n[2] RULE-BASED (hand-tuned heuristics):\n');

  // Temporarily rename weights file to force rule-based
  const fs = await import('fs');
  const weightsPath = './src/reasoning/bitnet-weights.json';
  const backupPath = './src/reasoning/bitnet-weights.json.bak';

  if (fs.existsSync(weightsPath)) {
    fs.renameSync(weightsPath, backupPath);
  }

  const ruleEngine = new BitNetEngine();
  await ruleEngine.loadModel();

  const ruleRisky = await ruleEngine.classify(riskyFeatures);
  const ruleSafe = await ruleEngine.classify(safeFeatures);

  // Restore weights
  if (fs.existsSync(backupPath)) {
    fs.renameSync(backupPath, weightsPath);
  }

  console.log(`    RISKY token: ${ruleRisky.riskScore}/100 ${ruleRisky.riskLevel}`);
  console.log(`    SAFE token:  ${ruleSafe.riskScore}/100 ${ruleSafe.riskLevel}`);
  console.log(`    Difference:  ${Math.abs(ruleRisky.riskScore - ruleSafe.riskScore)} points`);

  // Verdict
  console.log('\n' + '='.repeat(70));
  console.log('\nVERDICT:');

  const neuralWorks = neuralRisky.riskScore > neuralSafe.riskScore + 20;
  const ruleWorks = ruleRisky.riskScore > ruleSafe.riskScore + 20;

  console.log(`  Neural model: ${neuralWorks ? 'WORKING' : 'BROKEN (quantization collapse)'}`);
  console.log(`  Rule-based:   ${ruleWorks ? 'WORKING' : 'BROKEN'}`);

  if (!neuralWorks && ruleWorks) {
    console.log('\n  RECOMMENDATION: Use rule-based classifier');
    console.log('  The ternary quantization destroyed learned features.');
    console.log('  Options:');
    console.log('    1. Delete bitnet-weights.json to use rule-based');
    console.log('    2. Retrain with float32 weights (no quantization)');
    console.log('    3. Retrain with binary classification (simpler)');
    console.log('    4. Get 10x more training data (6000+ examples)');
  }
}

main().catch(console.error);
