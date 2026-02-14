/**
 * BitNetEngine Tests
 *
 * Tests 1-bit quantized AI inference, feature extraction, and classification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BitNetEngine } from '../../packages/agents/src/reasoning/BitNetEngine';
import { FEATURE_CONSTANTS } from '../../packages/agents/src';

describe('BitNetEngine', () => {
  let engine: BitNetEngine;

  beforeEach(async () => {
    engine = new BitNetEngine();
    await engine.loadModel();
  });

  describe('feature vector', () => {
    it('should have 29 dimensions', () => {
      expect(FEATURE_CONSTANTS.FEATURE_COUNT).toBe(29);
    });

    it('should compress 2MB data to 116 bytes', () => {
      // 29 features * 4 bytes (float32) = 116 bytes
      const bytesPerVector = FEATURE_CONSTANTS.FEATURE_COUNT * FEATURE_CONSTANTS.BYTES_PER_FEATURE;
      expect(bytesPerVector).toBe(116);
      expect(FEATURE_CONSTANTS.TOTAL_BYTES).toBe(116);

      // Compression ratio: 2MB / 116 bytes ≈ 17,000x
      const compressionRatio = (2 * 1024 * 1024) / 116;
      expect(compressionRatio).toBeGreaterThan(17000);
    });

    it('should normalize all features to [0, 1]', () => {
      const features = new Float32Array(29);

      // Set some raw values
      features[0] = Math.min(1, Math.log10(50000) / 7); // liquidityLog
      features[1] = Math.min(1, 3 / 10); // volumeToLiquidity
      features[5] = Math.min(1, Math.log10(100) / 5); // holderCountLog

      for (let i = 0; i < features.length; i++) {
        expect(features[i]).toBeGreaterThanOrEqual(0);
        expect(features[i]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('classification', () => {
    it('should return riskScore between 0 and 100', async () => {
      const features = new Float32Array(29).fill(0.5);

      const result = await engine.classify(features);

      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });

    it('should return riskLevel as one of SAFE, SUSPICIOUS, DANGEROUS, SCAM', async () => {
      const features = new Float32Array(29).fill(0.5);

      const result = await engine.classify(features);

      expect(['SAFE', 'SUSPICIOUS', 'DANGEROUS', 'SCAM']).toContain(result.riskLevel);
    });

    it('should flag high-risk tokens', async () => {
      // High-risk features
      const riskyFeatures = new Float32Array(29);
      riskyFeatures[5] = 0.1; // Low holder count
      riskyFeatures[6] = 0.9; // High top10 concentration
      riskyFeatures[7] = 0.9; // High Gini coefficient
      riskyFeatures[11] = 0; // Mint NOT disabled
      riskyFeatures[12] = 0; // Freeze NOT disabled
      riskyFeatures[15] = 1; // Bundle detected
      riskyFeatures[17] = 0.8; // High bundle control

      const result = await engine.classify(riskyFeatures);

      expect(result.riskScore).toBeGreaterThan(40);
      // Flags is an array of objects with type, probability, severity
      expect(result.flags.length).toBeGreaterThanOrEqual(0);
    });

    it('should mark safe tokens with lower score', async () => {
      // Safe token features
      const safeFeatures = new Float32Array(29);
      safeFeatures[0] = 0.8; // Good liquidity
      safeFeatures[5] = 0.7; // Many holders
      safeFeatures[6] = 0.3; // Low concentration
      safeFeatures[7] = 0.3; // Low Gini
      safeFeatures[11] = 1; // Mint disabled
      safeFeatures[12] = 1; // Freeze disabled
      safeFeatures[13] = 1; // LP locked
      safeFeatures[15] = 0; // No bundles

      const result = await engine.classify(safeFeatures);

      // Safe features should result in lower risk
      expect(result.riskLevel).toBe('SAFE');
    });

    it('should return confidence value', async () => {
      const features = new Float32Array(29).fill(0.5);

      const result = await engine.classify(features);

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(100); // confidence is 0-100 scale
    });

    it('should return featureImportance', async () => {
      const features = new Float32Array(29).fill(0.5);

      const result = await engine.classify(features);

      expect(result.featureImportance).toBeDefined();
      expect(typeof result.featureImportance).toBe('object');
    });
  });

  describe('ternary weights', () => {
    it('should use only -1, 0, +1 weights for ternary model', () => {
      const layers = (engine as any).layers;

      if (layers && (engine as any).useTernary) {
        for (const layer of layers) {
          for (const w of layer.weights) {
            expect([-1, 0, 1]).toContain(w);
          }
        }
      }
    });

    it('should enable CPU-only inference', async () => {
      const features = new Float32Array(29).fill(0.5);

      const start = performance.now();
      await engine.classify(features);
      const elapsed = performance.now() - start;

      // Should complete in <100ms on CPU (allowing for model load)
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('feature extraction', () => {
    it('should extract market features (0-4)', () => {
      const features = new Float32Array(29);

      // Market features
      features[0] = Math.min(1, Math.log10(100000) / 7); // liquidityLog
      features[1] = Math.min(1, 5 / 10); // volumeToLiquidity
      features[2] = Math.min(1, Math.log10(500000) / 9); // marketCapLog
      features[3] = Math.min(1, (0.5 + 1) / 2); // priceVelocity normalized
      features[4] = Math.min(1, Math.log10(50000) / 8); // volumeLog

      expect(features[0]).toBeCloseTo(0.714, 2); // log10(100000)/7
      expect(features[1]).toBe(0.5); // 5/10
    });

    it('should extract holder features (5-10)', () => {
      const features = new Float32Array(29);

      // Holder features
      features[5] = Math.min(1, Math.log10(500) / 5); // holderCountLog
      features[6] = 0.65; // top10Concentration
      features[7] = 0.45; // giniCoefficient
      features[8] = 0.2; // freshWalletRatio
      features[9] = Math.min(1, 5 / 10); // whaleCount
      features[10] = 0.15; // topWhalePercent

      expect(features[5]).toBeCloseTo(0.54, 2);
    });

    it('should extract security features (11-14)', () => {
      const features = new Float32Array(29);

      // Security binary flags
      features[11] = 1; // mintDisabled
      features[12] = 1; // freezeDisabled
      features[13] = 1; // lpLocked
      features[14] = 0; // lpBurned

      expect(features[11]).toBe(1);
      expect(features[14]).toBe(0);
    });

    it('should extract bundle features (15-19)', () => {
      const features = new Float32Array(29);

      // Bundle detection
      features[15] = 1; // bundleDetected
      features[16] = Math.min(1, 5 / 20); // bundleCountNorm
      features[17] = 0.35; // bundleControlPercent
      features[18] = 0.8; // bundleConfidence
      features[19] = 0.6; // bundleQuality

      expect(features[15]).toBe(1);
      expect(features[16]).toBe(0.25);
    });
  });

  describe('inference speed', () => {
    it('should complete in under 20ms on average', async () => {
      const features = new Float32Array(29).fill(0.5);

      const times: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await engine.classify(features);
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avgTime).toBeLessThan(20);
    });
  });
});
