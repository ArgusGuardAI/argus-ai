/**
 * Sentinel Data Integration
 *
 * Bridges the DataProvider with Sentinel's analysis pipeline.
 * Provides a unified interface that can use either:
 * - Legacy APIs (DexScreener, RugCheck, Helius)
 * - On-chain data (pure RPC)
 * - Hybrid (on-chain + DexScreener for price)
 */

import { type DataProviderMode } from './data-provider';
import { OnChainAnalyzer } from './onchain-analyzer';
import { fetchDexScreenerData } from './dexscreener';
import { fetchHeliusTokenMetadata, analyzeTokenTransactions, analyzeDevSelling } from './helius';

// ============================================
// INTERFACES (matching sentinel.ts expectations)
// ============================================

export interface SentinelTokenInfo {
  address: string;
  name: string;
  symbol: string;
  price?: number;
  marketCap?: number;
  liquidity: number;
  age?: number;
  ageHours?: number;
  holderCount: number;
  priceChange24h?: number;
  volume24h?: number;
  txns5m?: { buys: number; sells: number };
  txns1h?: { buys: number; sells: number };
  txns24h?: { buys: number; sells: number };
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  lpLockedPct: number;
}

export interface SentinelHolderInfo {
  address: string;
  balance: number;
  percent: number;
  isLp: boolean;
}

export interface SentinelBundleInfo {
  detected: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  count: number;
  txBundlePercent: number;
  suspiciousPatterns?: string[];
  description?: string;
  wallets?: string[];             // Actual bundle wallet addresses
  controlPercent?: number;        // Actual % of supply controlled by bundle wallets (capped at 100%)
  walletsWithHoldings?: Array<{   // Detailed wallet info for UI
    address: string;
    percent: number;
    isLp: boolean;
  }>;
}

export interface SentinelCreatorInfo {
  address: string;
  walletAge: number;
  tokensCreated: number;
  ruggedTokens: number;
  currentHoldings: number;
}

export interface SentinelDevActivity {
  hasSold: boolean;
  percentSold: number;
  sellCount: number;
  currentHoldingsPercent: number;
  severity: string;
  message: string;
}

export interface SentinelDataResult {
  tokenInfo: SentinelTokenInfo;
  holders: SentinelHolderInfo[];
  bundleInfo: SentinelBundleInfo;
  creatorInfo: SentinelCreatorInfo | null;
  devActivity: SentinelDevActivity | null;
  creatorAddress: string | null;
  pairAddress: string | null;
  isPumpFun: boolean;
  dataSource: DataProviderMode;
  fetchDuration: number;
}

// ============================================
// SENTINEL DATA FETCHER
// ============================================

export class SentinelDataFetcher {
  private mode: DataProviderMode;
  private onChain: OnChainAnalyzer;
  private heliusKey?: string;

  constructor(
    mode: DataProviderMode = 'HYBRID',
    rpcEndpoint?: string,
    heliusKey?: string
  ) {
    this.mode = mode;
    this.onChain = new OnChainAnalyzer(rpcEndpoint);
    this.heliusKey = heliusKey;
  }

  /**
   * Fetch all data needed for sentinel analysis
   */
  async fetchData(tokenAddress: string): Promise<SentinelDataResult> {
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
  // ON-CHAIN MODE
  // ============================================

  private async fetchOnChain(tokenAddress: string, start: number): Promise<SentinelDataResult> {
    console.log('[SentinelData] Using ON_CHAIN mode');

    const analysis = await this.onChain.analyze(tokenAddress);

    const isPumpFun = tokenAddress.endsWith('pump') ||
      analysis.pools.some(p => p.dex === 'pumpfun');

    // Map to sentinel format
    const tokenInfo: SentinelTokenInfo = {
      address: tokenAddress,
      name: analysis.metadata.name,
      symbol: analysis.metadata.symbol,
      price: analysis.price,
      marketCap: analysis.marketCap,
      liquidity: analysis.totalLiquidity,
      age: analysis.ageHours ? Math.floor(analysis.ageHours / 24) : undefined,
      ageHours: analysis.ageHours,
      holderCount: analysis.holders.length,
      volume24h: analysis.volume24h,
      txns24h: analysis.txns24h,
      mintAuthorityActive: !!analysis.metadata.mintAuthority,
      freezeAuthorityActive: !!analysis.metadata.freezeAuthority,
      lpLockedPct: this.calculateAvgLpLock(analysis.pools),
    };

    const holders: SentinelHolderInfo[] = analysis.holders.map(h => ({
      address: h.address,
      balance: h.balance,
      percent: h.percent,
      isLp: h.isLp,
    }));

    // Calculate actual bundle control percentage
    const bundleWallets = analysis.bundle.wallets || [];
    const bundleHoldersMatched = analysis.holders.filter(h => bundleWallets.includes(h.address));
    const rawBundleControlPercent = bundleHoldersMatched.reduce((sum, h) => sum + h.percent, 0);
    // Cap at 100% - anything higher is a data issue
    const bundleControlPercent = Math.min(rawBundleControlPercent, 100);

    // Build detailed wallet info with holdings for UI
    const walletsWithHoldings = bundleHoldersMatched
      .map(h => ({ address: h.address, percent: h.percent, isLp: h.isLp }))
      .sort((a, b) => b.percent - a.percent);

    const bundleInfo: SentinelBundleInfo = {
      detected: analysis.bundle.detected,
      confidence: analysis.bundle.confidence,
      count: analysis.bundle.count,
      txBundlePercent: analysis.bundle.txBundlePercent,
      suspiciousPatterns: analysis.bundle.patterns,
      description: analysis.bundle.patterns.join('; '),
      wallets: bundleWallets,
      controlPercent: bundleControlPercent,
      walletsWithHoldings,
    };

    // Creator info (limited without Helius)
    const creatorInfo: SentinelCreatorInfo | null = analysis.creatorAddress ? {
      address: analysis.creatorAddress,
      walletAge: -1, // Would need additional RPC calls
      tokensCreated: 0,
      ruggedTokens: 0,
      currentHoldings: analysis.creatorHoldings,
    } : null;

    return {
      tokenInfo,
      holders,
      bundleInfo,
      creatorInfo,
      devActivity: null, // Requires Helius for full analysis
      creatorAddress: analysis.creatorAddress,
      pairAddress: analysis.pools[0]?.address || null,
      isPumpFun,
      dataSource: 'ON_CHAIN',
      fetchDuration: Date.now() - start,
    };
  }

  // ============================================
  // HYBRID MODE
  // ============================================

  private async fetchHybrid(tokenAddress: string, start: number): Promise<SentinelDataResult> {
    console.log('[SentinelData] Using HYBRID mode');

    // Parallel fetch: on-chain + DexScreener
    const [analysis, dexData] = await Promise.all([
      this.onChain.analyze(tokenAddress),
      fetchDexScreenerData(tokenAddress).catch(() => null),
    ]);

    const isPumpFun = tokenAddress.endsWith('pump') ||
      dexData?.dex === 'pumpfun' ||
      analysis.pools.some(p => p.dex === 'pumpfun');

    // Merge data, preferring DexScreener for market data
    // For pump.fun tokens, estimate liquidity from bonding curve if not available
    let estimatedLiquidity = dexData?.liquidityUsd ?? analysis.totalLiquidity;
    if (isPumpFun && (!estimatedLiquidity || estimatedLiquidity === 0)) {
      // Pump.fun bonding curve tokens have ~30-85 SOL locked
      // Estimate based on market cap progression (higher mcap = more SOL deposited)
      const mcap = dexData?.marketCap ?? analysis.marketCap ?? 0;
      if (mcap > 0) {
        // Bonding curve math: liquidity roughly scales with sqrt of market cap
        // At $3k mcap, ~$3k liquidity; at $30k mcap, ~$10k liquidity
        estimatedLiquidity = Math.min(mcap, 50000); // Cap at $50k
        console.log(`[SentinelData] Pump.fun liquidity estimated: $${estimatedLiquidity.toFixed(0)} from mcap $${mcap.toFixed(0)}`);
      }
    }

    const tokenInfo: SentinelTokenInfo = {
      address: tokenAddress,
      name: dexData?.name || analysis.metadata.name,
      symbol: dexData?.symbol || analysis.metadata.symbol,
      price: dexData?.priceUsd ?? analysis.price,
      marketCap: dexData?.marketCap ?? analysis.marketCap,
      liquidity: estimatedLiquidity,
      age: dexData?.pairCreatedAt
        ? Math.floor((Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60 * 24))
        : (analysis.ageHours ? Math.floor(analysis.ageHours / 24) : undefined),
      ageHours: dexData?.pairCreatedAt
        ? (Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60)
        : analysis.ageHours,
      holderCount: analysis.holders.length,
      priceChange24h: dexData?.priceChange24h,
      volume24h: dexData?.volume24h ?? analysis.volume24h,
      txns5m: dexData?.txns5m,
      txns1h: dexData?.txns1h,
      txns24h: dexData?.txns24h ?? analysis.txns24h,
      mintAuthorityActive: !!analysis.metadata.mintAuthority,
      freezeAuthorityActive: !!analysis.metadata.freezeAuthority,
      lpLockedPct: this.calculateAvgLpLock(analysis.pools),
    };

    const holders: SentinelHolderInfo[] = analysis.holders.map(h => ({
      address: h.address,
      balance: h.balance,
      percent: h.percent,
      isLp: h.isLp,
    }));

    // Calculate actual bundle control percentage
    const hybridBundleWallets = analysis.bundle.wallets || [];
    const hybridBundleHoldersMatched = analysis.holders.filter(h => hybridBundleWallets.includes(h.address));
    const rawHybridBundleControlPercent = hybridBundleHoldersMatched.reduce((sum, h) => sum + h.percent, 0);
    // Cap at 100% - anything higher is a data issue
    const hybridBundleControlPercent = Math.min(rawHybridBundleControlPercent, 100);

    // Build detailed wallet info with holdings for UI
    const hybridWalletsWithHoldings = hybridBundleHoldersMatched
      .map(h => ({ address: h.address, percent: h.percent, isLp: h.isLp }))
      .sort((a, b) => b.percent - a.percent);

    const bundleInfo: SentinelBundleInfo = {
      detected: analysis.bundle.detected,
      confidence: analysis.bundle.confidence,
      count: analysis.bundle.count,
      txBundlePercent: analysis.bundle.txBundlePercent,
      suspiciousPatterns: analysis.bundle.patterns,
      description: analysis.bundle.patterns.join('; '),
      wallets: hybridBundleWallets,
      controlPercent: hybridBundleControlPercent,
      walletsWithHoldings: hybridWalletsWithHoldings,
    };

    const creatorInfo: SentinelCreatorInfo | null = analysis.creatorAddress ? {
      address: analysis.creatorAddress,
      walletAge: -1,
      tokensCreated: 0,
      ruggedTokens: 0,
      currentHoldings: analysis.creatorHoldings,
    } : null;

    return {
      tokenInfo,
      holders,
      bundleInfo,
      creatorInfo,
      devActivity: null,
      creatorAddress: analysis.creatorAddress,
      pairAddress: dexData?.pairAddress || analysis.pools[0]?.address || null,
      isPumpFun,
      dataSource: 'HYBRID',
      fetchDuration: Date.now() - start,
    };
  }

  // ============================================
  // LEGACY MODE (for comparison)
  // ============================================

  private async fetchLegacy(tokenAddress: string, start: number): Promise<SentinelDataResult> {
    console.log('[SentinelData] Using LEGACY mode');

    if (!this.heliusKey) {
      console.warn('[SentinelData] No Helius key, falling back to HYBRID');
      return this.fetchHybrid(tokenAddress, start);
    }

    // This mimics the original sentinel.ts data fetching
    const [dexData, metadata, txAnalysis] = await Promise.all([
      fetchDexScreenerData(tokenAddress),
      fetchHeliusTokenMetadata(tokenAddress, this.heliusKey),
      analyzeTokenTransactions(tokenAddress, this.heliusKey),
    ]);

    // Get on-chain holders (more reliable than Helius for this)
    const analysis = await this.onChain.analyze(tokenAddress);

    const isPumpFun = tokenAddress.endsWith('pump') || dexData?.dex === 'pumpfun';

    let effectiveLiquidity = dexData?.liquidityUsd || 0;
    if (isPumpFun && effectiveLiquidity <= 0 && dexData?.marketCap && dexData.marketCap > 0) {
      effectiveLiquidity = Math.round(dexData.marketCap * 0.20);
    }

    const ageHours = dexData?.pairCreatedAt
      ? (Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60)
      : undefined;

    const tokenInfo: SentinelTokenInfo = {
      address: tokenAddress,
      name: metadata?.name || dexData?.name || 'Unknown',
      symbol: metadata?.symbol || dexData?.symbol || '???',
      price: dexData?.priceUsd,
      marketCap: dexData?.marketCap,
      liquidity: effectiveLiquidity,
      age: ageHours ? Math.floor(ageHours / 24) : undefined,
      ageHours,
      holderCount: analysis.holders.length,
      priceChange24h: dexData?.priceChange24h,
      volume24h: dexData?.volume24h,
      txns5m: dexData?.txns5m,
      txns1h: dexData?.txns1h,
      txns24h: dexData?.txns24h,
      mintAuthorityActive: !!metadata?.mintAuthority,
      freezeAuthorityActive: !!metadata?.freezeAuthority,
      lpLockedPct: 0, // Would need RugCheck
    };

    const holders: SentinelHolderInfo[] = analysis.holders.map(h => ({
      address: h.address,
      balance: h.balance,
      percent: h.percent,
      isLp: h.isLp,
    }));

    // Use transaction-based bundle detection
    const bundleInfo: SentinelBundleInfo = {
      detected: txAnalysis.bundleDetected,
      confidence: txAnalysis.bundleDetected
        ? (txAnalysis.bundledBuyPercent > 20 ? 'HIGH' : 'MEDIUM')
        : 'NONE',
      count: txAnalysis.coordinatedWallets,
      txBundlePercent: txAnalysis.bundledBuyPercent,
      suspiciousPatterns: txAnalysis.suspiciousPatterns,
    };

    const creatorAddress = metadata?.updateAuthority || null;
    const creatorHolder = creatorAddress
      ? analysis.holders.find(h => h.address === creatorAddress)
      : null;

    const creatorInfo: SentinelCreatorInfo | null = creatorAddress ? {
      address: creatorAddress,
      walletAge: -1,
      tokensCreated: 0,
      ruggedTokens: 0,
      currentHoldings: creatorHolder?.percent || 0,
    } : null;

    // Dev activity analysis
    let devActivity: SentinelDevActivity | null = null;
    if (creatorAddress) {
      try {
        devActivity = await analyzeDevSelling(creatorAddress, tokenAddress, this.heliusKey);
      } catch {
        // Skip on error
      }
    }

    return {
      tokenInfo,
      holders,
      bundleInfo,
      creatorInfo,
      devActivity,
      creatorAddress,
      pairAddress: dexData?.pairAddress || null,
      isPumpFun,
      dataSource: 'LEGACY',
      fetchDuration: Date.now() - start,
    };
  }

  // ============================================
  // HELPERS
  // ============================================

  private calculateAvgLpLock(pools: Array<{ lpLockedPct: number }>): number {
    if (pools.length === 0) return 0;
    const total = pools.reduce((sum, p) => sum + p.lpLockedPct, 0);
    return Math.round((total / pools.length) * 10) / 10;
  }
}

/**
 * Factory function to create SentinelDataFetcher
 */
export function createSentinelDataFetcher(env: {
  DATA_PROVIDER_MODE?: string;
  HELIUS_API_KEY?: string;
  SOLANA_RPC_URL?: string;
}): SentinelDataFetcher {
  const mode = (env.DATA_PROVIDER_MODE || 'ON_CHAIN') as DataProviderMode;

  const rpcEndpoint = env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
    : env.SOLANA_RPC_URL || undefined;

  return new SentinelDataFetcher(mode, rpcEndpoint, env.HELIUS_API_KEY);
}
