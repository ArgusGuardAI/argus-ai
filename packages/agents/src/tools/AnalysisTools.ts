/**
 * AnalysisTools - Advanced Analysis Tools for Agents
 *
 * Provides:
 * - Bundle detection (coordinated wallet clusters)
 * - Wallet relationship mapping
 * - Trading pattern analysis
 * - Risk scoring utilities
 * - Gini coefficient calculation
 */

import { HolderData, TransactionData, WalletProfile } from './OnChainTools';

export interface BundleDetectionResult {
  detected: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  bundles: BundleCluster[];
  totalWallets: number;
  controlPercent: number;
  assessment: string;
}

export interface BundleCluster {
  id: string;
  wallets: string[];
  totalHoldings: number;
  percent: number;
  fundingSource?: string;
  createdWithin: number; // Hours
  signals: string[];
}

export interface WalletRelationship {
  wallet1: string;
  wallet2: string;
  relationship: 'FUNDER' | 'FUNDED' | 'SIBLING' | 'COORDINATED' | 'UNKNOWN';
  confidence: number;
  evidence: string[];
}

export interface TradingPattern {
  pattern: 'ACCUMULATION' | 'DISTRIBUTION' | 'WASH_TRADING' | 'PUMP_AND_DUMP' | 'ORGANIC' | 'UNKNOWN';
  confidence: number;
  signals: string[];
  metrics: {
    buyRatio: number;
    volumeConcentration: number;
    priceImpact: number;
    uniqueTraders: number;
  };
}

export interface RiskFactors {
  bundleRisk: number;
  concentrationRisk: number;
  liquidityRisk: number;
  securityRisk: number;
  patternRisk: number;
  creatorRisk: number;
  overall: number;
  flags: string[];
}

export class AnalysisTools {
  /**
   * Detect coordinated wallet bundles
   */
  detectBundles(
    holders: HolderData[],
    transactions: TransactionData[],
    options: {
      minBundleSize?: number;
      timeWindowHours?: number;
      minConfidence?: number;
    } = {}
  ): BundleDetectionResult {
    const minBundleSize = options.minBundleSize || 3;
    const timeWindowHours = options.timeWindowHours || 6;
    const minConfidence = options.minConfidence || 0.6;

    const bundles: BundleCluster[] = [];

    // Group wallets by timing patterns
    const walletsByTiming = this.groupByTiming(holders, transactions, timeWindowHours);

    // Group by funding source
    const walletsByFunding = this.groupByFundingSource(transactions);

    // Group by similar holdings
    const walletsByHoldings = this.groupBySimilarHoldings(holders);

    // Merge clusters that overlap
    const mergedClusters = this.mergeClusters([
      ...walletsByTiming,
      ...walletsByFunding,
      ...walletsByHoldings
    ], minBundleSize);

    // Score each cluster
    for (const cluster of mergedClusters) {
      const signals: string[] = [];
      let score = 0;

      // Check timing coordination
      if (this.hasTimingCoordination(cluster, transactions, timeWindowHours)) {
        signals.push('Coordinated buy timing');
        score += 30;
      }

      // Check funding patterns
      if (this.hasCommonFunding(cluster, transactions)) {
        signals.push('Common funding source');
        score += 35;
      }

      // Check similar holdings
      if (this.hasSimilarHoldings(cluster, holders)) {
        signals.push('Similar holding amounts');
        score += 20;
      }

      // Check fresh wallets
      const freshCount = this.countFreshWallets(cluster, transactions);
      if (freshCount > cluster.length * 0.5) {
        signals.push(`${freshCount} fresh wallets`);
        score += 15;
      }

      const confidence = score >= 70 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';

      if (score >= minConfidence * 100) {
        const clusterHolders = holders.filter(h => cluster.includes(h.address));
        const totalHoldings = clusterHolders.reduce((sum, h) => sum + h.balance, 0);
        const totalSupply = holders.reduce((sum, h) => sum + h.balance, 0);

        bundles.push({
          id: `bundle_${bundles.length + 1}`,
          wallets: cluster,
          totalHoldings,
          percent: totalSupply > 0 ? (totalHoldings / totalSupply) * 100 : 0,
          createdWithin: timeWindowHours,
          signals
        });
      }
    }

    // Calculate total control
    const totalControl = bundles.reduce((sum, b) => sum + b.percent, 0);
    const totalWallets = bundles.reduce((sum, b) => sum + b.wallets.length, 0);

    // Generate assessment
    let assessment = 'LIKELY_LEGIT';
    if (totalControl > 30) {
      assessment = 'VERY_SUSPICIOUS';
    } else if (totalControl > 15 || bundles.length > 2) {
      assessment = 'SUSPICIOUS';
    } else if (bundles.length > 0) {
      assessment = 'MINOR_CONCERN';
    }

    return {
      detected: bundles.length > 0,
      confidence: totalControl > 30 ? 'HIGH' : totalControl > 15 ? 'MEDIUM' : 'LOW',
      bundles,
      totalWallets,
      controlPercent: totalControl,
      assessment
    };
  }

  /**
   * Map relationships between wallets
   */
  mapWalletRelationships(
    wallets: string[],
    transactions: TransactionData[]
  ): WalletRelationship[] {
    const relationships: WalletRelationship[] = [];
    const walletSet = new Set(wallets);

    // Build transaction graph
    const fundingMap = new Map<string, Set<string>>();
    const fundedMap = new Map<string, Set<string>>();

    for (const tx of transactions) {
      if (tx.type === 'transfer') {
        if (!fundingMap.has(tx.from)) fundingMap.set(tx.from, new Set());
        if (!fundedMap.has(tx.to)) fundedMap.set(tx.to, new Set());

        fundingMap.get(tx.from)!.add(tx.to);
        fundedMap.get(tx.to)!.add(tx.from);
      }
    }

    // Find relationships
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i + 1; j < wallets.length; j++) {
        const w1 = wallets[i];
        const w2 = wallets[j];
        const evidence: string[] = [];
        let relationship: WalletRelationship['relationship'] = 'UNKNOWN';
        let confidence = 0;

        // Check direct funding
        if (fundingMap.get(w1)?.has(w2)) {
          relationship = 'FUNDER';
          confidence = 90;
          evidence.push(`${w1.slice(0, 8)} funded ${w2.slice(0, 8)}`);
        } else if (fundingMap.get(w2)?.has(w1)) {
          relationship = 'FUNDED';
          confidence = 90;
          evidence.push(`${w2.slice(0, 8)} funded ${w1.slice(0, 8)}`);
        }

        // Check sibling (same funder)
        if (relationship === 'UNKNOWN') {
          const funders1 = fundedMap.get(w1);
          const funders2 = fundedMap.get(w2);

          if (funders1 && funders2) {
            for (const funder of funders1) {
              if (funders2.has(funder)) {
                relationship = 'SIBLING';
                confidence = 80;
                evidence.push(`Same funding source: ${funder.slice(0, 8)}`);
                break;
              }
            }
          }
        }

        // Check coordination (similar timing)
        if (relationship === 'UNKNOWN') {
          const coordinated = this.checkCoordination(w1, w2, transactions);
          if (coordinated.isCoordinated) {
            relationship = 'COORDINATED';
            confidence = coordinated.confidence;
            evidence.push(...coordinated.evidence);
          }
        }

        if (relationship !== 'UNKNOWN') {
          relationships.push({
            wallet1: w1,
            wallet2: w2,
            relationship,
            confidence,
            evidence
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Analyze trading patterns
   */
  analyzeTradingPattern(
    transactions: TransactionData[],
    timeWindowHours: number = 24
  ): TradingPattern {
    const cutoff = Date.now() - timeWindowHours * 60 * 60 * 1000;
    const recentTxs = transactions.filter(tx => tx.timestamp >= cutoff);

    if (recentTxs.length === 0) {
      return {
        pattern: 'UNKNOWN',
        confidence: 0,
        signals: ['No recent transactions'],
        metrics: {
          buyRatio: 0,
          volumeConcentration: 0,
          priceImpact: 0,
          uniqueTraders: 0
        }
      };
    }

    // Calculate metrics
    const buys = recentTxs.filter(tx => tx.type === 'buy');
    const sells = recentTxs.filter(tx => tx.type === 'sell');
    const buyRatio = recentTxs.length > 0 ? buys.length / recentTxs.length : 0;

    const uniqueTraders = new Set([
      ...recentTxs.map(tx => tx.from),
      ...recentTxs.map(tx => tx.to)
    ]).size;

    // Check for wash trading
    const selfTrades = this.detectSelfTrades(recentTxs);
    const volumeConcentration = this.calculateVolumeConcentration(recentTxs);

    // Determine pattern
    const signals: string[] = [];
    let pattern: TradingPattern['pattern'] = 'ORGANIC';
    let confidence = 50;

    if (selfTrades > recentTxs.length * 0.2) {
      pattern = 'WASH_TRADING';
      confidence = 85;
      signals.push(`${selfTrades} potential self-trades detected`);
    } else if (buyRatio > 0.9 && volumeConcentration > 0.7) {
      pattern = 'PUMP_AND_DUMP';
      confidence = 70;
      signals.push('High buy ratio with concentrated volume');
    } else if (buyRatio > 0.7) {
      pattern = 'ACCUMULATION';
      confidence = 65;
      signals.push('Consistent buying pressure');
    } else if (buyRatio < 0.3) {
      pattern = 'DISTRIBUTION';
      confidence = 65;
      signals.push('Consistent selling pressure');
    } else {
      signals.push('Normal trading activity');
    }

    return {
      pattern,
      confidence,
      signals,
      metrics: {
        buyRatio,
        volumeConcentration,
        priceImpact: 0, // Would need price data
        uniqueTraders
      }
    };
  }

  /**
   * Calculate comprehensive risk factors
   */
  calculateRiskFactors(
    holders: HolderData[],
    bundleResult: BundleDetectionResult,
    tokenData: {
      mintAuthority: string | null;
      freezeAuthority: string | null;
      liquidity: number;
      lpLocked: boolean;
      lpBurned: boolean;
      creatorRugHistory: number;
    }
  ): RiskFactors {
    const flags: string[] = [];

    // Bundle risk (0-100)
    let bundleRisk = 0;
    if (bundleResult.detected) {
      bundleRisk = Math.min(100, bundleResult.controlPercent * 2);
      if (bundleResult.controlPercent > 30) {
        flags.push('BUNDLE_HIGH_CONTROL');
      } else if (bundleResult.controlPercent > 15) {
        flags.push('BUNDLE_DETECTED');
      }
    }

    // Concentration risk (0-100)
    const gini = this.calculateGini(holders.map(h => h.percent));
    const top10Percent = holders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);
    const concentrationRisk = Math.min(100, (gini * 50) + (top10Percent > 50 ? 30 : 0));

    if (top10Percent > 70) {
      flags.push('EXTREME_CONCENTRATION');
    } else if (top10Percent > 50) {
      flags.push('HIGH_CONCENTRATION');
    }

    // Liquidity risk (0-100)
    let liquidityRisk = 0;
    if (tokenData.liquidity < 1000) {
      liquidityRisk = 100;
      flags.push('MICRO_LIQUIDITY');
    } else if (tokenData.liquidity < 5000) {
      liquidityRisk = 80;
      flags.push('LOW_LIQUIDITY');
    } else if (tokenData.liquidity < 10000) {
      liquidityRisk = 50;
    } else if (tokenData.liquidity < 50000) {
      liquidityRisk = 25;
    }

    // Security risk (0-100)
    let securityRisk = 0;
    if (tokenData.mintAuthority) {
      securityRisk += 40;
      flags.push('MINT_ACTIVE');
    }
    if (tokenData.freezeAuthority) {
      securityRisk += 40;
      flags.push('FREEZE_ACTIVE');
    }
    if (!tokenData.lpLocked && !tokenData.lpBurned) {
      securityRisk += 20;
      flags.push('LP_UNLOCKED');
    }

    // Pattern risk (calculated elsewhere, default 0)
    const patternRisk = 0;

    // Creator risk (0-100)
    let creatorRisk = 0;
    if (tokenData.creatorRugHistory > 0) {
      creatorRisk = Math.min(100, tokenData.creatorRugHistory * 40);
      flags.push('CREATOR_RUG_HISTORY');
    }

    // Calculate overall (weighted average)
    const overall = Math.min(100, Math.round(
      bundleRisk * 0.25 +
      concentrationRisk * 0.15 +
      liquidityRisk * 0.15 +
      securityRisk * 0.25 +
      patternRisk * 0.10 +
      creatorRisk * 0.10
    ));

    return {
      bundleRisk,
      concentrationRisk,
      liquidityRisk,
      securityRisk,
      patternRisk,
      creatorRisk,
      overall,
      flags
    };
  }

  /**
   * Calculate Gini coefficient for holder distribution
   */
  calculateGini(values: number[]): number {
    if (values.length <= 1) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / n;

    if (mean === 0) return 0;

    let sumIX = 0;
    for (let i = 0; i < n; i++) {
      sumIX += (i + 1) * sorted[i];
    }

    const gini = (2 * sumIX) / (n * mean * n) - (n + 1) / n;
    return Math.min(1, Math.max(0, gini));
  }

  // Helper methods

  private groupByTiming(
    holders: HolderData[],
    transactions: TransactionData[],
    windowHours: number
  ): string[][] {
    const groups: string[][] = [];
    const windowMs = windowHours * 60 * 60 * 1000;

    // Group by first buy time
    const walletFirstBuy = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.type === 'buy' && !walletFirstBuy.has(tx.to)) {
        walletFirstBuy.set(tx.to, tx.timestamp);
      }
    }

    // Cluster wallets that bought within the same window
    const processed = new Set<string>();
    for (const [wallet, time] of walletFirstBuy) {
      if (processed.has(wallet)) continue;

      const cluster = [wallet];
      processed.add(wallet);

      for (const [other, otherTime] of walletFirstBuy) {
        if (!processed.has(other) && Math.abs(time - otherTime) < windowMs) {
          cluster.push(other);
          processed.add(other);
        }
      }

      if (cluster.length >= 3) {
        groups.push(cluster);
      }
    }

    return groups;
  }

  private groupByFundingSource(transactions: TransactionData[]): string[][] {
    const funderToFunded = new Map<string, Set<string>>();

    for (const tx of transactions) {
      if (tx.type === 'transfer') {
        if (!funderToFunded.has(tx.from)) {
          funderToFunded.set(tx.from, new Set());
        }
        funderToFunded.get(tx.from)!.add(tx.to);
      }
    }

    // Find funders with multiple funded wallets
    const groups: string[][] = [];
    for (const [_funder, funded] of funderToFunded) {
      if (funded.size >= 3) {
        groups.push(Array.from(funded));
      }
    }

    return groups;
  }

  private groupBySimilarHoldings(holders: HolderData[]): string[][] {
    const groups: string[][] = [];

    // Group by similar percentage (within 20% relative)
    const processed = new Set<string>();

    for (const holder of holders) {
      if (processed.has(holder.address) || holder.percent < 0.1) continue;

      const similar = [holder.address];
      processed.add(holder.address);

      for (const other of holders) {
        if (!processed.has(other.address) && other.percent >= 0.1) {
          const ratio = holder.percent / other.percent;
          if (ratio >= 0.8 && ratio <= 1.2) {
            similar.push(other.address);
            processed.add(other.address);
          }
        }
      }

      if (similar.length >= 3) {
        groups.push(similar);
      }
    }

    return groups;
  }

  private mergeClusters(clusters: string[][], minSize: number): string[][] {
    if (clusters.length === 0) return [];

    // Convert to sets for easier manipulation
    const sets = clusters.map(c => new Set(c));
    const merged: Set<string>[] = [];

    for (const set of sets) {
      let foundMerge = false;

      for (const existing of merged) {
        // Check overlap
        const overlap = [...set].filter(x => existing.has(x)).length;
        if (overlap >= 2) {
          // Merge
          for (const item of set) {
            existing.add(item);
          }
          foundMerge = true;
          break;
        }
      }

      if (!foundMerge) {
        merged.push(new Set(set));
      }
    }

    return merged
      .filter(s => s.size >= minSize)
      .map(s => Array.from(s));
  }

  private hasTimingCoordination(
    wallets: string[],
    transactions: TransactionData[],
    windowHours: number
  ): boolean {
    const windowMs = windowHours * 60 * 60 * 1000;
    const buyTimes: number[] = [];

    for (const tx of transactions) {
      if (tx.type === 'buy' && wallets.includes(tx.to)) {
        buyTimes.push(tx.timestamp);
      }
    }

    if (buyTimes.length < 2) return false;

    // Check if most buys happened within window
    const sorted = buyTimes.sort((a, b) => a - b);
    return (sorted[sorted.length - 1] - sorted[0]) < windowMs;
  }

  private hasCommonFunding(wallets: string[], transactions: TransactionData[]): boolean {
    const funders = new Map<string, Set<string>>();

    for (const tx of transactions) {
      if (tx.type === 'transfer' && wallets.includes(tx.to)) {
        if (!funders.has(tx.from)) {
          funders.set(tx.from, new Set());
        }
        funders.get(tx.from)!.add(tx.to);
      }
    }

    // Check if any funder funded multiple wallets
    for (const [_funder, funded] of funders) {
      if (funded.size >= Math.ceil(wallets.length * 0.5)) {
        return true;
      }
    }

    return false;
  }

  private hasSimilarHoldings(wallets: string[], holders: HolderData[]): boolean {
    const clusterHolders = holders.filter(h => wallets.includes(h.address));
    if (clusterHolders.length < 2) return false;

    const percents = clusterHolders.map(h => h.percent);
    const avg = percents.reduce((a, b) => a + b, 0) / percents.length;

    // Check if all holdings are within 30% of average
    return percents.every(p => Math.abs(p - avg) / avg < 0.3);
  }

  private countFreshWallets(wallets: string[], transactions: TransactionData[]): number {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let freshCount = 0;

    for (const wallet of wallets) {
      const firstTx = transactions
        .filter(tx => tx.from === wallet || tx.to === wallet)
        .sort((a, b) => a.timestamp - b.timestamp)[0];

      if (!firstTx || firstTx.timestamp > oneDayAgo) {
        freshCount++;
      }
    }

    return freshCount;
  }

  private checkCoordination(
    w1: string,
    w2: string,
    transactions: TransactionData[]
  ): { isCoordinated: boolean; confidence: number; evidence: string[] } {
    const evidence: string[] = [];
    let score = 0;

    // Check if they bought around the same time
    const w1Buys = transactions.filter(tx => tx.type === 'buy' && tx.to === w1);
    const w2Buys = transactions.filter(tx => tx.type === 'buy' && tx.to === w2);

    if (w1Buys.length > 0 && w2Buys.length > 0) {
      const timeDiff = Math.abs(w1Buys[0].timestamp - w2Buys[0].timestamp);
      if (timeDiff < 60000) { // Within 1 minute
        score += 50;
        evidence.push('Bought within 1 minute of each other');
      } else if (timeDiff < 300000) { // Within 5 minutes
        score += 30;
        evidence.push('Bought within 5 minutes of each other');
      }
    }

    return {
      isCoordinated: score >= 30,
      confidence: score,
      evidence
    };
  }

  private detectSelfTrades(transactions: TransactionData[]): number {
    // Simple heuristic: count transactions where same address appears as both buyer and seller
    // In reality, need to trace through intermediate wallets
    let selfTrades = 0;

    const walletActivity = new Map<string, { buys: number; sells: number }>();

    for (const tx of transactions) {
      if (tx.type === 'buy') {
        const activity = walletActivity.get(tx.to) || { buys: 0, sells: 0 };
        activity.buys++;
        walletActivity.set(tx.to, activity);
      } else if (tx.type === 'sell') {
        const activity = walletActivity.get(tx.from) || { buys: 0, sells: 0 };
        activity.sells++;
        walletActivity.set(tx.from, activity);
      }
    }

    // Wallets that both buy and sell frequently might be wash trading
    for (const [_wallet, activity] of walletActivity) {
      if (activity.buys >= 2 && activity.sells >= 2) {
        selfTrades += Math.min(activity.buys, activity.sells);
      }
    }

    return selfTrades;
  }

  private calculateVolumeConcentration(transactions: TransactionData[]): number {
    if (transactions.length === 0) return 0;

    const volumeByWallet = new Map<string, number>();
    let totalVolume = 0;

    for (const tx of transactions) {
      const wallet = tx.type === 'buy' ? tx.to : tx.from;
      const current = volumeByWallet.get(wallet) || 0;
      volumeByWallet.set(wallet, current + tx.amount);
      totalVolume += tx.amount;
    }

    if (totalVolume === 0) return 0;

    // Get top 10 wallet volume
    const sorted = Array.from(volumeByWallet.values()).sort((a, b) => b - a);
    const top10Volume = sorted.slice(0, 10).reduce((a, b) => a + b, 0);

    return top10Volume / totalVolume;
  }
}
