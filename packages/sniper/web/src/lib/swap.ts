/**
 * Client-side swap utility
 * Supports both Jupiter (for Raydium tokens) and Pump.fun bonding curve
 * Signs transactions with connected wallet (Phantom/Solflare)
 */

import { Connection, VersionedTransaction, PublicKey, Transaction } from '@solana/web3.js';

// Use server-side proxies to avoid CORS issues
const JUPITER_QUOTE_API = '/api/jupiter/quote';
const JUPITER_SWAP_API = '/api/jupiter/swap';
const PUMPFUN_API = '/pumpfun/api';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// RPC endpoint - Use Helius for reliability
const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=54846763-d323-4cb5-8d67-23ed50c19d10';

export interface SwapParams {
  inputMint: string;
  outputMint: string;
  amount: number; // in lamports for SOL, or smallest unit for tokens
  slippageBps: number;
  userPublicKey: string;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: any[];
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount?: number;
  outputAmount?: number;
}

/**
 * Get a swap quote from Jupiter
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number
): Promise<SwapQuote | null> {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'false',
      asLegacyTransaction: 'false',
    });

    const url = `${JUPITER_QUOTE_API}?${params}`;
    console.log('[Swap] Fetching quote from:', url);
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Swap] Quote failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('[Swap] Got quote:', data.outAmount ? `${data.inAmount} -> ${data.outAmount}` : 'no route');
    return data;
  } catch (error) {
    console.error('[Swap] Quote error:', error);
    return null;
  }
}

/**
 * Build a swap transaction from Jupiter
 */
export async function buildSwapTransaction(
  quote: SwapQuote,
  userPublicKey: string,
  priorityFeeLamports: number = 100000
): Promise<VersionedTransaction | null> {
  try {
    // Use same format as sol-bot
    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityFeeLamports,
      }),
    });

    if (!response.ok) {
      console.error('[Swap] Build TX failed:', await response.text());
      return null;
    }

    const { swapTransaction } = await response.json();

    // Deserialize the transaction
    const txBuffer = Buffer.from(swapTransaction, 'base64');
    return VersionedTransaction.deserialize(txBuffer);
  } catch (error) {
    console.error('[Swap] Build TX error:', error);
    return null;
  }
}

/**
 * Buy using Pump.fun's bonding curve API
 */
async function executePumpFunBuy(
  tokenMint: string,
  amountSol: number,
  slippageBps: number,
  wallet: {
    publicKey: PublicKey;
    signTransaction: <T extends VersionedTransaction | Transaction>(tx: T) => Promise<T>;
  }
): Promise<SwapResult> {
  try {
    // Use minimum 50% slippage for pump.fun (very volatile)
    const effectiveSlippage = Math.max(slippageBps / 100, 50);
    console.log(`[PumpFun] Buying ${tokenMint} with ${amountSol} SOL (slippage: ${effectiveSlippage}%)`);

    // Get transaction from pump.fun API
    const response = await fetch(`${PUMPFUN_API}/trade-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toString(),
        action: 'buy',
        mint: tokenMint,
        amount: amountSol * 1e9, // Amount in lamports
        denominatedInSol: 'true',
        slippage: effectiveSlippage, // Minimum 50% for pump.fun volatility
        priorityFee: 0.002, // Higher priority fee (0.002 SOL)
        pool: 'pump',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PumpFun] API error:', response.status, errorText);

      // Check specific error types
      if (errorText.includes('not found') || errorText.includes('graduated') || errorText.includes('Could not find')) {
        return { success: false, error: 'Token graduated to Raydium - trying Jupiter instead' };
      }
      if (errorText.includes('insufficient')) {
        return { success: false, error: 'Insufficient liquidity in bonding curve' };
      }
      return { success: false, error: `Pump.fun API: ${errorText.slice(0, 100)}` };
    }

    // Get the transaction bytes
    const txData = await response.arrayBuffer();
    console.log(`[PumpFun] Got transaction data: ${txData.byteLength} bytes`);

    if (txData.byteLength < 100) {
      // Likely an error message, not a transaction
      const errorText = new TextDecoder().decode(txData);
      console.error('[PumpFun] Invalid response:', errorText);
      return { success: false, error: `Invalid API response: ${errorText}` };
    }

    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));

    // Sign with wallet
    console.log('[PumpFun] Requesting wallet signature...');
    const signedTx = await wallet.signTransaction(tx);

    // Send transaction
    const connection = new Connection(RPC_URL, 'confirmed');
    console.log('[PumpFun] Sending transaction...');

    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    console.log(`[PumpFun] Transaction sent: ${signature}`);

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');

    if (confirmation.value.err) {
      return { success: false, error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`, signature };
    }

    console.log(`[PumpFun] Transaction confirmed: ${signature}`);

    return {
      success: true,
      signature,
      inputAmount: amountSol,
      outputAmount: 0, // We don't know exact output from pump.fun API
    };
  } catch (error: any) {
    console.error('[PumpFun] Buy error:', error);

    if (error.message?.includes('User rejected')) {
      return { success: false, error: 'Transaction rejected by user' };
    }

    return { success: false, error: error.message || 'Pump.fun buy failed' };
  }
}

/**
 * Execute a buy (SOL -> Token)
 * Tries Jupiter first (works for graduated tokens), falls back to Pump.fun bonding curve
 */
export async function executeBuy(
  tokenMint: string,
  amountSol: number,
  slippageBps: number,
  priorityFeeLamports: number,
  wallet: {
    publicKey: PublicKey;
    signTransaction: <T extends VersionedTransaction | Transaction>(tx: T) => Promise<T>;
  }
): Promise<SwapResult> {
  try {
    console.log(`[Swap] Buying ${tokenMint} with ${amountSol} SOL`);

    const amountLamports = Math.floor(amountSol * 1e9);

    // Try Jupiter first (works for graduated tokens on Raydium)
    console.log('[Swap] Trying Jupiter first...');
    const quote = await getSwapQuote(SOL_MINT, tokenMint, amountLamports, slippageBps);

    if (quote) {
      console.log(`[Swap] Jupiter quote: ${quote.inAmount} -> ${quote.outAmount} (impact: ${quote.priceImpactPct}%)`);

      const transaction = await buildSwapTransaction(quote, wallet.publicKey.toString(), priorityFeeLamports);
      if (transaction) {
        console.log('[Swap] Requesting wallet signature...');
        const signedTx = await wallet.signTransaction(transaction);

        const connection = new Connection(RPC_URL, 'confirmed');
        console.log('[Swap] Sending transaction...');

        const signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true, // Skip simulation to avoid scary warnings
          maxRetries: 3,
        });

        console.log(`[Swap] Transaction sent: ${signature}`);

        const confirmation = await connection.confirmTransaction(signature, 'confirmed');

        if (confirmation.value.err) {
          return { success: false, error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`, signature };
        }

        console.log(`[Swap] Transaction confirmed: ${signature}`);

        return {
          success: true,
          signature,
          inputAmount: amountSol,
          outputAmount: parseFloat(quote.outAmount) / 1e6,
        };
      }
    }

    // Jupiter failed (no route) - try Pump.fun bonding curve for new tokens
    console.log('[Swap] Jupiter failed, trying Pump.fun bonding curve...');
    const pumpResult = await executePumpFunBuy(tokenMint, amountSol, slippageBps, wallet);

    if (pumpResult.success || pumpResult.error?.includes('rejected')) {
      return pumpResult;
    }

    // Both failed
    return {
      success: false,
      error: 'No route found - token may be rugged or have no liquidity'
    };
  } catch (error: any) {
    console.error('[Swap] Buy error:', error);

    if (error.message?.includes('User rejected')) {
      return { success: false, error: 'Transaction rejected by user' };
    }

    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Sell using Pump.fun's bonding curve API
 */
async function executePumpFunSell(
  tokenMint: string,
  amountTokens: number,
  slippageBps: number,
  wallet: {
    publicKey: PublicKey;
    signTransaction: <T extends VersionedTransaction | Transaction>(tx: T) => Promise<T>;
  }
): Promise<SwapResult> {
  try {
    // Use minimum 50% slippage for pump.fun (very volatile)
    const effectiveSlippage = Math.max(slippageBps / 100, 50);
    console.log(`[PumpFun] Selling ${amountTokens} of ${tokenMint} (slippage: ${effectiveSlippage}%)`);

    // Get transaction from pump.fun API
    const response = await fetch(`${PUMPFUN_API}/trade-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toString(),
        action: 'sell',
        mint: tokenMint,
        amount: amountTokens * 1e6, // Amount in token smallest unit (6 decimals)
        denominatedInSol: 'false',
        slippage: effectiveSlippage, // Minimum 50% for pump.fun volatility
        priorityFee: 0.002, // Higher priority fee
        pool: 'pump',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PumpFun] API error:', errorText);
      return { success: false, error: `Pump.fun API error: ${response.status}` };
    }

    const txData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));

    console.log('[PumpFun] Requesting wallet signature...');
    const signedTx = await wallet.signTransaction(tx);

    const connection = new Connection(RPC_URL, 'confirmed');
    console.log('[PumpFun] Sending transaction...');

    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    console.log(`[PumpFun] Transaction sent: ${signature}`);

    const confirmation = await connection.confirmTransaction(signature, 'confirmed');

    if (confirmation.value.err) {
      return { success: false, error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`, signature };
    }

    console.log(`[PumpFun] Transaction confirmed: ${signature}`);

    return {
      success: true,
      signature,
      inputAmount: amountTokens,
      outputAmount: 0,
    };
  } catch (error: any) {
    console.error('[PumpFun] Sell error:', error);

    if (error.message?.includes('User rejected')) {
      return { success: false, error: 'Transaction rejected by user' };
    }

    return { success: false, error: error.message || 'Pump.fun sell failed' };
  }
}

/**
 * Execute a sell (Token -> SOL)
 * Tries Jupiter first (works for graduated tokens), falls back to Pump.fun bonding curve
 */
export async function executeSell(
  tokenMint: string,
  amountTokens: number,
  tokenDecimals: number,
  slippageBps: number,
  priorityFeeLamports: number,
  wallet: {
    publicKey: PublicKey;
    signTransaction: <T extends VersionedTransaction | Transaction>(tx: T) => Promise<T>;
  }
): Promise<SwapResult> {
  try {
    console.log(`[Swap] Selling ${amountTokens} of ${tokenMint}`);

    const amount = Math.floor(amountTokens * Math.pow(10, tokenDecimals));

    // Try Jupiter first (works for graduated tokens on Raydium)
    console.log('[Swap] Trying Jupiter first...');
    const quote = await getSwapQuote(tokenMint, SOL_MINT, amount, slippageBps);

    if (quote) {
      console.log(`[Swap] Jupiter quote: ${quote.inAmount} -> ${quote.outAmount} (impact: ${quote.priceImpactPct}%)`);

      const transaction = await buildSwapTransaction(quote, wallet.publicKey.toString(), priorityFeeLamports);
      if (transaction) {
        console.log('[Swap] Requesting wallet signature...');
        const signedTx = await wallet.signTransaction(transaction);

        const connection = new Connection(RPC_URL, 'confirmed');
        console.log('[Swap] Sending transaction...');

        const signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        console.log(`[Swap] Transaction sent: ${signature}`);

        const confirmation = await connection.confirmTransaction(signature, 'confirmed');

        if (confirmation.value.err) {
          return { success: false, error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`, signature };
        }

        console.log(`[Swap] Transaction confirmed: ${signature}`);

        return {
          success: true,
          signature,
          inputAmount: amountTokens,
          outputAmount: parseFloat(quote.outAmount) / 1e9,
        };
      }
    }

    // Jupiter failed - try Pump.fun bonding curve
    console.log('[Swap] Jupiter failed, trying Pump.fun bonding curve...');
    const pumpResult = await executePumpFunSell(tokenMint, amountTokens, slippageBps, wallet);

    if (pumpResult.success || pumpResult.error?.includes('rejected')) {
      return pumpResult;
    }

    // Both failed
    return {
      success: false,
      error: 'No route found - token may be rugged or have no liquidity'
    };
  } catch (error: any) {
    console.error('[Swap] Sell error:', error);

    if (error.message?.includes('User rejected')) {
      return { success: false, error: 'Transaction rejected by user' };
    }

    return { success: false, error: error.message || 'Unknown error' };
  }
}
