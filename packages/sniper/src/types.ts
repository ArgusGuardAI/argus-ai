/**
 * WhaleShield Sniper Types
 */

export interface SniperConfig {
  // Wallet
  walletPrivateKey: string;

  // Buy settings
  buyAmountSol: number;
  maxSlippageBps: number;
  priorityFeeLamports: number;
  useJito: boolean;

  // Safety filters (WhaleShield)
  maxRiskScore: number;
  minLiquidityUsd: number;

  // Token filters
  allowPumpFun: boolean;
  allowRaydium: boolean;
  blacklistCreators: string[];

  // Exit strategy
  takeProfitPercent: number;
  stopLossPercent: number;
  maxHoldTimeMinutes: number;
}

export interface NewTokenEvent {
  address: string;
  name: string;
  symbol: string;
  source: 'pump.fun' | 'raydium';
  creator: string;
  liquidityUsd: number;
  timestamp: number;
}

export interface SnipeDecision {
  token: NewTokenEvent;
  shouldBuy: boolean;
  reason: string;
  riskScore: number;
  analysis?: {
    flags: string[];
    summary: string;
  };
}

export interface Position {
  tokenAddress: string;
  tokenSymbol: string;
  entryPrice: number;
  currentPrice: number;
  amountTokens: number;
  costBasisSol: number;
  currentValueSol: number;
  pnlPercent: number;
  pnlSol: number;
  entryTime: number;
  txSignature: string;
}

export interface TradeResult {
  success: boolean;
  type: 'BUY' | 'SELL';
  tokenAddress: string;
  amountSol: number;
  amountTokens: number;
  price: number;
  txSignature?: string;
  error?: string;
}

export type SniperStatus = 'stopped' | 'running' | 'paused';

export interface SniperState {
  status: SniperStatus;
  positions: Position[];
  tokensScanned: number;
  tokensSniped: number;
  tokensSkipped: number;
  totalPnlSol: number;
  startedAt?: number;
}

// WebSocket message types
export type WSMessage =
  | { type: 'NEW_TOKEN'; data: NewTokenEvent }
  | { type: 'ANALYSIS_RESULT'; data: SnipeDecision }
  | { type: 'SNIPE_ATTEMPT'; data: { token: string; status: 'pending' | 'success' | 'failed' | 'watch-only'; txSignature?: string } }
  | { type: 'POSITION_UPDATE'; data: Position }
  | { type: 'TRADE_EXECUTED'; data: TradeResult }
  | { type: 'STATUS_UPDATE'; data: SniperState };
