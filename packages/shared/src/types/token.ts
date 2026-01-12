export interface Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUri?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
}

export interface TokenPair {
  pairAddress: string;
  baseToken: Token;
  quoteToken: Token;
  dexId: string;
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  priceUsd: string;
  priceChange24h: number;
  volume24h: number;
  createdAt: number;
}

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  sellerFeeBasisPoints?: number;
  creators?: Array<{
    address: string;
    verified: boolean;
    share: number;
  }>;
}

export interface DeployerInfo {
  address: string;
  previousTokens: number;
  rugCount: number;
  successfulProjects: number;
  firstSeen: number;
}
