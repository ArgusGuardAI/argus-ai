import { Eye, Target, XCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface StatsProps {
  stats: {
    tokensScanned: number;
    tokensSniped: number;
    tokensSkipped: number;
    totalPnlSol: number;
  };
}

export function Stats({ stats }: StatsProps) {
  const isProfit = stats.totalPnlSol >= 0;

  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
      <div className="grid grid-cols-4 gap-3">
        {/* Scanned */}
        <div className="text-center p-3 rounded-xl bg-white/[0.02]">
          <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <Eye className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-lg font-bold text-white tabular-nums">{stats.tokensScanned}</p>
          <p className="text-xs text-gray-500">Scanned</p>
        </div>

        {/* Sniped */}
        <div className="text-center p-3 rounded-xl bg-white/[0.02]">
          <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Target className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-lg font-bold text-white tabular-nums">{stats.tokensSniped}</p>
          <p className="text-xs text-gray-500">Sniped</p>
        </div>

        {/* Skipped */}
        <div className="text-center p-3 rounded-xl bg-white/[0.02]">
          <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-gray-500/10 flex items-center justify-center">
            <XCircle className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-lg font-bold text-white tabular-nums">{stats.tokensSkipped}</p>
          <p className="text-xs text-gray-500">Skipped</p>
        </div>

        {/* PnL */}
        <div className="text-center p-3 rounded-xl bg-white/[0.02]">
          <div className={`w-8 h-8 mx-auto mb-2 rounded-lg flex items-center justify-center ${
            isProfit ? 'bg-emerald-500/10' : 'bg-red-500/10'
          }`}>
            {isProfit ? (
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
          </div>
          <p className={`text-lg font-bold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
            {isProfit ? '+' : ''}{stats.totalPnlSol.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500">PnL SOL</p>
        </div>
      </div>
    </div>
  );
}
