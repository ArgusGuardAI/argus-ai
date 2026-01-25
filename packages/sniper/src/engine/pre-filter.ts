/**
 * Pre-Filter Pipeline
 * Aggressive FREE filters that eliminate scams before AI analysis
 * Uses DexScreener for token data
 */

import type { NewTokenEvent } from '../types';

export interface PreFilterConfig {
  // Liquidity thresholds
  minLiquidityUsd: number;      // Minimum liquidity to consider (default: 5000)
  maxLiquidityUsd: number;      // Maximum (avoid established tokens) (default: 500000)

  // Holder concentration
  maxTopHolderPercent: number;  // Reject if top holder > this (default: 30)
  maxTop5HoldersPercent: number; // Reject if top 5 holders > this (default: 50)

  // Token age
  minAgeMinutes: number;        // Let token settle before analyzing (default: 5)
  maxAgeMinutes: number;        // Don't buy old tokens (default: 60)

  // Trading activity
  minBuys: number;              // Minimum buy transactions (default: 50)
  minSellRatio: number;         // Min sells/buys ratio - too low = no one selling (default: 0.3)
  maxSellRatio: number;         // Max sells/buys ratio - too high = dump (default: 0.8)

  // Bundle detection (FREE on-chain check)
  maxBundleWallets: number;     // Reject if > N wallets bought in same block (default: 5)

  // Creator checks
  rejectNewCreator: boolean;    // Reject if creator wallet < 7 days old (default: false)
  rejectFlaggedCreator: boolean; // Reject if creator has previous rugs (default: true)

  // Market cap
  minMarketCapUsd: number;      // Minimum market cap (default: 10000)
  maxMarketCapUsd: number;      // Maximum market cap (default: 5000000)

  // DIP BUYING - Only buy tokens that are DOWN (avoid buying tops)
  requireDip: boolean;          // Only buy if price is down (default: true)
  maxPriceChange5m: number;     // Max 5-min price change % to allow (default: 0)
  minPriceChange5m: number;     // Min 5-min price change % (avoid tokens crashing too hard) (default: -30)
}

export const DEFAULT_PRE_FILTER_CONFIG: PreFilterConfig = {
  // Liquidity
  minLiquidityUsd: 5000,
  maxLiquidityUsd: 500000,
  minMarketCapUsd: 5000,
  maxMarketCapUsd: 500000,

  // Holder checks
  maxTopHolderPercent: 100,      // Let AI handle this
  maxTop5HoldersPercent: 100,    // Let AI handle this

  // Age - require 2 min so DexScreener has data for safety checks
  minAgeMinutes: 2,
  maxAgeMinutes: 60,

  // Activity
  minBuys: 10,
  minSellRatio: 0.2,
  maxSellRatio: 0.9,

  // Bundle detection
  maxBundleWallets: 10,

  // Creator checks
  rejectNewCreator: false,
  rejectFlaggedCreator: true,

  // DIP BUYING
  requireDip: true,
  maxPriceChange5m: 5,          // Allow up to +5% (slight pump ok)
  minPriceChange5m: -30,        // Don't buy if crashing more than 30%
};

export interface PreFilterResult {
  passed: boolean;
  reason: string;
  stage: 'LIQUIDITY' | 'HOLDERS' | 'AGE' | 'ACTIVITY' | 'BUNDLE' | 'CREATOR' | 'MARKET_CAP' | 'PRICE_DIP' | 'PASSED';
  tokenData?: TokenData;
}

export interface TokenData {
  address: string;
  name: string;
  symbol: string;
  liquidity: number;
  marketCap: number;
  ageMinutes: number;
  topHolderPercent: number;
  top5HoldersPercent: number;
  buys: number;
  sells: number;
  sellRatio: number;
  bundleWallets: number;
  creatorAge: number;
  creatorFlagged: boolean;
}

export interface FilterStats {
  total: number;
  passedLiquidity: number;
  passedHolders: number;
  passedAge: number;
  passedActivity: number;
  passedBundle: number;
  passedCreator: number;
  passedMarketCap: number;
  passedAll: number;
  sentToAI: number;
  aiApproved: number;
  traded: number;
}

// DexScreener API for token data
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// Helius API for holder data
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';

export class PreFilter {
  private config: PreFilterConfig;
  private stats: FilterStats;
  private flaggedCreators: Set<string> = new Set();

  constructor(config: Partial<PreFilterConfig> = {}) {
    this.config = { ...DEFAULT_PRE_FILTER_CONFIG, ...config };
    this.stats = this.initStats();
  }

  private initStats(): FilterStats {
    return {
      total: 0,
      passedLiquidity: 0,
      passedHolders: 0,
      passedAge: 0,
      passedActivity: 0,
      passedBundle: 0,
      passedCreator: 0,
      passedMarketCap: 0,
      passedAll: 0,
      sentToAI: 0,
      aiApproved: 0,
      traded: 0,
    };
  }

  /**
   * Main filter function - runs all checks using DexScreener data
   */
  async filter(tokenAddress: string, tokenEvent?: NewTokenEvent): Promise<PreFilterResult> {
    this.stats.total++;

    console.log(`[PreFilter] Checking ${tokenAddress}...`);

    // Get token data from DexScreener
    const dexData = await this.getDexScreenerData(tokenAddress);

    if (!dexData) {
      return { passed: false, reason: 'No DexScreener data found', stage: 'LIQUIDITY' };
    }

    // Step 1: Liquidity check
    if (dexData.liquidity < this.config.minLiquidityUsd) {
      return {
        passed: false,
        reason: `Liquidity $${dexData.liquidity.toFixed(0)} < min $${this.config.minLiquidityUsd}`,
        stage: 'LIQUIDITY'
      };
    }
    if (dexData.liquidity > this.config.maxLiquidityUsd) {
      return {
        passed: false,
        reason: `Liquidity $${dexData.liquidity.toFixed(0)} > max $${this.config.maxLiquidityUsd}`,
        stage: 'LIQUIDITY'
      };
    }
    this.stats.passedLiquidity++;
    console.log(`[PreFilter] ✓ Liquidity: $${dexData.liquidity.toFixed(0)}`);

    // Step 2: Market cap check
    if (dexData.marketCap < this.config.minMarketCapUsd) {
      return {
        passed: false,
        reason: `Market cap $${dexData.marketCap.toFixed(0)} < min $${this.config.minMarketCapUsd}`,
        stage: 'MARKET_CAP'
      };
    }
    if (dexData.marketCap > this.config.maxMarketCapUsd) {
      return {
        passed: false,
        reason: `Market cap $${dexData.marketCap.toFixed(0)} > max $${this.config.maxMarketCapUsd}`,
        stage: 'MARKET_CAP'
      };
    }
    this.stats.passedMarketCap++;
    console.log(`[PreFilter] ✓ Market cap: $${dexData.marketCap.toFixed(0)}`);

    // Step 3: Age check
    if (dexData.ageMinutes < this.config.minAgeMinutes) {
      return {
        passed: false,
        reason: `Age ${dexData.ageMinutes.toFixed(1)} min < min ${this.config.minAgeMinutes} min`,
        stage: 'AGE'
      };
    }
    if (dexData.ageMinutes > this.config.maxAgeMinutes) {
      return {
        passed: false,
        reason: `Age ${dexData.ageMinutes.toFixed(1)} min > max ${this.config.maxAgeMinutes} min`,
        stage: 'AGE'
      };
    }
    this.stats.passedAge++;
    console.log(`[PreFilter] ✓ Age: ${dexData.ageMinutes.toFixed(1)} minutes`);

    // Step 4: DIP CHECK - Only buy tokens that are dipping (not pumping!)
    if (this.config.requireDip && dexData.priceChange5m !== null) {
      if (dexData.priceChange5m > this.config.maxPriceChange5m) {
        return {
          passed: false,
          reason: `PUMP DETECTED: 5m change +${dexData.priceChange5m.toFixed(1)}% > max ${this.config.maxPriceChange5m}%`,
          stage: 'PRICE_DIP'
        };
      }
      if (dexData.priceChange5m < this.config.minPriceChange5m) {
        return {
          passed: false,
          reason: `CRASH DETECTED: 5m change ${dexData.priceChange5m.toFixed(1)}% < min ${this.config.minPriceChange5m}%`,
          stage: 'PRICE_DIP'
        };
      }
      console.log(`[PreFilter] ✓ Price trend: 5m change ${dexData.priceChange5m.toFixed(1)}%`);
    }

    // Step 5: Trading activity check
    if (dexData.buys < this.config.minBuys) {
      return {
        passed: false,
        reason: `Buys ${dexData.buys} < min ${this.config.minBuys}`,
        stage: 'ACTIVITY'
      };
    }
    const sellRatio = dexData.sells / Math.max(dexData.buys, 1);
    if (sellRatio < this.config.minSellRatio) {
      return {
        passed: false,
        reason: `Sell ratio ${(sellRatio * 100).toFixed(0)}% < min ${(this.config.minSellRatio * 100).toFixed(0)}%`,
        stage: 'ACTIVITY'
      };
    }
    if (sellRatio > this.config.maxSellRatio) {
      return {
        passed: false,
        reason: `Sell ratio ${(sellRatio * 100).toFixed(0)}% > max ${(this.config.maxSellRatio * 100).toFixed(0)}%`,
        stage: 'ACTIVITY'
      };
    }
    this.stats.passedActivity++;
    console.log(`[PreFilter] ✓ Activity: ${dexData.buys} buys, ${dexData.sells} sells`);

    // Step 6: Holder concentration check (requires Helius)
    const holderData = await this.getHolderData(tokenAddress);
    if (holderData) {
      if (holderData.topHolderPercent > this.config.maxTopHolderPercent) {
        return {
          passed: false,
          reason: `Top holder ${holderData.topHolderPercent.toFixed(1)}% > max ${this.config.maxTopHolderPercent}%`,
          stage: 'HOLDERS'
        };
      }
      if (holderData.top5HoldersPercent > this.config.maxTop5HoldersPercent) {
        return {
          passed: false,
          reason: `Top 5 holders ${holderData.top5HoldersPercent.toFixed(1)}% > max ${this.config.maxTop5HoldersPercent}%`,
          stage: 'HOLDERS'
        };
      }
      this.stats.passedHolders++;
      console.log(`[PreFilter] ✓ Holders: Top=${holderData.topHolderPercent.toFixed(1)}%, Top5=${holderData.top5HoldersPercent.toFixed(1)}%`);

      // Step 7: Bundle detection
      if (holderData.bundleWallets > this.config.maxBundleWallets) {
        return {
          passed: false,
          reason: `Bundle detected: ${holderData.bundleWallets} wallets > max ${this.config.maxBundleWallets}`,
          stage: 'BUNDLE'
        };
      }
      this.stats.passedBundle++;
      console.log(`[PreFilter] ✓ Bundle check: ${holderData.bundleWallets} suspicious wallets`);
    } else {
      console.log(`[PreFilter] ⚠ Could not fetch holder data, skipping holder checks`);
      this.stats.passedHolders++;
      this.stats.passedBundle++;
    }

    // Step 8: Creator check
    if (this.config.rejectFlaggedCreator && dexData.creator && this.flaggedCreators.has(dexData.creator)) {
      return {
        passed: false,
        reason: `Creator ${dexData.creator.slice(0, 8)} is flagged`,
        stage: 'CREATOR'
      };
    }
    this.stats.passedCreator++;
    console.log(`[PreFilter] ✓ Creator not flagged`);

    // ALL CHECKS PASSED!
    this.stats.passedAll++;
    console.log(`[PreFilter] ✅ ALL CHECKS PASSED - sending to AI`);

    const tokenData: TokenData = {
      address: tokenAddress,
      name: dexData.name,
      symbol: dexData.symbol,
      liquidity: dexData.liquidity,
      marketCap: dexData.marketCap,
      ageMinutes: dexData.ageMinutes,
      topHolderPercent: holderData?.topHolderPercent || 0,
      top5HoldersPercent: holderData?.top5HoldersPercent || 0,
      buys: dexData.buys,
      sells: dexData.sells,
      sellRatio,
      bundleWallets: holderData?.bundleWallets || 0,
      creatorAge: 0,
      creatorFlagged: false,
    };

    return { passed: true, reason: 'All pre-filters passed', stage: 'PASSED', tokenData };
  }

  /**
   * Get token data from DexScreener (FREE)
   */
  private async getDexScreenerData(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    liquidity: number;
    marketCap: number;
    ageMinutes: number;
    buys: number;
    sells: number;
    creator?: string;
    priceChange5m: number | null;
    priceChange1h: number | null;
  } | null> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/tokens/${tokenAddress}`);
      if (!response.ok) return null;

      const data = await response.json() as { pairs?: any[] };
      if (!data.pairs || data.pairs.length === 0) return null;

      // Get best pair (highest liquidity)
      const pair = data.pairs.reduce((best: any, p: any) => {
        const liq = p.liquidity?.usd || 0;
        const bestLiq = best?.liquidity?.usd || 0;
        return liq > bestLiq ? p : best;
      }, data.pairs[0]);

      const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).getTime() : Date.now();
      const ageMinutes = (Date.now() - createdAt) / 1000 / 60;

      return {
        name: pair.baseToken?.name || 'Unknown',
        symbol: pair.baseToken?.symbol || '???',
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || pair.fdv || 0,
        ageMinutes,
        buys: pair.txns?.h24?.buys || pair.txns?.h1?.buys || 0,
        sells: pair.txns?.h24?.sells || pair.txns?.h1?.sells || 0,
        creator: pair.info?.creator,
        priceChange5m: pair.priceChange?.m5 ?? null,
        priceChange1h: pair.priceChange?.h1 ?? null,
      };
    } catch (error) {
      console.error('[PreFilter] DexScreener error:', error);
      return null;
    }
  }

  /**
   * Get holder concentration data (uses Helius)
   */
  private async getHolderData(tokenAddress: string): Promise<{
    topHolderPercent: number;
    top5HoldersPercent: number;
    bundleWallets: number;
  } | null> {
    if (!HELIUS_API_KEY) {
      console.warn('[PreFilter] No Helius API key, skipping holder check');
      return null;
    }

    try {
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenLargestAccounts',
          params: [tokenAddress],
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as { result?: { value?: any[] } };
      const accounts = data.result?.value || [];

      if (accounts.length === 0) return null;

      // Calculate total supply from all accounts
      const totalSupply = accounts.reduce((sum: number, acc: any) =>
        sum + parseFloat(acc.amount || '0'), 0);

      if (totalSupply === 0) return null;

      // Top holder percentage
      const topHolder = parseFloat(accounts[0]?.amount || '0');
      const topHolderPercent = (topHolder / totalSupply) * 100;

      // Top 5 holders percentage
      const top5Total = accounts.slice(0, 5).reduce((sum: number, acc: any) =>
        sum + parseFloat(acc.amount || '0'), 0);
      const top5HoldersPercent = (top5Total / totalSupply) * 100;

      // Bundle detection: count wallets with near-identical holdings
      const holdingAmounts = accounts.map((acc: any) => parseFloat(acc.amount || '0'));
      let bundleWallets = 0;
      const checked = new Set<number>();

      for (let i = 0; i < holdingAmounts.length; i++) {
        if (checked.has(i)) continue;
        let clusterSize = 1;
        for (let j = i + 1; j < holdingAmounts.length; j++) {
          if (checked.has(j)) continue;
          const diff = Math.abs(holdingAmounts[i] - holdingAmounts[j]) / Math.max(holdingAmounts[i], 1);
          if (diff < 0.01) {
            clusterSize++;
            checked.add(j);
          }
        }
        if (clusterSize >= 3) {
          bundleWallets += clusterSize;
        }
        checked.add(i);
      }

      return { topHolderPercent, top5HoldersPercent, bundleWallets };
    } catch (error) {
      console.error('[PreFilter] Helius holder check error:', error);
      return null;
    }
  }

  flagCreator(creatorAddress: string) {
    this.flaggedCreators.add(creatorAddress);
    console.log(`[PreFilter] Flagged creator: ${creatorAddress}`);
  }

  getStats(): FilterStats {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = this.initStats();
  }

  updateConfig(config: Partial<PreFilterConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): PreFilterConfig {
    return { ...this.config };
  }

  recordAIResult(approved: boolean) {
    this.stats.sentToAI++;
    if (approved) {
      this.stats.aiApproved++;
    }
  }

  recordTrade() {
    this.stats.traded++;
  }
}
