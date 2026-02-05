/**
 * Pool Monitor - Yellowstone gRPC Subscriptions for New Token Detection
 *
 * Monitors DEX programs for new pool creations using Chainstack Yellowstone gRPC.
 * Persistent gRPC connection — unlimited events pushed to us for $49/mo flat.
 *
 * Supported DEXs:
 * - Raydium AMM (CPMM + V4)
 * - Orca Whirlpool
 * - Pump.fun
 * - Meteora
 */

import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate,
  SubscribeUpdateAccountInfo,
} from '@triton-one/yellowstone-grpc';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

// DEX Program IDs
export const DEX_PROGRAMS = {
  RAYDIUM_CPMM: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
  RAYDIUM_AMM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  ORCA_WHIRLPOOL: new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
  PUMP_FUN: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
  METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
} as const;

// Reverse lookup: owner bytes (base58) → DEX name
const OWNER_TO_DEX: Map<string, keyof typeof DEX_PROGRAMS> = new Map(
  Object.entries(DEX_PROGRAMS).map(([name, pubkey]) => [pubkey.toBase58(), name as keyof typeof DEX_PROGRAMS])
);

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
  graduatedFrom?: 'PUMP_FUN';
  bondingCurveTime?: number;
}

export type PoolEventCallback = (event: PoolEvent) => void | Promise<void>;

// Monitor configuration
export interface MonitorConfig {
  yellowstoneEndpoint: string;
  yellowstoneToken: string;
  enabledDexs?: Array<keyof typeof DEX_PROGRAMS>;
  onPoolEvent: PoolEventCallback;
  onError?: (error: Error, context: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

// Pump.fun bonding curve discriminator (verified from live data)
const PUMP_FUN_BONDING_CURVE_DISCRIMINATOR = Buffer.from([
  0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60
]);
const PUMP_FUN_BONDING_CURVE_SIZE = 151;

/**
 * PoolMonitor - Yellowstone gRPC subscriber for DEX pool detection
 *
 * Single persistent gRPC connection to Chainstack Yellowstone.
 * Subscribes to all DEX program accounts in one stream.
 */
export class PoolMonitor {
  private config: MonitorConfig;
  private client: Client;
  private stream: any = null;
  private running: boolean = false;
  private seenAccounts: Set<string> = new Set();
  private eventQueue: Array<{ dex: keyof typeof DEX_PROGRAMS; event: PoolEvent }> = [];
  private processingQueue: boolean = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingId: number = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private notificationCount: number = 0;
  private parsedCount: number = 0;

  // Graduation tracking: mint → timestamp when first seen on pump.fun
  private pumpFunTokens: Map<string, number> = new Map();
  private graduationCount: number = 0;

  constructor(config: MonitorConfig) {
    this.config = config;
    this.client = new Client(config.yellowstoneEndpoint, config.yellowstoneToken, {
      grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
    });

    console.log(`[PoolMonitor] Initialized with Yellowstone gRPC`);
    console.log(`[PoolMonitor] Endpoint: ${config.yellowstoneEndpoint}`);
  }

  /**
   * Start monitoring — connect to Yellowstone gRPC and subscribe
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[PoolMonitor] Already running');
      return;
    }

    this.running = true;
    await this.connectAndSubscribe();
  }

  /**
   * Connect to Yellowstone and set up subscription
   */
  private async connectAndSubscribe(): Promise<void> {
    const enabledDexs = this.config.enabledDexs || Object.keys(DEX_PROGRAMS) as Array<keyof typeof DEX_PROGRAMS>;

    try {
      // Connect gRPC client
      await this.client.connect();
      console.log('[PoolMonitor] gRPC client connected');

      // Create subscription stream
      this.stream = await this.client.subscribe();
      console.log('[PoolMonitor] Subscription stream created');

      // Build owner filter — all DEX program IDs in ONE subscription
      const ownerPubkeys = enabledDexs.map(dex => DEX_PROGRAMS[dex].toBase58());

      const request: SubscribeRequest = {
        accounts: {
          dex: {
            owner: ownerPubkeys,
            account: [],
            filters: [],
          },
        },
        slots: {},
        transactions: {},
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.CONFIRMED,
      };

      // Handle incoming data
      this.stream.on('data', (update: SubscribeUpdate) => {
        try {
          if (update.account) {
            this.handleAccountUpdate(update.account.account, update.account.slot);
          }
          if (update.pong) {
            // Pong received, connection is alive
          }
        } catch (err) {
          console.error('[PoolMonitor] Error processing update:', err);
        }
      });

      this.stream.on('error', (error: Error) => {
        console.error('[PoolMonitor] Stream error:', error.message);
        if (this.config.onError) {
          this.config.onError(error, 'stream');
        }
        this.handleDisconnect();
      });

      this.stream.on('end', () => {
        console.log('[PoolMonitor] Stream ended');
        this.handleDisconnect();
      });

      this.stream.on('close', () => {
        console.log('[PoolMonitor] Stream closed');
        this.handleDisconnect();
      });

      // Send subscription request
      this.stream.write(request);
      console.log(`[PoolMonitor] Subscribed to ${enabledDexs.length} DEX programs: ${enabledDexs.join(', ')}`);

      // Start ping keepalive every 10 seconds
      this.startPingKeepalive();

      if (this.config.onConnect) {
        this.config.onConnect();
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PoolMonitor] Failed to connect: ${errorMsg}`);
      if (this.config.onError) {
        this.config.onError(error instanceof Error ? error : new Error(errorMsg), 'connect');
      }
      this.scheduleReconnect();
    }
  }

  /**
   * Handle account update from Yellowstone gRPC stream
   */
  private handleAccountUpdate(accountInfo: SubscribeUpdateAccountInfo | undefined, slotStr: string): void {
    if (!accountInfo) return;

    this.notificationCount++;

    // Determine which DEX owns this account
    const ownerBase58 = new PublicKey(accountInfo.owner).toBase58();
    const dex = OWNER_TO_DEX.get(ownerBase58);

    if (!dex) return; // Not one of our DEX programs

    // Convert Uint8Array to Buffer for parsing
    const data = Buffer.from(accountInfo.data);
    const pubkey = new PublicKey(accountInfo.pubkey).toBase58();
    const slot = parseInt(slotStr, 10) || 0;

    if (this.notificationCount <= 5 || this.notificationCount % 1000 === 0) {
      console.log(`[PoolMonitor] Notification #${this.notificationCount} from ${dex} (parsed ${this.parsedCount} pools)`);
    }

    // Parse the account data
    const poolData = this.parsePoolData(dex, data);
    if (!poolData) return;

    // Generate unique key for dedup
    const poolKey = `${dex}:${poolData.baseMint || 'unknown'}:${poolData.quoteMint || 'unknown'}`;

    if (this.seenAccounts.has(poolKey)) return;
    this.seenAccounts.add(poolKey);
    this.parsedCount++;

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
        console.log(`[PoolMonitor] GRADUATION #${this.graduationCount}: ${poolData.baseMint?.slice(0, 12)}... (${Math.round(bondingCurveTime / 1000 / 60)}min on curve)`);
      } else {
        console.log(`[PoolMonitor] NEW POOL: ${poolData.baseMint?.slice(0, 12)}... on ${dex}`);
      }
    } else if (dex !== 'PUMP_FUN') {
      console.log(`[PoolMonitor] NEW POOL: ${poolData.baseMint?.slice(0, 12)}... on ${dex}`);
    }

    const event: PoolEvent = {
      type: eventType,
      dex,
      poolAddress: pubkey,
      baseMint: poolData.baseMint,
      quoteMint: poolData.quoteMint,
      timestamp: now,
      slot,
      rawData: data,
      graduatedFrom,
      bondingCurveTime,
    };

    this.eventQueue.push({ dex, event });
    this.processQueue();
  }

  /**
   * Process event queue with rate limiting
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
        console.error('[PoolMonitor] Queue processing error:', error);
      }

      if (this.eventQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    this.processingQueue = false;
  }

  /**
   * Start ping keepalive to maintain gRPC connection
   */
  private startPingKeepalive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.stream && this.running) {
        try {
          this.stream.write({
            accounts: {},
            slots: {},
            transactions: {},
            transactionsStatus: {},
            blocks: {},
            blocksMeta: {},
            entry: {},
            accountsDataSlice: [],
            ping: { id: ++this.pingId },
          });
        } catch (err) {
          console.error('[PoolMonitor] Ping failed:', err);
        }
      }
    }, 10000);
  }

  /**
   * Handle disconnect — clean up and schedule reconnect
   */
  private handleDisconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.stream = null;

    if (this.config.onDisconnect) {
      this.config.onDisconnect();
    }

    if (this.running) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    console.log('[PoolMonitor] Reconnecting in 5 seconds...');
    this.reconnectTimeout = setTimeout(async () => {
      if (this.running) {
        console.log('[PoolMonitor] Attempting reconnection...');
        // Create fresh client for reconnection
        this.client = new Client(
          this.config.yellowstoneEndpoint,
          this.config.yellowstoneToken,
          { grpcMaxDecodingMessageSize: 64 * 1024 * 1024 }
        );
        await this.connectAndSubscribe();
      }
    }, 5000);
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    console.log('[PoolMonitor] Stopping...');

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.stream) {
      try {
        this.stream.end();
      } catch (err) {
        // Ignore close errors
      }
      this.stream = null;
    }

    console.log('[PoolMonitor] Stopped');
  }

  // ============================================
  // POOL DATA PARSING (unchanged from WebSocket version)
  // ============================================

  /**
   * Parse pool data based on DEX type
   */
  private parsePoolData(dex: keyof typeof DEX_PROGRAMS, data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
  } | null {
    try {
      if (data.length < 100) return null;

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

  private isValidMint(mint: string): boolean {
    if (mint === '11111111111111111111111111111111') return false;
    if (mint.startsWith('1111111111')) return false;
    if (mint === 'So11111111111111111111111111111111111111112') return false;
    return true;
  }

  private parseRaydiumCPMM(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    if (data.length < 200) return null;
    try {
      const mint0 = new PublicKey(data.subarray(72, 104)).toBase58();
      const mint1 = new PublicKey(data.subarray(104, 136)).toBase58();
      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;
      return { poolAddress: 'parsed', baseMint, quoteMint: mint0 === baseMint ? mint1 : mint0 };
    } catch { return null; }
  }

  private parseRaydiumAMMV4(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    if (data.length < 400) return null;
    try {
      const mint0 = new PublicKey(data.subarray(336, 368)).toBase58();
      const mint1 = new PublicKey(data.subarray(368, 400)).toBase58();
      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;
      return { poolAddress: 'parsed', baseMint, quoteMint: mint0 === baseMint ? mint1 : mint0 };
    } catch { return null; }
  }

  private parseOrcaWhirlpool(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    if (data.length < 200) return null;
    try {
      const mint0 = new PublicKey(data.subarray(101, 133)).toBase58();
      const mint1 = new PublicKey(data.subarray(133, 165)).toBase58();
      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;
      return { poolAddress: 'parsed', baseMint, quoteMint: mint0 === baseMint ? mint1 : mint0 };
    } catch { return null; }
  }

  private parsePumpFun(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    if (data.length !== PUMP_FUN_BONDING_CURVE_SIZE) return null;
    try {
      const discriminator = data.subarray(0, 8);
      if (!discriminator.equals(PUMP_FUN_BONDING_CURVE_DISCRIMINATOR)) return null;
      const mintBytes = data.subarray(8, 40);
      const baseMint = new PublicKey(mintBytes).toBase58();
      if (baseMint === '11111111111111111111111111111111' || baseMint.startsWith('1111111111')) return null;
      return { poolAddress: 'parsed', baseMint, quoteMint: 'So11111111111111111111111111111111111111112' };
    } catch { return null; }
  }

  private parseMeteoraDLMM(data: Buffer): { poolAddress: string; baseMint?: string; quoteMint?: string } | null {
    if (data.length < 200) return null;
    try {
      const mint0 = new PublicKey(data.subarray(8, 40)).toBase58();
      const mint1 = new PublicKey(data.subarray(40, 72)).toBase58();
      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;
      return { poolAddress: 'parsed', baseMint, quoteMint: mint0 === baseMint ? mint1 : mint0 };
    } catch { return null; }
  }

  // ============================================
  // STATS & CLEANUP
  // ============================================

  getStats(): {
    running: boolean;
    connected: boolean;
    seenPools: number;
    notifications: number;
    parsed: number;
    pumpFunTracked: number;
    graduations: number;
  } {
    return {
      running: this.running,
      connected: this.stream !== null,
      seenPools: this.seenAccounts.size,
      notifications: this.notificationCount,
      parsed: this.parsedCount,
      pumpFunTracked: this.pumpFunTokens.size,
      graduations: this.graduationCount,
    };
  }

  cleanupOldTokens(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
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
