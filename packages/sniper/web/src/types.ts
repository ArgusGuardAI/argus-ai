export interface SniperConfig {
  walletPrivateKey?: string;
  buyAmountSol: number;
  maxSlippageBps: number;
  priorityFeeLamports: number;
  useJito: boolean;
  maxRiskScore: number;
  minLiquidityUsd: number;
  allowPumpFun: boolean;
  allowRaydium: boolean;

  // Enhanced Exit Strategy
  takeProfitPercent: number;
  stopLossPercent: number;
  maxHoldTimeMinutes: number;

  // Tiered Buy Strategy - adjust buy amount based on risk score
  enableTieredBuys: boolean;
  tierLowRisk: number;       // Risk 0-X = full buy amount
  tierMediumRisk: number;    // Risk X-Y = reduced buy amount
  tierMediumMultiplier: number; // 0.75 = 75% of buyAmountSol
  tierHighMultiplier: number;   // 0.5 = 50% of buyAmountSol

  // Partial Take Profits (Scale Out)
  enableScaleOut: boolean;
  scaleOut1Percent: number;  // Sell X% of position at TP1
  scaleOut1Target: number;   // e.g., 50 = +50% profit
  scaleOut2Percent: number;  // Sell X% of position at TP2
  scaleOut2Target: number;   // e.g., 100 = +100% profit
  scaleOut3Percent: number;  // Sell X% of position at TP3
  scaleOut3Target: number;   // e.g., 200 = +200% profit

  // Trailing Stop Loss
  enableTrailingStop: boolean;
  trailingStopActivation: number; // Activate after X% profit
  trailingStopDistance: number;   // Trail X% below peak

  // Quick Flip Mode - fast in/out for momentum plays
  enableQuickFlip: boolean;
  quickFlipTarget: number;   // Target profit % for quick flip
  quickFlipTimeout: number;  // Seconds before auto-exit if target not hit
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
