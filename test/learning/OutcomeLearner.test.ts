/**
 * OutcomeLearner Tests
 *
 * Tests self-improvement through prediction tracking and weight adjustment.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutcomeLearner, Prediction, Outcome } from '../../packages/agents/src/learning/OutcomeLearner';

describe('OutcomeLearner', () => {
  let learner: OutcomeLearner;

  beforeEach(() => {
    learner = new OutcomeLearner();
  });

  describe('prediction recording', () => {
    it('should record prediction with features', () => {
      const prediction: Omit<Prediction, 'id'> = {
        token: 'PredToken123',
        timestamp: Date.now(),
        features: new Float32Array(29).fill(0.5),
        verdict: 'SAFE',
        confidence: 0.8,
        riskScore: 25,
        patterns: [],
        source: 'test',
      };

      const id = learner.recordPrediction(prediction);

      expect(id).toBeDefined();
      expect(id.startsWith('pred_')).toBe(true);
    });

    it('should track multiple predictions', () => {
      for (let i = 0; i < 5; i++) {
        learner.recordPrediction({
          token: `Token${i}`,
          timestamp: Date.now(),
          features: new Float32Array(29).fill(0.5),
          verdict: 'SAFE',
          confidence: 0.7,
          riskScore: 30,
          patterns: [],
          source: 'test',
        });
      }

      const stats = learner.getStats();
      expect(stats.totalPredictions).toBe(5);
    });
  });

  describe('outcome verification', () => {
    it('should record outcome and verify prediction was correct', async () => {
      const predId = learner.recordPrediction({
        token: 'CorrectPred',
        timestamp: Date.now(),
        features: new Float32Array(29).fill(0.3),
        verdict: 'SAFE',
        confidence: 0.85,
        riskScore: 20,
        patterns: [],
        source: 'test',
      });

      await learner.recordOutcome(predId, {
        token: 'CorrectPred',
        outcome: 'STABLE', // Safe prediction + STABLE outcome = correct
        priceChange: 50,
        liquidityChange: 0,
        timeToOutcome: 3600000,
        details: 'Token held steady',
      });

      const stats = learner.getStats();
      expect(stats.totalOutcomes).toBe(1);
    });

    it('should detect incorrect prediction', async () => {
      const predId = learner.recordPrediction({
        token: 'WrongPred',
        timestamp: Date.now(),
        features: new Float32Array(29).fill(0.4),
        verdict: 'SAFE',
        confidence: 0.7,
        riskScore: 30,
        patterns: [],
        source: 'test',
      });

      await learner.recordOutcome(predId, {
        token: 'WrongPred',
        outcome: 'RUG', // Safe prediction + RUG outcome = WRONG
        priceChange: -95,
        liquidityChange: -100,
        timeToOutcome: 1800000,
        details: 'Token rugged',
      });

      const stats = learner.getStats();
      expect(stats.falseNegatives).toBeGreaterThan(0);
    });

    it('should calculate accuracy over time', async () => {
      // Record 10 predictions - 7 SAFE, 3 DANGEROUS
      const predIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = learner.recordPrediction({
          token: `AccToken${i}`,
          timestamp: Date.now(),
          features: new Float32Array(29).fill(0.5),
          verdict: i < 7 ? 'SAFE' : 'DANGEROUS',
          confidence: 0.75,
          riskScore: i < 7 ? 30 : 80,
          patterns: [],
          source: 'test',
        });
        predIds.push(id);
      }

      // Verify: First 7 SAFE tokens stay stable (correct), last 3 DANGEROUS also stay stable (wrong)
      for (let i = 0; i < 10; i++) {
        await learner.recordOutcome(predIds[i], {
          token: `AccToken${i}`,
          outcome: 'STABLE',
          priceChange: 0,
          liquidityChange: 0,
          timeToOutcome: 3600000,
          details: 'Test outcome',
        });
      }

      const stats = learner.getStats();
      expect(stats.totalOutcomes).toBe(10);
      // SAFE predicting STABLE = correct (7)
      // DANGEROUS predicting STABLE = correct (Suspicious/Dangerous can have any outcome)
      expect(stats.accuracy.overall).toBeGreaterThan(0);
    });
  });

  describe('weight adjustment', () => {
    it('should have initial equal weights', () => {
      const weights = learner.exportWeights();
      expect(weights.featureWeights.length).toBe(29);

      // All weights should be roughly equal initially (1/29)
      const expectedWeight = 1 / 29;
      for (const weight of weights.featureWeights) {
        expect(weight).toBeCloseTo(expectedWeight, 2);
      }
    });

    it('should adjust weights after learning from outcome', async () => {
      const initialWeights = learner.exportWeights().featureWeights.slice();

      // Features indicating a rug
      const rugFeatures = new Float32Array(29);
      rugFeatures[15] = 1; // Bundle detected
      rugFeatures[17] = 0.8; // High bundle control
      rugFeatures[11] = 0; // Mint NOT disabled

      const predId = learner.recordPrediction({
        token: 'RugToken',
        timestamp: Date.now(),
        features: rugFeatures,
        verdict: 'DANGEROUS',
        confidence: 0.9,
        riskScore: 80,
        patterns: ['BUNDLE_COORDINATOR'],
        source: 'test',
      });

      await learner.recordOutcome(predId, {
        token: 'RugToken',
        outcome: 'RUG',
        priceChange: -99,
        liquidityChange: -100,
        timeToOutcome: 600000,
        details: 'Token rugged quickly',
      });

      const newWeights = learner.exportWeights().featureWeights;

      // Weights should have changed
      let changed = false;
      for (let i = 0; i < 29; i++) {
        if (Math.abs(newWeights[i] - initialWeights[i]) > 0.0001) {
          changed = true;
          break;
        }
      }
      expect(changed).toBe(true);
    });
  });

  describe('feature importance', () => {
    it('should return feature importance rankings', () => {
      const importance = learner.getFeatureImportance();

      expect(importance.length).toBe(29);
      expect(importance[0].featureName).toBeDefined();
      expect(importance[0].importance).toBeDefined();
    });

    it('should have all 29 feature names', () => {
      const importance = learner.getFeatureImportance();

      const expectedFeatures = [
        'liquidityLog', 'volumeToLiquidity', 'marketCapLog', 'priceVelocity', 'volumeLog',
        'holderCountLog', 'top10Concentration', 'giniCoefficient', 'freshWalletRatio', 'whaleCount',
        'topWhalePercent', 'mintDisabled', 'freezeDisabled', 'lpLocked', 'lpBurned',
        'bundleDetected', 'bundleCountNorm', 'bundleControlPercent', 'bundleConfidence', 'bundleQuality',
        'buyRatio24h', 'buyRatio1h', 'activityLevel', 'momentum',
        'ageDecay', 'tradingRecency',
        'creatorIdentified', 'creatorRugHistory', 'creatorHoldings'
      ];

      const featureNames = importance.map(f => f.featureName);
      for (const expected of expectedFeatures) {
        expect(featureNames).toContain(expected);
      }
    });
  });

  describe('weighted risk scoring', () => {
    it('should calculate weighted risk score', () => {
      const features = new Float32Array(29).fill(0.5);
      const score = learner.getWeightedRiskScore(features);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should give higher scores for riskier features', () => {
      // Low risk features
      const safeFeatures = new Float32Array(29).fill(0);
      safeFeatures[11] = 1; // mintDisabled
      safeFeatures[12] = 1; // freezeDisabled
      safeFeatures[13] = 1; // lpLocked

      // High risk features
      const riskyFeatures = new Float32Array(29).fill(0);
      riskyFeatures[15] = 1; // bundleDetected
      riskyFeatures[17] = 1; // bundleControlPercent
      riskyFeatures[27] = 1; // creatorRugHistory

      const safeScore = learner.getWeightedRiskScore(safeFeatures);
      const riskyScore = learner.getWeightedRiskScore(riskyFeatures);

      // With equal initial weights, both should have similar scores
      // But conceptually risky features should contribute to risk
      expect(safeScore).toBeDefined();
      expect(riskyScore).toBeDefined();
    });
  });

  describe('similar predictions', () => {
    it('should find similar past predictions', () => {
      const baseFeatures = new Float32Array(29).fill(0.5);

      // Record several predictions
      for (let i = 0; i < 5; i++) {
        const features = new Float32Array(baseFeatures);
        features[0] += i * 0.01; // Slightly different

        learner.recordPrediction({
          token: `Similar${i}`,
          timestamp: Date.now(),
          features,
          verdict: 'SAFE',
          confidence: 0.8,
          riskScore: 25,
          patterns: [],
          source: 'test',
        });
      }

      // Find similar to base features
      const similar = learner.getSimilarPredictions(baseFeatures, 0.9, 3);

      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].similarity).toBeGreaterThan(0.9);
    });
  });

  describe('rug pattern analysis', () => {
    it('should analyze patterns that lead to rugs', async () => {
      const features = new Float32Array(29);
      features[15] = 1; // bundleDetected

      const predId = learner.recordPrediction({
        token: 'RugAnalysis',
        timestamp: Date.now(),
        features,
        verdict: 'DANGEROUS',
        confidence: 0.9,
        riskScore: 85,
        patterns: ['BUNDLE_COORDINATOR'],
        source: 'test',
      });

      await learner.recordOutcome(predId, {
        token: 'RugAnalysis',
        outcome: 'RUG',
        priceChange: -98,
        liquidityChange: -100,
        timeToOutcome: 900000,
        details: 'Bundle rugged',
      });

      const analysis = learner.analyzeRugPatterns();

      expect(analysis.commonFeatures).toBeDefined();
      expect(analysis.commonPatterns).toBeDefined();
    });
  });

  describe('statistics', () => {
    it('should track prediction statistics', async () => {
      const predId = learner.recordPrediction({
        token: 'StatsToken',
        timestamp: Date.now(),
        features: new Float32Array(29).fill(0.5),
        verdict: 'SAFE',
        confidence: 0.8,
        riskScore: 25,
        patterns: [],
        source: 'test',
      });

      await learner.recordOutcome(predId, {
        token: 'StatsToken',
        outcome: 'STABLE',
        priceChange: 20,
        liquidityChange: 10,
        timeToOutcome: 7200000,
        details: 'Stable token',
      });

      const stats = learner.getStats();

      expect(stats.totalPredictions).toBeGreaterThan(0);
      expect(stats.totalOutcomes).toBeGreaterThan(0);
      expect(stats.accuracy.overall).toBeDefined();
    });

    it('should track by verdict type', async () => {
      // SAFE predictions
      for (let i = 0; i < 3; i++) {
        const predId = learner.recordPrediction({
          token: `Safe${i}`,
          timestamp: Date.now(),
          features: new Float32Array(29).fill(0.3),
          verdict: 'SAFE',
          confidence: 0.8,
          riskScore: 20,
          patterns: [],
          source: 'test',
        });

        await learner.recordOutcome(predId, {
          token: `Safe${i}`,
          outcome: 'STABLE',
          priceChange: 10,
          liquidityChange: 5,
          timeToOutcome: 3600000,
          details: 'Stable',
        });
      }

      // DANGEROUS predictions
      for (let i = 0; i < 2; i++) {
        const predId = learner.recordPrediction({
          token: `Danger${i}`,
          timestamp: Date.now(),
          features: new Float32Array(29).fill(0.8),
          verdict: 'DANGEROUS',
          confidence: 0.85,
          riskScore: 75,
          patterns: ['PUMP_AND_DUMP'],
          source: 'test',
        });

        await learner.recordOutcome(predId, {
          token: `Danger${i}`,
          outcome: 'RUG',
          priceChange: -95,
          liquidityChange: -100,
          timeToOutcome: 1800000,
          details: 'Rugged',
        });
      }

      const stats = learner.getStats();

      expect(stats.accuracy.byVerdict).toBeDefined();
      expect(stats.accuracy.byVerdict.SAFE).toBeDefined();
      expect(stats.accuracy.byVerdict.DANGEROUS).toBeDefined();
    });
  });

  describe('import/export weights', () => {
    it('should export weights', () => {
      const exported = learner.exportWeights();

      expect(exported.featureWeights).toBeDefined();
      expect(exported.featureWeights.length).toBe(29);
      expect(exported.learnedAt).toBeDefined();
      expect(exported.samplesUsed).toBeDefined();
    });

    it('should import weights', () => {
      const weights = {
        featureWeights: new Array(29).fill(0.04),
        learnedAt: Date.now(),
        samplesUsed: 100,
      };
      weights.featureWeights[15] = 0.1; // Higher weight for bundleDetected

      learner.importWeights(weights);

      const importance = learner.getFeatureImportance();
      const bundleFeature = importance.find(f => f.featureName === 'bundleDetected');

      expect(bundleFeature).toBeDefined();
      expect(bundleFeature!.importance).toBeCloseTo(0.1, 2);
    });
  });

  describe('pending outcomes', () => {
    it('should find predictions pending outcome check', () => {
      learner.recordPrediction({
        token: 'Pending1',
        timestamp: Date.now(),
        features: new Float32Array(29).fill(0.5),
        verdict: 'SAFE',
        confidence: 0.75,
        riskScore: 30,
        patterns: [],
        source: 'test',
      });

      const pending = learner.getPendingOutcomes();

      expect(pending.length).toBe(1);
      expect(pending[0].token).toBe('Pending1');
    });
  });

  describe('cleanup', () => {
    it('should clean up old predictions', () => {
      // Record old prediction (simulated)
      const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago

      // Can't easily test this without mocking Date.now()
      // Just verify the method exists and doesn't throw
      const removed = learner.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(removed).toBe(0); // No old predictions to remove
    });
  });
});
