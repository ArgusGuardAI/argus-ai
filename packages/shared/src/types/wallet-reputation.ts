export type WalletTag =
  | 'KNOWN_SCAMMER'
  | 'SERIAL_RUGGER'
  | 'NEW_WALLET'
  | 'ESTABLISHED'
  | 'VERIFIED_DEV';

export interface WalletReputation {
  address: string;
  deployedTokens: number;
  rugCount: number;
  successfulProjects: number;
  firstSeen: number;
  lastActive: number;
  riskScore: number; // 0-100
  tags: WalletTag[];
}

export interface WalletHistoryRequest {
  address: string;
  includeTokens?: boolean;
}

export interface DeployedToken {
  address: string;
  name: string;
  symbol: string;
  deployedAt: number;
  status: 'ACTIVE' | 'RUGGED' | 'DEAD' | 'UNKNOWN';
  peakMarketCap?: number;
}

export interface WalletHistoryResponse {
  reputation: WalletReputation;
  deployedTokens?: DeployedToken[];
}

export function getWalletRiskLevel(reputation: WalletReputation): string {
  if (reputation.tags.includes('KNOWN_SCAMMER')) return 'CRITICAL';
  if (reputation.tags.includes('SERIAL_RUGGER')) return 'HIGH';
  if (reputation.rugCount > 0) return 'MEDIUM';
  if (reputation.tags.includes('VERIFIED_DEV')) return 'LOW';
  if (reputation.tags.includes('NEW_WALLET')) return 'MEDIUM';
  return 'LOW';
}
