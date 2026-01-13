import { Hono } from 'hono';
import type { Bindings } from '../index';
import { HoneypotAnalysisRequest, HoneypotResult, HoneypotFlag, HoneypotRiskLevel } from '@whaleshield/shared';
import { analyzeForHoneypot } from '../services/together-ai';
import { createSupabaseClient, cacheScanResult } from '../services/supabase';
import { fetchTokenData, buildOnChainContext } from '../services/solana-data';
import { fetchDexScreenerData, buildMarketContext, DexScreenerData } from '../services/dexscreener';
import { fetchPumpFunData, buildPumpFunContext, isPumpFunToken } from '../services/pumpfun';

/**
 * Apply hardcoded minimum score rules for critical red flags
 * Only applies to DEX tokens (not pump.fun bonding curve tokens)
 */
function applyHardcodedRules(
  result: HoneypotResult,
  dexData: DexScreenerData | null,
  isPumpFun: boolean
): HoneypotResult {
  // Don't apply liquidity rules to pump.fun tokens (they use bonding curves)
  if (isPumpFun) {
    return result;
  }

  // No DexScreener data available - can't apply rules
  if (!dexData) {
    return result;
  }

  let adjustedScore = result.riskScore;
  let adjustedLevel = result.riskLevel;
  const additionalFlags: HoneypotFlag[] = [];

  const liquidityUsd = dexData.liquidityUsd || 0;
  const ageInDays = dexData.ageInDays || 0;

  // Rule 1: Zero or near-zero liquidity = minimum DANGEROUS (85)
  if (liquidityUsd < 100) {
    if (adjustedScore < 90) {
      adjustedScore = 90;
      additionalFlags.push({
        type: 'LIQUIDITY',
        severity: 'CRITICAL',
        message: `CRITICAL: Liquidity is $${liquidityUsd.toFixed(2)} - token can be rugged instantly`,
      });
    }
  }
  // Rule 2: Very low liquidity (<$1000) = minimum SUSPICIOUS (75)
  else if (liquidityUsd < 1000) {
    if (adjustedScore < 80) {
      adjustedScore = 80;
      additionalFlags.push({
        type: 'LIQUIDITY',
        severity: 'HIGH',
        message: `Very low liquidity ($${liquidityUsd.toFixed(2)}) - high rug pull risk`,
      });
    }
  }
  // Rule 3: Low liquidity (<$10,000) with new token = minimum 70
  else if (liquidityUsd < 10000 && ageInDays < 3) {
    if (adjustedScore < 70) {
      adjustedScore = 70;
      additionalFlags.push({
        type: 'LIQUIDITY',
        severity: 'MEDIUM',
        message: `Low liquidity ($${liquidityUsd.toFixed(2)}) on new token (${ageInDays} days old)`,
      });
    }
  }

  // Rule 4: Brand new token (<1 day) with any liquidity issues = minimum 75
  if (ageInDays < 1 && liquidityUsd < 50000) {
    if (adjustedScore < 75) {
      adjustedScore = 75;
    }
  }

  // Determine risk level based on adjusted score
  if (adjustedScore >= 90) {
    adjustedLevel = 'SCAM';
  } else if (adjustedScore >= 75) {
    adjustedLevel = 'DANGEROUS';
  } else if (adjustedScore >= 50) {
    adjustedLevel = 'SUSPICIOUS';
  } else {
    adjustedLevel = 'SAFE';
  }

  // Merge additional flags (avoid duplicates)
  const existingFlagMessages = new Set(result.flags.map(f => f.message));
  const newFlags = additionalFlags.filter(f => !existingFlagMessages.has(f.message));

  return {
    ...result,
    riskScore: adjustedScore,
    riskLevel: adjustedLevel,
    flags: [...newFlags, ...result.flags], // New critical flags first
  };
}

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
    let dexScreenerData: DexScreenerData | null = null;

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

      // Store DexScreener data for hardcoded rules later
      if (dexScreenerResult.status === 'fulfilled' && dexScreenerResult.value) {
        dexScreenerData = dexScreenerResult.value;
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
    let result = await analyzeForHoneypot(
      {
        tokenAddress: body.tokenAddress,
        onChainContext: combinedContext,
      },
      {
        apiKey: c.env.TOGETHER_AI_API_KEY,
        model: c.env.TOGETHER_AI_MODEL,
      }
    );

    // Apply hardcoded rules for DEX tokens (not pump.fun)
    result = applyHardcodedRules(result, dexScreenerData, isPumpFun);

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
