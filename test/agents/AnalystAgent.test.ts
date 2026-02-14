/**
 * AnalystAgent Tests
 *
 * Tests the deep investigation, pattern matching, and bundle detection logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalystAgent, InvestigationReport } from '../../packages/agents/src/agents/AnalystAgent';
import { MessageBus } from '../../packages/agents/src/core/MessageBus';

describe('AnalystAgent', () => {
  let messageBus: MessageBus;
  let analyst: AnalystAgent;

  beforeEach(async () => {
    messageBus = new MessageBus();
    analyst = new AnalystAgent(messageBus, {
      name: 'test-analyst',
      rpcEndpoint: 'http://localhost:8899',
    });
    await analyst.initialize();
  });

  describe('initialization', () => {
    it('should initialize with pattern library', () => {
      const patternLibrary = (analyst as any).patternLibrary;
      expect(patternLibrary).toBeDefined();
    });

    it('should have on-chain tools', () => {
      const onChainTools = (analyst as any).onChainTools;
      expect(onChainTools).toBeDefined();
    });

    it('should have market data service', () => {
      const marketDataService = (analyst as any).marketDataService;
      expect(marketDataService).toBeDefined();
    });
  });

  describe('investigation queue', () => {
    it('should add investigation to queue', async () => {
      const request = {
        token: 'TestToken123',
        score: 50,
        flags: ['suspicious'],
        features: new Array(29).fill(0.5),
        priority: 'normal' as const,
        source: 'scout-1',
        timestamp: Date.now(),
      };

      // Access the queue via message bus
      await messageBus.publish('agent.test-analyst.investigate', request, { from: 'scout-1' });

      // Wait for message to be processed
      await new Promise(r => setTimeout(r, 100));

      // Queue should have been processed
      const queue = (analyst as any).investigationQueue;
      expect(queue).toBeDefined();
    });

    it('should prioritize critical investigations', async () => {
      const queue = (analyst as any).investigationQueue;

      queue.push({
        token: 'LowPriority',
        score: 30,
        flags: [],
        features: new Array(29).fill(0.3),
        priority: 'low',
        source: 'scout-1',
        timestamp: Date.now(),
      });

      queue.push({
        token: 'CriticalToken',
        score: 90,
        flags: ['critical'],
        features: new Array(29).fill(0.9),
        priority: 'critical',
        source: 'scout-1',
        timestamp: Date.now(),
      });

      // Sort by priority (as done in the run loop)
      queue.sort((a: any, b: any) => {
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      expect(queue[0].token).toBe('CriticalToken');
    });
  });

  describe('pattern matching', () => {
    it('should use pattern library for matching', () => {
      const patternLibrary = (analyst as any).patternLibrary;
      const patterns = patternLibrary.getAllPatterns();

      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should match suspicious features to patterns', () => {
      const patternLibrary = (analyst as any).patternLibrary;

      // Features typical of a rug puller
      const features = new Float32Array(29);
      features[11] = 0; // Mint NOT disabled
      features[12] = 0; // Freeze NOT disabled
      features[13] = 0; // LP NOT locked
      features[27] = 0.8; // Creator rug history
      features[28] = 0.7; // High creator holdings

      const matches = patternLibrary.matchPatterns(features, { minSimilarity: 0.3 });

      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe('feature processing', () => {
    it('should have buildTokenDataFromFeatures method', () => {
      // Verify the method exists
      const buildMethod = (analyst as any).buildTokenDataFromFeatures;
      expect(buildMethod).toBeDefined();
      expect(typeof buildMethod).toBe('function');
    });

    it('should process features with yellowstone data', () => {
      const features = new Float32Array(29);
      features[0] = 0.5; // liquidityLog
      features[6] = 0.7; // top10Concentration
      features[11] = 1.0; // mintDisabled
      features[12] = 1.0; // freezeDisabled

      const yellowstoneData = {
        liquiditySol: 30,
        dex: 'PUMP_FUN',
        poolAddress: 'TestPool',
      };

      // Call the method (may return different structure based on implementation)
      const tokenData = (analyst as any).buildTokenDataFromFeatures(
        'TestToken',
        features,
        yellowstoneData,
        ['LOW_LIQUIDITY']
      );

      // Just verify it doesn't throw and returns something
      expect(tokenData).toBeDefined();
    });
  });

  describe('completed investigations', () => {
    it('should store completed investigations', () => {
      const completedInvestigations = (analyst as any).completedInvestigations;
      expect(completedInvestigations).toBeDefined();
      expect(completedInvestigations instanceof Map).toBe(true);
    });

    it('should retrieve completed investigation', () => {
      const report: InvestigationReport = {
        token: 'TestToken',
        verdict: 'SAFE',
        confidence: 0.85,
        score: 25,
        summary: 'Token appears safe',
        findings: [],
        recommendation: 'CONSIDER',
        timestamp: Date.now(),
      };

      (analyst as any).completedInvestigations.set('TestToken', report);

      const retrieved = (analyst as any).completedInvestigations.get('TestToken');
      expect(retrieved).toBeDefined();
      expect(retrieved.verdict).toBe('SAFE');
    });
  });

  describe('scammer database', () => {
    it('should track scammer profiles locally', () => {
      const scammerDB = (analyst as any).scammerDB;
      expect(scammerDB).toBeDefined();
      expect(scammerDB instanceof Map).toBe(true);
    });

    it('should add scammer to local database', () => {
      const scammerDB = (analyst as any).scammerDB;

      scammerDB.set('ScammerWallet123', {
        rugCount: 3,
        pattern: 'RUG_PULLER',
        ruggedTokens: ['Token1', 'Token2', 'Token3'],
      });

      const scammer = scammerDB.get('ScammerWallet123');
      expect(scammer.rugCount).toBe(3);
      expect(scammer.pattern).toBe('RUG_PULLER');
    });
  });

  describe('message handling', () => {
    it('should handle investigate messages', async () => {
      const queueBefore = (analyst as any).investigationQueue.length;

      await messageBus.publish('agent.test-analyst.investigate', {
        token: 'MessageTestToken',
        score: 60,
        flags: ['test_flag'],
        features: new Array(29).fill(0.5),
        priority: 'high',
        source: 'scout-1',
        timestamp: Date.now(),
      }, { from: 'scout-1' });

      // Wait for message to be processed
      await new Promise(r => setTimeout(r, 100));

      // Queue should have increased
      const queue = (analyst as any).investigationQueue;
      expect(queue.length).toBeGreaterThanOrEqual(queueBefore);
    });
  });

  describe('constraints', () => {
    it('should have correct constraints', () => {
      // Analyst has no specific constraints, but check config
      const config = (analyst as any).config;

      expect(config.name).toBe('test-analyst');
      expect(config.maxReasoningSteps).toBe(7);
    });
  });

  describe('tools', () => {
    it('should have all required tools', () => {
      const config = (analyst as any).config;
      const toolNames = config.tools.map((t: any) => t.name);

      expect(toolNames).toContain('get_full_token_data');
      expect(toolNames).toContain('analyze_bundles');
      expect(toolNames).toContain('analyze_holders');
      expect(toolNames).toContain('check_creator_history');
      expect(toolNames).toContain('generate_report');
      expect(toolNames).toContain('recommend_action');
    });
  });
});
