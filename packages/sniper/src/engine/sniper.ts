/**
 * ArgusGuard Sniper Engine
 * Main orchestrator that combines token discovery, analysis, and trading
 *
 * NEW: Pre-filter pipeline eliminates 99% of scams BEFORE AI analysis
 * This makes auto-trading viable without bankrupting on AI costs.
 */

import { Connection } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { PumpFunListener } from '../listeners/pump-fun';
import { DexScreenerListener } from '../listeners/dexscreener';
import { TokenAnalyzer } from './analyzer';
import { TradeExecutor } from '../trading/executor';
import { PreFilter, PreFilterConfig, DEFAULT_PRE_FILTER_CONFIG } from './pre-filter';
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
  maxRiskScore: 75,
  minLiquidityUsd: 1000,
  allowPumpFun: true,
  allowRaydium: true,
  blacklistCreators: [],
  takeProfitPercent: 100, // 2x
  stopLossPercent: 30,
  maxHoldTimeMinutes: 60,
  manualModeOnly: false, // Auto-scan mode enabled by default now with pre-filters
};

// AI API for full analysis
const SENTINEL_API = process.env.SENTINEL_API_URL || 'http://localhost:8787';

export class SniperEngine extends EventEmitter {
  private config: SniperConfig;
  private connection: Connection;
  private pumpFunListener: PumpFunListener;
  private dexScreenerListener: DexScreenerListener;
  private analyzer: TokenAnalyzer;
  private preFilter: PreFilter;
  private executor: TradeExecutor | null = null;
  private state: SniperState;
  private preFilterConfig: PreFilterConfig;
  private autoTradeEnabled: boolean = true;

  // Re-check queue for tokens that failed AGE filter
  private pendingTokens: Map<string, NewTokenEvent> = new Map();
  private recheckInterval: NodeJS.Timeout | null = null;

  // Track AI-rejected tokens - NEVER re-check these
  private aiRejectedTokens: Set<string> = new Set();

  // Track processed tokens to avoid duplicates across sources
  private processedTokens: Set<string> = new Set();

  constructor(rpcUrl: string, config: Partial<SniperConfig> = {}, preFilterConfig: Partial<PreFilterConfig> = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.preFilterConfig = { ...DEFAULT_PRE_FILTER_CONFIG, ...preFilterConfig };
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.pumpFunListener = new PumpFunListener();
    this.dexScreenerListener = new DexScreenerListener();
    this.analyzer = new TokenAnalyzer(this.config);
    this.preFilter = new PreFilter(this.preFilterConfig);

    this.state = {
      status: 'stopped',
      positions: [],
      tokensScanned: 0,
      tokensSniped: 0,
      tokensSkipped: 0,
      totalPnlSol: 0,
    };

    // Set up event handlers for pump.fun
    this.pumpFunListener.on('newToken', (token) => this.handleNewToken(token));
    this.pumpFunListener.on('error', (err) => this.emit('error', err));

    // Set up event handlers for DexScreener trending
    this.dexScreenerListener.on('newToken', (token) => this.handleTrendingToken(token));
    this.dexScreenerListener.on('error', (err) => this.emit('error', err));
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

    // Only start token discovery if NOT in manual mode
    if (!this.config.manualModeOnly) {
      this.pumpFunListener.start();
      console.log('[Sniper] Pump.fun token discovery started');

      // Also start DexScreener trending scanner (polls every 60s)
      this.dexScreenerListener.start(60000);
      console.log('[Sniper] DexScreener trending scanner started');
    } else {
      console.log('[Sniper] Manual mode - token discovery disabled');
    }

    this.state.status = 'running';
    this.state.startedAt = Date.now();

    // Start the re-check queue processor (every 30 seconds)
    this.recheckInterval = setInterval(() => this.recheckPendingTokens(), 30000);
    console.log('[Sniper] Re-check queue started (30s interval)');

    this.emitStatusUpdate();
    console.log('[Sniper] Running! Waiting for new tokens...');
  }

  stop() {
    console.log('[Sniper] Stopping...');
    this.pumpFunListener.stop();
    this.dexScreenerListener.stop();

    // Stop re-check queue
    if (this.recheckInterval) {
      clearInterval(this.recheckInterval);
      this.recheckInterval = null;
      console.log(`[Sniper] Re-check queue stopped (${this.pendingTokens.size} pending, ${this.aiRejectedTokens.size} rejected cleared)`);
    }
    this.pendingTokens.clear();
    this.aiRejectedTokens.clear();
    this.processedTokens.clear();

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

  /**
   * Handle trending tokens from DexScreener
   * These already have data, so we can skip the age check
   */
  private async handleTrendingToken(token: NewTokenEvent) {
    // Avoid duplicates across sources
    if (this.processedTokens.has(token.address)) {
      return;
    }
    this.processedTokens.add(token.address);

    // Skip if already rejected by AI
    if (this.aiRejectedTokens.has(token.address)) {
      return;
    }

    // Skip if paused
    if (this.state.status !== 'running') {
      return;
    }

    // Emit for UI
    this.emit('message', {
      type: 'NEW_TOKEN',
      data: token,
    } as WSMessage);

    this.state.tokensScanned++;
    console.log(`\n[Sniper] ═══ TRENDING: ${token.symbol} (${token.source}) ═══`);

    // For trending tokens, skip pre-filter and go straight to AI
    // They already have market data and proven interest
    const mc = token.initialMarketCap || 0;
    const buys = token.buys1h || 0;
    const sells = token.sells1h || 0;

    // Basic sanity checks
    if (mc < 5000 || mc > 500000) {
      console.log(`[Sniper] ❌ MC out of range: $${mc.toFixed(0)}`);
      return;
    }

    if (buys < 10) {
      console.log(`[Sniper] ❌ Not enough buys: ${buys}`);
      return;
    }

    // Check sell pressure
    if (sells > buys * 1.5) {
      console.log(`[Sniper] ❌ Sell pressure: ${sells} sells vs ${buys} buys`);
      return;
    }

    // Check price trend
    const priceChange = token.priceChange1h || 0;
    if (priceChange < -20) {
      console.log(`[Sniper] ❌ Dumping: ${priceChange.toFixed(1)}% in 1h`);
      return;
    }

    console.log(`[Sniper] ✓ Trending checks passed: $${(mc/1000).toFixed(0)}K MC, ${buys} buys, ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%`);

    // Send to AI for risk analysis
    await this.analyzeAndTrade(token);
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

    // Skip auto-analysis in manual mode
    if (this.config.manualModeOnly) {
      return;
    }

    // Skip tokens that were already rejected by AI - no second chances
    if (this.aiRejectedTokens.has(token.address)) {
      return;
    }

    this.state.tokensScanned++;

    // ============================================
    // STAGE 1: PRE-FILTER (FREE - no AI cost)
    // ============================================
    console.log(`\n[Sniper] ═══ Processing ${token.symbol} (${token.address.slice(0, 8)}...) ═══`);

    const preFilterResult = await this.preFilter.filter(token.address, token);

    if (!preFilterResult.passed) {
      console.log(`[Sniper] ❌ PRE-FILTER REJECT [${preFilterResult.stage}]: ${preFilterResult.reason}`);

      // If rejected for AGE or MARKET CAP, add to re-check queue (might pass later)
      const requeueableStages = ['AGE', 'BONDING_CURVE', 'MARKET_CAP'];
      if (requeueableStages.includes(preFilterResult.stage) && !this.pendingTokens.has(token.address)) {
        this.pendingTokens.set(token.address, token);
        console.log(`[Sniper] 📋 Added ${token.symbol} to re-check queue [${preFilterResult.stage}] (${this.pendingTokens.size} pending)`);

        // Emit pending status for UI
        this.emit('message', {
          type: 'ANALYSIS_RESULT',
          data: {
            token,
            shouldBuy: false,
            reason: `Pre-filter: ${preFilterResult.reason} (queued for re-check)`,
            riskScore: 100,
            stage: preFilterResult.stage,
            pending: true,
          },
        } as WSMessage);
        return;
      }

      this.state.tokensSkipped++;
      this.emitStatusUpdate();

      // Emit rejection for UI
      this.emit('message', {
        type: 'ANALYSIS_RESULT',
        data: {
          token,
          shouldBuy: false,
          reason: `Pre-filter: ${preFilterResult.reason}`,
          riskScore: 100,
          stage: preFilterResult.stage,
        },
      } as WSMessage);
      return;
    }

    console.log(`[Sniper] ✅ PRE-FILTER PASSED - sending to AI analysis`);

    // Send to AI for risk analysis
    await this.analyzeAndTrade(token);
  }

  /**
   * Run AI analysis and execute trade if approved
   */
  private async analyzeAndTrade(token: NewTokenEvent) {
    // ============================================
    // AI ANALYSIS
    // ============================================
    const aiResult = await this.runAIAnalysis(token.address);

    this.preFilter.recordAIResult(aiResult.approved);

    if (!aiResult.approved) {
      console.log(`[Sniper] ❌ AI REJECT (score: ${aiResult.riskScore}): ${aiResult.reason}`);
      this.state.tokensSkipped++;
      this.emitStatusUpdate();

      // Add to rejected set - NEVER re-check this token
      this.aiRejectedTokens.add(token.address);
      // Also remove from pending queue if it was there
      this.pendingTokens.delete(token.address);

      this.emit('message', {
        type: 'ANALYSIS_RESULT',
        data: {
          token,
          shouldBuy: false,
          reason: `AI: ${aiResult.reason}`,
          riskScore: aiResult.riskScore,
          analysis: aiResult.analysis,
        },
      } as WSMessage);
      return;
    }

    console.log(`[Sniper] ✅ AI APPROVED (score: ${aiResult.riskScore}) - ${aiResult.reason}`);

    // ============================================
    // AUTO-TRADE (if enabled)
    // ============================================
    const decision: SnipeDecision = {
      token,
      shouldBuy: true,
      reason: `AI approved (score: ${aiResult.riskScore})`,
      riskScore: aiResult.riskScore,
      analysis: aiResult.analysis,
    };

    this.emit('message', {
      type: 'ANALYSIS_RESULT',
      data: decision,
    } as WSMessage);

    if (this.autoTradeEnabled) {
      console.log(`[Sniper] 🎯 AUTO-TRADING ${token.symbol}!`);
      this.preFilter.recordTrade();
      await this.executeSnipe(token, decision);
    } else {
      console.log(`[Sniper] 💡 Auto-trade disabled - token approved but not buying`);
    }
  }

  /**
   * Refresh token data with current market cap from DexScreener or Helius
   */
  private async refreshTokenData(token: NewTokenEvent): Promise<NewTokenEvent> {
    try {
      // Try DexScreener first (for graduated tokens)
      const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
      if (dexResponse.ok) {
        const data = await dexResponse.json() as { pairs?: any[] };
        if (data.pairs && data.pairs.length > 0) {
          const pair = data.pairs[0];
          const freshMarketCap = pair.marketCap || pair.fdv || 0;
          if (freshMarketCap > 0) {
            console.log(`[Sniper] 📈 Fresh MC for ${token.symbol}: $${freshMarketCap.toFixed(0)} (was $${token.liquidityUsd.toFixed(0)})`);
            return { ...token, liquidityUsd: freshMarketCap };
          }
        }
      }

      // For bonding curve tokens, estimate from token supply sold
      // Pump.fun bonding curve: starts at ~$4K, graduates at ~$69K (85 SOL @ ~$200)
      // Each 1% of curve = ~$650 added to market cap
      const heliusKey = process.env.HELIUS_API_KEY;
      if (heliusKey) {
        const rpcResponse = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenSupply',
            params: [token.address],
          }),
        });
        if (rpcResponse.ok) {
          const rpcData = await rpcResponse.json() as { result?: { value?: { uiAmount?: number } } };
          const circulatingSupply = rpcData.result?.value?.uiAmount || 0;
          // Total supply is 1 billion, bonding curve holds ~800M initially
          // As tokens are bought, circulating supply increases
          // Circulating of 200M = 20% through curve = ~$17K MC
          const percentSold = Math.min(100, (circulatingSupply / 1_000_000_000) * 100);
          const estimatedMC = 4000 + (percentSold * 650); // Rough estimate
          if (estimatedMC > token.liquidityUsd) {
            console.log(`[Sniper] 📈 Estimated MC for ${token.symbol}: $${estimatedMC.toFixed(0)} (${percentSold.toFixed(1)}% sold, was $${token.liquidityUsd.toFixed(0)})`);
            return { ...token, liquidityUsd: estimatedMC };
          }
        }
      }
    } catch (error) {
      console.log(`[Sniper] ⚠ Could not refresh data for ${token.symbol}, using cached`);
    }
    return token;
  }

  /**
   * Run AI analysis via Sentinel API
   */
  private async runAIAnalysis(tokenAddress: string): Promise<{
    approved: boolean;
    riskScore: number;
    reason: string;
    analysis?: { flags: string[]; summary: string };
  }> {
    try {
      const response = await fetch(`${SENTINEL_API}/sentinel/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress }),
      });

      if (!response.ok) {
        return { approved: false, riskScore: 100, reason: 'AI API error' };
      }

      const data = await response.json() as {
        analysis?: {
          riskScore?: number;
          riskLevel?: string;
          summary?: string;
          flags?: Array<{ message: string }>;
        };
      };

      const riskScore = data.analysis?.riskScore || 100;
      const riskLevel = data.analysis?.riskLevel || 'UNKNOWN';

      // Approve if score is below threshold
      const approved = riskScore <= this.config.maxRiskScore;

      return {
        approved,
        riskScore,
        reason: approved
          ? `Risk level ${riskLevel} is acceptable`
          : `Risk score ${riskScore} exceeds max ${this.config.maxRiskScore}`,
        analysis: {
          flags: data.analysis?.flags?.map(f => f.message) || [],
          summary: data.analysis?.summary || '',
        },
      };
    } catch (error) {
      console.error('[Sniper] AI analysis error:', error);
      return { approved: false, riskScore: 100, reason: 'AI analysis failed' };
    }
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
    // - Re-check ArgusGuard analysis if risk increases
    console.log(`[Sniper] Monitoring position: ${position.tokenSymbol}`);
  }

  /**
   * Re-check tokens that were queued for being too young
   * Runs every 30 seconds to process tokens that now meet the age requirement
   */
  private async recheckPendingTokens() {
    if (this.pendingTokens.size === 0) return;

    console.log(`\n[Sniper] 🔄 Re-checking ${this.pendingTokens.size} pending tokens...`);

    // Process tokens that should now be old enough
    const tokensToCheck: NewTokenEvent[] = [];
    const tokensToRemove: string[] = [];

    for (const [address, token] of this.pendingTokens) {
      // Skip if already rejected by AI
      if (this.aiRejectedTokens.has(address)) {
        tokensToRemove.push(address);
        continue;
      }

      const ageMinutes = (Date.now() - token.timestamp) / 1000 / 60;

      // Remove if token is too old (max age exceeded)
      if (ageMinutes > this.preFilterConfig.maxAgeMinutes) {
        console.log(`[Sniper] 🗑️ Removing ${token.symbol} - too old (${ageMinutes.toFixed(1)} min)`);
        tokensToRemove.push(address);
        continue;
      }

      // Check if now old enough
      if (ageMinutes >= this.preFilterConfig.minAgeMinutes) {
        tokensToCheck.push(token);
        tokensToRemove.push(address);
      }
    }

    // Remove processed tokens from queue
    for (const address of tokensToRemove) {
      this.pendingTokens.delete(address);
    }

    // Process tokens that are now ready
    for (const token of tokensToCheck) {
      console.log(`[Sniper] ⏰ Re-checking ${token.symbol} (now old enough)`);
      await this.processQueuedToken(token);
    }

    if (this.pendingTokens.size > 0) {
      console.log(`[Sniper] 📋 ${this.pendingTokens.size} tokens still pending`);
    }
  }

  /**
   * Process a token from the re-check queue (similar to handleNewToken but without queueing again)
   */
  private async processQueuedToken(token: NewTokenEvent) {
    this.state.tokensScanned++;

    console.log(`\n[Sniper] ═══ Re-processing ${token.symbol} (${token.address.slice(0, 8)}...) ═══`);

    // Fetch FRESH market cap data for re-check (don't use stale WebSocket data)
    const freshToken = await this.refreshTokenData(token);
    const preFilterResult = await this.preFilter.filter(token.address, freshToken);

    if (!preFilterResult.passed) {
      console.log(`[Sniper] ❌ PRE-FILTER REJECT [${preFilterResult.stage}]: ${preFilterResult.reason}`);
      this.state.tokensSkipped++;
      this.emitStatusUpdate();

      this.emit('message', {
        type: 'ANALYSIS_RESULT',
        data: {
          token,
          shouldBuy: false,
          reason: `Pre-filter (recheck): ${preFilterResult.reason}`,
          riskScore: 100,
          stage: preFilterResult.stage,
        },
      } as WSMessage);
      return;
    }

    console.log(`[Sniper] ✅ PRE-FILTER PASSED - sending to AI analysis`);

    // Run AI analysis
    const aiResult = await this.runAIAnalysis(token.address);

    this.preFilter.recordAIResult(aiResult.approved);

    if (!aiResult.approved) {
      console.log(`[Sniper] ❌ AI REJECT (score: ${aiResult.riskScore}): ${aiResult.reason}`);
      this.state.tokensSkipped++;
      this.emitStatusUpdate();

      // Add to rejected set - NEVER re-check this token again
      this.aiRejectedTokens.add(token.address);

      this.emit('message', {
        type: 'ANALYSIS_RESULT',
        data: {
          token,
          shouldBuy: false,
          reason: `AI: ${aiResult.reason}`,
          riskScore: aiResult.riskScore,
          analysis: aiResult.analysis,
        },
      } as WSMessage);
      return;
    }

    console.log(`[Sniper] ✅ AI APPROVED (score: ${aiResult.riskScore}) - ${aiResult.reason}`);

    const decision: SnipeDecision = {
      token,
      shouldBuy: true,
      reason: `Re-check passed, AI approved (score: ${aiResult.riskScore})`,
      riskScore: aiResult.riskScore,
      analysis: aiResult.analysis,
    };

    this.emit('message', {
      type: 'ANALYSIS_RESULT',
      data: decision,
    } as WSMessage);

    if (this.autoTradeEnabled) {
      console.log(`[Sniper] 🎯 AUTO-TRADING ${token.symbol} (from re-check)!`);
      this.preFilter.recordTrade();
      await this.executeSnipe(token, decision);
    } else {
      console.log(`[Sniper] 💡 Auto-trade disabled - token approved but not buying`);
    }
  }

  async manualBuy(tokenAddress: string) {
    if (!this.executor) {
      console.log(`[Sniper] 👀 WATCH-ONLY: Would buy ${tokenAddress}`);
      this.emit('message', {
        type: 'SNIPE_ATTEMPT',
        data: { token: tokenAddress, status: 'watch-only' },
      } as WSMessage);
      return;
    }

    console.log(`[Sniper] 🎯 Manual snipe: ${tokenAddress}`);

    this.emit('message', {
      type: 'SNIPE_ATTEMPT',
      data: { token: tokenAddress, status: 'pending' },
    } as WSMessage);

    const result = await this.executor.buy(tokenAddress);

    if (result.success) {
      this.state.tokensSniped++;

      const position: Position = {
        tokenAddress: tokenAddress,
        tokenSymbol: 'MANUAL',
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

      this.emit('message', {
        type: 'SNIPE_ATTEMPT',
        data: { token: tokenAddress, status: 'success', txSignature: result.txSignature },
      } as WSMessage);

      this.emit('message', {
        type: 'TRADE_EXECUTED',
        data: result,
      } as WSMessage);

      console.log(`[Sniper] ✅ Manual snipe success! TX: ${result.txSignature}`);
      this.monitorPosition(position);
    } else {
      this.emit('message', {
        type: 'SNIPE_ATTEMPT',
        data: { token: tokenAddress, status: 'failed' },
      } as WSMessage);
      console.log(`[Sniper] ❌ Manual snipe failed: ${result.error}`);
    }

    this.emitStatusUpdate();
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

  // ============================================
  // PRE-FILTER CONTROLS
  // ============================================

  /**
   * Get pre-filter statistics
   */
  getPreFilterStats() {
    return this.preFilter.getStats();
  }

  /**
   * Get pre-filter configuration
   */
  getPreFilterConfig() {
    return this.preFilter.getConfig();
  }

  /**
   * Update pre-filter configuration
   */
  updatePreFilterConfig(config: Partial<PreFilterConfig>) {
    this.preFilter.updateConfig(config);
    this.preFilterConfig = { ...this.preFilterConfig, ...config };
  }

  /**
   * Flag a creator as a scammer (will be rejected in pre-filter)
   */
  flagCreator(creatorAddress: string) {
    this.preFilter.flagCreator(creatorAddress);
  }

  /**
   * Enable/disable auto-trading
   */
  setAutoTrade(enabled: boolean) {
    this.autoTradeEnabled = enabled;
    console.log(`[Sniper] Auto-trade ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Check if auto-trading is enabled
   */
  isAutoTradeEnabled(): boolean {
    return this.autoTradeEnabled;
  }

  /**
   * Reset pre-filter statistics
   */
  resetPreFilterStats() {
    this.preFilter.resetStats();
  }

  /**
   * Get number of tokens in re-check queue
   */
  getPendingTokenCount(): number {
    return this.pendingTokens.size;
  }

  /**
   * Get list of pending tokens (for UI)
   */
  getPendingTokens(): NewTokenEvent[] {
    return Array.from(this.pendingTokens.values());
  }
}
