import { useState, useEffect, useCallback, useRef } from 'react';
import * as d3 from 'd3';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useAutoTrade } from './hooks/useAutoTrade';
import { useAgentStatus } from './hooks/useAgentStatus';
import { BundleNetworkGraph } from './components/BundleNetworkGraph';
import { SwarmStatusPanel } from './components/SwarmStatusPanel';
import { ActivityFeed } from './components/ActivityFeed';
import { GraduationFeed } from './components/GraduationFeed';
import { StatsGrid } from './components/StatsGrid';
import { BuyBar } from './components/BuyBar';
import './styles/dashboard.css';

type SignalType = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'AVOID';

const SIGNAL_BG: Record<SignalType, string> = {
  STRONG_BUY: 'bg-green-500 text-white',
  BUY: 'bg-emerald-500 text-white',
  WATCH: 'bg-yellow-500 text-white',
  HOLD: 'bg-gray-400 text-white',
  AVOID: 'bg-red-500 text-white',
};

// Gradient color function: score 0-100 maps to red → yellow → green
// Uses HSL interpolation for smooth transitions
function getScoreColor(score: number): string {
  // Clamp score to 0-100
  const s = Math.max(0, Math.min(100, score));
  // Map score to hue: 0 (red) → 60 (yellow) → 120 (green)
  const hue = (s / 100) * 120;
  // Adjust saturation and lightness for better visibility
  const saturation = 75;
  const lightness = s < 30 ? 45 : s > 70 ? 40 : 50; // Slightly darker at extremes
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Loading skeleton component
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-800 rounded ${className}`} />;
}

// Analysis loading skeleton - Compact version
function AnalysisSkeleton() {
  return (
    <div className="space-y-2">
      {/* Token Header Skeleton */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-14 rounded" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="w-[70px] h-[40px]" />
        </div>
      </div>

      {/* Info Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Skeleton className="w-6 h-6 rounded" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="space-y-1.5">
              {[1, 2, 3].map(j => (
                <div key={j} className="flex items-center justify-between">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Holders & AI Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Skeleton className="w-6 h-6 rounded" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="flex items-start gap-3">
            <Skeleton className="w-[80px] h-[80px] rounded-full" />
            <div className="flex-1 space-y-1">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-1.5 w-full rounded-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Skeleton className="w-6 h-6 rounded" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
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

// Score gauge component
function ScoreGauge({ score, aiScore, rulesOverride }: { score: number; aiScore?: number; rulesOverride?: boolean }) {
  const size = 70;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score)) / 100;
  const dashOffset = circumference * (1 - progress);
  const color = getScoreColor(score);

  return (
    <div className="flex flex-col items-center flex-shrink-0">
      <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`}>
        <path d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`} fill="none" stroke="#27272a" strokeWidth={strokeWidth} strokeLinecap="round" />
        <path d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset} style={{ filter: `drop-shadow(0 0 4px ${color}40)` }} />
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fill={color} fontSize="20" fontWeight="bold" fontFamily="inherit">{score}</text>
      </svg>
      <span className="text-[9px] text-zinc-500 uppercase tracking-wider -mt-0.5">Score</span>
      {rulesOverride && aiScore !== undefined && (
        <div className="text-[8px] text-orange-400 mt-0.5">{aiScore}→{score}</div>
      )}
    </div>
  );
}

// Buy/Sell pressure bar component
function PressureBar({ label, buys, sells }: { label: string; buys: number; sells: number }) {
  const total = buys + sells;
  const buyPct = total > 0 ? (buys / total) * 100 : 50;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-green-500 font-medium">{buys}</span>
        <span className="text-zinc-500">{label}</span>
        <span className="text-red-500 font-medium">{sells}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-gradient-to-r from-green-600 to-green-500 rounded-l-full transition-all"
          style={{ width: `${buyPct}%` }}
        />
        <div
          className="h-full bg-gradient-to-l from-red-600 to-red-500 rounded-r-full transition-all"
          style={{ width: `${100 - buyPct}%` }}
        />
      </div>
    </div>
  );
}

// Holder donut chart component - Compact
function HolderDonut({ holders }: { holders: Array<{ address: string; percent: number; isBundle: boolean }> }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || holders.length === 0) return;

    const size = 80;
    const outerRadius = size / 2;
    const innerRadius = outerRadius - 12;

    const top5 = holders.slice(0, 5);
    const top5Total = top5.reduce((s, h) => s + h.percent, 0);
    const othersPercent = Math.max(0, 100 - top5Total);

    const data = [
      ...top5.map(h => ({ ...h, label: `${h.address.slice(0, 4)}...${h.address.slice(-4)}` })),
      ...(othersPercent > 0 ? [{ percent: othersPercent, isBundle: false, label: 'Others', address: 'others' }] : []),
    ];

    const getColor = (d: typeof data[0], i: number) => {
      if (d.address === 'others') return '#3f3f46';
      if (d.isBundle) return '#ef4444';
      const greens = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'];
      return greens[i] || greens[4];
    };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.attr('width', size).attr('height', size).append('g').attr('transform', `translate(${size / 2},${size / 2})`);

    const pie = d3.pie<typeof data[0]>().value(d => d.percent).sort(null).padAngle(0.02);
    const arc = d3.arc<d3.PieArcDatum<typeof data[0]>>().innerRadius(innerRadius).outerRadius(outerRadius).cornerRadius(2);

    g.selectAll('path').data(pie(data)).enter().append('path').attr('d', arc).attr('fill', (d, i) => getColor(d.data, i)).attr('opacity', 0.9).attr('stroke', '#09090b').attr('stroke-width', 1);

    g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').attr('fill', '#fafafa').attr('font-size', '14').attr('font-weight', 'bold').text(`${top5Total.toFixed(0)}%`);
  }, [holders]);

  if (holders.length === 0) return null;

  return <svg ref={svgRef} className="flex-shrink-0" />;
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
    isPumpFun: boolean;
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
    controlPercent: number;  // Actual % of supply held by bundle wallets
    wallets: string[];
    walletsWithHoldings: Array<{  // Detailed wallet info from API
      address: string;
      percent: number;
      isLp: boolean;
    }>;
    description?: string;
    confidence?: string;
    syndicateWallets?: Array<{
      address: string;
      holdingsPercent: number;
      type: string;
      isHighRisk: boolean;
    }>;
    washTrading?: {
      detected: boolean;
      totalBuys: number;
      bundleBuys: number;
      organicBuys: number;
      washTradingPercent: number;
      realBuyRatio: number | null;
      warning: string | null;
    } | null;
    syndicateNetwork?: {
      detected: boolean;
      repeatOffenders: number;
      totalTokensTouched: number;
      rugRate: number;
      highRiskWallets: Array<{
        address: string;
        tokenCount: number;
        rugCount: number;
        riskScore: number;
        recentTokens: Array<{
          symbol: string;
          address: string;
          rugged: boolean;
          daysAgo: number;
        }>;
      }>;
      networkWarning?: string;
    } | null;
  };
  devActivity: {
    hasSold: boolean;
    percentSold: number;
    sellCount: number;
    currentHoldingsPercent: number;
    severity: string;
    message: string;
  } | null;
  ai: {
    signal: SignalType;
    score: number;
    aiScore?: number; // Original AI score before guardrails
    rulesOverride?: boolean; // Whether guardrails adjusted the score
    verdict: string;
    prediction?: string; // What will likely happen
    recommendation?: string; // Action advice
    networkInsights?: string[]; // Key observations
    flags: Array<{ type: string; severity: string; message: string }>;
  };
  links: {
    website?: string;
    twitter?: string;
    telegram?: string;
    dexscreener: string;
  };
}

// Use production API or localhost for development
// Using Workers (8787) for local dev to get agent events
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8787'
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
  const { publicKey: connectedWallet, disconnect: disconnectWallet, connected: isWalletConnected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [tokenInput, setTokenInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [scansRemaining, setScansRemaining] = useState<number | null>(null);
  const [recentSearches, setRecentSearches] = useState<Array<{ address: string; symbol: string }>>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [buyAmount, setBuyAmount] = useState(0.1);
  const [showCustomBuy, setShowCustomBuy] = useState(false);
  const [customBuyValue, setCustomBuyValue] = useState('0.1');
  const [isBuying, setIsBuying] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: Date; msg: string; type: string }>>([]);
  const [showBuyConfig, setShowBuyConfig] = useState(false);
  const [showBundleNetwork, setShowBundleNetwork] = useState(false);

  // Wallet management
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [withdrawAddr, setWithdrawAddr] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
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
  const [showExportKeyModal, setShowExportKeyModal] = useState(false);

  // Buy warning modal state
  const [buyWarning, setBuyWarning] = useState<{ message: string; symbol: string } | null>(null);

  // Deep link confirmation modal (from Telegram/X)
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);

  // Agent status for Swarm panel and Activity feed
  const agentStatus = useAgentStatus({
    enabled: true,
    statusInterval: 5000,
    activityInterval: 3000,
    statsInterval: 30000,
  });

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
    const trimmed = address.trim();
    if (!trimmed) return;

    // Validate Solana address format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
      setAnalysisError('Invalid Solana address. Please enter a valid token mint address (32-44 base58 characters).');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      // Use Workers API format (same for local and production now)
      const endpoint = '/sentinel/analyze';
      const payload = { tokenAddress: address.trim() };

      // Prefer connected wallet for rate limiting, fallback to trading wallet
      const walletForRateLimit = connectedWallet?.toBase58() || autoTrade.wallet.address;

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(walletForRateLimit ? { 'X-Wallet-Address': walletForRateLimit } : {}),
        },
        body: JSON.stringify(payload),
      });

      // Extract rate limit info from headers
      const remainingHeader = response.headers.get('X-RateLimit-Remaining');
      if (remainingHeader !== null) {
        const remaining = parseInt(remainingHeader, 10);
        if (!isNaN(remaining)) {
          setScansRemaining(remaining);
        }
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Analysis failed');
      }

      const data = await response.json();

      // Map Workers API response to our AnalysisResult format
      // Build bundle wallet addresses from bundleInfo.wallets (primary) or network nodes (fallback)
      // bundleInfo.wallets contains actual detected bundle wallet addresses from transaction analysis
      const bundleWalletsFromApi = data.bundleInfo?.wallets || [];
      const bundleWalletsFromNetwork = (data.network?.nodes || [])
          .filter((n: { type: string; isHighRisk?: boolean }) =>
            n.type !== 'token' &&
            n.type !== 'lp' &&
            n.isHighRisk === true
          )
          .map((n: { address: string }) => n.address);

        // Use bundleInfo.wallets if available, otherwise fall back to network nodes
        const bundleWalletAddresses = new Set(
          bundleWalletsFromApi.length > 0 ? bundleWalletsFromApi : bundleWalletsFromNetwork
        );

        // Calculate holder percentages
        const holders = data.holderDistribution || [];
        const top10 = holders.slice(0, 10);
        const top5Percent = holders.slice(0, 5).reduce((sum: number, h: { percent: number }) => sum + h.percent, 0);
        const top10Percent = top10.reduce((sum: number, h: { percent: number }) => sum + h.percent, 0);

        // Calculate buyRatio safely
        const buys24h = data.tokenInfo?.txns24h?.buys || 0;
        const sells24h = data.tokenInfo?.txns24h?.sells || 0;
        const buyRatio = sells24h > 0 ? buys24h / sells24h : (buys24h > 0 ? 2 : 1);

        // Invert risk score (API: higher = worse, we want: higher = better)
        // Backend sentinel handles ALL risk scoring: bundles, holder concentration,
        // liquidity, token age, sell pressure, etc. via AI analysis + post-AI guardrails.
        // No frontend penalties — they were double-counting and defeating backend guardrails.
        const score = Math.max(0, 100 - (data.analysis?.riskScore || 50));

        const signal: SignalType = score >= 75 ? 'STRONG_BUY' :
                                   score >= 60 ? 'BUY' :
                                   score >= 45 ? 'WATCH' :
                                   score >= 30 ? 'HOLD' : 'AVOID';

      const result: AnalysisResult = {
          token: {
            address: data.tokenInfo?.address || address.trim(),
            name: data.tokenInfo?.name || 'Unknown',
            symbol: data.tokenInfo?.symbol || '???',
          },
          security: {
            mintAuthorityRevoked: data.security?.mintRevoked ?? true,
            freezeAuthorityRevoked: data.security?.freezeRevoked ?? true,
            lpLockedPercent: data.security?.lpLockedPct ?? 0,
            isPumpFun: data.security?.isPumpFun ?? false,
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
            buys5m: data.tokenInfo?.txns5m?.buys || 0,
            sells5m: data.tokenInfo?.txns5m?.sells || 0,
            buys1h: data.tokenInfo?.txns1h?.buys || 0,
            sells1h: data.tokenInfo?.txns1h?.sells || 0,
            buys24h,
            sells24h,
            buyRatio,
          },
          holders: {
            total: data.tokenInfo?.holderCount || 0,
            top10: top10.map((h: { address: string; percent: number; type: string }) => ({
              address: h.address || '',
              percent: typeof h.percent === 'number' ? h.percent : 0,
              isBundle: bundleWalletAddresses.has(h.address),
            })),
            topHolderPercent: typeof holders[0]?.percent === 'number' ? holders[0].percent : 0,
            top5Percent: typeof top5Percent === 'number' ? top5Percent : 0,
            top10Percent: typeof top10Percent === 'number' ? top10Percent : 0,
          },
          bundles: {
            detected: data.bundleInfo?.detected || false,
            count: data.bundleInfo?.count || 0,
            totalPercent: typeof data.bundleInfo?.txBundlePercent === 'number' ? data.bundleInfo.txBundlePercent : 0,
            controlPercent: typeof data.bundleInfo?.controlPercent === 'number' ? data.bundleInfo.controlPercent : 0, // Actual % held by bundle wallets
            wallets: data.bundleInfo?.wallets || [],
            walletsWithHoldings: (data.bundleInfo?.walletsWithHoldings || []).map((w: { address: string; percent: number; isLp?: boolean }) => ({
              address: w.address,
              percent: w.percent,
              isLp: w.isLp || false,
            })),
            description: data.bundleInfo?.description,
            confidence: data.bundleInfo?.confidence,
            syndicateWallets: (data.network?.nodes || [])
              .filter((n: { type: string }) => n.type !== 'token' && n.type !== 'lp')
              .map((n: { address: string; holdingsPercent?: number; type: string; isHighRisk?: boolean }) => ({
                address: n.address,
                holdingsPercent: n.holdingsPercent || 0,
                type: n.type,
                isHighRisk: n.isHighRisk || false,
              }))
              .sort((a: { holdingsPercent: number }, b: { holdingsPercent: number }) => b.holdingsPercent - a.holdingsPercent),
            washTrading: data.bundleInfo?.washTrading || null,
            syndicateNetwork: data.syndicateNetwork ? {
              detected: data.syndicateNetwork.detected,
              repeatOffenders: data.syndicateNetwork.repeatOffenders,
              totalTokensTouched: data.syndicateNetwork.totalTokensTouched,
              rugRate: data.syndicateNetwork.rugRate,
              highRiskWallets: data.syndicateNetwork.highRiskWallets || [],
              networkWarning: data.syndicateNetwork.networkWarning,
            } : null,
          },
          devActivity: data.devActivity ? {
            hasSold: data.devActivity.hasSold,
            percentSold: data.devActivity.percentSold,
            sellCount: data.devActivity.sellCount,
            currentHoldingsPercent: data.devActivity.currentHoldingsPercent,
            severity: data.devActivity.severity,
            message: data.devActivity.message,
          } : null,
          ai: {
            signal,
            score,
            // Include original AI score (inverted same as final score) and override flag
            aiScore: data.aiScore !== undefined ? Math.max(0, 100 - data.aiScore) : undefined,
            rulesOverride: data.rulesOverride || false,
            verdict: data.analysis?.summary || 'Analysis unavailable',
            prediction: data.analysis?.prediction,
            recommendation: data.analysis?.recommendation,
            networkInsights: data.analysis?.networkInsights || [],
            flags: (data.analysis?.flags || []).map((f: { type: string; severity: string; message: string }) => ({
              type: f.type,
              severity: f.severity?.toUpperCase() || 'MEDIUM',
              message: f.message,
            })),
          },
          links: {
            website: data.tokenInfo?.website,
            twitter: data.tokenInfo?.twitter,
            telegram: data.tokenInfo?.telegram,
            dexscreener: `https://dexscreener.com/solana/${address.trim()}`,
          },
        };

      setAnalysisResult(result);
      addRecentSearch(result.token.address, result.token.symbol);
      log(`Analyzed ${result.token.symbol}: ${result.ai.signal} (${result.ai.score})`, 'success');

      // Fetch sparkline data from GeckoTerminal (non-blocking)
      const pairAddr = data.pairAddress;
      if (pairAddr) {
        const geckoBase = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddr}/ohlcv`;
        const setSparkline = (candles: number[][]) => {
          const closePrices = candles.map((c: number[]) => c[4]).reverse();
          setAnalysisResult(prev => prev ? {
            ...prev,
            market: { ...prev.market, sparkline: closePrices },
          } : null);
        };
        // Try hourly candles first (24h view), fall back to 5-min candles for newer tokens
        fetch(`${geckoBase}/hour?aggregate=1&limit=24`)
          .then(r => r.json())
          .then((ohlcv: { data?: { attributes?: { ohlcv_list?: number[][] } } }) => {
            const candles = ohlcv?.data?.attributes?.ohlcv_list;
            if (candles && candles.length >= 4) {
              setSparkline(candles);
            } else {
              // Fall back to 5-min candles (covers ~4h with 50 points)
              return fetch(`${geckoBase}/minute?aggregate=5&limit=50`)
                .then(r2 => r2.json())
                .then((ohlcv2: { data?: { attributes?: { ohlcv_list?: number[][] } } }) => {
                  const candles2 = ohlcv2?.data?.attributes?.ohlcv_list;
                  if (candles2 && candles2.length >= 3) {
                    setSparkline(candles2);
                  }
                });
            }
          })
          .catch(() => { /* sparkline is optional */ });
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Unknown error';
      let msg = raw;
      if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('net::')) {
        msg = 'Network error — check your connection and try again.';
      } else if (raw.includes('404') || raw.includes('not found')) {
        msg = 'Token not found. It may not be listed on any DEX yet.';
      } else if (raw.includes('429') || raw.includes('rate limit') || raw.includes('Daily limit')) {
        msg = 'Daily scan limit reached. Limits reset at midnight UTC.';
        setScansRemaining(0);
      }
      setAnalysisError(msg);
      log(`Analysis failed: ${raw}`, 'error');
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
      } else if (result.error && (result.error.includes('Sell pressure') || result.error.includes('dump'))) {
        // Safety check blocked — show warning modal
        setBuyWarning({ message: result.error, symbol: analysisResult.token.symbol });
      } else {
        log(`Buy failed: ${result.error}`, 'error');
      }
    } finally {
      setIsBuying(false);
    }
  };

  // Confirm buy after warning
  const handleBuyConfirm = async () => {
    if (!analysisResult || !autoTrade.wallet.isLoaded) return;
    setBuyWarning(null);
    setIsBuying(true);
    try {
      autoTrade.updateConfig({ buyAmountSol: buyAmount });
      const result = await autoTrade.executeTrade(
        analysisResult.token.address,
        analysisResult.token.symbol,
        analysisResult.ai.score,
        true // force past safety checks
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

  // Sell token
  const handleSell = async () => {
    if (!analysisResult || !autoTrade.wallet.isLoaded) return;

    setIsSelling(true);
    try {
      await autoTrade.manualSell(analysisResult.token.address);
      log(`Sold ${analysisResult.token.symbol}!`, 'success');
    } catch {
      log(`Sell failed`, 'error');
    } finally {
      setIsSelling(false);
    }
  };

  // Handle ?token= URL parameter for deep linking from Telegram/X
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam && tokenParam.trim()) {
      setTokenInput(tokenParam.trim());
      // Show confirmation modal instead of auto-analyzing
      setPendingDeepLink(tokenParam.trim());
      // Clear the URL parameter after reading it
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Derived risk variables for analysis results
  const isDangerous = analysisResult?.ai.signal === 'AVOID';
  const cardBorder = isDangerous ? 'border-red-800/40' : 'border-zinc-800';
  const cardBg = isDangerous ? 'bg-zinc-900/80' : 'bg-zinc-900';

  // Calculate actual LP locked value (more meaningful than percentage)
  const lpLockedValue = analysisResult
    ? (analysisResult.market.liquidity * analysisResult.security.lpLockedPercent / 100)
    : 0;
  // Mature tokens (high mcap/liquidity) may not have LP lock data from RugCheck
  // Don't penalize them - the data is simply unavailable for CEX-listed tokens
  const isMatureToken = analysisResult
    ? (analysisResult.market.marketCap > 50_000_000 || analysisResult.market.liquidity > 1_000_000)
    : false;
  // LP lock only meaningful when there's real value locked (>$1K), skip check for mature tokens
  // Pump.fun bonding curve tokens don't have traditional LP locks - the bonding curve IS the liquidity mechanism
  const isPumpFunToken = analysisResult?.security.isPumpFun ?? false;
  const hasRealLockedValue = isMatureToken || isPumpFunToken || lpLockedValue >= 1000;

  const criticalIssueCount = analysisResult ? [
    !analysisResult.security.mintAuthorityRevoked,
    !analysisResult.security.freezeAuthorityRevoked,
    // Only count LP lock as critical when there's real value at risk
    !hasRealLockedValue,
  ].filter(Boolean).length : 0;

  const securityIsDangerous = criticalIssueCount > 0;

  return (
    <div className="min-h-screen bg-[#09090B]">
      {/* Header */}
      <header className="bg-[#09090B]/90 backdrop-blur-sm border-b border-zinc-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-lg flex items-center justify-center border border-zinc-700">
                <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4L28 26H4L16 4Z" stroke="white" strokeWidth="2" fill="none"/>
                  <ellipse cx="16" cy="16" rx="6" ry="4" stroke="white" strokeWidth="1.5" fill="none"/>
                  <circle cx="16" cy="16" r="2" fill="white"/>
                </svg>
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold tracking-tight text-white">ARGUS</span>
                  <span className="text-zinc-500 text-sm font-light">AI</span>
                </div>
              </div>
            </div>

            {/* Right Side - Wallets */}
            <div className="flex items-center gap-3">
              {/* Phantom/External Wallet Connection */}
              {isWalletConnected && connectedWallet ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs text-zinc-400 hidden sm:inline">Connected:</span>
                  <code className="text-xs text-zinc-300">{connectedWallet.toBase58().slice(0, 4)}...{connectedWallet.toBase58().slice(-4)}</code>
                  <button
                    onClick={() => disconnectWallet()}
                    className="ml-1 p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors"
                    title="Disconnect wallet"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setWalletModalVisible(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-xl hover:bg-zinc-700 hover:border-zinc-600 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span className="text-sm font-medium">Connect</span>
                </button>
              )}

              {/* Trading Wallet */}
              {autoTrade.wallet.isLoaded ? (
                <div className="relative">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowWalletMenu(!showWalletMenu)}
                      className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-l-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
                    >
                      <div className="text-right">
                        <div className="text-[10px] text-emerald-200 truncate max-w-[100px]">{walletName}</div>
                        <div className="text-sm font-bold">{autoTrade.wallet.balance.toFixed(3)} SOL</div>
                      </div>
                      <svg className="w-4 h-4 text-emerald-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (isRefreshing) return;
                        setIsRefreshing(true);
                        const minSpin = new Promise(r => setTimeout(r, 750));
                        await Promise.all([autoTrade.refreshBalance(), minSpin]);
                        setIsRefreshing(false);
                      }}
                      disabled={isRefreshing}
                      className="px-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-r-xl shadow-lg shadow-emerald-500/20 transition-all h-full disabled:opacity-70"
                      title="Refresh balance"
                    >
                      <svg
                        className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                        style={isRefreshing ? { animationDuration: '0.75s' } : undefined}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>

                  {/* Wallet Dropdown */}
                  {showWalletMenu && (
                    <div className="absolute right-0 mt-2 w-80 bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden z-50">
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
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            placeholder="Recipient address"
                            value={withdrawAddr}
                            onChange={e => setWithdrawAddr(e.target.value)}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-700 bg-zinc-800 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              placeholder="Amount (SOL)"
                              value={withdrawAmount}
                              onChange={e => setWithdrawAmount(e.target.value)}
                              className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-700 bg-zinc-800 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <button
                              onClick={() => setWithdrawAmount(Math.max(0, autoTrade.wallet.balance - 0.005).toFixed(4))}
                              className="px-2 py-2 text-xs font-medium bg-zinc-700 text-zinc-400 rounded-lg hover:bg-zinc-600"
                            >
                              Max
                            </button>
                            <button
                              onClick={() => {
                                const amt = parseFloat(withdrawAmount);
                                autoTrade.withdraw(withdrawAddr, amt > 0 ? amt : undefined);
                                setWithdrawAddr('');
                                setWithdrawAmount('');
                              }}
                              disabled={!withdrawAddr}
                              className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50"
                            >
                              Send
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-2 border-t border-zinc-700">
                          <button
                            onClick={() => { autoTrade.refreshBalance(); }}
                            className="flex-1 px-3 py-2 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700"
                          >
                            Refresh
                          </button>
                          <button
                            onClick={() => setShowExportKeyModal(true)}
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
                        onClick={async () => {
                          const { privateKey } = await autoTrade.generateWallet();
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
                        onClick={async () => { await autoTrade.importWallet(importKey); setImportKey(''); setShowImport(false); }}
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
              onClick={async () => {
                const key = await autoTrade.exportPrivateKey();
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

      {/* Main Content */}
      <main className={`max-w-[1600px] mx-auto px-4 sm:px-6 py-4 ${analysisResult ? 'pb-16' : ''}`}>
        {/* Stats Grid */}
        <StatsGrid
          stats={{
            tokensAnalyzed: agentStatus.stats?.scans?.today || 0,
            alertsToday: agentStatus.stats?.alerts?.today || 0,
            highRiskDetected: agentStatus.stats?.alerts?.highRisk || 0,
            activePositions: autoTrade.state.positions.length,
            totalPnL: autoTrade.state.totalProfitSol * 100,
          }}
          isLoading={agentStatus.isLoading}
        />

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-3">
          {/* Left Column - Main Content */}
          <div className="space-y-3 min-w-0">
            {/* Agent Status */}
            <SwarmStatusPanel
              status={agentStatus.status}
              isConnected={agentStatus.isConnected}
              isLoading={agentStatus.isLoading}
              onRefresh={agentStatus.refresh}
            />

            {/* Graduation Feed - Only show when there are graduations */}
            {agentStatus.graduations.length > 0 && (
              <GraduationFeed
                graduations={agentStatus.graduations}
                isLoading={agentStatus.isLoading}
                onAnalyze={(tokenAddress) => {
                  setTokenInput(tokenAddress);
                  analyzeToken(tokenAddress);
                }}
              />
            )}

            {/* Token Input */}
            <div className="rounded-xl bg-[#0a0a0a] border border-[rgba(239,68,68,0.2)] p-3">
              <div className="h-[2px] bg-gradient-to-r from-[#EF4444] to-[#991B1B] -mt-3 -mx-3 mb-3 rounded-t-xl" />
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2">
                    <svg className="w-5 h-5 text-[#666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Paste Solana token address..."
                    value={tokenInput}
                    onChange={e => setTokenInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && analyzeToken(tokenInput)}
                    className="w-full pl-12 pr-4 py-3 rounded-lg border border-[#1a1a1a] bg-[#111] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#EF4444] focus:border-transparent font-mono"
                  />
                </div>
                <button
                  onClick={() => analyzeToken(tokenInput)}
                  disabled={isAnalyzing || !tokenInput.trim()}
                  className="px-6 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-[#EF4444] to-[#991B1B] text-white shadow-lg shadow-[rgba(239,68,68,0.2)] hover:shadow-[rgba(239,68,68,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
                {scansRemaining !== null && scansRemaining < 10 && (
                  <span className={`text-xs px-2 py-1 rounded ${scansRemaining <= 3 ? 'text-red-400 bg-red-500/10' : 'text-[#888] bg-[#111]'}`}>
                    {scansRemaining} scan{scansRemaining !== 1 ? 's' : ''} left today
                  </span>
                )}
              </div>

          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[#666]">Recent:</span>
              {recentSearches.slice(0, 6).map(s => (
                <button
                  key={s.address}
                  onClick={() => { setTokenInput(s.address); analyzeToken(s.address); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#111] border border-[#1a1a1a] text-[#888] hover:text-[#EF4444] hover:border-[rgba(239,68,68,0.3)] transition-all"
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
                  className="group px-3 py-1.5 rounded-lg text-xs font-medium bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] text-[#EF4444] hover:bg-[rgba(239,68,68,0.2)] transition-all flex items-center gap-1.5"
                >
                  {w.symbol}
                  <span className={`text-[10px] px-1 py-0.5 rounded ${SIGNAL_BG[w.signal]}`}>
                    {w.score}
                  </span>
                  <span
                    onClick={(e) => { e.stopPropagation(); removeFromWatchlist(w.address); }}
                    className="opacity-0 group-hover:opacity-100 text-[#666] hover:text-[#EF4444] transition-opacity"
                  >
                    x
                  </span>
                </button>
              ))}
            </div>
          )}
            </div>{/* End Token Input Card */}

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
          <div className="space-y-3">
            {/* Token Header Card - Combined with key badges */}
            <div className={`${cardBg} rounded-xl border ${cardBorder} p-3`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 bg-gradient-to-br ${isDangerous ? 'from-red-500 to-red-600' : 'from-emerald-500 to-emerald-600'} rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
                    {analysisResult.token.symbol.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className="text-base font-bold text-white">${analysisResult.token.symbol}</h2>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${SIGNAL_BG[analysisResult.ai.signal]}`}>
                        {analysisResult.ai.signal.replace('_', ' ')}
                      </span>
                      {analysisResult.bundles.detected && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-800/60 text-red-300">{analysisResult.bundles.count} BUNDLES</span>
                      )}
                      {analysisResult.security.isPumpFun ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-800/60 text-blue-300">PUMP</span>
                      ) : !(isMatureToken && lpLockedValue === 0) && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${hasRealLockedValue ? 'bg-emerald-800/60 text-emerald-300' : 'bg-red-800/60 text-red-300'}`}>{fmt(lpLockedValue)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <code className="text-[9px] text-zinc-500 font-mono truncate max-w-[100px]">{analysisResult.token.address}</code>
                      <button onClick={() => navigator.clipboard.writeText(analysisResult.token.address)} className="p-0.5 hover:bg-zinc-800 rounded" title="Copy">
                        <svg className="w-2.5 h-2.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      </button>
                      <button onClick={() => isInWatchlist(analysisResult.token.address) ? removeFromWatchlist(analysisResult.token.address) : addToWatchlist(analysisResult)} className={`p-0.5 rounded ${isInWatchlist(analysisResult.token.address) ? 'text-yellow-500' : 'text-zinc-500 hover:text-yellow-500'}`}>
                        <svg className="w-2.5 h-2.5" fill={isInWatchlist(analysisResult.token.address) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
                <ScoreGauge score={analysisResult.ai.score} aiScore={analysisResult.ai.aiScore} rulesOverride={analysisResult.ai.rulesOverride} />
              </div>
            </div>

            {/* Info Cards Grid - Compact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {/* Security Card */}
              <div className={`${cardBg} rounded-lg border ${securityIsDangerous ? 'border-red-800/50' : cardBorder} p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 ${securityIsDangerous ? 'bg-red-500/10' : 'bg-emerald-500/10'} rounded flex items-center justify-center`}>
                      <svg className={`w-3.5 h-3.5 ${securityIsDangerous ? 'text-red-500' : 'text-emerald-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <h3 className={`text-xs font-semibold ${securityIsDangerous ? 'text-red-500' : 'text-emerald-500'}`}>Security</h3>
                  </div>
                  {securityIsDangerous && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">
                      DANGER
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">Mint</span>
                    <span className={`text-[11px] font-semibold ${analysisResult.security.mintAuthorityRevoked ? 'text-green-500' : 'text-red-500'}`}>
                      {analysisResult.security.mintAuthorityRevoked ? '✓ Revoked' : '⚠ Active'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">Freeze</span>
                    <span className={`text-[11px] font-semibold ${analysisResult.security.freezeAuthorityRevoked ? 'text-green-500' : 'text-red-500'}`}>
                      {analysisResult.security.freezeAuthorityRevoked ? '✓ Revoked' : '⚠ Active'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">{analysisResult.security.isPumpFun ? 'LP' : 'Locked'}</span>
                    <span className={`text-[11px] font-semibold ${
                      analysisResult.security.isPumpFun
                        ? 'text-blue-400'
                        : isMatureToken && lpLockedValue === 0
                          ? 'text-zinc-400'
                          : hasRealLockedValue ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {analysisResult.security.isPumpFun
                        ? 'Bonding Curve'
                        : isMatureToken && lpLockedValue === 0
                          ? 'N/A'
                          : fmt(lpLockedValue)}
                    </span>
                  </div>
                </div>
                {!analysisResult.security.isPumpFun && !hasRealLockedValue && (
                  <div className="mt-2 pt-2 border-t border-red-800/30">
                    <p className="text-[10px] text-red-400 font-semibold">⚠ RUG RISK: &lt;$1K locked</p>
                  </div>
                )}
              </div>

              {/* Market Card */}
              <div className={`${cardBg} rounded-lg border ${cardBorder} p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 bg-emerald-500/10 rounded flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                    <h3 className="text-xs font-semibold text-emerald-500">Market</h3>
                  </div>
                  {analysisResult.market.sparkline && analysisResult.market.sparkline.length > 0 && (
                    <Sparkline data={analysisResult.market.sparkline} color={analysisResult.market.priceChange24h >= 0 ? '#10b981' : '#ef4444'} height={24} />
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">MCap</span>
                    <span className="text-[11px] font-semibold text-white">{fmt(analysisResult.market.marketCap)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">Liq</span>
                    <span className="text-[11px] font-semibold text-white">{fmt(analysisResult.market.liquidity)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">Vol 24h</span>
                    <span className="text-[11px] font-semibold text-white">{fmt(analysisResult.market.volume24h)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">24h</span>
                    <span className={`text-[11px] font-semibold ${pctColor(analysisResult.market.priceChange24h)}`}>
                      {fmtPct(analysisResult.market.priceChange24h)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Trading Activity Card */}
              <div className={`${cardBg} rounded-lg border ${cardBorder} p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 bg-emerald-500/10 rounded flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                    </div>
                    <h3 className="text-xs font-semibold text-emerald-500">Activity</h3>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${analysisResult.trading.buyRatio > 1 ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                    {analysisResult.trading.buyRatio.toFixed(1)}:1
                  </span>
                </div>
                <div className="space-y-1.5">
                  <PressureBar label="5m" buys={analysisResult.trading.buys5m} sells={analysisResult.trading.sells5m} />
                  <PressureBar label="1h" buys={analysisResult.trading.buys1h} sells={analysisResult.trading.sells1h} />
                  <PressureBar label="24h" buys={analysisResult.trading.buys24h} sells={analysisResult.trading.sells24h} />
                </div>
                <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500">24h Txns</span>
                  <span className="text-[10px] font-semibold text-white">
                    {(analysisResult.trading.buys24h + analysisResult.trading.sells24h).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Holders & AI Analysis - Compact */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {/* Top Holders */}
              <div className={`${cardBg} rounded-lg border ${cardBorder} p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 bg-emerald-500/10 rounded flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <h3 className="text-xs font-semibold text-emerald-500">Holders</h3>
                  </div>
                  {analysisResult.bundles.detected && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/50 text-red-400">
                      {analysisResult.bundles.count} BUNDLE{analysisResult.bundles.count > 1 ? 'S' : ''}
                    </span>
                  )}
                </div>
                {analysisResult.holders.top10.length > 0 && analysisResult.holders.topHolderPercent > 0 ? (
                  <div className="flex items-start gap-3">
                    <HolderDonut holders={analysisResult.holders.top10} />
                    <div className="flex-1 min-w-0">
                      <div className="space-y-1 mb-2">
                        {analysisResult.holders.top10.slice(0, 3).map((holder, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="text-[9px] text-zinc-500 w-2">{i + 1}</span>
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${holder.isBundle ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(holder.percent * 2, 100)}%` }} />
                            </div>
                            <span className={`text-[9px] font-mono ${holder.isBundle ? 'text-red-500' : 'text-zinc-400'}`}>{holder.percent.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 text-[9px]">
                        <span className="text-zinc-500">T1:<span className="text-white font-bold ml-0.5">{analysisResult.holders.topHolderPercent.toFixed(0)}%</span></span>
                        <span className="text-zinc-500">T5:<span className="text-white font-bold ml-0.5">{analysisResult.holders.top5Percent.toFixed(0)}%</span></span>
                        <span className="text-zinc-500">T10:<span className="text-white font-bold ml-0.5">{analysisResult.holders.top10Percent.toFixed(0)}%</span></span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-500">No holder data</p>
                )}
              </div>

              {/* AI Analysis - Compact */}
              <div className={`${cardBg} rounded-lg border ${cardBorder} p-3`}>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="text-xs font-semibold text-emerald-500">AI Analysis</h3>
                </div>

                {analysisResult.ai.rulesOverride && analysisResult.ai.aiScore !== undefined && (
                  <div className="bg-orange-500/10 border border-orange-500/30 rounded p-2 mb-2">
                    <p className="text-[10px] text-orange-300/80">
                      <span className="font-semibold text-orange-400">Guardrails:</span> AI rated <span className="font-mono font-bold" style={{ color: getScoreColor(analysisResult.ai.aiScore) }}>{analysisResult.ai.aiScore}</span> → adjusted to <span className="font-mono font-bold" style={{ color: getScoreColor(analysisResult.ai.score) }}>{analysisResult.ai.score}</span>
                    </p>
                  </div>
                )}

                <p className="text-[11px] text-zinc-300 leading-relaxed mb-2 line-clamp-3">{analysisResult.ai.verdict}</p>

                {/* Recommendation - compact */}
                {analysisResult.ai.recommendation && (
                  <div className={`rounded p-2 mb-2 ${
                    analysisResult.ai.signal === 'AVOID' ? 'bg-red-900/20' :
                    analysisResult.ai.signal === 'STRONG_BUY' || analysisResult.ai.signal === 'BUY' ? 'bg-emerald-900/20' : 'bg-zinc-800/50'
                  }`}>
                    <p className={`text-[10px] leading-relaxed line-clamp-2 ${
                      analysisResult.ai.signal === 'AVOID' ? 'text-red-300/80' :
                      analysisResult.ai.signal === 'STRONG_BUY' || analysisResult.ai.signal === 'BUY' ? 'text-emerald-300/80' : 'text-zinc-400'
                    }`}>{analysisResult.ai.recommendation}</p>
                  </div>
                )}

                {/* Flags - collapsed by default */}
                {analysisResult.ai.flags.length > 0 && (
                  <details className="mb-2">
                    <summary className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-400">
                      {analysisResult.ai.flags.length} flags (click to expand)
                    </summary>
                    <div className="mt-1 space-y-1 max-h-20 overflow-y-auto">
                      {analysisResult.ai.flags.slice(0, 5).map((flag, i) => (
                        <div key={i} className="flex items-start gap-1">
                          <span className={`px-1 rounded text-[9px] font-bold ${
                            flag.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                            flag.severity === 'HIGH' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-emerald-500/20 text-emerald-400'
                          }`}>{flag.severity === 'CRITICAL' ? '!' : flag.severity === 'HIGH' ? '!' : '✓'}</span>
                          <span className="text-[10px] text-zinc-500 line-clamp-1">{flag.message}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Links - compact inline */}
                <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-1.5 flex-wrap">
                  <a href={analysisResult.links.dexscreener} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-[10px] bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700">DEX</a>
                  {analysisResult.links.website && (
                    <a href={analysisResult.links.website} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-[10px] bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700">Web</a>
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

            {/* Bundle Warning - Compact */}
            {analysisResult.bundles.detected && (
              <div className="p-2 rounded-lg bg-red-900/30 border border-red-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-red-400">
                    {analysisResult.bundles.confidence === 'HIGH' ? '⚠ Pump Syndicate' : '⚠ Bundle Warning'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-800/60 text-red-300">
                    {analysisResult.bundles.count} wallets
                  </span>
                  {analysisResult.bundles.controlPercent > 0 && (
                    <span className="text-[10px] text-red-400">{analysisResult.bundles.controlPercent.toFixed(1)}% supply</span>
                  )}
                </div>
                <button
                  onClick={() => setShowBundleNetwork(true)}
                  className="px-2 py-1 rounded text-[10px] font-bold bg-zinc-700/80 text-zinc-300 hover:bg-zinc-600/80"
                >
                  VIEW MAP
                </button>
              </div>
            )}

            {/* Compact Warning Pills */}
            <div className="flex flex-wrap gap-2">
              {analysisResult.bundles.washTrading?.detected && (
                <span className="px-2 py-1 rounded text-[10px] font-bold bg-orange-900/30 border border-orange-800 text-orange-400">
                  ⚠ Wash Trading: {analysisResult.bundles.washTrading.washTradingPercent.toFixed(0)}% fake buys
                </span>
              )}
              {analysisResult.bundles.syndicateNetwork?.detected && (
                <span className="px-2 py-1 rounded text-[10px] font-bold bg-purple-900/30 border border-purple-800 text-purple-400">
                  ⚠ Syndicate: {analysisResult.bundles.syndicateNetwork.repeatOffenders} repeat offenders
                </span>
              )}
              {analysisResult.devActivity && analysisResult.devActivity.severity !== 'NONE' && (
                <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                  analysisResult.devActivity.severity === 'CRITICAL' || analysisResult.devActivity.severity === 'HIGH'
                    ? 'bg-red-900/30 border border-red-800 text-red-400'
                    : 'bg-amber-900/30 border border-amber-800 text-amber-400'
                }`}>
                  Dev: {analysisResult.devActivity.hasSold ? `Sold ${analysisResult.devActivity.percentSold.toFixed(0)}%` : `Holds ${analysisResult.devActivity.currentHoldingsPercent.toFixed(1)}%`}
                </span>
              )}
            </div>

            {/* Buy Controls - Hidden, using fixed BuyBar instead */}
            <div className="hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <span className="text-sm font-medium text-zinc-500">Amount:</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {[0.05, 0.1, 0.2, 0.5, 1].map(amt => (
                      <button
                        key={amt}
                        onClick={() => { setBuyAmount(amt); setShowCustomBuy(false); }}
                        className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          buyAmount === amt && !showCustomBuy
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        {amt} SOL
                      </button>
                    ))}
                    {showCustomBuy ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={customBuyValue}
                          onChange={(e) => setCustomBuyValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = parseFloat(customBuyValue);
                              if (val > 0) setBuyAmount(val);
                            }
                          }}
                          onBlur={() => {
                            const val = parseFloat(customBuyValue);
                            if (val > 0) setBuyAmount(val);
                          }}
                          className="w-20 px-2 py-2 rounded-lg text-sm font-medium bg-zinc-800 border border-emerald-500 text-white outline-none"
                          autoFocus
                        />
                        <span className="text-xs text-zinc-500">SOL</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setShowCustomBuy(true); setCustomBuyValue(buyAmount.toString()); }}
                        className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          ![0.05, 0.1, 0.2, 0.5, 1].includes(buyAmount)
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        {![0.05, 0.1, 0.2, 0.5, 1].includes(buyAmount) ? `${buyAmount} SOL` : 'Custom'}
                      </button>
                    )}
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
                <div className="flex gap-2 w-full sm:w-auto">
                  {autoTrade.state.positions.some(p => p.tokenAddress === analysisResult.token.address) && (
                    <button
                      onClick={handleSell}
                      disabled={!autoTrade.wallet.isLoaded || isSelling}
                      className="w-full sm:w-auto px-6 sm:px-8 py-3 rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-xl bg-gradient-to-r from-red-500 to-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                      {isSelling ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                          </svg>
                          Selling...
                        </span>
                      ) : `Sell ${analysisResult.token.symbol}`}
                    </button>
                  )}
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
              </div>

              {/* Expandable Trade Settings */}
              {showBuyConfig && (
                <div className="mt-4 pt-4 border-t border-zinc-800 space-y-4">
                  {/* Buy Config */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                  {/* Auto-Sell */}
                  <div className="pt-3 border-t border-zinc-800">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs text-zinc-500 font-medium">Auto-Sell</label>
                      <button
                        onClick={() => autoTrade.updateConfig({ autoSellEnabled: !autoTrade.config.autoSellEnabled })}
                        className={`w-10 h-5 rounded-full transition-colors relative ${autoTrade.config.autoSellEnabled ? 'bg-green-500' : 'bg-zinc-600'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoTrade.config.autoSellEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs text-zinc-500 mb-2 block">Take Profit</label>
                        <div className="flex gap-1.5">
                          {[50, 100, 200, 500].map(t => (
                            <button
                              key={t}
                              onClick={() => autoTrade.updateConfig({ takeProfitPercent: t })}
                              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.takeProfitPercent === t ? 'bg-green-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
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
                              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.stopLossPercent === s ? 'bg-red-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
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
                              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.trailingStopPercent === t ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                            >
                              {t === 0 ? 'Off' : `-${t}%`}
                            </button>
                          ))}
                        </div>
                      </div>
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

          </div>{/* End Left Column */}

          {/* Right Column - Activity Feed (Sticky) */}
          <div className="xl:sticky xl:top-6 xl:self-start">
            <ActivityFeed
              events={agentStatus.activity}
              maxVisible={15}
              onAnalyze={(tokenAddress) => {
                setTokenInput(tokenAddress);
                analyzeToken(tokenAddress);
              }}
              onClear={agentStatus.clearActivity}
            />
          </div>{/* End Right Column */}
        </div>{/* End Two Column Grid */}

        {/* Compact Empty State - Only show if no positions either */}
        {!analysisResult && !isAnalyzing && !analysisError && autoTrade.state.positions.length === 0 && (
          <div className="mt-6 p-6 rounded-xl bg-[#0a0a0a] border border-[#1a1a1a] text-center">
            <div className="flex items-center justify-center gap-4 text-[#666]">
              <svg className="w-5 h-5 text-[#EF4444]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="text-sm">Paste a token address above to begin analysis</span>
            </div>
            {!autoTrade.wallet.isLoaded && (
              <p className="mt-3 text-xs text-[#666]">
                <span className="text-[#EF4444]">Tip:</span> Create a trading wallet to enable one-click buys
              </p>
            )}
          </div>
        )}

        {/* Positions - Only show when there are positions */}
        {autoTrade.state.positions.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[10px] font-bold text-[#EF4444] tracking-wider uppercase">Positions</h3>
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#EF4444] text-white">
                {autoTrade.state.positions.length}
              </span>
              {autoTrade.state.totalTraded > 0 && (
                <span className={`text-[10px] ${autoTrade.state.totalProfitSol >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {autoTrade.state.totalProfitSol >= 0 ? '+' : ''}{autoTrade.state.totalProfitSol.toFixed(4)} SOL
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => autoTrade.sellAllPositions()}
                className="px-2 py-1 rounded text-[9px] font-semibold bg-red-900/50 text-red-400 hover:bg-red-900/70 transition-colors"
              >
                Sell All
              </button>
              <button
                onClick={() => autoTrade.clearAllPositions()}
                className="px-2 py-1 rounded text-[9px] font-semibold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="bg-[#0a0a0a] rounded-lg border border-[rgba(239,68,68,0.2)] overflow-hidden">
            <table className="w-full min-w-[400px]">
                <thead>
                  <tr className="bg-[#111] text-[9px] uppercase tracking-wider text-[#666]">
                    <th className="px-3 py-2 text-left font-semibold">Token</th>
                    <th className="px-3 py-2 text-right font-semibold">Entry</th>
                    <th className="px-3 py-2 text-right font-semibold">Current</th>
                    <th className="px-3 py-2 text-right font-semibold">P&L</th>
                    <th className="px-3 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {autoTrade.state.positions.map((p, i) => (
                    <tr key={`${p.tokenAddress}-${i}`} className="border-t border-[#1a1a1a] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                      <td className="px-3 py-2">
                        <a
                          href={`https://dexscreener.com/solana/${p.tokenAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#EF4444] hover:text-[#F87171]"
                        >
                          {p.tokenSymbol}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right text-[10px] text-[#888]">{p.entrySolAmount.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right text-[10px] text-[#888]">{p.currentValueSol.toFixed(3)}</td>
                      <td className={`px-3 py-2 text-right text-[10px] font-bold ${p.pnlPercent >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                        {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => autoTrade.manualSell(p.tokenAddress)}
                          className="px-2 py-1 rounded text-[9px] font-semibold bg-[#111] border border-[#1a1a1a] text-[#888] hover:text-[#EF4444] hover:border-[rgba(239,68,68,0.3)] transition-all"
                        >
                          Sell
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        </div>
        )}

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

      {/* Fixed Buy Bar - Always visible when analyzing */}
      {analysisResult && (
        <BuyBar
          tokenSymbol={analysisResult.token.symbol}
          tokenAddress={analysisResult.token.address}
          signal={analysisResult.ai.signal}
          score={analysisResult.ai.score}
          walletLoaded={autoTrade.wallet.isLoaded}
          walletBalance={autoTrade.wallet.balance}
          hasPosition={autoTrade.state.positions.some(p => p.tokenAddress === analysisResult.token.address)}
          isBuying={isBuying}
          isSelling={isSelling}
          onBuy={(amount) => {
            setBuyAmount(amount);
            handleBuy();
          }}
          onSell={handleSell}
        />
      )}

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

      {/* Export Key Warning Modal */}
      {showExportKeyModal && (
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
                <h3 className="text-lg font-bold text-white">Export Private Key</h3>
                <p className="text-sm text-zinc-400">Danger Zone</p>
              </div>
            </div>

            {/* Warning */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-amber-300 font-medium mb-2">
                Your private key gives FULL control of this wallet.
              </p>
              <ul className="text-xs text-amber-400/80 space-y-1">
                <li>Never share it with anyone</li>
                <li>Never paste it on any website</li>
                <li>Never send it via email or chat</li>
                <li>Store it in a secure, offline location</li>
              </ul>
            </div>

            {/* Info */}
            <div className="bg-zinc-800 rounded-lg p-3 mb-4">
              <div className="text-xs text-zinc-500 mb-1">Wallet Address</div>
              <div className="text-sm font-mono text-zinc-300 truncate">{autoTrade.wallet.address}</div>
              <div className="text-xs text-zinc-500 mt-2">Balance</div>
              <div className="text-sm font-semibold text-white">{autoTrade.wallet.balance.toFixed(4)} SOL</div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowExportKeyModal(false)}
                className="flex-1 py-3 rounded-lg font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const k = await autoTrade.exportPrivateKey();
                  if (k) {
                    navigator.clipboard.writeText(k);
                    setExportKeyCopied(true);
                    setTimeout(() => setExportKeyCopied(false), 2000);
                    log('Private key copied to clipboard', 'success');
                  }
                  setShowExportKeyModal(false);
                }}
                className="flex-1 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
              >
                I Understand, Copy Key
              </button>
            </div>
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
                onClick={async () => {
                  await autoTrade.deleteWallet();
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

      {/* Buy Warning Modal */}
      {buyWarning && (
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
                <h3 className="text-lg font-bold text-white">Risk Warning</h3>
                <p className="text-sm text-zinc-400">Safety check flagged this token</p>
              </div>
            </div>

            {/* Warning Details */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
              <p className="text-sm text-amber-400 font-medium">{buyWarning.message}</p>
            </div>

            <p className="text-sm text-zinc-400 mb-4">
              Are you sure you want to buy <span className="font-semibold text-white">${buyWarning.symbol}</span>? This token has been flagged for potential risks.
            </p>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setBuyWarning(null);
                  log('Buy cancelled by user', 'info');
                }}
                className="flex-1 py-3 rounded-lg font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBuyConfirm}
                className="flex-1 py-3 rounded-lg font-semibold bg-amber-500 text-black hover:bg-amber-400 transition-colors"
              >
                Buy Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deep Link Confirmation Modal (from Telegram/X) */}
      {pendingDeepLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Analyze Token?</h3>
                <p className="text-sm text-zinc-400">From Telegram/X link</p>
              </div>
            </div>

            {/* Token Address */}
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 mb-4">
              <p className="text-xs text-zinc-500 mb-1">Token Address</p>
              <p className="text-sm text-white font-mono break-all">{pendingDeepLink}</p>
            </div>

            {/* Warning */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
              <p className="text-sm text-amber-400">
                <span className="font-semibold">This will use 1 of your daily scans.</span>
                {scansRemaining !== null && (
                  <span className="block mt-1 text-amber-400/80">
                    You have {scansRemaining} scan{scansRemaining !== 1 ? 's' : ''} remaining today.
                  </span>
                )}
              </p>
            </div>

            <p className="text-sm text-zinc-400 mb-4">
              Hold 1K+ $ARGUS tokens for unlimited scans.
            </p>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setPendingDeepLink(null)}
                className="flex-1 py-3 rounded-lg font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const token = pendingDeepLink;
                  setPendingDeepLink(null);
                  analyzeToken(token);
                }}
                className="flex-1 py-3 rounded-lg font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors"
              >
                Analyze
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bundle Network Graph Modal */}
      {showBundleNetwork && analysisResult && analysisResult.bundles.wallets && analysisResult.bundles.wallets.length > 0 && (
        <BundleNetworkGraph
          tokenSymbol={analysisResult.token.symbol}
          tokenAddress={analysisResult.token.address}
          wallets={(() => {
            const walletsFromApi = analysisResult.bundles.walletsWithHoldings || [];
            return analysisResult.bundles.wallets.map(addr => {
              const apiWallet = walletsFromApi.find(w => w.address === addr);
              if (apiWallet && apiWallet.percent > 0) {
                return { address: addr, percent: apiWallet.percent, isHolder: true };
              }
              const holderMatch = analysisResult.holders.top10.find(h => h.address === addr);
              return { address: addr, percent: holderMatch?.percent || 0, isHolder: !!holderMatch || (apiWallet?.percent || 0) > 0 };
            });
          })()}
          controlPercent={analysisResult.bundles.controlPercent || 0}
          onClose={() => setShowBundleNetwork(false)}
        />
      )}
    </div>
  );
}
