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

import YellowstoneGrpcPkg from '@triton-one/yellowstone-grpc';
import type { SubscribeRequest, SubscribeUpdate, SubscribeUpdateAccountInfo } from '@triton-one/yellowstone-grpc';

// Handle ESM/CJS interop - the package exports default as the Client class
const Client = (YellowstoneGrpcPkg as any).default || YellowstoneGrpcPkg;
type Client = InstanceType<typeof Client>;

// CommitmentLevel enum values (avoid named export issues with Node ESM)
const CommitmentLevel = {
  PROCESSED: 0,
  CONFIRMED: 1,
  FINALIZED: 2,
} as const;
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

// Metaplex Token Metadata Program - for getting token names WITHOUT RPC (legacy tokens only)
export const METAPLEX_TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Token-2022 Program - pump.fun uses this since Nov 2025 with embedded metadata
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// SPL Token Program - for vault account tracking (Raydium AMM V4, Meteora DLMM)
export const SPL_TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Token metadata cache (mint -> name/symbol)
export interface TokenMetadata {
  name: string;
  symbol: string;
  cachedAt: number;
}

// Reverse lookup: owner bytes (base58) → DEX name
const OWNER_TO_DEX: Map<string, keyof typeof DEX_PROGRAMS> = new Map(
  Object.entries(DEX_PROGRAMS).map(([name, pubkey]) => [pubkey.toBase58(), name as keyof typeof DEX_PROGRAMS])
);

// Pool detection event - enriched with data from Yellowstone (no RPC needed!)
export interface PoolEvent {
  type: 'new_pool' | 'pool_update' | 'graduation';
  dex: keyof typeof DEX_PROGRAMS;
  poolAddress: string;
  baseMint?: string;
  quoteMint?: string;
  timestamp: number;
  slot: number;
  graduatedFrom?: 'PUMP_FUN';
  bondingCurveTime?: number;

  // Token metadata from Yellowstone (NO RPC!)
  tokenName?: string;
  tokenSymbol?: string;

  // Enriched data extracted directly from Yellowstone account bytes
  enrichedData?: {
    // Liquidity info (from pool reserves)
    virtualSolReserves?: number;    // In lamports
    virtualTokenReserves?: number;
    realSolReserves?: number;       // In lamports
    realTokenReserves?: number;
    liquiditySol?: number;          // Calculated SOL liquidity

    // Raw reserve amounts (Raydium CPMM)
    token0Amount?: number;          // Raw token0 reserves
    token1Amount?: number;          // Raw token1 reserves

    // Token info (from bonding curve / pool data)
    tokenSupply?: number;
    complete?: boolean;              // Pump.fun graduation status

    // Pool-specific data
    baseVault?: string;
    quoteVault?: string;
    lpMint?: string;
  };
}

export type PoolEventCallback = (event: PoolEvent) => void | Promise<void>;

// Price update event for position monitoring
export interface PriceUpdateEvent {
  poolAddress: string;
  tokenAddress: string;
  price: number;           // Price in SOL per token
  liquiditySol: number;    // Current liquidity
  timestamp: number;
}

export type PriceUpdateCallback = (event: PriceUpdateEvent) => void | Promise<void>;

// Monitor configuration
export interface MonitorConfig {
  yellowstoneEndpoint: string;
  yellowstoneToken: string;
  enabledDexs?: Array<keyof typeof DEX_PROGRAMS>;
  onPoolEvent: PoolEventCallback;
  onPriceUpdate?: PriceUpdateCallback;  // For position price tracking
  onError?: (error: Error, context: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  heliusApiKey?: string; // For fallback metadata fetch (pump.fun only)
}

// Pump.fun bonding curve discriminator (verified from live data)
const PUMP_FUN_BONDING_CURVE_DISCRIMINATOR = Buffer.from([
  0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60
]);
// Pump.fun bonding curve: 8 (discriminator) + 32 (mint) + 8*5 (reserves/supply) + 1 (complete) + more = 151 bytes
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

  // Token metadata cache: mint → {name, symbol} (from Metaplex, no RPC!)
  private metadataCache: Map<string, TokenMetadata> = new Map();
  private metadataHits: number = 0;
  private metadataMisses: number = 0;

  // Pending events waiting for metadata (mint → {event, retries, timer})
  private pendingMetadata: Map<string, {
    event: PoolEvent;
    dex: keyof typeof DEX_PROGRAMS;
    retries: number;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  // Memory management limits
  private static readonly MAX_SEEN_ACCOUNTS = 50_000;
  private static readonly MAX_PUMP_FUN_TOKENS = 10_000;
  private static readonly MAX_EVENT_QUEUE = 500;
  private static readonly METADATA_RETRY_DELAY_MS = 2000; // Retry every 2 seconds
  private static readonly METADATA_MAX_RETRIES = 5; // 5 retries = 10 seconds max wait

  // Helius DAS API for fallback metadata fetch (pump.fun tokens only)
  private heliusApiKey: string | undefined;
  private static readonly PUMP_FUN_CLEANUP_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Pending bonding curves waiting for mint registration
  // bondingCurveAddress → {poolData, timestamp}
  private pendingBondingCurves: Map<string, {
    poolData: {
      poolAddress: string;
      baseMint?: string;
      quoteMint?: string;
      enrichedData?: PoolEvent['enrichedData'];
    };
    pubkey: string;
    slot: number;
    timestamp: number;
  }> = new Map();
  private static readonly PENDING_BC_MAX_AGE_MS = 30000; // 30 seconds max wait

  // Position price tracking: poolAddress → {tokenAddress, lastPrice, dex}
  private positionPools: Map<string, {
    tokenAddress: string;
    lastPrice: number;
    dex: keyof typeof DEX_PROGRAMS;
  }> = new Map();
  private static readonly PRICE_CHANGE_THRESHOLD = 0.001; // 0.1% change threshold (lowered for better tracking)

  // Vault tracking for AMM pools: vaultAddress → {poolAddress, isBase}
  // Used to get liquidity for Raydium AMM V4, Meteora DLMM from their vault accounts
  private vaultToPool: Map<string, { poolAddress: string; isBase: boolean; mint: string }> = new Map();

  // Pool vault balances: poolAddress → {baseBalance, quoteBalance, baseMint, quoteMint, dex}
  private poolVaultBalances: Map<string, {
    baseBalance: number;
    quoteBalance: number;
    baseMint: string;
    quoteMint: string;
    dex: keyof typeof DEX_PROGRAMS;
    baseVault: string;
    quoteVault: string;
  }> = new Map();

  // Track which vaults we've already subscribed to
  private subscribedVaults: Set<string> = new Set();

  constructor(config: MonitorConfig) {
    this.config = config;
    this.heliusApiKey = config.heliusApiKey;
    this.client = new Client(config.yellowstoneEndpoint, config.yellowstoneToken, {
      grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
    });

    console.log(`[PoolMonitor] Initialized with Yellowstone gRPC`);
    console.log(`[PoolMonitor] Endpoint: ${config.yellowstoneEndpoint}`);
    if (this.heliusApiKey) {
      console.log(`[PoolMonitor] Helius DAS API: enabled (fallback for token names)`);
    }
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

      // Build owner filter — all DEX program IDs + Metaplex in ONE subscription
      const ownerPubkeys = enabledDexs.map(dex => DEX_PROGRAMS[dex].toBase58());

      const request: SubscribeRequest = {
        accounts: {
          // DEX programs for pool detection - single combined subscription
          dex: {
            owner: [
              ...ownerPubkeys,
              METAPLEX_TOKEN_METADATA_PROGRAM.toBase58(),
              TOKEN_2022_PROGRAM.toBase58(),
            ],
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

    // Check if this is a Metaplex metadata account (legacy tokens)
    const ownerBase58 = new PublicKey(accountInfo.owner).toBase58();
    if (ownerBase58 === METAPLEX_TOKEN_METADATA_PROGRAM.toBase58()) {
      this.handleMetadataUpdate(accountInfo);
      return;
    }

    // Check if this is a Token-2022 mint account (pump.fun since Nov 2025)
    if (ownerBase58 === TOKEN_2022_PROGRAM.toBase58()) {
      this.handleToken2022Update(accountInfo);
      return;
    }

    // Check if this is an SPL Token account (vault for Raydium AMM V4, Meteora)
    if (ownerBase58 === SPL_TOKEN_PROGRAM.toBase58()) {
      this.handleVaultUpdate(accountInfo);
      return;
    }

    // Determine which DEX owns this account
    const dex = OWNER_TO_DEX.get(ownerBase58);

    if (!dex) return; // Not one of our DEX programs

    // Convert Uint8Array to Buffer for parsing
    const data = Buffer.from(accountInfo.data);
    const pubkey = new PublicKey(accountInfo.pubkey).toBase58();
    const slot = parseInt(slotStr, 10) || 0;

    // Check if this is a tracked position pool (for price updates)
    if (this.positionPools.has(pubkey)) {
      console.log(`[PoolMonitor] Received update for TRACKED pool: ${pubkey.slice(0, 8)}... (${dex})`);
      this.handlePositionPriceUpdate(pubkey, data, slot);
      // Continue processing normally - we still want to detect new pools
    }

    if (this.notificationCount <= 5 || this.notificationCount % 1000 === 0) {
      console.log(`[PoolMonitor] Notification #${this.notificationCount} from ${dex} (parsed ${this.parsedCount} pools)`);
    }

    // Parse the account data
    const poolData = this.parsePoolData(dex, data);
    if (!poolData) return;

    // For Pump.fun, look up mint from bondingCurve→mint mapping
    // (the mint is not stored in the bonding curve account data)
    if (dex === 'PUMP_FUN' && !poolData.baseMint) {
      const mint = this.getMintFromBondingCurve(pubkey);
      if (mint) {
        poolData.baseMint = mint;
      } else {
        // Mint not registered yet - queue this bonding curve and wait
        if (this.pendingBondingCurves.size < 1000) {
          this.pendingBondingCurves.set(pubkey, {
            poolData,
            pubkey,
            slot,
            timestamp: Date.now(),
          });
        }
        return; // Wait for mint registration
      }
    }

    // Generate unique key for dedup
    const poolKey = `${dex}:${poolData.baseMint || 'unknown'}:${poolData.quoteMint || 'unknown'}`;

    if (this.seenAccounts.has(poolKey)) return;

    // Cap seenAccounts to prevent unbounded memory growth
    if (this.seenAccounts.size >= PoolMonitor.MAX_SEEN_ACCOUNTS) {
      // Clear oldest half (Set iteration order = insertion order)
      const toRemove = Math.floor(PoolMonitor.MAX_SEEN_ACCOUNTS / 2);
      let count = 0;
      for (const key of this.seenAccounts) {
        if (count++ >= toRemove) break;
        this.seenAccounts.delete(key);
      }
    }

    this.seenAccounts.add(poolKey);
    this.parsedCount++;

    const now = Date.now();
    let eventType: 'new_pool' | 'graduation' = 'new_pool';
    let graduatedFrom: 'PUMP_FUN' | undefined;
    let bondingCurveTime: number | undefined;

    // Track pump.fun tokens for graduation detection
    if (dex === 'PUMP_FUN' && poolData.baseMint) {
      // Cap pump.fun tracking to prevent memory growth
      if (this.pumpFunTokens.size >= PoolMonitor.MAX_PUMP_FUN_TOKENS) {
        this.cleanupOldTokens();
        // If still too large after cleanup, remove oldest entries
        if (this.pumpFunTokens.size >= PoolMonitor.MAX_PUMP_FUN_TOKENS) {
          const toRemove = Math.floor(PoolMonitor.MAX_PUMP_FUN_TOKENS / 2);
          let count = 0;
          for (const key of this.pumpFunTokens.keys()) {
            if (count++ >= toRemove) break;
            this.pumpFunTokens.delete(key);
          }
        }
      }
      this.pumpFunTokens.set(poolData.baseMint, now);
      if (this.pumpFunTokens.size % 500 === 0) {
        console.log(`[PoolMonitor] PUMP.FUN: tracking ${this.pumpFunTokens.size} tokens`);
      }
    }

    // Check for graduation: Raydium pool with a token we saw on pump.fun
    if ((dex === 'RAYDIUM_AMM_V4' || dex === 'RAYDIUM_CPMM') && poolData.baseMint) {
      const pumpFunTime = this.pumpFunTokens.get(poolData.baseMint);
      if (pumpFunTime) {
        eventType = 'graduation';
        graduatedFrom = 'PUMP_FUN';
        bondingCurveTime = now - pumpFunTime;
        this.graduationCount++;
        // Always log graduations — these are high-value events
        console.log(`[PoolMonitor] GRADUATION #${this.graduationCount}: ${poolData.baseMint?.slice(0, 12)}... (${Math.round(bondingCurveTime / 1000 / 60)}min on curve)`);
      }
    }

    const event: PoolEvent = {
      type: eventType,
      dex,
      poolAddress: pubkey,
      baseMint: poolData.baseMint,
      quoteMint: poolData.quoteMint,
      timestamp: now,
      slot,
      graduatedFrom,
      bondingCurveTime,
      tokenName: undefined,
      tokenSymbol: undefined,
      enrichedData: poolData.enrichedData,
    };

    // Try immediate metadata lookup
    if (poolData.baseMint) {
      const metadata = this.metadataCache.get(poolData.baseMint);
      if (metadata) {
        event.tokenName = metadata.name;
        event.tokenSymbol = metadata.symbol;
        this.metadataHits++;
        // Got metadata immediately - send event now
        this.sendPoolEvent(dex, event);
        return;
      }
    }

    // No metadata yet - queue for retry (brand new tokens need time for metadata to arrive)
    if (poolData.baseMint && this.pendingMetadata.size < 1000) {
      // Log pump.fun events specifically since they should have metadata
      if (dex === 'PUMP_FUN') {
        console.log(`[PumpFun] Queuing ${poolData.baseMint.slice(0, 8)}... for metadata retry`);
      }
      this.queueForMetadataRetry(dex, event);
    } else {
      // Either no mint or queue full - send immediately without metadata
      this.metadataMisses++;
      this.sendPoolEvent(dex, event);
    }
  }

  /**
   * Derive Metaplex metadata PDA address for a mint
   */
  private deriveMetadataPDA(mint: string): string {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        METAPLEX_TOKEN_METADATA_PROGRAM.toBytes(),
        new PublicKey(mint).toBytes(),
      ],
      METAPLEX_TOKEN_METADATA_PROGRAM
    );
    return pda.toBase58();
  }

  /**
   * Queue an event for metadata retry
   * Will retry looking up metadata every 500ms for up to 3 seconds
   */
  private queueForMetadataRetry(dex: keyof typeof DEX_PROGRAMS, event: PoolEvent): void {
    if (!event.baseMint) return;

    const mint = event.baseMint;

    // Log the expected metadata PDA for debugging and track it
    if (dex === 'PUMP_FUN') {
      try {
        const metadataPDA = this.deriveMetadataPDA(mint);
        console.log(`[PumpFun] Mint: ${mint.slice(0, 8)}... -> Metadata PDA: ${metadataPDA.slice(0, 8)}...`);
        this.pendingMetadataPDAs.set(mint, metadataPDA);
        // Cap size
        if (this.pendingMetadataPDAs.size > 1000) {
          const first = this.pendingMetadataPDAs.keys().next().value;
          if (first) this.pendingMetadataPDAs.delete(first);
        }
      } catch (e) {
        console.log(`[PumpFun] Failed to derive PDA for ${mint.slice(0, 8)}...`);
      }
    }

    // Set up retry timer
    const tryMetadata = () => {
      const pending = this.pendingMetadata.get(mint);
      if (!pending) return;

      // Try to find metadata
      const metadata = this.metadataCache.get(mint);
      if (metadata) {
        // Found it! Update event and send
        pending.event.tokenName = metadata.name;
        pending.event.tokenSymbol = metadata.symbol;
        this.metadataHits++;
        clearTimeout(pending.timer);
        this.pendingMetadata.delete(mint);
        // Log successful retry (shows the system is working)
        if (pending.retries > 0) {
          console.log(`[Metadata] Found on retry #${pending.retries}: ${metadata.symbol} (${metadata.name}) for ${mint.slice(0, 8)}...`);
        }
        this.sendPoolEvent(pending.dex, pending.event);
        return;
      }

      // No metadata yet - retry or give up
      pending.retries++;
      if (pending.retries >= PoolMonitor.METADATA_MAX_RETRIES) {
        // Last resort for pump.fun: try Helius DAS API (one call per token)
        if (pending.dex === 'PUMP_FUN' && this.heliusApiKey) {
          this.fetchMetadataViaHelius(mint).then(metadata => {
            if (metadata) {
              pending.event.tokenName = metadata.name;
              pending.event.tokenSymbol = metadata.symbol;
              this.metadataHits++;
              console.log(`[Helius] Got: ${metadata.symbol} (${metadata.name}) for ${mint.slice(0, 8)}...`);
            } else {
              this.metadataMisses++;
            }
            this.pendingMetadata.delete(mint);
            this.sendPoolEvent(pending.dex, pending.event);
          }).catch(() => {
            this.metadataMisses++;
            this.pendingMetadata.delete(mint);
            this.sendPoolEvent(pending.dex, pending.event);
          });
          clearTimeout(pending.timer);
          return;
        }

        // Give up - send without metadata
        this.metadataMisses++;
        clearTimeout(pending.timer);
        this.pendingMetadata.delete(mint);
        this.sendPoolEvent(pending.dex, pending.event);
      } else {
        // Schedule next retry
        pending.timer = setTimeout(tryMetadata, PoolMonitor.METADATA_RETRY_DELAY_MS);
      }
    };

    // Store pending event
    this.pendingMetadata.set(mint, {
      event,
      dex,
      retries: 0,
      timer: setTimeout(tryMetadata, PoolMonitor.METADATA_RETRY_DELAY_MS),
    });
  }

  /**
   * Fetch token metadata via Helius DAS API (fallback for pump.fun)
   * One call per token, result cached for future lookups
   */
  private async fetchMetadataViaHelius(mint: string): Promise<{ name: string; symbol: string } | null> {
    if (!this.heliusApiKey) return null;

    try {
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'helius-metadata',
          method: 'getAsset',
          params: { id: mint },
        }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const content = data?.result?.content;
      if (!content?.metadata) return null;

      const name = content.metadata.name || null;
      const symbol = content.metadata.symbol || null;

      if (name && symbol) {
        // Cache for future lookups
        this.metadataCache.set(mint, { name, symbol, cachedAt: Date.now() });
        return { name, symbol };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Send pool event to callback (with rate limiting)
   */
  private sendPoolEvent(dex: keyof typeof DEX_PROGRAMS, event: PoolEvent): void {
    // Drop events if queue is too deep (backpressure)
    if (this.eventQueue.length >= PoolMonitor.MAX_EVENT_QUEUE) {
      return;
    }

    // Subscribe to vault accounts for AMM pools (Raydium AMM V4, Meteora DLMM)
    // This enables us to get real liquidity data from vault account updates
    if ((dex === 'RAYDIUM_AMM_V4' || dex === 'METEORA_DLMM') &&
        event.enrichedData?.baseVault &&
        event.enrichedData?.quoteVault &&
        event.baseMint &&
        event.quoteMint) {
      this.subscribeToVaults(
        event.poolAddress,
        event.enrichedData.baseVault,
        event.enrichedData.quoteVault,
        event.baseMint,
        event.quoteMint,
        dex
      );
    }

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

      // Rate limit: wait between events
      if (this.eventQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
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

    // Clear all pending metadata timers
    for (const pending of this.pendingMetadata.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingMetadata.clear();

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
  // METAPLEX METADATA PARSING (for token names, NO RPC!)
  // ============================================

  // Track metadata notifications for debugging
  private metadataNotifications: number = 0;
  private metadataParsed: number = 0;
  private metadataAccountsSeen: Set<string> = new Set(); // Track unique metadata accounts

  // Map of mint -> expected metadata PDA (for debugging)
  private pendingMetadataPDAs: Map<string, string> = new Map();

  /**
   * Handle Metaplex token metadata account updates
   * Parses name/symbol from account bytes and caches for pool lookups
   */
  private handleMetadataUpdate(accountInfo: SubscribeUpdateAccountInfo): void {
    this.metadataNotifications++;

    // Track unique metadata accounts we receive
    const accountPubkey = accountInfo.pubkey ? new PublicKey(accountInfo.pubkey).toBase58() : 'unknown';
    this.metadataAccountsSeen.add(accountPubkey);

    // Check if this is a metadata PDA we're waiting for
    for (const [mint, pda] of this.pendingMetadataPDAs) {
      if (accountPubkey === pda) {
        console.log(`[Metadata] *** RECEIVED PDA for pending mint ${mint.slice(0, 8)}...!`);
        break;
      }
    }

    try {
      const data = Buffer.from(accountInfo.data);

      // Metaplex Metadata account layout:
      // [0:1]   key (1 byte) - should be 4 for MetadataV1
      // [1:33]  update_authority (32 bytes)
      // [33:65] mint (32 bytes)
      // [65:69] name_len (4 bytes LE u32)
      // [69:69+name_len] name (variable)
      // After name: symbol_len (4 bytes), then symbol

      if (data.length < 70) return; // Too short

      const key = data.readUInt8(0);
      // Accept key 4 (MetadataV1) or other potential metadata types
      if (key !== 4 && key !== 0) return; // Not a metadata account

      // Extract mint address
      const mint = new PublicKey(data.subarray(33, 65)).toBase58();
      if (mint === '11111111111111111111111111111111' || mint.startsWith('1111111111')) return;

      // Parse name (Borsh string: 4-byte length prefix + data)
      const nameLen = data.readUInt32LE(65);
      if (nameLen > 32 || nameLen === 0) return; // Invalid name length

      const nameEnd = 69 + nameLen;
      if (data.length < nameEnd + 4) return; // Not enough data for symbol

      const name = data.subarray(69, nameEnd).toString('utf8').replace(/\0+$/, '').trim();

      // Parse symbol
      const symbolLen = data.readUInt32LE(nameEnd);
      if (symbolLen > 10 || symbolLen === 0) return; // Invalid symbol length

      const symbolEnd = nameEnd + 4 + symbolLen;
      if (data.length < symbolEnd) return;

      const symbol = data.subarray(nameEnd + 4, symbolEnd).toString('utf8').replace(/\0+$/, '').trim();

      // Validate we got real data
      if (!name || !symbol) return;
      if (name.length === 0 || symbol.length === 0) return;

      // Cache the metadata
      // Cap cache size to prevent memory issues
      if (this.metadataCache.size >= 50000) {
        // Remove oldest 25% of entries
        const toRemove = Math.floor(this.metadataCache.size / 4);
        let count = 0;
        for (const key of this.metadataCache.keys()) {
          if (count++ >= toRemove) break;
          this.metadataCache.delete(key);
        }
      }

      this.metadataCache.set(mint, {
        name,
        symbol,
        cachedAt: Date.now(),
      });
      this.metadataParsed++;

      // Check if this mint has a pending pool event - THIS IS THE KEY CHECK
      const pending = this.pendingMetadata.get(mint);
      if (pending) {
        console.log(`[Metadata] *** MATCH! ${symbol} (${name}) matches pending pump.fun pool ${mint.slice(0, 8)}...`);
      }

      // Log cached metadata (but reduce frequency to avoid log spam)
      if (this.metadataCache.size <= 10 || this.metadataCache.size % 100 === 0) {
        console.log(`[Metadata] Cached: ${symbol} (${name}) for ${mint.slice(0, 8)}... (${this.metadataCache.size} total, pending: ${this.pendingMetadata.size})`);
      }
    } catch {
      // Ignore parse errors - not all metadata accounts are valid
    }
  }

  // ============================================
  // VAULT ACCOUNT HANDLING (Raydium AMM V4, Meteora DLMM)
  // ============================================

  /**
   * Handle SPL Token account updates for tracked vaults
   * These vaults hold the actual liquidity for AMM pools
   *
   * SPL Token Account Layout (165 bytes):
   * [0:32]   mint
   * [32:64]  owner
   * [64:72]  amount (u64)
   * [72:73]  delegate_option
   * ... more fields
   */
  private handleVaultUpdate(accountInfo: SubscribeUpdateAccountInfo): void {
    try {
      const pubkey = new PublicKey(accountInfo.pubkey).toBase58();

      // Check if this is a tracked vault
      const vaultInfo = this.vaultToPool.get(pubkey);
      if (!vaultInfo) return; // Not a tracked vault

      const data = Buffer.from(accountInfo.data);
      if (data.length < 72) return; // Too short for token account

      // Parse the token balance (u64 at offset 64)
      const balance = Number(data.readBigUInt64LE(64));

      // Update the pool's vault balance
      const poolInfo = this.poolVaultBalances.get(vaultInfo.poolAddress);
      if (poolInfo) {
        if (vaultInfo.isBase) {
          poolInfo.baseBalance = balance;
        } else {
          poolInfo.quoteBalance = balance;
        }

        // Calculate liquidity from vault balances
        const WSOL_MINT = 'So11111111111111111111111111111111111111112';
        const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

        let liquiditySol = 0;
        if (poolInfo.baseMint === WSOL_MINT) {
          liquiditySol = poolInfo.baseBalance / 1e9;
        } else if (poolInfo.quoteMint === WSOL_MINT) {
          liquiditySol = poolInfo.quoteBalance / 1e9;
        } else if (poolInfo.baseMint === USDC_MINT || poolInfo.baseMint === USDT_MINT) {
          liquiditySol = poolInfo.baseBalance / 1e6;
        } else if (poolInfo.quoteMint === USDC_MINT || poolInfo.quoteMint === USDT_MINT) {
          liquiditySol = poolInfo.quoteBalance / 1e6;
        } else {
          // Non-SOL/stablecoin pair - use geometric mean estimate
          const geomMean = Math.sqrt(poolInfo.baseBalance * poolInfo.quoteBalance);
          liquiditySol = geomMean / 1e11;
        }

        // Log significant vault updates (reduced frequency)
        if (liquiditySol > 1) {
          console.log(`[Vault] ${vaultInfo.poolAddress.slice(0, 8)}... liquidity: ${liquiditySol.toFixed(2)} SOL (${poolInfo.dex})`);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Subscribe to vault accounts for a pool
   * Called when we detect a new pool from Raydium AMM V4 or Meteora DLMM
   */
  subscribeToVaults(
    poolAddress: string,
    baseVault: string,
    quoteVault: string,
    baseMint: string,
    quoteMint: string,
    dex: keyof typeof DEX_PROGRAMS
  ): void {
    // Skip if already subscribed
    if (this.subscribedVaults.has(baseVault) && this.subscribedVaults.has(quoteVault)) {
      return;
    }

    // Track vault → pool mapping
    this.vaultToPool.set(baseVault, { poolAddress, isBase: true, mint: baseMint });
    this.vaultToPool.set(quoteVault, { poolAddress, isBase: false, mint: quoteMint });

    // Initialize pool vault balances
    this.poolVaultBalances.set(poolAddress, {
      baseBalance: 0,
      quoteBalance: 0,
      baseMint,
      quoteMint,
      dex,
      baseVault,
      quoteVault,
    });

    // Subscribe to both vault accounts
    const vaultsToSubscribe = [];
    if (!this.subscribedVaults.has(baseVault)) {
      vaultsToSubscribe.push(baseVault);
      this.subscribedVaults.add(baseVault);
    }
    if (!this.subscribedVaults.has(quoteVault)) {
      vaultsToSubscribe.push(quoteVault);
      this.subscribedVaults.add(quoteVault);
    }

    if (vaultsToSubscribe.length > 0 && this.stream) {
      try {
        const request: SubscribeRequest = {
          accounts: {
            [`vault_${poolAddress.slice(0, 8)}`]: {
              owner: [SPL_TOKEN_PROGRAM.toBase58()],
              account: vaultsToSubscribe,
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

        this.stream.write(request);
        console.log(`[PoolMonitor] Subscribed to vaults for ${dex} pool ${poolAddress.slice(0, 8)}...`);
      } catch (err) {
        console.error(`[PoolMonitor] Failed to subscribe to vaults:`, err);
      }
    }

    // Limit vault subscriptions to prevent memory issues
    if (this.subscribedVaults.size > 10000) {
      // Remove oldest vaults (first entries in the Set)
      const toRemove = Array.from(this.subscribedVaults).slice(0, 1000);
      for (const vault of toRemove) {
        this.subscribedVaults.delete(vault);
        this.vaultToPool.delete(vault);
      }
    }
  }

  /**
   * Get current liquidity for a pool with vault tracking
   */
  getPoolLiquidity(poolAddress: string): number {
    const poolInfo = this.poolVaultBalances.get(poolAddress);
    if (!poolInfo) return 0;

    const WSOL_MINT = 'So11111111111111111111111111111111111111112';
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

    if (poolInfo.baseMint === WSOL_MINT) {
      return poolInfo.baseBalance / 1e9;
    } else if (poolInfo.quoteMint === WSOL_MINT) {
      return poolInfo.quoteBalance / 1e9;
    } else if (poolInfo.baseMint === USDC_MINT || poolInfo.baseMint === USDT_MINT) {
      return poolInfo.baseBalance / 1e6;
    } else if (poolInfo.quoteMint === USDC_MINT || poolInfo.quoteMint === USDT_MINT) {
      return poolInfo.quoteBalance / 1e6;
    } else {
      // Non-SOL pair - use geometric mean estimate
      const geomMean = Math.sqrt(poolInfo.baseBalance * poolInfo.quoteBalance);
      return geomMean / 1e11;
    }
  }

  // ============================================
  // TOKEN-2022 METADATA PARSING (pump.fun since Nov 2025)
  // ============================================

  // Track Token-2022 notifications for debugging
  private token2022Notifications: number = 0;
  private token2022Parsed: number = 0;

  /**
   * Handle Token-2022 mint account updates
   * Pump.fun tokens have metadata embedded in the mint account
   */
  private handleToken2022Update(accountInfo: SubscribeUpdateAccountInfo): void {
    this.token2022Notifications++;

    try {
      const data = Buffer.from(accountInfo.data);

      // Token-2022 mint accounts are at least 82 bytes (standard mint)
      // With metadata extension they're much larger (200+ bytes)
      if (data.length < 200) return; // Too short for metadata extension

      // Check if this is a pending pump.fun mint
      const pubkey = accountInfo.pubkey ? new PublicKey(accountInfo.pubkey).toBase58() : null;
      if (pubkey && this.pendingMetadata.has(pubkey)) {
        console.log(`[Token2022] *** PENDING MINT UPDATE: ${pubkey.slice(0, 8)}... (${data.length} bytes)`);
        // Dump the full data for analysis
        console.log(`[Token2022] Data: ${data.toString('hex').slice(0, 200)}...`);
      }

      // The account pubkey IS the mint address for mint accounts
      const mint = accountInfo.pubkey ? new PublicKey(accountInfo.pubkey).toBase58() : null;
      if (!mint) return;

      // Register this mint so we can map bonding curve → mint later
      // This is how we discover which token a Pump.fun bonding curve belongs to
      this.registerPumpFunMint(mint);
      this.token2022Parsed++;

      // Look for metadata extension in TLV format
      // Extensions start after byte 82 (standard mint) + 1 (account type)
      // Extension format: type (2 bytes) + length (2 bytes) + data

      // Search for metadata extension (type = 12 for TokenMetadata)
      const METADATA_EXTENSION_TYPE = 12;
      let offset = 83; // Start after mint + account type

      while (offset + 4 < data.length) {
        const extType = data.readUInt16LE(offset);
        const extLength = data.readUInt16LE(offset + 2);

        if (extType === METADATA_EXTENSION_TYPE && extLength > 0) {
          // Found metadata extension
          const metadataStart = offset + 4;
          const metadataEnd = metadataStart + extLength;

          if (metadataEnd <= data.length) {
            const metadata = this.parseToken2022Metadata(data.subarray(metadataStart, metadataEnd), mint);
            if (metadata) {
              this.metadataCache.set(mint, {
                name: metadata.name,
                symbol: metadata.symbol,
                cachedAt: Date.now(),
              });
              this.metadataParsed++;
              console.log(`[Token2022] Cached: ${metadata.symbol} (${metadata.name}) for ${mint.slice(0, 8)}...`);

              // Check if this mint has a pending pool event
              const pending = this.pendingMetadata.get(mint);
              if (pending) {
                console.log(`[Token2022] *** MATCH! ${metadata.symbol} matches pending pool ${mint.slice(0, 8)}...`);
              }
            }
          }
          return;
        }

        // Move to next extension
        offset += 4 + extLength;
      }
    } catch (err) {
      // Log first few errors
      if (this.token2022Notifications <= 10) {
        console.error(`[Token2022] Parse error:`, err);
      }
    }
  }

  /**
   * Parse Token-2022 metadata extension data
   */
  private parseToken2022Metadata(data: Buffer, mint: string): { name: string; symbol: string } | null {
    try {
      // Token-2022 metadata layout:
      // [0:32]   update_authority
      // [32:64]  mint (should match the account pubkey)
      // [64:68]  name_len (u32)
      // [68:68+name_len] name
      // After name: symbol_len (u32), symbol, uri_len (u32), uri

      if (data.length < 68) return null;

      // Skip update authority and mint (64 bytes)
      let offset = 64;

      // Read name
      const nameLen = data.readUInt32LE(offset);
      offset += 4;
      if (nameLen === 0 || nameLen > 100 || offset + nameLen > data.length) return null;

      const name = data.subarray(offset, offset + nameLen).toString('utf8').replace(/\0+$/, '').trim();
      offset += nameLen;

      // Read symbol
      if (offset + 4 > data.length) return null;
      const symbolLen = data.readUInt32LE(offset);
      offset += 4;
      if (symbolLen === 0 || symbolLen > 20 || offset + symbolLen > data.length) return null;

      const symbol = data.subarray(offset, offset + symbolLen).toString('utf8').replace(/\0+$/, '').trim();

      if (!name || !symbol) return null;

      return { name, symbol };
    } catch {
      return null;
    }
  }

  // ============================================
  // POOL DATA PARSING (unchanged from WebSocket version)
  // ============================================

  /**
   * Parse pool data based on DEX type - extracts enriched data from account bytes
   */
  private parsePoolData(dex: keyof typeof DEX_PROGRAMS, data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
    enrichedData?: PoolEvent['enrichedData'];
  } | null {
    try {
      if (data.length < 100 && dex !== 'PUMP_FUN') return null;

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

  private parseRaydiumCPMM(data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
    enrichedData?: PoolEvent['enrichedData'];
  } | null {
    if (data.length < 200) return null;
    try {
      // Raydium CPMM Pool Layout:
      // [8:40]   ammConfig (32 bytes)
      // [40:72]  poolCreator (32 bytes)
      // [72:104] token0Mint (32 bytes)
      // [104:136] token1Mint (32 bytes)
      // [136:168] lpMint (32 bytes)
      // [168:200] token0Vault (32 bytes)
      // [200:232] token1Vault (32 bytes)
      // [232:264] observationKey (32 bytes)
      // [264:265] bump (1 byte)
      // [265:266] status (1 byte)
      // [266:274] lpAmount (u64)
      // [274:282] protocolFeesToken0 (u64)
      // [282:290] protocolFeesToken1 (u64)
      // [290:298] fundFeesToken0 (u64)
      // [298:306] fundFeesToken1 (u64)
      // [306:314] openTime (i64)
      // [314:322] recentEpoch (u64)
      // [322:338] padding (16 bytes)
      // [338:346] token0Amount (u64) - actual reserves
      // [346:354] token1Amount (u64) - actual reserves

      const mint0 = new PublicKey(data.subarray(72, 104)).toBase58();
      const mint1 = new PublicKey(data.subarray(104, 136)).toBase58();
      const baseMint = this.isValidMint(mint0) ? mint0 : (this.isValidMint(mint1) ? mint1 : null);
      if (!baseMint) return null;

      const lpMint = new PublicKey(data.subarray(136, 168)).toBase58();
      const baseVault = new PublicKey(data.subarray(168, 200)).toBase58();
      const quoteVault = new PublicKey(data.subarray(200, 232)).toBase58();

      // Read reserve amounts from pool account - Raydium CPMM stores reserves directly
      let liquiditySol = 0;
      let token0Amount = 0;
      let token1Amount = 0;
      const WSOL_MINT = 'So11111111111111111111111111111111111111112';
      const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

      if (data.length >= 354) {
        token0Amount = Number(data.readBigUInt64LE(338));
        token1Amount = Number(data.readBigUInt64LE(346));

        // Determine liquidity based on what tokens are in the pair
        if (mint0 === WSOL_MINT) {
          liquiditySol = token0Amount / 1_000_000_000; // 9 decimals
        } else if (mint1 === WSOL_MINT) {
          liquiditySol = token1Amount / 1_000_000_000; // 9 decimals
        } else if (mint0 === USDC_MINT || mint0 === USDT_MINT) {
          liquiditySol = token0Amount / 1_000_000; // 6 decimals, ~= SOL value
        } else if (mint1 === USDC_MINT || mint1 === USDT_MINT) {
          liquiditySol = token1Amount / 1_000_000; // 6 decimals, ~= SOL value
        } else {
          // Non-SOL/stablecoin pair - estimate from reserves
          // Use geometric mean of reserves as liquidity proxy
          // Most memecoins have 6-9 decimals, normalize to reasonable SOL estimate
          const geomMean = Math.sqrt(token0Amount * token1Amount);
          // Scale down: 1e12 geometric mean ≈ 10 SOL liquidity
          liquiditySol = geomMean / 1e11;
        }

        // Sanity check - cap at reasonable values
        if (liquiditySol > 100000) liquiditySol = 100000;
        if (liquiditySol < 0) liquiditySol = 0;
      }

      // Calculate SOL price per token for position tracking
      // This avoids confusion about token ordering in handlePositionPriceUpdate
      let priceSOLperToken = 0;
      if (mint0 === WSOL_MINT && token0Amount > 0 && token1Amount > 0) {
        // SOL is token0 (9 decimals), memecoin is token1 (assume 6 decimals)
        priceSOLperToken = (token0Amount / 1e9) / (token1Amount / 1e6);
      } else if (mint1 === WSOL_MINT && token0Amount > 0 && token1Amount > 0) {
        // SOL is token1 (9 decimals), memecoin is token0 (assume 6 decimals)
        priceSOLperToken = (token1Amount / 1e9) / (token0Amount / 1e6);
      } else if (token0Amount > 0 && token1Amount > 0) {
        // Non-SOL pair: use ratio as rough price estimate
        priceSOLperToken = token1Amount / token0Amount;
      }

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: mint0 === baseMint ? mint1 : mint0,
        enrichedData: {
          liquiditySol,
          lpMint,
          baseVault,
          quoteVault,
          // Store raw reserves for reference
          token0Amount,
          token1Amount,
          // Pre-calculated price for position tracking
          virtualSolReserves: priceSOLperToken,  // Repurpose: SOL per token price
          virtualTokenReserves: (mint0 === WSOL_MINT) ? 1 : ((mint1 === WSOL_MINT) ? 2 : 0),  // Flag: which token is SOL
        },
      };
    } catch { return null; }
  }

  private parseRaydiumAMMV4(data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
    enrichedData?: PoolEvent['enrichedData'];
  } | null {
    if (data.length < 400) return null;
    try {
      // Raydium AMM V4 (AmmInfo) Layout - 752 bytes total
      // Key offsets for our needs:
      // [64:72]   lpAmount (u64)
      // [72:80]   nonce (u64)
      // [80:88]   depth (u64)
      // [88:96]   baseDecimal (u64)
      // [96:104]  quoteDecimal (u64)
      // [104:112] state (u64)
      // [112:120] resetFlag (u64)
      // [120:128] minSize (u64)
      // [128:136] volMaxCutRatio (u64)
      // [136:144] amountWaveRatio (u64)
      // [144:152] baseLotSize (u64)
      // [152:160] quoteLotSize (u64)
      // [160:168] minPriceMultiplier (u64)
      // [168:176] maxPriceMultiplier (u64)
      // [176:184] systemDecimalValue (u64)
      // [184:186] minSeparateNumerator (u16)
      // [186:188] minSeparateDenominator (u16)
      // [188:190] tradeFeeNumerator (u16)
      // ...more fees...
      // [208:240] poolWithdrawQueue (32 bytes)
      // [240:272] poolTempLpTokenAccount (32 bytes)
      // [272:304] ammOwner (32 bytes)
      // [304:336] lpMintAddress (32 bytes)
      // [336:368] coinMintAddress (baseMint) (32 bytes)
      // [368:400] pcMintAddress (quoteMint) (32 bytes)
      // [400:432] coinVaultAccount (32 bytes)
      // [432:464] pcVaultAccount (32 bytes)
      // ...
      // [496:504] poolOpenTime (u64)
      // [504:512] punishPcAmount (u64)
      // [512:520] punishCoinAmount (u64)
      // [520:528] orderbookToInitTime (u64)
      // [528:536] swapCoinInAmount (u128 first 8)
      // [536:544] swapCoinOutAmount
      // [544:552] swapCoin2PcFee
      // [552:560] swapPcInAmount
      // [560:568] swapPcOutAmount
      // [568:576] swapPc2CoinFee
      // [576:584] poolCoinTokenAccount (partial)
      // ...
      // Near end: vault balances are stored separately via vault accounts

      const baseMint = new PublicKey(data.subarray(336, 368)).toBase58();
      const quoteMint = new PublicKey(data.subarray(368, 400)).toBase58();
      const coinMint = this.isValidMint(baseMint) ? baseMint : (this.isValidMint(quoteMint) ? quoteMint : null);
      if (!coinMint) return null;

      const lpMint = new PublicKey(data.subarray(304, 336)).toBase58();
      const baseVault = new PublicKey(data.subarray(400, 432)).toBase58();
      const quoteVault = new PublicKey(data.subarray(432, 464)).toBase58();

      // For AMM V4, the actual reserve amounts are in the vault accounts, not in this account
      // Accurate liquidity requires fetching vault balances
      // Don't fabricate - mark as unknown
      const liquiditySol = 0; // Unknown without vault reads

      return {
        poolAddress: 'parsed',
        baseMint: coinMint,
        quoteMint: baseMint === coinMint ? quoteMint : baseMint,
        enrichedData: {
          liquiditySol,
          lpMint,
          baseVault,
          quoteVault,
        },
      };
    } catch { return null; }
  }

  private parseOrcaWhirlpool(data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
    enrichedData?: PoolEvent['enrichedData'];
  } | null {
    if (data.length < 200) return null;
    try {
      // Orca Whirlpool Layout (653 bytes):
      // [0:8]     discriminator
      // [8:40]    whirlpoolsConfig (32 bytes)
      // [40:42]   whirlpoolBump (u8[2])
      // [42:44]   tickSpacing (u16)
      // [44:46]   tickSpacingSeed (u16[2])
      // [46:48]   feeRate (u16)
      // [48:50]   protocolFeeRate (u16)
      // [50:66]   liquidity (u128)
      // [66:82]   sqrtPrice (u128) - Q64.64 fixed-point
      // [81:85]   tickCurrentIndex (i32)
      // [85:93]   protocolFeeOwedA (u64)
      // [93:101]  protocolFeeOwedB (u64)
      // [101:133] tokenMintA (32 bytes)
      // [133:165] tokenVaultA (32 bytes)
      // [165:181] feeGrowthGlobalA (u128)
      // [181:213] tokenMintB (32 bytes)
      // [213:245] tokenVaultB (32 bytes)
      // ... more fields

      const WSOL_MINT = 'So11111111111111111111111111111111111111112';

      // Correct offsets based on Orca Whirlpool SDK (verified from official docs)
      const tokenMintA = new PublicKey(data.subarray(101, 133)).toBase58();
      const tokenMintB = new PublicKey(data.subarray(181, 213)).toBase58();  // After feeGrowthGlobalA
      const baseMint = this.isValidMint(tokenMintA) ? tokenMintA : (this.isValidMint(tokenMintB) ? tokenMintB : null);
      if (!baseMint) return null;

      const tokenVaultA = new PublicKey(data.subarray(133, 165)).toBase58();
      const tokenVaultB = new PublicKey(data.subarray(213, 245)).toBase58();

      // Read sqrtPrice (u128 at offset 65) - Q64.64 fixed-point format
      // Price = (sqrtPrice / 2^64)^2 = sqrtPrice^2 / 2^128
      // We read lower 64 bits and upper 64 bits separately
      let sqrtPriceX64 = 0n;
      let priceTokenBPerA = 0;

      if (data.length >= 81) {
        const sqrtPriceLow = data.readBigUInt64LE(65);
        const sqrtPriceHigh = data.readBigUInt64LE(73);
        sqrtPriceX64 = (sqrtPriceHigh << 64n) | sqrtPriceLow;

        // Calculate price: (sqrtPrice / 2^64)^2
        // For numerical stability, we divide by 2^64 first, then square
        const sqrtPriceFloat = Number(sqrtPriceX64) / (2 ** 64);
        priceTokenBPerA = sqrtPriceFloat * sqrtPriceFloat;
      }

      // Read liquidity (u128 at offset 49)
      const liquidityLow = Number(data.readBigUInt64LE(49));

      // Determine which token is SOL and calculate SOL-denominated values
      const solIsTokenA = tokenMintA === WSOL_MINT;
      const solIsTokenB = tokenMintB === WSOL_MINT;

      let liquiditySol = 0;
      let token0Amount = 0;
      let token1Amount = 0;

      if (solIsTokenB && priceTokenBPerA > 0) {
        // TokenB is SOL, price = SOL per TokenA (the memecoin)
        // This is what we want for price calculation
        // Estimate liquidity as sqrt(L) * sqrt(price) for rough SOL value
        const sqrtL = Math.sqrt(liquidityLow);
        liquiditySol = Math.min(10000, (sqrtL * Math.sqrt(priceTokenBPerA)) / 1e9);

        // For token0Amount/token1Amount, we use the price ratio
        // token0 = memecoin, token1 = SOL
        token0Amount = liquidityLow / 1e6;  // Rough memecoin amount (6 decimals)
        token1Amount = (liquidityLow * priceTokenBPerA) / 1e9;  // SOL amount (9 decimals)
      } else if (solIsTokenA && priceTokenBPerA > 0) {
        // TokenA is SOL, price = TokenB per SOL
        // We need to invert: SOL per TokenB = 1 / priceTokenBPerA
        const priceSOLperToken = priceTokenBPerA > 0 ? 1 / priceTokenBPerA : 0;
        const sqrtL = Math.sqrt(liquidityLow);
        liquiditySol = Math.min(10000, sqrtL / 1e9);

        // token0 = SOL, token1 = memecoin
        token0Amount = liquidityLow / 1e9;
        token1Amount = (liquidityLow / priceTokenBPerA) / 1e6;
      } else {
        // Non-SOL pair - rough estimate
        liquiditySol = Math.min(1000, liquidityLow / 1e12);
        token0Amount = liquidityLow / 1e6;
        token1Amount = liquidityLow / 1e6;
      }

      // Calculate the actual SOL price per token (for position tracking)
      // This avoids precision loss from storing raw sqrtPrice as Number
      let priceSOLperToken = 0;
      if (solIsTokenB && priceTokenBPerA > 0) {
        // TokenB is SOL, price is directly priceTokenBPerA
        // Adjust for decimals: SOL (9 decimals), memecoin (6 decimals)
        priceSOLperToken = priceTokenBPerA * (1e6 / 1e9);
      } else if (solIsTokenA && priceTokenBPerA > 0) {
        // TokenA is SOL, need to invert
        priceSOLperToken = (1 / priceTokenBPerA) * (1e6 / 1e9);
      } else if (priceTokenBPerA > 0) {
        // Non-SOL pair: use raw price as estimate
        priceSOLperToken = priceTokenBPerA;
      }

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: tokenMintA === baseMint ? tokenMintB : tokenMintA,
        enrichedData: {
          liquiditySol,
          baseVault: tokenVaultA,
          quoteVault: tokenVaultB,
          token0Amount,
          token1Amount,
          // Store calculated price directly (avoids bigint precision loss)
          virtualSolReserves: priceSOLperToken,  // Repurpose: actual SOL price per token
          virtualTokenReserves: solIsTokenB ? 1 : (solIsTokenA ? 2 : 0),  // Flag: 1=SOL is tokenB, 2=SOL is tokenA
        },
      };
    } catch { return null; }
  }

  // Map bonding curve address → mint address (populated by Token-2022 observations)
  private bondingCurveToMint: Map<string, string> = new Map();

  /**
   * Derive Pump.fun bonding curve PDA from mint address
   * Seeds: ["bonding-curve", mint]
   */
  private deriveBondingCurvePDA(mint: string): string {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), new PublicKey(mint).toBytes()],
      DEX_PROGRAMS.PUMP_FUN
    );
    return pda.toBase58();
  }

  /**
   * Register a mint → bonding curve mapping (called when we observe Token-2022 mints)
   */
  registerPumpFunMint(mint: string): void {
    try {
      const bondingCurve = this.deriveBondingCurvePDA(mint);
      this.bondingCurveToMint.set(bondingCurve, mint);
      // Check if we have a pending bonding curve waiting for this mint
      const pending = this.pendingBondingCurves.get(bondingCurve);
      if (pending && pending.poolData) {
        // Found a match! Complete the event
        pending.poolData.baseMint = mint;
        this.pendingBondingCurves.delete(bondingCurve);

        // Continue processing the pool event
        this.processPumpFunPool(pending.poolData, pending.pubkey, pending.slot, pending.timestamp, mint);
      }

      // Clean up old pending bonding curves
      const cutoff = Date.now() - PoolMonitor.PENDING_BC_MAX_AGE_MS;
      for (const [bc, data] of this.pendingBondingCurves) {
        if (data.timestamp < cutoff) {
          this.pendingBondingCurves.delete(bc);
        }
      }

      // Cap size
      if (this.bondingCurveToMint.size > 10000) {
        const first = this.bondingCurveToMint.keys().next().value;
        if (first) this.bondingCurveToMint.delete(first);
      }
    } catch {
      // Invalid mint - ignore
    }
  }

  /**
   * Process a Pump.fun pool event once we have the mint
   */
  private processPumpFunPool(
    poolData: NonNullable<ReturnType<typeof this.parsePoolData>>,
    pubkey: string,
    slot: number,
    timestamp: number,
    mint: string
  ): void {
    const dex = 'PUMP_FUN' as const;

    // Generate unique key for dedup
    const poolKey = `${dex}:${mint}:${poolData.quoteMint || 'unknown'}`;
    if (this.seenAccounts.has(poolKey)) return;
    this.seenAccounts.add(poolKey);

    // Track for graduation detection
    if (this.pumpFunTokens.size < PoolMonitor.MAX_PUMP_FUN_TOKENS) {
      this.pumpFunTokens.set(mint, timestamp);
    }

    const event: PoolEvent = {
      type: 'new_pool',
      dex,
      poolAddress: pubkey,
      baseMint: mint,
      quoteMint: poolData.quoteMint,
      timestamp,
      slot,
      tokenName: undefined,
      tokenSymbol: undefined,
      enrichedData: poolData.enrichedData,
    };

    // Try immediate metadata lookup
    const metadata = this.metadataCache.get(mint);
    if (metadata) {
      event.tokenName = metadata.name;
      event.tokenSymbol = metadata.symbol;
      this.metadataHits++;
      this.sendPoolEvent(dex, event);
    } else {
      // Queue for metadata retry
      this.queueForMetadataRetry(dex, event);
    }
  }

  /**
   * Look up mint from bonding curve address
   */
  getMintFromBondingCurve(bondingCurve: string): string | undefined {
    return this.bondingCurveToMint.get(bondingCurve);
  }

  private parsePumpFun(data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
    enrichedData?: PoolEvent['enrichedData'];
  } | null {
    // Pump.fun bonding curve accounts are 151 bytes
    if (data.length < 151) return null;
    try {
      const discriminator = data.subarray(0, 8);
      if (!discriminator.equals(PUMP_FUN_BONDING_CURVE_DISCRIMINATOR)) return null;

      // Parse from bonding curve data
      // Pump.fun bonding curve layout (151 bytes):
      // [0:8]    discriminator (u64)
      // [8:16]   virtualTokenReserves (u64)
      // [16:24]  virtualSolReserves (u64)  ← REAL SOL data (~30 SOL typical)
      // [24:32]  realTokenReserves (u64)
      // [32:40]  realSolReserves (u64)
      // [40:48]  tokenTotalSupply (u64)
      // [48:49]  complete (bool)
      // [49:81]  creator pubkey (32 bytes)
      // [81:...]  additional padding to 151 bytes
      // NOTE: The mint is NOT stored in the account - must use bondingCurve→mint mapping

      const virtualTokenReserves = data.readBigUInt64LE(8);
      const virtualSolReserves = data.readBigUInt64LE(16);
      const realTokenReserves = data.readBigUInt64LE(24);
      const realSolReserves = data.readBigUInt64LE(32);
      const tokenSupply = data.readBigUInt64LE(40);
      const complete = data.readUInt8(48) === 1;

      // Calculate liquidity in SOL (lamports to SOL)
      // Use virtualSolReserves as it represents market liquidity
      const liquiditySol = Number(virtualSolReserves) / 1_000_000_000;

      // Sanity check - Pump.fun bonding curves typically have 30-85 SOL
      // Values outside 1-100 SOL range might indicate parsing issues
      if (liquiditySol > 100 || liquiditySol < 1) {
        return null; // Don't create event for invalid data
      }

      // NOTE: baseMint is NOT in the account data - must be looked up from bondingCurve→mint mapping
      // The caller (handleAccountUpdate) will do this lookup
      return {
        poolAddress: 'parsed',
        baseMint: undefined, // Caller must look up from bondingCurve→mint mapping
        quoteMint: 'So11111111111111111111111111111111111111112',
        enrichedData: {
          virtualSolReserves: Number(virtualSolReserves),
          virtualTokenReserves: Number(virtualTokenReserves),
          realSolReserves: Number(realSolReserves),
          realTokenReserves: Number(realTokenReserves),
          tokenSupply: Number(tokenSupply),
          complete,
          liquiditySol,
        },
      };
    } catch { return null; }
  }

  private parseMeteoraDLMM(data: Buffer): {
    poolAddress: string;
    baseMint?: string;
    quoteMint?: string;
    enrichedData?: PoolEvent['enrichedData'];
  } | null {
    if (data.length < 200) return null;
    try {
      // Meteora DLMM (LbPair) Layout:
      // [0:8]    discriminator
      // [8:40]   tokenXMint (32 bytes)
      // [40:72]  tokenYMint (32 bytes)
      // [72:104] reserveX (32 bytes - pubkey of reserve vault)
      // [104:136] reserveY (32 bytes - pubkey of reserve vault)
      // [136:138] binStep (u16)
      // [138:139] status (u8)
      // [139:140] pairType (u8)
      // [140:141] activeId (i32 - 4 bytes)
      // ... more fields
      // [152:160] binStepSeed (u64)
      // ... fee parameters
      // The actual reserve amounts are in the vault accounts

      const tokenXMint = new PublicKey(data.subarray(8, 40)).toBase58();
      const tokenYMint = new PublicKey(data.subarray(40, 72)).toBase58();
      const baseMint = this.isValidMint(tokenXMint) ? tokenXMint : (this.isValidMint(tokenYMint) ? tokenYMint : null);
      if (!baseMint) return null;

      const reserveX = new PublicKey(data.subarray(72, 104)).toBase58();
      const reserveY = new PublicKey(data.subarray(104, 136)).toBase58();

      // Meteora DLMM pools - actual amounts require vault account reads
      // Don't fabricate - mark as unknown
      const liquiditySol = 0; // Unknown without vault reads

      return {
        poolAddress: 'parsed',
        baseMint,
        quoteMint: tokenXMint === baseMint ? tokenYMint : tokenXMint,
        enrichedData: {
          liquiditySol,
          baseVault: reserveX,
          quoteVault: reserveY,
        },
      };
    } catch { return null; }
  }

  // ============================================
  // POSITION PRICE TRACKING
  // ============================================

  /**
   * Add a position pool to track for price updates
   * Called when TraderAgent opens a new position
   *
   * IMPORTANT: We subscribe to the specific pool account to get real-time updates.
   * Without this, we only get updates when the account changes (trades happen).
   */
  addPositionTracking(poolAddress: string, tokenAddress: string, dex: keyof typeof DEX_PROGRAMS): void {
    this.positionPools.set(poolAddress, {
      tokenAddress,
      lastPrice: 0,
      dex,
    });
    console.log(`[PoolMonitor] Tracking position: ${tokenAddress.slice(0, 8)}... on ${dex} (pool: ${poolAddress.slice(0, 8)}...)`);

    // Subscribe to this specific pool account for real-time updates
    this.subscribeToPoolAccount(poolAddress);
  }

  /**
   * Subscribe to a specific pool account via Yellowstone
   * This ensures we get updates for tracked positions even if no new pools are created
   */
  private subscribeToPoolAccount(poolAddress: string): void {
    if (!this.stream) {
      console.log(`[PoolMonitor] Cannot subscribe to pool - stream not connected`);
      return;
    }

    try {
      // Send additional subscription request for this specific account
      const request: SubscribeRequest = {
        accounts: {
          [`position_${poolAddress.slice(0, 8)}`]: {
            owner: [],
            account: [poolAddress],  // Subscribe by specific account address
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

      this.stream.write(request);
      console.log(`[PoolMonitor] Subscribed to pool account: ${poolAddress.slice(0, 8)}...`);
    } catch (err) {
      console.error(`[PoolMonitor] Failed to subscribe to pool ${poolAddress.slice(0, 8)}:`, err);
    }
  }

  /**
   * Remove position tracking when position is closed
   */
  removePositionTracking(poolAddress: string): void {
    const pos = this.positionPools.get(poolAddress);
    if (pos) {
      console.log(`[PoolMonitor] Stopped tracking: ${pos.tokenAddress.slice(0, 8)}...`);
      this.positionPools.delete(poolAddress);
    }
  }

  /**
   * Get all tracked positions (for startup hydration)
   */
  getTrackedPositions(): Map<string, { tokenAddress: string; lastPrice: number; dex: keyof typeof DEX_PROGRAMS }> {
    return this.positionPools;
  }

  /**
   * Check if we're tracking a specific pool
   */
  isTrackingPool(poolAddress: string): boolean {
    return this.positionPools.has(poolAddress);
  }

  /**
   * Handle price update for tracked position
   * Called internally when we receive account update for a tracked pool
   */
  private handlePositionPriceUpdate(poolAddress: string, data: Buffer, slot: number): void {
    const tracked = this.positionPools.get(poolAddress);
    if (!tracked) return;

    // Parse pool data to get current reserves/price
    const poolData = this.parsePoolData(tracked.dex, data);
    if (!poolData?.enrichedData) {
      console.log(`[PoolMonitor] Price update: ${tracked.tokenAddress.slice(0, 8)}... - no enrichedData (${tracked.dex})`);
      return;
    }

    // Calculate price from reserves
    let price = 0;
    const enriched = poolData.enrichedData;
    const WSOL_MINT = 'So11111111111111111111111111111111111111112';

    if (tracked.dex === 'PUMP_FUN' && enriched.virtualSolReserves && enriched.virtualTokenReserves) {
      // Pump.fun bonding curve price
      price = (enriched.virtualSolReserves / 1e9) / (enriched.virtualTokenReserves / 1e6);
    } else if (tracked.dex === 'ORCA_WHIRLPOOL' && enriched.virtualSolReserves !== undefined) {
      // Orca Whirlpool: virtualSolReserves contains pre-calculated SOL price per token
      // (calculated in parseOrcaWhirlpool from sqrtPrice to avoid bigint precision loss)
      price = enriched.virtualSolReserves;

      // Sanity check: price should be small for typical memecoins
      if (price <= 0 || price > 0.1) {
        // Fallback to liquiditySol-based estimate if price is unreasonable
        price = enriched.liquiditySol ? enriched.liquiditySol / 1e10 : 0;
      }
    } else if (tracked.dex === 'RAYDIUM_CPMM' && enriched.virtualSolReserves !== undefined && enriched.virtualSolReserves > 0) {
      // Raydium CPMM: virtualSolReserves contains pre-calculated SOL price per token
      price = enriched.virtualSolReserves;

      // Sanity check: price should be small for typical memecoins
      if (price > 0.1) {
        // Fallback to liquiditySol-based estimate if price is unreasonable
        price = enriched.liquiditySol ? enriched.liquiditySol / 1e10 : 0;
      }
    } else if (enriched.token0Amount && enriched.token1Amount) {
      // Other AMM pools: use ratio as price estimate
      const token0 = enriched.token0Amount;
      const token1 = enriched.token1Amount;

      if (token0 > 0 && token1 > 0) {
        // Use ratio as rough price proxy
        price = token1 / token0;
      }
    } else if (enriched.liquiditySol && enriched.liquiditySol > 0) {
      // Fallback - use liquidity as rough price proxy
      price = enriched.liquiditySol / 1e10;
    }

    // Debug: log calculated price
    if (this.positionPools.size > 0 && this.positionPools.size <= 5) {
      console.log(`[PoolMonitor] Price calc for ${tracked.tokenAddress.slice(0, 8)}...: ${price.toExponential(2)} (${tracked.dex})`);
    }

    // Check if price changed significantly
    if (tracked.lastPrice > 0) {
      const change = Math.abs(price - tracked.lastPrice) / tracked.lastPrice;
      if (change < PoolMonitor.PRICE_CHANGE_THRESHOLD) {
        return; // Price hasn't changed enough to notify
      }
      console.log(`[PoolMonitor] Price change: ${tracked.tokenAddress.slice(0, 8)}... ${(change * 100).toFixed(2)}% (threshold: ${PoolMonitor.PRICE_CHANGE_THRESHOLD * 100}%)`);
    }

    // Update last price
    tracked.lastPrice = price;

    // Emit price update if callback configured
    if (this.config.onPriceUpdate && price > 0) {
      const event: PriceUpdateEvent = {
        poolAddress,
        tokenAddress: tracked.tokenAddress,
        price,
        liquiditySol: enriched.liquiditySol || 0,
        timestamp: Date.now(),
      };

      try {
        const result = this.config.onPriceUpdate(event);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error('[PoolMonitor] Price update callback error:', err);
          });
        }
      } catch (err) {
        console.error('[PoolMonitor] Price update callback error:', err);
      }
    }
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
    metadataCached: number;
    metadataPending: number;
    metadataHitRate: string;
    token2022Notifications: number;
    metaplexNotifications: number;
    positionsTracked: number;
  } {
    const total = this.metadataHits + this.metadataMisses;
    const hitRate = total > 0 ? ((this.metadataHits / total) * 100).toFixed(1) : '0.0';
    return {
      running: this.running,
      connected: this.stream !== null,
      seenPools: this.seenAccounts.size,
      notifications: this.notificationCount,
      parsed: this.parsedCount,
      pumpFunTracked: this.pumpFunTokens.size,
      graduations: this.graduationCount,
      metadataCached: this.metadataCache.size,
      metadataPending: this.pendingMetadata.size,
      metadataHitRate: `${hitRate}%`,
      token2022Notifications: this.token2022Notifications,
      metaplexNotifications: this.metadataNotifications,
      positionsTracked: this.positionPools.size,
    };
  }

  cleanupOldTokens(): void {
    const cutoff = Date.now() - PoolMonitor.PUMP_FUN_CLEANUP_AGE_MS;
    let removed = 0;
    for (const [mint, timestamp] of this.pumpFunTokens) {
      if (timestamp < cutoff) {
        this.pumpFunTokens.delete(mint);
        removed++;
      }
    }

    // Also trim seenAccounts if large
    const seenBefore = this.seenAccounts.size;
    if (this.seenAccounts.size > PoolMonitor.MAX_SEEN_ACCOUNTS / 2) {
      const toRemove = Math.floor(this.seenAccounts.size / 2);
      let count = 0;
      for (const key of this.seenAccounts) {
        if (count++ >= toRemove) break;
        this.seenAccounts.delete(key);
      }
    }

    console.log(`[PoolMonitor] Cleanup: pump.fun -${removed} (${this.pumpFunTokens.size} remaining), seen -${seenBefore - this.seenAccounts.size} (${this.seenAccounts.size} remaining)`);
  }
}
