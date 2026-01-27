/**
 * DexScreener API Service
 * Fetches real market data: price, volume, liquidity, market cap
 */

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

export interface DexScreenerData {
  tokenAddress: string;
  pairAddress?: string;
  dex: string;

  // Price data
  priceUsd: number;
  priceChange24h: number;

  // Market data
  marketCap: number;
  fdv: number; // Fully diluted valuation

  // Liquidity
  liquidityUsd: number;

  // Volume
  volume24h: number;
  txns5m: {
    buys: number;
    sells: number;
  };
  txns1h: {
    buys: number;
    sells: number;
  };
  txns24h: {
    buys: number;
    sells: number;
  };

  // Token info
  name?: string;
  symbol?: string;

  // Age
  pairCreatedAt?: number;
  ageInDays: number;

  // Social
  websites?: string[];
  socials?: { type: string; url: string }[];
}

export async function fetchDexScreenerData(tokenAddress: string): Promise<DexScreenerData | null> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/tokens/${tokenAddress}`);

    if (!response.ok) {
      console.warn(`DexScreener API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      pairs?: Array<{
        chainId: string;
        dexId: string;
        pairAddress: string;
        baseToken: { address: string; name: string; symbol: string };
        quoteToken: { address: string; name: string; symbol: string };
        priceUsd: string;
        priceChange: { h24: number };
        liquidity: { usd: number };
        fdv: number;
        marketCap: number;
        volume: { h24: number };
        txns: {
          m5?: { buys: number; sells: number };
          h1?: { buys: number; sells: number };
          h24: { buys: number; sells: number };
        };
        pairCreatedAt: number;
        info?: {
          websites?: Array<{ url: string }>;
          socials?: Array<{ type: string; url: string }>;
        };
      }>;
    };

    // Get Solana pairs where the queried token is the BASE token (correct name/symbol/price)
    const solanaPairs = data.pairs?.filter(p => p.chainId === 'solana') || [];

    if (solanaPairs.length === 0) {
      console.log('No Solana pairs found on DexScreener');
      return null;
    }

    // Prefer pairs where the queried token is the baseToken — these have correct name/symbol
    const basePairs = solanaPairs.filter(p =>
      p.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase()
    );

    // Sort by liquidity and get the best pair
    const bestPair = (basePairs.length > 0 ? basePairs : solanaPairs).sort((a, b) =>
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    // If we fell back to a pair where our token is the quoteToken, log a warning
    if (basePairs.length === 0) {
      console.warn(`[DexScreener] No base-token pairs found for ${tokenAddress.slice(0, 8)}... — using best available pair (token may be quoteToken)`);
    }

    const pairCreatedAt = bestPair.pairCreatedAt || 0;
    const ageInMs = Date.now() - pairCreatedAt;
    const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));

    return {
      tokenAddress,
      pairAddress: bestPair.pairAddress,
      dex: bestPair.dexId,

      priceUsd: parseFloat(bestPair.priceUsd) || 0,
      priceChange24h: bestPair.priceChange?.h24 || 0,

      marketCap: bestPair.marketCap || 0,
      fdv: bestPair.fdv || 0,

      liquidityUsd: bestPair.liquidity?.usd || 0,

      volume24h: bestPair.volume?.h24 || 0,
      txns5m: {
        buys: bestPair.txns?.m5?.buys || 0,
        sells: bestPair.txns?.m5?.sells || 0,
      },
      txns1h: {
        buys: bestPair.txns?.h1?.buys || 0,
        sells: bestPair.txns?.h1?.sells || 0,
      },
      txns24h: {
        buys: bestPair.txns?.h24?.buys || 0,
        sells: bestPair.txns?.h24?.sells || 0,
      },

      name: bestPair.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase()
        ? bestPair.baseToken?.name
        : bestPair.quoteToken?.name || bestPair.baseToken?.name,
      symbol: bestPair.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase()
        ? bestPair.baseToken?.symbol
        : bestPair.quoteToken?.symbol || bestPair.baseToken?.symbol,

      pairCreatedAt,
      ageInDays,

      websites: bestPair.info?.websites?.map(w => w.url),
      socials: bestPair.info?.socials,
    };
  } catch (error) {
    console.error('DexScreener fetch error:', error);
    return null;
  }
}

/**
 * Build market context string for AI analysis
 */
export function buildMarketContext(data: DexScreenerData): string {
  let context = `\nMARKET DATA (from DexScreener):\n`;

  if (data.name) context += `- Name: ${data.name}\n`;
  if (data.symbol) context += `- Symbol: ${data.symbol}\n`;
  context += `- DEX: ${data.dex}\n`;
  context += `- Price: $${data.priceUsd.toFixed(8)}\n`;
  context += `- 24h Change: ${data.priceChange24h > 0 ? '+' : ''}${data.priceChange24h.toFixed(2)}%\n`;

  // Market cap - THIS IS CRITICAL for risk assessment
  if (data.marketCap > 0) {
    context += `- Market Cap: $${formatNumber(data.marketCap)}\n`;

    // Add market cap tier for AI context
    if (data.marketCap >= 100_000_000) {
      context += `  ⚠️ LARGE CAP TOKEN (>$100M) - Likely established, lower scam risk\n`;
    } else if (data.marketCap >= 10_000_000) {
      context += `  ⚠️ MID CAP TOKEN ($10M-$100M) - Moderate establishment\n`;
    } else if (data.marketCap >= 1_000_000) {
      context += `  - Small cap token ($1M-$10M)\n`;
    } else {
      context += `  - Micro cap token (<$1M) - Higher risk\n`;
    }
  }

  if (data.fdv > 0) {
    context += `- FDV: $${formatNumber(data.fdv)}\n`;
  }

  // Liquidity - critical for rug pull assessment
  context += `- Liquidity: $${formatNumber(data.liquidityUsd)}\n`;
  if (data.liquidityUsd < 10_000) {
    context += `  ⚠️ LOW LIQUIDITY - Easy to manipulate\n`;
  } else if (data.liquidityUsd >= 1_000_000) {
    context += `  ✓ Strong liquidity (>$1M)\n`;
  }

  // Volume
  context += `- 24h Volume: $${formatNumber(data.volume24h)}\n`;
  context += `- 24h Transactions: ${data.txns24h.buys} buys, ${data.txns24h.sells} sells\n`;

  // Age
  context += `- Token Age: ${data.ageInDays} days\n`;
  if (data.ageInDays < 1) {
    context += `  ⚠️ VERY NEW TOKEN (<1 day old) - High risk\n`;
  } else if (data.ageInDays < 7) {
    context += `  ⚠️ New token (<1 week old)\n`;
  } else if (data.ageInDays >= 30) {
    context += `  ✓ Established token (>30 days)\n`;
  }

  // Socials
  if (data.websites && data.websites.length > 0) {
    context += `- Website: ${data.websites[0]}\n`;
  }
  if (data.socials && data.socials.length > 0) {
    const twitter = data.socials.find(s => s.type === 'twitter');
    const telegram = data.socials.find(s => s.type === 'telegram');
    if (twitter) context += `- Twitter: ${twitter.url}\n`;
    if (telegram) context += `- Telegram: ${telegram.url}\n`;
  }

  return context;
}

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
