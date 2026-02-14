/**
 * HunterAgent Tests
 *
 * Tests scammer tracking, wallet network analysis, and profile management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HunterAgent, ScammerProfile } from '../../packages/agents/src/agents/HunterAgent';
import { MessageBus } from '../../packages/agents/src/core/MessageBus';

describe('HunterAgent', () => {
  let messageBus: MessageBus;
  let hunter: HunterAgent;

  beforeEach(async () => {
    messageBus = new MessageBus();
    hunter = new HunterAgent(messageBus, {
      name: 'test-hunter',
      rpcEndpoint: 'http://localhost:8899',
    });
    await hunter.initialize();
  });

  describe('scammer profiles', () => {
    it('should track scammer profiles in memory', () => {
      // Add profile directly to the map
      const profile: ScammerProfile = {
        wallet: 'Scammer123',
        pattern: 'RUG_PULLER',
        confidence: 85,
        tokens: ['Rug1', 'Rug2'],
        ruggedTokens: ['Rug1', 'Rug2'],
        firstSeen: Date.now() - 86400000,
        lastSeen: Date.now(),
        totalVictims: 0,
        estimatedProfit: 0,
        connectedWallets: [],
        evidence: ['Creator dumped all tokens'],
      };

      (hunter as any).scammerProfiles.set('Scammer123', profile);

      const stored = (hunter as any).scammerProfiles.get('Scammer123');
      expect(stored).toBeDefined();
      expect(stored.pattern).toBe('RUG_PULLER');
      expect(stored.ruggedTokens).toHaveLength(2);
    });

    it('should update existing profile with new token', () => {
      const profile: ScammerProfile = {
        wallet: 'RepeatOffender',
        pattern: 'RUG_PULLER',
        confidence: 80,
        tokens: ['Rug1'],
        ruggedTokens: ['Rug1'],
        firstSeen: Date.now() - 86400000,
        lastSeen: Date.now() - 3600000,
        totalVictims: 0,
        estimatedProfit: 0,
        connectedWallets: [],
        evidence: [],
      };

      (hunter as any).scammerProfiles.set('RepeatOffender', profile);

      // Update with new rug
      const existing = (hunter as any).scammerProfiles.get('RepeatOffender');
      existing.tokens.push('Rug2');
      existing.ruggedTokens.push('Rug2');
      existing.lastSeen = Date.now();

      expect(existing.tokens).toContain('Rug2');
      expect(existing.ruggedTokens).toHaveLength(2);
    });
  });

  describe('watchlist management', () => {
    it('should add wallet to watchlist', () => {
      (hunter as any).watchlist.add('SuspiciousWallet123');

      expect((hunter as any).watchlist.has('SuspiciousWallet123')).toBe(true);
    });

    it('should track multiple wallets', () => {
      (hunter as any).watchlist.add('Wallet1');
      (hunter as any).watchlist.add('Wallet2');
      (hunter as any).watchlist.add('Wallet3');

      expect((hunter as any).watchlist.size).toBe(3);
    });
  });

  describe('wallet network', () => {
    it('should track wallet connections', () => {
      // Add connection via the addToNetwork method
      (hunter as any).addToNetwork('WalletA', 'WalletB');

      const networkA = (hunter as any).walletNetwork.get('WalletA');
      const networkB = (hunter as any).walletNetwork.get('WalletB');

      expect(networkA).toBeDefined();
      expect(networkA.has('WalletB')).toBe(true);
      expect(networkB.has('WalletA')).toBe(true);
    });

    it('should build network graph from multiple connections', () => {
      (hunter as any).addToNetwork('Master', 'Child1');
      (hunter as any).addToNetwork('Master', 'Child2');
      (hunter as any).addToNetwork('Master', 'Child3');

      const masterNetwork = (hunter as any).walletNetwork.get('Master');

      expect(masterNetwork.size).toBe(3);
      expect(masterNetwork.has('Child1')).toBe(true);
      expect(masterNetwork.has('Child2')).toBe(true);
      expect(masterNetwork.has('Child3')).toBe(true);
    });
  });

  describe('checkRepeatOffender', () => {
    it('should identify known scammer', async () => {
      // Add known scammer
      const profile: ScammerProfile = {
        wallet: 'KnownScammer',
        pattern: 'RUG_PULLER',
        confidence: 90,
        tokens: ['Rug1', 'Rug2', 'Rug3'],
        ruggedTokens: ['Rug1', 'Rug2', 'Rug3'],
        firstSeen: Date.now() - 86400000,
        lastSeen: Date.now(),
        totalVictims: 100,
        estimatedProfit: 50,
        connectedWallets: [],
        evidence: [],
      };

      (hunter as any).scammerProfiles.set('KnownScammer', profile);

      const result = await (hunter as any).checkRepeatOffender({ wallet: 'KnownScammer' });

      expect(result.isRepeat).toBe(true);
      expect(result.rugCount).toBe(3);
      expect(result.profile).toBeDefined();
    });

    it('should return false for unknown wallet', async () => {
      const result = await (hunter as any).checkRepeatOffender({ wallet: 'UnknownWallet' });

      expect(result.isRepeat).toBe(false);
      expect(result.rugCount).toBe(0);
      expect(result.profile).toBeNull();
    });
  });

  describe('pattern detection', () => {
    it('should detect pattern from profile data', async () => {
      // Set up profile context
      const profile: ScammerProfile = {
        wallet: 'TestWallet',
        pattern: 'UNKNOWN',
        confidence: 0,
        tokens: ['Token1'],
        ruggedTokens: ['Token1'],
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        totalVictims: 0,
        estimatedProfit: 0,
        connectedWallets: [],
        evidence: [],
      };

      (hunter as any).scammerProfiles.set('TestWallet', profile);

      const result = await (hunter as any).detectPattern({
        wallet: 'TestWallet',
        profile: {
          age: 24,
          transactionCount: 100,
          tradingPattern: 'ACTIVE',
        },
      });

      expect(result.pattern).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.evidence)).toBe(true);
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      // Add some test data
      (hunter as any).scammerProfiles.set('Scammer1', {} as ScammerProfile);
      (hunter as any).scammerProfiles.set('Scammer2', {} as ScammerProfile);
      (hunter as any).watchlist.add('Watch1');
      (hunter as any).walletNetwork.set('Node1', new Set());

      const stats = hunter.getStats();

      expect(stats.profileCount).toBe(2);
      expect(stats.watchlistSize).toBe(1);
      expect(stats.networkNodes).toBe(1);
    });
  });

  describe('message handlers', () => {
    it('should respond to check_wallet messages', async () => {
      // Set up known scammer
      const profile: ScammerProfile = {
        wallet: 'MessageTestScammer',
        pattern: 'RUG_PULLER',
        confidence: 85,
        tokens: ['Rug1'],
        ruggedTokens: ['Rug1'],
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        totalVictims: 0,
        estimatedProfit: 0,
        connectedWallets: [],
        evidence: [],
      };

      (hunter as any).scammerProfiles.set('MessageTestScammer', profile);

      const resultSpy = vi.fn();
      messageBus.subscribe('agent.test-agent.wallet_check_result', resultSpy);

      // Send check wallet request
      await messageBus.publish('agent.test-hunter.check_wallet', {
        wallet: 'MessageTestScammer',
      }, { from: 'test-agent' });

      await new Promise(r => setTimeout(r, 100));

      expect(resultSpy).toHaveBeenCalled();
    });
  });

  describe('constraints', () => {
    it('should have correct constraints', () => {
      const constraints = (hunter as any).getConstraints();

      expect(constraints.maxWatchlistSize).toBe(1000);
      expect(constraints.minConfidenceForAlert).toBe(0.7);
      expect(constraints.maxNetworkDepth).toBe(3);
    });
  });
});
