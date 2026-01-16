import { useState } from 'react';
import { Search, Loader2, CheckCircle, XCircle, Zap } from 'lucide-react';

interface AnalysisResult {
  riskScore: number;
  riskLevel: string;
  summary: string;
  flags: { message: string; severity: string }[];
  market?: {
    name: string;
    symbol: string;
    priceUsd: number;
    marketCap: number;
    liquidity: number;
  };
}

interface ManualSnipeProps {
  onSnipe: (tokenAddress: string) => void;
  maxRiskScore: number;
  isWatchOnly: boolean;
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
    <div className="bg-dark-800/50 cyber-border rounded-xl p-5 card-hover">
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
          {/* Token Info */}
          {result.market ? (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-white font-medium text-lg">{result.market.name || 'Unknown'}</span>
                <span className="text-gray-500 ml-2">${result.market.symbol || '???'}</span>
              </div>
              <div className="text-right text-sm">
                <div className="text-gray-400">
                  MC: <span className="text-white">
                    {result.market.marketCap
                      ? `$${(result.market.marketCap / 1000).toFixed(1)}K`
                      : 'N/A'}
                  </span>
                </div>
                <div className="text-gray-400">
                  Liq: <span className="text-white">
                    {result.market.liquidity
                      ? `$${(result.market.liquidity / 1000).toFixed(1)}K`
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-sm">
              Market data not available
            </div>
          )}

          {/* Risk Score */}
          <div className={`p-4 rounded-lg border ${
            isSafe
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {isSafe ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <span className={`font-medium ${isSafe ? 'text-green-400' : 'text-red-400'}`}>
                  Risk Score: {result.riskScore}
                </span>
              </div>
              <span className={`text-sm px-2 py-1 rounded ${
                result.riskLevel === 'SAFE' ? 'bg-green-500/20 text-green-400' :
                result.riskLevel === 'SUSPICIOUS' ? 'bg-yellow-500/20 text-yellow-400' :
                result.riskLevel === 'DANGEROUS' ? 'bg-orange-500/20 text-orange-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {result.riskLevel}
              </span>
            </div>
            <p className="text-gray-400 text-sm">{result.summary}</p>
          </div>

          {/* Flags */}
          {result.flags && result.flags.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Risk Flags</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {result.flags.slice(0, 5).map((flag, i) => (
                  <div key={i} className={`text-xs px-2 py-1 rounded ${
                    flag.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-400' :
                    flag.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400' :
                    flag.severity === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>
                    {flag.message}
                  </div>
                ))}
              </div>
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
