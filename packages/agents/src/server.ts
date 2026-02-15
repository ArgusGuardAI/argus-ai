/**
 * Argus Agents HTTP API Server
 *
 * Runs on your Hetzner server (46.225.3.208) and handles all analysis.
 * Workers API proxies requests here — no third-party RPCs.
 *
 * Start: pnpm start
 * Port: 8080 (or AGENTS_PORT env var)
 */

import http from 'http';
import { URL } from 'url';
import { MessageBus } from './core/MessageBus';
import { ScoutAgent, LaunchEvent } from './agents/ScoutAgent';
import { AnalystAgent } from './agents/AnalystAgent';
import { HunterAgent } from './agents/HunterAgent';
import { BitNetEngine } from './reasoning/BitNetEngine';
import { PatternLibrary } from './learning/PatternLibrary';
import { LLMService } from './services/LLMService';

// Configuration
const PORT = parseInt(process.env.AGENTS_PORT || '8080', 10);
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'http://144.76.62.180:8899';
const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434';

// Agents
let messageBus: MessageBus;
let scout: ScoutAgent;
let analyst: AnalystAgent;
let hunter: HunterAgent;
let bitnet: BitNetEngine;
let patterns: PatternLibrary;
let llm: LLMService;

/**
 * Initialize all agents
 */
async function initializeAgents(): Promise<void> {
  console.log('[Agents] Initializing...');
  console.log(`[Agents] RPC: ${RPC_ENDPOINT}`);
  console.log(`[Agents] LLM: ${LLM_ENDPOINT}`);

  messageBus = new MessageBus();
  bitnet = new BitNetEngine();
  patterns = new PatternLibrary();
  llm = new LLMService({
    endpoint: LLM_ENDPOINT,
    fastModel: 'qwen3:8b',
    reasoningModel: 'deepseek-r1:32b',
  });

  scout = new ScoutAgent(messageBus, {
    name: 'scout-1',
    rpcEndpoint: RPC_ENDPOINT,
  });

  analyst = new AnalystAgent(messageBus, {
    name: 'analyst-1',
    rpcEndpoint: RPC_ENDPOINT,
  });

  hunter = new HunterAgent(messageBus, {
    name: 'hunter-1',
    rpcEndpoint: RPC_ENDPOINT,
  });

  await scout.initialize();
  await analyst.initialize();
  await hunter.initialize();

  console.log('[Agents] All agents initialized');
}

/**
 * Analyze a token using all agents
 */
async function analyzeToken(tokenAddress: string): Promise<object> {
  const startTime = Date.now();
  console.log(`[Analyze] Starting analysis for ${tokenAddress}`);

  try {
    // 1. Scout quick scan
    const launchEvent: LaunchEvent = {
      token: tokenAddress,
      creator: 'unknown',
      slot: 0,
      timestamp: Date.now(),
      dex: 'UNKNOWN',
      poolAddress: '',
      liquiditySol: 0,
    };

    const quickScan = (scout as any).quickScanFromYellowstone(launchEvent);
    console.log(`[Analyze] Scout scan: score=${quickScan.score}, flags=${quickScan.flags.join(',')}`);

    // 2. BitNet classification
    const features = new Float32Array(quickScan.features);
    const bitnetResult = await bitnet.classify(features);
    console.log(`[Analyze] BitNet: risk=${bitnetResult.riskScore}, level=${bitnetResult.riskLevel}`);

    // 3. Pattern matching
    const patternMatches = patterns.matchPatterns(features, { minSimilarity: 0.3 });
    console.log(`[Analyze] Patterns: ${patternMatches.length} matches`);

    // 4. Check for known scammers via Hunter
    const creatorCheck = await (hunter as any).checkRepeatOffender({ wallet: launchEvent.creator });

    // 5. Build response
    const duration = Date.now() - startTime;
    console.log(`[Analyze] Complete in ${duration}ms`);

    return {
      tokenInfo: {
        address: tokenAddress,
        name: 'Unknown',
        symbol: 'UNKNOWN',
      },
      analysis: {
        riskScore: bitnetResult.riskScore,
        riskLevel: bitnetResult.riskLevel,
        confidence: bitnetResult.confidence,
        flags: quickScan.flags.map((f: string) => ({
          type: f,
          severity: f.includes('BUNDLE') || f.includes('RUG') ? 'HIGH' : 'MEDIUM',
        })),
        patterns: patternMatches.map(p => ({
          name: p.pattern.name,
          similarity: p.similarity,
          severity: p.pattern.severity,
        })),
        summary: `Token analysis: ${bitnetResult.riskLevel} risk (score: ${bitnetResult.riskScore})`,
        recommendation: bitnetResult.riskScore > 70
          ? 'AVOID - High risk detected'
          : bitnetResult.riskScore > 40
          ? 'CAUTION - Moderate risk'
          : 'Consider with care',
      },
      creatorInfo: {
        isKnownScammer: creatorCheck.isRepeat,
        rugCount: creatorCheck.rugCount,
      },
      agents: {
        scout: scout.getStats(),
        analyst: { investigationsComplete: 0 },
        hunter: hunter.getStats(),
      },
      dataSource: 'AGENTS',
      aiProvider: 'bitnet-local',
      fetchDuration: duration,
    };
  } catch (error) {
    console.error('[Analyze] Error:', error);
    throw error;
  }
}

/**
 * HTTP request handler
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // Health check
  if (path === '/health' || path === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      agents: {
        scout: 'online',
        analyst: 'online',
        hunter: 'online',
      },
      rpc: RPC_ENDPOINT,
      llm: LLM_ENDPOINT,
    }));
    return;
  }

  // Analyze endpoint
  if (path === '/analyze' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { tokenAddress } = JSON.parse(body);
        if (!tokenAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'tokenAddress required' }));
          return;
        }

        const result = await analyzeToken(tokenAddress);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error('[Server] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Analysis failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });
    return;
  }

  // Agent status
  if (path === '/agents/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      online: true,
      agents: [
        { type: 'scout', name: 'scout-1', status: 'active', ...scout.getStats() },
        { type: 'analyst', name: 'analyst-1', status: 'active' },
        { type: 'hunter', name: 'hunter-1', status: 'active', ...hunter.getStats() },
      ],
    }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

/**
 * Start the server
 */
async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           ARGUS AGENTS - HTTP API Server                     ║');
  console.log('║           Your Infrastructure • No Third-Party RPCs          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  await initializeAgents();

  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log('');
    console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
    console.log('[Server] Endpoints:');
    console.log(`  POST /analyze        - Analyze a token`);
    console.log(`  GET  /health         - Health check`);
    console.log(`  GET  /agents/status  - Agent status`);
    console.log('');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    server.close();
    process.exit(0);
  });
}

// Run if executed directly
main().catch(console.error);

export { analyzeToken, initializeAgents };
