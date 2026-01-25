/**
 * GeckoTerminal Listener
 * Uses GeckoTerminal's free API to discover new Solana pools
 *
 * This is a FREE alternative to Helius for getting new pool data
 * API Docs: https://www.geckoterminal.com/dex-api
 */

import { EventEmitter } from 'events';
import type { NewTokenEvent } from '../types';

const GECKO_API = 'https://api.geckoterminal.com/api/v2';
const SOLANA_NETWORK = 'solana';

// Filter to these DEXes (exclude pump-fun as we have dedicated listener)
const ALLOWED_DEXES = new Set(['raydium', 'raydium-clmm', 'meteora', 'meteora-damm-v2', 'orca']);

interface GeckoPool {
  id: string;
  type: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    reserve_in_usd: string;
    pool_created_at: string;
    fdv_usd: string;
    market_cap_usd: string | null;
  };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
}

interface GeckoToken {
  id: string;
  type: string;
  attributes: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    total_supply: string;
  };
}

export class GeckoTerminalListener extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private seenPools: Set<string> = new Set();
  private intervalMs: number;

  constructor(intervalMs: number = 30000) {
    super();
    this.intervalMs = intervalMs;
  }

  /**
   * Start polling for new pools
   */
  async start() {
    if (this.isRunning) {
      console.log('[GeckoTerminal] Already running');
      return;
    }

    console.log('[GeckoTerminal] Starting pool listener...');
    this.isRunning = true;

    // Do initial fetch
    await this.fetchNewPools();

    // Start polling
    this.pollInterval = setInterval(() => this.fetchNewPools(), this.intervalMs);
    console.log(`[GeckoTerminal] Polling every ${this.intervalMs / 1000}s`);
  }

  /**
   * Stop polling
   */
  stop() {
    console.log('[GeckoTerminal] Stopping...');
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log('[GeckoTerminal] Stopped');
  }

  /**
   * Fetch new pools from GeckoTerminal using the new_pools endpoint
   */
  private async fetchNewPools() {
    try {
      // Use the new_pools endpoint which returns all new pools across all DEXes
      const url = `${GECKO_API}/networks/${SOLANA_NETWORK}/new_pools?page=1`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.log('[GeckoTerminal] Rate limited, will retry later');
          return;
        }
        console.log(`[GeckoTerminal] Error fetching new pools: ${response.status}`);
        return;
      }

      const data = await response.json() as { data: GeckoPool[]; included?: GeckoToken[] };

      if (!data.data || data.data.length === 0) {
        return;
      }

      // Build token lookup from included data
      const tokenMap = new Map<string, GeckoToken>();
      if (data.included) {
        for (const item of data.included) {
          if (item.type === 'token') {
            tokenMap.set(item.id, item);
          }
        }
      }

      // Process each pool
      let newCount = 0;
      let skippedOld = 0;
      let skippedDex = 0;
      let skippedLiq = 0;

      for (const pool of data.data) {
        // Skip if we've seen this pool
        if (this.seenPools.has(pool.attributes.address)) {
          continue;
        }
        this.seenPools.add(pool.attributes.address);

        // Get DEX name from relationships
        const dexId = pool.relationships?.dex?.data?.id || 'unknown';
        const dexName = dexId.replace(`${SOLANA_NETWORK}_`, '');

        // Skip pump-fun only (we have dedicated listener), allow other DEXes
        if (dexName.includes('pump')) {
          skippedDex++;
          continue;
        }

        // Check pool age - process pools created in the last 60 minutes
        const createdAt = new Date(pool.attributes.pool_created_at).getTime();
        const ageMinutes = (Date.now() - createdAt) / 60000;
        if (ageMinutes > 60) {
          skippedOld++;
          continue; // Skip old pools
        }

        // Get base token info
        const baseTokenId = pool.relationships?.base_token?.data?.id;
        const baseToken = baseTokenId ? tokenMap.get(baseTokenId) : null;

        if (!baseToken) {
          continue; // Skip if we can't get token info
        }

        // Skip wrapped SOL or stablecoins as base token
        const skipSymbols = ['SOL', 'WSOL', 'USDC', 'USDT'];
        if (skipSymbols.includes(baseToken.attributes.symbol.toUpperCase())) {
          continue;
        }

        // Get liquidity and market cap
        const liquidityUsd = parseFloat(pool.attributes.reserve_in_usd) || 0;
        const marketCap = parseFloat(pool.attributes.fdv_usd) || 0;

        // Skip very low liquidity pools (lowered threshold)
        if (liquidityUsd < 500) {
          skippedLiq++;
          continue;
        }

        // Map DEX name to our source types
        let source: 'raydium' | 'meteora' = 'raydium';
        if (dexName.includes('meteora')) {
          source = 'meteora';
        }

        const token: NewTokenEvent = {
          address: baseToken.attributes.address,
          name: baseToken.attributes.name,
          symbol: baseToken.attributes.symbol,
          decimals: baseToken.attributes.decimals || 9,
          source,
          creator: 'unknown', // GeckoTerminal doesn't provide creator
          liquidityUsd,
          timestamp: createdAt,
          initialMarketCap: marketCap,
        };

        newCount++;
        console.log(`[GeckoTerminal] 🆕 ${dexName.toUpperCase()}: ${token.symbol} (${token.address.slice(0, 8)}...) - $${liquidityUsd.toFixed(0)} liq, ${ageMinutes.toFixed(1)}m old`);
        this.emit('newToken', token);
      }

      // Log stats
      const total = data.data.length;
      if (newCount > 0 || total > 10) {
        console.log(`[GeckoTerminal] Processed ${total} pools: ${newCount} new, skipped ${skippedOld} old, ${skippedDex} pump, ${skippedLiq} low liq`);
      }

      // Keep cache from growing too large
      if (this.seenPools.size > 5000) {
        const arr = Array.from(this.seenPools);
        this.seenPools = new Set(arr.slice(-2500));
      }

    } catch (error) {
      console.log('[GeckoTerminal] Error fetching new pools:', error);
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      poolsSeen: this.seenPools.size,
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.seenPools.clear();
  }
}
