import { Wallet, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
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

  return (
    <div className="bg-dark-800/50 cyber-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-cyber-blue/20 flex items-center justify-between">
        <h2 className="font-cyber font-semibold gradient-text flex items-center gap-2">
          <Wallet className="w-5 h-5 text-cyber-blue" />
          Open Positions
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-400">
            Value: <span className="text-white font-medium">{totalValue.toFixed(4)} SOL</span>
          </span>
          <span className={`font-medium ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {positions.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Wallet className="w-10 h-10 mx-auto mb-3 opacity-30 text-cyber-blue" />
            <p className="font-medium">No open positions</p>
            <p className="text-xs mt-1 text-gray-600">Sniped tokens will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-700">
            {positions.map((position) => {
              const isProfit = position.pnlPercent >= 0;
              const pnlColor = isProfit ? 'text-green-400' : 'text-red-400';
              const pnlBg = isProfit ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20';

              return (
                <div key={position.tokenAddress} className="p-5 hover:bg-dark-700/30 transition-colors">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white text-lg">
                          {position.tokenSymbol}
                        </span>
                        <a
                          href={`https://solscan.io/token/${position.tokenAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-cyber-blue transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Held for {formatTime(position.entryTime)}
                      </p>
                    </div>

                    <div className={`px-3 py-1.5 rounded-lg ${pnlBg} border flex items-center gap-1`}>
                      {isProfit ? (
                        <TrendingUp className={`w-4 h-4 ${pnlColor}`} />
                      ) : (
                        <TrendingDown className={`w-4 h-4 ${pnlColor}`} />
                      )}
                      <span className={`font-medium ${pnlColor}`}>
                        {isProfit ? '+' : ''}{position.pnlPercent.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Entry</p>
                      <p className="text-white font-mono">{position.entryPrice.toFixed(8)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Current</p>
                      <p className="text-white font-mono">{position.currentPrice.toFixed(8)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Value</p>
                      <p className="text-white font-mono">{position.currentValueSol.toFixed(4)} SOL</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => onSell(position.tokenAddress)}
                      className="flex-1 py-2 px-4 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-all border border-red-500/30 hover:border-red-500/50"
                    >
                      Sell All
                    </button>
                    <a
                      href={`https://pump.fun/coin/${position.tokenAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 px-4 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg text-sm transition-colors border border-gray-700/50"
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
