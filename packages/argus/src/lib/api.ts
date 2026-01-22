import type { AnalysisResult, VerificationInfo } from '../types';
import { getTokenVerification, getVerifiedMaxRiskScore } from './verified-tokens';

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
  bundleInfo?: {
    detected: boolean;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    count: number;
    txBundlePercent?: number;
    suspiciousPatterns?: string[];
    description?: string;
  };
}

export async function analyzeToken(tokenAddress: string): Promise<AnalysisResult> {
  // Check verification status in parallel with API call
  const [response, verificationResult] = await Promise.all([
    fetch(`${API_BASE}/sentinel/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tokenAddress }),
    }),
    getTokenVerification(tokenAddress),
  ]);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Analysis failed: ${response.status}`);
  }

  const data: SentinelResponse = await response.json();

  // Get original risk score
  let riskScore = data.analysis.riskScore;
  let riskLevel = data.analysis.riskLevel;
  const originalRiskScore = riskScore;

  // Build verification info
  let verification: VerificationInfo | undefined;

  if (verificationResult.verified && verificationResult.source) {
    const maxScore = getVerifiedMaxRiskScore(verificationResult.source);

    // Cap risk score for verified tokens
    if (riskScore > maxScore) {
      riskScore = maxScore;
      // Recalculate risk level based on capped score
      if (riskScore < 40) riskLevel = 'SAFE';
      else if (riskScore < 60) riskLevel = 'SUSPICIOUS';
      else if (riskScore < 80) riskLevel = 'DANGEROUS';
      else riskLevel = 'SCAM';

      console.log(`[Verified] Token ${data.tokenInfo.symbol} is verified (${verificationResult.source}). Risk capped: ${originalRiskScore} → ${riskScore}`);
    }

    verification = {
      verified: true,
      source: verificationResult.source,
      originalRiskScore: originalRiskScore !== riskScore ? originalRiskScore : undefined,
    };
  } else {
    verification = { verified: false };
  }

  // Transform sentinel response to AnalysisResult format
  return {
    tokenAddress: data.tokenInfo.address,
    riskLevel,
    riskScore,
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
    bundleInfo: data.bundleInfo,
    verification,
  };
}
