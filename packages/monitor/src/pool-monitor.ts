/**
 * Pool Monitor - WebSocket Subscriptions for New Token Detection
 *
 * Monitors DEX programs for new pool creations using FREE WebSocket subscriptions.
 * No per-call billing - just a persistent connection.
 *
 * Supported DEXs:
 * - Raydium AMM (CPMM)
 * - Orca Whirlpool
 * - Pump.fun
 * - Meteora
 */

import {
  Connection,
  PublicKey,
} from '@solana/web3.js';
import WebSocket from 'ws';

// DEX Program IDs
export const DEX_PROGRAMS = {
  // Raydium Concentrated Liquidity (CPMM)
  RAYDIUM_CPMM: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
  // Raydium AMM V4
  RAYDIUM_AMM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  // Orca Whirlpool
  ORCA_WHIRLPOOL: new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
  // Pump.fun
  PUMP_FUN: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
  // Meteora DLMM
  METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
} as const;

// Pool detection event
export interface PoolEvent {
  type: 'new_pool' | 'pool_update' | 'graduation';
  dex: keyof typeof DEX_PROGRAMS;
  poolAddress: string;
  baseMint?: string;
  quoteMint?: string;
  timestamp: number;
  slot: number;
  rawData: Buffer;
  // Graduation-specific fields
  graduatedFrom?: 'PUMP_FUN';
  bondingCurveTime?: number; // Time spent on bonding curve (ms)
}

// Callback for pool events
export type PoolEventCallback = (event: PoolEvent) => void | Promise<void>;

// Monitor configuration
export interface MonitorConfig {
  rpcEndpoint: string;
  rpcWsEndpoint?: string;
  enabledDexs?: Array<keyof typeof DEX_PROGRAMS>;
  onPoolEvent: PoolEventCallback;
  onError?: (error: Error, dex: string) => void;
  onConnect?: (dex: string) => void;
  onDisconnect?: (dex: string) => void;
}

// Pump.fun bonding curve discriminator
// Verified from live data: 17b7f83760d8ac60
const PUMP_FUN_BONDING_CURVE_DISCRIMINATOR = Buffer.from([
  0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60
]);

// Expected size for pump.fun bonding curve accounts
const PUMP_FUN_BONDING_CURVE_SIZE = 151;

/**
 * PoolMonitor - Manages WebSocket subscriptions to DEX programs
 * Uses raw WebSocket for reliability instead of @solana/web3.js subscriptions
 */
export class PoolMonitor {
  private connection: Connection;
  private config: MonitorConfig;
  private wsEndpoint: string;
  private websockets: Map<string, WebSocket> = new Map();
  private subscriptionIds: Map<string, number> = new Map();
  private running: boolean = false;
  private seenAccounts: Set<string> = new Set();
  private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private eventQueue: Array<{ dex: keyof typeof DEX_PROGRAMS; event: PoolEvent }> = [];
  private processingQueue: boolean = false;

  // Graduation tracking: mint -> timestamp when first seen on pump.fun
  private pumpFunTokens: Map<string, number> = new Map();
  private graduationCount: number = 0;

  constructor(config: MonitorConfig) {
    this.config = config;

    // Determine WebSocket endpoint
    this.wsEndpoint = config.rpcWsEndpoint || this.httpToWs(config.rpcEndpoint);

    this.connection = new Connection(config.rpcEndpoint, {
      commitment: 'confirmed',
    });

    console.log(`[PoolMonitor] Initialized with RPC: ${config.rpcEndpoint}`);
    console.log(`[PoolMonitor] WebSocket: ${this.wsEndpoint}`);
  }

  /**
   * Convert HTTP endpoint to WebSocket endpoint
   */
  private httpToWs(httpUrl: string): string {
    return httpUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');
  }

  /**
   * Start monitoring all enabled DEXs
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[PoolMonitor] Already running');
      return;
    }

    this.running = true;
    const enabledDexs = this.config.enabledDexs || Object.keys(DEX_PROGRAMS) as Array<keyof typeof DEX_PROGRAMS>;

    console.log(`[PoolMonitor] Starting monitoring for ${enabledDexs.length} DEXs...`);

    for (const dex of enabledDexs) {
      await this.subscribeToDex(dex);
    }

    console.log('[PoolMonitor] All subscriptions active');
  }

  /**
   * Stop all monitoring
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    console.log('[PoolMonitor] Stopping...');

    // Clear reconnect timeouts
    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();

    // Close all WebSocket connections
    for (const [dex, ws] of this.websockets) {
      try {
        ws.close();
        console.log(`[PoolMonitor] Closed WebSocket for ${dex}`);
      } catch (error) {
        console.error(`[PoolMonitor] Error closing WebSocket for ${dex}:`, error);
      }
    }

    this.websockets.clear();
    this.subscriptionIds.clear();
    console.log('[PoolMonitor] Stopped');
  }

  /**
   * Subscribe to a specific DEX program using raw WebSocket
   */
  private async subscribeToDex(dex: keyof typeof DEX_PROGRAMS): Promise<void> {
    const programId = DEX_PROGRAMS[dex];

    try {
      const ws = new WebSocket(this.wsEndpoint);

      ws.on('open', () => {
        console.log(`[PoolMonitor] WebSocket connected for ${dex}`);

        // Send subscription request
        const subscribeMsg = {
          jsonrpc: '2.0',
          id: 1,
          method: 'programSubscribe',
          params: [
            programId.toBase58(),
            { encoding: 'base64', commitment: 'confirmed' }
          ]
        };
        ws.send(JSON.stringify(subscribeMsg));
      });

      let notificationCount = 0;
      let parsedCount = 0;

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle subscription confirmation
          if (msg.result && msg.id === 1) {
            this.subscriptionIds.set(dex, msg.result);
            console.log(`[PoolMonitor] Subscribed to ${dex} (ID: ${msg.result})`);

            if (this.config.onConnect) {
              this.config.onConnect(dex);
            }
            return;
          }

          // Handle program notifications
          if (msg.method === 'programNotification') {
            notificationCount++;
            if (notificationCount <= 5 || notificationCount % 100 === 0) {
              console.log(`[PoolMonitor] Received notification #${notificationCount} for ${dex}`);
            }
            const result = this.handleRawNotification(dex, msg.params);
            if (result) parsedCount++;
            if (notificationCount <= 5 || notificationCount % 100 === 0) {
              console.log(`[PoolMonitor] Parsed ${parsedCount}/${notificationCount} so far`);
            }
          }
        } catch (err) {
          console.error(`[PoolMonitor] Error parsing message:`, err);
        }
      });

      ws.on('error', (error) => {
        console.error(`[PoolMonitor] WebSocket error for ${dex}:`, error.message);
        if (this.config.onError) {
          this.config.onError(error, dex);
        }
      });

      ws.on('close', () => {
        console.log(`[PoolMonitor] WebSocket closed for ${dex}`);
        this.websockets.delete(dex);
        this.subscriptionIds.delete(dex);

        if (this.config.onDisconnect) {
          this.config.onDisconnect(dex);
        }

        // Reconnect if still running
        if (this.running) {
          this.scheduleReconnect(dex);
        }
      });

      this.websockets.set(dex, ws);
    } catch (error) {
      console.error(`[PoolMonitor] Failed to subscribe to ${dex}:`, error);
      this.scheduleReconnect(dex);
    }
  }

  /**
   * Handle raw WebSocket notification
   * Returns true if a new pool was detected
   */
  private handleRawNotification(
    dex: keyof typeof DEX_PROGRAMS,
    params: { result: { context: { slot: number }; value: { pubkey: string; account: { data: [string, string]; lamports: number } } } }
  ): boolean {
    try {
      const { context, value } = params.result;
      const accountData = value.account.data;

      // Decode base64 data
      const data = Buffer.from(accountData[0], 'base64');

      // Parse the account data based on DEX type
      const poolData = this.parsePoolData(dex, data);

      if (!poolData) {
        return false;
      }

      // Generate a unique key for this pool
      const poolKey = `${dex}:${poolData.baseMint || 'unknown'}:${poolData.quoteMint || 'unknown'}`;

      // Check if we've seen this pool before
      const isNew = !this.seenAccounts.has(poolKey);

      if (isNew) {
        this.seenAccounts.add(poolKey);

        const now = Date.now();
        let eventType: 'new_pool' | 'graduation' = 'new_pool';
        let graduatedFrom: 'PUMP_FUN' | undefined;
        let bondingCurveTime: number | undefined;

        // Track pump.fun tokens for graduation detection
        if (dex === 'PUMP_FUN' && poolData.baseMint) {
          this.pumpFunTokens.set(poolData.baseMint, now);
          console.log(`[PoolMonitor] PUMP.FUN: ${poolData.baseMint?.slice(0, 12)}... (tracking ${this.pumpFunTokens.size} tokens)`);
        }

        // Check for graduation: Raydium pool with a token we saw on pump.fun
        if ((dex === 'RAYDIUM_AMM_V4' || dex === 'RAYDIUM_CPMM') && poolData.baseMint) {
          const pumpFunTime = this.pumpFunTokens.get(poolData.baseMint);
          if (pumpFunTime) {
            eventType = 'graduation';
            graduatedFrom = 'PUMP_FUN';
            bondingCurveTime = now - pumpFunTime;
            this.graduationCount++;
            console.log(`[PoolMonitor] 🎓 GRADUATION #${this.graduationCount}: ${poolData.baseMint?.slice(0, 12)}... (bonding curve: ${Math.round(bondingCurveTime / 1000 / 60)}min)`);
          } else {
            console.log(`[PoolMonitor] NEW POOL: ${poolData.baseMint?.slice(0, 12)}... on ${dex}`);
          }
        } else if (dex !== 'PUMP_FUN') {
          console.log(`[PoolMonitor] NEW POOL: ${poolData.baseMint?.slice(0, 12)}... on ${dex}`);
        }

        // Emit pool event
        const event: PoolEvent = {
          type: eventType,
          dex,
          poolAddress: value.pubkey,
          baseMint: poolData.baseMint,
          quoteMint: poolData.quoteMint,
          timestamp: now,
          slot: context.slot,
          rawData: data,
          graduatedFrom,
          bondingCurveTime,
        };

        // Add to queue instead of processing immediately
        this.eventQueue.push({ dex, event });
        this.processQueue();
        return true;
      }
      return false;
    } catch (error) {
      console.error(`[PoolMonitor] Error processing ${dex} notification:`, error);
      return false;
    }
  }

  /**
   * Process event queue with rate limiting
   * Only processes one event at a time with delays between
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.eventQueue.length > 0 && this.running) {
      const item = this.eventQueue.shift();
      if (!item) break;

      try {
        await this.config.onPoolEvent(item.event);
      } catch (error) {
        console.error(`[PoolMonitor] Queue processing error:`, error);
      }

      // Rate limit: wait 500ms between events to avoid RPC overload
      if (this.eventQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    this.processingQueue = false;
  }

  /**
   * Parse pool data based on DEX type
   * Returns null if not a valid pool account
   */
  private parsePoolData(dex: keyof typeof DEX_PROGRAMS, data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
  } | null {
    try {
      // Minimum size check
      if (data.length < 100) {
        return null;
      }

      switch (dex) {
        case 'RAYDIUM_CPMM':
          return this.parseRaydiumCPMM(data);
        case 'RAYDIUM_AMM_V4':
          return this.parseRaydiumAMMV4(data);
        case 'ORCA_WHIRLPOOL':
          return this.parseOrcaWhirlpool(data);
        case 'PUMP_FUN':
          return this.parsePumpFun(data);
        case 'METEORA_DLMM':
          return this.parseMeteoraDLMM(data);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Validate if a mint address looks valid
   */
  private isValidMint(mint: string): boolean {
    // Skip system program, all zeros, or obviously invalid
    if (mint === '11111111111111111111111111111111') return false;
    if (mint.startsWith('1111111111')) return false;
    if (mint === 'So11111111111111111111111111111111111111112') return false; // Skip SOL
    return true;
  }

  /**
   * Parse Raydium CPMM pool data
   * Layout: https://github.com/raydium-io/raydium-cpmm
   */
  private parseRaydiumCPMM(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    // CPMM pool state is 637 bytes
    if (data.length < 200) return null;

    try {
      // Discriminator check (first 8 bytes)
      // Skip discriminator and read token mints
      // Token 0 mint at offset 72
      // Token 1 mint at offset 104
      const mint0 = new PublicKey(data.subarray(72, 104)).toBase58();
      const mint1 = new PublicKey(data.subarray(104, 136)).toBase58();

      // Find the non-SOL token
      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: mint0 === baseMint ? mint1 : mint0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse Raydium AMM V4 pool data
   */
  private parseRaydiumAMMV4(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    // AMM V4 pool state is 752 bytes
    if (data.length < 400) return null;

    try {
      // AMM V4 layout: base mint at offset 336, quote mint at offset 368
      const mint0 = new PublicKey(data.subarray(336, 368)).toBase58();
      const mint1 = new PublicKey(data.subarray(368, 400)).toBase58();

      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: mint0 === baseMint ? mint1 : mint0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse Orca Whirlpool data
   */
  private parseOrcaWhirlpool(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    // Whirlpool state is 653 bytes
    if (data.length < 200) return null;

    try {
      // Token A mint at offset 101, Token B at 133
      const mint0 = new PublicKey(data.subarray(101, 133)).toBase58();
      const mint1 = new PublicKey(data.subarray(133, 165)).toBase58();

      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: mint0 === baseMint ? mint1 : mint0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse Pump.fun bonding curve data
   * Layout (for 151-byte bonding curves):
   *   0-8:    discriminator (17b7f83760d8ac60)
   *   8-40:   mint (token address)
   *   40-72:  associated account or PDA
   *   72+:    reserves and other state
   */
  private parsePumpFun(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    // Bonding curves are exactly 151 bytes based on live data analysis
    if (data.length !== PUMP_FUN_BONDING_CURVE_SIZE) {
      return null;
    }

    try {
      // Check discriminator (first 8 bytes)
      const discriminator = data.subarray(0, 8);
      if (!discriminator.equals(PUMP_FUN_BONDING_CURVE_DISCRIMINATOR)) {
        return null;
      }

      // Mint is at bytes 8-40
      const mintBytes = data.subarray(8, 40);
      const baseMint = new PublicKey(mintBytes).toBase58();

      // Skip if mint looks invalid (all zeros or system program)
      if (baseMint === '11111111111111111111111111111111' ||
          baseMint.startsWith('1111111111')) {
        return null;
      }

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: 'So11111111111111111111111111111111111111112', // SOL
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse Meteora DLMM pool data
   */
  private parseMeteoraDLMM(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    // Meteora DLMM LB pair is ~900+ bytes
    if (data.length < 200) return null;

    try {
      // DLMM layout: token X mint at offset 8, token Y mint at offset 40
      const mint0 = new PublicKey(data.subarray(8, 40)).toBase58();
      const mint1 = new PublicKey(data.subarray(40, 72)).toBase58();

      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: mint0 === baseMint ? mint1 : mint0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(dex: keyof typeof DEX_PROGRAMS): void {
    if (!this.running) return;

    // Clear existing timeout
    const existing = this.reconnectTimeouts.get(dex);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule reconnect in 5 seconds
    const timeout = setTimeout(async () => {
      if (this.running) {
        console.log(`[PoolMonitor] Reconnecting to ${dex}...`);
        await this.subscribeToDex(dex);
      }
    }, 5000);

    this.reconnectTimeouts.set(dex, timeout);

    if (this.config.onDisconnect) {
      this.config.onDisconnect(dex);
    }
  }

  /**
   * Get monitoring statistics
   */
  getStats(): {
    running: boolean;
    subscriptions: number;
    seenPools: number;
    dexs: string[];
    pumpFunTracked: number;
    graduations: number;
  } {
    return {
      running: this.running,
      subscriptions: this.websockets.size,
      seenPools: this.seenAccounts.size,
      dexs: Array.from(this.websockets.keys()),
      pumpFunTracked: this.pumpFunTokens.size,
      graduations: this.graduationCount,
    };
  }

  /**
   * Clean up old pump.fun tokens (older than 24h) to prevent memory leaks
   */
  cleanupOldTokens(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    let removed = 0;
    for (const [mint, timestamp] of this.pumpFunTokens) {
      if (timestamp < cutoff) {
        this.pumpFunTokens.delete(mint);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[PoolMonitor] Cleaned up ${removed} old pump.fun tokens`);
    }
  }
}
