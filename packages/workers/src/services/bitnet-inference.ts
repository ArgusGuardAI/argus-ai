/**
 * BitNet Local Inference Service
 *
 * This service runs the trained BitNet model for local inference.
 * Uses compressed feature vectors for efficient CPU-based inference.
 *
 * Can be deployed as:
 * - Cloudflare Worker (with WASM model)
 * - VPS with GPU (for larger models)
 * - Edge deployment (Workers AI / similar)
 *
 * Current status: Rule-based fallback while model trains
 */

import { TokenAnalysisInput, TokenAnalysisOutput } from './ai-provider';
import {
  CompressedFeatures,
  FeatureVector,
  extractFromAnalysisInput,
  toFeatureVector,
  getFeatureSummary,
  FEATURE_COUNT,
} from './feature-extractor';

// ============================================
// MODEL CONFIGURATION
// ============================================

export interface BitNetModelConfig {
  // Model file path or URL
  modelPath: string;

  // Inference settings
  maxTokens?: number;
  temperature?: number;

  // Performance settings
  batchSize?: number;
  useFP16?: boolean;

  // Model type
  modelType: 'classifier' | 'generator';
}

// ============================================
// CLASSIFIER MODEL OUTPUT
// For direct score prediction without text generation
// ============================================

export interface ClassifierOutput {
  riskScore: number;          // 0-100
  confidence: number;         // 0-100
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';

  // Feature importance (which inputs contributed most)
  featureImportance: {
    bundle: number;           // 0-1
    holders: number;
    security: number;
    trading: number;
    creator: number;
    washTrading: number;
  };

  // Flag predictions
  flags: Array<{
    type: string;
    probability: number;      // 0-1
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>;
}

// ============================================
// BITNET INFERENCE ENGINE (Placeholder)
// ============================================

export class BitNetInferenceEngine {
  private config: BitNetModelConfig;
  private modelLoaded: boolean = false;

  // Cached feature data for debugging/logging
  private lastFeatures: CompressedFeatures | null = null;
  private lastVector: FeatureVector | null = null;

  constructor(config: BitNetModelConfig) {
    this.config = config;
  }

  /**
   * Load the model into memory
   * For WASM deployment, this loads the compiled model
   * For GPU deployment, this loads model weights
   */
  async loadModel(): Promise<void> {
    console.log(`[BitNet] Loading model from ${this.config.modelPath}...`);
    console.log(`[BitNet] Feature vector size: ${FEATURE_COUNT} floats (${FEATURE_COUNT * 4} bytes)`);

    // TODO: Implement actual model loading
    // For WASM:
    //   const wasmModule = await WebAssembly.instantiate(modelBuffer);
    //   this.model = wasmModule.instance;
    //
    // For GPU (using ONNX Runtime Web):
    //   const session = await ort.InferenceSession.create(this.config.modelPath);
    //   this.model = session;

    this.modelLoaded = true;
    console.log('[BitNet] Model loaded successfully');
  }

  /**
   * Run inference on input data using compressed features
   */
  async infer(input: TokenAnalysisInput): Promise<ClassifierOutput> {
    if (!this.modelLoaded) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    // Extract compressed features using new feature extractor
    const features = extractFromAnalysisInput(input);
    const vector = toFeatureVector(features);

    // Cache for debugging
    this.lastFeatures = features;
    this.lastVector = vector;

    // Log feature summary for debugging
    console.log(`[BitNet] Features: ${getFeatureSummary(features)}`);

    // TODO: Run actual model inference with vector
    // For now, use rule-based fallback with compressed features
    return this.ruleBasedFallbackFromFeatures(features, input);
  }

  /**
   * Get last extracted features (for debugging)
   */
  getLastFeatures(): CompressedFeatures | null {
    return this.lastFeatures;
  }

  /**
   * Get last feature vector (for debugging)
   */
  getLastVector(): FeatureVector | null {
    return this.lastVector;
  }

  /**
   * Rule-based inference using compressed features
   * Uses the efficient feature representation for decision making
   */
  private ruleBasedFallbackFromFeatures(features: CompressedFeatures, input: TokenAnalysisInput): ClassifierOutput {
    let score = 30; // Base score
    const flags: ClassifierOutput['flags'] = [];
    const importance = {
      bundle: 0,
      holders: 0,
      security: 0,
      trading: 0,
      creator: 0,
      washTrading: 0,
    };

    // Security checks (using compressed features)
    if (features.security.mintDisabled === 0) {
      score += 15;
      importance.security += 0.3;
      flags.push({ type: 'MINT_ACTIVE', probability: 1, severity: 'HIGH' });
    }
    if (features.security.freezeDisabled === 0) {
      score += 25;
      importance.security += 0.5;
      flags.push({ type: 'FREEZE_ACTIVE', probability: 1, severity: 'CRITICAL' });
    }

    // Bundle detection (using compressed features)
    if (features.bundle.detected === 1) {
      // Use quality score to determine penalty
      const bundlePenalty = features.bundle.qualityScore < 0.25 ? 35
        : features.bundle.qualityScore < 0.5 ? 25
        : features.bundle.qualityScore > 0.75 ? 5
        : 15;
      score += bundlePenalty;
      importance.bundle = bundlePenalty / 35;
      flags.push({
        type: 'BUNDLE',
        probability: features.bundle.confidenceScore,
        severity: bundlePenalty > 25 ? 'CRITICAL' : 'HIGH',
      });
    }

    // Wash trading (from original input since not in compressed)
    if (input.washTrading?.detected && input.washTrading.percent > 30) {
      const washPenalty = input.washTrading.percent >= 70 ? 30
        : input.washTrading.percent >= 50 ? 20
        : 10;
      score += washPenalty;
      importance.washTrading = washPenalty / 30;
      flags.push({
        type: 'WASH_TRADING',
        probability: Math.min(1, input.washTrading.percent / 100 + 0.3),
        severity: washPenalty > 20 ? 'CRITICAL' : 'HIGH',
      });
    }

    // Creator history (using compressed features)
    if (features.creator.rugHistory > 0) {
      score += 40;
      importance.creator = 0.8;
      flags.push({ type: 'SERIAL_RUGGER', probability: 1, severity: 'CRITICAL' });
    }

    // Whale concentration (using compressed features)
    if (features.holders.topWhalePercent > 0.5) {
      score += 25;
      importance.holders = 0.5;
      flags.push({ type: 'WHALE_DOMINANCE', probability: 1, severity: 'CRITICAL' });
    } else if (features.holders.topWhalePercent > 0.3) {
      score += 15;
      importance.holders = 0.3;
      flags.push({ type: 'WHALE_CONCENTRATION', probability: 0.8, severity: 'HIGH' });
    }

    // Age factor (using compressed time decay)
    // ageDecay > 0.75 means token is < 6 hours old
    if (features.time.ageDecay > 0.75) {
      score = Math.max(score, 45);
    }

    // Liquidity factor (using compressed market features)
    // liquidityLog < 0.5 roughly means < $10k liquidity
    if (features.market.liquidityLog < 0.5) {
      score = Math.max(score, 40);
    }

    // Cap and determine level
    score = Math.min(100, score);

    let riskLevel: ClassifierOutput['riskLevel'] = 'SAFE';
    if (score >= 80) riskLevel = 'SCAM';
    else if (score >= 60) riskLevel = 'DANGEROUS';
    else if (score >= 40) riskLevel = 'SUSPICIOUS';

    // Normalize feature importance
    const totalImportance = Object.values(importance).reduce((a, b) => a + b, 0) || 1;
    for (const key of Object.keys(importance) as Array<keyof typeof importance>) {
      importance[key] = importance[key] / totalImportance;
    }

    return {
      riskScore: score,
      confidence: 80, // Slightly higher confidence with better features
      riskLevel,
      featureImportance: importance,
      flags,
    };
  }

  /**
   * Convert classifier output to full analysis output
   */
  toAnalysisOutput(classifier: ClassifierOutput, input: TokenAnalysisInput): TokenAnalysisOutput {
    // Generate summary from classifier
    const summaryParts: string[] = [];

    if (classifier.flags.some(f => f.type === 'BUNDLE')) {
      summaryParts.push(`${input.bundle.count} coordinated wallets detected (${input.bundle.confidence} confidence)`);
    }
    if (classifier.flags.some(f => f.type === 'WHALE_DOMINANCE' || f.type === 'WHALE_CONCENTRATION')) {
      summaryParts.push(`top whale holds ${input.holders.topWhalePercent.toFixed(1)}%`);
    }
    if (classifier.flags.some(f => f.type === 'WASH_TRADING')) {
      summaryParts.push(`${input.washTrading?.percent?.toFixed(0)}% wash trading`);
    }
    if (classifier.flags.some(f => f.type === 'SERIAL_RUGGER')) {
      summaryParts.push(`creator has ${input.creator?.ruggedTokens} previous rugs`);
    }

    const summary = summaryParts.length > 0
      ? `Token shows ${classifier.riskLevel} risk: ${summaryParts.join(', ')}.`
      : `Token shows ${classifier.riskLevel} risk with score ${classifier.riskScore}/100.`;

    return {
      riskScore: classifier.riskScore,
      riskLevel: classifier.riskLevel,
      confidence: classifier.confidence,
      summary,
      prediction: this.generatePrediction(classifier, input),
      recommendation: this.generateRecommendation(classifier, input),
      flags: classifier.flags.map(f => ({
        type: f.type,
        severity: f.severity,
        message: this.flagMessage(f.type, input),
      })),
      networkInsights: this.generateInsights(classifier, input),
    };
  }

  private generatePrediction(classifier: ClassifierOutput, input: TokenAnalysisInput): string {
    const parts: string[] = [];

    // Bundle-based prediction
    if (input.bundle.detected) {
      const controlPct = input.bundle.controlPercent?.toFixed(1) || '0';
      if (input.bundle.qualityAssessment === 'VERY_SUSPICIOUS') {
        parts.push(`${input.bundle.count} coordinated wallets control ${controlPct}% — expect coordinated dump within hours`);
      } else if (input.bundle.qualityAssessment === 'SUSPICIOUS') {
        parts.push(`${input.bundle.count} wallets show coordination patterns — elevated dump risk`);
      } else if (input.bundle.confidence === 'HIGH') {
        parts.push(`${input.bundle.count} bundled wallets holding ${controlPct}% may exit together`);
      }
    }

    // Whale concentration prediction
    if (input.holders.topWhalePercent > 50) {
      parts.push(`Top wallet holds ${input.holders.topWhalePercent.toFixed(1)}% — single seller can crash price 50%+`);
    } else if (input.holders.topWhalePercent > 30) {
      parts.push(`${input.holders.topWhalePercent.toFixed(1)}% whale concentration creates dump vulnerability`);
    }

    // Security-based prediction
    if (!input.security.mintRevoked) {
      parts.push('Mint authority active — unlimited inflation possible');
    }
    if (!input.security.freezeRevoked) {
      parts.push('Freeze authority active — your tokens can be locked');
    }

    // Liquidity-based prediction
    if (input.market.liquidity < 5000) {
      parts.push(`Only $${input.market.liquidity.toLocaleString()} liquidity — large sells will cause massive slippage`);
    }

    // Creator history
    if (input.creator?.ruggedTokens && input.creator.ruggedTokens > 0) {
      parts.push(`Creator has ${input.creator.ruggedTokens} previous rugs — high repeat offender risk`);
    }

    // Age-based prediction
    if (input.token.ageHours < 6) {
      parts.push(`Token is ${input.token.ageHours.toFixed(1)}h old — too early for reliable pattern analysis`);
    }

    // Fallback based on score
    if (parts.length === 0) {
      if (classifier.riskScore >= 60) {
        return `Risk score ${classifier.riskScore}/100 indicates elevated manipulation probability. Price action likely driven by coordinated activity rather than organic demand.`;
      }
      if (classifier.riskScore >= 40) {
        return `Risk score ${classifier.riskScore}/100 shows mixed signals. Token has ${input.holders.count} holders with ${input.holders.top10Percent.toFixed(1)}% in top 10. Monitor for sudden holder changes.`;
      }
      return `Risk score ${classifier.riskScore}/100. Distribution appears reasonable with ${input.holders.count} holders. Standard volatility expected for memecoins.`;
    }

    return parts.slice(0, 2).join('. ') + '.';
  }

  private generateRecommendation(classifier: ClassifierOutput, input: TokenAnalysisInput): string {
    // Critical red flags - immediate avoid
    if (classifier.riskScore >= 80) {
      const reasons: string[] = [];
      if (input.bundle.detected && input.bundle.count >= 5) reasons.push(`${input.bundle.count} coordinated wallets`);
      if (input.holders.topWhalePercent > 50) reasons.push(`${input.holders.topWhalePercent.toFixed(0)}% whale`);
      if (input.creator?.ruggedTokens) reasons.push(`creator rugged ${input.creator.ruggedTokens} tokens`);
      if (!input.security.mintRevoked) reasons.push('mint authority active');
      const reasonStr = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';
      return `AVOID${reasonStr}. If holding, exit immediately. This token shows critical rug indicators.`;
    }

    // High risk - strong caution
    if (classifier.riskScore >= 60) {
      const warnings: string[] = [];
      if (input.bundle.detected) warnings.push(`${input.bundle.count} bundled wallets`);
      if (input.holders.topWhalePercent > 30) warnings.push(`${input.holders.topWhalePercent.toFixed(0)}% top holder`);
      if (input.market.liquidity < 10000) warnings.push(`$${(input.market.liquidity / 1000).toFixed(1)}K liquidity`);
      const warningStr = warnings.length > 0 ? `: ${warnings.join(', ')}` : '';
      return `HIGH RISK${warningStr}. If you trade, use max 0.1 SOL and set tight stop-loss. Expect sudden 50%+ drops.`;
    }

    // Moderate risk
    if (classifier.riskScore >= 40) {
      const notes: string[] = [];
      if (input.bundle.detected) notes.push(`${input.bundle.count} bundled wallets detected`);
      if (input.holders.top10Percent > 50) notes.push(`top 10 control ${input.holders.top10Percent.toFixed(0)}%`);
      if (input.token.ageHours < 24) notes.push(`only ${input.token.ageHours.toFixed(0)}h old`);
      const noteStr = notes.length > 0 ? ` Note: ${notes.join(', ')}.` : '';
      return `ELEVATED RISK. Proceed with caution and position size accordingly.${noteStr} Take profits early.`;
    }

    // Lower risk
    return `LOWER RISK (${classifier.riskScore}/100). No major red flags detected. ${input.holders.count} holders, ${input.security.mintRevoked ? 'mint revoked' : 'mint active'}, $${(input.market.liquidity / 1000).toFixed(1)}K LP. Always DYOR.`;
  }

  private flagMessage(type: string, input: TokenAnalysisInput): string {
    switch (type) {
      case 'BUNDLE':
        return `${input.bundle.count} coordinated wallets controlling ${input.bundle.controlPercent.toFixed(1)}% of supply`;
      case 'WASH_TRADING':
        return `${input.washTrading?.percent?.toFixed(0)}% of buys from bundle wallets`;
      case 'SERIAL_RUGGER':
        return `Creator has ${input.creator?.ruggedTokens} previous rugged tokens`;
      case 'WHALE_DOMINANCE':
        return `Single whale holds ${input.holders.topWhalePercent.toFixed(1)}% of supply`;
      case 'WHALE_CONCENTRATION':
        return `High concentration: top holder has ${input.holders.topWhalePercent.toFixed(1)}%`;
      case 'MINT_ACTIVE':
        return 'Mint authority active - creator can mint unlimited tokens';
      case 'FREEZE_ACTIVE':
        return 'Freeze authority active - can freeze/close your token account';
      default:
        return type;
    }
  }

  private generateInsights(classifier: ClassifierOutput, input: TokenAnalysisInput): string[] {
    const insights: string[] = [];

    // Top contributing factors
    const sortedFactors = Object.entries(classifier.featureImportance)
      .sort(([, a], [, b]) => b - a)
      .filter(([, v]) => v > 0.1);

    for (const [factor, weight] of sortedFactors.slice(0, 3)) {
      insights.push(`${factor} contributed ${(weight * 100).toFixed(0)}% to risk score`);
    }

    // Token age insight
    if (input.token.ageHours < 24) {
      insights.push(`Very new token (${input.token.ageHours.toFixed(1)} hours old)`);
    }

    // Liquidity insight
    if (input.market.liquidity < 5000) {
      insights.push(`Low liquidity ($${input.market.liquidity.toLocaleString()})`);
    }

    return insights;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

let engineInstance: BitNetInferenceEngine | null = null;

export async function getBitNetEngine(config: BitNetModelConfig): Promise<BitNetInferenceEngine> {
  if (!engineInstance) {
    engineInstance = new BitNetInferenceEngine(config);
    await engineInstance.loadModel();
  }
  return engineInstance;
}
