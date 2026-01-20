import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, Zap, ExternalLink, AlertTriangle, CheckCircle, XCircle, TrendingUp, Users, Shield, Copy, Check, Sparkles } from 'lucide-react';

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
    dex: string;
    ageInDays: number;
  };
  holders?: {
    top1NonLp: number;
    top10NonLp: number;
    totalHolders: number;
  };
  creator?: {
    address: string;
    tokensCreated: number;
    ruggedTokens: number;
  };
  devSelling?: {
    currentHoldingsPercent: number;
    message: string;
  };
  insiders?: {
    count: number;
    highRiskCount: number;
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

interface TokenAnalyzerProps {
  onSnipe: (tokenAddress: string) => void;
  maxRiskScore: number;
}

function formatNumber(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function TokenAnalyzer({ onSnipe, maxRiskScore }: TokenAnalyzerProps) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const handleInput = () => {
      if (inputRef.current) {
        setAddress(inputRef.current.value);
      }
    };
    inputRef.current?.addEventListener('input', handleInput);
    return () => inputRef.current?.removeEventListener('input', handleInput);
  }, []);

  const canSnipe = result && result.riskScore <= maxRiskScore;

  const getScoreColor = (score: number) => {
    if (score <= 30) return { color: '#10b981', glow: 'rgba(16, 185, 129, 0.5)', label: 'SAFE' };
    if (score <= 50) return { color: '#22c55e', glow: 'rgba(34, 197, 94, 0.4)', label: 'LOW RISK' };
    if (score <= 70) return { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)', label: 'MEDIUM' };
    return { color: '#ef4444', glow: 'rgba(239, 68, 68, 0.5)', label: 'HIGH RISK' };
  };

  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'SAFE': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-emerald-500/20';
      case 'SUSPICIOUS': return 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-amber-500/20';
      case 'DANGEROUS': return 'bg-orange-500/20 text-orange-400 border-orange-500/50 shadow-orange-500/20';
      default: return 'bg-red-500/20 text-red-400 border-red-500/50 shadow-red-500/20';
    }
  };

  const scoreStyle = result ? getScoreColor(result.riskScore) : null;

  return (
    <div className="space-y-6">
      {/* Search Card */}
      <div className="relative">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl blur opacity-20" />
        <div className="relative bg-[#0a0a12] border border-cyan-500/30 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white font-cyber">Token Analysis</h2>
              <p className="text-xs text-cyan-400/60">AI-Powered Risk Detection</p>
            </div>
          </div>

          <div className="relative">
            <input
              ref={inputRef}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && analyze()}
              placeholder="Paste token address to analyze..."
              className="w-full bg-[#050508] border border-cyan-500/20 rounded-xl px-5 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:shadow-lg focus:shadow-cyan-500/10 font-mono text-sm transition-all"
            />
            <button
              onClick={analyze}
              disabled={loading || !address.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-cyan-500/25"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Analyze
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && scoreStyle && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Main Result Card */}
          <div className="relative">
            <div
              className="absolute -inset-0.5 rounded-2xl blur opacity-30"
              style={{ background: `linear-gradient(135deg, ${scoreStyle.color}, transparent)` }}
            />
            <div className="relative bg-[#0a0a12] border border-white/10 rounded-2xl overflow-hidden">
              {/* Score Header */}
              <div className="p-6 flex items-center gap-6">
                {/* Animated Score Ring */}
                <div className="relative flex-shrink-0">
                  <div
                    className="absolute inset-0 rounded-full blur-xl opacity-50"
                    style={{ background: scoreStyle.glow }}
                  />
                  <svg className="w-28 h-28 -rotate-90 relative">
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      className="text-white/5"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      fill="none"
                      stroke={scoreStyle.color}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${(100 - result.riskScore) * 3.01} 301`}
                      className="transition-all duration-1000 drop-shadow-lg"
                      style={{ filter: `drop-shadow(0 0 8px ${scoreStyle.glow})` }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                      className="text-4xl font-bold tabular-nums font-cyber"
                      style={{ color: scoreStyle.color, textShadow: `0 0 20px ${scoreStyle.glow}` }}
                    >
                      {result.riskScore}
                    </span>
                    <span className="text-[10px] text-gray-400 uppercase tracking-widest">Risk Score</span>
                  </div>
                </div>

                {/* Token Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h2 className="text-2xl font-bold text-white truncate font-cyber">
                      {result.market?.name || 'Unknown Token'}
                    </h2>
                    {result.market?.symbol && (
                      <span className="text-gray-400 text-lg">${result.market.symbol}</span>
                    )}
                    <span className={`px-3 py-1 text-xs font-bold rounded-lg border shadow-lg ${getLevelStyle(result.riskLevel)}`}>
                      {result.riskLevel}
                    </span>
                  </div>

                  <p className="text-gray-400 text-sm mb-4 line-clamp-2">{result.summary}</p>

                  {/* Quick Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={copyAddress}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-cyan-400 bg-white/5 hover:bg-cyan-500/10 rounded-lg transition border border-transparent hover:border-cyan-500/30"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Copied!' : 'Copy Address'}
                    </button>
                    <a
                      href={`https://dexscreener.com/solana/${address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-cyan-400 bg-white/5 hover:bg-cyan-500/10 rounded-lg transition border border-transparent hover:border-cyan-500/30"
                    >
                      <ExternalLink className="w-3 h-3" />
                      DexScreener
                    </a>
                    {result.socials?.twitter && (
                      <a
                        href={result.socials.twitter}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-lg transition border border-cyan-500/30"
                      >
                        Twitter
                      </a>
                    )}
                    {result.socials?.website && (
                      <a
                        href={result.socials.website}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-lg transition border border-cyan-500/30"
                      >
                        Website
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              {result.market && (
                <div className="grid grid-cols-4 border-t border-white/5">
                  <div className="p-4 border-r border-white/5 text-center">
                    <div className="text-xs text-gray-500 mb-1 flex items-center justify-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Market Cap
                    </div>
                    <div className="text-white font-bold text-lg">{formatNumber(result.market.marketCap)}</div>
                  </div>
                  <div className="p-4 border-r border-white/5 text-center">
                    <div className="text-xs text-gray-500 mb-1 flex items-center justify-center gap-1">
                      <Shield className="w-3 h-3" />
                      Liquidity
                    </div>
                    <div className="text-white font-bold text-lg">{formatNumber(result.market.liquidity)}</div>
                  </div>
                  <div className="p-4 border-r border-white/5 text-center">
                    <div className="text-xs text-gray-500 mb-1 flex items-center justify-center gap-1">
                      <Users className="w-3 h-3" />
                      Holders
                    </div>
                    <div className="text-white font-bold text-lg">{result.holders?.totalHolders?.toLocaleString() || '-'}</div>
                  </div>
                  <div className="p-4 text-center">
                    <div className="text-xs text-gray-500 mb-1">Age</div>
                    <div className="text-white font-bold text-lg">
                      {result.market.ageInDays < 1 ? '< 1d' : `${Math.floor(result.market.ageInDays)}d`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Security Badges */}
          <div className="flex flex-wrap gap-2">
            {result.authorities?.mintRevoked !== undefined && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border ${
                result.authorities.mintRevoked
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}>
                {result.authorities.mintRevoked ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                Mint {result.authorities.mintRevoked ? 'Revoked' : 'Active'}
              </div>
            )}
            {result.authorities?.freezeRevoked !== undefined && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border ${
                result.authorities.freezeRevoked
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}>
                {result.authorities.freezeRevoked ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                Freeze {result.authorities.freezeRevoked ? 'Revoked' : 'Active'}
              </div>
            )}
            {result.holders?.top1NonLp !== undefined && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border ${
                result.holders.top1NonLp > 20
                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                  : result.holders.top1NonLp > 10
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}>
                Top Holder: {result.holders.top1NonLp.toFixed(1)}%
              </div>
            )}
            {result.insiders && result.insiders.count > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
                <AlertTriangle className="w-4 h-4" />
                {result.insiders.count} Insider{result.insiders.count > 1 ? 's' : ''} Detected
              </div>
            )}
          </div>

          {/* Risk Flags */}
          {result.flags && result.flags.length > 0 && (
            <div className="bg-[#0a0a12] border border-white/10 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Risk Flags ({result.flags.length})
              </h3>
              <div className="space-y-2">
                {result.flags.map((flag, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-lg text-sm ${
                      flag.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-400 border-l-2 border-red-500' :
                      flag.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400 border-l-2 border-orange-500' :
                      flag.severity === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border-l-2 border-amber-500' :
                      'bg-gray-500/10 text-gray-400 border-l-2 border-gray-500'
                    }`}
                  >
                    <span className="text-[10px] uppercase font-bold tracking-wider opacity-60">{flag.severity}</span>
                    <span className="flex-1">{flag.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creator Warning */}
          {result.creator && result.creator.ruggedTokens > 0 && (
            <div className="relative">
              <div className="absolute -inset-0.5 bg-red-500 rounded-xl blur opacity-20" />
              <div className="relative p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
                <div>
                  <div className="text-red-400 font-bold text-sm mb-1">High Risk Creator Detected</div>
                  <div className="text-red-400/70 text-sm">
                    This creator has <span className="font-bold text-red-400">{result.creator.ruggedTokens}</span> previously rugged token{result.creator.ruggedTokens > 1 ? 's' : ''} out of {result.creator.tokensCreated} created.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Snipe Button */}
          <div className="relative">
            {canSnipe && (
              <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-green-600 rounded-xl blur opacity-40 animate-pulse" />
            )}
            <button
              onClick={() => canSnipe && onSnipe(address.trim())}
              disabled={!canSnipe}
              className={`relative w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all ${
                canSnipe
                  ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white shadow-xl shadow-emerald-500/30'
                  : 'bg-[#0a0a12] border border-white/10 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Zap className={`w-6 h-6 ${canSnipe ? 'animate-pulse' : ''}`} />
              {canSnipe ? 'Execute Snipe' : `Risk Score Exceeds ${maxRiskScore}`}
              {canSnipe && <Sparkles className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!result && !loading && !error && (
        <div className="text-center py-16">
          <div className="relative inline-block">
            <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl blur-xl opacity-20 animate-pulse" />
            <div className="relative w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center border border-cyan-500/30">
              <Shield className="w-10 h-10 text-cyan-400" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-white mb-2 font-cyber">Ready to Analyze</h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            Paste a Solana token address above to get an instant AI-powered risk analysis before you snipe.
          </p>
        </div>
      )}
    </div>
  );
}
