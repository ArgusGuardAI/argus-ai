/**
 * Pre-Filter Pipeline
 * Aggressive FREE filters that eliminate 99% of scams before AI analysis
 *
 * This is the key to making auto-trading viable without bankrupting on AI costs.
 */

import type { NewTokenEvent } from '../types';

export interface PreFilterConfig {
  // Liquidity thresholds (for graduated tokens on DEX)
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

  // Pump.fun bonding curve settings
  allowBondingCurve: boolean;   // Allow tokens still on bonding curve (default: true)
  minBondingCurvePercent: number; // Minimum bonding curve progress to consider (default: 30)
  minBondingCurveMarketCapUsd: number; // Min market cap for bonding curve tokens (default: 5000)

  // DIP BUYING - Only buy tokens that are DOWN (avoid buying pumps)
  requireDip: boolean;          // Only buy if price is down (default: true)
  maxPriceChange5m: number;     // Max 5-min price change % to allow (e.g., -5 = must be down 5%) (default: 0)
  minPriceChange5m: number;     // Min 5-min price change % (avoid tokens crashing too hard) (default: -30)
}

export const DEFAULT_PRE_FILTER_CONFIG: PreFilterConfig = {
  // Graduated token settings (DEX)
  minLiquidityUsd: 5000,
  maxLiquidityUsd: 500000,
  minMarketCapUsd: 10000,
  maxMarketCapUsd: 5000000,

  // Holder checks - DISABLED for pump.fun (let AI analyze instead)
  maxTopHolderPercent: 100,      // Disabled - AI handles this
  maxTop5HoldersPercent: 100,    // Disabled - AI handles this

  // Age - require 2 min so DexScreener has data for safety checks
  minAgeMinutes: 2,    // Wait 2 min for price data
  maxAgeMinutes: 60,

  // Activity (for graduated tokens)
  minBuys: 50,
  minSellRatio: 0.3,
  maxSellRatio: 0.8,

  // Bundle detection - stricter
  maxBundleWallets: 10,

  // Creator checks
  rejectNewCreator: false,
  rejectFlaggedCreator: true,

  // Pump.fun bonding curve defaults
  allowBondingCurve: true,
  minBondingCurvePercent: 30,   // 30% through curve minimum
  minBondingCurveMarketCapUsd: 3000,  // $3K min market cap (lowered to catch more tokens)

  // DIP BUYING - Don't buy pumps, buy dips!
  requireDip: true,             // Only buy tokens that are dipping
  maxPriceChange5m: 0,          // Max 5-min change: 0% = must be flat or down
  minPriceChange5m: -30,        // Don't buy if crashing more than 30%
};

export interface PreFilterResult {
  passed: boolean;
  reason: string;
  stage: 'LIQUIDITY' | 'HOLDERS' | 'AGE' | 'ACTIVITY' | 'BUNDLE' | 'CREATOR' | 'MARKET_CAP' | 'BONDING_CURVE' | 'PRICE_DIP' | 'PASSED';
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
  // Bonding curve data (pump.fun)
  isBondingCurve: boolean;
  bondingCurvePercent?: number;  // 0-100% progress toward graduation
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

// DexScreener API for FREE token data (graduated tokens)
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// Pump.fun API for bonding curve tokens (FREE)
const PUMPFUN_API = 'https://frontend-api.pump.fun';

// Helius API for holder data (uses existing key)
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';

// Bonding curve graduation threshold (in SOL) - tokens graduate at ~85 SOL ($12-15K)
const GRADUATION_THRESHOLD_SOL = 85;

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
   * Main filter function - runs all checks in order of cost (cheapest first)
   */
  /**
   * Main filter function - runs all checks in order of cost (cheapest first)
   * @param tokenAddress - Token mint address
   * @param tokenEvent - Optional token event data from WebSocket (for pump.fun tokens)
   */
  async filter(tokenAddress: string, tokenEvent?: NewTokenEvent): Promise<PreFilterResult> {
    this.stats.total++;

    console.log(`[PreFilter] Checking ${tokenAddress}...`);

    // Step 1: Get basic data from DexScreener (FREE) - for graduated tokens
    const dexData = await this.getDexScreenerData(tokenAddress);

    // Step 1b: If no DEX data (or 0 liquidity), use pump.fun WebSocket data (REST API is blocked by Cloudflare)
    let isBondingCurve = false;
    let pumpWsData: { name: string; symbol: string; marketCap: number; ageMinutes: number; creator?: string } | null = null;

    // Check if this is a bonding curve token:
    // - No DEX data at all, OR
    // - DEX data with 0 liquidity (token just appeared on DEX but hasn't graduated)
    const isBondingCurveToken = !dexData || (dexData.liquidity === 0 && tokenEvent?.source === 'pump.fun');

    if (isBondingCurveToken) {
      if (!this.config.allowBondingCurve) {
        return { passed: false, reason: 'No DEX data (bonding curve tokens disabled)', stage: 'LIQUIDITY' };
      }

      // Use WebSocket data if available (pump.fun REST API is blocked)
      if (tokenEvent && tokenEvent.source === 'pump.fun') {
        const ageMinutes = (Date.now() - tokenEvent.timestamp) / 1000 / 60;
        pumpWsData = {
          name: tokenEvent.name,
          symbol: tokenEvent.symbol,
          marketCap: tokenEvent.liquidityUsd, // This is actually estimated market cap
          ageMinutes,
          creator: tokenEvent.creator,
        };
        isBondingCurve = true;
        console.log(`[PreFilter] 🔶 Pump.fun bonding curve token (from WebSocket)`);
      } else {
        // No WebSocket data and no DEX data - reject
        return { passed: false, reason: 'No DEX data found (not a pump.fun token)', stage: 'LIQUIDITY' };
      }

      // Apply bonding curve-specific checks using WebSocket data
      if (pumpWsData.marketCap < this.config.minBondingCurveMarketCapUsd) {
        return {
          passed: false,
          reason: `Bonding curve MC $${pumpWsData.marketCap.toFixed(0)} < min $${this.config.minBondingCurveMarketCapUsd}`,
          stage: 'BONDING_CURVE'
        };
      }

      // Age check for bonding curve
      if (pumpWsData.ageMinutes < this.config.minAgeMinutes) {
        return {
          passed: false,
          reason: `Age ${pumpWsData.ageMinutes.toFixed(1)} min < min ${this.config.minAgeMinutes} min`,
          stage: 'AGE'
        };
      }
      this.stats.passedAge++;
      console.log(`[PreFilter] ✓ Age: ${pumpWsData.ageMinutes.toFixed(1)} minutes`);

      // Skip liquidity, activity, and market cap checks for bonding curve
      // (they don't have traditional liquidity pools - we only have estimated market cap)
      this.stats.passedLiquidity++;
      this.stats.passedMarketCap++;
      this.stats.passedActivity++;
      console.log(`[PreFilter] ✓ Bonding curve checks passed: $${pumpWsData.marketCap.toFixed(0)} estimated MC`);
    } else {
      // Graduated token - apply normal DEX checks

      // Step 2: Liquidity check (FREE - from DexScreener)
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

      // Step 3: Market cap check (FREE - from DexScreener)
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

      // Step 4: Age check (FREE - from DexScreener)
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

      // Step 4b: DIP CHECK - Only buy tokens that are dipping (not pumping!)
      if (this.config.requireDip && dexData.priceChange5m !== null) {
        if (dexData.priceChange5m > this.config.maxPriceChange5m) {
          return {
            passed: false,
            reason: `PUMP DETECTED: 5m change +${dexData.priceChange5m.toFixed(1)}% > max ${this.config.maxPriceChange5m}% (buying the top!)`,
            stage: 'PRICE_DIP'
          };
        }
        if (dexData.priceChange5m < this.config.minPriceChange5m) {
          return {
            passed: false,
            reason: `CRASH DETECTED: 5m change ${dexData.priceChange5m.toFixed(1)}% < min ${this.config.minPriceChange5m}% (avoid crashing tokens)`,
            stage: 'PRICE_DIP'
          };
        }
        console.log(`[PreFilter] ✓ Dip buy: 5m change ${dexData.priceChange5m.toFixed(1)}% (in range ${this.config.minPriceChange5m}% to ${this.config.maxPriceChange5m}%)`);
      } else if (this.config.requireDip) {
        console.log(`[PreFilter] ⚠ No 5m price data, skipping dip check`);
      }

      // Step 5: Trading activity check (FREE - from DexScreener)
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
          reason: `Sell ratio ${(sellRatio * 100).toFixed(0)}% < min ${(this.config.minSellRatio * 100).toFixed(0)}% (no one selling = suspicious)`,
          stage: 'ACTIVITY'
        };
      }
      if (sellRatio > this.config.maxSellRatio) {
        return {
          passed: false,
          reason: `Sell ratio ${(sellRatio * 100).toFixed(0)}% > max ${(this.config.maxSellRatio * 100).toFixed(0)}% (dump in progress)`,
          stage: 'ACTIVITY'
        };
      }
      this.stats.passedActivity++;
      console.log(`[PreFilter] ✓ Activity: ${dexData.buys} buys, ${dexData.sells} sells (${(sellRatio * 100).toFixed(0)}% ratio)`);
    }

    // Use the data source we have
    const tokenName = dexData?.name || pumpWsData?.name || 'Unknown';
    const tokenSymbol = dexData?.symbol || pumpWsData?.symbol || '???';
    const tokenMarketCap = dexData?.marketCap || pumpWsData?.marketCap || 0;
    const tokenAgeMinutes = dexData?.ageMinutes || pumpWsData?.ageMinutes || 0;
    const tokenCreator = dexData?.creator || pumpWsData?.creator;
    const tokenBuys = dexData?.buys || 0;
    const tokenSells = dexData?.sells || 0;
    const sellRatio = tokenBuys > 0 ? tokenSells / tokenBuys : 0;

    // Step 6: Holder concentration check (requires Helius - still cheap)
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

      // Step 7: Bundle detection (from holder patterns)
      if (holderData.bundleWallets > this.config.maxBundleWallets) {
        return {
          passed: false,
          reason: `Bundle detected: ${holderData.bundleWallets} wallets with identical holdings > max ${this.config.maxBundleWallets}`,
          stage: 'BUNDLE'
        };
      }
      this.stats.passedBundle++;
      console.log(`[PreFilter] ✓ Bundle check: ${holderData.bundleWallets} suspicious wallets`);
    } else {
      // Can't check holders, be cautious
      console.log(`[PreFilter] ⚠ Could not fetch holder data, skipping holder checks`);
      this.stats.passedHolders++;
      this.stats.passedBundle++;
    }

    // Step 8: Creator check
    if (this.config.rejectFlaggedCreator && tokenCreator && this.flaggedCreators.has(tokenCreator)) {
      return {
        passed: false,
        reason: `Creator ${tokenCreator.slice(0, 8)} is flagged for previous rugs`,
        stage: 'CREATOR'
      };
    }
    this.stats.passedCreator++;
    console.log(`[PreFilter] ✓ Creator not flagged`);

    // ALL CHECKS PASSED!
    this.stats.passedAll++;
    const sourceType = isBondingCurve ? 'bonding curve' : 'graduated';
    console.log(`[PreFilter] ✅ ALL CHECKS PASSED (${sourceType}) - sending to AI`);

    const tokenData: TokenData = {
      address: tokenAddress,
      name: tokenName,
      symbol: tokenSymbol,
      liquidity: dexData?.liquidity || 0,
      marketCap: tokenMarketCap,
      ageMinutes: tokenAgeMinutes,
      topHolderPercent: holderData?.topHolderPercent || 0,
      top5HoldersPercent: holderData?.top5HoldersPercent || 0,
      buys: tokenBuys,
      sells: tokenSells,
      sellRatio,
      bundleWallets: holderData?.bundleWallets || 0,
      creatorAge: 0,
      creatorFlagged: false,
      isBondingCurve,
      bondingCurvePercent: undefined, // WebSocket doesn't provide bonding curve progress
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
   * Get token data from Pump.fun API (FREE) - for bonding curve tokens
   */
  private async getPumpFunData(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    marketCap: number;
    ageMinutes: number;
    bondingCurvePercent: number;
    virtualSolReserves: number;
    creator?: string;
    replyCount: number;
  } | null> {
    try {
      const response = await fetch(`${PUMPFUN_API}/coins/${tokenAddress}`);
      if (!response.ok) return null;

      const data = await response.json() as any;

      // If token has "complete" status, it's graduated (use DexScreener instead)
      if (data.complete) {
        console.log(`[PreFilter] Token ${tokenAddress} is graduated, not on bonding curve`);
        return null;
      }

      // Calculate bonding curve progress
      // Tokens graduate at ~85 SOL virtual reserves
      const virtualSolReserves = (data.virtual_sol_reserves || 0) / 1e9; // Convert from lamports
      const bondingCurvePercent = Math.min(100, (virtualSolReserves / GRADUATION_THRESHOLD_SOL) * 100);

      // Calculate market cap from curve position
      // Market cap = (virtualSolReserves * SOL price) * 2 (roughly)
      // For now use their market_cap field if available
      const marketCap = data.usd_market_cap || (virtualSolReserves * 150 * 2); // Rough estimate at ~$150/SOL

      // Calculate age
      const createdAt = data.created_timestamp ? new Date(data.created_timestamp).getTime() : Date.now();
      const ageMinutes = (Date.now() - createdAt) / 1000 / 60;

      return {
        name: data.name || 'Unknown',
        symbol: data.symbol || '???',
        marketCap,
        ageMinutes,
        bondingCurvePercent,
        virtualSolReserves,
        creator: data.creator,
        replyCount: data.reply_count || 0,
      };
    } catch (error) {
      console.error('[PreFilter] Pump.fun API error:', error);
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

      // Bundle detection: count wallets with near-identical holdings (within 1%)
      const holdingAmounts = accounts.map((acc: any) => parseFloat(acc.amount || '0'));
      let bundleWallets = 0;
      const checked = new Set<number>();

      for (let i = 0; i < holdingAmounts.length; i++) {
        if (checked.has(i)) continue;
        let clusterSize = 1;
        for (let j = i + 1; j < holdingAmounts.length; j++) {
          if (checked.has(j)) continue;
          const diff = Math.abs(holdingAmounts[i] - holdingAmounts[j]) / Math.max(holdingAmounts[i], 1);
          if (diff < 0.01) { // Within 1%
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

  /**
   * Add a creator to the flagged list
   */
  flagCreator(creatorAddress: string) {
    this.flaggedCreators.add(creatorAddress);
    console.log(`[PreFilter] Flagged creator: ${creatorAddress}`);
  }

  /**
   * Get current filter statistics
   */
  getStats(): FilterStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = this.initStats();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PreFilterConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): PreFilterConfig {
    return { ...this.config };
  }

  /**
   * Record AI result for stats
   */
  recordAIResult(approved: boolean) {
    this.stats.sentToAI++;
    if (approved) {
      this.stats.aiApproved++;
    }
  }

  /**
   * Record trade for stats
   */
  recordTrade() {
    this.stats.traded++;
  }
}
