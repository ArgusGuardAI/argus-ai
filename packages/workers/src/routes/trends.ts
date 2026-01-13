import { Hono } from 'hono';
import type { Bindings } from '../index';

export const trendsRoutes = new Hono<{ Bindings: Bindings }>();

// RSS feeds for crypto news
const NEWS_SOURCES = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
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
    });

    if (!response.ok) return [];

    const xml = await response.text();

    // Simple XML parsing for titles
    const titles: string[] = [];
    const titleMatches = xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g);

    for (const match of titleMatches) {
      const title = match[1] || match[2];
      if (title && !title.includes('CoinDesk') && !title.includes('Cointelegraph') && !title.includes('The Block')) {
        titles.push(title.trim());
      }
    }

    return titles.slice(0, 15); // Get top 15 headlines per source
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

  try {
    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`Together AI error: ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
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

      // Return cached if still valid
      if (Date.now() < cachedData.nextUpdate) {
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

    const response: TrendsResponse = {
      narratives: narratives.slice(0, 5), // Top 5
      lastUpdated: Date.now(),
      nextUpdate: Date.now() + (CACHE_DURATION_HOURS * 60 * 60 * 1000),
    };

    // Cache the results
    await c.env.SCAN_CACHE.put(
      TRENDS_CACHE_KEY,
      JSON.stringify(response),
      { expirationTtl: CACHE_DURATION_HOURS * 60 * 60 }
    );

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
