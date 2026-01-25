/**
 * ArgusGuard Sniper Engine
 * Main orchestrator that combines token discovery, analysis, and trading
 *
 * NEW: Pre-filter pipeline eliminates 99% of scams BEFORE AI analysis
 * This makes auto-trading viable without bankrupting on AI costs.
 */

import { Connection } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { DexScreenerListener } from '../listeners/dexscreener';
import { RaydiumListener } from '../listeners/raydium';
import { MeteoraListener } from '../listeners/meteora';
import { PumpfunListener } from '../listeners/pumpfun';
import { GeckoTerminalListener } from '../listeners/geckoterminal';
import { TokenAnalyzer } from './analyzer';
import { TradeExecutor } from '../trading/executor';
import { PreFilter, PreFilterConfig, DEFAULT_PRE_FILTER_CONFIG } from './pre-filter';
import { LaunchFilter, LaunchFilterConfig, DEFAULT_LAUNCH_FILTER_CONFIG } from './launch-filter';
import type {
  SniperConfig,
  SniperState,
  SniperStatus,
  NewTokenEvent,
  SnipeDecision,
  Position,
  WSMessage,
} from '../types';
import { heliusBudget } from '../utils/helius-budget';

const DEFAULT_CONFIG: SniperConfig = {
  walletPrivateKey: '',
  buyAmountSol: 0.1,
  maxSlippageBps: 1500, // 15%
  priorityFeeLamports: 100000, // 0.0001 SOL
  useJito: false,
  minScore: 60,  // Only trade if score >= 60 (BUY or STRONG_BUY)
  minLiquidityUsd: 1000,
  allowRaydium: true,
  blacklistCreators: [],
  takeProfitPercent: 100, // 2x
  stopLossPercent: 30,
  maxHoldTimeMinutes: 60,
  manualModeOnly: false, // Auto-scan mode enabled by default now with pre-filters
};

export class SniperEngine extends EventEmitter {
  private config: SniperConfig;
  private connection: Connection;
  private dexScreenerListener: DexScreenerListener;
  private raydiumListener: RaydiumListener | null = null;
  private meteoraListener: MeteoraListener | null = null;
  private geckoTerminalListener: GeckoTerminalListener | null = null;
  private pumpfunListener: PumpfunListener | null = null;
  private analyzer: TokenAnalyzer;
  private preFilter: PreFilter;
  private launchFilter: LaunchFilter;
  private executor: TradeExecutor | null = null;
  private state: SniperState;
  private preFilterConfig: PreFilterConfig;
  private autoTradeEnabled: boolean = true;
  private heliusApiKey: string;

  // Re-check queue for tokens that failed initial checks
  private pendingTokens: Map<string, NewTokenEvent> = new Map();
  private recheckInterval: NodeJS.Timeout | null = null;

  // Track AI-rejected tokens - NEVER re-check these
  private aiRejectedTokens: Set<string> = new Set();

  // Track processed tokens to avoid duplicates
  private processedTokens: Set<string> = new Set();

  constructor(rpcUrl: string, config: Partial<SniperConfig> = {}, preFilterConfig: Partial<PreFilterConfig> = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.preFilterConfig = { ...DEFAULT_PRE_FILTER_CONFIG, ...preFilterConfig };
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.dexScreenerListener = new DexScreenerListener();
    this.analyzer = new TokenAnalyzer(this.config);
    this.preFilter = new PreFilter(this.preFilterConfig);
    this.launchFilter = new LaunchFilter();

    // Get Helius API key for Raydium listener
    this.heliusApiKey = process.env.HELIUS_API_KEY || '';

    this.state = {
      status: 'stopped',
      positions: [],
      tokensScanned: 0,
      tokensSniped: 0,
      tokensSkipped: 0,
      totalPnlSol: 0,
    };

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

    // Check if we should use public RPC (env var or no Helius key)
    const usePublicRpc = process.env.USE_PUBLIC_RPC === 'true' || process.env.USE_PUBLIC_RPC === '1';

    // Only start token discovery if NOT in manual mode
    if (!this.config.manualModeOnly) {
      // Start real-time listeners (works with or without Helius)
      // Raydium AMM listener
      this.raydiumListener = new RaydiumListener(this.heliusApiKey);
      this.raydiumListener.on('newToken', (token) => this.handleNewPoolToken(token));
      this.raydiumListener.on('error', (err) => this.emit('error', err));

      // Force public RPC if env var is set or no Helius key
      if (usePublicRpc || !this.heliusApiKey) {
        this.raydiumListener.forcePublicRpc();
        console.log('[Sniper] ⚡ Raydium listener starting (PUBLIC RPC)');
      } else {
        console.log('[Sniper] ⚡ Raydium listener starting (Helius)');
      }
      await this.raydiumListener.start();

      // Meteora DLMM listener
      this.meteoraListener = new MeteoraListener(this.heliusApiKey);
      this.meteoraListener.on('newToken', (token) => this.handleNewPoolToken(token));
      this.meteoraListener.on('error', (err) => this.emit('error', err));

      // Force public RPC if env var is set or no Helius key
      if (usePublicRpc || !this.heliusApiKey) {
        this.meteoraListener.forcePublicRpc();
        console.log('[Sniper] ⚡ Meteora listener starting (PUBLIC RPC)');
      } else {
        console.log('[Sniper] ⚡ Meteora listener starting (Helius)');
      }
      await this.meteoraListener.start();

      if (!this.heliusApiKey) {
        console.log('[Sniper] ⚠️ No HELIUS_API_KEY - Using public RPC (slower, rate limited)');
      } else if (usePublicRpc) {
        console.log('[Sniper] ⚠️ USE_PUBLIC_RPC=true - Using public RPC (Helius quota preserved)');
      }

      // Pump.fun bonding curve listener (no API key needed)
      // Can be disabled with DISABLE_PUMPFUN=true to focus on DEX only
      const disablePumpfun = process.env.DISABLE_PUMPFUN === 'true' || process.env.DISABLE_PUMPFUN === '1';
      if (!disablePumpfun) {
        this.pumpfunListener = new PumpfunListener();
        this.pumpfunListener.on('newToken', (token) => this.handleBondingCurveToken(token));
        this.pumpfunListener.on('error', (err) => this.emit('error', err));
        await this.pumpfunListener.start();
        console.log('[Sniper] ⚡ Pump.fun bonding curve listener started');
      } else {
        console.log('[Sniper] ⏭️ Pump.fun disabled (DISABLE_PUMPFUN=true) - DEX only mode');
      }

      // Also start DexScreener trending scanner as backup (polls every 60s)
      this.dexScreenerListener.start(60000);
      console.log('[Sniper] DexScreener trending scanner started (backup)');

      // Start GeckoTerminal listener as FREE alternative for new pools
      // This is more reliable than public RPC for getting new pool data
      const geckoInterval = usePublicRpc ? 20000 : 30000; // Poll faster when not using Helius
      this.geckoTerminalListener = new GeckoTerminalListener(geckoInterval);
      this.geckoTerminalListener.on('newToken', (token) => this.handleNewPoolToken(token));
      this.geckoTerminalListener.on('error', (err) => this.emit('error', err));
      await this.geckoTerminalListener.start();
      console.log(`[Sniper] 🦎 GeckoTerminal listener started (polls every ${geckoInterval / 1000}s)`);
    } else {
      console.log('[Sniper] Manual mode - token discovery disabled');
    }

    this.state.status = 'running';
    this.state.startedAt = Date.now();

    // Start the re-check queue processor (every 30 seconds)
    this.recheckInterval = setInterval(() => this.recheckPendingTokens(), 30000);
    console.log('[Sniper] Re-check queue started (30s interval)');

    // Log Helius budget status on startup and periodically
    if (this.heliusApiKey && !usePublicRpc) {
      console.log('[Sniper] Helius API budget tracking enabled');
      heliusBudget.logStatus();

      // Log budget status every 10 minutes
      setInterval(() => {
        heliusBudget.logStatus();
      }, 10 * 60 * 1000);

      // Listen for budget events
      heliusBudget.on('dailyBudgetExceeded', () => {
        console.log('[Sniper] ⚠️ HELIUS DAILY BUDGET EXCEEDED - Switching to free APIs');
        this.raydiumListener?.forcePublicRpc();
        this.meteoraListener?.forcePublicRpc();
      });

      heliusBudget.on('budgetWarning', (percent: number) => {
        console.log(`[Sniper] ⚠️ HELIUS BUDGET WARNING: ${(percent * 100).toFixed(0)}% used`);
      });
    }

    this.emitStatusUpdate();
    console.log('[Sniper] Running! Waiting for new tokens...');
  }

  stop() {
    console.log('[Sniper] Stopping...');
    this.dexScreenerListener.stop();

    // Stop Raydium listener
    if (this.raydiumListener) {
      this.raydiumListener.stop();
      this.raydiumListener = null;
    }

    // Stop Meteora listener
    if (this.meteoraListener) {
      this.meteoraListener.stop();
      this.meteoraListener = null;
    }

    // Stop GeckoTerminal listener
    if (this.geckoTerminalListener) {
      this.geckoTerminalListener.stop();
      this.geckoTerminalListener = null;
    }

    // Stop Pump.fun listener
    if (this.pumpfunListener) {
      this.pumpfunListener.stop();
      this.pumpfunListener = null;
    }

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
   * Handle brand new tokens from Raydium/Meteora pool creation
   * These are caught at launch - highest opportunity but need careful filtering
   */
  private async handleNewPoolToken(token: NewTokenEvent) {
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

    this.state.tokensScanned++;
    console.log(`\n[Sniper] ═══ NEW POOL: ${token.symbol} (${token.source}) ═══`);
    console.log(`[Sniper]    Address: ${token.address}`);
    console.log(`[Sniper]    Creator: ${token.creator || 'unknown'}`);
    console.log(`[Sniper]    Liquidity: $${token.liquidityUsd.toFixed(0)}`);

    // ========================================
    // LAUNCH FILTER (spam, liquidity, creator)
    // Run BEFORE emitting to UI - don't show garbage tokens
    // ========================================
    const filterResult = await this.launchFilter.filter(token);

    if (!filterResult.passed) {
      console.log(`[Sniper] ❌ LAUNCH FILTER: ${filterResult.reason}`);
      this.state.tokensSkipped++;
      // Don't emit to UI - filtered tokens don't show at all
      return;
    }

    // Only emit tokens that PASS the launch filter
    this.emit('message', {
      type: 'NEW_TOKEN',
      data: token,
    } as WSMessage);

    // Update token with accurate USD liquidity (using real SOL price)
    token.liquidityUsd = filterResult.adjustedLiquidityUsd;

    // Log any warning flags
    if (filterResult.flags.length > 0) {
      console.log(`[Sniper] ⚠️ Warning flags: ${filterResult.flags.join(', ')}`);
    }

    console.log(`[Sniper] ✓ Launch filter passed - sending to AI analysis`);

    // Send to AI for risk analysis
    await this.analyzeAndTrade(token);
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

    // Basic sanity checks - wider range to show more tokens
    // Rejected tokens only log to console (not sent to dashboard)
    if (mc < 3000 || mc > 5000000) {
      console.log(`[Sniper] ❌ MC out of range: $${mc.toFixed(0)}`);
      return;
    }

    // Lower threshold - any activity is interesting
    if (buys < 3) {
      console.log(`[Sniper] ❌ Not enough buys: ${buys}`);
      return;
    }

    // Check sell pressure - be more lenient
    if (sells > buys * 3) {
      console.log(`[Sniper] ❌ Sell pressure: ${sells} sells vs ${buys} buys`);
      return;
    }

    // Check price trend - allow more decline before rejecting
    const priceChange = token.priceChange1h || 0;
    if (priceChange < -60) {
      console.log(`[Sniper] ❌ Dumping: ${priceChange.toFixed(1)}% in 1h`);
      return;
    }

    console.log(`[Sniper] ✓ Trending checks passed: $${(mc/1000).toFixed(0)}K MC, ${buys} buys, ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%`);

    // Send to AI for risk analysis
    await this.analyzeAndTrade(token);
  }

  /**
   * Handle bonding curve tokens from Pump.fun
   * These are brand new tokens still on the bonding curve (pre-graduation)
   * We apply FREE heuristic scoring and emit to UI - no auto-trading
   */
  private async handleBondingCurveToken(token: NewTokenEvent) {
    // Avoid duplicates across sources
    if (this.processedTokens.has(token.address)) {
      return;
    }
    this.processedTokens.add(token.address);

    // Skip if paused
    if (this.state.status !== 'running') {
      return;
    }

    // FILTER: Skip BC tokens with no traction (< 1 SOL in bonding curve)
    const bondingProgress = token.metadata?.bondingProgress || 0;
    if (bondingProgress < 1) {
      return; // Silent skip - too much spam to log
    }

    this.state.tokensScanned++;

    // Apply FREE heuristic scoring for bonding curve tokens
    const heuristicScore = this.calculateBondingCurveScore(token);

    console.log(`\n[Sniper] ═══ BONDING CURVE: ${token.symbol} ═══`);
    console.log(`[Sniper]    Address: ${token.address}`);
    console.log(`[Sniper]    Creator: ${token.creator || 'unknown'}`);
    console.log(`[Sniper]    Bonding: ${token.metadata?.bondingProgress?.toFixed(2) || 0} SOL`);
    console.log(`[Sniper]    Dev Buy: ${token.metadata?.devBuy || 0} SOL`);
    console.log(`[Sniper]    FREE Score: ${heuristicScore.score} (${heuristicScore.flags.join(', ') || 'clean'})`);

    // Emit for UI with FREE score
    this.emit('message', {
      type: 'NEW_TOKEN',
      data: token,
    } as WSMessage);

    // Emit analysis result with FREE heuristic score
    // BONDING CURVE TOKENS: NEVER auto-trade, display only!
    // Too risky - dev can dump at any time
    this.emit('message', {
      type: 'ANALYSIS_RESULT',
      data: {
        token,
        shouldBuy: false, // NEVER auto-trade bonding curve tokens
        reason: `[BC] ${heuristicScore.summary}`,
        riskScore: heuristicScore.score, // RISK score: higher = more risky
        analysis: {
          flags: heuristicScore.flags,
          summary: `BONDING CURVE - ${heuristicScore.summary}`,
        },
        stage: 'BONDING_CURVE',
      },
    } as WSMessage);

    this.emitStatusUpdate();
  }

  /**
   * Calculate FREE heuristic score for bonding curve tokens
   * RISK score: 0-100 where HIGHER = MORE RISKY = DON'T BUY
   * This is intentionally different from the main heuristic scorer
   */
  private calculateBondingCurveScore(token: NewTokenEvent): {
    score: number;
    flags: string[];
    summary: string;
  } {
    let riskScore = 50; // Start neutral
    const flags: string[] = [];

    // ========================================
    // DEV BUY CHECK (CRITICAL!)
    // High dev buy = they can dump on you
    // ========================================
    const devBuy = token.metadata?.devBuy || 0;
    if (devBuy > 5) {
      riskScore += 40; // EXTREME RISK - dev owns massive bag
      flags.push('EXTREME_DEV_BAG');
    } else if (devBuy > 2) {
      riskScore += 30; // HIGH RISK
      flags.push('HIGH_DEV_BUY');
    } else if (devBuy > 0.5) {
      riskScore += 15;
      flags.push('MEDIUM_DEV_BUY');
    } else if (devBuy > 0) {
      riskScore += 5;
      flags.push('SMALL_DEV_BUY');
    }
    // No dev buy = good, no penalty

    // ========================================
    // BONDING CURVE PROGRESS
    // Very low = no interest = risky
    // ========================================
    const bondingProgress = token.metadata?.bondingProgress || 0;
    if (bondingProgress < 1) {
      riskScore += 20; // No traction = likely dead
      flags.push('NO_TRACTION');
    } else if (bondingProgress < 5) {
      riskScore += 10; // Low interest
      flags.push('LOW_TRACTION');
    } else if (bondingProgress > 20) {
      riskScore -= 10; // Good traction reduces risk
      flags.push('GOOD_TRACTION');
    }

    // ========================================
    // NAME/SYMBOL SPAM PATTERNS
    // ========================================
    const name = (token.name || '').toLowerCase();
    const symbol = (token.symbol || '').toLowerCase();

    if (/^[a-z]{1,2}$/.test(symbol)) {
      riskScore += 20;
      flags.push('TINY_SYMBOL');
    }
    if (/test|airdrop|presale|launch|moon|100x|1000x|free|giveaway/i.test(name)) {
      riskScore += 25;
      flags.push('SPAM_NAME');
    }
    if (/[0-9]{5,}/.test(name) || /[0-9]{5,}/.test(symbol)) {
      riskScore += 30;
      flags.push('RANDOM_NUMBERS');
    }

    // Copycat names (slightly risky but not fatal)
    if (/trump|musk|elon|doge|shib|pepe|wojak|inu/i.test(name)) {
      riskScore += 10;
      flags.push('COPYCAT');
    }

    // ========================================
    // BLACKLIST CHECK
    // ========================================
    const creator = token.creator || '';
    if (creator && this.config.blacklistCreators?.includes(creator)) {
      riskScore = 100;
      flags.push('BLACKLISTED');
    }

    // Clamp score 0-100
    riskScore = Math.max(0, Math.min(100, riskScore));

    // Generate summary based on RISK level
    let summary = '';
    if (riskScore >= 80) {
      summary = 'EXTREMELY RISKY - multiple red flags';
    } else if (riskScore >= 60) {
      summary = 'HIGH RISK - avoid or wait';
    } else if (riskScore >= 40) {
      summary = 'MODERATE RISK - proceed with caution';
    } else {
      summary = 'Lower risk - still bonding curve, be careful';
    }

    return { score: riskScore, flags, summary };
  }

  /**
   * Run AI analysis and execute trade if approved
   */
  private async analyzeAndTrade(token: NewTokenEvent) {
    // ============================================
    // AI ANALYSIS
    // ============================================
    const aiResult = await this.runAIAnalysis(token);

    this.preFilter.recordAIResult(aiResult.approved);

    if (!aiResult.approved) {
      console.log(`[Sniper] ❌ AI REJECT (score: ${aiResult.riskScore}): ${aiResult.reason}`);
      this.state.tokensSkipped++;
      this.emitStatusUpdate();

      // Add to rejected set - NEVER re-check this token
      this.aiRejectedTokens.add(token.address);
      // Also remove from pending queue if it was there
      this.pendingTokens.delete(token.address);
      // Rejected tokens not sent to dashboard (only logs to console)
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
      stage: 'AI_ANALYSIS',
    };

    this.emit('message', {
      type: 'ANALYSIS_RESULT',
      data: { ...decision, ai: aiResult.ai },
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

    } catch (error) {
      console.log(`[Sniper] ⚠ Could not refresh data for ${token.symbol}, using cached`);
    }
    return token;
  }

  /**
   * Run AI analysis using TokenAnalyzer (calls Together AI directly)
   * Now returns tiered AI analysis data for the frontend
   */
  private async runAIAnalysis(token: NewTokenEvent): Promise<{
    approved: boolean;
    riskScore: number;
    reason: string;
    analysis?: { flags: string[]; summary: string };
    ai?: {
      tier: 'full' | 'quick' | 'skip';
      signal?: string;
      risk?: number;
      confidence?: number;
      verdict?: string;
      watch?: boolean;
    };
  }> {
    try {
      // Use the TokenAnalyzer which calls Together AI directly
      // Now includes tiered AI analysis (full/quick/skip)
      const decision = await this.analyzer.analyze(token);

      return {
        approved: decision.shouldBuy,
        riskScore: decision.riskScore,
        reason: decision.reason,
        analysis: decision.analysis,
        ai: (decision as any).ai, // Pass AI tier data to frontend
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
      // Rejected tokens not sent to dashboard (only logs to console)
      return;
    }

    console.log(`[Sniper] ✅ PRE-FILTER PASSED - sending to AI analysis`);

    // Run AI analysis with full token data
    const aiResult = await this.runAIAnalysis(token);

    this.preFilter.recordAIResult(aiResult.approved);

    if (!aiResult.approved) {
      console.log(`[Sniper] ❌ AI REJECT (score: ${aiResult.riskScore}): ${aiResult.reason}`);
      this.state.tokensSkipped++;
      this.emitStatusUpdate();

      // Add to rejected set - NEVER re-check this token again
      this.aiRejectedTokens.add(token.address);
      // Rejected tokens not sent to dashboard (only logs to console)
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

  // ============================================
  // LAUNCH FILTER CONTROLS (for new pools)
  // ============================================

  /**
   * Get launch filter statistics
   */
  getLaunchFilterStats() {
    return this.launchFilter.getStats();
  }

  /**
   * Report a rug - auto-blacklists the creator
   */
  reportRug(creatorAddress: string, tokenAddress: string) {
    this.launchFilter.reportRug(creatorAddress, tokenAddress);
    // Also add to pre-filter blacklist
    this.preFilter.flagCreator(creatorAddress);
  }

  /**
   * Blacklist a creator manually
   */
  blacklistCreator(creatorAddress: string) {
    this.launchFilter.blacklistCreator(creatorAddress);
    this.preFilter.flagCreator(creatorAddress);
  }

  /**
   * Get current SOL price
   */
  getSolPrice(): number {
    return this.launchFilter.getSolPrice();
  }

  /**
   * Get all blacklisted creators
   */
  getBlacklistedCreators(): string[] {
    return this.launchFilter.getBlacklistedCreators();
  }

  // ============================================
  // RPC FALLBACK CONTROLS
  // ============================================

  /**
   * Force switch to public RPC for Raydium and Meteora listeners
   * Use this when Helius quota is exceeded
   */
  forcePublicRpc() {
    console.log('[Sniper] Forcing all listeners to use public RPC...');

    if (this.raydiumListener) {
      this.raydiumListener.forcePublicRpc();
    }
    if (this.meteoraListener) {
      this.meteoraListener.forcePublicRpc();
    }

    // Emit status update - will be broadcast to connected clients
    this.emitStatusUpdate();
  }

  /**
   * Check if listeners are using public RPC
   */
  isUsingPublicRpc(): { raydium: boolean; meteora: boolean } {
    return {
      raydium: this.raydiumListener?.isUsingPublicRpc() || false,
      meteora: this.meteoraListener?.isUsingPublicRpc() || false,
    };
  }

  /**
   * Get listener connection status
   */
  getListenerStatus() {
    return {
      raydium: this.raydiumListener?.getStats() || { isRunning: false, connected: false, usingPublicRpc: false },
      meteora: this.meteoraListener?.getStats() || { isRunning: false, connected: false, usingPublicRpc: false },
      pumpfun: this.pumpfunListener?.getStats() || { isRunning: false, connected: false },
      geckoTerminal: this.geckoTerminalListener?.getStats() || { isRunning: false, poolsSeen: 0 },
    };
  }
}
