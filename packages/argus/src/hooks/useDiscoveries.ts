/**
 * useDiscoveries Hook
 *
 * Polls the Workers API for agent-discovered tokens.
 * Returns full DiscoveryResult objects for display and trading.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// DiscoveryResult matching the agent-side interface
export interface DiscoveryResult {
  id: string;
  token: string;
  timestamp: number;

  market: {
    price: string | null;
    marketCap: number | null;
    liquidity: number | null;
    volume24h: number | null;
    priceChange24h: number | null;
    buys24h: number;
    sells24h: number;
    pairAddress: string | null;
    dexId: string | null;
    url: string | null;
  };

  tokenInfo: {
    name: string | null;
    symbol: string | null;
    decimals: number;
    supply: number;
    creator: string | null;
    mintAuthority: boolean;
    freezeAuthority: boolean;
  };

  analysis: {
    verdict: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
    confidence: number;
    score: number;
    summary: string;
    reasoning: string;
    attackVector: string | null;
    recommendations: string[];
    findings: Array<{
      category: string;
      finding: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      evidence: string;
    }>;
  };

  holders: {
    total: number;
    top10Concentration: number;
    giniCoefficient: number;
    topHolders: Array<{
      address: string;
      percent: number;
      isLP: boolean;
      isBundle: boolean;
    }>;
  };

  bundles: {
    detected: boolean;
    count: number;
    controlPercent: number;
    wallets: string[];
    assessment: string;
  };

  lp: {
    locked: boolean;
    burned: boolean;
    amount: number | null;
  };
}

interface UseDiscoveriesOptions {
  enabled?: boolean;
  interval?: number;  // ms between polls (default: 5000)
  limit?: number;     // max discoveries to fetch (default: 20)
}

interface UseDiscoveriesReturn {
  discoveries: DiscoveryResult[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const getApiBaseUrl = (): string => {
  // Always use production Workers API for live agent data
  return 'https://argusguard-api.hermosillo-jessie.workers.dev';
};

export function useDiscoveries(options: UseDiscoveriesOptions = {}): UseDiscoveriesReturn {
  const {
    enabled = true,
    interval = 5000,
    limit = 20,
  } = options;

  const [discoveries, setDiscoveries] = useState<DiscoveryResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchDiscoveries = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await fetch(`${getApiBaseUrl()}/agents/discoveries?limit=${limit}`);
      if (!response.ok) throw new Error(`Discoveries ${response.status}`);

      const data = await response.json() as { discoveries: DiscoveryResult[] };
      if (mountedRef.current) {
        setDiscoveries(data.discoveries || []);
        setError(null);
        setIsLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch discoveries');
        setIsLoading(false);
      }
    }
  }, [enabled, limit]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchDiscoveries();
  }, [fetchDiscoveries]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      fetchDiscoveries();
    }
    return () => { mountedRef.current = false; };
  }, [enabled, fetchDiscoveries]);

  // Polling
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(fetchDiscoveries, interval);
    return () => clearInterval(timer);
  }, [enabled, interval, fetchDiscoveries]);

  return { discoveries, isLoading, error, refresh };
}
