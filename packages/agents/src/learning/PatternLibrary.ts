/**
 * PatternLibrary - Knowledge Base of Scam Patterns
 *
 * Stores and matches:
 * - Known scam patterns
 * - Feature weight profiles
 * - Historical examples
 * - Pattern evolution tracking
 */

export interface ScamPattern {
  id: string;
  name: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  featureWeights: Float32Array;
  indicators: string[];
  examples: string[];
  detectionCount: number;
  rugRate: number;
  firstSeen: number;
  lastSeen: number;
  active: boolean;
}

export interface PatternMatch {
  pattern: ScamPattern;
  similarity: number;
  matchedIndicators: string[];
  confidence: number;
}

export interface PatternStats {
  totalPatterns: number;
  activePatterns: number;
  totalDetections: number;
  avgRugRate: number;
  topPatterns: Array<{ name: string; detections: number; rugRate: number }>;
}

export class PatternLibrary {
  private patterns: Map<string, ScamPattern> = new Map();
  private readonly featureNames: string[] = [
    'liquidityLog', 'volumeToLiquidity', 'marketCapLog', 'priceVelocity', 'volumeLog',
    'holderCountLog', 'top10Concentration', 'giniCoefficient', 'freshWalletRatio', 'whaleCount',
    'topWhalePercent', 'mintDisabled', 'freezeDisabled', 'lpLocked', 'lpBurned',
    'bundleDetected', 'bundleCountNorm', 'bundleControlPercent', 'bundleConfidence', 'bundleQuality',
    'buyRatio24h', 'buyRatio1h', 'activityLevel', 'momentum',
    'ageDecay', 'tradingRecency',
    'creatorIdentified', 'creatorRugHistory', 'creatorHoldings'
  ];

  constructor() {
    this.initializeKnownPatterns();
  }

  /**
   * Initialize library with known scam patterns
   */
  private initializeKnownPatterns(): void {
    // Bundle Coordinator Pattern
    this.addPattern({
      id: 'BUNDLE_COORDINATOR',
      name: 'Bundle Coordinator',
      description: 'Multiple wallets coordinating to manipulate supply distribution. Often funded from same source within short timeframe.',
      severity: 'HIGH',
      featureWeights: this.createWeights({
        bundleDetected: 0.25,
        bundleCountNorm: 0.20,
        bundleControlPercent: 0.25,
        bundleConfidence: 0.15,
        top10Concentration: 0.10,
        freshWalletRatio: 0.05
      }),
      indicators: [
        'Multiple wallets bought within seconds',
        'Common funding source detected',
        'Similar holding percentages',
        'Fresh wallets (< 24h old)',
        'Coordinated sell timing'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 0.75,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    // Rug Puller Pattern
    this.addPattern({
      id: 'RUG_PULLER',
      name: 'Rug Puller',
      description: 'Creator or insider wallet holding large supply with intent to dump. Often has active mint/freeze authority.',
      severity: 'CRITICAL',
      featureWeights: this.createWeights({
        creatorHoldings: 0.20,
        mintDisabled: -0.20, // Negative = mint enabled is bad
        freezeDisabled: -0.15,
        lpLocked: -0.15,
        lpBurned: -0.10,
        creatorRugHistory: 0.20
      }),
      indicators: [
        'Creator holds >10% of supply',
        'Mint authority active',
        'Freeze authority active',
        'LP not locked or burned',
        'Creator has rug history'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 0.90,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    // Wash Trader Pattern
    this.addPattern({
      id: 'WASH_TRADER',
      name: 'Wash Trader',
      description: 'Artificial volume through self-trading to attract buyers. High volume/liquidity ratio with concentrated traders.',
      severity: 'MEDIUM',
      featureWeights: this.createWeights({
        volumeToLiquidity: 0.30,
        activityLevel: 0.15,
        holderCountLog: -0.15, // Negative = few holders is bad
        buyRatio24h: 0.15,
        momentum: 0.15,
        liquidityLog: -0.10
      }),
      indicators: [
        'Volume/Liquidity ratio > 5x',
        'Repetitive buy/sell patterns',
        'Few unique traders',
        'Price maintained artificially',
        'Sudden volume spikes'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 0.60,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    // Insider Pattern
    this.addPattern({
      id: 'INSIDER',
      name: 'Insider Trading',
      description: 'Wallets with privileged access accumulating before public awareness. Often front-runs announcements.',
      severity: 'HIGH',
      featureWeights: this.createWeights({
        top10Concentration: 0.25,
        giniCoefficient: 0.20,
        topWhalePercent: 0.20,
        freshWalletRatio: 0.15,
        ageDecay: 0.10,
        creatorIdentified: -0.10
      }),
      indicators: [
        'Large accumulation before announcement',
        'Connected to project team',
        'Early large buys at low prices',
        'Coordinated with marketing',
        'Sells during pumps'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 0.50,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    // Pump and Dump Pattern
    this.addPattern({
      id: 'PUMP_AND_DUMP',
      name: 'Pump and Dump',
      description: 'Coordinated price inflation followed by massive sell-off. Often uses social media hype.',
      severity: 'HIGH',
      featureWeights: this.createWeights({
        priceVelocity: 0.25,
        momentum: 0.20,
        buyRatio1h: 0.20,
        volumeLog: 0.15,
        top10Concentration: 0.10,
        tradingRecency: 0.10
      }),
      indicators: [
        'Rapid price increase (>100% in hours)',
        'Heavy social media promotion',
        'Large holder accumulation',
        'Sudden sentiment shift',
        'Mass sell-off within hours'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 0.80,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    // Honeypot Pattern
    this.addPattern({
      id: 'HONEYPOT',
      name: 'Honeypot',
      description: 'Contract designed to prevent selling. Buys succeed but sells fail due to hidden code.',
      severity: 'CRITICAL',
      featureWeights: this.createWeights({
        freezeDisabled: -0.30, // Freeze active = honeypot risk
        buyRatio24h: 0.25, // High buy ratio = no one can sell
        holderCountLog: 0.15,
        tradingRecency: 0.15,
        liquidityLog: 0.15
      }),
      indicators: [
        'Sells consistently failing',
        'High tax on sells',
        'Freeze authority active',
        'Blacklist function present',
        'Only buys, no sells'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 1.00,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    // Micro Cap Trap Pattern
    this.addPattern({
      id: 'MICRO_CAP_TRAP',
      name: 'Micro Cap Trap',
      description: 'Very low liquidity token designed to trap small investors. Easy to manipulate price.',
      severity: 'MEDIUM',
      featureWeights: this.createWeights({
        liquidityLog: -0.30, // Very low liquidity
        marketCapLog: -0.20, // Very low market cap
        volumeToLiquidity: 0.20,
        priceVelocity: 0.15,
        ageDecay: 0.15
      }),
      indicators: [
        'Liquidity < $5,000',
        'Market cap < $50,000',
        'Easy to move price',
        'Thin order book',
        'High slippage on trades'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 0.55,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    // Legitimate VC Pattern (not a scam - for contrast)
    this.addPattern({
      id: 'LEGITIMATE_VC',
      name: 'Legitimate Project',
      description: 'Healthy token with proper distribution, locked liquidity, and legitimate team.',
      severity: 'LOW',
      featureWeights: this.createWeights({
        mintDisabled: 0.15, // Mint disabled is good
        freezeDisabled: 0.15,
        lpLocked: 0.15,
        lpBurned: 0.15,
        giniCoefficient: -0.10, // Lower gini = more distributed
        holderCountLog: 0.15,
        creatorIdentified: 0.15
      }),
      indicators: [
        'Mint/Freeze authority revoked',
        'LP locked or burned',
        'Wide holder distribution',
        'Team is doxxed',
        'Active development'
      ],
      examples: [],
      detectionCount: 0,
      rugRate: 0.05,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    });

    console.log(`[PatternLibrary] Initialized with ${this.patterns.size} known patterns`);
  }

  /**
   * Add or update a pattern
   */
  addPattern(pattern: ScamPattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  /**
   * Match features against all patterns
   */
  matchPatterns(
    features: Float32Array,
    options: {
      minSimilarity?: number;
      maxResults?: number;
      activeOnly?: boolean;
    } = {}
  ): PatternMatch[] {
    const minSimilarity = options.minSimilarity || 0.5;
    const maxResults = options.maxResults || 5;
    const activeOnly = options.activeOnly !== false;

    const matches: PatternMatch[] = [];

    for (const pattern of this.patterns.values()) {
      if (activeOnly && !pattern.active) continue;

      const similarity = this.calculateSimilarity(features, pattern.featureWeights);

      if (similarity >= minSimilarity) {
        // Check which indicators match
        const matchedIndicators = this.checkIndicators(features, pattern);

        matches.push({
          pattern,
          similarity,
          matchedIndicators,
          confidence: (similarity * 0.6) + (matchedIndicators.length / pattern.indicators.length * 0.4)
        });
      }
    }

    return matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxResults);
  }

  /**
   * Record a pattern detection
   */
  recordDetection(patternId: string, wasRug: boolean, tokenAddress?: string): void {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.detectionCount++;
    pattern.lastSeen = Date.now();

    // Update rug rate (exponential moving average)
    const alpha = 0.1; // Smoothing factor
    pattern.rugRate = pattern.rugRate * (1 - alpha) + (wasRug ? 1 : 0) * alpha;

    // Add example
    if (tokenAddress && pattern.examples.length < 100) {
      pattern.examples.push(tokenAddress);
    }
  }

  /**
   * Get pattern by ID
   */
  getPattern(patternId: string): ScamPattern | undefined {
    return this.patterns.get(patternId);
  }

  /**
   * Get all patterns
   */
  getAllPatterns(): ScamPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get active high-severity patterns
   */
  getHighSeverityPatterns(): ScamPattern[] {
    return Array.from(this.patterns.values())
      .filter(p => p.active && (p.severity === 'HIGH' || p.severity === 'CRITICAL'));
  }

  /**
   * Get library statistics
   */
  getStats(): PatternStats {
    const patterns = Array.from(this.patterns.values());
    const activePatterns = patterns.filter(p => p.active);
    const totalDetections = patterns.reduce((sum, p) => sum + p.detectionCount, 0);
    const avgRugRate = patterns.length > 0
      ? patterns.reduce((sum, p) => sum + p.rugRate, 0) / patterns.length
      : 0;

    const topPatterns = patterns
      .sort((a, b) => b.detectionCount - a.detectionCount)
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        detections: p.detectionCount,
        rugRate: p.rugRate
      }));

    return {
      totalPatterns: patterns.length,
      activePatterns: activePatterns.length,
      totalDetections,
      avgRugRate,
      topPatterns
    };
  }

  /**
   * Deactivate a pattern (mark as outdated)
   */
  deactivatePattern(patternId: string): void {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.active = false;
      console.log(`[PatternLibrary] Deactivated pattern: ${pattern.name}`);
    }
  }

  /**
   * Create a new pattern from observed behavior
   */
  createPatternFromObservation(
    name: string,
    description: string,
    exampleFeatures: Float32Array[],
    indicators: string[],
    severity: ScamPattern['severity']
  ): ScamPattern {
    // Average the feature vectors to create pattern weights
    const avgWeights = new Float32Array(29);

    for (const features of exampleFeatures) {
      for (let i = 0; i < features.length; i++) {
        avgWeights[i] += features[i] / exampleFeatures.length;
      }
    }

    // Normalize weights
    const maxWeight = Math.max(...avgWeights);
    if (maxWeight > 0) {
      for (let i = 0; i < avgWeights.length; i++) {
        avgWeights[i] /= maxWeight;
      }
    }

    const pattern: ScamPattern = {
      id: `LEARNED_${Date.now()}`,
      name,
      description,
      severity,
      featureWeights: avgWeights,
      indicators,
      examples: [],
      detectionCount: exampleFeatures.length,
      rugRate: 0.5, // Start with 50%
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      active: true
    };

    this.addPattern(pattern);
    console.log(`[PatternLibrary] Created new pattern: ${name}`);

    return pattern;
  }

  /**
   * Export patterns for backup/sharing
   */
  exportPatterns(): {
    patterns: Array<{
      id: string;
      name: string;
      description: string;
      severity: string;
      featureWeights: number[];
      indicators: string[];
      rugRate: number;
      detectionCount: number;
    }>;
    exportedAt: number;
  } {
    const patterns = Array.from(this.patterns.values()).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      severity: p.severity,
      featureWeights: Array.from(p.featureWeights),
      indicators: p.indicators,
      rugRate: p.rugRate,
      detectionCount: p.detectionCount
    }));

    return {
      patterns,
      exportedAt: Date.now()
    };
  }

  /**
   * Import patterns from backup
   */
  importPatterns(data: {
    patterns: Array<{
      id: string;
      name: string;
      description: string;
      severity: string;
      featureWeights: number[];
      indicators: string[];
      rugRate: number;
      detectionCount: number;
    }>;
    exportedAt: number;
  }): void {
    for (const p of data.patterns) {
      const pattern: ScamPattern = {
        id: p.id,
        name: p.name,
        description: p.description,
        severity: p.severity as ScamPattern['severity'],
        featureWeights: new Float32Array(p.featureWeights),
        indicators: p.indicators,
        examples: [],
        detectionCount: p.detectionCount,
        rugRate: p.rugRate,
        firstSeen: data.exportedAt,
        lastSeen: data.exportedAt,
        active: true
      };

      this.addPattern(pattern);
    }

    console.log(`[PatternLibrary] Imported ${data.patterns.length} patterns`);
  }

  // Helper methods

  /**
   * Create weight vector from named weights
   */
  private createWeights(namedWeights: Record<string, number>): Float32Array {
    const weights = new Float32Array(29);

    for (const [name, weight] of Object.entries(namedWeights)) {
      const index = this.featureNames.indexOf(name);
      if (index !== -1) {
        weights[index] = weight;
      }
    }

    return weights;
  }

  /**
   * Calculate similarity between features and pattern weights
   */
  private calculateSimilarity(features: Float32Array, weights: Float32Array): number {
    // Weighted dot product
    let score = 0;
    let totalWeight = 0;

    for (let i = 0; i < features.length; i++) {
      if (weights[i] !== 0) {
        // For negative weights, invert the feature value
        const adjustedFeature = weights[i] > 0 ? features[i] : 1 - features[i];
        score += Math.abs(weights[i]) * adjustedFeature;
        totalWeight += Math.abs(weights[i]);
      }
    }

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Check which indicators match based on features
   */
  private checkIndicators(features: Float32Array, pattern: ScamPattern): string[] {
    const matched: string[] = [];

    // Feature thresholds for common indicators
    const thresholds: Record<string, () => boolean> = {
      'bundle': () => features[15] > 0.5, // bundleDetected
      'coordinated': () => features[17] > 0.3, // bundleControlPercent
      'mint': () => features[11] < 0.5, // mintDisabled (inverted)
      'freeze': () => features[12] < 0.5, // freezeDisabled (inverted)
      'liquidity': () => features[0] < 0.3, // liquidityLog
      'concentrated': () => features[6] > 0.7, // top10Concentration
      'fresh': () => features[8] > 0.5, // freshWalletRatio
      'volume': () => features[1] > 2, // volumeToLiquidity
      'rug history': () => features[27] > 0, // creatorRugHistory
      'whale': () => features[10] > 0.3, // topWhalePercent
    };

    for (const indicator of pattern.indicators) {
      const lower = indicator.toLowerCase();

      for (const [key, check] of Object.entries(thresholds)) {
        if (lower.includes(key) && check()) {
          matched.push(indicator);
          break;
        }
      }
    }

    return matched;
  }
}
