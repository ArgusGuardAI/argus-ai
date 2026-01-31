/**
 * Quick Analyzer - Fast Initial Token Assessment
 *
 * Performs only 2 RPC calls to quickly determine if a token is worth investigating:
 * 1. getTokenSupply - Total supply
 * 2. getTokenLargestAccounts - Top holders
 *
 * Cost: 2 RPC calls per token (~400 calls/day for 200 new pools)
 * This stays well within free tier limits (2.16M/day)
 */

import {
  Connection,
  PublicKey,
  TokenAmount,
  AccountInfo,
} from '@solana/web3.js';

// Quick analysis result
export interface QuickAnalysis {
  mint: string;
  timestamp: number;

  // From getTokenSupply
  supply: number;
  decimals: number;

  // From getTokenLargestAccounts
  topHolders: Array<{
    address: string;
    amount: number;
    percentage: number;
  }>;

  // Calculated metrics
  metrics: {
    top10Concentration: number;    // % held by top 10
    topHolderPercent: number;      // % held by #1 holder
    giniCoefficient: number;       // 0-1, higher = more concentrated
    holderCount: number;           // Estimate from distribution
    suspiciousPatterns: string[];  // Quick red flags
  };

  // Quick verdict
  suspicious: boolean;
  suspicionScore: number;  // 0-100, higher = more suspicious
  reasons: string[];
}

// Configuration
export interface QuickAnalyzerConfig {
  rpcEndpoint: string;
  minLiquidityUsd?: number;  // Skip if liquidity below this
  maxTopHolderPercent?: number;  // Flag if top holder > this %
  maxTop10Percent?: number;  // Flag if top 10 > this %
}

// SOL mint for filtering
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Known stablecoins and wrapped tokens to skip
const SKIP_MINTS = new Set([
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // JitoSOL
]);

/**
 * QuickAnalyzer - Fast 2-call token assessment
 */
export class QuickAnalyzer {
  private connection: Connection;
  private config: QuickAnalyzerConfig;
  private cache: Map<string, QuickAnalysis> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private lastCallTime = 0;
  private minCallInterval = 200; // Minimum 200ms between RPC calls to avoid rate limits
  private consecutiveErrors = 0;
  private backoffTime = 1000; // Start with 1 second backoff

  constructor(config: QuickAnalyzerConfig) {
    this.config = {
      minLiquidityUsd: 1000,
      maxTopHolderPercent: 50,
      maxTop10Percent: 80,
      ...config,
    };

    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    console.log('[QuickAnalyzer] Initialized with rate limiting');
  }

  /**
   * Wait for rate limit to clear
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;

    // If we've had consecutive errors, use exponential backoff
    if (this.consecutiveErrors > 0) {
      const backoff = Math.min(this.backoffTime * Math.pow(2, this.consecutiveErrors - 1), 30000);
      await new Promise(resolve => setTimeout(resolve, backoff));
    } else if (timeSinceLastCall < this.minCallInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minCallInterval - timeSinceLastCall));
    }

    this.lastCallTime = Date.now();
  }

  /**
   * Analyze a token with only 2 RPC calls
   * For pump.fun bonding curve tokens, returns a minimal analysis
   * since they aren't standard SPL tokens until they graduate
   */
  async analyze(mint: string, retryCount = 0, isPumpFun = false): Promise<QuickAnalysis | null> {
    // Skip known tokens
    if (SKIP_MINTS.has(mint)) {
      return null;
    }

    // Check cache
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached;
    }

    // Wait for rate limit
    await this.waitForRateLimit();

    try {
      const mintPubkey = new PublicKey(mint);

      // Make both calls in parallel (still just 2 calls)
      const [supplyResult, holdersResult] = await Promise.all([
        this.connection.getTokenSupply(mintPubkey),
        this.connection.getTokenLargestAccounts(mintPubkey),
      ]);

      // Success - reset error counter
      this.consecutiveErrors = 0;

      // Parse supply
      const supply = this.parseSupply(supplyResult.value);
      const decimals = supplyResult.value.decimals;

      // Parse holders
      const topHolders = this.parseHolders(holdersResult.value, supply, decimals);

      // Calculate metrics
      const metrics = this.calculateMetrics(topHolders, supply);

      // Determine suspicion
      const { suspicious, score, reasons } = this.assessSuspicion(metrics);

      const analysis: QuickAnalysis = {
        mint,
        timestamp: Date.now(),
        supply,
        decimals,
        topHolders,
        metrics,
        suspicious,
        suspicionScore: score,
        reasons,
      };

      // Cache result
      this.cache.set(mint, analysis);

      return analysis;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for rate limit error (429)
      if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
        this.consecutiveErrors++;
        console.log(`[QuickAnalyzer] Rate limited, backing off (${this.consecutiveErrors} consecutive errors)`);

        // Retry up to 3 times with exponential backoff
        if (retryCount < 3) {
          return this.analyze(mint, retryCount + 1, isPumpFun);
        }
      } else if (errorMessage.includes('not a Token mint') || errorMessage.includes('Invalid param')) {
        // For pump.fun bonding curve tokens, this is expected
        // They aren't standard SPL tokens until they graduate to Raydium
        if (isPumpFun) {
          // Return a minimal analysis for pump.fun bonding curve tokens
          console.log(`[QuickAnalyzer] Pump.fun bonding curve detected: ${mint.slice(0, 12)}...`);
          const analysis: QuickAnalysis = {
            mint,
            timestamp: Date.now(),
            supply: 0, // Unknown until graduated
            decimals: 6, // Pump.fun default
            topHolders: [],
            metrics: {
              top10Concentration: 0,
              topHolderPercent: 0,
              giniCoefficient: 0,
              holderCount: 0,
              suspiciousPatterns: ['Bonding curve token - not yet graduated'],
            },
            suspicious: false,
            suspicionScore: 0,
            reasons: ['Token on bonding curve - monitoring for graduation'],
          };
          this.cache.set(mint, analysis);
          return analysis;
        }

        console.log(`[QuickAnalyzer] Skipping invalid mint: ${mint.slice(0, 12)}...`);
        return null;
      }

      console.error(`[QuickAnalyzer] Error analyzing ${mint.slice(0, 12)}...:`, errorMessage);
      return null;
    }
  }

  /**
   * Parse token supply from RPC response
   */
  private parseSupply(value: TokenAmount): number {
    return Number(value.amount) / Math.pow(10, value.decimals);
  }

  /**
   * Parse top holders from RPC response
   */
  private parseHolders(
    accounts: Array<{ address: PublicKey; amount: string }>,
    totalSupply: number,
    decimals: number
  ): QuickAnalysis['topHolders'] {
    return accounts.map(acc => {
      const amount = Number(acc.amount) / Math.pow(10, decimals);
      const percentage = totalSupply > 0 ? (amount / totalSupply) * 100 : 0;

      return {
        address: acc.address.toBase58(),
        amount,
        percentage,
      };
    });
  }

  /**
   * Calculate concentration metrics
   */
  private calculateMetrics(
    holders: QuickAnalysis['topHolders'],
    totalSupply: number
  ): QuickAnalysis['metrics'] {
    // Top 10 concentration
    const top10 = holders.slice(0, 10);
    const top10Concentration = top10.reduce((sum, h) => sum + h.percentage, 0);

    // Top holder
    const topHolderPercent = holders[0]?.percentage || 0;

    // Gini coefficient (measure of inequality)
    const giniCoefficient = this.calculateGini(holders.map(h => h.percentage));

    // Estimate holder count from distribution
    // If top 20 accounts hold most supply, there aren't many more holders
    const holderCount = this.estimateHolderCount(holders, totalSupply);

    // Suspicious patterns
    const suspiciousPatterns: string[] = [];

    // Check for similar-sized holdings (bundled buys)
    const similarHoldings = this.detectSimilarHoldings(holders);
    if (similarHoldings.length > 0) {
      suspiciousPatterns.push(`${similarHoldings.length} wallets with similar holdings`);
    }

    // Check for exactly round percentages (programmatic distribution)
    const roundPercentages = holders.filter(h =>
      h.percentage > 1 && Math.abs(h.percentage - Math.round(h.percentage)) < 0.01
    );
    if (roundPercentages.length >= 3) {
      suspiciousPatterns.push('Multiple wallets with exact round percentages');
    }

    return {
      top10Concentration,
      topHolderPercent,
      giniCoefficient,
      holderCount,
      suspiciousPatterns,
    };
  }

  /**
   * Calculate Gini coefficient (0 = perfect equality, 1 = perfect inequality)
   */
  private calculateGini(percentages: number[]): number {
    if (percentages.length === 0) return 0;

    const sorted = [...percentages].sort((a, b) => a - b);
    const n = sorted.length;
    let sum = 0;

    for (let i = 0; i < n; i++) {
      sum += (2 * (i + 1) - n - 1) * sorted[i];
    }

    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    if (mean === 0) return 0;

    return sum / (n * n * mean);
  }

  /**
   * Estimate total holder count from top 20 distribution
   */
  private estimateHolderCount(
    holders: QuickAnalysis['topHolders'],
    totalSupply: number
  ): number {
    if (holders.length === 0) return 0;

    // Sum of top 20
    const top20Total = holders.reduce((sum, h) => sum + h.percentage, 0);

    // If top 20 holds 100%, that's all the holders
    if (top20Total >= 99.9) {
      return holders.length;
    }

    // Otherwise, estimate based on distribution tail
    const remainingPercent = 100 - top20Total;
    const smallestHolder = holders[holders.length - 1]?.percentage || 0.01;

    // Rough estimate: remaining % / smallest holder %
    const additionalHolders = Math.floor(remainingPercent / Math.max(smallestHolder, 0.01));

    return holders.length + Math.min(additionalHolders, 10000);
  }

  /**
   * Detect wallets with suspiciously similar holdings
   */
  private detectSimilarHoldings(holders: QuickAnalysis['topHolders']): string[] {
    const similar: string[] = [];
    const tolerance = 0.1; // 10% tolerance

    for (let i = 0; i < holders.length - 1; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const h1 = holders[i];
        const h2 = holders[j];

        // Skip very small holdings
        if (h1.percentage < 0.5 || h2.percentage < 0.5) continue;

        // Check if within tolerance
        const diff = Math.abs(h1.percentage - h2.percentage);
        const avg = (h1.percentage + h2.percentage) / 2;

        if (diff / avg < tolerance) {
          similar.push(h1.address);
          similar.push(h2.address);
        }
      }
    }

    return [...new Set(similar)];
  }

  /**
   * Assess overall suspicion level
   */
  private assessSuspicion(metrics: QuickAnalysis['metrics']): {
    suspicious: boolean;
    score: number;
    reasons: string[];
  } {
    let score = 0;
    const reasons: string[] = [];

    // Top holder concentration
    if (metrics.topHolderPercent > 50) {
      score += 30;
      reasons.push(`Top holder owns ${metrics.topHolderPercent.toFixed(1)}%`);
    } else if (metrics.topHolderPercent > 30) {
      score += 15;
      reasons.push(`Top holder owns ${metrics.topHolderPercent.toFixed(1)}%`);
    }

    // Top 10 concentration
    if (metrics.top10Concentration > 90) {
      score += 25;
      reasons.push(`Top 10 own ${metrics.top10Concentration.toFixed(1)}%`);
    } else if (metrics.top10Concentration > 80) {
      score += 15;
      reasons.push(`Top 10 own ${metrics.top10Concentration.toFixed(1)}%`);
    }

    // Gini coefficient (high inequality)
    if (metrics.giniCoefficient > 0.8) {
      score += 20;
      reasons.push('Extreme holder concentration');
    } else if (metrics.giniCoefficient > 0.6) {
      score += 10;
      reasons.push('High holder concentration');
    }

    // Low holder count
    if (metrics.holderCount < 50) {
      score += 15;
      reasons.push(`Only ~${metrics.holderCount} holders`);
    } else if (metrics.holderCount < 100) {
      score += 5;
      reasons.push(`Only ~${metrics.holderCount} holders`);
    }

    // Suspicious patterns
    for (const pattern of metrics.suspiciousPatterns) {
      score += 10;
      reasons.push(pattern);
    }

    // Cap at 100
    score = Math.min(100, score);

    return {
      suspicious: score >= 40,
      score,
      reasons,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { cacheSize: number; cacheHits: number } {
    return {
      cacheSize: this.cache.size,
      cacheHits: 0, // Would need to track this
    };
  }
}
