/**
 * GraduationFeed Component
 *
 * Compact display of tokens graduating from pump.fun to Raydium.
 * Red/black theme matching the Argus landing page.
 */

import React, { useState } from 'react';

export interface Graduation {
  id: string;
  timestamp: number;
  mint: string;
  dex: string;
  poolAddress: string;
  bondingCurveTime?: number;
  graduatedFrom: string;
}

interface GraduationFeedProps {
  graduations: Graduation[];
  isLoading?: boolean;
  onAnalyze?: (tokenAddress: string) => void;
}

// Format time on bonding curve
const formatBondingTime = (ms?: number): string => {
  if (!ms) return '-';
  const minutes = Math.floor(ms / 1000 / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

// Format relative time
const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
};

export const GraduationFeed: React.FC<GraduationFeedProps> = ({
  graduations,
  onAnalyze,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (graduations.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 rounded-xl bg-[#0a0a0a] border border-[rgba(239,68,68,0.2)] overflow-hidden">
      {/* Red accent line */}
      <div className="h-[2px] bg-gradient-to-r from-[#10B981] to-[#059669]" />

      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-[rgba(255,255,255,0.02)] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-[#10B981]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
              <path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
          </span>
          <span className="text-xs font-bold text-[#10B981] tracking-[0.1em] uppercase">
            GRADUATING NOW
          </span>
          <span className="px-2 py-0.5 text-[10px] font-bold bg-[#10B981] text-black rounded">
            {graduations.length}
          </span>
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-[#666] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-[#1a1a1a] max-h-48 overflow-y-auto">
          {graduations.slice(0, 10).map((grad) => (
            <div
              key={grad.id}
              className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a1a]/50 last:border-b-0 hover:bg-[rgba(255,255,255,0.02)]"
            >
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs text-[#fafafa]">
                  {grad.mint.slice(0, 6)}...{grad.mint.slice(-4)}
                </span>
                <span className="text-[10px] text-[#666]">
                  {formatBondingTime(grad.bondingCurveTime)} on curve
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-[#666]">
                  {formatTimeAgo(grad.timestamp)}
                </span>
                {onAnalyze && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnalyze(grad.mint);
                    }}
                    className="px-3 py-1 text-[10px] font-semibold text-[#10B981] hover:bg-[rgba(16,185,129,0.1)] rounded transition-colors"
                  >
                    Analyze
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GraduationFeed;
