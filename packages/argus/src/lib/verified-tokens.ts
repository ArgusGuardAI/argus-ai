/**
 * Verified Token Service
 * Fetches and caches verified tokens from trusted sources:
 * - Jupiter Strict List (curated, scam-free)
 * - CoinGecko Top Solana Tokens (established by market cap)
 */

export interface VerifiedToken {
  address: string;
  symbol: string;
  name: string;
  source: 'jupiter' | 'coingecko' | 'both';
  marketCap?: number;
  logoURI?: string;
}

interface JupiterToken {
  address: string;
  symbol: string;
  name: string;
  logoURI?: string;
  tags?: string[];
}

interface CoinGeckoToken {
  id: string;
  symbol: string;
  name: string;
  platforms?: {
    solana?: string;
  };
  market_cap?: number;
  image?: string;
}

// Hardcoded list of well-known tokens (fallback if APIs fail)
const HARDCODED_TOKENS: { address: string; symbol: string; name: string }[] = [
  { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL' },
  { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin' },
  { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'USDT' },
  { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk' },
  { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter' },
  { address: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'WETH', name: 'Wrapped Ether' },
  { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium' },
  { address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', symbol: 'ORCA', name: 'Orca' },
  { address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL' },
  { address: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', symbol: 'bSOL', name: 'BlazeStake SOL' },
  { address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'jitoSOL', name: 'Jito SOL' },
  { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', symbol: 'SAMO', name: 'Samoyedcoin' },
  { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth Network' },
  { address: 'RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a', symbol: 'RLB', name: 'Rollbit' },
  { address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', symbol: 'MEW', name: 'cat in a dogs world' },
  { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat' },
  { address: 'DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ', symbol: 'DUST', name: 'DUST Protocol' },
  { address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', symbol: 'RENDER', name: 'Render Token' },
  { address: 'HNg5PYJmtqcmzXrv6S9zP1CDKk5BgDuyFBxbvNApump', symbol: 'PNUT', name: 'Peanut the Squirrel' },
  { address: 'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump', symbol: 'FARTCOIN', name: 'Fartcoin' },
];

// Cache for verified tokens
let verifiedTokensCache: Map<string, VerifiedToken> = new Map();
let lastFetchTime: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch Jupiter's validated token list from GitHub (public, no API key needed)
 * Format: CSV with columns: Name,Symbol,Mint,Decimals,LogoURI,Community Validated
 */
async function fetchJupiterTokens(): Promise<JupiterToken[]> {
  try {
    console.log('[Verified] Fetching Jupiter validated tokens from GitHub...');
    const response = await fetch('https://raw.githubusercontent.com/jup-ag/token-list/main/validated-tokens.csv');

    if (!response.ok) {
      console.warn('[Verified] Jupiter GitHub error:', response.status);
      return [];
    }

    const csvText = await response.text();
    const lines = csvText.split('\n');
    const tokens: JupiterToken[] = [];

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse CSV (handle commas in names by splitting carefully)
      const parts = line.split(',');
      if (parts.length >= 4) {
        const name = parts[0];
        const symbol = parts[1];
        const address = parts[2];
        const logoURI = parts[4] || undefined;

        if (address && address.length >= 32) {
          tokens.push({ address, symbol, name, logoURI });
        }
      }
    }

    console.log(`[Verified] Jupiter: ${tokens.length} validated tokens`);
    return tokens;
  } catch (error) {
    console.error('[Verified] Failed to fetch Jupiter tokens:', error);
    return [];
  }
}

/**
 * Fetch top Solana tokens from CoinGecko
 */
async function fetchCoinGeckoTokens(): Promise<CoinGeckoToken[]> {
  try {
    console.log('[Verified] Fetching CoinGecko top Solana tokens...');

    // Get top 250 tokens by market cap on Solana
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?' +
      'vs_currency=usd&category=solana-ecosystem&order=market_cap_desc&per_page=250&page=1'
    );

    if (!response.ok) {
      console.warn('[Verified] CoinGecko API error:', response.status);
      return [];
    }

    const tokens = await response.json();
    console.log(`[Verified] CoinGecko: ${tokens.length} Solana tokens`);

    // For each token, we need to get the Solana contract address
    // CoinGecko markets endpoint doesn't include platform addresses
    // We'll fetch details for top tokens
    const tokensWithAddresses: CoinGeckoToken[] = [];

    // Batch fetch - get details for top 50 to avoid rate limits
    const topTokenIds = tokens.slice(0, 50).map((t: any) => t.id);

    for (const id of topTokenIds) {
      try {
        const detailResponse = await fetch(
          `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`
        );

        if (detailResponse.ok) {
          const detail = await detailResponse.json();
          if (detail.platforms?.solana) {
            tokensWithAddresses.push({
              id: detail.id,
              symbol: detail.symbol,
              name: detail.name,
              platforms: { solana: detail.platforms.solana },
              market_cap: detail.market_data?.market_cap?.usd,
              image: detail.image?.small,
            });
          }
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        // Skip failed fetches
      }
    }

    console.log(`[Verified] CoinGecko: Found ${tokensWithAddresses.length} tokens with Solana addresses`);
    return tokensWithAddresses;
  } catch (error) {
    console.error('[Verified] Failed to fetch CoinGecko tokens:', error);
    return [];
  }
}

/**
 * Refresh the verified tokens cache
 */
async function refreshCache(): Promise<void> {
  const now = Date.now();

  // Skip if cache is still fresh
  if (verifiedTokensCache.size > 0 && now - lastFetchTime < CACHE_DURATION) {
    console.log('[Verified] Using cached token list');
    return;
  }

  console.log('[Verified] Refreshing token cache...');

  // Fetch from both sources in parallel
  const [jupiterTokens, coingeckoTokens] = await Promise.all([
    fetchJupiterTokens(),
    fetchCoinGeckoTokens(),
  ]);

  // Build the cache
  const newCache = new Map<string, VerifiedToken>();

  // Add hardcoded tokens first (as fallback)
  for (const token of HARDCODED_TOKENS) {
    newCache.set(token.address.toLowerCase(), {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      source: 'jupiter', // Treat hardcoded as jupiter-verified
    });
  }

  // Add Jupiter tokens (will overwrite hardcoded if present)
  for (const token of jupiterTokens) {
    newCache.set(token.address.toLowerCase(), {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      source: 'jupiter',
      logoURI: token.logoURI,
    });
  }

  // Add/merge CoinGecko tokens
  for (const token of coingeckoTokens) {
    const address = token.platforms?.solana?.toLowerCase();
    if (!address) continue;

    const existing = newCache.get(address);
    if (existing) {
      // Token is in both lists
      existing.source = 'both';
      existing.marketCap = token.market_cap;
    } else {
      const solanaAddress = token.platforms?.solana;
      if (solanaAddress) {
        newCache.set(address, {
          address: solanaAddress,
          symbol: token.symbol.toUpperCase(),
          name: token.name,
          source: 'coingecko',
          marketCap: token.market_cap,
          logoURI: token.image,
        });
      }
    }
  }

  verifiedTokensCache = newCache;
  lastFetchTime = now;

  console.log(`[Verified] Cache updated: ${newCache.size} verified tokens`);
}

/**
 * Check if a token is verified
 */
export async function isTokenVerified(tokenAddress: string): Promise<VerifiedToken | null> {
  await refreshCache();
  return verifiedTokensCache.get(tokenAddress.toLowerCase()) || null;
}

/**
 * Get verification info for a token
 */
export async function getTokenVerification(tokenAddress: string): Promise<{
  verified: boolean;
  source?: 'jupiter' | 'coingecko' | 'both';
  token?: VerifiedToken;
}> {
  const token = await isTokenVerified(tokenAddress);

  if (token) {
    return {
      verified: true,
      source: token.source,
      token,
    };
  }

  return { verified: false };
}

/**
 * Get the max risk score for a verified token
 * Jupiter-verified = max 25 (very trusted)
 * Both sources = max 20 (extremely trusted)
 * CoinGecko only = max 35 (established but not Jupiter-curated)
 */
export function getVerifiedMaxRiskScore(source: 'jupiter' | 'coingecko' | 'both'): number {
  switch (source) {
    case 'both':
      return 20;
    case 'jupiter':
      return 25;
    case 'coingecko':
      return 35;
    default:
      return 100;
  }
}

/**
 * Pre-load the cache (call on app startup)
 */
export async function preloadVerifiedTokens(): Promise<number> {
  await refreshCache();
  return verifiedTokensCache.size;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; age: number; sources: { jupiter: number; coingecko: number; both: number } } {
  let jupiter = 0, coingecko = 0, both = 0;

  for (const token of verifiedTokensCache.values()) {
    if (token.source === 'jupiter') jupiter++;
    else if (token.source === 'coingecko') coingecko++;
    else if (token.source === 'both') both++;
  }

  return {
    size: verifiedTokensCache.size,
    age: Date.now() - lastFetchTime,
    sources: { jupiter, coingecko, both },
  };
}
