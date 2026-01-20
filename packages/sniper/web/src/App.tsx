import { useState, useCallback, useEffect, useRef } from 'react';
import { Shield, Settings as SettingsIcon, Zap, Search, AlertTriangle, CheckCircle, XCircle, ExternalLink, Copy, Check, Loader2, Wallet, TrendingUp, Target, BarChart3, Clock, Bell, X } from 'lucide-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { Settings } from './components/Settings';
import { useWebSocket } from './hooks/useWebSocket';
import { executeBuy, executeSell } from './lib/swap';
import type { Position, SniperConfig } from './types';

const DEFAULT_CONFIG: SniperConfig = {
  // Basic Settings
  buyAmountSol: 0.1,
  maxSlippageBps: 2500, // 25% slippage for pump.fun volatility
  priorityFeeLamports: 100000,
  useJito: false,
  maxRiskScore: 40,
  minLiquidityUsd: 1000,
  allowPumpFun: true,
  allowRaydium: false,

  // Basic Exit Strategy
  takeProfitPercent: 100,
  stopLossPercent: 30,
  maxHoldTimeMinutes: 60,

  // Tiered Buy Strategy - buy less on higher risk
  enableTieredBuys: true,
  tierLowRisk: 20,          // 0-20 = full buy
  tierMediumRisk: 35,       // 21-35 = reduced buy
  tierMediumMultiplier: 0.75, // 75% of buyAmountSol
  tierHighMultiplier: 0.5,    // 50% of buyAmountSol for 36-40

  // Scale Out (Partial Takes) - lock in profits progressively
  enableScaleOut: true,
  scaleOut1Percent: 25,     // Sell 25% at TP1
  scaleOut1Target: 50,      // +50% profit
  scaleOut2Percent: 25,     // Sell 25% at TP2
  scaleOut2Target: 100,     // +100% profit (2x)
  scaleOut3Percent: 25,     // Sell 25% at TP3
  scaleOut3Target: 200,     // +200% profit (3x)

  // Trailing Stop - protect gains
  enableTrailingStop: true,
  trailingStopActivation: 30, // Activate after +30% profit
  trailingStopDistance: 15,   // Trail 15% below peak

  // Quick Flip Mode - fast momentum plays
  enableQuickFlip: false,
  quickFlipTarget: 20,      // +20% target
  quickFlipTimeout: 30,     // 30 second timeout
};

interface Alert {
  tokenAddress: string;
  tokenSymbol: string;
  type: 'TP' | 'SL' | 'TRAILING';
  pnlPercent: number;
  message: string;
}

interface AnalysisResult {
  riskScore: number;
  riskLevel: string;
  summary: string;
  confidence: number;
  flags: { message: string; severity: string; type: string }[];
  market?: {
    name: string;
    symbol: string;
    marketCap: number;
    liquidity: number;
    volume24h: number;
    ageInDays: number;
  };
  holders?: {
    top1NonLp: number;
    top10NonLp: number;
    totalHolders: number;
  };
  creator?: {
    ruggedTokens: number;
    tokensCreated: number;
  };
  insiders?: {
    count: number;
  };
  socials?: {
    website: string | null;
    twitter: string | null;
  };
  authorities?: {
    mintRevoked: boolean;
    freezeRevoked: boolean;
  };
}

function formatNum(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatTime(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Load positions from localStorage
function loadPositions(): Position[] {
  try {
    const saved = localStorage.getItem('whaleshield_positions');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// Save positions to localStorage
function savePositions(positions: Position[]) {
  try {
    localStorage.setItem('whaleshield_positions', JSON.stringify(positions));
  } catch (e) {
    console.error('[UI] Failed to save positions:', e);
  }
}

export default function App() {
  const { publicKey, signTransaction } = useWallet();
  const [positions, setPositions] = useState<Position[]>(loadPositions);
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ tokensScanned: 0, tokensSniped: 0, totalPnlSol: 0 });

  // Analysis state
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sniping, setSniping] = useState(false);
  const [snipeStatus, setSnipeStatus] = useState<string | null>(null);
  const [sellingToken, setSellingToken] = useState<string | null>(null);

  // Alert system for TP/SL
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const peakPrices = useRef<Record<string, number>>({});

  const handleMessage = useCallback((msg: any) => {
    console.log('[UI] Received message:', msg.type, msg.data);
    if (msg.type === 'STATUS_UPDATE') {
      // DON'T overwrite local positions - merge with server positions instead
      const serverPositions = msg.data.positions || [];
      if (serverPositions.length > 0) {
        setPositions(prev => {
          // Merge: keep local positions, add any new server positions
          const localAddresses = new Set(prev.map(p => p.tokenAddress));
          const newFromServer = serverPositions.filter((p: Position) => !localAddresses.has(p.tokenAddress));
          return [...prev, ...newFromServer];
        });
      }
      setStats({
        tokensScanned: msg.data.tokensScanned || 0,
        tokensSniped: msg.data.tokensSniped || 0,
        totalPnlSol: msg.data.totalPnlSol || 0,
      });
    } else if (msg.type === 'SNIPE_ATTEMPT') {
      const status = msg.data.status;
      if (status === 'watch-only') {
        setSnipeStatus('Watch-only mode - configure wallet to trade');
      } else if (status === 'success') {
        setSnipeStatus(`Sniped! TX: ${msg.data.txSignature?.slice(0, 8)}...`);
      } else if (status === 'failed') {
        setSnipeStatus('Snipe failed');
      } else if (status === 'pending') {
        setSnipeStatus('Executing snipe...');
      }
      setSniping(false);
    }
  }, []);

  const { sendMessage } = useWebSocket({
    url: 'ws://localhost:8787/ws',
    onMessage: handleMessage,
    onConnect: () => {
      setConnected(true);
      sendMessage({ type: 'START', config });
    },
    onDisconnect: () => setConnected(false),
  });

  // Persist positions to localStorage
  useEffect(() => {
    savePositions(positions);
  }, [positions]);

  // Real-time price updates for positions with TP/SL alerts
  useEffect(() => {
    if (positions.length === 0) return;

    const updatePrices = async () => {
      try {
        const tokenAddresses = positions.map(p => p.tokenAddress);
        const response = await fetch('/api/prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokens: tokenAddresses }),
        });

        if (!response.ok) return;

        const { prices } = await response.json();
        const newAlerts: Alert[] = [];

        setPositions(prev => prev.map(pos => {
          const newPrice = prices[pos.tokenAddress];
          if (newPrice === null || newPrice === undefined) return pos;

          const currentValueSol = pos.amountTokens * newPrice;
          const pnlSol = currentValueSol - pos.costBasisSol;
          const pnlPercent = (pnlSol / pos.costBasisSol) * 100;

          // Track peak price for trailing stop
          const currentPeak = peakPrices.current[pos.tokenAddress] || pos.entryPrice;
          if (newPrice > currentPeak) {
            peakPrices.current[pos.tokenAddress] = newPrice;
          }
          const peakPnlPercent = ((peakPrices.current[pos.tokenAddress] - pos.entryPrice) / pos.entryPrice) * 100;

          // Check for existing alert to avoid spamming
          const hasAlert = alerts.some(a => a.tokenAddress === pos.tokenAddress);

          // Check Take Profit
          if (!hasAlert && pnlPercent >= config.takeProfitPercent) {
            newAlerts.push({
              tokenAddress: pos.tokenAddress,
              tokenSymbol: pos.tokenSymbol,
              type: 'TP',
              pnlPercent,
              message: `+${pnlPercent.toFixed(1)}% - Take profit target hit!`,
            });
          }
          // Check Stop Loss
          else if (!hasAlert && pnlPercent <= -config.stopLossPercent) {
            newAlerts.push({
              tokenAddress: pos.tokenAddress,
              tokenSymbol: pos.tokenSymbol,
              type: 'SL',
              pnlPercent,
              message: `${pnlPercent.toFixed(1)}% - Stop loss triggered!`,
            });
          }
          // Check Trailing Stop (only if enabled and was in profit)
          else if (!hasAlert && config.enableTrailingStop &&
                   peakPnlPercent >= config.trailingStopActivation &&
                   pnlPercent <= peakPnlPercent - config.trailingStopDistance) {
            newAlerts.push({
              tokenAddress: pos.tokenAddress,
              tokenSymbol: pos.tokenSymbol,
              type: 'TRAILING',
              pnlPercent,
              message: `Trailing stop! Peak was +${peakPnlPercent.toFixed(1)}%, now +${pnlPercent.toFixed(1)}%`,
            });
          }

          return {
            ...pos,
            currentPrice: newPrice,
            currentValueSol,
            pnlSol,
            pnlPercent,
          };
        }));

        // Add new alerts
        if (newAlerts.length > 0) {
          setAlerts(prev => [...prev, ...newAlerts]);
          // Play alert sound
          try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQYAHo7a6NR6GB0fj9Lw33gVJRuT0fXigRMpGZTR+uCAFCwYk9H94oATLRiT0v7ggBMtGJPT/uCAEy0Yk9P+4IATLRiT0/7ggBMtGJLU/uGAEi0ZktT+4YASLBqT1P7hgBIsGpPU/uGAEiwak9T+4YASLBqT1P7hgBIsGpPU/uGAEiwak9T+4YASLBqS1P7hgBIsGpLU/uGAEiwaktT+4YASLBqS1P7hgA==');
            audio.volume = 0.3;
            audio.play().catch(() => {});
          } catch {}
        }
      } catch (error) {
        console.error('[UI] Price update error:', error);
      }
    };

    // Initial fetch
    updatePrices();

    // Update every 5 seconds for faster alerts
    const interval = setInterval(updatePrices, 5000);
    return () => clearInterval(interval);
  }, [positions.length, config.takeProfitPercent, config.stopLossPercent, config.enableTrailingStop, config.trailingStopActivation, config.trailingStopDistance, alerts]);

  const analyze = async () => {
    if (!address.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: address.trim() }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSnipe = async (forceHighRisk = false) => {
    if (!result) return;
    if (!forceHighRisk && result.riskScore > config.maxRiskScore) return;
    if (!publicKey || !signTransaction) {
      setSnipeStatus('Please connect your wallet first');
      return;
    }

    setSniping(true);
    setSnipeStatus('Preparing swap transaction...');

    try {
      // Calculate buy amount based on tiered strategy
      let buyAmount = config.buyAmountSol;
      if (config.enableTieredBuys && result.riskScore > config.tierLowRisk) {
        if (result.riskScore <= config.tierMediumRisk) {
          buyAmount = config.buyAmountSol * config.tierMediumMultiplier;
        } else {
          buyAmount = config.buyAmountSol * config.tierHighMultiplier;
        }
      }

      setSnipeStatus(`Buying with ${buyAmount.toFixed(3)} SOL...`);
      console.log(`[UI] Executing client-side buy: ${address.trim()} with ${buyAmount} SOL`);

      const swapResult = await executeBuy(
        address.trim(),
        buyAmount,
        config.maxSlippageBps,
        config.priorityFeeLamports,
        { publicKey, signTransaction }
      );

      if (swapResult.success) {
        setSnipeStatus(`Success! TX: ${swapResult.signature?.slice(0, 8)}...`);

        // Get token symbol with fallbacks
        const tokenSymbol = result.market?.symbol
          || result.market?.name?.slice(0, 8)
          || address.trim().slice(0, 6);

        // Add to local positions
        const newPosition: Position = {
          tokenAddress: address.trim(),
          tokenSymbol,
          entryPrice: buyAmount / (swapResult.outputAmount || 1),
          currentPrice: buyAmount / (swapResult.outputAmount || 1),
          amountTokens: swapResult.outputAmount || 0,
          costBasisSol: buyAmount,
          currentValueSol: buyAmount,
          pnlPercent: 0,
          pnlSol: 0,
          entryTime: Date.now(),
          txSignature: swapResult.signature || '',
        };

        setPositions(prev => [...prev, newPosition]);
        setStats(prev => ({ ...prev, tokensSniped: prev.tokensSniped + 1 }));

        // Clear status after 5 seconds
        setTimeout(() => setSnipeStatus(null), 5000);
      } else {
        setSnipeStatus(`Failed: ${swapResult.error}`);
        setTimeout(() => setSnipeStatus(null), 5000);
      }
    } catch (error: any) {
      console.error('[UI] Snipe error:', error);
      setSnipeStatus(`Error: ${error.message || 'Unknown error'}`);
      setTimeout(() => setSnipeStatus(null), 5000);
    } finally {
      setSniping(false);
    }
  };

  const handleSell = async (tokenAddress: string) => {
    if (!publicKey || !signTransaction) {
      setSnipeStatus('Please connect your wallet first');
      return;
    }

    const position = positions.find(p => p.tokenAddress === tokenAddress);
    if (!position) return;

    setSellingToken(tokenAddress);
    setSnipeStatus(`Selling ${position.tokenSymbol}...`);

    try {
      // Assume 6 decimals for most pump.fun tokens
      const tokenDecimals = 6;

      const sellResult = await executeSell(
        tokenAddress,
        position.amountTokens,
        tokenDecimals,
        config.maxSlippageBps,
        config.priorityFeeLamports,
        { publicKey, signTransaction }
      );

      if (sellResult.success) {
        const pnl = (sellResult.outputAmount || 0) - position.costBasisSol;
        setSnipeStatus(`Sold! ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL | TX: ${sellResult.signature?.slice(0, 8)}...`);

        // Remove from positions
        setPositions(prev => prev.filter(p => p.tokenAddress !== tokenAddress));
        setStats(prev => ({ ...prev, totalPnlSol: prev.totalPnlSol + pnl }));

        setTimeout(() => setSnipeStatus(null), 5000);
      } else {
        setSnipeStatus(`Sell failed: ${sellResult.error}`);
        setTimeout(() => setSnipeStatus(null), 5000);
      }
    } catch (error: any) {
      console.error('[UI] Sell error:', error);
      setSnipeStatus(`Error: ${error.message || 'Unknown error'}`);
      setTimeout(() => setSnipeStatus(null), 5000);
    } finally {
      setSellingToken(null);
    }
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canSnipe = result && result.riskScore <= config.maxRiskScore && publicKey;
  const totalHoldings = positions.reduce((sum, p) => sum + p.currentValueSol, 0);
  const totalCost = positions.reduce((sum, p) => sum + p.costBasisSol, 0);

  const dismissAlert = (tokenAddress: string) => {
    setAlerts(prev => prev.filter(a => a.tokenAddress !== tokenAddress));
  };

  const handleAlertSell = async (tokenAddress: string) => {
    dismissAlert(tokenAddress);
    await handleSell(tokenAddress);
  };

  return (
    <div className="min-h-screen bg-dark-950 text-white flex flex-col">
      {/* Alert Banner */}
      {alerts.length > 0 && (
        <div className="fixed top-0 left-0 right-0 z-[100] p-4 space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.tokenAddress}
              className={`max-w-xl mx-auto rounded-xl p-4 shadow-2xl border backdrop-blur-xl animate-pulse ${
                alert.type === 'TP'
                  ? 'bg-green-500/20 border-green-500/50'
                  : alert.type === 'TRAILING'
                  ? 'bg-yellow-500/20 border-yellow-500/50'
                  : 'bg-red-500/20 border-red-500/50'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  alert.type === 'TP' ? 'bg-green-500/30' :
                  alert.type === 'TRAILING' ? 'bg-yellow-500/30' : 'bg-red-500/30'
                }`}>
                  <Bell className={`w-6 h-6 ${
                    alert.type === 'TP' ? 'text-green-400' :
                    alert.type === 'TRAILING' ? 'text-yellow-400' : 'text-red-400'
                  }`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{alert.tokenSymbol}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      alert.type === 'TP' ? 'bg-green-500/30 text-green-300' :
                      alert.type === 'TRAILING' ? 'bg-yellow-500/30 text-yellow-300' :
                      'bg-red-500/30 text-red-300'
                    }`}>
                      {alert.type === 'TP' ? 'TAKE PROFIT' : alert.type === 'TRAILING' ? 'TRAILING STOP' : 'STOP LOSS'}
                    </span>
                  </div>
                  <p className={`text-sm ${
                    alert.type === 'TP' ? 'text-green-300' :
                    alert.type === 'TRAILING' ? 'text-yellow-300' : 'text-red-300'
                  }`}>{alert.message}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAlertSell(alert.tokenAddress)}
                    className={`px-4 py-2 rounded-lg font-bold text-sm transition ${
                      alert.type === 'TP'
                        ? 'bg-green-500 hover:bg-green-400 text-black'
                        : alert.type === 'TRAILING'
                        ? 'bg-yellow-500 hover:bg-yellow-400 text-black'
                        : 'bg-red-500 hover:bg-red-400 text-white'
                    }`}
                  >
                    SELL NOW
                  </button>
                  <button
                    onClick={() => dismissAlert(alert.tokenAddress)}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Background */}
      <div className="fixed inset-0 tech-grid opacity-20 pointer-events-none" />

      {/* Top Nav */}
      <nav className="relative z-50 bg-dark-900/80 backdrop-blur-xl border-b border-cyber-blue/20">
        <div className="px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyber-blue to-cyber-purple flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold font-cyber tracking-wider">WHALESHIELD</span>
          </div>

          <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 ${
              connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              {connected ? 'Live' : 'Offline'}
            </div>
            <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg text-gray-400 hover:text-cyber-blue hover:bg-dark-800 transition">
              <SettingsIcon className="w-5 h-5" />
            </button>
            <WalletMultiButton />
          </div>
        </div>
      </nav>

      {/* Main Layout */}
      <div className="flex-1 flex relative z-10">
        {/* Left Sidebar - Stats */}
        <aside className="w-72 border-r border-cyber-blue/10 bg-dark-900/50 p-4 flex flex-col gap-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-2">Portfolio</h3>

          {/* Holdings Card */}
          <div className="cyber-border rounded-xl p-4 bg-dark-800/50">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Holdings</p>
                <p className="text-xl font-bold text-white">{totalHoldings.toFixed(4)} <span className="text-sm text-gray-500">SOL</span></p>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              Cost Basis: {totalCost.toFixed(4)} SOL
            </div>
          </div>

          {/* Profit Card */}
          <div className="cyber-border rounded-xl p-4 bg-dark-800/50">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stats.totalPnlSol >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                <TrendingUp className={`w-5 h-5 ${stats.totalPnlSol >= 0 ? 'text-green-400' : 'text-red-400'}`} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Profit/Loss</p>
                <p className={`text-xl font-bold ${stats.totalPnlSol >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {stats.totalPnlSol >= 0 ? '+' : ''}{stats.totalPnlSol.toFixed(4)} <span className="text-sm opacity-60">SOL</span>
                </p>
              </div>
            </div>
            {totalCost > 0 && (
              <div className={`text-xs ${stats.totalPnlSol >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {((stats.totalPnlSol / totalCost) * 100).toFixed(1)}% return
              </div>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="cyber-border rounded-xl p-3 bg-dark-800/50 text-center">
              <BarChart3 className="w-5 h-5 text-cyber-blue mx-auto mb-1" />
              <p className="text-lg font-bold text-white">{stats.tokensScanned}</p>
              <p className="text-[10px] text-gray-500 uppercase">Analyzed</p>
            </div>
            <div className="cyber-border rounded-xl p-3 bg-dark-800/50 text-center">
              <Target className="w-5 h-5 text-amber-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">{positions.length}</p>
              <p className="text-[10px] text-gray-500 uppercase">Positions</p>
            </div>
          </div>

          {/* Config Summary */}
          <div className="cyber-border rounded-xl p-4 bg-dark-800/50">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Strategy</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Buy</span>
                <span className="text-white font-medium">{config.buyAmountSol} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Max Risk</span>
                <span className="text-white font-medium">{config.maxRiskScore}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">TP / SL</span>
                <span className="font-medium">
                  <span className="text-green-400">+{config.takeProfitPercent}%</span>
                  <span className="text-gray-600 mx-1">/</span>
                  <span className="text-red-400">-{config.stopLossPercent}%</span>
                </span>
              </div>
            </div>

            {/* Active Strategies */}
            <div className="mt-3 pt-3 border-t border-dark-600">
              <div className="flex flex-wrap gap-1">
                {config.enableTieredBuys && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-cyber-blue/20 text-cyber-blue">Tiered</span>
                )}
                {config.enableScaleOut && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-green-500/20 text-green-400">Scale Out</span>
                )}
                {config.enableTrailingStop && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400">Trailing</span>
                )}
                {config.enableQuickFlip && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400">Quick Flip</span>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Center - Scanner */}
        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-2xl mx-auto">
            {/* Search */}
            <div className="cyber-border rounded-xl p-5 bg-dark-800/50 mb-6">
              <h2 className="text-lg font-bold font-cyber mb-4 flex items-center gap-2">
                <Search className="w-5 h-5 text-cyber-blue" />
                <span className="gradient-text">TOKEN</span> SCANNER
              </h2>
              <div className="flex gap-3">
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && analyze()}
                  placeholder="Paste Solana token address..."
                  className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-cyber-blue/50 font-mono text-sm"
                />
                <button
                  onClick={analyze}
                  disabled={loading || !address.trim()}
                  className="px-5 py-3 bg-gradient-to-r from-cyber-blue to-cyber-purple rounded-lg font-bold font-cyber text-sm hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                  SCAN
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="cyber-border rounded-xl p-4 bg-red-500/10 border-red-500/30 mb-6 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <span className="text-red-400">{error}</span>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-4 slide-in">
                {/* Main Card */}
                <div className="narrative-card cyber-border rounded-xl p-5 bg-dark-800/50">
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center font-cyber text-2xl font-bold ${
                      result.riskScore <= 40 ? 'bg-green-500/20 text-green-400' :
                      result.riskScore <= 70 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {result.riskScore}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold">{result.market?.name || 'Unknown'}</h3>
                        {result.market?.symbol && <span className="text-gray-500">${result.market.symbol}</span>}
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          result.riskLevel === 'SAFE' ? 'bg-green-500/20 text-green-400' :
                          result.riskLevel === 'SUSPICIOUS' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>{result.riskLevel}</span>
                      </div>
                      <p className="text-sm text-gray-400">{result.summary}</p>
                    </div>
                  </div>

                  {/* Stats */}
                  {result.market && (
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      <div className="bg-dark-900/50 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-gray-500">MCap</p>
                        <p className="font-bold text-sm">{formatNum(result.market.marketCap)}</p>
                      </div>
                      <div className="bg-dark-900/50 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-gray-500">Liquidity</p>
                        <p className="font-bold text-sm">{formatNum(result.market.liquidity)}</p>
                      </div>
                      <div className="bg-dark-900/50 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-gray-500">Holders</p>
                        <p className="font-bold text-sm">{result.holders?.totalHolders?.toLocaleString() || '-'}</p>
                      </div>
                      <div className="bg-dark-900/50 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-gray-500">Age</p>
                        <p className="font-bold text-sm">{result.market.ageInDays < 1 ? '<1d' : `${Math.floor(result.market.ageInDays)}d`}</p>
                      </div>
                    </div>
                  )}

                  {/* Security */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {result.authorities?.mintRevoked !== undefined && (
                      <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        result.authorities.mintRevoked ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {result.authorities.mintRevoked ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        Mint
                      </span>
                    )}
                    {result.authorities?.freezeRevoked !== undefined && (
                      <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        result.authorities.freezeRevoked ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {result.authorities.freezeRevoked ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        Freeze
                      </span>
                    )}
                    {result.holders?.top1NonLp !== undefined && (
                      <span className={`px-2 py-1 rounded text-xs ${
                        result.holders.top1NonLp > 20 ? 'bg-red-500/10 text-red-400' :
                        result.holders.top1NonLp > 10 ? 'bg-yellow-500/10 text-yellow-400' :
                        'bg-green-500/10 text-green-400'
                      }`}>
                        Top: {result.holders.top1NonLp.toFixed(1)}%
                      </span>
                    )}
                    {result.insiders && result.insiders.count > 0 && (
                      <span className="px-2 py-1 rounded text-xs bg-yellow-500/10 text-yellow-400">
                        {result.insiders.count} Insiders
                      </span>
                    )}
                  </div>

                  {/* Links */}
                  <div className="flex gap-2">
                    <button onClick={copyAddress} className="px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 rounded-lg flex items-center gap-1.5">
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <a href={`https://dexscreener.com/solana/${address}`} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 rounded-lg flex items-center gap-1.5">
                      <ExternalLink className="w-3 h-3" /> DEX
                    </a>
                    {result.socials?.twitter && (
                      <a href={result.socials.twitter} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-xs bg-cyber-blue/10 text-cyber-blue rounded-lg">Twitter</a>
                    )}
                  </div>
                </div>

                {/* Flags */}
                {result.flags && result.flags.length > 0 && (
                  <div className="cyber-border rounded-xl p-4 bg-dark-800/50">
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Risk Flags ({result.flags.length})</h4>
                    <div className="space-y-1.5">
                      {result.flags.map((flag, i) => (
                        <div key={i} className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                          flag.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-400' :
                          flag.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400' :
                          flag.severity === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400' :
                          'bg-dark-700 text-gray-400'
                        }`}>
                          <span className="text-[9px] uppercase font-bold w-12 opacity-60">{flag.severity}</span>
                          <span>{flag.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Snipe Status */}
                {snipeStatus && (
                  <div className={`p-3 rounded-xl text-sm text-center ${
                    snipeStatus.includes('failed') || snipeStatus.includes('Error') || snipeStatus.includes('Failed') ? 'bg-red-500/20 text-red-400' :
                    snipeStatus.includes('Success') || snipeStatus.includes('Sold') ? 'bg-green-500/20 text-green-400' :
                    snipeStatus.includes('rejected') ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-cyber-blue/20 text-cyber-blue'
                  }`}>
                    {snipeStatus}
                  </div>
                )}

                {/* Snipe Buttons */}
                <div className="flex gap-2">
                  {/* Main Snipe Button */}
                  <button
                    onClick={() => handleSnipe(false)}
                    disabled={!canSnipe || sniping}
                    className={`flex-1 py-3 rounded-xl font-bold font-cyber flex items-center justify-center gap-2 transition ${
                      canSnipe && !sniping ? 'bg-gradient-to-r from-green-500 to-cyber-blue text-white cyber-glow' : 'bg-dark-700 text-gray-500'
                    }`}
                  >
                    <Zap className="w-5 h-5" />
                    {sniping ? 'SNIPING...' : !publicKey ? 'Connect Wallet' : canSnipe ? 'EXECUTE SNIPE' : `Risk > ${config.maxRiskScore}`}
                  </button>

                  {/* Force High-Risk Snipe */}
                  {result && result.riskScore > config.maxRiskScore && publicKey && (
                    <button
                      onClick={() => handleSnipe(true)}
                      disabled={sniping}
                      className="px-4 py-3 rounded-xl font-bold text-sm bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition flex items-center gap-2"
                      title="Override risk check and snipe anyway"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      YOLO
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Empty */}
            {!result && !loading && !error && (
              <div className="cyber-border rounded-xl p-10 bg-dark-800/30 text-center">
                <Shield className="w-12 h-12 text-cyber-blue/50 mx-auto mb-4" />
                <h3 className="font-bold font-cyber mb-1">Ready to Scan</h3>
                <p className="text-sm text-gray-500">Paste a token address to analyze</p>
              </div>
            )}
          </div>
        </main>

        {/* Right Sidebar - Positions */}
        <aside className="w-80 border-l border-cyber-blue/10 bg-dark-900/50 p-4 flex flex-col">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-2 mb-4 flex items-center justify-between">
            Active Positions
            <span className="bg-cyber-blue/20 text-cyber-blue px-2 py-0.5 rounded-full">{positions.length}</span>
          </h3>

          {positions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Target className="w-10 h-10 text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-600">No positions yet</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3">
              {positions.map((pos) => (
                <div key={pos.tokenAddress} className="cyber-border rounded-xl p-4 bg-dark-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold">{pos.tokenSymbol}</span>
                    <span className={`text-sm font-bold ${pos.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                      <p className="text-gray-500">Value</p>
                      <p className="font-medium">{pos.currentValueSol.toFixed(4)} SOL</p>
                    </div>
                    <div>
                      <p className="text-gray-500">PnL</p>
                      <p className={`font-medium ${pos.pnlSol >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pos.pnlSol >= 0 ? '+' : ''}{pos.pnlSol.toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Entry</p>
                      <p className="font-mono text-[10px]">{pos.entryPrice.toFixed(8)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Held</p>
                      <p className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(pos.entryTime)}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSell(pos.tokenAddress)}
                      disabled={sellingToken === pos.tokenAddress}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 ${
                        sellingToken === pos.tokenAddress
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      }`}
                    >
                      {sellingToken === pos.tokenAddress ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Selling...
                        </>
                      ) : (
                        'Sell'
                      )}
                    </button>
                    <a
                      href={`https://dexscreener.com/solana/${pos.tokenAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-dark-700 text-gray-400 rounded-lg text-xs hover:bg-dark-600 flex items-center"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Settings */}
      {showSettings && (
        <Settings config={config} onUpdate={(c) => setConfig({ ...config, ...c })} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
