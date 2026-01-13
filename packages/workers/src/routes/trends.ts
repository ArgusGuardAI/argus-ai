import { Hono } from 'hono';
import type { Bindings } from '../index';

export const trendsRoutes = new Hono<{ Bindings: Bindings }>();

// RSS feeds for crypto news (using feeds that work without redirects)
const NEWS_SOURCES = [
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/' },
];

// Cache key and duration
const TRENDS_CACHE_KEY = 'trending_narratives';
const CACHE_DURATION_HOURS = 4;

interface TrendingNarrative {
  title: string;
  description: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  relatedTokens: string[];
  strength: number; // 1-10
}

interface TrendsResponse {
  narratives: TrendingNarrative[];
  lastUpdated: number;
  nextUpdate: number;
}

// Fetch RSS feed and extract headlines
async function fetchRSSHeadlines(url: string): Promise<string[]> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WhaleShield/1.0' },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.log(`RSS fetch failed for ${url}: ${response.status}`);
      return [];
    }

    const xml = await response.text();

    // Simple XML parsing for titles - multiple patterns
    const titles: string[] = [];

    // Pattern 1: CDATA wrapped titles
    const cdataMatches = xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g);
    for (const match of cdataMatches) {
      if (match[1]) titles.push(match[1].trim());
    }

    // Pattern 2: Plain titles
    const plainMatches = xml.matchAll(/<title>([^<]+)<\/title>/g);
    for (const match of plainMatches) {
      if (match[1]) titles.push(match[1].trim());
    }

    // Filter out feed titles and duplicates
    const filtered = titles.filter(title =>
      title &&
      title.length > 10 &&
      !title.includes('Cointelegraph') &&
      !title.includes('Decrypt') &&
      !title.includes('Bitcoin Magazine') &&
      !title.includes('RSS') &&
      !title.includes('Feed')
    );

    const unique = [...new Set(filtered)];
    console.log(`Fetched ${unique.length} headlines from ${url}`);

    return unique.slice(0, 15); // Get top 15 headlines per source
  } catch (error) {
    console.error(`Error fetching RSS from ${url}:`, error);
    return [];
  }
}

// Use Together AI to analyze headlines and extract narratives
async function analyzeNarratives(
  headlines: string[],
  apiKey: string,
  model?: string
): Promise<TrendingNarrative[]> {
  if (!apiKey) {
    console.error('No Together AI API key provided');
    return [];
  }

  const prompt = `You are a crypto market analyst. Analyze these recent crypto news headlines and identify the TOP 5 trending narratives in the crypto market right now.

HEADLINES:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

For each narrative, provide:
1. A short title (2-4 words)
2. A brief description (1-2 sentences)
3. Sentiment (bullish, bearish, or neutral)
4. Related tokens/projects mentioned (if any)
5. Strength score 1-10 (how dominant this narrative is)

Respond in this exact JSON format:
{
  "narratives": [
    {
      "title": "AI Tokens Surge",
      "description": "AI-related cryptocurrencies are seeing massive gains as tech giants announce new AI initiatives.",
      "sentiment": "bullish",
      "relatedTokens": ["FET", "AGIX", "RNDR"],
      "strength": 8
    }
  ]
}

Only return valid JSON, no other text.`;

  const modelToUse = model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

  try {
    console.log(`Calling Together AI with model: ${modelToUse}, headlines: ${headlines.length}`);

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
        temperature: 0.3,
      }),
    });

    console.log(`Together AI response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Together AI error: ${response.status} - ${errorText}`);
      throw new Error(`Together AI error: ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    console.log(`Together AI response content length: ${content.length}`);

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in Together AI response:', content.substring(0, 200));
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`Parsed ${parsed.narratives?.length || 0} narratives`);
    return parsed.narratives || [];
  } catch (error) {
    console.error('Error analyzing narratives:', error);
    return [];
  }
}

// GET /trends - Get current trending narratives
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

    // Fetch headlines from all sources
    const allHeadlines: string[] = [];

    for (const source of NEWS_SOURCES) {
      const headlines = await fetchRSSHeadlines(source.url);
      allHeadlines.push(...headlines);
    }

    if (allHeadlines.length === 0) {
      return c.json({
        error: 'Unable to fetch news headlines',
        narratives: [],
        lastUpdated: Date.now(),
        nextUpdate: Date.now() + (30 * 60 * 1000), // Retry in 30 min
      }, 503);
    }

    // Shuffle and limit headlines
    const shuffled = allHeadlines.sort(() => Math.random() - 0.5).slice(0, 30);

    // Analyze with Together AI
    const narratives = await analyzeNarratives(
      shuffled,
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
    };

    // Only cache if we have narratives (don't cache failures)
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

// POST /trends/refresh - Force refresh trends (admin use)
trendsRoutes.post('/refresh', async (c) => {
  try {
    // Delete cache to force refresh
    await c.env.SCAN_CACHE.delete(TRENDS_CACHE_KEY);

    // Redirect to GET to fetch fresh data
    return c.redirect('/trends');
  } catch (error) {
    console.error('Refresh error:', error);
    return c.json({ error: 'Failed to refresh trends' }, 500);
  }
});

// GET /trends/debug - Debug endpoint to see raw headlines
trendsRoutes.get('/debug', async (c) => {
  const allHeadlines: { source: string; headlines: string[] }[] = [];

  for (const source of NEWS_SOURCES) {
    const headlines = await fetchRSSHeadlines(source.url);
    allHeadlines.push({ source: source.name, headlines });
  }

  return c.json({
    sources: NEWS_SOURCES,
    results: allHeadlines,
    totalHeadlines: allHeadlines.reduce((acc, s) => acc + s.headlines.length, 0),
  });
});

// GET /trends/test-ai - Test Together AI directly
trendsRoutes.get('/test-ai', async (c) => {
  const testHeadlines = [
    "Bitcoin rallies above $93,000",
    "Polygon strikes $250M deal",
    "Monero hits all-time high",
  ];

  try {
    const apiKey = c.env.TOGETHER_AI_API_KEY;
    const hasKey = !!apiKey;
    const keyPreview = apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT SET';

    if (!apiKey) {
      return c.json({ error: 'No API key', hasKey, keyPreview });
    }

    const model = c.env.TOGETHER_AI_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "Hello WhaleShield!" in one sentence.' }],
        max_tokens: 50,
        temperature: 0.3,
      }),
    });

    const status = response.status;
    const responseText = await response.text();

    return c.json({
      hasKey,
      keyPreview,
      model,
      status,
      response: responseText.substring(0, 500),
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
