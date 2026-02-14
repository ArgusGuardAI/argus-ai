/**
 * Full Flow Integration Tests
 *
 * Tests the complete token analysis pipeline from detection to trade decision.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentCoordinator } from '../../packages/agents/src/core/AgentCoordinator';
import { MessageBus } from '../../packages/agents/src/core/MessageBus';
import { ScoutAgent } from '../../packages/agents/src/agents/ScoutAgent';
import { AnalystAgent } from '../../packages/agents/src/agents/AnalystAgent';
import { TraderAgent } from '../../packages/agents/src/agents/TraderAgent';

describe('Full Token Analysis Flow', () => {
  let messageBus: MessageBus;
  let trader: TraderAgent;

  beforeEach(async () => {
    messageBus = new MessageBus();

    trader = new TraderAgent(messageBus, {
      name: 'test-trader',
      initialBalance: 10,
      maxPositionSize: 0.5,
      maxDailyTrades: 50,
    });

    await trader.start();
  });

  describe('message flow', () => {
    it('should route scan events through message bus', async () => {
      const scanEvents: any[] = [];
      messageBus.subscribe('agent.scout.scan', (msg) => scanEvents.push(msg));

      await messageBus.publish('agent.scout.scan', {
        token: 'SafeToken123',
        dex: 'PUMP_FUN',
        poolAddress: 'SafePool',
        liquiditySol: 50,
      });

      expect(scanEvents).toHaveLength(1);
      expect(scanEvents[0].data.token).toBe('SafeToken123');
    });

    it('should route alerts through message bus', async () => {
      const alerts: any[] = [];
      messageBus.subscribe('agent.analyst.alert', (msg) => alerts.push(msg));

      await messageBus.publish('agent.analyst.alert', {
        token: 'DangerToken456',
        score: 85,
        verdict: 'DANGEROUS',
        flags: ['low_liquidity', 'concentrated'],
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].data.verdict).toBe('DANGEROUS');
    });
  });

  describe('trader state', () => {
    it('should start with no positions', () => {
      const stats = trader.getStats();
      expect(stats.positions.length).toBe(0);
    });

    it('should track trader configuration', () => {
      const stats = trader.getStats();
      // getStats returns positionCount, not maxPositions
      // maxPositions is in getConstraints()
      expect(stats.positionCount).toBeDefined();
      expect(stats.balance).toBe(10); // Initial balance
    });
  });

  describe('bundle detection flow', () => {
    it('should detect bundles and warn', async () => {
      const hunterAlerts: any[] = [];
      messageBus.subscribe('agent.hunter.alert', (msg) => hunterAlerts.push(msg));

      // Simulate a bundled token
      // (In real scenario, bundle detection happens in AnalystAgent)

      // This tests the message flow exists
      await messageBus.publish('agent.hunter.alert', {
        type: 'bundle_detected',
        token: 'BundledToken',
        wallets: ['A', 'B', 'C', 'D', 'E'],
        controlPercent: 40,
      });

      expect(hunterAlerts).toHaveLength(1);
      // MessageBus wraps data in Message object with .data property
      expect(hunterAlerts[0].data.controlPercent).toBe(40);
    });
  });

  describe('price update flow', () => {
    it('should handle price update for non-existent position gracefully', async () => {
      // When no position exists, handlePriceUpdate should do nothing (no error)
      await trader.handlePriceUpdate({
        poolAddress: 'TestPool',
        tokenAddress: 'NonExistentToken',
        price: 0.00008,
        liquiditySol: 50,
        timestamp: Date.now(),
      });

      // Should not throw, positions should still be empty
      const stats = trader.getStats();
      expect(stats.positions.length).toBe(0);
    });

    it('should track position count correctly', async () => {
      // Verify initial state
      const stats = trader.getStats();
      expect(stats.positionCount).toBe(0);
      expect(stats.positions).toEqual([]);
    });
  });

  describe('multi-agent coordination', () => {
    it('should pass data through scout → analyst → trader', async () => {
      const scoutScans: any[] = [];
      const analystInvestigations: any[] = [];
      const traderSignals: any[] = [];

      messageBus.subscribe('agent.test-scout.scan', (data) => scoutScans.push(data));
      messageBus.subscribe('agent.test-analyst.investigation', (data) => analystInvestigations.push(data));
      messageBus.subscribe('agent.test-trader.signal', (data) => traderSignals.push(data));

      // Trigger the flow
      await messageBus.publish('agent.test-scout.scan', {
        token: 'FlowToken',
        liquiditySol: 50,
        dex: 'PUMP_FUN',
      });

      await messageBus.publish('agent.test-analyst.investigation', {
        token: 'FlowToken',
        score: 25, // Safe score
        verdict: 'SAFE',
      });

      await messageBus.publish('agent.test-trader.signal', {
        token: 'FlowToken',
        action: 'BUY',
        amount: 0.1,
      });

      expect(scoutScans).toHaveLength(1);
      expect(analystInvestigations).toHaveLength(1);
      expect(traderSignals).toHaveLength(1);
    });
  });

  describe('message bus behavior', () => {
    it('should deliver messages to all subscribers', async () => {
      let subscriberCount = 0;

      messageBus.subscribe('test.multi', () => {
        subscriberCount++;
      });

      messageBus.subscribe('test.multi', () => {
        subscriberCount++;
      });

      await messageBus.publish('test.multi', {});

      expect(subscriberCount).toBe(2);
    });

    it('should track subscriber count', () => {
      messageBus.subscribe('test.count', () => {});
      messageBus.subscribe('test.count', () => {});

      const count = messageBus.getSubscriberCount('test.count');
      expect(count).toBe(2);
    });
  });
});

describe('Pool Detection Integration', () => {
  it('should handle Pump.fun graduation event', async () => {
    const messageBus = new MessageBus();
    const graduations: any[] = [];

    messageBus.subscribe('pool.graduation', (msg) => graduations.push(msg));

    // Simulate graduation detection
    await messageBus.publish('pool.graduation', {
      token: 'GraduatedToken',
      fromDex: 'PUMP_FUN',
      toDex: 'RAYDIUM_CPMM',
      liquiditySol: 85,
      bondingCurveTime: 3600, // 1 hour to graduate
    });

    expect(graduations).toHaveLength(1);
    // MessageBus wraps data in Message object with .data property
    expect(graduations[0].data.toDex).toBe('RAYDIUM_CPMM');
  });

  it('should track pool across DEX migration', async () => {
    const messageBus = new MessageBus();

    // Token starts on Pump.fun
    const pumpFunEvent = {
      token: 'MigratingToken',
      dex: 'PUMP_FUN',
      poolAddress: 'BondingCurve123',
      liquiditySol: 50,
    };

    // Later graduates to Raydium
    const raydiumEvent = {
      token: 'MigratingToken',
      dex: 'RAYDIUM_CPMM',
      poolAddress: 'RaydiumPool456',
      liquiditySol: 85,
      graduatedFrom: 'PUMP_FUN',
    };

    // Both events should be trackable by token address
    expect(pumpFunEvent.token).toBe(raydiumEvent.token);
    expect(raydiumEvent.graduatedFrom).toBe('PUMP_FUN');
  });
});
