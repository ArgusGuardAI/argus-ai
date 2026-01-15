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
 *
 * @param tokenAddress - The token mint address
 * @param apiKey - Helius API key
 * @param dexId - Optional pre-fetched dexId from DexScreener (avoids duplicate fetch)
 * @param pairCreatedAt - Optional pre-fetched creation timestamp from DexScreener
 */
export async function findTokenCreator(
  tokenAddress: string,
  apiKey: string,
  dexId?: string,
  pairCreatedAt?: number
): Promise<string | null> {
  try {
    console.log(`[Helius] Finding creator for token ${tokenAddress.slice(0, 8)}...`);

    // Check if this is a pump.fun token
    // Use pre-fetched dexId if available to avoid duplicate DexScreener call
    let isPumpFun = tokenAddress.toLowerCase().endsWith('pump');
    let creationTimestamp = pairCreatedAt;

    if (dexId) {
      // Use pre-fetched data
      isPumpFun = isPumpFun || dexId === 'pumpfun' || dexId === 'pumpswap';
    }

    // ALWAYS fetch from DexScreener to get the ORIGINAL pumpfun creation time
    // (even if we have a timestamp, it might be from pumpswap graduation)
    if (isPumpFun) {
      try {
        const dexResponse = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
        );

        if (dexResponse.ok) {
          const dexData = await dexResponse.json() as {
            pairs?: Array<{ dexId?: string; pairCreatedAt?: number }>;
          };
          // ALWAYS prefer the original pumpfun pair timestamp (not pumpswap graduation)
          const pumpfunPair = dexData.pairs?.find(p => p.dexId === 'pumpfun');
          if (pumpfunPair?.pairCreatedAt) {
            console.log(`[Helius] Using original pumpfun timestamp: ${pumpfunPair.pairCreatedAt}`);
            creationTimestamp = pumpfunPair.pairCreatedAt;
          }
          isPumpFun = isPumpFun || dexData.pairs?.some(p =>
            p.dexId === 'pumpfun' || p.dexId === 'pumpswap'
          ) || false;
        }
      } catch (err) {
        console.warn('[Helius] Failed to fetch DexScreener for pumpfun timestamp:', err);
      }
    }

    if (isPumpFun) {
      // For pump.fun tokens, use the reliable slot-based method
      console.log(`[Helius] Token is pump.fun/pumpswap, using slot-based creator detection`);
      const creator = await findPumpFunCreator(tokenAddress, apiKey, creationTimestamp);
      if (creator) return creator;
    }

    // Fallback 1: signature-based search (works for tokens with < 1000 txs)
    const creatorBySig = await findCreatorBySignatures(tokenAddress, apiKey);
    if (creatorBySig) return creatorBySig;

    // Fallback 2: Use Helius getAsset API to get update authority
    // For pump.fun tokens, update authority is often the creator
    console.log(`[Helius] Trying getAsset fallback for creator detection...`);
    const creatorByAsset = await findCreatorByAsset(tokenAddress, apiKey);
    if (creatorByAsset) return creatorByAsset;

    console.warn(`[Helius] All creator detection methods failed for ${tokenAddress.slice(0, 8)}`);
    return null;
  } catch (error) {
    console.error('[Helius] Error finding token creator:', error);
    return null;
  }
}

/**
 * Find pump.fun token creator by locating the exact creation slot
 * Uses binary search to quickly find the slot matching the creation timestamp
 *
 * @param tokenAddress - The token mint address
 * @param apiKey - Helius API key
 * @param pairCreatedAt - Optional pre-fetched creation timestamp (ms) from DexScreener
 */
async function findPumpFunCreator(
  tokenAddress: string,
  apiKey: string,
  pairCreatedAt?: number
): Promise<string | null> {
  try {
    console.log(`[Helius] Finding pump.fun creator for ${tokenAddress.slice(0, 8)}...`);

    let creationTimestampMs = pairCreatedAt;

    // Only fetch from DexScreener if timestamp not provided
    if (!creationTimestampMs) {
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
      creationTimestampMs = pumpfunPair.pairCreatedAt;
    }

    const creationTimestamp = Math.floor(creationTimestampMs / 1000);
    console.log(`[Helius] Pump.fun creation timestamp: ${creationTimestamp}`);

    // Step 2: Binary search to find the slot with matching timestamp
    const targetSlot = await binarySearchSlotByTime(creationTimestamp, apiKey);
    if (!targetSlot) {
      console.warn(`[Helius] Could not find slot for timestamp`);
      return null;
    }

    console.log(`[Helius] Found slot ${targetSlot} for timestamp ${creationTimestamp}`);

    // Step 3: Search this slot and nearby for the CREATE transaction
    // Expanded range to ±10 slots to account for timestamp drift
    for (let offset = -10; offset <= 10; offset++) {
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

/**
 * Fallback: Find creator using Helius getAsset API
 * For pump.fun tokens, the update authority is often the original creator
 */
async function findCreatorByAsset(
  tokenAddress: string,
  apiKey: string
): Promise<string | null> {
  try {
    const response = await fetch(`${HELIUS_RPC_BASE}/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-asset',
        method: 'getAsset',
        params: { id: tokenAddress },
      }),
    });

    if (!response.ok) {
      console.warn(`[Helius] getAsset request failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      result?: {
        authorities?: Array<{
          address: string;
          scopes: string[];
        }>;
        creators?: Array<{
          address: string;
          verified: boolean;
          share: number;
        }>;
        ownership?: {
          owner: string;
        };
      };
    };

    const result = data.result;
    if (!result) return null;

    // Priority 1: Check for verified creators
    const verifiedCreator = result.creators?.find(c => c.verified);
    if (verifiedCreator) {
      console.log(`[Helius] Found verified creator via getAsset: ${verifiedCreator.address.slice(0, 8)}...`);
      return verifiedCreator.address;
    }

    // Priority 2: Check update authority (common for pump.fun tokens)
    const updateAuth = result.authorities?.find(a =>
      a.scopes.includes('metadata') || a.scopes.includes('full')
    );
    if (updateAuth) {
      console.log(`[Helius] Found update authority via getAsset: ${updateAuth.address.slice(0, 8)}...`);
      return updateAuth.address;
    }

    // Priority 3: First creator (even if not verified)
    if (result.creators && result.creators.length > 0) {
      console.log(`[Helius] Found unverified creator via getAsset: ${result.creators[0].address.slice(0, 8)}...`);
      return result.creators[0].address;
    }

    console.warn(`[Helius] getAsset returned no creator/authority info`);
    return null;
  } catch (error) {
    console.error('[Helius] Error in getAsset fallback:', error);
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

  // Current holdings (PROACTIVE - can they still dump?)
  currentBalance: number;
  currentHoldingsPercent: number; // % of total supply they currently hold

  // Risk assessment
  severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
}

export interface InsiderAnalysis {
  // Early buyers who might be insiders/snipers
  insiders: InsiderWallet[];

  // Summary stats
  totalInsiderHoldingsPercent: number;
  highRiskInsiderCount: number; // Insiders holding 5%+ each

  // Risk assessment
  severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
}

export interface InsiderWallet {
  address: string;
  buySlot: number; // When they bought (lower = earlier)
  currentHoldingsPercent: number;
  isHighRisk: boolean; // Holds 5%+ of supply
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
  _apiKey: string
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
    currentHoldingsPercent: 0,
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

    // Step 3: Get current token balance AND total supply (for currentHoldingsPercent)
    let totalSupply = 0;

    try {
      // Fetch balance and supply in parallel
      const [balanceResponse, supplyResponse] = await Promise.all([
        fetch(
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
        ),
        fetch(
          `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'get-supply',
              method: 'getTokenSupply',
              params: [tokenAddress],
            }),
          }
        )
      ]);

      // Parse balance
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

      // Parse total supply
      if (supplyResponse.ok) {
        const supplyData = await supplyResponse.json() as {
          result?: {
            value?: {
              uiAmount: number;
            };
          };
        };
        totalSupply = supplyData.result?.value?.uiAmount || 0;
      }

      // Calculate currentHoldingsPercent (PROACTIVE metric)
      if (totalSupply > 0 && analysis.currentBalance > 0) {
        analysis.currentHoldingsPercent = (analysis.currentBalance / totalSupply) * 100;
        console.log(`[DevSelling] Creator holds ${analysis.currentHoldingsPercent.toFixed(2)}% of total supply (${analysis.currentBalance}/${totalSupply})`);
      }
    } catch (err) {
      console.warn('[DevSelling] Failed to get current balance/supply:', err);
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

      // Determine severity based on CURRENT HOLDINGS (proactive), not percent sold (reactive)
      // What matters for new buyers is: can the dev still dump?
      if (analysis.currentHoldingsPercent === 0) {
        // Dev has completely exited - actually SAFER for new buyers
        analysis.severity = 'NONE';
        analysis.message = `Dev exited (sold ${analysis.percentSold.toFixed(0)}%) - now community-owned`;
      } else if (analysis.currentHoldingsPercent >= 50) {
        analysis.severity = 'CRITICAL';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% - major dump risk`;
      } else if (analysis.currentHoldingsPercent >= 30) {
        analysis.severity = 'HIGH';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% - significant dump risk`;
      } else if (analysis.currentHoldingsPercent >= 20) {
        analysis.severity = 'MEDIUM';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% of supply`;
      } else if (analysis.currentHoldingsPercent >= 10) {
        analysis.severity = 'LOW';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% - some dump potential`;
      } else {
        analysis.severity = 'NONE';
        analysis.message = `Dev holds minimal amount (${analysis.currentHoldingsPercent.toFixed(1)}%)`;
      }
    }

    // Also evaluate severity if dev hasn't sold but holds tokens (most important proactive case!)
    if (!analysis.hasSold && analysis.currentHoldingsPercent > 0) {
      if (analysis.currentHoldingsPercent >= 50) {
        analysis.severity = 'CRITICAL';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% - major dump risk`;
      } else if (analysis.currentHoldingsPercent >= 30) {
        analysis.severity = 'HIGH';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% - significant dump risk`;
      } else if (analysis.currentHoldingsPercent >= 20) {
        analysis.severity = 'MEDIUM';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% of supply`;
      } else if (analysis.currentHoldingsPercent >= 10) {
        analysis.severity = 'LOW';
        analysis.message = `Dev holds ${analysis.currentHoldingsPercent.toFixed(1)}% - some dump potential`;
      }
    }

    console.log(`[DevSelling] Creator ${creatorAddress.slice(0, 8)}: holds ${analysis.currentHoldingsPercent.toFixed(1)}%, sold ${analysis.percentSold.toFixed(1)}%`);

  } catch (error) {
    console.error('[DevSelling] Analysis error:', error);
  }

  return analysis;
}

/**
 * Analyze early buyers/snipers who might be insiders
 * PROACTIVE detection - identifies wallets that could dump
 */
export async function analyzeInsiders(
  tokenAddress: string,
  creatorAddress: string | null,
  apiKey: string,
  knownLpAddresses?: string[]
): Promise<InsiderAnalysis> {
  const analysis: InsiderAnalysis = {
    insiders: [],
    totalInsiderHoldingsPercent: 0,
    highRiskInsiderCount: 0,
    severity: 'NONE',
    message: 'No suspicious early buyers detected',
  };

  try {
    console.log(`[Insiders] Analyzing early buyers for ${tokenAddress.slice(0, 8)}...`);

    // Step 1: Get the first N transactions to find early buyers
    const sigResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-sigs',
          method: 'getSignaturesForAddress',
          params: [tokenAddress, { limit: 100 }],
        }),
      }
    );

    if (!sigResponse.ok) {
      console.warn(`[Insiders] Failed to get signatures`);
      return analysis;
    }

    const sigData = await sigResponse.json() as {
      result?: Array<{ signature: string; slot: number }>;
    };

    const signatures = sigData.result || [];
    if (signatures.length === 0) return analysis;

    // Sort by slot (ascending) to find earliest
    signatures.sort((a, b) => a.slot - b.slot);

    // Get the first slot (creation slot)
    const creationSlot = signatures[0].slot;

    // Find early transactions (within first 50 slots of creation)
    const earlySignatures = signatures
      .filter(sig => sig.slot <= creationSlot + 50)
      .slice(0, 30) // Max 30 to avoid timeout
      .map(sig => sig.signature);

    if (earlySignatures.length === 0) return analysis;

    // Step 2: Parse these transactions to find buyers
    const parseResponse = await fetch(
      `${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: earlySignatures }),
      }
    );

    if (!parseResponse.ok) return analysis;

    const parsedTxs = await parseResponse.json() as Array<{
      feePayer: string;
      type: string;
      slot: number;
      source?: string;
      tokenTransfers?: Array<{
        mint: string;
        toUserAccount: string;
        tokenAmount: number;
      }>;
    }>;

    // Step 3: Identify wallets that received tokens early (excluding creator and LPs)
    const earlyBuyers = new Map<string, { slot: number; amount: number }>();

    // Build set of known LP addresses (from DexScreener pair + hardcoded)
    const lpAddressSet = new Set(knownLpAddresses || []);
    // Add common Raydium LP authority
    lpAddressSet.add('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');

    for (const tx of parsedTxs) {
      if (!tx.tokenTransfers) continue;

      for (const transfer of tx.tokenTransfers) {
        if (transfer.mint !== tokenAddress) continue;

        const receiver = transfer.toUserAccount;

        // Skip creator, known LPs, and pump.fun bonding curves
        if (receiver === creatorAddress) continue;
        if (lpAddressSet.has(receiver)) continue;
        if (receiver.includes('pump')) continue; // Bonding curve addresses

        // Track this early buyer
        const existing = earlyBuyers.get(receiver);
        if (!existing || tx.slot < existing.slot) {
          earlyBuyers.set(receiver, {
            slot: tx.slot,
            amount: (existing?.amount || 0) + transfer.tokenAmount,
          });
        }
      }
    }

    console.log(`[Insiders] Found ${earlyBuyers.size} early buyers`);

    if (earlyBuyers.size === 0) return analysis;

    // Step 4: Get total supply for percentage calculation
    const supplyResponse = await fetch(
      `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-supply',
          method: 'getTokenSupply',
          params: [tokenAddress],
        }),
      }
    );

    let totalSupply = 0;
    if (supplyResponse.ok) {
      const supplyData = await supplyResponse.json() as {
        result?: { value?: { uiAmount: number } };
      };
      totalSupply = supplyData.result?.value?.uiAmount || 0;
    }

    if (totalSupply === 0) {
      console.warn('[Insiders] Could not get total supply');
      return analysis;
    }

    // Step 5: Check current holdings of early buyers (sample top 10)
    const earlyBuyerEntries = Array.from(earlyBuyers.entries())
      .sort((a, b) => a[1].slot - b[1].slot)
      .slice(0, 10);

    for (const [wallet, data] of earlyBuyerEntries) {
      try {
        const balanceResponse = await fetch(
          `${HELIUS_RPC_BASE}/?api-key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `balance-${wallet.slice(0, 8)}`,
              method: 'getTokenAccountsByOwner',
              params: [
                wallet,
                { mint: tokenAddress },
                { encoding: 'jsonParsed' }
              ],
            }),
          }
        );

        if (!balanceResponse.ok) continue;

        const balanceData = await balanceResponse.json() as {
          result?: {
            value?: Array<{
              account: {
                data: {
                  parsed: {
                    info: {
                      tokenAmount: { uiAmount: number };
                    };
                  };
                };
              };
            }>;
          };
        };

        let currentBalance = 0;
        for (const account of balanceData.result?.value || []) {
          currentBalance += account.account.data.parsed.info.tokenAmount.uiAmount || 0;
        }

        const holdingsPercent = (currentBalance / totalSupply) * 100;

        // Only track if they still hold meaningful amount (>1%)
        if (holdingsPercent > 1) {
          const isHighRisk = holdingsPercent >= 5; // 5%+ is high risk

          analysis.insiders.push({
            address: wallet,
            buySlot: data.slot,
            currentHoldingsPercent: holdingsPercent,
            isHighRisk,
          });

          analysis.totalInsiderHoldingsPercent += holdingsPercent;
          if (isHighRisk) {
            analysis.highRiskInsiderCount++;
          }
        }
      } catch (err) {
        console.warn(`[Insiders] Error checking wallet ${wallet.slice(0, 8)}:`, err);
      }
    }

    // Step 6: Calculate severity
    if (analysis.highRiskInsiderCount >= 3) {
      analysis.severity = 'CRITICAL';
      analysis.message = `${analysis.highRiskInsiderCount} early buyers each hold 5%+ of supply (${analysis.totalInsiderHoldingsPercent.toFixed(1)}% total)`;
    } else if (analysis.highRiskInsiderCount >= 2) {
      analysis.severity = 'HIGH';
      analysis.message = `${analysis.highRiskInsiderCount} early buyers hold significant portions (${analysis.totalInsiderHoldingsPercent.toFixed(1)}% total)`;
    } else if (analysis.totalInsiderHoldingsPercent >= 20) {
      analysis.severity = 'MEDIUM';
      analysis.message = `Early buyers collectively hold ${analysis.totalInsiderHoldingsPercent.toFixed(1)}% of supply`;
    } else if (analysis.totalInsiderHoldingsPercent >= 10) {
      analysis.severity = 'LOW';
      analysis.message = `Some early buyer concentration detected (${analysis.totalInsiderHoldingsPercent.toFixed(1)}%)`;
    }

    console.log(`[Insiders] ${analysis.insiders.length} insiders found, ${analysis.highRiskInsiderCount} high-risk, ${analysis.totalInsiderHoldingsPercent.toFixed(1)}% total holdings`);

  } catch (error) {
    console.error('[Insiders] Analysis error:', error);
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
