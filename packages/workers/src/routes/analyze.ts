import { Hono } from 'hono';
import type { Bindings } from '../index';
import { HoneypotAnalysisRequest, HoneypotResult, HoneypotFlag, HoneypotRiskLevel } from '@whaleshield/shared';
import { analyzeForHoneypot } from '../services/together-ai';
import { createSupabaseClient, cacheScanResult } from '../services/supabase';
import { fetchTokenData, buildOnChainContext } from '../services/solana-data';
import { fetchDexScreenerData, buildMarketContext, DexScreenerData } from '../services/dexscreener';
import { fetchPumpFunData, buildPumpFunContext, isPumpFunToken, PumpFunTokenData } from '../services/pumpfun';
import {
  fetchHeliusTokenMetadata,
  analyzeCreatorWallet,
  analyzeTokenTransactions,
  buildHeliusContext,
  CreatorAnalysis,
} from '../services/helius';

interface AnalysisData {
  dexScreener: DexScreenerData | null;
  pumpFun: PumpFunTokenData | null;
  creator: CreatorAnalysis | null;
  isPumpFun: boolean;
  ageInDays: number;
  marketCapUsd: number;
  liquidityUsd: number;
  hasUnknownDeployer: boolean;
  hasMintAuthority: boolean;
  hasFreezeAuthority: boolean;
}

/**
 * Apply hardcoded minimum score rules for critical red flags
 * These rules OVERRIDE the AI score when specific conditions are met
 */
function applyHardcodedRules(
  result: HoneypotResult,
  data: AnalysisData
): HoneypotResult {
  let adjustedScore = result.riskScore;
  let adjustedLevel = result.riskLevel;
  const additionalFlags: HoneypotFlag[] = [];

  const { dexScreener, pumpFun, creator, isPumpFun, ageInDays, liquidityUsd, marketCapUsd } = data;

  // ============================================
  // RULE 1: CREATOR/DEPLOYER RISK (CRITICAL)
  // ============================================
  if (creator) {
    // Previous rugs = immediate high risk
    if (creator.ruggedTokens > 0) {
      const penalty = Math.min(creator.ruggedTokens * 20, 50);
      if (adjustedScore < 70 + penalty / 2) {
        adjustedScore = Math.min(95, 70 + penalty / 2);
        additionalFlags.push({
          type: 'DEPLOYER',
          severity: 'CRITICAL',
          message: `CRITICAL: Creator has ${creator.ruggedTokens} previous dead/rugged tokens`,
        });
      }
    }

    // Brand new wallet = higher risk baseline
    if (creator.walletAge === 0) {
      if (adjustedScore < 65) {
        adjustedScore = 65;
        additionalFlags.push({
          type: 'DEPLOYER',
          severity: 'HIGH',
          message: 'Creator wallet is brand new (0 days old)',
        });
      }
    } else if (creator.walletAge < 7) {
      if (adjustedScore < 55) {
        adjustedScore = 55;
        additionalFlags.push({
          type: 'DEPLOYER',
          severity: 'MEDIUM',
          message: `Creator wallet is very new (${creator.walletAge} days old)`,
        });
      }
    }

    // Serial token creator
    if (creator.tokensCreated > 10) {
      if (adjustedScore < 60) {
        adjustedScore = 60;
        additionalFlags.push({
          type: 'DEPLOYER',
          severity: 'HIGH',
          message: `Serial token creator: ${creator.tokensCreated} tokens deployed`,
        });
      }
    }
  }

  // Unknown deployer = risk flag
  if (data.hasUnknownDeployer) {
    if (adjustedScore < 55) {
      adjustedScore = 55;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'MEDIUM',
        message: 'Deployer/creator information unavailable',
      });
    }
  }

  // ============================================
  // RULE 2: TOKEN AGE RISK
  // ============================================
  if (ageInDays < 1) {
    // Brand new token - minimum score based on other factors
    const baseMinScore = isPumpFun ? 50 : 60;
    if (adjustedScore < baseMinScore) {
      adjustedScore = baseMinScore;
      additionalFlags.push({
        type: 'CONTRACT',
        severity: 'MEDIUM',
        message: `Very new token (<1 day old) - exercise caution`,
      });
    }
  }

  // ============================================
  // RULE 3: LIQUIDITY RULES (NON-PUMP.FUN)
  // ============================================
  if (!isPumpFun && dexScreener) {
    // Zero or near-zero liquidity = SCAM
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
    // Very low liquidity = DANGEROUS
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
    // Low liquidity on new token = SUSPICIOUS
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
  }

  // ============================================
  // RULE 4: PUMP.FUN SPECIFIC RULES
  // ============================================
  if (isPumpFun && pumpFun) {
    // Low bonding curve reserves
    if (pumpFun.realSolReserves < 1) {
      if (adjustedScore < 70) {
        adjustedScore = 70;
        additionalFlags.push({
          type: 'LIQUIDITY',
          severity: 'HIGH',
          message: `Very low bonding curve reserves (${pumpFun.realSolReserves.toFixed(2)} SOL)`,
        });
      }
    }

    // No socials on pump.fun = higher risk
    if (!pumpFun.twitter && !pumpFun.telegram && !pumpFun.website) {
      if (adjustedScore < 55 && ageInDays < 1) {
        adjustedScore = 55;
        additionalFlags.push({
          type: 'SOCIAL',
          severity: 'MEDIUM',
          message: 'No social links provided on pump.fun',
        });
      }
    }
  }

  // ============================================
  // RULE 5: AUTHORITY RISKS
  // ============================================
  if (data.hasMintAuthority) {
    if (adjustedScore < 50) {
      adjustedScore = 50;
    }
    additionalFlags.push({
      type: 'OWNERSHIP',
      severity: 'MEDIUM',
      message: 'Mint authority not revoked - more tokens can be created',
    });
  }

  if (data.hasFreezeAuthority) {
    if (adjustedScore < 55) {
      adjustedScore = 55;
    }
    additionalFlags.push({
      type: 'OWNERSHIP',
      severity: 'HIGH',
      message: 'Freeze authority exists - accounts can be frozen',
    });
  }

  // ============================================
  // RULE 6: MARKET CAP CAPS (established tokens)
  // ============================================
  // Large established tokens should have score capped
  // Only skip the cap if we KNOW the creator has rugs
  const hasKnownRugs = creator && creator.ruggedTokens > 0;

  if (marketCapUsd >= 100_000_000 && ageInDays >= 30 && !hasKnownRugs) {
    // $100M+ market cap, 30+ days old - very established
    if (adjustedScore > 35) {
      adjustedScore = 35;
      additionalFlags.push({
        type: 'CONTRACT',
        severity: 'LOW',
        message: `Established token ($${(marketCapUsd / 1_000_000).toFixed(1)}M MC, ${ageInDays} days) - score capped`,
      });
    }
  } else if (marketCapUsd >= 50_000_000 && ageInDays >= 14 && !hasKnownRugs) {
    // $50M+ market cap, 14+ days old
    if (adjustedScore > 45) {
      adjustedScore = 45;
      additionalFlags.push({
        type: 'CONTRACT',
        severity: 'LOW',
        message: `Established token ($${(marketCapUsd / 1_000_000).toFixed(1)}M MC, ${ageInDays} days) - score capped`,
      });
    }
  } else if (marketCapUsd >= 10_000_000 && ageInDays >= 7 && !hasKnownRugs) {
    // $10M+ market cap, 7+ days old
    if (adjustedScore > 55) {
      adjustedScore = 55;
    }
  }

  // ============================================
  // DETERMINE FINAL RISK LEVEL
  // ============================================
  if (adjustedScore >= 90) {
    adjustedLevel = 'SCAM';
  } else if (adjustedScore >= 70) {
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

  if (solPriceCache && now - solPriceCache.timestamp < SOL_PRICE_CACHE_TTL) {
    return solPriceCache.price;
  }

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    const data = await response.json() as { solana?: { usd?: number } };
    const price = data.solana?.usd || 150;

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

    console.log(`[Analyze] Starting comprehensive analysis for ${body.tokenAddress}`);

    // Initialize analysis data
    const analysisData: AnalysisData = {
      dexScreener: null,
      pumpFun: null,
      creator: null,
      isPumpFun: isPumpFunToken(body.tokenAddress),
      ageInDays: 0,
      marketCapUsd: 0,
      liquidityUsd: 0,
      hasUnknownDeployer: true,
      hasMintAuthority: false,
      hasFreezeAuthority: false,
    };

    // Build combined context for AI
    let combinedContext = '';

    // ============================================
    // PHASE 1: Fetch all data sources in parallel
    // ============================================
    const heliusApiKey = c.env.HELIUS_API_KEY || '';

    const [
      solPrice,
      dexScreenerResult,
      pumpFunResult,
      heliusMetadata,
    ] = await Promise.all([
      getSolPrice(),
      fetchDexScreenerData(body.tokenAddress),
      analysisData.isPumpFun ? fetchPumpFunData(body.tokenAddress) : Promise.resolve(null),
      heliusApiKey ? fetchHeliusTokenMetadata(body.tokenAddress, heliusApiKey) : Promise.resolve(null),
    ]);

    // Store DexScreener data
    if (dexScreenerResult) {
      analysisData.dexScreener = dexScreenerResult;
      analysisData.ageInDays = dexScreenerResult.ageInDays || 0;
      analysisData.marketCapUsd = dexScreenerResult.marketCap || 0;
      analysisData.liquidityUsd = dexScreenerResult.liquidityUsd || 0;
    }

    // Store pump.fun data
    if (pumpFunResult) {
      analysisData.pumpFun = pumpFunResult;
      analysisData.ageInDays = pumpFunResult.ageInDays;
      analysisData.marketCapUsd = pumpFunResult.marketCapSol * solPrice;
      analysisData.hasUnknownDeployer = false; // We have the creator
    }

    // Check authorities from Helius metadata
    if (heliusMetadata) {
      analysisData.hasMintAuthority = !!heliusMetadata.mintAuthority;
      analysisData.hasFreezeAuthority = !!heliusMetadata.freezeAuthority;
    }

    // ============================================
    // PHASE 2: Creator/Deployer Analysis
    // ============================================
    const creatorAddress = pumpFunResult?.creator || heliusMetadata?.mintAuthority;

    if (creatorAddress && creatorAddress !== 'unknown' && heliusApiKey) {
      console.log(`[Analyze] Analyzing creator wallet: ${creatorAddress}`);
      analysisData.hasUnknownDeployer = false;

      const creatorAnalysis = await analyzeCreatorWallet(
        creatorAddress,
        heliusApiKey
      ).catch(err => {
        console.warn('Creator analysis failed:', err);
        return null;
      });

      if (creatorAnalysis) {
        analysisData.creator = creatorAnalysis;
      }
    }

    // ============================================
    // PHASE 3: Transaction Analysis (for bundle detection)
    // ============================================
    const txAnalysis = heliusApiKey
      ? await analyzeTokenTransactions(
          body.tokenAddress,
          heliusApiKey
        ).catch(err => {
          console.warn('Transaction analysis failed:', err);
          return null;
        })
      : null;

    // ============================================
    // PHASE 4: Fetch holder data
    // ============================================
    let holderData = null;
    const knownLpAddresses = pumpFunResult?.bondingCurveAddress
      ? [pumpFunResult.bondingCurveAddress]
      : [];

    holderData = await fetchTokenData(
      body.tokenAddress,
      heliusApiKey || undefined,
      knownLpAddresses
    ).catch(() => null);

    // ============================================
    // PHASE 5: Build context string for AI
    // ============================================

    // Add data source header
    combinedContext += `COMPREHENSIVE TOKEN ANALYSIS\n`;
    combinedContext += `============================\n`;
    combinedContext += `Token: ${body.tokenAddress}\n`;
    combinedContext += `Type: ${analysisData.isPumpFun ? 'PUMP.FUN (bonding curve)' : 'Standard DEX token'}\n\n`;

    // Add pump.fun specific context
    if (analysisData.isPumpFun && pumpFunResult) {
      combinedContext += buildPumpFunContext(pumpFunResult, solPrice);
    } else if (analysisData.isPumpFun) {
      combinedContext += `\nPUMP.FUN TOKEN NOTICE:\n`;
      combinedContext += `- This is a PUMP.FUN token (address ends in 'pump')\n`;
      combinedContext += `- Pump.fun API data unavailable\n`;
      combinedContext += `- ⚠️ Unable to verify bonding curve status\n\n`;
    }

    // Add DexScreener market data
    if (dexScreenerResult) {
      combinedContext += buildMarketContext(dexScreenerResult);
    }

    // Add Helius data (metadata, creator analysis, tx analysis)
    combinedContext += buildHeliusContext(heliusMetadata, analysisData.creator, txAnalysis);

    // Add on-chain holder data
    if (holderData) {
      combinedContext += '\n' + buildOnChainContext(holderData);
    }

    // Add data completeness notice
    combinedContext += `\n\nDATA COMPLETENESS:\n`;
    combinedContext += `- DexScreener: ${dexScreenerResult ? 'YES' : 'NO'}\n`;
    combinedContext += `- Pump.fun API: ${pumpFunResult ? 'YES' : 'NO'}\n`;
    combinedContext += `- Helius Metadata: ${heliusMetadata ? 'YES' : 'NO'}\n`;
    combinedContext += `- Creator Analysis: ${analysisData.creator ? 'YES' : 'NO'}\n`;
    combinedContext += `- Holder Data: ${holderData ? 'YES' : 'NO'}\n`;

    if (analysisData.hasUnknownDeployer) {
      combinedContext += `\n⚠️ WARNING: Creator/deployer could not be identified - INCREASE RISK SCORE\n`;
    }

    console.log(`[Analyze] Context built (${combinedContext.length} chars), calling AI...`);

    // ============================================
    // PHASE 6: AI Analysis
    // ============================================
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

    // ============================================
    // PHASE 7: Apply hardcoded rules
    // ============================================
    result = applyHardcodedRules(result, analysisData);

    console.log(`[Analyze] Final score: ${result.riskScore} (${result.riskLevel})`);

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
