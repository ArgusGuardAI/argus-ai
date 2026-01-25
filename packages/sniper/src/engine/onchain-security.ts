/**
 * On-Chain Security Analysis
 * Direct Solana RPC calls to verify token security
 *
 * Checks:
 * - Mint authority (can more tokens be minted?)
 * - Freeze authority (can accounts be frozen?)
 * - Holder concentration (whale risk)
 */

import { Connection, PublicKey } from '@solana/web3.js';

export interface OnChainData {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  topHolderPercent: number;
  top10HoldersPercent: number;
  holderCount: number;
}

// Use Helius RPC for better rate limits
const RPC_URL = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

let connection: Connection | null = null;

function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(RPC_URL, 'confirmed');
  }
  return connection;
}

// Cache to avoid repeated RPC calls
const securityCache = new Map<string, { data: OnChainData; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

// Skip on-chain checks when RPC is rate limited
const SKIP_ONCHAIN_CHECKS = process.env.SKIP_ONCHAIN_CHECKS === 'true' || process.env.SKIP_ONCHAIN_CHECKS === '1';

/**
 * Get on-chain security data for a token
 * Returns mint/freeze authority status and holder concentration
 */
export async function getOnChainSecurity(mintAddress: string): Promise<OnChainData | null> {
  // Skip if explicitly disabled (RPC rate limited)
  if (SKIP_ONCHAIN_CHECKS) {
    return null;
  }

  // Check cache first
  const cached = securityCache.get(mintAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const conn = getConnection();
    const mintPubkey = new PublicKey(mintAddress);

    // Get mint info and holder data in parallel
    const [mintInfo, holdersResult] = await Promise.all([
      getMintInfo(conn, mintPubkey),
      getHolderConcentration(conn, mintPubkey),
    ]);

    if (!mintInfo) {
      return null;
    }

    const data: OnChainData = {
      mintAuthorityRevoked: mintInfo.mintAuthority === null,
      freezeAuthorityRevoked: mintInfo.freezeAuthority === null,
      topHolderPercent: holdersResult?.topHolderPercent || 0,
      top10HoldersPercent: holdersResult?.top10Percent || 0,
      holderCount: holdersResult?.holderCount || 0,
    };

    // Cache the result
    securityCache.set(mintAddress, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    console.error('[OnChain] Error fetching security data:', error);
    return null;
  }
}

/**
 * Get mint info (authority status)
 */
async function getMintInfo(conn: Connection, mintPubkey: PublicKey): Promise<{
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: string;
  decimals: number;
} | null> {
  try {
    const accountInfo = await conn.getAccountInfo(mintPubkey);
    if (!accountInfo || accountInfo.data.length < 82) {
      return null;
    }

    // Parse SPL Token mint data manually
    // Layout: 36 bytes coption for mintAuthority, 8 bytes supply, 1 byte decimals,
    //         1 byte isInitialized, 36 bytes coption for freezeAuthority
    const data = accountInfo.data;

    // Mint authority (bytes 0-36)
    const mintAuthorityOption = data[0];
    let mintAuthority: string | null = null;
    if (mintAuthorityOption === 1) {
      mintAuthority = new PublicKey(data.slice(4, 36)).toBase58();
    }

    // Supply (bytes 36-44)
    const supply = data.readBigUInt64LE(36).toString();

    // Decimals (byte 44)
    const decimals = data[44];

    // Freeze authority (bytes 46-82)
    const freezeAuthorityOption = data[46];
    let freezeAuthority: string | null = null;
    if (freezeAuthorityOption === 1) {
      freezeAuthority = new PublicKey(data.slice(50, 82)).toBase58();
    }

    return {
      mintAuthority,
      freezeAuthority,
      supply,
      decimals,
    };
  } catch (error) {
    console.error('[OnChain] Error parsing mint info:', error);
    return null;
  }
}

/**
 * Get holder concentration data
 */
async function getHolderConcentration(conn: Connection, mintPubkey: PublicKey): Promise<{
  topHolderPercent: number;
  top10Percent: number;
  holderCount: number;
} | null> {
  try {
    const accounts = await conn.getTokenLargestAccounts(mintPubkey);
    const holders = accounts.value;

    if (holders.length === 0) {
      return null;
    }

    // Calculate total from largest accounts (not perfect but gives good estimate)
    const totalFromTop = holders.reduce((sum, h) => sum + Number(h.amount), 0);

    if (totalFromTop === 0) {
      return null;
    }

    const topHolderPercent = (Number(holders[0]?.amount || 0) / totalFromTop) * 100;
    const top10Amount = holders.slice(0, 10).reduce((sum, h) => sum + Number(h.amount), 0);
    const top10Percent = (top10Amount / totalFromTop) * 100;

    return {
      topHolderPercent,
      top10Percent,
      holderCount: holders.length,
    };
  } catch (error) {
    console.error('[OnChain] Error fetching holders:', error);
    return null;
  }
}

/**
 * Perform full security audit
 * Returns detailed breakdown with risk factors
 */
export async function performSecurityAudit(mintAddress: string): Promise<{
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  data: OnChainData | null;
}> {
  const data = await getOnChainSecurity(mintAddress);

  if (!data) {
    return {
      riskScore: 50,
      riskLevel: 'medium',
      factors: ['⚠️ Could not fetch on-chain data'],
      data: null,
    };
  }

  let riskScore = 100;
  const factors: string[] = [];

  // Mint authority check (25 points)
  if (!data.mintAuthorityRevoked) {
    riskScore -= 25;
    factors.push('⚠️ Mint authority not revoked - can mint more tokens');
  } else {
    factors.push('✅ Mint authority revoked');
  }

  // Freeze authority check (15 points)
  if (!data.freezeAuthorityRevoked) {
    riskScore -= 15;
    factors.push('⚠️ Freeze authority active - can freeze your tokens');
  } else {
    factors.push('✅ Freeze authority revoked');
  }

  // Holder concentration (30 points)
  if (data.topHolderPercent > 50) {
    riskScore -= 30;
    factors.push(`🚨 Single whale holds ${data.topHolderPercent.toFixed(1)}%`);
  } else if (data.topHolderPercent > 30) {
    riskScore -= 15;
    factors.push(`⚠️ Top holder has ${data.topHolderPercent.toFixed(1)}%`);
  } else if (data.topHolderPercent > 20) {
    riskScore -= 5;
    factors.push(`ℹ️ Top holder: ${data.topHolderPercent.toFixed(1)}%`);
  } else {
    factors.push(`✅ Well distributed (top: ${data.topHolderPercent.toFixed(1)}%)`);
  }

  // Top 10 concentration
  if (data.top10HoldersPercent > 80) {
    riskScore -= 10;
    factors.push(`⚠️ Top 10 hold ${data.top10HoldersPercent.toFixed(0)}%`);
  }

  // Holder count (10 points)
  if (data.holderCount < 20) {
    riskScore -= 10;
    factors.push(`⚠️ Only ${data.holderCount} holders`);
  } else if (data.holderCount > 100) {
    factors.push(`✅ ${data.holderCount}+ holders`);
  }

  // Normalize score
  riskScore = Math.max(0, Math.min(100, riskScore));

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (riskScore >= 70) riskLevel = 'low';
  else if (riskScore >= 50) riskLevel = 'medium';
  else if (riskScore >= 30) riskLevel = 'high';
  else riskLevel = 'critical';

  return {
    riskScore,
    riskLevel,
    factors,
    data,
  };
}

/**
 * Clear the cache (useful for testing)
 */
export function clearCache(): void {
  securityCache.clear();
}
