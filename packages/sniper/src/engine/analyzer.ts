/**
 * Token Analyzer
 * Calls ArgusGuard API to analyze tokens before sniping
 * Includes rate limiting and pre-filtering to reduce API calls
 */

import type { NewTokenEvent, SnipeDecision, SniperConfig } from '../types';

const ARGUSGUARD_API = process.env.ARGUSGUARD_API_URL || 'https://api.argusguard.io';

// Rate limiting config
const MAX_ANALYSES_PER_MINUTE = 15; // Max API calls per minute
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window

// Spam filter - skip tokens with these patterns (case insensitive)
const SPAM_PATTERNS = [
  /^test/i,
  /^aaa+/i,
  /^xxx/i,
  /^\d+$/,        // Pure numbers
  /^.{1,2}$/,     // 1-2 char names
  /porn/i,
  /nsfw/i,
  /sex/i,
  /fuck/i,
  /nigger/i,
  /nigga/i,
  /fag/i,
];

export class TokenAnalyzer {
  private config: SniperConfig;
  private analysisTimestamps: number[] = [];
  private skippedByRateLimit = 0;
  private skippedByFilter = 0;

  constructor(config: SniperConfig) {
    this.config = config;
  }

  /**
   * Pre-filter tokens before making API calls
   * Returns reason to skip, or null if should analyze
   */
  private preFilter(token: NewTokenEvent): string | null {
    // Check spam patterns
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(token.name) || pattern.test(token.symbol)) {
        return `Spam filter: name/symbol matches blocked pattern`;
      }
    }

    // Check source filters BEFORE API call
    if (token.source === 'pump.fun' && !this.config.allowPumpFun) {
      return 'Pump.fun tokens disabled';
    }
    if (token.source === 'raydium' && !this.config.allowRaydium) {
      return 'Raydium tokens disabled';
    }

    // Check blacklisted creators BEFORE API call
    if (this.config.blacklistCreators.includes(token.creator)) {
      return 'Creator is blacklisted';
    }

    return null; // Pass pre-filter
  }

  /**
   * Check if we're within rate limit
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    // Remove timestamps older than window
    this.analysisTimestamps = this.analysisTimestamps.filter(
      ts => now - ts < RATE_LIMIT_WINDOW_MS
    );
    return this.analysisTimestamps.length < MAX_ANALYSES_PER_MINUTE;
  }

  private recordAnalysis() {
    this.analysisTimestamps.push(Date.now());
  }

  getStats() {
    return {
      skippedByRateLimit: this.skippedByRateLimit,
      skippedByFilter: this.skippedByFilter,
      currentRate: this.analysisTimestamps.length,
      maxRate: MAX_ANALYSES_PER_MINUTE,
    };
  }

  async analyze(token: NewTokenEvent): Promise<SnipeDecision> {
    // Step 1: Pre-filter (no API call)
    const filterReason = this.preFilter(token);
    if (filterReason) {
      this.skippedByFilter++;
      console.log(`[Analyzer] ⏭️ PRE-FILTER SKIP: ${token.symbol} - ${filterReason}`);
      return this.createDecision(token, false, filterReason, 100);
    }

    // Step 2: Rate limit check
    if (!this.checkRateLimit()) {
      this.skippedByRateLimit++;
      console.log(`[Analyzer] ⏳ RATE LIMITED: ${token.symbol} (${this.analysisTimestamps.length}/${MAX_ANALYSES_PER_MINUTE} per min)`);
      return this.createDecision(token, false, 'Rate limited - too many requests', 100);
    }

    // Step 3: Make API call
    console.log(`[Analyzer] 🔍 Analyzing ${token.symbol} (${token.address})...`);

    try {
      // Call ArgusGuard API
      const response = await fetch(`${ARGUSGUARD_API}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress: token.address,
          forceRefresh: true, // Always get fresh analysis for sniping
        }),
      });

      // Record this analysis for rate limiting
      this.recordAnalysis();

      if (!response.ok) {
        return this.createDecision(token, false, 'API request failed', 100);
      }

      const analysis = await response.json();
      const riskScore = analysis.riskScore || 100;

      // Check against config thresholds
      if (riskScore > this.config.maxRiskScore) {
        return this.createDecision(
          token,
          false,
          `Risk score ${riskScore} exceeds max ${this.config.maxRiskScore}`,
          riskScore,
          analysis
        );
      }

      // Check liquidity
      if (token.liquidityUsd < this.config.minLiquidityUsd) {
        return this.createDecision(
          token,
          false,
          `Liquidity $${token.liquidityUsd} below min $${this.config.minLiquidityUsd}`,
          riskScore,
          analysis
        );
      }

      // All checks passed - SNIPE!
      return this.createDecision(
        token,
        true,
        `SAFE - Risk score ${riskScore}, liquidity $${token.liquidityUsd}`,
        riskScore,
        analysis
      );
    } catch (error) {
      console.error(`[Analyzer] Error analyzing ${token.symbol}:`, error);
      return this.createDecision(token, false, `Analysis error: ${error}`, 100);
    }
  }

  private createDecision(
    token: NewTokenEvent,
    shouldBuy: boolean,
    reason: string,
    riskScore: number,
    analysis?: any
  ): SnipeDecision {
    const decision: SnipeDecision = {
      token,
      shouldBuy,
      reason,
      riskScore,
    };

    if (analysis) {
      decision.analysis = {
        flags: analysis.flags?.map((f: any) => f.message) || [],
        summary: analysis.summary || '',
      };
    }

    console.log(`[Analyzer] Decision: ${shouldBuy ? '✅ BUY' : '❌ SKIP'} - ${reason}`);
    return decision;
  }

  updateConfig(config: Partial<SniperConfig>) {
    this.config = { ...this.config, ...config };
  }
}
