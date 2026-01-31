/**
 * Argus Monitor - Free 24/7 Token Monitoring
 *
 * WebSocket-based monitoring for new Solana token pools.
 * Runs at $0/month using free public RPC WebSocket subscriptions.
 * Detection only - no RPC calls. Users analyze tokens in the dashboard.
 *
 * Usage:
 *   pnpm dev     # Development with hot reload
 *   pnpm start   # Production
 *
 * Environment Variables:
 *   RPC_ENDPOINT          - Solana RPC endpoint (required, for WebSocket)
 *   RPC_WS_ENDPOINT       - WebSocket endpoint (optional, derived from RPC)
 *   WORKERS_API_URL       - Argus Workers API URL (required for dashboard feed)
 *   TELEGRAM_BOT_TOKEN    - Telegram bot token (optional)
 *   TELEGRAM_CHANNEL_ID   - Telegram channel ID (optional)
 *   ENABLED_DEXS          - Comma-separated DEX list (default: all)
 */

import { PoolMonitor, DEX_PROGRAMS, PoolEvent } from './pool-monitor.js';
import { AlertManager } from './alert-manager.js';

// Configuration from environment
interface Config {
  rpcEndpoint: string;
  rpcWsEndpoint?: string;
  workersApiUrl?: string;
  telegramBotToken?: string;
  telegramChannelId?: string;
  enabledDexs: Array<keyof typeof DEX_PROGRAMS>;
}

// Load configuration from environment
function loadConfig(): Config {
  const rpcEndpoint = process.env.RPC_ENDPOINT;

  if (!rpcEndpoint) {
    console.error('ERROR: RPC_ENDPOINT environment variable is required');
    console.log('\nExample (free public RPC):');
    console.log('  RPC_ENDPOINT=https://api.mainnet-beta.solana.com pnpm dev');
    process.exit(1);
  }

  // Parse enabled DEXs
  let enabledDexs: Array<keyof typeof DEX_PROGRAMS> = Object.keys(DEX_PROGRAMS) as Array<keyof typeof DEX_PROGRAMS>;
  if (process.env.ENABLED_DEXS) {
    enabledDexs = process.env.ENABLED_DEXS.split(',').map(s => s.trim()) as Array<keyof typeof DEX_PROGRAMS>;
  }

  return {
    rpcEndpoint,
    rpcWsEndpoint: process.env.RPC_WS_ENDPOINT,
    workersApiUrl: process.env.WORKERS_API_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChannelId: process.env.TELEGRAM_CHANNEL_ID,
    enabledDexs,
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
  console.log('║        ARGUS MONITOR - $0 24/7 Token Detection               ║');
  console.log('║        WebSocket only • No RPC calls • Zero cost             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Load configuration
  const config = loadConfig();

  console.log('[Config] RPC Endpoint:', config.rpcEndpoint.replace(/api-key=\w+/, 'api-key=***'));
  console.log('[Config] Enabled DEXs:', config.enabledDexs.join(', '));
  console.log('[Config] Workers API:', config.workersApiUrl || 'Not configured (local only)');
  console.log('');

  // Initialize alert manager (for sending to dashboard)
  const alertManager = new AlertManager({
    workersApiUrl: config.workersApiUrl,
    telegramBotToken: config.telegramBotToken,
    telegramChannelId: config.telegramChannelId,
    enableConsoleAlerts: true,
    minSeverityForTelegram: 'warning',
  });

  // Pool event handler - detection only, no analysis
  async function handlePoolEvent(event: PoolEvent): Promise<void> {
    stats.poolsDetected++;

    // Skip if no base mint (couldn't parse)
    if (!event.baseMint) {
      return;
    }

    const timestamp = new Date().toISOString().slice(11, 19);

    // Log differently for graduations
    if (event.type === 'graduation') {
      stats.graduations++;
      const bondingMin = event.bondingCurveTime ? Math.round(event.bondingCurveTime / 1000 / 60) : 0;
      console.log(`[${timestamp}] 🎓 GRADUATION: ${event.baseMint} → ${event.dex} (${bondingMin}min on curve)`);
    } else {
      console.log(`[${timestamp}] [${event.dex}] ${event.baseMint}`);
    }

    // Send to dashboard activity feed (no analysis, just detection)
    await alertManager.alertPoolDiscovered(event, null);
    stats.eventsSent++;
  }

  // Initialize pool monitor
  const poolMonitor = new PoolMonitor({
    rpcEndpoint: config.rpcEndpoint,
    rpcWsEndpoint: config.rpcWsEndpoint,
    enabledDexs: config.enabledDexs,
    onPoolEvent: handlePoolEvent,
    onConnect: (dex) => console.log(`[WebSocket] Connected to ${dex}`),
    onDisconnect: (dex) => console.log(`[WebSocket] Disconnected from ${dex}`),
    onError: (error, dex) => console.error(`[WebSocket] ${dex} error:`, error.message),
  });

  // Start monitoring
  await poolMonitor.start();

  // Print status every minute
  setInterval(() => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
    const monitorStats = poolMonitor.getStats();
    const rate = stats.poolsDetected / Math.max(uptime, 1);

    console.log('');
    console.log(`[Status] Uptime: ${uptime}m | Detected: ${stats.poolsDetected} pools | Sent: ${stats.eventsSent} events`);
    console.log(`[Status] Rate: ${rate.toFixed(1)} pools/min | WebSocket: ${monitorStats.subscriptions} subscriptions`);
    console.log(`[Status] 🎓 Graduations: ${stats.graduations} | Tracking: ${monitorStats.pumpFunTracked} pump.fun tokens`);
    console.log(`[Status] RPC calls: 0 (detection only)`);
    console.log('');

    // Clean up old tokens every hour (when uptime is divisible by 60)
    if (uptime > 0 && uptime % 60 === 0) {
      poolMonitor.cleanupOldTokens();
    }
  }, 60000);

  // Handle shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Shutting down...`);
    await poolMonitor.stop();

    // Final stats
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
    console.log(`║  RPC calls:            0 (FREE!)                             ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('');
  console.log('Monitoring started. Press Ctrl+C to stop.');
  console.log('New pools will appear in the dashboard activity feed.');
  console.log('');
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Export for testing
export { PoolMonitor, AlertManager };
export type { PoolEvent, Config };
