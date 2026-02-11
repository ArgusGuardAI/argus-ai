/**
 * WorkersSync - Syncs agent events to Cloudflare Workers
 *
 * Pushes real-time agent activity to the dashboard via the Workers API.
 * Events are stored in Cloudflare KV and displayed in the Agent Comms panel.
 */

import { MessageBus } from '../core/MessageBus';
import { LLMService } from './LLMService';

export interface WorkersSyncConfig {
  workersUrl: string;
  apiSecret?: string;
  enabled?: boolean;
  batchSize?: number;
  flushInterval?: number;
  llm?: LLMService;
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
  private config: Omit<Required<WorkersSyncConfig>, 'llm'>;
  private eventQueue: QueuedEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private messageBus: MessageBus | null = null;
  private llm: LLMService | null = null;

  constructor(config: WorkersSyncConfig) {
    this.config = {
      workersUrl: config.workersUrl,
      apiSecret: config.apiSecret || '',
      enabled: config.enabled ?? true,
      batchSize: config.batchSize || 10,
      flushInterval: config.flushInterval || 5000,
    };
    this.llm = config.llm || null;
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

    // Scout events — use LLM dialogue or agent-provided dialogue
    this.messageBus.subscribe('agent.scout-*.scan_result', async (msg) => {
      const flags = msg.data.flags || [];
      const score = msg.data.score || 0;
      const token = msg.data.token?.slice(0, 8) || 'unknown';
      const symbol = msg.data.symbol || token;

      // Use agent-provided dialogue, generate via LLM, or minimal fallback
      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'scout',
          event: 'scan_result',
          data: { token, symbol, score, flags },
        });
      }
      if (!message) {
        message = `Scanned ${symbol}. Risk score: ${score}/100.`;
      }

      this.queueEvent({
        agent: 'SCOUT',
        type: 'scan',
        message,
        severity: score >= 70 ? 'critical' : score >= 50 ? 'warning' : 'info',
        data: {
          tokenAddress: msg.data.token,
          score,
        },
        timestamp: Date.now(),
      });
    });

    // Scout to Analyst communication
    this.messageBus.subscribe('agent.analyst-*.investigate', async (msg) => {
      const token = msg.data.token?.slice(0, 8) || 'token';
      const symbol = msg.data.symbol || token;

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'scout',
          event: 'request_analysis',
          targetAgent: 'analyst',
          data: { token, symbol },
        });
      }
      if (!message) {
        message = `→ ANALYST: Flagged ${symbol} for deep analysis.`;
      }

      this.queueEvent({
        agent: 'SCOUT',
        type: 'comms',
        message,
        severity: 'info',
        data: {
          tokenAddress: msg.data.token,
          targetAgent: 'ANALYST',
          requestType: 'analyze',
        },
        timestamp: Date.now(),
      });
    });

    // Analyst investigation complete — use LLM dialogue
    this.messageBus.subscribe('agent.coordinator.investigation_complete', async (msg) => {
      const score = msg.data.score || 0;
      const verdict = msg.data.verdict || 'UNKNOWN';
      const symbol = msg.data.symbol || msg.data.token?.slice(0, 8) || 'token';

      const targetAgent = score >= 60 ? 'hunter' : 'scout';
      const severity: 'critical' | 'warning' | 'info' = score >= 60 ? 'critical' : score >= 40 ? 'warning' : 'info';
      const requestType = score >= 60 ? 'investigate' : score >= 40 ? 'flag' : 'cleared';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'analyst',
          event: 'investigation_complete',
          targetAgent,
          data: { symbol, score, verdict },
        });
      }
      if (!message) {
        message = score >= 60
          ? `→ HUNTER: ${verdict} on ${symbol} (${score}/100). Needs wallet tracking.`
          : score >= 40
            ? `→ SCOUT: ${symbol} shows moderate risk (${score}/100). Adding to watchlist.`
            : `→ SCOUT: ${symbol} analysis complete (${score}/100). Appears clean.`;
      }

      this.queueEvent({
        agent: 'ANALYST',
        type: 'comms',
        message,
        severity,
        data: {
          tokenAddress: msg.data.token,
          score,
          targetAgent: targetAgent.toUpperCase(),
          requestType,
        },
        timestamp: Date.now(),
      });
    });

    // Hunter tracking scammer
    this.messageBus.subscribe('agent.hunter-*.track_scammer', async (msg) => {
      const token = msg.data.token?.slice(0, 8) || 'token';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'hunter',
          event: 'track_scammer',
          targetAgent: 'analyst',
          data: { token },
        });
      }
      if (!message) {
        message = `→ ANALYST: Tracking wallets on ${token}. Will report findings.`;
      }

      this.queueEvent({
        agent: 'HUNTER',
        type: 'comms',
        message,
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
    this.messageBus.subscribe('alert.bundle_detected', async (msg) => {
      const bundleCount = msg.data.bundleCount || 0;
      const token = msg.data.token?.slice(0, 8) || 'token';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'hunter',
          event: 'bundle_detected',
          targetAgent: 'analyst',
          data: { bundleCount, token },
        });
      }
      if (!message) {
        message = `→ ANALYST: Bundle detected — ${bundleCount} coordinated wallets on ${token}.`;
      }

      this.queueEvent({
        agent: 'HUNTER',
        type: 'comms',
        message,
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
    this.messageBus.subscribe('alert.scammer', async (msg) => {
      const wallet = msg.data.wallet?.slice(0, 8) || 'wallet';
      const pattern = msg.data.pattern || 'UNKNOWN';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'hunter',
          event: 'scammer_alert',
          data: { wallet, pattern },
        });
      }
      if (!message) {
        message = `SCAMMER ALERT: ${wallet}... shows ${pattern} pattern. Flagged.`;
      }

      this.queueEvent({
        agent: 'HUNTER',
        type: 'alert',
        message,
        severity: 'critical',
        data: {
          walletAddress: msg.data.wallet,
          requestType: 'scammer_detected',
        },
        timestamp: Date.now(),
      });
    });

    // Investigation results with AI-generated dialogue
    this.messageBus.subscribe('agent.analyst-*.investigation_complete', async (msg) => {
      const symbol = msg.data.symbol || msg.data.token?.slice(0, 8) || 'token';
      const score = msg.data.score || 0;
      const verdict = msg.data.verdict || 'UNKNOWN';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'analyst',
          event: 'analysis_complete',
          data: { symbol, score, verdict },
        });
      }
      if (!message) {
        message = `${symbol} analysis: ${verdict} (${score}/100).`;
      }

      this.queueEvent({
        agent: 'ANALYST',
        type: 'analysis',
        message,
        severity: score >= 70 ? 'critical' : score >= 50 ? 'warning' : 'info',
        data: {
          tokenAddress: msg.data.token,
          tokenSymbol: msg.data.symbol,
          score,
        },
        timestamp: Date.now(),
      });
    });

    // High risk alerts with AI-generated dialogue
    this.messageBus.subscribe('alert.high_risk_token', async (msg) => {
      const symbol = msg.data.symbol || msg.data.token?.slice(0, 8) || 'token';
      const score = msg.data.score || 0;

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'analyst',
          event: 'high_risk_alert',
          targetAgent: 'hunter',
          data: { symbol, score },
        });
      }
      if (!message) {
        message = `→ HUNTER: ${symbol} is high risk (${score}/100). Track creator.`;
      }

      this.queueEvent({
        agent: 'ANALYST',
        type: 'alert',
        message,
        severity: 'critical',
        data: {
          tokenAddress: msg.data.token,
          tokenSymbol: msg.data.symbol,
          score,
        },
        timestamp: Date.now(),
      });
    });

    // Trade execution (legacy) — use LLM
    this.messageBus.subscribe('agent.trader-*.trade_executed', async (msg) => {
      const token = msg.data.token?.slice(0, 8) || 'token';
      const tradeType = msg.data.type?.toUpperCase() || 'TRADE';
      const amount = msg.data.amount || 0;

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'trader',
          event: 'trade_executed',
          data: { token, tradeType, amount },
        });
      }
      if (!message) {
        message = `${tradeType}: ${amount} SOL on ${token}.`;
      }

      this.queueEvent({
        agent: 'TRADER',
        type: 'trade',
        message,
        severity: 'info',
        data: {
          tokenAddress: msg.data.token,
        },
        timestamp: Date.now(),
      });
    });

    // Position opened (Trader bought) with AI-generated dialogue
    this.messageBus.subscribe('agent.trader-*.position_opened', async (msg) => {
      const symbol = msg.data.symbol || msg.data.token?.slice(0, 8) || 'token';
      const solInvested = msg.data.solInvested || 0;
      const strategy = msg.data.strategy || 'default';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'trader',
          event: 'position_opened',
          data: { symbol, solInvested, strategy },
        });
      }
      if (!message) {
        message = `Entered ${symbol} — ${solInvested.toFixed(3)} SOL (${strategy}).`;
      }

      this.queueEvent({
        agent: 'TRADER',
        type: 'trade',
        message,
        severity: 'info',
        data: {
          tokenAddress: msg.data.token,
          tokenSymbol: symbol,
        },
        timestamp: Date.now(),
      });
    });

    // Position closed (Trader sold) with AI-generated dialogue
    this.messageBus.subscribe('agent.trader-*.position_closed', async (msg) => {
      const pnl = msg.data.pnl || 0;
      const reason = msg.data.reason || 'manual';
      const severity: 'info' | 'warning' = pnl >= 0 ? 'info' : 'warning';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'trader',
          event: 'position_closed',
          data: { pnl, reason },
        });
      }
      if (!message) {
        message = `Closed: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${reason}).`;
      }

      this.queueEvent({
        agent: 'TRADER',
        type: 'trade',
        message,
        severity,
        data: {
          tokenAddress: msg.data.token,
        },
        timestamp: Date.now(),
      });
    });

    // Hunter scammer detected with AI-generated dialogue
    this.messageBus.subscribe('agent.hunter-*.scammer_detected', async (msg) => {
      const wallet = msg.data.wallet?.slice(0, 8) || 'wallet';
      const pattern = msg.data.pattern || 'UNKNOWN';
      const rugCount = msg.data.rugCount || 0;
      const isRepeat = msg.data.isRepeat || false;

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'hunter',
          event: 'scammer_detected',
          data: { wallet, pattern, rugCount, isRepeat },
        });
      }
      if (!message) {
        message = isRepeat
          ? `REPEAT SCAMMER: ${wallet}... (${pattern}) — ${rugCount} rugs.`
          : `NEW SCAMMER: ${wallet}... shows ${pattern} pattern.`;
      }

      this.queueEvent({
        agent: 'HUNTER',
        type: 'alert',
        message,
        severity: 'critical',
        data: {
          walletAddress: msg.data.wallet,
        },
        timestamp: Date.now(),
      });
    });

    // Hunter profile created with AI-generated dialogue
    this.messageBus.subscribe('agent.hunter-*.profile_created', async (msg) => {
      const wallet = msg.data.wallet?.slice(0, 8) || 'wallet';
      const pattern = msg.data.pattern || 'UNKNOWN';
      const confidence = msg.data.confidence || 0;

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'hunter',
          event: 'profile_created',
          data: { wallet, pattern, confidence },
        });
      }
      if (!message) {
        message = `Profiled ${wallet}... as ${pattern} (${confidence}% confidence).`;
      }

      this.queueEvent({
        agent: 'HUNTER',
        type: 'comms',
        message,
        severity: 'warning',
        data: {
          walletAddress: msg.data.wallet,
        },
        timestamp: Date.now(),
      });
    });

    // Discovery results — full investigation data for dashboard
    this.messageBus.subscribe('discovery.new', (msg) => {
      this.pushDiscovery(msg.data);
    });

    // User alerts (broadcast to dashboard)
    this.messageBus.subscribe('user.alert', async (msg) => {
      const title = msg.data.title || 'Alert';
      const alertMessage = msg.data.message || '';
      const agent = msg.data.agent || 'SYSTEM';

      let message = msg.data.dialogue;
      if (!message && this.llm) {
        message = await this.llm.generateDialogue({
          agent: agent.toLowerCase() as 'scout' | 'analyst' | 'hunter' | 'trader',
          event: 'user_alert',
          data: { title, message: alertMessage },
        });
      }
      if (!message) {
        message = `${title}: ${alertMessage}`;
      }

      this.queueEvent({
        agent,
        type: 'alert',
        message,
        severity: msg.data.severity === 'CRITICAL' ? 'critical' :
                 msg.data.severity === 'WARNING' ? 'warning' : 'info',
        data: {},
        timestamp: Date.now(),
      });
    });

    // Multi-agent debate results (autonomous reasoning)
    this.messageBus.subscribe('debate.result', async (msg) => {
      const decision = msg.data.decision || 'UNKNOWN';
      const confidence = Math.round((msg.data.confidence || 0) * 100);
      const action = msg.data.proposal?.action || 'action';
      const target = msg.data.proposal?.target?.slice(0, 8) || 'target';
      const proposer = msg.data.proposal?.agent?.toUpperCase() || 'AGENT';
      const reasoning = msg.data.consensusReasoning || '';

      // Build vote summary
      const votes = msg.data.votes || [];
      const yesVotes = votes.filter((v: any) => v.decision === 'YES').map((v: any) => v.agent);
      const noVotes = votes.filter((v: any) => v.decision === 'NO').map((v: any) => v.agent);

      let message: string | null = null;
      if (this.llm) {
        message = await this.llm.generateDialogue({
          agent: 'analyst',
          event: 'debate_result',
          data: { decision, confidence, action, target, yesVotes, noVotes },
        });
      }
      if (!message) {
        const voteStr = yesVotes.length > 0 || noVotes.length > 0
          ? ` [${yesVotes.join(', ')} YES | ${noVotes.join(', ')} NO]`
          : '';
        message = `DEBATE: ${action} on ${target}... ${decision} (${confidence}%)${voteStr}`;
      }

      this.queueEvent({
        agent: 'SWARM',
        type: 'comms',
        message,
        severity: decision === 'APPROVED' ? 'info' : 'warning',
        data: {
          tokenAddress: msg.data.proposal?.target,
          targetAgent: proposer,
          requestType: 'debate_result',
        },
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
   * Push a full discovery result to the Workers API (separate from event queue)
   */
  private async pushDiscovery(discovery: any): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const response = await fetch(`${this.config.workersUrl}/agents/discovery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiSecret && {
            'Authorization': `Bearer ${this.config.apiSecret}`
          }),
        },
        body: JSON.stringify(discovery),
      });

      if (!response.ok) {
        console.warn(`[WorkersSync] Failed to push discovery: ${response.status}`);
      } else {
        console.log(`[WorkersSync] Discovery pushed: ${discovery.token?.slice(0, 8)}... (${discovery.analysis?.verdict})`);
      }
    } catch (error) {
      console.warn('[WorkersSync] Discovery push error:', error);
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
