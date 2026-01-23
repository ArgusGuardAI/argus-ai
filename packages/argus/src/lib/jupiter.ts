/**
 * Jupiter Swap Service
 * Handles token swaps via Jupiter Aggregator
 * Routes through backend proxy to avoid CORS issues
 */

import { Connection, VersionedTransaction, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Use our backend proxy for Jupiter (avoids CORS)
const API_BASE = import.meta.env.VITE_API_URL || 'https://argusguard-api.hermosillo-jessie.workers.dev';
const JUPITER_API = `${API_BASE}/jupiter`;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Helius RPC with our API key for reliable connections
const HELIUS_API_KEY = '54846763-d323-4cb5-8d67-23ed50c19d10';
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Argus AI fee configuration
// TESTING MODE: Fee collection disabled - set wallet to enable
const ARGUS_FEE_WALLET: string | null = null; // Production: 'DvQzNPwaVAC2sKvyAkermrmvhnfGftxYdr3tTchB3NEv'
const ARGUS_FEE_PERCENT = 0.5; // 0.5% fee on AI-executed trades

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      label: string;
    };
  }>;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  error?: string;
}

/**
 * Get a swap quote from Jupiter via backend proxy
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number, // In lamports or smallest unit
  slippageBps: number = 100 // 1% default slippage
): Promise<SwapQuote | null> {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
    });

    // Use our backend proxy to avoid CORS
    const url = `${JUPITER_API}/quote?${params}`;
    console.log('[Jupiter] Fetching quote via proxy:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log('[Jupiter] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Jupiter] Quote error:', errorText);
      return null;
    }

    const data = await response.json();
    console.log('[Jupiter] Quote received:', data);
    return data;
  } catch (error) {
    console.error('[Jupiter] Failed to get swap quote:', error);
    return null;
  }
}

/**
 * Execute a swap transaction via backend proxy
 */
export async function executeSwap(
  quote: SwapQuote,
  userPublicKey: PublicKey,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>
): Promise<SwapResult> {
  try {
    console.log('[Jupiter] Building swap transaction via proxy...');

    // Get swap transaction from Jupiter via our backend proxy
    const swapResponse = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userPublicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 50000, // 0.00005 SOL priority fee
      }),
    });

    if (!swapResponse.ok) {
      const error = await swapResponse.text();
      console.error('[Jupiter] Swap build error:', error);
      return { success: false, error: `Failed to build swap: ${error}` };
    }

    const swapData = await swapResponse.json();
    console.log('[Jupiter] Swap transaction built successfully');

    // Deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Sign the transaction with user's wallet
    console.log('[Jupiter] Signing transaction...');
    const signedTransaction = await signTransaction(transaction);

    // Send the transaction via Helius RPC
    console.log('[Jupiter] Sending transaction via Helius RPC...');
    const connection = new Connection(HELIUS_RPC, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });
    const rawTransaction = signedTransaction.serialize();

    const signature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });

    console.log('[Jupiter] Transaction sent:', signature);

    // Wait for confirmation
    const latestBlockHash = await connection.getLatestBlockhash('confirmed');
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      console.error('[Jupiter] Transaction failed:', confirmation.value.err);
      return {
        success: false,
        signature,
        error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
      };
    }

    console.log('[Jupiter] Transaction confirmed:', signature);
    return { success: true, signature };
  } catch (error) {
    console.error('[Jupiter] Swap execution error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send Argus AI fee (used when fee wallet is configured)
 */
export async function sendArgusFee(
  connection: Connection,
  userPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  feeAmountSol: number
): Promise<string | null> {
  if (!ARGUS_FEE_WALLET || feeAmountSol <= 0) {
    console.log('[Fee] No fee wallet configured or zero fee');
    return null;
  }

  try {
    const feeLamports = Math.floor(feeAmountSol * LAMPORTS_PER_SOL);
    const feeWallet = new PublicKey(ARGUS_FEE_WALLET);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userPublicKey,
        toPubkey: feeWallet,
        lamports: feeLamports,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPublicKey;

    const signedTx = await signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    console.log(`[Fee] Collected ${feeAmountSol} SOL fee: ${signature}`);
    return signature;
  } catch (error) {
    console.error('[Fee] Failed to collect fee:', error);
    return null;
  }
}

/**
 * Buy tokens with SOL
 * @param withAiFee - If true, deducts 0.5% fee for Argus AI
 */
export async function buyToken(
  tokenMint: string,
  solAmount: number, // In SOL (not lamports)
  userPublicKey: PublicKey,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  slippageBps: number = 100,
  withAiFee: boolean = false
): Promise<SwapResult> {
  let actualAmount = solAmount;
  let feeAmount = 0;

  // Calculate and deduct fee for AI trades
  if (withAiFee && ARGUS_FEE_WALLET) {
    feeAmount = solAmount * (ARGUS_FEE_PERCENT / 100);
    actualAmount = solAmount - feeAmount;
    console.log(`[Buy] AI fee: ${feeAmount.toFixed(6)} SOL, Trading: ${actualAmount.toFixed(6)} SOL`);
  }

  const lamports = Math.floor(actualAmount * 1e9); // Convert SOL to lamports

  const quote = await getSwapQuote(SOL_MINT, tokenMint, lamports, slippageBps);
  if (!quote) {
    return { success: false, error: 'Failed to get quote' };
  }

  return executeSwap(quote, userPublicKey, signTransaction);
}

/**
 * Sell tokens for SOL
 * @param withAiFee - If true, 0.5% of received SOL goes to Argus AI
 */
export async function sellToken(
  tokenMint: string,
  tokenAmount: number, // In smallest token units
  userPublicKey: PublicKey,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  slippageBps: number = 100,
  withAiFee: boolean = false
): Promise<SwapResult> {
  if (withAiFee && ARGUS_FEE_WALLET) {
    console.log(`[Sell] AI fee enabled (${ARGUS_FEE_PERCENT}% of proceeds)`);
  }

  const quote = await getSwapQuote(tokenMint, SOL_MINT, tokenAmount, slippageBps);
  if (!quote) {
    return { success: false, error: 'Failed to get quote' };
  }

  // Note: For sells, fee would be collected from the SOL received
  // This requires a post-swap fee transfer which we'll implement
  // when the fee wallet is configured
  return executeSwap(quote, userPublicKey, signTransaction);
}

/**
 * Check if Argus AI fee is configured
 */
export function isAiFeeConfigured(): boolean {
  return ARGUS_FEE_WALLET !== null;
}

/**
 * Get the AI fee percentage
 */
export function getAiFeePercent(): number {
  return ARGUS_FEE_PERCENT;
}

/**
 * Get ALL token balances for a wallet (for detecting untracked positions)
 */
export async function getAllTokenBalances(
  walletAddress: string
): Promise<Array<{ mint: string; balance: number; decimals: number }>> {
  const rpcEndpoints = [
    HELIUS_RPC,
    'https://api.mainnet-beta.solana.com',
  ];

  for (const rpc of rpcEndpoints) {
    try {
      console.log(`[Jupiter] Scanning all token balances via ${rpc.includes('helius') ? 'Helius' : 'public'} RPC`);
      const connection = new Connection(rpc, { commitment: 'confirmed' });
      const walletPubkey = new PublicKey(walletAddress);

      // Get ALL token accounts for this wallet
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const tokens: Array<{ mint: string; balance: number; decimals: number }> = [];

      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (parsedInfo?.tokenAmount && Number(parsedInfo.tokenAmount.amount) > 0) {
          tokens.push({
            mint: parsedInfo.mint,
            balance: Number(parsedInfo.tokenAmount.amount),
            decimals: parsedInfo.tokenAmount.decimals,
          });
        }
      }

      console.log(`[Jupiter] Found ${tokens.length} tokens with balances`);
      return tokens;
    } catch (error) {
      console.warn(`[Jupiter] RPC failed for token scan:`, error);
      continue;
    }
  }

  console.error('[Jupiter] All RPC endpoints failed for token scan');
  return [];
}

/**
 * Get token balance for a wallet
 * Uses Helius RPC for reliability
 */
export async function getTokenBalance(
  tokenMint: string,
  walletAddress: string
): Promise<{ balance: number; decimals: number } | null> {
  // Prioritize Helius RPC with our API key
  const rpcEndpoints = [
    HELIUS_RPC,
    'https://api.mainnet-beta.solana.com',
  ];

  for (const rpc of rpcEndpoints) {
    try {
      console.log(`[Jupiter] Getting token balance via ${rpc.includes('helius') ? 'Helius' : 'public'} RPC`);
      const connection = new Connection(rpc, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 15000,
      });
      const walletPubkey = new PublicKey(walletAddress);
      const mintPubkey = new PublicKey(tokenMint);

      // Get all token accounts for this wallet and filter by mint
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: mintPubkey }
      );

      if (tokenAccounts.value.length === 0) {
        return { balance: 0, decimals: 9 };
      }

      let totalBalance = 0;
      let decimals = 9;

      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (parsedInfo?.tokenAmount) {
          totalBalance += Number(parsedInfo.tokenAmount.amount);
          decimals = parsedInfo.tokenAmount.decimals;
        }
      }

      console.log(`[Jupiter] Token balance: ${totalBalance} (${decimals} decimals)`);
      return { balance: totalBalance, decimals };
    } catch (error) {
      console.warn(`[Jupiter] RPC ${rpc.includes('helius') ? 'Helius' : 'public'} failed:`, error);
      continue; // Try next RPC
    }
  }

  console.error('[Jupiter] All RPC endpoints failed for token balance');
  return null;
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: number, decimals: number): string {
  const value = amount / Math.pow(10, decimals);
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(decimals > 4 ? 4 : decimals);
}

/**
 * Get price from Helius DAS API (most reliable)
 */
async function getHeliusPrice(tokenMint: string): Promise<{
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
} | null> {
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAsset',
        params: { id: tokenMint }
      })
    });

    if (!response.ok) {
      console.warn('[Helius] API error:', response.status);
      return null;
    }

    const data = await response.json();
    const tokenInfo = data.result?.token_info;
    const priceInfo = tokenInfo?.price_info;

    if (!priceInfo?.price_per_token) {
      console.warn('[Helius] No price data available');
      return null;
    }

    const priceUsd = priceInfo.price_per_token;
    const supply = tokenInfo.supply || 0;
    const decimals = tokenInfo.decimals || 6;
    const actualSupply = supply / Math.pow(10, decimals);
    const marketCap = priceUsd * actualSupply;

    console.log('[Helius] Price:', priceUsd, 'Supply:', actualSupply, 'MC:', marketCap);

    return {
      priceUsd,
      priceChange24h: 0, // Helius doesn't provide this
      volume24h: 0, // Would need separate API call
      liquidity: 0, // Would need separate API call
      marketCap,
    };
  } catch (error) {
    console.warn('[Helius] Failed to fetch price:', error);
    return null;
  }
}

/**
 * Get live token price - uses DexScreener primarily to avoid Helius rate limits
 * Helius is only used as fallback
 */
export async function getTokenPrice(tokenMint: string): Promise<{
  priceUsd: number;
  priceChange5m: number;   // 5-minute change (best for rug detection)
  priceChange1h: number;   // 1-hour change
  priceChange24h: number;  // 24-hour change
  volume24h: number;
  liquidity: number;
  marketCap?: number;
  tokenAgeMinutes: number;  // How old the token is
  txnsBuys5m: number;       // Buy transactions in last 5 min
  txnsSells5m: number;      // Sell transactions in last 5 min
} | null> {
  // Prefer DexScreener to avoid Helius rate limits
  const dexData = await getDexScreenerData(tokenMint);

  if (dexData) {
    return dexData;
  }

  // Fallback to Helius only if DexScreener fails
  const heliusData = await getHeliusPrice(tokenMint);
  if (heliusData) {
    return {
      priceUsd: heliusData.priceUsd,
      priceChange5m: 0,  // Helius doesn't provide this
      priceChange1h: 0,
      priceChange24h: 0,
      volume24h: 0,
      liquidity: 0,
      marketCap: heliusData.marketCap,
      tokenAgeMinutes: 999, // Unknown, assume old
      txnsBuys5m: 0,
      txnsSells5m: 0,
    };
  }

  return null;
}

/**
 * Get data from DexScreener
 */
async function getDexScreenerData(tokenMint: string): Promise<{
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap?: number;
  tokenAgeMinutes: number;  // How old the token is
  txnsBuys5m: number;       // Buy transactions in last 5 min
  txnsSells5m: number;      // Sell transactions in last 5 min
} | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);

    if (!response.ok) {
      console.warn('[DexScreener] API error:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data.pairs || data.pairs.length === 0) {
      console.warn('[DexScreener] No pairs found');
      return null;
    }

    // Get the pair with highest liquidity (or highest volume for pump.fun)
    const bestPair = data.pairs.reduce((best: any, pair: any) => {
      const liquidity = pair.liquidity?.usd || 0;
      const volume = pair.volume?.h24 || 0;
      const bestLiquidity = best?.liquidity?.usd || 0;
      const bestVolume = best?.volume?.h24 || 0;
      if (liquidity > bestLiquidity) return pair;
      if (liquidity === bestLiquidity && volume > bestVolume) return pair;
      return best;
    }, data.pairs[0]);

    // Calculate token age in minutes
    const pairCreatedAt = bestPair.pairCreatedAt || 0;
    const tokenAgeMinutes = pairCreatedAt > 0
      ? Math.floor((Date.now() - pairCreatedAt) / 60000)
      : 999; // Unknown age, assume old

    return {
      priceUsd: parseFloat(bestPair.priceUsd) || 0,
      priceChange5m: bestPair.priceChange?.m5 || 0,
      priceChange1h: bestPair.priceChange?.h1 || 0,
      priceChange24h: bestPair.priceChange?.h24 || 0,
      volume24h: bestPair.volume?.h24 || 0,
      liquidity: bestPair.liquidity?.usd || 0,
      marketCap: bestPair.marketCap || bestPair.fdv || 0,
      tokenAgeMinutes,
      txnsBuys5m: bestPair.txns?.m5?.buys || 0,
      txnsSells5m: bestPair.txns?.m5?.sells || 0,
    };
  } catch (error) {
    console.warn('[DexScreener] Failed to fetch:', error);
    return null;
  }
}

/**
 * Get user's actual purchase price for a token from transaction history
 * Uses Helius to find the earliest buy transaction
 */
export async function getUserPurchasePrice(
  tokenMint: string,
  walletAddress: string
): Promise<{ avgPrice: number; totalCost: number; totalTokens: number; totalSolSpent: number } | null> {
  try {
    console.log('[Purchase] Fetching transaction history for', walletAddress);

    // Get transaction signatures for this wallet
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [walletAddress, { limit: 100 }]
      })
    });

    if (!response.ok) {
      console.warn('[Purchase] Failed to get signatures');
      return null;
    }

    const sigData = await response.json();
    const signatures = sigData.result || [];

    if (signatures.length === 0) {
      console.warn('[Purchase] No transactions found');
      return null;
    }

    // Parse transactions using Helius enhanced API
    const parseResponse = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: signatures.slice(0, 50).map((s: any) => s.signature)
      })
    });

    if (!parseResponse.ok) {
      console.warn('[Purchase] Failed to parse transactions');
      return null;
    }

    const parsedTxs = await parseResponse.json();

    // Find buy transactions for this token
    let totalSolSpent = 0;
    let totalTokensReceived = 0;

    for (const tx of parsedTxs) {
      if (tx.type !== 'SWAP' || tx.transactionError) continue;

      // Look for swaps where user received this token
      const tokenTransfers = tx.tokenTransfers || [];
      const nativeTransfers = tx.nativeTransfers || [];

      for (const transfer of tokenTransfers) {
        if (transfer.mint === tokenMint && transfer.toUserAccount === walletAddress) {
          // User received this token
          const tokensReceived = transfer.tokenAmount || 0;

          // Find corresponding SOL payment
          for (const native of nativeTransfers) {
            if (native.fromUserAccount === walletAddress && native.amount > 0) {
              const solSpent = native.amount / LAMPORTS_PER_SOL;
              totalSolSpent += solSpent;
              totalTokensReceived += tokensReceived;
              console.log(`[Purchase] Found buy: ${solSpent} SOL → ${tokensReceived} tokens`);
            }
          }
        }
      }
    }

    if (totalTokensReceived > 0 && totalSolSpent > 0) {
      // Get current SOL price to convert to USD
      const solPrice = await getSolPrice();
      const avgPriceUsd = (totalSolSpent * solPrice) / totalTokensReceived;

      console.log(`[Purchase] Avg entry: $${avgPriceUsd.toFixed(10)} (${totalSolSpent} SOL for ${totalTokensReceived} tokens)`);

      return {
        avgPrice: avgPriceUsd,
        totalCost: totalSolSpent * solPrice,
        totalTokens: totalTokensReceived,
        totalSolSpent: totalSolSpent, // Return actual SOL spent for accurate P&L
      };
    }

    console.warn('[Purchase] No buy transactions found for this token');
    return null;
  } catch (error) {
    console.error('[Purchase] Error fetching purchase price:', error);
    return null;
  }
}

/**
 * Get current SOL price in USD
 */
async function getSolPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    return data.solana?.usd || 200; // Fallback to $200 if API fails
  } catch {
    return 200;
  }
}

/**
 * Pump.fun bonding curve constants
 * These are the fixed parameters for the pump.fun AMM
 */
const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/**
 * Derive the pump.fun bonding curve PDA from token mint
 */
function deriveBondingCurvePDA(tokenMint: string): string {
  // The bonding curve PDA is derived from:
  // seeds: ["bonding-curve", mint_pubkey]
  // program: pump.fun program
  const mintPubkey = new PublicKey(tokenMint);
  const programId = new PublicKey(PUMP_FUN_PROGRAM_ID);

  const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
    programId
  );

  return bondingCurvePDA.toString();
}

/**
 * Get pump.fun token data from on-chain bonding curve
 * Reads the bonding curve account directly - bypasses Cloudflare-blocked API!
 */
async function getPumpFunTokenData(tokenMint: string): Promise<{
  solPerToken: number;  // SOL per token - use this directly for P&L, no USD conversion!
  virtualSolReserves: number;
  virtualTokenReserves: number;
  complete: boolean;
} | null> {
  try {
    const bondingCurvePDA = deriveBondingCurvePDA(tokenMint);
    console.log(`[PumpFun] Reading bonding curve PDA: ${bondingCurvePDA}`);

    // Read the bonding curve account data
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [bondingCurvePDA, { encoding: 'base64' }]
      })
    });

    if (!response.ok) {
      console.warn('[PumpFun] RPC error:', response.status);
      return null;
    }

    const result = await response.json();

    if (!result.result?.value) {
      console.warn('[PumpFun] Bonding curve not found - token may have graduated to Raydium');
      return null;
    }

    // Decode the bonding curve account data
    // Bonding curve layout (simplified):
    // - 8 bytes: discriminator
    // - 8 bytes: virtual_token_reserves (u64)
    // - 8 bytes: virtual_sol_reserves (u64)
    // - 8 bytes: real_token_reserves (u64)
    // - 8 bytes: real_sol_reserves (u64)
    // - 8 bytes: token_total_supply (u64)
    // - 1 byte: complete (bool)

    const data = Buffer.from(result.result.value.data[0], 'base64');

    // Read virtual reserves (after 8-byte discriminator)
    const virtualTokenReserves = Number(data.readBigUInt64LE(8));
    const virtualSolReserves = Number(data.readBigUInt64LE(16));
    const complete = data[49] === 1; // complete flag

    console.log(`[PumpFun] Raw reserves - SOL: ${virtualSolReserves}, Tokens: ${virtualTokenReserves}, Complete: ${complete}`);

    if (complete) {
      console.log('[PumpFun] Token has graduated - bonding curve complete');
      return null; // Use Jupiter for graduated tokens
    }

    if (virtualTokenReserves === 0) {
      console.warn('[PumpFun] Zero token reserves');
      return null;
    }

    // Calculate price: SOL per token (this is the KEY value for P&L!)
    // virtualSolReserves is in lamports, virtualTokenReserves is in token units (6 decimals)
    const solPerToken = (virtualSolReserves / LAMPORTS_PER_SOL) / (virtualTokenReserves / 1e6);

    console.log(`[PumpFun] Price: ${solPerToken.toFixed(12)} SOL/token`);

    return {
      solPerToken, // Return SOL price directly - no USD conversion needed for P&L!
      virtualSolReserves: virtualSolReserves / LAMPORTS_PER_SOL,
      virtualTokenReserves: virtualTokenReserves / 1e6,
      complete,
    };
  } catch (error) {
    console.warn('[PumpFun] Error reading bonding curve:', error);
    return null;
  }
}

/**
 * Get the current SOL value of a token position
 * IMPORTANT: Checks bonding curve FIRST for pump.fun tokens, then Jupiter for graduated tokens
 */
export async function getTokenValueInSol(
  tokenMint: string,
  tokenAmount: number, // In smallest token units
  tokenDecimals: number = 6 // Token decimals for price calculation
): Promise<number | null> {
  try {
    // Method 1: Check pump.fun bonding curve FIRST (most accurate for non-graduated tokens)
    // This is critical because Jupiter returns WRONG quotes for bonding curve tokens!
    console.log(`[Value] Checking pump.fun bonding curve for ${tokenMint.slice(0, 8)}...`);
    const pumpData = await getPumpFunTokenData(tokenMint);

    if (pumpData && !pumpData.complete && pumpData.solPerToken > 0) {
      // Token is still on bonding curve - use on-chain SOL price directly (most accurate!)
      // NO USD CONVERSION - this avoids getSolPrice() rate limiting issues!
      const humanTokenAmount = tokenAmount / Math.pow(10, tokenDecimals);
      const solValue = humanTokenAmount * pumpData.solPerToken;
      console.log(`[Value] ✅ BONDING CURVE: ${humanTokenAmount.toFixed(2)} tokens × ${pumpData.solPerToken.toFixed(12)} SOL/token = ${solValue.toFixed(6)} SOL`);
      return solValue;
    }

    // Token has graduated (bonding curve complete or not found) - use Jupiter
    if (pumpData?.complete) {
      console.log(`[Value] Token graduated, using Jupiter...`);
    } else {
      console.log(`[Value] No bonding curve found, trying Jupiter...`);
    }

    // Method 2: Try Jupiter quote (for graduated tokens with DEX liquidity)
    const quote = await getSwapQuote(tokenMint, SOL_MINT, tokenAmount, 100); // 1% slippage
    if (quote) {
      const solValue = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
      if (solValue > 0.0001) { // More than dust
        console.log(`[Value] ✅ JUPITER: ${tokenAmount} tokens → ${solValue.toFixed(6)} SOL`);
        return solValue;
      }
      console.warn(`[Value] Jupiter quote too low (${solValue}), trying DexScreener...`);
    }

    // Method 3: Fallback to DexScreener
    console.log(`[Value] Trying DexScreener fallback...`);
    const dexData = await getDexScreenerData(tokenMint);
    if (dexData && dexData.priceUsd > 0) {
      const humanTokenAmount = tokenAmount / Math.pow(10, tokenDecimals);
      const valueUsd = humanTokenAmount * dexData.priceUsd;
      const solPrice = await getSolPrice();
      if (solPrice > 0) {
        const solValue = valueUsd / solPrice;
        console.log(`[Value] ✅ DEXSCREENER: ${humanTokenAmount.toFixed(2)} tokens × $${dexData.priceUsd.toFixed(8)} = $${valueUsd.toFixed(4)} = ${solValue.toFixed(6)} SOL`);
        return solValue;
      }
    }

    console.warn('[Value] ❌ No quote available from bonding curve, Jupiter, or DexScreener');
    return null;
  } catch (error) {
    console.error('[Value] Failed to get token value:', error);
    return null;
  }
}

/**
 * WebSocket price feed using Helius
 * Subscribes to pool account changes for real-time price updates
 */
export class PriceWebSocket {
  private ws: WebSocket | null = null;
  private tokenMint: string;
  private poolAddress: string | null = null;
  private onPriceUpdate: (price: number) => void;
  private reconnectAttempts = 0;
  private maxReconnects = 5;
  private lastPrice: number = 0;

  constructor(tokenMint: string, onPriceUpdate: (price: number) => void) {
    this.tokenMint = tokenMint;
    this.onPriceUpdate = onPriceUpdate;
  }

  async connect() {
    try {
      // First, get the pool address from DexScreener
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${this.tokenMint}`);
      const data = await response.json();

      let dexType = 'unknown';
      if (data.pairs && data.pairs.length > 0) {
        // Get highest liquidity pool - prefer Raydium for WebSocket, but note if it's pumpswap
        const raydiumPair = data.pairs.find((p: any) =>
          p.dexId === 'raydium' && p.liquidity?.usd > 1000
        );
        const bestPair = raydiumPair || data.pairs[0];

        this.poolAddress = bestPair.pairAddress;
        this.lastPrice = parseFloat(bestPair.priceUsd) || 0;
        dexType = bestPair.dexId;

        console.log('[WS] Found pool:', this.poolAddress, 'DEX:', dexType, 'Initial price:', this.lastPrice);
      }

      if (!this.poolAddress) {
        console.warn('[WS] No pool found, falling back to polling');
        return false;
      }

      // For pumpswap/pump.fun tokens, WebSocket on pool doesn't work well
      // Return false to use polling instead
      if (dexType === 'pumpswap' || dexType === 'pump.fun') {
        console.log('[WS] Pumpswap token detected, using fast polling instead');
        return false;
      }

      // Connect to Helius WebSocket for Raydium pools
      const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected to Helius');
        this.reconnectAttempts = 0;

        // Subscribe to pool account changes
        const subscribeMsg = {
          jsonrpc: '2.0',
          id: 1,
          method: 'accountSubscribe',
          params: [
            this.poolAddress,
            { encoding: 'jsonParsed', commitment: 'confirmed' }
          ]
        };

        this.ws?.send(JSON.stringify(subscribeMsg));
        console.log('[WS] Subscribed to pool:', this.poolAddress);
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle subscription confirmation
          if (data.result !== undefined) {
            console.log('[WS] Subscription confirmed, id:', data.result);
            return;
          }

          // Handle account update notification
          if (data.method === 'accountNotification') {
            console.log('[WS] Pool update received');
            // Fetch fresh price on any pool change
            const priceData = await getTokenPrice(this.tokenMint);
            if (priceData && priceData.priceUsd !== this.lastPrice) {
              this.lastPrice = priceData.priceUsd;
              this.onPriceUpdate(priceData.priceUsd);
            }
          }
        } catch (err) {
          console.error('[WS] Message parse error:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.tryReconnect();
      };

      return true;
    } catch (error) {
      console.error('[WS] Connection failed:', error);
      return false;
    }
  }

  private tryReconnect() {
    if (this.reconnectAttempts < this.maxReconnects) {
      this.reconnectAttempts++;
      console.log(`[WS] Reconnecting... attempt ${this.reconnectAttempts}`);
      setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getLastPrice() {
    return this.lastPrice;
  }
}
