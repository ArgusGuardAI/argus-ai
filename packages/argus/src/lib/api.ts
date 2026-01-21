import type { AnalysisResult } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.argusguard.io';

interface SentinelResponse {
  tokenInfo: {
    address: string;
    name: string;
    symbol: string;
    price?: number;
    marketCap?: number;
    liquidity?: number;
    age?: number;
    priceChange24h?: number;
    volume24h?: number;
    txns24h?: { buys: number; sells: number };
    holderCount?: number;
  };
  network: {
    nodes: Array<{
      id: string;
      address: string;
      label: string;
      type: 'token' | 'creator' | 'whale' | 'insider' | 'normal' | 'lp';
      holdingsPercent?: number;
      isHighRisk?: boolean;
    }>;
    links: Array<{
      source: string;
      target: string;
      type: 'created' | 'holds' | 'funded' | 'coordinated';
      value: number;
    }>;
  };
  analysis: {
    riskScore: number;
    riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
    summary: string;
    flags: Array<{ type: string; severity: string; message: string }>;
  };
  creatorInfo?: {
    address: string;
    walletAge: number;
    tokensCreated: number;
    ruggedTokens: number;
    currentHoldings: number;
  };
  holderDistribution?: Array<{
    address: string;
    percent: number;
    type: string;
  }>;
}

export async function analyzeToken(tokenAddress: string): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE}/sentinel/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tokenAddress }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Analysis failed: ${response.status}`);
  }

  const data: SentinelResponse = await response.json();

  // Transform sentinel response to AnalysisResult format
  return {
    tokenAddress: data.tokenInfo.address,
    riskLevel: data.analysis.riskLevel,
    riskScore: data.analysis.riskScore,
    flags: data.analysis.flags.map(f => ({
      type: f.type,
      severity: f.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      message: f.message,
    })),
    summary: data.analysis.summary,
    market: {
      name: data.tokenInfo.name,
      symbol: data.tokenInfo.symbol,
      priceUsd: data.tokenInfo.price,
      priceChange24h: data.tokenInfo.priceChange24h,
      marketCap: data.tokenInfo.marketCap,
      liquidity: data.tokenInfo.liquidity,
      volume24h: data.tokenInfo.volume24h,
      txns24h: data.tokenInfo.txns24h,
      ageInDays: data.tokenInfo.age,
    },
    holders: data.holderDistribution ? {
      totalHolders: data.tokenInfo.holderCount ?? data.holderDistribution.length,
      topHolder: data.holderDistribution[0]?.percent,
      top10Holders: data.holderDistribution.slice(0, 10).reduce((sum, h) => sum + h.percent, 0),
    } : undefined,
    creator: data.creatorInfo ? {
      address: data.creatorInfo.address,
      walletAge: data.creatorInfo.walletAge,
      tokensCreated: data.creatorInfo.tokensCreated,
      ruggedTokens: data.creatorInfo.ruggedTokens,
      currentHoldings: data.creatorInfo.currentHoldings,
    } : undefined,
    network: data.network,
  };
}
