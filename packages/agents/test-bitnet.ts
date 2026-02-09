import { BitNetEngine } from './src/reasoning/BitNetEngine';

async function main() {
  console.log('Loading BitNetEngine with trained weights...');
  const engine = new BitNetEngine();

  // Test with RISKY token features
  // Low liquidity (0.2), high vol/liq ratio (0.8), high concentration (0.8)
  // Mint enabled (0), freeze enabled (0), bundle detected (1), rug history (0.5)
  const riskyFeatures = new Float32Array([
    0.2, 0.8, 0.3, 0.5, 0.5,   // market: low liq, high vol ratio
    0.3, 0.8, 0.7, 0.6, 0.3,   // holders: high concentration, fresh wallets
    0.6,                        // topWhalePercent: 60%
    0, 0, 0, 0,                 // security: mint ON, freeze ON, LP not locked/burned
    1, 0.5, 0.6, 0.8, 0.5,     // bundle: detected, high control
    0.3, 0.4, 0.7, 0.8,        // trading: mixed signals
    0.9, 0.5,                   // time: very new (high decay)
    0, 0.5, 0.3                 // creator: has rug history!
  ]);

  const result = await engine.classify(riskyFeatures);
  console.log('\n[RISKY TOKEN TEST]');
  console.log(`  Score: ${result.riskScore}/100`);
  console.log(`  Level: ${result.riskLevel}`);
  console.log(`  Confidence: ${result.confidence}%`);
  console.log(`  Flags: ${result.flags?.map(f => `${f.type}(${f.severity})`).join(', ') || 'none'}`);

  // Check if neural model is working
  console.log('\n  Model info:');
  const info = engine.getModelInfo();
  console.log(`    Mode: ${info.mode}`);
  if (info.architecture) console.log(`    Architecture: ${info.architecture.join(' -> ')}`);
  if (info.accuracy) console.log(`    Accuracy: ${(info.accuracy * 100).toFixed(1)}%`);

  // Test with SAFE token features
  // High liquidity (0.9), low concentration (0.2), mint disabled (1), freeze disabled (1)
  // LP locked (1), LP burned (1), no bundle (0), no rug history (0)
  const safeFeatures = new Float32Array([
    0.9, 0.3, 0.8, 0.5, 0.6,   // market: high liq, normal vol ratio
    0.7, 0.2, 0.3, 0.1, 0.1,   // holders: low concentration, few fresh wallets
    0.1,                        // topWhalePercent: 10%
    1, 1, 1, 1,                 // security: mint OFF, freeze OFF, LP locked+burned
    0, 0, 0, 0, 0.8,           // bundle: NOT detected
    0.6, 0.5, 0.4, 0.3,        // trading: healthy
    0.1, 0.3,                   // time: old token (low decay)
    1, 0, 0.1                   // creator: identified, no rug history
  ]);

  const safeResult = await engine.classify(safeFeatures);
  console.log('\n[SAFE TOKEN TEST]');
  console.log(`  Score: ${safeResult.riskScore}/100`);
  console.log(`  Level: ${safeResult.riskLevel}`);
  console.log(`  Confidence: ${safeResult.confidence}%`);
  console.log(`  Flags: ${safeResult.flags?.map(f => `${f.type}(${f.severity})`).join(', ') || 'none'}`);

  // Verdict
  console.log('\n' + '='.repeat(60));
  const riskyCorrect = result.riskLevel !== 'SAFE' || result.flags!.length >= 3;
  const safeCorrect = safeResult.riskLevel === 'SAFE' || safeResult.flags!.length === 0;

  console.log(`RISKY token: ${riskyCorrect ? '✓ CORRECT' : '✗ WRONG'} - ${result.riskLevel}, ${result.flags?.length} flags`);
  console.log(`SAFE token:  ${safeCorrect ? '✓ CORRECT' : '✗ WRONG'} - ${safeResult.riskLevel}, ${safeResult.flags?.length} flags`);
  console.log('='.repeat(60));

  if (riskyCorrect && safeCorrect) {
    console.log('\n✅ Hybrid classification working correctly!');
    console.log('   Neural network provides base score');
    console.log('   Flags provide detailed risk indicators');
  } else {
    console.log('\n⚠️  Classification needs adjustment');
  }
}

main().catch(console.error);
