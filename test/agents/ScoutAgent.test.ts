/**
 * ScoutAgent Tests
 *
 * Tests the token discovery and quick scanning logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScoutAgent, LaunchEvent } from '../../packages/agents/src/agents/ScoutAgent';
import { MessageBus } from '../../packages/agents/src/core/MessageBus';

describe('ScoutAgent', () => {
  let messageBus: MessageBus;
  let scout: ScoutAgent;

  beforeEach(async () => {
    messageBus = new MessageBus();
    scout = new ScoutAgent(messageBus, {
      name: 'test-scout',
      rpcEndpoint: 'http://localhost:8899',
    });
    await scout.initialize();
  });

  describe('quickScanFromYellowstone', () => {
    it('should extract features from Yellowstone data without RPC calls', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'So11111111111111111111111111111111111111112',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'PUMP_FUN',
        poolAddress: 'TestPool123',
        liquiditySol: 50,
      };

      // Access private method via prototype
      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result).toBeDefined();
      expect(result.features).toHaveLength(29);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should flag low liquidity tokens as suspicious', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'LowLiqToken123',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'PUMP_FUN',
        poolAddress: 'TestPool456',
        liquiditySol: 0.5, // Very low liquidity
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result.suspicious).toBe(true);
      // Flags use UPPERCASE in the implementation
      expect(result.flags).toContain('LOW_LIQUIDITY');
    });

    it('should detect pump.fun micro cap tokens', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'MicroCapToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'PUMP_FUN',
        poolAddress: 'TestPool789',
        liquiditySol: 1.5, // Between 1 and 2 SOL
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result.flags).toContain('PUMP_MICRO');
    });
  });

  describe('processLaunch', () => {
    it('should process launch and update scan count', async () => {
      const launch: LaunchEvent = {
        token: 'ProcessTestToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'PUMP_FUN',
        poolAddress: 'ProcessPool',
        liquiditySol: 50,
      };

      const scanCountBefore = (scout as any).scanCount;

      await (scout as any).processLaunch(launch);

      const scanCountAfter = (scout as any).scanCount;

      expect(scanCountAfter).toBe(scanCountBefore + 1);
    });

    it('should publish discovery event for Yellowstone data', async () => {
      const discoverySpy = vi.fn();
      messageBus.subscribe('discovery.new', discoverySpy);

      const launch: LaunchEvent = {
        token: 'DiscoveryToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'PUMP_FUN',
        poolAddress: 'DiscoveryPool',
        liquiditySol: 30,
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
      };

      await (scout as any).processLaunch(launch);

      await new Promise(r => setTimeout(r, 100));

      expect(discoverySpy).toHaveBeenCalled();
    });
  });

  describe('feature extraction', () => {
    it('should extract all 29 features', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'FeatureTestToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'PUMP_FUN',
        poolAddress: 'FeaturePool',
        liquiditySol: 30,
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result.features).toHaveLength(29);

      // All features should be normalized between 0 and 1
      for (let i = 0; i < 29; i++) {
        expect(result.features[i]).toBeGreaterThanOrEqual(0);
        expect(result.features[i]).toBeLessThanOrEqual(1);
      }
    });

    it('should handle missing liquiditySol gracefully', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'MinimalToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'RAYDIUM_CPMM',
        poolAddress: 'MinimalPool',
        // No liquiditySol
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result).toBeDefined();
      expect(result.features).toHaveLength(29);
    });

    it('should set correct security features for pump.fun', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'PumpToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'PUMP_FUN',
        poolAddress: 'PumpPool',
        liquiditySol: 30,
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      // Pump.fun always disables mint and freeze
      expect(result.features[11]).toBe(1.0); // mintDisabled
      expect(result.features[12]).toBe(1.0); // freezeDisabled
    });
  });

  describe('graduation detection', () => {
    it('should flag graduated tokens', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'GraduatedToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'RAYDIUM_CPMM',
        poolAddress: 'GradPool',
        liquiditySol: 85,
        graduatedFrom: 'PUMP_FUN',
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result.flags).toContain('GRADUATED');
    });

    it('should flag fast graduations as suspicious', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'FastGradToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'RAYDIUM_CPMM',
        poolAddress: 'FastGradPool',
        liquiditySol: 85,
        graduatedFrom: 'PUMP_FUN',
        bondingCurveTime: 2 * 60 * 1000, // 2 minutes (very fast)
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result.flags).toContain('FAST_GRADUATION');
      expect(result.score).toBeGreaterThanOrEqual(40); // Higher risk from fast graduation bonus
    });

    it('should reward organic graduations', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'OrganicGradToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'RAYDIUM_CPMM',
        poolAddress: 'OrganicPool',
        liquiditySol: 85,
        graduatedFrom: 'PUMP_FUN',
        bondingCurveTime: 2 * 60 * 60 * 1000, // 2 hours (organic)
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result.flags).toContain('ORGANIC_GRADUATION');
    });
  });

  describe('DEX-specific handling', () => {
    it('should handle Raydium pools', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'RaydiumToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'RAYDIUM_CPMM',
        poolAddress: 'RaydiumPool',
        liquiditySol: 100,
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result.flags).toContain('RAYDIUM_ESTABLISHED');
      expect(result.score).toBeLessThan(50); // Lower risk for established pools
    });

    it('should handle Orca Whirlpool pools', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'OrcaToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'ORCA_WHIRLPOOL',
        poolAddress: 'OrcaPool',
        liquiditySol: 50,
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result).toBeDefined();
      expect(result.features).toHaveLength(29);
    });

    it('should handle Meteora DLMM pools', async () => {
      const launch: Partial<LaunchEvent> = {
        token: 'MeteoraToken',
        creator: 'unknown',
        slot: 12345,
        timestamp: Date.now(),
        dex: 'METEORA_DLMM',
        poolAddress: 'MeteoraPool',
        liquiditySol: 40,
      };

      const result = (scout as any).quickScanFromYellowstone(launch);

      expect(result).toBeDefined();
      expect(result.features).toHaveLength(29);
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      // Set some test values
      (scout as any).scanCount = 10;
      (scout as any).flaggedCount = 3;
      (scout as any).lastSlot = 12345;

      const stats = scout.getStats();

      expect(stats.scanCount).toBe(10);
      expect(stats.flaggedCount).toBe(3);
      expect(stats.lastSlot).toBe(12345);
      expect(stats.flagRate).toBeCloseTo(0.3, 2);
    });

    it('should handle zero scans gracefully', () => {
      const stats = scout.getStats();

      expect(stats.flagRate).toBe(0);
    });
  });

  describe('constraints', () => {
    it('should have correct constraints', () => {
      const constraints = (scout as any).getConstraints();

      expect(constraints.maxScansPerMinute).toBe(30);
      expect(constraints.minSlotInterval).toBe(10);
      expect(constraints.flagThreshold).toBe(50);
    });
  });
});
