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

export interface CoordinatorConfig {
  rpcEndpoint: string;
  scouts?: number;
  analysts?: number;
  hunters?: number;
  traders?: number;
  enableTrading?: boolean;
  maxDailyTrades?: number;
  maxPositionSize?: number;
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
      ...config
    };

    this.messageBus = new MessageBus();
    this.setupSystemHandlers();
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
        rpcEndpoint: this.config.rpcEndpoint
      });
      await scout.initialize();
      this.scouts.push(scout);
    }
    console.log(`[Coordinator] ${this.scouts.length} Scout agents ready`);

    // Create analyst agents
    for (let i = 0; i < this.config.analysts!; i++) {
      const analyst = new AnalystAgent(this.messageBus, {
        name: `analyst-${i + 1}`
      });
      await analyst.initialize();
      this.analysts.push(analyst);
    }
    console.log(`[Coordinator] ${this.analysts.length} Analyst agents ready`);

    // Create hunter agents
    for (let i = 0; i < this.config.hunters!; i++) {
      const hunter = new HunterAgent(this.messageBus, {
        name: `hunter-${i + 1}`
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
          maxDailyTrades: this.config.maxDailyTrades!
        });
        await trader.initialize();
        this.traders.push(trader);
      }
      console.log(`[Coordinator] ${this.traders.length} Trader agents ready`);
    } else {
      console.log('[Coordinator] Trading disabled');
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
}
