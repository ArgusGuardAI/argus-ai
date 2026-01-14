/**
 * WhaleShield Sniper Engine
 * Main orchestrator that combines token discovery, analysis, and trading
 */

import { Connection } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { PumpFunListener } from '../listeners/pump-fun';
import { TokenAnalyzer } from './analyzer';
import { TradeExecutor } from '../trading/executor';
import type {
  SniperConfig,
  SniperState,
  SniperStatus,
  NewTokenEvent,
  SnipeDecision,
  Position,
  WSMessage,
} from '../types';

const DEFAULT_CONFIG: SniperConfig = {
  walletPrivateKey: '',
  buyAmountSol: 0.1,
  maxSlippageBps: 1500, // 15%
  priorityFeeLamports: 100000, // 0.0001 SOL
  useJito: false,
  maxRiskScore: 40,
  minLiquidityUsd: 1000,
  allowPumpFun: true,
  allowRaydium: true,
  blacklistCreators: [],
  takeProfitPercent: 100, // 2x
  stopLossPercent: 30,
  maxHoldTimeMinutes: 60,
};

export class SniperEngine extends EventEmitter {
  private config: SniperConfig;
  private connection: Connection;
  private pumpFunListener: PumpFunListener;
  private analyzer: TokenAnalyzer;
  private executor: TradeExecutor | null = null;
  private state: SniperState;

  constructor(rpcUrl: string, config: Partial<SniperConfig> = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.pumpFunListener = new PumpFunListener();
    this.analyzer = new TokenAnalyzer(this.config);

    this.state = {
      status: 'stopped',
      positions: [],
      tokensScanned: 0,
      tokensSniped: 0,
      tokensSkipped: 0,
      totalPnlSol: 0,
    };

    // Set up event handlers
    this.pumpFunListener.on('newToken', (token) => this.handleNewToken(token));
    this.pumpFunListener.on('error', (err) => this.emit('error', err));
  }

  async start() {
    if (this.state.status === 'running') {
      console.log('[Sniper] Already running');
      return;
    }

    // Allow watch-only mode without wallet
    const watchOnly = !this.config.walletPrivateKey || this.config.walletPrivateKey === 'watch-only';

    console.log(`[Sniper] Starting in ${watchOnly ? 'WATCH-ONLY' : 'LIVE'} mode...`);

    // Initialize executor with wallet (only if not watch-only)
    if (!watchOnly) {
      this.executor = new TradeExecutor(this.connection, this.config);
      console.log(`[Sniper] Wallet: ${this.executor.getWalletAddress()}`);
    } else {
      console.log('[Sniper] Watch-only mode - no trades will be executed');
    }

    // Start listening for new tokens
    this.pumpFunListener.start();

    this.state.status = 'running';
    this.state.startedAt = Date.now();

    this.emitStatusUpdate();
    console.log('[Sniper] Running! Waiting for new tokens...');
  }

  stop() {
    console.log('[Sniper] Stopping...');
    this.pumpFunListener.stop();
    this.state.status = 'stopped';
    this.emitStatusUpdate();
  }

  pause() {
    this.state.status = 'paused';
    this.emitStatusUpdate();
  }

  resume() {
    if (this.state.status === 'paused') {
      this.state.status = 'running';
      this.emitStatusUpdate();
    }
  }

  private async handleNewToken(token: NewTokenEvent) {
    // Emit new token event for UI
    this.emit('message', {
      type: 'NEW_TOKEN',
      data: token,
    } as WSMessage);

    // Skip if paused
    if (this.state.status !== 'running') {
      return;
    }

    this.state.tokensScanned++;

    // Analyze token
    const decision = await this.analyzer.analyze(token);

    // Emit analysis result for UI
    this.emit('message', {
      type: 'ANALYSIS_RESULT',
      data: decision,
    } as WSMessage);

    if (!decision.shouldBuy) {
      this.state.tokensSkipped++;
      this.emitStatusUpdate();
      return;
    }

    // Execute snipe!
    await this.executeSnipe(token, decision);
  }

  private async executeSnipe(token: NewTokenEvent, decision: SnipeDecision) {
    if (!this.executor) {
      // Watch-only mode - just log what we would have done
      console.log(`[Sniper] 👀 WATCH-ONLY: Would snipe ${token.symbol} (score: ${decision.riskScore})`);
      this.emit('message', {
        type: 'SNIPE_ATTEMPT',
        data: { token: token.address, status: 'watch-only' },
      } as WSMessage);
      return;
    }

    // Emit snipe attempt
    this.emit('message', {
      type: 'SNIPE_ATTEMPT',
      data: { token: token.address, status: 'pending' },
    } as WSMessage);

    console.log(`[Sniper] 🎯 SNIPING ${token.symbol}!`);

    const result = await this.executor.buy(token.address);

    if (result.success) {
      this.state.tokensSniped++;

      // Add to positions
      const position: Position = {
        tokenAddress: token.address,
        tokenSymbol: token.symbol,
        entryPrice: result.price,
        currentPrice: result.price,
        amountTokens: result.amountTokens,
        costBasisSol: result.amountSol,
        currentValueSol: result.amountSol,
        pnlPercent: 0,
        pnlSol: 0,
        entryTime: Date.now(),
        txSignature: result.txSignature!,
      };

      this.state.positions.push(position);

      // Emit success
      this.emit('message', {
        type: 'SNIPE_ATTEMPT',
        data: { token: token.address, status: 'success', txSignature: result.txSignature },
      } as WSMessage);

      this.emit('message', {
        type: 'TRADE_EXECUTED',
        data: result,
      } as WSMessage);

      console.log(`[Sniper] ✅ Sniped ${token.symbol}! TX: ${result.txSignature}`);

      // Start monitoring position
      this.monitorPosition(position);
    } else {
      // Emit failure
      this.emit('message', {
        type: 'SNIPE_ATTEMPT',
        data: { token: token.address, status: 'failed' },
      } as WSMessage);

      console.log(`[Sniper] ❌ Snipe failed: ${result.error}`);
    }

    this.emitStatusUpdate();
  }

  private async monitorPosition(position: Position) {
    // TODO: Implement position monitoring
    // - Check price periodically
    // - Auto-sell on take profit / stop loss
    // - Auto-sell on max hold time
    // - Re-check WhaleShield analysis if risk increases
    console.log(`[Sniper] Monitoring position: ${position.tokenSymbol}`);
  }

  async manualSell(tokenAddress: string) {
    if (!this.executor) {
      throw new Error('Executor not initialized');
    }

    const position = this.state.positions.find((p) => p.tokenAddress === tokenAddress);
    if (!position) {
      throw new Error('Position not found');
    }

    const result = await this.executor.sell(tokenAddress, position.amountTokens);

    if (result.success) {
      // Update PnL
      position.pnlSol = result.amountSol - position.costBasisSol;
      position.pnlPercent = (position.pnlSol / position.costBasisSol) * 100;
      this.state.totalPnlSol += position.pnlSol;

      // Remove from positions
      this.state.positions = this.state.positions.filter((p) => p.tokenAddress !== tokenAddress);

      this.emit('message', {
        type: 'TRADE_EXECUTED',
        data: result,
      } as WSMessage);
    }

    this.emitStatusUpdate();
    return result;
  }

  getState(): SniperState {
    return { ...this.state };
  }

  updateConfig(config: Partial<SniperConfig>) {
    this.config = { ...this.config, ...config };
    this.analyzer.updateConfig(config);
    if (this.executor) {
      this.executor.updateConfig(config);
    }
  }

  private emitStatusUpdate() {
    this.emit('message', {
      type: 'STATUS_UPDATE',
      data: this.getState(),
    } as WSMessage);
  }
}
