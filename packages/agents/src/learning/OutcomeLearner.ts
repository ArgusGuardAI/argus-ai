/**
 * OutcomeLearner - Self-Improvement Through Outcome Analysis
 *
 * Tracks predictions vs outcomes to improve:
 * - Risk scoring accuracy
 * - Pattern recognition
 * - Trading decisions
 * - Scammer detection
 */

export interface Prediction {
  id: string;
  token: string;
  timestamp: number;
  riskScore: number;
  verdict: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  confidence: number;
  features: Float32Array;
  patterns: string[];
  source: string;
}

export interface Outcome {
  predictionId: string;
  token: string;
  outcomeTimestamp: number;
  outcome: 'RUG' | 'DUMP' | 'STABLE' | 'MOON' | 'UNKNOWN';
  priceChange: number;
  liquidityChange: number;
  timeToOutcome: number;
  details: string;
}

export interface LearningStats {
  totalPredictions: number;
  totalOutcomes: number;
  llmAnalysisCount: number;
  accuracy: {
    overall: number;
    byVerdict: Record<string, number>;
    byPattern: Record<string, number>;
  };
  falsePositives: number;
  falseNegatives: number;
  improvements: Array<{
    date: number;
    metric: string;
    before: number;
    after: number;
  }>;
}

export interface FeatureImportance {
  featureIndex: number;
  featureName: string;
  importance: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

import type { Database } from '../services/Database';
import type { LLMService } from '../services/LLMService';

// LLM prompt for outcome analysis
const OUTCOME_ANALYSIS_SYSTEM = `You are Argus Learning System, analyzing token outcomes to improve risk prediction.
You receive a prediction (features, score, verdict) and the actual outcome (RUG, DUMP, STABLE, MOON).
Your job is to identify which features were predictive vs misleading.

FEATURE NAMES (indices 0-28):
0-4: liquidityLog, volumeToLiquidity, marketCapLog, priceVelocity, volumeLog
5-10: holderCountLog, top10Concentration, giniCoefficient, freshWalletRatio, whaleCount, topWhalePercent
11-14: mintDisabled, freezeDisabled, lpLocked, lpBurned
15-19: bundleDetected, bundleCountNorm, bundleControlPercent, bundleConfidence, bundleQuality
20-23: buyRatio24h, buyRatio1h, activityLevel, momentum
24-25: ageDecay, tradingRecency
26-28: creatorIdentified, creatorRugHistory, creatorHoldings

RULES:
- Analyze if the prediction was correct and why
- Identify 3-5 features that were MOST predictive (helped predict correctly OR should have warned us)
- Identify 1-3 features that were MISLEADING (gave wrong signal)
- Suggest weight adjustments: positive = increase weight, negative = decrease weight
- Be specific about WHY each feature was predictive or misleading

You MUST respond with valid JSON only:
{
  "wasCorrect": true,
  "analysis": "2-3 sentences explaining why prediction was right or wrong",
  "predictiveFeatures": [
    {"index": 15, "name": "bundleDetected", "contribution": 0.15, "reason": "Bundle correctly flagged coordinated wallets"}
  ],
  "misleadingFeatures": [
    {"index": 0, "name": "liquidityLog", "contribution": -0.05, "reason": "High liquidity masked underlying risk"}
  ],
  "suggestedAdjustments": {
    "15": 0.02,
    "0": -0.01
  },
  "patternLearned": "PUMP_AND_DUMP" or null
}`;

export interface LLMOutcomeAnalysis {
  wasCorrect: boolean;
  analysis: string;
  predictiveFeatures: Array<{
    index: number;
    name: string;
    contribution: number;
    reason: string;
  }>;
  misleadingFeatures: Array<{
    index: number;
    name: string;
    contribution: number;
    reason: string;
  }>;
  suggestedAdjustments: Record<string, number>;
  patternLearned: string | null;
}

export class OutcomeLearner {
  private predictions: Map<string, Prediction> = new Map();
  private outcomes: Map<string, Outcome> = new Map();
  private featureWeights: Float32Array;
  private database: Database | undefined;
  private llm: LLMService | undefined;
  private llmAnalysisCount: number = 0;
  private readonly featureNames: string[] = [
    'liquidityLog', 'volumeToLiquidity', 'marketCapLog', 'priceVelocity', 'volumeLog',
    'holderCountLog', 'top10Concentration', 'giniCoefficient', 'freshWalletRatio', 'whaleCount',
    'topWhalePercent', 'mintDisabled', 'freezeDisabled', 'lpLocked', 'lpBurned',
    'bundleDetected', 'bundleCountNorm', 'bundleControlPercent', 'bundleConfidence', 'bundleQuality',
    'buyRatio24h', 'buyRatio1h', 'activityLevel', 'momentum',
    'ageDecay', 'tradingRecency',
    'creatorIdentified', 'creatorRugHistory', 'creatorHoldings'
  ];

  constructor() {
    // Initialize with equal weights
    this.featureWeights = new Float32Array(29).fill(1 / 29);
  }

  /**
   * Set database for persistence
   */
  setDatabase(db: Database): void {
    this.database = db;
  }

  /**
   * Set LLM service for intelligent outcome analysis
   * When available, uses DeepSeek R1 to analyze WHY predictions were right/wrong
   */
  setLLM(llm: LLMService): void {
    this.llm = llm;
    console.log('[OutcomeLearner] LLM-enhanced learning enabled');
  }

  /**
   * Load weights from database on startup
   */
  async loadFromDatabase(): Promise<boolean> {
    if (!this.database?.isReady()) return false;

    try {
      const stored = await this.database.loadWeights();
      if (stored && stored.feature_weights.length === 29) {
        this.featureWeights = new Float32Array(stored.feature_weights);
        console.log(`[OutcomeLearner] Loaded weights from database (${stored.samples_used} samples, updated ${stored.updated_at.toISOString()})`);
        return true;
      }
    } catch (err) {
      console.error('[OutcomeLearner] Failed to load weights from database:', (err as Error).message);
    }
    return false;
  }

  /**
   * Save weights to database
   */
  async saveToDatabase(): Promise<void> {
    if (!this.database?.isReady()) return;

    try {
      await this.database.saveWeights(
        Array.from(this.featureWeights),
        this.outcomes.size
      );
    } catch (err) {
      console.error('[OutcomeLearner] Failed to save weights:', (err as Error).message);
    }
  }

  /**
   * Record a new prediction
   */
  recordPrediction(prediction: Omit<Prediction, 'id'>): string {
    const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.predictions.set(id, {
      ...prediction,
      id
    });

    // Persist to database (fire and forget)
    if (this.database?.isReady()) {
      this.database.storePrediction({
        id,
        token: prediction.token,
        risk_score: prediction.riskScore,
        verdict: prediction.verdict,
        features: prediction.features,
        predicted_at: new Date(prediction.timestamp),
      }).catch(() => {});
    }

    console.log(`[OutcomeLearner] Recorded prediction ${id} for ${prediction.token.slice(0, 8)}...`);

    return id;
  }

  /**
   * Record outcome for a prediction
   * If LLM is available, uses DeepSeek R1 for deep analysis
   */
  async recordOutcome(
    predictionId: string,
    outcome: Omit<Outcome, 'predictionId' | 'outcomeTimestamp'>
  ): Promise<void> {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) {
      console.warn(`[OutcomeLearner] Prediction ${predictionId} not found`);
      return;
    }

    const fullOutcome: Outcome = {
      ...outcome,
      predictionId,
      outcomeTimestamp: Date.now(),
      timeToOutcome: Date.now() - prediction.timestamp
    };

    this.outcomes.set(predictionId, fullOutcome);

    // Learn from this outcome (async - may use LLM)
    await this.learnFromOutcome(prediction, fullOutcome);

    console.log(`[OutcomeLearner] Recorded outcome for ${prediction.token.slice(0, 8)}...: ${outcome.outcome}`);
  }

  /**
   * Learn from a prediction/outcome pair
   */
  private async learnFromOutcome(prediction: Prediction, outcome: Outcome): Promise<void> {
    // Determine if prediction was correct
    const wasCorrect = this.wasCorrectPrediction(prediction, outcome);
    const error = this.calculatePredictionError(prediction, outcome);

    // Try LLM-enhanced learning first (uses DeepSeek R1 for deep analysis)
    if (this.llm) {
      const llmAnalysis = await this.analyzeOutcomeWithLLM(prediction, outcome);
      if (llmAnalysis) {
        this.applyLLMWeightUpdates(llmAnalysis);
        this.llmAnalysisCount++;
        console.log(`[OutcomeLearner] LLM analysis #${this.llmAnalysisCount}: ${prediction.token.slice(0, 8)}... ` +
          `correct=${llmAnalysis.wasCorrect} pattern=${llmAnalysis.patternLearned || 'none'}`);
        return;
      }
    }

    // Fallback to rule-based weight updates
    this.updateFeatureWeights(prediction.features, wasCorrect, error);

    console.log(`[OutcomeLearner] Rule-based learning: ${prediction.token.slice(0, 8)}... ` +
      `correct=${wasCorrect} error=${error.toFixed(2)}`);
  }

  /**
   * Use LLM to analyze why a prediction was right or wrong
   * Returns structured analysis with feature importance insights
   */
  private async analyzeOutcomeWithLLM(
    prediction: Prediction,
    outcome: Outcome
  ): Promise<LLMOutcomeAnalysis | null> {
    if (!this.llm) return null;

    const featureValues = Array.from(prediction.features)
      .map((v, i) => `${this.featureNames[i]}: ${v.toFixed(3)}`)
      .join('\n');

    const prompt = `Analyze this prediction outcome:

PREDICTION:
- Token: ${prediction.token}
- Risk Score: ${prediction.riskScore}/100
- Verdict: ${prediction.verdict}
- Confidence: ${(prediction.confidence * 100).toFixed(0)}%
- Patterns detected: ${prediction.patterns.join(', ') || 'none'}

FEATURES (29 dimensions):
${featureValues}

ACTUAL OUTCOME:
- Result: ${outcome.outcome}
- Price change: ${outcome.priceChange > 0 ? '+' : ''}${outcome.priceChange.toFixed(1)}%
- Time to outcome: ${(outcome.timeToOutcome / 3600000).toFixed(1)} hours
- Details: ${outcome.details}

Was the prediction correct? Which features helped or hurt the prediction?`;

    try {
      // Use reasoning model for deep analysis
      const response = await this.llm.chat({
        system: OUTCOME_ANALYSIS_SYSTEM,
        prompt,
        model: 'reasoning',
        format: 'json',
        temperature: 0.2,
      });

      if (!response) return null;

      const parsed = JSON.parse(response);
      return {
        wasCorrect: Boolean(parsed.wasCorrect),
        analysis: String(parsed.analysis || ''),
        predictiveFeatures: Array.isArray(parsed.predictiveFeatures) ? parsed.predictiveFeatures : [],
        misleadingFeatures: Array.isArray(parsed.misleadingFeatures) ? parsed.misleadingFeatures : [],
        suggestedAdjustments: parsed.suggestedAdjustments || {},
        patternLearned: parsed.patternLearned || null,
      };
    } catch (err) {
      console.warn('[OutcomeLearner] LLM analysis failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Apply weight updates suggested by LLM analysis
   */
  private applyLLMWeightUpdates(analysis: LLMOutcomeAnalysis): void {
    const learningRate = 0.02; // Slightly higher rate for LLM-guided updates

    // Apply suggested adjustments
    for (const [indexStr, adjustment] of Object.entries(analysis.suggestedAdjustments)) {
      const index = parseInt(indexStr, 10);
      if (index >= 0 && index < 29) {
        // Clamp adjustment to reasonable range
        const clampedAdj = Math.max(-0.05, Math.min(0.05, adjustment)) * learningRate;
        this.featureWeights[index] += clampedAdj;
      }
    }

    // Boost predictive features
    for (const feature of analysis.predictiveFeatures) {
      if (feature.index >= 0 && feature.index < 29) {
        this.featureWeights[feature.index] += learningRate * Math.abs(feature.contribution);
      }
    }

    // Reduce misleading features
    for (const feature of analysis.misleadingFeatures) {
      if (feature.index >= 0 && feature.index < 29) {
        this.featureWeights[feature.index] -= learningRate * Math.abs(feature.contribution);
      }
    }

    // Normalize weights to sum to 1
    const sum = this.featureWeights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < this.featureWeights.length; i++) {
      this.featureWeights[i] = Math.max(0.001, this.featureWeights[i] / sum); // Min weight 0.001
    }

    console.log(`[OutcomeLearner] Applied LLM weight updates: ` +
      `+${analysis.predictiveFeatures.length} predictive, -${analysis.misleadingFeatures.length} misleading`);
  }

  /**
   * Check if prediction was correct
   */
  private wasCorrectPrediction(prediction: Prediction, outcome: Outcome): boolean {
    // Scam/Dangerous predictions should have RUG/DUMP outcomes
    if (prediction.verdict === 'SCAM' || prediction.verdict === 'DANGEROUS') {
      return outcome.outcome === 'RUG' || outcome.outcome === 'DUMP';
    }

    // Safe predictions should not have RUG outcomes
    if (prediction.verdict === 'SAFE') {
      return outcome.outcome !== 'RUG';
    }

    // Suspicious - either outcome is acceptable
    return true;
  }

  /**
   * Calculate prediction error (0-1)
   */
  private calculatePredictionError(prediction: Prediction, outcome: Outcome): number {
    // Map outcomes to expected risk scores
    const expectedScores: Record<Outcome['outcome'], number> = {
      RUG: 100,
      DUMP: 70,
      STABLE: 40,
      MOON: 20,
      UNKNOWN: 50
    };

    const expectedScore = expectedScores[outcome.outcome];
    const error = Math.abs(prediction.riskScore - expectedScore) / 100;

    return error;
  }

  /**
   * Update feature weights based on learning
   */
  private updateFeatureWeights(
    features: Float32Array,
    wasCorrect: boolean,
    error: number
  ): void {
    const learningRate = 0.01;
    const direction = wasCorrect ? 1 : -1;

    // Adjust weights for each feature based on its value and the outcome
    for (let i = 0; i < features.length; i++) {
      const featureValue = features[i];

      // If feature was high and prediction was correct, increase its weight
      // If feature was high and prediction was wrong, decrease its weight
      const adjustment = learningRate * direction * featureValue * (1 - error);
      this.featureWeights[i] += adjustment;
    }

    // Normalize weights to sum to 1
    const sum = this.featureWeights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < this.featureWeights.length; i++) {
      this.featureWeights[i] = Math.max(0, this.featureWeights[i] / sum);
    }
  }

  /**
   * Get current feature importance rankings
   */
  getFeatureImportance(): FeatureImportance[] {
    const importance: FeatureImportance[] = [];

    for (let i = 0; i < this.featureWeights.length; i++) {
      importance.push({
        featureIndex: i,
        featureName: this.featureNames[i] || `feature_${i}`,
        importance: this.featureWeights[i],
        trend: 'stable' // Would track historical weights to determine trend
      });
    }

    return importance.sort((a, b) => b.importance - a.importance);
  }

  /**
   * Get weighted risk score using learned weights
   */
  getWeightedRiskScore(features: Float32Array): number {
    let score = 0;

    for (let i = 0; i < features.length; i++) {
      // Higher risk features contribute more to score
      const riskContribution = this.featureWeights[i] * features[i];
      score += riskContribution;
    }

    // Scale to 0-100
    return Math.min(100, Math.max(0, score * 100));
  }

  /**
   * Get learning statistics
   */
  getStats(): LearningStats {
    let correct = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    const verdictCorrect: Record<string, number> = {};
    const verdictTotal: Record<string, number> = {};
    const patternCorrect: Record<string, number> = {};
    const patternTotal: Record<string, number> = {};

    for (const [predId, outcome] of this.outcomes) {
      const prediction = this.predictions.get(predId);
      if (!prediction) continue;

      const wasCorrect = this.wasCorrectPrediction(prediction, outcome);
      if (wasCorrect) correct++;

      // Track by verdict
      verdictTotal[prediction.verdict] = (verdictTotal[prediction.verdict] || 0) + 1;
      if (wasCorrect) {
        verdictCorrect[prediction.verdict] = (verdictCorrect[prediction.verdict] || 0) + 1;
      }

      // Track by pattern
      for (const pattern of prediction.patterns) {
        patternTotal[pattern] = (patternTotal[pattern] || 0) + 1;
        if (wasCorrect) {
          patternCorrect[pattern] = (patternCorrect[pattern] || 0) + 1;
        }
      }

      // Track false positives/negatives
      if (!wasCorrect) {
        if (prediction.verdict === 'SCAM' || prediction.verdict === 'DANGEROUS') {
          falsePositives++;
        } else if (prediction.verdict === 'SAFE' && outcome.outcome === 'RUG') {
          falseNegatives++;
        }
      }
    }

    // Calculate accuracy by verdict
    const byVerdict: Record<string, number> = {};
    for (const verdict of Object.keys(verdictTotal)) {
      byVerdict[verdict] = verdictTotal[verdict] > 0
        ? (verdictCorrect[verdict] || 0) / verdictTotal[verdict]
        : 0;
    }

    // Calculate accuracy by pattern
    const byPattern: Record<string, number> = {};
    for (const pattern of Object.keys(patternTotal)) {
      byPattern[pattern] = patternTotal[pattern] > 0
        ? (patternCorrect[pattern] || 0) / patternTotal[pattern]
        : 0;
    }

    return {
      totalPredictions: this.predictions.size,
      totalOutcomes: this.outcomes.size,
      llmAnalysisCount: this.llmAnalysisCount,
      accuracy: {
        overall: this.outcomes.size > 0 ? correct / this.outcomes.size : 0,
        byVerdict,
        byPattern
      },
      falsePositives,
      falseNegatives,
      improvements: [] // Would track historical accuracy improvements
    };
  }

  /**
   * Find tokens pending outcome check
   */
  getPendingOutcomes(maxAge: number = 24 * 60 * 60 * 1000): Prediction[] {
    const cutoff = Date.now() - maxAge;
    const pending: Prediction[] = [];

    for (const [id, prediction] of this.predictions) {
      if (!this.outcomes.has(id) && prediction.timestamp > cutoff) {
        pending.push(prediction);
      }
    }

    return pending.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get similar past predictions
   */
  getSimilarPredictions(
    features: Float32Array,
    threshold: number = 0.8,
    limit: number = 5
  ): Array<{ prediction: Prediction; outcome?: Outcome; similarity: number }> {
    const results: Array<{ prediction: Prediction; outcome?: Outcome; similarity: number }> = [];

    for (const [id, prediction] of this.predictions) {
      const similarity = this.cosineSimilarity(features, prediction.features);
      if (similarity >= threshold) {
        results.push({
          prediction,
          outcome: this.outcomes.get(id),
          similarity
        });
      }
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Analyze patterns that lead to rugs
   */
  analyzeRugPatterns(): {
    commonFeatures: Array<{ feature: string; avgValue: number; rugs: number }>;
    commonPatterns: Array<{ pattern: string; rugRate: number; count: number }>;
  } {
    const featureSums: number[] = new Array(29).fill(0);
    const featureCounts: number[] = new Array(29).fill(0);
    const patternRugs: Record<string, number> = {};
    const patternTotal: Record<string, number> = {};

    for (const [predId, outcome] of this.outcomes) {
      if (outcome.outcome !== 'RUG') continue;

      const prediction = this.predictions.get(predId);
      if (!prediction) continue;

      // Accumulate feature values for rugs
      for (let i = 0; i < prediction.features.length; i++) {
        featureSums[i] += prediction.features[i];
        featureCounts[i]++;
      }

      // Track patterns
      for (const pattern of prediction.patterns) {
        patternRugs[pattern] = (patternRugs[pattern] || 0) + 1;
      }
    }

    // Track total pattern occurrences
    for (const [predId, _outcome] of this.outcomes) {
      const prediction = this.predictions.get(predId);
      if (!prediction) continue;

      for (const pattern of prediction.patterns) {
        patternTotal[pattern] = (patternTotal[pattern] || 0) + 1;
      }
    }

    // Calculate averages
    const commonFeatures = this.featureNames.map((name, i) => ({
      feature: name,
      avgValue: featureCounts[i] > 0 ? featureSums[i] / featureCounts[i] : 0,
      rugs: featureCounts[i]
    })).sort((a, b) => b.avgValue - a.avgValue);

    // Calculate rug rates by pattern
    const commonPatterns = Object.keys(patternTotal).map(pattern => ({
      pattern,
      rugRate: patternTotal[pattern] > 0 ? (patternRugs[pattern] || 0) / patternTotal[pattern] : 0,
      count: patternTotal[pattern]
    })).sort((a, b) => b.rugRate - a.rugRate);

    return {
      commonFeatures,
      commonPatterns
    };
  }

  /**
   * Export learned weights for model update
   */
  exportWeights(): {
    featureWeights: number[];
    learnedAt: number;
    samplesUsed: number;
  } {
    return {
      featureWeights: Array.from(this.featureWeights),
      learnedAt: Date.now(),
      samplesUsed: this.outcomes.size
    };
  }

  /**
   * Import weights from previous learning
   */
  importWeights(weights: {
    featureWeights: number[];
    learnedAt: number;
    samplesUsed: number;
  }): void {
    if (weights.featureWeights.length !== 29) {
      console.warn('[OutcomeLearner] Invalid weight count, ignoring import');
      return;
    }

    this.featureWeights = new Float32Array(weights.featureWeights);
    console.log(`[OutcomeLearner] Imported weights from ${new Date(weights.learnedAt).toISOString()}`);
  }

  /**
   * Calculate cosine similarity between feature vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Clear old predictions to manage memory
   */
  cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [id, prediction] of this.predictions) {
      if (prediction.timestamp < cutoff) {
        this.predictions.delete(id);
        this.outcomes.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[OutcomeLearner] Cleaned up ${removed} old predictions`);
    }

    return removed;
  }
}
