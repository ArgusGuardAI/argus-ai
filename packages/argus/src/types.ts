export interface WalletNode {
  id: string;
  address: string;
  label: string;
  type: 'token' | 'creator' | 'whale' | 'insider' | 'normal' | 'lp';
  holdingsPercent?: number;
  isHighRisk?: boolean;
  txCount?: number;
  firstTxTime?: number;
  lastTxTime?: number;
  buyTime?: number;
  sellTime?: number;
  fundedBy?: string;
  solReceived?: number;
}

export interface WalletLink {
  source: string;
  target: string;
  type: 'created' | 'holds' | 'funded' | 'coordinated';
  value: number;
}

export interface NetworkData {
  nodes: WalletNode[];
  links: WalletLink[];
}

export interface RiskFlag {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
}

export interface MarketData {
  name?: string;
  symbol?: string;
  priceUsd?: number;
  priceChange24h?: number;
  marketCap?: number;
  liquidity?: number;
  volume24h?: number;
  txns24h?: {
    buys: number;
    sells: number;
  };
  dex?: string;
  ageInDays?: number;
}

export interface HolderData {
  topHolder?: number;
  top10Holders?: number;
  top1NonLp?: number;
  top10NonLp?: number;
  totalHolders?: number;
}

export interface CreatorData {
  address?: string;
  walletAge?: number;
  tokensCreated?: number;
  ruggedTokens?: number;
  currentHoldings?: number;
}

export interface SocialsData {
  website?: string;
  twitter?: string;
  telegram?: string;
}

export interface AuthoritiesData {
  mintRevoked?: boolean;
  freezeRevoked?: boolean;
}

export interface BundleInfo {
  detected: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  count: number;
  txBundlePercent?: number;
  suspiciousPatterns?: string[];
  description?: string;
}

export interface VerificationInfo {
  verified: boolean;
  source?: 'jupiter' | 'coingecko' | 'both';
  originalRiskScore?: number; // Risk score before verification cap
}

// This matches the actual API response
export interface AnalysisResult {
  tokenAddress: string;
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  riskScore: number;
  confidence?: number;
  flags: RiskFlag[];
  summary: string;
  checkedAt?: number;
  cached?: boolean;
  market?: MarketData;
  holders?: HolderData;
  creator?: CreatorData | null;
  devSelling?: unknown;
  insiders?: unknown;
  socials?: SocialsData;
  authorities?: AuthoritiesData;
  // Network data from Sentinel API
  network?: NetworkData;
  // Bundle detection from backend (transaction-based + holder pattern analysis)
  bundleInfo?: BundleInfo;
  // Token verification from trusted sources (Jupiter, CoinGecko)
  verification?: VerificationInfo;
}
