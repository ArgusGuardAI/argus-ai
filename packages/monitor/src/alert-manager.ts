/**
 * Alert Manager - Push Notifications for Token Discoveries
 *
 * Sends alerts to:
 * 1. Workers API - Updates agent events in KV
 * 2. Telegram (optional) - Direct notifications to channel
 * 3. Console - Local logging
 */

import type { PoolEvent } from './pool-monitor.js';

// Minimal analysis interface (for backwards compatibility)
interface QuickAnalysis {
  suspicionScore?: number;
  supply?: number;
}

// Alert types
export interface Alert {
  id: string;
  timestamp: number;
  type: 'new_pool' | 'suspicious_token' | 'known_scammer' | 'high_risk' | 'graduation';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  data: {
    mint?: string;
    dex?: string;
    poolAddress?: string;
    suspicionScore?: number;
    reasons?: string[];
    scammerInfo?: {
      wallet: string;
      rugCount: number;
      lastRug?: string;
    };
    // Graduation-specific
    graduatedFrom?: string;
    bondingCurveTime?: number;
  };
}

// Alert manager configuration
export interface AlertManagerConfig {
  workersApiUrl?: string;  // e.g., https://argusguard-api.workers.dev
  telegramBotToken?: string;
  telegramChannelId?: string;
  minSeverityForTelegram?: 'info' | 'warning' | 'critical';
  enableConsoleAlerts?: boolean;
  ollamaEndpoint?: string; // e.g., http://144.XX.XX.XXX:11434
}

/**
 * AlertManager - Unified alert distribution
 */
export class AlertManager {
  private config: AlertManagerConfig;
  private alertCount = 0;
  private lastApiCallTime = 0;
  private lastRotationCheck = 0;
  private static readonly POOL_EVENTS_FILE = '/opt/argus-ai/data/pool-events.jsonl';
  private static readonly API_MIN_INTERVAL_MS = 2000; // Max 1 API call per 2 seconds for discoveries
  private static readonly MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB before rotation
  private static readonly ROTATION_CHECK_INTERVAL_MS = 60_000; // Check file size every minute

  constructor(config: AlertManagerConfig) {
    this.config = {
      enableConsoleAlerts: true,
      minSeverityForTelegram: 'warning',
      ...config,
    };

    console.log('[AlertManager] Initialized');
    console.log(`[AlertManager] Pool events file: ${AlertManager.POOL_EVENTS_FILE}`);
    if (config.workersApiUrl) {
      console.log(`[AlertManager] Workers API: ${config.workersApiUrl}`);
    }
    if (config.telegramBotToken) {
      console.log('[AlertManager] Telegram: enabled');
    }

    // Ensure data directory exists on startup
    this.ensureDataDir();
  }

  /**
   * Ensure data directory exists for pool events file
   */
  private async ensureDataDir(): Promise<void> {
    try {
      const fs = await import('fs').then(m => m.promises);
      await fs.mkdir('/opt/argus-ai/data', { recursive: true });
    } catch {
      // Non-fatal
    }
  }

  /**
   * Generate unique alert ID
   */
  private generateId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Generate natural dialogue via LLM (Ollama)
   * Falls back to simple message if LLM unavailable
   */
  private async generateLLMDialogue(
    agent: string,
    event: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const ollamaUrl = this.config.ollamaEndpoint || process.env.OLLAMA_ENDPOINT || 'http://144.XX.XX.XXX:8899';

    // Fallback message in case LLM fails
    const symbol = data.symbol || data.token || 'token';
    const dex = String(data.dex || 'DEX').replace('_', ' ');
    const liq = data.liquidity ? ` ${Number(data.liquidity).toFixed(1)} SOL liq.` : '';
    const fallback = `Detected ${symbol} on ${dex}.${liq}`;

    try {
      const prompt = `You are SCOUT, an AI agent monitoring Solana for new token launches. Generate a BRIEF status update (10-15 words max) about detecting a new token.

DATA:
- Token: ${data.symbol || data.token || 'unknown'}
- DEX: ${data.dex}
- Liquidity: ${data.liquidity ? data.liquidity + ' SOL' : 'unknown'}
- Event type: ${event}

Rules:
- Natural, conversational tone
- Reference specific data (symbol, DEX, liquidity)
- No emojis
- Examples of good responses:
  - "Spotted PEPE on Raydium. 45 SOL liquidity. Running scan."
  - "New pump.fun launch: DOGE. Checking curve status."
  - "Fresh pool on Meteora: ABC with 120 SOL. Analyzing."

Respond with ONLY the message text, nothing else.`;

      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3:8b',
          prompt,
          stream: false,
          think: false, // Disable thinking mode for fast response
          options: { temperature: 0.7, num_predict: 100 },
        }),
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      if (!response.ok) {
        return fallback;
      }

      const result = await response.json() as { response?: string };
      const generated = result.response?.trim();

      // Use generated if valid, otherwise fallback
      if (generated && generated.length > 5 && generated.length < 150) {
        return generated;
      }

      return fallback;
    } catch {
      // LLM unavailable, use fallback
      return fallback;
    }
  }

  /**
   * Send pool discovery event to Workers API + local file (for agents)
   * This feeds the dashboard activity feed AND the Scout agent
   * Detection only - no analysis data
   */
  async alertPoolDiscovered(event: PoolEvent, _analysis: QuickAnalysis | null): Promise<void> {
    // Skip if no base mint
    if (!event.baseMint) return;

    // Check if this is a graduation event
    if (event.type === 'graduation') {
      await this.alertGraduation(event);
      return;
    }

    // ALWAYS write to local file for agents (even if Workers API is not configured)
    await this.writePoolEventToFile(event);

    // Send to Workers API if configured (rate-limited to avoid KV contention)
    if (!this.config.workersApiUrl) return;

    const now = Date.now();
    if (now - this.lastApiCallTime < AlertManager.API_MIN_INTERVAL_MS) return;
    this.lastApiCallTime = now;

    try {
      // Generate natural dialogue via LLM (async, non-blocking)
      const message = await this.generateLLMDialogue('scout', 'pool_detected', {
        token: event.baseMint?.slice(0, 8),
        symbol: event.tokenSymbol,
        dex: event.dex,
        liquidity: event.enrichedData?.liquiditySol,
        type: event.type,
      });

      // Fire and forget - don't await the response
      fetch(`${this.config.workersApiUrl}/agents/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'monitor_alert',
          alert: {
            agent: 'SCOUT',
            type: 'discovery',
            message,
            severity: 'info',
            data: {
              mint: event.baseMint,
              dex: event.dex,
              poolAddress: event.poolAddress,
            },
          },
        }),
      }).catch(() => {}); // Silently fail
    } catch (error) {
      // Silently fail - don't block monitoring for API errors
    }
  }

  /**
   * Write pool event to local JSONL file for Scout agent consumption
   * This is how Monitor (Yellowstone/WebSocket) communicates with Agents (same server)
   * Zero RPC calls — just a file append
   */
  private async writePoolEventToFile(event: PoolEvent): Promise<void> {
    try {
      const fs = await import('fs').then(m => m.promises);

      // Periodically check file size and rotate if needed
      const now = Date.now();
      if (now - this.lastRotationCheck > AlertManager.ROTATION_CHECK_INTERVAL_MS) {
        this.lastRotationCheck = now;
        try {
          const stat = await fs.stat(AlertManager.POOL_EVENTS_FILE);
          if (stat.size > AlertManager.MAX_FILE_SIZE_BYTES) {
            const rotatedPath = `${AlertManager.POOL_EVENTS_FILE}.${new Date().toISOString().slice(0, 10)}`;
            await fs.rename(AlertManager.POOL_EVENTS_FILE, rotatedPath).catch(() => {});
            // Keep max 3 rotated files
            const dataDir = '/opt/argus-ai/data';
            const files = await fs.readdir(dataDir);
            const rotatedFiles = files
              .filter(f => f.startsWith('pool-events.jsonl.'))
              .sort()
              .reverse();
            for (const old of rotatedFiles.slice(3)) {
              await fs.unlink(`${dataDir}/${old}`).catch(() => {});
            }
            console.log(`[AlertManager] Rotated pool-events.jsonl (was ${Math.round(stat.size / 1024)}KB)`);
          }
        } catch {
          // File doesn't exist yet, that's fine
        }
      }

      const entry = JSON.stringify({
        token: event.baseMint,
        dex: event.dex,
        poolAddress: event.poolAddress,
        type: event.type || 'new_pool',
        timestamp: Date.now(),
        slot: event.slot,
        // Token metadata from Yellowstone Metaplex stream (NO RPC!)
        tokenName: event.tokenName || null,
        tokenSymbol: event.tokenSymbol || null,
        // Enriched data from Yellowstone - no RPC needed!
        liquiditySol: event.enrichedData?.liquiditySol,
        tokenSupply: event.enrichedData?.tokenSupply,
        realSolReserves: event.enrichedData?.realSolReserves,
        realTokenReserves: event.enrichedData?.realTokenReserves,
        complete: event.enrichedData?.complete,
        // Graduation data
        graduatedFrom: event.graduatedFrom,
        bondingCurveTime: event.bondingCurveTime,
      }) + '\n';

      await fs.appendFile(AlertManager.POOL_EVENTS_FILE, entry);
    } catch (err) {
      console.error('[AlertManager] File write error:', err);
    }
  }

  /**
   * Send graduation event to Workers API + local file
   * Higher severity - these are tradeable tokens
   */
  async alertGraduation(event: PoolEvent): Promise<void> {
    // ALWAYS write to local file for agents
    await this.writePoolEventToFile(event);

    if (!this.config.workersApiUrl) return;

    try {
      const bondingMinutes = event.bondingCurveTime
        ? Math.round(event.bondingCurveTime / 1000 / 60)
        : 0;

      // Generate natural dialogue via LLM
      const message = await this.generateLLMDialogue('scout', 'graduation', {
        token: event.baseMint?.slice(0, 8),
        symbol: event.tokenSymbol,
        dex: event.dex,
        bondingMinutes,
        graduatedFrom: event.graduatedFrom,
      });

      const response = await fetch(`${this.config.workersApiUrl}/agents/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'monitor_alert',
          alert: {
            agent: 'SCOUT',
            type: 'graduation',
            message,
            severity: 'warning', // Higher visibility for graduations
            data: {
              mint: event.baseMint,
              dex: event.dex,
              poolAddress: event.poolAddress,
              graduatedFrom: event.graduatedFrom,
              bondingCurveTime: event.bondingCurveTime,
            },
          },
        }),
      });

      if (!response.ok) {
        console.error(`[AlertManager] Graduation API error: ${response.status}`);
      }
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Create alert from new pool detection
   */
  async alertNewPool(event: PoolEvent, analysis: QuickAnalysis | null): Promise<void> {
    const alert: Alert = {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'new_pool',
      severity: 'info',
      title: 'New Pool Detected',
      message: `New ${event.dex} pool: ${event.baseMint?.slice(0, 8)}...`,
      data: {
        mint: event.baseMint,
        dex: event.dex,
        poolAddress: event.poolAddress,
      },
    };

    // Note: In detection-only mode, analysis is always null
    // Analysis-based severity upgrades would go here if analysis were enabled

    await this.sendAlert(alert);
  }

  /**
   * Create alert for known scammer detection
   */
  async alertKnownScammer(
    mint: string,
    scammerWallet: string,
    rugCount: number,
    lastRug?: string
  ): Promise<void> {
    const alert: Alert = {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'known_scammer',
      severity: 'critical',
      title: 'KNOWN SCAMMER DETECTED',
      message: `Token ${mint.slice(0, 8)}... created by known scammer (${rugCount} rugs)`,
      data: {
        mint,
        scammerInfo: {
          wallet: scammerWallet,
          rugCount,
          lastRug,
        },
      },
    };

    await this.sendAlert(alert);
  }

  /**
   * Create high-risk alert (from deeper analysis)
   */
  async alertHighRisk(
    mint: string,
    score: number,
    reasons: string[]
  ): Promise<void> {
    const alert: Alert = {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'high_risk',
      severity: 'critical',
      title: 'HIGH RISK TOKEN',
      message: `${mint.slice(0, 8)}... - Risk Score: ${score}`,
      data: {
        mint,
        suspicionScore: score,
        reasons,
      },
    };

    await this.sendAlert(alert);
  }

  /**
   * Send alert to all configured destinations
   */
  private async sendAlert(alert: Alert): Promise<void> {
    this.alertCount++;

    // Console logging
    if (this.config.enableConsoleAlerts) {
      this.logToConsole(alert);
    }

    // Workers API
    if (this.config.workersApiUrl) {
      await this.sendToWorkersApi(alert);
    }

    // Telegram (only for warning+ by default)
    if (this.config.telegramBotToken && this.shouldSendToTelegram(alert)) {
      await this.sendToTelegram(alert);
    }
  }

  /**
   * Log alert to console with formatting
   */
  private logToConsole(alert: Alert): void {
    const severityColors = {
      info: '\x1b[36m',     // Cyan
      warning: '\x1b[33m',  // Yellow
      critical: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';

    const color = severityColors[alert.severity];
    const timestamp = new Date(alert.timestamp).toISOString().slice(11, 19);

    console.log(`${color}[${timestamp}] [${alert.severity.toUpperCase()}] ${alert.title}${reset}`);
    console.log(`  ${alert.message}`);

    if (alert.data.reasons && alert.data.reasons.length > 0) {
      console.log(`  Reasons:`);
      alert.data.reasons.forEach(r => console.log(`    - ${r}`));
    }

    if (alert.data.scammerInfo) {
      console.log(`  Scammer: ${alert.data.scammerInfo.wallet.slice(0, 8)}...`);
      console.log(`  Rug count: ${alert.data.scammerInfo.rugCount}`);
    }
  }

  /**
   * Send alert to Workers API as agent event
   */
  private async sendToWorkersApi(alert: Alert): Promise<void> {
    try {
      const response = await fetch(`${this.config.workersApiUrl}/agents/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'monitor_alert',
          alert: {
            agent: alert.type === 'new_pool' ? 'SCOUT' : 'HUNTER',
            type: alert.type === 'known_scammer' ? 'alert' : 'discovery',
            message: alert.title,
            severity: alert.severity,
            data: alert.data,
          },
        }),
      });

      if (!response.ok) {
        console.error(`[AlertManager] Workers API error: ${response.status}`);
      }
    } catch (error) {
      console.error('[AlertManager] Failed to send to Workers API:', error);
    }
  }

  /**
   * Check if alert should be sent to Telegram
   */
  private shouldSendToTelegram(alert: Alert): boolean {
    const severityOrder = { info: 0, warning: 1, critical: 2 };
    const minSeverity = this.config.minSeverityForTelegram || 'warning';

    return severityOrder[alert.severity] >= severityOrder[minSeverity];
  }

  /**
   * Send alert to Telegram channel
   */
  private async sendToTelegram(alert: Alert): Promise<void> {
    if (!this.config.telegramBotToken || !this.config.telegramChannelId) {
      return;
    }

    try {
      // Format message for Telegram
      const emoji = {
        info: 'ℹ️',
        warning: '⚠️',
        critical: '🚨',
      };

      let text = `${emoji[alert.severity]} <b>${this.escapeHtml(alert.title)}</b>\n\n`;
      text += `${this.escapeHtml(alert.message)}\n`;

      if (alert.data.mint) {
        text += `\n<code>${alert.data.mint}</code>`;
      }

      if (alert.data.reasons && alert.data.reasons.length > 0) {
        text += '\n\n<b>Reasons:</b>';
        alert.data.reasons.forEach(r => {
          text += `\n• ${this.escapeHtml(r)}`;
        });
      }

      if (alert.data.scammerInfo) {
        text += '\n\n<b>Known Scammer:</b>';
        text += `\n• Wallet: <code>${alert.data.scammerInfo.wallet}</code>`;
        text += `\n• Rug count: ${alert.data.scammerInfo.rugCount}`;
      }

      // Add view link
      if (alert.data.mint) {
        text += `\n\n<a href="https://app.argusguard.io/?token=${alert.data.mint}">View in Argus</a>`;
      }

      const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.telegramChannelId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
    } catch (error) {
      console.error('[AlertManager] Telegram error:', error);
    }
  }

  /**
   * Escape HTML special characters for Telegram
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Get alert statistics
   */
  getStats(): { totalAlerts: number } {
    return { totalAlerts: this.alertCount };
  }
}
