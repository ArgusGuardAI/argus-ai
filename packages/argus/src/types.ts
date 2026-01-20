export interface WalletNode {
  id: string;
  address: string;
  label: string;
  type: 'token' | 'creator' | 'whale' | 'insider' | 'normal' | 'lp';
  holdingsPercent?: number;
  isHighRisk?: boolean;
  txCount?: number;
}

export interface WalletLink {
  source: string;
  target: string;
  type: 'created' | 'holds' | 'funded' | 'coordinated';
  value: number; // Strength of connection
}

export interface NetworkData {
  nodes: WalletNode[];
  links: WalletLink[];
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  price?: number;
  marketCap?: number;
  liquidity?: number;
  age?: number; // days
  holderCount?: number;
  priceChange24h?: number;
  volume24h?: number;
  txns24h?: {
    buys: number;
    sells: number;
  };
}

export interface HolderDistribution {
  address: string;
  percent: number;
  type: 'creator' | 'whale' | 'insider' | 'lp' | 'normal';
}

export interface BundleInfo {
  detected: boolean;
  count: number;
  description?: string;
}

export interface RiskFlag {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
}

export interface AIAnalysis {
  riskScore: number;
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  summary: string;
  prediction: string;
  flags: RiskFlag[];
  networkInsights: string[];
}

export interface AnalysisResult {
  tokenInfo: TokenInfo;
  network: NetworkData;
  analysis: AIAnalysis;
  creatorInfo?: {
    address: string;
    walletAge: number;
    tokensCreated: number;
    ruggedTokens: number;
    currentHoldings: number;
  };
  holderDistribution?: HolderDistribution[];
  bundleInfo?: BundleInfo;
  timestamp: number;
}
