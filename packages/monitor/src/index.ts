/**
 * Argus Monitor - Yellowstone gRPC 24/7 Token Detection
 *
 * Chainstack Yellowstone gRPC streaming for new Solana token pools.
 * Persistent gRPC connection — $49/mo flat, unlimited events.
 * Detection only — no RPC calls for pool discovery.
 *
 * Environment Variables:
 *   YELLOWSTONE_ENDPOINT  - Chainstack Yellowstone gRPC endpoint (required)
 *   YELLOWSTONE_TOKEN     - Chainstack x-token for auth (required)
 *   WORKERS_API_URL       - Argus Workers API URL (optional, for dashboard feed)
 *   TELEGRAM_BOT_TOKEN    - Telegram bot token (optional)
 *   TELEGRAM_CHANNEL_ID   - Telegram channel ID (optional)
 *   ENABLED_DEXS          - Comma-separated DEX list (default: all)
 */

import 'dotenv/config';
import { PoolMonitor, DEX_PROGRAMS, PoolEvent } from './pool-monitor.js';
import { AlertManager } from './alert-manager.js';

// Configuration from environment
interface Config {
  yellowstoneEndpoint: string;
  yellowstoneToken: string;
  workersApiUrl?: string;
  telegramBotToken?: string;
  telegramChannelId?: string;
  enabledDexs: Array<keyof typeof DEX_PROGRAMS>;
  heliusApiKey?: string; // For fallback token name fetch
}

// Load configuration from environment
function loadConfig(): Config {
  const yellowstoneEndpoint = process.env.YELLOWSTONE_ENDPOINT;
  const yellowstoneToken = process.env.YELLOWSTONE_TOKEN;

  if (!yellowstoneEndpoint || !yellowstoneToken) {
    console.error('ERROR: YELLOWSTONE_ENDPOINT and YELLOWSTONE_TOKEN are required');
    console.log('\nSet these from your Chainstack dashboard:');
    console.log('  YELLOWSTONE_ENDPOINT=yellowstone-solana-mainnet.core.chainstack.com');
    console.log('  YELLOWSTONE_TOKEN=your-x-token');
    process.exit(1);
  }

  // Parse enabled DEXs
  let enabledDexs: Array<keyof typeof DEX_PROGRAMS> = Object.keys(DEX_PROGRAMS) as Array<keyof typeof DEX_PROGRAMS>;
  if (process.env.ENABLED_DEXS) {
    enabledDexs = process.env.ENABLED_DEXS.split(',').map(s => s.trim()) as Array<keyof typeof DEX_PROGRAMS>;
  }

  return {
    yellowstoneEndpoint,
    yellowstoneToken,
    workersApiUrl: process.env.WORKERS_API_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChannelId: process.env.TELEGRAM_CHANNEL_ID,
    enabledDexs,
    heliusApiKey: process.env.HELIUS_API_KEY, // For fallback token name fetch
  };
}

// Statistics tracking
interface MonitorStats {
  startTime: number;
  poolsDetected: number;
  eventsSent: number;
  graduations: number;
}

const stats: MonitorStats = {
  startTime: Date.now(),
  poolsDetected: 0,
  eventsSent: 0,
  graduations: 0,
};

/**
 * Main monitoring loop
 */
async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS MONITOR - Yellowstone gRPC Token Detection        ║');
  console.log('║     Chainstack Geyser • Persistent gRPC • $49/mo flat       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Load configuration
  const config = loadConfig();

  console.log('[Config] Yellowstone: ', config.yellowstoneEndpoint);
  console.log('[Config] Enabled DEXs:', config.enabledDexs.join(', '));
  console.log('[Config] Workers API: ', config.workersApiUrl || 'Not configured (local only)');
  console.log('');

  // Initialize alert manager (for sending to dashboard + local file)
  const alertManager = new AlertManager({
    workersApiUrl: config.workersApiUrl,
    telegramBotToken: config.telegramBotToken,
    telegramChannelId: config.telegramChannelId,
    enableConsoleAlerts: true,
    minSeverityForTelegram: 'warning',
  });

  // Pool event handler — detection only, no analysis
  async function handlePoolEvent(event: PoolEvent): Promise<void> {
    stats.poolsDetected++;

    if (!event.baseMint) return;

    // Only log graduations (high-value) — skip routine pool discoveries to reduce log volume
    if (event.type === 'graduation') {
      stats.graduations++;
      const timestamp = new Date().toISOString().slice(11, 19);
      const bondingMin = event.bondingCurveTime ? Math.round(event.bondingCurveTime / 1000 / 60) : 0;
      console.log(`[${timestamp}] GRADUATION: ${event.baseMint} → ${event.dex} (${bondingMin}min on curve)`);
    }

    // Write to local file for agents + send to Workers API
    await alertManager.alertPoolDiscovered(event, null);
    stats.eventsSent++;
  }

  // Initialize pool monitor with Yellowstone gRPC
  const poolMonitor = new PoolMonitor({
    yellowstoneEndpoint: config.yellowstoneEndpoint,
    yellowstoneToken: config.yellowstoneToken,
    enabledDexs: config.enabledDexs,
    heliusApiKey: config.heliusApiKey, // For fallback metadata fetch
    onPoolEvent: handlePoolEvent,
    onConnect: () => console.log('[Yellowstone] Connected to gRPC stream'),
    onDisconnect: () => console.log('[Yellowstone] Disconnected from gRPC stream'),
    onError: (error, ctx) => console.error(`[Yellowstone] ${ctx} error:`, error.message),
  });

  // Start monitoring
  await poolMonitor.start();

  // Print status every minute
  setInterval(() => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
    const monitorStats = poolMonitor.getStats();
    const rate = stats.poolsDetected / Math.max(uptime, 1);

    const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[Status] Uptime: ${uptime}m | Pools: ${stats.poolsDetected} | Graduations: ${stats.graduations} | Mem: ${memMB}MB`);
    console.log(`[Status] Rate: ${rate.toFixed(1)}/min | gRPC: ${monitorStats.connected ? 'connected' : 'disconnected'} | Seen: ${monitorStats.seenPools} | Pump.fun: ${monitorStats.pumpFunTracked}`);
    console.log(`[Status] Metadata: ${monitorStats.metadataCached} cached | Pending: ${monitorStats.metadataPending} | Hit rate: ${monitorStats.metadataHitRate}`);
    console.log(`[Status] Sources: Metaplex: ${monitorStats.metaplexNotifications} | Token2022: ${monitorStats.token2022Notifications}`);

    // Clean up old tokens every 15 minutes
    if (uptime > 0 && uptime % 15 === 0) {
      poolMonitor.cleanupOldTokens();
    }
  }, 60000);

  // Handle shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Shutting down...`);
    await poolMonitor.stop();

    const totalUptime = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
    const rate = stats.poolsDetected / Math.max(totalUptime, 1);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                      Final Statistics                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Uptime:          ${String(totalUptime).padStart(6)} minutes                        ║`);
    console.log(`║  Pools detected:  ${String(stats.poolsDetected).padStart(6)}                                 ║`);
    console.log(`║  Graduations:     ${String(stats.graduations).padStart(6)}                                 ║`);
    console.log(`║  Events sent:     ${String(stats.eventsSent).padStart(6)}                                 ║`);
    console.log(`║  Detection rate:  ${rate.toFixed(1).padStart(6)} pools/min                       ║`);
    console.log(`║  Transport:       Yellowstone gRPC                           ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('');
  console.log('Monitoring started via Yellowstone gRPC. Press Ctrl+C to stop.');
  console.log('New pools will appear in the dashboard activity feed.');
  console.log('');
}

// Export for use by other packages (BEFORE main() check)
export { PoolMonitor, AlertManager, DEX_PROGRAMS };
export type { PoolEvent, PriceUpdateEvent, MonitorConfig, PriceUpdateCallback, PoolEventCallback } from './pool-monitor.js';

// Only run main() when this file is executed directly, NOT when imported
// This allows agents to import PoolMonitor without triggering Yellowstone check
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const currentFile = fileURLToPath(import.meta.url);
const entryFile = resolve(process.argv[1]);

// Check if this module is the entry point
if (currentFile === entryFile || entryFile.endsWith('/monitor/dist/index.js')) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
