import type { AnalysisResult, RiskFlag } from '../types';

interface Props {
  result: AnalysisResult;
}

const riskColors: Record<string, { bg: string; border: string; text: string }> = {
  SAFE: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400' },
  SUSPICIOUS: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
  DANGEROUS: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
  SCAM: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' },
};

const defaultColors = { bg: 'bg-zinc-500/10', border: 'border-zinc-500/30', text: 'text-zinc-400' };

const severityColors: Record<string, string> = {
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
  const colorClass = severityColors[flag.severity] || 'text-zinc-400 bg-zinc-500/10';
  return (
    <div className={`px-3 py-2 rounded-lg ${colorClass} border border-current/20`}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="font-semibold">{flag.type || 'UNKNOWN'}</span>
        <span className="opacity-60">{flag.severity || 'MEDIUM'}</span>
      </div>
      <p className="text-sm opacity-90">{flag.message || ''}</p>
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

function formatNumber(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export function AnalysisPanel({ result }: Props) {
  const colors = riskColors[result.riskLevel] || defaultColors;
  const market = result.market;
  const holders = result.holders;
  const creator = result.creator;
  const socials = result.socials;
  const authorities = result.authorities;

  return (
    <>
      {/* Token Info */}
      <div className="bg-argus-card border border-argus-border rounded-xl p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-white text-lg">
              {market?.name || 'Unknown Token'}
            </h3>
            <p className="text-zinc-500 text-sm">{market?.symbol || '???'}</p>
          </div>
          <div className={`px-3 py-1 rounded-lg ${colors.bg} ${colors.border} border`}>
            <span className={`font-semibold ${colors.text}`}>{result.riskLevel}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          {market?.marketCap !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">Market Cap</p>
              <p className="font-semibold text-white">${formatNumber(market.marketCap)}</p>
            </div>
          )}
          {market?.liquidity !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">Liquidity</p>
              <p className="font-semibold text-white">${formatNumber(market.liquidity)}</p>
            </div>
          )}
          {market?.ageInDays !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">Age</p>
              <p className="font-semibold text-white">
                {market.ageInDays < 1
                  ? '<1 day'
                  : market.ageInDays === 1
                  ? '1 day'
                  : `${Math.floor(market.ageInDays)} days`}
              </p>
            </div>
          )}
          {market?.priceChange24h !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">24h Change</p>
              <PriceChange change={market.priceChange24h} />
            </div>
          )}
          {market?.volume24h !== undefined && (
            <div>
              <p className="text-zinc-500 text-xs">24h Volume</p>
              <p className="font-semibold text-white">${formatNumber(market.volume24h)}</p>
            </div>
          )}
          {market?.txns24h && (
            <div>
              <p className="text-zinc-500 text-xs">24h Txns</p>
              <p className="font-semibold text-white">
                <span className="text-green-400">{market.txns24h.buys}</span>
                <span className="text-zinc-500">/</span>
                <span className="text-red-400">{market.txns24h.sells}</span>
              </p>
            </div>
          )}
        </div>

        <p className="mt-3 font-mono text-xs text-zinc-500 break-all">
          {result.tokenAddress}
        </p>
      </div>

      {/* Risk Score */}
      <div className="bg-argus-card border border-argus-border rounded-xl p-4">
        <h3 className="font-semibold text-white mb-4">Risk Assessment</h3>
        <RiskMeter score={result.riskScore} />
        <p className="text-sm text-zinc-300 mt-4 text-center">{result.summary}</p>
      </div>

      {/* Holder Stats */}
      {holders && (
        <div className="bg-argus-card border border-argus-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <i className="fa-solid fa-chart-bar text-argus-accent"></i>
            Holder Stats
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {holders.totalHolders !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Total Holders</p>
                <p className="font-semibold text-white">{holders.totalHolders.toLocaleString()}</p>
              </div>
            )}
            {holders.topHolder !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Top Holder</p>
                <p className={`font-semibold ${holders.topHolder > 20 ? 'text-red-400' : holders.topHolder > 10 ? 'text-yellow-400' : 'text-white'}`}>
                  {holders.topHolder.toFixed(1)}%
                </p>
              </div>
            )}
            {holders.top10Holders !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Top 10 Combined</p>
                <p className={`font-semibold ${holders.top10Holders > 50 ? 'text-red-400' : holders.top10Holders > 30 ? 'text-yellow-400' : 'text-white'}`}>
                  {holders.top10Holders.toFixed(1)}%
                </p>
              </div>
            )}
            {holders.top1NonLp !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Top Non-LP</p>
                <p className={`font-semibold ${holders.top1NonLp > 20 ? 'text-red-400' : holders.top1NonLp > 10 ? 'text-yellow-400' : 'text-white'}`}>
                  {holders.top1NonLp.toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Creator Info */}
      {creator && (
        <div className="bg-argus-card border border-argus-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3">Creator Analysis</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {creator.walletAge !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Wallet Age</p>
                <p className="text-white">{creator.walletAge} days</p>
              </div>
            )}
            {creator.tokensCreated !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Tokens Created</p>
                <p className="text-white">{creator.tokensCreated}</p>
              </div>
            )}
            {creator.ruggedTokens !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Previous Rugs</p>
                <p className={creator.ruggedTokens > 0 ? 'text-red-400 font-semibold' : 'text-white'}>
                  {creator.ruggedTokens}
                </p>
              </div>
            )}
            {creator.currentHoldings !== undefined && (
              <div>
                <p className="text-zinc-500 text-xs">Current Holdings</p>
                <p className={creator.currentHoldings > 10 ? 'text-yellow-400' : 'text-white'}>
                  {creator.currentHoldings.toFixed(1)}%
                </p>
              </div>
            )}
          </div>
          {creator.address && (
            <p className="mt-2 font-mono text-xs text-zinc-500 break-all">
              {creator.address}
            </p>
          )}
        </div>
      )}

      {/* Authorities */}
      {authorities && (
        <div className="bg-argus-card border border-argus-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3">Token Authorities</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-zinc-500 text-xs">Mint Authority</p>
              <p className={authorities.mintRevoked ? 'text-green-400' : 'text-red-400'}>
                {authorities.mintRevoked ? 'Revoked' : 'Active'}
              </p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Freeze Authority</p>
              <p className={authorities.freezeRevoked ? 'text-green-400' : 'text-red-400'}>
                {authorities.freezeRevoked ? 'Revoked' : 'Active'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Socials */}
      {socials && (socials.website || socials.twitter || socials.telegram) && (
        <div className="bg-argus-card border border-argus-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3">Social Links</h3>
          <div className="flex flex-wrap gap-2">
            {socials.website && (
              <a href={socials.website} target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 bg-argus-bg rounded-lg text-sm text-zinc-300 hover:text-white flex items-center gap-2">
                <i className="fa-solid fa-globe"></i>
                Website
              </a>
            )}
            {socials.twitter && (
              <a href={socials.twitter} target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 bg-argus-bg rounded-lg text-sm text-zinc-300 hover:text-white flex items-center gap-2">
                <i className="fa-brands fa-x-twitter"></i>
                Twitter
              </a>
            )}
            {socials.telegram && (
              <a href={socials.telegram} target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 bg-argus-bg rounded-lg text-sm text-zinc-300 hover:text-white flex items-center gap-2">
                <i className="fa-brands fa-telegram"></i>
                Telegram
              </a>
            )}
          </div>
        </div>
      )}

      {/* Risk Flags */}
      {result.flags && result.flags.length > 0 && (
        <div className="bg-argus-card border border-argus-border rounded-xl p-4">
          <h3 className="font-semibold text-white mb-3">
            Risk Flags ({result.flags.length})
          </h3>
          <div className="space-y-2">
            {result.flags.map((flag, i) => (
              <FlagItem key={i} flag={flag} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
