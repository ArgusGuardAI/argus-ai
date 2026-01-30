/**
 * On-Chain Token Analyzer
 *
 * Fetches ALL token data directly from Solana blockchain.
 * No external APIs - pure on-chain data extraction.
 *
 * Uses:
 * - solana-rpc.ts: Low-level RPC calls
 * - price-oracle.ts: Jupiter price API
 * - dex-pools.ts: DEX pool parsing
 * - metaplex.ts: Token metadata
 */

import { SolanaRpcClient, PROGRAMS } from './solana-rpc';
import { getSolPrice, getTokenPrice, calculatePriceFromPool, calculateLiquidity } from './price-oracle';
import { findAllPools, type PoolInfo } from './dex-pools';
import { fetchTokenMetadata } from './metaplex';
import { isPumpfunToken, fetchPumpfunMetadata, getPumpfunPoolInfo } from './pumpfun';

// ============================================
// INTERFACES
// ============================================

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  updateAuthority: string | null;
}

export interface TokenHolder {
  address: string;         // Owner wallet address
  tokenAccount: string;    // Token account address
  balance: number;         // Token balance (UI amount)
  percent: number;         // Percentage of supply
  isLp: boolean;           // Is this a liquidity pool?
}

export interface LiquidityPool {
  address: string;
  dex: string;
  tokenMint: string;
  quoteMint: string;
  tokenReserve: number;
  quoteReserve: number;
  lpMint?: string;
  lpLocked: boolean;
  lpLockedPct: number;
  createdAt?: number;
}

export interface BundleAnalysis {
  detected: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  count: number;
  wallets: string[];
  sameBlockBuys: number;
  txBundlePercent: number;
  patterns: string[];
}

export interface OnChainAnalysis {
  metadata: TokenMetadata;
  holders: TokenHolder[];
  pools: LiquidityPool[];
  totalLiquidity: number;
  price?: number;
  marketCap?: number;
  volume24h?: number;
  txns24h?: { buys: number; sells: number };
  ageHours?: number;
  bundle: BundleAnalysis;
  creatorAddress: string | null;
  creatorHoldings: number;
}

// Known LP program addresses
const LP_PROGRAMS = new Set([
  PROGRAMS.RAYDIUM_AMM_V4,
  PROGRAMS.RAYDIUM_CLMM,
  PROGRAMS.ORCA_WHIRLPOOL,
  PROGRAMS.METEORA_DLMM,
  PROGRAMS.PUMPFUN,
  PROGRAMS.PUMPSWAP,
]);

// LP address prefixes (heuristic)
const LP_PREFIXES = ['5Q544', 'HWy1', 'Gnt2', 'BVCh', 'DQyr', 'BDc8', '39azU', 'FoSD'];

// ============================================
// ON-CHAIN ANALYZER CLASS
// ============================================

export class OnChainAnalyzer {
  private rpc: SolanaRpcClient;
  private rpcEndpoint: string;
  private solPrice: number = 200;

  constructor(rpcEndpointOrClient?: string | SolanaRpcClient) {
    if (typeof rpcEndpointOrClient === 'string' || rpcEndpointOrClient === undefined) {
      this.rpcEndpoint = rpcEndpointOrClient || 'https://api.mainnet-beta.solana.com';
      this.rpc = new SolanaRpcClient(this.rpcEndpoint);
    } else {
      // Use pre-constructed RPC client (e.g., MultiRpcSolanaClient)
      this.rpc = rpcEndpointOrClient;
      this.rpcEndpoint = 'multi-rpc'; // Placeholder - actual endpoints managed by client
    }
  }

  /**
   * Set SOL price manually
   */
  setSolPrice(price: number) {
    this.solPrice = price;
  }

  /**
   * Fetch current SOL price from on-chain pool
   */
  async fetchSolPrice(): Promise<number> {
    this.solPrice = await getSolPrice(this.rpcEndpoint);
    return this.solPrice;
  }

  /**
   * Full token analysis from on-chain data
   */
  async analyze(tokenMint: string): Promise<OnChainAnalysis> {
    console.log(`[OnChain] Analyzing ${tokenMint.slice(0, 8)}...`);
    const start = Date.now();

    // Fetch SOL price first
    await this.fetchSolPrice();
    console.log(`[OnChain] SOL price: $${this.solPrice}`);

    // Check if this is a Pumpfun token (special handling)
    const isPumpfun = isPumpfunToken(tokenMint);
    let pumpfunData = null;
    let pumpfunPool = null;

    if (isPumpfun) {
      console.log('[OnChain] Pumpfun token detected, fetching from Pumpfun API...');
      [pumpfunData, pumpfunPool] = await Promise.all([
        fetchPumpfunMetadata(tokenMint),
        getPumpfunPoolInfo(this.rpc, tokenMint, this.solPrice),
      ]);
    }

    // Parallel fetch of all data
    const [metadata, holders, pools, tokenPrice] = await Promise.all([
      this.getTokenMetadata(tokenMint, pumpfunData),
      this.getTopHolders(tokenMint, 25),
      this.getPools(tokenMint),
      getTokenPrice(tokenMint),
    ]);

    console.log(`[OnChain] Data fetch: ${Date.now() - start}ms`);

    // Calculate liquidity and price
    let totalLiquidity = 0;
    let price = tokenPrice?.priceUsd;
    let marketCap: number | undefined;

    // Use Pumpfun data if available
    if (pumpfunPool) {
      totalLiquidity = pumpfunPool.liquidity;
      price = pumpfunPool.price;
      marketCap = pumpfunPool.marketCap;
      console.log(`[OnChain] Pumpfun pool: $${totalLiquidity.toFixed(0)} liquidity, $${price?.toFixed(8)} price`);
    } else {
      for (const pool of pools) {
        const poolLiquidity = calculateLiquidity(pool.quoteReserve, pool.quoteMint, this.solPrice);
        totalLiquidity += poolLiquidity;

        // Fallback price from pool if Jupiter doesn't have it
        if (!price && pool.tokenReserve > 0) {
          price = calculatePriceFromPool(
            pool.tokenReserve,
            pool.quoteReserve,
            pool.quoteMint,
            this.solPrice
          ) ?? undefined;
        }
      }
      marketCap = price ? price * metadata.supply : undefined;
    }

    // Find creator
    let creatorAddress = pumpfunData?.creator || metadata.updateAuthority;
    if (!creatorAddress) {
      const likelyCreator = holders.find(h => !h.isLp && h.percent > 2 && h.percent < 40);
      creatorAddress = likelyCreator?.address || null;
    }

    const creatorHolder = creatorAddress
      ? holders.find(h => h.address === creatorAddress)
      : null;
    const creatorHoldings = creatorHolder?.percent || 0;

    // Token age (calculate early so we can use it for bundle detection)
    let ageHours: number | undefined;
    if (pumpfunData?.createdAt) {
      ageHours = (Date.now() - pumpfunData.createdAt) / (1000 * 60 * 60);
    } else {
      const oldestPool = pools
        .filter(p => p.createdAt)
        .sort((a, b) => (a.createdAt || Infinity) - (b.createdAt || Infinity))[0];
      ageHours = oldestPool?.createdAt
        ? (Date.now() - oldestPool.createdAt * 1000) / (1000 * 60 * 60)
        : undefined;
    }

    // Bundle detection (pass token characteristics for smarter detection)
    const bundleStart = Date.now();
    const bundle = await this.detectBundles(tokenMint, holders, ageHours, totalLiquidity, marketCap);
    console.log(`[OnChain] Bundle detection: ${Date.now() - bundleStart}ms`);

    // Volume estimation
    const { volume24h, txns24h } = await this.estimateVolume(tokenMint, price);

    // Add pumpfun pool to pools array if found
    const allPools = pumpfunPool
      ? [pumpfunPool, ...pools]
      : pools;

    console.log(`[OnChain] Total analysis: ${Date.now() - start}ms`);

    return {
      metadata,
      holders,
      pools: allPools.map(p => ({
        address: p.address,
        dex: p.dex,
        tokenMint: p.tokenMint,
        quoteMint: p.quoteMint,
        tokenReserve: p.tokenReserve,
        quoteReserve: p.quoteReserve,
        lpMint: (p as PoolInfo).lpMint,
        lpLocked: p.lpLocked,
        lpLockedPct: p.lpLockedPct,
        createdAt: (p as PoolInfo).createdAt,
      })),
      totalLiquidity,
      price,
      marketCap,
      volume24h,
      txns24h,
      ageHours,
      bundle,
      creatorAddress,
      creatorHoldings,
    };
  }

  // ============================================
  // TOKEN METADATA
  // ============================================

  async getTokenMetadata(
    mint: string,
    pumpfunData?: { name: string; symbol: string; creator: string } | null
  ): Promise<TokenMetadata> {
    // Get supply and mint info in parallel
    const [supplyResult, mintInfo, metaplexData] = await Promise.all([
      this.rpc.getTokenSupply(mint),
      this.rpc.getAccountInfo(mint, 'jsonParsed'),
      pumpfunData ? Promise.resolve(null) : fetchTokenMetadata(this.rpc, mint), // Skip Metaplex if we have Pumpfun data
    ]);

    const supply = supplyResult.value.uiAmount;
    const decimals = supplyResult.value.decimals;

    // Parse mint account
    const mintData = mintInfo.value?.data as {
      parsed?: {
        info?: {
          mintAuthority?: string;
          freezeAuthority?: string;
        };
      };
    };

    const info = mintData?.parsed?.info || {};

    // Use Pumpfun data if available, otherwise Metaplex, otherwise defaults
    const name = pumpfunData?.name || metaplexData?.name || 'Unknown';
    const symbol = pumpfunData?.symbol || metaplexData?.symbol || '???';
    const updateAuthority = pumpfunData?.creator || metaplexData?.updateAuthority || null;

    return {
      mint,
      name,
      symbol,
      decimals,
      supply,
      mintAuthority: info.mintAuthority || null,
      freezeAuthority: info.freezeAuthority || null,
      updateAuthority,
    };
  }

  // ============================================
  // HOLDER ANALYSIS
  // ============================================

  async getTopHolders(mint: string, limit: number = 20): Promise<TokenHolder[]> {
    const largestAccounts = await this.rpc.getTokenLargestAccounts(mint);
    const accounts = largestAccounts.value.slice(0, limit);

    if (accounts.length === 0) return [];

    const supply = await this.rpc.getTokenSupply(mint);
    const totalSupply = supply.value.uiAmount;

    // Get owner info for each account
    const tokenAccountAddresses = accounts.map(a => a.address);
    const accountInfos = await this.rpc.getMultipleAccounts(tokenAccountAddresses, 'jsonParsed');

    const holders: TokenHolder[] = [];

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const info = accountInfos.value[i];

      if (!info) continue;

      const data = info.data as {
        parsed?: {
          info?: {
            owner?: string;
            tokenAmount?: { uiAmount?: number };
          };
        };
      };

      const owner = data?.parsed?.info?.owner;
      const balance = data?.parsed?.info?.tokenAmount?.uiAmount || account.uiAmount;

      if (!owner) continue;

      const percent = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;
      const isLp = this.isLiquidityPool(owner, account.address);

      holders.push({
        address: owner,
        tokenAccount: account.address,
        balance,
        percent,
        isLp,
      });
    }

    return holders;
  }

  private isLiquidityPool(owner: string, tokenAccount: string): boolean {
    if (LP_PROGRAMS.has(owner)) return true;
    if (LP_PREFIXES.some(p => owner.startsWith(p))) return true;
    if (LP_PREFIXES.some(p => tokenAccount.startsWith(p))) return true;
    if (owner.toLowerCase().includes('pool')) return true;
    return false;
  }

  // ============================================
  // LIQUIDITY POOLS
  // ============================================

  async getPools(tokenMint: string): Promise<PoolInfo[]> {
    return findAllPools(this.rpc, tokenMint);
  }

  async findLiquidityPools(tokenMint: string): Promise<LiquidityPool[]> {
    const pools = await this.getPools(tokenMint);
    return pools.map(p => ({
      address: p.address,
      dex: p.dex,
      tokenMint: p.tokenMint,
      quoteMint: p.quoteMint,
      tokenReserve: p.tokenReserve,
      quoteReserve: p.quoteReserve,
      lpMint: p.lpMint,
      lpLocked: p.lpLocked,
      lpLockedPct: p.lpLockedPct,
      createdAt: p.createdAt,
    }));
  }

  // ============================================
  // BUNDLE DETECTION
  // ============================================

  async detectBundles(
    tokenMint: string,
    holders: TokenHolder[],
    tokenAgeHours?: number,
    liquidityUsd?: number,
    marketCapUsd?: number
  ): Promise<BundleAnalysis> {
    const patterns: string[] = [];
    let bundleWallets: string[] = [];
    let sameBlockBuys = 0;

    // Determine if this is an established token (less suspicious for bundle patterns)
    const isEstablishedToken = (
      (tokenAgeHours !== undefined && tokenAgeHours > 168) || // >7 days old
      (liquidityUsd !== undefined && liquidityUsd > 100000) || // >$100K liquidity
      (marketCapUsd !== undefined && marketCapUsd > 1000000) // >$1M market cap
    );

    // For established tokens, use stricter thresholds
    const sameBlockThreshold = isEstablishedToken ? 8 : 3; // Require more same-block txns
    const similarHoldingsMinPct = isEstablishedToken ? 1.0 : 0.1; // Ignore tiny holders for established
    const similarHoldingsMinWallets = isEstablishedToken ? 5 : 3; // Need more wallets to trigger

    console.log(`[OnChain] Bundle detection: established=${isEstablishedToken}, age=${tokenAgeHours?.toFixed(0)}h, liq=$${liquidityUsd?.toFixed(0)}`);

    // 1. Same-block transaction analysis (only for newer tokens or very suspicious patterns)
    // For established tokens, high-volume same-block buys are normal (arbitrage, MEV, etc.)
    if (!isEstablishedToken || (tokenAgeHours !== undefined && tokenAgeHours < 48)) {
      try {
        const recentSigs = await this.rpc.getSignaturesForAddress(tokenMint, { limit: 200 });

        // Group by slot
        const txBySlot = new Map<number, string[]>();
        for (const sig of recentSigs.slice(0, 100)) {
          if (!txBySlot.has(sig.slot)) {
            txBySlot.set(sig.slot, []);
          }
          txBySlot.get(sig.slot)!.push(sig.signature);
        }

        // Find slots with multiple transactions
        for (const [slot, sigs] of txBySlot) {
          if (sigs.length >= sameBlockThreshold) {
            sameBlockBuys += sigs.length;
            patterns.push(`${sigs.length} txns in slot ${slot}`);

            // Get fee payers (buyers)
            const txDetails = await Promise.all(
              sigs.slice(0, 5).map(s => this.rpc.getTransaction(s))
            );

            for (const tx of txDetails) {
              if (!tx) continue;
              const feePayer = tx.transaction.message.accountKeys.find(k => k.signer)?.pubkey;
              if (feePayer && !bundleWallets.includes(feePayer)) {
                bundleWallets.push(feePayer);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[OnChain] Bundle tx analysis error:', err);
      }
    }

    // 2. Similar holdings pattern - only flag if holdings are significant
    const nonLpHolders = holders.filter(h => !h.isLp && h.percent > similarHoldingsMinPct);

    const holdingGroups = new Map<number, string[]>();
    for (const holder of nonLpHolders) {
      // Group by percentage (rounded to 0.1%)
      const rounded = Math.round(holder.percent * 10);
      if (!holdingGroups.has(rounded)) {
        holdingGroups.set(rounded, []);
      }
      holdingGroups.get(rounded)!.push(holder.address);
    }

    for (const [pct, wallets] of holdingGroups) {
      // Only flag if enough wallets have similar holdings AND holdings are meaningful
      if (wallets.length >= similarHoldingsMinWallets && pct / 10 >= similarHoldingsMinPct) {
        // For established tokens, similar small holdings are common (DEX aggregators, etc.)
        if (isEstablishedToken && pct / 10 < 2.0) {
          continue; // Skip small similar holdings for established tokens
        }
        patterns.push(`${wallets.length} wallets with ~${pct / 10}% holdings`);
        for (const w of wallets) {
          if (!bundleWallets.includes(w)) {
            bundleWallets.push(w);
          }
        }
      }
    }

    // 3. Common funder analysis (sample for speed) - only if we have bundle suspects
    if (bundleWallets.length >= 3 && bundleWallets.length <= 10) {
      try {
        const funders = await Promise.all(
          bundleWallets.slice(0, 5).map(w => this.rpc.getFirstFunder(w))
        );

        const funderCounts = new Map<string, number>();
        for (const f of funders) {
          if (f) {
            funderCounts.set(f, (funderCounts.get(f) || 0) + 1);
          }
        }

        for (const [funder, count] of funderCounts) {
          if (count >= 2) {
            patterns.push(`${count} wallets funded by ${funder.slice(0, 8)}...`);
          }
        }
      } catch {
        // Skip on error
      }
    }

    // Determine confidence - higher thresholds for established tokens
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
    const minBundleWallets = isEstablishedToken ? 5 : 3;
    const detected = bundleWallets.length >= minBundleWallets;

    if (isEstablishedToken) {
      // Established tokens need stronger evidence
      if (sameBlockBuys >= 15 && bundleWallets.length >= 8) {
        confidence = 'HIGH';
      } else if (sameBlockBuys >= 10 && bundleWallets.length >= 6) {
        confidence = 'MEDIUM';
      } else if (bundleWallets.length >= 5) {
        confidence = 'LOW';
      }
    } else {
      // New tokens: more sensitive
      if (sameBlockBuys >= 10 && bundleWallets.length >= 5) {
        confidence = 'HIGH';
      } else if (sameBlockBuys >= 5 || bundleWallets.length >= 5) {
        confidence = 'MEDIUM';
      } else if (bundleWallets.length >= 3) {
        confidence = 'LOW';
      }
    }

    // Calculate actual bundle wallet holdings (not total top holders!)
    const bundleHoldings = holders
      .filter(h => bundleWallets.includes(h.address))
      .reduce((sum, h) => sum + h.percent, 0);

    const totalHolders = nonLpHolders.length;
    const txBundlePercent = totalHolders > 0
      ? (bundleWallets.length / totalHolders) * 100
      : 0;

    console.log(`[OnChain] Bundle result: detected=${detected}, count=${bundleWallets.length}, holdings=${bundleHoldings.toFixed(1)}%`);

    return {
      detected,
      confidence,
      count: bundleWallets.length,
      wallets: bundleWallets,
      sameBlockBuys,
      txBundlePercent,
      patterns,
    };
  }

  // ============================================
  // VOLUME ESTIMATION
  // ============================================

  async estimateVolume(
    tokenMint: string,
    tokenPrice?: number
  ): Promise<{ volume24h: number; txns24h: { buys: number; sells: number } }> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const oneDayAgo = now - 24 * 60 * 60;

      const sigs = await this.rpc.getSignaturesForAddress(tokenMint, { limit: 500 });
      const recent = sigs.filter(s => s.blockTime && s.blockTime >= oneDayAgo);

      let buys = 0;
      let sells = 0;
      let volumeTokens = 0;

      // Sample transactions
      const sampled = recent.slice(0, 50);
      for (const sig of sampled) {
        try {
          const tx = await this.rpc.getTransaction(sig.signature);
          if (!tx?.meta) continue;

          const preBalances = tx.meta.preTokenBalances || [];
          const postBalances = tx.meta.postTokenBalances || [];

          for (const post of postBalances) {
            if (post.mint !== tokenMint) continue;

            const pre = preBalances.find(p =>
              p.accountIndex === post.accountIndex && p.mint === post.mint
            );

            const change = post.uiTokenAmount.uiAmount - (pre?.uiTokenAmount.uiAmount || 0);
            if (change > 0) {
              buys++;
              volumeTokens += Math.abs(change);
            } else if (change < 0) {
              sells++;
              volumeTokens += Math.abs(change);
            }
          }
        } catch {
          // Skip individual errors
        }
      }

      // Extrapolate
      const sampleRatio = recent.length / Math.max(sampled.length, 1);
      const estimatedBuys = Math.round(buys * sampleRatio);
      const estimatedSells = Math.round(sells * sampleRatio);
      const estimatedVolumeTokens = volumeTokens * sampleRatio;

      // Convert to USD
      const volume24h = tokenPrice ? estimatedVolumeTokens * tokenPrice : 0;

      return {
        volume24h,
        txns24h: { buys: estimatedBuys, sells: estimatedSells },
      };
    } catch {
      return { volume24h: 0, txns24h: { buys: 0, sells: 0 } };
    }
  }

  // ============================================
  // WASH TRADING DETECTION
  // ============================================

  async detectWashTrading(
    tokenMint: string,
    bundleWallets: string[],
    reportedBuys: number
  ): Promise<{
    detected: boolean;
    bundleBuys: number;
    organicBuys: number;
    washPercent: number;
  }> {
    if (bundleWallets.length === 0) {
      return { detected: false, bundleBuys: 0, organicBuys: reportedBuys, washPercent: 0 };
    }

    const bundleSet = new Set(bundleWallets.map(w => w.toLowerCase()));

    try {
      const sigs = await this.rpc.getSignaturesForAddress(tokenMint, { limit: 100 });

      let bundleBuys = 0;
      let totalBuys = 0;

      for (const sig of sigs.slice(0, 50)) {
        try {
          const tx = await this.rpc.getTransaction(sig.signature);
          if (!tx) continue;

          const feePayer = tx.transaction.message.accountKeys.find(k => k.signer)?.pubkey;
          if (!feePayer) continue;

          const postBalance = tx.meta?.postTokenBalances?.find(b =>
            b.mint === tokenMint && b.owner?.toLowerCase() === feePayer.toLowerCase()
          );

          if (postBalance && postBalance.uiTokenAmount.uiAmount > 0) {
            totalBuys++;
            if (bundleSet.has(feePayer.toLowerCase())) {
              bundleBuys++;
            }
          }
        } catch {
          // Skip
        }
      }

      const organicBuys = totalBuys - bundleBuys;
      const washPercent = totalBuys > 0 ? (bundleBuys / totalBuys) * 100 : 0;

      return {
        detected: washPercent >= 30,
        bundleBuys,
        organicBuys,
        washPercent,
      };
    } catch {
      return { detected: false, bundleBuys: 0, organicBuys: reportedBuys, washPercent: 0 };
    }
  }
}

// Default instance
export const onChainAnalyzer = new OnChainAnalyzer();
