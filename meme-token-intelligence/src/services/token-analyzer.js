/**
 * Token Analyzer Service
 * Combines all data sources to produce AI-powered trading signals
 */

import * as dexscreener from '../api/dexscreener.js';
import * as pumpfun from '../api/pumpfun.js';
import * as goplus from '../api/goplus-security.js';
import * as solana from '../api/solana-onchain.js';

/**
 * Signal types with their trading implications
 */
export const SIGNAL_TYPES = {
  STRONG_BUY: {
    type: 'STRONG_BUY',
    color: '#22c55e',
    description: 'High confidence entry - strong fundamentals + momentum',
    action: 'Consider entry with stop loss',
  },
  BUY: {
    type: 'BUY',
    color: '#4ade80',
    description: 'Positive setup - acceptable risk/reward',
    action: 'Entry opportunity with caution',
  },
  WATCH: {
    type: 'WATCH',
    color: '#facc15',
    description: 'Promising but needs confirmation',
    action: 'Add to watchlist, wait for better entry',
  },
  HOLD: {
    type: 'HOLD',
    color: '#94a3b8',
    description: 'Neutral - no clear signal',
    action: 'No action recommended',
  },
  SELL: {
    type: 'SELL',
    color: '#f97316',
    description: 'Momentum fading or risk increasing',
    action: 'Consider taking profits or exiting',
  },
  AVOID: {
    type: 'AVOID',
    color: '#ef4444',
    description: 'High risk detected - potential scam',
    action: 'Do not buy - likely rug pull',
  },
};

/**
 * Analyze a token and generate a trading signal
 */
export async function analyzeToken(tokenAddress, options = {}) {
  const { includePumpFun = true, includeOnChain = true, includeSecurity = true } = options;

  // Gather all data in parallel
  const [dexData, securityData, onChainData] = await Promise.all([
    dexscreener.getTokenByAddress(tokenAddress).catch(() => null),
    includeSecurity ? goplus.getTokenSecurity(tokenAddress).catch(() => null) : null,
    includeOnChain ? solana.performFullSecurityAudit(tokenAddress).catch(() => null) : null,
  ]);

  // Parse data
  const market = dexData ? dexscreener.parseDexScreenerPair(dexData) : null;
  const security = securityData ? goplus.parseSecurityData(securityData) : null;

  // Generate composite score
  const analysis = generateAnalysis(market, security, onChainData);

  return {
    address: tokenAddress,
    market,
    security,
    onChain: onChainData,
    analysis,
    signal: analysis.signal,
    timestamp: Date.now(),
  };
}

/**
 * Analyze a PumpFun token specifically
 */
export async function analyzePumpFunToken(mintAddress) {
  const [tokenDetails, trades, onChainData] = await Promise.all([
    pumpfun.getTokenDetails(mintAddress),
    pumpfun.getTokenTrades(mintAddress, 100),
    solana.analyzeTokenAuthorities(mintAddress).catch(() => null),
  ]);

  const token = pumpfun.parsePumpFunToken(tokenDetails);
  const tradePressure = pumpfun.analyzeTradePressure(trades);
  const graduationProb = pumpfun.estimateGraduationProbability(token, tradePressure);

  // Generate PumpFun-specific signal
  const signal = generatePumpFunSignal(token, tradePressure, graduationProb, onChainData);

  return {
    address: mintAddress,
    token,
    tradePressure,
    graduationProbability: graduationProb,
    onChain: onChainData,
    signal,
    platform: 'pumpfun',
    timestamp: Date.now(),
  };
}

/**
 * Generate analysis and signal for DEX tokens
 */
function generateAnalysis(market, security, onChain) {
  let score = 50; // Start neutral
  const factors = [];

  // === SECURITY FACTORS (Most Important) ===
  if (security) {
    if (security.riskLevel === 'critical') {
      return {
        score: 0,
        signal: SIGNAL_TYPES.AVOID,
        factors: security.riskFactors,
        reason: 'Critical security risks detected',
      };
    }

    score += (security.riskScore - 50) * 0.4; // Security is 40% of score

    if (security.riskScore >= 80) {
      factors.push('✅ Strong security profile');
    } else if (security.riskScore < 50) {
      factors.push('⚠️ Security concerns detected');
    }
  }

  // === ON-CHAIN FACTORS ===
  if (onChain) {
    if (onChain.details?.authorities?.mintAuthorityRevoked) {
      score += 5;
      factors.push('✅ Mint authority revoked');
    } else {
      score -= 10;
      factors.push('⚠️ Mint authority active');
    }

    if (onChain.details?.holders?.isSingleWhale) {
      score -= 20;
      factors.push('🚨 Single whale detected');
    }
  }

  // === MARKET FACTORS ===
  if (market) {
    // Volume analysis
    if (market.volume24h > 100000) {
      score += 10;
      factors.push('✅ Strong 24h volume');
    } else if (market.volume24h < 10000) {
      score -= 5;
      factors.push('⚠️ Low trading volume');
    }

    // Liquidity check
    if (market.liquidity > 50000) {
      score += 10;
      factors.push('✅ Good liquidity depth');
    } else if (market.liquidity < 10000) {
      score -= 15;
      factors.push('⚠️ Low liquidity (high slippage risk)');
    }

    // Momentum
    if (market.priceChange1h > 20) {
      score += 5;
      factors.push('📈 Strong short-term momentum');
    } else if (market.priceChange1h < -20) {
      score -= 10;
      factors.push('📉 Negative momentum');
    }

    // Buy/sell ratio
    const buyRatio = market.txns1h.buys / (market.txns1h.buys + market.txns1h.sells || 1);
    if (buyRatio > 0.6) {
      score += 5;
      factors.push('✅ More buyers than sellers');
    } else if (buyRatio < 0.4) {
      score -= 10;
      factors.push('⚠️ Sell pressure detected');
    }
  }

  // Normalize score
  score = Math.max(0, Math.min(100, score));

  // Determine signal
  let signal;
  if (score >= 80) signal = SIGNAL_TYPES.STRONG_BUY;
  else if (score >= 65) signal = SIGNAL_TYPES.BUY;
  else if (score >= 50) signal = SIGNAL_TYPES.WATCH;
  else if (score >= 35) signal = SIGNAL_TYPES.HOLD;
  else if (score >= 20) signal = SIGNAL_TYPES.SELL;
  else signal = SIGNAL_TYPES.AVOID;

  return {
    score,
    signal,
    factors,
    reason: generateReason(signal, factors),
  };
}

/**
 * Generate signal specifically for PumpFun bonding curve tokens
 */
function generatePumpFunSignal(token, tradePressure, graduationProb, onChain) {
  let score = 50;
  const factors = [];

  // === GRADUATION POTENTIAL (Key metric for PumpFun) ===
  if (graduationProb >= 80) {
    score += 25;
    factors.push(`🚀 ${graduationProb}% graduation probability`);
  } else if (graduationProb >= 60) {
    score += 15;
    factors.push(`📈 ${graduationProb}% graduation probability`);
  } else if (graduationProb < 30) {
    score -= 15;
    factors.push(`⚠️ Low graduation chance (${graduationProb}%)`);
  }

  // === BONDING CURVE POSITION ===
  if (token.nearGraduation) {
    score += 20;
    factors.push('🎯 Near graduation threshold');
  } else if (token.bondingCurveProgress < 20) {
    score -= 10;
    factors.push('⚠️ Very early - high failure risk');
  }

  // === TRADE PRESSURE ===
  if (tradePressure.sentiment === 'bullish') {
    score += 15;
    factors.push(`✅ Bullish pressure (${(tradePressure.buyPressure * 100).toFixed(0)}% buys)`);
  } else if (tradePressure.sentiment === 'bearish') {
    score -= 20;
    factors.push(`📉 Bearish pressure (${(tradePressure.sellPressure * 100).toFixed(0)}% sells)`);
  }

  // === TOKEN AGE ===
  if (token.ageMinutes < 5) {
    score -= 15;
    factors.push('⚠️ Very new (<5 min) - extreme risk');
  } else if (token.ageMinutes > 60) {
    score += 5;
    factors.push('✅ Survived >1 hour');
  }

  // === COMMUNITY ===
  if (token.replyCount > 50) {
    score += 10;
    factors.push('✅ Active community discussion');
  }

  // === ON-CHAIN CHECKS ===
  if (onChain) {
    if (!onChain.mintAuthorityRevoked) {
      // Note: PumpFun tokens typically have mint authority for the bonding curve
      factors.push('ℹ️ Mint authority active (normal for PumpFun)');
    }
  }

  // Normalize
  score = Math.max(0, Math.min(100, score));

  // Signal determination for PumpFun (more aggressive thresholds)
  let signal;
  if (score >= 75 && token.nearGraduation) signal = SIGNAL_TYPES.STRONG_BUY;
  else if (score >= 65) signal = SIGNAL_TYPES.BUY;
  else if (score >= 45) signal = SIGNAL_TYPES.WATCH;
  else if (score >= 30) signal = SIGNAL_TYPES.HOLD;
  else signal = SIGNAL_TYPES.AVOID;

  return {
    type: signal.type,
    color: signal.color,
    score,
    factors,
    reason: generatePumpFunReason(token, signal, graduationProb),
    entryStrategy: generatePumpFunEntry(token, signal),
  };
}

/**
 * Generate human-readable reason for signal
 */
function generateReason(signal, factors) {
  const positives = factors.filter((f) => f.startsWith('✅')).length;
  const negatives = factors.filter((f) => f.startsWith('⚠️') || f.startsWith('🚨')).length;

  if (signal.type === 'STRONG_BUY') {
    return `Strong setup with ${positives} positive factors and solid security`;
  } else if (signal.type === 'BUY') {
    return `Favorable risk/reward with acceptable security profile`;
  } else if (signal.type === 'WATCH') {
    return `Mixed signals - monitor for clearer entry`;
  } else if (signal.type === 'HOLD') {
    return `Neutral stance - no compelling reason to act`;
  } else if (signal.type === 'SELL') {
    return `Deteriorating conditions - consider exit`;
  } else {
    return `${negatives} red flags detected - high scam probability`;
  }
}

function generatePumpFunReason(token, signal, graduationProb) {
  if (token.nearGraduation) {
    return `${token.bondingCurveProgress.toFixed(0)}% to graduation - ${graduationProb}% chance of success`;
  } else if (signal.type === 'AVOID') {
    return `High failure probability - most PumpFun tokens never graduate`;
  } else {
    return `Early stage (${token.bondingCurveProgress.toFixed(0)}% filled) - ${graduationProb}% graduation estimate`;
  }
}

function generatePumpFunEntry(token, signal) {
  if (signal.type === 'STRONG_BUY' || signal.type === 'BUY') {
    return {
      action: 'Buy on bonding curve',
      size: 'Small position (0.1-0.5 SOL max)',
      target: 'Sell 50% at graduation, hold rest for Raydium pump',
      stopLoss: 'Exit if bonding curve progress stalls for >30 min',
    };
  } else if (signal.type === 'WATCH') {
    return {
      action: 'Wait for >70% bonding curve fill',
      size: 'N/A',
      target: 'Re-evaluate at higher fill %',
      stopLoss: 'N/A',
    };
  }
  return null;
}

/**
 * Scan for opportunities across multiple sources
 */
export async function scanForOpportunities(options = {}) {
  const { includePumpFun = true, includeDex = true, minScore = 60 } = options;

  const opportunities = [];

  // Scan PumpFun for tokens near graduation
  if (includePumpFun) {
    try {
      const nearGraduation = await pumpfun.getTokensAboutToGraduate(20);
      for (const token of nearGraduation.slice(0, 10)) {
        const analysis = await analyzePumpFunToken(token.mint);
        if (analysis.signal.score >= minScore) {
          opportunities.push({
            source: 'pumpfun',
            ...analysis,
          });
        }
      }
    } catch (e) {
      console.error('PumpFun scan error:', e);
    }
  }

  // Scan DEX for trending tokens
  if (includeDex) {
    try {
      const trending = await dexscreener.getTrendingTokens();
      for (const token of trending.slice(0, 10)) {
        const analysis = await analyzeToken(token.tokenAddress);
        if (analysis.analysis.score >= minScore) {
          opportunities.push({
            source: 'dex',
            ...analysis,
          });
        }
      }
    } catch (e) {
      console.error('DEX scan error:', e);
    }
  }

  // Sort by score
  return opportunities.sort((a, b) => {
    const scoreA = a.signal?.score || a.analysis?.score || 0;
    const scoreB = b.signal?.score || b.analysis?.score || 0;
    return scoreB - scoreA;
  });
}
