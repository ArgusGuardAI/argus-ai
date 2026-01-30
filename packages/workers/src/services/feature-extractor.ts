/**
 * Feature Extractor for CPU-Based Inference
 *
 * Compresses raw token data into dense numerical features for efficient
 * CPU-based model inference. Reduces megabytes of raw data to ~200 bytes.
 *
 * Design principles:
 * - All features normalized to 0-1 range (or -1 to 1 for signed)
 * - Log-scaling for values with large ranges (market cap, volume)
 * - Binary flags as 0/1
 * - Temporal decay for time-sensitive features
 */

import { SentinelDataResult, SentinelHolderInfo } from './sentinel-data';
import { TokenAnalysisInput } from './ai-provider';

// ============================================
// COMPRESSED FEATURE INTERFACE
// ============================================

/**
 * Dense feature vector for model inference
 * Total: ~25 features (100 bytes as Float32Array)
 */
export interface CompressedFeatures {
  // Market features (5 floats)
  market: {
    liquidityLog: number;        // log10(liquidity)/8, normalized 0-1
    volumeToLiquidity: number;   // vol/liquidity ratio, capped at 1
    marketCapLog: number;        // log10(mcap)/10, normalized 0-1
    priceVelocity: number;       // 24h change normalized -1 to 1
    volumeLog: number;           // log10(volume)/8, normalized 0-1
  };

  // Holder features (6 floats)
  holders: {
    countLog: number;            // log10(count)/4, normalized 0-1
    top10Concentration: number;  // % held by top 10, 0-1
    giniCoefficient: number;     // 0-1, higher = more concentrated
    freshWalletRatio: number;    // % of holders with no history, 0-1
    whaleCount: number;          // count/10, capped at 1
    topWhalePercent: number;     // largest holder %, 0-1
  };

  // Security features (4 binary: 0 or 1)
  security: {
    mintDisabled: number;
    freezeDisabled: number;
    lpLocked: number;            // 1 if >50% locked
    lpBurned: number;            // 1 if burned
  };

  // Bundle/coordination features (5 floats)
  bundle: {
    detected: number;            // 0 or 1
    countNorm: number;           // count/50, capped at 1
    controlPercent: number;      // % of supply, 0-1
    confidenceScore: number;     // HIGH=1, MED=0.66, LOW=0.33, NONE=0
    qualityScore: number;        // legitimacy score 0-1
  };

  // Trading behavior (4 floats)
  trading: {
    buyRatio24h: number;         // buys/(buys+sells), 0-1
    buyRatio1h: number;          // buys/(buys+sells), 0-1
    activityLevel: number;       // log10(total_txns)/4, 0-1
    momentum: number;            // 1h ratio - 24h ratio, -1 to 1
  };

  // Time features (2 floats)
  time: {
    ageDecay: number;            // e^(-age/24), 1=new, 0=old
    tradingRecency: number;      // 1 if traded in last hour, decays
  };

  // Creator risk (3 floats)
  creator: {
    identified: number;          // 0 or 1
    rugHistory: number;          // rugged_tokens/5, capped at 1
    holdingsPercent: number;     // current holdings, 0-1
  };
}

/**
 * Flat array representation for direct model input
 * Order matters - must match model training order
 */
export type FeatureVector = Float32Array;

// ============================================
// NORMALIZATION CONSTANTS
// ============================================

const CONSTANTS = {
  // Log scale denominators (for 0-1 normalization)
  LIQUIDITY_LOG_MAX: 8,      // $100M = 10^8
  VOLUME_LOG_MAX: 8,         // $100M
  MCAP_LOG_MAX: 10,          // $10B = 10^10
  HOLDER_LOG_MAX: 4,         // 10,000 holders = 10^4
  ACTIVITY_LOG_MAX: 4,       // 10,000 txns = 10^4

  // Caps for linear scaling
  BUNDLE_COUNT_CAP: 50,
  WHALE_COUNT_CAP: 10,
  RUG_HISTORY_CAP: 5,

  // Time decay constants
  AGE_DECAY_HOURS: 24,       // Half-life for age decay
  RECENCY_DECAY_HOURS: 1,    // Half-life for recency

  // Thresholds
  LP_LOCKED_THRESHOLD: 50,   // % to consider "locked"
  WHALE_THRESHOLD: 10,       // % to consider a whale
};

// ============================================
// FEATURE EXTRACTION FUNCTIONS
// ============================================

/**
 * Normalize value using log10 scale
 */
function logNorm(value: number, maxLog: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log10(value + 1) / maxLog);
}

/**
 * Normalize value linearly with cap
 */
function linearNorm(value: number, cap: number): number {
  return Math.min(1, Math.max(0, value / cap));
}

/**
 * Exponential decay for time-based features
 */
function expDecay(hours: number, halfLife: number): number {
  return Math.exp(-hours / halfLife);
}

/**
 * Encode confidence level to numeric
 */
function encodeConfidence(conf: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | string): number {
  switch (conf) {
    case 'HIGH': return 1;
    case 'MEDIUM': return 0.66;
    case 'LOW': return 0.33;
    default: return 0;
  }
}

/**
 * Calculate Gini coefficient for holder distribution
 * 0 = perfectly equal, 1 = one holder has everything
 */
function calculateGini(holders: SentinelHolderInfo[]): number {
  if (holders.length <= 1) return 0;

  // Sort by percent ascending
  const sorted = holders.map(h => h.percent).sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;

  if (mean === 0) return 0;

  // Gini = (2 * sum of (i * x[i])) / (n * sum of x[i]) - (n + 1) / n
  let sumIX = 0;
  let sumX = 0;
  for (let i = 0; i < n; i++) {
    sumIX += (i + 1) * sorted[i];
    sumX += sorted[i];
  }

  const gini = (2 * sumIX) / (n * sumX) - (n + 1) / n;
  return Math.min(1, Math.max(0, gini));
}

// ============================================
// MAIN EXTRACTION FUNCTIONS
// ============================================

/**
 * Extract compressed features from SentinelDataResult
 */
export function extractFromSentinelData(data: SentinelDataResult): CompressedFeatures {
  const { tokenInfo, holders, bundleInfo, creatorInfo } = data;

  // Calculate derived values
  const totalTxns24h = (tokenInfo.txns24h?.buys || 0) + (tokenInfo.txns24h?.sells || 0);
  const totalTxns1h = (tokenInfo.txns1h?.buys || 0) + (tokenInfo.txns1h?.sells || 0);
  const ageHours = tokenInfo.ageHours || 0;

  // Holder analysis
  const whales = holders.filter(h => h.percent > CONSTANTS.WHALE_THRESHOLD && !h.isLp);
  const top10Pct = holders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);

  return {
    market: {
      liquidityLog: logNorm(tokenInfo.liquidity, CONSTANTS.LIQUIDITY_LOG_MAX),
      volumeToLiquidity: tokenInfo.liquidity > 0
        ? Math.min(1, (tokenInfo.volume24h || 0) / tokenInfo.liquidity)
        : 0,
      marketCapLog: logNorm(tokenInfo.marketCap || 0, CONSTANTS.MCAP_LOG_MAX),
      priceVelocity: Math.max(-1, Math.min(1, (tokenInfo.priceChange24h || 0) / 100)),
      volumeLog: logNorm(tokenInfo.volume24h || 0, CONSTANTS.VOLUME_LOG_MAX),
    },

    holders: {
      countLog: logNorm(tokenInfo.holderCount, CONSTANTS.HOLDER_LOG_MAX),
      top10Concentration: Math.min(1, top10Pct / 100),
      giniCoefficient: calculateGini(holders),
      freshWalletRatio: 0, // Would need wallet age data
      whaleCount: linearNorm(whales.length, CONSTANTS.WHALE_COUNT_CAP),
      topWhalePercent: whales.length > 0
        ? Math.min(1, Math.max(...whales.map(w => w.percent)) / 100)
        : 0,
    },

    security: {
      mintDisabled: tokenInfo.mintAuthorityActive ? 0 : 1,
      freezeDisabled: tokenInfo.freezeAuthorityActive ? 0 : 1,
      lpLocked: tokenInfo.lpLockedPct >= CONSTANTS.LP_LOCKED_THRESHOLD ? 1 : 0,
      lpBurned: tokenInfo.lpLockedPct >= 100 ? 1 : 0,
    },

    bundle: {
      detected: bundleInfo.detected ? 1 : 0,
      countNorm: linearNorm(bundleInfo.count, CONSTANTS.BUNDLE_COUNT_CAP),
      controlPercent: Math.min(1, (bundleInfo.controlPercent || 0) / 100),
      confidenceScore: encodeConfidence(bundleInfo.confidence),
      qualityScore: 0.5, // Default neutral, would need bundle quality analysis
    },

    trading: {
      buyRatio24h: totalTxns24h > 0
        ? (tokenInfo.txns24h?.buys || 0) / totalTxns24h
        : 0.5,
      buyRatio1h: totalTxns1h > 0
        ? (tokenInfo.txns1h?.buys || 0) / totalTxns1h
        : 0.5,
      activityLevel: logNorm(totalTxns24h, CONSTANTS.ACTIVITY_LOG_MAX),
      momentum: 0, // Would calculate 1h vs 24h difference
    },

    time: {
      ageDecay: expDecay(ageHours, CONSTANTS.AGE_DECAY_HOURS),
      tradingRecency: totalTxns1h > 0 ? 1 : 0.5,
    },

    creator: {
      identified: creatorInfo ? 1 : 0,
      rugHistory: creatorInfo
        ? linearNorm(creatorInfo.ruggedTokens, CONSTANTS.RUG_HISTORY_CAP)
        : 0,
      holdingsPercent: creatorInfo
        ? Math.min(1, creatorInfo.currentHoldings / 100)
        : 0,
    },
  };
}

/**
 * Extract compressed features from TokenAnalysisInput
 */
export function extractFromAnalysisInput(input: TokenAnalysisInput): CompressedFeatures {
  const totalTxns24h = input.trading.buys24h + input.trading.sells24h;
  const totalTxns1h = input.trading.buys1h + input.trading.sells1h;

  return {
    market: {
      liquidityLog: logNorm(input.market.liquidity, CONSTANTS.LIQUIDITY_LOG_MAX),
      volumeToLiquidity: input.market.liquidity > 0
        ? Math.min(1, input.market.volume24h / input.market.liquidity)
        : 0,
      marketCapLog: logNorm(input.market.marketCap, CONSTANTS.MCAP_LOG_MAX),
      priceVelocity: Math.max(-1, Math.min(1, input.market.priceChange24h / 100)),
      volumeLog: logNorm(input.market.volume24h, CONSTANTS.VOLUME_LOG_MAX),
    },

    holders: {
      countLog: logNorm(input.holders.count, CONSTANTS.HOLDER_LOG_MAX),
      top10Concentration: Math.min(1, input.holders.top10Percent / 100),
      giniCoefficient: 0.5, // Not available from this input
      freshWalletRatio: 0,
      whaleCount: linearNorm(input.holders.whaleCount, CONSTANTS.WHALE_COUNT_CAP),
      topWhalePercent: Math.min(1, input.holders.topWhalePercent / 100),
    },

    security: {
      mintDisabled: input.security.mintRevoked ? 1 : 0,
      freezeDisabled: input.security.freezeRevoked ? 1 : 0,
      lpLocked: input.security.lpLockedPercent >= CONSTANTS.LP_LOCKED_THRESHOLD ? 1 : 0,
      lpBurned: input.security.lpLockedPercent >= 100 ? 1 : 0,
    },

    bundle: {
      detected: input.bundle.detected ? 1 : 0,
      countNorm: linearNorm(input.bundle.count, CONSTANTS.BUNDLE_COUNT_CAP),
      controlPercent: Math.min(1, input.bundle.controlPercent / 100),
      confidenceScore: encodeConfidence(input.bundle.confidence),
      qualityScore: input.bundle.qualityScore / 100,
    },

    trading: {
      buyRatio24h: totalTxns24h > 0 ? input.trading.buys24h / totalTxns24h : 0.5,
      buyRatio1h: totalTxns1h > 0 ? input.trading.buys1h / totalTxns1h : 0.5,
      activityLevel: logNorm(totalTxns24h, CONSTANTS.ACTIVITY_LOG_MAX),
      momentum: totalTxns24h > 0 && totalTxns1h > 0
        ? (input.trading.buys1h / totalTxns1h) - (input.trading.buys24h / totalTxns24h)
        : 0,
    },

    time: {
      ageDecay: expDecay(input.token.ageHours, CONSTANTS.AGE_DECAY_HOURS),
      tradingRecency: totalTxns1h > 0 ? 1 : 0.5,
    },

    creator: {
      identified: input.creator ? 1 : 0,
      rugHistory: input.creator
        ? linearNorm(input.creator.ruggedTokens, CONSTANTS.RUG_HISTORY_CAP)
        : 0,
      holdingsPercent: input.creator
        ? Math.min(1, input.creator.currentHoldingsPercent / 100)
        : 0,
    },
  };
}

// ============================================
// VECTOR CONVERSION
// ============================================

/**
 * Feature order for flat vector (must match model training)
 */
const FEATURE_ORDER = [
  // Market (5)
  'market.liquidityLog',
  'market.volumeToLiquidity',
  'market.marketCapLog',
  'market.priceVelocity',
  'market.volumeLog',
  // Holders (6)
  'holders.countLog',
  'holders.top10Concentration',
  'holders.giniCoefficient',
  'holders.freshWalletRatio',
  'holders.whaleCount',
  'holders.topWhalePercent',
  // Security (4)
  'security.mintDisabled',
  'security.freezeDisabled',
  'security.lpLocked',
  'security.lpBurned',
  // Bundle (5)
  'bundle.detected',
  'bundle.countNorm',
  'bundle.controlPercent',
  'bundle.confidenceScore',
  'bundle.qualityScore',
  // Trading (4)
  'trading.buyRatio24h',
  'trading.buyRatio1h',
  'trading.activityLevel',
  'trading.momentum',
  // Time (2)
  'time.ageDecay',
  'time.tradingRecency',
  // Creator (3)
  'creator.identified',
  'creator.rugHistory',
  'creator.holdingsPercent',
] as const;

export const FEATURE_COUNT = FEATURE_ORDER.length; // 29 features

/**
 * Convert CompressedFeatures to flat Float32Array for model input
 */
export function toFeatureVector(features: CompressedFeatures): FeatureVector {
  const vector = new Float32Array(FEATURE_COUNT);

  vector[0] = features.market.liquidityLog;
  vector[1] = features.market.volumeToLiquidity;
  vector[2] = features.market.marketCapLog;
  vector[3] = features.market.priceVelocity;
  vector[4] = features.market.volumeLog;

  vector[5] = features.holders.countLog;
  vector[6] = features.holders.top10Concentration;
  vector[7] = features.holders.giniCoefficient;
  vector[8] = features.holders.freshWalletRatio;
  vector[9] = features.holders.whaleCount;
  vector[10] = features.holders.topWhalePercent;

  vector[11] = features.security.mintDisabled;
  vector[12] = features.security.freezeDisabled;
  vector[13] = features.security.lpLocked;
  vector[14] = features.security.lpBurned;

  vector[15] = features.bundle.detected;
  vector[16] = features.bundle.countNorm;
  vector[17] = features.bundle.controlPercent;
  vector[18] = features.bundle.confidenceScore;
  vector[19] = features.bundle.qualityScore;

  vector[20] = features.trading.buyRatio24h;
  vector[21] = features.trading.buyRatio1h;
  vector[22] = features.trading.activityLevel;
  vector[23] = features.trading.momentum;

  vector[24] = features.time.ageDecay;
  vector[25] = features.time.tradingRecency;

  vector[26] = features.creator.identified;
  vector[27] = features.creator.rugHistory;
  vector[28] = features.creator.holdingsPercent;

  return vector;
}

/**
 * Convert flat vector back to CompressedFeatures (for debugging)
 */
export function fromFeatureVector(vector: FeatureVector): CompressedFeatures {
  return {
    market: {
      liquidityLog: vector[0],
      volumeToLiquidity: vector[1],
      marketCapLog: vector[2],
      priceVelocity: vector[3],
      volumeLog: vector[4],
    },
    holders: {
      countLog: vector[5],
      top10Concentration: vector[6],
      giniCoefficient: vector[7],
      freshWalletRatio: vector[8],
      whaleCount: vector[9],
      topWhalePercent: vector[10],
    },
    security: {
      mintDisabled: vector[11],
      freezeDisabled: vector[12],
      lpLocked: vector[13],
      lpBurned: vector[14],
    },
    bundle: {
      detected: vector[15],
      countNorm: vector[16],
      controlPercent: vector[17],
      confidenceScore: vector[18],
      qualityScore: vector[19],
    },
    trading: {
      buyRatio24h: vector[20],
      buyRatio1h: vector[21],
      activityLevel: vector[22],
      momentum: vector[23],
    },
    time: {
      ageDecay: vector[24],
      tradingRecency: vector[25],
    },
    creator: {
      identified: vector[26],
      rugHistory: vector[27],
      holdingsPercent: vector[28],
    },
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get human-readable feature summary
 */
export function getFeatureSummary(features: CompressedFeatures): string {
  const lines: string[] = [];

  // Market
  lines.push(`Market: liq=${(features.market.liquidityLog * 100).toFixed(0)}%, vol/liq=${(features.market.volumeToLiquidity * 100).toFixed(0)}%`);

  // Holders
  lines.push(`Holders: top10=${(features.holders.top10Concentration * 100).toFixed(0)}%, gini=${features.holders.giniCoefficient.toFixed(2)}`);

  // Security
  const secFlags = [];
  if (features.security.mintDisabled) secFlags.push('mint-off');
  if (features.security.freezeDisabled) secFlags.push('freeze-off');
  if (features.security.lpLocked) secFlags.push('lp-locked');
  lines.push(`Security: ${secFlags.length > 0 ? secFlags.join(', ') : 'none'}`);

  // Bundle
  if (features.bundle.detected) {
    lines.push(`Bundle: ${(features.bundle.countNorm * 50).toFixed(0)} wallets, ${(features.bundle.controlPercent * 100).toFixed(0)}% control`);
  }

  // Time
  lines.push(`Age: ${features.time.ageDecay < 0.5 ? 'old' : 'new'} (decay=${features.time.ageDecay.toFixed(2)})`);

  return lines.join(' | ');
}

/**
 * Calculate memory size of features
 */
export function getFeatureMemorySize(): { structured: number; vector: number } {
  return {
    structured: 29 * 8, // 29 floats as JS numbers (8 bytes each) = 232 bytes
    vector: FEATURE_COUNT * 4, // Float32Array = 116 bytes
  };
}

/**
 * Quantize features to Int8 for extreme compression (optional)
 * Reduces 116 bytes to 29 bytes
 */
export function quantizeToInt8(features: CompressedFeatures): Int8Array {
  const vector = toFeatureVector(features);
  const quantized = new Int8Array(FEATURE_COUNT);

  for (let i = 0; i < FEATURE_COUNT; i++) {
    // Map [-1, 1] or [0, 1] to [-127, 127]
    // For features that are 0-1: value * 254 - 127
    // For features that are -1 to 1: value * 127
    const isSignedFeature = i === 3 || i === 23; // priceVelocity, momentum
    if (isSignedFeature) {
      quantized[i] = Math.round(vector[i] * 127);
    } else {
      quantized[i] = Math.round(vector[i] * 254 - 127);
    }
  }

  return quantized;
}

/**
 * Dequantize Int8 back to Float32 (for inference)
 */
export function dequantizeFromInt8(quantized: Int8Array): FeatureVector {
  const vector = new Float32Array(FEATURE_COUNT);

  for (let i = 0; i < FEATURE_COUNT; i++) {
    const isSignedFeature = i === 3 || i === 23;
    if (isSignedFeature) {
      vector[i] = quantized[i] / 127;
    } else {
      vector[i] = (quantized[i] + 127) / 254;
    }
  }

  return vector;
}

// ============================================
// EXPORTS
// ============================================

export {
  CONSTANTS as FEATURE_CONSTANTS,
  FEATURE_ORDER,
  logNorm,
  linearNorm,
  expDecay,
  calculateGini,
};
