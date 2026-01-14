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
 * Find the original creator/deployer of a token
 * For pump.fun tokens: Uses DexScreener to get creation timestamp, then finds the exact slot
 * For other tokens: Falls back to signature-based search
 */
export async function findTokenCreator(
  tokenAddress: string,
  apiKey: string
): Promise<string | null> {
  try {
    console.log(`[Helius] Finding creator for token ${tokenAddress.slice(0, 8)}...`);

    // Check if this is a pump.fun token (address ends in 'pump')
    const isPumpFun = tokenAddress.toLowerCase().endsWith('pump');

    if (isPumpFun) {
      // For pump.fun tokens, use the reliable slot-based method
      const creator = await findPumpFunCreator(tokenAddress, apiKey);
      if (creator) return creator;
    }

    // Fallback: signature-based search (works for tokens with < 1000 txs)
    return await findCreatorBySignatures(tokenAddress, apiKey);
  } catch (error) {
    console.error('[Helius] Error finding token creator:', error);
    return null;
  }
}

/**
 * Find pump.fun token creator by locating the exact creation slot
 * Uses binary search to quickly find the slot matching the creation timestamp
 */
async function findPumpFunCreator(
  tokenAddress: string,
  apiKey: string
): Promise<string | null> {
  try {
    console.log(`[Helius] Finding pump.fun creator for ${tokenAddress.slice(0, 8)}...`);

    // Step 1: Get creation timestamp from DexScreener
    const dexResponse = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
    );

    if (!dexResponse.ok) {
      console.warn(`[Helius] DexScreener request failed: ${dexResponse.status}`);
      return null;
    }

    const dexData = await dexResponse.json() as {
      pairs?: Array<{
        dexId: string;
        pairCreatedAt?: number;
      }>;
    };

    // Find the pumpfun pair (original creation)
    const pumpfunPair = dexData.pairs?.find(p => p.dexId === 'pumpfun');
    if (!pumpfunPair?.pairCreatedAt) {
      console.warn(`[Helius] No pump.fun pair found in DexScreener`);
      return null;
    }

    const creationTimestamp = Math.floor(pumpfunPair.pairCreatedAt / 1000);
    console.log(`[Helius] Pump.fun creation timestamp: ${creationTimestamp}`);

    // Step 2: Binary search to find the slot with matching timestamp
    const targetSlot = await binarySearchSlotByTime(creationTimestamp, apiKey);
    if (!targetSlot) {
      console.warn(`[Helius] Could not find slot for timestamp`);
      return null;
    }

    console.log(`[Helius] Found slot ${targetSlot} for timestamp ${creationTimestamp}`);

    // Step 3: Search this slot and nearby for the CREATE transaction
    for (let offset = -5; offset <= 5; offset++) {
      const creator = await findCreateTxInSlot(tokenAddress, targetSlot + offset, apiKey);
      if (creator) {
        console.log(`[Helius] Found pump.fun creator at slot ${targetSlot + offset}: ${creator}`);
        return creator;
      }
    }

    console.warn(`[Helius] Could not find CREATE transaction in slots around ${targetSlot}`);
    return null;
  } catch (error) {
    console.error('[Helius] Error finding pump.fun creator:', error);
    return null;
  }
}

/**
 * Binary search to find a slot with a specific timestamp
 * Much faster than linear search - finds slot in ~15 iterations
 */
async function binarySearchSlotByTime(
  targetTimestamp: number,
  apiKey: string
): Promise<number | null> {
  try {
    // Get current slot as upper bound
    const currentSlotResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-slot',
          method: 'getSlot',
          params: [],
        }),
      }
    );

    const currentSlotData = await currentSlotResponse.json() as { result?: number };
    const currentSlot = currentSlotData.result;
    if (!currentSlot) return null;

    // Estimate search range - slot ~2.5/sec, but add buffer
    const timeDiff = Math.floor(Date.now() / 1000) - targetTimestamp;
    const estimatedSlotDiff = Math.floor(timeDiff * 2.5);

    // Binary search within range
    let low = currentSlot - estimatedSlotDiff - 10000; // Add buffer
    let high = currentSlot - estimatedSlotDiff + 10000;
    let bestSlot = null;
    let bestDiff = Infinity;

    // Helper to get block time
    const getBlockTime = async (slot: number): Promise<number | null> => {
      const resp = await fetch(
        `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `time-${slot}`,
            method: 'getBlockTime',
            params: [slot],
          }),
        }
      );
      const data = await resp.json() as { result?: number };
      return data.result || null;
    };

    // Binary search (~15 iterations max)
    for (let i = 0; i < 20 && low <= high; i++) {
      const mid = Math.floor((low + high) / 2);
      const midTime = await getBlockTime(mid);

      if (!midTime) {
        // Slot doesn't exist, narrow from above
        high = mid - 1;
        continue;
      }

      const diff = midTime - targetTimestamp;

      // Track best match
      if (Math.abs(diff) < bestDiff) {
        bestDiff = Math.abs(diff);
        bestSlot = mid;
      }

      // If we're within 5 seconds, good enough
      if (Math.abs(diff) <= 5) {
        return mid;
      }

      if (diff < 0) {
        // midTime is before target, search later slots
        low = mid + 1;
      } else {
        // midTime is after target, search earlier slots
        high = mid - 1;
      }
    }

    return bestSlot;
  } catch (error) {
    console.error('[Helius] Binary search error:', error);
    return null;
  }
}

/**
 * Convert a Unix timestamp to a Solana slot number (simple estimation)
 */
async function timestampToSlot(
  targetTimestamp: number,
  apiKey: string
): Promise<number | null> {
  try {
    // Get a recent slot as reference point
    const recentSlotResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-slot',
          method: 'getSlot',
          params: [],
        }),
      }
    );

    const recentSlotData = await recentSlotResponse.json() as { result?: number };
    const recentSlot = recentSlotData.result;
    if (!recentSlot) return null;

    // Get timestamp for recent slot
    const recentTimeResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-time',
          method: 'getBlockTime',
          params: [recentSlot],
        }),
      }
    );

    const recentTimeData = await recentTimeResponse.json() as { result?: number };
    const recentTimestamp = recentTimeData.result;
    if (!recentTimestamp) return null;

    // Calculate estimated slot (~2.5 slots per second)
    const timeDiff = recentTimestamp - targetTimestamp;
    const slotDiff = Math.floor(timeDiff * 2.5);
    const estimatedSlot = recentSlot - slotDiff;

    console.log(`[Helius] Estimated slot: ${estimatedSlot} (reference: ${recentSlot}, diff: ${slotDiff})`);
    return estimatedSlot;
  } catch (error) {
    console.error('[Helius] Error converting timestamp to slot:', error);
    return null;
  }
}

/**
 * Find CREATE transaction for a token in a specific slot
 */
async function findCreateTxInSlot(
  tokenAddress: string,
  slot: number,
  apiKey: string
): Promise<string | null> {
  try {
    // Get block with full transaction details
    const blockResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-block',
          method: 'getBlock',
          params: [slot, {
            encoding: 'jsonParsed',
            transactionDetails: 'full',
            maxSupportedTransactionVersion: 0,
          }],
        }),
      }
    );

    const blockData = await blockResponse.json() as {
      result?: {
        transactions?: Array<{
          transaction: {
            signatures: string[];
            message: {
              accountKeys: Array<{ pubkey: string }>;
            };
          };
        }>;
      };
    };

    const transactions = blockData.result?.transactions;
    if (!transactions) return null;

    // Find transactions involving our token
    const tokenTxs = transactions.filter(tx =>
      tx.transaction.message.accountKeys.some(key => key.pubkey === tokenAddress)
    );

    if (tokenTxs.length === 0) return null;

    // Get signatures and parse them with Helius to find the CREATE tx
    const signatures = tokenTxs.slice(0, 10).map(tx => tx.transaction.signatures[0]);

    const parseResponse = await fetch(
      `${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: signatures }),
      }
    );

    const parsedTxs = await parseResponse.json() as Array<{
      feePayer: string;
      type: string;
      source?: string;
    }>;

    // Find the CREATE transaction from PUMP_FUN - ONLY return if we find the actual creation
    const createTx = parsedTxs.find(tx =>
      tx.type === 'CREATE' && tx.source === 'PUMP_FUN'
    );

    if (createTx) {
      return createTx.feePayer;
    }

    // No CREATE transaction found in this slot - return null to keep searching
    return null;
  } catch (error) {
    console.error(`[Helius] Error searching slot ${slot}:`, error);
    return null;
  }
}

/**
 * Fallback: Find creator by searching signatures (works for low-volume tokens)
 */
async function findCreatorBySignatures(
  tokenAddress: string,
  apiKey: string
): Promise<string | null> {
  try {
    const signaturesResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-signatures',
          method: 'getSignaturesForAddress',
          params: [tokenAddress, { limit: 1000 }],
        }),
      }
    );

    const signaturesData = await signaturesResponse.json() as {
      result?: Array<{ signature: string; slot: number }>;
    };

    const signatures = signaturesData.result;
    if (!signatures || signatures.length === 0) return null;

    // If we got 1000 signatures, we can't reliably find the first
    if (signatures.length >= 1000) {
      console.warn(`[Helius] Token has 1000+ txs - cannot reliably find creator via signatures`);
      return null;
    }

    // Find earliest signature
    const earliest = signatures.reduce((min, curr) =>
      curr.slot < min.slot ? curr : min
    );

    // Parse the transaction
    const txResponse = await fetch(
      `${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [earliest.signature] }),
      }
    );

    const txData = await txResponse.json() as Array<{ feePayer: string }>;
    return txData[0]?.feePayer || null;
  } catch (error) {
    console.error('[Helius] Error in signature-based search:', error);
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

export interface DevSellingAnalysis {
  creatorAddress: string;
  tokenAddress: string;

  // Did dev sell?
  hasSold: boolean;

  // How much did they sell?
  totalSold: number; // raw token amount
  percentSold: number; // % of their original holdings

  // Timing
  firstSellTimestamp?: number;
  lastSellTimestamp?: number;
  sellCount: number;

  // Current holdings
  currentBalance: number;

  // Risk assessment
  severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
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
 * Analyze if the creator/dev has sold their tokens
 * This is a CRITICAL indicator - if the dev dumps, it's almost certainly a rug
 */
export async function analyzeDevSelling(
  creatorAddress: string,
  tokenAddress: string,
  apiKey: string
): Promise<DevSellingAnalysis> {
  const analysis: DevSellingAnalysis = {
    creatorAddress,
    tokenAddress,
    hasSold: false,
    totalSold: 0,
    percentSold: 0,
    sellCount: 0,
    currentBalance: 0,
    severity: 'NONE',
    message: 'No dev selling detected',
  };

  try {
    // Step 1: Get creator's transaction history for this specific token
    const response = await fetch(
      `${HELIUS_API_BASE}/addresses/${creatorAddress}/transactions?api-key=${apiKey}&type=SWAP&limit=100`
    );

    if (!response.ok) {
      console.warn(`[DevSelling] Failed to fetch creator transactions: ${response.status}`);
      return analysis;
    }

    const transactions = await response.json() as Array<{
      signature: string;
      timestamp: number;
      type: string;
      feePayer: string;
      description?: string;
      source?: string;
      tokenTransfers?: Array<{
        mint: string;
        fromUserAccount: string;
        toUserAccount: string;
        tokenAmount: number;
      }>;
      nativeTransfers?: Array<{
        fromUserAccount: string;
        toUserAccount: string;
        amount: number;
      }>;
    }>;

    // Step 2: Find all ACTUAL SELLS (not just transfers) of this token by the creator
    // A real sell means: creator sent tokens AND received SOL/value in return
    let totalReceived = 0; // How much they originally got (mints + buys)
    let totalSoldAmount = 0;
    let sellTimestamps: number[] = [];

    // Known DEX/swap keywords in transaction descriptions
    const sellKeywords = ['sold', 'swapped', 'swap'];
    const dexSources = ['RAYDIUM', 'JUPITER', 'ORCA', 'PUMP_FUN', 'METEORA'];

    for (const tx of transactions) {
      if (!tx.tokenTransfers) continue;

      const desc = (tx.description || '').toLowerCase();
      const source = (tx.source || '').toUpperCase();

      // Check if this is actually a DEX swap transaction
      const isSellDescription = sellKeywords.some(kw => desc.includes(kw));
      const isDexSource = dexSources.some(dex => source.includes(dex));
      const isSwapType = tx.type === 'SWAP';

      // Check if creator received SOL in this transaction (indicates real sale)
      const creatorReceivedSol = tx.nativeTransfers?.some(
        nt => nt.toUserAccount === creatorAddress && nt.amount > 0
      ) || false;

      for (const transfer of tx.tokenTransfers) {
        // Only look at transfers of THIS token
        if (transfer.mint !== tokenAddress) continue;

        // Creator RECEIVING tokens (original allocation or buys)
        if (transfer.toUserAccount === creatorAddress) {
          totalReceived += transfer.tokenAmount;
        }

        // Creator SELLING tokens - must be a REAL DEX SELL, not just a transfer
        // Criteria: Creator sent tokens AND (received SOL OR it's a known DEX swap)
        if (transfer.fromUserAccount === creatorAddress) {
          const isRealSell = creatorReceivedSol || isSellDescription || isDexSource || isSwapType;

          if (isRealSell) {
            totalSoldAmount += transfer.tokenAmount;
            sellTimestamps.push(tx.timestamp);
            analysis.sellCount++;
            console.log(`[DevSelling] Found real sell: ${transfer.tokenAmount} tokens, source=${source}, desc=${desc.slice(0, 50)}`);
          } else {
            console.log(`[DevSelling] Skipped transfer (not a DEX sell): ${transfer.tokenAmount} tokens`);
          }
        }
      }
    }

    // Step 3: Get current token balance
    try {
      const balanceResponse = await fetch(
        `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'get-token-accounts',
            method: 'getTokenAccountsByOwner',
            params: [
              creatorAddress,
              { mint: tokenAddress },
              { encoding: 'jsonParsed' }
            ],
          }),
        }
      );

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json() as {
          result?: {
            value?: Array<{
              account: {
                data: {
                  parsed: {
                    info: {
                      tokenAmount: {
                        uiAmount: number;
                      };
                    };
                  };
                };
              };
            }>;
          };
        };

        const tokenAccounts = balanceData.result?.value || [];
        for (const account of tokenAccounts) {
          analysis.currentBalance += account.account.data.parsed.info.tokenAmount.uiAmount || 0;
        }
      }
    } catch (err) {
      console.warn('[DevSelling] Failed to get current balance:', err);
    }

    // Step 4: Calculate selling metrics
    if (totalSoldAmount > 0) {
      analysis.hasSold = true;
      analysis.totalSold = totalSoldAmount;

      // Calculate percent sold
      // Original holdings = what they received OR current + sold (whichever is higher)
      const originalHoldings = Math.max(totalReceived, analysis.currentBalance + totalSoldAmount);
      if (originalHoldings > 0) {
        analysis.percentSold = (totalSoldAmount / originalHoldings) * 100;
      }

      // Timestamps
      if (sellTimestamps.length > 0) {
        analysis.firstSellTimestamp = Math.min(...sellTimestamps);
        analysis.lastSellTimestamp = Math.max(...sellTimestamps);
      }

      // Determine severity based on percent sold
      if (analysis.percentSold >= 90) {
        analysis.severity = 'CRITICAL';
        analysis.message = `DEV DUMPED: Creator sold ${analysis.percentSold.toFixed(0)}% of tokens (${analysis.sellCount} sales)`;
      } else if (analysis.percentSold >= 70) {
        analysis.severity = 'HIGH';
        analysis.message = `DEV SELLING HEAVILY: Creator sold ${analysis.percentSold.toFixed(0)}% of tokens`;
      } else if (analysis.percentSold >= 50) {
        analysis.severity = 'MEDIUM';
        analysis.message = `Dev sold ${analysis.percentSold.toFixed(0)}% of holdings`;
      } else if (analysis.percentSold >= 20) {
        analysis.severity = 'LOW';
        analysis.message = `Dev sold ${analysis.percentSold.toFixed(0)}% - taking some profit`;
      } else {
        analysis.severity = 'NONE';
        analysis.message = `Minor dev selling (${analysis.percentSold.toFixed(0)}%)`;
      }
    }

    console.log(`[DevSelling] Creator ${creatorAddress.slice(0, 8)}: sold ${analysis.percentSold.toFixed(1)}% (${analysis.sellCount} txs)`);

  } catch (error) {
    console.error('[DevSelling] Analysis error:', error);
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
