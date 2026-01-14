/**
 * Helius API Service
 * Comprehensive data fetching using Helius DAS and Enhanced Transactions APIs
 *
 * Docs:
 * - DAS API: https://www.helius.dev/docs/das-api
 * - Enhanced Transactions: https://www.helius.dev/docs/enhanced-transactions
 * - Token APIs: https://www.helius.dev/solana-token-apis
 */

const HELIUS_API_BASE = 'https://api.helius.xyz/v0';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';

/**
 * Find the original creator/deployer of a token by looking at its first transaction
 * This is a fallback when pump.fun API is unavailable
 */
export async function findTokenCreator(
  tokenAddress: string,
  apiKey: string
): Promise<string | null> {
  try {
    // Method 1: Get token signatures and find the earliest one
    const signaturesResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-signatures',
          method: 'getSignaturesForAddress',
          params: [
            tokenAddress,
            { limit: 1000 } // Get as many as possible to find the first
          ],
        }),
      }
    );

    if (!signaturesResponse.ok) {
      console.warn(`Failed to get signatures: ${signaturesResponse.status}`);
      return null;
    }

    const signaturesData = await signaturesResponse.json() as {
      result?: Array<{
        signature: string;
        slot: number;
        blockTime?: number;
      }>;
    };

    const signatures = signaturesData.result;
    if (!signatures || signatures.length === 0) {
      console.warn('No signatures found for token');
      return null;
    }

    // Get the earliest signature (last in the array since they're returned newest-first)
    const earliestSignature = signatures[signatures.length - 1].signature;
    console.log(`[Helius] Found earliest tx: ${earliestSignature}`);

    // Method 2: Parse the earliest transaction to find the creator
    const txResponse = await fetch(
      `${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: [earliestSignature],
        }),
      }
    );

    if (!txResponse.ok) {
      console.warn(`Failed to parse transaction: ${txResponse.status}`);
      return null;
    }

    const txData = await txResponse.json() as Array<{
      signature: string;
      feePayer: string;
      type: string;
      source?: string;
      description?: string;
      tokenTransfers?: Array<{
        mint: string;
        fromUserAccount: string;
        toUserAccount: string;
      }>;
      accountData?: Array<{
        account: string;
        nativeBalanceChange: number;
        tokenBalanceChanges?: Array<{
          mint: string;
          rawTokenAmount: {
            tokenAmount: string;
          };
          userAccount: string;
        }>;
      }>;
    }>;

    if (!txData || txData.length === 0) {
      console.warn('Could not parse earliest transaction');
      return null;
    }

    const earliestTx = txData[0];

    // The fee payer of the first transaction is typically the creator
    const creator = earliestTx.feePayer;

    if (creator) {
      console.log(`[Helius] Found token creator: ${creator}`);
      return creator;
    }

    return null;
  } catch (error) {
    console.error('Error finding token creator:', error);
    return null;
  }
}

export interface HeliusTokenMetadata {
  tokenAddress: string;
  name?: string;
  symbol?: string;
  decimals: number;
  supply: number;

  // Authorities (critical for rug detection)
  mintAuthority?: string;
  freezeAuthority?: string;
  updateAuthority?: string;

  // Off-chain metadata
  description?: string;
  image?: string;
  externalUrl?: string;

  // Token program
  tokenProgram: 'spl-token' | 'token-2022';

  // Price info (if available)
  priceUsd?: number;
}

export interface CreatorAnalysis {
  creatorAddress: string;
  walletAge: number; // days since first transaction
  firstTxDate?: string;

  // Token creation history
  tokensCreated: number;
  tokensMinted: TokenMintInfo[];

  // Rug indicators
  ruggedTokens: number;
  suspiciousPatterns: string[];

  // Risk assessment
  riskScore: number; // 0-100
  riskFlags: string[];
}

export interface TokenMintInfo {
  tokenAddress: string;
  name?: string;
  symbol?: string;
  mintedAt: number;
  currentPrice?: number;
  priceChange?: number; // % from ATH
  isLikelyRug: boolean;
}

export interface TransactionAnalysis {
  // Bundle detection
  bundleDetected: boolean;
  bundledBuyPercent: number;
  coordinatedWallets: number;

  // Trading patterns
  totalBuys24h: number;
  totalSells24h: number;
  uniqueBuyers24h: number;
  uniqueSellers24h: number;

  // Whale activity
  largeTransactions: LargeTransaction[];

  // Suspicious patterns
  suspiciousPatterns: string[];
}

export interface LargeTransaction {
  signature: string;
  type: 'buy' | 'sell';
  amountUsd: number;
  wallet: string;
  timestamp: number;
}

/**
 * Fetch token metadata using Helius DAS API
 */
export async function fetchHeliusTokenMetadata(
  tokenAddress: string,
  apiKey: string
): Promise<HeliusTokenMetadata | null> {
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'token-metadata',
        method: 'getAsset',
        params: { id: tokenAddress },
      }),
    });

    if (!response.ok) {
      console.warn(`Helius DAS API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      result?: {
        id: string;
        content?: {
          metadata?: {
            name?: string;
            symbol?: string;
            description?: string;
          };
          links?: {
            image?: string;
            external_url?: string;
          };
        };
        token_info?: {
          decimals?: number;
          supply?: number;
          mint_authority?: string;
          freeze_authority?: string;
          token_program?: string;
          price_info?: {
            price_per_token?: number;
          };
        };
        authorities?: Array<{
          address: string;
          scopes: string[];
        }>;
      };
    };

    const result = data.result;
    if (!result) return null;

    // Find update authority
    const updateAuth = result.authorities?.find(a =>
      a.scopes.includes('metadata') || a.scopes.includes('full')
    );

    return {
      tokenAddress: result.id,
      name: result.content?.metadata?.name,
      symbol: result.content?.metadata?.symbol,
      decimals: result.token_info?.decimals || 9,
      supply: result.token_info?.supply || 0,

      mintAuthority: result.token_info?.mint_authority,
      freezeAuthority: result.token_info?.freeze_authority,
      updateAuthority: updateAuth?.address,

      description: result.content?.metadata?.description,
      image: result.content?.links?.image,
      externalUrl: result.content?.links?.external_url,

      tokenProgram: result.token_info?.token_program === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
        ? 'token-2022'
        : 'spl-token',

      priceUsd: result.token_info?.price_info?.price_per_token,
    };
  } catch (error) {
    console.error('Helius DAS API error:', error);
    return null;
  }
}

/**
 * Analyze a creator/deployer wallet for rug history
 */
export async function analyzeCreatorWallet(
  creatorAddress: string,
  apiKey: string
): Promise<CreatorAnalysis> {
  const analysis: CreatorAnalysis = {
    creatorAddress,
    walletAge: 0,
    tokensCreated: 0,
    tokensMinted: [],
    ruggedTokens: 0,
    suspiciousPatterns: [],
    riskScore: 50, // Default medium risk
    riskFlags: [],
  };

  try {
    // Get wallet transaction history to find token mints
    const response = await fetch(
      `${HELIUS_API_BASE}/addresses/${creatorAddress}/transactions?api-key=${apiKey}&type=TOKEN_MINT&limit=50`
    );

    if (!response.ok) {
      analysis.riskFlags.push('Unable to fetch creator history');
      analysis.riskScore = 70;
      return analysis;
    }

    const transactions = await response.json() as Array<{
      signature: string;
      timestamp: number;
      type: string;
      tokenTransfers?: Array<{
        mint: string;
        tokenAmount: number;
        tokenStandard?: string;
      }>;
      description?: string;
    }>;

    if (transactions.length === 0) {
      // New wallet with no history
      analysis.riskFlags.push('New wallet with no transaction history');
      analysis.riskScore = 75;
      return analysis;
    }

    // Calculate wallet age from oldest transaction
    const timestamps = transactions.map(tx => tx.timestamp).filter(Boolean);
    if (timestamps.length > 0) {
      const oldestTx = Math.min(...timestamps) * 1000; // Convert to ms
      const ageMs = Date.now() - oldestTx;
      analysis.walletAge = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      analysis.firstTxDate = new Date(oldestTx).toISOString().split('T')[0];
    }

    // Find unique tokens created by this wallet
    const tokenMints = new Set<string>();
    for (const tx of transactions) {
      if (tx.type === 'TOKEN_MINT' && tx.tokenTransfers) {
        for (const transfer of tx.tokenTransfers) {
          if (transfer.mint) {
            tokenMints.add(transfer.mint);
          }
        }
      }
    }

    analysis.tokensCreated = tokenMints.size;

    // Check each token for rug indicators (sample up to 10)
    const tokensToCheck = Array.from(tokenMints).slice(0, 10);

    for (const tokenMint of tokensToCheck) {
      const tokenInfo = await checkTokenForRug(tokenMint, apiKey);
      if (tokenInfo) {
        analysis.tokensMinted.push(tokenInfo);
        if (tokenInfo.isLikelyRug) {
          analysis.ruggedTokens++;
        }
      }
    }

    // Calculate risk score based on findings
    calculateCreatorRiskScore(analysis);

  } catch (error) {
    console.error('Creator analysis error:', error);
    analysis.riskFlags.push('Error analyzing creator wallet');
    analysis.riskScore = 70;
  }

  return analysis;
}

/**
 * Check if a token looks like a rug pull
 */
async function checkTokenForRug(
  tokenAddress: string,
  apiKey: string
): Promise<TokenMintInfo | null> {
  try {
    // Quick check via DexScreener for price history
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);

    if (!response.ok) {
      return {
        tokenAddress,
        mintedAt: 0,
        isLikelyRug: false, // Can't determine
      };
    }

    const data = await response.json() as {
      pairs?: Array<{
        baseToken: { name?: string; symbol?: string };
        priceUsd?: string;
        priceChange?: { h24?: number };
        pairCreatedAt?: number;
        liquidity?: { usd?: number };
      }>;
    };

    const pair = data.pairs?.[0];
    if (!pair) {
      return {
        tokenAddress,
        mintedAt: 0,
        isLikelyRug: false,
      };
    }

    const currentPrice = parseFloat(pair.priceUsd || '0');
    const liquidity = pair.liquidity?.usd || 0;
    const age = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
    const ageInDays = age / (1000 * 60 * 60 * 24);

    // Rug indicators:
    // - Token is >7 days old with <$100 liquidity
    // - Price dropped >99% and liquidity is near zero
    const isLikelyRug = (ageInDays > 7 && liquidity < 100) ||
                        (liquidity < 50 && ageInDays > 1);

    return {
      tokenAddress,
      name: pair.baseToken?.name,
      symbol: pair.baseToken?.symbol,
      mintedAt: pair.pairCreatedAt || 0,
      currentPrice,
      priceChange: pair.priceChange?.h24,
      isLikelyRug,
    };
  } catch {
    return null;
  }
}

/**
 * Calculate risk score for creator based on analysis
 */
function calculateCreatorRiskScore(analysis: CreatorAnalysis): void {
  let score = 30; // Base score

  // Wallet age factor
  if (analysis.walletAge === 0) {
    score += 30;
    analysis.riskFlags.push('Brand new wallet (0 days old)');
  } else if (analysis.walletAge < 7) {
    score += 20;
    analysis.riskFlags.push(`Very new wallet (${analysis.walletAge} days old)`);
  } else if (analysis.walletAge < 30) {
    score += 10;
    analysis.riskFlags.push(`New wallet (${analysis.walletAge} days old)`);
  } else if (analysis.walletAge > 180) {
    score -= 10;
    // Established wallet is good
  }

  // Token creation history
  if (analysis.tokensCreated > 10) {
    score += 15;
    analysis.riskFlags.push(`Serial token creator (${analysis.tokensCreated} tokens)`);
  } else if (analysis.tokensCreated > 5) {
    score += 10;
    analysis.riskFlags.push(`Multiple tokens created (${analysis.tokensCreated})`);
  }

  // Rug history - CRITICAL
  if (analysis.ruggedTokens > 0) {
    const rugPenalty = Math.min(analysis.ruggedTokens * 15, 40);
    score += rugPenalty;
    analysis.riskFlags.push(`PREVIOUS RUGS DETECTED: ${analysis.ruggedTokens} dead tokens`);
    analysis.suspiciousPatterns.push(`${analysis.ruggedTokens} previous tokens with zero liquidity`);
  }

  // Clamp score
  analysis.riskScore = Math.max(0, Math.min(100, score));
}

/**
 * Analyze token transactions for bundle detection and trading patterns
 */
export async function analyzeTokenTransactions(
  tokenAddress: string,
  apiKey: string
): Promise<TransactionAnalysis> {
  const analysis: TransactionAnalysis = {
    bundleDetected: false,
    bundledBuyPercent: 0,
    coordinatedWallets: 0,
    totalBuys24h: 0,
    totalSells24h: 0,
    uniqueBuyers24h: 0,
    uniqueSellers24h: 0,
    largeTransactions: [],
    suspiciousPatterns: [],
  };

  try {
    // Fetch recent transactions for this token
    const response = await fetch(
      `${HELIUS_API_BASE}/addresses/${tokenAddress}/transactions?api-key=${apiKey}&type=SWAP&limit=100`
    );

    if (!response.ok) {
      return analysis;
    }

    const transactions = await response.json() as Array<{
      signature: string;
      timestamp: number;
      type: string;
      slot: number;
      feePayer: string;
      nativeTransfers?: Array<{
        fromUserAccount: string;
        toUserAccount: string;
        amount: number;
      }>;
      tokenTransfers?: Array<{
        mint: string;
        fromUserAccount: string;
        toUserAccount: string;
        tokenAmount: number;
      }>;
      description?: string;
    }>;

    const now = Date.now() / 1000;
    const dayAgo = now - 86400;

    // Track unique wallets and timing
    const buyers = new Set<string>();
    const sellers = new Set<string>();
    const slotGroups: Map<number, string[]> = new Map();

    for (const tx of transactions) {
      if (tx.timestamp < dayAgo) continue;

      const wallet = tx.feePayer;
      const isBuy = tx.description?.toLowerCase().includes('bought') ||
                    tx.description?.toLowerCase().includes('swap') &&
                    tx.tokenTransfers?.some(t => t.toUserAccount === wallet);

      if (isBuy) {
        analysis.totalBuys24h++;
        buyers.add(wallet);
      } else {
        analysis.totalSells24h++;
        sellers.add(wallet);
      }

      // Group transactions by slot for bundle detection
      const slot = tx.slot;
      const existing = slotGroups.get(slot) || [];
      existing.push(wallet);
      slotGroups.set(slot, existing);
    }

    analysis.uniqueBuyers24h = buyers.size;
    analysis.uniqueSellers24h = sellers.size;

    // Detect bundles (multiple different wallets in same slot)
    // Threshold of 5+ wallets to avoid false positives from normal trading
    let bundledWallets = 0;
    for (const [, wallets] of slotGroups) {
      const uniqueWallets = new Set(wallets);
      if (uniqueWallets.size >= 5) {
        analysis.bundleDetected = true;
        bundledWallets += uniqueWallets.size;
        analysis.suspiciousPatterns.push(
          `${uniqueWallets.size} wallets transacted in same slot`
        );
      }
    }

    if (analysis.totalBuys24h > 0) {
      analysis.bundledBuyPercent = (bundledWallets / analysis.totalBuys24h) * 100;
    }
    analysis.coordinatedWallets = bundledWallets;

    // Flag suspicious patterns
    if (analysis.bundledBuyPercent > 30) {
      analysis.suspiciousPatterns.push(
        `High bundle percentage: ${analysis.bundledBuyPercent.toFixed(1)}%`
      );
    }

    if (analysis.uniqueBuyers24h > 0 &&
        analysis.totalBuys24h / analysis.uniqueBuyers24h > 5) {
      analysis.suspiciousPatterns.push(
        'Possible wash trading: high tx/unique buyer ratio'
      );
    }

  } catch (error) {
    console.error('Transaction analysis error:', error);
  }

  return analysis;
}

/**
 * Build comprehensive context string for AI from Helius data
 */
export function buildHeliusContext(
  metadata: HeliusTokenMetadata | null,
  creator: CreatorAnalysis | null,
  transactions: TransactionAnalysis | null
): string {
  let context = '';

  // Token metadata
  if (metadata) {
    context += `\nTOKEN METADATA (Helius DAS):\n`;
    if (metadata.name) context += `- Name: ${metadata.name}\n`;
    if (metadata.symbol) context += `- Symbol: ${metadata.symbol}\n`;
    context += `- Decimals: ${metadata.decimals}\n`;
    context += `- Supply: ${metadata.supply.toLocaleString()}\n`;
    context += `- Token Program: ${metadata.tokenProgram}\n`;

    // Authorities - critical for rug detection
    context += `\nAUTHORITIES:\n`;
    if (metadata.mintAuthority) {
      context += `- Mint Authority: ${metadata.mintAuthority}\n`;
      context += `  ⚠️ WARNING: Mint authority exists - can create more tokens\n`;
    } else {
      context += `- Mint Authority: REVOKED ✓\n`;
    }

    if (metadata.freezeAuthority) {
      context += `- Freeze Authority: ${metadata.freezeAuthority}\n`;
      context += `  ⚠️ WARNING: Freeze authority exists - can freeze accounts\n`;
    } else {
      context += `- Freeze Authority: REVOKED ✓\n`;
    }
  }

  // Creator analysis
  if (creator) {
    context += `\nCREATOR/DEPLOYER ANALYSIS:\n`;
    context += `- Creator Wallet: ${creator.creatorAddress}\n`;
    context += `- Wallet Age: ${creator.walletAge} days`;
    if (creator.firstTxDate) context += ` (first tx: ${creator.firstTxDate})`;
    context += `\n`;
    context += `- Tokens Created: ${creator.tokensCreated}\n`;
    context += `- Creator Risk Score: ${creator.riskScore}/100\n`;

    if (creator.ruggedTokens > 0) {
      context += `\n⚠️ CRITICAL - PREVIOUS RUGS DETECTED:\n`;
      context += `- Dead/Rugged Tokens: ${creator.ruggedTokens}\n`;
      for (const token of creator.tokensMinted.filter(t => t.isLikelyRug)) {
        context += `  - ${token.symbol || token.tokenAddress.slice(0, 8)}: Liquidity drained\n`;
      }
    }
    // Note: Removed "Creator Risk Flags" section to avoid AI duplicating flags
    // The AI already sees wallet age and can derive appropriate flags
  }

  // Transaction analysis
  if (transactions) {
    context += `\nTRANSACTION ANALYSIS (24h):\n`;
    context += `- Total Buys: ${transactions.totalBuys24h} (${transactions.uniqueBuyers24h} unique)\n`;
    context += `- Total Sells: ${transactions.totalSells24h} (${transactions.uniqueSellers24h} unique)\n`;

    if (transactions.bundleDetected) {
      context += `\n⚠️ BUNDLE DETECTION:\n`;
      context += `- Bundles Detected: YES\n`;
      context += `- Coordinated Wallets: ${transactions.coordinatedWallets}\n`;
      context += `- Bundled Buy %: ${transactions.bundledBuyPercent.toFixed(1)}%\n`;
    }

    if (transactions.suspiciousPatterns.length > 0) {
      context += `\nSuspicious Patterns:\n`;
      for (const pattern of transactions.suspiciousPatterns) {
        context += `  - ⚠️ ${pattern}\n`;
      }
    }
  }

  return context;
}
