/**
 * AgentCoordinator - Orchestrates All AI Agents
 *
 * Responsibilities:
 * - Initialize and manage agent lifecycle
 * - Route messages between agents
 * - Handle system-wide events
 * - Monitor agent health and performance
 * - Provide unified API for external systems
 */

import { MessageBus } from './MessageBus';
import { ScoutAgent } from '../agents/ScoutAgent';
import { AnalystAgent } from '../agents/AnalystAgent';
import { HunterAgent } from '../agents/HunterAgent';
import { TraderAgent } from '../agents/TraderAgent';
import { BaseAgent } from './BaseAgent';
import { WorkersSync, WorkersSyncConfig } from '../services/WorkersSync';
import { OutcomeLearner } from '../learning/OutcomeLearner';
import { PatternLibrary } from '../learning/PatternLibrary';
import { PositionStore } from '../services/PositionStore';
import { DebateProtocol, Proposal, DebateResult, createProposalId, shouldDebate } from '../reasoning/DebateProtocol';
import { getGoalTracker, GoalTracker } from './AgentGoals';
import type { Database } from '../services/Database';
import type { LLMService } from '../services/LLMService';

export interface CoordinatorConfig {
  rpcEndpoint: string;
  scouts?: number;
  analysts?: number;
  hunters?: number;
  traders?: number;
  enableTrading?: boolean;
  maxDailyTrades?: number;
  maxPositionSize?: number;
  // Workers sync for dashboard
  workersUrl?: string;
  workersApiSecret?: string;
  enableWorkersSync?: boolean;
  // Database persistence
  database?: Database;
  // LLM service for real AI reasoning
  llm?: LLMService;
}

export interface SystemStatus {
  running: boolean;
  uptime: number;
  agents: {
    scouts: number;
    analysts: number;
    hunters: number;
    traders: number;
    total: number;
  };
  stats: {
    tokensScanned: number;
    investigationsCompleted: number;
    scammersTracked: number;
    tradesExecuted: number;
    totalPnl: number;
  };
  health: {
    healthy: boolean;
    issues: string[];
  };
}

export class AgentCoordinator {
  private messageBus: MessageBus;
  private config: CoordinatorConfig;
  private running: boolean = false;
  private startTime: number = 0;
  private workersSync: WorkersSync | null = null;
  private database: Database | undefined;
  private llm: LLMService | undefined;
  private outcomeLearner: OutcomeLearner;
  private patternLibrary: PatternLibrary;
  private positionStore: PositionStore | null = null;
  private outcomeCheckTimer: NodeJS.Timeout | null = null;

  // Autonomous reasoning components
  private debateProtocol: DebateProtocol | null = null;
  private goalTracker: GoalTracker;

  // Agent pools
  private scouts: ScoutAgent[] = [];
  private analysts: AnalystAgent[] = [];
  private hunters: HunterAgent[] = [];
  private traders: TraderAgent[] = [];

  // System stats
  private stats = {
    tokensScanned: 0,
    investigationsCompleted: 0,
    scammersTracked: 0,
    tradesExecuted: 0,
    totalPnl: 0
  };

  constructor(config: CoordinatorConfig) {
    this.config = {
      scouts: 2,
      analysts: 1,
      hunters: 1,
      traders: 1,
      enableTrading: false,
      maxDailyTrades: 10,
      maxPositionSize: 0.1,
      enableWorkersSync: true,
      ...config
    };

    this.messageBus = new MessageBus();
    this.database = config.database;
    this.llm = config.llm;
    this.outcomeLearner = new OutcomeLearner();
    this.patternLibrary = new PatternLibrary();
    this.goalTracker = getGoalTracker();

    // Initialize debate protocol if LLM is available
    if (this.llm) {
      this.debateProtocol = new DebateProtocol(this.llm, this.messageBus);
      console.log('[Coordinator] DebateProtocol enabled (LLM available)');
    }

    // Wire database to learning components
    if (this.database) {
      this.outcomeLearner.setDatabase(this.database);
      this.patternLibrary.setDatabase(this.database);
      // Initialize position store for trading persistence
      this.positionStore = new PositionStore(this.database);
    }

    // Wire LLM to outcome learner for intelligent weight updates
    if (this.llm) {
      this.outcomeLearner.setLLM(this.llm);
    }

    this.setupSystemHandlers();

    // Initialize Workers sync if configured
    if (this.config.enableWorkersSync && this.config.workersUrl) {
      this.workersSync = new WorkersSync({
        workersUrl: this.config.workersUrl,
        apiSecret: this.config.workersApiSecret,
        enabled: true,
        llm: this.llm, // Pass LLM for natural dialogue generation
      });
      console.log('[Coordinator] Workers sync configured');
    }
  }

  /**
   * Initialize all agents
   */
  async initialize(): Promise<void> {
    console.log('[Coordinator] Initializing Argus Agent Network...');

    // Create scout agents
    for (let i = 0; i < this.config.scouts!; i++) {
      const scout = new ScoutAgent(this.messageBus, {
        name: `scout-${i + 1}`,
        rpcEndpoint: this.config.rpcEndpoint,
        database: this.database,
      });
      await scout.initialize();
      this.scouts.push(scout);
    }
    console.log(`[Coordinator] ${this.scouts.length} Scout agents ready`);

    // Create analyst agents
    for (let i = 0; i < this.config.analysts!; i++) {
      const analyst = new AnalystAgent(this.messageBus, {
        name: `analyst-${i + 1}`,
        rpcEndpoint: this.config.rpcEndpoint,
        database: this.database,
        llm: this.llm,
      });
      await analyst.initialize();
      this.analysts.push(analyst);
    }
    console.log(`[Coordinator] ${this.analysts.length} Analyst agents ready`);

    // Create hunter agents
    for (let i = 0; i < this.config.hunters!; i++) {
      const hunter = new HunterAgent(this.messageBus, {
        name: `hunter-${i + 1}`,
        rpcEndpoint: this.config.rpcEndpoint,
        database: this.database,
        llm: this.llm,
      });
      await hunter.initialize();
      this.hunters.push(hunter);
    }
    console.log(`[Coordinator] ${this.hunters.length} Hunter agents ready`);

    // Create trader agents (only if trading enabled)
    if (this.config.enableTrading) {
      for (let i = 0; i < this.config.traders!; i++) {
        const trader = new TraderAgent(this.messageBus, {
          name: `trader-${i + 1}`,
          maxPositionSize: this.config.maxPositionSize!,
          maxDailyTrades: this.config.maxDailyTrades!,
          rpcEndpoint: this.config.rpcEndpoint,
          positionStore: this.positionStore || undefined,
          // Yellowstone price tracking callbacks will be wired in start.ts
          // when PoolMonitor is available
        });
        await trader.initialize();
        this.traders.push(trader);
      }
      console.log(`[Coordinator] ${this.traders.length} Trader agents ready`);
      if (this.positionStore) {
        const stats = await this.positionStore.getStats();
        console.log(`[Coordinator] Loaded ${stats.activeCount} active positions from database`);
      }
    } else {
      console.log('[Coordinator] Trading disabled');
    }

    // Load learning state from database
    if (this.database?.isReady()) {
      await this.outcomeLearner.loadFromDatabase();
      await this.patternLibrary.loadFromDatabase();
    }

    // Connect Workers sync to message bus
    if (this.workersSync) {
      this.workersSync.connect(this.messageBus);
      console.log('[Coordinator] Workers sync connected');
    }

    // Configure BitNet metrics reporting for all agents
    if (this.config.workersUrl) {
      const metricsUrl = `${this.config.workersUrl}/agents/bitnet`;
      for (const agent of this.getAllAgents()) {
        agent.setMetricsUrl(metricsUrl);
      }
      console.log(`[Coordinator] BitNet metrics reporting → ${metricsUrl}`);
    }

    console.log('[Coordinator] All agents initialized');
  }

  /**
   * Start all agents
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log('[Coordinator] Starting Argus Agent Network...');
    this.running = true;
    this.startTime = Date.now();

    // Start all agents
    const startPromises: Promise<void>[] = [];

    for (const scout of this.scouts) {
      startPromises.push(scout.start());
    }
    for (const analyst of this.analysts) {
      startPromises.push(analyst.start());
    }
    for (const hunter of this.hunters) {
      startPromises.push(hunter.start());
    }
    for (const trader of this.traders) {
      startPromises.push(trader.start());
    }

    await Promise.all(startPromises);

    // Start health monitoring
    this.startHealthMonitoring();

    // Start hourly outcome checking (for OutcomeLearner)
    this.startOutcomeChecking();

    console.log('[Coordinator] Argus Agent Network is LIVE');

    // Broadcast system start
    await this.messageBus.publish('system.started', {
      timestamp: Date.now(),
      agents: this.getAllAgents().length
    }, { from: 'coordinator' });
  }

  /**
   * Stop all agents
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('[Coordinator] Stopping Argus Agent Network...');

    // Broadcast shutdown warning
    await this.messageBus.publish('system.stopping', {
      timestamp: Date.now()
    }, { from: 'coordinator' });

    // Stop all agents
    const stopPromises: Promise<void>[] = [];

    for (const scout of this.scouts) {
      stopPromises.push(scout.stop());
    }
    for (const analyst of this.analysts) {
      stopPromises.push(analyst.stop());
    }
    for (const hunter of this.hunters) {
      stopPromises.push(hunter.stop());
    }
    for (const trader of this.traders) {
      stopPromises.push(trader.stop());
    }

    await Promise.all(stopPromises);

    // Stop outcome checking
    if (this.outcomeCheckTimer) {
      clearTimeout(this.outcomeCheckTimer);
      this.outcomeCheckTimer = null;
    }

    // Save learning state to database before shutdown
    if (this.database?.isReady()) {
      await this.outcomeLearner.saveToDatabase();
      await this.patternLibrary.saveToDatabase();
      console.log('[Coordinator] Learning state saved to database');
    }

    // Stop Workers sync
    if (this.workersSync) {
      this.workersSync.stop();
    }

    this.running = false;
    console.log('[Coordinator] All agents stopped');
  }

  /**
   * Request manual token analysis
   */
  async analyzeToken(tokenAddress: string, priority: 'low' | 'normal' | 'high' | 'critical' = 'high'): Promise<void> {
    console.log(`[Coordinator] Manual analysis requested: ${tokenAddress.slice(0, 8)}...`);

    // Send to first available analyst
    await this.messageBus.sendTo('analyst-1', 'investigate', {
      token: tokenAddress,
      score: 0,
      flags: [],
      features: [],
      priority,
      source: 'manual',
      timestamp: Date.now()
    }, 'coordinator');
  }

  /**
   * Check if wallet is known scammer
   */
  async checkWallet(walletAddress: string): Promise<any> {
    return new Promise((resolve) => {
      // Subscribe to response
      const unsubscribe = this.messageBus.subscribe('agent.hunter-1.wallet_check_result', (msg) => {
        unsubscribe();
        resolve(msg.data);
      });

      // Request check
      this.messageBus.sendTo('hunter-1', 'check_wallet', {
        wallet: walletAddress
      }, 'coordinator');

      // Timeout after 5 seconds
      setTimeout(() => {
        unsubscribe();
        resolve({ isRepeat: false, profile: null, rugCount: 0 });
      }, 5000);
    });
  }

  /**
   * Get system status
   */
  getStatus(): SystemStatus {
    const allAgents = this.getAllAgents();
    const healthIssues: string[] = [];

    // Check agent health
    for (const agent of allAgents) {
      const status = agent.getStatus();
      if (!status.running) {
        healthIssues.push(`${status.name} is not running`);
      }
    }

    // Get trader PnL
    let totalPnl = 0;
    for (const trader of this.traders) {
      const stats = trader.getStats();
      totalPnl += stats.totalPnl;
    }

    return {
      running: this.running,
      uptime: this.running ? Date.now() - this.startTime : 0,
      agents: {
        scouts: this.scouts.length,
        analysts: this.analysts.length,
        hunters: this.hunters.length,
        traders: this.traders.length,
        total: allAgents.length
      },
      stats: {
        ...this.stats,
        totalPnl
      },
      health: {
        healthy: healthIssues.length === 0,
        issues: healthIssues
      }
    };
  }

  /**
   * Get all agents
   */
  private getAllAgents(): BaseAgent[] {
    return [
      ...this.scouts,
      ...this.analysts,
      ...this.hunters,
      ...this.traders
    ];
  }

  /**
   * Setup system-wide message handlers
   */
  private setupSystemHandlers(): void {
    // Track scans
    this.messageBus.subscribe('agent.scout-*.scan_result', () => {
      this.stats.tokensScanned++;
    });

    // Track investigations
    this.messageBus.subscribe('agent.analyst-*.investigation_complete', () => {
      this.stats.investigationsCompleted++;
    });

    // Track scammers
    this.messageBus.subscribe('alert.scammer', () => {
      this.stats.scammersTracked++;
    });

    // Track trades
    this.messageBus.subscribe('agent.trader-*.trade_executed', () => {
      this.stats.tradesExecuted++;
    });

    // Handle user alerts
    this.messageBus.subscribe('user.alert', (msg) => {
      console.log(`[ALERT] ${msg.data.severity}: ${msg.data.title}`);
      console.log(`        ${msg.data.message}`);
      if (msg.data.action) {
        console.log(`        Action: ${msg.data.action}`);
      }
    });

    // Handle emergency events
    this.messageBus.subscribe('alert.emergency', async (msg) => {
      console.log(`[EMERGENCY] ${msg.data.reason}`);
      // Could trigger emergency shutdown or notifications here
    });

    // Handle debate requests (for multi-agent consensus on critical decisions)
    this.messageBus.subscribe('debate.request', async (msg) => {
      if (!this.debateProtocol) {
        console.log('[Coordinator] Debate requested but no LLM available - auto-approving');
        await this.messageBus.publish('debate.result', {
          proposal: msg.data,
          decision: 'APPROVED',
          confidence: 0.5,
          consensusReasoning: 'Auto-approved (no LLM for debate)',
          arguments: [],
          counters: [],
          votes: [],
        });
        return;
      }

      const proposal: Proposal = {
        id: createProposalId(),
        agent: msg.from || 'unknown',
        action: msg.data.action,
        target: msg.data.target,
        amount: msg.data.amount,
        reasoning: msg.data.reasoning,
        confidence: msg.data.confidence || 0.7,
        context: msg.data.context || {},
        timestamp: Date.now(),
      };

      console.log(`[Coordinator] Starting debate on ${proposal.action} for ${proposal.target.slice(0, 8)}...`);

      const result = await this.debateProtocol.debate(proposal);

      console.log(`[Coordinator] Debate concluded: ${result.decision} (${(result.confidence * 100).toFixed(0)}% confidence)`);

      // Result is auto-published by DebateProtocol
    });
  }

  /**
   * Start health monitoring loop
   */
  private startHealthMonitoring(): void {
    const healthCheck = async () => {
      if (!this.running) return;

      const status = this.getStatus();

      if (!status.health.healthy) {
        console.log('[Coordinator] Health issues detected:');
        for (const issue of status.health.issues) {
          console.log(`  - ${issue}`);
        }
      }

      // Schedule next check
      setTimeout(healthCheck, 60000); // Every minute
    };

    // Start first check after 30 seconds
    setTimeout(healthCheck, 30000);
  }

  /**
   * Start hourly outcome checking for OutcomeLearner
   * Checks DexScreener (free API) for token outcomes 24h+ after prediction
   */
  private startOutcomeChecking(): void {
    if (!this.database?.isReady()) {
      console.log('[Coordinator] No database — outcome checking disabled');
      return;
    }

    const checkOutcomes = async () => {
      if (!this.running) return;

      try {
        // Get predictions older than 24h that don't have outcomes yet
        const pending = await this.database!.getPendingPredictions(24 * 60 * 60 * 1000, 5);

        for (const prediction of pending) {
          try {
            // Check DexScreener (free, no rate limit)
            const response = await fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${prediction.token}`,
              { signal: AbortSignal.timeout(5000) }
            );

            if (!response.ok) continue;

            const data = await response.json() as { pairs?: Array<{ liquidity?: { usd: number }; priceChange?: { h24: number } }> };
            const pair = data.pairs?.[0];

            let outcome: string;
            if (!pair) {
              outcome = 'RUG'; // No pair data = token dead
            } else if ((pair.liquidity?.usd || 0) < 100) {
              outcome = 'RUG'; // Liquidity drained
            } else if ((pair.priceChange?.h24 || 0) < -80) {
              outcome = 'DUMP'; // Massive price drop
            } else if ((pair.priceChange?.h24 || 0) > 100) {
              outcome = 'MOON'; // Price way up
            } else {
              outcome = 'STABLE'; // Still alive
            }

            // Record outcome
            this.outcomeLearner.recordOutcome(prediction.id, {
              token: prediction.token,
              outcome: outcome as any,
              priceChange: pair?.priceChange?.h24 || -100,
              liquidityChange: 0,
              timeToOutcome: Date.now() - prediction.predicted_at.getTime(),
              details: `DexScreener check: liq=$${pair?.liquidity?.usd || 0}`,
            });

            // Update in database
            await this.database!.updatePredictionOutcome(prediction.id, outcome);

            console.log(`[OutcomeLearner] ${prediction.token.slice(0, 8)}... → ${outcome}`);
          } catch {
            // Skip this token, try next
          }
        }

        // Save updated weights periodically
        if (pending.length > 0) {
          await this.outcomeLearner.saveToDatabase();
        }
      } catch (err) {
        console.error('[Coordinator] Outcome check error:', (err as Error).message);
      }

      // Schedule next check (every hour)
      this.outcomeCheckTimer = setTimeout(checkOutcomes, 60 * 60 * 1000);
    };

    // First check after 5 minutes (let system stabilize)
    this.outcomeCheckTimer = setTimeout(checkOutcomes, 5 * 60 * 1000);
    console.log('[Coordinator] Outcome checking enabled (hourly)');
  }

  /**
   * Get message bus for external subscriptions
   */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  /**
   * Get agent by name
   */
  getAgent(name: string): BaseAgent | undefined {
    return this.getAllAgents().find(a => a.getStatus().name === name);
  }

  /**
   * Get all scout stats
   */
  getScoutStats(): Array<{ name: string; stats: any }> {
    return this.scouts.map(scout => ({
      name: scout.getStatus().name,
      stats: scout.getStats()
    }));
  }

  /**
   * Get all analyst stats
   */
  getAnalystStats(): Array<{ name: string; stats: any }> {
    return this.analysts.map(analyst => ({
      name: analyst.getStatus().name,
      stats: analyst.getStats()
    }));
  }

  /**
   * Get all hunter stats
   */
  getHunterStats(): Array<{ name: string; stats: any }> {
    return this.hunters.map(hunter => ({
      name: hunter.getStatus().name,
      stats: hunter.getStats()
    }));
  }

  /**
   * Get all trader stats
   */
  getTraderStats(): Array<{ name: string; stats: any }> {
    return this.traders.map(trader => ({
      name: trader.getStatus().name,
      stats: trader.getStats()
    }));
  }

  /**
   * Get trader agents (for Yellowstone price update wiring)
   */
  getTraders(): TraderAgent[] {
    return this.traders;
  }

  /**
   * Get aggregate BitNet inference stats across all agents
   */
  getBitNetStats(): {
    totalInferences: number;
    avgMs: number;
    lastMs: number;
    agentBreakdown: Array<{ name: string; stats: { lastMs: number; avgMs: number; totalInferences: number } }>;
  } {
    const allAgents = this.getAllAgents();
    const breakdown = allAgents.map(agent => ({
      name: agent.getStatus().name,
      stats: agent.getBitNetStats(),
    }));

    const totalInferences = breakdown.reduce((sum, a) => sum + a.stats.totalInferences, 0);
    const totalMs = breakdown.reduce((sum, a) => sum + (a.stats.avgMs * a.stats.totalInferences), 0);
    const avgMs = totalInferences > 0 ? totalMs / totalInferences : 0;
    const lastMs = Math.max(...breakdown.map(a => a.stats.lastMs), 0);

    return {
      totalInferences,
      avgMs,
      lastMs,
      agentBreakdown: breakdown,
    };
  }

  /**
   * Get debate history
   */
  getDebateHistory(limit: number = 20): DebateResult[] {
    return this.debateProtocol?.getHistory(limit) || [];
  }

  /**
   * Get goal progress summary for all agents
   */
  getGoalSummary(): Record<string, { progress: number; onTrack: number; total: number }> {
    return this.goalTracker.getSummary();
  }

  /**
   * Trigger a debate on a proposal manually
   */
  async triggerDebate(proposal: {
    agent: string;
    action: 'BUY' | 'SELL' | 'IGNORE' | 'TRACK' | 'ALERT';
    target: string;
    reasoning: string;
    confidence?: number;
    context?: Record<string, unknown>;
  }): Promise<DebateResult | null> {
    if (!this.debateProtocol) {
      console.log('[Coordinator] Cannot trigger debate - no LLM available');
      return null;
    }

    const fullProposal: Proposal = {
      id: createProposalId(),
      agent: proposal.agent,
      action: proposal.action,
      target: proposal.target,
      reasoning: proposal.reasoning,
      confidence: proposal.confidence || 0.7,
      context: proposal.context || {},
      timestamp: Date.now(),
    };

    return this.debateProtocol.debate(fullProposal);
  }

  /**
   * Check if autonomous reasoning (LLM) is available
   */
  isAutonomousReasoningEnabled(): boolean {
    return this.llm !== undefined && this.debateProtocol !== null;
  }

  /**
   * Update agent success rate in debate protocol (for learning)
   */
  updateAgentDebateSuccess(agentName: string, wasCorrect: boolean): void {
    this.debateProtocol?.updateAgentSuccess(agentName, wasCorrect);
  }
}
