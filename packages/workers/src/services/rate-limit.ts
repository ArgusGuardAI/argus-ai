/**
 * Rate Limiting Service
 * Tracks API usage per IP/wallet and enforces tier-based limits
 */

import { checkTokenBalance } from './auth';

// Rate limit configuration by tier
const RATE_LIMITS = {
  free: {
    daily: 3,
    window: 24 * 60 * 60 * 1000, // 24 hours in ms
  },
  holder: {
    daily: Infinity,
    window: 24 * 60 * 60 * 1000,
  },
  pro: {
    daily: Infinity,
    window: 24 * 60 * 60 * 1000,
  },
};

// Token thresholds
const HOLDER_THRESHOLD = 1000;
const PRO_THRESHOLD = 10000;

export type UserTier = 'free' | 'holder' | 'pro';

interface RateLimitResult {
  allowed: boolean;
  tier: UserTier;
  remaining: number;
  limit: number;
  resetAt: number;
  error?: string;
}

/**
 * Get the start of the current day (UTC) for consistent rate limit windows
 */
function getDayKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Get the reset timestamp (start of next UTC day)
 */
function getResetTimestamp(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime();
}

/**
 * Determine user tier based on wallet token balance and subscription status
 */
export async function getUserTier(
  walletAddress: string | null,
  mintAddress: string | undefined,
  heliusApiKey: string | undefined,
  supabaseUrl: string,
  supabaseKey: string
): Promise<{ tier: UserTier; tokenBalance: number; isSubscribed: boolean }> {
  if (!walletAddress) {
    return { tier: 'free', tokenBalance: 0, isSubscribed: false };
  }

  let tokenBalance = 0;
  let isSubscribed = false;

  // Check token balance if mint is set
  if (mintAddress && mintAddress !== 'TBD_AFTER_LAUNCH') {
    try {
      const result = await checkTokenBalance(walletAddress, mintAddress, 0, heliusApiKey);
      tokenBalance = result.balance;
    } catch (error) {
      console.error('Error checking token balance:', error);
    }
  }

  // Check subscription status
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/subscribers?wallet_address=eq.${walletAddress}&select=status,current_period_end`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0 && data[0].status === 'active') {
        const periodEnd = new Date(data[0].current_period_end);
        isSubscribed = periodEnd > new Date();
      }
    }
  } catch (error) {
    console.error('Error checking subscription:', error);
  }

  // Determine tier
  let tier: UserTier = 'free';
  if (isSubscribed || tokenBalance >= PRO_THRESHOLD) {
    tier = 'pro';
  } else if (tokenBalance >= HOLDER_THRESHOLD) {
    tier = 'holder';
  }

  return { tier, tokenBalance, isSubscribed };
}

/**
 * Check and update rate limit for a request
 */
export async function checkRateLimit(
  kv: KVNamespace,
  identifier: string, // IP address or wallet address
  tier: UserTier
): Promise<RateLimitResult> {
  const limits = RATE_LIMITS[tier];
  const dayKey = getDayKey();
  const kvKey = `ratelimit:${identifier}:${dayKey}`;

  // Unlimited tiers always pass
  if (limits.daily === Infinity) {
    return {
      allowed: true,
      tier,
      remaining: Infinity,
      limit: Infinity,
      resetAt: getResetTimestamp(),
    };
  }

  // Get current usage count
  const currentCount = parseInt(await kv.get(kvKey) || '0', 10);

  if (currentCount >= limits.daily) {
    return {
      allowed: false,
      tier,
      remaining: 0,
      limit: limits.daily,
      resetAt: getResetTimestamp(),
      error: `Daily limit of ${limits.daily} scans reached. Upgrade to get unlimited scans.`,
    };
  }

  // Increment count
  const newCount = currentCount + 1;
  await kv.put(kvKey, String(newCount), {
    expirationTtl: 86400, // 24 hours
  });

  return {
    allowed: true,
    tier,
    remaining: limits.daily - newCount,
    limit: limits.daily,
    resetAt: getResetTimestamp(),
  };
}

/**
 * Get current usage without incrementing
 */
export async function getUsage(
  kv: KVNamespace,
  identifier: string,
  tier: UserTier
): Promise<{ used: number; limit: number; remaining: number }> {
  const limits = RATE_LIMITS[tier];
  const dayKey = getDayKey();
  const kvKey = `ratelimit:${identifier}:${dayKey}`;

  if (limits.daily === Infinity) {
    return { used: 0, limit: Infinity, remaining: Infinity };
  }

  const currentCount = parseInt(await kv.get(kvKey) || '0', 10);

  return {
    used: currentCount,
    limit: limits.daily,
    remaining: Math.max(0, limits.daily - currentCount),
  };
}

/**
 * Extract client IP from request headers
 */
export function getClientIP(request: Request): string {
  // Cloudflare provides the real IP in CF-Connecting-IP
  const cfIP = request.headers.get('CF-Connecting-IP');
  if (cfIP) return cfIP;

  // Fallback to X-Forwarded-For
  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  // Last resort
  return 'unknown';
}
