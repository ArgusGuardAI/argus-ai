/**
 * Scammer Database Client
 *
 * Checks local/remote database for known scammer wallets.
 * Uses the Workers API to query the D1 database (BUNDLE_DB).
 *
 * Cost: $0 - D1 queries are free within limits
 */

// Scammer profile from database
export interface ScammerProfile {
  wallet: string;
  rugCount: number;
  tokensInvolved: number;
  firstSeen: number;
  lastSeen: number;
  pattern?: 'BUNDLE_COORDINATOR' | 'RUG_PULLER' | 'WASH_TRADER' | 'UNKNOWN';
}

// Database query result
export interface ScammerCheckResult {
  isKnown: boolean;
  profile: ScammerProfile | null;
  relatedWallets: string[];
}

// Configuration
export interface ScammerDbConfig {
  workersApiUrl?: string;
  localCache?: boolean;
  cacheTimeout?: number;  // ms
}

/**
 * ScammerDb - Local/remote scammer database client
 */
export class ScammerDb {
  private config: ScammerDbConfig;
  private cache: Map<string, { result: ScammerCheckResult; timestamp: number }> = new Map();
  private localDb: Map<string, ScammerProfile> = new Map();
  private cacheTimeout: number;

  constructor(config: ScammerDbConfig) {
    this.config = config;
    this.cacheTimeout = config.cacheTimeout || 5 * 60 * 1000; // 5 minutes

    console.log('[ScammerDb] Initialized');
    if (config.workersApiUrl) {
      console.log(`[ScammerDb] Remote: ${config.workersApiUrl}`);
    }
  }

  /**
   * Check if a wallet is a known scammer
   */
  async checkWallet(wallet: string): Promise<ScammerCheckResult> {
    // Check cache first
    const cached = this.cache.get(wallet);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }

    // Check local database
    const localProfile = this.localDb.get(wallet);
    if (localProfile) {
      const result: ScammerCheckResult = {
        isKnown: true,
        profile: localProfile,
        relatedWallets: [],
      };
      this.cache.set(wallet, { result, timestamp: Date.now() });
      return result;
    }

    // Query remote API if configured
    if (this.config.workersApiUrl) {
      try {
        const remoteResult = await this.queryRemote(wallet);
        this.cache.set(wallet, { result: remoteResult, timestamp: Date.now() });

        // Add to local DB if found
        if (remoteResult.isKnown && remoteResult.profile) {
          this.localDb.set(wallet, remoteResult.profile);
        }

        return remoteResult;
      } catch (error) {
        console.error('[ScammerDb] Remote query failed:', error);
      }
    }

    // Not found
    const result: ScammerCheckResult = {
      isKnown: false,
      profile: null,
      relatedWallets: [],
    };
    this.cache.set(wallet, { result, timestamp: Date.now() });
    return result;
  }

  /**
   * Check multiple wallets at once
   */
  async checkWallets(wallets: string[]): Promise<Map<string, ScammerCheckResult>> {
    const results = new Map<string, ScammerCheckResult>();

    // Check in parallel
    await Promise.all(
      wallets.map(async (wallet) => {
        const result = await this.checkWallet(wallet);
        results.set(wallet, result);
      })
    );

    return results;
  }

  /**
   * Query remote Workers API
   */
  private async queryRemote(wallet: string): Promise<ScammerCheckResult> {
    const response = await fetch(
      `${this.config.workersApiUrl}/scammer/check?wallet=${wallet}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Remote query failed: ${response.status}`);
    }

    const data = await response.json() as {
      found: boolean;
      profile?: ScammerProfile;
      related?: string[];
    };

    return {
      isKnown: data.found,
      profile: data.profile || null,
      relatedWallets: data.related || [],
    };
  }

  /**
   * Add a scammer to local database
   */
  addScammer(profile: ScammerProfile): void {
    this.localDb.set(profile.wallet, profile);
    this.cache.delete(profile.wallet); // Invalidate cache
    console.log(`[ScammerDb] Added scammer: ${profile.wallet.slice(0, 8)}... (${profile.rugCount} rugs)`);
  }

  /**
   * Update scammer profile
   */
  updateScammer(wallet: string, updates: Partial<ScammerProfile>): void {
    const existing = this.localDb.get(wallet);
    if (existing) {
      this.localDb.set(wallet, { ...existing, ...updates });
      this.cache.delete(wallet);
    }
  }

  /**
   * Record a rug pull (for learning)
   */
  recordRug(wallet: string, tokenMint: string): void {
    const existing = this.localDb.get(wallet);

    if (existing) {
      existing.rugCount++;
      existing.lastSeen = Date.now();
    } else {
      this.localDb.set(wallet, {
        wallet,
        rugCount: 1,
        tokensInvolved: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        pattern: 'UNKNOWN',
      });
    }

    this.cache.delete(wallet);
    console.log(`[ScammerDb] Recorded rug by ${wallet.slice(0, 8)}... on ${tokenMint.slice(0, 8)}...`);
  }

  /**
   * Get all known scammers
   */
  getAllScammers(): ScammerProfile[] {
    return Array.from(this.localDb.values());
  }

  /**
   * Get top scammers by rug count
   */
  getTopScammers(limit: number = 10): ScammerProfile[] {
    return Array.from(this.localDb.values())
      .sort((a, b) => b.rugCount - a.rugCount)
      .slice(0, limit);
  }

  /**
   * Export database for backup
   */
  export(): { scammers: ScammerProfile[]; exportedAt: number } {
    return {
      scammers: this.getAllScammers(),
      exportedAt: Date.now(),
    };
  }

  /**
   * Import database from backup
   */
  import(data: { scammers: ScammerProfile[]; exportedAt: number }): void {
    for (const profile of data.scammers) {
      this.localDb.set(profile.wallet, profile);
    }
    this.cache.clear();
    console.log(`[ScammerDb] Imported ${data.scammers.length} scammers`);
  }

  /**
   * Load known scammers from hardcoded list
   * (For bootstrapping before we have real data)
   */
  loadSeedData(): void {
    // These are example patterns - in production, load from actual data
    const seedScammers: ScammerProfile[] = [
      // Add known scammers here as discovered
    ];

    for (const profile of seedScammers) {
      this.localDb.set(profile.wallet, profile);
    }

    console.log(`[ScammerDb] Loaded ${seedScammers.length} seed scammers`);
  }

  /**
   * Get database statistics
   */
  getStats(): {
    totalScammers: number;
    totalRugs: number;
    cacheSize: number;
  } {
    let totalRugs = 0;
    for (const profile of this.localDb.values()) {
      totalRugs += profile.rugCount;
    }

    return {
      totalScammers: this.localDb.size,
      totalRugs,
      cacheSize: this.cache.size,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
