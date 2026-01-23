import { useState, useEffect, useRef, useCallback } from 'react';
import { useAutoTrade } from './hooks/useAutoTrade';

interface DiscoveredToken {
  address: string;
  symbol: string;
  name?: string;
  status: 'pending' | 'filtered' | 'analyzing' | 'approved' | 'rejected' | 'traded';
  riskScore?: number;
  timestamp: number;
  marketCap?: number;
  liquidity?: number;
}

interface Stats {
  total: number;
  passedAll: number;
  sentToAI: number;
  aiApproved: number;
  traded: number;
}

const WS_URL = 'ws://localhost:8788/ws';
const API_URL = 'http://localhost:8788';

type Page = 'dashboard' | 'positions' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [wsConnected, setWsConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);

  const [tokens, setTokens] = useState<DiscoveredToken[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, passedAll: 0, sentToAI: 0, aiApproved: 0, traded: 0 });
  const [logs, setLogs] = useState<Array<{ time: Date; msg: string; type: string }>>([]);

  const log = useCallback((msg: string, type = 'info') => {
    setLogs(prev => {
      if (prev.length > 0 && prev[prev.length - 1].msg === msg) return prev;
      return [...prev.slice(-99), { time: new Date(), msg, type }];
    });
  }, []);

  const autoTrade = useAutoTrade(
    {}, // Use defaults from useAutoTrade - config persisted in localStorage
    (trade) => {
      if (trade.status === 'success') {
        setTokens(prev => prev.map(t => t.address === trade.tokenAddress ? { ...t, status: 'traded' as const } : t));
      }
    },
    log
  );

  const [showImport, setShowImport] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [withdrawAddr, setWithdrawAddr] = useState('');

  useEffect(() => {
    const connect = () => {
      try {
        const ws = new WebSocket(WS_URL);
        ws.onopen = () => { setWsConnected(true); log('Connected to server', 'success'); };
        ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch {} };
        ws.onclose = () => { setWsConnected(false); reconnectRef.current = setTimeout(connect, 3000); };
        wsRef.current = ws;
      } catch { reconnectRef.current = setTimeout(connect, 3000); }
    };
    connect();
    return () => { reconnectRef.current && clearTimeout(reconnectRef.current); wsRef.current?.close(); };
  }, []);

  useEffect(() => {
    const sync = async () => {
      try {
        const [s1, s2] = await Promise.all([fetch(`${API_URL}/api/prefilter/stats`), fetch(`${API_URL}/api/status`)]);
        if (s1.ok) setStats(await s1.json());
        if (s2.ok) { const d = await s2.json(); setIsRunning(d.status === 'running'); }
      } catch {}
    };
    sync();
    const i = setInterval(sync, 2000);
    return () => clearInterval(i);
  }, []);

  const handleMessage = (msg: any) => {
    if (msg.type === 'NEW_TOKEN') {
      setTokens(prev => {
        if (prev.some(t => t.address === msg.data.address)) return prev;
        log(`Discovered ${msg.data.symbol || 'token'}`);
        return [{ address: msg.data.address, symbol: msg.data.symbol || '???', status: 'pending' as const, timestamp: Date.now(), marketCap: msg.data.marketCap, liquidity: msg.data.liquidity }, ...prev].slice(0, 50);
      });
    } else if (msg.type === 'ANALYSIS_RESULT') {
      const { stage, shouldBuy, token, riskScore } = msg.data;
      const filtered = stage && stage !== 'PASSED';
      const approved = shouldBuy === true;
      if (filtered) log(`Filtered ${token?.symbol}`, 'warning');
      else if (approved) log(`Approved ${token?.symbol} (${riskScore})`, 'success');
      else log(`Rejected ${token?.symbol} (${riskScore})`, 'error');
      setTokens(prev => prev.map(t => t.address === token?.address ? { ...t, status: filtered ? 'filtered' : approved ? 'approved' : 'rejected', riskScore } : t));
      if (approved && token?.address) autoTrade.handleApprovedToken(token.address, token.symbol, riskScore || 100);
    }
  };

  const toggle = async () => {
    try {
      if (isRunning) { await fetch(`${API_URL}/api/stop`, { method: 'POST' }); setTokens([]); log('Scanner stopped'); }
      else { await fetch(`${API_URL}/api/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { manualModeOnly: false, maxRiskScore: autoTrade.config.maxRiskScore, walletPrivateKey: 'watch-only' } }) }); log('Scanner started', 'success'); }
      setIsRunning(!isRunning);
    } catch { log('Error', 'error'); }
  };

  const fmt = (n?: number) => !n ? '—' : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/[0.06] p-4 flex flex-col">
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <div className="font-semibold text-[15px]">Argus</div>
            <div className="text-[11px] text-white/40">AI Trading Engine</div>
          </div>
        </div>

        <nav className="space-y-1 flex-1">
          {[
            { id: 'dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Dashboard' },
            { id: 'positions', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', label: 'Positions' },
            { id: 'settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', label: 'Settings' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id as Page)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all ${
                page === item.id ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'
              }`}
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Status */}
        <div className="border-t border-white/[0.06] pt-4 mt-4">
          <div className="flex items-center gap-2 px-2">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-white/20'}`} />
            <span className="text-[12px] text-white/40">{wsConnected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6">
          {page === 'dashboard' && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
                  <p className="text-white/40 text-sm mt-1">Monitor and control your AI trading</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggle}
                    disabled={!wsConnected}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isRunning
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                        : 'bg-emerald-500 text-black hover:bg-emerald-400'
                    }`}
                  >
                    {isRunning ? 'Stop Scanner' : 'Start Scanner'}
                  </button>
                  <button
                    onClick={() => autoTrade.toggleEnabled()}
                    disabled={!autoTrade.wallet.isLoaded}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                      autoTrade.config.enabled
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]'
                    }`}
                  >
                    Auto-Trade {autoTrade.config.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-4 mb-8">
                {[
                  { label: 'Balance', value: autoTrade.wallet.isLoaded ? `${autoTrade.wallet.balance.toFixed(3)} SOL` : '—', sub: 'Trading wallet' },
                  { label: 'Positions', value: autoTrade.state.positions.length, sub: `${autoTrade.state.totalSold} sold` },
                  { label: 'P&L', value: `${autoTrade.state.totalProfitSol >= 0 ? '+' : ''}${autoTrade.state.totalProfitSol.toFixed(4)} SOL`, sub: 'Realized', color: autoTrade.state.totalProfitSol >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Scanned', value: stats.total, sub: `${stats.aiApproved} approved` },
                ].map((s, i) => (
                  <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                    <div className="text-[13px] text-white/40 mb-2">{s.label}</div>
                    <div className={`text-2xl font-semibold tracking-tight ${s.color || ''}`}>{s.value}</div>
                    <div className="text-[12px] text-white/30 mt-1">{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Content Grid */}
              <div className="grid grid-cols-3 gap-6">
                {/* Token Feed */}
                <div className="col-span-2 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                    <span className="font-medium text-[14px]">Live Feed</span>
                    <span className="text-[12px] text-white/30">{tokens.length} tokens</span>
                  </div>
                  <div className="max-h-[480px] overflow-auto">
                    {tokens.length === 0 ? (
                      <div className="p-12 text-center text-white/30 text-sm">
                        {isRunning ? 'Waiting for tokens...' : 'Start scanner to see tokens'}
                      </div>
                    ) : (
                      tokens.slice(0, 15).map(t => (
                        <div key={t.address} className={`px-5 py-3.5 border-b border-white/[0.04] flex items-center justify-between hover:bg-white/[0.02] transition-colors ${t.status === 'filtered' ? 'opacity-40' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold ${
                              t.status === 'approved' || t.status === 'traded' ? 'bg-emerald-500/10 text-emerald-400' :
                              t.status === 'rejected' ? 'bg-red-500/10 text-red-400' :
                              'bg-white/[0.06] text-white/40'
                            }`}>
                              {t.symbol.slice(0, 2)}
                            </div>
                            <div>
                              <div className="text-[13px] font-medium">{t.symbol}</div>
                              <div className="text-[11px] text-white/30 font-mono">{t.address.slice(0, 6)}...{t.address.slice(-4)}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <div className="text-[13px] text-white/70">{fmt(t.marketCap)}</div>
                              <div className="text-[10px] text-white/30">MC</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[13px] text-white/70">{fmt(t.liquidity)}</div>
                              <div className="text-[10px] text-white/30">LIQ</div>
                            </div>
                            {t.riskScore !== undefined && (
                              <div className={`text-[13px] font-medium tabular-nums ${t.riskScore <= 40 ? 'text-emerald-400' : t.riskScore <= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {t.riskScore}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Activity Log */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <div className="px-5 py-4 border-b border-white/[0.06]">
                    <span className="font-medium text-[14px]">Activity</span>
                  </div>
                  <div className="p-4 max-h-[480px] overflow-auto">
                    <div className="space-y-2 text-[12px] font-mono">
                      {logs.length === 0 ? (
                        <div className="text-white/20">No activity yet</div>
                      ) : (
                        logs.slice().reverse().map((l, i) => (
                          <div key={i} className={`${l.type === 'success' ? 'text-emerald-400' : l.type === 'error' ? 'text-red-400' : l.type === 'warning' ? 'text-yellow-400' : 'text-white/40'}`}>
                            <span className="text-white/20">{l.time.toLocaleTimeString('en-US', { hour12: false })}</span> {l.msg}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {page === 'positions' && (
            <>
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
                  <p className="text-white/40 text-sm mt-1">Track your active and sold positions</p>
                </div>
                <div className="flex gap-2">
                  {autoTrade.wallet.isLoaded && (
                    <button
                      onClick={async (e) => {
                        const btn = e.currentTarget;
                        btn.disabled = true;
                        const originalText = btn.textContent;
                        btn.textContent = 'Scanning...';
                        try {
                          const count = await autoTrade.recoverUntrackedPositions();
                          btn.textContent = count > 0 ? `Found ${count}!` : 'None found';
                          setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
                        } catch {
                          btn.textContent = 'Error';
                          setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
                        }
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      Scan Wallet
                    </button>
                  )}
                  {autoTrade.state.positions.length > 0 && (
                    <>
                      <button
                        onClick={async () => {
                          const btn = document.activeElement as HTMLButtonElement;
                          if (btn) btn.disabled = true;
                          try {
                            await autoTrade.sellAllPositions();
                          } finally {
                            if (btn) btn.disabled = false;
                          }
                        }}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        Sell All
                      </button>
                      <button onClick={() => { if (confirm('Clear all positions? Use this if you already sold via Phantom.')) autoTrade.clearAllPositions(); }} className="px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.06] text-white/60 border border-white/[0.08] hover:bg-white/[0.1]">
                        Clear All
                      </button>
                    </>
                  )}
                </div>
              </div>

              {autoTrade.state.positions.length === 0 && autoTrade.state.soldPositions.length === 0 ? (
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-16 text-center">
                  <div className="text-white/30 mb-2">No positions yet</div>
                  <div className="text-white/20 text-sm mb-4">Approved tokens will appear here</div>
                  {autoTrade.wallet.isLoaded && (
                    <button
                      onClick={async (e) => {
                        const btn = e.currentTarget;
                        btn.disabled = true;
                        btn.textContent = 'Scanning...';
                        try {
                          const count = await autoTrade.recoverUntrackedPositions();
                          btn.textContent = count > 0 ? `Found ${count}!` : 'No tokens found';
                          setTimeout(() => { btn.textContent = 'Scan Wallet'; btn.disabled = false; }, 2000);
                        } catch {
                          btn.textContent = 'Error';
                          setTimeout(() => { btn.textContent = 'Scan Wallet'; btn.disabled = false; }, 2000);
                        }
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.06] text-white/60 border border-white/[0.08] hover:bg-white/[0.1]"
                    >
                      Scan Wallet
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {autoTrade.state.positions.map((p, i) => (
                    <div key={`${p.tokenAddress}-${i}`} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <a href={`https://pump.fun/${p.tokenAddress}`} target="_blank" rel="noopener noreferrer" className={`w-12 h-12 rounded-xl flex items-center justify-center text-sm font-semibold hover:scale-105 transition-transform ${p.pnlPercent >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                          {p.tokenSymbol.slice(0, 2)}
                        </a>
                        <div>
                          <a href={`https://pump.fun/${p.tokenAddress}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-emerald-400 transition-colors">{p.tokenSymbol}</a>
                          <div className="text-[13px] text-white/40">Entry: {p.entrySolAmount.toFixed(3)} SOL</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-8">
                        <div className="text-right">
                          <div className={`text-xl font-semibold ${p.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(1)}%
                          </div>
                          <div className="text-[13px] text-white/40">{p.currentValueSol.toFixed(4)} SOL</div>
                        </div>
                        <button
                          onClick={async (e) => {
                            const btn = e.currentTarget;
                            btn.disabled = true;
                            btn.textContent = 'Selling...';
                            try {
                              const result = await autoTrade.manualSell(p.tokenAddress);
                              if (!result.success) {
                                btn.textContent = 'Failed';
                                setTimeout(() => { btn.textContent = 'Sell'; btn.disabled = false; }, 2000);
                              }
                            } catch {
                              btn.textContent = 'Error';
                              setTimeout(() => { btn.textContent = 'Sell'; btn.disabled = false; }, 2000);
                            }
                          }}
                          className="px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] transition-colors disabled:opacity-50"
                        >
                          Sell
                        </button>
                      </div>
                    </div>
                  ))}

                  {autoTrade.state.soldPositions.length > 0 && (
                    <div className="mt-8">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-[13px] text-white/40 uppercase tracking-wider">Sold</h3>
                        <button onClick={() => autoTrade.clearSoldHistory()} className="text-[12px] text-white/30 hover:text-white/60">
                          Clear History
                        </button>
                      </div>
                      <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
                        {autoTrade.state.soldPositions.slice(0, 10).map((p, i) => (
                          <div key={i} className="px-5 py-3 border-b border-white/[0.04] last:border-0 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <a href={`https://pump.fun/${p.tokenAddress}`} target="_blank" rel="noopener noreferrer" className="font-medium text-[14px] hover:text-emerald-400 transition-colors">{p.tokenSymbol}</a>
                              <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                                p.sellReason === 'take_profit' ? 'bg-emerald-500/10 text-emerald-400' :
                                p.sellReason === 'stop_loss' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
                              }`}>
                                {p.sellReason === 'take_profit' ? 'Take Profit' : p.sellReason === 'stop_loss' ? 'Stop Loss' : 'Trailing Stop'}
                              </span>
                            </div>
                            <span className={`font-medium ${p.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {page === 'settings' && (
            <>
              <div className="mb-8">
                <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
                <p className="text-white/40 text-sm mt-1">Configure your trading parameters</p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Wallet */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
                  <h3 className="font-medium mb-4">Trading Wallet</h3>
                  {!autoTrade.wallet.isLoaded ? (
                    <div className="space-y-4">
                      <p className="text-[14px] text-white/50">Create a dedicated wallet for automated trading.</p>
                      {!showImport ? (
                        <div className="flex gap-3">
                          <button onClick={() => autoTrade.generateWallet()} className="px-4 py-2.5 rounded-lg text-sm font-medium bg-emerald-500 text-black hover:bg-emerald-400">
                            Create Wallet
                          </button>
                          <button onClick={() => setShowImport(true)} className="px-4 py-2.5 rounded-lg text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1]">
                            Import
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <input type="password" placeholder="Private key (base58)" value={importKey} onChange={e => setImportKey(e.target.value)} className="w-full px-4 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm focus:outline-none focus:border-emerald-500/50" />
                          <div className="flex gap-2">
                            <button onClick={() => { autoTrade.importWallet(importKey); setImportKey(''); setShowImport(false); }} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-black">Import</button>
                            <button onClick={() => setShowImport(false)} className="px-4 py-2 rounded-lg text-sm bg-white/[0.06]">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg bg-white/[0.04]">
                        <div className="text-[12px] text-white/40 mb-1">Address</div>
                        <div className="text-[13px] font-mono flex items-center justify-between">
                          <span>{autoTrade.wallet.address}</span>
                          <button onClick={() => navigator.clipboard.writeText(autoTrade.wallet.address || '')} className="text-white/40 hover:text-white">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-2xl font-semibold">{autoTrade.wallet.balance.toFixed(4)} SOL</span>
                        <button onClick={() => autoTrade.refreshBalance()} className="text-white/40 hover:text-white"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
                      </div>
                      <div className="flex gap-2">
                        <input type="text" placeholder="Withdraw to address" value={withdrawAddr} onChange={e => setWithdrawAddr(e.target.value)} className="flex-1 px-4 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm focus:outline-none focus:border-emerald-500/50" />
                        <button onClick={() => { autoTrade.withdraw(withdrawAddr); setWithdrawAddr(''); }} disabled={!withdrawAddr} className="px-4 py-2.5 rounded-lg text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50">Withdraw</button>
                      </div>
                      <div className="flex gap-4 text-[13px]">
                        <button onClick={() => { const k = autoTrade.exportPrivateKey(); if (k) { navigator.clipboard.writeText(k); log('Key copied', 'success'); }}} className="text-white/40 hover:text-white">Export Key</button>
                        <button onClick={() => { if (confirm('WARNING: Make sure you have exported and saved your private key before deleting!\n\nThis action cannot be undone. Your funds will be lost if you haven\'t backed up.\n\nDelete wallet?')) autoTrade.deleteWallet(); }} className="text-red-400 hover:text-red-300">Delete</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Buy Settings */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
                  <h3 className="font-medium mb-4">Buy Settings</h3>
                  <div className="space-y-5">
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Amount per trade</label>
                      <div className="flex gap-2">
                        {[0.01, 0.05, 0.1, 0.25].map(a => (
                          <button key={a} onClick={() => autoTrade.updateConfig({ buyAmountSol: a })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.buyAmountSol === a ? 'bg-emerald-500 text-black' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            {a} SOL
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Max risk score</label>
                      <div className="flex gap-2">
                        {[40, 50, 75, 90].map(r => (
                          <button key={r} onClick={() => autoTrade.updateConfig({ maxRiskScore: r })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.maxRiskScore === r ? 'bg-emerald-500 text-black' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            ≤{r}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Max slippage</label>
                      <div className="flex gap-2">
                        {[100, 300, 500, 1000].map(s => (
                          <button key={s} onClick={() => autoTrade.updateConfig({ maxSlippageBps: s })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.maxSlippageBps === s ? 'bg-white/20 text-white' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            {s / 100}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Reserve balance</label>
                      <div className="flex gap-2">
                        {[0.05, 0.1, 0.2, 0.5].map(r => (
                          <button key={r} onClick={() => autoTrade.updateConfig({ reserveBalanceSol: r })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.reserveBalanceSol === r ? 'bg-white/20 text-white' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            {r} SOL
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Max price drop (skip dumps)</label>
                      <div className="flex gap-2">
                        {[20, 30, 40, 50].map(d => (
                          <button key={d} onClick={() => autoTrade.updateConfig({ maxPriceDropPercent: d })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.maxPriceDropPercent === d ? 'bg-yellow-500 text-black' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            -{d}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Trade cooldown</label>
                      <div className="flex gap-2">
                        {[0, 10, 30, 60].map(c => (
                          <button key={c} onClick={() => autoTrade.updateConfig({ tradeCooldownSeconds: c })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.tradeCooldownSeconds === c ? 'bg-white/20 text-white' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            {c === 0 ? 'None' : `${c}s`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sell Settings */}
                <div className="col-span-2 bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium">Auto-Sell</h3>
                    <button onClick={() => autoTrade.updateConfig({ autoSellEnabled: !autoTrade.config.autoSellEnabled })} className={`w-12 h-7 rounded-full transition-colors flex items-center px-1 ${autoTrade.config.autoSellEnabled ? 'bg-emerald-500' : 'bg-white/10'}`}>
                      <div className={`w-5 h-5 rounded-full bg-white transition-transform ${autoTrade.config.autoSellEnabled ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Take profit</label>
                      <div className="flex flex-wrap gap-2">
                        {[50, 100, 200, 500].map(t => (
                          <button key={t} onClick={() => autoTrade.updateConfig({ takeProfitPercent: t })} className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.takeProfitPercent === t ? 'bg-emerald-500 text-black' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            +{t}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Stop loss</label>
                      <div className="flex flex-wrap gap-2">
                        {[20, 30, 50, 70].map(s => (
                          <button key={s} onClick={() => autoTrade.updateConfig({ stopLossPercent: s })} className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.stopLossPercent === s ? 'bg-red-500 text-white' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            -{s}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] text-white/50 mb-2 block">Trailing stop</label>
                      <div className="flex flex-wrap gap-2">
                        {[0, 10, 20, 30].map(t => (
                          <button key={t} onClick={() => autoTrade.updateConfig({ trailingStopPercent: t })} className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${autoTrade.config.trailingStopPercent === t ? 'bg-yellow-500 text-black' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
                            {t === 0 ? 'Off' : `-${t}%`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
      </main>
    </div>
  );
}
