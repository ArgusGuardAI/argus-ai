/**
 * Solana On-Chain Analysis
 * Direct RPC calls to analyze token security at the blockchain level
 *
 * Uses: @solana/web3.js and @solana/spl-token
 *
 * RPC Providers:
 * - Helius (recommended): https://helius.dev - free tier available
 * - Shyft: https://shyft.to
 * - QuickNode: https://quicknode.com
 * - Public RPC (rate limited): https://api.mainnet-beta.solana.com
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Use Helius or your preferred RPC
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

/**
 * Analyze token mint authority and freeze authority
 * These are CRITICAL security checks for Solana SPL tokens
 */
export async function analyzeTokenAuthorities(mintAddress) {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mintPubkey);

    return {
      // If mintAuthority is null, no one can mint more tokens (SAFE)
      mintAuthorityRevoked: mintInfo.mintAuthority === null,
      mintAuthority: mintInfo.mintAuthority?.toBase58() || null,

      // If freezeAuthority is null, no one can freeze accounts (SAFE)
      freezeAuthorityRevoked: mintInfo.freezeAuthority === null,
      freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,

      supply: mintInfo.supply.toString(),
      decimals: mintInfo.decimals,

      // Risk assessment
      canMintMore: mintInfo.mintAuthority !== null,
      canFreezeAccounts: mintInfo.freezeAuthority !== null,
    };
  } catch (error) {
    console.error('Error analyzing token authorities:', error);
    return null;
  }
}

/**
 * Get top token holders and their percentages
 * Critical for detecting concentrated ownership (rug risk)
 */
export async function getTopHolders(mintAddress, limit = 20) {
  try {
    const mintPubkey = new PublicKey(mintAddress);

    // Get all token accounts for this mint
    const accounts = await connection.getTokenLargestAccounts(mintPubkey);

    // Get mint info for total supply
    const mintInfo = await getMint(connection, mintPubkey);
    const totalSupply = Number(mintInfo.supply);

    const holders = accounts.value.map((account, index) => {
      const amount = Number(account.amount);
      const percentage = (amount / totalSupply) * 100;

      return {
        rank: index + 1,
        address: account.address.toBase58(),
        amount: amount,
        percentage: percentage,
      };
    });

    // Calculate concentration metrics
    const top10Percentage = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);
    const top5Percentage = holders.slice(0, 5).reduce((sum, h) => sum + h.percentage, 0);
    const topHolderPercentage = holders[0]?.percentage || 0;

    return {
      holders: holders.slice(0, limit),
      totalHolders: accounts.value.length,
      concentration: {
        top1: topHolderPercentage,
        top5: top5Percentage,
        top10: top10Percentage,
      },
      // Risk flags
      isSingleWhale: topHolderPercentage > 50,
      isHighlyConcentrated: top10Percentage > 80,
    };
  } catch (error) {
    console.error('Error getting top holders:', error);
    return null;
  }
}

/**
 * Check if LP (liquidity pool) tokens are burned
 * Burned LP = liquidity is locked forever (SAFE)
 */
export async function checkLPStatus(lpMintAddress) {
  try {
    const lpMintPubkey = new PublicKey(lpMintAddress);
    const lpMintInfo = await getMint(connection, lpMintPubkey);

    // Get largest LP token holders
    const lpHolders = await connection.getTokenLargestAccounts(lpMintPubkey);

    // Common burn addresses
    const BURN_ADDRESSES = [
      '1nc1nerator11111111111111111111111111111111',
      '11111111111111111111111111111111',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token program (some burn to here)
    ];

    let burnedPercentage = 0;
    let lockedPercentage = 0;
    const totalSupply = Number(lpMintInfo.supply);

    for (const holder of lpHolders.value) {
      const address = holder.address.toBase58();
      const percentage = (Number(holder.amount) / totalSupply) * 100;

      if (BURN_ADDRESSES.includes(address)) {
        burnedPercentage += percentage;
      }
      // TODO: Check against known locker programs (e.g., Streamflow, Uncx)
    }

    return {
      totalLPSupply: totalSupply,
      burnedPercentage,
      lockedPercentage,
      safetyLevel:
        burnedPercentage >= 95
          ? 'very_safe'
          : burnedPercentage >= 80
          ? 'safe'
          : burnedPercentage >= 50
          ? 'moderate'
          : 'risky',
      topLPHolders: lpHolders.value.slice(0, 5).map((h) => ({
        address: h.address.toBase58(),
        percentage: (Number(h.amount) / totalSupply) * 100,
      })),
    };
  } catch (error) {
    console.error('Error checking LP status:', error);
    return null;
  }
}

/**
 * Analyze developer wallet activity
 * Tracks if the deployer has sold their tokens
 */
export async function analyzeDevWallet(mintAddress, devWalletAddress) {
  try {
    const devPubkey = new PublicKey(devWalletAddress);
    const mintPubkey = new PublicKey(mintAddress);

    // Get dev's token account for this mint
    const tokenAccounts = await connection.getTokenAccountsByOwner(devPubkey, {
      mint: mintPubkey,
    });

    if (tokenAccounts.value.length === 0) {
      return {
        hasTokenAccount: false,
        currentBalance: 0,
        status: 'sold_all', // Dev doesn't hold any tokens
        riskLevel: 'high',
      };
    }

    // Parse the token account data
    const accountInfo = tokenAccounts.value[0];
    const accountData = await getAccount(connection, accountInfo.pubkey);
    const balance = Number(accountData.amount);

    // Get mint info for percentage calculation
    const mintInfo = await getMint(connection, mintPubkey);
    const totalSupply = Number(mintInfo.supply);
    const devPercentage = (balance / totalSupply) * 100;

    return {
      hasTokenAccount: true,
      currentBalance: balance,
      percentageOfSupply: devPercentage,
      status:
        devPercentage > 10
          ? 'holding_significant'
          : devPercentage > 1
          ? 'holding_some'
          : 'mostly_sold',
      riskLevel: devPercentage > 20 ? 'medium' : devPercentage > 5 ? 'low' : 'high',
    };
  } catch (error) {
    console.error('Error analyzing dev wallet:', error);
    return null;
  }
}

/**
 * Get recent transactions for a token (for activity analysis)
 */
export async function getRecentTokenTransactions(mintAddress, limit = 20) {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const signatures = await connection.getSignaturesForAddress(mintPubkey, { limit });

    return signatures.map((sig) => ({
      signature: sig.signature,
      slot: sig.slot,
      timestamp: sig.blockTime,
      error: sig.err !== null,
    }));
  } catch (error) {
    console.error('Error getting transactions:', error);
    return [];
  }
}

/**
 * Comprehensive token safety analysis
 * Combines all checks into a single risk assessment
 */
export async function performFullSecurityAudit(mintAddress, devWalletAddress = null) {
  const [authorities, holders, transactions] = await Promise.all([
    analyzeTokenAuthorities(mintAddress),
    getTopHolders(mintAddress),
    getRecentTokenTransactions(mintAddress),
  ]);

  const devAnalysis = devWalletAddress ? await analyzeDevWallet(mintAddress, devWalletAddress) : null;

  // Calculate overall risk score
  let riskScore = 100;
  const riskFactors = [];

  // Authority checks
  if (authorities) {
    if (authorities.canMintMore) {
      riskScore -= 25;
      riskFactors.push('⚠️ Mint authority not revoked');
    } else {
      riskFactors.push('✅ Mint authority revoked');
    }

    if (authorities.canFreezeAccounts) {
      riskScore -= 15;
      riskFactors.push('⚠️ Freeze authority not revoked');
    } else {
      riskFactors.push('✅ Freeze authority revoked');
    }
  }

  // Holder concentration
  if (holders) {
    if (holders.isSingleWhale) {
      riskScore -= 30;
      riskFactors.push(`🚨 Single wallet holds ${holders.concentration.top1.toFixed(1)}%`);
    } else if (holders.isHighlyConcentrated) {
      riskScore -= 20;
      riskFactors.push(`⚠️ Top 10 wallets hold ${holders.concentration.top10.toFixed(1)}%`);
    }

    if (holders.totalHolders < 50) {
      riskScore -= 10;
      riskFactors.push(`⚠️ Only ${holders.totalHolders} holders`);
    }
  }

  // Dev wallet
  if (devAnalysis) {
    if (devAnalysis.status === 'sold_all') {
      riskScore -= 15;
      riskFactors.push('⚠️ Dev has sold all tokens');
    } else if (devAnalysis.percentageOfSupply > 30) {
      riskScore -= 10;
      riskFactors.push(`⚠️ Dev holds ${devAnalysis.percentageOfSupply.toFixed(1)}% of supply`);
    }
  }

  // Activity check
  if (transactions.length < 10) {
    riskScore -= 5;
    riskFactors.push('⚠️ Low transaction activity');
  }

  // Normalize score
  riskScore = Math.max(0, Math.min(100, riskScore));

  return {
    mintAddress,
    riskScore,
    riskLevel:
      riskScore >= 70 ? 'low' : riskScore >= 50 ? 'medium' : riskScore >= 30 ? 'high' : 'critical',
    riskFactors,
    details: {
      authorities,
      holders,
      devAnalysis,
      recentTransactions: transactions.length,
    },
  };
}
