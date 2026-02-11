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
// DexScreener and Helius removed — all data comes from on-chain sources
import { SolanaRpcClient, createSolanaRpcClientFromEnv } from './solana-rpc';

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
  private onChain: OnChainAnalyzer | null = null;
  // Helius key removed — no longer using external APIs

  constructor(
    mode: DataProviderMode = 'ON_CHAIN', // Default changed to ON_CHAIN
    rpcEndpointOrClient?: string | SolanaRpcClient,
    _heliusKey?: string // Kept for backwards compatibility but not used
  ) {
    // All modes now use pure on-chain data
    this.mode = mode;
    if (rpcEndpointOrClient) {
      this.onChain = new OnChainAnalyzer(rpcEndpointOrClient);
    }
  }

  private getOnChainAnalyzer(): OnChainAnalyzer {
    if (!this.onChain) {
      throw new Error('SOLANA_RPC_URL not configured - cannot perform on-chain analysis');
    }
    return this.onChain;
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

    const analysis = await this.getOnChainAnalyzer().analyze(tokenAddress);

    const isPumpFun = tokenAddress.endsWith('pump') ||
      analysis.pools.some(p => p.dex === 'pumpfun');

    // For pump.fun tokens still on bonding curve, estimate liquidity from market cap
    let effectiveLiquidity = analysis.totalLiquidity;
    if (isPumpFun && (!effectiveLiquidity || effectiveLiquidity === 0)) {
      const mcap = analysis.marketCap ?? 0;
      if (mcap > 0) {
        // Bonding curve: liquidity roughly scales with market cap, capped at $50k
        effectiveLiquidity = Math.min(mcap, 50000);
        console.log(`[SentinelData] Pump.fun ON_CHAIN liquidity estimated: $${effectiveLiquidity.toFixed(0)} from mcap $${mcap.toFixed(0)}`);
      }
    }

    // Map to sentinel format
    const tokenInfo: SentinelTokenInfo = {
      address: tokenAddress,
      name: analysis.metadata.name,
      symbol: analysis.metadata.symbol,
      price: analysis.price,
      marketCap: analysis.marketCap,
      liquidity: effectiveLiquidity,
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
  // HYBRID MODE (Now pure on-chain, kept for backwards compatibility)
  // Previously used DexScreener for market data — now uses on-chain pool data
  // ============================================

  private async fetchHybrid(tokenAddress: string, start: number): Promise<SentinelDataResult> {
    console.log('[SentinelData] Using HYBRID mode (pure on-chain)');

    // All data comes from on-chain — no external API calls
    return this.fetchOnChain(tokenAddress, start);
  }

  // ============================================
  // LEGACY MODE (Deprecated - now uses pure on-chain)
  // Kept for backwards compatibility with existing deployments
  // ============================================

  private async fetchLegacy(tokenAddress: string, start: number): Promise<SentinelDataResult> {
    console.log('[SentinelData] LEGACY mode deprecated — using pure on-chain');

    // All modes now use pure on-chain data
    return this.fetchOnChain(tokenAddress, start);
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
 *
 * NOTE: All modes now use pure on-chain data.
 * External APIs (DexScreener, Helius, RugCheck) have been removed.
 * Your own RPC node provides all the data.
 */
export function createSentinelDataFetcher(env: {
  DATA_PROVIDER_MODE?: string;
  HELIUS_API_KEY?: string; // Deprecated — not used
  SOLANA_RPC_URL?: string;
  QUICKNODE_RPC_URL?: string;
  ALCHEMY_RPC_URL?: string;
  TRITON_RPC_URL?: string;
}): SentinelDataFetcher {
  // All modes now use pure on-chain data — external APIs removed
  const mode = (env.DATA_PROVIDER_MODE || 'ON_CHAIN') as DataProviderMode;

  // Use multi-RPC client with automatic failover
  const multiRpcClient = createSolanaRpcClientFromEnv(env);

  return new SentinelDataFetcher(mode, multiRpcClient);
}
