/**
 * TraderAgent - Autonomous Trading Execution
 *
 * Responsibilities:
 * - Execute buy/sell based on analysis
 * - Manage positions with stop-loss and take-profit
 * - Track P&L and performance
 * - Learn from outcomes
 * - Emergency exit on scammer alerts
 */

import { BaseAgent, AgentConfig } from '../core/BaseAgent';
import { MessageBus } from '../core/MessageBus';

export interface TradingStrategy {
  name: string;
  description: string;
  entryConditions: {
    maxScore: number;
    minLiquidity: number;
    bundlesAllowed: boolean;
    securityRequirements: string[];
  };
  exitConditions: {
    takeProfitPercent: number;
    stopLossPercent: number;
    maxHoldTime: number; // hours
  };
  positionSize: number; // SOL
  riskTolerance: number; // 0-1
}

export interface Position {
  id: string;
  token: string;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  solInvested: number;
  entryTime: number;
  strategy: string;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  pnlPercent: number;
}

export interface TradeResult {
  success: boolean;
  txSignature?: string;
  price?: number;
  amount?: number;
  error?: string;
}

export class TraderAgent extends BaseAgent {
  private positions: Map<string, Position> = new Map();
  private tradeHistory: Array<{
    token: string;
    type: 'buy' | 'sell';
    price: number;
    amount: number;
    pnl?: number;
    reason: string;
    timestamp: number;
  }> = [];

  private strategies: TradingStrategy[] = [];
  private walletBalance: number = 0;
  private totalPnl: number = 0;
  private winCount: number = 0;
  private lossCount: number = 0;

  // Trading wallet (in production, loaded from secure vault)
  // @ts-ignore - Reserved for future production use
  private walletAddress: string = '';

  // Config from coordinator
  private maxPositionSize: number;
  private maxDailyTrades: number;
  private dailyTradeCount: number = 0;
  private lastTradeDate: string = '';

  constructor(messageBus: MessageBus, options: {
    name?: string;
    walletAddress?: string;
    initialBalance?: number;
    maxPositionSize?: number;
    maxDailyTrades?: number;
  } = {}) {
    const config: AgentConfig = {
      name: options.name || 'trader-1',
      role: 'Trader - Execute strategies and manage positions',
      model: './models/argus-sentinel-v1.bitnet',
      tools: [
        {
          name: 'evaluate_opportunity',
          description: 'Evaluate if token meets strategy criteria',
          execute: (params) => this.evaluateOpportunity(params)
        },
        {
          name: 'execute_buy',
          description: 'Execute buy order',
          execute: (params) => this.executeBuy(params)
        },
        {
          name: 'execute_sell',
          description: 'Execute sell order',
          execute: (params) => this.executeSell(params)
        },
        {
          name: 'monitor_positions',
          description: 'Check all positions for exit signals',
          execute: (_params) => this.monitorPositions()
        },
        {
          name: 'emergency_exit',
          description: 'Emergency sell all positions for a token',
          execute: (params) => this.emergencyExit(params)
        }
      ],
      memory: true,
      reasoning: true,
      maxReasoningSteps: 3
    };

    super(config, messageBus);

    this.walletAddress = options.walletAddress || 'SIMULATED_WALLET';
    this.walletBalance = options.initialBalance || 1.0; // 1 SOL starting balance
    this.maxPositionSize = options.maxPositionSize || 0.1; // Default 0.1 SOL
    this.maxDailyTrades = options.maxDailyTrades || 10; // Default 10 trades/day

    this.initializeStrategies();
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', `Trader initialized. Balance: ${this.walletBalance} SOL`);
    await this.think('observation', `Loaded ${this.strategies.length} trading strategies`);
  }

  protected async run(): Promise<void> {
    await this.think('observation', 'Starting position monitoring...');

    while (this.running) {
      try {
        // Monitor existing positions
        await this.monitorPositions();

        // Update balances
        await this.updateBalances();

        await new Promise(resolve => setTimeout(resolve, 30000)); // Check every 30s

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.think('reflection', `Trading error: ${errorMsg}`);
      }
    }
  }

  /**
   * Initialize default trading strategies
   */
  private initializeStrategies(): void {
    this.strategies = [
      {
        name: 'SAFE_EARLY',
        description: 'Low-risk early entries on verified safe tokens',
        entryConditions: {
          maxScore: 35,
          minLiquidity: 10000,
          bundlesAllowed: false,
          securityRequirements: ['mint_revoked', 'freeze_revoked']
        },
        exitConditions: {
          takeProfitPercent: 100, // 2x
          stopLossPercent: 25,
          maxHoldTime: 48
        },
        positionSize: 0.1,
        riskTolerance: 0.3
      },
      {
        name: 'MOMENTUM',
        description: 'Ride momentum on trending tokens',
        entryConditions: {
          maxScore: 50,
          minLiquidity: 25000,
          bundlesAllowed: true, // Allow VC bundles
          securityRequirements: ['mint_revoked']
        },
        exitConditions: {
          takeProfitPercent: 50,
          stopLossPercent: 20,
          maxHoldTime: 24
        },
        positionSize: 0.05,
        riskTolerance: 0.5
      },
      {
        name: 'SNIPER',
        description: 'Quick scalps on volatile tokens',
        entryConditions: {
          maxScore: 60,
          minLiquidity: 5000,
          bundlesAllowed: true,
          securityRequirements: []
        },
        exitConditions: {
          takeProfitPercent: 30,
          stopLossPercent: 15,
          maxHoldTime: 4
        },
        positionSize: 0.02,
        riskTolerance: 0.7
      }
    ];
  }

  /**
   * Evaluate if opportunity matches any strategy
   */
  private async evaluateOpportunity(params: {
    token: string;
    analysis: any;
  }): Promise<{
    shouldBuy: boolean;
    strategy?: string;
    positionSize?: number;
    reasoning: string;
  }> {
    const { token, analysis } = params;

    // Reset daily trade count if new day
    const today = new Date().toISOString().split('T')[0];
    if (this.lastTradeDate !== today) {
      this.dailyTradeCount = 0;
      this.lastTradeDate = today;
    }

    // Check daily trade limit
    if (this.dailyTradeCount >= this.maxDailyTrades) {
      return {
        shouldBuy: false,
        reasoning: `Daily trade limit reached (${this.maxDailyTrades})`
      };
    }

    // Check if we already have a position
    if (this.positions.has(token)) {
      return {
        shouldBuy: false,
        reasoning: 'Already have position in this token'
      };
    }

    // Check position limits
    if (this.positions.size >= 5) {
      return {
        shouldBuy: false,
        reasoning: 'Maximum positions reached (5)'
      };
    }

    // Find matching strategy
    for (const strategy of this.strategies) {
      const matches = this.checkStrategyMatch(strategy, analysis);

      if (matches.matches) {
        // Cap position size to configured max
        const positionSize = Math.min(strategy.positionSize, this.maxPositionSize);

        // Check if we have enough balance
        if (this.walletBalance < positionSize) {
          continue;
        }

        return {
          shouldBuy: true,
          strategy: strategy.name,
          positionSize,
          reasoning: matches.reasoning
        };
      }
    }

    return {
      shouldBuy: false,
      reasoning: 'No strategy matched entry conditions'
    };
  }

  /**
   * Check if analysis matches strategy conditions
   */
  private checkStrategyMatch(strategy: TradingStrategy, analysis: any): {
    matches: boolean;
    reasoning: string;
  } {
    const conditions = strategy.entryConditions;

    // Check score
    if ((analysis.score || 100) > conditions.maxScore) {
      return { matches: false, reasoning: `Score ${analysis.score} exceeds max ${conditions.maxScore}` };
    }

    // Check liquidity
    if ((analysis.liquidity || 0) < conditions.minLiquidity) {
      return { matches: false, reasoning: `Liquidity ${analysis.liquidity} below min ${conditions.minLiquidity}` };
    }

    // Check bundles
    if (!conditions.bundlesAllowed && analysis.bundleAnalysis?.detected) {
      return { matches: false, reasoning: 'Bundles detected but not allowed' };
    }

    // Check security
    for (const req of conditions.securityRequirements) {
      if (req === 'mint_revoked' && !analysis.mintRevoked) {
        return { matches: false, reasoning: 'Mint authority not revoked' };
      }
      if (req === 'freeze_revoked' && !analysis.freezeRevoked) {
        return { matches: false, reasoning: 'Freeze authority not revoked' };
      }
    }

    return {
      matches: true,
      reasoning: `Matches ${strategy.name} strategy conditions`
    };
  }

  /**
   * Execute buy order
   */
  private async executeBuy(params: {
    token: string;
    amount: number;
    strategy: string;
    analysis: any;
  }): Promise<TradeResult> {
    const { token, amount, strategy, analysis } = params;

    await this.think('action', `Executing BUY: ${amount} SOL of ${token.slice(0, 8)}...`);

    // In production, execute via Jupiter
    // Simulated for now
    const price = analysis.price || (Math.random() * 0.0001);
    const tokenAmount = amount / price;

    // Simulate success
    const success = Math.random() > 0.1; // 90% success rate

    if (success) {
      // Get strategy for stop-loss/take-profit
      const strat = this.strategies.find(s => s.name === strategy);

      // Create position
      const position: Position = {
        id: `pos_${Date.now()}`,
        token,
        entryPrice: price,
        currentPrice: price,
        amount: tokenAmount,
        solInvested: amount,
        entryTime: Date.now(),
        strategy,
        stopLoss: price * (1 - (strat?.exitConditions.stopLossPercent || 20) / 100),
        takeProfit: price * (1 + (strat?.exitConditions.takeProfitPercent || 100) / 100),
        pnl: 0,
        pnlPercent: 0
      };

      this.positions.set(token, position);
      this.walletBalance -= amount;
      this.dailyTradeCount++;

      // Record trade
      this.tradeHistory.push({
        token,
        type: 'buy',
        price,
        amount: tokenAmount,
        reason: `Strategy: ${strategy}`,
        timestamp: Date.now()
      });

      // Store in memory for learning
      await this.memory.store({
        action: 'buy',
        token,
        price,
        amount,
        strategy,
        analysis: {
          score: analysis.score,
          verdict: analysis.verdict
        }
      }, { type: 'action', tags: ['trade', 'buy', strategy] });

      await this.think(
        'action',
        `Position opened: ${token.slice(0, 8)}... @ ${price.toFixed(8)} (SL: ${position.stopLoss.toFixed(8)}, TP: ${position.takeProfit.toFixed(8)})`
      );

      return {
        success: true,
        txSignature: `sim_${Date.now()}`,
        price,
        amount: tokenAmount
      };
    }

    return {
      success: false,
      error: 'Simulated transaction failure'
    };
  }

  /**
   * Execute sell order
   */
  private async executeSell(params: {
    token: string;
    reason: string;
  }): Promise<TradeResult> {
    const { token, reason } = params;

    const position = this.positions.get(token);
    if (!position) {
      return { success: false, error: 'No position found' };
    }

    await this.think('action', `Executing SELL: ${token.slice(0, 8)}... (${reason})`);

    // In production, execute via Jupiter
    // Simulated for now
    const currentPrice = position.currentPrice;
    const solReceived = position.amount * currentPrice;

    // Simulate success
    const success = Math.random() > 0.05; // 95% success rate

    if (success) {
      // Calculate P&L
      const pnl = solReceived - position.solInvested;
      const pnlPercent = (pnl / position.solInvested) * 100;

      this.walletBalance += solReceived;
      this.totalPnl += pnl;

      if (pnl >= 0) {
        this.winCount++;
      } else {
        this.lossCount++;
      }

      // Record trade
      this.tradeHistory.push({
        token,
        type: 'sell',
        price: currentPrice,
        amount: position.amount,
        pnl,
        reason,
        timestamp: Date.now()
      });

      // Store in memory for learning
      await this.memory.store({
        action: 'sell',
        token,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        pnl,
        pnlPercent,
        holdTime: Date.now() - position.entryTime,
        reason,
        strategy: position.strategy
      }, { type: 'outcome', tags: ['trade', 'sell', pnl >= 0 ? 'win' : 'loss'] });

      // Report to coordinator
      await this.sendMessage('coordinator', 'trade_complete', {
        token,
        pnl,
        pnlPercent,
        strategy: position.strategy,
        reason
      });

      // Remove position
      this.positions.delete(token);

      await this.think(
        'action',
        `Position closed: ${token.slice(0, 8)}... | P&L: ${pnl.toFixed(4)} SOL (${pnlPercent.toFixed(1)}%)`
      );

      return {
        success: true,
        txSignature: `sim_${Date.now()}`,
        price: currentPrice,
        amount: solReceived
      };
    }

    return {
      success: false,
      error: 'Simulated transaction failure'
    };
  }

  /**
   * Monitor all positions for exit signals
   */
  private async monitorPositions(): Promise<void> {
    for (const [token, position] of this.positions) {
      // Simulate price movement
      const priceChange = (Math.random() - 0.45) * 0.1; // Slight upward bias
      position.currentPrice = position.entryPrice * (1 + priceChange);
      position.pnl = (position.currentPrice * position.amount) - position.solInvested;
      position.pnlPercent = (position.pnl / position.solInvested) * 100;

      // Check stop-loss
      if (position.currentPrice <= position.stopLoss) {
        await this.executeSell({ token, reason: 'Stop-loss triggered' });
        continue;
      }

      // Check take-profit
      if (position.currentPrice >= position.takeProfit) {
        await this.executeSell({ token, reason: 'Take-profit triggered' });
        continue;
      }

      // Check max hold time
      const strategy = this.strategies.find(s => s.name === position.strategy);
      const holdTimeHours = (Date.now() - position.entryTime) / 3600000;
      if (strategy && holdTimeHours >= strategy.exitConditions.maxHoldTime) {
        await this.executeSell({ token, reason: 'Max hold time reached' });
        continue;
      }
    }
  }

  /**
   * Emergency exit all positions for a token/creator
   */
  private async emergencyExit(params: { token?: string; wallet?: string }): Promise<void> {
    const { token, wallet } = params;

    for (const [posToken, _position] of this.positions) {
      let shouldExit = false;

      if (token && posToken === token) {
        shouldExit = true;
      }

      // In production, check if position's token was created by wallet
      if (wallet && Math.random() > 0.9) { // Simulated match
        shouldExit = true;
      }

      if (shouldExit) {
        await this.think('action', `EMERGENCY EXIT: ${posToken.slice(0, 8)}... (scammer alert)`);
        await this.executeSell({ token: posToken, reason: 'Emergency exit - scammer detected' });
      }
    }
  }

  /**
   * Update wallet balance
   */
  private async updateBalances(): Promise<void> {
    // In production, query actual wallet balance
    // For simulation, balance is tracked in memory
  }

  protected getConstraints(): Record<string, any> {
    return {
      maxPositions: 5,
      maxPositionSize: this.maxPositionSize,
      maxDailyTrades: this.maxDailyTrades,
      minBalance: 0.1,
      maxDailyLoss: this.walletBalance * 0.1
    };
  }

  protected setupMessageHandlers(): void {
    // Handle opportunities from analysts
    this.messageBus.subscribe(`agent.${this.config.name}.opportunity`, async (msg) => {
      const { token, analysis } = msg.data;

      const evaluation = await this.evaluateOpportunity({ token, analysis });

      if (evaluation.shouldBuy && evaluation.positionSize) {
        await this.executeBuy({
          token,
          amount: evaluation.positionSize,
          strategy: evaluation.strategy!,
          analysis
        });
      }
    });

    // Handle scammer alerts - emergency exit
    this.messageBus.subscribe('alert.scammer', async (msg) => {
      await this.emergencyExit({ wallet: msg.data.wallet });
    });

    // Handle high risk alerts
    this.messageBus.subscribe('alert.high_risk_token', async (msg) => {
      await this.emergencyExit({ token: msg.data.token });
    });

    // Handle manual sell requests
    this.messageBus.subscribe(`agent.${this.config.name}.sell`, async (msg) => {
      await this.executeSell({ token: msg.data.token, reason: 'Manual request' });
    });
  }

  /**
   * Get trader statistics
   */
  getStats(): {
    balance: number;
    positionCount: number;
    totalPnl: number;
    winRate: number;
    positions: Position[];
  } {
    const totalTrades = this.winCount + this.lossCount;

    return {
      balance: this.walletBalance,
      positionCount: this.positions.size,
      totalPnl: this.totalPnl,
      winRate: totalTrades > 0 ? this.winCount / totalTrades : 0,
      positions: Array.from(this.positions.values())
    };
  }
}
