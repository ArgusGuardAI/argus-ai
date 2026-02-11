/**
 * DiscoveryFeed - Agent-discovered tokens with trade actions
 *
 * Shows tokens that agents have autonomously investigated.
 * Each card displays the AI verdict, market data, and action buttons.
 */

import React from 'react';
import type { DiscoveryResult } from '../../hooks/useDiscoveries';

interface DiscoveryFeedProps {
  discoveries: DiscoveryResult[];
  isLoading: boolean;
  onSelect: (discovery: DiscoveryResult) => void;
  onBuy?: (discovery: DiscoveryResult, amount: number) => void;
  selectedToken?: string;
}

function formatPrice(price: string | null): string {
  if (!price) return '--';
  const num = parseFloat(price);
  if (num < 0.00001) return `$${num.toExponential(2)}`;
  if (num < 0.01) return `$${num.toFixed(6)}`;
  if (num < 1) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}

function formatCompact(value: number | null): string {
  if (value === null || value === undefined) return '--';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function getVerdictStyle(verdict: string): { bg: string; text: string; border: string } {
  switch (verdict) {
    case 'SAFE':
      return { bg: 'bg-[rgba(34,197,94,0.15)]', text: 'text-[#22C55E]', border: 'border-[#22C55E]' };
    case 'SUSPICIOUS':
      return { bg: 'bg-[rgba(245,158,11,0.15)]', text: 'text-[#F59E0B]', border: 'border-[#F59E0B]' };
    case 'DANGEROUS':
      return { bg: 'bg-[rgba(239,68,68,0.15)]', text: 'text-[#EF4444]', border: 'border-[#EF4444]' };
    case 'SCAM':
      return { bg: 'bg-[rgba(239,68,68,0.25)]', text: 'text-[#EF4444]', border: 'border-[#EF4444]' };
    default:
      return { bg: 'bg-[rgba(100,100,100,0.15)]', text: 'text-[#888]', border: 'border-[#555]' };
  }
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const DiscoveryFeed: React.FC<DiscoveryFeedProps> = ({
  discoveries,
  isLoading,
  onSelect,
  onBuy,
  selectedToken,
}) => {
  // Convert risk score to safety score (higher = safer)
  const safetyScore = (riskScore: number) => Math.max(0, 100 - riskScore);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span>Discoveries</span>
          <span className="text-[#444] text-[0.6rem] normal-case">{discoveries.length} tokens</span>
        </div>
        {isLoading && (
          <span className="text-[#555] text-[0.55rem] animate-pulse">updating...</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {discoveries.map((disc) => {
          const verdict = getVerdictStyle(disc.analysis.verdict);
          const safety = safetyScore(disc.analysis.score);
          const isSelected = selectedToken === disc.token;

          return (
            <div
              key={disc.id}
              className={`p-2.5 rounded border cursor-pointer transition-colors ${
                isSelected
                  ? 'border-[#3B82F6] bg-[rgba(59,130,246,0.08)]'
                  : 'border-[#222] bg-[#0d0d0d] hover:border-[#333] hover:bg-[#111]'
              }`}
              onClick={() => onSelect(disc)}
            >
              {/* Header: Token + Verdict */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-[0.75rem] text-[#FAFAFA] truncate">
                    {disc.tokenInfo.symbol || disc.token.slice(0, 6)}
                  </span>
                  {disc.tokenInfo.name && (
                    <span className="text-[0.6rem] text-[#555] truncate">
                      {disc.tokenInfo.name}
                    </span>
                  )}
                </div>
                <span className={`text-[0.5rem] px-1.5 py-0.5 rounded border font-bold ${verdict.bg} ${verdict.text} ${verdict.border}`}>
                  {disc.analysis.verdict}
                </span>
              </div>

              {/* Score + Price row */}
              <div className="flex items-center justify-between text-[0.65rem] mb-1">
                <div className="flex items-center gap-3">
                  <span className={`font-mono font-bold ${
                    safety >= 60 ? 'text-[#22C55E]' : safety >= 40 ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                  }`}>
                    {safety}/100
                  </span>
                  <span className="text-[#888]">{formatPrice(disc.market.price)}</span>
                </div>
                <span className="text-[#555] text-[0.55rem]">{formatTimeAgo(disc.timestamp)}</span>
              </div>

              {/* Market stats row */}
              <div className="flex items-center gap-3 text-[0.55rem] text-[#666] mb-1.5">
                <span>MCap: {formatCompact(disc.market.marketCap)}</span>
                <span>Liq: {formatCompact(disc.market.liquidity)}</span>
                <span>Vol: {formatCompact(disc.market.volume24h)}</span>
              </div>

              {/* Warnings */}
              <div className="flex flex-wrap gap-1 mb-1.5">
                {disc.bundles.detected && (
                  <span className="text-[0.5rem] px-1 py-0 rounded bg-[rgba(245,158,11,0.15)] text-[#F59E0B] border border-[#F59E0B]">
                    BUNDLE {disc.bundles.count}w ({disc.bundles.controlPercent.toFixed(0)}%)
                  </span>
                )}
                {disc.tokenInfo.mintAuthority && (
                  <span className="text-[0.5rem] px-1 py-0 rounded bg-[rgba(239,68,68,0.15)] text-[#EF4444] border border-[#EF4444]">
                    MINT ACTIVE
                  </span>
                )}
                {disc.tokenInfo.freezeAuthority && (
                  <span className="text-[0.5rem] px-1 py-0 rounded bg-[rgba(239,68,68,0.15)] text-[#EF4444] border border-[#EF4444]">
                    FREEZE ACTIVE
                  </span>
                )}
                {disc.holders.top10Concentration > 50 && (
                  <span className="text-[0.5rem] px-1 py-0 rounded bg-[rgba(245,158,11,0.15)] text-[#F59E0B] border border-[#F59E0B]">
                    TOP10: {disc.holders.top10Concentration.toFixed(0)}%
                  </span>
                )}
              </div>

              {/* AI Summary */}
              <div className="text-[0.55rem] text-[#777] line-clamp-2 mb-2">
                {disc.analysis.summary}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  className="text-[0.55rem] px-2 py-1 rounded bg-[#111] border border-[#333] text-[#888] hover:text-[#FAFAFA] hover:border-[#555] transition-colors"
                  onClick={(e) => { e.stopPropagation(); onSelect(disc); }}
                >
                  DETAILS
                </button>
                {disc.analysis.verdict !== 'SCAM' && onBuy && (
                  <>
                    <button
                      className="text-[0.55rem] px-2 py-1 rounded bg-[rgba(34,197,94,0.1)] border border-[#22C55E] text-[#22C55E] hover:bg-[rgba(34,197,94,0.2)] transition-colors"
                      onClick={(e) => { e.stopPropagation(); onBuy(disc, 0.1); }}
                    >
                      0.1 SOL
                    </button>
                    <button
                      className="text-[0.55rem] px-2 py-1 rounded bg-[rgba(34,197,94,0.1)] border border-[#22C55E] text-[#22C55E] hover:bg-[rgba(34,197,94,0.2)] transition-colors"
                      onClick={(e) => { e.stopPropagation(); onBuy(disc, 0.5); }}
                    >
                      0.5 SOL
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {discoveries.length === 0 && !isLoading && (
          <div className="text-[#555] text-[0.65rem] py-6 text-center">
            <div className="text-[#444] mb-1">No discoveries yet</div>
            <div className="text-[#333] text-[0.55rem]">Agents are scanning for tokens...</div>
          </div>
        )}

        {discoveries.length === 0 && isLoading && (
          <div className="text-[#555] text-[0.65rem] py-6 text-center animate-pulse">
            Loading discoveries...
          </div>
        )}
      </div>
    </div>
  );
};

export default DiscoveryFeed;
