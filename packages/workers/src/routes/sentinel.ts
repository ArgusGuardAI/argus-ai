import { Hono } from 'hono';
import type { Bindings } from '../index';
import { fetchHeliusTokenMetadata, analyzeTokenTransactions, analyzeDevSelling } from '../services/helius';
import { fetchDexScreenerData } from '../services/dexscreener';
import { fetchPumpFunData, isPumpFunToken } from '../services/pumpfun';

const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';

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
${tokenInfo.age !== undefined ? `- Age: ${tokenInfo.age} days` : ''}

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
⚠️ BUNDLE DETECTED - HIGH CONFIDENCE (CRITICAL):
- ${bundleInfo.count} coordinated wallets CONFIRMED via same-block transactions
${bundleInfo.txBundlePercent ? `- ${bundleInfo.txBundlePercent.toFixed(1)}% of buys came from bundled transactions` : ''}
- This is DEFINITIVE evidence of coordinated buying (bundle attack)
- Bundle wallets will likely dump simultaneously
- MUST increase risk score significantly (+30-40 points)
${bundleInfo.description ? `\nDetails: ${bundleInfo.description}` : ''}
`;
    } else if (bundleInfo.confidence === 'MEDIUM') {
      context += `
⚠️ BUNDLE DETECTED - MEDIUM CONFIDENCE:
- ${bundleInfo.count} wallets show coordination patterns
${bundleInfo.txBundlePercent && bundleInfo.txBundlePercent > 0 ? `- ${bundleInfo.txBundlePercent.toFixed(1)}% of buys from same-block transactions` : '- Near-identical holdings detected'}
- Likely coordinated buying, exercise caution
- Increase risk score (+15-25 points)
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
- HIGH CONFIDENCE bundle (same-block transactions confirmed) = CRITICAL (+30-40 points, min score 70)
- MEDIUM CONFIDENCE bundle (strong patterns) = HIGH RISK (+15-25 points)
- LOW CONFIDENCE bundle (similar holdings only) = MINOR (+5-10 points max)
  * LOW confidence often means natural distribution, NOT a scam
  * Do NOT flag as SCAM based on LOW confidence alone

DEV SELLING ACTIVITY - Include this in your analysis:
- Dev sold >50% but still holds >5% = "Dev sold X% but still holds Y%" - DUMP RISK
- Dev sold >90% and holds <1% = Likely community-owned, reduced dump risk
- Dev has NOT sold and holds >20% = Major dump risk pending
- Dev has NOT sold and holds <5% = Minor concern
- Always mention specific percentages in your summary

OTHER RISK FACTORS:
- Concentrated holdings (few wallets hold most supply) = HIGH RISK
- Creator with previous rugs = CRITICAL (+40 points)
- New creator wallet (<7 days) = MEDIUM RISK (+10 points)
- Creator still holds large % (>20%) = DUMP RISK (+15 points)
- Multiple whales >5% each = COORDINATION RISK

IMPORTANT: Only score 80+ (SCAM) if you have HIGH confidence bundle detection OR creator has previous rugs. Similar holdings alone is NOT enough for SCAM rating.

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
      // POST-AI COMPOUNDING (always applies)
      // ============================================
      const isNewWallet = creatorInfo?.walletAge !== undefined && creatorInfo.walletAge < 7;
      const hasBundleDetection = bundleInfo.confidence === 'HIGH' || bundleInfo.confidence === 'MEDIUM';
      const hasWhale = whales.length > 0;
      const topWhalePercent = whales[0]?.holdingsPercent || 0;

      console.log(`[Sentinel] Post-AI check: newWallet=${isNewWallet}, bundle=${hasBundleDetection} (${bundleInfo.confidence}), whale=${hasWhale} (${topWhalePercent.toFixed(1)}%)`);

      // Count risk factors
      let riskFactors = 0;
      if (isNewWallet) riskFactors++;
      if (hasBundleDetection) riskFactors++;
      if (hasWhale && topWhalePercent >= 10) riskFactors++;

      // Apply compounding based on number of factors (non-stacking)
      if (riskFactors >= 3) {
        // Triple threat: New wallet + Bundle + Whale
        score += 20;
        aiFlags.push({
          type: 'SCAM PATTERN',
          severity: 'CRITICAL',
          message: `🚨 High-risk combo: New wallet + Bundle + Whale (${topWhalePercent.toFixed(1)}%)`,
        });
        console.log(`[Sentinel] TRIPLE THREAT = +20 (now ${score})`);
      } else if (riskFactors === 2) {
        // Double threat
        score += 10;
        console.log(`[Sentinel] Double risk factor = +10 (now ${score})`);
      }

      // Enforce minimums based on patterns
      // Triple threat = minimum 65 (DANGEROUS)
      if (riskFactors >= 3 && score < 65) {
        console.log(`[Sentinel] Enforcing minimum 65 for triple threat (was ${score})`);
        score = 65;
      }

      // HIGH confidence bundle = minimum 70 (DANGEROUS)
      if (bundleInfo.confidence === 'HIGH' && score < 70) {
        console.log(`[Sentinel] Enforcing minimum 70 for HIGH bundle (was ${score})`);
        score = 70;
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

  if (creatorInfo?.walletAge !== undefined && creatorInfo.walletAge < 7) {
    riskScore += 10;
    flags.push({
      type: 'DEPLOYER',
      severity: 'MEDIUM',
      message: `Creator wallet is only ${creatorInfo.walletAge} days old`,
    });
  }

  networkInsights.push(`${network.nodes.length} wallets in network`);
  if (whales.length > 0) {
    networkInsights.push(`Top whale holds ${whales[0]?.holdingsPercent?.toFixed(1)}%`);
  }

  // ============================================
  // COMPOUNDING RISK FACTORS
  // ============================================
  // When multiple red flags combine, the risk is much higher
  const isNewWallet = creatorInfo?.walletAge !== undefined && creatorInfo.walletAge < 7;
  const hasBundleDetection = bundleInfo.confidence === 'HIGH' || bundleInfo.confidence === 'MEDIUM';
  const hasWhale = whales.length > 0;
  const topWhalePercent = whales[0]?.holdingsPercent || 0;

  console.log(`[Sentinel] Compounding check: newWallet=${isNewWallet}, bundle=${hasBundleDetection} (${bundleInfo.confidence}), whale=${hasWhale} (${topWhalePercent.toFixed(1)}%)`);

  // New wallet + Bundle = coordinated scam setup
  if (isNewWallet && hasBundleDetection) {
    riskScore += 15;
    console.log(`[Sentinel] Compounding: New wallet + Bundle = +15`);
  }

  // New wallet + Whale = likely insider accumulation
  if (isNewWallet && hasWhale && topWhalePercent >= 10) {
    riskScore += 15;
    console.log(`[Sentinel] Compounding: New wallet + Whale = +15`);
  }

  // Bundle + Whale = coordinated pump before dump
  if (hasBundleDetection && hasWhale && topWhalePercent >= 10) {
    riskScore += 15;
    console.log(`[Sentinel] Compounding: Bundle + Whale = +15`);
  }

  // Triple threat: New wallet + Bundle + Whale = HIGHLY LIKELY SCAM
  if (isNewWallet && hasBundleDetection && hasWhale && topWhalePercent >= 10) {
    riskScore += 20; // Additional on top of the above
    flags.push({
      type: 'SCAM PATTERN',
      severity: 'CRITICAL',
      message: `🚨 High-risk combo: New wallet + Bundle + Whale concentration`,
    });
    console.log(`[Sentinel] TRIPLE THREAT: New wallet + Bundle + Whale = +20 additional`);
  }

  // For very new tokens (< 1 day), whale concentration is MORE dangerous
  const ageInDays = dexData?.pairCreatedAt
    ? (Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60 * 24)
    : undefined;

  if (ageInDays !== undefined && ageInDays < 1 && hasWhale && topWhalePercent >= 15) {
    riskScore += 10;
    flags.push({
      type: 'NEW TOKEN RISK',
      severity: 'HIGH',
      message: `Token is < 1 day old with ${topWhalePercent.toFixed(1)}% whale - high dump risk`,
    });
    console.log(`[Sentinel] New token + whale = +10`);
  }

  // ============================================
  // MINIMUM SCORE ENFORCEMENT
  // ============================================
  // Ensure certain patterns get minimum scores regardless of AI output

  // Triple threat (new wallet + bundle + whale) = minimum 70 (DANGEROUS)
  if (isNewWallet && hasBundleDetection && hasWhale && topWhalePercent >= 10) {
    if (riskScore < 70) {
      console.log(`[Sentinel] Enforcing minimum 70 for triple threat (was ${riskScore})`);
      riskScore = 70;
    }
  }

  // High confidence bundle = minimum 65 (DANGEROUS)
  if (bundleInfo.confidence === 'HIGH') {
    if (riskScore < 65) {
      console.log(`[Sentinel] Enforcing minimum 65 for HIGH bundle (was ${riskScore})`);
      riskScore = 65;
    }
  }

  // New wallet (<7 days) + any whale (>10%) = minimum 55 (SUSPICIOUS)
  if (isNewWallet && hasWhale && topWhalePercent >= 10) {
    if (riskScore < 55) {
      console.log(`[Sentinel] Enforcing minimum 55 for new wallet + whale (was ${riskScore})`);
      riskScore = 55;
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
    const [metadata, holders, txAnalysis] = await Promise.all([
      fetchHeliusTokenMetadata(tokenAddress, heliusKey),
      fetchTopHolders(tokenAddress, heliusKey, 20, knownLpAddresses),
      analyzeTokenTransactions(tokenAddress, heliusKey),
    ]);
    console.log(`[Sentinel] Parallel fetch took ${Date.now() - fetchStart}ms`);

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
        walletAge: 0, // Would need separate call
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
    const tokenInfo = {
      address: tokenAddress,
      name: metadata?.name || dexData?.name || 'Unknown',
      symbol: metadata?.symbol || dexData?.symbol || '???',
      price: dexData?.priceUsd,
      marketCap: dexData?.marketCap,
      liquidity: dexData?.liquidityUsd,
      age: dexData?.pairCreatedAt
        ? Math.floor((Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60 * 24))
        : undefined,
      holderCount: holders.length,
      priceChange24h: dexData?.priceChange24h,
      volume24h: dexData?.volume24h,
      txns5m: dexData?.txns5m,
      txns1h: dexData?.txns1h,
      txns24h: dexData?.txns24h,
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
    const analysis = await generateNetworkAnalysis(
      tokenInfo,
      network,
      creatorInfo,
      bundleInfo,
      devActivity,
      togetherKey,
      model
    );
    console.log(`[Sentinel] AI analysis took ${Date.now() - aiStart}ms`);

    return c.json({
      tokenInfo,
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
