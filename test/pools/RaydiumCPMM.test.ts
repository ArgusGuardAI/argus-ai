/**
 * Raydium CPMM Pool Tests
 *
 * Tests pool account parsing, reserve extraction, and price calculation.
 */

import { describe, it, expect } from 'vitest';
import { PoolMonitor } from '../../packages/monitor/src/pool-monitor';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('Raydium CPMM', () => {
  describe('parseRaydiumCPMM', () => {
    it('should parse CPMM pool with WSOL as token0', () => {
      // Raydium CPMM Pool Layout (354+ bytes):
      // [72:104]  token0Mint (32 bytes)
      // [104:136] token1Mint (32 bytes)
      // [136:168] lpMint (32 bytes)
      // [168:200] token0Vault (32 bytes)
      // [200:232] token1Vault (32 bytes)
      // [338:346] token0Amount (u64)
      // [346:354] token1Amount (u64)

      const data = Buffer.alloc(400);

      // token0Mint = WSOL
      const wsolPubkey = new PublicKey(WSOL_MINT);
      wsolPubkey.toBuffer().copy(data, 72);

      // token1Mint = memecoin (non-WSOL valid mint)
      const memeMint = new PublicKey('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      memeMint.toBuffer().copy(data, 104);

      // lpMint
      PublicKey.unique().toBuffer().copy(data, 136);

      // token0Vault
      PublicKey.unique().toBuffer().copy(data, 168);

      // token1Vault
      PublicKey.unique().toBuffer().copy(data, 200);

      // token0Amount (WSOL) = 50 SOL
      data.writeBigUInt64LE(BigInt(50_000_000_000), 338);

      // token1Amount (memecoin) = 1B tokens
      data.writeBigUInt64LE(BigInt(1_000_000_000_000), 346);

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseRaydiumCPMM(data);

      expect(result).not.toBeNull();
      // baseMint should be the memecoin (not WSOL)
      expect(result.baseMint).toBe('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      expect(result.enrichedData.token0Amount).toBe(50_000_000_000);
      expect(result.enrichedData.token1Amount).toBe(1_000_000_000_000);
      expect(result.enrichedData.liquiditySol).toBe(50);
    });

    it('should parse CPMM pool with WSOL as token1', () => {
      const data = Buffer.alloc(400);

      // token0Mint = memecoin
      const memeMint = new PublicKey('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      memeMint.toBuffer().copy(data, 72);

      // token1Mint = WSOL
      const wsolPubkey = new PublicKey(WSOL_MINT);
      wsolPubkey.toBuffer().copy(data, 104);

      // Other fields
      PublicKey.unique().toBuffer().copy(data, 136);
      PublicKey.unique().toBuffer().copy(data, 168);
      PublicKey.unique().toBuffer().copy(data, 200);

      // token0Amount (memecoin)
      data.writeBigUInt64LE(BigInt(1_000_000_000_000), 338);

      // token1Amount (WSOL) = 75 SOL
      data.writeBigUInt64LE(BigInt(75_000_000_000), 346);

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseRaydiumCPMM(data);

      expect(result).not.toBeNull();
      expect(result.baseMint).toBe('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      expect(result.enrichedData.liquiditySol).toBe(75);
    });

    it('should return null for data too small', () => {
      const data = Buffer.alloc(100); // Less than 200 bytes

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseRaydiumCPMM(data);

      expect(result).toBeNull();
    });

    it('should handle pool without reserve data', () => {
      const data = Buffer.alloc(250); // Has mints but not reserves

      // Valid mints
      const memeMint = new PublicKey('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      memeMint.toBuffer().copy(data, 72);

      const wsolPubkey = new PublicKey(WSOL_MINT);
      wsolPubkey.toBuffer().copy(data, 104);

      // Other required fields
      PublicKey.unique().toBuffer().copy(data, 136);
      PublicKey.unique().toBuffer().copy(data, 168);
      PublicKey.unique().toBuffer().copy(data, 200);

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseRaydiumCPMM(data);

      // Should still parse but with 0 liquidity
      expect(result).not.toBeNull();
      expect(result.enrichedData.liquiditySol).toBe(0);
    });
  });

  describe('USDC/USDT pairs', () => {
    it('should estimate SOL value from USDC liquidity', () => {
      const data = Buffer.alloc(400);

      // token0Mint = USDC
      const usdcPubkey = new PublicKey(USDC_MINT);
      usdcPubkey.toBuffer().copy(data, 72);

      // token1Mint = memecoin
      const memeMint = new PublicKey('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
      memeMint.toBuffer().copy(data, 104);

      PublicKey.unique().toBuffer().copy(data, 136);
      PublicKey.unique().toBuffer().copy(data, 168);
      PublicKey.unique().toBuffer().copy(data, 200);

      // 10000 USDC (6 decimals)
      data.writeBigUInt64LE(BigInt(10_000_000_000), 338);
      data.writeBigUInt64LE(BigInt(500_000_000_000), 346);

      const monitor = new PoolMonitor({
        yellowstoneEndpoint: 'http://test',
        yellowstoneToken: 'test',
      });

      const result = (monitor as any).parseRaydiumCPMM(data);

      expect(result).not.toBeNull();
      // Should treat USDC as ~SOL value
      expect(result.enrichedData.liquiditySol).toBeGreaterThan(0);
    });
  });

  describe('price calculation', () => {
    it('should calculate price from reserves', () => {
      const solAmount = 100_000_000_000; // 100 SOL (9 decimals)
      const tokenAmount = 1_000_000_000_000; // 1B tokens (6 decimals)

      const price = (solAmount / 1e9) / (tokenAmount / 1e6);

      expect(price).toBeCloseTo(0.0001, 6);
    });

    it('should detect significant price changes', () => {
      const PRICE_CHANGE_THRESHOLD = 0.001; // 0.1%

      const oldPrice = 0.0001;
      const cases = [
        { newPrice: 0.0001, significant: false },
        { newPrice: 0.000100005, significant: false },
        { newPrice: 0.00010015, significant: true },
        { newPrice: 0.000105, significant: true },
      ];

      for (const tc of cases) {
        const change = Math.abs(tc.newPrice - oldPrice) / oldPrice;
        const isSignificant = change >= PRICE_CHANGE_THRESHOLD;
        expect(isSignificant).toBe(tc.significant);
      }
    });
  });
});
