import { useState, useEffect, useCallback } from 'react';
import { useAutoTrade } from './hooks/useAutoTrade';

type SignalType = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'AVOID';

const SIGNAL_BG: Record<SignalType, string> = {
  STRONG_BUY: 'bg-green-500 text-white',
  BUY: 'bg-emerald-500 text-white',
  WATCH: 'bg-yellow-500 text-white',
  HOLD: 'bg-gray-400 text-white',
  AVOID: 'bg-red-500 text-white',
};

const SIGNAL_COLORS: Record<SignalType, string> = {
  STRONG_BUY: '#22c55e',
  BUY: '#10b981',
  WATCH: '#eab308',
  HOLD: '#9ca3af',
  AVOID: '#ef4444',
};

// Loading skeleton component
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-800 rounded ${className}`} />;
}

// Analysis loading skeleton
function AnalysisSkeleton() {
  return (
    <div className="space-y-6">
      {/* Token Header Skeleton */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-5">
            <Skeleton className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl" />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <div className="flex sm:block items-center gap-2">
            <Skeleton className="h-12 w-16" />
            <Skeleton className="h-4 w-16 mt-1" />
          </div>
        </div>
      </div>

      {/* Info Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="w-8 h-8 rounded-lg" />
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3, 4].map(j => (
                <div key={j} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Holders & AI Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="w-8 h-8 rounded-lg" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-4" />
                <Skeleton className="h-3 flex-1 rounded-full" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="w-8 h-8 rounded-lg" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Sparkline SVG component
function Sparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  if (!data || data.length < 2) return null;

  const width = 120;
  const padding = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Generate SVG path
  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  // Create gradient fill
  const fillPoints = [...points, `${width - padding},${height - padding}`, `${padding},${height - padding}`];
  const fillD = `M ${fillPoints.join(' L ')} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`sparkline-gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path
        d={fillD}
        fill={`url(#sparkline-gradient-${color.replace('#', '')})`}
      />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current price dot */}
      <circle
        cx={width - padding}
        cy={padding + (1 - (data[data.length - 1] - min) / range) * (height - padding * 2)}
        r="3"
        fill={color}
      />
    </svg>
  );
}

// Analysis result from /api/analyze-full
interface AnalysisResult {
  token: {
    address: string;
    name: string;
    symbol: string;
  };
  security: {
    mintAuthorityRevoked: boolean;
    freezeAuthorityRevoked: boolean;
    lpLockedPercent: number;
  };
  market: {
    price: number;
    marketCap: number;
    liquidity: number;
    volume24h: number;
    priceChange5m: number;
    priceChange1h: number;
    priceChange24h: number;
    sparkline?: number[];
  };
  trading: {
    buys5m: number;
    sells5m: number;
    buys1h: number;
    sells1h: number;
    buys24h: number;
    sells24h: number;
    buyRatio: number;
  };
  holders: {
    total: number;
    top10: Array<{
      address: string;
      percent: number;
      isBundle: boolean;
      bundleId?: number;
    }>;
    topHolderPercent: number;
    top5Percent: number;
    top10Percent: number;
  };
  bundles: {
    detected: boolean;
    count: number;
    totalPercent: number;
    wallets: string[];
  };
  ai: {
    signal: SignalType;
    score: number;
    verdict: string;
  };
  links: {
    website?: string;
    twitter?: string;
    telegram?: string;
    dexscreener: string;
  };
}

// Use production API or localhost for development
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8788'
  : 'https://argusguard-api.hermosillo-jessie.workers.dev';
const RECENT_SEARCHES_KEY = 'argus_recent_searches';
const WATCHLIST_KEY = 'argus_watchlist';

interface WatchlistItem {
  address: string;
  symbol: string;
  name: string;
  signal: SignalType;
  score: number;
  addedAt: number;
}

export default function App() {
  const [tokenInput, setTokenInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<Array<{ address: string; symbol: string }>>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [buyAmount, setBuyAmount] = useState(0.05);
  const [isBuying, setIsBuying] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: Date; msg: string; type: string }>>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showBuyConfig, setShowBuyConfig] = useState(false);

  // Wallet management
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [withdrawAddr, setWithdrawAddr] = useState('');
  const [walletName, setWalletName] = useState('Trading Wallet');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Backup modal state
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [newWalletKey, setNewWalletKey] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  // Export key and delete modal state
  const [exportKeyCopied, setExportKeyCopied] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const log = useCallback((msg: string, type = 'info') => {
    setLogs(prev => [...prev.slice(-49), { time: new Date(), msg, type }]);
  }, []);

  const autoTrade = useAutoTrade({}, undefined, log);

  // Load recent searches and watchlist from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) setRecentSearches(JSON.parse(saved));
    } catch {}
    try {
      const savedWatchlist = localStorage.getItem(WATCHLIST_KEY);
      if (savedWatchlist) setWatchlist(JSON.parse(savedWatchlist));
    } catch {}
  }, []);

  // Load wallet name when wallet is loaded
  useEffect(() => {
    if (autoTrade.wallet.isLoaded) {
      setWalletName(autoTrade.getWalletName());
    }
  }, [autoTrade.wallet.isLoaded, autoTrade.getWalletName]);

  // Save recent searches to localStorage
  const addRecentSearch = (address: string, symbol: string) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(s => s.address !== address);
      const updated = [{ address, symbol }, ...filtered].slice(0, 10);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // Watchlist functions
  const isInWatchlist = (address: string) => watchlist.some(w => w.address === address);

  const addToWatchlist = (result: AnalysisResult) => {
    if (isInWatchlist(result.token.address)) return;
    const item: WatchlistItem = {
      address: result.token.address,
      symbol: result.token.symbol,
      name: result.token.name,
      signal: result.ai.signal,
      score: result.ai.score,
      addedAt: Date.now(),
    };
    setWatchlist(prev => {
      const updated = [item, ...prev].slice(0, 20);
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(updated));
      return updated;
    });
    log(`Added ${result.token.symbol} to watchlist`, 'success');
  };

  const removeFromWatchlist = (address: string) => {
    setWatchlist(prev => {
      const updated = prev.filter(w => w.address !== address);
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // Analyze token
  const analyzeToken = async (address: string) => {
    if (!address.trim()) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      // Use different endpoint and payload format for local vs production
      const isLocal = window.location.hostname === 'localhost';
      const endpoint = isLocal ? '/api/analyze-full' : '/sentinel/analyze';
      const payload = isLocal
        ? { address: address.trim() }
        : { tokenAddress: address.trim() };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Analysis failed');
      }

      const data = await response.json();

      // Map Workers API response to our AnalysisResult format
      let result: AnalysisResult;

      if (isLocal) {
        result = data;
      } else {
        // Calculate holder percentages
        const holders = data.holderDistribution || [];
        const top10 = holders.slice(0, 10);
        const top5Percent = holders.slice(0, 5).reduce((sum: number, h: { percent: number }) => sum + h.percent, 0);
        const top10Percent = top10.reduce((sum: number, h: { percent: number }) => sum + h.percent, 0);

        // Invert risk score (API: higher = worse, we want: higher = better)
        const score = Math.max(0, 100 - (data.analysis?.riskScore || 50));
        const signal: SignalType = score >= 75 ? 'STRONG_BUY' :
                                   score >= 60 ? 'BUY' :
                                   score >= 45 ? 'WATCH' :
                                   score >= 30 ? 'HOLD' : 'AVOID';

        // Calculate buyRatio safely
        const buys24h = data.tokenInfo?.txns24h?.buys || 0;
        const sells24h = data.tokenInfo?.txns24h?.sells || 0;
        const buyRatio = sells24h > 0 ? buys24h / sells24h : (buys24h > 0 ? 2 : 1);

        result = {
          token: {
            address: data.tokenInfo?.address || address.trim(),
            name: data.tokenInfo?.name || 'Unknown',
            symbol: data.tokenInfo?.symbol || '???',
          },
          security: {
            mintAuthorityRevoked: true, // Default - API doesn't provide this
            freezeAuthorityRevoked: true,
            lpLockedPercent: 0,
          },
          market: {
            price: data.tokenInfo?.price || 0,
            marketCap: data.tokenInfo?.marketCap || 0,
            liquidity: data.tokenInfo?.liquidity || 0,
            volume24h: data.tokenInfo?.volume24h || 0,
            priceChange5m: 0,
            priceChange1h: 0,
            priceChange24h: data.tokenInfo?.priceChange24h || 0,
          },
          trading: {
            buys5m: 0,
            sells5m: 0,
            buys1h: 0,
            sells1h: 0,
            buys24h,
            sells24h,
            buyRatio,
          },
          holders: {
            total: data.tokenInfo?.holderCount || 0,
            top10: top10.map((h: { address: string; percent: number; type: string }) => ({
              address: h.address || '',
              percent: typeof h.percent === 'number' ? h.percent : 0,
              isBundle: h.type === 'insider' || h.type === 'whale',
            })),
            topHolderPercent: typeof holders[0]?.percent === 'number' ? holders[0].percent : 0,
            top5Percent: typeof top5Percent === 'number' ? top5Percent : 0,
            top10Percent: typeof top10Percent === 'number' ? top10Percent : 0,
          },
          bundles: {
            detected: data.bundleInfo?.detected || false,
            count: data.bundleInfo?.count || 0,
            totalPercent: typeof data.bundleInfo?.txBundlePercent === 'number' ? data.bundleInfo.txBundlePercent : 0,
            wallets: [],
          },
          ai: {
            signal,
            score,
            verdict: data.analysis?.summary || 'Analysis unavailable',
          },
          links: {
            website: data.tokenInfo?.website,
            twitter: data.tokenInfo?.twitter,
            telegram: data.tokenInfo?.telegram,
            dexscreener: `https://dexscreener.com/solana/${address.trim()}`,
          },
        };
      }

      setAnalysisResult(result);
      addRecentSearch(result.token.address, result.token.symbol);
      log(`Analyzed ${result.token.symbol}: ${result.ai.signal} (${result.ai.score})`, 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setAnalysisError(msg);
      log(`Analysis failed: ${msg}`, 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Buy token
  const handleBuy = async () => {
    if (!analysisResult || !autoTrade.wallet.isLoaded) return;

    setIsBuying(true);
    try {
      autoTrade.updateConfig({ buyAmountSol: buyAmount });
      const result = await autoTrade.executeTrade(
        analysisResult.token.address,
        analysisResult.token.symbol,
        analysisResult.ai.score
      );
      if (result.success) {
        log(`Bought ${analysisResult.token.symbol}!`, 'success');
      } else {
        log(`Buy failed: ${result.error}`, 'error');
      }
    } finally {
      setIsBuying(false);
    }
  };

  const fmt = (n?: number) => {
    if (n === undefined || n === null) return '--';
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  };

  const fmtPct = (n?: number) => {
    if (n === undefined || n === null) return '--';
    const sign = n >= 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
  };

  const pctColor = (n?: number) => {
    if (n === undefined || n === null) return 'text-zinc-500';
    return n >= 0 ? 'text-green-500' : 'text-red-500';
  };

  return (
    <div className="min-h-screen bg-[#09090B]">
      {/* Header */}
      <header className="bg-[#09090B]/90 backdrop-blur-sm border-b border-zinc-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-xl flex items-center justify-center border border-zinc-700">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4L28 26H4L16 4Z" stroke="white" strokeWidth="2" fill="none"/>
                  <ellipse cx="16" cy="16" rx="6" ry="4" stroke="white" strokeWidth="1.5" fill="none"/>
                  <circle cx="16" cy="16" r="2" fill="white"/>
                </svg>
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold tracking-tight text-white">ARGUS</span>
                  <span className="text-zinc-500 font-light">AI</span>
                </div>
                <div className="text-[10px] text-emerald-500 tracking-wider uppercase">Token Research</div>
              </div>
            </div>

            {/* Right Side - Wallet & Settings */}
            <div className="flex items-center gap-3">
              {/* Settings Button */}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2.5 rounded-lg transition-all ${showSettings ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* Wallet */}
              {autoTrade.wallet.isLoaded ? (
                <div className="relative">
                  <button
                    onClick={() => setShowWalletMenu(!showWalletMenu)}
                    className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
                  >
                    <div className="text-right">
                      <div className="text-[10px] text-emerald-200 truncate max-w-[100px]">{walletName}</div>
                      <div className="text-sm font-bold">{autoTrade.wallet.balance.toFixed(3)} SOL</div>
                    </div>
                    <svg className="w-4 h-4 text-emerald-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Wallet Dropdown */}
                  {showWalletMenu && (
                    <div className="absolute right-0 mt-2 w-72 bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden z-50">
                      <div className="p-4 bg-zinc-800 border-b border-zinc-700">
                        {/* Wallet Name */}
                        <div className="mb-3">
                          <div className="text-xs text-zinc-500 mb-1">Wallet Name</div>
                          {isEditingName ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editNameValue}
                                onChange={e => setEditNameValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    autoTrade.setWalletName(editNameValue);
                                    setWalletName(editNameValue);
                                    setIsEditingName(false);
                                  } else if (e.key === 'Escape') {
                                    setIsEditingName(false);
                                  }
                                }}
                                className="flex-1 px-2 py-1 text-sm rounded border border-zinc-600 bg-zinc-700 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                autoFocus
                              />
                              <button
                                onClick={() => {
                                  autoTrade.setWalletName(editNameValue);
                                  setWalletName(editNameValue);
                                  setIsEditingName(false);
                                }}
                                className="p-1 text-emerald-500 hover:bg-zinc-700 rounded"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setIsEditingName(false)}
                                className="p-1 text-zinc-500 hover:bg-zinc-700 rounded"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white flex-1">{walletName}</span>
                              <button
                                onClick={() => {
                                  setEditNameValue(walletName);
                                  setIsEditingName(true);
                                }}
                                className="p-1 text-zinc-500 hover:bg-zinc-700 rounded"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                        {/* Wallet Address */}
                        <div className="text-xs text-zinc-500 mb-1">Wallet Address</div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-zinc-300 flex-1 truncate">{autoTrade.wallet.address}</code>
                          <button
                            onClick={() => navigator.clipboard.writeText(autoTrade.wallet.address || '')}
                            className="p-1 hover:bg-zinc-700 rounded"
                          >
                            <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Withdraw to address"
                            value={withdrawAddr}
                            onChange={e => setWithdrawAddr(e.target.value)}
                            className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-700 bg-zinc-800 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <button
                            onClick={() => { autoTrade.withdraw(withdrawAddr); setWithdrawAddr(''); }}
                            disabled={!withdrawAddr}
                            className="px-3 py-2 text-sm font-medium bg-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-600 disabled:opacity-50"
                          >
                            Send
                          </button>
                        </div>
                        <div className="flex gap-2 pt-2 border-t border-zinc-700">
                          <button
                            onClick={() => { autoTrade.refreshBalance(); }}
                            className="flex-1 px-3 py-2 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700"
                          >
                            Refresh
                          </button>
                          <button
                            onClick={() => {
                              const k = autoTrade.exportPrivateKey();
                              if (k) {
                                navigator.clipboard.writeText(k);
                                setExportKeyCopied(true);
                                setTimeout(() => setExportKeyCopied(false), 2000);
                                log('Key copied!', 'success');
                              }
                            }}
                            className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                              exportKeyCopied
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                            }`}
                          >
                            {exportKeyCopied ? 'Copied!' : 'Export Key'}
                          </button>
                          <button
                            onClick={() => setShowDeleteModal(true)}
                            className="flex-1 px-3 py-2 text-xs font-medium bg-red-900/50 text-red-400 rounded-lg hover:bg-red-900/70"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  {!showImport ? (
                    <>
                      <button
                        onClick={() => {
                          const { privateKey } = autoTrade.generateWallet();
                          setNewWalletKey(privateKey);
                          setShowBackupModal(true);
                          setShowKey(false);
                          setKeyCopied(false);
                          setBackupConfirmed(false);
                        }}
                        className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
                      >
                        Create Wallet
                      </button>
                      <button
                        onClick={() => setShowImport(true)}
                        className="px-4 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                      >
                        Import
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="Private key (base58)"
                        value={importKey}
                        onChange={e => setImportKey(e.target.value)}
                        className="px-3 py-2 rounded-lg text-sm border border-zinc-700 bg-zinc-800 text-white w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        onClick={() => { autoTrade.importWallet(importKey); setImportKey(''); setShowImport(false); }}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white"
                      >
                        Import
                      </button>
                      <button
                        onClick={() => setShowImport(false)}
                        className="px-4 py-2 rounded-lg text-sm bg-zinc-800 text-zinc-400"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Backup Reminder Banner */}
      {autoTrade.wallet.isLoaded && !localStorage.getItem('argus_backup_confirmed') && (
        <div className="bg-amber-500/10 border-b border-amber-500/30">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-amber-200">
                <span className="font-semibold">Backup your wallet!</span> Export your private key and store it securely. Without it, you cannot recover your funds.
              </p>
            </div>
            <button
              onClick={() => {
                const key = autoTrade.exportPrivateKey();
                if (key) {
                  setNewWalletKey(key);
                  setShowBackupModal(true);
                  setShowKey(false);
                  setKeyCopied(false);
                  setBackupConfirmed(false);
                }
              }}
              className="px-4 py-1.5 text-sm font-medium bg-amber-500 text-black rounded-lg hover:bg-amber-400 transition-colors flex-shrink-0"
            >
              Backup Now
            </button>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-zinc-900 border-b border-zinc-800 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {/* Auto-Sell Settings */}
              <div className="bg-zinc-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-emerald-500">Auto-Sell</h3>
                  <button
                    onClick={() => autoTrade.updateConfig({ autoSellEnabled: !autoTrade.config.autoSellEnabled })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${autoTrade.config.autoSellEnabled ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoTrade.config.autoSellEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-zinc-500 mb-2 block">Take Profit</label>
                    <div className="flex gap-1.5">
                      {[50, 100, 200, 500].map(t => (
                        <button
                          key={t}
                          onClick={() => autoTrade.updateConfig({ takeProfitPercent: t })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.takeProfitPercent === t ? 'bg-green-500 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}
                        >
                          +{t}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-2 block">Stop Loss</label>
                    <div className="flex gap-1.5">
                      {[20, 30, 50, 70].map(s => (
                        <button
                          key={s}
                          onClick={() => autoTrade.updateConfig({ stopLossPercent: s })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.stopLossPercent === s ? 'bg-red-500 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}
                        >
                          -{s}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-2 block">Trailing Stop</label>
                    <div className="flex gap-1.5">
                      {[0, 10, 20, 30].map(t => (
                        <button
                          key={t}
                          onClick={() => autoTrade.updateConfig({ trailingStopPercent: t })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.trailingStopPercent === t ? 'bg-amber-500 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}
                        >
                          {t === 0 ? 'Off' : `-${t}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats & History */}
              <div className="bg-zinc-800 rounded-xl p-5">
                <h3 className="font-semibold text-emerald-500 mb-4">Statistics</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-900 rounded-lg p-3">
                    <div className="text-xs text-zinc-500">Total Trades</div>
                    <div className="text-xl font-bold text-white">{autoTrade.state.totalTraded}</div>
                  </div>
                  <div className="bg-zinc-900 rounded-lg p-3">
                    <div className="text-xs text-zinc-500">Success Rate</div>
                    <div className="text-xl font-bold text-white">
                      {autoTrade.state.totalTraded > 0 ? ((autoTrade.state.totalSuccessful / autoTrade.state.totalTraded) * 100).toFixed(0) : 0}%
                    </div>
                  </div>
                  <div className="bg-zinc-900 rounded-lg p-3">
                    <div className="text-xs text-zinc-500">Total Sold</div>
                    <div className="text-xl font-bold text-white">{autoTrade.state.totalSold}</div>
                  </div>
                  <div className="bg-zinc-900 rounded-lg p-3">
                    <div className="text-xs text-zinc-500">Total P&L</div>
                    <div className={`text-xl font-bold ${autoTrade.state.totalProfitSol >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {autoTrade.state.totalProfitSol >= 0 ? '+' : ''}{autoTrade.state.totalProfitSol.toFixed(4)} SOL
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { if (confirm('Clear all history?')) autoTrade.clearHistory(); }}
                  className="w-full mt-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Clear History
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Token Input */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Paste Solana token address..."
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyzeToken(tokenInput)}
                className="w-full pl-12 pr-4 py-4 rounded-xl border border-zinc-700 bg-zinc-900 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono"
              />
            </div>
            <button
              onClick={() => analyzeToken(tokenInput)}
              disabled={isAnalyzing || !tokenInput.trim()}
              className="px-8 py-4 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Analyzing...
                </span>
              ) : 'Analyze'}
            </button>
          </div>

          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-500">Recent:</span>
              {recentSearches.slice(0, 6).map(s => (
                <button
                  key={s.address}
                  onClick={() => { setTokenInput(s.address); analyzeToken(s.address); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:border-zinc-600 transition-all"
                >
                  {s.symbol}
                </button>
              ))}
            </div>
          )}

          {/* Watchlist */}
          {watchlist.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-yellow-500 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                Watchlist:
              </span>
              {watchlist.slice(0, 6).map(w => (
                <button
                  key={w.address}
                  onClick={() => { setTokenInput(w.address); analyzeToken(w.address); }}
                  className="group px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/20 transition-all flex items-center gap-1.5"
                >
                  {w.symbol}
                  <span className={`text-[10px] px-1 py-0.5 rounded ${SIGNAL_BG[w.signal]}`}>
                    {w.score}
                  </span>
                  <span
                    onClick={(e) => { e.stopPropagation(); removeFromWatchlist(w.address); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-opacity"
                  >
                    x
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error Message */}
        {analysisError && (
          <div className="mb-6 p-4 rounded-xl bg-red-900/30 border border-red-800">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <div className="text-sm font-medium text-red-400 mb-1">Analysis Failed</div>
                <div className="text-sm text-red-400/80 mb-3">{analysisError}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAnalysisError(null); analyzeToken(tokenInput); }}
                    className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => setAnalysisError(null)}
                    className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading Skeleton */}
        {isAnalyzing && <AnalysisSkeleton />}

        {/* Analysis Results */}
        {analysisResult && !isAnalyzing && (
          <div className="space-y-6">
            {/* Token Header Card */}
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4 sm:gap-5">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl sm:rounded-2xl flex items-center justify-center text-white text-lg sm:text-xl font-bold shadow-lg shadow-emerald-500/20 flex-shrink-0">
                    {analysisResult.token.symbol.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                      <h2 className="text-xl sm:text-2xl font-bold text-white">${analysisResult.token.symbol}</h2>
                      <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-bold ${SIGNAL_BG[analysisResult.ai.signal]}`}>
                        {analysisResult.ai.signal.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] sm:text-xs text-zinc-500 font-mono truncate max-w-[150px] sm:max-w-none">{analysisResult.token.address}</code>
                      <button
                        onClick={() => navigator.clipboard.writeText(analysisResult.token.address)}
                        className="p-1 hover:bg-zinc-800 rounded flex-shrink-0"
                        title="Copy address"
                      >
                        <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => isInWatchlist(analysisResult.token.address)
                          ? removeFromWatchlist(analysisResult.token.address)
                          : addToWatchlist(analysisResult)
                        }
                        className={`p-1 rounded flex-shrink-0 transition-colors ${isInWatchlist(analysisResult.token.address) ? 'text-yellow-500 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-800 hover:text-yellow-500'}`}
                        title={isInWatchlist(analysisResult.token.address) ? 'Remove from watchlist' : 'Add to watchlist'}
                      >
                        <svg className="w-3.5 h-3.5" fill={isInWatchlist(analysisResult.token.address) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-left sm:text-right flex sm:block items-center gap-2">
                  <div className="text-4xl sm:text-5xl font-bold" style={{ color: SIGNAL_COLORS[analysisResult.ai.signal] }}>
                    {analysisResult.ai.score}
                  </div>
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">AI Score</div>
                </div>
              </div>
            </div>

            {/* Info Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Security Card */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-emerald-500">Security</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Mint Authority</span>
                    <span className={`text-sm font-semibold flex items-center gap-1 ${analysisResult.security.mintAuthorityRevoked ? 'text-green-500' : 'text-red-500'}`}>
                      {analysisResult.security.mintAuthorityRevoked ? (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Revoked</>
                      ) : (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Active</>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Freeze Authority</span>
                    <span className={`text-sm font-semibold flex items-center gap-1 ${analysisResult.security.freezeAuthorityRevoked ? 'text-green-500' : 'text-red-500'}`}>
                      {analysisResult.security.freezeAuthorityRevoked ? (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Revoked</>
                      ) : (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Active</>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">LP Locked</span>
                    <span className={`text-sm font-semibold ${analysisResult.security.lpLockedPercent > 50 ? 'text-green-500' : 'text-amber-500'}`}>
                      {analysisResult.security.lpLockedPercent.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Market Card */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-emerald-500">Market</h3>
                  </div>
                  {/* 24h Sparkline */}
                  {analysisResult.market.sparkline && analysisResult.market.sparkline.length > 0 && (
                    <Sparkline
                      data={analysisResult.market.sparkline}
                      color={analysisResult.market.priceChange24h >= 0 ? '#10b981' : '#ef4444'}
                      height={36}
                    />
                  )}
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Market Cap</span>
                    <span className="text-sm font-semibold text-white">{fmt(analysisResult.market.marketCap)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Liquidity</span>
                    <span className="text-sm font-semibold text-white">{fmt(analysisResult.market.liquidity)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">24h Volume</span>
                    <span className="text-sm font-semibold text-white">{fmt(analysisResult.market.volume24h)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Price (24h)</span>
                    <span className={`text-sm font-semibold ${pctColor(analysisResult.market.priceChange24h)}`}>
                      {fmtPct(analysisResult.market.priceChange24h)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Trading Activity Card */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-emerald-500">Activity</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Buys (1h)</span>
                    <span className="text-sm font-semibold text-green-500">{analysisResult.trading.buys1h}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Sells (1h)</span>
                    <span className="text-sm font-semibold text-red-500">{analysisResult.trading.sells1h}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">Buy Ratio</span>
                    <span className={`text-sm font-semibold ${analysisResult.trading.buyRatio > 1 ? 'text-green-500' : 'text-red-500'}`}>
                      {analysisResult.trading.buyRatio.toFixed(2)}:1
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">24h Txns</span>
                    <span className="text-sm font-semibold text-white">
                      {analysisResult.trading.buys24h + analysisResult.trading.sells24h}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Holders & AI Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Holders */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-emerald-500">Top Holders</h3>
                  </div>
                  {analysisResult.bundles.detected && (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-900/50 text-red-400 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {analysisResult.bundles.count} BUNDLE{analysisResult.bundles.count > 1 ? 'S' : ''}
                    </span>
                  )}
                </div>
                {analysisResult.holders.top10.length > 0 && analysisResult.holders.topHolderPercent > 0 ? (
                  <>
                    <div className="space-y-2.5">
                      {analysisResult.holders.top10.slice(0, 5).map((holder, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500 w-4">{i + 1}</span>
                          <div className="flex-1">
                            <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${holder.isBundle ? 'bg-gradient-to-r from-red-500 to-red-400' : 'bg-gradient-to-r from-emerald-500 to-emerald-400'}`}
                                style={{ width: `${Math.min(holder.percent * 2, 100)}%` }}
                              />
                            </div>
                          </div>
                          <span className={`text-xs font-mono w-12 text-right font-semibold ${holder.isBundle ? 'text-red-500' : 'text-zinc-400'}`}>
                            {holder.percent.toFixed(1)}%
                          </span>
                          <code className="text-[10px] text-zinc-600 w-20 truncate">
                            {holder.address.slice(0, 4)}...{holder.address.slice(-4)}
                          </code>
                          {holder.isBundle && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-400 font-semibold">B{holder.bundleId}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 mb-1">Top 1</div>
                        <div className="text-sm font-bold text-white">{analysisResult.holders.topHolderPercent.toFixed(1)}%</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 mb-1">Top 5</div>
                        <div className="text-sm font-bold text-white">{analysisResult.holders.top5Percent.toFixed(1)}%</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 mb-1">Top 10</div>
                        <div className="text-sm font-bold text-white">{analysisResult.holders.top10Percent.toFixed(1)}%</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-6 text-center">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <p className="text-sm text-zinc-500">Holder data unavailable</p>
                    <p className="text-xs text-zinc-600 mt-1">Not tracked for established tokens</p>
                  </div>
                )}
              </div>

              {/* AI Verdict */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-emerald-500">AI Analysis</h3>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed mb-4">{analysisResult.ai.verdict}</p>

                {/* Bundle Warning */}
                {analysisResult.bundles.detected && (
                  <div className="p-4 rounded-xl bg-red-900/30 border border-red-800">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-sm font-bold text-red-400">Bundle Warning</span>
                    </div>
                    <p className="text-sm text-red-400/80">
                      {analysisResult.bundles.count} coordinated wallet cluster{analysisResult.bundles.count > 1 ? 's' : ''} detected holding {analysisResult.bundles.totalPercent.toFixed(1)}% of supply. This may indicate coordinated trading.
                    </p>
                  </div>
                )}

                {/* Links */}
                <div className="mt-4 pt-4 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
                  <a
                    href={analysisResult.links.dexscreener}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700 transition-colors"
                  >
                    DexScreener
                  </a>
                  {analysisResult.links.website && (
                    <a href={analysisResult.links.website} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700">
                      Website
                    </a>
                  )}
                  {analysisResult.links.twitter && (
                    <a href={analysisResult.links.twitter} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700">
                      Twitter
                    </a>
                  )}
                  {analysisResult.links.telegram && (
                    <a href={analysisResult.links.telegram} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700">
                      Telegram
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Buy Controls */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <span className="text-sm font-medium text-zinc-500">Amount:</span>
                  <div className="flex flex-wrap gap-2">
                    {[0.01, 0.05, 0.1, 0.25, 0.5].map(amt => (
                      <button
                        key={amt}
                        onClick={() => setBuyAmount(amt)}
                        className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          buyAmount === amt
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        {amt} SOL
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowBuyConfig(!showBuyConfig)}
                    className={`p-2 rounded-lg transition-all ${showBuyConfig ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'}`}
                    title="Trade settings"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                </div>
                <button
                  onClick={handleBuy}
                  disabled={!autoTrade.wallet.isLoaded || isBuying || autoTrade.wallet.balance < buyAmount}
                  className={`w-full sm:w-auto px-8 sm:px-10 py-3 rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-xl ${
                    analysisResult.ai.signal === 'AVOID'
                      ? 'bg-gradient-to-r from-red-500 to-red-600 text-white'
                      : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white'
                  } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
                >
                  {isBuying ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      Buying...
                    </span>
                  ) : `Buy ${analysisResult.token.symbol}`}
                </button>
              </div>

              {/* Expandable Trade Settings */}
              {showBuyConfig && (
                <div className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-500 mb-2 block">Max Slippage</label>
                    <div className="flex gap-1.5">
                      {[100, 300, 500, 1000].map(s => (
                        <button
                          key={s}
                          onClick={() => autoTrade.updateConfig({ maxSlippageBps: s })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.maxSlippageBps === s ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                        >
                          {s / 100}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-2 block">Reserve Balance</label>
                    <div className="flex gap-1.5">
                      {[0.05, 0.1, 0.2, 0.5].map(r => (
                        <button
                          key={r}
                          onClick={() => autoTrade.updateConfig({ reserveBalanceSol: r })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.reserveBalanceSol === r ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                        >
                          {r} SOL
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {!autoTrade.wallet.isLoaded && (
                <p className="mt-3 text-sm text-zinc-500">Create or import a trading wallet to buy tokens</p>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!analysisResult && !isAnalyzing && !analysisError && (
          <div className="text-center py-24">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-emerald-500 mb-2">Token Research Tool</h3>
            <p className="text-zinc-500 max-w-lg mx-auto leading-relaxed">
              Paste a Solana token address above to get comprehensive AI analysis including security checks, holder distribution, bundle detection, and trading signals.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 text-sm text-zinc-500">
              <div className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Security Analysis
              </div>
              <div className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Bundle Detection
              </div>
              <div className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Verdict
              </div>
            </div>
          </div>
        )}

        {/* Positions - Always visible */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-emerald-500">Your Positions</h3>
              {autoTrade.state.positions.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500 text-white">
                  {autoTrade.state.positions.length}
                </span>
              )}
            </div>
            {autoTrade.state.positions.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => autoTrade.sellAllPositions()}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-900/50 text-red-400 hover:bg-red-900/70 transition-colors"
                >
                  Sell All
                </button>
                <button
                  onClick={() => autoTrade.clearAllPositions()}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
                >
                  Clear All
                </button>
              </div>
            )}
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-x-auto">
            {autoTrade.state.positions.length > 0 ? (
              <table className="w-full min-w-[500px]">
                <thead>
                  <tr className="bg-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
                    <th className="px-5 py-3 text-left font-semibold">Token</th>
                    <th className="px-5 py-3 text-right font-semibold">Entry</th>
                    <th className="px-5 py-3 text-right font-semibold">Current</th>
                    <th className="px-5 py-3 text-right font-semibold">P&L</th>
                    <th className="px-5 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {autoTrade.state.positions.map((p, i) => (
                    <tr key={`${p.tokenAddress}-${i}`} className="border-t border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                      <td className="px-5 py-4">
                        <a
                          href={`https://dexscreener.com/solana/${p.tokenAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-white hover:text-emerald-400"
                        >
                          {p.tokenSymbol}
                        </a>
                      </td>
                      <td className="px-5 py-4 text-right text-sm text-zinc-400">{p.entrySolAmount.toFixed(4)} SOL</td>
                      <td className="px-5 py-4 text-right text-sm text-zinc-400">{p.currentValueSol.toFixed(4)} SOL</td>
                      <td className={`px-5 py-4 text-right text-sm font-bold ${p.pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(1)}%
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => autoTrade.manualSell(p.tokenAddress)}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
                        >
                          Sell
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-zinc-800 flex items-center justify-center">
                  <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <p className="text-sm text-zinc-500">No positions yet</p>
                <p className="text-xs text-zinc-600 mt-1">Buy a token to start tracking</p>
              </div>
            )}
          </div>
        </div>

        {/* Trade History */}
        {autoTrade.state.soldPositions.length > 0 && (
          <div className="mt-8">
            <details className="bg-zinc-900 rounded-xl border border-zinc-800">
              <summary className="px-5 py-4 text-sm font-semibold text-zinc-300 cursor-pointer hover:bg-zinc-800 transition-colors flex items-center justify-between">
                <span className="flex items-center gap-2">
                  Trade History
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-700 text-zinc-300">
                    {autoTrade.state.soldPositions.length}
                  </span>
                </span>
                <span className={`text-sm font-bold ${autoTrade.state.totalProfitSol >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  Total: {autoTrade.state.totalProfitSol >= 0 ? '+' : ''}{autoTrade.state.totalProfitSol.toFixed(4)} SOL
                </span>
              </summary>
              <div className="border-t border-zinc-800 overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="bg-zinc-800/50 text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-5 py-3 text-left font-semibold">Token</th>
                      <th className="px-5 py-3 text-right font-semibold">Entry</th>
                      <th className="px-5 py-3 text-right font-semibold">Exit</th>
                      <th className="px-5 py-3 text-right font-semibold">P&L</th>
                      <th className="px-5 py-3 text-right font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoTrade.state.soldPositions.slice(0, 20).map((p, i) => (
                      <tr key={`${p.tokenAddress}-${i}`} className="border-t border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="px-5 py-3">
                          <a
                            href={`https://dexscreener.com/solana/${p.tokenAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-zinc-300 hover:text-emerald-400 text-sm"
                          >
                            {p.tokenSymbol}
                          </a>
                        </td>
                        <td className="px-5 py-3 text-right text-sm text-zinc-500">{p.entrySolAmount.toFixed(4)} SOL</td>
                        <td className="px-5 py-3 text-right text-sm text-zinc-500">{p.currentValueSol.toFixed(4)} SOL</td>
                        <td className={`px-5 py-3 text-right text-sm font-bold ${p.pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(1)}%
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-xs px-2 py-1 rounded ${
                            p.sellReason === 'take_profit' ? 'bg-green-900/50 text-green-400' :
                            p.sellReason === 'stop_loss' ? 'bg-red-900/50 text-red-400' :
                            p.sellReason === 'trailing_stop' ? 'bg-amber-900/50 text-amber-400' :
                            'bg-zinc-700 text-zinc-400'
                          }`}>
                            {p.sellReason === 'take_profit' ? 'TP' :
                             p.sellReason === 'stop_loss' ? 'SL' :
                             p.sellReason === 'trailing_stop' ? 'TS' :
                             'Manual'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}

        {/* Activity Log */}
        {logs.length > 0 && (
          <div className="mt-8">
            <details className="bg-zinc-900 rounded-xl border border-zinc-800">
              <summary className="px-5 py-4 text-sm font-semibold text-zinc-300 cursor-pointer hover:bg-zinc-800 transition-colors">
                Activity Log ({logs.length})
              </summary>
              <div className="px-5 pb-4 max-h-48 overflow-auto border-t border-zinc-800">
                <div className="space-y-1 pt-3 text-xs font-mono">
                  {logs.slice().reverse().map((l, i) => (
                    <div key={i} className={
                      l.type === 'success' ? 'text-green-500' :
                      l.type === 'error' ? 'text-red-500' :
                      l.type === 'warning' ? 'text-amber-500' :
                      'text-zinc-500'
                    }>
                      <span className="text-zinc-600">{l.time.toLocaleTimeString('en-US', { hour12: false })}</span> {l.msg}
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}
      </main>

      {/* Click outside to close wallet dropdown */}
      {showWalletMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowWalletMenu(false)}
        />
      )}

      {/* Backup Modal - CRITICAL: Show private key after wallet creation */}
      {showBackupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Backup Your Wallet</h3>
                <p className="text-sm text-zinc-400">Save this key before continuing</p>
              </div>
            </div>

            {/* Warning */}
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-400 font-medium">
                If you lose this key, you will lose access to any funds in this wallet. There is NO recovery option.
              </p>
            </div>

            {/* Private Key Display */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-400 mb-2">Private Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={newWalletKey}
                  readOnly
                  className="w-full px-4 py-3 pr-20 rounded-lg border border-zinc-700 bg-zinc-800 text-white font-mono text-sm"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-zinc-400 hover:text-white"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Copy Button */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(newWalletKey);
                setKeyCopied(true);
              }}
              className={`w-full py-3 rounded-lg font-medium mb-4 transition-all ${
                keyCopied
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
              }`}
            >
              {keyCopied ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied to Clipboard
                </span>
              ) : (
                'Copy Private Key'
              )}
            </button>

            {/* Confirmation Checkbox */}
            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={e => setBackupConfirmed(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
              />
              <span className="text-sm text-zinc-300">
                I have saved my private key in a secure location and understand that I cannot recover my wallet without it.
              </span>
            </label>

            {/* Continue Button */}
            <button
              onClick={() => {
                if (backupConfirmed) {
                  localStorage.setItem('argus_backup_confirmed', 'true');
                  setShowBackupModal(false);
                  setNewWalletKey('');
                  log('Wallet backup confirmed', 'success');
                }
              }}
              disabled={!backupConfirmed}
              className={`w-full py-3 rounded-lg font-semibold transition-all ${
                backupConfirmed
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
            >
              Continue to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Delete Wallet Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete Wallet</h3>
                <p className="text-sm text-zinc-400">This action cannot be undone</p>
              </div>
            </div>

            {/* Warning */}
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-400 font-medium">
                Make sure you have exported and saved your private key! Without it, you will permanently lose access to any funds in this wallet.
              </p>
            </div>

            {/* Wallet Info */}
            <div className="bg-zinc-800 rounded-lg p-3 mb-4">
              <div className="text-xs text-zinc-500 mb-1">Wallet Address</div>
              <div className="text-sm font-mono text-zinc-300 truncate">{autoTrade.wallet.address}</div>
              <div className="text-xs text-zinc-500 mt-2">Balance</div>
              <div className="text-sm font-semibold text-white">{autoTrade.wallet.balance.toFixed(4)} SOL</div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-3 rounded-lg font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  autoTrade.deleteWallet();
                  setShowDeleteModal(false);
                  setShowWalletMenu(false);
                  localStorage.removeItem('argus_backup_confirmed');
                  log('Wallet deleted', 'info');
                }}
                className="flex-1 py-3 rounded-lg font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Delete Wallet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
