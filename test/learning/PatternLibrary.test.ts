/**
 * PatternLibrary Tests
 *
 * Tests scam pattern detection, similarity matching, and pattern updates.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternLibrary, ScamPattern, PatternMatch } from '../../packages/agents/src/learning/PatternLibrary';

describe('PatternLibrary', () => {
  let library: PatternLibrary;

  beforeEach(() => {
    library = new PatternLibrary();
  });

  describe('known patterns', () => {
    it('should have 8 predefined scam patterns', () => {
      const patterns = library.getAllPatterns();
      expect(patterns).toHaveLength(8);
    });

    it('should include critical patterns', () => {
      const patterns = library.getAllPatterns();
      const patternIds = patterns.map(p => p.id);

      expect(patternIds).toContain('BUNDLE_COORDINATOR');
      expect(patternIds).toContain('RUG_PULLER');
      expect(patternIds).toContain('HONEYPOT');
      expect(patternIds).toContain('PUMP_AND_DUMP');
    });

    it('should have rug rates for each pattern', () => {
      const patterns = library.getAllPatterns();

      for (const pattern of patterns) {
        expect(pattern.rugRate).toBeGreaterThanOrEqual(0);
        expect(pattern.rugRate).toBeLessThanOrEqual(1);
      }
    });

    it('should have severity levels', () => {
      const patterns = library.getAllPatterns();
      const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

      for (const pattern of patterns) {
        expect(severities).toContain(pattern.severity);
      }
    });

    it('should have indicators for each pattern', () => {
      const patterns = library.getAllPatterns();

      for (const pattern of patterns) {
        expect(pattern.indicators).toBeDefined();
        expect(pattern.indicators.length).toBeGreaterThan(0);
      }
    });
  });

  describe('pattern matching', () => {
    it('should match BUNDLE_COORDINATOR pattern', () => {
      // Features typical of bundle coordination
      // Also set security features to "safe" values so RUG_PULLER doesn't dominate
      const features = new Float32Array(29);
      features[15] = 1; // bundleDetected
      features[16] = 0.5; // bundleCountNorm (10+ wallets)
      features[17] = 0.6; // bundleControlPercent - higher to emphasize bundles
      features[18] = 0.95; // bundleConfidence - very high
      features[19] = 0.8; // bundleQuality
      features[11] = 1; // mintDisabled (safe - reduce RUG_PULLER match)
      features[12] = 1; // freezeDisabled (safe)
      features[13] = 1; // lpLocked (safe)
      features[6] = 0.7; // high top10Concentration

      const matches = library.matchPatterns(features, { minSimilarity: 0.3 });

      expect(matches.length).toBeGreaterThan(0);
      // BUNDLE_COORDINATOR should be in top matches when bundle features are prominent
      const bundleMatch = matches.find(m => m.pattern.id === 'BUNDLE_COORDINATOR');
      expect(bundleMatch).toBeDefined();
      expect(bundleMatch!.similarity).toBeGreaterThan(0.3);
    });

    it('should match RUG_PULLER pattern', () => {
      // Features typical of rug pull setup
      const features = new Float32Array(29);
      features[11] = 0; // Mint NOT disabled (bad)
      features[12] = 0; // Freeze NOT disabled (bad)
      features[13] = 0; // LP NOT locked (bad)
      features[27] = 0.8; // Creator has rug history
      features[28] = 0.7; // High creator holdings

      const matches = library.matchPatterns(features, { minSimilarity: 0.3 });

      const rugPattern = matches.find(m => m.pattern.id === 'RUG_PULLER');
      expect(rugPattern).toBeDefined();
    });

    it('should match HONEYPOT pattern', () => {
      // Features typical of honeypot
      const features = new Float32Array(29);
      features[12] = 0; // Freeze enabled (bad)
      features[20] = 0.99; // Very high buy ratio (no one can sell)
      features[5] = 0.6; // Some holders
      features[24] = 0.8; // Recent trading

      const matches = library.matchPatterns(features, { minSimilarity: 0.3 });

      const honeypot = matches.find(m => m.pattern.id === 'HONEYPOT');
      expect(honeypot).toBeDefined();
    });

    it('should identify LEGITIMATE_VC pattern', () => {
      // Features of a legitimate token
      const features = new Float32Array(29);
      features[0] = 0.9; // High liquidity
      features[5] = 0.8; // Many holders
      features[6] = 0.3; // Low concentration
      features[7] = 0.25; // Low Gini
      features[11] = 1; // Mint disabled (good)
      features[12] = 1; // Freeze disabled (good)
      features[13] = 1; // LP locked (good)
      features[15] = 0; // No bundles
      features[26] = 1; // Creator identified

      const matches = library.matchPatterns(features, { minSimilarity: 0.3 });

      const legitimate = matches.find(m => m.pattern.id === 'LEGITIMATE_VC');
      expect(legitimate).toBeDefined();
    });

    it('should return confidence score for matches', () => {
      const features = new Float32Array(29);
      features[15] = 1; // bundleDetected
      features[17] = 0.5; // bundleControlPercent

      const matches = library.matchPatterns(features);

      if (matches.length > 0) {
        expect(matches[0].confidence).toBeGreaterThan(0);
        expect(matches[0].confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should return matched indicators', () => {
      const features = new Float32Array(29);
      features[15] = 1; // bundleDetected
      features[17] = 0.5; // bundleControlPercent

      const matches = library.matchPatterns(features);

      if (matches.length > 0) {
        expect(matches[0].matchedIndicators).toBeDefined();
        expect(Array.isArray(matches[0].matchedIndicators)).toBe(true);
      }
    });
  });

  describe('pattern retrieval', () => {
    it('should get pattern by ID', () => {
      const pattern = library.getPattern('BUNDLE_COORDINATOR');

      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('Bundle Coordinator');
    });

    it('should return undefined for unknown pattern', () => {
      const pattern = library.getPattern('UNKNOWN_PATTERN');

      expect(pattern).toBeUndefined();
    });

    it('should get high severity patterns', () => {
      const highSeverity = library.getHighSeverityPatterns();

      for (const pattern of highSeverity) {
        expect(['HIGH', 'CRITICAL']).toContain(pattern.severity);
      }
    });
  });

  describe('pattern severity', () => {
    it('should rank CRITICAL patterns with high rug rates', () => {
      const patterns = library.getAllPatterns();
      const criticalPatterns = patterns.filter(p => p.severity === 'CRITICAL');

      for (const pattern of criticalPatterns) {
        expect(pattern.rugRate).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('should rank LOW patterns with low rug rates', () => {
      const patterns = library.getAllPatterns();
      const lowPatterns = patterns.filter(p => p.severity === 'LOW');

      for (const pattern of lowPatterns) {
        expect(pattern.rugRate).toBeLessThanOrEqual(0.1);
      }
    });
  });

  describe('pattern feature weights', () => {
    it('should have 29 weights per pattern', () => {
      const patterns = library.getAllPatterns();

      for (const pattern of patterns) {
        expect(pattern.featureWeights).toBeDefined();
        expect(pattern.featureWeights.length).toBe(29);
      }
    });

    it('should emphasize bundle features for BUNDLE_COORDINATOR', () => {
      const bundlePattern = library.getPattern('BUNDLE_COORDINATOR');

      if (bundlePattern) {
        // Bundle features (15-19) should have high weights
        expect(bundlePattern.featureWeights[15]).toBeGreaterThan(0); // bundleDetected
        expect(bundlePattern.featureWeights[17]).toBeGreaterThan(0); // bundleControlPercent
      }
    });

    it('should emphasize security features for RUG_PULLER', () => {
      const rugPattern = library.getPattern('RUG_PULLER');

      if (rugPattern) {
        // Security features should have weights (negative means enabled is bad)
        expect(rugPattern.featureWeights[11]).not.toBe(0); // mintDisabled
        expect(rugPattern.featureWeights[27]).toBeGreaterThan(0); // creatorRugHistory
      }
    });
  });

  describe('recording detections', () => {
    it('should record pattern detection', () => {
      const patternBefore = library.getPattern('BUNDLE_COORDINATOR');
      const countBefore = patternBefore?.detectionCount || 0;

      library.recordDetection('BUNDLE_COORDINATOR', true, 'TestToken123');

      const patternAfter = library.getPattern('BUNDLE_COORDINATOR');
      expect(patternAfter?.detectionCount).toBe(countBefore + 1);
    });

    it('should update rug rate based on outcome', () => {
      const pattern = library.getPattern('BUNDLE_COORDINATOR');
      const rugRateBefore = pattern?.rugRate || 0;

      // Record multiple non-rug outcomes to lower the rate
      for (let i = 0; i < 10; i++) {
        library.recordDetection('BUNDLE_COORDINATOR', false);
      }

      const patternAfter = library.getPattern('BUNDLE_COORDINATOR');
      // Rug rate should have decreased (EMA with alpha 0.1)
      expect(patternAfter?.rugRate).toBeLessThan(rugRateBefore);
    });

    it('should add token to examples', () => {
      library.recordDetection('BUNDLE_COORDINATOR', true, 'ExampleToken456');

      const pattern = library.getPattern('BUNDLE_COORDINATOR');
      expect(pattern?.examples).toContain('ExampleToken456');
    });
  });

  describe('statistics', () => {
    it('should return library stats', () => {
      const stats = library.getStats();

      expect(stats.totalPatterns).toBe(8);
      expect(stats.activePatterns).toBe(8);
      expect(stats.avgRugRate).toBeGreaterThan(0);
      expect(stats.topPatterns).toBeDefined();
    });

    it('should track total detections', () => {
      library.recordDetection('BUNDLE_COORDINATOR', true);
      library.recordDetection('RUG_PULLER', true);

      const stats = library.getStats();
      expect(stats.totalDetections).toBeGreaterThanOrEqual(2);
    });
  });

  describe('pattern lifecycle', () => {
    it('should deactivate patterns', () => {
      library.deactivatePattern('MICRO_CAP_TRAP');

      const pattern = library.getPattern('MICRO_CAP_TRAP');
      expect(pattern?.active).toBe(false);
    });

    it('should exclude inactive patterns from high severity list', () => {
      // Deactivate a high severity pattern
      library.deactivatePattern('PUMP_AND_DUMP');

      const highSeverity = library.getHighSeverityPatterns();
      const pumpAndDump = highSeverity.find(p => p.id === 'PUMP_AND_DUMP');

      expect(pumpAndDump).toBeUndefined();
    });
  });

  describe('export/import', () => {
    it('should export patterns', () => {
      const exported = library.exportPatterns();

      expect(exported.patterns).toBeDefined();
      expect(exported.patterns.length).toBe(8);
      expect(exported.exportedAt).toBeDefined();
    });

    it('should import patterns', () => {
      const exported = library.exportPatterns();

      // Create new library and import
      const newLibrary = new PatternLibrary();
      newLibrary.importPatterns(exported);

      // Should have both original and imported patterns
      const allPatterns = newLibrary.getAllPatterns();
      expect(allPatterns.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('creating patterns from observation', () => {
    it('should create new pattern from examples', () => {
      const examples = [
        new Float32Array(29).fill(0.5),
        new Float32Array(29).fill(0.6),
        new Float32Array(29).fill(0.55),
      ];

      const newPattern = library.createPatternFromObservation(
        'New Scam Pattern',
        'A newly discovered scam pattern',
        examples,
        ['Indicator 1', 'Indicator 2'],
        'MEDIUM'
      );

      expect(newPattern.id).toContain('LEARNED_');
      expect(newPattern.name).toBe('New Scam Pattern');
      expect(newPattern.featureWeights.length).toBe(29);
    });
  });
});
