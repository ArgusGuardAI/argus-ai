/**
 * Twitter/X Alert Routes
 * Manual trigger, status check, and test endpoints
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import {
  postTweet,
  formatAlertTweet,
  canTweet,
  recordTweet,
  getDailyTweetCount,
  type TwitterConfig,
} from '../services/twitter';

export const twitterRoutes = new Hono<{ Bindings: Bindings }>();

function getTwitterConfig(env: Bindings): TwitterConfig | null {
  if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET || !env.TWITTER_ACCESS_TOKEN || !env.TWITTER_ACCESS_TOKEN_SECRET) {
    return null;
  }
  return {
    apiKey: env.TWITTER_API_KEY,
    apiSecret: env.TWITTER_API_SECRET,
    accessToken: env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: env.TWITTER_ACCESS_TOKEN_SECRET,
  };
}

// ============================================
// POST /twitter/alert
// Post a security alert for a specific token
// Body: { tokenAddress, analysisResult }
// ============================================
twitterRoutes.post('/alert', async (c) => {
  const config = getTwitterConfig(c.env);
  if (!config) {
    return c.json({ error: 'Twitter API keys not configured' }, 500);
  }

  const body = await c.req.json() as {
    tokenAddress?: string;
    analysisResult?: {
      tokenInfo: { name: string; symbol: string; liquidity: number; marketCap: number; ageHours: number };
      analysis: { riskScore: number; riskLevel: string; flags: Array<{ type: string; severity: string; message: string }>; summary: string };
      bundleInfo?: { detected: boolean; count: number; confidence: string };
    };
  };

  if (!body.tokenAddress || !body.analysisResult) {
    return c.json({ error: 'Missing tokenAddress or analysisResult' }, 400);
  }

  // Check rate limit and dedup
  const { allowed, reason } = await canTweet(c.env.SCAN_CACHE, body.tokenAddress);
  if (!allowed) {
    return c.json({ error: reason, tweeted: false }, 429);
  }

  const { analysisResult } = body;

  // Format the alert tweet
  const tweetText = formatAlertTweet({
    tokenAddress: body.tokenAddress,
    name: analysisResult.tokenInfo.name,
    symbol: analysisResult.tokenInfo.symbol,
    riskScore: analysisResult.analysis.riskScore,
    riskLevel: analysisResult.analysis.riskLevel,
    liquidity: analysisResult.tokenInfo.liquidity,
    marketCap: analysisResult.tokenInfo.marketCap,
    ageHours: analysisResult.tokenInfo.ageHours,
    bundleDetected: analysisResult.bundleInfo?.detected || false,
    bundleCount: analysisResult.bundleInfo?.count || 0,
    bundleConfidence: analysisResult.bundleInfo?.confidence || 'NONE',
    flags: analysisResult.analysis.flags,
    summary: analysisResult.analysis.summary,
  });

  // Post the tweet
  const result = await postTweet(tweetText, config);

  if (result.success && result.tweetId) {
    await recordTweet(c.env.SCAN_CACHE, body.tokenAddress, result.tweetId);
    return c.json({
      tweeted: true,
      tweetId: result.tweetId,
      tweetUrl: result.tweetUrl,
      text: tweetText,
    });
  }

  return c.json({ tweeted: false, error: result.error }, 500);
});

// ============================================
// GET /twitter/status
// Check tweet count and rate limit status
// ============================================
twitterRoutes.get('/status', async (c) => {
  const config = getTwitterConfig(c.env);
  const dailyCount = await getDailyTweetCount(c.env.SCAN_CACHE);

  return c.json({
    configured: !!config,
    dailyTweets: dailyCount,
    dailyLimit: 10,
    remaining: Math.max(0, 10 - dailyCount),
  });
});

// ============================================
// POST /twitter/test
// Send a test tweet to verify credentials
// ============================================
twitterRoutes.post('/test', async (c) => {
  const config = getTwitterConfig(c.env);
  if (!config) {
    return c.json({ error: 'Twitter API keys not configured' }, 500);
  }

  const testText = `\u{1F6E1}\u{FE0F} Argus AI is online.\n\nScanning Solana tokens for rug pulls, bundle attacks, and insider trading.\n\nProtect your capital. DYOR.\n\nhttps://argusguard.io\n\n#Solana #CryptoSecurity`;

  const result = await postTweet(testText, config);

  if (result.success) {
    return c.json({
      success: true,
      tweetId: result.tweetId,
      tweetUrl: result.tweetUrl,
    });
  }

  return c.json({ success: false, error: result.error }, 500);
});
