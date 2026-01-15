/**
 * Pump.fun API Service
 * Fetches accurate data for pump.fun tokens (bonding curve mechanism)
 */

const PUMPFUN_API = 'https://frontend-api.pump.fun';

export interface PumpFunTokenData {
  tokenAddress: string;
  name: string;
  symbol: string;
  description?: string;
  imageUri?: string;

  // Creator info
  creator: string;
  createdTimestamp: number;
  ageInDays: number;

  // Bonding curve data
  bondingCurveAddress: string;
  virtualSolReserves: number;
  virtualTokenReserves: number;
  realSolReserves: number;
  realTokenReserves: number;

  // Market data
  marketCapSol: number;
  pricePerToken: number;

  // Status
  complete: boolean; // Has graduated to Raydium
  raydiumPool?: string;

  // Social
  twitter?: string;
  telegram?: string;
  website?: string;

  // Trading activity
  replyCount: number;
  lastReply?: number;
}

export async function fetchPumpFunData(tokenAddress: string): Promise<PumpFunTokenData | null> {
  // Retry up to 3 times with exponential backoff to handle Cloudflare blocking (error 1016)
  const maxRetries = 3;
  const delays = [0, 500, 1500]; // No delay, 500ms, 1500ms

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add delay between retries (exponential backoff)
      if (delays[attempt] > 0) {
        console.log(`[PumpFun] Waiting ${delays[attempt]}ms before retry ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      }

      console.log(`[PumpFun] Attempt ${attempt + 1}/${maxRetries} for ${tokenAddress.slice(0, 8)}...`);

      // Fetch coin data with browser-like headers to avoid Cloudflare blocking
      const response = await fetch(`${PUMPFUN_API}/coins/${tokenAddress}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://pump.fun/',
          'Origin': 'https://pump.fun',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log('[PumpFun] Token not found on Pump.fun');
          return null;
        }
        // Log the error details
        const errorText = await response.text().catch(() => 'unknown');
        const isCloudflareBlock = errorText.includes('1016') || errorText.includes('Cloudflare');
        console.warn(`[PumpFun] API error: ${response.status} - ${errorText.slice(0, 100)}`);

        // If Cloudflare is blocking, retry
        if (isCloudflareBlock && attempt < maxRetries - 1) {
          console.log(`[PumpFun] Cloudflare blocking detected, will retry...`);
          continue;
        }
        return null;
      }

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        console.warn('[PumpFun] API returned non-JSON response');
        continue; // Retry
      }

      const data = await response.json() as {
        mint: string;
        name: string;
        symbol: string;
        description?: string;
        image_uri?: string;
        creator: string;
        created_timestamp: number;
        bonding_curve: string;
        virtual_sol_reserves: number;
        virtual_token_reserves: number;
        real_sol_reserves: number;
        real_token_reserves: number;
        market_cap: number;
        complete: boolean;
        raydium_pool?: string;
        twitter?: string;
        telegram?: string;
        website?: string;
        reply_count: number;
        last_reply?: number;
      };

      const createdAt = data.created_timestamp || 0;
      const ageInMs = Date.now() - createdAt;
      const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));

      // Calculate price from bonding curve
      // Price = virtual_sol_reserves / virtual_token_reserves
      const pricePerToken = data.virtual_token_reserves > 0
        ? data.virtual_sol_reserves / data.virtual_token_reserves
        : 0;

      return {
        tokenAddress: data.mint,
        name: data.name,
        symbol: data.symbol,
        description: data.description,
        imageUri: data.image_uri,

        creator: data.creator,
        createdTimestamp: createdAt,
        ageInDays,

        bondingCurveAddress: data.bonding_curve,
        virtualSolReserves: data.virtual_sol_reserves / 1e9, // Convert lamports to SOL
        virtualTokenReserves: data.virtual_token_reserves / 1e6, // Adjust decimals
        realSolReserves: data.real_sol_reserves / 1e9,
        realTokenReserves: data.real_token_reserves / 1e6,

        marketCapSol: data.market_cap / 1e9, // Convert to SOL
        pricePerToken,

        complete: data.complete,
        raydiumPool: data.raydium_pool,

        twitter: data.twitter,
        telegram: data.telegram,
        website: data.website,

        replyCount: data.reply_count || 0,
        lastReply: data.last_reply,
      };
    } catch (error) {
      console.error(`[PumpFun] Attempt ${attempt + 1} error:`, error);
      // Continue to next retry if not the last attempt
      if (attempt < maxRetries - 1) {
        continue;
      }
    }
  }

  // All retries failed
  console.warn('[PumpFun] All retry attempts failed');
  return null;
}

/**
 * Build context string for AI analysis from Pump.fun data
 */
export function buildPumpFunContext(data: PumpFunTokenData, solPriceUsd: number): string {
  let context = `\nPUMP.FUN TOKEN DATA:\n`;

  context += `- Name: ${data.name}\n`;
  context += `- Symbol: ${data.symbol}\n`;
  if (data.description) {
    context += `- Description: ${data.description.slice(0, 200)}${data.description.length > 200 ? '...' : ''}\n`;
  }

  // Creator
  context += `\nCREATOR INFO:\n`;
  context += `- Creator Wallet: ${data.creator}\n`;
  context += `- Created: ${data.ageInDays} days ago\n`;

  // Bonding curve liquidity (THIS IS THE REAL LIQUIDITY FOR PUMP.FUN)
  const liquiditySol = data.realSolReserves;
  const liquidityUsd = liquiditySol * solPriceUsd;
  const virtualLiquidityUsd = data.virtualSolReserves * solPriceUsd;

  context += `\nBONDING CURVE LIQUIDITY:\n`;
  context += `- Real SOL Reserves: ${liquiditySol.toFixed(2)} SOL ($${formatNumber(liquidityUsd)})\n`;
  context += `- Virtual SOL Reserves: ${data.virtualSolReserves.toFixed(2)} SOL ($${formatNumber(virtualLiquidityUsd)})\n`;
  context += `- This is NOT a traditional LP - pump.fun uses a bonding curve mechanism\n`;

  if (liquiditySol > 100) {
    context += `  ✓ Strong bonding curve reserves (>100 SOL)\n`;
  } else if (liquiditySol > 10) {
    context += `  - Moderate bonding curve reserves\n`;
  } else {
    context += `  ⚠️ Low bonding curve reserves (<10 SOL)\n`;
  }

  // Market cap
  const marketCapUsd = data.marketCapSol * solPriceUsd;
  context += `\nMARKET DATA:\n`;
  context += `- Market Cap: ${data.marketCapSol.toFixed(2)} SOL ($${formatNumber(marketCapUsd)})\n`;

  if (marketCapUsd >= 100_000_000) {
    context += `  ⚠️ LARGE CAP TOKEN (>$100M) - Established on pump.fun\n`;
  } else if (marketCapUsd >= 10_000_000) {
    context += `  ⚠️ MID CAP TOKEN ($10M-$100M)\n`;
  } else if (marketCapUsd >= 1_000_000) {
    context += `  - Small cap token ($1M-$10M)\n`;
  } else {
    context += `  - Micro cap token (<$1M)\n`;
  }

  // Status
  context += `\nSTATUS:\n`;
  if (data.complete) {
    context += `- ✓ GRADUATED to Raydium - has traditional LP now\n`;
    if (data.raydiumPool) {
      context += `- Raydium Pool: ${data.raydiumPool}\n`;
    }
  } else {
    context += `- Still on bonding curve (not yet graduated to Raydium)\n`;
  }

  // Age assessment
  context += `\nAGE ASSESSMENT:\n`;
  if (data.ageInDays < 1) {
    context += `- ⚠️ VERY NEW TOKEN (<1 day old) - Higher risk\n`;
  } else if (data.ageInDays < 7) {
    context += `- New token (${data.ageInDays} days old)\n`;
  } else if (data.ageInDays >= 30) {
    context += `- ✓ Established token (${data.ageInDays} days old)\n`;
  } else {
    context += `- Token age: ${data.ageInDays} days\n`;
  }

  // Social
  context += `\nSOCIAL:\n`;
  if (data.twitter) context += `- Twitter: ${data.twitter}\n`;
  if (data.telegram) context += `- Telegram: ${data.telegram}\n`;
  if (data.website) context += `- Website: ${data.website}\n`;
  context += `- Community Replies: ${data.replyCount}\n`;

  if (!data.twitter && !data.telegram && !data.website) {
    context += `- ⚠️ No social links provided\n`;
  }

  return context;
}

/**
 * Check if a token address is a pump.fun token
 */
export function isPumpFunToken(tokenAddress: string): boolean {
  return tokenAddress.endsWith('pump');
}

/**
 * Pump.fun program ID
 */
export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2)}B`;
  } else if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(2)}K`;
  }
  return num.toFixed(2);
}
