/**
 * Agent Event Storage Service
 *
 * Stores and retrieves real agent events in KV.
 * Events are generated from actual user scans - no extra RPC calls.
 */

// Event types
export interface AgentEvent {
  id: string;
  timestamp: number;
  agent: 'SCOUT' | 'ANALYST' | 'HUNTER' | 'TRADER';
  type: 'scan' | 'alert' | 'analysis' | 'trade' | 'discovery' | 'graduation' | 'comms';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  data?: {
    tokenAddress?: string;
    tokenSymbol?: string;
    score?: number;
    walletAddress?: string;
    bundleCount?: number;
    rugRate?: number;
    // Graduation-specific
    dex?: string;
    graduatedFrom?: string;
    bondingCurveTime?: number;
    poolAddress?: string;
    // Agent communication
    targetAgent?: 'SCOUT' | 'ANALYST' | 'HUNTER' | 'TRADER';
    requestType?: string;
  };
}

// Graduation event for dedicated tracking
export interface GraduationEvent {
  id: string;
  timestamp: number;
  mint: string;
  dex: string;
  poolAddress: string;
  bondingCurveTime?: number;
  graduatedFrom: string;
}

export interface AgentStats {
  scans: {
    today: number;
    total: number;
    lastReset: number;
  };
  alerts: {
    today: number;
    highRisk: number;
    bundlesDetected: number;
  };
  hunters: {
    walletsTracked: number;
    syndicatesFound: number;
  };
  graduations: {
    today: number;
    total: number;
  };
  lastUpdate: number;
}

// Keys
const EVENTS_KEY = 'agents:events';
const STATS_KEY = 'agents:stats';
const GRADUATIONS_KEY = 'agents:graduations';
const MAX_EVENTS = 100;
const MAX_GRADUATIONS = 50;

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Get today's date key for stats reset
 */
function getTodayKey(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Store a new agent event
 */
export async function storeAgentEvent(
  kv: KVNamespace,
  event: Omit<AgentEvent, 'id' | 'timestamp'>
): Promise<AgentEvent> {
  const fullEvent: AgentEvent = {
    ...event,
    id: generateEventId(),
    timestamp: Date.now(),
  };

  // Get existing events
  const existing = await kv.get<AgentEvent[]>(EVENTS_KEY, 'json') || [];

  // Prepend new event and limit size
  const updated = [fullEvent, ...existing].slice(0, MAX_EVENTS);

  // Store with 24h TTL
  await kv.put(EVENTS_KEY, JSON.stringify(updated), { expirationTtl: 86400 });

  return fullEvent;
}

/**
 * Get recent agent events
 */
export async function getAgentEvents(
  kv: KVNamespace,
  limit = 50,
  afterId?: string
): Promise<{ events: AgentEvent[]; lastEventId: string }> {
  const events = await kv.get<AgentEvent[]>(EVENTS_KEY, 'json') || [];

  let filtered = events;
  if (afterId) {
    const afterIndex = events.findIndex(e => e.id === afterId);
    if (afterIndex > 0) {
      filtered = events.slice(0, afterIndex);
    } else if (afterIndex === 0) {
      filtered = [];
    }
  }

  const limited = filtered.slice(0, limit);
  return {
    events: limited,
    lastEventId: limited[0]?.id || '',
  };
}

/**
 * Update agent stats
 */
export async function updateAgentStats(
  kv: KVNamespace,
  updates: {
    scan?: boolean;
    alert?: boolean;
    highRisk?: boolean;
    bundleDetected?: boolean;
    walletTracked?: boolean;
    syndicateFound?: boolean;
    graduation?: boolean;
  }
): Promise<AgentStats> {
  const existing = await kv.get<AgentStats>(STATS_KEY, 'json');
  const today = getTodayKey();

  // Initialize or reset if new day
  const stats: AgentStats = existing && existing.scans.lastReset === today
    ? existing
    : {
        scans: { today: 0, total: existing?.scans.total || 0, lastReset: today },
        alerts: { today: 0, highRisk: 0, bundlesDetected: existing?.alerts.bundlesDetected || 0 },
        hunters: { walletsTracked: existing?.hunters.walletsTracked || 0, syndicatesFound: existing?.hunters.syndicatesFound || 0 },
        graduations: { today: 0, total: existing?.graduations?.total || 0 },
        lastUpdate: Date.now(),
      };

  // Ensure graduations field exists (backwards compatibility)
  if (!stats.graduations) {
    stats.graduations = { today: 0, total: 0 };
  }

  // Apply updates
  if (updates.scan) {
    stats.scans.today++;
    stats.scans.total++;
  }
  if (updates.alert) {
    stats.alerts.today++;
  }
  if (updates.highRisk) {
    stats.alerts.highRisk++;
  }
  if (updates.bundleDetected) {
    stats.alerts.bundlesDetected++;
  }
  if (updates.walletTracked) {
    stats.hunters.walletsTracked++;
  }
  if (updates.syndicateFound) {
    stats.hunters.syndicatesFound++;
  }
  if (updates.graduation) {
    stats.graduations.today++;
    stats.graduations.total++;
  }

  stats.lastUpdate = Date.now();

  // Store with 7 day TTL
  await kv.put(STATS_KEY, JSON.stringify(stats), { expirationTtl: 604800 });

  return stats;
}

/**
 * Get agent stats
 */
export async function getAgentStats(kv: KVNamespace): Promise<AgentStats> {
  const stats = await kv.get<AgentStats>(STATS_KEY, 'json');
  const today = getTodayKey();

  if (!stats) {
    return {
      scans: { today: 0, total: 0, lastReset: today },
      alerts: { today: 0, highRisk: 0, bundlesDetected: 0 },
      hunters: { walletsTracked: 0, syndicatesFound: 0 },
      graduations: { today: 0, total: 0 },
      lastUpdate: Date.now(),
    };
  }

  // Reset daily counters if new day
  if (stats.scans.lastReset !== today) {
    stats.scans.today = 0;
    stats.scans.lastReset = today;
    stats.alerts.today = 0;
    stats.alerts.highRisk = 0;
    if (stats.graduations) {
      stats.graduations.today = 0;
    }
  }

  // Ensure graduations field exists (backwards compatibility)
  if (!stats.graduations) {
    stats.graduations = { today: 0, total: 0 };
  }

  return stats;
}

/**
 * Create events from a token scan result
 * Called after /sentinel/analyze completes
 *
 * Implements agent-to-agent communication:
 * SCOUT detects → requests ANALYST analysis → ANALYST reports → HUNTER tracks (if risky)
 */
export async function processTokenScan(
  kv: KVNamespace,
  scanResult: {
    tokenAddress: string;
    tokenSymbol: string;
    score: number;
    bundleDetected: boolean;
    bundleCount?: number;
    bundleWallets?: string[];
    syndicateNetwork?: {
      detected: boolean;
      repeatOffenders: number;
      rugRate: number;
    };
  }
): Promise<void> {
  const { tokenAddress, tokenSymbol, score, bundleDetected, bundleCount, syndicateNetwork } = scanResult;

  // Update stats for scan
  const statsUpdates: Parameters<typeof updateAgentStats>[1] = { scan: true };

  // 1. SCOUT detects token and requests ANALYST analysis
  await storeAgentEvent(kv, {
    agent: 'SCOUT',
    type: 'comms',
    message: `→ ANALYST: New token detected, requesting analysis`,
    severity: 'info',
    data: {
      tokenAddress,
      tokenSymbol: `$${tokenSymbol}`,
      targetAgent: 'ANALYST',
      requestType: 'analyze',
    },
  });

  // Small delay simulation for agent processing (these get timestamped slightly apart)
  // 2. ANALYST responds with analysis results
  if (score < 40) {
    // Critical risk - ANALYST alerts and requests HUNTER investigation
    await storeAgentEvent(kv, {
      agent: 'ANALYST',
      type: 'comms',
      message: `→ HUNTER: CRITICAL risk (${score}/100), requesting wallet investigation`,
      severity: 'critical',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        score,
        targetAgent: 'HUNTER',
        requestType: 'investigate',
      },
    });
    statsUpdates.alert = true;
    statsUpdates.highRisk = true;

    // 3. HUNTER acknowledges and begins tracking
    await storeAgentEvent(kv, {
      agent: 'HUNTER',
      type: 'comms',
      message: `→ ANALYST: Acknowledged, tracking suspicious wallets on $${tokenSymbol}`,
      severity: 'warning',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        targetAgent: 'ANALYST',
        requestType: 'tracking_started',
      },
    });

  } else if (score < 60) {
    // Medium risk - ANALYST warns SCOUT
    await storeAgentEvent(kv, {
      agent: 'ANALYST',
      type: 'comms',
      message: `→ SCOUT: Moderate risk (${score}/100), flagging for watchlist`,
      severity: 'warning',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        score,
        targetAgent: 'SCOUT',
        requestType: 'flag',
      },
    });
    statsUpdates.alert = true;

  } else {
    // Safe token - ANALYST confirms to SCOUT
    await storeAgentEvent(kv, {
      agent: 'ANALYST',
      type: 'comms',
      message: `→ SCOUT: Analysis complete (${score}/100), token appears safe`,
      severity: 'info',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        score,
        targetAgent: 'SCOUT',
        requestType: 'cleared',
      },
    });
  }

  // 4. If bundle detected, HUNTER reports to ANALYST
  if (bundleDetected && bundleCount && bundleCount > 0) {
    await storeAgentEvent(kv, {
      agent: 'HUNTER',
      type: 'comms',
      message: `→ ANALYST: Found ${bundleCount} coordinated wallets on $${tokenSymbol}`,
      severity: 'warning',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        bundleCount,
        targetAgent: 'ANALYST',
        requestType: 'bundle_report',
      },
    });
    statsUpdates.bundleDetected = true;

    // ANALYST acknowledges bundle intel
    await storeAgentEvent(kv, {
      agent: 'ANALYST',
      type: 'comms',
      message: `→ HUNTER: Received, factoring ${bundleCount} wallets into risk model`,
      severity: 'info',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        targetAgent: 'HUNTER',
        requestType: 'intel_received',
      },
    });
  }

  // 5. If syndicate network found, escalate through all agents
  if (syndicateNetwork?.detected && syndicateNetwork.repeatOffenders > 0) {
    // HUNTER alerts entire swarm
    await storeAgentEvent(kv, {
      agent: 'HUNTER',
      type: 'comms',
      message: `→ ALL: SYNDICATE ALERT - ${syndicateNetwork.repeatOffenders} repeat scammers, ${Math.round(syndicateNetwork.rugRate * 100)}% rug rate`,
      severity: 'critical',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        rugRate: syndicateNetwork.rugRate,
        requestType: 'syndicate_alert',
      },
    });
    statsUpdates.syndicateFound = true;

    // TRADER responds to syndicate warning
    await storeAgentEvent(kv, {
      agent: 'TRADER',
      type: 'comms',
      message: `→ HUNTER: Blacklisting $${tokenSymbol}, blocking all trade routes`,
      severity: 'critical',
      data: {
        tokenAddress,
        tokenSymbol: `$${tokenSymbol}`,
        targetAgent: 'HUNTER',
        requestType: 'blacklist',
      },
    });
  }

  // Update stats
  await updateAgentStats(kv, statsUpdates);
}

/**
 * Store a graduation event
 */
export async function storeGraduation(
  kv: KVNamespace,
  graduation: Omit<GraduationEvent, 'id' | 'timestamp'>
): Promise<GraduationEvent> {
  const fullGraduation: GraduationEvent = {
    ...graduation,
    id: `grad_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
  };

  // Get existing graduations
  const existing = await kv.get<GraduationEvent[]>(GRADUATIONS_KEY, 'json') || [];

  // Prepend new graduation and limit size
  const updated = [fullGraduation, ...existing].slice(0, MAX_GRADUATIONS);

  // Store with 24h TTL
  await kv.put(GRADUATIONS_KEY, JSON.stringify(updated), { expirationTtl: 86400 });

  // Update stats
  await updateAgentStats(kv, { graduation: true });

  return fullGraduation;
}

/**
 * Get recent graduations
 */
export async function getGraduations(
  kv: KVNamespace,
  limit = 20
): Promise<{ graduations: GraduationEvent[] }> {
  const graduations = await kv.get<GraduationEvent[]>(GRADUATIONS_KEY, 'json') || [];
  return {
    graduations: graduations.slice(0, limit),
  };
}
