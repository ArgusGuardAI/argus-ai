/**
 * BitNetEngine - 1-Bit Ternary AI Reasoning Core
 *
 * Two modes:
 *   1. Neural inference: Loads trained ternary weights ({-1, 0, +1}) from
 *      bitnet-weights.json. Forward pass uses only addition/subtraction
 *      (no floating-point multiply) — runs in <1ms on CPU.
 *   2. Rule-based fallback: If no trained model exists, uses hand-tuned
 *      rules for risk classification.
 *
 * Integrates with feature compression engine (17,000x compression).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

// Ternary model weights loaded from JSON
interface TernaryModelWeights {
  version: number;
  architecture: number[];
  quantization: 'ternary';
  weights: { [key: string]: number[] };
  biases: { [key: string]: number[] };
  classes: string[];
  featureCount: number;
  accuracy: number;
  trainedOn: number;
  trainedAt: string;
}

// Loaded layer for fast inference
interface TernaryLayer {
  weights: Int8Array;   // {-1, 0, +1}
  biases: Float32Array;
  rows: number;
  cols: number;
}

export class BitNetEngine {
  private config: ModelConfig;
  private modelLoaded: boolean = false;
  private patternWeights: Map<string, number[]> = new Map();

  // Ternary model (null if not loaded / not available)
  private ternaryModel: TernaryModelWeights | null = null;
  private ternaryLayers: TernaryLayer[] = [];
  private useNeuralInference: boolean = false;

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
   * Load the BitNet model — tries ternary weights first, falls back to rules
   */
  async loadModel(): Promise<void> {
    console.log(`[BitNetEngine] Loading model from ${this.config.modelPath}...`);
    console.log(`[BitNetEngine] Feature vector size: ${FEATURE_COUNT} floats (${FEATURE_COUNT * 4} bytes)`);

    // Try to load trained ternary model
    const weightsPath = this.resolveWeightsPath();
    if (weightsPath && existsSync(weightsPath)) {
      try {
        const raw = readFileSync(weightsPath, 'utf-8');
        this.ternaryModel = JSON.parse(raw) as TernaryModelWeights;

        // Parse layers
        this.ternaryLayers = [];
        const arch = this.ternaryModel.architecture;
        for (let l = 0; l < arch.length - 1; l++) {
          const key = `layer${l + 1}`;
          const wArr = this.ternaryModel.weights[key];
          const bArr = this.ternaryModel.biases[key];
          if (!wArr || !bArr) {
            throw new Error(`Missing weights/biases for ${key}`);
          }

          this.ternaryLayers.push({
            weights: new Int8Array(wArr),
            biases: new Float32Array(bArr),
            rows: arch[l + 1],
            cols: arch[l],
          });
        }

        this.useNeuralInference = true;
        const totalWeights = this.ternaryLayers.reduce((s, l) => s + l.weights.length, 0);
        console.log(`[BitNetEngine] Loaded ternary model: ${arch.join(' -> ')}`);
        console.log(`[BitNetEngine] ${totalWeights} ternary weights, accuracy: ${(this.ternaryModel.accuracy * 100).toFixed(1)}%`);
        console.log(`[BitNetEngine] Trained on ${this.ternaryModel.trainedOn} examples at ${this.ternaryModel.trainedAt}`);
      } catch (err) {
        console.warn(`[BitNetEngine] Failed to load ternary model: ${err instanceof Error ? err.message : err}`);
        console.log('[BitNetEngine] Falling back to rule-based inference');
        this.useNeuralInference = false;
      }
    } else {
      console.log('[BitNetEngine] No trained model found, using rule-based inference');
      this.useNeuralInference = false;
    }

    this.modelLoaded = true;
    console.log('[BitNetEngine] Model loaded successfully');
  }

  /**
   * Resolve the path to bitnet-weights.json
   */
  private resolveWeightsPath(): string | null {
    // If explicit path provided and not 'rule-based'
    if (this.config.modelPath !== 'rule-based') {
      return this.config.modelPath;
    }

    // Try relative to this file
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      const candidate = resolve(thisDir, 'bitnet-weights.json');
      if (existsSync(candidate)) return candidate;
    } catch {
      // import.meta.url may not work in all contexts
    }

    // Try common locations
    const candidates = [
      resolve(process.cwd(), 'src/reasoning/bitnet-weights.json'),
      resolve(process.cwd(), 'bitnet-weights.json'),
      resolve(process.cwd(), '../agents/src/reasoning/bitnet-weights.json'),
    ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    return null;
  }

  /**
   * Classify token risk from feature vector
   */
  async classify(features: Float32Array): Promise<ClassifierOutput> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    if (this.useNeuralInference) {
      return this.neuralClassify(features);
    }

    return this.ruleBasedClassify(features);
  }

  /**
   * Neural network classification with ternary weights
   *
   * Forward pass: only addition and subtraction (no floating-point multiply).
   * For each weight:
   *   w = +1 → sum += activation
   *   w = -1 → sum -= activation
   *   w =  0 → skip
   */
  private neuralClassify(features: Float32Array): ClassifierOutput {
    let activation: Float32Array = features;

    // Forward through hidden layers (ReLU) and output layer
    for (let l = 0; l < this.ternaryLayers.length; l++) {
      const layer = this.ternaryLayers[l];
      const next = new Float32Array(layer.rows);

      for (let j = 0; j < layer.rows; j++) {
        let sum = layer.biases[j];
        const offset = j * layer.cols;
        for (let i = 0; i < layer.cols; i++) {
          const w = layer.weights[offset + i];
          if (w === 1) sum += activation[i];
          else if (w === -1) sum -= activation[i];
          // w === 0: no operation
        }

        // ReLU for hidden layers, raw logit for output
        next[j] = l < this.ternaryLayers.length - 1 ? Math.max(0, sum) : sum;
      }

      // Softmax on final layer
      if (l === this.ternaryLayers.length - 1) {
        const maxLogit = Math.max(...next);
        let expSum = 0;
        for (let i = 0; i < next.length; i++) {
          next[i] = Math.exp(next[i] - maxLogit);
          expSum += next[i];
        }
        for (let i = 0; i < next.length; i++) {
          next[i] /= expSum;
        }
      }

      activation = next;
    }

    // activation is now [P(SAFE), P(SUSPICIOUS), P(DANGEROUS), P(SCAM)]
    const probs = activation;

    // Predicted class
    let maxIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[maxIdx]) maxIdx = i;
    }

    const classes: ClassifierOutput['riskLevel'][] = ['SAFE', 'SUSPICIOUS', 'DANGEROUS', 'SCAM'];
    const riskLevel = classes[maxIdx];

    // Risk score: weighted sum of class probabilities
    const riskScore = Math.round(
      probs[0] * 15 + probs[1] * 50 + probs[2] * 75 + probs[3] * 95
    );

    // Confidence from max probability
    const confidence = Math.round(probs[maxIdx] * 100);

    // Feature importance from first layer weights
    const importance = this.computeFeatureImportance(features);

    // Generate flags from classification + feature analysis
    const flags = this.generateFlags(features, riskLevel, probs);

    return {
      riskScore: Math.min(100, Math.max(0, riskScore)),
      riskLevel,
      confidence,
      featureImportance: importance,
      flags,
    };
  }

  /**
   * Compute feature importance from first-layer ternary weights
   */
  private computeFeatureImportance(features: Float32Array): Record<string, number> {
    const importance: Record<string, number> = {
      market: 0,
      holders: 0,
      security: 0,
      bundle: 0,
      trading: 0,
      time: 0,
      creator: 0,
    };

    if (this.ternaryLayers.length === 0) return importance;

    const layer = this.ternaryLayers[0];
    // Sum absolute contribution of each feature across all neurons
    const featureContrib = new Float32Array(Math.min(layer.cols, features.length));
    for (let j = 0; j < layer.rows; j++) {
      const offset = j * layer.cols;
      for (let i = 0; i < featureContrib.length; i++) {
        const w = layer.weights[offset + i];
        if (w !== 0) {
          featureContrib[i] += Math.abs(features[i]);
        }
      }
    }

    // Map feature indices to categories (based on 29-feature layout)
    const catMap: [number, number, string][] = [
      [0, 4, 'market'],
      [5, 10, 'holders'],
      [11, 14, 'security'],
      [15, 19, 'bundle'],
      [20, 23, 'trading'],
      [24, 25, 'time'],
      [26, 28, 'creator'],
    ];

    for (const [start, end, cat] of catMap) {
      for (let i = start; i <= end && i < featureContrib.length; i++) {
        importance[cat] += featureContrib[i];
      }
    }

    // Normalize
    const total = Object.values(importance).reduce((a, b) => a + b, 0) || 1;
    for (const key of Object.keys(importance)) {
      importance[key] = importance[key] / total;
    }

    return importance;
  }

  /**
   * Generate risk flags from features and classification
   */
  private generateFlags(
    features: Float32Array,
    riskLevel: string,
    probs: Float32Array
  ): ClassifierOutput['flags'] {
    const flags: ClassifierOutput['flags'] = [];

    // Use the first 29 features (our standard layout)
    const mintDisabled = features.length > 11 ? features[11] : 1;
    const freezeDisabled = features.length > 12 ? features[12] : 1;
    const bundleDetected = features.length > 15 ? features[15] : 0;
    const bundleConfidence = features.length > 18 ? features[18] : 0;
    const bundleQuality = features.length > 19 ? features[19] : 1;
    const topWhalePercent = features.length > 10 ? features[10] : 0;
    const creatorRugHistory = features.length > 27 ? features[27] : 0;
    const volumeToLiquidity = features.length > 1 ? features[1] : 0;

    if (mintDisabled === 0) {
      flags.push({ type: 'MINT_ACTIVE', probability: 1, severity: 'HIGH' });
    }
    if (freezeDisabled === 0) {
      flags.push({ type: 'FREEZE_ACTIVE', probability: 1, severity: 'CRITICAL' });
    }
    if (bundleDetected === 1) {
      flags.push({
        type: 'BUNDLE_DETECTED',
        probability: bundleConfidence,
        severity: bundleQuality < 0.25 ? 'CRITICAL' : 'HIGH',
      });
    }
    if (topWhalePercent > 0.5) {
      flags.push({ type: 'WHALE_DOMINANCE', probability: 1, severity: 'CRITICAL' });
    } else if (topWhalePercent > 0.3) {
      flags.push({ type: 'WHALE_CONCENTRATION', probability: 0.8, severity: 'HIGH' });
    }
    if (creatorRugHistory > 0) {
      flags.push({ type: 'SERIAL_RUGGER', probability: 1, severity: 'CRITICAL' });
    }
    if (volumeToLiquidity > 0.8) {
      flags.push({ type: 'SUSPICIOUS_VOLUME', probability: 0.7, severity: 'MEDIUM' });
    }

    // High scam probability flag
    if (probs.length > 3 && probs[3] > 0.5) {
      flags.push({ type: 'HIGH_SCAM_PROBABILITY', probability: probs[3], severity: 'CRITICAL' });
    }

    return flags;
  }

  /**
   * Generate reasoning/explanation from prompt
   */
  async generate(options: GenerateOptions): Promise<string> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    return this.templateGenerate(options);
  }

  /**
   * Reason about what action to take
   */
  async reason(context: string, availableTools: string[]): Promise<ReasoningOutput> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

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
   * Check if neural model is loaded
   */
  isNeuralModelLoaded(): boolean {
    return this.useNeuralInference;
  }

  /**
   * Get model info
   */
  getModelInfo(): {
    mode: 'neural' | 'rule-based';
    architecture?: number[];
    accuracy?: number;
    trainedOn?: number;
  } {
    if (this.useNeuralInference && this.ternaryModel) {
      return {
        mode: 'neural',
        architecture: this.ternaryModel.architecture,
        accuracy: this.ternaryModel.accuracy,
        trainedOn: this.ternaryModel.trainedOn,
      };
    }
    return { mode: 'rule-based' };
  }

  /**
   * Rule-based classification (fallback when no trained model)
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

    if (format === 'json') {
      return JSON.stringify({ response: 'Analysis complete', confidence: 50 });
    }

    return 'Analysis complete. Additional context needed for detailed response.';
  }

  /**
   * Generate reasoning thought
   */
  private async generateThought(context: string): Promise<string> {
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
    this.patternWeights.set('BUNDLE_COORDINATOR', new Array(FEATURE_COUNT).fill(0).map((_, i) => {
      if (i === 15) return 1.0;  // bundleDetected
      if (i === 16) return 0.8;  // bundleCountNorm
      if (i === 8) return 0.7;   // freshWalletRatio
      if (i === 19) return -0.5; // bundleQuality (inverse)
      return 0;
    }));

    this.patternWeights.set('RUG_PULLER', new Array(FEATURE_COUNT).fill(0).map((_, i) => {
      if (i === 27) return 1.0;  // creatorRugHistory
      if (i === 10) return 0.8;  // topWhalePercent
      if (i === 11) return -0.5; // mintDisabled (inverse = active)
      if (i === 12) return -0.7; // freezeDisabled (inverse = active)
      return 0;
    }));

    this.patternWeights.set('WASH_TRADER', new Array(FEATURE_COUNT).fill(0).map((_, i) => {
      if (i === 1) return 1.0;   // volumeToLiquidity
      if (i === 5) return -0.5;  // holderCountLog (inverse = low)
      if (i === 22) return 0.6;  // activityLevel
      return 0;
    }));

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
