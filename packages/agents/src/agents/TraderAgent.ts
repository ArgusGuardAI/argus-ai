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
import { TradingTools } from '../tools/TradingTools';
import { OnChainTools } from '../tools/OnChainTools';
import { Keypair, VersionedTransaction, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import type { PositionStore, Position as StoredPosition, CreatePositionInput } from '../services/PositionStore';

// Price update from Yellowstone streaming (received from PoolMonitor)
export interface PriceUpdateEvent {
  poolAddress: string;
  tokenAddress: string;
  price: number;           // SOL per token
  liquiditySol: number;    // Current liquidity in SOL
  timestamp: number;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;
const FEE_TRANSFER_THRESHOLD = 0.01; // Transfer fees when accumulated >= 0.01 SOL

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
  private walletAddress: string = '';

  // Config from coordinator
  private maxPositionSize: number;
  private maxDailyTrades: number;
  private dailyTradeCount: number = 0;
  private lastTradeDate: string = '';

  // Tools for real data
  private tradingTools: TradingTools;
  private onChainTools: OnChainTools;
  private rpcEndpoint: string;
  private connection: Connection;

  // Keypair for signing transactions (loaded from env)
  private keypair: Keypair | null = null;
  private tradingEnabled: boolean = false;

  // Position persistence (optional - enables position survival across restarts)
  private positionStore: PositionStore | null = null;

  // Callback for adding position to Yellowstone price tracking
  private onPositionOpened?: (poolAddress: string, tokenAddress: string) => Promise<void>;
  private onPositionClosed?: (poolAddress: string) => Promise<void>;

  constructor(messageBus: MessageBus, options: {
    name?: string;
    walletAddress?: string;
    privateKey?: string; // Base58 encoded private key for autonomous trading
    initialBalance?: number;
    maxPositionSize?: number;
    maxDailyTrades?: number;
    rpcEndpoint?: string;
    positionStore?: PositionStore;
    // Callbacks for Yellowstone price tracking integration
    onPositionOpened?: (poolAddress: string, tokenAddress: string) => Promise<void>;
    onPositionClosed?: (poolAddress: string) => Promise<void>;
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

    this.maxPositionSize = options.maxPositionSize || 0.1; // Default 0.1 SOL
    this.maxDailyTrades = options.maxDailyTrades || 10; // Default 10 trades/day
    this.rpcEndpoint = options.rpcEndpoint || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(this.rpcEndpoint, 'confirmed');

    // Initialize tools
    this.tradingTools = new TradingTools({ rpcEndpoint: this.rpcEndpoint });
    this.onChainTools = new OnChainTools({ rpcEndpoint: this.rpcEndpoint });

    // Position persistence (enables survival across restarts)
    this.positionStore = options.positionStore || null;

    // Yellowstone price tracking callbacks
    this.onPositionOpened = options.onPositionOpened;
    this.onPositionClosed = options.onPositionClosed;

    // Load keypair from private key if provided
    const privateKey = options.privateKey || process.env.TRADING_WALLET_PRIVATE_KEY;
    if (privateKey) {
      try {
        const secretKey = bs58.decode(privateKey);
        this.keypair = Keypair.fromSecretKey(secretKey);
        this.walletAddress = this.keypair.publicKey.toBase58();
        this.tradingEnabled = true;
        console.log(`[TraderAgent] Keypair loaded, wallet: ${this.walletAddress.slice(0, 8)}...`);
      } catch (error) {
        console.error('[TraderAgent] Failed to load keypair from private key:', error);
        this.walletAddress = options.walletAddress || '';
        this.tradingEnabled = false;
      }
    } else {
      this.walletAddress = options.walletAddress || '';
      this.tradingEnabled = false;
      console.log('[TraderAgent] No private key provided, trading disabled (simulation mode)');
    }

    this.walletBalance = options.initialBalance || 0;

    this.initializeStrategies();
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', `Trader initialized. Balance: ${this.walletBalance} SOL`);
    await this.think('observation', `Loaded ${this.strategies.length} trading strategies`);
    await this.think('observation', `Trading enabled: ${this.tradingEnabled} | Fee: ${this.tradingTools.getFeePercent()}%`);
    if (this.tradingEnabled) {
      await this.think('observation', `Wallet: ${this.walletAddress.slice(0, 8)}...${this.walletAddress.slice(-4)}`);
    }

    // Load active positions from database (survive restarts)
    if (this.positionStore) {
      try {
        const activePositions = await this.positionStore.getActive();
        for (const stored of activePositions) {
          // Convert StoredPosition to in-memory Position format
          const position: Position = {
            id: stored.id,
            token: stored.tokenAddress,
            entryPrice: stored.entryPrice,
            currentPrice: stored.currentPrice || stored.entryPrice,
            amount: stored.tokenAmount,
            solInvested: stored.entrySolAmount,
            entryTime: stored.entryTime,
            strategy: stored.strategy,
            stopLoss: stored.stopLossPrice,
            takeProfit: stored.takeProfitPrice,
            pnl: 0,
            pnlPercent: 0
          };
          this.positions.set(stored.tokenAddress, position);

          // Subscribe to price updates for this position via Yellowstone
          if (this.onPositionOpened) {
            await this.onPositionOpened(stored.poolAddress, stored.tokenAddress);
          }
        }
        await this.think('observation', `Loaded ${activePositions.length} active positions from database`);
      } catch (err) {
        console.error('[TraderAgent] Error loading positions:', (err as Error).message);
      }
    }
  }

  protected async run(): Promise<void> {
    await this.think('observation', 'Starting position monitoring...');

    while (this.running) {
      try {
        // Monitor existing positions (fallback for non-streaming mode)
        // When Yellowstone streaming is active, prices come via handlePriceUpdate()
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
   * Handle price update from Yellowstone gRPC streaming
   * Called by PoolMonitor when pool account data changes
   * Zero RPC calls - all data comes from the stream
   */
  async handlePriceUpdate(event: PriceUpdateEvent): Promise<void> {
    const position = this.positions.get(event.tokenAddress);
    if (!position) return;

    // Update current price
    position.currentPrice = event.price;
    position.pnl = (position.currentPrice * position.amount) - position.solInvested;
    position.pnlPercent = (position.pnl / position.solInvested) * 100;

    // Update in database
    if (this.positionStore) {
      try {
        // Find position by pool address
        const stored = await this.positionStore.getByPool(event.poolAddress);
        if (stored) {
          await this.positionStore.updatePrice(stored.id, event.price);
        }
      } catch (err) {
        console.error('[TraderAgent] Error updating position price:', (err as Error).message);
      }
    }

    // Check stop-loss
    if (position.currentPrice <= position.stopLoss) {
      await this.think('action', `Stop-loss triggered for ${event.tokenAddress.slice(0, 8)}... at ${event.price}`);
      await this.executeSellWithPool({ token: event.tokenAddress, reason: 'Stop-loss triggered', poolAddress: event.poolAddress });
      return;
    }

    // Check take-profit
    if (position.currentPrice >= position.takeProfit) {
      await this.think('action', `Take-profit triggered for ${event.tokenAddress.slice(0, 8)}... at ${event.price}`);
      await this.executeSellWithPool({ token: event.tokenAddress, reason: 'Take-profit triggered', poolAddress: event.poolAddress });
      return;
    }

    // Check max hold time
    const strategy = this.strategies.find(s => s.name === position.strategy);
    const holdTimeHours = (Date.now() - position.entryTime) / 3600000;
    if (strategy && holdTimeHours >= strategy.exitConditions.maxHoldTime) {
      await this.think('action', `Max hold time reached for ${event.tokenAddress.slice(0, 8)}...`);
      await this.executeSellWithPool({ token: event.tokenAddress, reason: 'Max hold time reached', poolAddress: event.poolAddress });
      return;
    }
  }

  /**
   * Execute sell with pool address for Yellowstone cleanup
   */
  private async executeSellWithPool(params: {
    token: string;
    reason: string;
    poolAddress: string;
  }): Promise<TradeResult> {
    const result = await this.executeSell({ token: params.token, reason: params.reason });

    // Remove from Yellowstone price tracking
    if (result.success && this.onPositionClosed) {
      await this.onPositionClosed(params.poolAddress);
    }

    return result;
  }

  /**
   * Sign a transaction using the loaded keypair
   * Returns base64-encoded signed transaction
   */
  private async signTransaction(serializedTx: string): Promise<string> {
    if (!this.keypair) {
      throw new Error('No keypair loaded for signing');
    }

    try {
      // Decode the base64 transaction
      const txBuffer = Buffer.from(serializedTx, 'base64');

      // Try to deserialize as VersionedTransaction first (Jupiter typically uses this)
      let signedTx: Buffer;
      try {
        const versionedTx = VersionedTransaction.deserialize(txBuffer);
        versionedTx.sign([this.keypair]);
        signedTx = Buffer.from(versionedTx.serialize());
      } catch {
        // Fallback: legacy transaction handling would go here
        throw new Error('Only versioned transactions are supported');
      }

      return signedTx.toString('base64');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown signing error';
      throw new Error(`Transaction signing failed: ${errorMsg}`);
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
        // Get risk score from analysis
        const riskScore = analysis.riskScore ?? analysis.score ?? 50;

        // TIERED POSITION SIZING based on risk score
        // Lower score = safer = bigger position
        let baseSize = Math.min(strategy.positionSize, this.maxPositionSize);
        let adjustedSize = baseSize;
        let tier = 'FULL';

        if (riskScore >= 80) {
          // High risk - skip entirely
          continue;
        } else if (riskScore >= 60) {
          // Medium-high risk - quarter position
          adjustedSize = baseSize * 0.25;
          tier = 'QUARTER';
        } else if (riskScore >= 40) {
          // Medium risk - half position
          adjustedSize = baseSize * 0.5;
          tier = 'HALF';
        }
        // Score < 40: full position

        // Check if we have enough balance
        if (this.walletBalance < adjustedSize) {
          continue;
        }

        return {
          shouldBuy: true,
          strategy: strategy.name,
          positionSize: adjustedSize,
          reasoning: `${matches.reasoning} [${tier} position @ score ${riskScore}]`
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
   * Execute buy order using real price data
   */
  private async executeBuy(params: {
    token: string;
    amount: number;
    strategy: string;
    analysis: any;
  }): Promise<TradeResult> {
    const { token, amount, strategy, analysis } = params;

    await this.think('action', `Executing BUY: ${amount} SOL of ${token.slice(0, 8)}...`);

    // Get quote from Jupiter (SOL -> Token)
    const inputLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    const quote = await this.tradingTools.getQuote(SOL_MINT, token, inputLamports, 100); // 1% slippage

    if (!quote) {
      await this.think('reflection', `Failed to get quote for ${token.slice(0, 8)}...`);
      return { success: false, error: 'Could not get swap quote' };
    }

    const price = amount / quote.outputAmount; // SOL per token
    const tokenAmount = quote.outputAmount;

    await this.think('observation', `Quote received: ${amount} SOL -> ${tokenAmount.toFixed(2)} tokens (impact: ${quote.priceImpact.toFixed(2)}%)`);

    // Execute real trade if trading is enabled
    let txSignature: string | undefined;

    if (this.tradingEnabled && this.keypair) {
      await this.think('action', `Executing real swap via Jupiter...`);

      try {
        const result = await this.tradingTools.executeSwap(
          quote,
          this.walletAddress,
          (tx) => this.signTransaction(tx),
          true // withFee = true, applies 0.5% fee for Argus AI
        );

        if (!result.success) {
          await this.think('reflection', `Swap failed: ${result.error}`);
          return { success: false, error: result.error };
        }

        txSignature = result.signature;
        await this.think('action', `Swap successful! TX: ${txSignature?.slice(0, 16)}...`);

        // Check if pending fees should be transferred
        if (this.tradingTools.getPendingFees() >= FEE_TRANSFER_THRESHOLD) {
          await this.think('observation', `Transferring accumulated fees: ${this.tradingTools.getPendingFees().toFixed(6)} SOL`);
          const feeResult = await this.tradingTools.transferFees(
            this.walletAddress,
            (tx) => this.signTransaction(tx)
          );
          if (feeResult.success) {
            await this.think('action', `Fees transferred: ${feeResult.amount?.toFixed(6)} SOL to Argus wallet`);
          }
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.think('reflection', `Trade execution error: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } else {
      await this.think('observation', `Simulation mode - trade not executed on-chain`);
      txSignature = `sim_${Date.now()}`;
    }

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

    // Persist to database for survival across restarts
    const poolAddress = analysis.poolAddress || `pool_${token.slice(0, 8)}`;
    const tokenSymbol = analysis.symbol || analysis.name || 'UNKNOWN';

    if (this.positionStore) {
      try {
        const positionInput: CreatePositionInput = {
          tokenAddress: token,
          tokenSymbol,
          poolAddress,
          entryPrice: price,
          entrySolAmount: amount,
          tokenAmount,
          stopLossPrice: position.stopLoss,
          takeProfitPrice: position.takeProfit,
          txSignature: txSignature || '',
          strategy,
        };
        await this.positionStore.create(positionInput);
        await this.think('observation', `Position persisted to database`);
      } catch (err) {
        console.error('[TraderAgent] Error persisting position:', (err as Error).message);
      }
    }

    // Register for Yellowstone price streaming
    if (this.onPositionOpened) {
      try {
        await this.onPositionOpened(poolAddress, token);
        await this.think('observation', `Registered for Yellowstone price streaming`);
      } catch (err) {
        console.error('[TraderAgent] Error registering for price updates:', (err as Error).message);
      }
    }

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
      txSignature,
      price,
      amount: tokenAmount
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

    // Get quote from Jupiter (Token -> SOL)
    // Note: Need to get token decimals for accurate amount, assuming 6 decimals for most SPL tokens
    const tokenDecimals = 6; // Most memecoins use 6 decimals
    const inputAmount = Math.floor(position.amount * Math.pow(10, tokenDecimals));

    const quote = await this.tradingTools.getQuote(token, SOL_MINT, inputAmount, 100); // 1% slippage

    if (!quote) {
      await this.think('reflection', `Failed to get sell quote for ${token.slice(0, 8)}...`);
      // Fall back to last known price for position tracking
      const estimatedSolReceived = position.amount * position.currentPrice;
      return { success: false, error: 'Could not get sell quote', amount: estimatedSolReceived };
    }

    const solReceived = quote.outputAmount / LAMPORTS_PER_SOL;
    const currentPrice = solReceived / position.amount;

    await this.think('observation', `Sell quote: ${position.amount.toFixed(2)} tokens -> ${solReceived.toFixed(6)} SOL`);

    // Execute real trade if trading is enabled
    let txSignature: string | undefined;

    if (this.tradingEnabled && this.keypair) {
      await this.think('action', `Executing real sell via Jupiter...`);

      try {
        const result = await this.tradingTools.executeSwap(
          quote,
          this.walletAddress,
          (tx) => this.signTransaction(tx),
          true // withFee = true, applies 0.5% fee for Argus AI
        );

        if (!result.success) {
          await this.think('reflection', `Sell failed: ${result.error}`);
          return { success: false, error: result.error };
        }

        txSignature = result.signature;
        await this.think('action', `Sell successful! TX: ${txSignature?.slice(0, 16)}...`);

        // Check if pending fees should be transferred
        if (this.tradingTools.getPendingFees() >= FEE_TRANSFER_THRESHOLD) {
          await this.think('observation', `Transferring accumulated fees: ${this.tradingTools.getPendingFees().toFixed(6)} SOL`);
          const feeResult = await this.tradingTools.transferFees(
            this.walletAddress,
            (tx) => this.signTransaction(tx)
          );
          if (feeResult.success) {
            await this.think('action', `Fees transferred: ${feeResult.amount?.toFixed(6)} SOL to Argus wallet`);
          }
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.think('reflection', `Sell execution error: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } else {
      await this.think('observation', `Simulation mode - sell not executed on-chain`);
      txSignature = `sim_${Date.now()}`;
    }

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

    // Close position in database
    if (this.positionStore) {
      try {
        // Map reason string to exit reason enum
        let exitReason: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'manual' | 'emergency' = 'manual';
        if (reason.includes('Stop-loss')) exitReason = 'stop_loss';
        else if (reason.includes('Take-profit')) exitReason = 'take_profit';
        else if (reason.includes('Emergency') || reason.includes('scammer')) exitReason = 'emergency';
        else if (reason.includes('hold time')) exitReason = 'manual';

        await this.positionStore.close(
          position.id,
          exitReason,
          pnl,
          txSignature || ''
        );
        await this.think('observation', `Position closed in database`);
      } catch (err) {
        console.error('[TraderAgent] Error closing position in database:', (err as Error).message);
      }
    }

    // Remove position from memory
    this.positions.delete(token);

    await this.think(
      'action',
      `Position closed: ${token.slice(0, 8)}... | P&L: ${pnl.toFixed(4)} SOL (${pnlPercent.toFixed(1)}%)`
    );

    return {
      success: true,
      txSignature,
      price: currentPrice,
      amount: solReceived
    };
  }

  /**
   * Monitor all positions for exit signals using real price data
   */
  private async monitorPositions(): Promise<void> {
    if (this.positions.size === 0) return;

    // Batch fetch current prices for all positions
    const tokens = Array.from(this.positions.keys());
    const prices = await this.tradingTools.batchGetPrices(tokens);

    for (const [token, position] of this.positions) {
      // Get real price, fallback to entry price if unavailable
      const currentPrice = prices.get(token) || position.currentPrice;
      position.currentPrice = currentPrice;
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
   * Update wallet balance from on-chain
   */
  private async updateBalances(): Promise<void> {
    if (!this.walletAddress || this.walletAddress === '') {
      return; // No wallet configured
    }

    try {
      const balance = await this.onChainTools.getBalance(this.walletAddress);
      this.walletBalance = balance;
    } catch (error) {
      console.error('[TraderAgent] Error updating balance:', error);
    }
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
    const agentType = this.config.name.replace(/-\d+$/, '');

    // Handle opportunities from analysts
    const handleOpportunity = async (msg: import('../core/MessageBus').Message) => {
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
    };
    this.messageBus.subscribe(`agent.${this.config.name}.opportunity`, handleOpportunity);
    if (agentType !== this.config.name) {
      this.messageBus.subscribe(`agent.${agentType}.opportunity`, handleOpportunity);
    }

    // Handle scammer alerts - emergency exit
    this.messageBus.subscribe('alert.scammer', async (msg) => {
      await this.emergencyExit({ wallet: msg.data.wallet });
    });

    // Handle high risk alerts
    this.messageBus.subscribe('alert.high_risk_token', async (msg) => {
      await this.emergencyExit({ token: msg.data.token });
    });

    // Handle manual sell requests
    const handleSell = async (msg: import('../core/MessageBus').Message) => {
      await this.executeSell({ token: msg.data.token, reason: 'Manual request' });
    };
    this.messageBus.subscribe(`agent.${this.config.name}.sell`, handleSell);
    if (agentType !== this.config.name) {
      this.messageBus.subscribe(`agent.${agentType}.sell`, handleSell);
    }
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
    tradingEnabled: boolean;
    pendingFees: number;
    walletAddress: string;
  } {
    const totalTrades = this.winCount + this.lossCount;

    return {
      balance: this.walletBalance,
      positionCount: this.positions.size,
      totalPnl: this.totalPnl,
      winRate: totalTrades > 0 ? this.winCount / totalTrades : 0,
      positions: Array.from(this.positions.values()),
      tradingEnabled: this.tradingEnabled,
      pendingFees: this.tradingTools.getPendingFees(),
      walletAddress: this.walletAddress
    };
  }
}
