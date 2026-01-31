#!/usr/bin/env node
/**
 * Argus Agent System - Production Startup
 *
 * Launches the full agent network:
 * - ScoutAgent(s): Monitor new token launches
 * - AnalystAgent(s): Deep investigation
 * - HunterAgent(s): Scammer tracking
 * - TraderAgent(s): Trade execution (if enabled)
 */

import { createArgusNetwork } from './index';

// Load environment
const config = {
  rpcEndpoint: process.env.RPC_ENDPOINT || 'http://localhost:8899',
  enableTrading: process.env.ENABLE_TRADING === 'true',
  scouts: parseInt(process.env.SCOUT_COUNT || '2', 10),
  analysts: parseInt(process.env.ANALYST_COUNT || '1', 10),
  hunters: parseInt(process.env.HUNTER_COUNT || '1', 10),
  traders: parseInt(process.env.TRADER_COUNT || '1', 10),
  maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES || '10', 10),
  maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '0.1')
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

  console.log('Configuration:');
  console.log(`  RPC Endpoint:    ${config.rpcEndpoint}`);
  console.log(`  Trading Enabled: ${config.enableTrading}`);
  console.log(`  Scouts:          ${config.scouts}`);
  console.log(`  Analysts:        ${config.analysts}`);
  console.log(`  Hunters:         ${config.hunters}`);
  console.log(`  Traders:         ${config.traders}`);
  console.log('');

  try {
    // Create and initialize the network
    console.log('[Main] Creating Argus Network...');
    const coordinator = await createArgusNetwork(config);

    // Start the network
    console.log('[Main] Starting agents...');
    await coordinator.start();

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('           🛡️  ARGUS NETWORK IS LIVE  🛡️');
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
      await coordinator.stop();

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
