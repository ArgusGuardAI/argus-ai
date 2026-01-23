/**
 * Trade Executor
 * Executes buy/sell orders via Jupiter
 */

import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import type { SniperConfig, TradeResult } from '../types';

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  outputMintDecimals?: number;
  error?: string;
}

interface JupiterSwapResponse {
  swapTransaction: string;
}

export class TradeExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private config: SniperConfig;

  constructor(connection: Connection, config: SniperConfig) {
    this.connection = connection;
    this.config = config;

    // Load wallet from private key
    const secretKey = Buffer.from(config.walletPrivateKey, 'base64');
    this.wallet = Keypair.fromSecretKey(secretKey);

    console.log(`[Executor] Wallet loaded: ${this.wallet.publicKey.toBase58()}`);
  }

  async buy(tokenAddress: string): Promise<TradeResult> {
    console.log(`[Executor] Buying ${tokenAddress}...`);

    try {
      const inputAmount = Math.floor(this.config.buyAmountSol * LAMPORTS_PER_SOL);

      // Get quote from Jupiter
      const quoteResponse = await fetch(
        `${JUPITER_QUOTE_API}/quote?` +
        `inputMint=${SOL_MINT}&` +
        `outputMint=${tokenAddress}&` +
        `amount=${inputAmount}&` +
        `slippageBps=${this.config.maxSlippageBps}`
      );

      if (!quoteResponse.ok) {
        throw new Error(`Quote failed: ${quoteResponse.status}`);
      }

      const quote = await quoteResponse.json() as JupiterQuote;

      if (!quote || quote.error) {
        throw new Error(quote?.error || 'No quote available');
      }

      // Get swap transaction
      const swapResponse = await fetch(`${JUPITER_QUOTE_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: this.config.priorityFeeLamports,
        }),
      });

      if (!swapResponse.ok) {
        throw new Error(`Swap request failed: ${swapResponse.status}`);
      }

      const { swapTransaction } = await swapResponse.json() as JupiterSwapResponse;

      // Deserialize and sign
      const swapTxBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTxBuf);
      transaction.sign([this.wallet]);

      // Send transaction
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      console.log(`[Executor] Buy TX sent: ${signature}`);

      // Confirm
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const outAmount = parseInt(quote.outAmount) / Math.pow(10, quote.outputMintDecimals || 9);

      return {
        success: true,
        type: 'BUY',
        tokenAddress,
        amountSol: this.config.buyAmountSol,
        amountTokens: outAmount,
        price: this.config.buyAmountSol / outAmount,
        txSignature: signature,
      };
    } catch (error) {
      console.error(`[Executor] Buy failed:`, error);
      return {
        success: false,
        type: 'BUY',
        tokenAddress,
        amountSol: this.config.buyAmountSol,
        amountTokens: 0,
        price: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async sell(tokenAddress: string, amountTokens: number, decimals = 9): Promise<TradeResult> {
    console.log(`[Executor] Selling ${amountTokens} of ${tokenAddress}...`);

    try {
      const inputAmount = Math.floor(amountTokens * Math.pow(10, decimals));

      // Get quote from Jupiter
      const quoteResponse = await fetch(
        `${JUPITER_QUOTE_API}/quote?` +
        `inputMint=${tokenAddress}&` +
        `outputMint=${SOL_MINT}&` +
        `amount=${inputAmount}&` +
        `slippageBps=${this.config.maxSlippageBps}`
      );

      if (!quoteResponse.ok) {
        throw new Error(`Quote failed: ${quoteResponse.status}`);
      }

      const quote = await quoteResponse.json() as JupiterQuote;

      if (!quote || quote.error) {
        throw new Error(quote?.error || 'No quote available');
      }

      // Get swap transaction
      const swapResponse = await fetch(`${JUPITER_QUOTE_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: this.config.priorityFeeLamports,
        }),
      });

      if (!swapResponse.ok) {
        throw new Error(`Swap request failed: ${swapResponse.status}`);
      }

      const { swapTransaction } = await swapResponse.json() as JupiterSwapResponse;

      // Deserialize and sign
      const swapTxBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTxBuf);
      transaction.sign([this.wallet]);

      // Send transaction
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      console.log(`[Executor] Sell TX sent: ${signature}`);

      // Confirm
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const outAmount = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;

      return {
        success: true,
        type: 'SELL',
        tokenAddress,
        amountSol: outAmount,
        amountTokens,
        price: outAmount / amountTokens,
        txSignature: signature,
      };
    } catch (error) {
      console.error(`[Executor] Sell failed:`, error);
      return {
        success: false,
        type: 'SELL',
        tokenAddress,
        amountSol: 0,
        amountTokens,
        price: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getWalletAddress(): string {
    return this.wallet.publicKey.toBase58();
  }

  updateConfig(config: Partial<SniperConfig>) {
    this.config = { ...this.config, ...config };
  }
}
