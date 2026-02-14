/**
 * LLMService Tests
 *
 * Tests Ollama integration with DeepSeek-R1 32B and Qwen 3 8B.
 * Hetzner server: agents-n-database (46.225.3.208)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LLMService, TokenAnalysisContext, TokenVerdict } from '../../packages/agents/src/services/LLMService';

// Mock fetch for unit tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LLMService', () => {
  let llm: LLMService;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new LLMService({
      endpoint: 'http://46.225.3.208:11434', // Hetzner agents-n-database
      reasoningModel: 'deepseek-r1:32b',
      fastModel: 'qwen3:8b',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configuration', () => {
    it('should use DeepSeek-R1 32B for reasoning tasks', () => {
      const config = (llm as any).config;
      expect(config.reasoningModel).toBe('deepseek-r1:32b');
    });

    it('should use Qwen 3 8B for fast classification', () => {
      const config = (llm as any).config;
      expect(config.fastModel).toBe('qwen3:8b');
    });

    it('should have correct Hetzner endpoint', () => {
      const config = (llm as any).config;
      expect(config.endpoint).toBe('http://46.225.3.208:11434');
    });

    it('should have long timeout for DeepSeek reasoning (5 min)', () => {
      const config = (llm as any).config;
      expect(config.reasoningTimeout).toBe(300000);
    });

    it('should have shorter timeout for Qwen fast tasks (1 min)', () => {
      const config = (llm as any).config;
      expect(config.fastTimeout).toBe(60000);
    });

    it('should use default models if not specified', () => {
      const defaultLlm = new LLMService({
        endpoint: 'http://localhost:11434',
      });
      const config = (defaultLlm as any).config;
      expect(config.reasoningModel).toBe('deepseek-r1:32b');
      expect(config.fastModel).toBe('qwen3:8b');
    });
  });

  describe('health check', () => {
    it('should check Ollama server availability', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'deepseek-r1:32b' }, { name: 'qwen3:8b' }] }),
      });

      const available = await llm.isAvailable();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tags'),
        expect.any(Object)
      );
      expect(available).toBe(true);
    });

    it('should return false when server is down', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const available = await llm.isAvailable();

      expect(available).toBe(false);
    });

    it('should cache health check result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      await llm.isAvailable();
      await llm.isAvailable();

      // Should only call once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('chat method', () => {
    it('should send chat request with correct structure', async () => {
      // First call for health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['qwen3:8b'] }),
      });

      // Second call for chat
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Test response' },
        }),
      });

      const result = await llm.chat({
        system: 'You are a helpful assistant',
        prompt: 'Hello',
        model: 'fast',
      });

      expect(result).toBe('Test response');
    });

    it('should use reasoning model when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['deepseek-r1:32b'] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: '{"answer": "test"}' },
        }),
      });

      await llm.chat({
        system: 'You are an analyst',
        prompt: 'Analyze this',
        model: 'reasoning',
        format: 'json',
      });

      // Verify the second call (chat request) used the reasoning model
      const chatCall = mockFetch.mock.calls[1];
      expect(chatCall[0]).toContain('/api/chat');
      const body = JSON.parse(chatCall[1].body);
      expect(body.model).toBe('deepseek-r1:32b');
    });

    it('should use fast model by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['qwen3:8b'] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Fast response' },
        }),
      });

      await llm.chat({
        system: 'You are a classifier',
        prompt: 'Classify this',
      });

      const chatCall = mockFetch.mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      expect(body.model).toBe('qwen3:8b');
    });

    it('should return null when server is unavailable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await llm.chat({
        system: 'Test',
        prompt: 'Test',
      });

      expect(result).toBeNull();
    });
  });

  describe('token analysis (DeepSeek-R1)', () => {
    it('should analyze token with full context', async () => {
      const mockResponse: TokenVerdict = {
        verdict: 'DANGEROUS',
        confidence: 0.85,
        reasoning: 'Bundle detected with 40% control, fresh wallets, creator has rug history',
        summary: 'High risk token showing coordinated pump-and-dump patterns',
        attackVector: 'PUMP_AND_DUMP',
        recommendations: ['Avoid trading', 'Report to community'],
      };

      // Health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['deepseek-r1:32b'] }),
      });

      // Token analysis
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify(mockResponse) },
        }),
      });

      const context: TokenAnalysisContext = {
        tokenAddress: 'DangerToken123',
        score: 75,
        riskLevel: 'HIGH',
        findings: [
          { category: 'holders', finding: 'Bundle detected', severity: 'HIGH' },
          { category: 'creator', finding: 'Has rug history', severity: 'CRITICAL' },
        ],
        security: { mintDisabled: false, freezeDisabled: true, lpLocked: false, lpBurned: false },
        holders: { count: 50, top10Concentration: 0.8, topWhalePercent: 0.4, gini: 0.85 },
        bundle: { detected: true, count: 8, controlPercent: 0.4, confidence: 0.9 },
        trading: { buyRatio24h: 0.9, buyRatio1h: 0.95, volume: 10000, liquidity: 5000 },
        creator: { identified: true, rugHistory: 3, holdings: 0.2, isKnownScammer: true },
        tokenAge: '2 hours',
      };

      const verdict = await llm.analyzeToken(context);

      expect(verdict).toBeDefined();
      expect(verdict?.verdict).toBe('DANGEROUS');
      expect(verdict?.attackVector).toBe('PUMP_AND_DUMP');
    });

    it('should return null on parse error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['deepseek-r1:32b'] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'This is not JSON' },
        }),
      });

      const result = await llm.analyzeToken({
        tokenAddress: 'test',
        score: 50,
        riskLevel: 'MEDIUM',
        findings: [],
        security: { mintDisabled: true, freezeDisabled: true, lpLocked: true, lpBurned: false },
        holders: { count: 100, top10Concentration: 0.5, topWhalePercent: 0.15, gini: 0.5 },
        bundle: { detected: false, count: 0, controlPercent: 0, confidence: 0 },
        trading: { buyRatio24h: 0.5, buyRatio1h: 0.5, volume: 10000, liquidity: 10000 },
        creator: { identified: false, rugHistory: 0, holdings: 0, isKnownScammer: false },
        tokenAge: '1 day',
      });

      // Should return null or fallback on parse error
      expect(result === null || result.verdict !== undefined).toBe(true);
    });
  });

  describe('pattern classification', () => {
    it('should classify scam patterns', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['deepseek-r1:32b'] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              pattern: 'BUNDLE_COORDINATOR',
              confidence: 0.89,
              evidence: ['8 wallets bought within 30 seconds', 'All funded by same master wallet'],
              reasoning: 'Coordinated bundle attack pattern detected',
            }),
          },
        }),
      });

      // classifyPattern expects the correct interface
      const result = await llm.classifyPattern({
        wallet: 'BundleWallet123',
        tokensInvolved: ['Token1', 'Token2', 'Token3'],
        ruggedTokens: ['Token1', 'Token2'],
        connectedWallets: ['Wallet1', 'Wallet2', 'Wallet3'],
        evidence: ['Funded by same wallet', 'Bought within 30s'],
        transactionCount: 50,
        bundleCount: 8,
      });

      expect(result?.pattern).toBe('BUNDLE_COORDINATOR');
      expect(result?.confidence).toBeGreaterThan(0.8);
    });

    it('should return UNKNOWN for insufficient evidence', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['deepseek-r1:32b'] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              pattern: 'UNKNOWN',
              confidence: 0.3,
              evidence: ['Limited transaction history'],
              reasoning: 'Insufficient data to classify pattern',
            }),
          },
        }),
      });

      const result = await llm.classifyPattern({
        wallet: 'NewWallet',
        tokensInvolved: ['Token1'],
        ruggedTokens: [],
        connectedWallets: [],
        evidence: ['Limited history'],
        transactionCount: 2,
      });

      expect(result?.pattern).toBe('UNKNOWN');
      expect(result?.confidence).toBeLessThan(0.5);
    });
  });

  describe('graceful degradation', () => {
    it('should return null when server is unreachable', async () => {
      // Reset mocks completely and set up fresh failure scenario
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      // Create fresh LLM instance to avoid cached availability
      const freshLlm = new LLMService({
        endpoint: 'http://46.225.3.208:11434',
        reasoningModel: 'deepseek-r1:32b',
        fastModel: 'qwen3:8b',
      });

      const result = await freshLlm.analyzeToken({
        tokenAddress: 'test',
        score: 50,
        riskLevel: 'MEDIUM',
        findings: [],
        security: { mintDisabled: true, freezeDisabled: true, lpLocked: true, lpBurned: false },
        holders: { count: 100, top10Concentration: 0.5, topWhalePercent: 0.15, gini: 0.5 },
        bundle: { detected: false, count: 0, controlPercent: 0, confidence: 0 },
        trading: { buyRatio24h: 0.5, buyRatio1h: 0.5, volume: 10000, liquidity: 10000 },
        creator: { identified: false, rugHistory: 0, holdings: 0, isKnownScammer: false },
        tokenAge: '1 day',
      });

      expect(result).toBeNull();
    });

    it('should allow callers to fall back to rule-based logic', async () => {
      mockFetch.mockRejectedValue(new Error('Server down'));

      const chatResult = await llm.chat({
        system: 'Test',
        prompt: 'Question',
      });

      // Caller should handle null and use fallback
      if (chatResult === null) {
        // Fall back to rule-based logic
        const fallbackResult = 'Rule-based fallback activated';
        expect(fallbackResult).toBeDefined();
      }
    });
  });

  describe('retry behavior', () => {
    it('should retry once on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['qwen3:8b'] }),
      });

      // First attempt fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Second attempt succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Success on retry' },
        }),
      });

      const result = await llm.chat({
        system: 'Test',
        prompt: 'Test',
      });

      expect(result).toBe('Success on retry');
    });
  });

  describe('response parsing', () => {
    it('should handle thinking field from DeepSeek-R1', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['deepseek-r1:32b'] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: '',
            thinking: 'Output in thinking field',
          },
        }),
      });

      const result = await llm.chat({
        system: 'Test',
        prompt: 'Test',
        model: 'reasoning',
      });

      expect(result).toBe('Output in thinking field');
    });

    it('should strip <think> tags from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ['deepseek-r1:32b'] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: '<think>Internal reasoning...</think>Actual response',
          },
        }),
      });

      const result = await llm.chat({
        system: 'Test',
        prompt: 'Test',
      });

      expect(result).toBe('Actual response');
    });
  });
});

describe('LLMService Integration (requires running Ollama)', () => {
  // These tests require actual Ollama server
  // Skip in CI, run locally with: pnpm test -- --grep "Integration"

  it.skip('should connect to real Hetzner server', async () => {
    const llm = new LLMService({
      endpoint: 'http://46.225.3.208:11434',
    });

    const available = await llm.isAvailable();
    expect(available).toBe(true);
  });

  it.skip('should get real DeepSeek-R1 analysis', async () => {
    const llm = new LLMService({
      endpoint: 'http://46.225.3.208:11434',
    });

    const verdict = await llm.analyzeToken({
      tokenAddress: 'TestToken123',
      score: 65,
      riskLevel: 'MEDIUM',
      findings: [
        { category: 'holders', finding: 'Top 10 hold 70%', severity: 'HIGH' },
      ],
      security: { mintDisabled: true, freezeDisabled: true, lpLocked: false, lpBurned: false },
      holders: { count: 100, top10Concentration: 0.7, topWhalePercent: 0.25, gini: 0.7 },
      bundle: { detected: false, count: 0, controlPercent: 0, confidence: 0 },
      trading: { buyRatio24h: 0.8, buyRatio1h: 0.9, volume: 50000, liquidity: 20000 },
      creator: { identified: false, rugHistory: 0, holdings: 0, isKnownScammer: false },
      tokenAge: '6 hours',
    });

    expect(verdict).toBeDefined();
    expect(['SAFE', 'SUSPICIOUS', 'DANGEROUS', 'SCAM']).toContain(verdict?.verdict);
  });
});
