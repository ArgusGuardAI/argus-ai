/**
 * Pumpfun Token Parser
 *
 * Pumpfun tokens don't use standard Metaplex metadata.
 * They store metadata in the bonding curve account and use
 * a different program structure.
 *
 * Program ID: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
 */

import { SolanaRpcClient, PROGRAMS, TOKENS } from './solana-rpc';

// Pumpfun API for metadata (they have a public API)
const PUMPFUN_API = 'https://frontend-api.pump.fun';

export interface PumpfunTokenInfo {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  creator: string;
  createdAt?: number;
  bondingCurve: string;
  associatedBondingCurve: string;
  virtualSolReserves: number;
  virtualTokenReserves: number;
  realSolReserves: number;
  realTokenReserves: number;
  totalSupply: number;
  complete: boolean; // Has graduated to Raydium
  marketCap?: number;
  price?: number;
}

/**
 * Check if a token is a Pumpfun token
 */
export function isPumpfunToken(mint: string): boolean {
  return mint.endsWith('pump');
}

/**
 * Fetch Pumpfun token metadata from their API
 * Falls back to DexScreener if Pumpfun API fails
 */
export async function fetchPumpfunMetadata(mint: string): Promise<PumpfunTokenInfo | null> {
  if (!isPumpfunToken(mint)) return null;

  // Try Pumpfun API first
  try {
    const response = await fetch(`${PUMPFUN_API}/coins/${mint}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ArgusBot/1.0)',
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json() as {
        mint: string;
        name: string;
        symbol: string;
        description?: string;
        image_uri?: string;
        creator: string;
        created_timestamp?: number;
        bonding_curve: string;
        associated_bonding_curve: string;
        virtual_sol_reserves: number;
        virtual_token_reserves: number;
        real_sol_reserves: number;
        real_token_reserves: number;
        total_supply: number;
        complete: boolean;
        market_cap?: number;
        usd_market_cap?: number;
      };

      const price = data.virtual_sol_reserves > 0 && data.virtual_token_reserves > 0
        ? (data.virtual_sol_reserves / 1e9) / (data.virtual_token_reserves / 1e6)
        : undefined;

      return {
        mint: data.mint,
        name: data.name,
        symbol: data.symbol,
        description: data.description,
        image: data.image_uri,
        creator: data.creator,
        createdAt: data.created_timestamp,
        bondingCurve: data.bonding_curve,
        associatedBondingCurve: data.associated_bonding_curve,
        virtualSolReserves: data.virtual_sol_reserves / 1e9,
        virtualTokenReserves: data.virtual_token_reserves / 1e6,
        realSolReserves: data.real_sol_reserves / 1e9,
        realTokenReserves: data.real_token_reserves / 1e6,
        totalSupply: data.total_supply / 1e6,
        complete: data.complete,
        marketCap: data.usd_market_cap || data.market_cap,
        price,
      };
    }
  } catch (err) {
    console.warn('[Pumpfun] API failed, trying DexScreener fallback:', err);
  }

  // Fallback to DexScreener
  try {
    const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);

    if (dexResponse.ok) {
      const dexData = await dexResponse.json() as {
        pairs?: Array<{
          baseToken: { name: string; symbol: string };
          priceUsd?: string;
          liquidity?: { usd: number };
          marketCap?: number;
          pairCreatedAt?: number;
          dexId?: string;
        }>;
      };

      const pair = dexData.pairs?.[0];
      if (pair) {
        console.log('[Pumpfun] Using DexScreener fallback');
        return {
          mint,
          name: pair.baseToken.name,
          symbol: pair.baseToken.symbol,
          creator: '', // Not available from DexScreener
          bondingCurve: '',
          associatedBondingCurve: '',
          virtualSolReserves: 0,
          virtualTokenReserves: 0,
          realSolReserves: (pair.liquidity?.usd || 0) / 200 / 2, // Rough estimate
          realTokenReserves: 0,
          totalSupply: 1000000000, // Default for pumpfun
          complete: pair.dexId !== 'pumpfun', // If on another DEX, graduated
          marketCap: pair.marketCap,
          price: pair.priceUsd ? parseFloat(pair.priceUsd) / 200 : undefined, // Price in SOL
          createdAt: pair.pairCreatedAt,
        };
      }
    }
  } catch (err) {
    console.warn('[Pumpfun] DexScreener fallback also failed:', err);
  }

  return null;
}

/**
 * Get Pumpfun bonding curve data from on-chain
 */
export async function getPumpfunBondingCurve(
  rpc: SolanaRpcClient,
  mint: string
): Promise<{
  bondingCurve: string;
  solReserve: number;
  tokenReserve: number;
  complete: boolean;
} | null> {
  if (!isPumpfunToken(mint)) return null;

  try {
    // Find bonding curve account by searching program accounts
    const accounts = await rpc.getProgramAccounts(PROGRAMS.PUMPFUN, [
      {
        memcmp: {
          offset: 8, // After discriminator
          bytes: mint,
        },
      },
    ]);

    if (accounts.length === 0) {
      console.log('[Pumpfun] No bonding curve found');
      return null;
    }

    const bondingCurveAddress = accounts[0].pubkey;

    // Get the bonding curve's SOL balance
    const solBalance = await rpc.getBalance(bondingCurveAddress);

    // Get the bonding curve's token balance
    const tokenAccounts = await rpc.getTokenAccountsByOwner(bondingCurveAddress, mint);
    const tokenBalance = tokenAccounts.value.length > 0
      ? tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount
      : 0;

    // Check if complete (graduated to Raydium)
    const complete = solBalance < 0.1 && tokenBalance < 1000;

    return {
      bondingCurve: bondingCurveAddress,
      solReserve: solBalance,
      tokenReserve: tokenBalance,
      complete,
    };
  } catch (err) {
    console.warn('[Pumpfun] Failed to get bonding curve:', err);
    return null;
  }
}

/**
 * Calculate Pumpfun price from bonding curve
 */
export function calculatePumpfunPrice(
  virtualSolReserves: number,
  virtualTokenReserves: number,
  solPrice: number
): number {
  if (virtualTokenReserves <= 0) return 0;
  const priceInSol = virtualSolReserves / virtualTokenReserves;
  return priceInSol * solPrice;
}

/**
 * Calculate Pumpfun liquidity
 */
export function calculatePumpfunLiquidity(
  realSolReserves: number,
  solPrice: number
): number {
  return realSolReserves * solPrice * 2;
}

/**
 * Get Pumpfun pool info in standard format
 */
export async function getPumpfunPoolInfo(
  rpc: SolanaRpcClient,
  mint: string,
  solPrice: number
): Promise<{
  address: string;
  dex: 'pumpfun';
  tokenMint: string;
  quoteMint: string;
  tokenReserve: number;
  quoteReserve: number;
  lpLocked: boolean;
  lpLockedPct: number;
  price: number;
  liquidity: number;
  marketCap: number;
} | null> {
  // Try API first (faster and more accurate)
  const apiData = await fetchPumpfunMetadata(mint);

  if (apiData) {
    const price = apiData.price
      ? apiData.price * solPrice
      : calculatePumpfunPrice(apiData.virtualSolReserves, apiData.virtualTokenReserves, solPrice);

    const liquidity = calculatePumpfunLiquidity(apiData.realSolReserves, solPrice);
    const marketCap = apiData.marketCap || (price * apiData.totalSupply);

    return {
      address: apiData.bondingCurve,
      dex: 'pumpfun',
      tokenMint: mint,
      quoteMint: TOKENS.SOL,
      tokenReserve: apiData.virtualTokenReserves,
      quoteReserve: apiData.virtualSolReserves,
      lpLocked: true,
      lpLockedPct: 100,
      price,
      liquidity,
      marketCap,
    };
  }

  // Fallback to on-chain
  const onChainData = await getPumpfunBondingCurve(rpc, mint);

  if (onChainData) {
    const price = onChainData.tokenReserve > 0
      ? (onChainData.solReserve / onChainData.tokenReserve) * solPrice
      : 0;

    const liquidity = onChainData.solReserve * solPrice * 2;

    const supply = await rpc.getTokenSupply(mint);
    const marketCap = price * supply.value.uiAmount;

    return {
      address: onChainData.bondingCurve,
      dex: 'pumpfun',
      tokenMint: mint,
      quoteMint: TOKENS.SOL,
      tokenReserve: onChainData.tokenReserve,
      quoteReserve: onChainData.solReserve,
      lpLocked: true,
      lpLockedPct: 100,
      price,
      liquidity,
      marketCap,
    };
  }

  return null;
}
