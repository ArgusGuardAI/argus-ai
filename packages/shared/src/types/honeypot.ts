export type HoneypotRiskLevel = 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';

export interface HoneypotFlag {
  type: 'LIQUIDITY' | 'OWNERSHIP' | 'CONTRACT' | 'SOCIAL' | 'DEPLOYER' | 'BUNDLE' | 'HOLDERS' | 'TRADING';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
}

export interface HoneypotResult {
  tokenAddress: string;
  riskLevel: HoneypotRiskLevel;
  riskScore: number; // 0-100 (higher = more risk)
  confidence: number; // 0-100
  flags: HoneypotFlag[];
  summary: string;
  checkedAt: number;
}

export interface HoneypotAnalysisRequest {
  tokenAddress: string;
  chain: 'solana';
  includeDeployerHistory?: boolean;
}

export interface HoneypotAIResponse {
  risk_score: number;
  risk_level: string;
  confidence: number;
  flags: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
  summary: string;
}

export function getHoneypotRiskLevel(score: number): HoneypotRiskLevel {
  if (score <= 25) return 'SAFE';
  if (score <= 50) return 'SUSPICIOUS';
  if (score <= 75) return 'DANGEROUS';
  return 'SCAM';
}
