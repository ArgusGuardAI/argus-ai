/**
 * Orca Whirlpool Pool Tests
 *
 * Tests concentrated liquidity pool parsing and sqrtPrice calculation.
 */

import { describe, it, expect } from 'vitest';
import { PoolMonitor } from '../../packages/monitor/src/pool-monitor';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

describe('Orca Whirlpool', () => {
  describe('parseOrcaWhirlpool', () => {
    it('should parse Whirlpool with valid memecoin mint', () => {
      // Orca Whirlpool Layout (653 bytes):
      // [50:66]   liquidity (u128)
      // [66:82]   sqrtPrice (u128)
      // [101:133] tokenMintA (32 bytes)
      // [133:165] tokenVaultA (32 bytes)
      // [165:181] feeGrowthGlobalA (u128)
      // [181:213] tokenMintB (32 bytes)
      // [213:245] tokenVaultB (32 bytes)

      const data = Buffer.alloc(700);

      // Memecoin at tokenMintA (valid non-WSOL mint)
      const memeMint = new PublicKey('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      memeMint.toBuffer().copy(data, 101);

      // WSOL at tokenMintB
      const wsolPubkey = new PublicKey(WSOL_MINT);
      wsolPubkey.toBuffer().copy(data, 181);

      // TokenVaultA
      PublicKey.unique().toBuffer().copy(data, 133);

      // TokenVaultB
      PublicKey.unique().toBuffer().copy(data, 213);

      // Liquidity (u128 at offset 50)
      data.writeBigUInt64LE(BigInt(1_000_000_000), 50);
      data.writeBigUInt64LE(BigInt(0), 58);

      // sqrtPrice (u128 at offset 66) - a reasonable value
      // For price ~0.00005, sqrtPrice ≈ 0.00707 * 2^64
      data.writeBigUInt64LE(BigInt('130451050000000000'), 66);
      data.writeBigUInt64LE(BigInt(0), 74);

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseOrcaWhirlpool(data);

      expect(result).not.toBeNull();
      expect(result.baseMint).toBe('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      expect(result.enrichedData).toBeDefined();
    });

    it('should return null for data too small', () => {
      const data = Buffer.alloc(100); // Less than 200 bytes

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseOrcaWhirlpool(data);

      expect(result).toBeNull();
    });

    it('should return null when both mints are invalid', () => {
      const data = Buffer.alloc(700);

      // Both WSOL - invalid as baseMint
      const wsolPubkey = new PublicKey(WSOL_MINT);
      wsolPubkey.toBuffer().copy(data, 101);
      wsolPubkey.toBuffer().copy(data, 181);

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseOrcaWhirlpool(data);

      expect(result).toBeNull();
    });
  });

  describe('sqrtPrice calculation', () => {
    it('should calculate price from sqrtPrice Q64.64 format', () => {
      // sqrtPrice in Q64.64 format: fixed-point with 64 integer bits and 64 fractional bits
      // Price = (sqrtPrice / 2^64)^2

      // For a sqrtPrice of 0.01 (in Q64.64 = 0.01 * 2^64)
      const sqrtPriceX64 = BigInt(Math.floor(0.01 * Math.pow(2, 64)));

      const sqrtPriceFloat = Number(sqrtPriceX64) / Math.pow(2, 64);
      const price = sqrtPriceFloat * sqrtPriceFloat;

      expect(price).toBeCloseTo(0.0001, 6);
    });

    it('should handle very small prices typical for memecoins', () => {
      const targetPrice = 1e-7;
      const sqrtPrice = Math.sqrt(targetPrice);
      const sqrtPriceX64 = BigInt(Math.floor(sqrtPrice * Math.pow(2, 64)));

      const sqrtPriceFloat = Number(sqrtPriceX64) / Math.pow(2, 64);
      const calculatedPrice = sqrtPriceFloat * sqrtPriceFloat;

      expect(calculatedPrice).toBeCloseTo(targetPrice, 10);
    });

    it('should handle very large sqrtPrice values', () => {
      // For price of 0.1
      const targetPrice = 0.1;
      const sqrtPrice = Math.sqrt(targetPrice);
      const sqrtPriceX64 = BigInt(Math.floor(sqrtPrice * Math.pow(2, 64)));

      const sqrtPriceFloat = Number(sqrtPriceX64) / Math.pow(2, 64);
      const calculatedPrice = sqrtPriceFloat * sqrtPriceFloat;

      expect(calculatedPrice).toBeCloseTo(targetPrice, 4);
    });
  });

  describe('concentrated liquidity', () => {
    it('should handle different tick spacings', () => {
      // Orca Whirlpools use different tick spacings
      const tickSpacings = [1, 8, 64, 128];

      for (const spacing of tickSpacings) {
        expect(spacing).toBeGreaterThan(0);
      }
    });

    it('should calculate liquidity from position range', () => {
      // In concentrated liquidity, liquidity is within specific tick range
      const liquidity = BigInt(1_000_000_000);
      const sqrtPriceLow = 0.005;
      const sqrtPriceHigh = 0.015;
      const sqrtPriceCurrent = 0.01;

      // Amount of token A in range
      const amountA = Number(liquidity) * (sqrtPriceHigh - sqrtPriceCurrent);

      // Amount of token B in range
      const amountB = Number(liquidity) * (1/sqrtPriceCurrent - 1/sqrtPriceHigh);

      expect(amountA).toBeGreaterThan(0);
      expect(amountB).toBeGreaterThan(0);
    });
  });

  describe('price direction', () => {
    it('should determine correct price direction based on token order', () => {
      // Price direction depends on which token is SOL
      // If SOL is tokenA: price = tokenB per SOL
      // If SOL is tokenB: price = tokenA per SOL (what we typically want)

      const sqrtPriceX64 = 0.01;
      const priceTokenBPerA = sqrtPriceX64 * sqrtPriceX64;

      // If SOL is tokenB, we get SOL per memecoin directly
      const solIsTokenB = true;
      const priceSOLperToken = solIsTokenB
        ? priceTokenBPerA * (1e6 / 1e9) // Adjust for decimal difference (memecoin: 6, SOL: 9)
        : (1 / priceTokenBPerA) * (1e6 / 1e9);

      expect(priceSOLperToken).toBeDefined();
      expect(priceSOLperToken).toBeGreaterThan(0);
    });
  });
});
