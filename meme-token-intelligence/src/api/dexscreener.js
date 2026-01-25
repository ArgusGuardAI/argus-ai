/**
 * DexScreener API Integration
 * Free tier: 300 requests/minute
 * Docs: https://docs.dexscreener.com
 */

const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest';

/**
 * Get new token pairs from Solana DEXs
 * Returns pairs sorted by creation time (newest first)
 */
export async function getNewSolanaPairs() {
  const response = await fetch(`${DEXSCREENER_BASE}/dex/tokens/solana`);
  const data = await response.json();
  return data.pairs || [];
}

/**
 * Search for a specific token by address
 */
export async function getTokenByAddress(tokenAddress) {
  const response = await fetch(`${DEXSCREENER_BASE}/dex/tokens/${tokenAddress}`);
  const data = await response.json();
  return data.pairs?.[0] || null;
}

/**
 * Get pairs from a specific DEX (raydium, orca, etc.)
 */
export async function getPairsByDex(dexId, limit = 50) {
  const response = await fetch(`${DEXSCREENER_BASE}/dex/pairs/solana/${dexId}`);
  const data = await response.json();
  return (data.pairs || []).slice(0, limit);
}

/**
 * Get trending/boosted tokens (high volume recently)
 */
export async function getTrendingTokens() {
  const response = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
  const data = await response.json();
  return data || [];
}

/**
 * Parse DexScreener pair data into our standard format
 */
export function parseDexScreenerPair(pair) {
  return {
    address: pair.baseToken?.address,
    name: pair.baseToken?.name,
    symbol: pair.baseToken?.symbol,
    pairAddress: pair.pairAddress,
    dex: pair.dexId,
    price: parseFloat(pair.priceUsd) || 0,
    priceChange24h: pair.priceChange?.h24 || 0,
    priceChange1h: pair.priceChange?.h1 || 0,
    priceChange5m: pair.priceChange?.m5 || 0,
    volume24h: pair.volume?.h24 || 0,
    volume1h: pair.volume?.h1 || 0,
    liquidity: pair.liquidity?.usd || 0,
    fdv: pair.fdv || 0,
    marketCap: pair.marketCap || 0,
    pairCreatedAt: pair.pairCreatedAt,
    txns24h: {
      buys: pair.txns?.h24?.buys || 0,
      sells: pair.txns?.h24?.sells || 0,
    },
    txns1h: {
      buys: pair.txns?.h1?.buys || 0,
      sells: pair.txns?.h1?.sells || 0,
    },
  };
}
