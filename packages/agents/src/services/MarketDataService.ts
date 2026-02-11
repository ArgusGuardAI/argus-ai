/**
 * MarketDataService - Pure On-Chain Market Data
 *
 * Replaces DexScreener API with direct on-chain pool reads.
 * Uses your own RPC node — zero external dependencies.
 *
 * Strategy:
 * - SOL price: Read Raydium SOL/USDC pool reserves
 * - Token price: Read pool reserves and calculate
 * - Liquidity: 2x quote side of pool
 * - Market cap: price × supply
 * - LP lock: Check LP token holder distribution
 *
 * Cost: ~5-10 RPC calls per token (vs 0 RPC for DexScreener)
 * Benefit: No external API dependency, works with your own node
 */

// Well-known addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Raydium SOL/USDC pool (most liquid - use for SOL price)
const SOL_USDC_POOL = {
  address: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
  solVault: 'DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz',
  usdcVault: 'HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz',
};

// DEX program IDs
const PROGRAMS = {
  RAYDIUM_AMM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  PUMPFUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMPSWAP: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
};

// Known LP lock programs
const LP_LOCK_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  '11111111111111111111111111111111111111111',
  'LockuPTQVAiRdxjq7Kw9Dq1iZcRvBKC2gRaB8bKbPH3',
]);

export interface MarketData {
  price: number | null;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  buys24h: number;
  sells24h: number;
  pairAddress: string | null;
  dexId: string | null;
}

export interface PoolData {
  address: string;
  dex: string;
  tokenMint: string;
  quoteMint: string;
  tokenReserve: number;
  quoteReserve: number;
  lpMint?: string;
  lpLocked: boolean;
  lpLockedPct: number;
}

export interface LpLockInfo {
  locked: boolean;
  lockedPct: number;
  burnedPct: number;
}

interface RpcResponse<T> {
  jsonrpc: string;
  result?: T;
  error?: { code: number; message: string };
}

export class MarketDataService {
  private rpcEndpoint: string;
  private solPrice: number = 200;
  private solPriceLastUpdate: number = 0;

  constructor(rpcEndpoint: string) {
    this.rpcEndpoint = rpcEndpoint;
  }

  /**
   * Get complete market data for a token
   */
  async getMarketData(tokenMint: string, supply: number): Promise<MarketData> {
    try {
      // 1. Update SOL price (cached for 60s)
      await this.updateSolPrice();

      // 2. Find the token's liquidity pool
      const pool = await this.findBestPool(tokenMint);

      if (!pool || pool.tokenReserve <= 0) {
        return this.emptyMarketData();
      }

      // 3. Calculate price from pool reserves
      const priceInQuote = pool.quoteReserve / pool.tokenReserve;
      const priceUsd = this.isStablecoin(pool.quoteMint)
        ? priceInQuote
        : priceInQuote * this.solPrice;

      // 4. Calculate liquidity (2x quote side for standard AMM)
      const liquidityUsd = this.isStablecoin(pool.quoteMint)
        ? pool.quoteReserve * 2
        : pool.quoteReserve * this.solPrice * 2;

      // 5. Calculate market cap
      const marketCap = priceUsd * supply;

      // 6. Estimate trading activity (simple tx count)
      const { buys, sells } = await this.estimateTradingActivity(tokenMint);

      return {
        price: priceUsd,
        marketCap,
        liquidity: liquidityUsd,
        volume24h: null, // Would need historical tracking
        priceChange24h: null, // Would need historical tracking
        buys24h: buys,
        sells24h: sells,
        pairAddress: pool.address,
        dexId: pool.dex,
      };
    } catch (err) {
      console.warn(`[MarketDataService] Error fetching market data:`, err instanceof Error ? err.message : err);
      return this.emptyMarketData();
    }
  }

  /**
   * Get LP lock information for a pool
   */
  async getLpLockInfo(lpMint: string): Promise<LpLockInfo> {
    if (!lpMint) {
      return { locked: false, lockedPct: 0, burnedPct: 0 };
    }

    try {
      // Get largest LP token holders
      const largestAccounts = await this.rpcCall<{
        value: Array<{ address: string; amount: string; uiAmount: number }>;
      }>('getTokenLargestAccounts', [lpMint]);

      if (!largestAccounts.value?.length) {
        return { locked: false, lockedPct: 0, burnedPct: 0 };
      }

      // Get total supply
      const supplyData = await this.rpcCall<{ value: { uiAmount: number } }>(
        'getTokenSupply',
        [lpMint]
      );
      const totalSupply = supplyData.value?.uiAmount || 0;

      if (totalSupply <= 0) {
        return { locked: false, lockedPct: 0, burnedPct: 0 };
      }

      // Get owner info for top holders
      const addresses = largestAccounts.value.slice(0, 10).map(a => a.address);
      const accountInfos = await this.rpcCall<{
        value: Array<{ data: { parsed?: { info?: { owner?: string } } } } | null>;
      }>('getMultipleAccounts', [addresses, { encoding: 'jsonParsed' }]);

      let lockedAmount = 0;
      let burnedAmount = 0;

      for (let i = 0; i < accountInfos.value.length; i++) {
        const info = accountInfos.value[i];
        const holder = largestAccounts.value[i];
        if (!info || !holder) continue;

        const owner = info.data?.parsed?.info?.owner;
        if (!owner) continue;

        // Check if owner is lock program or burn address
        if (LP_LOCK_PROGRAMS.has(owner)) {
          lockedAmount += holder.uiAmount;
        }

        // Check for burn patterns
        if (owner.startsWith('1111111111') || owner.includes('dead') || owner.includes('burn')) {
          burnedAmount += holder.uiAmount;
        }
      }

      const lockedPct = (lockedAmount / totalSupply) * 100;
      const burnedPct = (burnedAmount / totalSupply) * 100;

      return {
        locked: lockedPct + burnedPct > 50,
        lockedPct: Math.round(lockedPct * 10) / 10,
        burnedPct: Math.round(burnedPct * 10) / 10,
      };
    } catch (err) {
      console.warn(`[MarketDataService] LP lock check failed:`, err instanceof Error ? err.message : err);
      return { locked: false, lockedPct: 0, burnedPct: 0 };
    }
  }

  /**
   * Update SOL price from on-chain Raydium pool
   */
  private async updateSolPrice(): Promise<void> {
    // Cache for 60 seconds
    if (Date.now() - this.solPriceLastUpdate < 60_000) return;

    try {
      const [solBalRes, usdcBalRes] = await Promise.all([
        this.rpcCall<{ value: { uiAmount: number } }>('getTokenAccountBalance', [SOL_USDC_POOL.solVault]),
        this.rpcCall<{ value: { uiAmount: number } }>('getTokenAccountBalance', [SOL_USDC_POOL.usdcVault]),
      ]);

      const solAmount = solBalRes.value?.uiAmount || 0;
      const usdcAmount = usdcBalRes.value?.uiAmount || 0;

      if (solAmount > 0 && usdcAmount > 0) {
        const price = usdcAmount / solAmount;
        // Sanity check
        if (price >= 10 && price <= 1000) {
          this.solPrice = price;
          this.solPriceLastUpdate = Date.now();
        }
      }
    } catch (err) {
      console.warn(`[MarketDataService] SOL price fetch failed:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Find the best liquidity pool for a token
   * Tries pump.fun first (cheap), then Raydium
   */
  private async findBestPool(tokenMint: string): Promise<PoolData | null> {
    // Try Pump.fun first (single account lookup via PDA)
    if (this.isPumpfunToken(tokenMint)) {
      const pumpPool = await this.findPumpfunPool(tokenMint);
      if (pumpPool) return pumpPool;
    }

    // Try Raydium (requires getProgramAccounts - expensive but comprehensive)
    // For agents running continuously, we could cache this
    const raydiumPool = await this.findRaydiumPool(tokenMint);
    if (raydiumPool) return raydiumPool;

    return null;
  }

  /**
   * Check if token is from pump.fun (mint ends with 'pump')
   */
  private isPumpfunToken(mint: string): boolean {
    return mint.endsWith('pump');
  }

  /**
   * Find pump.fun bonding curve pool
   * Much cheaper than getProgramAccounts - just reads the bonding curve account
   */
  private async findPumpfunPool(tokenMint: string): Promise<PoolData | null> {
    try {
      // Derive bonding curve PDA
      // Seeds: ["bonding-curve", mint]
      const bondingCurve = await this.derivePumpfunBondingCurve(tokenMint);
      if (!bondingCurve) return null;

      // Get bonding curve account data
      const accountInfo = await this.rpcCall<{
        value: { data: [string, string]; lamports: number } | null;
      }>('getAccountInfo', [bondingCurve, { encoding: 'base64' }]);

      if (!accountInfo.value) return null;

      // Get token reserve from bonding curve's token account
      const tokenAccounts = await this.rpcCall<{
        value: Array<{ pubkey: string; account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }>;
      }>('getTokenAccountsByOwner', [
        bondingCurve,
        { mint: tokenMint },
        { encoding: 'jsonParsed' },
      ]);

      const tokenReserve = tokenAccounts.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;

      // SOL reserve is the lamports on the bonding curve
      const solReserve = accountInfo.value.lamports / 1e9;

      return {
        address: bondingCurve,
        dex: 'pumpfun',
        tokenMint,
        quoteMint: SOL_MINT,
        tokenReserve,
        quoteReserve: solReserve,
        lpLocked: true, // Pump.fun bonding curves are inherently "locked"
        lpLockedPct: 100,
      };
    } catch (err) {
      console.warn(`[MarketDataService] Pump.fun pool lookup failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Derive pump.fun bonding curve PDA
   */
  private async derivePumpfunBondingCurve(tokenMint: string): Promise<string | null> {
    // Pump.fun bonding curve PDA: seeds = ["bonding-curve", mint]
    // We need to derive this on-chain since we don't have @solana/web3.js
    // Simplified approach: try known bonding curve patterns

    try {
      // Check if token accounts exist under pump.fun program
      const tokenAccounts = await this.rpcCall<{
        value: Array<{ pubkey: string }>;
      }>('getTokenAccountsByOwner', [
        PROGRAMS.PUMPFUN,
        { mint: tokenMint },
        { encoding: 'jsonParsed' },
      ]);

      if (tokenAccounts.value?.length > 0) {
        // The bonding curve is the owner of the token account
        return PROGRAMS.PUMPFUN;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find Raydium AMM V4 pool
   * Note: Uses getProgramAccounts which is expensive
   * Consider caching results for frequently queried tokens
   */
  private async findRaydiumPool(tokenMint: string): Promise<PoolData | null> {
    try {
      // Search for pools where token is the coin mint (offset 304)
      const poolAccounts = await this.rpcCall<{
        value: Array<{ pubkey: string; account: { data: [string, string] } }>;
      }>('getProgramAccounts', [
        PROGRAMS.RAYDIUM_AMM_V4,
        {
          encoding: 'base64',
          filters: [
            { dataSize: 752 },
            { memcmp: { offset: 304, bytes: tokenMint } },
          ],
        },
      ]);

      if (!poolAccounts.value?.length) {
        // Also try where token is the pc mint (offset 336)
        const pcPoolAccounts = await this.rpcCall<{
          value: Array<{ pubkey: string; account: { data: [string, string] } }>;
        }>('getProgramAccounts', [
          PROGRAMS.RAYDIUM_AMM_V4,
          {
            encoding: 'base64',
            filters: [
              { dataSize: 752 },
              { memcmp: { offset: 336, bytes: tokenMint } },
            ],
          },
        ]);

        if (!pcPoolAccounts.value?.length) return null;

        return this.parseRaydiumPool(pcPoolAccounts.value[0], tokenMint, true);
      }

      return this.parseRaydiumPool(poolAccounts.value[0], tokenMint, false);
    } catch (err) {
      console.warn(`[MarketDataService] Raydium pool lookup failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Parse Raydium AMM V4 pool account data
   */
  private async parseRaydiumPool(
    poolAccount: { pubkey: string; account: { data: [string, string] } },
    tokenMint: string,
    isQuote: boolean
  ): Promise<PoolData | null> {
    try {
      const buffer = Buffer.from(poolAccount.account.data[0], 'base64');

      // Read addresses from fixed offsets
      const lpMint = this.readPubkey(buffer, 272);
      const coinMint = this.readPubkey(buffer, 304);
      const pcMint = this.readPubkey(buffer, 336);
      const coinVault = this.readPubkey(buffer, 368);
      const pcVault = this.readPubkey(buffer, 400);

      // Get vault balances
      const [coinBal, pcBal] = await Promise.all([
        this.rpcCall<{ value: { uiAmount: number } }>('getTokenAccountBalance', [coinVault]),
        this.rpcCall<{ value: { uiAmount: number } }>('getTokenAccountBalance', [pcVault]),
      ]);

      const coinReserve = coinBal.value?.uiAmount || 0;
      const pcReserve = pcBal.value?.uiAmount || 0;

      // Determine which is token and which is quote
      const tokenReserve = isQuote ? pcReserve : coinReserve;
      const quoteReserve = isQuote ? coinReserve : pcReserve;
      const quoteMint = isQuote ? coinMint : pcMint;

      // Get LP lock info
      const lpLockInfo = await this.getLpLockInfo(lpMint);

      return {
        address: poolAccount.pubkey,
        dex: 'raydium',
        tokenMint,
        quoteMint,
        tokenReserve,
        quoteReserve,
        lpMint,
        lpLocked: lpLockInfo.locked,
        lpLockedPct: lpLockInfo.lockedPct,
      };
    } catch (err) {
      console.warn(`[MarketDataService] Raydium pool parse failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Estimate trading activity from recent transactions
   * Simple heuristic: count signatures in last few minutes
   */
  private async estimateTradingActivity(tokenMint: string): Promise<{ buys: number; sells: number }> {
    try {
      const sigs = await this.rpcCall<{
        result: Array<{ signature: string }>;
      }>('getSignaturesForAddress', [tokenMint, { limit: 100 }]);

      // Simple estimate: half buys, half sells
      const total = sigs.result?.length || 0;
      return {
        buys: Math.floor(total / 2),
        sells: Math.ceil(total / 2),
      };
    } catch {
      return { buys: 0, sells: 0 };
    }
  }

  /**
   * Check if mint is a stablecoin
   */
  private isStablecoin(mint: string): boolean {
    return mint === USDC_MINT || mint === USDT_MINT;
  }

  /**
   * Return empty market data structure
   */
  private emptyMarketData(): MarketData {
    return {
      price: null,
      marketCap: null,
      liquidity: null,
      volume24h: null,
      priceChange24h: null,
      buys24h: 0,
      sells24h: 0,
      pairAddress: null,
      dexId: null,
    };
  }

  /**
   * Make an RPC call
   */
  private async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`RPC error: ${response.status}`);
    }

    const data = await response.json() as RpcResponse<T>;

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    return data.result as T;
  }

  /**
   * Read a 32-byte public key from buffer at offset
   */
  private readPubkey(buffer: Buffer, offset: number): string {
    const bytes = buffer.slice(offset, offset + 32);
    return this.encodeBase58(bytes);
  }

  /**
   * Base58 encode bytes
   */
  private encodeBase58(bytes: Buffer): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    if (bytes.length === 0) return '';

    let num = BigInt('0x' + bytes.toString('hex'));
    let result = '';

    while (num > 0n) {
      const mod = Number(num % 58n);
      result = ALPHABET[mod] + result;
      num = num / 58n;
    }

    for (const byte of bytes) {
      if (byte === 0) {
        result = '1' + result;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Get current SOL price (for external use)
   */
  getSolPrice(): number {
    return this.solPrice;
  }
}
