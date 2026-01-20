import type { AnalysisResult, RiskFlag, HolderDistribution } from '../types';

interface Props {
  result: AnalysisResult;
}

const holderTypeColors: Record<HolderDistribution['type'], string> = {
  creator: '#ff9500',
  whale: '#ff4444',
  insider: '#ff6b6b',
  lp: '#3b82f6',
  normal: '#71717a',
};

const riskColors = {
  SAFE: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400' },
  SUSPICIOUS: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
  DANGEROUS: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
  SCAM: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' },
};

const severityColors = {
  LOW: 'text-zinc-400 bg-zinc-500/10',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10',
  HIGH: 'text-orange-400 bg-orange-500/10',
  CRITICAL: 'text-red-400 bg-red-500/10',
};

function RiskMeter({ score }: { score: number }) {
  const rotation = (score / 100) * 180 - 90;

  return (
    <div className="relative w-32 h-16 mx-auto">
      {/* Gauge background */}
      <svg viewBox="0 0 100 50" className="w-full h-full">
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        {/* Background arc */}
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke="#1e1e2e"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Colored arc */}
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke="url(#gaugeGradient)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Needle */}
        <g transform={`rotate(${rotation}, 50, 50)`}>
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="18"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="50" cy="50" r="4" fill="white" />
        </g>
      </svg>
      {/* Score text */}
      <div className="absolute inset-x-0 -bottom-1 text-center">
        <span className="text-2xl font-bold text-white">{score}</span>
        <span className="text-xs text-zinc-500">/100</span>
      </div>
    </div>
  );
}

function FlagItem({ flag }: { flag: RiskFlag }) {
  return (
    <div className={`px-3 py-2 rounded-lg ${severityColors[flag.severity]} border border-current/20`}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="font-semibold">{flag.type}</span>
        <span className="opacity-60">{flag.severity}</span>
      </div>
      <p className="text-sm opacity-90">{flag.message}</p>
    </div>
  );
}

function HolderChart({ holders }: { holders: HolderDistribution[] }) {
  const maxPercent = Math.max(...holders.map(h => h.percent), 1);

  return (
    <div className="space-y-2">
      {holders.map((holder, i) => (
        <div key={holder.address} className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-4">{i + 1}</span>
          <div className="flex-1 h-5 bg-sentinel-bg rounded overflow-hidden relative">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${(holder.percent / maxPercent) * 100}%`,
                backgroundColor: holderTypeColors[holder.type],
                opacity: 0.7,
              }}
            />
            <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-white font-mono">
              {holder.address.slice(0, 4)}...{holder.address.slice(-4)}
            </span>
          </div>
          <span className={`text-xs font-semibold w-14 text-right ${
            holder.percent > 10 ? 'text-red-400' :
            holder.percent > 5 ? 'text-yellow-400' : 'text-zinc-400'
          }`}>
            {holder.percent.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function PriceChange({ change }: { change: number }) {
  const isPositive = change >= 0;
  return (
    <span className={`flex items-center gap-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
      <i className={`fa-solid ${isPositive ? 'fa-caret-up' : 'fa-caret-down'}`}></i>
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

function BundleBadge({ count, description }: { count: number; description?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
      <i className="fa-solid fa-cubes-stacked text-red-400"></i>
      <div>
        <p className="text-sm font-semibold text-red-400">Bundle Detected</p>
        <p className="text-xs text-zinc-400">{description || `${count} suspicious wallets`}</p>
      </div>
    </div>
  );
}

export function AnalysisPanel({ result }: Props) {
  const { tokenInfo, analysis, creatorInfo, holderDistribution, bundleInfo } = result;
  const colors = riskColors[analysis.riskLevel];

  return (
    <>
      {/* Token Info */}
      <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-white text-lg">
              {tokenInfo.name || 'Unknown Token'}
            </h3>
            <p className="text-zinc-500 text-sm">{tokenInfo.symbol}</p>
          </div>
          <div className={`px-3 py-1 rounded-lg ${colors.bg} ${colors.border} border`}>
            <span className={`font-semibold ${colors.text}`}>{analysis.riskLevel}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          {tokenInfo.marketCap !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">Market Cap</p>
              <p className="font-semibold text-white">
                ${tokenInfo.marketCap >= 1e6
                  ? `${(tokenInfo.marketCap / 1e6).toFixed(1)}M`
                  : tokenInfo.marketCap >= 1e3
                  ? `${(tokenInfo.marketCap / 1e3).toFixed(1)}K`
                  : tokenInfo.marketCap.toFixed(0)}
              </p>
            </div>
          )}
          {tokenInfo.liquidity !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">Liquidity</p>
              <p className="font-semibold text-white">
                ${tokenInfo.liquidity >= 1e3
                  ? `${(tokenInfo.liquidity / 1e3).toFixed(1)}K`
                  : tokenInfo.liquidity.toFixed(0)}
              </p>
            </div>
          )}
          {tokenInfo.age !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">Age</p>
              <p className="font-semibold text-white">
                {tokenInfo.age < 1
                  ? '<1 day'
                  : tokenInfo.age === 1
                  ? '1 day'
                  : `${tokenInfo.age} days`}
              </p>
            </div>
          )}
          {tokenInfo.priceChange24h !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">24h Change</p>
              <PriceChange change={tokenInfo.priceChange24h} />
            </div>
          )}
          {tokenInfo.volume24h !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">24h Volume</p>
              <p className="font-semibold text-white">
                ${tokenInfo.volume24h >= 1e6
                  ? `${(tokenInfo.volume24h / 1e6).toFixed(1)}M`
                  : tokenInfo.volume24h >= 1e3
                  ? `${(tokenInfo.volume24h / 1e3).toFixed(1)}K`
                  : tokenInfo.volume24h.toFixed(0)}
              </p>
            </div>
          )}
          {tokenInfo.txns24h && (
            <div>
              <p className="text-zinc-500 text-xs">24h Txns</p>
              <p className="font-semibold text-white">
                <span className="text-green-400">{tokenInfo.txns24h.buys}</span>
                <span className="text-zinc-500">/</span>
                <span className="text-red-400">{tokenInfo.txns24h.sells}</span>
              </p>
            </div>
          )}
        </div>

        <p className="mt-3 font-mono text-xs text-zinc-500 break-all">
          {tokenInfo.address}
        </p>
      </div>

      {/* Risk Score */}
      <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-4">
        <h3 className="font-semibold text-white mb-4">Risk Assessment</h3>
        <RiskMeter score={analysis.riskScore} />

        <p className="text-sm text-zinc-300 mt-4 text-center">{analysis.summary}</p>
      </div>

      {/* Bundle Detection Warning */}
      {bundleInfo?.detected && (
        <BundleBadge count={bundleInfo.count} description={bundleInfo.description} />
      )}

      {/* Holder Distribution */}
      {holderDistribution && holderDistribution.length > 0 && (
        <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <i className="fa-solid fa-chart-bar text-sentinel-accent"></i>
            Top Holders
          </h3>
          <HolderChart holders={holderDistribution} />
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-sentinel-border text-[10px]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              Creator
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              Whale
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              LP
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-zinc-500"></span>
              Other
            </span>
          </div>
        </div>
      )}

      {/* AI Prediction */}
      <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-4">
        <h3 className="font-semibold text-white mb-2">AI Prediction</h3>
        <p className="text-sm text-zinc-300">{analysis.prediction}</p>

        {analysis.networkInsights.length > 0 && (
          <div className="mt-3 pt-3 border-t border-sentinel-border">
            <p className="text-xs text-zinc-500 mb-2">Network Insights</p>
            <ul className="space-y-1">
              {analysis.networkInsights.map((insight, i) => (
                <li key={i} className="text-sm text-zinc-400 flex items-start gap-2">
                  <span className="text-sentinel-accent">-</span>
                  {insight}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Creator Info */}
      {creatorInfo && (
        <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3">Creator Analysis</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-zinc-500">Wallet Age</p>
              <p className="text-white">{creatorInfo.walletAge} days</p>
            </div>
            <div>
              <p className="text-zinc-500">Tokens Created</p>
              <p className="text-white">{creatorInfo.tokensCreated}</p>
            </div>
            <div>
              <p className="text-zinc-500">Previous Rugs</p>
              <p className={creatorInfo.ruggedTokens > 0 ? 'text-red-400 font-semibold' : 'text-white'}>
                {creatorInfo.ruggedTokens}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Current Holdings</p>
              <p className={creatorInfo.currentHoldings > 10 ? 'text-yellow-400' : 'text-white'}>
                {creatorInfo.currentHoldings.toFixed(1)}%
              </p>
            </div>
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-500 break-all">
            {creatorInfo.address}
          </p>
        </div>
      )}

      {/* Risk Flags */}
      {analysis.flags.length > 0 && (
        <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3">
            Risk Flags ({analysis.flags.length})
          </h3>
          <div className="space-y-2">
            {analysis.flags.map((flag, i) => (
              <FlagItem key={i} flag={flag} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
