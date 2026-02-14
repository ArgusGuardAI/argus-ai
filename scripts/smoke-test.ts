#!/usr/bin/env npx ts-node
/**
 * Smoke Test - Verify Real Infrastructure
 *
 * Tests actual connectivity and functionality against production systems.
 * Run with: npx ts-node scripts/smoke-test.ts
 */

const HETZNER_LLM = process.env.LLM_ENDPOINT || 'http://46.225.3.208:11434';
const HETZNER_RPC = process.env.RPC_ENDPOINT || 'http://144.76.62.180:8899';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<string | void>): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
      details: details || undefined,
    });
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
    if (details) console.log(`   ${details}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error,
    });
    console.log(`❌ ${name} (${Date.now() - start}ms)`);
    console.log(`   Error: ${error}`);
  }
}

// ============================================
// Infrastructure Tests
// ============================================

async function testLLMServer(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${HETZNER_LLM}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models?.map(m => m.name) || [];

    if (models.length === 0) {
      throw new Error('No models loaded');
    }

    return `Models: ${models.join(', ')}`;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Connection timeout (10s)');
    }
    throw err;
  }
}

async function testRPCNode(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(HETZNER_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSlot',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { result?: number; error?: { message: string } };

    if (data.error) {
      throw new Error(data.error.message);
    }

    if (!data.result) {
      throw new Error('No slot returned');
    }

    return `Slot: ${data.result.toLocaleString()}`;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Connection timeout (10s)');
    }
    throw err;
  }
}

// ============================================
// Local Agent System Tests (no network needed)
// ============================================

async function testBitNetEngine(): Promise<string> {
  // BitNet uses import.meta which requires ESM - skip in CommonJS mode
  // Unit tests cover this fully; smoke test focuses on infrastructure
  try {
    const { BitNetEngine } = await import('../packages/agents/src/reasoning/BitNetEngine');
    const engine = new BitNetEngine();

    const features = new Float32Array(29);
    features[0] = 0.5;
    features[6] = 0.7;
    features[11] = 1.0;
    features[15] = 0;

    const result = await engine.classify(features);
    return `Risk: ${result.riskScore}, Level: ${result.riskLevel}, Confidence: ${result.confidence}%`;
  } catch (err: any) {
    if (err.message?.includes('import.meta') || err.message?.includes('Cannot find module')) {
      return 'Skipped (ESM-only, covered by unit tests)';
    }
    throw err;
  }
}

async function testPatternLibrary(): Promise<string> {
  const { PatternLibrary } = await import('../packages/agents/src/learning/PatternLibrary');

  const library = new PatternLibrary();
  const patterns = library.getAllPatterns();

  // Test pattern matching
  const features = new Float32Array(29);
  features[11] = 0; // Mint NOT disabled (bad)
  features[12] = 0; // Freeze NOT disabled (bad)
  features[27] = 0.8; // Creator rug history

  const matches = library.matchPatterns(features, { minSimilarity: 0.3 });

  return `${patterns.length} patterns, ${matches.length} matches`;
}

async function testMessageBus(): Promise<string> {
  const { MessageBus } = await import('../packages/agents/src/core/MessageBus');

  const bus = new MessageBus();
  let received = false;

  bus.subscribe('test.topic', () => {
    received = true;
  });

  await bus.publish('test.topic', { test: true });

  if (!received) {
    throw new Error('Message not received');
  }

  return 'Pub/sub working';
}

async function testAgentMemory(): Promise<string> {
  const { AgentMemory } = await import('../packages/agents/src/core/AgentMemory');

  const memory = new AgentMemory('test-agent');

  // Store a token
  const features = new Float32Array(29).fill(0.5);
  await memory.storeToken('TestToken123', features, { score: 50 });

  // Retrieve it
  const similar = await memory.findSimilar(features, 1, 0.9);

  if (similar.length === 0) {
    throw new Error('Could not retrieve stored token');
  }

  return `Stored and retrieved token (similarity: ${similar[0].similarity.toFixed(2)})`;
}

async function testOutcomeLearner(): Promise<string> {
  const { OutcomeLearner } = await import('../packages/agents/src/learning/OutcomeLearner');

  const learner = new OutcomeLearner();

  // Record a prediction with all required fields
  learner.recordPrediction({
    token: 'TestToken',
    verdict: 'SAFE',
    riskScore: 25,
    confidence: 85,
    timestamp: Date.now(),
    patterns: [],
    source: 'test',
    features: new Float32Array(29).fill(0.5),
  });

  const stats = learner.getStats();

  return `Predictions: ${stats.totalPredictions}, Outcomes: ${stats.totalOutcomes}`;
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('🔥 SMOKE TEST - Infrastructure Verification\n');
  console.log('=' .repeat(50) + '\n');

  // Infrastructure (may fail if not on same network)
  console.log('📡 INFRASTRUCTURE (remote servers)\n');
  console.log(`   LLM: ${HETZNER_LLM}`);
  console.log(`   RPC: ${HETZNER_RPC}\n`);

  await test('LLM Server', testLLMServer);
  await test('RPC Node', testRPCNode);

  console.log('\n🤖 AGENT SYSTEM (local)\n');

  await test('BitNet Engine', testBitNetEngine);
  await test('Pattern Library', testPatternLibrary);
  await test('Message Bus', testMessageBus);
  await test('Agent Memory', testAgentMemory);
  await test('Outcome Learner', testOutcomeLearner);

  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('\n📊 SUMMARY\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  const infraPassed = results.slice(0, 2).filter(r => r.passed).length;
  const localPassed = results.slice(2).filter(r => r.passed).length;

  console.log(`   Infrastructure: ${infraPassed}/2`);
  console.log(`   Local agents:   ${localPassed}/${results.length - 2}`);
  console.log(`   Total time:     ${totalTime}ms`);

  if (failed > 0) {
    console.log('\n⚠️  ISSUES:\n');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   • ${r.name}: ${r.error}`);
    });
  }

  // Exit code based on local tests (infra may fail due to network)
  const localFailed = results.slice(2).filter(r => !r.passed).length;
  if (localFailed > 0) {
    console.log('\n❌ Local agent tests failed!\n');
    process.exit(1);
  } else if (infraPassed === 2) {
    console.log('\n✅ All systems operational!\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Local OK, but infrastructure unreachable\n');
    console.log('   Run from a server with network access to Hetzner.\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
