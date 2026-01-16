import { Activity, CheckCircle, XCircle, Loader, Target, AlertTriangle } from 'lucide-react';
import type { TokenEvent } from '../types';

interface TokenFeedProps {
  tokens: TokenEvent[];
}

function getStatusIcon(status?: TokenEvent['status']) {
  switch (status) {
    case 'analyzing':
      return <Loader className="w-4 h-4 text-yellow-400 animate-spin" />;
    case 'sniping':
      return <Target className="w-4 h-4 text-cyber-blue animate-pulse" />;
    case 'sniped':
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    case 'skipped':
      return <XCircle className="w-4 h-4 text-gray-500" />;
    case 'failed':
      return <AlertTriangle className="w-4 h-4 text-red-400" />;
    default:
      return <Activity className="w-4 h-4 text-gray-400" />;
  }
}

function getStatusBg(status?: TokenEvent['status']) {
  switch (status) {
    case 'sniped':
      return 'bg-green-500/5 border-l-2 border-l-green-500';
    case 'sniping':
      return 'bg-cyber-blue/5 border-l-2 border-l-cyber-blue';
    case 'failed':
      return 'bg-red-500/5 border-l-2 border-l-red-500';
    default:
      return 'bg-dark-800/30 border-l-2 border-l-transparent';
  }
}

function getRiskColor(score?: number) {
  if (score === undefined) return 'text-gray-500';
  if (score < 40) return 'text-green-400';
  if (score < 70) return 'text-yellow-400';
  return 'text-red-400';
}

function formatTime(timestamp: number) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function TokenFeed({ tokens }: TokenFeedProps) {
  return (
    <div className="bg-dark-800/50 cyber-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-cyber-blue/20 flex items-center justify-between">
        <h2 className="font-cyber font-semibold gradient-text flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyber-blue" />
          Token Feed
        </h2>
        <span className="text-xs text-gray-500 px-2 py-1 bg-dark-700 rounded">{tokens.length} tokens</span>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {tokens.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-30 text-cyber-blue" />
            <p className="font-medium">Waiting for new tokens...</p>
            <p className="text-xs mt-1 text-gray-600">Tokens will appear here when detected</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-700">
            {tokens.map((token) => (
              <div
                key={`${token.address}-${token.timestamp}`}
                className={`p-4 ${getStatusBg(token.status)} slide-in token-card`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(token.status)}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{token.symbol}</span>
                        <span className="text-xs text-gray-500 truncate max-w-[100px]">
                          {token.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        <span className="text-cyber-blue">{token.source}</span>
                        <span className="text-gray-600">•</span>
                        <a
                          href={`https://solscan.io/token/${token.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-cyber-blue truncate max-w-[80px] transition-colors"
                        >
                          {token.address.slice(0, 8)}...
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      {token.riskScore !== undefined && (
                        <span className={`text-sm font-medium ${getRiskColor(token.riskScore)}`}>
                          {token.riskScore}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">{formatTime(token.timestamp)}</span>
                    </div>
                    {token.reason && (
                      <p className="text-xs text-gray-500 mt-1 max-w-[150px] truncate">
                        {token.reason}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
