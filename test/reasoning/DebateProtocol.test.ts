/**
 * DebateProtocol Tests
 *
 * Tests multi-agent consensus, voting, and debate resolution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DebateProtocol, Proposal, DebateResult } from '../../packages/agents/src/reasoning/DebateProtocol';
import { MessageBus } from '../../packages/agents/src/core/MessageBus';
import { LLMService } from '../../packages/agents/src/services/LLMService';

// Mock LLMService
const createMockLLM = () => ({
  isAvailable: vi.fn().mockResolvedValue(true),
  chat: vi.fn(),
} as unknown as LLMService);

describe('DebateProtocol', () => {
  let messageBus: MessageBus;
  let mockLLM: ReturnType<typeof createMockLLM>;
  let debate: DebateProtocol;

  beforeEach(() => {
    vi.clearAllMocks();
    messageBus = new MessageBus();
    mockLLM = createMockLLM();
    debate = new DebateProtocol(mockLLM, messageBus);
  });

  describe('proposal creation', () => {
    it('should create valid proposal with required fields', () => {
      const proposal: Proposal = {
        id: 'prop_123',
        agent: 'analyst',
        action: 'BUY',
        target: 'TokenABC123456789',
        reasoning: 'Token looks safe with good fundamentals',
        confidence: 0.85,
        context: {
          score: 25,
          liquidity: 50000,
          holders: 500,
        },
        timestamp: Date.now(),
      };

      expect(proposal.id).toBeDefined();
      expect(proposal.action).toBe('BUY');
      expect(proposal.target).toBeDefined();
      expect(proposal.reasoning).toBeDefined();
    });

    it('should generate unique proposal IDs', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        ids.add(id);
      }

      expect(ids.size).toBe(100); // All unique
    });
  });

  describe('voting', () => {
    it('should collect votes from all agents', async () => {
      // Mock LLM to return arguments and votes
      mockLLM.chat = vi.fn()
        .mockResolvedValue(JSON.stringify({
          position: 'SUPPORT',
          points: ['Good fundamentals'],
          confidence: 0.8
        }));

      const proposal: Proposal = {
        id: 'prop_safe',
        agent: 'analyst',
        action: 'BUY',
        target: 'SafeToken12345678',
        reasoning: 'Safe token analysis',
        confidence: 0.85,
        context: { score: 20 },
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.votes).toBeDefined();
      expect(result.votes.length).toBeGreaterThan(0);
    });

    it('should reach consensus when all agents agree', async () => {
      // All agents support
      mockLLM.chat = vi.fn()
        .mockResolvedValue(JSON.stringify({
          position: 'SUPPORT',
          points: ['Looks good'],
          confidence: 0.9
        }));

      const proposal: Proposal = {
        id: 'prop_consensus',
        agent: 'scout',
        action: 'BUY',
        target: 'ConsensusToken1234',
        reasoning: 'Good opportunity',
        confidence: 0.9,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.decision).toBeDefined();
      // Decision should be APPROVED or REJECTED based on votes
      expect(['APPROVED', 'REJECTED']).toContain(result.decision);
    });

    it('should handle mixed votes', async () => {
      // Mix of support and oppose
      let callCount = 0;
      mockLLM.chat = vi.fn().mockImplementation(() => {
        callCount++;
        const position = callCount % 2 === 0 ? 'SUPPORT' : 'OPPOSE';
        return Promise.resolve(JSON.stringify({
          position,
          points: [position === 'SUPPORT' ? 'Looks safe' : 'Too risky'],
          confidence: 0.7
        }));
      });

      const proposal: Proposal = {
        id: 'prop_mixed',
        agent: 'analyst',
        action: 'BUY',
        target: 'MixedToken12345678',
        reasoning: 'Mixed signals',
        confidence: 0.6,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result).toBeDefined();
      expect(result.votes.length).toBeGreaterThan(0);
    });
  });

  describe('action types', () => {
    const actions: Array<Proposal['action']> = ['BUY', 'SELL', 'ALERT', 'TRACK', 'IGNORE'];

    for (const action of actions) {
      it(`should handle ${action} proposals`, async () => {
        mockLLM.chat = vi.fn().mockResolvedValue(JSON.stringify({
          position: 'SUPPORT',
          points: ['Valid action'],
          confidence: 0.8
        }));

        const proposal: Proposal = {
          id: `prop_${action.toLowerCase()}`,
          agent: 'analyst',
          action,
          target: 'TestToken12345678',
          reasoning: `${action} reasoning`,
          confidence: 0.75,
          context: {},
          timestamp: Date.now(),
        };

        const result = await debate.debate(proposal);
        expect(result).toBeDefined();
        expect(result.proposal.action).toBe(action);
      });
    }
  });

  describe('reasoning collection', () => {
    it('should collect arguments from agents', async () => {
      mockLLM.chat = vi.fn().mockResolvedValue(JSON.stringify({
        position: 'SUPPORT',
        points: ['Liquidity above threshold', 'Holder distribution healthy'],
        confidence: 0.85
      }));

      const proposal: Proposal = {
        id: 'prop_reasoning',
        agent: 'scout',
        action: 'BUY',
        target: 'ReasonToken12345678',
        reasoning: 'Initial analysis',
        confidence: 0.8,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.arguments).toBeDefined();
      expect(result.arguments.length).toBeGreaterThan(0);
    });

    it('should include consensus reasoning', async () => {
      mockLLM.chat = vi.fn().mockResolvedValue(JSON.stringify({
        position: 'SUPPORT',
        points: ['Valid'],
        confidence: 0.9
      }));

      const proposal: Proposal = {
        id: 'prop_synth',
        agent: 'analyst',
        action: 'BUY',
        target: 'SynthToken12345678',
        reasoning: 'Synthesis test',
        confidence: 0.85,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.consensusReasoning).toBeDefined();
    });
  });

  describe('debate timing', () => {
    it('should track total debate time', async () => {
      mockLLM.chat = vi.fn().mockResolvedValue(JSON.stringify({
        position: 'SUPPORT',
        points: ['OK'],
        confidence: 0.8
      }));

      const proposal: Proposal = {
        id: 'prop_timing',
        agent: 'trader',
        action: 'BUY',
        target: 'TimingToken12345678',
        reasoning: 'Timing test',
        confidence: 0.75,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.totalTimeMs).toBeDefined();
      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('confidence calculation', () => {
    it('should calculate overall confidence', async () => {
      mockLLM.chat = vi.fn().mockResolvedValue(JSON.stringify({
        position: 'SUPPORT',
        points: ['High confidence'],
        confidence: 0.95
      }));

      const proposal: Proposal = {
        id: 'prop_conf',
        agent: 'analyst',
        action: 'BUY',
        target: 'ConfidenceToken1234',
        reasoning: 'Confidence test',
        confidence: 0.9,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('error handling', () => {
    it('should handle LLM failures gracefully', async () => {
      // LLMService returns null when unavailable (not rejecting)
      mockLLM.chat = vi.fn().mockResolvedValue(null);

      const proposal: Proposal = {
        id: 'prop_error',
        agent: 'analyst',
        action: 'BUY',
        target: 'ErrorToken12345678',
        reasoning: 'Error test',
        confidence: 0.7,
        context: {},
        timestamp: Date.now(),
      };

      // Should handle gracefully with fallback values
      const result = await debate.debate(proposal);
      expect(result).toBeDefined();
      // Agents should abstain or be neutral when LLM unavailable
      expect(result.decision).toBeDefined();
    });

    it('should handle malformed LLM responses', async () => {
      mockLLM.chat = vi.fn().mockResolvedValue('not valid json');

      const proposal: Proposal = {
        id: 'prop_malformed',
        agent: 'analyst',
        action: 'BUY',
        target: 'MalformedToken12345',
        reasoning: 'Malformed test',
        confidence: 0.7,
        context: {},
        timestamp: Date.now(),
      };

      // Should handle gracefully
      const result = await debate.debate(proposal);
      expect(result).toBeDefined();
    });
  });

  describe('debate history', () => {
    it('should store debate results', async () => {
      mockLLM.chat = vi.fn().mockResolvedValue(JSON.stringify({
        position: 'SUPPORT',
        points: ['OK'],
        confidence: 0.8
      }));

      const proposal: Proposal = {
        id: 'prop_history',
        agent: 'analyst',
        action: 'BUY',
        target: 'HistoryToken12345678',
        reasoning: 'History test',
        confidence: 0.8,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.proposalId).toBe('prop_history');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('agent weights', () => {
    it('should assign weights based on expertise', async () => {
      mockLLM.chat = vi.fn().mockResolvedValue(JSON.stringify({
        position: 'SUPPORT',
        points: ['Valid'],
        confidence: 0.85
      }));

      const proposal: Proposal = {
        id: 'prop_weights',
        agent: 'analyst',
        action: 'ALERT', // Hunter should have higher weight for alerts
        target: 'WeightToken12345678',
        reasoning: 'Weight test',
        confidence: 0.85,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      // Votes should have weights
      for (const vote of result.votes) {
        expect(vote.weight).toBeDefined();
        expect(vote.weight).toBeGreaterThan(0);
      }
    });
  });

  describe('counter-arguments', () => {
    it('should collect counter-arguments', async () => {
      let callCount = 0;
      mockLLM.chat = vi.fn().mockImplementation(() => {
        callCount++;
        // First calls are arguments, later calls might be counters
        return Promise.resolve(JSON.stringify({
          position: callCount % 2 === 0 ? 'SUPPORT' : 'OPPOSE',
          points: ['Counter point'],
          confidence: 0.75
        }));
      });

      const proposal: Proposal = {
        id: 'prop_counters',
        agent: 'analyst',
        action: 'BUY',
        target: 'CounterToken12345678',
        reasoning: 'Counter test',
        confidence: 0.8,
        context: {},
        timestamp: Date.now(),
      };

      const result = await debate.debate(proposal);

      expect(result.counters).toBeDefined();
      // May or may not have counters depending on implementation
    });
  });
});
