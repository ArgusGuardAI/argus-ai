/**
 * ARGUS TERMINAL - Brutalist Trading Dashboard
 *
 * Two-panel layout:
 * - LEFT: Raw log firehose (all events)
 * - RIGHT: Data table (only interesting tokens with verdicts)
 *
 * Features:
 * - Real-time pool detection via agent discoveries
 * - BitNet instant scoring
 * - Auto-trade with configurable settings
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { useDiscoveries, DiscoveryResult } from '../../hooks/useDiscoveries';
import { useAutoTrade } from '../../hooks/useAutoTrade';

// Log entry type
interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'normal' | 'skip' | 'alert' | 'hit' | 'trade' | 'error';
}

// Table row type
interface TableRow {
  id: string;
  timestamp: Date;
  name: string | null;
  symbol: string | null;
  address: string;
  dex: string | null;
  liquidity: number | null;
  liquiditySol: number | null;
  marketCap: number | null;
  supply: number | null;
  price: number | null;
  priceSol: number | null;
  bondingProgress: number | null;
  bitnetScore: number;
  verdict: 'SAFE' | 'RISK' | 'SCAM' | 'SCAN';
  isGraduated: boolean;
  // Bundle & holder data
  hasBundle: boolean;
  bundleCount: number;
  bundlePercent: number;
  top10: number;
  holders: number;
  discovery: DiscoveryResult;
}

// Format DEX names for display
const formatDex = (dex: string | null): string => {
  if (!dex) return '--';
  switch (dex) {
    case 'PUMP_FUN': return 'PUMP';
    case 'ORCA_WHIRLPOOL': return 'ORCA';
    case 'METEORA_DLMM': return 'METR';
    case 'RAYDIUM_AMM_V4': return 'RAY4';
    case 'RAYDIUM_CPMM': return 'RAYC';
    default: return dex.slice(0, 4);
  }
};

// Format SOL amount
const formatSol = (sol: number | null): string => {
  if (sol === null) return '--';
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}K`;
  if (sol >= 100) return sol.toFixed(0);
  return sol.toFixed(1);
};

// Format supply (in trillions/billions/millions) - reserved for future use
const _formatSupply = (supply: number | null): string => {
  if (!supply) return '--';
  const actualSupply = supply / 1_000_000_000;
  if (actualSupply >= 1_000_000_000) return `${(actualSupply / 1_000_000_000).toFixed(0)}T`;
  if (actualSupply >= 1_000_000) return `${(actualSupply / 1_000_000).toFixed(0)}B`;
  if (actualSupply >= 1_000) return `${(actualSupply / 1_000).toFixed(0)}M`;
  if (actualSupply >= 1) return `${actualSupply.toFixed(0)}K`;
  return actualSupply.toFixed(2);
};
void _formatSupply; // Suppress unused warning

// Format age
const formatAge = (timestamp: Date): string => {
  const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
};

// Format price (scientific notation for tiny values)
const formatPrice = (price: number | null): string => {
  if (price === null || price === undefined) return '--';
  if (price < 0.0001) return price.toExponential(1);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return `$${price.toFixed(2)}`;
};

// Format bonding progress - reserved for future use
const _formatProgress = (progress: number | null): string => {
  if (progress === null || progress === undefined) return '--';
  return `${progress.toFixed(0)}%`;
};
void _formatProgress; // Suppress unused warning

interface TerminalDashboardProps {
  // Legacy props (kept for compatibility with TerminalApp - unused in this component)
  walletAddress?: string;
  walletBalance?: number;
  onAnalyze?: (address: string) => Promise<unknown>;
  onBuy?: (tokenAddress: string, amount: number) => Promise<void>;
  onSell?: (tokenAddress: string) => Promise<void>;
  hasPosition?: boolean;
  onSettingsClick?: () => void;
}

export const TerminalDashboard: React.FC<TerminalDashboardProps> = ({
  onSettingsClick,
}) => {
  // State
  const [_logs, setLogs] = useState<LogEntry[]>([]);
  void _logs; // Used for logging history
  const [tableRows, setTableRows] = useState<TableRow[]>([]);
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const logPanelRef = useRef<HTMLDivElement>(null);

  // Hooks
  const { status, isConnected } = useAgentStatus({ enabled: true });
  const { discoveries } = useDiscoveries({ enabled: true, interval: 3000 });

  // Auto-trade hook with logging callback
  const autoTrade = useAutoTrade({}, undefined, (message, type) => {
    addLog(message, type === 'success' ? 'trade' : type === 'error' ? 'error' : 'normal');
  });

  // Add log entry (newest at bottom like real terminal)
  const addLog = useCallback((message: string, type: LogEntry['type'] = 'normal') => {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      message,
      type,
    };
    setLogs(prev => {
      const newLogs = [...prev, entry];
      return newLogs.slice(-150); // Keep last 150 logs
    });

    // Auto-scroll to bottom
    setTimeout(() => {
      if (logPanelRef.current) {
        logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
      }
    }, 10);
  }, []);

  // Format timestamp - reserved for log panel
  const _formatTime = (date: Date) => {
    return date.toTimeString().split(' ')[0];
  };
  void _formatTime;

  // Format number with K/M suffix
  const formatNumber = (num: number | null, fallback: string = '--'): string => {
    if (num === null || num === undefined) return fallback;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
    return `$${num.toFixed(0)}`;
  };

  // Process new discoveries
  useEffect(() => {
    if (discoveries.length === 0) return;

    discoveries.forEach(disc => {
      // Skip already processed
      if (processedIds.has(disc.id)) return;

      // Extract token info
      const rawSymbol = disc.tokenInfo?.symbol;
      const rawName = disc.tokenInfo?.name;
      const symbol = (rawSymbol && rawSymbol !== 'UNKNOWN' && rawSymbol.length > 0)
        ? rawSymbol.toUpperCase()
        : null;
      const name = (rawName && rawName !== 'Unknown' && rawName.length > 0)
        ? rawName
        : null;
      const liquidity = disc.market?.liquidity;
      const hasBundle = disc.bundles?.detected;
      const bundleCount = disc.bundles?.count || 0;
      const bundlePercent = disc.bundles?.controlPercent || 0;
      const top10 = disc.holders?.top10Concentration || 0;
      const holders = disc.holders?.total || 0;

      // Use the API's analysis score directly (higher = riskier)
      const riskScore = disc.analysis?.score ?? 50;
      const bondingProg = (disc.market as any)?.bondingProgress ?? 0;
      const liqSol = (disc.market as any)?.liquiditySol ?? (liquidity ? liquidity / 150 : 0);

      // REAL risk assessment - brand new tokens are NOT safe by default
      // Safe = established with good metrics
      // New = just launched, no data
      // Risk = some red flags
      // Scam = clear scam signals
      let verdict: TableRow['verdict'] = 'SCAN';

      const isPumpFun = disc.market?.dexId === 'PUMP_FUN';
      const isGraduated = disc.lp?.burned === true;

      if (riskScore >= 70 || hasBundle) {
        verdict = 'SCAM'; // High risk or bundle = SCAM
      } else if (riskScore >= 50 || (top10 > 95 && !isPumpFun)) {
        verdict = 'RISK'; // Medium risk or extreme concentration
      } else if (isPumpFun && bondingProg < 10 && liqSol <= 30) {
        verdict = 'SCAN'; // Brand new pump.fun, unrated - NOT safe
      } else if (isGraduated || liqSol > 100 || (holders > 50 && top10 < 70)) {
        verdict = 'SAFE'; // Graduated, high liquidity, or good distribution
      } else {
        verdict = 'SCAN'; // Default: unrated, needs more data
      }

      // Build log message
      const displayName = symbol || disc.token.slice(0, 6);
      const dexName = formatDex(disc.market?.dexId ?? null);
      const solLiq = (disc.market as any)?.liquiditySol ?? (liquidity ? liquidity / 150 : 0);
      const isGrad = disc.lp?.burned ? '🎓' : '';
      const priceUsd = typeof disc.market?.price === 'number' ? disc.market.price : parseFloat(disc.market?.price || '0') || null;
      const priceStr = priceUsd ? formatPrice(priceUsd) : '';
      const mcapStr = disc.market?.marketCap ? formatNumber(disc.market.marketCap).replace('$', '') : '';
      const progVal = (disc.market as any)?.bondingProgress as number | null;
      const progStr = progVal ? `${progVal.toFixed(0)}%` : '';

      // Build compact flags string
      const flags: string[] = [];
      if (priceStr) flags.push(priceStr);
      if (mcapStr) flags.push(`MC${mcapStr}`);
      if (progStr && disc.market?.dexId === 'PUMP_FUN') flags.push(progStr);
      flags.push(`T${top10.toFixed(0)}`);
      flags.push(`H${holders}`);
      if (hasBundle) flags.push(`B${bundleCount}`);

      const logIcon = verdict === 'SAFE' ? '+' : verdict === 'SCAM' ? '!' : '?';
      const flagsStr = flags.join(' ');

      addLog(
        `${logIcon} ${dexName}${isGrad} ${displayName} ${solLiq.toFixed(1)}S ${flagsStr}`,
        verdict === 'SAFE' ? 'hit' : verdict === 'SCAM' ? 'alert' : 'normal'
      );

      // Add ALL tokens to table
      // Get liquiditySol from API or calculate from USD
      const liquiditySol = (disc.market as any)?.liquiditySol ?? (liquidity ? liquidity / 150 : null);
      const price = priceUsd; // Already parsed above
      const priceSol = typeof (disc.market as any)?.priceSol === 'number' ? (disc.market as any).priceSol : null;
      const bondingProgress = progVal;

      const row: TableRow = {
        id: disc.id,
        timestamp: new Date(disc.timestamp),
        name: name,
        symbol: symbol,
        address: disc.token,
        dex: disc.market?.dexId ?? null,
        liquidity: liquidity,
        liquiditySol: liquiditySol,
        marketCap: disc.market?.marketCap ?? null,
        supply: disc.tokenInfo?.supply ?? null,
        price: price,
        priceSol: priceSol,
        bondingProgress: bondingProgress,
        bitnetScore: riskScore,
        verdict,
        isGraduated,
        hasBundle: hasBundle || false,
        bundleCount: bundleCount,
        bundlePercent: bundlePercent,
        top10: top10,
        holders: holders,
        discovery: disc,
      };

      setTableRows(prev => [row, ...prev].slice(0, 50));

      // Auto-trade if enabled and SAFE with decent liquidity
      if (autoTrade.config.enabled && verdict === 'SAFE' && (liquidity === null || liquidity > 3000)) {
        addLog(`AUTO_BUY: ${symbol} @ ${autoTrade.config.buyAmountSol} SOL`, 'trade');
        autoTrade.buyFromDiscovery(disc);
      }

      setProcessedIds(prev => new Set([...prev, disc.id]));
    });
  }, [discoveries, processedIds, addLog, autoTrade]);

  // Initial logs (only once)
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    addLog('ARGUS TERMINAL ONLINE', 'hit');
    addLog('Connecting to agent swarm...', 'normal');
  }, [addLog]);

  // Connection status log
  useEffect(() => {
    if (isConnected) {
      addLog(`AGENT SWARM: ${status?.online || 0} agents online`, 'hit');
    }
  }, [isConnected, status?.online]);

  // Handle buy click
  const handleBuy = async (row: TableRow) => {
    if (!autoTrade.wallet.isLoaded) {
      addLog('ERROR: Trading wallet not loaded', 'error');
      return;
    }
    addLog(`MANUAL BUY: ${row.symbol || row.address.slice(0, 8)} (${autoTrade.config.buyAmountSol} SOL)`, 'trade');
    await autoTrade.buyFromDiscovery(row.discovery);
  };

  // Calculate stats - reserved for stats display
  const _scanRate = discoveries.length > 0 ? Math.round(discoveries.length * 12) : 0;
  void _scanRate;

  return (
    <div className="h-screen flex flex-col bg-[#050505] text-[#e0e0e0] font-mono text-[13px] overflow-hidden">

      {/* HEADER */}
      <header className="h-[50px] bg-[#111] border-b border-[#333] flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-white">ARGUS</span>
          <span className="text-sm text-[#666]">Real-time Token Scanner</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#00ff41]' : 'bg-[#ff3333]'}`}></span>
            <span className="text-sm text-[#888]">{isConnected ? 'Connected' : 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#888]">Wallet:</span>
            <span className={`text-sm font-mono ${autoTrade.wallet.isLoaded ? 'text-[#00ff41]' : 'text-[#666]'}`}>
              {autoTrade.wallet.isLoaded ? `${autoTrade.wallet.balance.toFixed(2)} SOL` : 'Not connected'}
            </span>
          </div>
          <div className="text-sm text-[#ffcc00]">
            {tableRows.length} tokens
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-1 text-sm bg-[#222] text-[#888] hover:bg-[#333] hover:text-white rounded transition-colors"
          >
            Settings
          </button>
        </div>
      </header>

      {/* SETTINGS PANEL (collapsible) */}
      {showSettings && (
        <div className="bg-[#0d0d0d] border-b border-[#333] p-4">
          <div className="flex flex-wrap gap-8 items-center text-sm">
            {/* Auto-Trade Toggle */}
            <div className="flex items-center gap-3">
              <span className="text-[#888]">Auto-Trade</span>
              <button
                onClick={autoTrade.toggleEnabled}
                className={`px-4 py-2 rounded font-bold transition-colors ${
                  autoTrade.config.enabled
                    ? 'bg-[#00ff41] text-black'
                    : 'bg-[#222] text-[#666] hover:bg-[#333]'
                }`}
              >
                {autoTrade.config.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Buy Amount */}
            <div className="flex items-center gap-2">
              <span className="text-[#888]">Buy Amount</span>
              <input
                type="number"
                value={autoTrade.config.buyAmountSol}
                onChange={(e) => autoTrade.updateConfig({ buyAmountSol: parseFloat(e.target.value) || 0.1 })}
                className="w-20 bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-[#00ff41] font-mono"
                step="0.1"
                min="0.01"
              />
              <span className="text-[#666]">SOL</span>
            </div>

            {/* Take Profit */}
            <div className="flex items-center gap-2">
              <span className="text-[#888]">Take Profit</span>
              <input
                type="number"
                value={autoTrade.config.takeProfitPercent}
                onChange={(e) => autoTrade.updateConfig({ takeProfitPercent: parseInt(e.target.value) || 100 })}
                className="w-16 bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-[#00ff41] font-mono"
              />
              <span className="text-[#666]">%</span>
            </div>

            {/* Stop Loss */}
            <div className="flex items-center gap-2">
              <span className="text-[#888]">Stop Loss</span>
              <input
                type="number"
                value={autoTrade.config.stopLossPercent}
                onChange={(e) => autoTrade.updateConfig({ stopLossPercent: parseInt(e.target.value) || 30 })}
                className="w-16 bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-[#ff3333] font-mono"
              />
              <span className="text-[#666]">%</span>
            </div>

            {/* Wallet Actions */}
            <div className="ml-auto">
              {!autoTrade.wallet.isLoaded ? (
                <button
                  onClick={async () => {
                    const result = await autoTrade.generateWallet();
                    addLog(`Wallet created: ${result.address.slice(0, 12)}...`, 'trade');
                  }}
                  className="px-4 py-2 bg-[#00ff41] text-black font-bold rounded hover:bg-[#00cc33] transition-colors"
                >
                  Create Wallet
                </button>
              ) : (
                <button
                  onClick={onSettingsClick}
                  className="px-4 py-2 bg-[#222] text-[#888] rounded hover:bg-[#333] transition-colors"
                >
                  Wallet Settings
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN LAYOUT - Card-based feed */}
      <main className="flex-1 overflow-hidden bg-[#0a0a0a]">
        <div className="h-full overflow-y-auto p-4">
          <div className="max-w-6xl mx-auto space-y-3">
            {tableRows.map(row => {
              const ageSeconds = (Date.now() - row.timestamp.getTime()) / 1000;
              const isVeryNew = ageSeconds < 30;
              const isPumpFun = row.dex === 'PUMP_FUN';
              const progress = row.bondingProgress || 0;

              // Generate human-readable insight
              let insight = '';
              let insightColor = '#888';

              if (row.verdict === 'SCAM' || row.hasBundle) {
                insight = '⚠️ Coordinated wallet activity detected - likely rug pull';
                insightColor = '#ff3333';
              } else if (row.verdict === 'SAFE' && row.isGraduated) {
                insight = '🎓 Graduated from bonding curve - established token';
                insightColor = '#00ff41';
              } else if (row.verdict === 'SAFE' && (row.liquiditySol || 0) > 100) {
                insight = '💰 High liquidity pool - lower slippage, safer trade';
                insightColor = '#00ff41';
              } else if (isPumpFun && progress > 70) {
                insight = `🚀 ${progress.toFixed(0)}% to graduation - gaining momentum`;
                insightColor = '#00ff41';
              } else if (isPumpFun && progress > 30) {
                insight = `📈 ${progress.toFixed(0)}% curve filled - early but growing`;
                insightColor = '#ffcc00';
              } else if (isPumpFun && progress < 5) {
                insight = '🆕 Brand new - no trading history yet';
                insightColor = '#888';
              } else if (row.top10 > 95) {
                insight = '⚠️ Extreme concentration - one wallet holds almost everything';
                insightColor = '#ff3333';
              } else if ((row.liquiditySol || 0) < 10) {
                insight = '💧 Very low liquidity - high slippage risk';
                insightColor = '#ffcc00';
              } else {
                insight = '👀 New token - monitor before buying';
                insightColor = '#888';
              }

              // Card border color
              const borderColor = row.verdict === 'SCAM' ? 'border-[#ff3333]' :
                                 row.verdict === 'SAFE' ? 'border-[#00ff41]' :
                                 row.verdict === 'RISK' ? 'border-[#ffcc00]' : 'border-[#333]';

              return (
                <div
                  key={row.id}
                  className={`bg-[#111] rounded-lg border-l-4 ${borderColor} p-4 hover:bg-[#151515] transition-colors`}
                >
                  {/* Top row: DEX + Token Name/Symbol + Age + Status */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {/* DEX Badge */}
                      <span className={`text-xs font-bold px-2 py-1 rounded ${
                        row.dex === 'PUMP_FUN' ? 'bg-[#ff69b4]/20 text-[#ff69b4]' :
                        row.dex === 'ORCA_WHIRLPOOL' ? 'bg-[#00d4aa]/20 text-[#00d4aa]' :
                        row.dex === 'METEORA_DLMM' ? 'bg-[#9945FF]/20 text-[#9945FF]' :
                        'bg-[#58d6f7]/20 text-[#58d6f7]'
                      }`}>
                        {formatDex(row.dex)}{row.isGraduated ? ' 🎓' : ''}
                      </span>

                      {/* Token Symbol & Name - THE KEY INFO */}
                      {row.symbol ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xl font-bold text-white">${row.symbol}</span>
                          {row.name && row.name !== row.symbol && (
                            <span className="text-sm text-[#888]">{row.name}</span>
                          )}
                        </div>
                      ) : (
                        <code className="text-[#666] text-sm">{row.address.slice(0, 8)}...{row.address.slice(-6)}</code>
                      )}

                      {/* Address (always shown small) */}
                      {row.symbol && (
                        <code className="text-[#444] text-xs">{row.address.slice(0, 6)}...</code>
                      )}

                      {/* Live indicator */}
                      {isVeryNew && (
                        <span className="flex items-center gap-1 text-xs text-[#00ff41]">
                          <span className="w-2 h-2 bg-[#00ff41] rounded-full animate-pulse"></span>
                          LIVE
                        </span>
                      )}
                    </div>

                    {/* Age + Status */}
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[#555]">{formatAge(row.timestamp)} ago</span>
                      <span className={`text-sm font-bold px-3 py-1 rounded ${
                        row.verdict === 'SAFE' ? 'bg-[#00ff41] text-black' :
                        row.verdict === 'SCAM' ? 'bg-[#ff3333] text-white' :
                        row.verdict === 'RISK' ? 'bg-[#ffcc00] text-black' :
                        'bg-[#333] text-[#888]'
                      }`}>
                        {row.verdict === 'SCAN' ? 'UNRATED' : row.verdict}
                      </span>
                    </div>
                  </div>

                  {/* Insight - THE MOST IMPORTANT PART */}
                  <div className="text-lg mb-4" style={{ color: insightColor }}>
                    {insight}
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-6 text-sm">
                    {/* Price */}
                    <div>
                      <span className="text-[#555]">Price: </span>
                      <span className="text-[#00ccff] font-mono">{formatPrice(row.price)}</span>
                    </div>

                    {/* Market Cap */}
                    <div>
                      <span className="text-[#555]">MCap: </span>
                      <span className="text-white font-mono font-bold">{row.marketCap ? formatNumber(row.marketCap) : '--'}</span>
                    </div>

                    {/* Liquidity */}
                    <div>
                      <span className="text-[#555]">Liquidity: </span>
                      <span className="text-[#ffcc00] font-mono">{formatSol(row.liquiditySol)} SOL</span>
                    </div>

                    {/* Curve Progress (if pump.fun) */}
                    {isPumpFun && (
                      <div className="flex items-center gap-2">
                        <span className="text-[#555]">Curve:</span>
                        <div className="w-24 h-2 bg-[#222] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#ff69b4] to-[#00ff41]"
                            style={{ width: `${Math.min(100, progress)}%` }}
                          />
                        </div>
                        <span className="text-[#ff69b4] font-mono text-xs">{progress.toFixed(0)}%</span>
                      </div>
                    )}

                    {/* Buy Button - Far right */}
                    {autoTrade.wallet.isLoaded && row.verdict !== 'SCAM' && (
                      <button
                        onClick={() => handleBuy(row)}
                        className={`ml-auto px-4 py-2 font-bold rounded transition-colors ${
                          row.verdict === 'SAFE'
                            ? 'bg-[#00ff41] text-black hover:bg-[#00cc33]'
                            : 'bg-[#333] text-[#888] hover:bg-[#444] hover:text-white'
                        }`}
                      >
                        Buy {autoTrade.config.buyAmountSol} SOL
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {tableRows.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="text-4xl mb-4 animate-pulse">🔍</div>
                  <div className="text-xl text-white mb-2">Scanning Solana for new tokens...</div>
                  <div className="text-sm text-[#666]">New opportunities will appear here in real-time</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* POSITIONS BAR (if any active positions) */}
      {autoTrade.state.positions.length > 0 && (
        <div className="bg-[#0d0808] border-t border-[#333] p-3">
          <div className="flex items-center gap-4 overflow-x-auto">
            <span className="text-[#888] text-sm font-bold shrink-0">Open Positions:</span>
            {autoTrade.state.positions.map(pos => (
              <div
                key={pos.tokenAddress}
                className={`flex items-center gap-3 px-3 py-2 rounded ${
                  pos.pnlPercent >= 0 ? 'bg-[#00ff41]/10 border border-[#00ff41]/30' : 'bg-[#ff3333]/10 border border-[#ff3333]/30'
                }`}
              >
                <span className="font-bold text-white text-sm">{pos.tokenSymbol}</span>
                <span className={`font-mono font-bold ${pos.pnlPercent >= 0 ? 'text-[#00ff41]' : 'text-[#ff3333]'}`}>
                  {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
                </span>
                <span className="text-[#666] text-sm">{pos.entrySolAmount.toFixed(2)} SOL</span>
                <button
                  onClick={() => autoTrade.manualSell(pos.tokenAddress)}
                  className="text-[#ff3333] hover:text-white font-bold text-sm"
                >
                  SELL
                </button>
              </div>
            ))}
            <button
              onClick={autoTrade.sellAllPositions}
              className="ml-auto px-3 py-2 bg-[#ff3333] text-black font-bold rounded hover:bg-[#cc2222] shrink-0 text-sm"
            >
              Sell All
            </button>
          </div>
        </div>
      )}

      {/* STATS BAR */}
      <footer className="h-[40px] bg-[#111] border-t border-[#333] flex items-center px-6 text-sm text-[#666] gap-8">
        <div className="flex items-center gap-2">
          <span>Trades:</span>
          <span className="text-white font-mono">{autoTrade.state.totalTraded}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Positions:</span>
          <span className="text-white font-mono">{autoTrade.state.positions.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>P&L:</span>
          <span className={`font-mono font-bold ${autoTrade.state.totalProfitSol >= 0 ? 'text-[#00ff41]' : 'text-[#ff3333]'}`}>
            {autoTrade.state.totalProfitSol >= 0 ? '+' : ''}{autoTrade.state.totalProfitSol.toFixed(3)} SOL
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${autoTrade.config.enabled ? 'bg-[#00ff41] animate-pulse' : 'bg-[#333]'}`}></span>
          <span className={autoTrade.config.enabled ? 'text-[#00ff41]' : 'text-[#666]'}>
            Auto-trade {autoTrade.config.enabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </footer>
    </div>
  );
};

export default TerminalDashboard;
