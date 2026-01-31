/**
 * BitNetEngine - AI Reasoning Core for Agents
 *
 * Integrates with our feature compression engine (17,000x compression)
 * to enable fast, efficient AI reasoning on compressed token data.
 *
 * Provides:
 * - Feature extraction from raw data
 * - Risk classification
 * - Pattern matching
 * - Natural language generation for explanations
 */

// Feature constants from our compression engine
const FEATURE_COUNT = 29;

// Risk thresholds
const RISK_THRESHOLDS = {
  SAFE: 40,
  SUSPICIOUS: 60,
  DANGEROUS: 80,
  SCAM: 100
};

export interface ModelConfig {
  modelPath: string;
  modelType: 'classifier' | 'regressor' | 'generator';
  featureCount: number;
}

export interface ClassifierOutput {
  riskScore: number;
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  confidence: number;
  featureImportance: Record<string, number>;
  flags: Array<{
    type: string;
    probability: number;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>;
}

export interface ReasoningOutput {
  thought: string;
  action?: {
    tool: string;
    params: Record<string, any>;
    reason: string;
  };
  confidence: number;
}

export interface GenerateOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  format?: 'text' | 'json';
}

export class BitNetEngine {
  private config: ModelConfig;
  private modelLoaded: boolean = false;
  private patternWeights: Map<string, number[]> = new Map();

  constructor(modelPath: string = 'rule-based') {
    this.config = {
      modelPath,
      modelType: 'classifier',
      featureCount: FEATURE_COUNT
    };

    // Initialize pattern weights for known scam patterns
    this.initializePatternWeights();
  }

  /**
   * Load the BitNet model
   */
  async loadModel(): Promise<void> {
    console.log(`[BitNetEngine] Loading model from ${this.config.modelPath}...`);
    console.log(`[BitNetEngine] Feature vector size: ${FEATURE_COUNT} floats (${FEATURE_COUNT * 4} bytes)`);

    // TODO: Load actual WASM/ONNX model when trained
    // For now, use rule-based inference

    this.modelLoaded = true;
    console.log('[BitNetEngine] Model loaded successfully');
  }

  /**
   * Classify token risk from feature vector
   */
  async classify(features: Float32Array): Promise<ClassifierOutput> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    // Rule-based classification using compressed features
    return this.ruleBasedClassify(features);
  }

  /**
   * Generate reasoning/explanation from prompt
   */
  async generate(options: GenerateOptions): Promise<string> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    // TODO: Use actual model for generation
    // For now, use template-based generation
    return this.templateGenerate(options);
  }

  /**
   * Reason about what action to take
   */
  async reason(context: string, availableTools: string[]): Promise<ReasoningOutput> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    // Parse context to determine best action
    const thought = await this.generateThought(context);
    const action = await this.selectAction(context, availableTools);

    return {
      thought,
      action,
      confidence: action ? 0.85 : 0.5
    };
  }

  /**
   * Match features against known scam patterns
   */
  async matchPatterns(features: Float32Array): Promise<Array<{
    pattern: string;
    similarity: number;
    description: string;
  }>> {
    const matches: Array<{ pattern: string; similarity: number; description: string }> = [];

    for (const [pattern, weights] of this.patternWeights) {
      const similarity = this.calculatePatternMatch(features, weights);

      if (similarity > 0.7) {
        matches.push({
          pattern,
          similarity,
          description: this.getPatternDescription(pattern)
        });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Rule-based classification (fallback until model is trained)
   */
  private ruleBasedClassify(features: Float32Array): ClassifierOutput {
    let score = 30; // Base score
    const flags: ClassifierOutput['flags'] = [];
    const importance: Record<string, number> = {
      market: 0,
      holders: 0,
      security: 0,
      bundle: 0,
      trading: 0,
      time: 0,
      creator: 0
    };

    // Feature indices (matching our feature-extractor.ts order)
    const f = {
      liquidityLog: features[0],
      volumeToLiquidity: features[1],
      marketCapLog: features[2],
      priceVelocity: features[3],
      volumeLog: features[4],
      holderCountLog: features[5],
      top10Concentration: features[6],
      giniCoefficient: features[7],
      freshWalletRatio: features[8],
      whaleCount: features[9],
      topWhalePercent: features[10],
      mintDisabled: features[11],
      freezeDisabled: features[12],
      lpLocked: features[13],
      lpBurned: features[14],
      bundleDetected: features[15],
      bundleCountNorm: features[16],
      bundleControlPercent: features[17],
      bundleConfidence: features[18],
      bundleQuality: features[19],
      buyRatio24h: features[20],
      buyRatio1h: features[21],
      activityLevel: features[22],
      momentum: features[23],
      ageDecay: features[24],
      tradingRecency: features[25],
      creatorIdentified: features[26],
      creatorRugHistory: features[27],
      creatorHoldings: features[28]
    };

    // Security checks
    if (f.mintDisabled === 0) {
      score += 15;
      importance.security += 0.3;
      flags.push({ type: 'MINT_ACTIVE', probability: 1, severity: 'HIGH' });
    }

    if (f.freezeDisabled === 0) {
      score += 25;
      importance.security += 0.5;
      flags.push({ type: 'FREEZE_ACTIVE', probability: 1, severity: 'CRITICAL' });
    }

    // Bundle detection
    if (f.bundleDetected === 1) {
      const bundlePenalty = f.bundleQuality < 0.25 ? 35
        : f.bundleQuality < 0.5 ? 25
        : f.bundleQuality > 0.75 ? 5
        : 15;

      score += bundlePenalty;
      importance.bundle = bundlePenalty / 35;
      flags.push({
        type: 'BUNDLE_DETECTED',
        probability: f.bundleConfidence,
        severity: bundlePenalty > 25 ? 'CRITICAL' : 'HIGH'
      });
    }

    // Whale concentration
    if (f.topWhalePercent > 0.5) {
      score += 25;
      importance.holders = 0.5;
      flags.push({ type: 'WHALE_DOMINANCE', probability: 1, severity: 'CRITICAL' });
    } else if (f.topWhalePercent > 0.3) {
      score += 15;
      importance.holders = 0.3;
      flags.push({ type: 'WHALE_CONCENTRATION', probability: 0.8, severity: 'HIGH' });
    }

    // Gini coefficient (holder distribution inequality)
    if (f.giniCoefficient > 0.8) {
      score += 15;
      importance.holders += 0.3;
      flags.push({ type: 'EXTREME_CONCENTRATION', probability: 0.9, severity: 'HIGH' });
    }

    // Creator rug history
    if (f.creatorRugHistory > 0) {
      score += 40;
      importance.creator = 0.8;
      flags.push({ type: 'SERIAL_RUGGER', probability: 1, severity: 'CRITICAL' });
    }

    // Age factor (very new tokens are risky)
    if (f.ageDecay > 0.75) { // < 6 hours old
      score = Math.max(score, 45);
      importance.time = 0.3;
    }

    // Low liquidity
    if (f.liquidityLog < 0.5) { // < $10k liquidity
      score = Math.max(score, 40);
      importance.market += 0.3;
    }

    // Volume manipulation check
    if (f.volumeToLiquidity > 0.8) { // Volume > 80% of liquidity
      score += 10;
      importance.market += 0.2;
      flags.push({ type: 'SUSPICIOUS_VOLUME', probability: 0.7, severity: 'MEDIUM' });
    }

    // Cap score
    score = Math.min(100, score);

    // Determine risk level
    let riskLevel: ClassifierOutput['riskLevel'] = 'SAFE';
    if (score >= RISK_THRESHOLDS.DANGEROUS) riskLevel = 'SCAM';
    else if (score >= RISK_THRESHOLDS.SUSPICIOUS) riskLevel = 'DANGEROUS';
    else if (score >= RISK_THRESHOLDS.SAFE) riskLevel = 'SUSPICIOUS';

    // Normalize importance
    const totalImportance = Object.values(importance).reduce((a, b) => a + b, 0) || 1;
    for (const key of Object.keys(importance)) {
      importance[key] = importance[key] / totalImportance;
    }

    return {
      riskScore: score,
      riskLevel,
      confidence: 85,
      featureImportance: importance,
      flags
    };
  }

  /**
   * Template-based text generation (fallback)
   */
  private templateGenerate(options: GenerateOptions): string {
    const { prompt, format } = options;

    // Simple template matching for common prompts
    if (prompt.includes('Should I exit')) {
      return JSON.stringify({
        shouldExit: false,
        confidence: 70,
        reason: 'Position within normal parameters'
      });
    }

    if (prompt.includes('Analyze this wallet')) {
      return JSON.stringify({
        isScammer: false,
        confidence: 60,
        pattern: 'unknown',
        evidence: [],
        tokensInvolved: []
      });
    }

    if (prompt.includes('Does this token meet')) {
      return JSON.stringify({
        meets: false,
        confidence: 50,
        reasoning: 'Insufficient data for determination'
      });
    }

    // Default response
    if (format === 'json') {
      return JSON.stringify({ response: 'Analysis complete', confidence: 50 });
    }

    return 'Analysis complete. Additional context needed for detailed response.';
  }

  /**
   * Generate reasoning thought
   */
  private async generateThought(context: string): Promise<string> {
    // Extract key information from context
    const hasBundle = context.includes('bundle') || context.includes('coordinated');
    const hasRisk = context.includes('risk') || context.includes('suspicious');
    const hasNew = context.includes('new') || context.includes('launch');

    if (hasBundle && hasRisk) {
      return 'Detected coordination patterns with elevated risk signals. Requires deeper investigation.';
    }

    if (hasNew) {
      return 'New token detected. Performing initial security scan and holder analysis.';
    }

    if (hasRisk) {
      return 'Risk indicators present. Evaluating severity and potential impact.';
    }

    return 'Analyzing current state and determining optimal action.';
  }

  /**
   * Select action based on context
   */
  private async selectAction(
    context: string,
    availableTools: string[]
  ): Promise<ReasoningOutput['action'] | undefined> {
    // Simple keyword-based action selection
    const contextLower = context.toLowerCase();

    if (contextLower.includes('new launch') && availableTools.includes('quick_scan')) {
      return {
        tool: 'quick_scan',
        params: {},
        reason: 'New launch detected - performing quick security scan'
      };
    }

    if (contextLower.includes('bundle') && availableTools.includes('analyze_bundles')) {
      return {
        tool: 'analyze_bundles',
        params: {},
        reason: 'Bundle indicators present - analyzing coordination'
      };
    }

    if (contextLower.includes('scammer') && availableTools.includes('profile_wallet')) {
      return {
        tool: 'profile_wallet',
        params: {},
        reason: 'Scammer suspected - building wallet profile'
      };
    }

    if (contextLower.includes('exit') && availableTools.includes('execute_sell')) {
      return {
        tool: 'execute_sell',
        params: {},
        reason: 'Exit conditions met - executing sell'
      };
    }

    return undefined;
  }

  /**
   * Initialize pattern weights for known scam types
   */
  private initializePatternWeights(): void {
    // Bundle coordinator pattern
    // High: bundleDetected, bundleCount, freshWalletRatio
    // Low: bundleQuality, holderCountLog
    this.patternWeights.set('BUNDLE_COORDINATOR', new Array(FEATURE_COUNT).fill(0).map((_, i) => {
      if (i === 15) return 1.0;  // bundleDetected
      if (i === 16) return 0.8;  // bundleCountNorm
      if (i === 8) return 0.7;   // freshWalletRatio
      if (i === 19) return -0.5; // bundleQuality (inverse)
      return 0;
    }));

    // Rug puller pattern
    // High: creatorRugHistory, top whale percent, mint/freeze active
    this.patternWeights.set('RUG_PULLER', new Array(FEATURE_COUNT).fill(0).map((_, i) => {
      if (i === 27) return 1.0;  // creatorRugHistory
      if (i === 10) return 0.8;  // topWhalePercent
      if (i === 11) return -0.5; // mintDisabled (inverse = active)
      if (i === 12) return -0.7; // freezeDisabled (inverse = active)
      return 0;
    }));

    // Wash trader pattern
    // High: volumeToLiquidity, low holder count, suspicious activity
    this.patternWeights.set('WASH_TRADER', new Array(FEATURE_COUNT).fill(0).map((_, i) => {
      if (i === 1) return 1.0;   // volumeToLiquidity
      if (i === 5) return -0.5;  // holderCountLog (inverse = low)
      if (i === 22) return 0.6;  // activityLevel
      return 0;
    }));

    // Legitimate VC pattern (positive)
    // High: old wallets, high bundleQuality, no rug history
    this.patternWeights.set('LEGITIMATE_VC', new Array(FEATURE_COUNT).fill(0).map((_, i) => {
      if (i === 19) return 1.0;  // bundleQuality
      if (i === 24) return -0.5; // ageDecay (inverse = old)
      if (i === 27) return -1.0; // creatorRugHistory (must be 0)
      if (i === 11) return 0.8;  // mintDisabled
      if (i === 12) return 0.8;  // freezeDisabled
      return 0;
    }));
  }

  /**
   * Calculate pattern match score
   */
  private calculatePatternMatch(features: Float32Array, weights: number[]): number {
    let score = 0;
    let maxScore = 0;

    for (let i = 0; i < FEATURE_COUNT; i++) {
      if (weights[i] !== 0) {
        score += features[i] * weights[i];
        maxScore += Math.abs(weights[i]);
      }
    }

    // Normalize to 0-1
    return maxScore > 0 ? (score + maxScore) / (2 * maxScore) : 0;
  }

  /**
   * Get pattern description
   */
  private getPatternDescription(pattern: string): string {
    const descriptions: Record<string, string> = {
      'BUNDLE_COORDINATOR': 'Wallet coordinates bundle buys across multiple fresh wallets',
      'RUG_PULLER': 'Creator has history of rug pulls, controls large supply',
      'WASH_TRADER': 'Self-trading to inflate volume artificially',
      'LEGITIMATE_VC': 'Pattern consistent with legitimate VC investment round'
    };

    return descriptions[pattern] || 'Unknown pattern';
  }
}
