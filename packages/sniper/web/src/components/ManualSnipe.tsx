import { useState } from 'react';
import { Search, Loader2, CheckCircle, XCircle, Zap, ExternalLink, Shield, Users, Clock, TrendingUp, Wallet } from 'lucide-react';

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
  return `${num.toFixed(2)}%`;
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

  return (
    <div className="bg-dark-800/50 cyber-border rounded-xl p-5">
      <h3 className="text-sm font-cyber font-medium text-cyber-blue mb-4">Manual Token Analysis</h3>

      {/* Input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
          placeholder="Paste token address..."
          className="flex-1 bg-dark-900 border border-gray-700/50 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyber-blue/50 font-mono text-sm"
        />
        <button
          onClick={handleAnalyze}
          disabled={loading || !tokenAddress.trim()}
          className="flex items-center gap-2 px-5 py-3 bg-cyber-blue/20 hover:bg-cyber-blue/30 text-cyber-blue rounded-lg font-medium transition-all border border-cyber-blue/30 hover:border-cyber-blue/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Search className="w-5 h-5" />
          )}
          Analyze
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Token Header */}
          <div className="flex items-center justify-between border-b border-gray-700/50 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium text-xl">{result.market?.name || 'Unknown'}</span>
                <span className="text-gray-500">${result.market?.symbol || '???'}</span>
                {result.market?.dex && (
                  <span className="text-xs px-2 py-0.5 rounded bg-cyber-blue/20 text-cyber-blue">
                    {result.market.dex}
                  </span>
                )}
              </div>
              {result.market?.ageInDays !== undefined && (
                <div className="flex items-center gap-1 text-gray-500 text-xs mt-1">
                  <Clock className="w-3 h-3" />
                  {result.market.ageInDays < 1 ? 'Less than 1 day old' : `${result.market.ageInDays.toFixed(1)} days old`}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <a
                href={`https://solscan.io/token/${tokenAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-cyber-blue transition p-2"
                title="View on Solscan"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
              <a
                href={`https://dexscreener.com/solana/${tokenAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-cyber-blue transition p-2"
                title="View on DexScreener"
              >
                <TrendingUp className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Risk Score - Large */}
          <div className={`p-4 rounded-lg border ${
            isSafe
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                {isSafe ? (
                  <CheckCircle className="w-8 h-8 text-green-400" />
                ) : (
                  <XCircle className="w-8 h-8 text-red-400" />
                )}
                <div>
                  <span className={`text-3xl font-bold ${isSafe ? 'text-green-400' : 'text-red-400'}`}>
                    {result.riskScore}
                  </span>
                  <span className="text-gray-500 text-sm ml-2">/ 100</span>
                </div>
              </div>
              <span className={`text-sm px-3 py-1.5 rounded font-medium ${
                result.riskLevel === 'SAFE' ? 'bg-green-500/20 text-green-400' :
                result.riskLevel === 'SUSPICIOUS' ? 'bg-yellow-500/20 text-yellow-400' :
                result.riskLevel === 'DANGEROUS' ? 'bg-orange-500/20 text-orange-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {result.riskLevel}
              </span>
            </div>
            <p className="text-gray-300 text-sm">{result.summary}</p>

            {/* Risk Bar */}
            <div className="mt-3">
              <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${result.riskScore}%`,
                    background: result.riskScore < 40
                      ? 'linear-gradient(90deg, #00d4ff, #00ff88)'
                      : result.riskScore < 70
                        ? 'linear-gradient(90deg, #00ff88, #ffcc00)'
                        : 'linear-gradient(90deg, #ffcc00, #ff4444)'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Market Stats Grid */}
          {result.market && (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-dark-900/50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">Market Cap</p>
                <p className="text-white font-medium">{result.market.marketCap ? formatNumber(result.market.marketCap) : 'N/A'}</p>
              </div>
              <div className="bg-dark-900/50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">Liquidity</p>
                <p className="text-white font-medium">{result.market.liquidity ? formatNumber(result.market.liquidity) : 'N/A'}</p>
              </div>
              <div className="bg-dark-900/50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">24h Volume</p>
                <p className="text-white font-medium">{result.market.volume24h ? formatNumber(result.market.volume24h) : 'N/A'}</p>
              </div>
              <div className="bg-dark-900/50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">24h Change</p>
                <p className={`font-medium ${result.market.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {result.market.priceChange24h ? `${result.market.priceChange24h >= 0 ? '+' : ''}${result.market.priceChange24h.toFixed(1)}%` : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {/* Holder Info */}
          {result.holders && (
            <div className="bg-dark-900/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-cyber-blue" />
                <span className="text-sm font-medium text-white">Holder Distribution</span>
                {result.holders.totalHolders && (
                  <span className="text-xs text-gray-500 ml-auto">{result.holders.totalHolders.toLocaleString()} holders</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Top Holder (Non-LP):</span>
                  <span className={`ml-2 font-medium ${result.holders.top1NonLp > 20 ? 'text-red-400' : result.holders.top1NonLp > 10 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {formatPercent(result.holders.top1NonLp)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Top 10 (Non-LP):</span>
                  <span className={`ml-2 font-medium ${result.holders.top10NonLp > 60 ? 'text-red-400' : result.holders.top10NonLp > 40 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {formatPercent(result.holders.top10NonLp)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Dev & Insiders Row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Dev Status */}
            {result.devSelling && (
              <div className="bg-dark-900/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-cyber-blue" />
                  <span className="text-sm font-medium text-white">Dev Wallet</span>
                </div>
                <p className={`text-sm ${result.devSelling.hasSold ? 'text-yellow-400' : 'text-green-400'}`}>
                  {result.devSelling.message || (result.devSelling.hasSold ? `Sold ${result.devSelling.percentSold?.toFixed(1)}%` : 'Holding')}
                </p>
                {result.devSelling.currentHoldingsPercent !== undefined && (
                  <p className="text-xs text-gray-500 mt-1">
                    Currently holds: {formatPercent(result.devSelling.currentHoldingsPercent)}
                  </p>
                )}
              </div>
            )}

            {/* Insiders */}
            {result.insiders && (
              <div className="bg-dark-900/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-cyber-blue" />
                  <span className="text-sm font-medium text-white">Insiders/Snipers</span>
                </div>
                <p className={`text-sm ${result.insiders.highRiskCount > 0 ? 'text-red-400' : result.insiders.count > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {result.insiders.count === 0 ? 'None detected' : `${result.insiders.count} found (${result.insiders.highRiskCount} high risk)`}
                </p>
                {result.insiders.totalHoldingsPercent > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Total holdings: {formatPercent(result.insiders.totalHoldingsPercent)}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Security Badges */}
          <div className="flex flex-wrap gap-2">
            {result.authorities?.mintRevoked && (
              <span className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                Mint Revoked
              </span>
            )}
            {result.authorities?.freezeRevoked && (
              <span className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                Freeze Revoked
              </span>
            )}
            {!result.authorities?.mintRevoked && (
              <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                Mint Active
              </span>
            )}
            {!result.authorities?.freezeRevoked && (
              <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                Freeze Active
              </span>
            )}
            {result.socials?.twitter && (
              <a href={result.socials.twitter} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 rounded bg-cyber-blue/20 text-cyber-blue border border-cyber-blue/30 hover:bg-cyber-blue/30 transition">
                Twitter
              </a>
            )}
            {result.socials?.website && (
              <a href={result.socials.website} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 rounded bg-cyber-blue/20 text-cyber-blue border border-cyber-blue/30 hover:bg-cyber-blue/30 transition">
                Website
              </a>
            )}
          </div>

          {/* All Flags */}
          {result.flags && result.flags.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">All Risk Flags ({result.flags.length})</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {result.flags.map((flag, i) => (
                  <div key={i} className={`text-xs px-3 py-2 rounded flex items-center gap-2 ${
                    flag.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-400 border-l-2 border-red-500' :
                    flag.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400 border-l-2 border-orange-500' :
                    flag.severity === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400 border-l-2 border-yellow-500' :
                    'bg-gray-500/10 text-gray-400 border-l-2 border-gray-500'
                  }`}>
                    <span className="font-medium text-[10px] uppercase opacity-60">{flag.type}</span>
                    <span>{flag.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creator Info */}
          {result.creator && (
            <div className="text-xs text-gray-500 border-t border-gray-700/50 pt-3">
              <span>Creator: </span>
              <a
                href={`https://solscan.io/account/${result.creator.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyber-blue hover:underline font-mono"
              >
                {result.creator.address.slice(0, 8)}...{result.creator.address.slice(-6)}
              </a>
              {result.creator.tokensCreated > 1 && (
                <span className={result.creator.ruggedTokens > 0 ? 'text-red-400' : 'text-gray-400'}>
                  {' '}({result.creator.tokensCreated} tokens created{result.creator.ruggedTokens > 0 ? `, ${result.creator.ruggedTokens} rugged` : ''})
                </span>
              )}
            </div>
          )}

          {/* Snipe Button */}
          <button
            onClick={handleSnipe}
            disabled={!canSnipe}
            className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
              canSnipe
                ? 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 hover:border-green-500/50'
                : 'bg-gray-700/20 text-gray-500 border border-gray-700/30 cursor-not-allowed'
            }`}
          >
            <Zap className="w-5 h-5" />
            {isWatchOnly
              ? 'Watch-Only Mode (No Trading)'
              : canSnipe
                ? 'Snipe This Token'
                : `Risk Too High (max ${maxRiskScore})`
            }
          </button>
        </div>
      )}
    </div>
  );
}
