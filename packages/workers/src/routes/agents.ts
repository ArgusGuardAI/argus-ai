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
import { getAgentEvents, getAgentStats, storeAgentEvent, updateAgentStats, storeGraduation, getGraduations, type AgentEvent, type AgentStats, type GraduationEvent } from '../services/agent-events';

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
      type: 'analyze' | 'track_wallet' | 'monitor_alert';
      tokenAddress?: string;
      walletAddress?: string;
      priority?: 'high' | 'normal';
      alert?: {
        agent: 'SCOUT' | 'ANALYST' | 'HUNTER' | 'TRADER';
        type: 'scan' | 'alert' | 'discovery' | 'analysis' | 'graduation';
        message: string;
        severity: 'info' | 'warning' | 'critical';
        data?: {
          mint?: string;
          dex?: string;
          poolAddress?: string;
          suspicionScore?: number;
          reasons?: string[];
          graduatedFrom?: string;
          bondingCurveTime?: number;
        };
      };
    }>();

    if (!body.type) {
      return c.json({ error: 'Missing command type' }, 400);
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
                    tokenSymbol: alert.data?.dex ? `${alert.data.dex}` : undefined,
                    score: alert.data?.suspicionScore,
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
