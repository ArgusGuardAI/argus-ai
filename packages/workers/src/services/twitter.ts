/**
 * Twitter/X API Service
 * OAuth 1.0a signing + tweet posting via Twitter API v2
 * Uses Web Crypto API (Cloudflare Workers compatible)
 */

export interface TwitterConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

const TWITTER_API_V2 = 'https://api.twitter.com/2';

// ============================================
// OAuth 1.0a Signature Generation
// ============================================

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36)).join('').slice(0, 32);
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function generateOAuthHeader(
  method: string,
  url: string,
  config: TwitterConfig
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: config.accessToken,
    oauth_version: '1.0',
  };

  // Sort parameters alphabetically
  const sortedParams = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(oauthParams[key])}`)
    .join('&');

  // Build signature base string
  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(sortedParams)}`;

  // Build signing key
  const signingKey = `${percentEncode(config.apiSecret)}&${percentEncode(config.accessTokenSecret)}`;

  // Generate HMAC-SHA1 signature
  const signature = await hmacSha1(signingKey, signatureBase);

  // Build Authorization header
  const authParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const headerString = Object.keys(authParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(authParams[key])}"`)
    .join(', ');

  return `OAuth ${headerString}`;
}

// ============================================
// Tweet Posting
// ============================================

export interface TweetResult {
  success: boolean;
  tweetId?: string;
  tweetUrl?: string;
  error?: string;
}

export async function postTweet(text: string, config: TwitterConfig): Promise<TweetResult> {
  const url = `${TWITTER_API_V2}/tweets`;

  try {
    const authHeader = await generateOAuthHeader('POST', url, config);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Twitter] API error ${response.status}: ${errorBody}`);
      return {
        success: false,
        error: `Twitter API ${response.status}: ${errorBody}`,
      };
    }

    const data = (await response.json()) as { data?: { id: string; text: string } };

    if (data.data?.id) {
      const tweetUrl = `https://x.com/ArgusPanoptes7z/status/${data.data.id}`;
      console.log(`[Twitter] Tweet posted: ${tweetUrl}`);
      return {
        success: true,
        tweetId: data.data.id,
        tweetUrl,
      };
    }

    return { success: false, error: 'No tweet ID in response' };
  } catch (error) {
    console.error('[Twitter] Post error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// Alert Tweet Formatting
// ============================================

interface AlertData {
  tokenAddress: string;
  name: string;
  symbol: string;
  riskScore: number;
  riskLevel: string;
  liquidity: number;
  marketCap: number;
  ageHours: number;
  bundleDetected: boolean;
  bundleCount: number;
  bundleConfidence: string;
  flags: Array<{ type: string; severity: string; message: string }>;
  summary: string;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatAlertTweet(data: AlertData): string {
  const displayScore = 100 - data.riskScore;

  // Determine alert type
  let alertType = 'RISK ALERT';
  if (data.bundleDetected) {
    const hasSyndicate = data.flags.some((f) => f.type === 'BUNDLE_DOMINANCE');
    alertType = hasSyndicate ? 'SYNDICATE ALERT' : 'BUNDLE ALERT';
  }
  if (data.riskScore >= 80) alertType = 'SCAM ALERT';

  // Signal label (matches frontend)
  let signal = 'AVOID';
  if (displayScore >= 75) signal = 'STRONG BUY';
  else if (displayScore >= 60) signal = 'BUY';
  else if (displayScore >= 45) signal = 'WATCH';
  else if (displayScore >= 30) signal = 'HOLD';

  const lines: string[] = [];

  // Header
  lines.push(`\u{1F6A8} ${alertType}: $${data.symbol}`);
  lines.push('');

  // Risk info
  lines.push(`\u{26A0}\u{FE0F} Safety: ${displayScore}/100 (${signal})`);

  // Bundle / syndicate info
  if (data.bundleDetected) {
    const syndicateFlag = data.flags.find((f) => f.type === 'BUNDLE_DOMINANCE');
    if (syndicateFlag && data.bundleConfidence === 'HIGH') {
      lines.push(`\u{1F578}\u{FE0F} ${data.bundleCount} syndicate wallets (same-block snipe)`);
    } else {
      lines.push(`\u{1F578}\u{FE0F} ${data.bundleCount} coordinated wallets (${data.bundleConfidence})`);
    }
  }

  // Market data
  const marketParts: string[] = [];
  if (data.liquidity > 0) marketParts.push(`Liq: $${formatNumber(data.liquidity)}`);
  if (data.marketCap > 0) marketParts.push(`MCap: $${formatNumber(data.marketCap)}`);
  if (marketParts.length > 0) {
    lines.push(`\u{1F4B0} ${marketParts.join(' | ')}`);
  }

  // Age
  if (data.ageHours !== undefined) {
    lines.push(`\u{23F0} ${formatAge(data.ageHours)} old`);
  }

  // Key flag (pick the most critical)
  const criticalFlag = data.flags.find((f) => f.severity === 'CRITICAL');
  if (criticalFlag) {
    // Truncate message if too long
    const msg = criticalFlag.message.length > 60
      ? criticalFlag.message.slice(0, 57) + '...'
      : criticalFlag.message;
    lines.push(`\u{1F534} ${msg}`);
  }

  lines.push('');

  // Link to analysis
  lines.push(`Analyze: https://app.argusguard.io/?token=${data.tokenAddress}`);

  lines.push('');
  lines.push('#Solana #RugPull #DYOR');

  let tweet = lines.join('\n');

  // Ensure under 280 chars — trim flags if needed
  if (tweet.length > 280) {
    // Remove the critical flag line
    const flagIdx = lines.findIndex((l) => l.startsWith('\u{1F534}'));
    if (flagIdx !== -1) {
      lines.splice(flagIdx, 1);
      tweet = lines.join('\n');
    }
  }

  // Final safety: hard truncate
  if (tweet.length > 280) {
    tweet = tweet.slice(0, 277) + '...';
  }

  return tweet;
}

// ============================================
// Follow-up Tweet (when warned token rugs)
// ============================================

export function formatFollowUpTweet(
  symbol: string,
  priceDropPercent: number,
): string {
  const lines: string[] = [];
  lines.push(`\u{1F4A5} UPDATE: $${symbol} we warned about just dropped ${priceDropPercent.toFixed(0)}%`);
  lines.push('');
  lines.push('This is why we scan. Protect your capital.');
  lines.push('');
  lines.push('#Solana #RugPull #ArgusAI');

  return lines.join('\n');
}

// ============================================
// Rate Limiting & Dedup (KV-based)
// ============================================

const DAILY_TWEET_LIMIT = 10;
const KV_TWEET_LOG_PREFIX = 'tweet:';
const KV_DAILY_COUNT_KEY = 'tweet_daily_count:';

export async function canTweet(kv: KVNamespace, tokenAddress: string): Promise<{ allowed: boolean; reason?: string }> {
  // Check if already tweeted about this token
  const existing = await kv.get(`${KV_TWEET_LOG_PREFIX}${tokenAddress}`);
  if (existing) {
    return { allowed: false, reason: 'Already tweeted about this token' };
  }

  // Check daily rate limit
  const today = new Date().toISOString().split('T')[0];
  const countStr = await kv.get(`${KV_DAILY_COUNT_KEY}${today}`);
  const count = countStr ? parseInt(countStr, 10) : 0;

  if (count >= DAILY_TWEET_LIMIT) {
    return { allowed: false, reason: `Daily limit reached (${DAILY_TWEET_LIMIT}/day)` };
  }

  return { allowed: true };
}

export async function recordTweet(
  kv: KVNamespace,
  tokenAddress: string,
  tweetId: string
): Promise<void> {
  // Record this token as tweeted (expire after 7 days)
  await kv.put(`${KV_TWEET_LOG_PREFIX}${tokenAddress}`, tweetId, {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  // Increment daily count (expire at end of day + buffer)
  const today = new Date().toISOString().split('T')[0];
  const countStr = await kv.get(`${KV_DAILY_COUNT_KEY}${today}`);
  const count = countStr ? parseInt(countStr, 10) : 0;
  await kv.put(`${KV_DAILY_COUNT_KEY}${today}`, (count + 1).toString(), {
    expirationTtl: 48 * 60 * 60, // 48h buffer
  });
}

export async function getDailyTweetCount(kv: KVNamespace): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const countStr = await kv.get(`${KV_DAILY_COUNT_KEY}${today}`);
  return countStr ? parseInt(countStr, 10) : 0;
}
