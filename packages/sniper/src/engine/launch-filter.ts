/**
 * Launch Filter
 * Specialized filter for brand new pools (Raydium/Meteora)
 * These tokens have NO trading history, so we use different checks
 */

import type { NewTokenEvent } from '../types';

// Spam patterns - reject tokens matching these (case insensitive)
const SPAM_PATTERNS = [
  /^test/i,
  /^aaa+/i,
  /^xxx/i,
  /^zzz/i,
  /^\d+$/,           // Pure numbers
  /^.{1,2}$/,        // 1-2 char names
  /asdf/i,
  /qwer/i,
  /token$/i,         // Generic "token" suffix
  /^new.?token/i,
  /porn/i,
  /nsfw/i,
  /sex/i,
  /fuck/i,
  /shit/i,
  /scam/i,
  /rug/i,
  /honeypot/i,
];

// Suspicious name patterns (not instant reject, but flag)
const SUSPICIOUS_PATTERNS = [
  /elon/i,
  /musk/i,
  /trump/i,
  /official/i,
  /v2$/i,
  /2\.0$/i,
  /safe/i,          // "SafeMoon" clones
  /moon/i,
  /rocket/i,
  /1000x/i,
  /gem/i,
];

export interface LaunchFilterConfig {
  // Liquidity bounds (in SOL)
  minLiquiditySol: number;
  maxLiquiditySol: number;

  // USD bounds (calculated from SOL price)
  minLiquidityUsd: number;
  maxLiquidityUsd: number;

  // Creator settings
  maxCreatorTokens: number;     // Max tokens created by same creator in 24h
  autoBlacklistOnRug: boolean;  // Auto-blacklist creator if their token rugs
}

export const DEFAULT_LAUNCH_FILTER_CONFIG: LaunchFilterConfig = {
  minLiquiditySol: 40,          // Min 40 SOL (~$5000)
  maxLiquiditySol: 50000,       // Max 50000 SOL (~$6M) - allow pump.fun migrations
  minLiquidityUsd: 5000,        // Min $5K - anything less is too risky
  maxLiquidityUsd: 10000000,    // Max $10M - pump.fun graduates can have high liq
  maxCreatorTokens: 3,          // Reject if creator launched >3 tokens in 24h
  autoBlacklistOnRug: true,
};

export interface LaunchFilterResult {
  passed: boolean;
  reason: string;
  flags: string[];              // Warning flags (not rejections)
  adjustedLiquidityUsd: number; // Liquidity with real SOL price
}

interface CreatorRecord {
  address: string;
  tokensCreated: number;
  lastTokenTime: number;
  rugCount: number;
  isBlacklisted: boolean;
}

export class LaunchFilter {
  private config: LaunchFilterConfig;
  private creatorRecords: Map<string, CreatorRecord> = new Map();
  private blacklistedCreators: Set<string> = new Set();
  private solPriceUsd: number = 200;  // Default, updated periodically
  private lastPriceUpdate: number = 0;

  // Stats
  private stats = {
    total: 0,
    passedSpam: 0,
    passedLiquidity: 0,
    passedCreator: 0,
    passedAll: 0,
    rejectedSpam: 0,
    rejectedLiquidity: 0,
    rejectedCreator: 0,
  };

  constructor(config: Partial<LaunchFilterConfig> = {}) {
    this.config = { ...DEFAULT_LAUNCH_FILTER_CONFIG, ...config };
    // Start SOL price updates
    this.updateSolPrice();
    setInterval(() => this.updateSolPrice(), 60000); // Update every minute
  }

  /**
   * Filter a new pool token
   */
  async filter(token: NewTokenEvent): Promise<LaunchFilterResult> {
    this.stats.total++;
    const flags: string[] = [];

    // Ensure we have fresh SOL price
    if (Date.now() - this.lastPriceUpdate > 120000) {
      await this.updateSolPrice();
    }

    // Calculate USD liquidity from SOL
    const liquiditySol = token.liquidityUsd / this.solPriceUsd; // Reverse if we have USD
    const adjustedLiquidityUsd = token.liquidityUsd > 0
      ? token.liquidityUsd
      : liquiditySol * this.solPriceUsd;

    console.log(`[LaunchFilter] Checking ${token.symbol} (${token.address.slice(0, 8)}...)`);
    console.log(`[LaunchFilter]   Liquidity: $${adjustedLiquidityUsd.toFixed(0)} (SOL price: $${this.solPriceUsd.toFixed(0)})`);

    // ========================================
    // STEP 1: SPAM FILTER
    // ========================================
    const spamResult = this.checkSpam(token.name, token.symbol);
    if (!spamResult.passed) {
      this.stats.rejectedSpam++;
      return {
        passed: false,
        reason: spamResult.reason,
        flags: [],
        adjustedLiquidityUsd,
      };
    }
    this.stats.passedSpam++;

    // Add suspicious flags (not rejections)
    if (spamResult.flags.length > 0) {
      flags.push(...spamResult.flags);
      console.log(`[LaunchFilter]   ⚠️ Suspicious patterns: ${spamResult.flags.join(', ')}`);
    }

    // ========================================
    // STEP 2: LIQUIDITY CHECK
    // ========================================
    if (adjustedLiquidityUsd < this.config.minLiquidityUsd) {
      this.stats.rejectedLiquidity++;
      return {
        passed: false,
        reason: `Liquidity $${adjustedLiquidityUsd.toFixed(0)} < min $${this.config.minLiquidityUsd}`,
        flags,
        adjustedLiquidityUsd,
      };
    }

    if (adjustedLiquidityUsd > this.config.maxLiquidityUsd) {
      this.stats.rejectedLiquidity++;
      return {
        passed: false,
        reason: `Liquidity $${adjustedLiquidityUsd.toFixed(0)} > max $${this.config.maxLiquidityUsd} (suspicious for new launch)`,
        flags,
        adjustedLiquidityUsd,
      };
    }
    this.stats.passedLiquidity++;
    console.log(`[LaunchFilter]   ✓ Liquidity OK: $${adjustedLiquidityUsd.toFixed(0)}`);

    // ========================================
    // STEP 3: CREATOR CHECK
    // ========================================
    if (token.creator) {
      const creatorResult = this.checkCreator(token.creator);
      if (!creatorResult.passed) {
        this.stats.rejectedCreator++;
        return {
          passed: false,
          reason: creatorResult.reason,
          flags,
          adjustedLiquidityUsd,
        };
      }

      // Track this token creation
      this.recordCreatorToken(token.creator);

      if (creatorResult.flags.length > 0) {
        flags.push(...creatorResult.flags);
      }
    }
    this.stats.passedCreator++;
    console.log(`[LaunchFilter]   ✓ Creator OK`);

    // ========================================
    // ALL CHECKS PASSED
    // ========================================
    this.stats.passedAll++;
    console.log(`[LaunchFilter] ✅ PASSED - sending to AI`);

    return {
      passed: true,
      reason: 'All launch filters passed',
      flags,
      adjustedLiquidityUsd,
    };
  }

  /**
   * Check for spam patterns in name/symbol
   */
  private checkSpam(name: string, symbol: string): { passed: boolean; reason: string; flags: string[] } {
    const flags: string[] = [];

    // Check for spam patterns (instant reject)
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(name) || pattern.test(symbol)) {
        return {
          passed: false,
          reason: `Spam pattern detected: ${pattern.toString()}`,
          flags: [],
        };
      }
    }

    // Check for suspicious patterns (flag but don't reject)
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(name) || pattern.test(symbol)) {
        flags.push(`suspicious:${pattern.source}`);
      }
    }

    // Check for unusual characters
    if (/[^\w\s\-\.\$]/.test(name)) {
      flags.push('unusual_chars_in_name');
    }

    // Check for very long names (potential spam)
    if (name.length > 32) {
      flags.push('long_name');
    }

    return { passed: true, reason: '', flags };
  }

  /**
   * Check creator reputation
   */
  private checkCreator(creatorAddress: string): { passed: boolean; reason: string; flags: string[] } {
    const flags: string[] = [];

    // Check blacklist
    if (this.blacklistedCreators.has(creatorAddress)) {
      return {
        passed: false,
        reason: `Creator ${creatorAddress.slice(0, 8)}... is BLACKLISTED (previous rug)`,
        flags: [],
      };
    }

    // Check creator record
    const record = this.creatorRecords.get(creatorAddress);
    if (record) {
      // Check if creator is launching too many tokens
      const hoursSinceFirst = (Date.now() - record.lastTokenTime) / 1000 / 60 / 60;
      if (hoursSinceFirst < 24 && record.tokensCreated >= this.config.maxCreatorTokens) {
        return {
          passed: false,
          reason: `Creator launched ${record.tokensCreated} tokens in 24h (max: ${this.config.maxCreatorTokens})`,
          flags: [],
        };
      }

      // Add flags for suspicious activity
      if (record.tokensCreated >= 2) {
        flags.push(`creator_${record.tokensCreated}_tokens_24h`);
      }

      if (record.rugCount > 0) {
        flags.push(`creator_${record.rugCount}_rugs`);
      }
    }

    return { passed: true, reason: '', flags };
  }

  /**
   * Record a token creation by a creator
   */
  private recordCreatorToken(creatorAddress: string) {
    const existing = this.creatorRecords.get(creatorAddress);
    const now = Date.now();

    if (existing) {
      // Reset count if >24h since last token
      const hoursSince = (now - existing.lastTokenTime) / 1000 / 60 / 60;
      if (hoursSince > 24) {
        existing.tokensCreated = 1;
      } else {
        existing.tokensCreated++;
      }
      existing.lastTokenTime = now;
    } else {
      this.creatorRecords.set(creatorAddress, {
        address: creatorAddress,
        tokensCreated: 1,
        lastTokenTime: now,
        rugCount: 0,
        isBlacklisted: false,
      });
    }
  }

  /**
   * Report a rug by a creator (call this when a token dumps >90%)
   */
  reportRug(creatorAddress: string, tokenAddress: string) {
    console.log(`[LaunchFilter] 🚨 RUG REPORTED: Creator ${creatorAddress.slice(0, 8)}... (token: ${tokenAddress.slice(0, 8)}...)`);

    const record = this.creatorRecords.get(creatorAddress);
    if (record) {
      record.rugCount++;
      if (this.config.autoBlacklistOnRug) {
        record.isBlacklisted = true;
        this.blacklistedCreators.add(creatorAddress);
        console.log(`[LaunchFilter] ⛔ Creator AUTO-BLACKLISTED`);
      }
    } else {
      this.creatorRecords.set(creatorAddress, {
        address: creatorAddress,
        tokensCreated: 1,
        lastTokenTime: Date.now(),
        rugCount: 1,
        isBlacklisted: this.config.autoBlacklistOnRug,
      });
      if (this.config.autoBlacklistOnRug) {
        this.blacklistedCreators.add(creatorAddress);
        console.log(`[LaunchFilter] ⛔ Creator AUTO-BLACKLISTED`);
      }
    }
  }

  /**
   * Manually blacklist a creator
   */
  blacklistCreator(creatorAddress: string) {
    this.blacklistedCreators.add(creatorAddress);
    const record = this.creatorRecords.get(creatorAddress);
    if (record) {
      record.isBlacklisted = true;
    }
    console.log(`[LaunchFilter] ⛔ Creator blacklisted: ${creatorAddress.slice(0, 8)}...`);
  }

  /**
   * Update SOL price from multiple sources
   */
  private async updateSolPrice() {
    // Try Jupiter first
    try {
      const response = await fetch('https://price.jup.ag/v6/price?ids=SOL', { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json() as { data?: { SOL?: { price?: number } } };
        const price = data.data?.SOL?.price;
        if (price && price > 0) {
          this.solPriceUsd = price;
          this.lastPriceUpdate = Date.now();
          console.log(`[LaunchFilter] SOL price: $${this.solPriceUsd.toFixed(2)} (Jupiter)`);
          return;
        }
      }
    } catch {}

    // Fallback to CoinGecko
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json() as { solana?: { usd?: number } };
        const price = data.solana?.usd;
        if (price && price > 0) {
          this.solPriceUsd = price;
          this.lastPriceUpdate = Date.now();
          console.log(`[LaunchFilter] SOL price: $${this.solPriceUsd.toFixed(2)} (CoinGecko)`);
          return;
        }
      }
    } catch {}

    console.warn(`[LaunchFilter] Could not fetch SOL price, using $${this.solPriceUsd.toFixed(0)}`);
  }

  /**
   * Get current SOL price
   */
  getSolPrice(): number {
    return this.solPriceUsd;
  }

  /**
   * Get filter stats
   */
  getStats() {
    return {
      ...this.stats,
      blacklistedCreators: this.blacklistedCreators.size,
      trackedCreators: this.creatorRecords.size,
      solPriceUsd: this.solPriceUsd,
    };
  }

  /**
   * Get blacklisted creators
   */
  getBlacklistedCreators(): string[] {
    return Array.from(this.blacklistedCreators);
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<LaunchFilterConfig>) {
    this.config = { ...this.config, ...config };
  }
}
