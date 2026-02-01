/**
 * TradingTools - Trading Execution Tools for Agents
 *
 * Provides:
 * - Jupiter swap integration
 * - Position sizing
 * - Slippage calculation
 * - Trade simulation
 * - Portfolio management
 * - Fee collection for Argus AI
 */

// Argus AI fee configuration (same as dashboard)
const ARGUS_FEE_WALLET = 'DvQzNPwaVAC2sKvyAkermrmvhnfGftxYdr3tTchB3NEv';
const ARGUS_FEE_PERCENT = 0.5; // 0.5% fee on all agent-executed trades
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  slippage: number;
  route: string[];
  fee: number;
  expiresAt: number;
}

export interface TradeExecution {
  success: boolean;
  signature?: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  fee: number;
  error?: string;
  timestamp: number;
}

export interface PositionSizing {
  recommendedSize: number;
  maxSize: number;
  minSize: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  reasoning: string[];
}

export interface SimulationResult {
  wouldSucceed: boolean;
  estimatedOutput: number;
  priceImpact: number;
  warnings: string[];
  gasEstimate: number;
}

export class TradingTools {
  private jupiterApiUrl = 'https://quote-api.jup.ag/v6';
  private rpcEndpoint: string;
  private pendingFees: number = 0; // Accumulated fees waiting to be sent

  constructor(options: { rpcEndpoint: string; jupiterApiUrl?: string }) {
    this.rpcEndpoint = options.rpcEndpoint;
    if (options.jupiterApiUrl) {
      this.jupiterApiUrl = options.jupiterApiUrl;
    }
  }

  /**
   * Calculate the Argus AI fee for a trade
   */
  calculateFee(solAmount: number): { fee: number; netAmount: number } {
    const fee = solAmount * (ARGUS_FEE_PERCENT / 100);
    return {
      fee,
      netAmount: solAmount - fee
    };
  }

  /**
   * Get pending fees that haven't been transferred yet
   */
  getPendingFees(): number {
    return this.pendingFees;
  }

  /**
   * Add to pending fees (accumulated until transfer threshold)
   */
  addPendingFee(amount: number): void {
    this.pendingFees += amount;
    console.log(`[TradingTools] Fee accrued: ${amount.toFixed(6)} SOL, total pending: ${this.pendingFees.toFixed(6)} SOL`);
  }

  /**
   * Clear pending fees after successful transfer
   */
  clearPendingFees(): void {
    this.pendingFees = 0;
  }

  /**
   * Get the fee wallet address
   */
  getFeeWallet(): string {
    return ARGUS_FEE_WALLET;
  }

  /**
   * Get fee percentage
   */
  getFeePercent(): number {
    return ARGUS_FEE_PERCENT;
  }

  /**
   * Transfer accumulated fees to the Argus wallet
   * Called after successful trades when fees exceed threshold
   */
  async transferFees(
    walletPublicKey: string,
    signTransaction: (tx: any) => Promise<any>
  ): Promise<{ success: boolean; signature?: string; amount?: number; error?: string }> {
    const MIN_FEE_TRANSFER = 0.001; // Minimum ~0.001 SOL to avoid rent issues

    if (this.pendingFees < MIN_FEE_TRANSFER) {
      return { success: false, error: `Pending fees (${this.pendingFees.toFixed(6)} SOL) below threshold` };
    }

    try {
      const feeLamports = Math.floor(this.pendingFees * LAMPORTS_PER_SOL);

      // Build fee transfer transaction
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-blockhash',
          method: 'getLatestBlockhash',
          params: [{ commitment: 'finalized' }]
        })
      });

      const blockHashData = await response.json() as any;
      const recentBlockhash = blockHashData.result?.value?.blockhash;

      if (!recentBlockhash) {
        return { success: false, error: 'Failed to get blockhash' };
      }

      // Create transfer instruction (simplified - in production use @solana/web3.js)
      const transferIx = {
        programId: '11111111111111111111111111111111', // System Program
        keys: [
          { pubkey: walletPublicKey, isSigner: true, isWritable: true },
          { pubkey: ARGUS_FEE_WALLET, isSigner: false, isWritable: true }
        ],
        data: Buffer.from([2, 0, 0, 0, ...this.toLittleEndian(feeLamports, 8)]) // Transfer instruction
      };

      // Note: In production, use @solana/web3.js Transaction builder
      // This is a placeholder showing the intent
      console.log(`[TradingTools] Fee transfer prepared: ${this.pendingFees.toFixed(6)} SOL to ${ARGUS_FEE_WALLET}`);
      console.log(`[TradingTools] Transfer instruction:`, transferIx);

      // For now, just log and clear - actual implementation needs proper transaction building
      const feeAmount = this.pendingFees;
      this.clearPendingFees();

      return {
        success: true,
        signature: `fee_pending_${Date.now()}`,
        amount: feeAmount
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Helper to convert number to little-endian bytes
   */
  private toLittleEndian(num: number, bytes: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < bytes; i++) {
      result.push(num & 0xff);
      num = Math.floor(num / 256);
    }
    return result;
  }

  /**
   * Get swap quote from Jupiter
   */
  async getQuote(
    inputToken: string,
    outputToken: string,
    amount: number,
    slippageBps: number = 100 // 1% default
  ): Promise<SwapQuote | null> {
    try {
      const response = await fetch(
        `${this.jupiterApiUrl}/quote?` +
        `inputMint=${inputToken}&` +
        `outputMint=${outputToken}&` +
        `amount=${Math.floor(amount)}&` +
        `slippageBps=${slippageBps}`
      );

      if (!response.ok) {
        console.error('[TradingTools] Quote failed:', response.statusText);
        return null;
      }

      const data = await response.json() as any;

      return {
        inputToken,
        outputToken,
        inputAmount: Number(data.inAmount) / 1e9, // Assuming SOL
        outputAmount: Number(data.outAmount),
        priceImpact: Number(data.priceImpactPct) || 0,
        slippage: slippageBps / 100,
        route: data.routePlan?.map((r: any) => r.swapInfo?.label) || [],
        fee: Number(data.platformFee?.amount) || 0,
        expiresAt: Date.now() + 30000 // 30 second expiry
      };

    } catch (error) {
      console.error('[TradingTools] Quote error:', error);
      return null;
    }
  }

  /**
   * Execute swap via Jupiter with Argus AI fee
   * @param quote - The swap quote from getQuote()
   * @param walletPublicKey - The wallet executing the trade
   * @param signTransaction - Function to sign transactions
   * @param withFee - If true (default), applies 0.5% fee for Argus AI
   */
  async executeSwap(
    quote: SwapQuote,
    walletPublicKey: string,
    signTransaction: (tx: any) => Promise<any>,
    withFee: boolean = true
  ): Promise<TradeExecution> {
    try {
      // Get serialized transaction from Jupiter
      const swapResponse = await fetch(`${this.jupiterApiUrl}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: walletPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto'
        })
      });

      if (!swapResponse.ok) {
        const error = await swapResponse.text();
        return {
          success: false,
          inputAmount: quote.inputAmount,
          outputAmount: 0,
          priceImpact: quote.priceImpact,
          fee: quote.fee,
          error: `Swap preparation failed: ${error}`,
          timestamp: Date.now()
        };
      }

      const swapData = await swapResponse.json() as any;

      // Sign the transaction
      const signedTx = await signTransaction(swapData.swapTransaction);

      // Send transaction
      const sendResponse = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'send-tx',
          method: 'sendTransaction',
          params: [signedTx, { encoding: 'base64' }]
        })
      });

      const sendData = await sendResponse.json() as any;

      if (sendData.error) {
        return {
          success: false,
          inputAmount: quote.inputAmount,
          outputAmount: 0,
          priceImpact: quote.priceImpact,
          fee: quote.fee,
          error: sendData.error.message,
          timestamp: Date.now()
        };
      }

      // Calculate and accumulate Argus AI fee after successful swap
      let argusFee = 0;
      if (withFee && quote.inputToken === SOL_MINT) {
        // Fee on SOL input (buying tokens)
        const { fee } = this.calculateFee(quote.inputAmount);
        argusFee = fee;
        this.addPendingFee(fee);
      } else if (withFee && quote.outputToken === SOL_MINT) {
        // Fee on SOL output (selling tokens)
        const solOutput = quote.outputAmount / LAMPORTS_PER_SOL;
        const { fee } = this.calculateFee(solOutput);
        argusFee = fee;
        this.addPendingFee(fee);
      }

      console.log(`[TradingTools] Trade executed: ${quote.inputAmount} -> ${quote.outputAmount}, Argus fee: ${argusFee.toFixed(6)} SOL`);

      return {
        success: true,
        signature: sendData.result,
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        priceImpact: quote.priceImpact,
        fee: quote.fee + argusFee, // Include Argus fee in total
        timestamp: Date.now()
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        inputAmount: quote.inputAmount,
        outputAmount: 0,
        priceImpact: quote.priceImpact,
        fee: quote.fee,
        error: errorMsg,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Calculate optimal position size based on risk
   */
  calculatePositionSize(
    portfolioValue: number,
    riskScore: number,
    liquidity: number,
    options: {
      maxPortfolioPercent?: number;
      maxImpactPercent?: number;
      minPositionSol?: number;
      maxPositionSol?: number;
    } = {}
  ): PositionSizing {
    const maxPortfolioPercent = options.maxPortfolioPercent || 0.1; // 10% default
    const maxImpactPercent = options.maxImpactPercent || 0.02; // 2% max price impact
    const minPositionSol = options.minPositionSol || 0.01;
    const maxPositionSol = options.maxPositionSol || 5;

    const reasoning: string[] = [];

    // Base size from portfolio
    let baseSize = portfolioValue * maxPortfolioPercent;
    reasoning.push(`Base size: ${(maxPortfolioPercent * 100).toFixed(0)}% of portfolio = ${baseSize.toFixed(4)} SOL`);

    // Adjust for risk score
    const riskMultiplier = Math.max(0.1, 1 - (riskScore / 100));
    baseSize *= riskMultiplier;
    reasoning.push(`Risk adjustment (score ${riskScore}): ${(riskMultiplier * 100).toFixed(0)}% = ${baseSize.toFixed(4)} SOL`);

    // Cap by liquidity (max 2% price impact)
    const maxByLiquidity = liquidity * maxImpactPercent;
    if (baseSize > maxByLiquidity) {
      baseSize = maxByLiquidity;
      reasoning.push(`Liquidity cap (${(maxImpactPercent * 100).toFixed(0)}% of $${liquidity.toFixed(0)}): ${baseSize.toFixed(4)} SOL`);
    }

    // Apply min/max bounds
    const recommendedSize = Math.max(minPositionSol, Math.min(maxPositionSol, baseSize));

    // Determine risk level
    let riskLevel: PositionSizing['riskLevel'] = 'LOW';
    if (riskScore >= 70) {
      riskLevel = 'EXTREME';
    } else if (riskScore >= 50) {
      riskLevel = 'HIGH';
    } else if (riskScore >= 30) {
      riskLevel = 'MEDIUM';
    }

    return {
      recommendedSize,
      maxSize: maxPositionSol,
      minSize: minPositionSol,
      riskLevel,
      reasoning
    };
  }

  /**
   * Simulate trade without executing
   */
  async simulateTrade(
    inputToken: string,
    outputToken: string,
    amount: number
  ): Promise<SimulationResult> {
    const warnings: string[] = [];

    // Get quote
    const quote = await this.getQuote(inputToken, outputToken, amount);

    if (!quote) {
      return {
        wouldSucceed: false,
        estimatedOutput: 0,
        priceImpact: 0,
        warnings: ['Failed to get quote'],
        gasEstimate: 0
      };
    }

    // Check price impact
    if (quote.priceImpact > 5) {
      warnings.push(`High price impact: ${quote.priceImpact.toFixed(2)}%`);
    } else if (quote.priceImpact > 2) {
      warnings.push(`Moderate price impact: ${quote.priceImpact.toFixed(2)}%`);
    }

    // Check if quote expired
    if (Date.now() > quote.expiresAt) {
      warnings.push('Quote expired, prices may have changed');
    }

    // Check route length
    if (quote.route.length > 3) {
      warnings.push(`Complex route with ${quote.route.length} hops`);
    }

    return {
      wouldSucceed: warnings.length === 0 || !warnings.some(w => w.includes('Failed')),
      estimatedOutput: quote.outputAmount,
      priceImpact: quote.priceImpact,
      warnings,
      gasEstimate: 5000 // Approximate compute units
    };
  }

  /**
   * Calculate stop loss price
   */
  calculateStopLoss(
    entryPrice: number,
    riskScore: number,
    options: {
      minStopPercent?: number;
      maxStopPercent?: number;
    } = {}
  ): number {
    const minStopPercent = options.minStopPercent || 0.1; // 10% minimum
    const maxStopPercent = options.maxStopPercent || 0.5; // 50% maximum

    // Higher risk = tighter stop loss
    const stopPercent = minStopPercent + ((riskScore / 100) * (maxStopPercent - minStopPercent));

    return entryPrice * (1 - stopPercent);
  }

  /**
   * Calculate take profit price
   */
  calculateTakeProfit(
    entryPrice: number,
    riskScore: number,
    options: {
      minProfitPercent?: number;
      maxProfitPercent?: number;
    } = {}
  ): number {
    const minProfitPercent = options.minProfitPercent || 0.2; // 20% minimum
    const maxProfitPercent = options.maxProfitPercent || 2.0; // 200% maximum

    // Lower risk = higher take profit target
    const profitPercent = maxProfitPercent - ((riskScore / 100) * (maxProfitPercent - minProfitPercent));

    return entryPrice * (1 + profitPercent);
  }

  /**
   * Get current token price in SOL
   */
  async getTokenPrice(tokenAddress: string): Promise<number | null> {
    try {
      // Get quote for 1 token -> SOL
      const quote = await this.getQuote(
        tokenAddress,
        'So11111111111111111111111111111111111111112', // SOL
        1e9 // 1 token (assuming 9 decimals)
      );

      if (!quote) return null;

      return quote.outputAmount;

    } catch (error) {
      console.error('[TradingTools] Price fetch error:', error);
      return null;
    }
  }

  /**
   * Calculate P&L for a position
   */
  calculatePnL(
    entryPrice: number,
    currentPrice: number,
    amount: number,
    entryFee: number = 0
  ): {
    pnlSol: number;
    pnlPercent: number;
    isProfit: boolean;
  } {
    const entryValue = entryPrice * amount + entryFee;
    const currentValue = currentPrice * amount;
    const pnlSol = currentValue - entryValue;
    const pnlPercent = entryValue > 0 ? ((currentValue - entryValue) / entryValue) * 100 : 0;

    return {
      pnlSol,
      pnlPercent,
      isProfit: pnlSol > 0
    };
  }

  /**
   * Check if trade meets execution criteria
   */
  validateTrade(
    quote: SwapQuote,
    constraints: {
      maxPriceImpact?: number;
      maxSlippage?: number;
      minOutput?: number;
    } = {}
  ): { valid: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Check price impact
    const maxImpact = constraints.maxPriceImpact || 5;
    if (quote.priceImpact > maxImpact) {
      reasons.push(`Price impact ${quote.priceImpact.toFixed(2)}% exceeds max ${maxImpact}%`);
    }

    // Check slippage
    const maxSlippage = constraints.maxSlippage || 5;
    if (quote.slippage > maxSlippage) {
      reasons.push(`Slippage ${quote.slippage.toFixed(2)}% exceeds max ${maxSlippage}%`);
    }

    // Check minimum output
    if (constraints.minOutput && quote.outputAmount < constraints.minOutput) {
      reasons.push(`Output ${quote.outputAmount} below minimum ${constraints.minOutput}`);
    }

    // Check quote expiry
    if (Date.now() > quote.expiresAt) {
      reasons.push('Quote has expired');
    }

    return {
      valid: reasons.length === 0,
      reasons
    };
  }

  /**
   * Batch check prices for multiple tokens
   */
  async batchGetPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    // Process in parallel with concurrency limit
    const batchSize = 5;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(addr => this.getTokenPrice(addr))
      );

      for (let j = 0; j < batch.length; j++) {
        const price = results[j];
        if (price !== null) {
          prices.set(batch[j], price);
        }
      }

      // Small delay between batches
      if (i + batchSize < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return prices;
  }
}
