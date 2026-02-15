/**
 * Smart Multi-RPC Client
 *
 * Intelligent routing across multiple Solana RPC endpoints:
 * - Tracks latency per endpoint
 * - Routes light calls to fastest free endpoints
 * - Reserves premium endpoints for heavy operations
 * - Auto-failover on errors/rate limits
 * - Load balances across healthy endpoints
 */

// ============================================
// METHOD CLASSIFICATION
// ============================================

// Light methods - cheap, fast, use free endpoints
const LIGHT_METHODS = new Set([
  'getSlot',
  'getBlockHeight',
  'getLatestBlockhash',
  'getBalance',
  'getBlockTime',
  'getMinimumBalanceForRentExemption',
  'getVersion',
  'getHealth',
  'getIdentity',
  'getEpochInfo',
  'getRecentPerformanceSamples',
]);

// Medium methods - moderate cost, prefer fast endpoints
const _MEDIUM_METHODS = new Set([
  'getAccountInfo',
  'getMultipleAccounts',
  'getTokenSupply',
  'getTokenLargestAccounts',
  'getTokenAccountBalance',
  'getSignatureStatuses',
  'getTransaction',
]);

// Heavy methods - expensive, use premium endpoints when available
const HEAVY_METHODS = new Set([
  'getProgramAccounts',
  'getSignaturesForAddress',
  'getTokenAccountsByOwner',
  'getBlockProduction',
  'getVoteAccounts',
  'getClusterNodes',
]);

type MethodWeight = 'light' | 'medium' | 'heavy';

function getMethodWeight(method: string): MethodWeight {
  if (LIGHT_METHODS.has(method)) return 'light';
  if (HEAVY_METHODS.has(method)) return 'heavy';
  return 'medium';
}

// ============================================
// ENDPOINT TYPES
// ============================================

export interface RpcEndpoint {
  name: string;
  url: string;
  tier: 'free' | 'premium';   // Free tier vs paid
  priority: number;            // Base priority (lower = better)
  rateLimit?: number;          // Requests per second (0 = unlimited)

  // Runtime stats
  lastError?: number;          // Timestamp of last error
  errorCount: number;          // Consecutive errors
  avgLatency: number;          // Rolling average latency in ms
  requestCount: number;        // Total requests made
  lastUsed?: number;           // Last time this endpoint was used
}

interface RpcResponse<T> {
  jsonrpc: string;
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

// ============================================
// CONSTANTS
// ============================================

const RATE_LIMIT_CODES = [429, 503];
const ERROR_COOLDOWN_MS = 30000;      // 30s cooldown after errors
const MAX_CONSECUTIVE_ERRORS = 3;      // Mark unhealthy after 3 errors
const LATENCY_PENALTY_THRESHOLD = 500; // Penalize endpoints slower than 500ms
const REQUEST_TIMEOUT_MS = 60000;      // 60s timeout (node may be syncing)

// ============================================
// SMART RPC CLIENT
// ============================================

export class MultiRpcClient {
  private endpoints: RpcEndpoint[] = [];
  private requestId = 0;
  private roundRobinIndex = 0;

  constructor() {}

  /**
   * Add an RPC endpoint to the pool
   */
  addEndpoint(
    name: string,
    url: string,
    tier: 'free' | 'premium' = 'free',
    priority: number = 10,
    rateLimit?: number
  ): void {
    if (this.endpoints.some(e => e.url === url)) return;

    this.endpoints.push({
      name,
      url,
      tier,
      priority,
      rateLimit,
      errorCount: 0,
      avgLatency: 100, // Assume 100ms baseline
      requestCount: 0,
    });

    console.log(`[MultiRPC] Added ${tier} endpoint: ${name} (priority: ${priority})`);
  }

  /**
   * Get healthy endpoints, optionally filtered by tier
   */
  private getHealthyEndpoints(preferredTier?: 'free' | 'premium'): RpcEndpoint[] {
    const now = Date.now();

    return this.endpoints
      .filter(ep => {
        // Skip if too many consecutive errors
        if (ep.errorCount >= MAX_CONSECUTIVE_ERRORS) {
          if (ep.lastError && now - ep.lastError < ERROR_COOLDOWN_MS) {
            return false;
          }
          ep.errorCount = 0; // Reset after cooldown
        }
        // Filter by tier if specified
        if (preferredTier && ep.tier !== preferredTier) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Sort by: effective score (priority + latency penalty)
        const scoreA = this.calculateScore(a);
        const scoreB = this.calculateScore(b);
        return scoreA - scoreB;
      });
  }

  /**
   * Calculate endpoint score (lower = better)
   */
  private calculateScore(ep: RpcEndpoint): number {
    let score = ep.priority;

    // Add latency penalty for slow endpoints
    if (ep.avgLatency > LATENCY_PENALTY_THRESHOLD) {
      score += (ep.avgLatency - LATENCY_PENALTY_THRESHOLD) / 100;
    }

    // Slight penalty for recently used (spread load)
    if (ep.lastUsed && Date.now() - ep.lastUsed < 1000) {
      score += 0.5;
    }

    // Bonus for endpoints with good track record
    if (ep.requestCount > 10 && ep.errorCount === 0) {
      score -= 1;
    }

    return score;
  }

  /**
   * Select best endpoint for a given method
   */
  private _selectEndpoint(method: string): RpcEndpoint | null {
    const weight = getMethodWeight(method);

    // For heavy methods, prefer premium endpoints if available
    if (weight === 'heavy') {
      const premium = this.getHealthyEndpoints('premium');
      if (premium.length > 0) {
        return premium[0];
      }
    }

    // For light/medium methods, use free endpoints first
    const free = this.getHealthyEndpoints('free');
    if (free.length > 0) {
      // Round-robin among top performers for load balancing
      const topPerformers = free.filter(ep =>
        this.calculateScore(ep) <= this.calculateScore(free[0]) + 2
      );

      if (topPerformers.length > 1) {
        this.roundRobinIndex = (this.roundRobinIndex + 1) % topPerformers.length;
        return topPerformers[this.roundRobinIndex];
      }

      return free[0];
    }

    // Fallback to any healthy endpoint
    const all = this.getHealthyEndpoints();
    return all[0] || null;
  }

  /**
   * Make an RPC call with smart routing
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const weight = getMethodWeight(method);
    let attempts = 0;
    const maxAttempts = Math.min(this.endpoints.length, 3);
    const triedEndpoints = new Set<string>();
    let lastError: Error | null = null;

    while (attempts < maxAttempts) {
      const endpoint = this.selectEndpointExcluding(method, triedEndpoints);

      if (!endpoint) {
        // Reset and try again if we've tried all endpoints
        if (triedEndpoints.size > 0) {
          triedEndpoints.clear();
          this.endpoints.forEach(ep => ep.errorCount = 0);
          continue;
        }
        break;
      }

      triedEndpoints.add(endpoint.url);
      attempts++;

      try {
        const result = await this.callEndpoint<T>(endpoint, method, params);

        // Log routing decision for debugging
        if (weight === 'heavy') {
          console.log(`[MultiRPC] Heavy call ${method} routed to ${endpoint.name} (${endpoint.tier})`);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[MultiRPC] ${endpoint.name} failed (${attempts}/${maxAttempts}): ${lastError.message}`);

        endpoint.errorCount++;
        endpoint.lastError = Date.now();
      }
    }

    throw lastError || new Error('All RPC endpoints failed');
  }

  /**
   * Select endpoint excluding already-tried ones
   */
  private selectEndpointExcluding(method: string, excluded: Set<string>): RpcEndpoint | null {
    const weight = getMethodWeight(method);

    const candidates = this.getHealthyEndpoints()
      .filter(ep => !excluded.has(ep.url));

    if (candidates.length === 0) return null;

    // For heavy methods, prefer premium
    if (weight === 'heavy') {
      const premium = candidates.filter(ep => ep.tier === 'premium');
      if (premium.length > 0) return premium[0];
    }

    // For light methods, prefer free
    if (weight === 'light') {
      const free = candidates.filter(ep => ep.tier === 'free');
      if (free.length > 0) {
        // Load balance among similar performers
        const best = free[0];
        const similar = free.filter(ep =>
          this.calculateScore(ep) <= this.calculateScore(best) + 2
        );
        if (similar.length > 1) {
          this.roundRobinIndex = (this.roundRobinIndex + 1) % similar.length;
          return similar[this.roundRobinIndex];
        }
        return best;
      }
    }

    return candidates[0];
  }

  /**
   * Make a call to a specific endpoint
   */
  private async callEndpoint<T>(
    endpoint: RpcEndpoint,
    method: string,
    params: unknown[]
  ): Promise<T> {
    const id = ++this.requestId;
    const start = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (RATE_LIMIT_CODES.includes(response.status)) {
        throw new Error(`Rate limited (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as RpcResponse<T>;

      if (data.error) {
        throw new Error(`RPC error ${data.error.code}: ${data.error.message}`);
      }

      // Update stats on success
      const latency = Date.now() - start;
      endpoint.requestCount++;
      endpoint.errorCount = 0;
      endpoint.lastUsed = Date.now();

      // Exponential moving average for latency
      endpoint.avgLatency = endpoint.avgLatency === 0
        ? latency
        : Math.round(endpoint.avgLatency * 0.7 + latency * 0.3);

      return data.result as T;

    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Get status of all endpoints
   */
  getStatus(): Array<{
    name: string;
    tier: string;
    healthy: boolean;
    latency: number;
    requests: number;
    errors: number;
    score: number;
  }> {
    return this.endpoints.map(ep => ({
      name: ep.name,
      tier: ep.tier,
      healthy: ep.errorCount < MAX_CONSECUTIVE_ERRORS,
      latency: Math.round(ep.avgLatency),
      requests: ep.requestCount,
      errors: ep.errorCount,
      score: Math.round(this.calculateScore(ep) * 10) / 10,
    }));
  }

  /**
   * Get primary endpoint URL (for services that need a single URL)
   */
  getPrimaryEndpoint(): string {
    const healthy = this.getHealthyEndpoints();
    if (!healthy[0]?.url && !this.endpoints[0]?.url) {
      throw new Error('No RPC endpoints configured');
    }
    return healthy[0]?.url || this.endpoints[0]?.url;
  }

  /**
   * Check if any endpoints are configured
   */
  hasEndpoints(): boolean {
    return this.endpoints.length > 0;
  }

  /**
   * Get stats summary
   */
  getStatsSummary(): string {
    const status = this.getStatus();
    const healthy = status.filter(s => s.healthy).length;
    const totalRequests = status.reduce((sum, s) => sum + s.requests, 0);
    const avgLatency = status.length > 0
      ? Math.round(status.reduce((sum, s) => sum + s.latency, 0) / status.length)
      : 0;

    return `${healthy}/${status.length} healthy, ${totalRequests} reqs, ${avgLatency}ms avg`;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a MultiRpcClient from environment variables
 *
 * CHAINSTACK PRIMARY + HELIUS FALLBACK
 */
export function createMultiRpcClient(env: {
  SOLANA_RPC_URL?: string;
  HELIUS_API_KEY?: string;
}): MultiRpcClient {
  const client = new MultiRpcClient();

  // CHAINSTACK - PRIMARY (Growth plan: 20M requests/month, 250 req/sec)
  if (env.SOLANA_RPC_URL) {
    client.addEndpoint('Chainstack', env.SOLANA_RPC_URL, 'premium', 0);
    console.log(`[MultiRPC] Added primary: Chainstack`);
  } else {
    console.error('[MultiRPC] ERROR: SOLANA_RPC_URL not set!');
  }

  // HELIUS FALLBACK - secondary option if Chainstack has issues
  if (env.HELIUS_API_KEY) {
    const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
    client.addEndpoint('Helius', heliusUrl, 'premium', 5);
    console.log(`[MultiRPC] Added Helius fallback`);
  }

  return client;
}
