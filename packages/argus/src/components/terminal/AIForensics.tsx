/**
 * AIForensics - Security analysis grid with detailed indicators
 */

import React, { useState } from 'react';
import { BundleNetworkGraph } from '../BundleNetworkGraph';

interface ForensicsData {
  mintAuthority: 'Disabled' | 'Active' | null;
  freezeAuthority: 'Disabled' | 'Active' | null;
  lpLocked: boolean | null;
  lpLockedValue?: number; // Dollar value of locked LP
  lpLockedPercent?: number;
  tokenAge: string | null;
  honeypot: boolean | null;
  bundleDetected: boolean;
  bundleCount?: number;
  bundleHoldingsPercent?: number; // % of supply held by bundles
  bundleWallets?: Array<{ address: string; percent: number; isHolder: boolean }>;
  topHolderPercent?: number;
  devSoldPercent?: number;
  liquidity?: number;
  marketCap?: number;
}

interface AIForensicsProps {
  data: ForensicsData;
  tokenSymbol?: string;
  tokenAddress?: string;
  verdict?: string;
  score?: number;
}

// Format dollar values
function formatUSD(value: number | undefined | null): string {
  if (value === undefined || value === null) return '---';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export const AIForensics: React.FC<AIForensicsProps> = ({
  data,
  tokenSymbol,
  tokenAddress,
  // verdict - kept for API compatibility but replaced by specific factors
  score,
}) => {
  const [showBundleMap, setShowBundleMap] = useState(false);

  // Calculate MC/Liq ratio
  const mcLiqRatio = data.marketCap && data.liquidity && data.liquidity > 0
    ? data.marketCap / data.liquidity
    : null;

  // Determine age risk (newer = riskier)
  const getAgeRisk = (): 'safe' | 'warning' | 'danger' | 'neutral' => {
    if (!data.tokenAge) return 'neutral';
    if (data.tokenAge.includes('d') || data.tokenAge.includes('w')) return 'safe'; // Days or weeks old
    const hours = parseInt(data.tokenAge);
    if (!isNaN(hours) && hours < 6) return 'danger';
    if (!isNaN(hours) && hours < 24) return 'warning';
    return 'safe';
  };

  const pills: Array<{
    label: string;
    value: string;
    subtext?: string;
    risk: 'safe' | 'warning' | 'danger' | 'neutral';
    action?: { label: string; onClick: () => void };
  }> = [
    {
      label: 'Mint Auth',
      value: data.mintAuthority === 'Disabled' ? 'Revoked' : data.mintAuthority === 'Active' ? 'Active' : '---',
      subtext: data.mintAuthority === 'Active' ? 'Can mint unlimited' : data.mintAuthority === 'Disabled' ? 'Supply fixed' : undefined,
      risk: data.mintAuthority === 'Disabled' ? 'safe' : data.mintAuthority === 'Active' ? 'danger' : 'neutral',
    },
    {
      label: 'Freeze Auth',
      value: data.freezeAuthority === 'Disabled' ? 'Revoked' : data.freezeAuthority === 'Active' ? 'Active' : '---',
      subtext: data.freezeAuthority === 'Active' ? 'Can freeze wallets' : data.freezeAuthority === 'Disabled' ? 'Cannot freeze' : undefined,
      risk: data.freezeAuthority === 'Disabled' ? 'safe' : data.freezeAuthority === 'Active' ? 'danger' : 'neutral',
    },
    {
      label: 'LP Lock',
      value: data.lpLockedValue ? formatUSD(data.lpLockedValue) : data.lpLocked === true ? 'Locked' : data.lpLocked === false ? 'Unlocked' : '---',
      subtext: data.lpLockedPercent ? `${data.lpLockedPercent}% of LP` : undefined,
      risk: data.lpLocked === null ? 'neutral' : data.lpLocked ? 'safe' : 'danger',
    },
    {
      label: 'Age',
      value: data.tokenAge || '---',
      subtext: data.tokenAge && !data.tokenAge.includes('d') ? 'New token' : undefined,
      risk: getAgeRisk(),
    },
    {
      label: 'Honeypot',
      value: data.honeypot === null ? '---' : data.honeypot ? 'DETECTED' : 'Clear',
      subtext: data.honeypot ? 'Cannot sell!' : data.honeypot === false ? 'Sells work' : undefined,
      risk: data.honeypot === null ? 'neutral' : data.honeypot ? 'danger' : 'safe',
    },
    {
      label: 'Bundles',
      value: data.bundleDetected
        ? `${data.bundleCount || '?'} wallets`
        : 'None',
      subtext: data.bundleHoldingsPercent
        ? `${data.bundleHoldingsPercent.toFixed(1)}% supply`
        : data.bundleDetected ? 'Coordinated buys' : undefined,
      risk: data.bundleDetected
        ? (data.bundleHoldingsPercent && data.bundleHoldingsPercent > 20 ? 'danger' : 'warning')
        : 'safe',
      action: data.bundleDetected && data.bundleWallets && data.bundleWallets.length > 0
        ? { label: 'View Map', onClick: () => setShowBundleMap(true) }
        : undefined,
    },
  ];

  // Add MC/Liq ratio if available
  if (mcLiqRatio !== null) {
    pills.push({
      label: 'MC/Liq',
      value: `${mcLiqRatio.toFixed(1)}x`,
      subtext: mcLiqRatio > 10 ? 'Low liquidity!' : mcLiqRatio < 3 ? 'Good depth' : undefined,
      risk: mcLiqRatio > 10 ? 'danger' : mcLiqRatio > 5 ? 'warning' : 'safe',
    });
  }

  // Add top holder concentration if available
  if (data.topHolderPercent !== undefined) {
    pills.push({
      label: 'Top Holder',
      value: `${data.topHolderPercent.toFixed(1)}%`,
      subtext: data.topHolderPercent > 20 ? 'High concentration' : 'Distributed',
      risk: data.topHolderPercent > 30 ? 'danger' : data.topHolderPercent > 15 ? 'warning' : 'safe',
    });
  }

  return (
    <div>
      <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-3">
        AI Forensics
      </div>

      {/* Forensics Grid */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {pills.map((pill) => (
          <div
            key={pill.label}
            className={`bg-[#111] p-2 font-mono text-[0.75rem] border-l-[3px] ${getBorderColor(pill.risk)}`}
          >
            <div className="flex justify-between items-center">
              <span className="text-[#888]">{pill.label}</span>
              <span className={`font-bold ${getTextColor(pill.risk)}`}>{pill.value}</span>
            </div>
            <div className="flex justify-between items-center mt-0.5">
              {pill.subtext ? (
                <span className="text-[0.65rem] text-[#555]">{pill.subtext}</span>
              ) : (
                <span />
              )}
              {pill.action && (
                <button
                  onClick={pill.action.onClick}
                  className="text-[0.6rem] text-[#F59E0B] hover:text-[#FBBF24] underline"
                >
                  {pill.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Risk Factors & Positives */}
      <RiskBreakdown data={data} mcLiqRatio={mcLiqRatio} />

      {/* Tiered Recommendation */}
      {score !== undefined && (
        <TradingRecommendation score={score} />
      )}

      {/* Bundle Network Graph Modal */}
      {showBundleMap && data.bundleWallets && tokenSymbol && tokenAddress && (
        <BundleNetworkGraph
          tokenSymbol={tokenSymbol}
          tokenAddress={tokenAddress}
          wallets={data.bundleWallets}
          controlPercent={data.bundleHoldingsPercent || 0}
          onClose={() => setShowBundleMap(false)}
        />
      )}
    </div>
  );
};

// Risk breakdown component
const RiskBreakdown: React.FC<{ data: ForensicsData; mcLiqRatio: number | null }> = ({ data, mcLiqRatio }) => {
  const risks: string[] = [];
  const positives: string[] = [];

  // Analyze each factor and categorize

  // Token Age
  if (data.tokenAge) {
    if (data.tokenAge.includes('m') && !data.tokenAge.includes('mo')) {
      risks.push(`New token (${data.tokenAge} old) - high volatility risk`);
    } else if (data.tokenAge.includes('h') && parseInt(data.tokenAge) < 24) {
      risks.push(`Young token (${data.tokenAge}) - elevated risk`);
    } else if (data.tokenAge.includes('d') || data.tokenAge.includes('w')) {
      positives.push(`Established token (${data.tokenAge} old)`);
    }
  }

  // Bundle Detection
  if (data.bundleDetected) {
    if (data.bundleHoldingsPercent && data.bundleHoldingsPercent > 20) {
      risks.push(`Bundles hold ${data.bundleHoldingsPercent.toFixed(1)}% of supply - coordinated dump risk`);
    } else if (data.bundleHoldingsPercent) {
      risks.push(`Bundle activity detected (${data.bundleHoldingsPercent.toFixed(1)}% supply)`);
    } else {
      risks.push(`Bundle activity detected (${data.bundleCount || '?'} wallets)`);
    }
  } else {
    positives.push('No bundle activity detected');
  }

  // Top Holder Concentration
  if (data.topHolderPercent !== undefined) {
    if (data.topHolderPercent > 30) {
      risks.push(`Top holder owns ${data.topHolderPercent.toFixed(1)}% - extreme concentration risk`);
    } else if (data.topHolderPercent > 15) {
      risks.push(`Top holder owns ${data.topHolderPercent.toFixed(1)}% - concentration risk`);
    } else {
      positives.push(`Top holder only ${data.topHolderPercent.toFixed(1)}% - well distributed`);
    }
  }

  // LP Lock
  if (data.lpLocked === false) {
    risks.push('LP unlocked - rug pull possible');
  } else if (data.lpLocked === true) {
    if (data.lpLockedPercent && data.lpLockedPercent >= 90) {
      positives.push(`LP ${data.lpLockedPercent}% locked - protected`);
    } else if (data.lpLockedPercent) {
      positives.push(`LP ${data.lpLockedPercent}% locked`);
    } else {
      positives.push('LP locked');
    }
  }

  // Mint Authority
  if (data.mintAuthority === 'Active') {
    risks.push('Mint authority active - unlimited supply risk');
  } else if (data.mintAuthority === 'Disabled') {
    positives.push('Mint authority revoked - supply fixed');
  }

  // Freeze Authority
  if (data.freezeAuthority === 'Active') {
    risks.push('Freeze authority active - can freeze wallets');
  } else if (data.freezeAuthority === 'Disabled') {
    positives.push('Freeze authority revoked');
  }

  // Honeypot
  if (data.honeypot === true) {
    risks.push('HONEYPOT DETECTED - cannot sell!');
  } else if (data.honeypot === false) {
    positives.push('Not a honeypot - sells work');
  }

  // MC/Liq Ratio
  if (mcLiqRatio !== null) {
    if (mcLiqRatio > 10) {
      risks.push(`MC/Liq ratio ${mcLiqRatio.toFixed(1)}x - very thin liquidity`);
    } else if (mcLiqRatio > 5) {
      risks.push(`MC/Liq ratio ${mcLiqRatio.toFixed(1)}x - moderate slippage expected`);
    } else if (mcLiqRatio < 3) {
      positives.push(`MC/Liq ratio ${mcLiqRatio.toFixed(1)}x - good liquidity depth`);
    }
  }

  // Liquidity
  if (data.liquidity !== undefined) {
    if (data.liquidity < 5000) {
      risks.push(`Low liquidity ($${data.liquidity.toLocaleString()}) - hard to exit`);
    } else if (data.liquidity >= 50000) {
      positives.push(`Strong liquidity ($${(data.liquidity / 1000).toFixed(0)}K)`);
    }
  }

  if (risks.length === 0 && positives.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 space-y-3">
      {/* Risk Factors */}
      {risks.length > 0 && (
        <div className="bg-[rgba(255,68,68,0.08)] border border-[#ff4444]/30 rounded p-3">
          <div className="text-[0.7rem] uppercase text-[#ff4444] font-bold mb-2 flex items-center gap-1">
            <span>Risk Factors</span>
            <span className="bg-[#ff4444] text-black px-1.5 py-0.5 rounded text-[0.6rem]">{risks.length}</span>
          </div>
          <ul className="space-y-1">
            {risks.map((risk, i) => (
              <li key={i} className="text-[0.75rem] text-[#ffaaaa] flex items-start gap-2">
                <span className="text-[#ff4444] mt-0.5">•</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Positive Factors */}
      {positives.length > 0 && (
        <div className="bg-[rgba(0,230,118,0.08)] border border-[#00e676]/30 rounded p-3">
          <div className="text-[0.7rem] uppercase text-[#00e676] font-bold mb-2 flex items-center gap-1">
            <span>Positive Factors</span>
            <span className="bg-[#00e676] text-black px-1.5 py-0.5 rounded text-[0.6rem]">{positives.length}</span>
          </div>
          <ul className="space-y-1">
            {positives.map((pos, i) => (
              <li key={i} className="text-[0.75rem] text-[#aaffcc] flex items-start gap-2">
                <span className="text-[#00e676] mt-0.5">✓</span>
                <span>{pos}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Tiered trading recommendation
const TradingRecommendation: React.FC<{ score: number }> = ({ score }) => {
  let recommendation: { level: string; title: string; advice: string; color: string; bgColor: string; borderColor: string };

  if (score >= 75) {
    recommendation = {
      level: 'LOW RISK',
      title: 'Standard Position',
      advice: 'Lower risk profile. Standard position sizing appropriate. Monitor for changes in holder distribution.',
      color: 'text-[#00e676]',
      bgColor: 'bg-[rgba(0,230,118,0.1)]',
      borderColor: 'border-[#00e676]',
    };
  } else if (score >= 60) {
    recommendation = {
      level: 'MODERATE RISK',
      title: 'Reduced Position',
      advice: 'Consider reduced position size. Set stop-loss at 15-20%. Watch for bundle wallet sells.',
      color: 'text-[#00e676]',
      bgColor: 'bg-[rgba(0,230,118,0.08)]',
      borderColor: 'border-[#00e676]/50',
    };
  } else if (score >= 40) {
    recommendation = {
      level: 'HIGH RISK',
      title: 'Small Position Only',
      advice: 'High risk trade. Small position only (1-2% portfolio). Tight stop-loss required. Take profits quickly.',
      color: 'text-[#F59E0B]',
      bgColor: 'bg-[rgba(245,158,11,0.1)]',
      borderColor: 'border-[#F59E0B]',
    };
  } else if (score >= 25) {
    recommendation = {
      level: 'VERY HIGH RISK',
      title: 'Avoid or Minimal',
      advice: 'Significant red flags detected. Avoid or use only disposable funds. High probability of loss.',
      color: 'text-[#ff4444]',
      bgColor: 'bg-[rgba(255,68,68,0.1)]',
      borderColor: 'border-[#ff4444]',
    };
  } else {
    recommendation = {
      level: 'CRITICAL RISK',
      title: 'Do Not Trade',
      advice: 'Critical risk indicators. Likely scam or rug pull. Do not invest any funds.',
      color: 'text-[#ff4444]',
      bgColor: 'bg-[rgba(255,68,68,0.15)]',
      borderColor: 'border-[#ff4444]',
    };
  }

  return (
    <div className={`${recommendation.bgColor} border ${recommendation.borderColor} rounded p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`text-[0.7rem] uppercase font-bold ${recommendation.color}`}>
          {recommendation.level}
        </div>
        <div className="text-[0.8rem] font-mono font-bold text-[#FAFAFA]">
          Score: {score}/100
        </div>
      </div>
      <div className={`text-[0.9rem] font-bold ${recommendation.color} mb-1`}>
        {recommendation.title}
      </div>
      <div className="text-[0.8rem] text-[#aaa]">
        {recommendation.advice}
      </div>
    </div>
  );
};

function getBorderColor(risk: string): string {
  switch (risk) {
    case 'safe':
      return 'border-[#00e676]';
    case 'warning':
      return 'border-[#F59E0B]';
    case 'danger':
      return 'border-[#ff4444]';
    default:
      return 'border-[#333]';
  }
}

function getTextColor(risk: string): string {
  switch (risk) {
    case 'safe':
      return 'text-[#00e676]';
    case 'warning':
      return 'text-[#F59E0B]';
    case 'danger':
      return 'text-[#ff4444]';
    default:
      return 'text-[#d1d1d1]';
  }
}

export default AIForensics;
