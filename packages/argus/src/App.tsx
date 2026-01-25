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

const API_URL = 'http://localhost:8788';
const RECENT_SEARCHES_KEY = 'argus_recent_searches';

export default function App() {
  const [tokenInput, setTokenInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<Array<{ address: string; symbol: string }>>([]);
  const [buyAmount, setBuyAmount] = useState(0.05);
  const [isBuying, setIsBuying] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: Date; msg: string; type: string }>>([]);
  const [showSettings, setShowSettings] = useState(false);

  // Wallet management
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [withdrawAddr, setWithdrawAddr] = useState('');

  const log = useCallback((msg: string, type = 'info') => {
    setLogs(prev => [...prev.slice(-49), { time: new Date(), msg, type }]);
  }, []);

  const autoTrade = useAutoTrade({}, undefined, log);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) setRecentSearches(JSON.parse(saved));
    } catch {}
  }, []);

  // Save recent searches to localStorage
  const addRecentSearch = (address: string, symbol: string) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(s => s.address !== address);
      const updated = [{ address, symbol }, ...filtered].slice(0, 10);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
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
      const response = await fetch(`${API_URL}/api/analyze-full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Analysis failed');
      }

      const result: AnalysisResult = await response.json();
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
    if (n === undefined || n === null) return 'text-gray-500';
    return n >= 0 ? 'text-green-600' : 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-900 to-slate-700 rounded-xl flex items-center justify-center shadow-lg">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4L28 26H4L16 4Z" stroke="white" strokeWidth="2" fill="none"/>
                  <ellipse cx="16" cy="16" rx="6" ry="4" stroke="white" strokeWidth="1.5" fill="none"/>
                  <circle cx="16" cy="16" r="2" fill="white"/>
                </svg>
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold tracking-tight text-slate-900">ARGUS</span>
                  <span className="text-slate-400 font-light">AI</span>
                </div>
                <div className="text-[10px] text-slate-400 tracking-wider uppercase">Token Research</div>
              </div>
            </div>

            {/* Right Side - Wallet & Settings */}
            <div className="flex items-center gap-3">
              {/* Settings Button */}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2.5 rounded-lg transition-all ${showSettings ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
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
                    className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl shadow-lg hover:shadow-xl transition-all"
                  >
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 font-mono">{autoTrade.wallet.address?.slice(0, 6)}...{autoTrade.wallet.address?.slice(-4)}</div>
                      <div className="text-sm font-bold">{autoTrade.wallet.balance.toFixed(3)} SOL</div>
                    </div>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Wallet Dropdown */}
                  {showWalletMenu && (
                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50">
                      <div className="p-4 bg-slate-50 border-b border-slate-200">
                        <div className="text-xs text-slate-500 mb-1">Wallet Address</div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-slate-700 flex-1 truncate">{autoTrade.wallet.address}</code>
                          <button
                            onClick={() => navigator.clipboard.writeText(autoTrade.wallet.address || '')}
                            className="p-1 hover:bg-slate-200 rounded"
                          >
                            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                          <button
                            onClick={() => { autoTrade.withdraw(withdrawAddr); setWithdrawAddr(''); }}
                            disabled={!withdrawAddr}
                            className="px-3 py-2 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                          >
                            Send
                          </button>
                        </div>
                        <div className="flex gap-2 pt-2 border-t border-slate-100">
                          <button
                            onClick={() => { autoTrade.refreshBalance(); }}
                            className="flex-1 px-3 py-2 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                          >
                            Refresh
                          </button>
                          <button
                            onClick={() => { const k = autoTrade.exportPrivateKey(); if (k) { navigator.clipboard.writeText(k); log('Key copied!', 'success'); }}}
                            className="flex-1 px-3 py-2 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                          >
                            Export Key
                          </button>
                          <button
                            onClick={() => { if (confirm('Delete wallet? Make sure you exported your key!')) { autoTrade.deleteWallet(); setShowWalletMenu(false); }}}
                            className="flex-1 px-3 py-2 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
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
                        onClick={() => autoTrade.generateWallet()}
                        className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg hover:shadow-xl transition-all"
                      >
                        Create Wallet
                      </button>
                      <button
                        onClick={() => setShowImport(true)}
                        className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
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
                        className="px-3 py-2 rounded-lg text-sm border border-slate-200 w-64 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      <button
                        onClick={() => { autoTrade.importWallet(importKey); setImportKey(''); setShowImport(false); }}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white"
                      >
                        Import
                      </button>
                      <button
                        onClick={() => setShowImport(false)}
                        className="px-4 py-2 rounded-lg text-sm bg-slate-100 text-slate-600"
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

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="grid grid-cols-3 gap-6">
              {/* Auto-Sell Settings */}
              <div className="bg-slate-50 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900">Auto-Sell</h3>
                  <button
                    onClick={() => autoTrade.updateConfig({ autoSellEnabled: !autoTrade.config.autoSellEnabled })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${autoTrade.config.autoSellEnabled ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoTrade.config.autoSellEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-500 mb-2 block">Take Profit</label>
                    <div className="flex gap-1.5">
                      {[50, 100, 200, 500].map(t => (
                        <button
                          key={t}
                          onClick={() => autoTrade.updateConfig({ takeProfitPercent: t })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.takeProfitPercent === t ? 'bg-green-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                          +{t}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-2 block">Stop Loss</label>
                    <div className="flex gap-1.5">
                      {[20, 30, 50, 70].map(s => (
                        <button
                          key={s}
                          onClick={() => autoTrade.updateConfig({ stopLossPercent: s })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.stopLossPercent === s ? 'bg-red-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                          -{s}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-2 block">Trailing Stop</label>
                    <div className="flex gap-1.5">
                      {[0, 10, 20, 30].map(t => (
                        <button
                          key={t}
                          onClick={() => autoTrade.updateConfig({ trailingStopPercent: t })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.trailingStopPercent === t ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                          {t === 0 ? 'Off' : `-${t}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Buy Settings */}
              <div className="bg-slate-50 rounded-xl p-5">
                <h3 className="font-semibold text-slate-900 mb-4">Buy Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-500 mb-2 block">Default Amount</label>
                    <div className="flex gap-1.5">
                      {[0.01, 0.05, 0.1, 0.25].map(a => (
                        <button
                          key={a}
                          onClick={() => { autoTrade.updateConfig({ buyAmountSol: a }); setBuyAmount(a); }}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.buyAmountSol === a ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                          {a} SOL
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-2 block">Max Slippage</label>
                    <div className="flex gap-1.5">
                      {[100, 300, 500, 1000].map(s => (
                        <button
                          key={s}
                          onClick={() => autoTrade.updateConfig({ maxSlippageBps: s })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.maxSlippageBps === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                          {s / 100}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-2 block">Reserve Balance</label>
                    <div className="flex gap-1.5">
                      {[0.05, 0.1, 0.2, 0.5].map(r => (
                        <button
                          key={r}
                          onClick={() => autoTrade.updateConfig({ reserveBalanceSol: r })}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${autoTrade.config.reserveBalanceSol === r ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                          {r} SOL
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats & History */}
              <div className="bg-slate-50 rounded-xl p-5">
                <h3 className="font-semibold text-slate-900 mb-4">Statistics</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-xs text-slate-500">Total Trades</div>
                    <div className="text-xl font-bold text-slate-900">{autoTrade.state.totalTraded}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-xs text-slate-500">Success Rate</div>
                    <div className="text-xl font-bold text-slate-900">
                      {autoTrade.state.totalTraded > 0 ? ((autoTrade.state.totalSuccessful / autoTrade.state.totalTraded) * 100).toFixed(0) : 0}%
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-xs text-slate-500">Total Sold</div>
                    <div className="text-xl font-bold text-slate-900">{autoTrade.state.totalSold}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-xs text-slate-500">Total P&L</div>
                    <div className={`text-xl font-bold ${autoTrade.state.totalProfitSol >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {autoTrade.state.totalProfitSol >= 0 ? '+' : ''}{autoTrade.state.totalProfitSol.toFixed(4)} SOL
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { if (confirm('Clear all history?')) autoTrade.clearHistory(); }}
                  className="w-full mt-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-white rounded-lg transition-colors"
                >
                  Clear History
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Token Input */}
        <div className="mb-8">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Paste Solana token address..."
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyzeToken(tokenInput)}
                className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono shadow-sm"
              />
            </div>
            <button
              onClick={() => analyzeToken(tokenInput)}
              disabled={isAnalyzing || !tokenInput.trim()}
              className="px-8 py-4 rounded-xl text-sm font-semibold bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
              <span className="text-xs text-slate-400">Recent:</span>
              {recentSearches.slice(0, 6).map(s => (
                <button
                  key={s.address}
                  onClick={() => { setTokenInput(s.address); analyzeToken(s.address); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all"
                >
                  {s.symbol}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error Message */}
        {analysisError && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {analysisError}
          </div>
        )}

        {/* Analysis Results */}
        {analysisResult && (
          <div className="space-y-6">
            {/* Token Header Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="w-16 h-16 bg-gradient-to-br from-slate-900 to-slate-700 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg">
                    {analysisResult.token.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-2xl font-bold text-slate-900">${analysisResult.token.symbol}</h2>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${SIGNAL_BG[analysisResult.ai.signal]}`}>
                        {analysisResult.ai.signal.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-slate-400 font-mono">{analysisResult.token.address}</code>
                      <button
                        onClick={() => navigator.clipboard.writeText(analysisResult.token.address)}
                        className="p-1 hover:bg-slate-100 rounded"
                      >
                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-bold" style={{ color: SIGNAL_COLORS[analysisResult.ai.signal] }}>
                    {analysisResult.ai.score}
                  </div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider">AI Score</div>
                </div>
              </div>
            </div>

            {/* Info Cards Grid */}
            <div className="grid grid-cols-3 gap-4">
              {/* Security Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-900">Security</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Mint Authority</span>
                    <span className={`text-sm font-semibold flex items-center gap-1 ${analysisResult.security.mintAuthorityRevoked ? 'text-green-600' : 'text-red-600'}`}>
                      {analysisResult.security.mintAuthorityRevoked ? (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Revoked</>
                      ) : (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Active</>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Freeze Authority</span>
                    <span className={`text-sm font-semibold flex items-center gap-1 ${analysisResult.security.freezeAuthorityRevoked ? 'text-green-600' : 'text-red-600'}`}>
                      {analysisResult.security.freezeAuthorityRevoked ? (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Revoked</>
                      ) : (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Active</>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">LP Locked</span>
                    <span className={`text-sm font-semibold ${analysisResult.security.lpLockedPercent > 50 ? 'text-green-600' : 'text-amber-600'}`}>
                      {analysisResult.security.lpLockedPercent.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Market Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-slate-900">Market</h3>
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
                    <span className="text-sm text-slate-500">Market Cap</span>
                    <span className="text-sm font-semibold text-slate-900">{fmt(analysisResult.market.marketCap)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Liquidity</span>
                    <span className="text-sm font-semibold text-slate-900">{fmt(analysisResult.market.liquidity)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">24h Volume</span>
                    <span className="text-sm font-semibold text-slate-900">{fmt(analysisResult.market.volume24h)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Price (24h)</span>
                    <span className={`text-sm font-semibold ${pctColor(analysisResult.market.priceChange24h)}`}>
                      {fmtPct(analysisResult.market.priceChange24h)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Trading Activity Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-900">Activity</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Buys (1h)</span>
                    <span className="text-sm font-semibold text-green-600">{analysisResult.trading.buys1h}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Sells (1h)</span>
                    <span className="text-sm font-semibold text-red-600">{analysisResult.trading.sells1h}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Buy Ratio</span>
                    <span className={`text-sm font-semibold ${analysisResult.trading.buyRatio > 1 ? 'text-green-600' : 'text-red-600'}`}>
                      {analysisResult.trading.buyRatio.toFixed(2)}:1
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">24h Txns</span>
                    <span className="text-sm font-semibold text-slate-900">
                      {analysisResult.trading.buys24h + analysisResult.trading.sells24h}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Holders & AI Analysis */}
            <div className="grid grid-cols-2 gap-4">
              {/* Top Holders */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-slate-900">Top Holders</h3>
                  </div>
                  {analysisResult.bundles.detected && (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {analysisResult.bundles.count} BUNDLE{analysisResult.bundles.count > 1 ? 'S' : ''}
                    </span>
                  )}
                </div>
                <div className="space-y-2.5">
                  {analysisResult.holders.top10.slice(0, 5).map((holder, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-4">{i + 1}</span>
                      <div className="flex-1">
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${holder.isBundle ? 'bg-gradient-to-r from-red-500 to-red-400' : 'bg-gradient-to-r from-slate-800 to-slate-600'}`}
                            style={{ width: `${Math.min(holder.percent * 2, 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className={`text-xs font-mono w-12 text-right font-semibold ${holder.isBundle ? 'text-red-600' : 'text-slate-600'}`}>
                        {holder.percent.toFixed(1)}%
                      </span>
                      <code className="text-[10px] text-slate-400 w-20 truncate">
                        {holder.address.slice(0, 4)}...{holder.address.slice(-4)}
                      </code>
                      {holder.isBundle && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-semibold">B{holder.bundleId}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-xs text-slate-400 mb-1">Top 1</div>
                    <div className="text-sm font-bold text-slate-900">{analysisResult.holders.topHolderPercent.toFixed(1)}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-slate-400 mb-1">Top 5</div>
                    <div className="text-sm font-bold text-slate-900">{analysisResult.holders.top5Percent.toFixed(1)}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-slate-400 mb-1">Top 10</div>
                    <div className="text-sm font-bold text-slate-900">{analysisResult.holders.top10Percent.toFixed(1)}%</div>
                  </div>
                </div>
              </div>

              {/* AI Verdict */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-900">AI Analysis</h3>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed mb-4">{analysisResult.ai.verdict}</p>

                {/* Bundle Warning */}
                {analysisResult.bundles.detected && (
                  <div className="p-4 rounded-xl bg-gradient-to-r from-red-50 to-orange-50 border border-red-200">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-sm font-bold text-red-700">Bundle Warning</span>
                    </div>
                    <p className="text-sm text-red-600">
                      {analysisResult.bundles.count} coordinated wallet cluster{analysisResult.bundles.count > 1 ? 's' : ''} detected holding {analysisResult.bundles.totalPercent.toFixed(1)}% of supply. This may indicate coordinated trading.
                    </p>
                  </div>
                )}

                {/* Links */}
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                  <a
                    href={analysisResult.links.dexscreener}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    DexScreener
                  </a>
                  {analysisResult.links.website && (
                    <a href={analysisResult.links.website} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">
                      Website
                    </a>
                  )}
                  {analysisResult.links.twitter && (
                    <a href={analysisResult.links.twitter} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">
                      Twitter
                    </a>
                  )}
                  {analysisResult.links.telegram && (
                    <a href={analysisResult.links.telegram} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">
                      Telegram
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Buy Controls */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-slate-500">Amount:</span>
                  <div className="flex gap-2">
                    {[0.01, 0.05, 0.1, 0.25, 0.5].map(amt => (
                      <button
                        key={amt}
                        onClick={() => setBuyAmount(amt)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          buyAmount === amt
                            ? 'bg-slate-900 text-white shadow-md'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {amt} SOL
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleBuy}
                  disabled={!autoTrade.wallet.isLoaded || isBuying || autoTrade.wallet.balance < buyAmount}
                  className={`px-10 py-3 rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-xl ${
                    analysisResult.ai.signal === 'AVOID'
                      ? 'bg-gradient-to-r from-red-500 to-red-600 text-white'
                      : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white'
                  } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
                >
                  {isBuying ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      Buying...
                    </span>
                  ) : `Buy ${analysisResult.token.symbol}`}
                </button>
              </div>
              {!autoTrade.wallet.isLoaded && (
                <p className="mt-3 text-sm text-slate-400">Create or import a trading wallet to buy tokens</p>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!analysisResult && !isAnalyzing && !analysisError && (
          <div className="text-center py-24">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
              <svg className="w-10 h-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-2">Token Research Tool</h3>
            <p className="text-slate-500 max-w-lg mx-auto leading-relaxed">
              Paste a Solana token address above to get comprehensive AI analysis including security checks, holder distribution, bundle detection, and trading signals.
            </p>
            <div className="mt-8 flex justify-center gap-4 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Security Analysis
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Bundle Detection
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              <h3 className="text-lg font-bold text-slate-900">Your Positions</h3>
              {autoTrade.state.positions.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-900 text-white">
                  {autoTrade.state.positions.length}
                </span>
              )}
            </div>
            {autoTrade.state.positions.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => autoTrade.sellAllPositions()}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                >
                  Sell All
                </button>
                <button
                  onClick={() => autoTrade.clearAllPositions()}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Clear All
                </button>
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            {autoTrade.state.positions.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 text-left font-semibold">Token</th>
                    <th className="px-5 py-3 text-right font-semibold">Entry</th>
                    <th className="px-5 py-3 text-right font-semibold">Current</th>
                    <th className="px-5 py-3 text-right font-semibold">P&L</th>
                    <th className="px-5 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {autoTrade.state.positions.map((p, i) => (
                    <tr key={`${p.tokenAddress}-${i}`} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4">
                        <a
                          href={`https://dexscreener.com/solana/${p.tokenAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-slate-900 hover:text-slate-600"
                        >
                          {p.tokenSymbol}
                        </a>
                      </td>
                      <td className="px-5 py-4 text-right text-sm text-slate-600">{p.entrySolAmount.toFixed(4)} SOL</td>
                      <td className="px-5 py-4 text-right text-sm text-slate-600">{p.currentValueSol.toFixed(4)} SOL</td>
                      <td className={`px-5 py-4 text-right text-sm font-bold ${p.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(1)}%
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => autoTrade.manualSell(p.tokenAddress)}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
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
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <p className="text-sm text-slate-500">No positions yet</p>
                <p className="text-xs text-slate-400 mt-1">Buy a token to start tracking</p>
              </div>
            )}
          </div>
        </div>

        {/* Activity Log */}
        {logs.length > 0 && (
          <div className="mt-8">
            <details className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <summary className="px-5 py-4 text-sm font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors">
                Activity Log ({logs.length})
              </summary>
              <div className="px-5 pb-4 max-h-48 overflow-auto border-t border-slate-100">
                <div className="space-y-1 pt-3 text-xs font-mono">
                  {logs.slice().reverse().map((l, i) => (
                    <div key={i} className={
                      l.type === 'success' ? 'text-green-600' :
                      l.type === 'error' ? 'text-red-600' :
                      l.type === 'warning' ? 'text-amber-600' :
                      'text-slate-500'
                    }>
                      <span className="text-slate-400">{l.time.toLocaleTimeString('en-US', { hour12: false })}</span> {l.msg}
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
    </div>
  );
}
