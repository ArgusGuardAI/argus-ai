/**
 * Jupiter Swap Service
 * Handles token swaps via Jupiter Aggregator
 * Routes through backend proxy to avoid CORS issues
 */

import { Connection, VersionedTransaction, PublicKey, SystemProgram, LAMPORTS_PER_SOL, TransactionMessage } from '@solana/web3.js';

// Use our backend proxy for Jupiter (avoids CORS)
const API_BASE = import.meta.env.VITE_API_URL || 'https://argusguard-api.hermosillo-jessie.workers.dev';
const JUPITER_API = `${API_BASE}/jupiter`;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Helius RPC for reliable connections (key via VITE_HELIUS_API_KEY env var)
const HELIUS_API_KEY = import.meta.env.VITE_HELIUS_API_KEY || '';
const HELIUS_RPC = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : 'https://api.mainnet-beta.solana.com';

// Argus AI fee configuration
// 0.5% fee on all trades - sent to platform wallet
const ARGUS_FEE_WALLET = 'DvQzNPwaVAC2sKvyAkermrmvhnfGftxYdr3tTchB3NEv';
const ARGUS_FEE_PERCENT = 0.5; // 0.5% fee on AI-executed trades

// Fee transfer threshold — set to 0 once fee wallet is funded on-chain
// If the fee wallet account doesn't exist, transfers below ~0.00089 SOL fail
// and the catch block saves them for the next attempt
const RENT_EXEMPT_MINIMUM = 0; // Fee wallet is funded, transfer every trade
const PENDING_FEES_KEY = 'argus_pending_fees';

function getPendingFees(): number {
  try {
    return parseFloat(localStorage.getItem(PENDING_FEES_KEY) || '0') || 0;
  } catch { return 0; }
}

function setPendingFees(amount: number) {
  try {
    localStorage.setItem(PENDING_FEES_KEY, amount.toString());
  } catch { /* ignore */ }
}

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
 * Get dynamic priority fee estimate from Helius
 * Adds a 20% buffer to ensure transaction lands during congestion
 */
async function getPriorityFee(accounts: PublicKey[]): Promise<number> {
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getPriorityFeeEstimate',
        params: [
          {
            accountKeys: accounts.map(k => k.toString()),
            options: { priorityLevel: 'high' }
          }
        ]
      })
    });

    if (!response.ok) throw new Error('Failed to fetch fee estimate');

    const data = await response.json();
    const estimatedFee = data.result?.priorityFeeEstimate || 50000;

    // Add 20% buffer for safety, minimum 50k lamports
    const bufferedFee = Math.ceil(estimatedFee * 1.2);
    const finalFee = Math.max(50000, bufferedFee);

    console.log(`[Jupiter] Priority fee estimate: ${estimatedFee}, using: ${finalFee} lamports`);
    return finalFee;
  } catch (error) {
    console.warn('[Jupiter] Fee estimate failed, using fallback:', error);
    return 50000; // Fallback to hardcoded safe minimum
  }
}

/**
 * Parse Solana/Jupiter transaction errors into human-readable messages
 */
export function parseSwapError(error: unknown): string {
  const raw = typeof error === 'string' ? error : JSON.stringify(error);

  // Custom program error codes (common across Jupiter route programs)
  const customMatch = raw.match(/Custom["\s:]+(\d+)/i);
  if (customMatch) {
    const code = parseInt(customMatch[1]);
    const knownErrors: Record<number, string> = {
      1: 'Insufficient funds',
      6000: 'Slippage exceeded — price moved too fast',
      6001: 'Invalid swap amount',
      6003: 'Swap pool has insufficient liquidity',
      6005: 'Slippage exceeded — price moved too fast, try again',
      6006: 'Invalid swap route',
      6007: 'Expired transaction — try again',
      6022: 'Too little output received — increase slippage',
      6023: 'Too much input required — increase slippage',
    };
    return knownErrors[code] || `Swap program error (code ${code}) — try again or increase slippage`;
  }

  // InstructionError without Custom
  if (raw.includes('InstructionError')) {
    if (raw.includes('InsufficientFunds')) return 'Insufficient SOL balance';
    if (raw.includes('AccountNotFound')) return 'Token account not found';
    if (raw.includes('InvalidAccountData')) return 'Invalid account data — token may have been rugged';
    return 'Transaction instruction failed — try again';
  }

  // Simulation/preflight errors
  if (raw.includes('Simulation failed') || raw.includes('preflight')) {
    return 'Transaction simulation failed — pool may be unstable, try again';
  }

  // Blockhash/timeout errors
  if (raw.includes('block height exceeded') || raw.includes('Blockhash not found')) {
    return 'Transaction expired — network congestion, try again';
  }

  // Catch-all
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return `Transaction failed: ${raw.slice(0, 120)}`;
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
 *
 * OPTIMISTIC EXECUTION: Returns success immediately after send.
 * Confirmation happens in the background to avoid blocking the UI.
 * This provides instant feedback while the transaction confirms.
 */
export async function executeSwap(
  quote: SwapQuote,
  userPublicKey: PublicKey,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>
): Promise<SwapResult> {
  try {
    console.log('[Jupiter] Building swap transaction via proxy...');

    // Create connection for RPC calls
    const connection = new Connection(HELIUS_RPC, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });

    // Step 1: Get initial swap transaction to extract accounts for fee estimation
    const initialResponse = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userPublicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 50000, // Placeholder, will be replaced
      }),
    });

    if (!initialResponse.ok) {
      const error = await initialResponse.text();
      console.error('[Jupiter] Initial swap build error:', error);
      return { success: false, error: `Failed to build swap: ${error}` };
    }

    const initialData = await initialResponse.json();
    const initialTx = VersionedTransaction.deserialize(Buffer.from(initialData.swapTransaction, 'base64'));

    // Step 2: Get dynamic priority fee based on accounts in the transaction
    const accounts = initialTx.message.staticAccountKeys;
    const dynamicFee = await getPriorityFee(accounts);

    // Step 3: Re-fetch swap transaction with dynamic fee
    console.log('[Jupiter] Rebuilding transaction with dynamic fee:', dynamicFee);
    const swapResponse = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userPublicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: dynamicFee,
      }),
    });

    if (!swapResponse.ok) {
      const error = await swapResponse.text();
      console.error('[Jupiter] Swap build error:', error);
      return { success: false, error: `Failed to build swap: ${error}` };
    }

    const swapData = await swapResponse.json();
    console.log('[Jupiter] Swap transaction built with dynamic fee');

    // Step 4: Deserialize and sign the transaction
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    console.log('[Jupiter] Signing transaction...');
    const signedTransaction = await signTransaction(transaction);

    // Step 5: OPTIMISTIC EXECUTION - Send immediately
    console.log('[Jupiter] Sending transaction (optimistic)...');
    const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
      skipPreflight: false, // Still check basic validity
      maxRetries: 2, // Quick retries for network hiccups
      preflightCommitment: 'processed', // Fastest preflight check
    });

    console.log('[Jupiter] Transaction sent:', signature);

    // Step 6: FIRE AND FORGET - Confirm in background, don't block UI
    // We do NOT await this - user gets instant feedback
    const latestBlockHash = await connection.getLatestBlockhash('confirmed');
    connection.confirmTransaction({
      signature,
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    }, 'confirmed').then(confirmation => {
      if (confirmation.value.err) {
        const errMsg = parseSwapError(confirmation.value.err);
        console.error('[Jupiter] Background confirmation failed:', errMsg, confirmation.value.err);
        // Dispatch event so UI can update if needed
        window.dispatchEvent(new CustomEvent('trade-confirmation-failed', {
          detail: { signature, error: errMsg }
        }));
      } else {
        console.log('[Jupiter] Transaction confirmed in background:', signature);
        window.dispatchEvent(new CustomEvent('trade-confirmed', {
          detail: { signature }
        }));
      }
    }).catch(err => {
      console.error('[Jupiter] Confirmation promise rejection:', err);
      window.dispatchEvent(new CustomEvent('trade-confirmation-failed', {
        detail: { signature, error: 'Confirmation timeout - check explorer' }
      }));
    });

    // Return SUCCESS immediately - user sees instant feedback
    return { success: true, signature };
  } catch (error) {
    // Critical errors (network down, invalid signature, etc.)
    // These happen BEFORE we return success, so user gets real error
    const errMsg = parseSwapError(error);
    console.error('[Jupiter] Swap execution error (critical):', errMsg, error);
    return {
      success: false,
      error: errMsg
    };
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
    console.log(`[Buy] AI fee: ${feeAmount.toFixed(6)} SOL (${ARGUS_FEE_PERCENT}%), Trading: ${actualAmount.toFixed(6)} SOL`);
  }

  const lamports = Math.floor(actualAmount * 1e9); // Convert SOL to lamports

  const quote = await getSwapQuote(SOL_MINT, tokenMint, lamports, slippageBps);
  if (!quote) {
    return { success: false, error: 'Failed to get quote' };
  }

  // Execute the swap first
  const swapResult = await executeSwap(quote, userPublicKey, signTransaction);

  // If swap succeeded and fee is configured, accumulate and send fee
  if (swapResult.success && feeAmount > 0 && ARGUS_FEE_WALLET) {
    try {
      const totalPending = getPendingFees() + feeAmount;
      console.log(`[Buy] Fee accrued: ${feeAmount.toFixed(6)} SOL, total pending: ${totalPending.toFixed(6)} SOL`);

      // Only transfer when accumulated fees exceed rent-exempt minimum
      if (totalPending >= RENT_EXEMPT_MINIMUM) {
        const connection = new Connection(HELIUS_RPC, 'confirmed');
        const feeLamports = Math.floor(totalPending * LAMPORTS_PER_SOL);
        const feeWallet = new PublicKey(ARGUS_FEE_WALLET);

        const balance = await connection.getBalance(userPublicKey);
        const MIN_RESERVE = 0.01 * LAMPORTS_PER_SOL;
        if (balance < feeLamports + MIN_RESERVE) {
          console.log(`[Buy] Deferring fee — insufficient balance (${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
          setPendingFees(totalPending);
        } else {
          const feeIx = SystemProgram.transfer({
            fromPubkey: userPublicKey,
            toPubkey: feeWallet,
            lamports: feeLamports,
          });

          const { blockhash } = await connection.getLatestBlockhash('confirmed');
          const messageV0 = new TransactionMessage({
            payerKey: userPublicKey,
            recentBlockhash: blockhash,
            instructions: [feeIx],
          }).compileToV0Message();

          const feeTx = new VersionedTransaction(messageV0);
          const signedFeeTx = await signTransaction(feeTx);
          const feeSignature = await connection.sendRawTransaction(signedFeeTx.serialize());
          await connection.confirmTransaction(feeSignature, 'confirmed');

          setPendingFees(0);
          console.log(`[Buy] Fee collected: ${totalPending.toFixed(6)} SOL (tx: ${feeSignature})`);
        }
      } else {
        setPendingFees(totalPending);
        console.log(`[Buy] Fee saved — waiting to reach ${RENT_EXEMPT_MINIMUM} SOL threshold`);
      }
    } catch (feeError) {
      // Save the fee so we don't lose it
      setPendingFees(getPendingFees() + feeAmount);
      console.error('[Buy] Fee transfer failed, saved for later:', feeError);
    }
  }

  return swapResult;
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
  const quote = await getSwapQuote(tokenMint, SOL_MINT, tokenAmount, slippageBps);
  if (!quote) {
    return { success: false, error: 'Failed to get quote' };
  }

  // Calculate expected SOL proceeds for fee calculation
  const expectedSolOut = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
  let feeAmount = 0;

  if (withAiFee && ARGUS_FEE_WALLET) {
    feeAmount = expectedSolOut * (ARGUS_FEE_PERCENT / 100);
    console.log(`[Sell] Expected: ${expectedSolOut.toFixed(6)} SOL, AI fee: ${feeAmount.toFixed(6)} SOL (${ARGUS_FEE_PERCENT}%)`);
  }

  // Execute the swap first
  const swapResult = await executeSwap(quote, userPublicKey, signTransaction);

  // If swap succeeded and fee is configured, accumulate and send fee
  if (swapResult.success && feeAmount > 0 && ARGUS_FEE_WALLET) {
    try {
      const totalPending = getPendingFees() + feeAmount;
      console.log(`[Sell] Fee accrued: ${feeAmount.toFixed(6)} SOL, total pending: ${totalPending.toFixed(6)} SOL`);

      // Only transfer when accumulated fees exceed rent-exempt minimum
      if (totalPending >= RENT_EXEMPT_MINIMUM) {
        const connection = new Connection(HELIUS_RPC, 'confirmed');
        const feeLamports = Math.floor(totalPending * LAMPORTS_PER_SOL);
        const feeWallet = new PublicKey(ARGUS_FEE_WALLET);

        // Small delay to ensure swap SOL has landed
        await new Promise(resolve => setTimeout(resolve, 3000));

        const balance = await connection.getBalance(userPublicKey);
        const MIN_RESERVE = 0.01 * LAMPORTS_PER_SOL;
        if (balance < feeLamports + MIN_RESERVE) {
          console.log(`[Sell] Deferring fee — insufficient balance (${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
          setPendingFees(totalPending);
        } else {
          const feeIx = SystemProgram.transfer({
            fromPubkey: userPublicKey,
            toPubkey: feeWallet,
            lamports: feeLamports,
          });

          const { blockhash } = await connection.getLatestBlockhash('confirmed');
          const messageV0 = new TransactionMessage({
            payerKey: userPublicKey,
            recentBlockhash: blockhash,
            instructions: [feeIx],
          }).compileToV0Message();

          const feeTx = new VersionedTransaction(messageV0);
          const signedFeeTx = await signTransaction(feeTx);
          const feeSignature = await connection.sendRawTransaction(signedFeeTx.serialize());
          await connection.confirmTransaction(feeSignature, 'confirmed');

          setPendingFees(0);
          console.log(`[Sell] Fee collected: ${totalPending.toFixed(6)} SOL (tx: ${feeSignature})`);
        }
      } else {
        setPendingFees(totalPending);
        console.log(`[Sell] Fee saved — waiting to reach ${RENT_EXEMPT_MINIMUM} SOL threshold`);
      }
    } catch (feeError) {
      setPendingFees(getPendingFees() + feeAmount);
      console.error('[Sell] Fee transfer failed, saved for later:', feeError);
    }
  }

  return swapResult;
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
 * Uses Helius RPC with caching to reduce rate limits
 */
const balanceCache = new Map<string, { balance: number; decimals: number; timestamp: number }>();
const BALANCE_CACHE_MS = 10000; // Cache for 10 seconds

export async function getTokenBalance(
  tokenMint: string,
  walletAddress: string
): Promise<{ balance: number; decimals: number } | null> {
  const cacheKey = `${tokenMint}-${walletAddress}`;

  // Check cache first
  const cached = balanceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_MS) {
    return { balance: cached.balance, decimals: cached.decimals };
  }

  // Use only Helius - public RPC is too slow/unreliable
  try {
    const connection = new Connection(HELIUS_RPC, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 10000,
    });
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(tokenMint);

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { mint: mintPubkey }
    );

    let totalBalance = 0;
    let decimals = 6; // Default for most tokens

    if (tokenAccounts.value.length > 0) {
      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (parsedInfo?.tokenAmount) {
          totalBalance += Number(parsedInfo.tokenAmount.amount);
          decimals = parsedInfo.tokenAmount.decimals;
        }
      }
    }

    // Cache the result
    balanceCache.set(cacheKey, { balance: totalBalance, decimals, timestamp: Date.now() });
    return { balance: totalBalance, decimals };
  } catch (error) {
    console.warn(`[Balance] RPC error:`, error);
    // Return cached value if available (even if stale)
    if (cached) {
      console.log(`[Balance] Using stale cache for ${tokenMint.slice(0, 8)}`);
      return { balance: cached.balance, decimals: cached.decimals };
    }
    return null;
  }
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

    // Get the pair with highest liquidity
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
 * Get current SOL price in USD (cached for 60 seconds)
 */
let cachedSolPrice = 200;
let solPriceCacheTime = 0;
const SOL_PRICE_CACHE_MS = 60000; // 60 seconds

async function getSolPrice(): Promise<number> {
  // Return cached price if fresh
  if (Date.now() - solPriceCacheTime < SOL_PRICE_CACHE_MS) {
    return cachedSolPrice;
  }

  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    if (response.ok) {
      const data = await response.json();
      if (data.solana?.usd > 0) {
        cachedSolPrice = data.solana.usd;
        solPriceCacheTime = Date.now();
      }
    }
  } catch {
    // Use cached price on error
  }

  return cachedSolPrice;
}


/**
 * Get the current SOL value of a token position
 * Uses Jupiter PRICE API (spot price, no execution impact)
 * Falls back to DexScreener
 * NEVER uses Jupiter QUOTE API (has price impact)
 */
export async function getTokenValueInSol(
  tokenMint: string,
  tokenAmount: number, // In smallest token units
  tokenDecimals: number = 6 // Token decimals for price calculation
): Promise<number | null> {
  try {
    const humanTokenAmount = tokenAmount / Math.pow(10, tokenDecimals);
    const solPrice = await getSolPrice();
    if (solPrice <= 0) return null;

    // METHOD 1: Jupiter Price API v2 (spot price, NOT quote/execution price)
    try {
      const jupResponse = await fetch(`https://api.jup.ag/price/v2?ids=${tokenMint}`);

      if (jupResponse.ok) {
        const jupData = await jupResponse.json();
        const tokenPrice = jupData.data?.[tokenMint]?.price;

        if (tokenPrice && tokenPrice > 0) {
          const valueUsd = humanTokenAmount * tokenPrice;
          const solValue = valueUsd / solPrice;
          return solValue;
        }
      }
    } catch {
      // Jupiter failed, try DexScreener
    }

    // METHOD 2: DexScreener fallback
    try {
      const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);

      if (dexResponse.ok) {
        const dexData = await dexResponse.json();
        if (dexData.pairs && dexData.pairs.length > 0) {
          const bestPair = dexData.pairs.reduce((best: any, pair: any) => {
            const liq = pair.liquidity?.usd || 0;
            return liq > (best?.liquidity?.usd || 0) ? pair : best;
          }, dexData.pairs[0]);

          const priceUsd = parseFloat(bestPair.priceUsd);
          if (priceUsd > 0) {
            const valueUsd = humanTokenAmount * priceUsd;
            const solValue = valueUsd / solPrice;
            return solValue;
          }
        }
      }
    } catch {
      // DexScreener also failed
    }

    console.warn(`[Value] No price for ${tokenMint.slice(0, 8)}`);
    return null;
  } catch (error) {
    console.error('[Value] Error:', error);
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

      if (data.pairs && data.pairs.length > 0) {
        // Get highest liquidity pool - prefer Raydium for WebSocket
        const raydiumPair = data.pairs.find((p: any) =>
          p.dexId === 'raydium' && p.liquidity?.usd > 1000
        );
        const bestPair = raydiumPair || data.pairs[0];

        this.poolAddress = bestPair.pairAddress;
        this.lastPrice = parseFloat(bestPair.priceUsd) || 0;

        console.log('[WS] Found pool:', this.poolAddress, 'DEX:', bestPair.dexId, 'Initial price:', this.lastPrice);
      }

      if (!this.poolAddress) {
        console.warn('[WS] No pool found, falling back to polling');
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
