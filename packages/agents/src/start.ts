#!/usr/bin/env node
/**
 * Argus Agent System - Production Startup
 *
 * Launches the full agent network:
 * - ScoutAgent(s): Monitor new token launches
 * - AnalystAgent(s): Deep investigation
 * - HunterAgent(s): Scammer tracking
 * - TraderAgent(s): Trade execution (if enabled)
 *
 * Yellowstone gRPC Integration:
 * - PoolMonitor streams DEX account changes
 * - TraderAgent receives real-time price updates for positions
 * - Zero RPC calls for position monitoring
 */

// Load .env file FIRST
import 'dotenv/config';

import { createArgusNetwork } from './index';
import { Database } from './services/Database';
import { LLMService } from './services/LLMService';
import { PoolMonitor, type PoolEvent, type PriceUpdateEvent } from '@argus/monitor';

// Load environment
const config = {
  rpcEndpoint: process.env.RPC_ENDPOINT || 'http://localhost:8899',
  enableTrading: process.env.ENABLE_TRADING === 'true',
  scouts: parseInt(process.env.SCOUT_COUNT || '2', 10),
  analysts: parseInt(process.env.ANALYST_COUNT || '1', 10),
  hunters: parseInt(process.env.HUNTER_COUNT || '1', 10),
  traders: parseInt(process.env.TRADER_COUNT || '1', 10),
  maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES || '10', 10),
  maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '0.1'),
  // Workers sync for dashboard
  workersUrl: process.env.WORKERS_API_URL || '',
  workersApiSecret: process.env.WORKERS_API_SECRET || '',
  enableWorkersSync: process.env.ENABLE_WORKERS_SYNC !== 'false' && !!process.env.WORKERS_API_URL,
  // Database
  databaseUrl: process.env.DATABASE_URL || '',
  // LLM (self-hosted Ollama)
  llmEndpoint: process.env.LLM_ENDPOINT || '',
  llmReasoningModel: process.env.LLM_REASONING_MODEL || 'deepseek-r1:32b',
  llmFastModel: process.env.LLM_FAST_MODEL || 'qwen3:8b',
  // Yellowstone gRPC (Chainstack)
  yellowstoneEndpoint: process.env.YELLOWSTONE_ENDPOINT || '',
  yellowstoneToken: process.env.YELLOWSTONE_TOKEN || '',
  enableYellowstone: !!process.env.YELLOWSTONE_ENDPOINT && !!process.env.YELLOWSTONE_TOKEN,
};

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║              ARGUS AI AGENT SYSTEM                        ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Validate RPC endpoint
  if (config.rpcEndpoint === 'http://localhost:8899') {
    console.warn('⚠️  WARNING: Using default localhost RPC. Set RPC_ENDPOINT in .env');
  }

  // Check if trading wallet is configured
  const hasPrivateKey = !!process.env.TRADING_WALLET_PRIVATE_KEY;
  const tradingMode = config.enableTrading && hasPrivateKey ? 'LIVE' : config.enableTrading ? 'SIMULATION' : 'DISABLED';

  console.log('Configuration:');
  console.log(`  RPC Endpoint:    ${config.rpcEndpoint}`);
  console.log(`  Trading Mode:    ${tradingMode}`);
  if (config.enableTrading) {
    console.log(`  Max Position:    ${config.maxPositionSize} SOL`);
    console.log(`  Max Daily Trades: ${config.maxDailyTrades}`);
    console.log(`  Trade Fee:       0.5% (to Argus wallet)`);
  }
  console.log(`  Scouts:          ${config.scouts}`);
  console.log(`  Analysts:        ${config.analysts}`);
  console.log(`  Hunters:         ${config.hunters}`);
  console.log(`  Traders:         ${config.traders}`);
  console.log(`  Workers Sync:    ${config.enableWorkersSync ? config.workersUrl : 'Disabled'}`);
  console.log(`  LLM Endpoint:    ${config.llmEndpoint || 'Disabled'}`);
  if (config.llmEndpoint) {
    console.log(`  Reasoning Model: ${config.llmReasoningModel}`);
    console.log(`  Fast Model:      ${config.llmFastModel}`);
  }
  console.log(`  Yellowstone:     ${config.enableYellowstone ? 'ENABLED (real-time price streaming)' : 'Disabled'}`);
  console.log('');

  // Initialize database if configured
  let database: Database | undefined;
  if (config.databaseUrl) {
    try {
      database = new Database(config.databaseUrl);
      await database.initialize();
      console.log('[Main] PostgreSQL connected');
    } catch (err) {
      console.warn('[Main] PostgreSQL unavailable, running without persistence:', (err as Error).message);
      database = undefined;
    }
  } else {
    console.log('[Main] DATABASE_URL not set, running without persistence');
  }

  // Initialize LLM service if configured
  let llm: LLMService | undefined;
  if (config.llmEndpoint) {
    llm = new LLMService({
      endpoint: config.llmEndpoint,
      reasoningModel: config.llmReasoningModel,
      fastModel: config.llmFastModel,
    });
    const available = await llm.isAvailable();
    if (available) {
      console.log('[Main] LLM service connected');
    } else {
      console.warn('[Main] LLM service unreachable — agents will use rule-based fallback');
    }
  } else {
    console.log('[Main] LLM_ENDPOINT not set, using rule-based reasoning');
  }

  // PoolMonitor for Yellowstone streaming (initialized after coordinator)
  let poolMonitor: PoolMonitor | null = null;

  try {
    // Create and initialize the network
    console.log('[Main] Creating Argus Network...');
    const coordinator = await createArgusNetwork({ ...config, database, llm });

    // Start the network
    console.log('[Main] Starting agents...');
    await coordinator.start();

    // Initialize Yellowstone streaming for real-time price updates
    if (config.enableYellowstone && config.enableTrading) {
      console.log('[Main] Initializing Yellowstone gRPC for position price streaming...');

      const traders = coordinator.getTraders();
      if (traders.length > 0) {
        poolMonitor = new PoolMonitor({
          yellowstoneEndpoint: config.yellowstoneEndpoint,
          yellowstoneToken: config.yellowstoneToken,

          // Handle new pool events (forward to ScoutAgent via message bus)
          onPoolEvent: async (event: PoolEvent) => {
            // Log significant events
            if (event.type === 'new_pool' || event.type === 'graduation') {
              console.log(`[Yellowstone] ${event.type}: ${event.tokenSymbol || event.baseMint?.slice(0, 8)} on ${event.dex}`);
            }
          },

          // Handle price updates for positions - WIRE TO TRADER AGENTS
          onPriceUpdate: async (event: PriceUpdateEvent) => {
            // Forward to all traders (they filter by their own positions)
            for (const trader of traders) {
              try {
                await trader.handlePriceUpdate(event);
              } catch (err) {
                console.error('[Yellowstone] Error forwarding price update:', (err as Error).message);
              }
            }
          },

          onConnect: () => {
            console.log('[Yellowstone] Connected to gRPC stream');
          },

          onDisconnect: () => {
            console.warn('[Yellowstone] Disconnected from gRPC stream');
          },

          onError: (error: Error, context: string) => {
            console.error(`[Yellowstone] Error in ${context}:`, error.message);
          },
        });

        await poolMonitor.start();
        console.log('[Main] Yellowstone price streaming ACTIVE');

        // Wire up TraderAgent position tracking callbacks
        // When TraderAgent opens a position, it will subscribe to price updates via these callbacks
        for (const trader of traders) {
          trader.setYellowstoneCallbacks(
            // onPositionOpened: subscribe to price updates for this pool
            async (poolAddress: string, tokenAddress: string) => {
              // Determine DEX from pool address (default to Raydium for now)
              // In production, this should be detected from the pool data
              poolMonitor!.addPositionTracking(poolAddress, tokenAddress, 'RAYDIUM_AMM_V4');
            },
            // onPositionClosed: unsubscribe from price updates
            async (poolAddress: string) => {
              poolMonitor!.removePositionTracking(poolAddress);
            }
          );
        }
        console.log(`[Main] ${traders.length} Traders wired to Yellowstone price streaming`);
      } else {
        console.log('[Main] No traders configured, skipping Yellowstone initialization');
      }
    } else if (config.enableYellowstone && !config.enableTrading) {
      console.log('[Main] Yellowstone enabled but trading disabled - skipping price streaming');
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('           ARGUS NETWORK IS LIVE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // Log status every 60 seconds
    const statusInterval = setInterval(() => {
      const status = coordinator.getStatus();
      console.log(`[Status] Uptime: ${Math.floor(status.uptime / 1000)}s | Scanned: ${status.stats.tokensScanned} | Investigations: ${status.stats.investigationsCompleted} | Scammers: ${status.stats.scammersTracked}`);
    }, 60000);

    // Handle shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n[Main] Received ${signal}, shutting down...`);
      clearInterval(statusInterval);

      // Stop Yellowstone streaming first
      if (poolMonitor) {
        console.log('[Main] Stopping Yellowstone streaming...');
        await poolMonitor.stop();
      }

      await coordinator.stop();

      if (database) {
        await database.close();
      }

      console.log('[Main] Argus Network stopped. Goodbye.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Signal ready to PM2
    if (process.send) {
      process.send('ready');
    }

  } catch (error) {
    console.error('[Main] Failed to start Argus Network:', error);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('[Main] Unhandled error:', error);
  process.exit(1);
});
