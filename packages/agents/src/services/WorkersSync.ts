/**
 * WorkersSync - Syncs agent events to Cloudflare Workers
 *
 * Pushes real-time agent activity to the dashboard via the Workers API.
 * Events are stored in Cloudflare KV and displayed in the Agent Comms panel.
 */

import { MessageBus } from '../core/MessageBus';

export interface WorkersSyncConfig {
  workersUrl: string;
  apiSecret?: string;
  enabled?: boolean;
  batchSize?: number;
  flushInterval?: number;
}

interface QueuedEvent {
  agent: string;
  type: 'scan' | 'alert' | 'analysis' | 'trade' | 'discovery' | 'graduation' | 'comms';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  data?: {
    tokenAddress?: string;
    tokenSymbol?: string;
    score?: number;
    walletAddress?: string;
    bundleCount?: number;
    targetAgent?: string;
    requestType?: string;
  };
  timestamp: number;
}

export class WorkersSync {
  private config: Required<WorkersSyncConfig>;
  private eventQueue: QueuedEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private messageBus: MessageBus | null = null;

  constructor(config: WorkersSyncConfig) {
    this.config = {
      workersUrl: config.workersUrl,
      apiSecret: config.apiSecret || '',
      enabled: config.enabled ?? true,
      batchSize: config.batchSize || 10,
      flushInterval: config.flushInterval || 5000,
    };
  }

  /**
   * Connect to message bus and start syncing
   */
  connect(messageBus: MessageBus): void {
    if (!this.config.enabled) {
      console.log('[WorkersSync] Sync disabled');
      return;
    }

    this.messageBus = messageBus;
    this.setupSubscriptions();
    this.startFlushTimer();

    console.log(`[WorkersSync] Connected to ${this.config.workersUrl}`);
  }

  /**
   * Subscribe to agent messages
   */
  private setupSubscriptions(): void {
    if (!this.messageBus) return;

    // Scout events
    this.messageBus.subscribe('agent.scout-*.scan_result', (msg) => {
      this.queueEvent({
        agent: 'SCOUT',
        type: 'scan',
        message: `Scanned ${msg.data.token?.slice(0, 8)}... score=${msg.data.score}`,
        severity: msg.data.score >= 70 ? 'critical' : msg.data.score >= 50 ? 'warning' : 'info',
        data: {
          tokenAddress: msg.data.token,
          score: msg.data.score,
        },
        timestamp: Date.now(),
      });
    });

    // Scout to Analyst communication
    this.messageBus.subscribe('agent.analyst-*.investigate', (msg) => {
      this.queueEvent({
        agent: 'SCOUT',
        type: 'comms',
        message: `→ ANALYST: New token detected, requesting analysis`,
        severity: 'info',
        data: {
          tokenAddress: msg.data.token,
          targetAgent: 'ANALYST',
          requestType: 'analyze',
        },
        timestamp: Date.now(),
      });
    });

    // Analyst investigation complete
    this.messageBus.subscribe('agent.coordinator.investigation_complete', (msg) => {
      const score = msg.data.score || 0;
      const verdict = msg.data.verdict || 'UNKNOWN';

      if (score >= 60) {
        this.queueEvent({
          agent: 'ANALYST',
          type: 'comms',
          message: `→ HUNTER: ${verdict} risk (${score}/100), requesting wallet investigation`,
          severity: 'critical',
          data: {
            tokenAddress: msg.data.token,
            score,
            targetAgent: 'HUNTER',
            requestType: 'investigate',
          },
          timestamp: Date.now(),
        });
      } else if (score >= 40) {
        this.queueEvent({
          agent: 'ANALYST',
          type: 'comms',
          message: `→ SCOUT: Moderate risk (${score}/100), flagging for watchlist`,
          severity: 'warning',
          data: {
            tokenAddress: msg.data.token,
            score,
            targetAgent: 'SCOUT',
            requestType: 'flag',
          },
          timestamp: Date.now(),
        });
      } else {
        this.queueEvent({
          agent: 'ANALYST',
          type: 'comms',
          message: `→ SCOUT: Analysis complete (${score}/100), token appears safe`,
          severity: 'info',
          data: {
            tokenAddress: msg.data.token,
            score,
            targetAgent: 'SCOUT',
            requestType: 'cleared',
          },
          timestamp: Date.now(),
        });
      }
    });

    // Hunter tracking scammer
    this.messageBus.subscribe('agent.hunter-*.track_scammer', (msg) => {
      this.queueEvent({
        agent: 'HUNTER',
        type: 'comms',
        message: `→ ANALYST: Acknowledged, tracking suspicious wallets on ${msg.data.token?.slice(0, 8)}...`,
        severity: 'warning',
        data: {
          tokenAddress: msg.data.token,
          targetAgent: 'ANALYST',
          requestType: 'tracking_started',
        },
        timestamp: Date.now(),
      });
    });

    // Bundle detection
    this.messageBus.subscribe('alert.bundle_detected', (msg) => {
      this.queueEvent({
        agent: 'HUNTER',
        type: 'comms',
        message: `→ ANALYST: Found ${msg.data.bundleCount} coordinated wallets`,
        severity: 'warning',
        data: {
          tokenAddress: msg.data.token,
          bundleCount: msg.data.bundleCount,
          targetAgent: 'ANALYST',
          requestType: 'bundle_report',
        },
        timestamp: Date.now(),
      });
    });

    // Scammer alerts
    this.messageBus.subscribe('alert.scammer', (msg) => {
      this.queueEvent({
        agent: 'HUNTER',
        type: 'comms',
        message: `→ ALL: SYNDICATE ALERT - Known scammer detected`,
        severity: 'critical',
        data: {
          walletAddress: msg.data.wallet,
          requestType: 'syndicate_alert',
        },
        timestamp: Date.now(),
      });

      // Trader response
      this.queueEvent({
        agent: 'TRADER',
        type: 'comms',
        message: `→ HUNTER: Acknowledged, blocking all trade routes`,
        severity: 'critical',
        data: {
          targetAgent: 'HUNTER',
          requestType: 'blacklist',
        },
        timestamp: Date.now(),
      });
    });

    // High risk alerts
    this.messageBus.subscribe('alert.high_risk_token', (msg) => {
      this.queueEvent({
        agent: 'ANALYST',
        type: 'alert',
        message: `HIGH RISK: ${msg.data.token?.slice(0, 8)}... score=${msg.data.score}`,
        severity: 'critical',
        data: {
          tokenAddress: msg.data.token,
          score: msg.data.score,
        },
        timestamp: Date.now(),
      });
    });

    // Trade execution
    this.messageBus.subscribe('agent.trader-*.trade_executed', (msg) => {
      this.queueEvent({
        agent: 'TRADER',
        type: 'trade',
        message: `${msg.data.type.toUpperCase()}: ${msg.data.amount} SOL on ${msg.data.token?.slice(0, 8)}...`,
        severity: 'info',
        data: {
          tokenAddress: msg.data.token,
        },
        timestamp: Date.now(),
      });
    });

    // User alerts (broadcast to dashboard)
    this.messageBus.subscribe('user.alert', (msg) => {
      this.queueEvent({
        agent: msg.data.agent || 'SYSTEM',
        type: 'alert',
        message: `${msg.data.title}: ${msg.data.message}`,
        severity: msg.data.severity === 'CRITICAL' ? 'critical' :
                 msg.data.severity === 'WARNING' ? 'warning' : 'info',
        data: {},
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Queue an event for sync
   */
  private queueEvent(event: QueuedEvent): void {
    this.eventQueue.push(event);

    // Flush immediately if batch size reached
    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  /**
   * Flush queued events to Workers
   */
  private async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // Send each event (could batch in future)
    for (const event of events) {
      try {
        const response = await fetch(`${this.config.workersUrl}/agents/command`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiSecret && {
              'Authorization': `Bearer ${this.config.apiSecret}`
            }),
          },
          body: JSON.stringify({
            type: 'monitor_alert',
            alert: {
              agent: event.agent,
              type: event.type,
              message: event.message,
              severity: event.severity,
              data: {
                mint: event.data?.tokenAddress,
                suspicionScore: event.data?.score,
                targetAgent: event.data?.targetAgent,
                requestType: event.data?.requestType,
              },
            },
          }),
        });

        if (!response.ok) {
          console.warn(`[WorkersSync] Failed to sync event: ${response.status}`);
        }
      } catch (error) {
        console.warn('[WorkersSync] Sync error:', error);
      }
    }
  }

  /**
   * Manually push an event
   */
  async pushEvent(event: QueuedEvent): Promise<void> {
    if (!this.config.enabled) return;
    this.queueEvent(event);
  }

  /**
   * Stop syncing
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    if (this.eventQueue.length > 0) {
      this.flush();
    }

    console.log('[WorkersSync] Stopped');
  }
}
