import { Eye, Target, XCircle, TrendingUp } from 'lucide-react';

interface StatsProps {
  stats: {
    tokensScanned: number;
    tokensSniped: number;
    tokensSkipped: number;
    totalPnlSol: number;
  };
}

export function Stats({ stats }: StatsProps) {
  const pnlColor = stats.totalPnlSol >= 0 ? 'text-green-400' : 'text-red-400';
  const pnlBg = stats.totalPnlSol >= 0 ? 'bg-green-500/10' : 'bg-red-500/10';

  return (
    <div className="bg-dark-800/50 cyber-border rounded-xl p-5 card-hover">
      <h3 className="text-sm font-cyber font-medium text-cyber-blue mb-4">Session Stats</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyber-blue/10 flex items-center justify-center border border-cyber-blue/20">
            <Eye className="w-5 h-5 text-cyber-blue" />
          </div>
          <div>
            <p className="text-xl font-bold text-white">{stats.tokensScanned}</p>
            <p className="text-xs text-gray-500">Scanned</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center border border-green-500/20">
            <Target className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-white">{stats.tokensSniped}</p>
            <p className="text-xs text-gray-500">Sniped</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-500/10 flex items-center justify-center border border-gray-500/20">
            <XCircle className="w-5 h-5 text-gray-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-white">{stats.tokensSkipped}</p>
            <p className="text-xs text-gray-500">Skipped</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${pnlBg} flex items-center justify-center border ${stats.totalPnlSol >= 0 ? 'border-green-500/20' : 'border-red-500/20'}`}>
            <TrendingUp className={`w-5 h-5 ${pnlColor}`} />
          </div>
          <div>
            <p className={`text-xl font-bold ${pnlColor}`}>
              {stats.totalPnlSol >= 0 ? '+' : ''}{stats.totalPnlSol.toFixed(4)}
            </p>
            <p className="text-xs text-gray-500">PnL (SOL)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
