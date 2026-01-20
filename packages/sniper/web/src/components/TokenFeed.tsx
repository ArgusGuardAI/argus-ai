import { Activity, CheckCircle, XCircle, Loader, Target, AlertTriangle, ExternalLink } from 'lucide-react';
import type { TokenEvent } from '../types';

interface TokenFeedProps {
  tokens: TokenEvent[];
  onSelect?: (address: string) => void;
}

function getStatusIcon(status?: TokenEvent['status']) {
  switch (status) {
    case 'analyzing':
      return <Loader className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
    case 'sniping':
      return <Target className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />;
    case 'sniped':
      return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
    case 'skipped':
      return <XCircle className="w-3.5 h-3.5 text-gray-500" />;
    case 'failed':
      return <AlertTriangle className="w-3.5 h-3.5 text-red-400" />;
    default:
      return <Activity className="w-3.5 h-3.5 text-gray-500" />;
  }
}

function getRiskColor(score?: number) {
  if (score === undefined) return 'bg-gray-500/10 text-gray-400';
  if (score < 40) return 'bg-emerald-500/10 text-emerald-400';
  if (score < 70) return 'bg-amber-500/10 text-amber-400';
  return 'bg-red-500/10 text-red-400';
}

function formatTime(timestamp: number) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function TokenFeed({ tokens, onSelect }: TokenFeedProps) {
  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div>
            <h2 className="font-semibold text-sm gradient-text font-cyber">LIVE FEED</h2>
          </div>
        </div>
        <span className="text-xs text-cyan-400 px-2 py-1 bg-cyan-500/10 rounded-lg border border-cyan-500/20">{tokens.length}</span>
      </div>

      {/* Token List */}
      <div className="max-h-[500px] overflow-y-auto">
        {tokens.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/5 flex items-center justify-center">
              <Activity className="w-6 h-6 text-gray-600" />
            </div>
            <p className="text-gray-400 font-medium">Waiting for tokens</p>
            <p className="text-xs mt-1 text-gray-600">New tokens will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {tokens.map((token) => (
              <div
                key={`${token.address}-${token.timestamp}`}
                onClick={() => onSelect?.(token.address)}
                className="px-4 py-3 hover:bg-white/[0.02] transition cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(token.status)}
                    <span className="font-medium text-white text-sm">{token.symbol}</span>
                    <span className="text-xs text-gray-600 truncate max-w-[80px]">{token.name}</span>
                  </div>
                  <span className="text-xs text-gray-600">{formatTime(token.timestamp)}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-cyan-400">{token.source}</span>
                    <a
                      href={`https://solscan.io/token/${token.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-gray-500 hover:text-cyan-400 transition flex items-center gap-1"
                    >
                      {token.address.slice(0, 6)}...
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                    </a>
                  </div>

                  {token.riskScore !== undefined && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getRiskColor(token.riskScore)}`}>
                      {token.riskScore}
                    </span>
                  )}
                </div>

                {token.reason && (
                  <p className="text-xs text-gray-600 mt-1 truncate">{token.reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
