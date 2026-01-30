/**
 * BitNet Local Inference Service
 *
 * This service will run the trained BitNet model for local inference.
 * Can be deployed as:
 * - Cloudflare Worker (with WASM model)
 * - VPS with GPU (for larger models)
 * - Edge deployment (Workers AI / similar)
 *
 * Current status: PLACEHOLDER - awaiting model training
 */

import { TokenAnalysisInput, TokenAnalysisOutput } from './ai-provider';

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
   * Run inference on input data
   */
  async infer(input: TokenAnalysisInput): Promise<ClassifierOutput> {
    if (!this.modelLoaded) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    // Convert input to model feature vector
    const features = this.extractFeatures(input);

    // TODO: Run actual inference
    // For now, return a rule-based placeholder
    return this.ruleBasedFallback(input, features);
  }

  /**
   * Extract numerical features from input
   * This matches the training data format
   */
  private extractFeatures(input: TokenAnalysisInput): number[] {
    return [
      // Token age (normalized)
      Math.min(input.token.ageHours / 168, 1), // 0-1 over 7 days

      // Market features (log-scaled)
      Math.log10(Math.max(1, input.market.marketCap)) / 10,
      Math.log10(Math.max(1, input.market.liquidity)) / 8,
      Math.log10(Math.max(1, input.market.volume24h)) / 8,
      (input.market.priceChange24h + 100) / 200, // Normalize -100% to +100%

      // Security (binary)
      input.security.mintRevoked ? 1 : 0,
      input.security.freezeRevoked ? 1 : 0,
      input.security.lpLockedPercent / 100,

      // Trading ratios
      input.trading.buys24h / Math.max(1, input.trading.buys24h + input.trading.sells24h),
      Math.min(1, input.trading.buys24h / 1000), // Normalized buy count

      // Holder concentration
      Math.min(1, input.holders.count / 1000),
      input.holders.top10Percent / 100,
      input.holders.whaleCount / 10,
      input.holders.topWhalePercent / 100,

      // Bundle features
      input.bundle.detected ? 1 : 0,
      input.bundle.count / 50, // Normalized bundle count
      input.bundle.controlPercent / 100,
      input.bundle.qualityScore / 100,
      input.bundle.avgWalletAgeDays / 30, // Normalized over 30 days
      this.encodeConfidence(input.bundle.confidence),
      this.encodeAssessment(input.bundle.qualityAssessment),

      // Creator features
      input.creator ? 1 : 0,
      input.creator?.walletAgeDays ? Math.min(1, input.creator.walletAgeDays / 365) : 0,
      input.creator?.tokensCreated ? Math.min(1, input.creator.tokensCreated / 20) : 0,
      input.creator?.ruggedTokens ? Math.min(1, input.creator.ruggedTokens / 5) : 0,
      input.creator?.currentHoldingsPercent ? input.creator.currentHoldingsPercent / 100 : 0,

      // Dev activity
      input.devActivity?.hasSold ? 1 : 0,
      input.devActivity?.percentSold ? input.devActivity.percentSold / 100 : 0,
      input.devActivity?.currentHoldingsPercent ? input.devActivity.currentHoldingsPercent / 100 : 0,

      // Wash trading
      input.washTrading?.detected ? 1 : 0,
      input.washTrading?.percent ? input.washTrading.percent / 100 : 0,
    ];
  }

  private encodeConfidence(confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'): number {
    switch (confidence) {
      case 'HIGH': return 1;
      case 'MEDIUM': return 0.66;
      case 'LOW': return 0.33;
      case 'NONE': return 0;
    }
  }

  private encodeAssessment(assessment: 'LIKELY_LEGIT' | 'NEUTRAL' | 'SUSPICIOUS' | 'VERY_SUSPICIOUS'): number {
    switch (assessment) {
      case 'LIKELY_LEGIT': return 0;
      case 'NEUTRAL': return 0.33;
      case 'SUSPICIOUS': return 0.66;
      case 'VERY_SUSPICIOUS': return 1;
    }
  }

  /**
   * Rule-based fallback until model is trained
   * This mimics the current guardrails logic
   */
  private ruleBasedFallback(input: TokenAnalysisInput, _features: number[]): ClassifierOutput {
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

    // Security checks
    if (!input.security.mintRevoked) {
      score += 15;
      importance.security += 0.3;
      flags.push({ type: 'MINT_ACTIVE', probability: 1, severity: 'HIGH' });
    }
    if (!input.security.freezeRevoked) {
      score += 25;
      importance.security += 0.5;
      flags.push({ type: 'FREEZE_ACTIVE', probability: 1, severity: 'CRITICAL' });
    }

    // Bundle detection
    if (input.bundle.detected) {
      const bundlePenalty = input.bundle.qualityAssessment === 'VERY_SUSPICIOUS' ? 35
        : input.bundle.qualityAssessment === 'SUSPICIOUS' ? 25
        : input.bundle.qualityAssessment === 'LIKELY_LEGIT' ? 5
        : 15;
      score += bundlePenalty;
      importance.bundle = bundlePenalty / 35;
      flags.push({
        type: 'BUNDLE',
        probability: input.bundle.confidence === 'HIGH' ? 0.95 : input.bundle.confidence === 'MEDIUM' ? 0.7 : 0.5,
        severity: bundlePenalty > 25 ? 'CRITICAL' : 'HIGH',
      });
    }

    // Wash trading
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

    // Creator history
    if (input.creator?.ruggedTokens && input.creator.ruggedTokens > 0) {
      score += 40;
      importance.creator = 0.8;
      flags.push({ type: 'SERIAL_RUGGER', probability: 1, severity: 'CRITICAL' });
    }

    // Whale concentration
    if (input.holders.topWhalePercent > 50) {
      score += 25;
      importance.holders = 0.5;
      flags.push({ type: 'WHALE_DOMINANCE', probability: 1, severity: 'CRITICAL' });
    } else if (input.holders.topWhalePercent > 30) {
      score += 15;
      importance.holders = 0.3;
      flags.push({ type: 'WHALE_CONCENTRATION', probability: 0.8, severity: 'HIGH' });
    }

    // Age factor
    if (input.token.ageHours < 6) {
      score = Math.max(score, 45);
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
      confidence: 75, // Rule-based confidence
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
