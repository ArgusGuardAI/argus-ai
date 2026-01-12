import { Hono } from 'hono';
import type { Bindings } from '../index';
import { HoneypotAnalysisRequest, HoneypotResult } from '@whaleshield/shared';
import { analyzeForHoneypot } from '../services/together-ai';
import { createSupabaseClient, cacheScanResult } from '../services/supabase';
import { fetchTokenData, buildOnChainContext } from '../services/solana-data';
import { fetchDexScreenerData, buildMarketContext } from '../services/dexscreener';
import { fetchPumpFunData, buildPumpFunContext, isPumpFunToken } from '../services/pumpfun';

const CACHE_TTL_SECONDS = 3600; // 1 hour

// Fetch current SOL price from CoinGecko (cached)
let solPriceCache: { price: number; timestamp: number } | null = null;
const SOL_PRICE_CACHE_TTL = 60000; // 1 minute

async function getSolPrice(): Promise<number> {
  const now = Date.now();

  // Return cached price if fresh
  if (solPriceCache && now - solPriceCache.timestamp < SOL_PRICE_CACHE_TTL) {
    return solPriceCache.price;
  }

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    const data = await response.json() as { solana?: { usd?: number } };
    const price = data.solana?.usd || 150; // Fallback to $150

    solPriceCache = { price, timestamp: now };
    return price;
  } catch (error) {
    console.warn('Failed to fetch SOL price, using fallback:', error);
    return solPriceCache?.price || 150;
  }
}

export const analyzeRoutes = new Hono<{ Bindings: Bindings }>();

analyzeRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<HoneypotAnalysisRequest & { forceRefresh?: boolean }>();

    if (!body.tokenAddress) {
      return c.json({ error: 'tokenAddress is required' }, 400);
    }

    // Check KV cache first (unless force refresh requested)
    const cacheKey = `scan:${body.tokenAddress}`;

    if (!body.forceRefresh) {
      const cached = await c.env.SCAN_CACHE.get(cacheKey, 'json');

      if (cached) {
        return c.json({
          ...(cached as HoneypotResult),
          cached: true,
        });
      }
    }

    // Build combined context for AI
    let combinedContext = '';

    // Check if this is a pump.fun token
    const isPumpFun = isPumpFunToken(body.tokenAddress);

    if (isPumpFun) {
      console.log('Detected pump.fun token, fetching pump.fun data...');

      // Fetch pump.fun data, SOL price, and DexScreener in parallel first
      // We need the bonding curve address BEFORE fetching holder data to mark it as LP
      const [pumpFunResult, solPrice, dexScreenerResult] = await Promise.all([
        fetchPumpFunData(body.tokenAddress),
        getSolPrice(),
        fetchDexScreenerData(body.tokenAddress),
      ]);

      // Add pump.fun specific data first (most accurate for pump.fun tokens)
      if (pumpFunResult) {
        combinedContext += buildPumpFunContext(pumpFunResult, solPrice);

        // Now fetch holder data WITH bonding curve marked as LP
        // This is done after we get pump.fun data so we know the bonding curve address
        const holderData = await fetchTokenData(
          body.tokenAddress,
          c.env.HELIUS_API_KEY,
          [pumpFunResult.bondingCurveAddress] // Mark bonding curve as LP
        ).catch(() => null);

        if (holderData) {
          combinedContext += '\n' + buildOnChainContext(holderData);
        }
      } else {
        // Pump.fun API failed - add context note for AI
        combinedContext += `\nPUMP.FUN TOKEN NOTICE:\n`;
        combinedContext += `- This is a PUMP.FUN token (address ends in 'pump')\n`;
        combinedContext += `- Pump.fun tokens use a BONDING CURVE for liquidity, NOT traditional LP pools\n`;
        combinedContext += `- "No liquidity lock" warnings are NOT applicable - bonding curves work differently\n`;
        combinedContext += `- Pump.fun API data unavailable - using DexScreener data below\n\n`;

        // IMPORTANT: Without confirmed bonding curve address from pump.fun API,
        // we should NOT assume the top holder is the bonding curve.
        // DexScreener pairAddress is NOT reliable for this purpose.
        // Better to have false positives (warning about safe tokens) than miss rugs.
        const holderData = await fetchTokenData(
          body.tokenAddress,
          c.env.HELIUS_API_KEY
          // No knownLpAddresses - be conservative when pump.fun API fails
        ).catch(() => null);

        if (holderData) {
          combinedContext += '\n' + buildOnChainContext(holderData);
        }
      }

      // Add DexScreener data for additional context (price, volume)
      if (dexScreenerResult) {
        combinedContext += '\n' + buildMarketContext(dexScreenerResult);
      }
    } else {
      // Not a pump.fun token - use standard data sources
      const [onChainResult, dexScreenerResult] = await Promise.allSettled([
        fetchTokenData(body.tokenAddress, c.env.HELIUS_API_KEY),
        fetchDexScreenerData(body.tokenAddress),
      ]);

      // Add DexScreener market data first
      if (dexScreenerResult.status === 'fulfilled' && dexScreenerResult.value) {
        combinedContext += buildMarketContext(dexScreenerResult.value);
      }

      // Add on-chain data
      if (onChainResult.status === 'fulfilled') {
        combinedContext += '\n' + buildOnChainContext(onChainResult.value);
      } else {
        console.warn('Failed to fetch on-chain data:', onChainResult.reason);
      }
    }

    // Perform analysis with combined context
    const result = await analyzeForHoneypot(
      {
        tokenAddress: body.tokenAddress,
        onChainContext: combinedContext,
      },
      {
        apiKey: c.env.TOGETHER_AI_API_KEY,
        model: c.env.TOGETHER_AI_MODEL,
      }
    );

    // Cache in KV
    await c.env.SCAN_CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    // Also cache in Supabase for persistence
    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
    await cacheScanResult(supabase, result);

    return c.json({
      ...result,
      cached: false,
    });
  } catch (error) {
    console.error('Analyze error:', error);
    return c.json(
      {
        error: 'Analysis failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Get cached result without triggering new analysis
analyzeRoutes.get('/:tokenAddress', async (c) => {
  const tokenAddress = c.req.param('tokenAddress');

  const cacheKey = `scan:${tokenAddress}`;
  const cached = await c.env.SCAN_CACHE.get(cacheKey, 'json');

  if (cached) {
    return c.json({
      ...(cached as HoneypotResult),
      cached: true,
    });
  }

  return c.json({ error: 'No cached result found' }, 404);
});
