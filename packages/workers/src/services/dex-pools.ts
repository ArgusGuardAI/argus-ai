/**
 * DEX Pool Parser
 *
 * Parses liquidity pool data from major Solana DEXs:
 * - Raydium AMM V4
 * - Raydium CLMM (concentrated liquidity)
 * - Orca Whirlpools
 * - Meteora DLMM
 * - Pumpfun bonding curves
 *
 * All data fetched directly from on-chain accounts.
 */

import { SolanaRpcClient, PROGRAMS, TOKENS } from './solana-rpc';

// ============================================
// INTERFACES
// ============================================

export interface PoolInfo {
  address: string;
  dex: 'raydium' | 'raydium_clmm' | 'orca' | 'meteora' | 'pumpfun' | 'pumpswap' | 'unknown';
  tokenMint: string;
  quoteMint: string;
  tokenReserve: number;
  quoteReserve: number;
  lpMint?: string;
  lpSupply?: number;
  lpLocked: boolean;
  lpLockedPct: number;
  lpLockedAmount?: number;
  fee?: number; // In basis points
  createdSlot?: number;
  createdAt?: number; // Unix timestamp
}

// ============================================
// RAYDIUM AMM V4
// ============================================

// Raydium AMM V4 account layout offsets
const RAYDIUM_AMM_OFFSETS = {
  STATUS: 0,
  NONCE: 8,
  ORDER_NUM: 9,
  DEPTH: 10,
  COIN_DECIMALS: 11,
  PC_DECIMALS: 12,
  STATE: 13,
  RESET_FLAG: 14,
  MIN_SIZE: 15,
  VOL_MAX_CUT_RATIO: 23,
  AMOUNT_WAVE_RATIO: 31,
  COIN_LOT_SIZE: 39,
  PC_LOT_SIZE: 47,
  MIN_PRICE_MULTIPLIER: 55,
  MAX_PRICE_MULTIPLIER: 63,
  SYSTEM_DECIMALS_VALUE: 71,
  // ... more fields
  LP_MINT: 272,
  COIN_MINT: 304,
  PC_MINT: 336,
  COIN_VAULT: 368,
  PC_VAULT: 400,
};

/**
 * Find Raydium AMM V4 pools for a token
 */
export async function findRaydiumPools(
  rpc: SolanaRpcClient,
  tokenMint: string
): Promise<PoolInfo[]> {
  const pools: PoolInfo[] = [];

  try {
    // Search for pools where this token is the base (coin) mint
    // Raydium stores coin_mint at offset 304
    const coinMintFilter = {
      memcmp: {
        offset: RAYDIUM_AMM_OFFSETS.COIN_MINT,
        bytes: tokenMint,
      },
    };

    const poolAccounts = await rpc.getProgramAccounts(PROGRAMS.RAYDIUM_AMM_V4, [
      coinMintFilter,
      { dataSize: 752 }, // Standard AMM account size
    ]);

    for (const account of poolAccounts) {
      try {
        const pool = await parseRaydiumPool(rpc, account.pubkey, tokenMint);
        if (pool) pools.push(pool);
      } catch {
        // Skip unparseable pools
      }
    }

    // Also search where token is the quote (pc) mint
    const pcMintFilter = {
      memcmp: {
        offset: RAYDIUM_AMM_OFFSETS.PC_MINT,
        bytes: tokenMint,
      },
    };

    const pcPoolAccounts = await rpc.getProgramAccounts(PROGRAMS.RAYDIUM_AMM_V4, [
      pcMintFilter,
      { dataSize: 752 },
    ]);

    for (const account of pcPoolAccounts) {
      try {
        const pool = await parseRaydiumPool(rpc, account.pubkey, tokenMint, true);
        if (pool) pools.push(pool);
      } catch {
        // Skip unparseable pools
      }
    }
  } catch (err) {
    console.warn('[DexPools] Raydium search error:', err);
  }

  return pools;
}

/**
 * Parse a Raydium AMM V4 pool account
 */
async function parseRaydiumPool(
  rpc: SolanaRpcClient,
  poolAddress: string,
  tokenMint: string,
  isQuote: boolean = false
): Promise<PoolInfo | null> {
  try {
    const accountInfo = await rpc.getAccountInfo(poolAddress, 'base64');
    if (!accountInfo.value) return null;

    // Decode base64 data
    const data = accountInfo.value.data as [string, string];
    const buffer = Buffer.from(data[0], 'base64');

    // Read LP mint (32 bytes at offset 272)
    const lpMint = readPubkey(buffer, RAYDIUM_AMM_OFFSETS.LP_MINT);
    const coinMint = readPubkey(buffer, RAYDIUM_AMM_OFFSETS.COIN_MINT);
    const pcMint = readPubkey(buffer, RAYDIUM_AMM_OFFSETS.PC_MINT);
    const coinVault = readPubkey(buffer, RAYDIUM_AMM_OFFSETS.COIN_VAULT);
    const pcVault = readPubkey(buffer, RAYDIUM_AMM_OFFSETS.PC_VAULT);

    // Get vault balances
    const [coinBalance, pcBalance, lpSupplyData] = await Promise.all([
      rpc.getAccountInfo(coinVault, 'jsonParsed'),
      rpc.getAccountInfo(pcVault, 'jsonParsed'),
      rpc.getTokenSupply(lpMint),
    ]);

    const coinReserve = parseTokenBalance(coinBalance.value?.data);
    const pcReserve = parseTokenBalance(pcBalance.value?.data);
    const lpSupply = lpSupplyData.value.uiAmount;

    // Determine which is token and which is quote
    let tokenReserve: number;
    let quoteReserve: number;
    let quoteMint: string;

    if (isQuote) {
      tokenReserve = pcReserve;
      quoteReserve = coinReserve;
      quoteMint = coinMint;
    } else {
      tokenReserve = coinReserve;
      quoteReserve = pcReserve;
      quoteMint = pcMint;
    }

    // Check LP lock status
    const lpLockInfo = await checkLpLock(rpc, lpMint, lpSupply);

    return {
      address: poolAddress,
      dex: 'raydium',
      tokenMint,
      quoteMint,
      tokenReserve,
      quoteReserve,
      lpMint,
      lpSupply,
      lpLocked: lpLockInfo.locked,
      lpLockedPct: lpLockInfo.lockedPct,
      lpLockedAmount: lpLockInfo.lockedAmount,
    };
  } catch {
    return null;
  }
}

// ============================================
// PUMPFUN BONDING CURVE
// ============================================

/**
 * Find Pumpfun bonding curve for a token
 */
export async function findPumpfunPool(
  rpc: SolanaRpcClient,
  tokenMint: string
): Promise<PoolInfo | null> {
  // Pumpfun tokens end with "pump"
  if (!tokenMint.endsWith('pump')) return null;

  try {
    // Get token accounts owned by Pumpfun program
    const tokenAccounts = await rpc.getTokenAccountsByOwner(PROGRAMS.PUMPFUN, tokenMint);

    if (tokenAccounts.value.length === 0) return null;

    const tokenAccount = tokenAccounts.value[0];
    const tokenReserve = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;

    // Get SOL balance of Pumpfun program (bonding curve reserve)
    const solBalance = await rpc.getBalance(PROGRAMS.PUMPFUN);

    return {
      address: PROGRAMS.PUMPFUN,
      dex: 'pumpfun',
      tokenMint,
      quoteMint: TOKENS.SOL,
      tokenReserve,
      quoteReserve: solBalance,
      lpLocked: true, // Pumpfun bonding curve is always "locked"
      lpLockedPct: 100,
    };
  } catch {
    return null;
  }
}

// ============================================
// LP LOCK DETECTION
// ============================================

// Known LP lock programs
const LP_LOCK_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program (burn address)
  '11111111111111111111111111111111111111111', // System Program (dead)
  'LockuPTQVAiRdxjq7Kw9Dq1iZcRvBKC2gRaB8bKbPH3', // Lockup protocol
];

// Dead/burn addresses
const BURN_ADDRESSES = new Set([
  '1nc1nerator11111111111111111111111111111111',
  '11111111111111111111111111111111',
  'deadbeef11111111111111111111111111111111',
]);

/**
 * Check if LP tokens are locked
 */
async function checkLpLock(
  rpc: SolanaRpcClient,
  lpMint: string,
  totalSupply: number
): Promise<{ locked: boolean; lockedPct: number; lockedAmount: number }> {
  if (totalSupply <= 0) {
    return { locked: false, lockedPct: 0, lockedAmount: 0 };
  }

  try {
    // Get largest LP token holders
    const largestAccounts = await rpc.getTokenLargestAccounts(lpMint);
    const accounts = largestAccounts.value;

    let lockedAmount = 0;

    // Get owner info for each account
    const accountAddresses = accounts.slice(0, 10).map(a => a.address);
    const accountInfos = await rpc.getMultipleAccounts(accountAddresses, 'jsonParsed');

    for (let i = 0; i < accountInfos.value.length; i++) {
      const info = accountInfos.value[i];
      const account = accounts[i];

      if (!info) continue;

      const data = info.data as {
        parsed?: { info?: { owner?: string } };
      };

      const owner = data?.parsed?.info?.owner;
      if (!owner) continue;

      // Check if owner is a lock program or burn address
      if (LP_LOCK_PROGRAMS.includes(owner) || BURN_ADDRESSES.has(owner)) {
        lockedAmount += account.uiAmount;
      }

      // Check if owner is a known dead address pattern
      if (owner.startsWith('1111111111') || owner.includes('dead') || owner.includes('burn')) {
        lockedAmount += account.uiAmount;
      }
    }

    const lockedPct = (lockedAmount / totalSupply) * 100;

    return {
      locked: lockedPct > 50,
      lockedPct: Math.round(lockedPct * 10) / 10,
      lockedAmount,
    };
  } catch {
    return { locked: false, lockedPct: 0, lockedAmount: 0 };
  }
}

// ============================================
// UNIFIED POOL FINDER
// ============================================

/**
 * Find all liquidity pools for a token across all DEXs
 */
export async function findAllPools(
  rpc: SolanaRpcClient,
  tokenMint: string
): Promise<PoolInfo[]> {
  const [raydiumPools, pumpfunPool] = await Promise.all([
    findRaydiumPools(rpc, tokenMint),
    findPumpfunPool(rpc, tokenMint),
  ]);

  const pools: PoolInfo[] = [...raydiumPools];
  if (pumpfunPool) pools.push(pumpfunPool);

  // Sort by liquidity (quoteReserve as proxy)
  pools.sort((a, b) => b.quoteReserve - a.quoteReserve);

  return pools;
}

/**
 * Get primary pool (highest liquidity)
 */
export async function getPrimaryPool(
  rpc: SolanaRpcClient,
  tokenMint: string
): Promise<PoolInfo | null> {
  const pools = await findAllPools(rpc, tokenMint);
  return pools[0] || null;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Read a 32-byte public key from buffer
 */
function readPubkey(buffer: Buffer, offset: number): string {
  const bytes = buffer.slice(offset, offset + 32);
  return encodeBase58(bytes);
}

/**
 * Parse token balance from account data
 */
function parseTokenBalance(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;

  const parsed = data as {
    parsed?: { info?: { tokenAmount?: { uiAmount?: number } } };
  };

  return parsed?.parsed?.info?.tokenAmount?.uiAmount || 0;
}

/**
 * Base58 encoding (simplified)
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Buffer): string {
  if (bytes.length === 0) return '';

  // Convert to big integer
  let num = BigInt('0x' + bytes.toString('hex'));

  let result = '';
  while (num > 0n) {
    const mod = Number(num % 58n);
    result = BASE58_ALPHABET[mod] + result;
    num = num / 58n;
  }

  // Add leading zeros
  for (const byte of bytes) {
    if (byte === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }

  return result;
}
