/**
 * useAgentStatus Hook
 *
 * Provides polling-based real-time agent status, activity feed, and stats.
 * Uses configurable intervals and handles offline/error states gracefully.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Types matching the API response
export interface AgentState {
  type: 'scout' | 'analyst' | 'hunter' | 'trader';
  name: string;
  status: 'active' | 'idle' | 'busy' | 'error';
  statusText: string;
  metric: string;
  lastActivity: number;
  progress?: number;
}

export interface AgentStatusResponse {
  online: number;
  agents: AgentState[];
  health: 'healthy' | 'degraded' | 'critical';
  lastUpdate: number;
}

export interface ActivityEvent {
  id: string;
  timestamp: number;
  agent: string;
  type: 'scan' | 'alert' | 'analysis' | 'trade' | 'discovery' | 'comms';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  data?: {
    tokenAddress?: string;
    tokenSymbol?: string;
    score?: number;
    walletAddress?: string;
    targetAgent?: string;
    requestType?: string;
  };
}

export interface ActivityFeedResponse {
  events: ActivityEvent[];
  lastEventId: string;
}

export interface AgentStatsResponse {
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
  graduations?: {
    today: number;
    total: number;
  };
}

export interface Graduation {
  id: string;
  timestamp: number;
  mint: string;
  dex: string;
  poolAddress: string;
  bondingCurveTime?: number;
  graduatedFrom: string;
}

export interface GraduationsResponse {
  graduations: Graduation[];
}

interface UseAgentStatusOptions {
  enabled?: boolean;
  statusInterval?: number;      // ms between status polls (default: 3000)
  activityInterval?: number;    // ms between activity polls (default: 1000) - FAST!
  statsInterval?: number;       // ms between stats polls (default: 30000)
  graduationsInterval?: number; // ms between graduations polls (default: 5000)
  maxActivityEvents?: number;   // max events to keep in state (default: 100)
}

interface UseAgentStatusReturn {
  // Data
  status: AgentStatusResponse | null;
  activity: ActivityEvent[];
  stats: AgentStatsResponse | null;
  graduations: Graduation[];

  // State
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
  lastUpdate: number | null;

  // Actions
  refresh: () => Promise<void>;
  clearActivity: () => void;
}

// API base URL - always use production for live agent data
const getApiBaseUrl = (): string => {
  // Use production Workers API for live agent data
  return 'https://argusguard-api.hermosillo-jessie.workers.dev';
};

export function useAgentStatus(options: UseAgentStatusOptions = {}): UseAgentStatusReturn {
  const {
    enabled = true,
    statusInterval = 3000,
    activityInterval = 1000,  // Poll every 1 second for fast updates
    statsInterval = 30000,
    graduationsInterval = 5000,
    maxActivityEvents = 100,
  } = options;

  // State
  const [status, setStatus] = useState<AgentStatusResponse | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [stats, setStats] = useState<AgentStatsResponse | null>(null);
  const [graduations, setGraduations] = useState<Graduation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  // Refs for tracking
  const lastEventIdRef = useRef<string>('');
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const clearedAtRef = useRef<number>(0); // Track when user cleared the feed

  // Fetch agent status
  const fetchStatus = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await fetch(`${getApiBaseUrl()}/agents/status`);
      if (!response.ok) throw new Error(`Status ${response.status}`);

      const data: AgentStatusResponse = await response.json();
      if (mountedRef.current) {
        setStatus(data);
        setIsConnected(true);
        setError(null);
        setLastUpdate(Date.now());
      }
    } catch (err) {
      if (mountedRef.current) {
        setIsConnected(false);
        setError(err instanceof Error ? err.message : 'Failed to fetch status');
      }
    }
  }, [enabled]);

  // Fetch activity with deduplication
  const fetchActivity = useCallback(async () => {
    if (!enabled) return;

    try {
      const url = lastEventIdRef.current
        ? `${getApiBaseUrl()}/agents/activity?after=${lastEventIdRef.current}`
        : `${getApiBaseUrl()}/agents/activity`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Activity ${response.status}`);

      const data: ActivityFeedResponse = await response.json();
      if (mountedRef.current && data.events.length > 0) {
        // Filter out events before user cleared, then deduplicate
        const newEvents = data.events
          .filter(e => e.timestamp > clearedAtRef.current)
          .filter(e => !seenEventIdsRef.current.has(e.id));

        if (newEvents.length > 0) {
          // Track seen events
          newEvents.forEach(e => seenEventIdsRef.current.add(e.id));

          // Limit size of seen set
          if (seenEventIdsRef.current.size > maxActivityEvents * 2) {
            const arr = Array.from(seenEventIdsRef.current);
            seenEventIdsRef.current = new Set(arr.slice(-maxActivityEvents));
          }

          // Update activity state
          setActivity(prev => {
            const combined = [...newEvents, ...prev];
            return combined.slice(0, maxActivityEvents);
          });

          // Update cursor
          lastEventIdRef.current = data.lastEventId;
        }
      }
    } catch (err) {
      console.error('[useAgentStatus] Activity fetch error:', err);
    }
  }, [enabled, maxActivityEvents]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await fetch(`${getApiBaseUrl()}/agents/stats`);
      if (!response.ok) throw new Error(`Stats ${response.status}`);

      const data: AgentStatsResponse = await response.json();
      if (mountedRef.current) {
        setStats(data);
      }
    } catch (err) {
      console.error('[useAgentStatus] Stats fetch error:', err);
    }
  }, [enabled]);

  // Fetch graduations
  const fetchGraduations = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await fetch(`${getApiBaseUrl()}/agents/graduations`);
      if (!response.ok) throw new Error(`Graduations ${response.status}`);

      const data: GraduationsResponse = await response.json();
      if (mountedRef.current) {
        setGraduations(data.graduations || []);
      }
    } catch (err) {
      console.error('[useAgentStatus] Graduations fetch error:', err);
    }
  }, [enabled]);

  // Refresh all data
  const refresh = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchStatus(), fetchActivity(), fetchStats(), fetchGraduations()]);
    setIsLoading(false);
  }, [fetchStatus, fetchActivity, fetchStats, fetchGraduations]);

  // Clear activity - sets a timestamp so old events won't reappear
  const clearActivity = useCallback(() => {
    setActivity([]);
    seenEventIdsRef.current.clear();
    lastEventIdRef.current = '';
    clearedAtRef.current = Date.now();
  }, []);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      refresh();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, refresh]);

  // Status polling
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(fetchStatus, statusInterval);
    return () => clearInterval(interval);
  }, [enabled, statusInterval, fetchStatus]);

  // Activity polling
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(fetchActivity, activityInterval);
    return () => clearInterval(interval);
  }, [enabled, activityInterval, fetchActivity]);

  // Stats polling
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(fetchStats, statsInterval);
    return () => clearInterval(interval);
  }, [enabled, statsInterval, fetchStats]);

  // Graduations polling
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(fetchGraduations, graduationsInterval);
    return () => clearInterval(interval);
  }, [enabled, graduationsInterval, fetchGraduations]);

  return {
    status,
    activity,
    stats,
    graduations,
    isLoading,
    isConnected,
    error,
    lastUpdate,
    refresh,
    clearActivity,
  };
}
