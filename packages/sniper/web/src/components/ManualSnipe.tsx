import { useState } from 'react';
import { Search, Loader2, CheckCircle, XCircle, Zap, ExternalLink, Shield, Users, Clock, TrendingUp, Wallet, AlertTriangle, Globe, Twitter } from 'lucide-react';

interface AnalysisResult {
  riskScore: number;
  riskLevel: string;
  summary: string;
  confidence: number;
  flags: { message: string; severity: string; type: string }[];
  market?: {
    name: string;
    symbol: string;
    priceUsd: number;
    priceChange24h: number;
    marketCap: number;
    liquidity: number;
    volume24h: number;
    txns24h: { buys: number; sells: number };
    dex: string;
    ageInDays: number;
  };
  holders?: {
    topHolder: number;
    top10Holders: number;
    top1NonLp: number;
    top10NonLp: number;
    totalHolders: number;
  };
  creator?: {
    address: string;
    walletAge: string;
    tokensCreated: number;
    ruggedTokens: number;
  };
  devSelling?: {
    hasSold: boolean;
    percentSold: number;
    currentHoldingsPercent: number;
    message: string;
  };
  insiders?: {
    count: number;
    highRiskCount: number;
    totalHoldingsPercent: number;
    message: string;
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

interface ManualSnipeProps {
  onSnipe: (tokenAddress: string) => void;
  maxRiskScore: number;
  isWatchOnly: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

function formatPercent(num: number | undefined): string {
  if (num === undefined || num === null) return 'N/A';
  return `${num.toFixed(1)}%`;
}

// Circular gauge component
function RiskGauge({ score, level }: { score: number; level: string }) {
  const radius = 70;
  const stroke = 10;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const getColor = () => {
    if (score < 40) return '#00ff88';
    if (score < 70) return '#ffcc00';
    return '#ff4444';
  };

  const getGlow = () => {
    if (score < 40) return '0 0 20px rgba(0, 255, 136, 0.5)';
    if (score < 70) return '0 0 20px rgba(255, 204, 0, 0.5)';
    return '0 0 20px rgba(255, 68, 68, 0.5)';
  };

  return (
    <div className="relative flex items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          stroke="#1a1a28"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        {/* Progress circle */}
        <circle
          stroke={getColor()}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{
            strokeDashoffset,
            filter: getGlow(),
            transition: 'stroke-dashoffset 0.5s ease-out'
          }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-bold" style={{ color: getColor() }}>{score}</span>
        <span className="text-xs text-gray-500 uppercase tracking-wider">{level}</span>
      </div>
    </div>
  );
}

export function ManualSnipe({ onSnipe, maxRiskScore, isWatchOnly }: ManualSnipeProps) {
  const [tokenAddress, setTokenAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!tokenAddress.trim()) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: tokenAddress.trim() }),
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSnipe = () => {
    if (result && result.riskScore <= maxRiskScore) {
      onSnipe(tokenAddress.trim());
    }
  };

  const canSnipe = result && result.riskScore <= maxRiskScore && !isWatchOnly;
  const isSafe = result && result.riskScore <= maxRiskScore;

  const getRiskGradient = (score: number) => {
    if (score < 40) return 'from-green-500/20 to-cyan-500/20 border-green-500/30';
    if (score < 70) return 'from-yellow-500/20 to-orange-500/20 border-yellow-500/30';
    return 'from-red-500/20 to-orange-500/20 border-red-500/30';
  };

  return (
    <div className="space-y-4">
      {/* Search Header */}
      <div className="bg-dark-800/50 cyber-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-5 h-5 text-cyber-blue" />
          <h3 className="text-sm font-cyber font-medium text-cyber-blue">Manual Token Analysis</h3>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            placeholder="Paste token address..."
            className="flex-1 bg-dark-900 border border-gray-700/50 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyber-blue/50 focus:ring-1 focus:ring-cyber-blue/30 font-mono text-sm transition-all"
          />
          <button
            onClick={handleAnalyze}
            disabled={loading || !tokenAddress.trim()}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyber-blue/20 to-cyan-500/20 hover:from-cyber-blue/30 hover:to-cyan-500/30 text-cyber-blue rounded-lg font-semibold transition-all border border-cyber-blue/30 hover:border-cyber-blue/50 hover:shadow-lg hover:shadow-cyber-blue/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Search className="w-5 h-5" />
            )}
            Analyze
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Main Score Card */}
          <div className={`bg-gradient-to-br ${getRiskGradient(result.riskScore)} border rounded-xl p-6 relative overflow-hidden`}>
            {/* Background glow */}
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background: result.riskScore < 40
                  ? 'radial-gradient(circle at 30% 50%, rgba(0, 255, 136, 0.3), transparent 50%)'
                  : result.riskScore < 70
                    ? 'radial-gradient(circle at 30% 50%, rgba(255, 204, 0, 0.3), transparent 50%)'
                    : 'radial-gradient(circle at 30% 50%, rgba(255, 68, 68, 0.3), transparent 50%)'
              }}
            />

            <div className="relative flex items-center gap-6">
              {/* Gauge */}
              <RiskGauge score={result.riskScore} level={result.riskLevel} />

              {/* Token Info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-white">{result.market?.name || 'Unknown Token'}</h2>
                  {result.market?.symbol && (
                    <span className="text-lg text-gray-400">${result.market.symbol}</span>
                  )}
                  {result.market?.dex && (
                    <span className="px-2 py-1 text-xs font-medium rounded bg-cyber-blue/20 text-cyber-blue border border-cyber-blue/30">
                      {result.market.dex}
                    </span>
                  )}
                </div>

                {result.market?.ageInDays !== undefined && (
                  <div className="flex items-center gap-1.5 text-gray-400 text-sm mb-3">
                    <Clock className="w-4 h-4" />
                    {result.market.ageInDays < 1 ? 'Less than 1 day old' : `${result.market.ageInDays.toFixed(1)} days old`}
                  </div>
                )}

                <p className="text-gray-300 text-sm leading-relaxed">{result.summary}</p>

                {/* Quick Links */}
                <div className="flex items-center gap-3 mt-4">
                  <a
                    href={`https://dexscreener.com/solana/${tokenAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyber-blue transition px-2 py-1 rounded bg-dark-800/50 hover:bg-dark-700/50"
                  >
                    <TrendingUp className="w-3 h-3" /> DexScreener
                  </a>
                  <a
                    href={`https://solscan.io/token/${tokenAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyber-blue transition px-2 py-1 rounded bg-dark-800/50 hover:bg-dark-700/50"
                  >
                    <ExternalLink className="w-3 h-3" /> Solscan
                  </a>
                  {result.socials?.twitter && (
                    <a
                      href={result.socials.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyber-blue transition px-2 py-1 rounded bg-dark-800/50 hover:bg-dark-700/50"
                    >
                      <Twitter className="w-3 h-3" /> Twitter
                    </a>
                  )}
                  {result.socials?.website && (
                    <a
                      href={result.socials.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyber-blue transition px-2 py-1 rounded bg-dark-800/50 hover:bg-dark-700/50"
                    >
                      <Globe className="w-3 h-3" /> Website
                    </a>
                  )}
                </div>
              </div>

              {/* Status Icon */}
              <div className={`p-4 rounded-xl ${isSafe ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {isSafe ? (
                  <CheckCircle className="w-12 h-12 text-green-400" />
                ) : (
                  <XCircle className="w-12 h-12 text-red-400" />
                )}
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Market Cap */}
            <div className="bg-dark-800/50 cyber-border rounded-xl p-4 hover:border-cyber-blue/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyber-blue/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-cyber-blue" />
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Market Cap</span>
              </div>
              <p className="text-xl font-bold text-white">{result.market?.marketCap ? formatNumber(result.market.marketCap) : 'N/A'}</p>
            </div>

            {/* Liquidity */}
            <div className="bg-dark-800/50 cyber-border rounded-xl p-4 hover:border-cyber-blue/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-cyan-400" />
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Liquidity</span>
              </div>
              <p className="text-xl font-bold text-white">{result.market?.liquidity ? formatNumber(result.market.liquidity) : 'N/A'}</p>
            </div>

            {/* Holders */}
            <div className="bg-dark-800/50 cyber-border rounded-xl p-4 hover:border-cyber-blue/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Users className="w-4 h-4 text-purple-400" />
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Holders</span>
              </div>
              <p className="text-xl font-bold text-white">{result.holders?.totalHolders?.toLocaleString() || 'N/A'}</p>
            </div>

            {/* 24h Change */}
            <div className="bg-dark-800/50 cyber-border rounded-xl p-4 hover:border-cyber-blue/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${result.market?.priceChange24h && result.market.priceChange24h >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                  <TrendingUp className={`w-4 h-4 ${result.market?.priceChange24h && result.market.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`} />
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">24h Change</span>
              </div>
              <p className={`text-xl font-bold ${result.market?.priceChange24h && result.market.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {result.market?.priceChange24h ? `${result.market.priceChange24h >= 0 ? '+' : ''}${result.market.priceChange24h.toFixed(1)}%` : 'N/A'}
              </p>
            </div>
          </div>

          {/* Security & Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Security Status */}
            <div className="bg-dark-800/50 cyber-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-cyber-blue" />
                <h4 className="font-semibold text-white">Security Status</h4>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-lg border ${result.authorities?.mintRevoked ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                  <div className="flex items-center gap-2">
                    {result.authorities?.mintRevoked ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className={`text-sm font-medium ${result.authorities?.mintRevoked ? 'text-green-400' : 'text-red-400'}`}>
                      Mint {result.authorities?.mintRevoked ? 'Revoked' : 'Active'}
                    </span>
                  </div>
                </div>
                <div className={`p-3 rounded-lg border ${result.authorities?.freezeRevoked ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                  <div className="flex items-center gap-2">
                    {result.authorities?.freezeRevoked ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className={`text-sm font-medium ${result.authorities?.freezeRevoked ? 'text-green-400' : 'text-red-400'}`}>
                      Freeze {result.authorities?.freezeRevoked ? 'Revoked' : 'Active'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dev & Insiders */}
              <div className="mt-4 space-y-2">
                {result.devSelling && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Dev Wallet:</span>
                    <span className={result.devSelling.currentHoldingsPercent > 5 ? 'text-yellow-400' : 'text-green-400'}>
                      {result.devSelling.message || `Holds ${formatPercent(result.devSelling.currentHoldingsPercent)}`}
                    </span>
                  </div>
                )}
                {result.insiders && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Insiders:</span>
                    <span className={result.insiders.highRiskCount > 0 ? 'text-red-400' : result.insiders.count > 0 ? 'text-yellow-400' : 'text-green-400'}>
                      {result.insiders.count === 0 ? 'None detected' : `${result.insiders.count} found`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Holder Distribution */}
            {result.holders && (
              <div className="bg-dark-800/50 cyber-border rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Users className="w-5 h-5 text-cyber-blue" />
                  <h4 className="font-semibold text-white">Holder Distribution</h4>
                </div>

                {/* Top Holder Bar */}
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">Top Holder (Non-LP)</span>
                      <span className={`font-medium ${result.holders.top1NonLp > 20 ? 'text-red-400' : result.holders.top1NonLp > 10 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {formatPercent(result.holders.top1NonLp)}
                      </span>
                    </div>
                    <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(result.holders.top1NonLp || 0, 100)}%`,
                          background: (result.holders.top1NonLp || 0) > 20 ? '#ff4444' : (result.holders.top1NonLp || 0) > 10 ? '#ffcc00' : '#00ff88'
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">Top 10 (Non-LP)</span>
                      <span className={`font-medium ${result.holders.top10NonLp > 60 ? 'text-red-400' : result.holders.top10NonLp > 40 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {formatPercent(result.holders.top10NonLp)}
                      </span>
                    </div>
                    <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(result.holders.top10NonLp || 0, 100)}%`,
                          background: (result.holders.top10NonLp || 0) > 60 ? '#ff4444' : (result.holders.top10NonLp || 0) > 40 ? '#ffcc00' : '#00ff88'
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Risk Flags */}
          {result.flags && result.flags.length > 0 && (
            <div className="bg-dark-800/50 cyber-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  <h4 className="font-semibold text-white">Risk Flags</h4>
                </div>
                <span className="text-xs text-gray-500 px-2 py-1 rounded bg-dark-700">{result.flags.length} issues</span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {result.flags.map((flag, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-lg border-l-2 ${
                      flag.severity === 'CRITICAL' ? 'bg-red-500/10 border-red-500 text-red-300' :
                      flag.severity === 'HIGH' ? 'bg-orange-500/10 border-orange-500 text-orange-300' :
                      flag.severity === 'MEDIUM' ? 'bg-yellow-500/10 border-yellow-500 text-yellow-300' :
                      'bg-gray-500/10 border-gray-500 text-gray-300'
                    }`}
                  >
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      flag.severity === 'CRITICAL' ? 'bg-red-500/30' :
                      flag.severity === 'HIGH' ? 'bg-orange-500/30' :
                      flag.severity === 'MEDIUM' ? 'bg-yellow-500/30' :
                      'bg-gray-500/30'
                    }`}>
                      {flag.severity}
                    </span>
                    <span className="text-sm flex-1">{flag.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creator Info */}
          {result.creator && (
            <div className="bg-dark-800/30 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>Created by:</span>
                <a
                  href={`https://solscan.io/account/${result.creator.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyber-blue hover:underline font-mono"
                >
                  {result.creator.address.slice(0, 6)}...{result.creator.address.slice(-4)}
                </a>
              </div>
              {result.creator.tokensCreated > 1 && (
                <span className={`text-xs px-2 py-1 rounded ${result.creator.ruggedTokens > 0 ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {result.creator.tokensCreated} tokens{result.creator.ruggedTokens > 0 ? ` (${result.creator.ruggedTokens} rugged)` : ''}
                </span>
              )}
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleSnipe}
            disabled={!canSnipe}
            className={`w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold text-lg transition-all ${
              canSnipe
                ? 'bg-gradient-to-r from-green-500/20 to-cyan-500/20 hover:from-green-500/30 hover:to-cyan-500/30 text-green-400 border border-green-500/30 hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/20'
                : 'bg-gray-700/20 text-gray-500 border border-gray-700/30 cursor-not-allowed'
            }`}
          >
            <Zap className="w-6 h-6" />
            {isWatchOnly
              ? 'Watch-Only Mode (No Trading)'
              : canSnipe
                ? 'Snipe This Token'
                : `Risk Too High (max ${maxRiskScore})`
            }
          </button>
        </>
      )}
    </div>
  );
}
