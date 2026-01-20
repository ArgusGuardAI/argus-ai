import { useState } from 'react';
import { Search, Loader2, Zap, ExternalLink, AlertTriangle } from 'lucide-react';

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

interface ManualSnipeProps {
  onSnipe: (tokenAddress: string) => void;
  maxRiskScore: number;
  isWatchOnly: boolean;
}

function formatNum(n: number): string {
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function ManualSnipe({ onSnipe, maxRiskScore, isWatchOnly }: ManualSnipeProps) {
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!addr.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: addr.trim() }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const canSnipe = result && result.riskScore <= maxRiskScore && !isWatchOnly;

  const scoreColor = (s: number) => s < 40 ? '#00ff88' : s < 70 ? '#ffa500' : '#ff4444';
  const levelBg = (l: string) =>
    l === 'SAFE' ? 'bg-green-500/20 text-green-400' :
    l === 'SUSPICIOUS' ? 'bg-yellow-500/20 text-yellow-400' :
    l === 'DANGEROUS' ? 'bg-orange-500/20 text-orange-400' :
    'bg-red-500/20 text-red-400';

  return (
    <div className="bg-dark-800/50 cyber-border rounded-xl p-4">
      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input
          value={addr}
          onChange={e => setAddr(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && analyze()}
          placeholder="Token address..."
          className="flex-1 bg-dark-900 border border-gray-700/50 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-cyber-blue/50 font-mono text-sm"
        />
        <button
          onClick={analyze}
          disabled={loading || !addr.trim()}
          className="px-4 py-2.5 bg-cyber-blue/20 hover:bg-cyber-blue/30 text-cyber-blue rounded-lg font-medium transition border border-cyber-blue/30 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Header Row: Score + Token Info */}
          <div className="flex items-center gap-4">
            {/* Score Circle */}
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: `conic-gradient(${scoreColor(result.riskScore)} ${result.riskScore * 3.6}deg, #1a1a28 0deg)`,
                boxShadow: `0 0 20px ${scoreColor(result.riskScore)}40`
              }}
            >
              <div className="w-16 h-16 rounded-full bg-dark-900 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold" style={{ color: scoreColor(result.riskScore) }}>{result.riskScore}</span>
              </div>
            </div>

            {/* Token Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-semibold text-white truncate">
                  {result.market?.name || 'Unknown'}
                </span>
                {result.market?.symbol && (
                  <span className="text-gray-500 text-sm">${result.market.symbol}</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${levelBg(result.riskLevel)}`}>
                  {result.riskLevel}
                </span>
              </div>
              <p className="text-gray-400 text-sm line-clamp-2">{result.summary}</p>
            </div>

            {/* Quick Links */}
            <div className="flex gap-1">
              <a href={`https://dexscreener.com/solana/${addr}`} target="_blank" rel="noreferrer"
                className="p-2 text-gray-500 hover:text-cyber-blue hover:bg-dark-700 rounded transition">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Risk Score Bar */}
          <div className="relative h-2 rounded-full overflow-hidden bg-dark-700">
            <div className="absolute inset-0 risk-bar opacity-30" />
            <div
              className="absolute left-0 top-0 h-full transition-all duration-500"
              style={{
                width: `${result.riskScore}%`,
                background: `linear-gradient(90deg, #00ff88, ${scoreColor(result.riskScore)})`,
                boxShadow: `0 0 10px ${scoreColor(result.riskScore)}60`
              }}
            />
            {/* Threshold marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-white/50"
              style={{ left: `${maxRiskScore}%` }}
              title={`Max risk: ${maxRiskScore}`}
            />
          </div>

          {/* Stats Row - Only show if we have data */}
          {(result.market?.marketCap || result.market?.liquidity || result.holders?.totalHolders) && (
            <div className="flex gap-4 text-sm border-t border-b border-gray-800/50 py-2">
              {result.market?.marketCap && (
                <div><span className="text-gray-500">MC:</span> <span className="text-white">{formatNum(result.market.marketCap)}</span></div>
              )}
              {result.market?.liquidity && (
                <div><span className="text-gray-500">Liq:</span> <span className="text-white">{formatNum(result.market.liquidity)}</span></div>
              )}
              {result.holders?.totalHolders && (
                <div><span className="text-gray-500">Holders:</span> <span className="text-white">{result.holders.totalHolders.toLocaleString()}</span></div>
              )}
              {result.market?.ageInDays !== undefined && (
                <div><span className="text-gray-500">Age:</span> <span className="text-white">{result.market.ageInDays < 1 ? '<1d' : `${result.market.ageInDays.toFixed(0)}d`}</span></div>
              )}
            </div>
          )}

          {/* Quick Status Pills */}
          <div className="flex flex-wrap gap-2">
            {result.authorities?.mintRevoked !== undefined && (
              <span className={`text-xs px-2 py-1 rounded ${result.authorities.mintRevoked ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                Mint {result.authorities.mintRevoked ? '✓' : '✗'}
              </span>
            )}
            {result.authorities?.freezeRevoked !== undefined && (
              <span className={`text-xs px-2 py-1 rounded ${result.authorities.freezeRevoked ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                Freeze {result.authorities.freezeRevoked ? '✓' : '✗'}
              </span>
            )}
            {result.holders?.top1NonLp !== undefined && (
              <span className={`text-xs px-2 py-1 rounded ${result.holders.top1NonLp > 20 ? 'bg-red-500/10 text-red-400' : result.holders.top1NonLp > 10 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'}`}>
                Top: {result.holders.top1NonLp.toFixed(1)}%
              </span>
            )}
            {result.insiders && result.insiders.count > 0 && (
              <span className="text-xs px-2 py-1 rounded bg-yellow-500/10 text-yellow-400">
                {result.insiders.count} insiders
              </span>
            )}
            {result.socials?.twitter && (
              <a href={result.socials.twitter} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded bg-cyber-blue/10 text-cyber-blue hover:bg-cyber-blue/20">
                Twitter
              </a>
            )}
            {result.socials?.website && (
              <a href={result.socials.website} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded bg-cyber-blue/10 text-cyber-blue hover:bg-cyber-blue/20">
                Website
              </a>
            )}
          </div>

          {/* Flags - Compact */}
          {result.flags && result.flags.length > 0 && (
            <div className="space-y-1">
              {result.flags.slice(0, 4).map((flag, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs py-1.5 px-2 rounded ${
                  flag.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-400' :
                  flag.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400' :
                  flag.severity === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400' :
                  'bg-gray-500/10 text-gray-400'
                }`}>
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{flag.message}</span>
                </div>
              ))}
              {result.flags.length > 4 && (
                <div className="text-xs text-gray-500 pl-2">+{result.flags.length - 4} more flags</div>
              )}
            </div>
          )}

          {/* Creator - Minimal */}
          {result.creator && result.creator.ruggedTokens > 0 && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5">
              ⚠ Creator has {result.creator.ruggedTokens} rugged token{result.creator.ruggedTokens > 1 ? 's' : ''}
            </div>
          )}

          {/* Action */}
          <button
            onClick={() => canSnipe && onSnipe(addr.trim())}
            disabled={!canSnipe}
            className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition ${
              canSnipe
                ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                : 'bg-gray-800/50 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Zap className="w-4 h-4" />
            {isWatchOnly ? 'Watch-Only Mode' : canSnipe ? 'Snipe' : `Risk > ${maxRiskScore}`}
          </button>
        </div>
      )}
    </div>
  );
}
