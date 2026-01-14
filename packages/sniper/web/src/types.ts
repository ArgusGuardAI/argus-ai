export interface SniperConfig {
  buyAmountSol: number;
  maxSlippageBps: number;
  priorityFeeLamports: number;
  useJito: boolean;
  maxRiskScore: number;
  minLiquidityUsd: number;
  allowPumpFun: boolean;
  allowRaydium: boolean;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxHoldTimeMinutes: number;
}

export interface TokenEvent {
  address: string;
  name: string;
  symbol: string;
  source: 'pump.fun' | 'raydium';
  creator: string;
  liquidityUsd: number;
  timestamp: number;
  status?: 'analyzing' | 'sniping' | 'sniped' | 'skipped' | 'failed';
  riskScore?: number;
  reason?: string;
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

export interface SniperState {
  status: 'stopped' | 'running' | 'paused';
  positions: Position[];
  tokensScanned: number;
  tokensSniped: number;
  tokensSkipped: number;
  totalPnlSol: number;
}
