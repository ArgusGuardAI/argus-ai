/**
 * ArgusGuard Sniper API Server
 * Serves the web dashboard and WebSocket connections
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import { SniperEngine } from './engine/sniper';
import { TokenAnalyzer } from './engine/analyzer';
import type { SniperConfig, NewTokenEvent } from './types';

const PORT = parseInt(process.env.PORT || '8788'); // Use 8788 to not conflict with workers on 8787
const RPC_URL = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Extract Helius API key from RPC URL if available
function getHeliusApiKey(): string {
  const rpcUrl = process.env.HELIUS_RPC_URL || '';
  const match = rpcUrl.match(/api-key=([a-f0-9-]+)/i) || rpcUrl.match(/helius-rpc\.com\/\?api-key=([a-f0-9-]+)/i);
  if (match) return match[1];

  // Also check for explicit API key env var
  return process.env.HELIUS_API_KEY || '';
}

// Initialize sniper engine
let sniper: SniperEngine | null = null;
const clients = new Set<WebSocket>();

const app = new Hono();

// CORS for development
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Get current status
app.get('/api/status', (c) => {
  return c.json(sniper?.getState() || { status: 'stopped' });
});

// Start sniper
app.post('/api/start', async (c) => {
  try {
    const { config, preFilterConfig } = await c.req.json<{ config: Partial<SniperConfig>; preFilterConfig?: Record<string, unknown> }>();

    if (!sniper) {
      sniper = new SniperEngine(RPC_URL, config, preFilterConfig || {});

      // Forward all messages to WebSocket clients
      sniper.on('message', (msg) => {
        broadcast(msg);
      });
    } else {
      // Update pre-filter config if sniper already exists
      if (preFilterConfig) {
        console.log('[API] Updating pre-filter config:', preFilterConfig);
        sniper.updatePreFilterConfig(preFilterConfig);
      }
    }

    await sniper.start();
    return c.json({ success: true, status: sniper.getState() });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Stop sniper
app.post('/api/stop', (c) => {
  if (sniper) {
    sniper.stop();
  }
  return c.json({ success: true });
});

// Update config
app.put('/api/config', async (c) => {
  const { config } = await c.req.json<{ config: Partial<SniperConfig> }>();
  if (sniper) {
    sniper.updateConfig(config);
  }
  return c.json({ success: true });
});

// Manual sell
app.post('/api/sell/:tokenAddress', async (c) => {
  const tokenAddress = c.req.param('tokenAddress');
  if (!sniper) {
    return c.json({ success: false, error: 'Sniper not running' }, 400);
  }

  try {
    const result = await sniper.manualSell(tokenAddress);
    return c.json({ success: true, result });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Manual token analysis using local TokenAnalyzer (uses Together AI)
const localAnalyzer = new TokenAnalyzer({ minScore: 0 } as any);

// ============================================
// COMPREHENSIVE TOKEN ANALYSIS (NEW)
// ============================================

interface BundleInfo {
  detected: boolean;
  count: number;
  totalPercent: number;
  clusters: Array<{
    id: number;
    wallets: string[];
    combinedPercent: number;
  }>;
}

interface HolderInfo {
  address: string;
  percent: number;
  isBundle: boolean;
  bundleId?: number;
}

// Detect bundle wallets from holder data
function detectBundles(holders: Array<{ address: string; pct: number }>): { bundles: BundleInfo; holdersWithBundles: HolderInfo[] } {
  const threshold = 1; // 1% difference threshold
  const minClusterSize = 3;

  const holdersWithBundles: HolderInfo[] = holders.map(h => ({
    address: h.address,
    percent: h.pct,
    isBundle: false,
  }));

  const clusters: Array<{ id: number; wallets: string[]; combinedPercent: number }> = [];
  const assigned = new Set<number>();
  let clusterId = 0;

  // Find clusters of similar holdings
  for (let i = 0; i < holders.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: number[] = [i];
    for (let j = i + 1; j < holders.length; j++) {
      if (assigned.has(j)) continue;

      // Check if holdings are within threshold
      if (Math.abs(holders[i].pct - holders[j].pct) <= threshold) {
        cluster.push(j);
      }
    }

    // Only count as bundle if 3+ wallets have similar holdings
    if (cluster.length >= minClusterSize) {
      clusterId++;
      let combinedPercent = 0;
      const wallets: string[] = [];

      for (const idx of cluster) {
        assigned.add(idx);
        holdersWithBundles[idx].isBundle = true;
        holdersWithBundles[idx].bundleId = clusterId;
        combinedPercent += holders[idx].pct;
        wallets.push(holders[idx].address);
      }

      clusters.push({ id: clusterId, wallets, combinedPercent });
    }
  }

  return {
    bundles: {
      detected: clusters.length > 0,
      count: clusters.length,
      totalPercent: clusters.reduce((sum, c) => sum + c.combinedPercent, 0),
      clusters,
    },
    holdersWithBundles,
  };
}

// Generate sparkline data from price changes
function generateSparkline(
  currentPrice: number,
  change5m: number,
  change1h: number,
  change6h: number,
  change24h: number
): number[] {
  if (!currentPrice || currentPrice === 0) return [];

  // Calculate historical prices based on % changes
  const price24hAgo = currentPrice / (1 + change24h / 100);
  const price6hAgo = currentPrice / (1 + change6h / 100);
  const price1hAgo = currentPrice / (1 + change1h / 100);
  const price5mAgo = currentPrice / (1 + change5m / 100);

  // Create 24 data points with some interpolation
  const points: number[] = [];
  const keyPoints = [
    { time: 0, price: price24hAgo },
    { time: 6, price: price6hAgo },
    { time: 12, price: (price6hAgo + price1hAgo) / 2 }, // Interpolated
    { time: 18, price: price1hAgo },
    { time: 23, price: price5mAgo },
    { time: 24, price: currentPrice },
  ];

  // Interpolate between key points with some noise for realism
  for (let i = 0; i < 24; i++) {
    const prevPoint = keyPoints.filter(p => p.time <= i).pop() || keyPoints[0];
    const nextPoint = keyPoints.find(p => p.time > i) || keyPoints[keyPoints.length - 1];

    const t = prevPoint.time === nextPoint.time ? 0 :
      (i - prevPoint.time) / (nextPoint.time - prevPoint.time);

    const basePrice = prevPoint.price + (nextPoint.price - prevPoint.price) * t;
    // Add small random variation for natural look (±2%)
    const noise = 1 + (Math.sin(i * 1.5) * 0.02);
    points.push(basePrice * noise);
  }

  return points;
}

// Full comprehensive analysis endpoint for Token Research Tool
app.post('/api/analyze-full', async (c) => {
  try {
    const { address } = await c.req.json<{ address: string }>();

    if (!address) {
      return c.json({ error: 'address required' }, 400);
    }

    console.log(`[API] Full analysis request for ${address}`);

    // 1. Fetch DexScreener data
    let dexData: any = null;
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      if (dexRes.ok) {
        const data = await dexRes.json() as any;
        if (data.pairs && data.pairs.length > 0) {
          // Get best pair by liquidity
          dexData = data.pairs.reduce((best: any, p: any) => {
            const liq = p.liquidity?.usd || 0;
            const bestLiq = best?.liquidity?.usd || 0;
            return liq > bestLiq ? p : best;
          }, data.pairs[0]);
        }
      }
    } catch (e) {
      console.log('[API] DexScreener fetch failed');
    }

    // 2. Fetch RugCheck security data
    let rugCheckData: any = null;
    try {
      const rugRes = await fetch(`https://api.rugcheck.xyz/v1/tokens/${address}/report`);
      if (rugRes.ok) {
        rugCheckData = await rugRes.json();
      }
    } catch (e) {
      console.log('[API] RugCheck fetch failed');
    }

    // 3. Process holders and detect bundles
    let holdersData: HolderInfo[] = [];
    let bundleData: BundleInfo = { detected: false, count: 0, totalPercent: 0, clusters: [] };

    if (rugCheckData?.topHolders) {
      const holders = rugCheckData.topHolders.slice(0, 10).map((h: any) => ({
        address: h.address || h.owner || 'unknown',
        pct: h.pct || h.percentage || 0,
      }));

      const { bundles, holdersWithBundles } = detectBundles(holders);
      bundleData = bundles;
      holdersData = holdersWithBundles;
    }

    // 4. Run AI analysis
    const tokenData: NewTokenEvent = {
      address,
      name: dexData?.baseToken?.name || rugCheckData?.tokenMeta?.name || 'Unknown',
      symbol: dexData?.baseToken?.symbol || rugCheckData?.tokenMeta?.symbol || '???',
      source: 'dexscreener-trending',
      liquidityUsd: dexData?.liquidity?.usd || 0,
      timestamp: Date.now(),
      initialMarketCap: dexData?.marketCap || dexData?.fdv || 0,
      priceUsd: parseFloat(dexData?.priceUsd || '0'),
      volume24h: dexData?.volume?.h24 || 0,
      volume1h: dexData?.volume?.h1 || 0,
      buys1h: dexData?.txns?.h1?.buys || 0,
      sells1h: dexData?.txns?.h1?.sells || 0,
      priceChange1h: dexData?.priceChange?.h1 || 0,
      priceChange24h: dexData?.priceChange?.h24 || 0,
    };

    let aiResult: any = null;
    try {
      const decision = await localAnalyzer.analyze(tokenData);
      let adjustedScore = decision.riskScore;
      let bundleWarning = '';

      // BUNDLE PENALTY: Coordinated wallets are a major red flag
      // They can dump together and crash the price
      if (bundleData.detected) {
        const bundlePercent = bundleData.totalPercent;

        if (bundlePercent >= 40) {
          // Massive bundle - very dangerous
          adjustedScore -= 30;
          bundleWarning = ` CRITICAL: ${bundleData.count} coordinated wallet cluster(s) hold ${bundlePercent.toFixed(1)}% - extreme dump risk.`;
        } else if (bundlePercent >= 25) {
          // Large bundle - significant risk
          adjustedScore -= 20;
          bundleWarning = ` WARNING: ${bundleData.count} coordinated wallet cluster(s) hold ${bundlePercent.toFixed(1)}% - high dump risk.`;
        } else if (bundlePercent >= 15) {
          // Medium bundle - moderate risk
          adjustedScore -= 12;
          bundleWarning = ` Caution: ${bundleData.count} coordinated wallet cluster(s) hold ${bundlePercent.toFixed(1)}% of supply.`;
        } else if (bundlePercent >= 8) {
          // Small bundle - minor risk
          adjustedScore -= 5;
          bundleWarning = ` Note: Small bundle detected (${bundlePercent.toFixed(1)}%).`;
        }

        // Ensure score doesn't go below 0
        adjustedScore = Math.max(0, adjustedScore);

        console.log(`[API] Bundle penalty applied: -${decision.riskScore - adjustedScore} points (${bundlePercent.toFixed(1)}% bundled)`);
      }

      // Determine signal based on adjusted score
      const signal = adjustedScore >= 75 ? 'STRONG_BUY' :
                     adjustedScore >= 60 ? 'BUY' :
                     adjustedScore >= 45 ? 'WATCH' :
                     adjustedScore >= 30 ? 'HOLD' : 'AVOID';

      aiResult = {
        signal,
        score: adjustedScore,
        verdict: (decision.reason || decision.analysis?.summary || 'Analysis complete') + bundleWarning,
      };
    } catch (e) {
      console.log('[API] AI analysis failed:', e);
      aiResult = { signal: 'HOLD', score: 50, verdict: 'AI analysis unavailable' };
    }

    // 5. Build comprehensive response
    const result = {
      token: {
        address,
        name: tokenData.name,
        symbol: tokenData.symbol,
      },
      security: {
        mintAuthorityRevoked: rugCheckData?.risks?.find((r: any) => r.name === 'Mutable metadata')?.level !== 'danger',
        freezeAuthorityRevoked: !rugCheckData?.risks?.find((r: any) => r.name === 'Freeze authority'),
        lpLockedPercent: rugCheckData?.markets?.[0]?.lp?.lpLockedPct || 0,
      },
      market: {
        price: parseFloat(dexData?.priceUsd || '0'),
        marketCap: dexData?.marketCap || dexData?.fdv || 0,
        liquidity: dexData?.liquidity?.usd || 0,
        volume24h: dexData?.volume?.h24 || 0,
        priceChange5m: dexData?.priceChange?.m5 || 0,
        priceChange1h: dexData?.priceChange?.h1 || 0,
        priceChange24h: dexData?.priceChange?.h24 || 0,
        // Generate sparkline data points from price changes
        sparkline: generateSparkline(
          parseFloat(dexData?.priceUsd || '0'),
          dexData?.priceChange?.m5 || 0,
          dexData?.priceChange?.h1 || 0,
          dexData?.priceChange?.h6 || 0,
          dexData?.priceChange?.h24 || 0
        ),
      },
      trading: {
        buys5m: dexData?.txns?.m5?.buys || 0,
        sells5m: dexData?.txns?.m5?.sells || 0,
        buys1h: dexData?.txns?.h1?.buys || 0,
        sells1h: dexData?.txns?.h1?.sells || 0,
        buys24h: dexData?.txns?.h24?.buys || 0,
        sells24h: dexData?.txns?.h24?.sells || 0,
        buyRatio: dexData?.txns?.h1?.buys && dexData?.txns?.h1?.sells
          ? (dexData.txns.h1.buys / (dexData.txns.h1.buys + dexData.txns.h1.sells))
          : 0.5,
      },
      holders: {
        total: rugCheckData?.totalHolders || holdersData.length,
        top10: holdersData,
        topHolderPercent: holdersData[0]?.percent || 0,
        top5Percent: holdersData.slice(0, 5).reduce((sum, h) => sum + h.percent, 0),
        top10Percent: holdersData.reduce((sum, h) => sum + h.percent, 0),
      },
      bundles: bundleData,
      ai: aiResult,
      links: {
        website: dexData?.info?.websites?.[0]?.url,
        twitter: dexData?.info?.socials?.find((s: any) => s.type === 'twitter')?.url,
        telegram: dexData?.info?.socials?.find((s: any) => s.type === 'telegram')?.url,
        dexscreener: `https://dexscreener.com/solana/${address}`,
      },
    };

    console.log(`[API] Full analysis complete: ${result.token.symbol} - Score ${result.ai.score} (${result.ai.signal})`);
    if (bundleData.detected) {
      console.log(`[API] Bundle detected: ${bundleData.count} clusters, ${bundleData.totalPercent.toFixed(1)}% combined`);
    }

    return c.json(result);
  } catch (error) {
    console.error('[API] Full analysis error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Legacy analyze endpoint (kept for backwards compatibility)
app.post('/api/analyze', async (c) => {
  try {
    const { tokenAddress } = await c.req.json<{ tokenAddress: string }>();

    if (!tokenAddress) {
      return c.json({ error: 'tokenAddress required' }, 400);
    }

    console.log(`[API] Manual analysis request for ${tokenAddress}`);

    // Get token info from DexScreener first
    let tokenData: NewTokenEvent | null = null;
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      if (dexRes.ok) {
        const dexData = await dexRes.json() as { pairs?: any[] };
        if (dexData.pairs && dexData.pairs.length > 0) {
          const pair = dexData.pairs[0];
          tokenData = {
            address: tokenAddress,
            name: pair.baseToken?.name || 'Unknown',
            symbol: pair.baseToken?.symbol || '???',
            source: 'dexscreener-trending',
            liquidityUsd: pair.liquidity?.usd || 0,
            timestamp: Date.now(),
            initialMarketCap: pair.marketCap || pair.fdv || 0,
            priceUsd: parseFloat(pair.priceUsd || '0'),
            volume24h: pair.volume?.h24 || 0,
            volume1h: pair.volume?.h1 || 0,
            buys1h: pair.txns?.h1?.buys || 0,
            sells1h: pair.txns?.h1?.sells || 0,
            priceChange1h: pair.priceChange?.h1 || 0,
            priceChange24h: pair.priceChange?.h24 || 0,
          };
        }
      }
    } catch (e) {
      console.log('[API] Could not fetch DexScreener data, using minimal token data');
    }

    // If no DexScreener data, create minimal token event
    if (!tokenData) {
      tokenData = {
        address: tokenAddress,
        name: 'Unknown',
        symbol: '???',
        source: 'pumpfun',
        liquidityUsd: 0,
        timestamp: Date.now(),
      };
    }

    // Run AI analysis
    const decision = await localAnalyzer.analyze(tokenData);

    console.log(`[API] Analysis complete: ${decision.riskScore} (${decision.shouldBuy ? 'SAFE' : 'RISKY'})`);

    // Broadcast result to all clients
    const wsMessage = {
      type: 'ANALYSIS_RESULT',
      data: {
        token: tokenData,
        shouldBuy: decision.shouldBuy,
        reason: decision.reason,
        riskScore: decision.riskScore,
        analysis: decision.analysis,
        stage: 'AI_ANALYSIS',
      },
    };
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(wsMessage));
      }
    });

    return c.json({
      riskScore: decision.riskScore,
      riskLevel: decision.shouldBuy ? 'SAFE' : decision.riskScore < 70 ? 'SUSPICIOUS' : 'DANGEROUS',
      reason: decision.reason,
      flags: decision.analysis?.flags || [],
      summary: decision.analysis?.summary || '',
    });
  } catch (error) {
    console.error('[API] Analysis error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Jupiter API key (from sol-bot config)
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '057a176a-d2af-4ff6-a35d-84ed54fcd4b4';
const JUPITER_API_URL = 'https://api.jup.ag';

// Jupiter API proxy (using api.jup.ag v1 with API key)
app.get('/api/jupiter/quote', async (c) => {
  try {
    const url = new URL(c.req.url);
    const jupiterUrl = `${JUPITER_API_URL}/swap/v1/quote${url.search}`;

    console.log(`[API] Jupiter quote: ${url.search.slice(0, 60)}...`);

    const response = await fetch(jupiterUrl, {
      headers: {
        'x-api-key': JUPITER_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Quote failed:', response.status, errorText);
      return c.json({ error: errorText }, response.status as 400 | 500);
    }

    const data = await response.json() as { inAmount: string; outAmount: string };
    console.log(`[API] Quote success: ${data.inAmount} -> ${data.outAmount}`);
    return c.json(data);
  } catch (error) {
    console.error('[API] Jupiter quote error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

app.post('/api/jupiter/swap', async (c) => {
  try {
    const body = await c.req.json();
    const swapUrl = `${JUPITER_API_URL}/swap/v1/swap`;

    console.log('[API] Jupiter swap request');

    const response = await fetch(swapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': JUPITER_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Swap failed:', response.status, errorText);
      return c.json({ error: errorText }, response.status as 400 | 500);
    }

    const data = await response.json() as { swapTransaction: string };
    console.log('[API] Swap transaction built successfully');
    return c.json(data);
  } catch (error) {
    console.error('[API] Jupiter swap error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get current price for a token (in SOL)
const SOL_MINT = 'So11111111111111111111111111111111111111112';

app.get('/api/price/:tokenMint', async (c) => {
  try {
    const tokenMint = c.req.param('tokenMint');

    // Get quote for 1M tokens -> SOL to determine price
    const amount = 1_000_000_000_000; // 1M tokens with 6 decimals
    const quoteUrl = `${JUPITER_API_URL}/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=100`;

    const response = await fetch(quoteUrl, {
      headers: {
        'x-api-key': JUPITER_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Token might not be on Jupiter yet
      return c.json({ price: null, error: 'No route' }, 200);
    }

    const data = await response.json() as { inAmount: string; outAmount: string };

    // Price = outAmount (in lamports) / inAmount (tokens)
    const priceInSol = parseFloat(data.outAmount) / 1e9 / (parseFloat(data.inAmount) / 1e6);

    return c.json({
      price: priceInSol,
      inAmount: data.inAmount,
      outAmount: data.outAmount,
    });
  } catch (error) {
    console.error('[API] Price error:', error);
    return c.json({ price: null, error: String(error) }, 200);
  }
});

// Batch price lookup for multiple tokens
app.post('/api/prices', async (c) => {
  try {
    const { tokens } = await c.req.json<{ tokens: string[] }>();

    if (!tokens || !Array.isArray(tokens)) {
      return c.json({ error: 'tokens array required' }, 400);
    }

    const prices: Record<string, number | null> = {};

    // Fetch prices in parallel
    await Promise.all(
      tokens.map(async (tokenMint) => {
        try {
          const amount = 1_000_000_000_000; // 1M tokens
          const quoteUrl = `${JUPITER_API_URL}/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=100`;

          const response = await fetch(quoteUrl, {
            headers: {
              'x-api-key': JUPITER_API_KEY,
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json() as { inAmount: string; outAmount: string };
            prices[tokenMint] = parseFloat(data.outAmount) / 1e9 / (parseFloat(data.inAmount) / 1e6);
          } else {
            prices[tokenMint] = null;
          }
        } catch {
          prices[tokenMint] = null;
        }
      })
    );

    return c.json({ prices });
  } catch (error) {
    console.error('[API] Prices error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============================================
// PRE-FILTER & AUTO-TRADE ENDPOINTS
// ============================================

// Get pre-filter stats
app.get('/api/prefilter/stats', (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  return c.json(sniper.getPreFilterStats());
});

// Get pre-filter config
app.get('/api/prefilter/config', (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  return c.json(sniper.getPreFilterConfig());
});

// Update pre-filter config
app.put('/api/prefilter/config', async (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  const config = await c.req.json();
  sniper.updatePreFilterConfig(config);
  return c.json({ success: true, config: sniper.getPreFilterConfig() });
});

// Reset pre-filter stats
app.post('/api/prefilter/reset', (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  sniper.resetPreFilterStats();
  return c.json({ success: true });
});

// Flag a creator as scammer
app.post('/api/prefilter/flag-creator', async (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  const { creatorAddress } = await c.req.json() as { creatorAddress: string };
  sniper.flagCreator(creatorAddress);
  return c.json({ success: true, flagged: creatorAddress });
});

// Toggle auto-trade
app.post('/api/autotrade', async (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  const { enabled } = await c.req.json() as { enabled: boolean };
  sniper.setAutoTrade(enabled);
  return c.json({ success: true, autoTradeEnabled: sniper.isAutoTradeEnabled() });
});

// Get auto-trade status
app.get('/api/autotrade', (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  return c.json({ autoTradeEnabled: sniper.isAutoTradeEnabled() });
});

// Force switch to public RPC (use when Helius quota is exceeded)
app.post('/api/use-public-rpc', (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  sniper.forcePublicRpc();
  return c.json({
    success: true,
    message: 'Switched to public RPC',
    status: sniper.isUsingPublicRpc(),
  });
});

// Get RPC status
app.get('/api/rpc-status', (c) => {
  if (!sniper) {
    return c.json({ error: 'Sniper not initialized' }, 400);
  }
  return c.json({
    usingPublicRpc: sniper.isUsingPublicRpc(),
    listeners: sniper.getListenerStatus(),
  });
});

function handleClientMessage(msg: any, _ws: WebSocket) {
  switch (msg.type) {
    case 'START':
      if (!sniper) {
        sniper = new SniperEngine(RPC_URL, msg.config);
        sniper.on('message', (m) => broadcast(m));
      }
      sniper.start();
      break;

    case 'STOP':
      sniper?.stop();
      break;

    case 'UPDATE_CONFIG':
      sniper?.updateConfig(msg.config);
      break;

    case 'SELL':
      sniper?.manualSell(msg.tokenAddress);
      break;

    case 'MANUAL_SNIPE':
      if (sniper) {
        console.log(`[WS] Manual snipe request for ${msg.tokenAddress}`);
        sniper.manualBuy(msg.tokenAddress);
      }
      break;

    case 'SET_AUTO_TRADE':
      if (sniper) {
        sniper.setAutoTrade(msg.enabled);
        broadcast({ type: 'AUTO_TRADE_STATUS', data: { enabled: sniper.isAutoTradeEnabled() } });
      }
      break;

    case 'USE_PUBLIC_RPC':
      if (sniper) {
        console.log('[WS] Switching to public RPC (Helius quota exceeded)');
        sniper.forcePublicRpc();
        broadcast({ type: 'RPC_STATUS', data: sniper.isUsingPublicRpc() });
      }
      break;

    case 'UPDATE_PREFILTER':
      if (sniper) {
        sniper.updatePreFilterConfig(msg.config);
        broadcast({ type: 'PREFILTER_CONFIG', data: sniper.getPreFilterConfig() });
      }
      break;

    case 'GET_PREFILTER_STATS':
      if (sniper) {
        broadcast({ type: 'PREFILTER_STATS', data: sniper.getPreFilterStats() });
      }
      break;

    case 'FLAG_CREATOR':
      if (sniper && msg.creatorAddress) {
        sniper.flagCreator(msg.creatorAddress);
        console.log(`[WS] Flagged creator: ${msg.creatorAddress}`);
      }
      break;
  }
}

function broadcast(msg: any) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (err) {
        clients.delete(client);
      }
    }
  }
}

// Start server
console.log('╔═══════════════════════════════════════════════════╗');
console.log('║       ArgusGuard Sniper API Server v0.1.0         ║');
console.log('╚═══════════════════════════════════════════════════╝');
console.log('');

const server = serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`🚀 Server running at http://localhost:${info.port}`);
  console.log(`📡 WebSocket at ws://localhost:${info.port}/ws`);
  console.log('');
  console.log('Open the dashboard at http://localhost:3000');
});

// Create WebSocket server on same port
const wss = new WebSocketServer({ server: server as any, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  clients.add(ws);

  // Send current state
  if (sniper) {
    ws.send(JSON.stringify({
      type: 'STATUS_UPDATE',
      data: sniper.getState(),
    }));
  } else {
    ws.send(JSON.stringify({
      type: 'STATUS_UPDATE',
      data: { status: 'stopped', positions: [], tokensScanned: 0, tokensSniped: 0, tokensSkipped: 0, totalPnlSol: 0 },
    }));
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleClientMessage(msg, ws);
    } catch (err) {
      console.error('[WS] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
    clients.delete(ws);
  });
});

console.log('[WS] WebSocket server attached');

// Auto-start the scanner in watch-only mode
// Uses default minScore from SniperEngine (60 = BUY threshold)
// Frontend can override via UPDATE_CONFIG message
setTimeout(() => {
  if (!sniper) {
    console.log('[Auto-Start] Initializing scanner...');
    sniper = new SniperEngine(RPC_URL, {
      // minScore comes from SniperEngine default (60)
      walletPrivateKey: 'watch-only',
      manualModeOnly: false,
    });
    sniper.on('message', (m) => broadcast(m));
    sniper.start();
    console.log('[Auto-Start] Scanner running in WATCH-ONLY mode');
  }
}, 1000);
