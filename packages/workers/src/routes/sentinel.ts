import { Hono } from 'hono';
import type { Bindings } from '../index';
import { fetchHeliusTokenMetadata } from '../services/helius';
import { fetchDexScreenerData } from '../services/dexscreener';

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
  limit: number = 20
): Promise<HolderInfo[]> {
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
          const isLp = LP_PREFIXES.some(prefix => owner.startsWith(prefix)) ||
            LP_PREFIXES.some(prefix => tokenAccountAddress.startsWith(prefix)) ||
            owner.includes('pool') ||
            tokenAccountAddress.includes('pool') ||
            (percent > 30 && !owner.includes('pump')); // Very high % and not bonding curve

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
    count: number;
    description?: string;
  },
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

  // ADD BUNDLE DETECTION TO CONTEXT - CRITICAL FOR SCORING
  if (bundleInfo.detected) {
    context += `
⚠️ BUNDLE DETECTED - CRITICAL WARNING:
- ${bundleInfo.count} wallets with suspiciously similar holdings detected
- This is a strong indicator of coordinated buying (bundle attack)
- Bundle wallets often dump simultaneously, causing massive price crashes
- MUST increase risk score significantly (+25-40 points)

`;
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

  const systemPrompt = `You are Sentinel, an AI that analyzes Solana token wallet networks to predict pump & dump schemes.

Analyze the provided network data and return a JSON response with:
1. riskScore (0-100): Overall risk based on network patterns
2. riskLevel: SAFE (<40), SUSPICIOUS (40-59), DANGEROUS (60-79), or SCAM (80+)
3. summary: 1-2 sentence risk summary
4. prediction: Your prediction of what will likely happen to this token
5. flags: Array of {type, severity, message} for specific risks
6. networkInsights: Array of strings with network pattern observations

RISK FACTORS:
- BUNDLE DETECTED (multiple wallets with similar holdings) = CRITICAL RISK (+30-40 points)
  * 10+ bundled wallets = minimum score 80 (SCAM)
  * 5-9 bundled wallets = minimum score 70 (DANGEROUS)
  * 3-4 bundled wallets = minimum score 60 (DANGEROUS)
- Concentrated holdings (few wallets hold most supply) = HIGH RISK
- Creator with previous rugs = CRITICAL
- New creator wallet (<7 days) = MEDIUM RISK
- Creator still holds large % = DUMP RISK
- Multiple whales >5% each = COORDINATION RISK

IMPORTANT: If BUNDLE DETECTED is mentioned in the context, you MUST score at least 60+. Bundles are the #1 indicator of coordinated pump & dump schemes.

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
      const score = Math.max(0, Math.min(100, parsed.riskScore || 50));
      return {
        riskScore: score,
        riskLevel: parsed.riskLevel || 'SUSPICIOUS',
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

  // Fallback analysis based on data
  let riskScore = 30;
  const flags: Array<{ type: string; severity: string; message: string }> = [];
  const networkInsights: string[] = [];

  // CRITICAL: Bundle detection significantly increases risk
  if (bundleInfo.detected) {
    if (bundleInfo.count >= 10) {
      riskScore += 40; // 10+ bundled wallets = CRITICAL
      flags.push({
        type: 'BUNDLE',
        severity: 'CRITICAL',
        message: `🚨 ${bundleInfo.count} coordinated wallets detected - HIGH probability of coordinated dump`,
      });
    } else if (bundleInfo.count >= 5) {
      riskScore += 30; // 5-9 bundled wallets = HIGH
      flags.push({
        type: 'BUNDLE',
        severity: 'HIGH',
        message: `⚠️ ${bundleInfo.count} wallets with similar holdings detected - likely coordinated buying`,
      });
    } else {
      riskScore += 20; // 3-4 bundled wallets = MEDIUM
      flags.push({
        type: 'BUNDLE',
        severity: 'MEDIUM',
        message: `${bundleInfo.count} wallets with similar holdings detected`,
      });
    }
    networkInsights.push(`Bundle pattern: ${bundleInfo.count} coordinated wallets`);
  }

  if (whales.length > 0) {
    riskScore += whales.length * 10;
    flags.push({
      type: 'CONCENTRATION',
      severity: 'HIGH',
      message: `${whales.length} wallet(s) hold >10% of supply`,
    });
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

    // Fetch data in parallel
    console.log('[Sentinel] Starting parallel fetch...');
    const fetchStart = Date.now();
    const [dexData, metadata, holders] = await Promise.all([
      fetchDexScreenerData(tokenAddress),
      fetchHeliusTokenMetadata(tokenAddress, heliusKey),
      fetchTopHolders(tokenAddress, heliusKey, 20),
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

    // Simple bundle detection based on holder patterns
    // Bundles often show as multiple wallets with very similar holdings
    const similarHoldings = holders.filter((h, i, arr) => {
      if (i === 0) return false;
      const prevPercent = arr[i - 1].percent;
      return Math.abs(h.percent - prevPercent) < 0.5 && h.percent > 1;
    });
    const bundleInfo = {
      detected: similarHoldings.length >= 3,
      count: similarHoldings.length,
      description: similarHoldings.length >= 3
        ? `${similarHoldings.length} wallets with suspiciously similar holdings detected`
        : undefined,
    };

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
