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

export class OutcomeLearner {
  private predictions: Map<string, Prediction> = new Map();
  private outcomes: Map<string, Outcome> = new Map();
  private featureWeights: Float32Array;
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
   * Record a new prediction
   */
  recordPrediction(prediction: Omit<Prediction, 'id'>): string {
    const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.predictions.set(id, {
      ...prediction,
      id
    });

    console.log(`[OutcomeLearner] Recorded prediction ${id} for ${prediction.token.slice(0, 8)}...`);

    return id;
  }

  /**
   * Record outcome for a prediction
   */
  recordOutcome(
    predictionId: string,
    outcome: Omit<Outcome, 'predictionId' | 'outcomeTimestamp'>
  ): void {
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

    // Learn from this outcome
    this.learnFromOutcome(prediction, fullOutcome);

    console.log(`[OutcomeLearner] Recorded outcome for ${prediction.token.slice(0, 8)}...: ${outcome.outcome}`);
  }

  /**
   * Learn from a prediction/outcome pair
   */
  private learnFromOutcome(prediction: Prediction, outcome: Outcome): void {
    // Determine if prediction was correct
    const wasCorrect = this.wasCorrectPrediction(prediction, outcome);
    const error = this.calculatePredictionError(prediction, outcome);

    // Update feature weights based on outcome
    this.updateFeatureWeights(prediction.features, wasCorrect, error);

    // Store learning event
    console.log(`[OutcomeLearner] Learning from ${prediction.token.slice(0, 8)}... ` +
      `correct=${wasCorrect} error=${error.toFixed(2)}`);
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
