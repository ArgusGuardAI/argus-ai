/**
 * Bundle Network Map Service
 * Tracks bundle wallets across all token scans to identify repeat offenders (syndicate networks)
 *
 * Premium Feature: Available only to 10K $ARGUS holders
 */

export interface BundleWallet {
  address: string;
  firstSeenAt: number;
  tokenCount: number;
  rugCount: number;
  totalHoldingsPct: number;
  lastSeenAt: number;
  riskScore: number;
}

export interface BundleWalletToken {
  id: number;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol?: string;
  holdingsPct?: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  detectedAt: number;
  rugged: 0 | 1 | 2; // 0=unknown, 1=rugged, 2=safe
  ruggedAt?: number;
}

export interface SyndicateNetwork {
  detected: boolean;
  repeatOffenders: number;           // Wallets seen in previous scans
  totalTokensTouched: number;        // Across all repeat offenders
  rugRate: number;                   // % of tokens that rugged
  highRiskWallets: Array<{
    address: string;
    tokenCount: number;
    rugCount: number;
    riskScore: number;
    recentTokens: Array<{
      symbol: string;
      address: string;
      rugged: boolean;
      daysAgo: number;
    }>;
  }>;
  networkWarning?: string;           // e.g., "3 wallets from $SCAM rug (2 days ago)"
}

/**
 * Store bundle wallets detected in a scan
 * Called after bundle detection in sentinel.ts
 */
export async function storeBundleWallets(
  db: D1Database,
  tokenAddress: string,
  tokenSymbol: string | undefined,
  walletAddresses: string[],
  confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  holdingsMap?: Map<string, number> // wallet -> holdings %
): Promise<void> {
  if (walletAddresses.length === 0) return;

  const now = Math.floor(Date.now() / 1000);

  try {
    // Process each wallet
    for (const address of walletAddresses) {
      const holdingsPct = holdingsMap?.get(address) || 0;

      // Upsert into bundle_wallets
      await db.prepare(`
        INSERT INTO bundle_wallets (address, first_seen_at, token_count, rug_count, total_holdings_pct, last_seen_at, risk_score)
        VALUES (?, ?, 1, 0, ?, ?, 50)
        ON CONFLICT(address) DO UPDATE SET
          token_count = token_count + 1,
          total_holdings_pct = total_holdings_pct + ?,
          last_seen_at = ?,
          risk_score = CASE
            WHEN rug_count > 0 THEN MIN(100, 50 + (rug_count * 100 / (token_count + 1)))
            ELSE 50
          END
      `).bind(address, now, holdingsPct, now, holdingsPct, now).run();

      // Insert into bundle_wallet_tokens (ignore if duplicate)
      await db.prepare(`
        INSERT OR IGNORE INTO bundle_wallet_tokens
        (wallet_address, token_address, token_symbol, holdings_pct, confidence, detected_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(address, tokenAddress, tokenSymbol || null, holdingsPct, confidence, now).run();
    }

    console.log(`[BundleNetwork] Stored ${walletAddresses.length} bundle wallets for ${tokenSymbol || tokenAddress.slice(0, 8)}`);
  } catch (error) {
    console.error('[BundleNetwork] Error storing bundle wallets:', error);
    // Don't throw - bundle network is a nice-to-have, not critical
  }
}

/**
 * Query for repeat offenders among a set of wallet addresses
 * Returns wallets that have been seen in previous scans
 */
export async function findRepeatOffenders(
  db: D1Database,
  walletAddresses: string[],
  currentTokenAddress: string
): Promise<SyndicateNetwork> {
  const result: SyndicateNetwork = {
    detected: false,
    repeatOffenders: 0,
    totalTokensTouched: 0,
    rugRate: 0,
    highRiskWallets: [],
  };

  if (walletAddresses.length === 0) return result;

  try {
    // Find wallets that exist in our database (have been seen before)
    const placeholders = walletAddresses.map(() => '?').join(',');
    const existingWallets = await db.prepare(`
      SELECT * FROM bundle_wallets
      WHERE address IN (${placeholders})
      AND token_count > 1
      ORDER BY risk_score DESC, token_count DESC
      LIMIT 10
    `).bind(...walletAddresses).all<BundleWallet>();

    if (!existingWallets.results || existingWallets.results.length === 0) {
      return result;
    }

    result.detected = true;
    result.repeatOffenders = existingWallets.results.length;

    // Calculate totals and get recent tokens for each repeat offender
    let totalTokens = 0;
    let totalRugs = 0;
    const now = Math.floor(Date.now() / 1000);

    for (const wallet of existingWallets.results) {
      totalTokens += wallet.tokenCount;
      totalRugs += wallet.rugCount;

      // Get recent tokens this wallet was involved in (excluding current token)
      const recentTokens = await db.prepare(`
        SELECT token_address, token_symbol, rugged, detected_at
        FROM bundle_wallet_tokens
        WHERE wallet_address = ? AND token_address != ?
        ORDER BY detected_at DESC
        LIMIT 3
      `).bind(wallet.address, currentTokenAddress).all<{
        token_address: string;
        token_symbol: string | null;
        rugged: number;
        detected_at: number;
      }>();

      const tokens = (recentTokens.results || []).map(t => ({
        symbol: t.token_symbol || t.token_address.slice(0, 8),
        address: t.token_address,
        rugged: t.rugged === 1,
        daysAgo: Math.floor((now - t.detected_at) / 86400),
      }));

      result.highRiskWallets.push({
        address: wallet.address,
        tokenCount: wallet.tokenCount,
        rugCount: wallet.rugCount,
        riskScore: wallet.riskScore,
        recentTokens: tokens,
      });
    }

    result.totalTokensTouched = totalTokens;
    result.rugRate = totalTokens > 0 ? Math.round((totalRugs / totalTokens) * 100) : 0;

    // Generate warning message
    if (result.repeatOffenders > 0) {
      const mostRecent = result.highRiskWallets
        .flatMap(w => w.recentTokens)
        .filter(t => t.rugged)
        .sort((a, b) => a.daysAgo - b.daysAgo)[0];

      if (mostRecent) {
        result.networkWarning = `${result.repeatOffenders} wallet${result.repeatOffenders > 1 ? 's' : ''} appeared in $${mostRecent.symbol} which rugged ${mostRecent.daysAgo} day${mostRecent.daysAgo !== 1 ? 's' : ''} ago`;
      } else if (result.rugRate > 50) {
        result.networkWarning = `${result.repeatOffenders} repeat offenders with ${result.rugRate}% historical rug rate`;
      } else {
        result.networkWarning = `${result.repeatOffenders} wallet${result.repeatOffenders > 1 ? 's' : ''} seen in ${result.totalTokensTouched} previous token${result.totalTokensTouched > 1 ? 's' : ''}`;
      }
    }

    console.log(`[BundleNetwork] Found ${result.repeatOffenders} repeat offenders for current scan`);
  } catch (error) {
    console.error('[BundleNetwork] Error finding repeat offenders:', error);
  }

  return result;
}

/**
 * Mark a token as rugged
 * Called by background job or manual trigger when a rug is detected
 */
export async function markTokenAsRugged(
  db: D1Database,
  tokenAddress: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Get all wallets associated with this token
    const wallets = await db.prepare(`
      SELECT wallet_address FROM bundle_wallet_tokens
      WHERE token_address = ? AND rugged = 0
    `).bind(tokenAddress).all<{ wallet_address: string }>();

    if (!wallets.results || wallets.results.length === 0) {
      console.log(`[BundleNetwork] No wallets found for rugged token ${tokenAddress.slice(0, 8)}`);
      return;
    }

    // Mark the token as rugged for all wallets
    await db.prepare(`
      UPDATE bundle_wallet_tokens
      SET rugged = 1, rugged_at = ?
      WHERE token_address = ?
    `).bind(now, tokenAddress).run();

    // Update rug_count and risk_score for each wallet
    for (const wallet of wallets.results) {
      await db.prepare(`
        UPDATE bundle_wallets
        SET
          rug_count = rug_count + 1,
          risk_score = MIN(100, 50 + (rug_count + 1) * 100 / token_count)
        WHERE address = ?
      `).bind(wallet.wallet_address).run();
    }

    console.log(`[BundleNetwork] Marked ${wallets.results.length} wallets as involved in rug for ${tokenAddress.slice(0, 8)}`);
  } catch (error) {
    console.error('[BundleNetwork] Error marking token as rugged:', error);
  }
}

/**
 * Get network statistics for analytics
 */
export async function getNetworkStats(
  db: D1Database
): Promise<{
  totalWallets: number;
  totalTokens: number;
  totalRugs: number;
  avgRiskScore: number;
  topOffenders: Array<{ address: string; tokenCount: number; rugCount: number }>;
}> {
  try {
    const stats = await db.prepare(`
      SELECT
        COUNT(DISTINCT address) as totalWallets,
        SUM(token_count) as totalTokens,
        SUM(rug_count) as totalRugs,
        AVG(risk_score) as avgRiskScore
      FROM bundle_wallets
    `).first<{
      totalWallets: number;
      totalTokens: number;
      totalRugs: number;
      avgRiskScore: number;
    }>();

    const topOffenders = await db.prepare(`
      SELECT address, token_count as tokenCount, rug_count as rugCount
      FROM bundle_wallets
      WHERE token_count > 1
      ORDER BY rug_count DESC, token_count DESC
      LIMIT 10
    `).all<{ address: string; tokenCount: number; rugCount: number }>();

    return {
      totalWallets: stats?.totalWallets || 0,
      totalTokens: stats?.totalTokens || 0,
      totalRugs: stats?.totalRugs || 0,
      avgRiskScore: stats?.avgRiskScore || 50,
      topOffenders: topOffenders.results || [],
    };
  } catch (error) {
    console.error('[BundleNetwork] Error getting network stats:', error);
    return {
      totalWallets: 0,
      totalTokens: 0,
      totalRugs: 0,
      avgRiskScore: 50,
      topOffenders: [],
    };
  }
}
