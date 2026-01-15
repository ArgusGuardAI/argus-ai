import { Hono } from 'hono';
import type { Bindings } from '../index';

/**
 * Lightweight scores endpoint - returns cached risk scores only
 * NO external API calls, just KV cache reads
 * Perfect for website display of multiple tokens
 */

interface CachedFlag {
  type: string;
  severity: string;
  message: string;
}

interface CachedScore {
  tokenAddress: string;
  riskScore: number;
  riskLevel: string;
  confidence: number;
  checkedAt: number;
  // Lightweight summary data
  market?: {
    name: string;
    symbol: string;
    marketCap: number;
    liquidity: number;
  };
  creator?: {
    tokensCreated: number;
    ruggedTokens: number;
  };
  flags: CachedFlag[];
  flagCount: number;
}

interface ScoresResponse {
  scores: Record<string, CachedScore | null>;
  cached: number; // How many were found in cache
  notCached: number; // How many were not in cache
}

const scoresRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * GET /scores?tokens=abc,def,ghi
 * Returns cached scores for multiple tokens (up to 50)
 * Zero external API calls - KV reads only
 */
scoresRoutes.get('/', async (c) => {
  const tokensParam = c.req.query('tokens');

  if (!tokensParam) {
    return c.json({ error: 'tokens query parameter is required (comma-separated)' }, 400);
  }

  const tokenAddresses = tokensParam
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .slice(0, 50); // Limit to 50 tokens per request

  if (tokenAddresses.length === 0) {
    return c.json({ error: 'No valid token addresses provided' }, 400);
  }

  const scores: Record<string, CachedScore | null> = {};
  let cached = 0;
  let notCached = 0;

  // Fetch all from KV cache in parallel
  const cachePromises = tokenAddresses.map(async (tokenAddress) => {
    const cacheKey = `scan:${tokenAddress}`;
    const cachedData = await c.env.SCAN_CACHE.get(cacheKey, 'json') as {
      riskScore?: number;
      riskLevel?: string;
      confidence?: number;
      checkedAt?: number;
      market?: {
        name?: string;
        symbol?: string;
        marketCap?: number;
        liquidity?: number;
      };
      creator?: {
        tokensCreated?: number;
        ruggedTokens?: number;
      };
      flags?: unknown[];
    } | null;

    if (cachedData && cachedData.riskScore !== undefined) {
      cached++;
      const flags = Array.isArray(cachedData.flags) ? cachedData.flags.map((f: { type?: string; severity?: string; message?: string }) => ({
        type: f.type || 'UNKNOWN',
        severity: f.severity || 'MEDIUM',
        message: f.message || '',
      })) : [];
      scores[tokenAddress] = {
        tokenAddress,
        riskScore: cachedData.riskScore,
        riskLevel: cachedData.riskLevel || 'UNKNOWN',
        confidence: cachedData.confidence || 0,
        checkedAt: cachedData.checkedAt || 0,
        market: cachedData.market ? {
          name: cachedData.market.name || '',
          symbol: cachedData.market.symbol || '',
          marketCap: cachedData.market.marketCap || 0,
          liquidity: cachedData.market.liquidity || 0,
        } : undefined,
        creator: cachedData.creator ? {
          tokensCreated: cachedData.creator.tokensCreated || 0,
          ruggedTokens: cachedData.creator.ruggedTokens || 0,
        } : undefined,
        flags,
        flagCount: flags.length,
      };
    } else {
      notCached++;
      scores[tokenAddress] = null;
    }
  });

  await Promise.all(cachePromises);

  const response: ScoresResponse = {
    scores,
    cached,
    notCached,
  };

  return c.json(response);
});

/**
 * POST /scores
 * Same as GET but accepts body for longer token lists
 * Body: { tokens: ["abc", "def", ...] }
 */
scoresRoutes.post('/', async (c) => {
  const body = await c.req.json() as { tokens?: string[] };

  if (!body.tokens || !Array.isArray(body.tokens)) {
    return c.json({ error: 'tokens array is required in body' }, 400);
  }

  const tokenAddresses = body.tokens
    .filter(t => typeof t === 'string' && t.length > 0)
    .slice(0, 100); // Allow up to 100 for POST

  if (tokenAddresses.length === 0) {
    return c.json({ error: 'No valid token addresses provided' }, 400);
  }

  const scores: Record<string, CachedScore | null> = {};
  let cached = 0;
  let notCached = 0;

  // Fetch all from KV cache in parallel
  const cachePromises = tokenAddresses.map(async (tokenAddress) => {
    const cacheKey = `scan:${tokenAddress}`;
    const cachedData = await c.env.SCAN_CACHE.get(cacheKey, 'json') as {
      riskScore?: number;
      riskLevel?: string;
      confidence?: number;
      checkedAt?: number;
      market?: {
        name?: string;
        symbol?: string;
        marketCap?: number;
        liquidity?: number;
      };
      creator?: {
        tokensCreated?: number;
        ruggedTokens?: number;
      };
      flags?: unknown[];
    } | null;

    if (cachedData && cachedData.riskScore !== undefined) {
      cached++;
      const flags = Array.isArray(cachedData.flags) ? cachedData.flags.map((f: { type?: string; severity?: string; message?: string }) => ({
        type: f.type || 'UNKNOWN',
        severity: f.severity || 'MEDIUM',
        message: f.message || '',
      })) : [];
      scores[tokenAddress] = {
        tokenAddress,
        riskScore: cachedData.riskScore,
        riskLevel: cachedData.riskLevel || 'UNKNOWN',
        confidence: cachedData.confidence || 0,
        checkedAt: cachedData.checkedAt || 0,
        market: cachedData.market ? {
          name: cachedData.market.name || '',
          symbol: cachedData.market.symbol || '',
          marketCap: cachedData.market.marketCap || 0,
          liquidity: cachedData.market.liquidity || 0,
        } : undefined,
        creator: cachedData.creator ? {
          tokensCreated: cachedData.creator.tokensCreated || 0,
          ruggedTokens: cachedData.creator.ruggedTokens || 0,
        } : undefined,
        flags,
        flagCount: flags.length,
      };
    } else {
      notCached++;
      scores[tokenAddress] = null;
    }
  });

  await Promise.all(cachePromises);

  const response: ScoresResponse = {
    scores,
    cached,
    notCached,
  };

  return c.json(response);
});

export default scoresRoutes;
