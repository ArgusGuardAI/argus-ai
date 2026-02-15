/**
 * Price Oracle Service - Pure On-Chain
 *
 * Gets all prices from on-chain pool reserves.
 * Zero external APIs. Zero dependencies.
 *
 * SOL/USD price: Read from Raydium SOL/USDC pool
 * Token prices: Calculate from pool reserves
 */

import { TOKENS } from './solana-rpc';

// Raydium SOL/USDC pool address (most liquid)
const _SOL_USDC_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';

// Pool vault addresses for SOL/USDC pool
const SOL_USDC_VAULTS = {
  SOL: 'DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz',
  USDC: 'HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz',
};

// Cache for SOL price (valid for 60 seconds)
let solPriceCache: { price: number; timestamp: number } | null = null;
const CACHE_TTL = 60_000;

export interface TokenPrice {
  mint: string;
  priceUsd: number;
  source: 'on-chain' | 'calculated';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Get SOL price from on-chain Raydium SOL/USDC pool
 */
export async function getSolPrice(rpcEndpoint?: string): Promise<number> {
  // Check cache
  if (solPriceCache && Date.now() - solPriceCache.timestamp < CACHE_TTL) {
    return solPriceCache.price;
  }

  if (!rpcEndpoint) {
    console.warn('[PriceOracle] No RPC endpoint provided, using cached price');
    return solPriceCache?.price || 200;
  }
  const endpoint = rpcEndpoint;

  try {
    // Fetch both vault balances in parallel
    const [solVaultRes, usdcVaultRes] = await Promise.all([
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountBalance',
          params: [SOL_USDC_VAULTS.SOL],
        }),
      }),
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'getTokenAccountBalance',
          params: [SOL_USDC_VAULTS.USDC],
        }),
      }),
    ]);

    const solData = await solVaultRes.json() as {
      result?: { value?: { uiAmount?: number } };
    };
    const usdcData = await usdcVaultRes.json() as {
      result?: { value?: { uiAmount?: number } };
    };

    const solAmount = solData.result?.value?.uiAmount || 0;
    const usdcAmount = usdcData.result?.value?.uiAmount || 0;

    if (solAmount > 0 && usdcAmount > 0) {
      // Price = USDC / SOL
      const price = usdcAmount / solAmount;

      // Sanity check (SOL should be between $10 and $1000)
      if (price >= 10 && price <= 1000) {
        solPriceCache = { price, timestamp: Date.now() };
        console.log(`[PriceOracle] SOL price from on-chain: $${price.toFixed(2)}`);
        return price;
      }
    }
  } catch (err) {
    console.warn('[PriceOracle] Error fetching on-chain SOL price:', err);
  }

  // Fallback to cached price or reasonable default
  return solPriceCache?.price || 200;
}

/**
 * Get token price - always calculated from pool reserves
 * Returns null if no pool data available
 */
export async function getTokenPrice(_mint: string): Promise<TokenPrice | null> {
  // Token prices are calculated from pool reserves in onchain-analyzer.ts
  // This function is kept for interface compatibility but returns null
  // to force calculation from pool data
  return null;
}

/**
 * Calculate price from pool reserves (pure math, no API)
 */
export function calculatePriceFromPool(
  tokenReserve: number,
  quoteReserve: number,
  quoteMint: string,
  solPrice: number
): number | null {
  if (tokenReserve <= 0) return null;

  const priceInQuote = quoteReserve / tokenReserve;

  if (quoteMint === TOKENS.SOL) {
    return priceInQuote * solPrice;
  }

  if (quoteMint === TOKENS.USDC || quoteMint === TOKENS.USDT) {
    return priceInQuote;
  }

  return null;
}

/**
 * Estimate market cap
 */
export function calculateMarketCap(supply: number, priceUsd: number): number {
  return supply * priceUsd;
}

/**
 * Estimate liquidity from pool reserves
 */
export function calculateLiquidity(
  quoteReserve: number,
  quoteMint: string,
  solPrice: number
): number {
  // Liquidity = 2 * quote side value (standard AMM)
  if (quoteMint === TOKENS.SOL) {
    return quoteReserve * solPrice * 2;
  }

  if (quoteMint === TOKENS.USDC || quoteMint === TOKENS.USDT) {
    return quoteReserve * 2;
  }

  return 0;
}
