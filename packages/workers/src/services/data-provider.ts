/**
 * Unified Data Provider
 *
 * Abstracts token data fetching, supporting multiple backends:
 * - ON_CHAIN: Pure RPC calls (free, no rate limits)
 * - HYBRID: On-chain + DexScreener for price data
 * - LEGACY: Original API-based approach (DexScreener, RugCheck, Helius)
 *
 * Allows gradual migration to fully on-chain analysis.
 */

import { OnChainAnalyzer, type OnChainAnalysis, type TokenHolder } from './onchain-analyzer';
import { fetchDexScreenerData } from './dexscreener';

// ============================================
// INTERFACES
// ============================================

export type DataProviderMode = 'ON_CHAIN' | 'HYBRID' | 'LEGACY';

export interface TokenData {
  // Basic info
  address: string;
  name: string;
  symbol: string;
  decimals: number;

  // Supply & pricing
  supply: number;
  price?: number;
  marketCap?: number;
  liquidity?: number;

  // Security
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  lpLockedPct: number;

  // Activity
  volume24h?: number;
  priceChange24h?: number;
  txns24h?: { buys: number; sells: number };
  txns1h?: { buys: number; sells: number };
  txns5m?: { buys: number; sells: number };

  // Timing
  ageHours?: number;
  age?: number; // Days

  // Holders
  holderCount: number;
  holders: HolderData[];

  // Pools
  pools: PoolData[];
  pairAddress?: string;

  // Creator
  creatorAddress: string | null;
  creatorHoldings: number;
  updateAuthority: string | null;

  // Bundle detection
  bundle: BundleData;

  // Source info
  dataSource: DataProviderMode;
  fetchDuration: number;
}

export interface HolderData {
  address: string;
  balance: number;
  percent: number;
  isLp: boolean;
  type?: 'creator' | 'whale' | 'insider' | 'lp' | 'normal';
}

export interface PoolData {
  address: string;
  dex: string;
  tokenReserve: number;
  quoteReserve: number;
  lpLocked: boolean;
  lpLockedPct: number;
}

export interface BundleData {
  detected: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  count: number;
  wallets: string[];
  txBundlePercent: number;
  patterns: string[];
}

// ============================================
// DATA PROVIDER CLASS
// ============================================

export class DataProvider {
  private mode: DataProviderMode;
  private onChain: OnChainAnalyzer;

  constructor(
    mode: DataProviderMode = 'HYBRID',
    rpcEndpoint?: string,
    _heliusKey?: string // Reserved for future Helius-specific features
  ) {
    this.mode = mode;
    this.onChain = new OnChainAnalyzer(rpcEndpoint);
  }

  /**
   * Set SOL price for USD calculations
   */
  setSolPrice(price: number) {
    this.onChain.setSolPrice(price);
  }

  /**
   * Fetch all token data
   */
  async getTokenData(tokenAddress: string): Promise<TokenData> {
    const start = Date.now();

    switch (this.mode) {
      case 'ON_CHAIN':
        return this.fetchOnChain(tokenAddress, start);

      case 'HYBRID':
        return this.fetchHybrid(tokenAddress, start);

      case 'LEGACY':
        return this.fetchLegacy(tokenAddress, start);

      default:
        return this.fetchHybrid(tokenAddress, start);
    }
  }

  // ============================================
  // ON-CHAIN MODE (Zero external APIs)
  // ============================================

  private async fetchOnChain(tokenAddress: string, start: number): Promise<TokenData> {
    console.log('[DataProvider] Using ON_CHAIN mode');

    const analysis = await this.onChain.analyze(tokenAddress);

    return this.convertOnChainToTokenData(analysis, start, 'ON_CHAIN');
  }

  // ============================================
  // HYBRID MODE (On-chain + DexScreener for price)
  // ============================================

  private async fetchHybrid(tokenAddress: string, start: number): Promise<TokenData> {
    console.log('[DataProvider] Using HYBRID mode');

    // Parallel fetch: on-chain + DexScreener
    const [analysis, dexData] = await Promise.all([
      this.onChain.analyze(tokenAddress),
      fetchDexScreenerData(tokenAddress).catch(() => null),
    ]);

    // Merge data, preferring DexScreener for market data
    const tokenData = this.convertOnChainToTokenData(analysis, start, 'HYBRID');

    if (dexData) {
      // Override with more accurate DexScreener data
      tokenData.price = dexData.priceUsd ?? tokenData.price;
      tokenData.marketCap = dexData.marketCap ?? tokenData.marketCap;
      tokenData.liquidity = dexData.liquidityUsd ?? tokenData.liquidity;
      tokenData.volume24h = dexData.volume24h ?? tokenData.volume24h;
      tokenData.priceChange24h = dexData.priceChange24h;
      tokenData.txns24h = dexData.txns24h ?? tokenData.txns24h;
      tokenData.txns1h = dexData.txns1h;
      tokenData.txns5m = dexData.txns5m;
      tokenData.pairAddress = dexData.pairAddress;

      // DexScreener age is more reliable
      if (dexData.pairCreatedAt) {
        const ageHours = (Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60);
        tokenData.ageHours = Math.round(ageHours * 10) / 10;
        tokenData.age = Math.floor(ageHours / 24);
      }

      // Use DexScreener name/symbol if available
      if (dexData.name) tokenData.name = dexData.name;
      if (dexData.symbol) tokenData.symbol = dexData.symbol;
    }

    tokenData.fetchDuration = Date.now() - start;
    return tokenData;
  }

  // ============================================
  // LEGACY MODE (Original API-based)
  // ============================================

  private async fetchLegacy(tokenAddress: string, start: number): Promise<TokenData> {
    console.log('[DataProvider] Using LEGACY mode');

    // This calls the original Helius/DexScreener/RugCheck APIs
    // For now, fall back to hybrid
    // TODO: Extract legacy logic from sentinel.ts

    return this.fetchHybrid(tokenAddress, start);
  }

  // ============================================
  // CONVERTERS
  // ============================================

  private convertOnChainToTokenData(
    analysis: OnChainAnalysis,
    start: number,
    source: DataProviderMode
  ): TokenData {
    // Convert holders to HolderData
    const holders: HolderData[] = analysis.holders.map(h => ({
      address: h.address,
      balance: h.balance,
      percent: h.percent,
      isLp: h.isLp,
      type: this.classifyHolder(h, analysis.creatorAddress),
    }));

    // Convert pools to PoolData
    const pools: PoolData[] = analysis.pools.map(p => ({
      address: p.address,
      dex: p.dex,
      tokenReserve: p.tokenReserve,
      quoteReserve: p.quoteReserve,
      lpLocked: p.lpLocked,
      lpLockedPct: p.lpLockedPct,
    }));

    // Calculate aggregate LP lock
    const lpLockedPct = pools.length > 0
      ? pools.reduce((sum, p) => sum + p.lpLockedPct, 0) / pools.length
      : 0;

    return {
      // Basic info
      address: analysis.metadata.mint,
      name: analysis.metadata.name,
      symbol: analysis.metadata.symbol,
      decimals: analysis.metadata.decimals,

      // Supply & pricing
      supply: analysis.metadata.supply,
      price: analysis.price,
      marketCap: analysis.marketCap,
      liquidity: analysis.totalLiquidity,

      // Security
      mintAuthorityActive: !!analysis.metadata.mintAuthority,
      freezeAuthorityActive: !!analysis.metadata.freezeAuthority,
      lpLockedPct,

      // Activity
      volume24h: analysis.volume24h,
      txns24h: analysis.txns24h,

      // Timing
      ageHours: analysis.ageHours,
      age: analysis.ageHours ? Math.floor(analysis.ageHours / 24) : undefined,

      // Holders
      holderCount: analysis.holders.length,
      holders,

      // Pools
      pools,
      pairAddress: pools[0]?.address,

      // Creator
      creatorAddress: analysis.creatorAddress,
      creatorHoldings: analysis.creatorHoldings,
      updateAuthority: analysis.metadata.updateAuthority,

      // Bundle
      bundle: {
        detected: analysis.bundle.detected,
        confidence: analysis.bundle.confidence,
        count: analysis.bundle.count,
        wallets: analysis.bundle.wallets,
        txBundlePercent: analysis.bundle.txBundlePercent,
        patterns: analysis.bundle.patterns,
      },

      // Source
      dataSource: source,
      fetchDuration: Date.now() - start,
    };
  }

  private classifyHolder(
    holder: TokenHolder,
    creatorAddress: string | null
  ): HolderData['type'] {
    if (holder.address === creatorAddress) return 'creator';
    if (holder.isLp) return 'lp';
    if (holder.percent > 10) return 'whale';
    if (holder.percent > 5) return 'insider';
    return 'normal';
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a data provider based on environment config
 */
export function createDataProvider(
  env: {
    DATA_PROVIDER_MODE?: string;
    HELIUS_API_KEY?: string;
    SOLANA_RPC_URL?: string;
  }
): DataProvider {
  const mode = (env.DATA_PROVIDER_MODE || 'HYBRID') as DataProviderMode;

  // Use Helius RPC if available, otherwise public
  const rpcEndpoint = env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
    : env.SOLANA_RPC_URL || undefined;

  return new DataProvider(mode, rpcEndpoint, env.HELIUS_API_KEY);
}

// Default instance
export const dataProvider = new DataProvider('HYBRID');
