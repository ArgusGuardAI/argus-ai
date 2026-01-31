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
}

/**
 * AlertManager - Unified alert distribution
 */
export class AlertManager {
  private config: AlertManagerConfig;
  private alertCount = 0;

  constructor(config: AlertManagerConfig) {
    this.config = {
      enableConsoleAlerts: true,
      minSeverityForTelegram: 'warning',
      ...config,
    };

    console.log('[AlertManager] Initialized');
    if (config.workersApiUrl) {
      console.log(`[AlertManager] Workers API: ${config.workersApiUrl}`);
    }
    if (config.telegramBotToken) {
      console.log('[AlertManager] Telegram: enabled');
    }
  }

  /**
   * Generate unique alert ID
   */
  private generateId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Send pool discovery event to Workers API (for ALL pools)
   * This feeds the dashboard activity feed with live pool discoveries
   * Detection only - no analysis data
   */
  async alertPoolDiscovered(event: PoolEvent, _analysis: QuickAnalysis | null): Promise<void> {
    // Only send to Workers API if configured
    if (!this.config.workersApiUrl) return;

    try {
      // Check if this is a graduation event
      if (event.type === 'graduation') {
        await this.alertGraduation(event);
        return;
      }

      const isPumpFun = event.dex === 'PUMP_FUN';

      const message = isPumpFun
        ? `New pump.fun token: ${event.baseMint?.slice(0, 8)}...`
        : `New ${event.dex} pool: ${event.baseMint?.slice(0, 8)}...`;

      const response = await fetch(`${this.config.workersApiUrl}/agents/command`, {
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
      });

      if (!response.ok) {
        console.error(`[AlertManager] Pool discovery API error: ${response.status}`);
      }
    } catch (error) {
      // Silently fail - don't block monitoring for API errors
    }
  }

  /**
   * Send graduation event to Workers API
   * Higher severity - these are tradeable tokens
   */
  async alertGraduation(event: PoolEvent): Promise<void> {
    if (!this.config.workersApiUrl) return;

    try {
      const bondingMinutes = event.bondingCurveTime
        ? Math.round(event.bondingCurveTime / 1000 / 60)
        : 0;

      const message = `🎓 Graduated: ${event.baseMint?.slice(0, 8)}... (${bondingMinutes}min on curve)`;

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
