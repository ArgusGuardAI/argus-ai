/**
 * Meteora Pool Creation Listener
 * Uses WebSocket to detect new DLMM pools in real-time
 * Supports both Helius (primary) and public RPC (fallback)
 *
 * Meteora DLMM is popular for new token launches
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { NewTokenEvent } from '../types';
import { heliusBudget } from '../utils/helius-budget';

// Meteora Program IDs
const METEORA_DLMM_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const METEORA_AMM_PROGRAM = 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB';

// Common quote tokens (SOL, USDC, USDT)
const QUOTE_TOKENS = new Set([
  'So11111111111111111111111111111111111111112',  // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

// RPC endpoints - will try in order
const PUBLIC_WS_RPC = 'wss://api.mainnet-beta.solana.com';
const PUBLIC_HTTP_RPC = 'https://api.mainnet-beta.solana.com';

// Rate limiting for public RPC - very conservative to avoid 429s
// Public RPC allows ~2 requests/second sustained
const REQUEST_INTERVAL_MS = 600; // ~1.6 requests/second
let lastRequestTime = 0;
const requestQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < REQUEST_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    const request = requestQueue.shift();
    if (request) {
      lastRequestTime = Date.now();
      try {
        await request();
      } catch (e) {
        // Ignore errors, they're handled in the request itself
      }
    }
  }

  isProcessingQueue = false;
}

export class MeteoraListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private heliusApiKey: string;
  private isRunning: boolean = false;
  private seenPools: Set<string> = new Set();
  private seenSignatures: Set<string> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private subscriptionIds: number[] = [];
  private usePublicRpc: boolean = false;
  private heliusFailCount: number = 0;

  constructor(heliusApiKey: string) {
    super();
    this.heliusApiKey = heliusApiKey;
  }

  /**
   * Start listening for new Meteora pools
   */
  async start() {
    if (this.isRunning) {
      console.log('[Meteora] Already running');
      return;
    }

    console.log('[Meteora] Starting DLMM pool listener...');
    this.isRunning = true;
    this.connect();
  }

  /**
   * Connect to WebSocket (Helius primary, public RPC fallback)
   */
  private connect() {
    // Choose endpoint based on whether we should use public RPC
    let wsUrl: string;
    if (this.usePublicRpc || !this.heliusApiKey) {
      wsUrl = PUBLIC_WS_RPC;
      console.log('[Meteora] Connecting to PUBLIC Solana WebSocket (fallback)...');
    } else {
      wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
      console.log('[Meteora] Connecting to Helius WebSocket...');
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log(`[Meteora] WebSocket connected (${this.usePublicRpc ? 'PUBLIC' : 'HELIUS'})`);
      this.subscribeToMeteora();

      // Keep connection alive with pings
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30000);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        // Ignore parse errors
      }
    });

    this.ws.on('error', (error: any) => {
      console.error('[Meteora] WebSocket error:', error.message);

      // Check if this is a rate limit or quota error - switch to public RPC
      if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('limit')) {
        this.heliusFailCount++;
        if (this.heliusFailCount >= 3 && !this.usePublicRpc) {
          console.log('[Meteora] Helius quota exceeded, switching to public RPC...');
          this.usePublicRpc = true;
        }
      }
      console.log('[Meteora] Will retry connection...');
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[Meteora] WebSocket closed (code: ${code})`);
      this.cleanup();

      // Check for rate limit close codes
      if (code === 1008 || code === 1013) {
        this.heliusFailCount++;
        if (!this.usePublicRpc) {
          console.log('[Meteora] Possible rate limit, switching to public RPC...');
          this.usePublicRpc = true;
        }
      }

      if (this.isRunning) {
        const delay = this.usePublicRpc ? 3000 : 5000;
        console.log(`[Meteora] Reconnecting in ${delay/1000} seconds...`);
        this.reconnectTimeout = setTimeout(() => this.connect(), delay);
      }
    });
  }

  /**
   * Subscribe to Meteora program logs using standard logsSubscribe
   */
  private subscribeToMeteora() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Subscribe to DLMM program logs
    const subscribeDLMM = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [METEORA_DLMM_PROGRAM],
        },
        {
          commitment: 'confirmed',
        },
      ],
    };

    // Subscribe to AMM program logs
    const subscribeAMM = {
      jsonrpc: '2.0',
      id: 2,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [METEORA_AMM_PROGRAM],
        },
        {
          commitment: 'confirmed',
        },
      ],
    };

    this.ws.send(JSON.stringify(subscribeDLMM));
    this.ws.send(JSON.stringify(subscribeAMM));
    console.log('[Meteora] Subscribed to DLMM and AMM logs');
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any) {
    // Handle subscription confirmations
    if (message.result !== undefined && (message.id === 1 || message.id === 2)) {
      this.subscriptionIds.push(message.result);
      console.log(`[Meteora] Subscription confirmed (ID: ${message.result})`);
      return;
    }

    // Handle errors
    if (message.error) {
      console.error(`[Meteora] RPC error:`, message.error);
      return;
    }

    // Handle log notifications
    if (message.method === 'logsNotification') {
      const result = message.params?.result;
      if (result?.value) {
        this.processLogs(result.value);
      }
    }
  }

  /**
   * Process log notification to detect pool creation
   */
  private processLogs(logData: { signature: string; logs: string[]; err: any }) {
    const { signature, logs, err } = logData;

    // Skip failed transactions
    if (err) return;

    // Skip if we've seen this signature
    if (this.seenSignatures.has(signature)) return;
    this.seenSignatures.add(signature);

    // Keep signature cache from growing too large
    if (this.seenSignatures.size > 10000) {
      const arr = Array.from(this.seenSignatures);
      this.seenSignatures = new Set(arr.slice(-5000));
    }

    // Check for pool initialization
    const isPoolInit = logs.some((log: string) =>
      log.includes('InitializeLbPair') ||
      log.includes('InitializePool') ||
      log.includes('initialize_lb_pair') ||
      log.includes('initializePermissionlessPool') ||
      log.includes('Program log: Instruction: Initialize')
    );

    if (!isPoolInit) return;

    console.log(`\n[Meteora] 🆕 POOL INIT DETECTED! TX: ${signature.slice(0, 20)}...`);

    // Queue the fetch request to avoid rate limiting
    requestQueue.push(() => this.fetchTransactionDetails(signature));
    processRequestQueue();
  }

  /**
   * Fetch transaction details to extract token info
   * Uses Helius API if available, falls back to public RPC with retry logic
   */
  private async fetchTransactionDetails(signature: string) {
    // Try Helius first if not in public RPC mode AND budget allows
    if (!this.usePublicRpc && this.heliusApiKey && heliusBudget.canMakeCall('GET_TRANSACTION')) {
      try {
        const response = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${this.heliusApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: [signature] }),
        });

        if (response.status === 429) {
          console.log('[Meteora] Helius rate limited, switching to public RPC...');
          this.usePublicRpc = true;
          heliusBudget.pause();
          // Fall through to public RPC
        } else if (response.ok) {
          // Track successful API call
          heliusBudget.trackUsage('GET_TRANSACTION');
          const data = await response.json() as any[];
          if (data && data[0]) {
            this.processTransaction(data[0], signature);
            return;
          }
        }
      } catch (error) {
        console.log(`[Meteora] Helius error, trying public RPC...`);
      }
    } else if (!this.usePublicRpc && this.heliusApiKey && !heliusBudget.canMakeCall('GET_TRANSACTION')) {
      console.log('[Meteora] Helius budget limit reached, using public RPC...');
    }

    // Fallback to public RPC with retry logic
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Add delay between retries (exponential backoff)
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }

        const response = await fetch(PUBLIC_HTTP_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [
              signature,
              { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
            ],
          }),
        });

        if (response.status === 429) {
          if (attempt < maxRetries - 1) {
            continue; // Retry
          }
          console.log(`[Meteora] Public RPC rate limited, skipping TX`);
          return;
        }

        if (!response.ok) {
          console.log(`[Meteora] Failed to fetch TX details: ${response.status}`);
          return;
        }

        const data = await response.json() as any;
        if (!data?.result) {
          // Transaction might not be confirmed yet, retry
          if (attempt < maxRetries - 1) {
            continue;
          }
          return;
        }

        // Convert public RPC format to our expected format
        const tx = this.convertPublicRpcTx(data.result, signature);
        if (tx) {
          this.processTransaction(tx, signature);
        }
        return; // Success, exit retry loop
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.log(`[Meteora] Error fetching TX after ${maxRetries} attempts`);
        }
      }
    }
  }

  /**
   * Convert public RPC transaction format to our expected format
   */
  private convertPublicRpcTx(result: any, signature: string): any {
    try {
      const meta = result.meta;
      const tx = result.transaction;

      if (!meta || !tx) return null;

      // Extract token transfers from postTokenBalances/preTokenBalances
      const tokenTransfers: any[] = [];
      const postBalances = meta.postTokenBalances || [];
      const preBalances = meta.preTokenBalances || [];

      // Build map of pre-balances
      const preMap = new Map<string, { mint: string; amount: string }>();
      for (const pre of preBalances) {
        const key = `${pre.accountIndex}-${pre.mint}`;
        preMap.set(key, { mint: pre.mint, amount: pre.uiTokenAmount?.amount || '0' });
      }

      // Find transfers by comparing pre/post
      for (const post of postBalances) {
        const key = `${post.accountIndex}-${post.mint}`;
        const pre = preMap.get(key);
        const preAmount = BigInt(pre?.amount || '0');
        const postAmount = BigInt(post.uiTokenAmount?.amount || '0');

        if (postAmount !== preAmount) {
          tokenTransfers.push({
            mint: post.mint,
            fromUserAccount: pre ? 'existing' : null,
            toUserAccount: post.owner,
            tokenAmount: Number(postAmount - preAmount) / Math.pow(10, post.uiTokenAmount?.decimals || 9),
          });
        }
      }

      // Extract native SOL transfers
      const nativeTransfers: any[] = [];
      const preSOL = meta.preBalances || [];
      const postSOL = meta.postBalances || [];
      const accountKeys = tx.message?.accountKeys || [];

      for (let i = 0; i < preSOL.length; i++) {
        const diff = postSOL[i] - preSOL[i];
        if (Math.abs(diff) > 1000000) { // > 0.001 SOL
          nativeTransfers.push({
            fromUserAccount: diff < 0 ? accountKeys[i]?.pubkey : null,
            toUserAccount: diff > 0 ? accountKeys[i]?.pubkey : null,
            amount: Math.abs(diff),
          });
        }
      }

      // Get fee payer (first account)
      const feePayer = accountKeys[0]?.pubkey || 'unknown';

      return {
        signature,
        feePayer,
        tokenTransfers,
        nativeTransfers,
      };
    } catch (error) {
      console.log(`[Meteora] Error converting TX format: ${error}`);
      return null;
    }
  }

  /**
   * Process transaction data to extract token info
   */
  private processTransaction(tx: any, signature: string) {
    try {
      // Find token transfers to identify the new token
      const tokenTransfers = tx.tokenTransfers || [];
      const nativeTransfers = tx.nativeTransfers || [];

      // Find mints that aren't quote tokens
      const mints = new Set<string>();
      for (const transfer of tokenTransfers) {
        if (transfer.mint && !QUOTE_TOKENS.has(transfer.mint)) {
          mints.add(transfer.mint);
        }
      }

      if (mints.size === 0) {
        console.log('[Meteora] No new token found in TX');
        return;
      }

      const baseToken = Array.from(mints)[0];

      // Skip if we've seen this pool
      if (this.seenPools.has(baseToken)) return;
      this.seenPools.add(baseToken);

      // Get creator (fee payer)
      const creator = tx.feePayer || 'unknown';

      // Calculate liquidity from native transfers
      let liquiditySol = 0;
      for (const transfer of nativeTransfers) {
        if (transfer.amount > 0) {
          liquiditySol = Math.max(liquiditySol, transfer.amount / 1e9);
        }
      }

      console.log(`[Meteora]    Token: ${baseToken}`);
      console.log(`[Meteora]    Creator: ${creator}`);
      console.log(`[Meteora]    Liquidity: ~${liquiditySol.toFixed(2)} SOL`);

      // Emit the new token event
      this.emitNewToken(baseToken, creator, liquiditySol, signature);

    } catch (error) {
      console.log(`[Meteora] Error processing TX: ${error}`);
    }
  }

  /**
   * Emit a new token event
   */
  private async emitNewToken(tokenAddress: string, creator: string, liquiditySol: number, txSignature: string) {
    // Fetch token metadata - prefer DexScreener (FREE) when budget is tight
    let name = 'Unknown';
    let symbol = 'UNKNOWN';
    let decimals = 9;

    // Only try Helius metadata if budget allows (skip when budget is > 50% used)
    const shouldUseHeliusMetadata = !this.usePublicRpc && this.heliusApiKey && heliusBudget.shouldUseHelius();

    // Try Helius DAS if budget allows
    if (shouldUseHeliusMetadata && heliusBudget.canMakeCall('GET_ASSET')) {
      try {
        const dasResponse = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'metadata',
            method: 'getAsset',
            params: { id: tokenAddress },
          }),
        });

        if (dasResponse.status === 429) {
          console.log('[Meteora] Helius rate limited on metadata, using fallbacks...');
          this.usePublicRpc = true;
          heliusBudget.pause();
        } else if (dasResponse.ok) {
          heliusBudget.trackUsage('GET_ASSET');
          const dasData = await dasResponse.json() as any;
          if (dasData?.result?.content?.metadata) {
            const meta = dasData.result.content.metadata;
            name = meta.name || 'Unknown';
            symbol = meta.symbol || 'UNKNOWN';
          }
          if (dasData?.result?.token_info?.decimals !== undefined) {
            decimals = dasData.result.token_info.decimals;
          }
        }
      } catch (error) {
        // Silent fail, will try DexScreener
      }
    }

    // Skip second Helius call - rely on DexScreener (FREE) for metadata
    // This saves ~100 credits per token

    // Fetch REAL liquidity from DexScreener (not from transaction which is unreliable)
    let liquidityUsd = 0;
    let marketCap = 0;

    try {
      // Give DexScreener a moment to index the new pool
      await new Promise(resolve => setTimeout(resolve, 2000));

      const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      if (dexResponse.ok) {
        const dexData = await dexResponse.json() as any;
        if (dexData?.pairs && dexData.pairs.length > 0) {
          // Get the pair with highest liquidity
          const bestPair = dexData.pairs.reduce((best: any, p: any) => {
            const liq = p.liquidity?.usd || 0;
            const bestLiq = best?.liquidity?.usd || 0;
            return liq > bestLiq ? p : best;
          }, dexData.pairs[0]);

          liquidityUsd = bestPair.liquidity?.usd || 0;
          marketCap = bestPair.marketCap || bestPair.fdv || 0;

          // Also get name/symbol from DexScreener if we don't have it
          if (name === 'Unknown' && bestPair.baseToken?.name) {
            name = bestPair.baseToken.name;
            symbol = bestPair.baseToken.symbol || symbol;
          }
        }
      }
    } catch (error) {
      console.log(`[Meteora] Could not fetch DexScreener data for ${tokenAddress}`);
    }

    // Fallback to transaction-based estimate if DexScreener has no data
    if (liquidityUsd === 0) {
      const solPrice = 127;
      liquidityUsd = liquiditySol * solPrice;
      marketCap = liquidityUsd * 2;
    }

    const token: NewTokenEvent = {
      address: tokenAddress,
      name,
      symbol,
      decimals,
      source: 'meteora',
      creator,
      liquidityUsd,
      timestamp: Date.now(),
      initialMarketCap: marketCap,
    };

    console.log(`[Meteora] 🎯 Emitting: ${symbol} (${tokenAddress.slice(0, 8)}...) - $${liquidityUsd.toFixed(0)} liq, $${marketCap.toFixed(0)} mc`);
    this.emit('newToken', token);
  }

  /**
   * Stop listening
   */
  stop() {
    console.log('[Meteora] Stopping...');
    this.isRunning = false;
    this.cleanup();

    if (this.ws) {
      // Unsubscribe from all subscriptions
      if (this.ws.readyState === WebSocket.OPEN) {
        for (const subId of this.subscriptionIds) {
          this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'logsUnsubscribe',
            params: [subId],
          }));
        }
      }
      this.ws.close();
      this.ws = null;
    }

    this.subscriptionIds = [];
    console.log('[Meteora] Stopped');
  }

  /**
   * Cleanup timers
   */
  private cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Clear seen pools cache
   */
  clearCache() {
    this.seenPools.clear();
    this.seenSignatures.clear();
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      poolsDetected: this.seenPools.size,
      connected: this.ws?.readyState === WebSocket.OPEN,
      usingPublicRpc: this.usePublicRpc,
    };
  }

  /**
   * Force switch to public RPC (call when Helius quota is exceeded)
   */
  forcePublicRpc() {
    if (!this.usePublicRpc) {
      console.log('[Meteora] Forcing switch to public RPC...');
      this.usePublicRpc = true;

      // Reconnect with public RPC if already running
      if (this.isRunning && this.ws) {
        this.ws.close();
        // Will auto-reconnect with public RPC
      }
    }
  }

  /**
   * Check if using public RPC
   */
  isUsingPublicRpc(): boolean {
    return this.usePublicRpc;
  }
}
