/**
 * Helius Credit Budget Tracker
 *
 * Tracks and limits Helius API usage to stay within credit budget.
 *
 * Credit costs (approximate):
 * - WebSocket subscription: ~1 credit per log notification
 * - getTransaction API: ~100 credits
 * - getAsset (DAS): ~100 credits
 * - token-metadata API: ~100 credits
 *
 * Budget: 20M credits for ~7 days = ~2.85M/day = ~119K/hour = ~2K/min
 */

import { EventEmitter } from 'events';

// Credit costs per API call (approximate)
const CREDIT_COSTS = {
  WEBSOCKET_LOG: 1,        // Each log notification
  GET_TRANSACTION: 100,    // Transaction fetch
  GET_ASSET: 100,          // DAS getAsset
  TOKEN_METADATA: 100,     // token-metadata API
  RPC_CALL: 10,            // Generic RPC call
};

// Budget configuration
const DEFAULT_MONTHLY_BUDGET = 20_000_000;  // 20M credits
const DAYS_REMAINING = 7;                    // Days remaining in billing cycle

interface BudgetState {
  totalUsed: number;
  dailyUsed: number;
  hourlyUsed: number;
  lastResetDay: string;
  lastResetHour: number;
  apiCallCounts: Record<string, number>;
}

class HeliusBudgetTracker extends EventEmitter {
  private state: BudgetState;
  private monthlyBudget: number;
  private dailyBudget: number;
  private hourlyBudget: number;
  private minuteBudget: number;
  private minuteUsed: number = 0;
  private lastMinuteReset: number = Date.now();
  private warningThreshold: number = 0.8; // Warn at 80% usage
  private paused: boolean = false;

  constructor(monthlyBudget: number = DEFAULT_MONTHLY_BUDGET, daysRemaining: number = DAYS_REMAINING) {
    super();
    this.monthlyBudget = monthlyBudget;
    this.dailyBudget = Math.floor(monthlyBudget / daysRemaining);
    this.hourlyBudget = Math.floor(this.dailyBudget / 24);
    this.minuteBudget = Math.floor(this.hourlyBudget / 60);

    // Initialize state
    const today = new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();

    this.state = {
      totalUsed: 0,
      dailyUsed: 0,
      hourlyUsed: 0,
      lastResetDay: today,
      lastResetHour: currentHour,
      apiCallCounts: {},
    };

    console.log(`[HeliusBudget] Initialized with ${(monthlyBudget / 1_000_000).toFixed(1)}M credits budget`);
    console.log(`[HeliusBudget] Daily: ${(this.dailyBudget / 1_000_000).toFixed(2)}M | Hourly: ${(this.hourlyBudget / 1000).toFixed(1)}K | Minute: ${this.minuteBudget}`);
  }

  /**
   * Check and reset daily/hourly counters if needed
   */
  private checkReset() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentHour = now.getHours();

    // Reset daily counter
    if (this.state.lastResetDay !== today) {
      console.log(`[HeliusBudget] Daily reset - yesterday used: ${this.state.dailyUsed.toLocaleString()} credits`);
      this.state.dailyUsed = 0;
      this.state.lastResetDay = today;
      this.state.hourlyUsed = 0;
      this.state.lastResetHour = currentHour;
      this.paused = false;
    }

    // Reset hourly counter
    if (this.state.lastResetHour !== currentHour) {
      this.state.hourlyUsed = 0;
      this.state.lastResetHour = currentHour;
      // Reset paused if we're under daily limit
      if (this.state.dailyUsed < this.dailyBudget) {
        this.paused = false;
      }
    }

    // Reset minute counter
    const minutesSinceReset = (Date.now() - this.lastMinuteReset) / 60000;
    if (minutesSinceReset >= 1) {
      this.minuteUsed = 0;
      this.lastMinuteReset = Date.now();
    }
  }

  /**
   * Record credit usage for an API call
   * @returns true if the call is allowed, false if budget exceeded
   */
  trackUsage(apiType: keyof typeof CREDIT_COSTS, count: number = 1): boolean {
    this.checkReset();

    const cost = CREDIT_COSTS[apiType] * count;

    // Check if we're over budget
    if (this.paused) {
      return false;
    }

    // Check minute budget (most granular, prevents bursts)
    if (this.minuteUsed + cost > this.minuteBudget * 2) {
      console.log(`[HeliusBudget] Minute limit approaching (${this.minuteUsed}/${this.minuteBudget}), throttling...`);
      return false;
    }

    // Check hourly budget
    if (this.state.hourlyUsed + cost > this.hourlyBudget) {
      console.log(`[HeliusBudget] Hourly budget exceeded! Used: ${this.state.hourlyUsed.toLocaleString()}/${this.hourlyBudget.toLocaleString()}`);
      this.emit('hourlyBudgetExceeded');
      return false;
    }

    // Check daily budget
    if (this.state.dailyUsed + cost > this.dailyBudget) {
      console.log(`[HeliusBudget] Daily budget exceeded! Used: ${this.state.dailyUsed.toLocaleString()}/${this.dailyBudget.toLocaleString()}`);
      this.paused = true;
      this.emit('dailyBudgetExceeded');
      return false;
    }

    // Record usage
    this.state.totalUsed += cost;
    this.state.dailyUsed += cost;
    this.state.hourlyUsed += cost;
    this.minuteUsed += cost;
    this.state.apiCallCounts[apiType] = (this.state.apiCallCounts[apiType] || 0) + count;

    // Warn at threshold
    const dailyPercent = this.state.dailyUsed / this.dailyBudget;
    if (dailyPercent >= this.warningThreshold && dailyPercent < this.warningThreshold + 0.05) {
      console.log(`[HeliusBudget] WARNING: ${(dailyPercent * 100).toFixed(1)}% of daily budget used`);
      this.emit('budgetWarning', dailyPercent);
    }

    return true;
  }

  /**
   * Check if we can make an API call without exceeding budget
   */
  canMakeCall(apiType: keyof typeof CREDIT_COSTS, count: number = 1): boolean {
    this.checkReset();

    if (this.paused) return false;

    const cost = CREDIT_COSTS[apiType] * count;
    return (
      this.minuteUsed + cost <= this.minuteBudget * 2 &&
      this.state.hourlyUsed + cost <= this.hourlyBudget &&
      this.state.dailyUsed + cost <= this.dailyBudget
    );
  }

  /**
   * Get current budget status
   */
  getStatus() {
    this.checkReset();

    return {
      totalUsed: this.state.totalUsed,
      dailyUsed: this.state.dailyUsed,
      hourlyUsed: this.state.hourlyUsed,
      minuteUsed: this.minuteUsed,
      dailyBudget: this.dailyBudget,
      hourlyBudget: this.hourlyBudget,
      minuteBudget: this.minuteBudget,
      dailyPercent: (this.state.dailyUsed / this.dailyBudget * 100).toFixed(1),
      hourlyPercent: (this.state.hourlyUsed / this.hourlyBudget * 100).toFixed(1),
      paused: this.paused,
      apiCallCounts: this.state.apiCallCounts,
    };
  }

  /**
   * Log current status to console
   */
  logStatus() {
    const status = this.getStatus();
    console.log(`[HeliusBudget] Daily: ${status.dailyUsed.toLocaleString()}/${status.dailyBudget.toLocaleString()} (${status.dailyPercent}%)`);
    console.log(`[HeliusBudget] Hourly: ${status.hourlyUsed.toLocaleString()}/${status.hourlyBudget.toLocaleString()} (${status.hourlyPercent}%)`);
    if (status.paused) {
      console.log(`[HeliusBudget] ⚠️ PAUSED - Budget exceeded, will resume next period`);
    }
  }

  /**
   * Check if Helius should be used or if we should fall back to free APIs
   */
  shouldUseHelius(): boolean {
    this.checkReset();
    return !this.paused && this.state.dailyUsed < this.dailyBudget * 0.9;
  }

  /**
   * Pause Helius API usage (force switch to free APIs)
   */
  pause() {
    this.paused = true;
    console.log('[HeliusBudget] Paused - switching to free APIs');
    this.emit('paused');
  }

  /**
   * Resume Helius API usage
   */
  resume() {
    if (this.state.dailyUsed < this.dailyBudget) {
      this.paused = false;
      console.log('[HeliusBudget] Resumed');
      this.emit('resumed');
    }
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.paused;
  }
}

// Singleton instance
export const heliusBudget = new HeliusBudgetTracker();

// Export types and constants
export { CREDIT_COSTS };
export type { BudgetState };
