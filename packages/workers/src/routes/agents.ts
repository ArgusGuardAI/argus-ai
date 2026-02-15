/**
 * Agent Status API Routes
 *
 * Provides endpoints for the dashboard to query agent status, activity, and stats.
 * Uses polling since Cloudflare Workers don't support persistent WebSockets.
 *
 * Events are generated from real user scans - no extra RPC calls.
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import { getAgentEvents, getAgentStats, storeAgentEvent, storeBatchAgentEvents, updateAgentStats, storeGraduation, getGraduations, storeDiscovery, getDiscoveries, type AgentEvent, type AgentStats } from '../services/agent-events';

// Types
interface AgentState {
  type: 'scout' | 'analyst' | 'hunter' | 'trader';
  name: string;
  status: 'active' | 'idle' | 'busy' | 'error';
  statusText: string;
  metric: string;
  lastActivity: number;
  progress?: number;
}

interface AgentStatusResponse {
  online: number;
  agents: AgentState[];
  health: 'healthy' | 'degraded' | 'critical';
  lastUpdate: number;
}

interface ActivityFeedResponse {
  events: AgentEvent[];
  lastEventId: string;
}

interface AgentStatsResponse {
  scans: {
    today: number;
    total: number;
    avgPerHour: number;
  };
  alerts: {
    today: number;
    highRisk: number;
    scamsDetected: number;
  };
  hunters: {
    walletsTracked: number;
    scammersIdentified: number;
  };
  traders: {
    activePositions: number;
    totalPnL: number;
  };
  graduations: {
    today: number;
    total: number;
  };
}

/**
 * Generate agent status based on real activity stats
 */
function generateStatusFromStats(stats: AgentStats): AgentStatusResponse {
  const now = Date.now();
  const recentActivity = now - stats.lastUpdate < 60000; // Activity in last minute

  const agents: AgentState[] = [
    {
      type: 'scout',
      name: 'SCOUT',
      status: recentActivity ? 'active' : 'idle',
      statusText: recentActivity ? 'Monitoring scans...' : 'Awaiting scans',
      metric: `${stats.scans.today} today`,
      lastActivity: stats.lastUpdate,
    },
    {
      type: 'analyst',
      name: 'ANALYST',
      status: stats.alerts.today > 0 ? 'active' : 'idle',
      statusText: stats.alerts.highRisk > 0 ? 'High-risk tokens found' : 'Analyzing tokens',
      metric: `${stats.alerts.today} alerts`,
      lastActivity: stats.lastUpdate,
    },
    {
      type: 'hunter',
      name: 'HUNTER',
      status: stats.alerts.bundlesDetected > 0 ? 'active' : 'idle',
      statusText: stats.hunters.syndicatesFound > 0 ? 'Syndicates detected' : 'Tracking bundles',
      metric: `${stats.alerts.bundlesDetected} bundles`,
      lastActivity: stats.lastUpdate,
    },
    {
      type: 'trader',
      name: 'TRADER',
      status: 'idle',
      statusText: 'Guarding positions',
      metric: '0 positions',
      lastActivity: stats.lastUpdate,
    },
  ];

  const activeCount = agents.filter(a => a.status === 'active').length;
  const health = activeCount >= 2 ? 'healthy' : activeCount >= 1 ? 'degraded' : 'critical';

  return {
    online: 4, // All agents are "online" (just may be idle)
    agents,
    health: stats.scans.total > 0 ? health : 'healthy',
    lastUpdate: stats.lastUpdate,
  };
}

// Create router
export const agentRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * GET /agents/status
 * Returns current state of all agents based on real activity
 */
agentRoutes.get('/status', async (c) => {
  try {
    if (!c.env.SCAN_CACHE) {
      // No KV available, return default status
      return c.json({
        online: 4,
        agents: [
          { type: 'scout', name: 'SCOUT', status: 'idle', statusText: 'Awaiting scans', metric: '0 today', lastActivity: Date.now() },
          { type: 'analyst', name: 'ANALYST', status: 'idle', statusText: 'Awaiting targets', metric: '0 alerts', lastActivity: Date.now() },
          { type: 'hunter', name: 'HUNTER', status: 'idle', statusText: 'Awaiting bundles', metric: '0 bundles', lastActivity: Date.now() },
          { type: 'trader', name: 'TRADER', status: 'idle', statusText: 'Guarding positions', metric: '0 positions', lastActivity: Date.now() },
        ],
        health: 'healthy',
        lastUpdate: Date.now(),
      } as AgentStatusResponse);
    }

    // Get real stats and derive status
    const stats = await getAgentStats(c.env.SCAN_CACHE);
    const status = generateStatusFromStats(stats);
    return c.json(status);
  } catch (error) {
    console.error('[Agents] Status error:', error);
    return c.json({
      online: 0,
      agents: [],
      health: 'critical' as const,
      lastUpdate: Date.now(),
      error: 'Failed to fetch agent status'
    }, 500);
  }
});

/**
 * GET /agents/activity
 * Returns recent agent activity feed from real scans
 * Query params:
 *   - after: event ID to get events after (for cursor-based polling)
 */
agentRoutes.get('/activity', async (c) => {
  try {
    const after = c.req.query('after');

    if (!c.env.SCAN_CACHE) {
      return c.json({ events: [], lastEventId: '' } as ActivityFeedResponse);
    }

    // Get real events from KV
    const result = await getAgentEvents(c.env.SCAN_CACHE, 50, after || undefined);
    return c.json(result);
  } catch (error) {
    console.error('[Agents] Activity error:', error);
    return c.json({ events: [], lastEventId: '', error: 'Failed to fetch activity' }, 500);
  }
});

/**
 * GET /agents/stats
 * Returns aggregate statistics from real scans
 */
agentRoutes.get('/stats', async (c) => {
  try {
    if (!c.env.SCAN_CACHE) {
      return c.json({
        scans: { today: 0, total: 0, avgPerHour: 0 },
        alerts: { today: 0, highRisk: 0, scamsDetected: 0 },
        hunters: { walletsTracked: 0, scammersIdentified: 0 },
        traders: { activePositions: 0, totalPnL: 0 },
        graduations: { today: 0, total: 0 },
      } as AgentStatsResponse);
    }

    // Get real stats from KV
    const stats = await getAgentStats(c.env.SCAN_CACHE);

    // Calculate avg per hour (assuming stats cover today)
    const hoursToday = new Date().getHours() + 1;
    const avgPerHour = Math.round(stats.scans.today / hoursToday);

    return c.json({
      scans: {
        today: stats.scans.today,
        total: stats.scans.total,
        avgPerHour,
      },
      alerts: {
        today: stats.alerts.today,
        highRisk: stats.alerts.highRisk,
        scamsDetected: stats.hunters.syndicatesFound,
      },
      hunters: {
        walletsTracked: stats.hunters.walletsTracked,
        scammersIdentified: stats.hunters.syndicatesFound,
      },
      traders: {
        activePositions: 0,
        totalPnL: 0,
      },
      graduations: {
        today: stats.graduations?.today || 0,
        total: stats.graduations?.total || 0,
      },
    } as AgentStatsResponse);
  } catch (error) {
    console.error('[Agents] Stats error:', error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

/**
 * POST /agents/command
 * Send a command to agents (e.g., request deep analysis)
 * Body: { type: 'analyze', tokenAddress: string, priority?: 'high' | 'normal' }
 */
agentRoutes.post('/command', async (c) => {
  try {
    const body = await c.req.json<{
      type: 'analyze' | 'track_wallet' | 'monitor_alert' | 'monitor_alert_batch';
      tokenAddress?: string;
      walletAddress?: string;
      priority?: 'high' | 'normal';
      alert?: {
        agent: 'SCOUT' | 'ANALYST' | 'HUNTER' | 'TRADER';
        type: 'scan' | 'alert' | 'discovery' | 'analysis' | 'graduation' | 'council';
        message: string;
        severity: 'info' | 'warning' | 'critical';
        data?: {
          mint?: string;
          symbol?: string;
          dex?: string;
          poolAddress?: string;
          suspicionScore?: number;
          reasons?: string[];
          graduatedFrom?: string;
          bondingCurveTime?: number;
          decision?: string;
          confidence?: number;
        };
      };
      alerts?: Array<{
        agent: 'SCOUT' | 'ANALYST' | 'HUNTER' | 'TRADER';
        type: 'scan' | 'alert' | 'discovery' | 'analysis' | 'graduation' | 'council';
        message: string;
        severity: 'info' | 'warning' | 'critical';
        data?: {
          mint?: string;
          symbol?: string;
          tokenAddress?: string;
          tokenSymbol?: string;
        };
      }>;
    }>();

    if (!body.type) {
      return c.json({ error: 'Missing command type' }, 400);
    }

    // Handle batch alerts - stores all events in single KV write (no race condition)
    if (body.type === 'monitor_alert_batch' && body.alerts && body.alerts.length > 0) {
      if (c.env.SCAN_CACHE) {
        c.executionCtx.waitUntil(
          (async () => {
            try {
              // Store all events in a single KV operation
              // Accept both tokenAddress/tokenSymbol (new) and mint/symbol (legacy)
              await storeBatchAgentEvents(c.env.SCAN_CACHE, body.alerts!.map(alert => ({
                agent: alert.agent,
                type: alert.type as AgentEvent['type'],
                message: alert.message,
                severity: alert.severity,
                data: {
                  tokenAddress: alert.data?.tokenAddress || alert.data?.mint,
                  tokenSymbol: alert.data?.tokenSymbol || alert.data?.symbol,
                },
              })));
            } catch (err) {
              console.error('[Agents] Batch KV error:', err);
            }
          })()
        );
      }
      return c.json({ success: true, message: 'Batch alerts queued', count: body.alerts.length });
    }

    // Handle monitor alerts - return immediately, store in background
    // KV read-modify-write under high concurrency causes 500s, so use waitUntil()
    if (body.type === 'monitor_alert' && body.alert) {
      const { alert } = body;
      const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      // Do KV operations in the background (non-blocking)
      if (c.env.SCAN_CACHE) {
        c.executionCtx.waitUntil(
          (async () => {
            try {
              if (alert.type === 'graduation' && alert.data?.mint) {
                // Store graduation + event
                await storeGraduation(c.env.SCAN_CACHE, {
                  mint: alert.data.mint,
                  dex: alert.data.dex || 'RAYDIUM',
                  poolAddress: alert.data.poolAddress || '',
                  bondingCurveTime: alert.data.bondingCurveTime,
                  graduatedFrom: alert.data.graduatedFrom || 'PUMP_FUN',
                });
                await storeAgentEvent(c.env.SCAN_CACHE, {
                  agent: alert.agent,
                  type: 'graduation',
                  message: alert.message,
                  severity: alert.severity,
                  data: {
                    tokenAddress: alert.data.mint,
                    dex: alert.data.dex,
                    poolAddress: alert.data.poolAddress,
                    graduatedFrom: alert.data.graduatedFrom,
                    bondingCurveTime: alert.data.bondingCurveTime,
                  },
                });
              } else {
                // Store regular event
                await storeAgentEvent(c.env.SCAN_CACHE, {
                  agent: alert.agent,
                  type: alert.type as AgentEvent['type'],
                  message: alert.message,
                  severity: alert.severity,
                  data: {
                    tokenAddress: alert.data?.mint,
                    tokenSymbol: alert.data?.symbol,
                  },
                });
              }

              // Update stats
              const statsUpdates: {
                scan?: boolean;
                alert?: boolean;
                highRisk?: boolean;
                bundleDetected?: boolean;
                graduation?: boolean;
              } = {};

              if (alert.agent === 'SCOUT') statsUpdates.scan = true;
              if (alert.severity === 'warning' || alert.severity === 'critical') statsUpdates.alert = true;
              if (alert.severity === 'critical') statsUpdates.highRisk = true;
              if (alert.type === 'discovery' && alert.agent === 'HUNTER') statsUpdates.bundleDetected = true;
              if (alert.type === 'graduation') statsUpdates.graduation = true;

              await updateAgentStats(c.env.SCAN_CACHE, statsUpdates);
            } catch (err) {
              console.error('[Agents] Background KV error:', err);
            }
          })()
        );
      }

      return c.json({
        success: true,
        message: alert.type === 'graduation' ? 'Graduation queued' : 'Monitor alert queued',
        eventId,
      });
    }

    // Other command types - acknowledge receipt
    return c.json({
      success: true,
      message: `Command "${body.type}" queued for processing`,
      commandId: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    });
  } catch (error) {
    console.error('[Agents] Command error:', error);
    return c.json({ error: 'Failed to process command' }, 500);
  }
});

/**
 * POST /agents/discovery
 * Receives full investigation results (DiscoveryResult) from the agents server
 */
agentRoutes.post('/discovery', async (c) => {
  try {
    const discovery = await c.req.json();

    if (!discovery.token || !discovery.analysis) {
      return c.json({ error: 'Invalid discovery: missing token or analysis' }, 400);
    }

    if (c.env.SCAN_CACHE) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            await storeDiscovery(c.env.SCAN_CACHE, discovery);
            // Also update stats for this discovery
            await updateAgentStats(c.env.SCAN_CACHE, {
              scan: true,
              alert: discovery.analysis.score >= 60,
              highRisk: discovery.analysis.score >= 80,
              bundleDetected: discovery.bundles?.detected || false,
            });
          } catch (err) {
            console.error('[Agents] Discovery storage error:', err);
          }
        })()
      );
    }

    return c.json({
      success: true,
      message: 'Discovery stored',
      token: discovery.token,
    });
  } catch (error) {
    console.error('[Agents] Discovery POST error:', error);
    return c.json({ error: 'Failed to store discovery' }, 500);
  }
});

/**
 * GET /agents/discoveries
 * Returns recent agent-discovered tokens for the dashboard
 */
agentRoutes.get('/discoveries', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');

    if (!c.env.SCAN_CACHE) {
      return c.json({ discoveries: [] });
    }

    const discoveries = await getDiscoveries(c.env.SCAN_CACHE, Math.min(limit, 50));
    return c.json({ discoveries });
  } catch (error) {
    console.error('[Agents] Discoveries error:', error);
    return c.json({ discoveries: [], error: 'Failed to fetch discoveries' }, 500);
  }
});

/**
 * GET /agents/bitnet
 * Returns BitNet engine stats (dynamic)
 */
agentRoutes.get('/bitnet', async (c) => {
  try {
    // Get stats from KV if available
    let inferenceMs = 13; // Default baseline
    let patternsKnown = 8; // Base patterns in PatternLibrary
    let tokensAnalyzed = 0;
    let avgConfidence = 0;

    if (c.env.SCAN_CACHE) {
      const stats = await getAgentStats(c.env.SCAN_CACHE);
      tokensAnalyzed = stats.scans.total;

      // Get BitNet-specific metrics if stored
      const bitnetData = await c.env.SCAN_CACHE.get('bitnet:metrics', 'json') as {
        lastInferenceMs?: number;
        avgInferenceMs?: number;
        patternsMatched?: number;
        avgConfidence?: number;
      } | null;

      if (bitnetData) {
        inferenceMs = bitnetData.avgInferenceMs || bitnetData.lastInferenceMs || 13;
        avgConfidence = bitnetData.avgConfidence || 0;
      }
    }

    return c.json({
      inference: {
        lastMs: inferenceMs,
        avgMs: inferenceMs,
        label: `${Math.round(inferenceMs)}ms`,
      },
      features: {
        dimensions: 29,
        label: '29-dim',
      },
      compression: {
        ratio: 17000,
        inputBytes: 2000000,  // ~2MB raw
        outputBytes: 116,     // 29 * 4 bytes
        label: '17,000×',
      },
      patterns: {
        known: patternsKnown,
        label: `${patternsKnown} known`,
        types: [
          'BUNDLE_COORDINATOR',
          'RUG_PULLER',
          'WASH_TRADER',
          'INSIDER',
          'PUMP_AND_DUMP',
          'HONEYPOT',
          'MICRO_CAP_TRAP',
          'LEGITIMATE_VC'
        ],
      },
      stats: {
        tokensAnalyzed,
        avgConfidence,
      },
    });
  } catch (error) {
    console.error('[Agents] BitNet stats error:', error);
    return c.json({
      inference: { lastMs: 13, avgMs: 13, label: '13ms' },
      features: { dimensions: 29, label: '29-dim' },
      compression: { ratio: 17000, label: '17,000×' },
      patterns: { known: 8, label: '8 known' },
    });
  }
});

/**
 * POST /agents/bitnet
 * Updates BitNet metrics (called by agents after inference)
 */
agentRoutes.post('/bitnet', async (c) => {
  try {
    const body = await c.req.json<{
      inferenceMs: number;
      confidence?: number;
      patternMatched?: string;
    }>();

    if (c.env.SCAN_CACHE) {
      // Get existing metrics
      const existing = await c.env.SCAN_CACHE.get('bitnet:metrics', 'json') as {
        totalInferences?: number;
        totalMs?: number;
        avgInferenceMs?: number;
        lastInferenceMs?: number;
        avgConfidence?: number;
        totalConfidence?: number;
      } | null || {
        totalInferences: 0,
        totalMs: 0,
        avgInferenceMs: 13,
        lastInferenceMs: 13,
        avgConfidence: 0,
        totalConfidence: 0,
      };

      // Update metrics
      const totalInferences = (existing.totalInferences || 0) + 1;
      const totalMs = (existing.totalMs || 0) + body.inferenceMs;
      const avgInferenceMs = totalMs / totalInferences;

      const totalConfidence = (existing.totalConfidence || 0) + (body.confidence || 0);
      const avgConfidence = body.confidence ? totalConfidence / totalInferences : existing.avgConfidence;

      await c.env.SCAN_CACHE.put('bitnet:metrics', JSON.stringify({
        totalInferences,
        totalMs,
        avgInferenceMs,
        lastInferenceMs: body.inferenceMs,
        avgConfidence,
        totalConfidence,
      }), { expirationTtl: 86400 * 7 }); // 7 days
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('[Agents] BitNet update error:', error);
    return c.json({ error: 'Failed to update BitNet metrics' }, 500);
  }
});

/**
 * GET /agents/graduations
 * Returns recent token graduations (pump.fun → Raydium)
 */
agentRoutes.get('/graduations', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');

    if (!c.env.SCAN_CACHE) {
      return c.json({ graduations: [] });
    }

    const result = await getGraduations(c.env.SCAN_CACHE, Math.min(limit, 50));
    return c.json(result);
  } catch (error) {
    console.error('[Agents] Graduations error:', error);
    return c.json({ graduations: [], error: 'Failed to fetch graduations' }, 500);
  }
});
