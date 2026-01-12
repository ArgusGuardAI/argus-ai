export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface LegitimacyScore {
  score: number; // 0-100
  riskLevel: RiskLevel;
  confidence: number; // 0-100, how confident the AI is in its assessment
  redFlags: string[];
  positiveIndicators: string[];
  summary: string;
}

export interface VettingRequest {
  tokenAddress: string;
  websiteContent?: string;
  whitepaperContent?: string;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
  };
  onChainData?: {
    holderCount: number;
    liquidityLocked: boolean;
    deployerHistory: string;
  };
}

export interface VettingResult {
  tokenAddress: string;
  tokenName?: string;
  tokenSymbol?: string;
  timestamp: number;
  legitimacyScore: LegitimacyScore;
  dataSourcesAnalyzed: string[];
  rawAiResponse?: string;
}

export interface AIAnalysisRequest {
  content: string;
  contentType: 'website' | 'whitepaper' | 'combined';
  additionalContext?: string;
}

export interface AIAnalysisResponse {
  legitimacy_score: number;
  risk_level: string;
  confidence: number;
  red_flags: string[];
  positive_indicators: string[];
  summary: string;
}

export function getRiskLevel(score: number): RiskLevel {
  if (score < 30) return 'CRITICAL';
  if (score < 50) return 'HIGH';
  if (score < 70) return 'MEDIUM';
  return 'LOW';
}
