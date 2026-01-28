import { Hono } from 'hono';
import type { Bindings } from '../index';
import { fetchHeliusTokenMetadata, analyzeTokenTransactions, analyzeDevSelling } from '../services/helius';
import { fetchDexScreenerData } from '../services/dexscreener';
import { postTweet, formatAlertTweet, canTweet, recordTweet, type TwitterConfig } from '../services/twitter';
import { sendMessage, formatAlertHtml } from '../services/telegram';
import { checkRateLimit, getUserTier, getClientIP } from '../services/rate-limit';
// Pump.fun API disabled (Cloudflare 1016 error)
// import { fetchPumpFunData, isPumpFunToken } from '../services/pumpfun';

const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1';

interface RugCheckReport {
  markets?: Array<{
    pubkey: string;
    marketType: string;
    lpLockedPct?: number;
    lp?: {
      lpLockedPct: number;
    };
  }>;
}

/**
 * Fetch LP lock data from RugCheck API (free, no API key needed)
 */
async function fetchRugCheckData(tokenAddress: string): Promise<{ lpLockedPct: number } | null> {
  try {
    const response = await fetch(`${RUGCHECK_API}/tokens/${tokenAddress}/report`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.log(`[RugCheck] Failed to fetch for ${tokenAddress.slice(0, 8)}... - ${response.status}`);
      return null;
    }

    const data = await response.json() as RugCheckReport;

    // LP locked percentage can be in markets[0].lp.lpLockedPct or markets[0].lpLockedPct
    const market = data.markets?.[0];
    const lpLockedPct = market?.lp?.lpLockedPct ?? market?.lpLockedPct ?? 0;

    console.log(`[RugCheck] ${tokenAddress.slice(0, 8)}... - LP Locked: ${lpLockedPct.toFixed(1)}%`);

    return { lpLockedPct };
  } catch (error) {
    console.error('[RugCheck] Error:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

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

  const { tokenInfo, holders, creatorInfo, bundleInfo, devActivity, isPumpFun } = data;
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
  // RULE 4: AUTHORITY RISKS
  // ============================================
  if (tokenInfo.mintAuthorityActive) {
    if (adjustedScore < 50) adjustedScore = 50;
  }
  if (tokenInfo.freezeAuthorityActive) {
    if (adjustedScore < 55) adjustedScore = 55;
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
  // RULE 7: BUNDLE DETECTION PENALTY
  // ============================================
  if (bundleInfo.detected) {
    const { confidence, count, txBundlePercent } = bundleInfo;

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

    // Additional penalty based on dev status
    if (!isCommunityOwned) {
      adjustedScore += 15; // Dev still active + bundles = HIGH risk
    } else {
      adjustedScore += 5; // Community-owned + bundles = lower concern
    }
  }

  // ============================================
  // RULE 8: SINGLE WHALE CONCENTRATION
  // ============================================
  // Only apply to non-mature tokens
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
  // Large established tokens should have score capped
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

  // Apply credit (max 15 reduction, floor at 50)
  if (fundamentalsCredit > 0 && !hasKnownRugs) {
    const maxCredit = Math.min(fundamentalsCredit, 15);
    if (adjustedScore - maxCredit >= 50) {
      adjustedScore -= maxCredit;
    } else if (adjustedScore > 50) {
      adjustedScore = 50;
    }
  }

  // ============================================
  // RULE 11: COMMUNITY-OWNED TOKEN CAP
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
  // ============================================
  let adjustedLevel: string;
  if (adjustedScore >= 90) {
    adjustedLevel = 'SCAM';
  } else if (adjustedScore >= 70) {
    adjustedLevel = 'DANGEROUS';
  } else if (adjustedScore >= 50) {
    adjustedLevel = 'SUSPICIOUS';
  } else {
    adjustedLevel = 'SAFE';
  }

  // Ensure score is within bounds
  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  // Merge flags (avoid duplicates)
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
  // Create a set of known LP addresses for quick lookup
  const knownLpSet = new Set(knownLpAddresses.map(a => a.toLowerCase()));
  try {
    // Get token largest accounts
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

    // Calculate total from top accounts for percentage
    const totalBalance = accounts.reduce((sum, acc) => sum + acc.uiAmount, 0);

    // Get owner addresses for these token accounts
    const holders: HolderInfo[] = [];

    // Batch fetch account info
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

          // Detect LP by checking BOTH owner and token account address for LP patterns
          // Token account address is what getTokenLargestAccounts returns
          // Owner is who controls that account
          // IMPORTANT: Do NOT mark high % holders as LP - that's the bug!
          // High % holders could be whales or deployers, which are HIGH RISK
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

  // Token node (center)
  nodes.push({
    id: tokenAddress,
    address: tokenAddress,
    label: tokenSymbol || 'TOKEN',
    type: 'token',
  });
  addedNodes.add(tokenAddress);

  // Creator node
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

  // Holder nodes
  for (const holder of holders) {
    // Skip if it's the creator (already added)
    if (holder.address === creatorAddress) continue;
    if (addedNodes.has(holder.address)) continue;

    // Determine node type based on holdings
    let type: WalletNode['type'] = 'normal';
    if (holder.percent > 10) {
      type = 'whale';
    } else if (holder.percent > 5) {
      type = 'insider';
    }

    // Use the isLp flag from holder detection
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
    return '🚨 AVOID. This token shows critical red flags. Do not invest. If holding, exit immediately.';
  }
  if (riskScore >= 70 || (bundleDetected && bundleCount >= 5)) {
    return '⚠️ AVOID or EXIT. High probability of coordinated dump. If you must trade, use tight stop losses and expect sudden price crashes.';
  }
  if (riskScore >= 60 || bundleDetected) {
    return '⚠️ CAUTION. Suspicious patterns detected. Trade with extreme care. Set stop losses and take profits early.';
  }
  if (riskScore >= 40) {
    return '⚡ MODERATE RISK. Some concerns detected. DYOR and monitor closely. Consider smaller position sizes.';
  }
  return '✅ LOWER RISK. No major red flags detected, but always DYOR. Crypto is inherently risky.';
}

/**
 * Generate AI analysis for the network
 */
async function generateNetworkAnalysis(
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
  // Build context for AI
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

STRUCTURAL RISK:${(() => {
    const warnings: string[] = [];
    if (tokenInfo.ageHours !== undefined && tokenInfo.ageHours < 6) {
      warnings.push('- Token is less than 6 hours old (consider +10 risk)');
    } else if (tokenInfo.ageHours !== undefined && tokenInfo.ageHours < 24) {
      warnings.push('- Token is less than 24 hours old (consider +5 risk)');
    }
    if (tokenInfo.liquidity && tokenInfo.liquidity < 5000) {
      warnings.push('- Liquidity under $5K — thin exit (consider +10 risk)');
    } else if (tokenInfo.liquidity && tokenInfo.liquidity < 10000) {
      warnings.push('- Liquidity under $10K (consider +5 risk)');
    }
    if (tokenInfo.volume24h && tokenInfo.liquidity && tokenInfo.liquidity > 0) {
      const volLiqRatio = tokenInfo.volume24h / tokenInfo.liquidity;
      if (volLiqRatio > 5) {
        warnings.push(`- Volume/Liquidity ratio: ${volLiqRatio.toFixed(1)}x — high pool turnover`);
      }
    }
    if (tokenInfo.marketCap && tokenInfo.liquidity && tokenInfo.liquidity > 0) {
      const mcapLiqRatio = tokenInfo.marketCap / tokenInfo.liquidity;
      if (mcapLiqRatio > 10) {
        warnings.push(`- MCap/Liquidity ratio: ${mcapLiqRatio.toFixed(1)}x — inflated relative to exit liquidity`);
      }
    }
    return warnings.length > 0 ? '\n' + warnings.join('\n') : '\n- No structural concerns';
  })()}

NETWORK SUMMARY:
- Total Nodes: ${network.nodes.length}
- Whales (>10%): ${whales.length}
- Insiders (5-10%): ${insiders.length}
- High Risk Nodes: ${highRiskNodes.length}

WHALE HOLDINGS:
${whales.map(w => `- ${w.label}: ${w.holdingsPercent?.toFixed(2)}%`).join('\n') || '- None detected'}

`;

  // ADD BUNDLE DETECTION TO CONTEXT - weight by confidence level
  if (bundleInfo.detected || bundleInfo.confidence === 'LOW') {
    if (bundleInfo.confidence === 'HIGH') {
      context += `
⚠️ BUNDLE DETECTED - HIGH CONFIDENCE:
- ${bundleInfo.count} coordinated wallets CONFIRMED via same-block transactions
${bundleInfo.txBundlePercent ? `- ${bundleInfo.txBundlePercent.toFixed(1)}% of buys came from bundled transactions` : ''}
- Evidence of coordinated buying
- Consider dump risk but weigh against positive market signals
- Increase risk score +15-25 points (offset by positive signals if present)
${bundleInfo.description ? `\nDetails: ${bundleInfo.description}` : ''}
`;
    } else if (bundleInfo.confidence === 'MEDIUM') {
      context += `
⚠️ BUNDLE DETECTED - MEDIUM CONFIDENCE:
- ${bundleInfo.count} wallets show coordination patterns
${bundleInfo.txBundlePercent && bundleInfo.txBundlePercent > 0 ? `- ${bundleInfo.txBundlePercent.toFixed(1)}% of buys from same-block transactions` : '- Near-identical holdings detected'}
- Possible coordinated buying, exercise caution
- Increase risk score +10-15 points (offset by positive signals if present)
${bundleInfo.description ? `\nDetails: ${bundleInfo.description}` : ''}
`;
    } else if (bundleInfo.confidence === 'LOW') {
      context += `
ℹ️ POSSIBLE BUNDLE - LOW CONFIDENCE:
- Some wallets have similar holdings, but this could be natural distribution
- No same-block transaction evidence found
- Do NOT significantly increase risk score for this alone (+5-10 points max)
- This is common in new tokens with organic interest
${bundleInfo.description ? `\nDetails: ${bundleInfo.description}` : ''}
`;
    }

    // Add suspicious patterns from transaction analysis
    if (bundleInfo.suspiciousPatterns && bundleInfo.suspiciousPatterns.length > 0) {
      context += `\nSuspicious Patterns:\n`;
      for (const pattern of bundleInfo.suspiciousPatterns) {
        context += `- ⚠️ ${pattern}\n`;
      }
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

  // DEV SELLING ACTIVITY - critical for risk assessment
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
3. summary: 1-2 sentence risk summary
4. prediction: Your prediction of what will likely happen to this token
5. flags: Array of {type, severity, message} for specific risks
6. networkInsights: Array of strings with network pattern observations

RISK FACTORS (weight by confidence):

BUNDLE DETECTION - weight by CONFIDENCE LEVEL:
- HIGH CONFIDENCE bundle (same-block transactions confirmed) = Significant concern (+15-25 points)
- MEDIUM CONFIDENCE bundle (strong patterns) = Moderate concern (+10-15 points)
- LOW CONFIDENCE bundle (similar holdings only) = Minor concern (+5 max)
  * LOW confidence often means natural distribution, NOT a scam
  * Do NOT flag as SCAM based on LOW confidence alone

DEV SELLING ACTIVITY:
- Dev sold >50% but still holds >5% = "Dev sold X% but still holds Y%" - moderate dump risk
- Dev sold >90% and holds <1% = Likely community-owned, reduced dump risk
- Dev has NOT sold and holds >20% = Major dump risk pending
- Dev has NOT sold and holds <5% = Minor concern
- Always mention specific percentages in your summary

OTHER RISK FACTORS:
- Concentrated holdings (few wallets hold most supply) = +10-20 points
- Creator with previous rugs = CRITICAL (+40 points)
- New creator wallet (<7 days) = +10 points
- Creator still holds large % (>20%) = +10-15 points
- Multiple whales >5% each = coordination concern

POSITIVE SIGNALS (should LOWER risk score):
- High trading volume relative to market cap = active, healthy market
- Strong buy ratio (>1.2:1) = organic demand
- Good liquidity (>$20K) = harder to manipulate
- Many transactions (>1000) = real community engagement
- Price trending up with volume = organic growth
- Both mint AND freeze authority revoked = safer, -5 points
- These signals can offset bundle/whale concerns by -10 to -20 points

SECURITY AUTHORITY SCORING:
- Freeze authority ACTIVE = +20 points (creator can freeze/close token accounts — direct rug vector)
- Mint authority ACTIVE = +10 points (creator can inflate supply)
- Both active = +25 points (combined rug capability)
- Both revoked = -5 points (positive safety signal)

STRUCTURAL RISK AWARENESS (consider but do not over-penalize):
- Token < 6 hours old = +10 points (most rugs happen in first few hours)
- Token < 24 hours old = +5 points (elevated rug window)
- Liquidity < $5K = +10 points (thin exit liquidity, easier to rug)
- Liquidity < $10K = +5 points (moderate exit liquidity)
- Volume/Liquidity > 5x on a new token = note as churning risk
- Max structural penalty should be ~+15 points total (hard guardrails enforce minimums separately)
- Positive trading signals CAN still offset structural risk, but weight them less for tokens < 6h old

PRICE CRASH — CRITICAL SIGNAL (do NOT let positive signals offset a crash):
- 24h price change < -80% = ALREADY RUGGED. Score 75+ minimum regardless of other signals
- 24h price change < -50% = Major dump in progress. Score 65+ minimum
- 24h price change < -30% = Significant selling pressure. Score 55+ minimum
- Revoked authorities do NOT offset a price crash — the rug already happened
- A token down 90% with revoked mint/freeze is STILL a rug, not a safe token

SELL PRESSURE:
- Sells significantly exceeding buys (ratio < 0.7) on a new token (<24h) = dump in progress (+10-15 points)
- Very few holders (<25) on a new token (<6h) = no organic adoption (+10 points)
- Multiple moderate red flags together compound risk — do not treat them independently

SCORING GUIDANCE:
- 80+ (SCAM): Creator with previous rugs, active freeze authority + bundles, or extreme red flags with NO positive signals
- 75-79 (DANGEROUS): Token already crashed >80% — likely rugged
- 60-74 (DANGEROUS): HIGH confidence bundles with additional red flags, active freeze authority with concentration, or >50% price crash
- 40-59 (SUSPICIOUS): Bundles or concentration WITH positive market activity, or new tokens (<24h) with thin liquidity
- 0-39 (SAFE): No major red flags, or red flags offset by strong positive signals AND no price crash
- A token with active freeze authority should almost never score below 40
- A token with bundles BUT strong volume, good liquidity (>$20K), and active trading should score 40-60, NOT 80+
- A token down >50% should NEVER score below 55 regardless of other signals

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

    // Extract JSON from response
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      let score = Math.max(0, Math.min(100, parsed.riskScore || 50));
      const aiFlags = parsed.flags || [];
      const aiInsights = parsed.networkInsights || [];

      // ============================================
      // POST-AI GUARDRAILS (minimums only, no additive scoring)
      // The AI prompt already instructs scoring for bundles, whales, etc.
      // Adding points on top would double-count. Only enforce floor scores.
      // ============================================
      // walletAge === -1 means unknown (API couldn't determine) — treat as potentially new
      const isNewWallet = creatorInfo?.walletAge !== undefined && (creatorInfo.walletAge === -1 || (creatorInfo.walletAge > 0 && creatorInfo.walletAge < 7));
      const hasBundleDetection = bundleInfo.confidence === 'HIGH' || bundleInfo.confidence === 'MEDIUM';
      const hasWhale = whales.length > 0;
      const topWhalePercent = whales[0]?.holdingsPercent || 0;

      console.log(`[Sentinel] Post-AI guardrails: newWallet=${isNewWallet}, bundle=${hasBundleDetection} (${bundleInfo.confidence}), whale=${hasWhale} (${topWhalePercent.toFixed(1)}%), aiScore=${score}`);

      // Enforce floor scores as safety nets (not additive)
      // HIGH confidence bundle = minimum 55 (SUSPICIOUS)
      if (bundleInfo.confidence === 'HIGH' && score < 55) {
        console.log(`[Sentinel] Enforcing minimum 55 for HIGH bundle (was ${score})`);
        score = 55;
      }

      // MEDIUM confidence bundle = minimum 50 (SUSPICIOUS)
      if (bundleInfo.confidence === 'MEDIUM' && score < 50) {
        console.log(`[Sentinel] Enforcing minimum 50 for MEDIUM bundle (was ${score})`);
        score = 50;
      }

      // Triple threat (confirmed new wallet + bundle + whale) = minimum 60 (DANGEROUS)
      if (isNewWallet && hasBundleDetection && hasWhale && topWhalePercent >= 10 && score < 60) {
        console.log(`[Sentinel] Enforcing minimum 60 for triple threat (was ${score})`);
        score = 60;
      }

      // ============================================
      // PRICE CRASH GUARDRAIL — highest priority
      // If a token has already crashed, it's already rugged.
      // No positive signals (revoked mint, etc.) can offset an actual crash.
      // ============================================
      const priceChange24h = tokenInfo.priceChange24h;
      if (priceChange24h !== undefined && priceChange24h < -80 && score < 75) {
        console.log(`[Sentinel] Enforcing minimum 75 for >80% price crash (${priceChange24h.toFixed(1)}%, was ${score})`);
        score = 75;
        aiFlags.push({ type: 'PRICE_CRASH', severity: 'CRITICAL', message: `Price crashed ${priceChange24h.toFixed(1)}% — token likely already rugged` });
      } else if (priceChange24h !== undefined && priceChange24h < -50 && score < 65) {
        console.log(`[Sentinel] Enforcing minimum 65 for >50% price crash (${priceChange24h.toFixed(1)}%, was ${score})`);
        score = 65;
        aiFlags.push({ type: 'PRICE_CRASH', severity: 'HIGH', message: `Price dropped ${priceChange24h.toFixed(1)}% — significant dump in progress` });
      } else if (priceChange24h !== undefined && priceChange24h < -30 && score < 55) {
        console.log(`[Sentinel] Enforcing minimum 55 for >30% price drop (${priceChange24h.toFixed(1)}%, was ${score})`);
        score = 55;
        aiFlags.push({ type: 'PRICE_CRASH', severity: 'MEDIUM', message: `Price dropped ${priceChange24h.toFixed(1)}% — selling pressure detected` });
      }

      // ============================================
      // STRUCTURAL RISK GUARDRAILS
      // Token age and liquidity are the hardest signals to fake.
      // A brand new token with thin liquidity showing "great" buy activity
      // is the pump phase of a pump-and-dump.
      // ============================================
      const liquidityUsd = tokenInfo.liquidity || 0;
      const marketCapUsd = tokenInfo.marketCap || 0;
      const tokenAgeHours = tokenInfo.ageHours;

      // MATURITY GATE: Established tokens (>$100K liquidity OR >$10M market cap)
      // shouldn't be penalized for bundle detection — those "bundles" are likely
      // exchanges, market makers, or early investors, not malicious actors.
      const isMatureToken = liquidityUsd > 100_000 || marketCapUsd > 10_000_000;

      // CRITICAL: $0 liquidity = cannot sell = minimum 80
      // PumpFun bonding curve tokens already have estimated liquidity from market cap,
      // so this only fires for genuinely dead/untradeable tokens
      if (liquidityUsd <= 0 && score < 80) {
        console.log(`[Sentinel] Enforcing minimum 80 for $0 liquidity (was ${score})`);
        score = 80;
        aiFlags.push({ type: 'LIQUIDITY', severity: 'CRITICAL', message: '$0 reported liquidity — extremely high rug risk, may not be sellable' });
      }

      // CRITICAL: Ultra-thin liquidity (<$1K) on very new token (<1h) = minimum 75
      // Almost always a fresh pump.fun token in the pump phase before rug
      if (tokenAgeHours !== undefined && tokenAgeHours < 1 && liquidityUsd > 0 && liquidityUsd < 1000 && score < 75) {
        console.log(`[Sentinel] Enforcing minimum 75 for ultra-thin liquidity ($${liquidityUsd.toFixed(0)}) on <1h token (was ${score})`);
        score = 75;
        aiFlags.push({ type: 'STRUCTURAL', severity: 'CRITICAL', message: `Token is ${(tokenAgeHours * 60).toFixed(0)}m old with only $${liquidityUsd.toLocaleString()} liquidity — extreme rug risk` });
      }

      // Bundle detected + thin liquidity (<$2K) = minimum 70
      // Coordinated wallets on a token with no real liquidity = classic rug setup
      if (hasBundleDetection && liquidityUsd > 0 && liquidityUsd < 2000 && score < 70) {
        console.log(`[Sentinel] Enforcing minimum 70 for bundles + thin liquidity ($${liquidityUsd.toFixed(0)}) (was ${score})`);
        score = 70;
        aiFlags.push({ type: 'STRUCTURAL', severity: 'HIGH', message: `Bundle activity detected with only $${liquidityUsd.toLocaleString()} liquidity — coordinated rug risk` });
      }

      // ============================================
      // BUNDLE DOMINANCE GUARDRAIL
      // When coordinated wallets make up a large % of holders, it's a syndicate pump
      // Skipped for mature tokens — bundles on established tokens are benign
      // ============================================
      const holderCountForBundle = tokenInfo.holderCount || 0;
      if (!isMatureToken && bundleInfo.count > 0 && holderCountForBundle > 0) {
        const bundleRatio = bundleInfo.count / holderCountForBundle;
        if (bundleInfo.confidence === 'HIGH' && bundleRatio > 0.4 && score < 75) {
          console.log(`[Sentinel] Enforcing minimum 75 for bundle dominance: ${bundleInfo.count}/${holderCountForBundle} holders (${(bundleRatio * 100).toFixed(0)}%) are coordinated (was ${score})`);
          score = 75;
          aiFlags.push({ type: 'BUNDLE_DOMINANCE', severity: 'CRITICAL', message: `Pump syndicate: ${bundleInfo.count} of ${holderCountForBundle} holders (${(bundleRatio * 100).toFixed(0)}%) are coordinated wallets confirmed via same-block transactions` });
        } else if (bundleRatio > 0.5 && score < 70) {
          console.log(`[Sentinel] Enforcing minimum 70 for bundle dominance: ${bundleInfo.count}/${holderCountForBundle} holders (${(bundleRatio * 100).toFixed(0)}%) are coordinated (was ${score})`);
          score = 70;
          aiFlags.push({ type: 'BUNDLE_DOMINANCE', severity: 'HIGH', message: `${bundleInfo.count} of ${holderCountForBundle} holders (${(bundleRatio * 100).toFixed(0)}%) show coordinated wallet patterns — likely pump syndicate` });
        }
      }

      // Very new token (<6h) with thin liquidity (<$10K) = minimum 55
      if (tokenAgeHours !== undefined && tokenAgeHours < 6 && liquidityUsd < 10000 && score < 55) {
        console.log(`[Sentinel] Enforcing minimum 55 for new token (<6h) + thin liquidity (was ${score})`);
        score = 55;
        aiFlags.push({ type: 'STRUCTURAL', severity: 'HIGH', message: `Token is ${tokenAgeHours.toFixed(1)}h old with $${liquidityUsd.toLocaleString()} liquidity — high rug risk` });
      }
      // New token (<24h) with very thin liquidity (<$5K) = minimum 55
      else if (tokenAgeHours !== undefined && tokenAgeHours < 24 && liquidityUsd < 5000 && score < 55) {
        console.log(`[Sentinel] Enforcing minimum 55 for <24h token + <$5K liquidity (was ${score})`);
        score = 55;
        aiFlags.push({ type: 'STRUCTURAL', severity: 'HIGH', message: `Token is ${tokenAgeHours.toFixed(1)}h old with only $${liquidityUsd.toLocaleString()} liquidity` });
      }

      // Any token < 6 hours old = minimum 50 regardless
      if (tokenAgeHours !== undefined && tokenAgeHours < 6 && score < 50) {
        console.log(`[Sentinel] Enforcing minimum 50 for <6h token (was ${score})`);
        score = 50;
      }

      // Any token < 24 hours old = minimum 40
      if (tokenAgeHours !== undefined && tokenAgeHours < 24 && score < 40) {
        console.log(`[Sentinel] Enforcing minimum 40 for <24h token (was ${score})`);
        score = 40;
      }

      // Any token with $0 < liquidity < $5K = minimum 50
      if (liquidityUsd > 0 && liquidityUsd < 5000 && score < 50) {
        console.log(`[Sentinel] Enforcing minimum 50 for <$5K liquidity (was ${score})`);
        score = 50;
      }

      // Volume/Liquidity churning: if 24h volume > 8x liquidity on a new token, suspicious
      if (tokenInfo.volume24h && liquidityUsd > 0 && tokenAgeHours !== undefined && tokenAgeHours < 24) {
        const volLiqRatio = tokenInfo.volume24h / liquidityUsd;
        if (volLiqRatio > 8 && score < 50) {
          console.log(`[Sentinel] Enforcing minimum 50 for volume churning (${volLiqRatio.toFixed(1)}x vol/liq on <24h token, was ${score})`);
          score = 50;
        }
      }

      // ============================================
      // SELL PRESSURE GUARDRAIL
      // Heavy selling on a new token = dump in progress
      // ============================================
      const sells24h = tokenInfo.txns24h?.sells || 0;
      const buys24h = tokenInfo.txns24h?.buys || 0;
      if (sells24h > 0 && buys24h > 0) {
        const buyRatio = buys24h / sells24h;
        if (buyRatio < 0.7 && sells24h > 100 && tokenAgeHours !== undefined && tokenAgeHours < 24 && score < 60) {
          console.log(`[Sentinel] Enforcing minimum 60 for sell-heavy new token (ratio ${buyRatio.toFixed(2)}, ${sells24h} sells, was ${score})`);
          score = 60;
          aiFlags.push({ type: 'SELL_PRESSURE', severity: 'HIGH', message: `Sell-heavy trading: ${sells24h} sells vs ${buys24h} buys (ratio ${buyRatio.toFixed(2)}) on <24h token` });
        } else if (buyRatio < 0.5 && sells24h > 50 && score < 55) {
          console.log(`[Sentinel] Enforcing minimum 55 for extreme sell pressure (ratio ${buyRatio.toFixed(2)}, was ${score})`);
          score = 55;
          aiFlags.push({ type: 'SELL_PRESSURE', severity: 'MEDIUM', message: `Heavy sell pressure: ${sells24h} sells vs ${buys24h} buys (ratio ${buyRatio.toFixed(2)})` });
        }
      }

      // ============================================
      // LOW HOLDER COUNT GUARDRAIL
      // Very few holders on a new token = no organic adoption
      // ============================================
      const holderCount = tokenInfo.holderCount || 0;
      if (holderCount > 0 && holderCount < 25 && tokenAgeHours !== undefined && tokenAgeHours < 6 && score < 55) {
        console.log(`[Sentinel] Enforcing minimum 55 for low holder count (${holderCount} holders on <6h token, was ${score})`);
        score = 55;
        aiFlags.push({ type: 'LOW_HOLDERS', severity: 'MEDIUM', message: `Only ${holderCount} holders on a ${tokenAgeHours.toFixed(1)}h old token — very low organic adoption` });
      }

      // ============================================
      // DEV SELLING GUARDRAIL
      // Developer dumping tokens on a new token = major red flag
      // ============================================
      if (devActivity && devActivity.hasSold && tokenAgeHours !== undefined) {
        if (devActivity.percentSold >= 50 && tokenAgeHours < 6 && score < 80) {
          console.log(`[Sentinel] Enforcing minimum 80 for dev sold ${devActivity.percentSold.toFixed(0)}% on <6h token (was ${score})`);
          score = 80;
          aiFlags.push({ type: 'DEV_DUMP', severity: 'CRITICAL', message: `Developer sold ${devActivity.percentSold.toFixed(0)}% of tokens on a ${tokenAgeHours.toFixed(1)}h old token — likely rug` });
        } else if (devActivity.percentSold >= 20 && devActivity.currentHoldingsPercent > 20 && tokenAgeHours < 6 && score < 75) {
          console.log(`[Sentinel] Enforcing minimum 75 for dev sold ${devActivity.percentSold.toFixed(0)}% + still holds ${devActivity.currentHoldingsPercent.toFixed(0)}% on <6h token (was ${score})`);
          score = 75;
          aiFlags.push({ type: 'DEV_DUMP', severity: 'HIGH', message: `Developer sold ${devActivity.percentSold.toFixed(0)}% but still holds ${devActivity.currentHoldingsPercent.toFixed(0)}% — more selling likely` });
        } else if (devActivity.percentSold >= 20 && tokenAgeHours < 24 && score < 65) {
          console.log(`[Sentinel] Enforcing minimum 65 for dev sold ${devActivity.percentSold.toFixed(0)}% on <24h token (was ${score})`);
          score = 65;
          aiFlags.push({ type: 'DEV_DUMP', severity: 'MEDIUM', message: `Developer sold ${devActivity.percentSold.toFixed(0)}% of tokens within first 24h` });
        }
      }

      // ============================================
      // COMBO SIGNAL ESCALATION
      // Multiple moderate flags firing together = higher risk than any individual flag
      // ============================================
      let moderateFlags = 0;
      if (tokenAgeHours !== undefined && tokenAgeHours < 6) moderateFlags++;
      if (liquidityUsd < 10000) moderateFlags++;
      if (sells24h > buys24h && sells24h > 50) moderateFlags++;
      if (holderCount > 0 && holderCount < 30) moderateFlags++;
      if (hasBundleDetection && !isMatureToken) moderateFlags++;
      if (isNewWallet) moderateFlags++;
      if (priceChange24h !== undefined && priceChange24h < -30) moderateFlags++;
      if (devActivity && devActivity.hasSold && devActivity.percentSold >= 20) moderateFlags++;

      // POSITIVE SIGNAL OFFSET
      // Strong bullish counter-signals reduce combo escalation — real momentum
      // shouldn't be penalized as harshly as tokens with no organic activity.
      // SAFETY: Disabled when the "positive signals" are likely a coordinated pump:
      //   - HIGH confidence bundles (wallets ARE the buying pressure)
      //   - Bundle wallets dominate holder base (>40% = syndicate)
      //   - Ultra-thin liquidity <$2K (price trivially manipulable)
      //   - Token < 1h old (too early to trust any momentum)
      const isHighBundle = bundleInfo?.confidence === 'HIGH' && !isMatureToken;
      const bundleDominant = !isMatureToken && holderCountForBundle > 0 && bundleInfo.count > 0 && (bundleInfo.count / holderCountForBundle) > 0.4;
      const tooThinForOffset = liquidityUsd < 2000;
      const tooNewForOffset = tokenAgeHours !== undefined && tokenAgeHours < 1;
      const offsetBlocked = isHighBundle || bundleDominant || tooThinForOffset || tooNewForOffset;

      const buyRatio = buys24h > 0 && sells24h > 0 ? buys24h / sells24h : 0;

      if (!offsetBlocked) {
        let positiveSignals = 0;
        if (buyRatio > 1.3) positiveSignals++;
        if (priceChange24h !== undefined && priceChange24h > 50) positiveSignals++;
        if (liquidityUsd > 0 && tokenInfo.volume24h && tokenInfo.volume24h / liquidityUsd > 5 && buyRatio > 1) positiveSignals++;

        const rawFlags = moderateFlags;
        if (positiveSignals >= 3) {
          moderateFlags = Math.max(0, moderateFlags - 2);
          console.log(`[Sentinel] Positive offset -2: ${positiveSignals} bullish signals (buyRatio=${buyRatio.toFixed(2)}, price=${priceChange24h?.toFixed(0)}%) — flags ${rawFlags} → ${moderateFlags}`);
        } else if (positiveSignals >= 2) {
          moderateFlags = Math.max(0, moderateFlags - 1);
          console.log(`[Sentinel] Positive offset -1: ${positiveSignals} bullish signals (buyRatio=${buyRatio.toFixed(2)}, price=${priceChange24h?.toFixed(0)}%) — flags ${rawFlags} → ${moderateFlags}`);
        }
      } else {
        console.log(`[Sentinel] Positive offset BLOCKED: highBundle=${isHighBundle}, bundleDominant=${bundleDominant}, thinLiq=${tooThinForOffset}, tooNew=${tooNewForOffset}`);
      }

      if (moderateFlags >= 5 && score < 75) {
        console.log(`[Sentinel] Enforcing minimum 75 for ${moderateFlags} combined risk signals (was ${score})`);
        score = 75;
        aiFlags.push({ type: 'COMBO_RISK', severity: 'CRITICAL', message: `${moderateFlags} risk signals detected simultaneously — extreme compounding risk` });
      } else if (moderateFlags >= 4 && score < 70) {
        console.log(`[Sentinel] Enforcing minimum 70 for ${moderateFlags} combined risk signals (was ${score})`);
        score = 70;
        aiFlags.push({ type: 'COMBO_RISK', severity: 'HIGH', message: `${moderateFlags} risk signals detected simultaneously — compounding risk` });
      } else if (moderateFlags >= 3 && score < 60) {
        console.log(`[Sentinel] Enforcing minimum 60 for ${moderateFlags} combined risk signals (was ${score})`);
        score = 60;
        aiFlags.push({ type: 'COMBO_RISK', severity: 'MEDIUM', message: `${moderateFlags} risk signals detected — elevated compound risk` });
      }

      // ============================================
      // MATURITY OFFSET
      // Established tokens carry less rug risk — reduce score proportionally.
      // A $300M+ market cap token simply cannot rug the same way a pump.fun coin can.
      // ============================================
      if (isMatureToken) {
        let maturityReduction = 0;
        if (marketCapUsd > 100_000_000) maturityReduction += 15;
        else if (marketCapUsd > 10_000_000) maturityReduction += 10;
        if (liquidityUsd > 1_000_000) maturityReduction += 10;
        else if (liquidityUsd > 100_000) maturityReduction += 5;
        if (maturityReduction > 0) {
          const before = score;
          score = Math.max(20, score - maturityReduction);
          console.log(`[Sentinel] Maturity offset -${maturityReduction}: mcap=$${(marketCapUsd/1e6).toFixed(1)}M, liq=$${(liquidityUsd/1e3).toFixed(0)}K — score ${before} → ${score}`);
        }
      }

      score = Math.min(100, score);

      // Recalculate risk level based on adjusted score
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
        flags: aiFlags,
        networkInsights: aiInsights,
      };
    }
  } catch (error) {
    console.error('[Sentinel] AI analysis error:', error);
  }

  // Fallback analysis based on data
  let riskScore = 30;
  const flags: Array<{ type: string; severity: string; message: string }> = [];
  const networkInsights: string[] = [];

  // Bundle detection scoring based on CONFIDENCE level
  if (bundleInfo.confidence === 'HIGH') {
    // HIGH confidence = confirmed same-block transactions
    riskScore += 35;
    flags.push({
      type: 'BUNDLE',
      severity: 'CRITICAL',
      message: `🚨 ${bundleInfo.count} coordinated wallets CONFIRMED via same-block transactions`,
    });
    networkInsights.push(`Bundle CONFIRMED: ${bundleInfo.count} wallets bought in same block`);
  } else if (bundleInfo.confidence === 'MEDIUM') {
    // MEDIUM confidence = strong pattern but not definitive
    riskScore += 20;
    flags.push({
      type: 'BUNDLE',
      severity: 'HIGH',
      message: `⚠️ ${bundleInfo.count} wallets show coordination patterns`,
    });
    networkInsights.push(`Likely bundle: ${bundleInfo.count} wallets with suspicious patterns`);
  } else if (bundleInfo.confidence === 'LOW') {
    // LOW confidence = could be natural distribution, minimal score impact
    riskScore += 5;
    flags.push({
      type: 'BUNDLE',
      severity: 'LOW',
      message: `Some wallets have similar holdings (could be natural distribution)`,
    });
    networkInsights.push(`Possible coordination: similar holdings detected`);
  }

  if (whales.length > 0) {
    // Get the largest whale
    const topWhale = whales.reduce((max, w) =>
      (w.holdingsPercent || 0) > (max.holdingsPercent || 0) ? w : max
    , whales[0]);
    const topWhalePercent = topWhale?.holdingsPercent || 0;

    // CRITICAL: Extreme concentration (50%+) = guaranteed dump risk
    if (topWhalePercent >= 50) {
      riskScore += 50; // Massive penalty
      flags.push({
        type: 'CONCENTRATED HOLDINGS',
        severity: 'CRITICAL',
        message: `🚨 CRITICAL: One whale holds ${topWhalePercent.toFixed(2)}% of the total supply`,
      });
      networkInsights.push(`Concentrated holdings with one whale holding ${topWhalePercent.toFixed(2)}% of the total supply`);
    } else if (topWhalePercent >= 30) {
      // HIGH: Major concentration (30-50%)
      riskScore += 30;
      flags.push({
        type: 'CONCENTRATED HOLDINGS',
        severity: 'HIGH',
        message: `One whale holds ${topWhalePercent.toFixed(2)}% of the total supply`,
      });
    } else if (topWhalePercent >= 20) {
      // MEDIUM: Significant concentration (20-30%)
      riskScore += 20;
      flags.push({
        type: 'CONCENTRATED HOLDINGS',
        severity: 'MEDIUM',
        message: `One whale holds ${topWhalePercent.toFixed(2)}% of supply`,
      });
    } else {
      // Basic whale penalty for 10-20%
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

  if (creatorInfo?.currentHoldings && creatorInfo.currentHoldings > 10) {
    riskScore += 15;
    flags.push({
      type: 'DEPLOYER',
      severity: 'HIGH',
      message: `Creator still holds ${creatorInfo.currentHoldings.toFixed(1)}% of supply`,
    });
  }

  if (creatorInfo?.walletAge !== undefined && (creatorInfo.walletAge === -1 || (creatorInfo.walletAge > 0 && creatorInfo.walletAge < 7))) {
    riskScore += 10;
    flags.push({
      type: 'DEPLOYER',
      severity: 'MEDIUM',
      message: creatorInfo.walletAge === -1
        ? 'Creator wallet age unknown — could be brand new'
        : `Creator wallet is only ${creatorInfo.walletAge} days old`,
    });
  }

  networkInsights.push(`${network.nodes.length} wallets in network`);
  if (whales.length > 0) {
    networkInsights.push(`Top whale holds ${whales[0]?.holdingsPercent?.toFixed(1)}%`);
  }

  // ============================================
  // STRUCTURAL RISK SCORING (fallback)
  // ============================================
  const fallbackLiquidity = tokenInfo.liquidity || 0;
  const fallbackMarketCap = tokenInfo.marketCap || 0;
  const fallbackAgeHours = tokenInfo.ageHours;

  // MATURITY GATE (fallback): Established tokens exempt from bundle penalties
  const fbIsMatureToken = fallbackLiquidity > 100_000 || fallbackMarketCap > 10_000_000;

  if (fallbackAgeHours !== undefined && fallbackAgeHours < 6) {
    riskScore += 20;
    flags.push({ type: 'STRUCTURAL', severity: 'HIGH', message: `Token is only ${fallbackAgeHours.toFixed(1)} hours old — very high rug risk` });
  } else if (fallbackAgeHours !== undefined && fallbackAgeHours < 24) {
    riskScore += 10;
    flags.push({ type: 'STRUCTURAL', severity: 'MEDIUM', message: `Token is ${fallbackAgeHours.toFixed(1)} hours old — elevated rug risk` });
  }

  if (fallbackLiquidity > 0 && fallbackLiquidity < 5000) {
    riskScore += 20;
    flags.push({ type: 'STRUCTURAL', severity: 'HIGH', message: `Liquidity is only $${fallbackLiquidity.toLocaleString()} — paper-thin exit` });
  } else if (fallbackLiquidity > 0 && fallbackLiquidity < 10000) {
    riskScore += 10;
    flags.push({ type: 'STRUCTURAL', severity: 'MEDIUM', message: `Liquidity is $${fallbackLiquidity.toLocaleString()} — thin exit` });
  }

  if (tokenInfo.volume24h && fallbackLiquidity > 0) {
    const volLiqRatio = tokenInfo.volume24h / fallbackLiquidity;
    if (volLiqRatio > 8) {
      riskScore += 10;
      networkInsights.push(`Volume/Liquidity ratio: ${volLiqRatio.toFixed(1)}x — rapid pool churning`);
    }
  }

  // ============================================
  // POSITIVE SIGNAL OFFSET (fallback only)
  // The AI naturally weighs positive signals against negatives,
  // but the fallback scoring is purely additive. Apply discounts
  // for strong positive market signals to avoid false SCAM ratings
  // on tokens with real market activity.
  // ============================================
  let positiveOffset = 0;
  const fbPriceChange24h = tokenInfo.priceChange24h;
  const positiveBuys = tokenInfo.txns24h?.buys || 0;
  const positiveSells = tokenInfo.txns24h?.sells || 0;
  const positiveBuyRatio = positiveSells > 0 ? positiveBuys / positiveSells : 1;
  const totalTxns = positiveBuys + positiveSells;

  // Good liquidity ($20K+) = harder to manipulate
  if (fallbackLiquidity >= 20000) positiveOffset += 10;
  if (fallbackLiquidity >= 50000) positiveOffset += 5;

  // Healthy buy/sell ratio (>=1.0) with real volume = organic demand
  if (positiveBuyRatio >= 1.0 && positiveBuys > 100) positiveOffset += 10;

  // High transaction count = real community engagement
  if (totalTxns >= 1000) positiveOffset += 5;
  if (totalTxns >= 5000) positiveOffset += 5;

  // Price trending up = not crashing/dumping
  if (fbPriceChange24h !== undefined && fbPriceChange24h > 0) positiveOffset += 5;

  // Both mint and freeze authority revoked = safer
  if (!tokenInfo.mintAuthorityActive && !tokenInfo.freezeAuthorityActive) positiveOffset += 5;

  // Cap total offset at 40 — positive signals reduce risk but don't erase it
  positiveOffset = Math.min(40, positiveOffset);

  if (positiveOffset > 0) {
    const beforeOffset = riskScore;
    riskScore = Math.max(30, riskScore - positiveOffset); // Never below baseline 30
    console.log(`[Sentinel] Fallback positive offset: -${positiveOffset} (${beforeOffset} → ${riskScore})`);
    if (positiveOffset >= 20) {
      networkInsights.push(`Strong positive market signals detected (offset -${positiveOffset})`);
    }
  }

  // ============================================
  // FALLBACK GUARDRAILS (minimums only)
  // ============================================
  // walletAge === -1 means unknown (API couldn't determine) — treat as potentially new
  const isNewWallet = creatorInfo?.walletAge !== undefined && (creatorInfo.walletAge === -1 || (creatorInfo.walletAge > 0 && creatorInfo.walletAge < 7));
  const hasBundleDetection = bundleInfo.confidence === 'HIGH' || bundleInfo.confidence === 'MEDIUM';
  const hasWhale = whales.length > 0;
  const topWhalePercent = whales[0]?.holdingsPercent || 0;

  console.log(`[Sentinel] Fallback guardrails: newWallet=${isNewWallet}, bundle=${hasBundleDetection} (${bundleInfo.confidence}), whale=${hasWhale} (${topWhalePercent.toFixed(1)}%), mature=${fbIsMatureToken}, age=${fallbackAgeHours?.toFixed(1)}h, liq=$${fallbackLiquidity}`);

  // HIGH confidence bundle = minimum 55
  if (bundleInfo.confidence === 'HIGH' && riskScore < 55) {
    console.log(`[Sentinel] Enforcing minimum 55 for HIGH bundle (was ${riskScore})`);
    riskScore = 55;
  }

  // MEDIUM confidence bundle = minimum 50
  if (bundleInfo.confidence === 'MEDIUM' && riskScore < 50) {
    console.log(`[Sentinel] Enforcing minimum 50 for MEDIUM bundle (was ${riskScore})`);
    riskScore = 50;
  }

  // Confirmed new wallet + bundle + whale = minimum 60
  if (isNewWallet && hasBundleDetection && hasWhale && topWhalePercent >= 10 && riskScore < 60) {
    console.log(`[Sentinel] Enforcing minimum 60 for triple threat (was ${riskScore})`);
    riskScore = 60;
  }

  // ============================================
  // PRICE CRASH GUARDRAIL — highest priority
  // ============================================
  const fallbackPriceChange = tokenInfo.priceChange24h;
  if (fallbackPriceChange !== undefined && fallbackPriceChange < -80 && riskScore < 75) {
    console.log(`[Sentinel] Enforcing minimum 75 for >80% price crash (${fallbackPriceChange.toFixed(1)}%, was ${riskScore})`);
    riskScore = 75;
    flags.push({ type: 'PRICE_CRASH', severity: 'CRITICAL', message: `Price crashed ${fallbackPriceChange.toFixed(1)}% — token likely already rugged` });
  } else if (fallbackPriceChange !== undefined && fallbackPriceChange < -50 && riskScore < 65) {
    console.log(`[Sentinel] Enforcing minimum 65 for >50% price crash (${fallbackPriceChange.toFixed(1)}%, was ${riskScore})`);
    riskScore = 65;
    flags.push({ type: 'PRICE_CRASH', severity: 'HIGH', message: `Price dropped ${fallbackPriceChange.toFixed(1)}% — significant dump in progress` });
  } else if (fallbackPriceChange !== undefined && fallbackPriceChange < -30 && riskScore < 55) {
    console.log(`[Sentinel] Enforcing minimum 55 for >30% price drop (${fallbackPriceChange.toFixed(1)}%, was ${riskScore})`);
    riskScore = 55;
    flags.push({ type: 'PRICE_CRASH', severity: 'MEDIUM', message: `Price dropped ${fallbackPriceChange.toFixed(1)}% — selling pressure detected` });
  }

  // CRITICAL: $0 liquidity = cannot sell = minimum 80 (fallback)
  if (fallbackLiquidity <= 0 && riskScore < 80) {
    console.log(`[Sentinel] Enforcing minimum 80 for $0 liquidity (was ${riskScore})`);
    riskScore = 80;
    flags.push({ type: 'LIQUIDITY', severity: 'CRITICAL', message: '$0 reported liquidity — extremely high rug risk, may not be sellable' });
  }

  // CRITICAL: Ultra-thin liquidity (<$1K) on very new token (<1h) = minimum 75
  if (fallbackAgeHours !== undefined && fallbackAgeHours < 1 && fallbackLiquidity > 0 && fallbackLiquidity < 1000 && riskScore < 75) {
    console.log(`[Sentinel] Enforcing minimum 75 for ultra-thin liquidity ($${fallbackLiquidity.toFixed(0)}) on <1h token (was ${riskScore})`);
    riskScore = 75;
    flags.push({ type: 'STRUCTURAL', severity: 'CRITICAL', message: `Token is ${(fallbackAgeHours * 60).toFixed(0)}m old with only $${fallbackLiquidity.toLocaleString()} liquidity — extreme rug risk` });
  }

  // Bundle detected + thin liquidity (<$2K) = minimum 70
  if (hasBundleDetection && fallbackLiquidity > 0 && fallbackLiquidity < 2000 && riskScore < 70) {
    console.log(`[Sentinel] Enforcing minimum 70 for bundles + thin liquidity ($${fallbackLiquidity.toFixed(0)}) (was ${riskScore})`);
    riskScore = 70;
    flags.push({ type: 'STRUCTURAL', severity: 'HIGH', message: `Bundle activity detected with only $${fallbackLiquidity.toLocaleString()} liquidity — coordinated rug risk` });
  }

  // ============================================
  // BUNDLE DOMINANCE GUARDRAIL (fallback)
  // When coordinated wallets make up a large % of holders, it's a syndicate pump
  // ============================================
  const fbHolderCountForBundle = tokenInfo.holderCount || 0;
  if (!fbIsMatureToken && bundleInfo.count > 0 && fbHolderCountForBundle > 0) {
    const fbBundleRatio = bundleInfo.count / fbHolderCountForBundle;
    if (bundleInfo.confidence === 'HIGH' && fbBundleRatio > 0.4 && riskScore < 75) {
      console.log(`[Sentinel] Enforcing minimum 75 for bundle dominance: ${bundleInfo.count}/${fbHolderCountForBundle} holders (${(fbBundleRatio * 100).toFixed(0)}%) are coordinated (was ${riskScore})`);
      riskScore = 75;
      flags.push({ type: 'BUNDLE_DOMINANCE', severity: 'CRITICAL', message: `Pump syndicate: ${bundleInfo.count} of ${fbHolderCountForBundle} holders (${(fbBundleRatio * 100).toFixed(0)}%) are coordinated wallets confirmed via same-block transactions` });
    } else if (fbBundleRatio > 0.5 && riskScore < 70) {
      console.log(`[Sentinel] Enforcing minimum 70 for bundle dominance: ${bundleInfo.count}/${fbHolderCountForBundle} holders (${(fbBundleRatio * 100).toFixed(0)}%) are coordinated (was ${riskScore})`);
      riskScore = 70;
      flags.push({ type: 'BUNDLE_DOMINANCE', severity: 'HIGH', message: `${bundleInfo.count} of ${fbHolderCountForBundle} holders (${(fbBundleRatio * 100).toFixed(0)}%) show coordinated wallet patterns — likely pump syndicate` });
    }
  }

  // Structural minimums
  if (fallbackAgeHours !== undefined && fallbackAgeHours < 6 && fallbackLiquidity < 10000 && riskScore < 55) {
    riskScore = 55;
  }
  if (fallbackAgeHours !== undefined && fallbackAgeHours < 24 && fallbackLiquidity < 5000 && riskScore < 55) {
    riskScore = 55;
  }
  if (fallbackLiquidity > 0 && fallbackLiquidity < 5000 && riskScore < 50) {
    riskScore = 50;
  }
  if (fallbackAgeHours !== undefined && fallbackAgeHours < 6 && riskScore < 50) {
    riskScore = 50;
  }
  if (fallbackAgeHours !== undefined && fallbackAgeHours < 24 && riskScore < 40) {
    riskScore = 40;
  }

  // ============================================
  // SELL PRESSURE GUARDRAIL
  // ============================================
  const fbSells24h = tokenInfo.txns24h?.sells || 0;
  const fbBuys24h = tokenInfo.txns24h?.buys || 0;
  if (fbSells24h > 0 && fbBuys24h > 0) {
    const fbBuyRatio = fbBuys24h / fbSells24h;
    if (fbBuyRatio < 0.7 && fbSells24h > 100 && fallbackAgeHours !== undefined && fallbackAgeHours < 24 && riskScore < 60) {
      console.log(`[Sentinel] Enforcing minimum 60 for sell-heavy new token (ratio ${fbBuyRatio.toFixed(2)}, was ${riskScore})`);
      riskScore = 60;
      flags.push({ type: 'SELL_PRESSURE', severity: 'HIGH', message: `Sell-heavy trading: ${fbSells24h} sells vs ${fbBuys24h} buys (ratio ${fbBuyRatio.toFixed(2)}) on <24h token` });
    } else if (fbBuyRatio < 0.5 && fbSells24h > 50 && riskScore < 55) {
      console.log(`[Sentinel] Enforcing minimum 55 for extreme sell pressure (ratio ${fbBuyRatio.toFixed(2)}, was ${riskScore})`);
      riskScore = 55;
      flags.push({ type: 'SELL_PRESSURE', severity: 'MEDIUM', message: `Heavy sell pressure: ${fbSells24h} sells vs ${fbBuys24h} buys (ratio ${fbBuyRatio.toFixed(2)})` });
    }
  }

  // ============================================
  // LOW HOLDER COUNT GUARDRAIL
  // ============================================
  const fbHolderCount = tokenInfo.holderCount || 0;
  if (fbHolderCount > 0 && fbHolderCount < 25 && fallbackAgeHours !== undefined && fallbackAgeHours < 6 && riskScore < 55) {
    console.log(`[Sentinel] Enforcing minimum 55 for low holder count (${fbHolderCount} holders on <6h token, was ${riskScore})`);
    riskScore = 55;
    flags.push({ type: 'LOW_HOLDERS', severity: 'MEDIUM', message: `Only ${fbHolderCount} holders on a ${fallbackAgeHours.toFixed(1)}h old token — very low organic adoption` });
  }

  // ============================================
  // DEV SELLING GUARDRAIL (fallback)
  // ============================================
  if (devActivity && devActivity.hasSold && fallbackAgeHours !== undefined) {
    if (devActivity.percentSold >= 50 && fallbackAgeHours < 6 && riskScore < 80) {
      console.log(`[Sentinel] Enforcing minimum 80 for dev sold ${devActivity.percentSold.toFixed(0)}% on <6h token (was ${riskScore})`);
      riskScore = 80;
      flags.push({ type: 'DEV_DUMP', severity: 'CRITICAL', message: `Developer sold ${devActivity.percentSold.toFixed(0)}% of tokens on a ${fallbackAgeHours.toFixed(1)}h old token — likely rug` });
    } else if (devActivity.percentSold >= 20 && devActivity.currentHoldingsPercent > 20 && fallbackAgeHours < 6 && riskScore < 75) {
      console.log(`[Sentinel] Enforcing minimum 75 for dev sold ${devActivity.percentSold.toFixed(0)}% + still holds ${devActivity.currentHoldingsPercent.toFixed(0)}% on <6h token (was ${riskScore})`);
      riskScore = 75;
      flags.push({ type: 'DEV_DUMP', severity: 'HIGH', message: `Developer sold ${devActivity.percentSold.toFixed(0)}% but still holds ${devActivity.currentHoldingsPercent.toFixed(0)}% — more selling likely` });
    } else if (devActivity.percentSold >= 20 && fallbackAgeHours < 24 && riskScore < 65) {
      console.log(`[Sentinel] Enforcing minimum 65 for dev sold ${devActivity.percentSold.toFixed(0)}% on <24h token (was ${riskScore})`);
      riskScore = 65;
      flags.push({ type: 'DEV_DUMP', severity: 'MEDIUM', message: `Developer sold ${devActivity.percentSold.toFixed(0)}% of tokens within first 24h` });
    }
  }

  // ============================================
  // COMBO SIGNAL ESCALATION
  // ============================================
  let fbModerateFlags = 0;
  if (fallbackAgeHours !== undefined && fallbackAgeHours < 6) fbModerateFlags++;
  if (fallbackLiquidity < 10000) fbModerateFlags++;
  if (fbSells24h > fbBuys24h && fbSells24h > 50) fbModerateFlags++;
  if (fbHolderCount > 0 && fbHolderCount < 30) fbModerateFlags++;
  if (hasBundleDetection && !fbIsMatureToken) fbModerateFlags++;
  if (isNewWallet) fbModerateFlags++;
  if (fallbackPriceChange !== undefined && fallbackPriceChange < -30) fbModerateFlags++;
  if (devActivity && devActivity.hasSold && devActivity.percentSold >= 20) fbModerateFlags++;

  // POSITIVE SIGNAL OFFSET (fallback)
  // SAFETY: Blocked when signals are likely a coordinated pump
  const fbIsHighBundle = bundleInfo?.confidence === 'HIGH' && !fbIsMatureToken;
  const fbBundleDominant = !fbIsMatureToken && fbHolderCountForBundle > 0 && bundleInfo.count > 0 && (bundleInfo.count / fbHolderCountForBundle) > 0.4;
  const fbTooThin = fallbackLiquidity < 2000;
  const fbTooNew = fallbackAgeHours !== undefined && fallbackAgeHours < 1;
  const fbOffsetBlocked = fbIsHighBundle || fbBundleDominant || fbTooThin || fbTooNew;

  const fbBuyRatio = fbBuys24h > 0 && fbSells24h > 0 ? fbBuys24h / fbSells24h : 0;

  if (!fbOffsetBlocked) {
    let fbPositiveSignals = 0;
    if (fbBuyRatio > 1.3) fbPositiveSignals++;
    if (fallbackPriceChange !== undefined && fallbackPriceChange > 50) fbPositiveSignals++;
    if (fallbackLiquidity > 0 && tokenInfo.volume24h && tokenInfo.volume24h / fallbackLiquidity > 5 && fbBuyRatio > 1) fbPositiveSignals++;

    const fbRawFlags = fbModerateFlags;
    if (fbPositiveSignals >= 3) {
      fbModerateFlags = Math.max(0, fbModerateFlags - 2);
      console.log(`[Sentinel] Positive offset -2: ${fbPositiveSignals} bullish signals (buyRatio=${fbBuyRatio.toFixed(2)}, price=${fallbackPriceChange?.toFixed(0)}%) — flags ${fbRawFlags} → ${fbModerateFlags}`);
    } else if (fbPositiveSignals >= 2) {
      fbModerateFlags = Math.max(0, fbModerateFlags - 1);
      console.log(`[Sentinel] Positive offset -1: ${fbPositiveSignals} bullish signals (buyRatio=${fbBuyRatio.toFixed(2)}, price=${fallbackPriceChange?.toFixed(0)}%) — flags ${fbRawFlags} → ${fbModerateFlags}`);
    }
  } else {
    console.log(`[Sentinel] Positive offset BLOCKED: highBundle=${fbIsHighBundle}, bundleDominant=${fbBundleDominant}, thinLiq=${fbTooThin}, tooNew=${fbTooNew}`);
  }

  if (fbModerateFlags >= 5 && riskScore < 75) {
    console.log(`[Sentinel] Enforcing minimum 75 for ${fbModerateFlags} combined risk signals (was ${riskScore})`);
    riskScore = 75;
    flags.push({ type: 'COMBO_RISK', severity: 'CRITICAL', message: `${fbModerateFlags} risk signals detected simultaneously — extreme compounding risk` });
  } else if (fbModerateFlags >= 4 && riskScore < 70) {
    console.log(`[Sentinel] Enforcing minimum 70 for ${fbModerateFlags} combined risk signals (was ${riskScore})`);
    riskScore = 70;
    flags.push({ type: 'COMBO_RISK', severity: 'HIGH', message: `${fbModerateFlags} risk signals detected simultaneously — compounding risk` });
  } else if (fbModerateFlags >= 3 && riskScore < 60) {
    console.log(`[Sentinel] Enforcing minimum 60 for ${fbModerateFlags} combined risk signals (was ${riskScore})`);
    riskScore = 60;
    flags.push({ type: 'COMBO_RISK', severity: 'MEDIUM', message: `${fbModerateFlags} risk signals detected — elevated compound risk` });
  }

  // ============================================
  // MATURITY OFFSET (fallback)
  // ============================================
  if (fbIsMatureToken) {
    let fbMaturityReduction = 0;
    if (fallbackMarketCap > 100_000_000) fbMaturityReduction += 15;
    else if (fallbackMarketCap > 10_000_000) fbMaturityReduction += 10;
    if (fallbackLiquidity > 1_000_000) fbMaturityReduction += 10;
    else if (fallbackLiquidity > 100_000) fbMaturityReduction += 5;
    if (fbMaturityReduction > 0) {
      const before = riskScore;
      riskScore = Math.max(20, riskScore - fbMaturityReduction);
      console.log(`[Sentinel] Maturity offset -${fbMaturityReduction}: mcap=$${(fallbackMarketCap/1e6).toFixed(1)}M, liq=$${(fallbackLiquidity/1e3).toFixed(0)}K — score ${before} → ${riskScore}`);
    }
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

    // Get user tier (based on token holdings or subscription)
    const { tier } = await getUserTier(
      walletAddress,
      c.env.ARGUSGUARD_MINT,
      c.env.HELIUS_API_KEY,
      c.env.SUPABASE_URL || '',
      c.env.SUPABASE_ANON_KEY || ''
    );

    // Check rate limit
    const rateLimitResult = await checkRateLimit(c.env.SCAN_CACHE, rateLimitIdentifier, tier);

    if (!rateLimitResult.allowed) {
      return c.json({
        error: rateLimitResult.error,
        remaining: 0,
        limit: rateLimitResult.limit,
        resetAt: rateLimitResult.resetAt,
      }, 429);
    }

    const heliusKey = c.env.HELIUS_API_KEY;
    const togetherKey = c.env.TOGETHER_AI_API_KEY;
    const model = c.env.TOGETHER_AI_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

    if (!heliusKey) {
      return c.json({ error: 'Helius API key not configured' }, 500);
    }

    if (!togetherKey) {
      return c.json({ error: 'Together AI API key not configured' }, 500);
    }

    // Fetch data in parallel - including transaction analysis for bundle detection
    console.log('[Sentinel] Starting parallel fetch...');
    const fetchStart = Date.now();

    // First fetch DexScreener to get LP pair address
    const dexData = await fetchDexScreenerData(tokenAddress);

    // Build known LP addresses list
    const knownLpAddresses: string[] = [];
    if (dexData?.pairAddress) {
      knownLpAddresses.push(dexData.pairAddress);
      console.log(`[Sentinel] Known LP from DexScreener: ${dexData.pairAddress.slice(0, 8)}...`);
    }

    // Now fetch remaining data with known LPs
    const [metadata, holders, txAnalysis, rugCheckData] = await Promise.all([
      fetchHeliusTokenMetadata(tokenAddress, heliusKey),
      fetchTopHolders(tokenAddress, heliusKey, 20, knownLpAddresses),
      analyzeTokenTransactions(tokenAddress, heliusKey),
      fetchRugCheckData(tokenAddress),
    ]);
    console.log(`[Sentinel] Parallel fetch took ${Date.now() - fetchStart}ms`);

    // Extract LP locked percentage from RugCheck
    const lpLockedPct = rugCheckData?.lpLockedPct ?? 0;

    // Get creator info - try multiple fast methods
    let creatorAddress: string | null = null;

    // Method 1: For pump.fun tokens, try pump.fun API (has creator directly)
    // DISABLED: Pump.fun API is blocking with Cloudflare 1016 error
    // if (isPumpFunToken(tokenAddress)) {
    //   try {
    //     const pumpData = await fetchPumpFunData(tokenAddress);
    //     if (pumpData?.creator) {
    //       creatorAddress = pumpData.creator;
    //       console.log('[Sentinel] Got creator from pump.fun API:', creatorAddress.slice(0, 8));
    //     }
    //   } catch (err) {
    //     console.warn('[Sentinel] Pump.fun API failed:', err);
    //   }
    // }

    // Method 2: Get from metadata update authority
    if (!creatorAddress && metadata?.updateAuthority) {
      creatorAddress = metadata.updateAuthority;
      console.log('[Sentinel] Using update authority as creator:', creatorAddress.slice(0, 8));
    }

    // Method 3: Use top non-LP holder as likely creator (fast heuristic)
    // For pump.fun, the creator often holds a significant portion
    if (!creatorAddress && holders.length > 0) {
      // Skip LP-like addresses (very high holdings, >40%) and find first regular holder with >2%
      const likelyCreator = holders.find(h => h.percent > 2 && h.percent < 40);
      if (likelyCreator) {
        creatorAddress = likelyCreator.address;
        console.log('[Sentinel] Using top holder as likely creator:', creatorAddress.slice(0, 8), `(${likelyCreator.percent.toFixed(1)}%)`);
      }
    }

    let creatorInfo = null;
    let creatorHoldingsPercent = 0;

    if (creatorAddress) {
      // Find creator in holders to get current holdings
      const creatorHolder = holders.find(h => h.address === creatorAddress);
      creatorHoldingsPercent = creatorHolder?.percent || 0;

      // Skip slow detailed analysis - just use basic info
      // Full analyzeCreatorWallet takes 10+ seconds checking rug history
      creatorInfo = {
        address: creatorAddress,
        walletAge: -1, // Unknown — -1 means "not checked", prevents false "new wallet" triggers
        tokensCreated: 0,
        ruggedTokens: 0,
        currentHoldings: creatorHoldingsPercent,
      };
      console.log(`[Sentinel] Creator: ${creatorAddress.slice(0, 8)}, holdings: ${creatorHoldingsPercent.toFixed(1)}%`);
    }

    // Analyze dev selling activity
    let devActivity = null;
    if (creatorAddress) {
      try {
        const devStart = Date.now();
        const devResult = await analyzeDevSelling(creatorAddress, tokenAddress, heliusKey);
        console.log(`[Sentinel] Dev selling analysis took ${Date.now() - devStart}ms: sold ${devResult.percentSold.toFixed(0)}%, holds ${devResult.currentHoldingsPercent.toFixed(1)}%`);

        // Only use dev activity if the creator actually held tokens
        // Update authority / protocol addresses never hold tokens — skip them
        if (devResult.hasSold || devResult.currentHoldingsPercent > 0) {
          devActivity = devResult;
        } else {
          console.log('[Sentinel] Creator never held tokens (likely protocol authority) — skipping dev activity');
        }
      } catch (err) {
        console.warn('[Sentinel] Dev selling analysis failed:', err);
      }
    }

    // Build token info with market data
    const mintAuthorityActive = !!metadata?.mintAuthority;
    const freezeAuthorityActive = !!metadata?.freezeAuthority;

    const ageHours = dexData?.pairCreatedAt
      ? (Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60)
      : undefined;

    // Estimate bonding curve liquidity for PumpFun tokens
    // DexScreener reports $0 for tokens still on bonding curve, but they ARE tradeable
    // PumpFun bonding curve provides ~20% of market cap as effective liquidity
    const isPumpFun = tokenAddress.endsWith('pump') || dexData?.dex === 'pumpfun';
    let effectiveLiquidity = dexData?.liquidityUsd || 0;
    if (isPumpFun && effectiveLiquidity <= 0 && dexData?.marketCap && dexData.marketCap > 0) {
      effectiveLiquidity = Math.round(dexData.marketCap * 0.20);
      console.log(`[Sentinel] PumpFun bonding curve: estimated liquidity $${effectiveLiquidity} from $${dexData.marketCap} market cap`);
    }

    const tokenInfo = {
      address: tokenAddress,
      name: metadata?.name || dexData?.name || 'Unknown',
      symbol: metadata?.symbol || dexData?.symbol || '???',
      price: dexData?.priceUsd,
      marketCap: dexData?.marketCap,
      liquidity: effectiveLiquidity,
      age: ageHours !== undefined ? Math.floor(ageHours / 24) : undefined,
      ageHours: ageHours !== undefined ? Math.round(ageHours * 10) / 10 : undefined,
      holderCount: holders.length,
      priceChange24h: dexData?.priceChange24h,
      volume24h: dexData?.volume24h,
      txns5m: dexData?.txns5m,
      txns1h: dexData?.txns1h,
      txns24h: dexData?.txns24h,
      mintAuthorityActive,
      freezeAuthorityActive,
    };

    // Build holder distribution for chart
    const holderDistribution = holders.slice(0, 10).map(h => {
      let type: 'creator' | 'whale' | 'insider' | 'lp' | 'normal' = 'normal';
      if (h.address === creatorAddress) type = 'creator';
      else if (h.isLp) type = 'lp';  // Use the detected LP flag
      else if (h.percent > 10) type = 'whale';
      else if (h.percent > 5) type = 'insider';
      return {
        address: h.address,
        percent: h.percent,
        type,
      };
    });

    // IMPROVED BUNDLE DETECTION - transaction-based is PRIMARY, holder-based is SUPPORTING
    // Method 1: Transaction-based (HIGH CONFIDENCE) - wallets buying in same slot
    const txBundleDetected = txAnalysis.bundleDetected;
    const txBundleCount = txAnalysis.coordinatedWallets;
    const txBundlePercent = txAnalysis.bundledBuyPercent;

    // Method 2: Holder pattern-based (SUPPORTING EVIDENCE ONLY)
    // Much stricter: require near-IDENTICAL holdings (0.1% tolerance) AND 5+ wallets
    // This avoids flagging natural distribution (people buying similar amounts)
    const nearIdenticalHoldings = holders.filter((h, i, arr) => {
      if (i === 0) return false;
      const prevPercent = arr[i - 1].percent;
      // Must be within 0.1% AND both > 1% holding
      return Math.abs(h.percent - prevPercent) < 0.1 && h.percent > 1 && arr[i - 1].percent > 1;
    });

    // Even stricter: check for EXACT same holdings (within 0.05%) - very suspicious
    const exactSameHoldings = holders.filter((h, i, arr) => {
      if (i === 0) return false;
      const prevPercent = arr[i - 1].percent;
      return Math.abs(h.percent - prevPercent) < 0.05 && h.percent > 0.5;
    });

    // Holder pattern only triggers with 5+ near-identical OR 3+ exact-same
    const holderBundleDetected = nearIdenticalHoldings.length >= 5 || exactSameHoldings.length >= 3;
    const holderBundleCount = Math.max(nearIdenticalHoldings.length, exactSameHoldings.length);

    // CONFIDENCE LEVELS:
    // HIGH: Transaction-based detected (same-block buys) - this is definitive
    // MEDIUM: Both transaction AND holder patterns agree
    // LOW: Only holder patterns (could be natural distribution)
    let bundleConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
    if (txBundleDetected && txBundlePercent > 20) {
      bundleConfidence = 'HIGH';
    } else if (txBundleDetected && holderBundleDetected) {
      bundleConfidence = 'HIGH';
    } else if (txBundleDetected) {
      bundleConfidence = 'MEDIUM';
    } else if (holderBundleDetected && exactSameHoldings.length >= 3) {
      bundleConfidence = 'MEDIUM'; // Exact same holdings is suspicious even without tx data
    } else if (holderBundleDetected) {
      bundleConfidence = 'LOW'; // Could be false positive
    }

    // Only flag as bundle if we have at least MEDIUM confidence
    const bundleDetected = bundleConfidence === 'HIGH' || bundleConfidence === 'MEDIUM';
    const bundleCount = txBundleDetected ? txBundleCount : holderBundleCount;

    // Build description with specifics
    let bundleDescription: string | undefined;
    if (bundleDetected || bundleConfidence === 'LOW') {
      const parts: string[] = [];
      if (txBundleDetected) {
        if (txBundlePercent > 0) {
          parts.push(`${txBundleCount} wallets bought in same block (${txBundlePercent.toFixed(1)}% of buys)`);
        } else {
          parts.push(`${txBundleCount} wallets transacted in same block`);
        }
      }
      if (exactSameHoldings.length >= 3) {
        parts.push(`${exactSameHoldings.length} wallets with near-identical holdings`);
      } else if (nearIdenticalHoldings.length >= 5) {
        parts.push(`${nearIdenticalHoldings.length} wallets with similar holdings (possible coordination)`);
      }
      bundleDescription = parts.join('; ');
    }

    const bundleInfo = {
      detected: bundleDetected,
      confidence: bundleConfidence,
      count: bundleCount,
      txBundlePercent: txBundlePercent,
      suspiciousPatterns: txAnalysis.suspiciousPatterns,
      description: bundleDescription,
    };

    if (bundleDetected) {
      console.log(`[Sentinel] BUNDLE DETECTED (${bundleConfidence}): ${bundleDescription}`);
    } else if (bundleConfidence === 'LOW') {
      console.log(`[Sentinel] Possible bundle (LOW confidence): ${bundleDescription}`);
    }

    // Build network graph
    const network = buildNetworkGraph(
      tokenAddress,
      tokenInfo.symbol,
      creatorAddress,
      holders,
      creatorHoldingsPercent
    );

    // Generate AI analysis - PASS BUNDLE INFO for proper scoring
    const aiStart = Date.now();
    const aiAnalysis = await generateNetworkAnalysis(
      tokenInfo,
      network,
      creatorInfo,
      bundleInfo,
      devActivity,
      togetherKey,
      model
    );
    console.log(`[Sentinel] AI analysis took ${Date.now() - aiStart}ms, AI score: ${aiAnalysis.riskScore}`);

    // ============================================
    // APPLY HARDCODED RULES (THE SPINE)
    // Overrides AI hallucinations with structural guardrails
    // ============================================
    const hasWebsite = !!(dexData?.websites && dexData.websites.length > 0);
    const hasTwitter = !!(dexData?.socials?.some(s =>
      s.type === 'twitter' || s.url?.includes('twitter.com') || s.url?.includes('x.com')
    ));

    const analysis = applyHardcodedRules(aiAnalysis, {
      tokenInfo: {
        marketCap: tokenInfo.marketCap,
        liquidity: tokenInfo.liquidity,
        ageHours: tokenInfo.ageHours,
        volume24h: tokenInfo.volume24h,
        txns24h: tokenInfo.txns24h,
        mintAuthorityActive: tokenInfo.mintAuthorityActive,
        freezeAuthorityActive: tokenInfo.freezeAuthorityActive,
      },
      holders,
      creatorInfo,
      bundleInfo,
      devActivity,
      isPumpFun,
      hasWebsite,
      hasTwitter,
      creatorAddress,
    });
    console.log(`[Sentinel] Final score after rules: ${analysis.riskScore} (${analysis.riskLevel})`);

    // ============================================
    // AUTO-TWEET: Alert on high-risk tokens
    // Fire-and-forget via waitUntil (doesn't block response)
    // Criteria: riskScore >= 70 (DANGEROUS/SCAM)
    // ============================================
    if (analysis.riskScore >= 70 && c.env.TWITTER_API_KEY) {
      const twitterConfig: TwitterConfig = {
        apiKey: c.env.TWITTER_API_KEY,
        apiSecret: c.env.TWITTER_API_SECRET || '',
        accessToken: c.env.TWITTER_ACCESS_TOKEN || '',
        accessTokenSecret: c.env.TWITTER_ACCESS_TOKEN_SECRET || '',
      };

      c.executionCtx.waitUntil(
        (async () => {
          try {
            const { allowed, reason } = await canTweet(c.env.SCAN_CACHE, tokenAddress);
            if (!allowed) {
              console.log(`[Twitter] Skipping tweet for ${tokenAddress}: ${reason}`);
              return;
            }

            const tweetText = formatAlertTweet({
              tokenAddress,
              name: tokenInfo.name,
              symbol: tokenInfo.symbol,
              riskScore: analysis.riskScore,
              riskLevel: analysis.riskLevel,
              liquidity: tokenInfo.liquidity || 0,
              marketCap: tokenInfo.marketCap || 0,
              ageHours: tokenInfo.ageHours || 0,
              bundleDetected: bundleInfo?.detected || false,
              bundleCount: bundleInfo?.count || 0,
              bundleConfidence: bundleInfo?.confidence || 'NONE',
              flags: analysis.flags || [],
              summary: analysis.summary || '',
            });

            const result = await postTweet(tweetText, twitterConfig);
            if (result.success && result.tweetId) {
              await recordTweet(c.env.SCAN_CACHE, tokenAddress, result.tweetId);
              console.log(`[Twitter] Alert posted: ${result.tweetUrl}`);
            } else {
              console.warn(`[Twitter] Failed to post: ${result.error}`);
            }
          } catch (err) {
            console.error('[Twitter] Auto-tweet error:', err);
          }
        })()
      );
    }

    // ============================================
    // AUTO-TELEGRAM: Alert on high-risk tokens
    // Fire-and-forget to Telegram channel
    // ============================================
    if (analysis.riskScore >= 70 && c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHANNEL_ID) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            // Check dedup (reuse Twitter KV prefix with telegram: prefix)
            const tgKey = `telegram:${tokenAddress}`;
            const existing = await c.env.SCAN_CACHE.get(tgKey);
            if (existing) {
              console.log(`[Telegram] Already alerted for ${tokenAddress}`);
              return;
            }

            const html = formatAlertHtml({
              tokenAddress,
              name: tokenInfo.name,
              symbol: tokenInfo.symbol,
              riskScore: analysis.riskScore,
              riskLevel: analysis.riskLevel,
              liquidity: tokenInfo.liquidity || 0,
              marketCap: tokenInfo.marketCap || 0,
              ageHours: tokenInfo.ageHours || 0,
              bundleDetected: bundleInfo?.detected || false,
              bundleCount: bundleInfo?.count || 0,
              bundleConfidence: bundleInfo?.confidence || 'NONE',
              flags: analysis.flags || [],
              summary: analysis.summary || '',
            });

            const result = await sendMessage(
              c.env.TELEGRAM_BOT_TOKEN!,
              c.env.TELEGRAM_CHANNEL_ID!,
              html
            );

            if (result.ok) {
              await c.env.SCAN_CACHE.put(tgKey, String(result.messageId), {
                expirationTtl: 7 * 24 * 60 * 60,
              });
              console.log(`[Telegram] Alert posted to channel, msg ${result.messageId}`);
            } else {
              console.warn(`[Telegram] Failed to post: ${result.error}`);
            }
          } catch (err) {
            console.error('[Telegram] Auto-alert error:', err);
          }
        })()
      );
    }

    // Add rate limit headers to response
    c.header('X-RateLimit-Limit', String(rateLimitResult.limit));
    c.header('X-RateLimit-Remaining', String(rateLimitResult.remaining));
    c.header('X-RateLimit-Reset', String(rateLimitResult.resetAt));
    c.header('X-User-Tier', tier);

    return c.json({
      tokenInfo,
      pairAddress: dexData?.pairAddress || null,
      security: {
        mintRevoked: !mintAuthorityActive,
        freezeRevoked: !freezeAuthorityActive,
        lpLockedPct,
      },
      network,
      analysis,
      creatorInfo,
      holderDistribution,
      bundleInfo,
      devActivity: devActivity ? {
        hasSold: devActivity.hasSold,
        percentSold: devActivity.percentSold,
        sellCount: devActivity.sellCount,
        currentHoldingsPercent: devActivity.currentHoldingsPercent,
        severity: devActivity.severity,
        message: devActivity.message,
      } : null,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[Sentinel] Analysis error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      500
    );
  }
});

export { sentinelRoutes };
