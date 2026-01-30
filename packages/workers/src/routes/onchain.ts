/**
 * On-Chain Analysis Routes
 *
 * Pure on-chain token analysis - no external APIs.
 * Uses only Solana RPC calls for all data.
 *
 * Endpoints:
 * - GET /onchain/analyze/:token - Analyze a token using on-chain data
 * - GET /onchain/holders/:token - Get top holders from chain
 * - GET /onchain/pools/:token - Find liquidity pools
 * - GET /onchain/bundle/:token - Detect coordinated wallets
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import { OnChainAnalyzer } from '../services/onchain-analyzer';
import { DataProvider, createDataProvider } from '../services/data-provider';

const onchainRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Helper to get RPC endpoint
 */
function getRpcEndpoint(env: Bindings): string {
  if (env.SOLANA_RPC_URL) {
    return env.SOLANA_RPC_URL;
  }
  if (env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  }
  return 'https://api.mainnet-beta.solana.com';
}

/**
 * Full on-chain token analysis
 */
onchainRoutes.get('/analyze/:token', async (c) => {
  const tokenAddress = c.req.param('token');

  if (!tokenAddress || tokenAddress.length < 32) {
    return c.json({ error: 'Invalid token address' }, 400);
  }

  console.log(`[OnChain] Analyzing ${tokenAddress.slice(0, 8)}...`);
  const start = Date.now();

  try {
    const rpcEndpoint = getRpcEndpoint(c.env);
    const analyzer = new OnChainAnalyzer(rpcEndpoint);

    // Set SOL price (TODO: fetch from oracle)
    analyzer.setSolPrice(200);

    const analysis = await analyzer.analyze(tokenAddress);

    const duration = Date.now() - start;
    console.log(`[OnChain] Analysis complete in ${duration}ms`);

    return c.json({
      success: true,
      tokenAddress,
      analysis: {
        // Token info
        name: analysis.metadata.name,
        symbol: analysis.metadata.symbol,
        decimals: analysis.metadata.decimals,
        supply: analysis.metadata.supply,

        // Security
        mintAuthority: analysis.metadata.mintAuthority,
        freezeAuthority: analysis.metadata.freezeAuthority,
        updateAuthority: analysis.metadata.updateAuthority,

        // Market data
        price: analysis.price,
        marketCap: analysis.marketCap,
        liquidity: analysis.totalLiquidity,
        volume24h: analysis.volume24h,
        txns24h: analysis.txns24h,
        ageHours: analysis.ageHours,

        // Holders (summary)
        holderCount: analysis.holders.length,
        top5Holders: analysis.holders.slice(0, 5).map(h => ({
          address: h.address,
          percent: h.percent,
          isLp: h.isLp,
        })),

        // Pools
        pools: analysis.pools.map(p => ({
          address: p.address,
          dex: p.dex,
          tokenReserve: p.tokenReserve,
          quoteReserve: p.quoteReserve,
          lpLocked: p.lpLocked,
          lpLockedPct: p.lpLockedPct,
        })),

        // Creator
        creatorAddress: analysis.creatorAddress,
        creatorHoldings: analysis.creatorHoldings,

        // Bundle detection
        bundle: {
          detected: analysis.bundle.detected,
          confidence: analysis.bundle.confidence,
          count: analysis.bundle.count,
          patterns: analysis.bundle.patterns,
        },
      },
      dataSource: 'ON_CHAIN',
      duration,
    });
  } catch (error) {
    console.error('[OnChain] Analysis error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Analysis failed',
      tokenAddress,
    }, 500);
  }
});

/**
 * Get top token holders
 */
onchainRoutes.get('/holders/:token', async (c) => {
  const tokenAddress = c.req.param('token');
  const limit = parseInt(c.req.query('limit') || '20');

  if (!tokenAddress || tokenAddress.length < 32) {
    return c.json({ error: 'Invalid token address' }, 400);
  }

  try {
    const rpcEndpoint = getRpcEndpoint(c.env);
    const analyzer = new OnChainAnalyzer(rpcEndpoint);

    const holders = await analyzer.getTopHolders(tokenAddress, Math.min(limit, 50));

    return c.json({
      success: true,
      tokenAddress,
      holderCount: holders.length,
      holders: holders.map(h => ({
        address: h.address,
        tokenAccount: h.tokenAccount,
        balance: h.balance,
        percent: h.percent,
        isLp: h.isLp,
      })),
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to fetch holders',
    }, 500);
  }
});

/**
 * Find liquidity pools
 */
onchainRoutes.get('/pools/:token', async (c) => {
  const tokenAddress = c.req.param('token');

  if (!tokenAddress || tokenAddress.length < 32) {
    return c.json({ error: 'Invalid token address' }, 400);
  }

  try {
    const rpcEndpoint = getRpcEndpoint(c.env);
    const analyzer = new OnChainAnalyzer(rpcEndpoint);

    const pools = await analyzer.findLiquidityPools(tokenAddress);

    return c.json({
      success: true,
      tokenAddress,
      poolCount: pools.length,
      pools: pools.map(p => ({
        address: p.address,
        dex: p.dex,
        tokenReserve: p.tokenReserve,
        quoteReserve: p.quoteReserve,
        lpMint: p.lpMint,
        lpLocked: p.lpLocked,
        lpLockedPct: p.lpLockedPct,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to find pools',
    }, 500);
  }
});

/**
 * Detect bundle wallets
 */
onchainRoutes.get('/bundle/:token', async (c) => {
  const tokenAddress = c.req.param('token');

  if (!tokenAddress || tokenAddress.length < 32) {
    return c.json({ error: 'Invalid token address' }, 400);
  }

  try {
    const rpcEndpoint = getRpcEndpoint(c.env);
    const analyzer = new OnChainAnalyzer(rpcEndpoint);

    // First get holders
    const holders = await analyzer.getTopHolders(tokenAddress, 25);

    // Then detect bundles
    const bundle = await analyzer.detectBundles(tokenAddress, holders);

    return c.json({
      success: true,
      tokenAddress,
      bundle: {
        detected: bundle.detected,
        confidence: bundle.confidence,
        count: bundle.count,
        wallets: bundle.wallets,
        sameBlockBuys: bundle.sameBlockBuys,
        txBundlePercent: bundle.txBundlePercent,
        patterns: bundle.patterns,
      },
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Bundle detection failed',
    }, 500);
  }
});

/**
 * Compare on-chain vs hybrid data
 * Useful for validating the on-chain approach
 */
onchainRoutes.get('/compare/:token', async (c) => {
  const tokenAddress = c.req.param('token');

  if (!tokenAddress || tokenAddress.length < 32) {
    return c.json({ error: 'Invalid token address' }, 400);
  }

  const start = Date.now();

  try {
    // Create both providers
    const onChainProvider = new DataProvider('ON_CHAIN', getRpcEndpoint(c.env));
    const hybridProvider = createDataProvider(c.env);

    // Fetch in parallel
    const [onChainData, hybridData] = await Promise.all([
      onChainProvider.getTokenData(tokenAddress).catch(e => ({ error: e.message })),
      hybridProvider.getTokenData(tokenAddress).catch(e => ({ error: e.message })),
    ]);

    const duration = Date.now() - start;

    return c.json({
      success: true,
      tokenAddress,
      comparison: {
        onChain: onChainData,
        hybrid: hybridData,
        differences: 'error' in onChainData || 'error' in hybridData ? null : {
          priceDiff: Math.abs((onChainData.price || 0) - (hybridData.price || 0)),
          liquidityDiff: Math.abs((onChainData.liquidity || 0) - (hybridData.liquidity || 0)),
          holderCountDiff: onChainData.holderCount - hybridData.holderCount,
          bundleMatch: onChainData.bundle.detected === hybridData.bundle.detected,
        },
      },
      duration,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Comparison failed',
    }, 500);
  }
});

/**
 * Token metadata only
 */
onchainRoutes.get('/metadata/:token', async (c) => {
  const tokenAddress = c.req.param('token');

  if (!tokenAddress || tokenAddress.length < 32) {
    return c.json({ error: 'Invalid token address' }, 400);
  }

  try {
    const rpcEndpoint = getRpcEndpoint(c.env);
    const analyzer = new OnChainAnalyzer(rpcEndpoint);

    const metadata = await analyzer.getTokenMetadata(tokenAddress);

    return c.json({
      success: true,
      tokenAddress,
      metadata: {
        mint: metadata.mint,
        name: metadata.name,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
        supply: metadata.supply,
        mintAuthority: metadata.mintAuthority,
        freezeAuthority: metadata.freezeAuthority,
        updateAuthority: metadata.updateAuthority,
      },
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to fetch metadata',
    }, 500);
  }
});

export { onchainRoutes };
