/**
 * GoPlus Security API Integration
 * Free tier available - provides token security analysis
 * Docs: https://docs.gopluslabs.io
 *
 * This is the industry standard for detecting:
 * - Honeypots
 * - Rug pulls
 * - Malicious contracts
 */

const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';

/**
 * Get comprehensive token security info
 * @param tokenAddress - The token mint address
 * @param chainId - 'solana' for Solana tokens
 */
export async function getTokenSecurity(tokenAddress, chainId = 'solana') {
  const response = await fetch(
    `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${tokenAddress}`
  );
  const data = await response.json();
  return data.result?.[tokenAddress.toLowerCase()] || null;
}

/**
 * Check if address is a known malicious address
 */
export async function checkMaliciousAddress(address, chainId = 'solana') {
  const response = await fetch(
    `${GOPLUS_BASE}/address_security/${address}?chain_id=${chainId}`
  );
  const data = await response.json();
  return data.result || null;
}

/**
 * Parse GoPlus security data into risk factors
 */
export function parseSecurityData(security) {
  if (!security) {
    return {
      isVerified: false,
      riskLevel: 'unknown',
      riskFactors: ['Unable to fetch security data'],
      score: 0,
    };
  }

  const riskFactors = [];
  let riskScore = 100; // Start at 100, deduct for risks

  // Critical risks (instant red flags)
  if (security.is_honeypot === '1') {
    riskFactors.push('🚨 HONEYPOT DETECTED - Cannot sell');
    riskScore -= 100;
  }

  if (security.is_blacklisted === '1') {
    riskFactors.push('🚨 Token is blacklisted');
    riskScore -= 50;
  }

  // High risks
  if (security.is_mintable === '1') {
    riskFactors.push('⚠️ Mint function enabled - supply can increase');
    riskScore -= 25;
  }

  if (security.can_take_back_ownership === '1') {
    riskFactors.push('⚠️ Ownership can be reclaimed');
    riskScore -= 30;
  }

  if (security.owner_change_balance === '1') {
    riskFactors.push('⚠️ Owner can modify balances');
    riskScore -= 40;
  }

  if (security.hidden_owner === '1') {
    riskFactors.push('⚠️ Hidden owner detected');
    riskScore -= 20;
  }

  if (security.selfdestruct === '1') {
    riskFactors.push('⚠️ Contract can self-destruct');
    riskScore -= 35;
  }

  if (security.external_call === '1') {
    riskFactors.push('⚠️ External calls detected (potential exploit)');
    riskScore -= 15;
  }

  // Medium risks
  if (security.is_proxy === '1') {
    riskFactors.push('⚡ Proxy contract - logic can change');
    riskScore -= 10;
  }

  if (security.transfer_pausable === '1') {
    riskFactors.push('⚡ Transfers can be paused');
    riskScore -= 15;
  }

  if (security.trading_cooldown === '1') {
    riskFactors.push('⚡ Trading cooldown enabled');
    riskScore -= 5;
  }

  if (security.is_anti_whale === '1') {
    riskFactors.push('ℹ️ Anti-whale mechanism (limits large trades)');
    // Not necessarily bad, slight deduction
    riskScore -= 5;
  }

  // Holder concentration risks
  if (security.holder_count && parseInt(security.holder_count) < 50) {
    riskFactors.push('⚠️ Very few holders (< 50)');
    riskScore -= 15;
  }

  const topHolderPercent = parseFloat(security.top_10_holder_ratio || 0) * 100;
  if (topHolderPercent > 80) {
    riskFactors.push(`⚠️ Top 10 holders own ${topHolderPercent.toFixed(1)}%`);
    riskScore -= 25;
  } else if (topHolderPercent > 50) {
    riskFactors.push(`⚡ Top 10 holders own ${topHolderPercent.toFixed(1)}%`);
    riskScore -= 10;
  }

  // LP risks
  if (security.lp_holder_count && parseInt(security.lp_holder_count) === 1) {
    riskFactors.push('⚠️ Single LP holder (rug pull risk)');
    riskScore -= 20;
  }

  const lpLockedPercent = parseFloat(security.lp_locked_ratio || 0) * 100;
  if (lpLockedPercent < 50) {
    riskFactors.push(`⚠️ Only ${lpLockedPercent.toFixed(1)}% liquidity locked`);
    riskScore -= 20;
  } else if (lpLockedPercent >= 95) {
    riskFactors.push(`✅ ${lpLockedPercent.toFixed(1)}% liquidity locked`);
  }

  // Positive signals
  if (security.is_open_source === '1') {
    riskFactors.push('✅ Contract is open source');
  }

  if (security.is_honeypot === '0') {
    riskFactors.push('✅ Not a honeypot (sell simulation passed)');
  }

  // Determine risk level
  let riskLevel = 'low';
  if (riskScore < 0) riskScore = 0;
  if (riskScore > 100) riskScore = 100;

  if (riskScore < 30) riskLevel = 'critical';
  else if (riskScore < 50) riskLevel = 'high';
  else if (riskScore < 70) riskLevel = 'medium';
  else riskLevel = 'low';

  return {
    isVerified: security.is_open_source === '1',
    riskLevel,
    riskScore,
    riskFactors,
    raw: security,
  };
}

/**
 * Quick safety check - returns true if token passes basic checks
 */
export function passesBasicSafetyCheck(security) {
  if (!security) return false;

  return (
    security.is_honeypot !== '1' &&
    security.is_blacklisted !== '1' &&
    security.owner_change_balance !== '1' &&
    security.selfdestruct !== '1'
  );
}
