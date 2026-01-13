import { Hono } from 'hono';
import type { Bindings } from '../index';

export const trendsRoutes = new Hono<{ Bindings: Bindings }>();

// Cache key and duration
const TRENDS_CACHE_KEY = 'meme_narratives';
const CACHE_DURATION_HOURS = 2; // Refresh every 2 hours for meme trends

interface TrendingToken {
  name: string;
  symbol: string;
  address: string;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
}

interface MemeNarrative {
  title: string;
  description: string;
  sentiment: 'hot' | 'rising' | 'cooling';
  exampleTokens: string[];
  strength: number; // 1-10
}

interface TrendsResponse {
  narratives: MemeNarrative[];
  lastUpdated: number;
  nextUpdate: number;
  source: string;
}

// Fetch trending Solana tokens from DexScreener (boosted tokens)
async function fetchDexScreenerTrending(): Promise<TrendingToken[]> {
  try {
    // Get top boosted tokens
    const boostsResponse = await fetch(
      'https://api.dexscreener.com/token-boosts/top/v1',
      { headers: { 'User-Agent': 'WhaleShield/1.0' } }
    );

    if (!boostsResponse.ok) {
      console.log(`DexScreener boosts API failed: ${boostsResponse.status}`);
      return [];
    }

    const boosts = await boostsResponse.json() as any[];

    // Filter for Solana tokens only
    const solanaBoosts = boosts.filter((b: any) => b.chainId === 'solana').slice(0, 30);

    if (solanaBoosts.length === 0) {
      console.log('No Solana tokens in boosts');
      return [];
    }

    // Batch lookup token names/symbols (comma-separated addresses)
    const addresses = solanaBoosts.map((b: any) => b.tokenAddress).join(',');
    const tokensResponse = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${addresses}`,
      { headers: { 'User-Agent': 'WhaleShield/1.0' } }
    );

    if (!tokensResponse.ok) {
      console.log(`DexScreener tokens API failed: ${tokensResponse.status}`);
      // Fallback: use description as name
      return solanaBoosts.map((b: any) => ({
        name: b.description || 'Unknown',
        symbol: b.tokenAddress.slice(0, 6),
        address: b.tokenAddress,
      }));
    }

    const pairs = await tokensResponse.json() as any[];

    // Build map of address -> token info
    const tokenInfoMap = new Map<string, { name: string; symbol: string }>();
    for (const pair of pairs) {
      if (pair.baseToken) {
        tokenInfoMap.set(pair.baseToken.address, {
          name: pair.baseToken.name || 'Unknown',
          symbol: pair.baseToken.symbol || '???',
        });
      }
    }

    // Combine boost data with token info
    const tokens: TrendingToken[] = solanaBoosts.map((b: any) => {
      const info = tokenInfoMap.get(b.tokenAddress);
      return {
        name: info?.name || b.description || 'Unknown',
        symbol: info?.symbol || b.tokenAddress.slice(0, 6),
        address: b.tokenAddress,
      };
    });

    console.log(`Fetched ${tokens.length} tokens from DexScreener`);
    return tokens;
  } catch (error) {
    console.error('DexScreener fetch error:', error);
    return [];
  }
}

// Fetch latest token profiles from DexScreener
async function fetchLatestProfiles(): Promise<TrendingToken[]> {
  try {
    const response = await fetch(
      'https://api.dexscreener.com/token-profiles/latest/v1',
      { headers: { 'User-Agent': 'WhaleShield/1.0' } }
    );

    if (!response.ok) {
      console.log(`DexScreener profiles API failed: ${response.status}`);
      return [];
    }

    const profiles = await response.json() as any[];
    const solanaProfiles = profiles
      .filter((p: any) => p.chainId === 'solana')
      .slice(0, 30);

    if (solanaProfiles.length === 0) return [];

    // Batch lookup token names/symbols
    const addresses = solanaProfiles.map((p: any) => p.tokenAddress).join(',');
    const tokensResponse = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${addresses}`,
      { headers: { 'User-Agent': 'WhaleShield/1.0' } }
    );

    if (!tokensResponse.ok) {
      return solanaProfiles.map((p: any) => ({
        name: p.description || 'Unknown',
        symbol: p.tokenAddress.slice(0, 6),
        address: p.tokenAddress,
      }));
    }

    const pairs = await tokensResponse.json() as any[];
    const tokenInfoMap = new Map<string, { name: string; symbol: string }>();
    for (const pair of pairs) {
      if (pair.baseToken) {
        tokenInfoMap.set(pair.baseToken.address, {
          name: pair.baseToken.name || 'Unknown',
          symbol: pair.baseToken.symbol || '???',
        });
      }
    }

    const tokens: TrendingToken[] = solanaProfiles.map((p: any) => {
      const info = tokenInfoMap.get(p.tokenAddress);
      return {
        name: info?.name || p.description || 'Unknown',
        symbol: info?.symbol || p.tokenAddress.slice(0, 6),
        address: p.tokenAddress,
      };
    });

    console.log(`Fetched ${tokens.length} tokens from DexScreener profiles`);
    return tokens;
  } catch (error) {
    console.error('DexScreener profiles fetch error:', error);
    return [];
  }
}

// Use Together AI to analyze token names and identify meme narratives
async function analyzeMemeNarratives(
  tokens: TrendingToken[],
  apiKey: string,
  model?: string
): Promise<MemeNarrative[]> {
  if (!apiKey) {
    console.error('No Together AI API key provided');
    return [];
  }

  // Build token list for analysis
  const tokenList = tokens
    .slice(0, 50)
    .map((t, i) => `${i + 1}. ${t.name} ($${t.symbol})`)
    .join('\n');

  const prompt = `You are a meme coin analyst specializing in Solana memecoins on pump.fun.

Analyze these trending Solana meme tokens and identify the TOP 5 narrative themes/categories that are currently popular:

TRENDING TOKENS:
${tokenList}

Look for patterns like:
- Animal memes (dogs, cats, frogs, etc.)
- AI/Tech themed tokens
- Political/news-related memes
- Celebrity/influencer tokens
- Food/object memes
- Anime/gaming references
- Abstract/meta memes

For each narrative, provide:
1. A catchy title (2-4 words)
2. A brief description of why it's trending
3. Sentiment: "hot" (exploding now), "rising" (gaining momentum), or "cooling" (past peak)
4. Example token symbols from the list
5. Strength score 1-10

Respond in this exact JSON format:
{
  "narratives": [
    {
      "title": "AI Agent Mania",
      "description": "AI and agent-themed tokens are dominating as the AI narrative spreads to memecoins.",
      "sentiment": "hot",
      "exampleTokens": ["AIXBT", "GOAT", "AI16Z"],
      "strength": 9
    }
  ]
}

Only return valid JSON, no other text.`;

  const modelToUse = model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

  try {
    console.log(`Analyzing ${tokens.length} tokens for meme narratives`);

    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Together AI error: ${response.status} - ${errorText}`);
      return [];
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in AI response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`Identified ${parsed.narratives?.length || 0} meme narratives`);
    return parsed.narratives || [];
  } catch (error) {
    console.error('Error analyzing meme narratives:', error);
    return [];
  }
}

// GET /trends - Get current trending meme narratives
trendsRoutes.get('/', async (c) => {
  try {
    // Check cache first
    const cached = await c.env.SCAN_CACHE.get(TRENDS_CACHE_KEY);

    if (cached) {
      const cachedData = JSON.parse(cached) as TrendsResponse;

      // Return cached if still valid AND has narratives
      if (Date.now() < cachedData.nextUpdate && cachedData.narratives.length > 0) {
        return c.json(cachedData);
      }
    }

    // Fetch tokens from DexScreener sources in parallel
    const [boostTokens, profileTokens] = await Promise.all([
      fetchDexScreenerTrending(),
      fetchLatestProfiles(),
    ]);

    // Combine and deduplicate tokens (boosts first, then profiles)
    const allTokens = [...boostTokens, ...profileTokens];
    const uniqueTokens = Array.from(
      new Map(allTokens.map(t => [t.address, t])).values()
    );

    console.log(`Total unique tokens: ${uniqueTokens.length}`);

    if (uniqueTokens.length === 0) {
      return c.json({
        error: 'Unable to fetch trending tokens',
        narratives: [],
        lastUpdated: Date.now(),
        nextUpdate: Date.now() + (30 * 60 * 1000), // Retry in 30 min
        source: 'none',
      }, 503);
    }

    // Analyze with Together AI
    const narratives = await analyzeMemeNarratives(
      uniqueTokens,
      c.env.TOGETHER_AI_API_KEY,
      c.env.TOGETHER_AI_MODEL
    );

    // Sort by strength
    narratives.sort((a, b) => b.strength - a.strength);

    const topNarratives = narratives.slice(0, 5);

    const response: TrendsResponse = {
      narratives: topNarratives,
      lastUpdated: Date.now(),
      nextUpdate: Date.now() + (CACHE_DURATION_HOURS * 60 * 60 * 1000),
      source: 'DexScreener',
    };

    // Only cache if we have narratives
    if (topNarratives.length > 0) {
      await c.env.SCAN_CACHE.put(
        TRENDS_CACHE_KEY,
        JSON.stringify(response),
        { expirationTtl: CACHE_DURATION_HOURS * 60 * 60 }
      );
    }

    return c.json(response);
  } catch (error) {
    console.error('Trends error:', error);
    return c.json({ error: 'Failed to fetch trends' }, 500);
  }
});

// POST /trends/refresh - Force refresh trends
trendsRoutes.post('/refresh', async (c) => {
  try {
    await c.env.SCAN_CACHE.delete(TRENDS_CACHE_KEY);
    return c.redirect('/trends');
  } catch (error) {
    console.error('Refresh error:', error);
    return c.json({ error: 'Failed to refresh trends' }, 500);
  }
});

// GET /trends/debug - Debug endpoint to see raw token data
trendsRoutes.get('/debug', async (c) => {
  const [boostTokens, profileTokens] = await Promise.all([
    fetchDexScreenerTrending(),
    fetchLatestProfiles(),
  ]);

  return c.json({
    boosts: { count: boostTokens.length, tokens: boostTokens.slice(0, 10) },
    profiles: { count: profileTokens.length, tokens: profileTokens.slice(0, 10) },
    total: boostTokens.length + profileTokens.length,
  });
});
