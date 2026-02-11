import { Hono } from 'hono';
import type { Bindings } from '../index';
// External API imports removed — all data comes from on-chain sources
// Helius, DexScreener, and RugCheck are no longer used
import { postTweet, formatAlertTweet, canTweet, recordTweet, type TwitterConfig } from '../services/twitter';
import { sendMessage, formatAlertHtml } from '../services/telegram';
import { checkRateLimit, getUserTier, getClientIP } from '../services/rate-limit';
import { saveTrainingExample } from '../services/training-data';
import { convertToAnalysisInput, type TokenAnalysisOutput, createAIProvider, LocalBitNetProvider } from '../services/ai-provider';
import { createSentinelDataFetcher } from '../services/sentinel-data';
import { storeBundleWallets, findRepeatOffenders, type SyndicateNetwork } from '../services/bundle-network';
import { extractFromSentinelData, toFeatureVector, getFeatureSummary, getFeatureMemorySize } from '../services/feature-extractor';

// ============================================
// EXTERNAL APIs REMOVED - Pure On-Chain Data
// ============================================
// Previously used:
// - DexScreener: price, liquidity, volume, market cap → now from on-chain pools
// - RugCheck: LP lock percentage → now from on-chain holder analysis
// - Helius: token metadata, transactions → now from RPC node
//
// All data now comes from your own Solana RPC node.
// Cost: $0 external API calls

interface WalletNode {
  id: string;
  address: string;
  label: string;
  type: 'token' | 'creator' | 'whale' | 'insider' | 'normal' | 'lp';
  holdingsPercent?: number;
  isHighRisk?: boolean;
  txCount?: number;
}

interface WalletLink {
  source: string;
  target: string;
  type: 'created' | 'holds' | 'funded' | 'coordinated';
  value: number;
}

interface NetworkData {
  nodes: WalletNode[];
  links: WalletLink[];
}

interface HolderInfo {
  address: string;
  balance: number;
  percent: number;
  isLp: boolean;
}

// Known LP pool authority prefixes (Raydium, Pumpswap, Meteora, etc.)
const LP_PREFIXES = ['5Q544', 'HWy1', 'Gnt2', 'BVCh', 'DQyr', 'BDc8', '39azU', 'FoSD'];

// ============================================
// BUNDLE QUALITY ASSESSMENT
// Determines if bundles are legitimate (VCs, team) or malicious (rug setup)
// ============================================

interface BundleQuality {
  legitimacyScore: number; // 0-100, higher = more likely legit
  assessment: 'LIKELY_LEGIT' | 'NEUTRAL' | 'SUSPICIOUS' | 'VERY_SUSPICIOUS';
  signals: {
    positive: string[];
    negative: string[];
  };
}

/**
 * Get wallet age in days by checking first transaction
 */
async function getWalletAge(address: string, heliusKey: string): Promise<number> {
  try {
    const response = await fetch(`${HELIUS_RPC_BASE}/?api-key=${heliusKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'wallet-age',
        method: 'getSignaturesForAddress',
        params: [
          address,
          { limit: 1 } // Get oldest transaction
        ],
      }),
    });

    if (!response.ok) return -1;

    const data = await response.json() as {
      result?: Array<{ blockTime?: number }>;
    };

    const signatures = data.result || [];
    if (signatures.length === 0) return -1;

    const firstTx = signatures[signatures.length - 1]; // Oldest
    if (!firstTx.blockTime) return -1;

    const ageMs = Date.now() - (firstTx.blockTime * 1000);
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    return ageDays;
  } catch (error) {
    console.error(`[BundleQuality] Error getting wallet age for ${address.slice(0, 8)}:`, error);
    return -1; // Unknown
  }
}

/**
 * Get the first address that funded this wallet
 */
async function getFirstFunder(address: string, heliusKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${HELIUS_RPC_BASE}/?api-key=${heliusKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'first-funder',
        method: 'getSignaturesForAddress',
        params: [
          address,
          { limit: 5 } // Get first few transactions
        ],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      result?: Array<{ signature?: string }>;
    };

    const signatures = data.result || [];
    if (signatures.length === 0) return null;

    // Get details of oldest transaction
    const oldestSig = signatures[signatures.length - 1].signature;
    if (!oldestSig) return null;

    const txResponse = await fetch(`${HELIUS_RPC_BASE}/?api-key=${heliusKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tx-detail',
        method: 'getTransaction',
        params: [
          oldestSig,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ],
      }),
    });

    if (!txResponse.ok) return null;

    const txData = await txResponse.json() as {
      result?: {
        transaction?: {
          message?: {
            accountKeys?: Array<{ pubkey: string }>;
          };
        };
      };
    };

    const accountKeys = txData.result?.transaction?.message?.accountKeys || [];
    
    // First account that's not the target wallet is likely the funder
    for (const account of accountKeys) {
      if (account.pubkey !== address) {
        return account.pubkey;
      }
    }

    return null;
  } catch (error) {
    console.error(`[BundleQuality] Error getting first funder for ${address.slice(0, 8)}:`, error);
    return null;
  }
}

/**
 * Calculate variance of an array of numbers
 */
function calculateVariance(numbers: number[]): number {
  if (numbers.length === 0) return 0;

  const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / numbers.length;

  // Return coefficient of variation (normalized)
  return mean > 0 ? Math.sqrt(variance) / mean : 0;
}

// ============================================
// WASH TRADING DETECTION
// Detects when bundle wallets are creating fake buy pressure
// ============================================

interface WashTradingResult {
  detected: boolean;
  totalBuys: number;
  bundleBuys: number;
  organicBuys: number;
  washTradingPercent: number;
  realBuyRatio: number | null;
  warning: string | null;
}

/**
 * Fetch recent buy transactions for a token using Helius
 */
async function getRecentBuyTransactions(
  tokenAddress: string,
  heliusKey: string,
  limitTxns: number = 100
): Promise<Array<{ buyer: string; timestamp: number; signature: string }>> {
  try {
    // Use Helius parsed transaction history for the token
    const response = await fetch(
      `https://api.helius.xyz/v0/addresses/${tokenAddress}/transactions?api-key=${heliusKey}&limit=${limitTxns}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      console.log(`[WashTrading] Failed to fetch transactions: ${response.status}`);
      return [];
    }

    const txns = await response.json() as Array<{
      type: string;
      timestamp: number;
      signature: string;
      feePayer: string;
      tokenTransfers?: Array<{
        mint: string;
        fromUserAccount: string;
        toUserAccount: string;
        tokenAmount: number;
      }>;
    }>;

    // Filter for SWAP transactions where token is being received (buys)
    const buyTxns: Array<{ buyer: string; timestamp: number; signature: string }> = [];

    for (const tx of txns) {
      if (tx.type === 'SWAP' && tx.tokenTransfers) {
        // Find transfers where the token is being received (buy)
        const tokenReceived = tx.tokenTransfers.find(
          t => t.mint === tokenAddress && t.toUserAccount && t.tokenAmount > 0
        );

        if (tokenReceived && tokenReceived.toUserAccount) {
          buyTxns.push({
            buyer: tokenReceived.toUserAccount,
            timestamp: tx.timestamp,
            signature: tx.signature
          });
        }
      }
    }

    console.log(`[WashTrading] Found ${buyTxns.length} buy transactions out of ${txns.length} total`);
    return buyTxns;
  } catch (error) {
    console.error('[WashTrading] Error fetching transactions:', error);
    return [];
  }
}

/**
 * Detect wash trading by cross-referencing bundle wallets with recent buys
 */
async function detectWashTrading(
  bundleWallets: string[],
  tokenAddress: string,
  heliusKey: string,
  reportedBuys24h: number,
  reportedSells24h: number
): Promise<WashTradingResult> {
  if (bundleWallets.length === 0) {
    return {
      detected: false,
      totalBuys: reportedBuys24h,
      bundleBuys: 0,
      organicBuys: reportedBuys24h,
      washTradingPercent: 0,
      realBuyRatio: null,
      warning: null
    };
  }

  const recentBuys = await getRecentBuyTransactions(tokenAddress, heliusKey, 100);

  if (recentBuys.length === 0) {
    return {
      detected: false,
      totalBuys: reportedBuys24h,
      bundleBuys: 0,
      organicBuys: reportedBuys24h,
      washTradingPercent: 0,
      realBuyRatio: null,
      warning: null
    };
  }

  // Create a Set for O(1) lookup
  const bundleSet = new Set(bundleWallets.map(w => w.toLowerCase()));

  // Count how many buys are from bundle wallets
  let bundleBuys = 0;
  const seenSignatures = new Set<string>();

  for (const tx of recentBuys) {
    // Dedupe by signature
    if (seenSignatures.has(tx.signature)) continue;
    seenSignatures.add(tx.signature);

    if (bundleSet.has(tx.buyer.toLowerCase())) {
      bundleBuys++;
    }
  }

  const totalBuys = seenSignatures.size;
  const organicBuys = totalBuys - bundleBuys;
  const washTradingPercent = totalBuys > 0 ? (bundleBuys / totalBuys) * 100 : 0;

  // Calculate what the "real" buy ratio would be without wash trades
  // If reported is 176:73 but 165 buys are wash, real is 11:73
  const estimatedOrganicBuys24h = Math.max(1, Math.round(reportedBuys24h * (organicBuys / Math.max(1, totalBuys))));
  const realBuyRatio = reportedSells24h > 0
    ? estimatedOrganicBuys24h / reportedSells24h
    : estimatedOrganicBuys24h;

  // Determine if wash trading is significant (30%+ of buys from bundle wallets)
  const isSignificant = washTradingPercent >= 30 && bundleBuys >= 3;

  let warning: string | null = null;
  if (washTradingPercent >= 70) {
    warning = `CRITICAL: ${washTradingPercent.toFixed(0)}% of recent buys are from bundle wallets — massive wash trading`;
  } else if (washTradingPercent >= 50) {
    warning = `${washTradingPercent.toFixed(0)}% of buy volume is bundle self-trading — artificial demand`;
  } else if (washTradingPercent >= 30) {
    warning = `${washTradingPercent.toFixed(0)}% of buys from coordinated wallets — possible wash trading`;
  }

  console.log(`[WashTrading] Result: ${bundleBuys}/${totalBuys} buys from bundles (${washTradingPercent.toFixed(1)}%), real ratio: ${realBuyRatio?.toFixed(2)}`);

  return {
    detected: isSignificant,
    totalBuys,
    bundleBuys,
    organicBuys,
    washTradingPercent,
    realBuyRatio,
    warning
  };
}

/**
 * Identify which wallets are part of the bundle
 */
function identifyBundleWallets(
  holders: HolderInfo[],
  bundleInfo: { count: number; confidence: string }
): string[] {
  // For same-block bundles, look for holders with similar holdings patterns
  // Bundle wallets typically have small, similar percentage holdings (often <1%)
  // Take top N non-LP holders that could be bundle participants
  const candidates = holders
    .filter(h => !h.isLp && h.percent > 0.1 && h.percent < 10)
    .slice(0, Math.min(bundleInfo.count, 15));

  return candidates.map(h => h.address);
}

/**
 * Assess bundle legitimacy based on wallet behavior patterns
 */
async function assessBundleQuality(
  bundleInfo: { detected: boolean; count: number; confidence: string },
  holders: HolderInfo[],
  creatorAddress: string | null,
  tokenAgeHours: number | undefined,
  heliusKey: string
): Promise<BundleQuality> {
  
  const positive: string[] = [];
  const negative: string[] = [];
  let score = 50; // Start neutral

  if (!bundleInfo.detected || bundleInfo.count === 0) {
    return {
      legitimacyScore: 100,
      assessment: 'LIKELY_LEGIT',
      signals: { positive: ['No bundle detected'], negative: [] }
    };
  }

  // Get bundle wallet addresses
  const bundleWallets = identifyBundleWallets(holders, bundleInfo);
  console.log(`[BundleQuality] Assessing ${bundleWallets.length} bundle wallets...`);

  // ============================================
  // 1. Check wallet ages (parallel, limit to 5 for speed)
  // ============================================
  try {
    const agesToCheck = bundleWallets.slice(0, 5);
    const ages = await Promise.all(
      agesToCheck.map(addr => getWalletAge(addr, heliusKey))
    );
    
    const validAges = ages.filter(age => age >= 0);
    
    if (validAges.length > 0) {
      const avgAge = validAges.reduce((sum, age) => sum + age, 0) / validAges.length;
      
      console.log(`[BundleQuality] Average wallet age: ${avgAge.toFixed(1)} days`);
      
      if (avgAge > 180) {
        score -= 20;
        positive.push(`Established wallets (avg ${avgAge.toFixed(0)} days old)`);
      } else if (avgAge > 90) {
        score -= 10;
        positive.push(`Mature wallets (avg ${avgAge.toFixed(0)} days old)`);
      } else if (avgAge > 30) {
        score -= 5;
        positive.push('Wallets have some history');
      } else if (avgAge < 7) {
        score += 20;
        negative.push(`Fresh wallets (avg ${avgAge.toFixed(0)} days old)`);
      } else if (avgAge < 14) {
        score += 10;
        negative.push('Recently created wallets');
      }
    }
  } catch (error) {
    console.error('[BundleQuality] Error checking wallet ages:', error);
  }

  // ============================================
  // 2. Check common funding source
  // ============================================
  try {
    const fundersToCheck = bundleWallets.slice(0, 5);
    const funders = await Promise.all(
      fundersToCheck.map(addr => getFirstFunder(addr, heliusKey))
    );
    
    const validFunders = funders.filter(f => f !== null) as string[];
    
    if (validFunders.length >= 2) {
      const uniqueFunders = new Set(validFunders);
      const singleSourceRatio = validFunders.length / uniqueFunders.size;
      
      console.log(`[BundleQuality] ${uniqueFunders.size} unique funders for ${validFunders.length} wallets`);
      
      if (uniqueFunders.size === 1) {
        score += 25;
        negative.push('All wallets funded from single source');
      } else if (singleSourceRatio > 2) {
        score += 15;
        negative.push('Wallets share common funding sources');
      } else if (uniqueFunders.size >= validFunders.length * 0.7) {
        score -= 10;
        positive.push('Diverse funding sources');
      }
    }
  } catch (error) {
    console.error('[BundleQuality] Error checking funders:', error);
  }

  // ============================================
  // 3. Check buy amount variance
  // ============================================
  const amounts = bundleWallets
    .map(w => holders.find(h => h.address === w)?.balance || 0)
    .filter(a => a > 0);
  
  if (amounts.length >= 2) {
    const variance = calculateVariance(amounts);
    
    console.log(`[BundleQuality] Buy amount variance: ${variance.toFixed(3)}`);
    
    if (variance < 0.05) {
      score += 20;
      negative.push('Near-identical buy amounts');
    } else if (variance < 0.15) {
      score += 10;
      negative.push('Similar buy amounts');
    } else if (variance > 0.4) {
      score -= 10;
      positive.push('Varied position sizes');
    }
  }

  // ============================================
  // 4. Check if they're still holding (if token >24h old)
  // ============================================
  if (tokenAgeHours !== undefined && tokenAgeHours > 24) {
    const stillHolding = bundleWallets.filter(w => 
      holders.find(h => h.address === w && h.balance > 0)
    ).length;
    
    const holdingPct = stillHolding / bundleWallets.length;
    
    console.log(`[BundleQuality] ${stillHolding}/${bundleWallets.length} (${(holdingPct * 100).toFixed(0)}%) still holding after 24h`);
    
    if (holdingPct > 0.9) {
      score -= 20;
      positive.push('Bundle holding after 24h (not dumped)');
    } else if (holdingPct > 0.7) {
      score -= 10;
      positive.push('Most bundle wallets still holding');
    } else if (holdingPct < 0.3) {
      score += 25;
      negative.push('Bundle dumped within 24h');
    } else if (holdingPct < 0.5) {
      score += 15;
      negative.push('Majority of bundle has sold');
    }
  }

  // ============================================
  // 5. Check if creator is part of bundle
  // ============================================
  if (creatorAddress && bundleWallets.includes(creatorAddress)) {
    score += 20;
    negative.push('Creator wallet is part of bundle');
  }

  // ============================================
  // 6. Check holder percentage concentration
  // ============================================
  const bundleHoldings = bundleWallets
    .map(w => holders.find(h => h.address === w)?.percent || 0)
    .filter(p => p > 0);
  
  const totalBundlePercent = bundleHoldings.reduce((sum, p) => sum + p, 0);
  
  console.log(`[BundleQuality] Bundle controls ${totalBundlePercent.toFixed(1)}% of supply`);
  
  if (totalBundlePercent > 40) {
    score += 15;
    negative.push(`Bundle controls ${totalBundlePercent.toFixed(1)}% of supply`);
  } else if (totalBundlePercent > 25) {
    score += 10;
    negative.push('Significant bundle concentration');
  } else if (totalBundlePercent < 10) {
    score -= 5;
    positive.push('Bundle has limited supply control');
  }

  // Cap score
  score = Math.max(0, Math.min(100, score));

  // Determine assessment
  let assessment: BundleQuality['assessment'];
  if (score >= 70) {
    assessment = 'VERY_SUSPICIOUS';
  } else if (score >= 50) {
    assessment = 'SUSPICIOUS';
  } else if (score >= 30) {
    assessment = 'NEUTRAL';
  } else {
    assessment = 'LIKELY_LEGIT';
  }

  console.log(`[BundleQuality] Final assessment: ${assessment} (score: ${score})`);
  console.log(`[BundleQuality] Positive signals: ${positive.length}, Negative signals: ${negative.length}`);

  return {
    legitimacyScore: score,
    assessment,
    signals: { positive, negative }
  };
}

// ============================================
// HARDCODED RULES ENGINE
// Applies structural guardrails that OVERRIDE AI hallucinations
// Migrated from analyze.ts for unified sentinel brain
// ============================================

interface RulesInputData {
  tokenInfo: {
    marketCap?: number;
    liquidity?: number;
    ageHours?: number;
    volume24h?: number;
    txns24h?: { buys: number; sells: number };
    mintAuthorityActive: boolean;
    freezeAuthorityActive: boolean;
    lpLockedPct?: number;
  };
  holders: HolderInfo[];
  creatorInfo: {
    address: string;
    walletAge: number;
    tokensCreated: number;
    ruggedTokens: number;
    currentHoldings: number;
  } | null;
  bundleInfo: {
    detected: boolean;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    count: number;
    txBundlePercent: number;
  };
  bundleQuality?: BundleQuality;
  washTrading?: WashTradingResult | null;
  devActivity: {
    hasSold: boolean;
    percentSold: number;
    currentHoldingsPercent: number;
  } | null;
  isPumpFun: boolean;
  hasWebsite: boolean;
  hasTwitter: boolean;
  creatorAddress: string | null;
}

interface AnalysisFlag {
  type: string;
  severity: string;
  message: string;
}

interface AnalysisResult {
  riskScore: number;
  riskLevel: string;
  summary: string;
  flags: AnalysisFlag[];
  networkInsights: string[];
  prediction?: string;
  recommendation?: string;
}

/**
 * Apply hardcoded minimum score rules for critical red flags
 * These rules OVERRIDE the AI score when specific conditions are met
 */
function applyHardcodedRules(
  result: AnalysisResult,
  data: RulesInputData
): AnalysisResult {
  let adjustedScore = result.riskScore;
  const additionalFlags: AnalysisFlag[] = [];

  const { tokenInfo, holders, creatorInfo, bundleInfo, bundleQuality, devActivity, isPumpFun } = data;
  const ageInDays = tokenInfo.ageHours !== undefined ? tokenInfo.ageHours / 24 : 0;
  const liquidityUsd = tokenInfo.liquidity || 0;
  const marketCapUsd = tokenInfo.marketCap || 0;

  // Calculate holder metrics from raw data
  const nonLpHolders = holders.filter(h => !h.isLp);
  const top1NonLpPercent = nonLpHolders[0]?.percent || 0;
  const top10NonLpPercent = nonLpHolders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);

  // Track if dev has exited (community-owned)
  let isCommunityOwned = false;
  const hasKnownRugs = creatorInfo && creatorInfo.ruggedTokens > 0;

  // ============================================
  // RULE 1: CREATOR/DEPLOYER RISK (CRITICAL)
  // ============================================
  if (creatorInfo) {
    // Previous rugs = immediate high risk
    if (creatorInfo.ruggedTokens > 0) {
      const penalty = Math.min(creatorInfo.ruggedTokens * 20, 50);
      if (adjustedScore < 70 + penalty / 2) {
        adjustedScore = Math.min(95, 70 + penalty / 2);
        additionalFlags.push({
          type: 'DEPLOYER',
          severity: 'CRITICAL',
          message: `CRITICAL: Creator has ${creatorInfo.ruggedTokens} previous dead/rugged tokens`,
        });
      }
    }

    // Brand new wallet (only apply if we actually checked - walletAge >= 0)
    if (creatorInfo.walletAge >= 0) {
      if (creatorInfo.walletAge === 0) {
        if (adjustedScore < 65) adjustedScore = 65;
      } else if (creatorInfo.walletAge < 7) {
        if (adjustedScore < 55) adjustedScore = 55;
      }
    }

    // Serial token creator - VERY suspicious
    if (creatorInfo.tokensCreated >= 20) {
      if (adjustedScore < 85) adjustedScore = 85;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'CRITICAL',
        message: `SERIAL RUG FARMER: Creator deployed ${creatorInfo.tokensCreated} tokens`,
      });
    } else if (creatorInfo.tokensCreated >= 10) {
      if (adjustedScore < 80) adjustedScore = 80;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'CRITICAL',
        message: `Serial token creator: ${creatorInfo.tokensCreated} tokens deployed`,
      });
    } else if (creatorInfo.tokensCreated >= 5) {
      if (adjustedScore < 75) adjustedScore = 75;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'HIGH',
        message: `Serial token creator: ${creatorInfo.tokensCreated} tokens deployed`,
      });
    }
  }

  // Unknown deployer = significant risk
  if (!data.creatorAddress) {
    if (adjustedScore < 60) {
      adjustedScore = 60;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'HIGH',
        message: 'Deployer/creator could not be identified',
      });
    }
  }

  // ============================================
  // RULE 2: TOKEN AGE RISK
  // ============================================
  if (ageInDays < 1) {
    if (adjustedScore < 55) {
      adjustedScore = 55;
      additionalFlags.push({
        type: 'TOKEN',
        severity: 'HIGH',
        message: 'Very new token (<1 day old) - high risk of rug pull',
      });
    }
  } else if (ageInDays < 3) {
    if (adjustedScore < 50) adjustedScore = 50;
  }

  // ============================================
  // RULE 3: LIQUIDITY RISK
  // ============================================
  if (!isPumpFun && liquidityUsd <= 0) {
    if (adjustedScore < 90) {
      adjustedScore = 90;
      additionalFlags.push({
        type: 'LIQUIDITY',
        severity: 'CRITICAL',
        message: 'HONEYPOT: $0 liquidity - YOU CANNOT SELL',
      });
    }
  } else if (!isPumpFun && liquidityUsd < 1000) {
    if (adjustedScore < 80) {
      adjustedScore = 80;
      additionalFlags.push({
        type: 'LIQUIDITY',
        severity: 'HIGH',
        message: `Very low liquidity ($${liquidityUsd.toFixed(0)}) - high rug risk`,
      });
    }
  } else if (!isPumpFun && liquidityUsd < 10000 && ageInDays < 3) {
    if (adjustedScore < 70) adjustedScore = 70;
  }

  // ============================================
  // RULE 4: AUTHORITY RISKS (CRITICAL RED FLAGS)
  // Mint/Freeze authority = creator can rug at any time
  // These are deal-breakers that cap max safety score
  // ============================================
  const hasMintAuth = tokenInfo.mintAuthorityActive;
  const hasFreezeAuth = tokenInfo.freezeAuthorityActive;

  if (hasMintAuth && hasFreezeAuth) {
    // BOTH active = maximum danger, cap at 75 risk (25 safety)
    if (adjustedScore < 75) adjustedScore = 75;
    additionalFlags.push({
      type: 'SECURITY',
      severity: 'CRITICAL',
      message: 'Both mint AND freeze authority active - creator has full control, extreme rug risk',
    });
  } else if (hasFreezeAuth) {
    // Freeze alone is worse than mint - can trap your funds
    if (adjustedScore < 70) adjustedScore = 70;
    additionalFlags.push({
      type: 'SECURITY',
      severity: 'CRITICAL',
      message: 'Freeze authority active - creator can freeze your wallet and prevent selling',
    });
  } else if (hasMintAuth) {
    // Mint authority = can dilute supply
    if (adjustedScore < 65) adjustedScore = 65;
    additionalFlags.push({
      type: 'SECURITY',
      severity: 'HIGH',
      message: 'Mint authority active - creator can mint unlimited tokens and dump',
    });
  }

  // ============================================
  // RULE 5: DEV EXIT STATUS
  // ============================================
  if (devActivity && devActivity.hasSold) {
    if (devActivity.percentSold >= 90 && devActivity.currentHoldingsPercent === 0) {
      isCommunityOwned = true;
      // Dev fully exited - positive for new buyers
      if (!hasKnownRugs) {
        adjustedScore -= 15;
        additionalFlags.push({
          type: 'DEPLOYER',
          severity: 'LOW',
          message: `Dev has exited (sold ${devActivity.percentSold.toFixed(0)}%) - community-owned`,
        });
      }
    }
  }

  // ============================================
  // RULE 6: CREATOR CURRENT HOLDINGS
  // ============================================
  if (devActivity && devActivity.currentHoldingsPercent > 0) {
    const holdings = devActivity.currentHoldingsPercent;
    if (holdings >= 50) {
      if (adjustedScore < 75) adjustedScore = 75;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'CRITICAL',
        message: `Creator holds ${holdings.toFixed(1)}% of supply - major dump risk`,
      });
    } else if (holdings >= 30) {
      if (adjustedScore < 65) adjustedScore = 65;
    } else if (holdings >= 20) {
      if (adjustedScore < 55) adjustedScore = 55;
    }
  }

  // ============================================
  // RULE 7: BUNDLE DETECTION PENALTY (WITH QUALITY ASSESSMENT)
  // ============================================
  if (bundleInfo.detected) {
    const { confidence, count, txBundlePercent } = bundleInfo;
    
    // Use bundle quality assessment if available
    if (bundleQuality) {
      const { legitimacyScore, assessment, signals } = bundleQuality;
      
      console.log(`[Rules] Bundle quality: ${assessment} (${legitimacyScore}/100)`);
      
      if (assessment === 'VERY_SUSPICIOUS') {
        // High-risk bundle - full penalty
        if (confidence === 'HIGH' && adjustedScore < 80) {
          adjustedScore = 80;
          additionalFlags.push({
            type: 'BUNDLE',
            severity: 'CRITICAL',
            message: `${count} coordinated wallets detected - HIGH RUG RISK: ${signals.negative.join('; ')}`,
          });
        } else if (adjustedScore < 75) {
          adjustedScore = 75;
          additionalFlags.push({
            type: 'BUNDLE',
            severity: 'HIGH',
            message: `${count} coordinated wallets - suspicious patterns: ${signals.negative.join('; ')}`,
          });
        }
      } else if (assessment === 'SUSPICIOUS') {
        // Moderate-risk bundle - reduced penalty
        if (adjustedScore < 65) {
          adjustedScore = 65;
          additionalFlags.push({
            type: 'BUNDLE',
            severity: 'MEDIUM',
            message: `${count} coordinated wallets with mixed signals`,
          });
        }
      } else if (assessment === 'NEUTRAL') {
        // Uncertain - minimal penalty
        if (adjustedScore < 55) {
          adjustedScore = 55;
          additionalFlags.push({
            type: 'BUNDLE',
            severity: 'LOW',
            message: `${count} wallets show coordination, intent unclear`,
          });
        }
      } else if (assessment === 'LIKELY_LEGIT') {
        // Likely legitimate - no penalty, add positive flag
        additionalFlags.push({
          type: 'BUNDLE',
          severity: 'LOW',
          message: `${count} coordinated wallets detected but show legitimacy signals: ${signals.positive.join('; ')}`,
        });
      }
    } else {
      // No quality assessment available - use original conservative approach
      if (confidence === 'HIGH' || txBundlePercent >= 25) {
        if (adjustedScore < 80) adjustedScore = 80;
        additionalFlags.push({
          type: 'BUNDLE',
          severity: 'CRITICAL',
          message: `${count} coordinated wallets detected - likely rug setup`,
        });
      } else if (confidence === 'MEDIUM' || count >= 5) {
        if (adjustedScore < 75) adjustedScore = 75;
        additionalFlags.push({
          type: 'BUNDLE',
          severity: 'HIGH',
          message: `${count} coordinated wallets detected - suspicious activity`,
        });
      } else if (count >= 3) {
        if (adjustedScore < 70) adjustedScore = 70;
      }
    }

    // Additional penalty based on dev status (only if bundle is suspicious)
    if (!bundleQuality || bundleQuality.assessment !== 'LIKELY_LEGIT') {
      if (!isCommunityOwned) {
        adjustedScore += 15; // Dev still active + bundles = HIGH risk
      } else {
        adjustedScore += 5; // Community-owned + bundles = lower concern
      }
    }
  }

  // ============================================
  // RULE 7B: WASH TRADING DETECTION
  // Bundle wallets creating fake buy pressure
  // ============================================
  const { washTrading } = data;

  if (washTrading && washTrading.detected) {
    const { washTradingPercent, bundleBuys, organicBuys, realBuyRatio } = washTrading;

    if (washTradingPercent >= 70) {
      // Severe wash trading - massive fake buy pressure
      if (adjustedScore < 85) adjustedScore = 85;
      additionalFlags.push({
        type: 'WASH_TRADING',
        severity: 'CRITICAL',
        message: `WASH TRADING: ${washTradingPercent.toFixed(0)}% of buys are bundle self-trades (${bundleBuys} fake, ${organicBuys} organic). Real buy ratio: ${realBuyRatio?.toFixed(2) || 'N/A'}`,
      });
    } else if (washTradingPercent >= 50) {
      // Significant wash trading
      if (adjustedScore < 80) adjustedScore = 80;
      additionalFlags.push({
        type: 'WASH_TRADING',
        severity: 'HIGH',
        message: `${washTradingPercent.toFixed(0)}% of buy volume is artificial — bundle wallets self-trading to inflate metrics`,
      });
    } else if (washTradingPercent >= 30) {
      // Moderate wash trading
      if (adjustedScore < 70) adjustedScore = 70;
      additionalFlags.push({
        type: 'WASH_TRADING',
        severity: 'MEDIUM',
        message: `${washTradingPercent.toFixed(0)}% of buys from coordinated wallets — possible wash trading`,
      });
    }
  }

  // ============================================
  // RULE 8: SINGLE WHALE CONCENTRATION
  // ============================================
  const isMatureToken = liquidityUsd > 100_000 || marketCapUsd > 10_000_000;

  if (!isMatureToken) {
    if (top1NonLpPercent >= 30) {
      if (adjustedScore < 80) adjustedScore = 80;
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'CRITICAL',
        message: `CRITICAL: Single wallet holds ${top1NonLpPercent.toFixed(1)}% - major dump risk`,
      });
    } else if (top1NonLpPercent >= 25) {
      if (adjustedScore < 75) adjustedScore = 75;
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'HIGH',
        message: `Single wallet holds ${top1NonLpPercent.toFixed(1)}% - high dump risk`,
      });
    } else if (top1NonLpPercent >= 15) {
      if (adjustedScore < 65) adjustedScore = 65;
    }
  }

  // ============================================
  // RULE 9: MATURITY OFFSET (CREDIT)
  // ============================================
  if (marketCapUsd >= 100_000_000 && ageInDays >= 30 && !hasKnownRugs) {
    if (adjustedScore > 35) {
      adjustedScore = 35;
      additionalFlags.push({
        type: 'CONTRACT',
        severity: 'LOW',
        message: `Established token ($${(marketCapUsd / 1_000_000).toFixed(1)}M MC) - score capped`,
      });
    }
  } else if (marketCapUsd >= 50_000_000 && ageInDays >= 14 && !hasKnownRugs) {
    if (adjustedScore > 45) adjustedScore = 45;
  } else if (marketCapUsd >= 10_000_000 && ageInDays >= 7 && !hasKnownRugs) {
    if (adjustedScore > 55) adjustedScore = 55;
  }

  // ============================================
  // RULE 10: GOOD FUNDAMENTALS CREDIT
  // ============================================
  const volume24h = tokenInfo.volume24h || 0;
  const txns24h = (tokenInfo.txns24h?.buys || 0) + (tokenInfo.txns24h?.sells || 0);

  let fundamentalsCredit = 0;
  if (liquidityUsd >= 100_000) fundamentalsCredit += 5;
  if (volume24h >= 1_000_000) fundamentalsCredit += 5;
  if (txns24h >= 10_000) fundamentalsCredit += 5;
  if (data.hasWebsite && data.hasTwitter && !hasKnownRugs) fundamentalsCredit += 5;

  if (fundamentalsCredit > 0 && !hasKnownRugs) {
    const maxCredit = Math.min(fundamentalsCredit, 15);
    if (adjustedScore - maxCredit >= 50) {
      adjustedScore -= maxCredit;
    } else if (adjustedScore > 50) {
      adjustedScore = 50;
    }
  }

  // ============================================
  // RULE 11: SECURITY FUNDAMENTALS CAP
  // ============================================
  const hasRevokedAuth = !tokenInfo.mintAuthorityActive && !tokenInfo.freezeAuthorityActive;
  const hasLockedLP = liquidityUsd > 0 && tokenInfo.lpLockedPct !== undefined && tokenInfo.lpLockedPct > 50;
  const hasGoodLPAmount = liquidityUsd >= 25_000;

  if (hasRevokedAuth && (hasLockedLP || hasGoodLPAmount)) {
    if (adjustedScore > 75) {
      console.log(`[Rules] Security cap: revoked auth + LP protection caps score at 75 (was ${adjustedScore})`);
      adjustedScore = 75;
      additionalFlags.push({
        type: 'SECURITY',
        severity: 'LOW',
        message: 'Revoked authorities and LP protection limit downside risk',
      });
    }
  } else if (hasRevokedAuth && liquidityUsd >= 10_000) {
    if (adjustedScore > 80) {
      console.log(`[Rules] Security cap: revoked auth caps score at 80 (was ${adjustedScore})`);
      adjustedScore = 80;
    }
  }

  // ============================================
  // RULE 12: COMMUNITY-OWNED TOKEN CAP
  // ============================================
  if (isCommunityOwned) {
    let positiveSignals = 0;
    if (data.hasWebsite || data.hasTwitter) positiveSignals++;
    if (top1NonLpPercent < 10 && top10NonLpPercent >= 10) positiveSignals++;
    if (liquidityUsd >= 25000) positiveSignals++;
    if (!tokenInfo.mintAuthorityActive && !tokenInfo.freezeAuthorityActive) positiveSignals++;

    if (positiveSignals >= 3 && adjustedScore > 50) {
      adjustedScore = 50;
    } else if (positiveSignals >= 2 && adjustedScore > 55) {
      adjustedScore = 55;
    } else if (positiveSignals >= 1 && adjustedScore > 65) {
      adjustedScore = 65;
    }
  }

  // ============================================
  // DETERMINE FINAL RISK LEVEL
  // Updated thresholds based on backtest (catches 80% of rugs)
  // ============================================
  let adjustedLevel: string;
  if (adjustedScore >= 80) {
    adjustedLevel = 'SCAM';
  } else if (adjustedScore >= 65) {
    adjustedLevel = 'DANGEROUS';  // Was 70
  } else if (adjustedScore >= 55) {
    adjustedLevel = 'SUSPICIOUS'; // Was 50
  } else {
    adjustedLevel = 'SAFE';
  }

  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  const existingMessages = new Set(result.flags.map(f => f.message));
  const newFlags = additionalFlags.filter(f => !existingMessages.has(f.message));

  console.log(`[Rules] Score adjustment: ${result.riskScore} → ${adjustedScore} (${result.riskLevel} → ${adjustedLevel})`);

  return {
    ...result,
    riskScore: adjustedScore,
    riskLevel: adjustedLevel,
    flags: [...newFlags, ...result.flags],
  };
}

const sentinelRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Fetch top token holders using Helius RPC
 */
async function fetchTopHolders(
  tokenAddress: string,
  apiKey: string,
  limit: number = 20,
  knownLpAddresses: string[] = []
): Promise<HolderInfo[]> {
  const knownLpSet = new Set(knownLpAddresses.map(a => a.toLowerCase()));
  try {
    const response = await fetch(`${HELIUS_RPC_BASE}/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-largest-accounts',
        method: 'getTokenLargestAccounts',
        params: [tokenAddress],
      }),
    });

    if (!response.ok) {
      console.warn('[Sentinel] Failed to fetch largest accounts');
      return [];
    }

    const data = await response.json() as {
      result?: {
        value?: Array<{
          address: string;
          amount: string;
          decimals: number;
          uiAmount: number;
        }>;
      };
    };

    const accounts = data.result?.value || [];
    if (accounts.length === 0) return [];

    const totalBalance = accounts.reduce((sum, acc) => sum + acc.uiAmount, 0);

    const holders: HolderInfo[] = [];

    const accountAddresses = accounts.slice(0, limit).map(a => a.address);

    const infoResponse = await fetch(`${HELIUS_RPC_BASE}/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-account-info',
        method: 'getMultipleAccounts',
        params: [accountAddresses, { encoding: 'jsonParsed' }],
      }),
    });

    if (infoResponse.ok) {
      const infoData = await infoResponse.json() as {
        result?: {
          value?: Array<{
            data?: {
              parsed?: {
                info?: {
                  owner?: string;
                  tokenAmount?: {
                    uiAmount?: number;
                  };
                };
              };
            };
          } | null>;
        };
      };

      const accountInfos = infoData.result?.value || [];

      for (let i = 0; i < accountInfos.length; i++) {
        const info = accountInfos[i];
        const originalAccount = accounts[i];

        if (info?.data?.parsed?.info?.owner) {
          const owner = info.data.parsed.info.owner;
          const tokenAccountAddress = originalAccount.address;
          const balance = info.data.parsed.info.tokenAmount?.uiAmount || originalAccount.uiAmount;
          const percent = (balance / totalBalance) * 100;

          const isLp = LP_PREFIXES.some(prefix => owner.startsWith(prefix)) ||
            LP_PREFIXES.some(prefix => tokenAccountAddress.startsWith(prefix)) ||
            owner.toLowerCase().includes('pool') ||
            tokenAccountAddress.toLowerCase().includes('pool') ||
            knownLpSet.has(owner.toLowerCase()) ||
            knownLpSet.has(tokenAccountAddress.toLowerCase())

          if (isLp) {
            console.log(`[Sentinel] Detected LP: owner=${owner.slice(0,8)}, tokenAcc=${tokenAccountAddress.slice(0,8)}, ${percent.toFixed(1)}%`);
          }

          holders.push({
            address: owner,
            balance,
            percent,
            isLp,
          });
        }
      }
    }

    return holders;
  } catch (error) {
    console.error('[Sentinel] Error fetching holders:', error);
    return [];
  }
}

/**
 * Build network graph from token data
 */
function buildNetworkGraph(
  tokenAddress: string,
  tokenSymbol: string,
  creatorAddress: string | null,
  holders: HolderInfo[],
  creatorHoldingsPercent: number
): NetworkData {
  const nodes: WalletNode[] = [];
  const links: WalletLink[] = [];
  const addedNodes = new Set<string>();

  nodes.push({
    id: tokenAddress,
    address: tokenAddress,
    label: tokenSymbol || 'TOKEN',
    type: 'token',
  });
  addedNodes.add(tokenAddress);

  if (creatorAddress && !addedNodes.has(creatorAddress)) {
    nodes.push({
      id: creatorAddress,
      address: creatorAddress,
      label: 'Creator',
      type: 'creator',
      holdingsPercent: creatorHoldingsPercent,
      isHighRisk: creatorHoldingsPercent > 10,
    });
    addedNodes.add(creatorAddress);

    links.push({
      source: creatorAddress,
      target: tokenAddress,
      type: 'created',
      value: 3,
    });
  }

  for (const holder of holders) {
    if (holder.address === creatorAddress) continue;
    if (addedNodes.has(holder.address)) continue;

    let type: WalletNode['type'] = 'normal';
    if (holder.percent > 10) {
      type = 'whale';
    } else if (holder.percent > 5) {
      type = 'insider';
    }

    if (holder.isLp) {
      type = 'lp';
    }

    const isHighRisk = holder.percent > 5 && type !== 'lp';

    nodes.push({
      id: holder.address,
      address: holder.address,
      label: `${holder.address.slice(0, 4)}...${holder.address.slice(-4)}`,
      type,
      holdingsPercent: holder.percent,
      isHighRisk,
    });
    addedNodes.add(holder.address);

    links.push({
      source: holder.address,
      target: tokenAddress,
      type: 'holds',
      value: Math.max(1, holder.percent / 5),
    });
  }

  return { nodes, links };
}

/**
 * Generate actionable recommendation based on risk score and bundle detection
 */
function generateRecommendation(riskScore: number, bundleDetected: boolean, bundleCount: number): string {
  if (riskScore >= 80 || (bundleDetected && bundleCount >= 10)) {
    const bundleNote = bundleDetected ? ` (${bundleCount} coordinated wallets detected)` : '';
    return `AVOID${bundleNote}. Critical risk indicators present. Do not invest. If holding, exit immediately.`;
  }
  if (riskScore >= 70 || (bundleDetected && bundleCount >= 5)) {
    const bundleNote = bundleDetected ? ` ${bundleCount} bundled wallets indicate coordinated activity.` : '';
    return `HIGH RISK.${bundleNote} If you must trade, use max 0.1 SOL and set tight stop-loss at -20%. Expect sudden 50%+ price drops.`;
  }
  if (riskScore >= 60 || bundleDetected) {
    const bundleNote = bundleDetected ? ` ${bundleCount} wallets show coordination.` : '';
    return `ELEVATED RISK.${bundleNote} Trade with caution. Set stop losses and take profits at 2x. Position size: max 0.2 SOL.`;
  }
  if (riskScore >= 40) {
    return `CAUTION (${riskScore}/100). Risk factors detected. DYOR before entry. Use smaller position sizes and set stop-loss at -30%.`;
  }
  return `LOWER RISK (${riskScore}/100). No critical red flags detected. Standard memecoin volatility expected. Always DYOR.`;
}

/**
 * @deprecated - This function used Together AI which has been removed.
 * All analysis now uses LocalBitNetProvider (rule-based, $0 cost).
 * Keeping for reference but this function is never called.
 */
async function generateNetworkAnalysis_DEPRECATED(
  tokenInfo: {
    name: string;
    symbol: string;
    address: string;
    marketCap?: number;
    liquidity?: number;
    age?: number;
    ageHours?: number;
    volume24h?: number;
    priceChange24h?: number;
    txns24h?: { buys: number; sells: number };
    txns1h?: { buys: number; sells: number };
    mintAuthorityActive?: boolean;
    freezeAuthorityActive?: boolean;
    holderCount?: number;
  },
  network: NetworkData,
  creatorInfo: {
    address: string;
    walletAge: number;
    tokensCreated: number;
    ruggedTokens: number;
    currentHoldings: number;
  } | null,
  bundleInfo: {
    detected: boolean;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    count: number;
    txBundlePercent?: number;
    suspiciousPatterns?: string[];
    description?: string;
  },
  bundleQuality: BundleQuality | undefined,
  devActivity: {
    hasSold: boolean;
    percentSold: number;
    sellCount: number;
    currentHoldingsPercent: number;
    severity: string;
    message: string;
  } | null,
  apiKey: string,
  model: string
): Promise<{
  riskScore: number;
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  summary: string;
  prediction: string;
  recommendation: string;
  flags: Array<{ type: string; severity: string; message: string }>;
  networkInsights: string[];
}> {
  const whales = network.nodes.filter(n => n.type === 'whale');
  const insiders = network.nodes.filter(n => n.type === 'insider');
  const highRiskNodes = network.nodes.filter(n => n.isHighRisk);

  let context = `SENTINEL NETWORK ANALYSIS REQUEST

TOKEN INFO:
- Name: ${tokenInfo.name || 'Unknown'}
- Symbol: ${tokenInfo.symbol || 'Unknown'}
- Address: ${tokenInfo.address}
${tokenInfo.marketCap ? `- Market Cap: $${tokenInfo.marketCap.toLocaleString()}` : ''}
${tokenInfo.liquidity ? `- Liquidity: $${tokenInfo.liquidity.toLocaleString()}` : ''}
${tokenInfo.ageHours !== undefined ? (tokenInfo.ageHours < 24 ? `- Age: ${tokenInfo.ageHours.toFixed(1)} hours ⚠️ VERY NEW` : `- Age: ${tokenInfo.age} days`) : ''}
${tokenInfo.volume24h ? `- 24h Volume: $${tokenInfo.volume24h.toLocaleString()}` : ''}
${tokenInfo.priceChange24h !== undefined ? `- 24h Price Change: ${tokenInfo.priceChange24h > 0 ? '+' : ''}${tokenInfo.priceChange24h.toFixed(1)}%` : ''}
${tokenInfo.txns24h ? `- 24h Transactions: ${tokenInfo.txns24h.buys} buys / ${tokenInfo.txns24h.sells} sells (ratio: ${tokenInfo.txns24h.sells > 0 ? (tokenInfo.txns24h.buys / tokenInfo.txns24h.sells).toFixed(2) : 'N/A'})` : ''}
${tokenInfo.txns1h ? `- 1h Transactions: ${tokenInfo.txns1h.buys} buys / ${tokenInfo.txns1h.sells} sells` : ''}

SECURITY:
- Mint Authority: ${tokenInfo.mintAuthorityActive ? '⚠️ ACTIVE (can mint more tokens)' : 'REVOKED ✓'}
- Freeze Authority: ${tokenInfo.freezeAuthorityActive ? '🚨 ACTIVE (can freeze/close accounts — HIGH rug risk)' : 'REVOKED ✓'}

NETWORK SUMMARY:
- Total Nodes: ${network.nodes.length}
- Whales (>10%): ${whales.length}
- Insiders (5-10%): ${insiders.length}
- High Risk Nodes: ${highRiskNodes.length}

WHALE HOLDINGS:
${whales.map(w => `- ${w.label}: ${w.holdingsPercent?.toFixed(2)}%`).join('\n') || '- None detected'}

`;

  // Add bundle detection with quality assessment
  if (bundleInfo.detected || bundleInfo.confidence === 'LOW') {
    if (bundleQuality) {
      context += `\n⚠️ BUNDLE DETECTED - ${bundleInfo.confidence} CONFIDENCE:\n`;
      context += `- ${bundleInfo.count} coordinated wallets\n`;
      context += `- Quality Assessment: ${bundleQuality.assessment}\n`;
      context += `- Legitimacy Score: ${bundleQuality.legitimacyScore}/100\n`;
      
      if (bundleQuality.signals.positive.length > 0) {
        context += `\nPositive Signals:\n`;
        bundleQuality.signals.positive.forEach(signal => {
          context += `  ✓ ${signal}\n`;
        });
      }
      
      if (bundleQuality.signals.negative.length > 0) {
        context += `\nNegative Signals:\n`;
        bundleQuality.signals.negative.forEach(signal => {
          context += `  ⚠️ ${signal}\n`;
        });
      }
      
      if (bundleQuality.assessment === 'LIKELY_LEGIT') {
        context += `\nThis bundle shows signs of legitimate coordination (VCs, team allocation, etc.)\n`;
        context += `Reduce bundle-related risk penalties significantly.\n`;
      } else if (bundleQuality.assessment === 'VERY_SUSPICIOUS') {
        context += `\nThis bundle shows strong signs of malicious coordination (rug setup)\n`;
        context += `Apply maximum bundle-related risk penalties.\n`;
      }
    } else {
      // No quality assessment available
      if (bundleInfo.confidence === 'HIGH') {
        context += `\n⚠️ BUNDLE DETECTED - HIGH CONFIDENCE:\n`;
        context += `- ${bundleInfo.count} coordinated wallets CONFIRMED via same-block transactions\n`;
      } else if (bundleInfo.confidence === 'MEDIUM') {
        context += `\n⚠️ BUNDLE DETECTED - MEDIUM CONFIDENCE:\n`;
        context += `- ${bundleInfo.count} wallets show coordination patterns\n`;
      } else if (bundleInfo.confidence === 'LOW') {
        context += `\nℹ️ POSSIBLE BUNDLE - LOW CONFIDENCE:\n`;
        context += `- Some wallets have similar holdings\n`;
      }
    }
    
    if (bundleInfo.txBundlePercent && bundleInfo.txBundlePercent > 0) {
      context += `- ${bundleInfo.txBundlePercent.toFixed(1)}% of buys from bundled transactions\n`;
    }
    if (bundleInfo.description) {
      context += `\nDetails: ${bundleInfo.description}\n`;
    }
    if (bundleInfo.suspiciousPatterns && bundleInfo.suspiciousPatterns.length > 0) {
      context += `\nSuspicious Patterns:\n`;
      bundleInfo.suspiciousPatterns.forEach(pattern => {
        context += `- ⚠️ ${pattern}\n`;
      });
    }
    context += '\n';
  }

  if (creatorInfo) {
    context += `
CREATOR ANALYSIS:
- Wallet Age: ${creatorInfo.walletAge} days
- Tokens Created: ${creatorInfo.tokensCreated}
- Previous Rugs: ${creatorInfo.ruggedTokens}
- Current Holdings: ${creatorInfo.currentHoldings.toFixed(2)}%
`;

    if (creatorInfo.ruggedTokens > 0) {
      context += `\n⚠️ CRITICAL: Creator has ${creatorInfo.ruggedTokens} previous rugged tokens!\n`;
    }
  }

  if (devActivity) {
    context += `\nDEV WALLET ACTIVITY:\n`;
    if (devActivity.hasSold) {
      context += `- Dev has SOLD ${devActivity.percentSold.toFixed(0)}% of their tokens (${devActivity.sellCount} sell transactions)\n`;
      context += `- Dev currently holds ${devActivity.currentHoldingsPercent.toFixed(1)}% of supply\n`;
      context += `- Severity: ${devActivity.severity}\n`;
      context += `- Assessment: ${devActivity.message}\n`;

      if (devActivity.percentSold >= 90 && devActivity.currentHoldingsPercent < 1) {
        context += `  ⚠️ Dev has almost completely exited - could be community-owned OR abandoned\n`;
      } else if (devActivity.percentSold >= 50 && devActivity.currentHoldingsPercent > 5) {
        context += `  ⚠️ Dev sold majority but still holds enough to dump\n`;
      } else if (devActivity.percentSold >= 50) {
        context += `  ⚠️ Dev has been actively selling - reduced dump risk going forward\n`;
      }
    } else {
      context += `- Dev has NOT sold any tokens\n`;
      context += `- Dev currently holds ${devActivity.currentHoldingsPercent.toFixed(1)}% of supply\n`;
      if (devActivity.currentHoldingsPercent > 20) {
        context += `  ⚠️ Dev still holds large position - dump risk exists\n`;
      }
    }
  }

  const systemPrompt = `You are Sentinel, an AI that analyzes Solana token wallet networks to predict pump & dump schemes.

Analyze the provided network data and return a JSON response with:
1. riskScore (0-100): Overall risk based on network patterns
2. riskLevel: SAFE (<40), SUSPICIOUS (40-59), DANGEROUS (60-79), or SCAM (80+)
3. summary: 1-2 sentence risk summary WITH SPECIFIC VALUES
4. prediction: Your prediction of what will likely happen
5. flags: Array of {type, severity, message} for specific risks
6. networkInsights: Array of strings with observations

CRITICAL: When bundle quality assessment is provided, TRUST IT:
- "LIKELY_LEGIT" bundle = Reduce risk penalties significantly, this may be VCs/team
- "VERY_SUSPICIOUS" bundle = Apply maximum risk penalties, this is a rug setup
- "NEUTRAL" or "SUSPICIOUS" = Moderate concern, weigh against other signals

RETURN ONLY VALID JSON, no markdown or explanation.`;

  try {
    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const rawContent = data.choices?.[0]?.message?.content || '';

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      let score = Math.max(0, Math.min(100, parsed.riskScore || 50));

      let riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM' = 'SAFE';
      if (score >= 80) riskLevel = 'SCAM';
      else if (score >= 60) riskLevel = 'DANGEROUS';
      else if (score >= 40) riskLevel = 'SUSPICIOUS';

      return {
        riskScore: score,
        riskLevel,
        summary: parsed.summary || 'Analysis completed.',
        prediction: parsed.prediction || 'Unable to predict.',
        recommendation: generateRecommendation(score, bundleInfo.detected, bundleInfo.count),
        flags: parsed.flags || [],
        networkInsights: parsed.networkInsights || [],
      };
    }
  } catch (error) {
    console.error('[Sentinel] AI analysis error:', error);
  }

  // Fallback
  let riskScore = 30;
  const flags: Array<{ type: string; severity: string; message: string }> = [];
  const networkInsights: string[] = [];

  if (bundleInfo.detected) {
    if (bundleQuality?.assessment === 'VERY_SUSPICIOUS') {
      riskScore += 35;
      flags.push({
        type: 'BUNDLE',
        severity: 'CRITICAL',
        message: `${bundleInfo.count} coordinated wallets - HIGH RUG RISK: ${bundleQuality.signals.negative.join('; ')}`,
      });
    } else if (bundleQuality?.assessment === 'SUSPICIOUS') {
      riskScore += 20;
      flags.push({
        type: 'BUNDLE',
        severity: 'HIGH',
        message: `${bundleInfo.count} coordinated wallets with suspicious patterns`,
      });
    } else if (bundleQuality?.assessment === 'LIKELY_LEGIT') {
      riskScore += 5;
      flags.push({
        type: 'BUNDLE',
        severity: 'LOW',
        message: `${bundleInfo.count} coordinated wallets show legitimacy signals: ${bundleQuality.signals.positive.join('; ')}`,
      });
    } else {
      // No quality assessment
      riskScore += 25;
      flags.push({
        type: 'BUNDLE',
        severity: 'HIGH',
        message: `${bundleInfo.count} coordinated wallets detected`,
      });
    }
  }

  if (whales.length > 0) {
    const topWhale = whales.reduce((max, w) =>
      (w.holdingsPercent || 0) > (max.holdingsPercent || 0) ? w : max
    , whales[0]);
    const topWhalePercent = topWhale?.holdingsPercent || 0;

    if (topWhalePercent >= 50) {
      riskScore += 50;
      flags.push({
        type: 'CONCENTRATED HOLDINGS',
        severity: 'CRITICAL',
        message: `🚨 CRITICAL: One whale holds ${topWhalePercent.toFixed(2)}% of total supply`,
      });
    } else if (topWhalePercent >= 30) {
      riskScore += 30;
      flags.push({
        type: 'CONCENTRATED HOLDINGS',
        severity: 'HIGH',
        message: `One whale holds ${topWhalePercent.toFixed(2)}% of total supply`,
      });
    } else {
      riskScore += whales.length * 10;
      flags.push({
        type: 'CONCENTRATION',
        severity: 'HIGH',
        message: `${whales.length} wallet(s) hold >10% of supply`,
      });
    }
  }

  if (creatorInfo?.ruggedTokens && creatorInfo.ruggedTokens > 0) {
    riskScore += 40;
    flags.push({
      type: 'DEPLOYER',
      severity: 'CRITICAL',
      message: `Creator has ${creatorInfo.ruggedTokens} previous rugged tokens`,
    });
  }

  networkInsights.push(`${network.nodes.length} wallets in network`);
  if (whales.length > 0) {
    networkInsights.push(`Top whale holds ${whales[0]?.holdingsPercent?.toFixed(1)}%`);
  }

  riskScore = Math.min(100, riskScore);

  let riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM' = 'SAFE';
  if (riskScore >= 80) riskLevel = 'SCAM';
  else if (riskScore >= 60) riskLevel = 'DANGEROUS';
  else if (riskScore >= 40) riskLevel = 'SUSPICIOUS';

  return {
    riskScore,
    riskLevel,
    summary: `Network analysis reveals ${flags.length > 0 ? 'concerning patterns' : 'normal distribution'}.`,
    prediction: riskScore > 60
      ? 'High probability of coordinated dump based on network structure.'
      : 'Network appears relatively distributed. Monitor for changes.',
    recommendation: generateRecommendation(riskScore, bundleInfo.detected, bundleInfo.count),
    flags,
    networkInsights,
  };
}

// Main analysis endpoint
sentinelRoutes.post('/analyze', async (c) => {
  try {
    const body = await c.req.json<{ tokenAddress: string }>();
    const { tokenAddress } = body;

    if (!tokenAddress || tokenAddress.length < 32) {
      return c.json({ error: 'Invalid token address' }, 400);
    }

    // Rate limiting
    const clientIP = getClientIP(c.req.raw);
    const walletAddress = c.req.header('X-Wallet-Address') || null;
    const rateLimitIdentifier = walletAddress || clientIP;

    const { tier } = await getUserTier(
      walletAddress,
      c.env.ARGUSGUARD_MINT,
      c.env.HELIUS_API_KEY,
      c.env.SUPABASE_URL || '',
      c.env.SUPABASE_ANON_KEY || ''
    );

    // Admin bypass for backfill/training
    const authHeader = c.req.header('Authorization');
    const isAdmin = authHeader && c.env.ADMIN_SECRET && authHeader.replace('Bearer ', '') === c.env.ADMIN_SECRET;

    const rateLimitResult = isAdmin
      ? { allowed: true, tier: 'pro' as const, remaining: Infinity, limit: Infinity, resetAt: 0 }
      : await checkRateLimit(c.env.SCAN_CACHE, rateLimitIdentifier, tier);

    if (!rateLimitResult.allowed) {
      return c.json({
        error: rateLimitResult.error,
        remaining: 0,
        limit: rateLimitResult.limit,
        resetAt: rateLimitResult.resetAt,
      }, 429);
    }

    // Helius key no longer used — all data comes from on-chain sources
    // const heliusKey = c.env.HELIUS_API_KEY;

    // All modes now use pure on-chain data
    // LEGACY mode is deprecated and falls through to ON_CHAIN
    const dataMode = c.env.DATA_PROVIDER_MODE || 'ON_CHAIN';
    const aiMode = 'local-bitnet';

    // ============================================
    // PURE ON-CHAIN MODE - Zero External Dependencies
    // All external APIs (DexScreener, Helius, RugCheck) removed
    // ============================================
    // Always use on-chain data regardless of DATA_PROVIDER_MODE
    // The mode setting is kept for backwards compatibility but has no effect
    console.log(`[Sentinel] Using pure ON_CHAIN mode with ${aiMode} AI (requested: ${dataMode})`);
      const fetchStart = Date.now();

      // Use on-chain data fetcher — no external API calls
      const dataFetcher = createSentinelDataFetcher(c.env);
      const data = await dataFetcher.fetchData(tokenAddress);

      console.log(`[Sentinel] On-chain fetch took ${data.fetchDuration}ms`);

      // Extract compressed features for efficient inference
      const compressedFeatures = extractFromSentinelData(data);
      const featureVector = toFeatureVector(compressedFeatures);
      const memSize = getFeatureMemorySize();
      console.log(`[Sentinel] Compressed features: ${featureVector.length} floats (${memSize.vector} bytes vs ~2MB raw)`);
      console.log(`[Sentinel] Feature summary: ${getFeatureSummary(compressedFeatures)}`);

      // Always use local BitNet for structural scoring
      // Deep AI reasoning happens on the agents server via Ollama
      const aiProvider = new LocalBitNetProvider();

      // Convert to AI input format
      const holders = data.holders.map(h => ({
        percent: h.percent,
        isWhale: h.percent > 10,
      }));

      const aiInput = convertToAnalysisInput(
        {
          name: data.tokenInfo.name,
          symbol: data.tokenInfo.symbol,
          address: tokenAddress,
          marketCap: data.tokenInfo.marketCap,
          liquidity: data.tokenInfo.liquidity,
          ageHours: data.tokenInfo.ageHours,
          volume24h: data.tokenInfo.volume24h,
          priceChange24h: data.tokenInfo.priceChange24h,
          txns24h: data.tokenInfo.txns24h,
          txns1h: data.tokenInfo.txns1h,
          mintAuthorityActive: data.tokenInfo.mintAuthorityActive,
          freezeAuthorityActive: data.tokenInfo.freezeAuthorityActive,
          holderCount: data.tokenInfo.holderCount,
        },
        holders,
        {
          detected: data.bundleInfo.detected,
          count: data.bundleInfo.count,
          confidence: data.bundleInfo.confidence,
        },
        {
          legitimacyScore: 50,
          assessment: data.bundleInfo.confidence === 'HIGH' ? 'VERY_SUSPICIOUS' : 'NEUTRAL',
        },
        data.creatorInfo,
        data.devActivity,
        null, // washTrading - can be added later
        0, // avgBundleWalletAge
        Math.min(data.bundleInfo.controlPercent || 0, 100) // Use actual control %, capped at 100%
      );

      // Run AI analysis
      const aiStart = Date.now();
      const aiResult = await aiProvider.analyze(aiInput);
      console.log(`[Sentinel] AI analysis (${aiProvider.getName()}) took ${Date.now() - aiStart}ms`);

      // Apply structural guardrails
      let finalScore = aiResult.riskScore;
      let finalLevel = aiResult.riskLevel;

      // Guardrail: Very new tokens with low liquidity
      if ((data.tokenInfo.ageHours ?? 24) < 6 && (data.tokenInfo.liquidity ?? 0) < 10000) {
        finalScore = Math.max(finalScore, 50);
      }
      if ((data.tokenInfo.ageHours ?? 24) < 24 && (data.tokenInfo.liquidity ?? 0) < 5000) {
        finalScore = Math.max(finalScore, 50);
      }
      if ((data.tokenInfo.ageHours ?? 24) < 6) {
        finalScore = Math.max(finalScore, 35);
      }
      if ((data.tokenInfo.liquidity ?? 0) < 5000) {
        finalScore = Math.max(finalScore, 40);
      }

      // Update risk level based on final score
      // Updated thresholds based on backtest (catches 80% of rugs)
      if (finalScore >= 80) finalLevel = 'SCAM';
      else if (finalScore >= 65) finalLevel = 'DANGEROUS';  // Was 60
      else if (finalScore >= 55) finalLevel = 'SUSPICIOUS'; // Was 40
      else finalLevel = 'SAFE';

      // Build response
      const response = {
        tokenInfo: {
          name: data.tokenInfo.name,
          symbol: data.tokenInfo.symbol,
          address: tokenAddress,
          price: data.tokenInfo.price,
          marketCap: data.tokenInfo.marketCap,
          liquidity: data.tokenInfo.liquidity,
          age: data.tokenInfo.age,
          ageHours: data.tokenInfo.ageHours,
          holderCount: data.tokenInfo.holderCount,
          priceChange24h: data.tokenInfo.priceChange24h,
          volume24h: data.tokenInfo.volume24h,
          txns5m: data.tokenInfo.txns5m,
          txns1h: data.tokenInfo.txns1h,
          txns24h: data.tokenInfo.txns24h,
        },
        security: {
          mintAuthorityActive: data.tokenInfo.mintAuthorityActive,
          freezeAuthorityActive: data.tokenInfo.freezeAuthorityActive,
          lpLockedPct: data.tokenInfo.lpLockedPct,
        },
        analysis: {
          riskScore: finalScore,
          riskLevel: finalLevel,
          summary: aiResult.summary,
          prediction: aiResult.prediction,
          recommendation: aiResult.recommendation,
          flags: aiResult.flags,
        },
        holderDistribution: data.holders.slice(0, 10).map(h => {
          let type: 'creator' | 'whale' | 'insider' | 'lp' | 'normal' = 'normal';
          if (h.address === data.creatorAddress) type = 'creator';
          else if (h.isLp) type = 'lp';
          else if (h.percent > 10) type = 'whale';
          else if (h.percent > 5) type = 'insider';
          return {
            address: h.address,
            percent: h.percent,
            type,
          };
        }),
        bundleInfo: {
          detected: data.bundleInfo.detected,
          confidence: data.bundleInfo.confidence,
          count: data.bundleInfo.count,
          txBundlePercent: data.bundleInfo.txBundlePercent,
          description: data.bundleInfo.description,
          wallets: data.bundleInfo.wallets || [],
          controlPercent: data.bundleInfo.controlPercent || 0,
          walletsWithHoldings: data.bundleInfo.walletsWithHoldings || [],
        },
        creatorInfo: data.creatorInfo,
        network: { nodes: [], links: [] },
        dataSource: data.dataSource,
        aiProvider: aiProvider.getName(),
        fetchDuration: Date.now() - fetchStart,
      };

      // Set rate limit headers
      c.header('X-RateLimit-Limit', rateLimitResult.limit.toString());
      c.header('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
      c.header('X-RateLimit-Reset', rateLimitResult.resetAt.toString());
      c.header('X-User-Tier', tier);

      // Agent events now come from the real agents server via WorkersSync
      // No fake simulated conversations needed here

      return c.json(response);

    // ============================================
    // LEGACY MODE REMOVED - All external APIs deprecated
    // The following code has been removed:
    // - DexScreener API calls
    // - Helius API calls
    // - RugCheck API calls
    // All data now comes from pure on-chain sources via SentinelDataFetcher
    // ============================================

  } catch (error) {
    console.error('[Sentinel] Analysis error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      500
    );
  }
});

export { sentinelRoutes };