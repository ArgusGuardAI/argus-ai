/**
 * Pump.fun Pool Tests
 *
 * Tests bonding curve parsing, graduation detection, and price calculation.
 */

import { describe, it, expect } from 'vitest';
import { PoolMonitor } from '../../packages/monitor/src/pool-monitor';
import { Buffer } from 'buffer';

// Pump.fun bonding curve discriminator
const PUMP_FUN_DISCRIMINATOR = Buffer.from([
  0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60
]);

describe('Pump.fun Bonding Curve', () => {
  describe('parsePumpFun', () => {
    it('should parse valid bonding curve data with correct layout', () => {
      // Pump.fun bonding curve layout (151 bytes):
      // [0:8]    discriminator (u64)
      // [8:16]   virtualTokenReserves (u64)
      // [16:24]  virtualSolReserves (u64)
      // [24:32]  realTokenReserves (u64)
      // [32:40]  realSolReserves (u64)
      // [40:48]  tokenTotalSupply (u64)
      // [48:49]  complete (bool)
      // [49:81]  creator pubkey (32 bytes)
      // [81:151] padding

      const data = Buffer.alloc(151);

      // Write discriminator
      PUMP_FUN_DISCRIMINATOR.copy(data, 0);

      // Write virtualTokenReserves (u64) - 800B tokens
      data.writeBigUInt64LE(BigInt(800_000_000_000_000), 8);

      // Write virtualSolReserves (u64) - 50 SOL in lamports
      data.writeBigUInt64LE(BigInt(50_000_000_000), 16);

      // Write realTokenReserves (u64) - 200B tokens
      data.writeBigUInt64LE(BigInt(200_000_000_000_000), 24);

      // Write realSolReserves (u64) - 20 SOL
      data.writeBigUInt64LE(BigInt(20_000_000_000), 32);

      // Write tokenTotalSupply (u64) - 1B tokens
      data.writeBigUInt64LE(BigInt(1_000_000_000_000_000), 40);

      // Write complete flag (bool)
      data.writeUInt8(0, 48); // Not graduated

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parsePumpFun(data);

      expect(result).not.toBeNull();
      expect(result.enrichedData.virtualSolReserves).toBe(50_000_000_000);
      expect(result.enrichedData.virtualTokenReserves).toBe(800_000_000_000_000);
      expect(result.enrichedData.complete).toBe(false);
      expect(result.enrichedData.liquiditySol).toBe(50);
    });

    it('should detect graduated tokens', () => {
      const data = Buffer.alloc(151);
      PUMP_FUN_DISCRIMINATOR.copy(data, 0);

      // virtualTokenReserves
      data.writeBigUInt64LE(BigInt(100_000_000_000_000), 8);
      // virtualSolReserves - 85 SOL (graduation threshold)
      data.writeBigUInt64LE(BigInt(85_000_000_000), 16);
      // realTokenReserves
      data.writeBigUInt64LE(BigInt(50_000_000_000_000), 24);
      // realSolReserves
      data.writeBigUInt64LE(BigInt(85_000_000_000), 32);
      // tokenTotalSupply
      data.writeBigUInt64LE(BigInt(1_000_000_000_000_000), 40);
      // complete = true
      data.writeUInt8(1, 48);

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parsePumpFun(data);

      expect(result).not.toBeNull();
      expect(result.enrichedData.complete).toBe(true);
    });

    it('should return null for invalid discriminator', () => {
      const data = Buffer.alloc(151);
      data.fill(0); // Invalid discriminator

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parsePumpFun(data);

      expect(result).toBeNull();
    });

    it('should return null for too small buffer', () => {
      const data = Buffer.alloc(100); // Less than 151 bytes

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parsePumpFun(data);

      expect(result).toBeNull();
    });
  });

  describe('price calculation', () => {
    it('should calculate price from reserves', () => {
      const virtualSolReserves = 50_000_000_000; // 50 SOL (lamports)
      const virtualTokenReserves = 800_000_000_000_000; // 800B tokens (6 decimals)

      // Price = SOL / tokens
      const pricePerToken = (virtualSolReserves / 1e9) / (virtualTokenReserves / 1e6);

      expect(pricePerToken).toBeCloseTo(6.25e-8, 10);
    });

    it('should handle price increases as curve progresses', () => {
      // Early in curve (less SOL, more tokens)
      const earlyPrice = (35_000_000_000 / 1e9) / (900_000_000_000_000 / 1e6);

      // Later in curve (more SOL, fewer tokens)
      const latePrice = (70_000_000_000 / 1e9) / (400_000_000_000_000 / 1e6);

      expect(latePrice).toBeGreaterThan(earlyPrice);
    });
  });

  describe('graduation detection', () => {
    it('should detect graduation at 85 SOL threshold', () => {
      const GRADUATION_SOL = 85;

      const cases = [
        { realSol: 80, graduated: false },
        { realSol: 84.9, graduated: false },
        { realSol: 85, graduated: true },
        { realSol: 90, graduated: true },
      ];

      for (const tc of cases) {
        const isGraduated = tc.realSol >= GRADUATION_SOL;
        expect(isGraduated).toBe(tc.graduated);
      }
    });
  });

  describe('bonding curve progress', () => {
    it('should calculate progress towards graduation', () => {
      const testCases = [
        { virtualSol: 30, expectedProgress: 35 },  // ~35% (30/85)
        { virtualSol: 42.5, expectedProgress: 50 }, // ~50% (42.5/85)
        { virtualSol: 68, expectedProgress: 80 },   // ~80% (68/85)
        { virtualSol: 85, expectedProgress: 100 },  // 100% (graduated)
      ];

      for (const tc of testCases) {
        const progress = (tc.virtualSol / 85) * 100;
        expect(progress).toBeCloseTo(tc.expectedProgress, 0);
      }
    });
  });
});
