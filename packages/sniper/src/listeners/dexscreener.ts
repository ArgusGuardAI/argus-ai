/**
 * DexScreener Trending Tokens Listener
 * Fetches trending/hot tokens from DexScreener API
 */

import { EventEmitter } from 'events';
import type { NewTokenEvent } from '../types';

// DexScreener API endpoints
const DEXSCREENER_API = 'https://api.dexscreener.com';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export class DexScreenerListener extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private seenTokens: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor() {
    super();
  }

  /**
   * Start polling for trending tokens
   */
  async start(intervalMs: number = 30000) {
    if (this.isRunning) {
      console.log('[DexScreener] Already running');
      return;
    }

    console.log('[DexScreener] Starting trending token scanner...');
    this.isRunning = true;

    // Initial fetch
    await this.fetchTrendingTokens();

    // Poll periodically
    this.pollInterval = setInterval(() => {
      this.fetchTrendingTokens();
    }, intervalMs);
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    console.log('[DexScreener] Stopped');
  }

  /**
   * Fetch trending Solana tokens from DexScreener
   */
  private async fetchTrendingTokens() {
    try {
      // Fetch token boosts (promoted/trending tokens)
      const boostsResponse = await fetch(`${DEXSCREENER_API}/token-boosts/top/v1`);
      if (boostsResponse.ok) {
        const boosts = await boostsResponse.json() as any[];
        await this.processBoosts(boosts);
      }

      // Also search for recently active Solana tokens
      // Using search with high volume Solana tokens
      const searchResponse = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=pump`);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json() as any;
        if (searchData.pairs) {
          await this.processPairs(searchData.pairs);
        }
      }

    } catch (error) {
      console.error('[DexScreener] Error fetching trending tokens:', error);
      this.emit('error', error);
    }
  }

  /**
   * Process boosted tokens
   */
  private async processBoosts(boosts: any[]) {
    if (!Array.isArray(boosts)) return;

    for (const boost of boosts) {
      // Only Solana tokens
      if (boost.chainId !== 'solana') continue;

      const tokenAddress = boost.tokenAddress;
      if (!tokenAddress || this.seenTokens.has(tokenAddress)) continue;

      // Fetch full token data
      try {
        const response = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${tokenAddress}`);
        if (response.ok) {
          const data = await response.json() as any;
          if (data.pairs && data.pairs.length > 0) {
            const pair = this.getBestPair(data.pairs);
            if (pair) {
              this.emitToken(pair, 'boost');
            }
          }
        }
      } catch (e) {
        // Ignore individual fetch errors
      }
    }
  }

  /**
   * Process pairs from search results
   */
  private async processPairs(pairs: DexScreenerPair[]) {
    if (!Array.isArray(pairs)) return;

    // Filter for Solana pairs with good activity
    const solanaPairs = pairs.filter(p =>
      p.chainId === 'solana' &&
      p.txns?.h1?.buys >= 10 &&  // At least 10 buys in last hour
      p.volume?.h1 >= 1000 &&    // At least $1K volume in last hour
      (p.marketCap || p.fdv || 0) >= 5000 &&  // Min $5K market cap
      (p.marketCap || p.fdv || 0) <= 500000   // Max $500K (still early)
    );

    // Sort by 1h volume (most active first)
    solanaPairs.sort((a, b) => (b.volume?.h1 || 0) - (a.volume?.h1 || 0));

    // Take top 20
    for (const pair of solanaPairs.slice(0, 20)) {
      const tokenAddress = pair.baseToken.address;
      if (this.seenTokens.has(tokenAddress)) continue;

      this.emitToken(pair, 'trending');
    }
  }

  /**
   * Get best pair for a token (highest liquidity)
   */
  private getBestPair(pairs: DexScreenerPair[]): DexScreenerPair | null {
    if (!pairs || pairs.length === 0) return null;

    // Filter for Solana only
    const solanaPairs = pairs.filter(p => p.chainId === 'solana');
    if (solanaPairs.length === 0) return null;

    // Sort by liquidity
    solanaPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    return solanaPairs[0];
  }

  /**
   * Emit token event in NewTokenEvent format
   */
  private emitToken(pair: DexScreenerPair, source: 'boost' | 'trending') {
    const tokenAddress = pair.baseToken.address;
    this.seenTokens.add(tokenAddress);

    const token: NewTokenEvent = {
      address: tokenAddress,
      name: pair.baseToken.name,
      symbol: pair.baseToken.symbol,
      decimals: 6, // Most Solana tokens
      supply: 0,
      timestamp: pair.pairCreatedAt || Date.now(),
      liquidityUsd: pair.liquidity?.usd || 0,
      initialMarketCap: pair.marketCap || pair.fdv || 0,
      source: source === 'boost' ? 'dexscreener-boost' : 'dexscreener-trending',
      // Additional data for analysis
      priceUsd: parseFloat(pair.priceUsd) || 0,
      volume24h: pair.volume?.h24 || 0,
      volume1h: pair.volume?.h1 || 0,
      buys1h: pair.txns?.h1?.buys || 0,
      sells1h: pair.txns?.h1?.sells || 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
    };

    console.log(`[DexScreener] ${source === 'boost' ? '🚀' : '📈'} Trending: ${token.symbol} ($${((token.initialMarketCap || 0) / 1000).toFixed(0)}K MC, ${token.buys1h} buys/1h)`);
    this.emit('newToken', token);
  }

  /**
   * Clear seen tokens cache (for testing)
   */
  clearCache() {
    this.seenTokens.clear();
  }
}
