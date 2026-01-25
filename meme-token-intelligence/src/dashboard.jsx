import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, TrendingUp, Shield, Zap, DollarSign, Users, Clock, X, RefreshCw, ExternalLink, Copy, CheckCircle, XCircle, Activity, Eye, Wallet, Settings, BarChart3, Brain, Sparkles, AlertCircle } from 'lucide-react';

// Signal colors - muted for light theme
const SIGNAL_COLORS = {
  STRONG_BUY: '#22c55e',
  BUY: '#4ade80',
  WATCH: '#eab308',
  HOLD: '#6b7280',
  AVOID: '#ef4444',
};

const SIGNAL_BG = {
  STRONG_BUY: 'bg-green-50 border-green-200',
  BUY: 'bg-emerald-50 border-emerald-200',
  WATCH: 'bg-yellow-50 border-yellow-200',
  HOLD: 'bg-gray-50 border-gray-200',
  AVOID: 'bg-red-50 border-red-200',
};

// Components
const SignalBadge = ({ signal }) => (
  <span
    className="px-2 py-0.5 rounded text-xs font-semibold"
    style={{ backgroundColor: `${SIGNAL_COLORS[signal]}15`, color: SIGNAL_COLORS[signal] }}
  >
    {signal.replace('_', ' ')}
  </span>
);

const RiskScore = ({ score }) => {
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  return (
    <span className="font-semibold" style={{ color }}>{score}</span>
  );
};

// AI Badge
const AIBadge = ({ ai }) => {
  if (!ai) return null;

  const isFull = ai.tier === 'full';

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-600 border border-purple-200">
      <Brain className="w-3 h-3" />
      {isFull ? `${ai.confidence}%` : (ai.watch ? '👀' : '⏭️')}
    </span>
  );
};

const TokenRow = ({ token, onClick }) => {
  return (
    <tr
      onClick={() => onClick(token)}
      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">{token.symbol}</span>
          <span className="text-xs text-gray-400">{token.dex}</span>
          {token.ai && <AIBadge ai={token.ai} />}
        </div>
      </td>
      <td className="py-3 px-4">
        <RiskScore score={token.score} />
      </td>
      <td className="py-3 px-4 font-mono text-sm text-gray-600">
        ${token.price?.toFixed(6)}
      </td>
      <td className="py-3 px-4">
        <span className={token.priceChange1h >= 0 ? 'text-green-600' : 'text-red-500'}>
          {token.priceChange1h >= 0 ? '+' : ''}{token.priceChange1h?.toFixed(1)}%
        </span>
      </td>
      <td className="py-3 px-4 text-gray-600">
        ${(token.liquidity / 1000).toFixed(1)}k
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-1">
          {token.onChain?.mintRevoked && <span className="w-2 h-2 rounded-full bg-green-500" title="Mint revoked" />}
          {token.onChain?.freezeRevoked && <span className="w-2 h-2 rounded-full bg-green-500" title="Freeze revoked" />}
          {!token.onChain?.mintRevoked && token.onChain && <span className="w-2 h-2 rounded-full bg-red-500" title="Mint active" />}
        </div>
      </td>
      <td className="py-3 px-4">
        <SignalBadge signal={token.signal} />
      </td>
    </tr>
  );
};

const TokenDetailModal = ({ token, onClose }) => {
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(token.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold text-gray-900">{token.symbol}</h2>
                <span className="text-sm px-2 py-1 rounded bg-gray-100 text-gray-500">{token.dex}</span>
                <SignalBadge signal={token.signal} />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <code className="text-xs text-gray-400 font-mono">{token.address?.slice(0, 16)}...{token.address?.slice(-8)}</code>
                <button onClick={copyAddress} className="text-gray-400 hover:text-gray-600">
                  {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* AI Analysis Card - NEW */}
          {token.ai && (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-5 h-5 text-purple-600" />
                <h3 className="font-semibold text-purple-900">AI Analysis</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600">
                  {token.ai.tier === 'full' ? 'Full Analysis' : 'Quick Check'}
                </span>
              </div>

              {token.ai.tier === 'full' ? (
                <>
                  {/* Full AI Analysis */}
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="bg-white/60 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500">Risk Level</p>
                      <p className={`text-lg font-bold ${token.ai.risk <= 3 ? 'text-green-600' : token.ai.risk <= 6 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {token.ai.risk}/10
                      </p>
                    </div>
                    <div className="bg-white/60 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500">AI Signal</p>
                      <p className="text-lg font-bold" style={{ color: SIGNAL_COLORS[token.ai.signal] }}>
                        {token.ai.signal?.replace('_', ' ')}
                      </p>
                    </div>
                    <div className="bg-white/60 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500">Confidence</p>
                      <p className="text-lg font-bold text-purple-600">{token.ai.confidence}%</p>
                    </div>
                  </div>

                  {/* Verdict */}
                  <div className="bg-white/60 rounded-lg p-3 mb-3">
                    <p className="text-sm text-gray-700 italic">"{token.ai.verdict}"</p>
                  </div>

                  {/* Reasoning */}
                  {token.ai.reasoning && (
                    <p className="text-sm text-gray-600 mb-3">{token.ai.reasoning}</p>
                  )}

                  {/* Flags */}
                  <div className="flex flex-wrap gap-2">
                    {token.ai.redFlags?.map((flag, i) => (
                      <span key={`red-${i}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">
                        <AlertCircle className="w-3 h-3" /> {flag}
                      </span>
                    ))}
                    {token.ai.greenFlags?.map((flag, i) => (
                      <span key={`green-${i}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                        <CheckCircle className="w-3 h-3" /> {flag}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                // Quick AI Check
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${token.ai.watch ? 'bg-green-100' : 'bg-gray-100'}`}>
                    {token.ai.watch ? <Eye className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-gray-400" />}
                  </div>
                  <div>
                    <p className={`font-semibold ${token.ai.watch ? 'text-green-700' : 'text-gray-500'}`}>
                      {token.ai.watch ? 'Worth Watching' : 'Skip'}
                    </p>
                    <p className="text-sm text-gray-600">{token.ai.reason}</p>
                  </div>
                  {token.ai.risk && (
                    <div className="ml-auto text-center">
                      <p className="text-xs text-gray-400">Risk</p>
                      <p className={`font-bold ${token.ai.risk <= 4 ? 'text-green-600' : token.ai.risk <= 6 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {token.ai.risk}/10
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Score Card */}
          <div className={`rounded-xl p-4 mb-6 border ${SIGNAL_BG[token.signal]}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">Heuristic Score</p>
                <p className="text-4xl font-bold" style={{ color: SIGNAL_COLORS[token.signal] }}>{token.score}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500 mb-1">Final Signal</p>
                <p className="text-xl font-semibold" style={{ color: SIGNAL_COLORS[token.signal] }}>{token.signal.replace('_', ' ')}</p>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Price</p>
              <p className="font-mono text-gray-900">${token.price?.toFixed(8)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">1h Change</p>
              <p className={token.priceChange1h >= 0 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>
                {token.priceChange1h >= 0 ? '+' : ''}{token.priceChange1h?.toFixed(1)}%
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Liquidity</p>
              <p className="text-gray-900 font-semibold">${(token.liquidity / 1000).toFixed(1)}k</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Volume 24h</p>
              <p className="text-gray-900 font-semibold">${(token.volume24h / 1000).toFixed(1)}k</p>
            </div>
          </div>

          {/* On-Chain Security */}
          {token.onChain && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">On-Chain Security</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className={`p-3 rounded-lg border ${token.onChain.mintRevoked ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {token.onChain.mintRevoked ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-500" />}
                    <span className="text-xs font-medium text-gray-600">Mint Authority</span>
                  </div>
                  <p className={`text-sm font-semibold ${token.onChain.mintRevoked ? 'text-green-700' : 'text-red-600'}`}>
                    {token.onChain.mintRevoked ? 'Revoked' : 'Active ⚠️'}
                  </p>
                </div>
                <div className={`p-3 rounded-lg border ${token.onChain.freezeRevoked ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {token.onChain.freezeRevoked ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-500" />}
                    <span className="text-xs font-medium text-gray-600">Freeze Authority</span>
                  </div>
                  <p className={`text-sm font-semibold ${token.onChain.freezeRevoked ? 'text-green-700' : 'text-red-600'}`}>
                    {token.onChain.freezeRevoked ? 'Revoked' : 'Active ⚠️'}
                  </p>
                </div>
                <div className={`p-3 rounded-lg border ${token.onChain.top10Pct < 60 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-4 h-4 text-gray-500" />
                    <span className="text-xs font-medium text-gray-600">Top 10 Holders</span>
                  </div>
                  <p className={`text-sm font-semibold ${token.onChain.top10Pct < 60 ? 'text-green-700' : 'text-yellow-700'}`}>
                    {token.onChain.top10Pct?.toFixed(0)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Analysis Factors */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Analysis Factors</h3>
            <div className="flex flex-wrap gap-2">
              {token.factors?.map((factor, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                  {factor}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <a
              href={token.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-gray-900 hover:bg-gray-800 text-white py-2.5 rounded-lg font-medium text-center flex items-center justify-center gap-2 text-sm"
            >
              View on DexScreener <ExternalLink className="w-4 h-4" />
            </a>
            <a
              href={`https://solscan.io/token/${token.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-lg font-medium flex items-center gap-2 text-sm"
            >
              Solscan <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

// Sidebar Nav Item
const NavItem = ({ icon: Icon, label, active }) => (
  <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-colors ${active ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
    <Icon className="w-5 h-5" />
    <span className="text-sm font-medium">{label}</span>
  </div>
);

// Main Dashboard
export default function MemeTokenDashboard() {
  const [tokens, setTokens] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [stats, setStats] = useState({ scanned: 0, filtered: 0, aiEnabled: false, aiTokensUsed: 0 });
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Scanning');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/scan-results.json?' + Date.now());
      if (!response.ok) throw new Error('Scanner not running');
      const data = await response.json();
      setTokens(data.opportunities || []);
      setLastUpdate(data.lastUpdate ? new Date(data.lastUpdate) : new Date());
      setStats({
        scanned: data.scanned || 0,
        filtered: data.filtered || 0,
        aiEnabled: data.aiEnabled || false,
        aiTokensUsed: data.aiTokensUsed || 0,
      });
      setStatus(data.aiEnabled ? 'AI Active' : 'Scanning');
    } catch (err) {
      setError('Start scanner: node scanner.js');
      setStatus('Offline');
      setTokens([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const signalCounts = {
    strongBuy: tokens.filter(t => t.signal === 'STRONG_BUY').length,
    buy: tokens.filter(t => t.signal === 'BUY').length,
    watch: tokens.filter(t => t.signal === 'WATCH').length,
  };

  const aiAnalyzedCount = tokens.filter(t => t.ai).length;

  return (
    <div className="min-h-screen bg-white flex">
      {/* Sidebar */}
      <div className="w-56 border-r border-gray-200 p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-8 px-2">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-gray-900">MEME<span className="text-purple-600">AI</span></span>
        </div>

        <nav className="space-y-1">
          <NavItem icon={BarChart3} label="Dashboard" active />
          <NavItem icon={Activity} label="Positions" />
          <NavItem icon={Settings} label="Settings" />
          <NavItem icon={Wallet} label="Wallet" />
        </nav>

        <div className="mt-auto pt-4 border-t border-gray-100">
          <div className="text-xs text-gray-400 px-4 space-y-1">
            <div>Auto-refresh: 30s</div>
            {stats.aiEnabled && (
              <div className="flex items-center gap-1 text-purple-500">
                <Brain className="w-3 h-3" /> AI Enabled
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6">
        {/* Header Stats */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex gap-8">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Scanned</p>
              <p className="text-2xl font-bold text-gray-900">{stats.scanned}</p>
              <p className="text-xs text-gray-400">tokens</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Active Signals</p>
              <p className="text-2xl font-bold text-gray-900">{signalCounts.strongBuy + signalCounts.buy}</p>
              <p className="text-xs text-green-500">+{signalCounts.strongBuy} strong</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">AI Analyzed</p>
              <p className="text-2xl font-bold text-purple-600">{aiAnalyzedCount}</p>
              <p className="text-xs text-gray-400">tokens</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Status</p>
              <p className={`text-2xl font-bold ${stats.aiEnabled ? 'text-purple-600' : 'text-green-500'}`}>{status}</p>
              <p className="text-xs text-gray-400">{lastUpdate?.toLocaleTimeString() || '--'}</p>
            </div>
          </div>

          {/* Config Panel */}
          <div className="bg-gray-50 rounded-xl p-4 w-64">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">AI Config</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Full Analysis</span>
                <span className="font-semibold text-gray-900">Score ≥50</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Quick Check</span>
                <span className="font-semibold text-gray-900">Score 30-49</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Est. Cost/Scan</span>
                <span className="font-semibold text-purple-600">~$0.03</span>
              </div>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Token Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-gray-900">Top Opportunities</h2>
              {stats.aiEnabled && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200">
                  <Sparkles className="w-3 h-3" /> AI Enhanced
                </span>
              )}
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {tokens.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="py-2 px-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Token</th>
                  <th className="py-2 px-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Score</th>
                  <th className="py-2 px-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Price</th>
                  <th className="py-2 px-4 text-xs font-medium text-gray-400 uppercase tracking-wide">1h</th>
                  <th className="py-2 px-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Liquidity</th>
                  <th className="py-2 px-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Security</th>
                  <th className="py-2 px-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Signal</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token, i) => (
                  <TokenRow key={token.address || i} token={token} onClick={setSelectedToken} />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-gray-400">
              {loading ? 'Loading...' : 'No tokens found. Make sure scanner is running.'}
            </div>
          )}
        </div>

        {/* AI Cost Tracker */}
        {stats.aiTokensUsed > 0 && (
          <div className="mt-6 flex justify-end">
            <div className="bg-purple-50 border border-purple-100 rounded-lg px-4 py-3 text-center">
              <p className="text-xs text-purple-400 uppercase tracking-wide mb-1">AI Tokens Used</p>
              <p className="text-sm font-medium text-purple-700">
                {stats.aiTokensUsed.toLocaleString()} (~${((stats.aiTokensUsed / 1000000) * 10).toFixed(4)})
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedToken && (
        <TokenDetailModal token={selectedToken} onClose={() => setSelectedToken(null)} />
      )}
    </div>
  );
}
