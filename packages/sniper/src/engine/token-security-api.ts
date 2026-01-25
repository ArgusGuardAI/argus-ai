/**
 * Token Security API
 * Uses FREE APIs (Birdeye, RugCheck) instead of RPC for security data
 *
 * This replaces the need for Helius RPC calls!
 */

import type { OnChainData } from './onchain-security';

// API endpoints
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1';
const BIRDEYE_API = 'https://public-api.birdeye.so';

// Birdeye API key (free tier available)
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';

// Cache to avoid repeated API calls
const securityCache = new Map<string, { data: OnChainData; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

interface RugCheckHolder {
  address: string;
  pct: number;
  uiAmount: number;
  owner?: string;
  insider?: boolean;
}

interface RugCheckReport {
  mint: string;
  tokenProgram: string;
  creator: string;
  token: {
    name: string;
    symbol: string;
    decimals: number;
    supply: number;
  };
  risks: Array<{
    name: string;
    level: string;
    description: string;
    score: number;
  }>;
  score: number;
  topHolders: RugCheckHolder[] | null;
  markets: Array<{
    pubkey: string;
    marketType: string;
    lpLockedPct: number;
    lp?: {
      lpLockedPct: number;
      holders: RugCheckHolder[];
    };
  }>;
  freezeAuthority: string | null;
  mintAuthority: string | null;
}

interface BirdeyeTokenSecurity {
  address: string;
  creatorAddress: string;
  creatorBalance: number;
  creatorPercentage: number;
  ownerAddress: string;
  ownerBalance: number;
  ownerPercentage: number;
  top10HolderBalance: number;
  top10HolderPercent: number;
  isMintable: boolean;
  isFreezable: boolean;
  totalSupply: number;
}

/**
 * Get security data from RugCheck API (FREE, no API key needed)
 */
async function getRugCheckData(mintAddress: string): Promise<OnChainData | null> {
  try {
    const response = await fetch(`${RUGCHECK_API}/tokens/${mintAddress}/report`, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.log('[RugCheck] Rate limited, will retry...');
        return null;
      }
      return null;
    }

    const data = await response.json() as RugCheckReport;

    // Calculate top holder percentage
    // RugCheck returns pct as percentage already (e.g., 15.5 for 15.5%)
    let topHolderPercent = 0;
    let top10Percent = 0;
    let holderCount = 0;

    // Try topHolders first (root level)
    if (data.topHolders && data.topHolders.length > 0) {
      topHolderPercent = data.topHolders[0]?.pct || 0;
      top10Percent = data.topHolders.slice(0, 10).reduce((sum, h) => sum + (h.pct || 0), 0);
      holderCount = data.topHolders.length;
    }
    // Fallback: check markets array for holder data
    else if (data.markets && data.markets.length > 0) {
      for (const market of data.markets) {
        if (market.lp?.holders && market.lp.holders.length > 0) {
          // Get non-LP holders (filter out LP accounts)
          const nonLpHolders = market.lp.holders.filter(h => !h.insider);
          if (nonLpHolders.length > 0) {
            const maxHolder = nonLpHolders.reduce((max, h) => h.pct > max.pct ? h : max, nonLpHolders[0]);
            topHolderPercent = Math.max(topHolderPercent, maxHolder.pct);
            top10Percent = Math.max(top10Percent, nonLpHolders.slice(0, 10).reduce((sum, h) => sum + h.pct, 0));
            holderCount = Math.max(holderCount, nonLpHolders.length);
          }
          break; // Use first market with holder data
        }
      }
    }

    // Cap percentages at 100 (some API responses have weird data)
    topHolderPercent = Math.min(topHolderPercent, 100);
    top10Percent = Math.min(top10Percent, 100);

    const result: OnChainData = {
      mintAuthorityRevoked: data.mintAuthority === null,
      freezeAuthorityRevoked: data.freezeAuthority === null,
      topHolderPercent,
      top10HoldersPercent: top10Percent,
      holderCount,
    };

    console.log(`[RugCheck] ${mintAddress.slice(0, 8)}... - Mint: ${result.mintAuthorityRevoked ? 'revoked' : 'active'}, Top holder: ${result.topHolderPercent.toFixed(1)}%`);
    return result;

  } catch (error) {
    console.log(`[RugCheck] Error fetching ${mintAddress.slice(0, 8)}...:`, error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Get security data from Birdeye API (requires API key for higher limits)
 */
async function getBirdeyeData(mintAddress: string): Promise<OnChainData | null> {
  if (!BIRDEYE_API_KEY) {
    return null; // Skip if no API key
  }

  try {
    const response = await fetch(`${BIRDEYE_API}/defi/token_security?address=${mintAddress}`, {
      headers: {
        'Accept': 'application/json',
        'X-API-KEY': BIRDEYE_API_KEY,
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.log('[Birdeye] Rate limited');
        return null;
      }
      return null;
    }

    const json = await response.json() as { success: boolean; data: BirdeyeTokenSecurity };
    if (!json.success || !json.data) {
      return null;
    }

    const data = json.data;

    const result: OnChainData = {
      mintAuthorityRevoked: !data.isMintable,
      freezeAuthorityRevoked: !data.isFreezable,
      topHolderPercent: Math.max(data.creatorPercentage || 0, data.ownerPercentage || 0),
      top10HoldersPercent: data.top10HolderPercent || 0,
      holderCount: 0, // Birdeye doesn't provide this directly
    };

    console.log(`[Birdeye] ${mintAddress.slice(0, 8)}... - Mint: ${result.mintAuthorityRevoked ? 'revoked' : 'active'}, Top holder: ${result.topHolderPercent.toFixed(1)}%`);
    return result;

  } catch (error) {
    console.log(`[Birdeye] Error fetching ${mintAddress.slice(0, 8)}...:`, error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Get token security data using FREE APIs
 * Tries RugCheck first (free, no key), then Birdeye (if key available)
 */
export async function getTokenSecurity(mintAddress: string): Promise<OnChainData | null> {
  // Check cache first
  const cached = securityCache.get(mintAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Try RugCheck first (free, no API key needed)
  let result = await getRugCheckData(mintAddress);

  // Fallback to Birdeye if RugCheck fails and we have an API key
  if (!result && BIRDEYE_API_KEY) {
    result = await getBirdeyeData(mintAddress);
  }

  // Cache the result
  if (result) {
    securityCache.set(mintAddress, { data: result, timestamp: Date.now() });
  }

  return result;
}

/**
 * Clear the security cache
 */
export function clearSecurityCache() {
  securityCache.clear();
}

/**
 * Get cache stats
 */
export function getSecurityCacheStats() {
  return {
    size: securityCache.size,
  };
}
