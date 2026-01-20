import { Wallet, TrendingUp, TrendingDown, ExternalLink, Clock } from 'lucide-react';
import type { Position } from '../types';

interface PositionsProps {
  positions: Position[];
  onSell: (tokenAddress: string) => void;
}

function formatTime(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function Positions({ positions, onSell }: PositionsProps) {
  const totalValue = positions.reduce((sum, p) => sum + p.currentValueSol, 0);
  const totalPnl = positions.reduce((sum, p) => sum + p.pnlSol, 0);
  const totalPnlPercent = totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;

  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="font-semibold text-sm gradient-text font-cyber">OPEN POSITIONS</h2>
            <p className="text-xs text-gray-500">{positions.length} active</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-gray-500">Total Value</p>
            <p className="text-white font-medium tabular-nums">{totalValue.toFixed(4)} SOL</p>
          </div>
          <div className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            totalPnl >= 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnlPercent.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Positions List */}
      <div className="max-h-[400px] overflow-y-auto">
        {positions.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/5 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-gray-600" />
            </div>
            <p className="text-gray-400 font-medium">No open positions</p>
            <p className="text-xs mt-1 text-gray-600">Sniped tokens will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {positions.map((position) => {
              const isProfit = position.pnlPercent >= 0;

              return (
                <div key={position.tokenAddress} className="p-4 hover:bg-white/[0.02] transition">
                  {/* Token Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{position.tokenSymbol}</span>
                      <a
                        href={`https://solscan.io/token/${position.tokenAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-cyan-400 transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        {formatTime(position.entryTime)}
                      </span>
                    </div>

                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-medium ${
                      isProfit
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-red-500/10 text-red-400'
                    }`}>
                      {isProfit ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      {isProfit ? '+' : ''}{position.pnlPercent.toFixed(1)}%
                    </div>
                  </div>

                  {/* Stats Row */}
                  <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                    <div className="bg-white/[0.02] rounded-lg p-2">
                      <p className="text-gray-500 text-xs mb-0.5">Entry</p>
                      <p className="text-white font-mono text-xs">{position.entryPrice.toFixed(8)}</p>
                    </div>
                    <div className="bg-white/[0.02] rounded-lg p-2">
                      <p className="text-gray-500 text-xs mb-0.5">Current</p>
                      <p className="text-white font-mono text-xs">{position.currentPrice.toFixed(8)}</p>
                    </div>
                    <div className="bg-white/[0.02] rounded-lg p-2">
                      <p className="text-gray-500 text-xs mb-0.5">Value</p>
                      <p className="text-white font-mono text-xs">{position.currentValueSol.toFixed(4)} SOL</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => onSell(position.tokenAddress)}
                      className="flex-1 py-2 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition border border-red-500/20 hover:border-red-500/30"
                    >
                      Sell All
                    </button>
                    <a
                      href={`https://pump.fun/coin/${position.tokenAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 px-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-sm transition"
                    >
                      View
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
