/**
 * Token Analyzer
 * Calls WhaleShield API to analyze tokens before sniping
 */

import type { NewTokenEvent, SnipeDecision, SniperConfig } from '../types';

const WHALESHIELD_API = process.env.WHALESHIELD_API_URL || 'https://whaleshield-api.workers.dev';

export class TokenAnalyzer {
  private config: SniperConfig;

  constructor(config: SniperConfig) {
    this.config = config;
  }

  async analyze(token: NewTokenEvent): Promise<SnipeDecision> {
    console.log(`[Analyzer] Analyzing ${token.symbol} (${token.address})...`);

    try {
      // Call WhaleShield API
      const response = await fetch(`${WHALESHIELD_API}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress: token.address,
          forceRefresh: true, // Always get fresh analysis for sniping
        }),
      });

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

      // Check blacklisted creators
      if (this.config.blacklistCreators.includes(token.creator)) {
        return this.createDecision(
          token,
          false,
          'Creator is blacklisted',
          riskScore,
          analysis
        );
      }

      // Check source filters
      if (token.source === 'pump.fun' && !this.config.allowPumpFun) {
        return this.createDecision(token, false, 'Pump.fun tokens disabled', riskScore, analysis);
      }

      if (token.source === 'raydium' && !this.config.allowRaydium) {
        return this.createDecision(token, false, 'Raydium tokens disabled', riskScore, analysis);
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
