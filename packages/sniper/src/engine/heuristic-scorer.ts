/**
 * Heuristic Scoring System
 * Fast, FREE scoring based on market data and on-chain checks
 *
 * Score Range: 0-100
 * - 75+: STRONG_BUY
 * - 60-74: BUY
 * - 45-59: WATCH
 * - 30-44: HOLD
 * - <30: AVOID
 */

import type { NewTokenEvent } from '../types';
import type { OnChainData } from './onchain-security';

export type SignalType = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'AVOID';

export interface HeuristicResult {
  score: number;
  signal: SignalType;
  factors: string[];
  breakdown: {
    security: number;
    liquidity: number;
    volume: number;
    momentum: number;
    activity: number;
  };
}

export type { OnChainData };

/**
 * Calculate heuristic score for a token
 * Combines market data with on-chain security checks
 */
export function calculateHeuristicScore(
  token: NewTokenEvent,
  onChain?: OnChainData | null
): HeuristicResult {
  let score = 0;
  const factors: string[] = [];
  const breakdown = {
    security: 0,
    liquidity: 0,
    volume: 0,
    momentum: 0,
    activity: 0,
  };

  // ========================================
  // SECURITY (Max 40 points)
  // ========================================
  if (onChain) {
    // Mint authority (15 points)
    if (onChain.mintAuthorityRevoked) {
      breakdown.security += 15;
      factors.push('✅ Mint authority revoked');
    } else {
      factors.push('⚠️ Mint authority active');
    }

    // Freeze authority (10 points)
    if (onChain.freezeAuthorityRevoked) {
      breakdown.security += 10;
      factors.push('✅ Freeze authority revoked');
    } else {
      factors.push('⚠️ Freeze authority active');
    }

    // Holder concentration - CRITICAL for rug detection
    // If one wallet holds most tokens, they can dump anytime
    if (onChain.topHolderPercent >= 70) {
      breakdown.security -= 30;
      factors.push('🚨 DEV HOLDS 70%+ - WILL RUG');
    } else if (onChain.topHolderPercent >= 50) {
      breakdown.security -= 20;
      factors.push('🚨 Single wallet >50% - HIGH RUG RISK');
    } else if (onChain.topHolderPercent >= 30) {
      breakdown.security -= 5;
      factors.push('⚠️ High concentration >30%');
    } else if (onChain.topHolderPercent < 15) {
      breakdown.security += 15;
      factors.push('✅ Well distributed <15%');
    } else {
      breakdown.security += 8;
      factors.push('✅ Decent distribution');
    }

    // Holder count - few holders = easy to manipulate
    if (onChain.holderCount >= 200) {
      breakdown.security += 5;
      factors.push('✅ Many holders');
    } else if (onChain.holderCount >= 50) {
      breakdown.security += 2;
    } else if (onChain.holderCount < 20) {
      breakdown.security -= 10;
      factors.push('🚨 Very few holders - easy to rug');
    } else {
      breakdown.security -= 3;
      factors.push('⚠️ Few holders');
    }
  } else {
    // No on-chain data - give partial score
    breakdown.security = 15;
    factors.push('ℹ️ On-chain data unavailable');
  }

  // ========================================
  // LIQUIDITY (Max 20 points, Min -30 points)
  // CRITICAL: Small caps are EXTREMELY risky for rugs
  // ========================================
  const liquidity = token.liquidityUsd || 0;
  const marketCap = token.initialMarketCap || liquidity;

  if (marketCap < 10000) {
    // TINY CAP - extremely high rug risk, almost always dev dumps
    breakdown.liquidity = -30;
    factors.push('🚨 TINY CAP <$10K - EXTREME RUG RISK');
  } else if (marketCap < 25000) {
    // Very small - high rug risk
    breakdown.liquidity = -15;
    factors.push('🚨 Small cap <$25K - high rug risk');
  } else if (marketCap < 50000) {
    // Small - elevated risk
    breakdown.liquidity = -5;
    factors.push('⚠️ Small cap <$50K');
  } else if (liquidity >= 100000) {
    breakdown.liquidity = 20;
    factors.push('✅ Strong liquidity >$100k');
  } else if (liquidity >= 50000) {
    breakdown.liquidity = 15;
    factors.push('✅ Good liquidity >$50k');
  } else if (liquidity >= 25000) {
    breakdown.liquidity = 10;
    factors.push('⚠️ Moderate liquidity');
  } else {
    breakdown.liquidity = 0;
    factors.push('⚠️ Low liquidity');
  }

  // ========================================
  // VOLUME (Max 15 points)
  // ========================================
  const volume = token.volume24h || token.volume1h || 0;
  if (volume >= 100000) {
    breakdown.volume = 15;
    factors.push('✅ High volume >$100k');
  } else if (volume >= 30000) {
    breakdown.volume = 10;
    factors.push('✅ Good volume');
  } else if (volume >= 5000) {
    breakdown.volume = 5;
  } else {
    factors.push('⚠️ Low volume');
  }

  // ========================================
  // MOMENTUM (Max 15 points)
  // ========================================
  const priceChange1h = token.priceChange1h || 0;
  const priceChange5m = (token as any).priceChange5m || 0;

  // Pump & dump filter
  if (priceChange1h > 500 || priceChange5m > 200) {
    breakdown.momentum = -20;
    factors.push('🚨 Pump detected - likely manipulation');
  } else if (priceChange1h >= 10 && priceChange1h <= 100) {
    breakdown.momentum = 15;
    factors.push('🚀 Strong momentum +' + priceChange1h.toFixed(0) + '%');
  } else if (priceChange1h >= 0 && priceChange1h < 10) {
    breakdown.momentum = 8;
    factors.push('📈 Positive momentum');
  } else if (priceChange1h >= -20 && priceChange1h < 0) {
    breakdown.momentum = 5;
    factors.push('📉 Slight dip (buy opportunity?)');
  } else if (priceChange1h < -20) {
    breakdown.momentum = -5;
    factors.push('📉 Dumping ' + priceChange1h.toFixed(0) + '%');
  }

  // ========================================
  // ACTIVITY / BUY-SELL RATIO (Max 10 points)
  // ========================================
  const buys = token.buys1h || 0;
  const sells = token.sells1h || 0;
  const total = buys + sells;

  if (total > 0) {
    const buyRatio = buys / total;
    if (buyRatio > 0.65) {
      breakdown.activity = 10;
      factors.push('✅ Strong buying pressure');
    } else if (buyRatio > 0.55) {
      breakdown.activity = 7;
      factors.push('✅ More buyers than sellers');
    } else if (buyRatio > 0.45) {
      breakdown.activity = 5;
      factors.push('⚖️ Balanced activity');
    } else if (buyRatio > 0.35) {
      breakdown.activity = 2;
      factors.push('⚠️ Sell pressure');
    } else {
      breakdown.activity = -5;
      factors.push('🚨 Heavy selling');
    }
  }

  // ========================================
  // CALCULATE TOTAL SCORE
  // ========================================
  score = Math.max(0, Math.min(100,
    breakdown.security +
    breakdown.liquidity +
    breakdown.volume +
    breakdown.momentum +
    breakdown.activity
  ));

  // Determine signal
  const signal = scoreToSignal(score);

  return {
    score,
    signal,
    factors,
    breakdown,
  };
}

/**
 * Convert numeric score to signal type
 */
export function scoreToSignal(score: number): SignalType {
  if (score >= 75) return 'STRONG_BUY';
  if (score >= 60) return 'BUY';
  if (score >= 45) return 'WATCH';
  if (score >= 30) return 'HOLD';
  return 'AVOID';
}

/**
 * Get signal color for UI
 */
export function getSignalColor(signal: SignalType): string {
  switch (signal) {
    case 'STRONG_BUY': return '#22c55e';
    case 'BUY': return '#4ade80';
    case 'WATCH': return '#eab308';
    case 'HOLD': return '#6b7280';
    case 'AVOID': return '#ef4444';
  }
}

/**
 * Get AI tier based on score
 * - Score >= 50: Full AI analysis
 * - Score 30-49: Quick AI check
 * - Score < 30: Skip AI (AVOID)
 */
export function getAITier(score: number): 'full' | 'quick' | 'skip' {
  if (score >= 50) return 'full';
  if (score >= 30) return 'quick';
  return 'skip';
}
