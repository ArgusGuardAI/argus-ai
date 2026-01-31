/**
 * WalletTopology - Top holders with tags and distribution
 */

import React, { useMemo } from 'react';

interface Holder {
  address: string;
  percent: number;
  tags?: ('DEV' | 'SNIPER' | 'BUNDLE' | 'DEX' | 'LP' | 'BURN')[];
  label?: string;
}

interface WalletTopologyProps {
  holders: Holder[];
  totalHolders?: number;
  top10Percent?: number;
  top100Percent?: number;
  retailPercent?: number;
  bundleCount?: number;
  bundleHoldingsPercent?: number;
}

// Tag colors for consistency
const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  DEV: { bg: 'rgba(187,134,252,0.3)', text: '#bb86fc', border: '#bb86fc' },
  SNIPER: { bg: 'rgba(255,68,68,0.3)', text: '#ff4444', border: '#ff4444' },
  BUNDLE: { bg: 'rgba(245,158,11,0.3)', text: '#F59E0B', border: '#F59E0B' },
  DEX: { bg: 'rgba(0,230,118,0.3)', text: '#00e676', border: '#00e676' },
  LP: { bg: 'rgba(0,230,118,0.3)', text: '#00e676', border: '#00e676' },
  BURN: { bg: 'rgba(136,136,136,0.3)', text: '#888', border: '#888' },
};

export const WalletTopology: React.FC<WalletTopologyProps> = ({
  holders,
  totalHolders,
  top10Percent,
  top100Percent,
  retailPercent,
  bundleCount,
  bundleHoldingsPercent,
}) => {
  // Calculate category breakdown by tag + bundle data from props
  const categoryBreakdown = useMemo(() => {
    const breakdown: Record<string, { count: number; percent: number }> = {
      DEV: { count: 0, percent: 0 },
      LP: { count: 0, percent: 0 },
      BUNDLE: { count: 0, percent: 0 },
      DEX: { count: 0, percent: 0 },
      BURN: { count: 0, percent: 0 },
      SNIPER: { count: 0, percent: 0 },
    };

    let taggedPercent = 0;

    for (const holder of holders) {
      if (holder.tags && holder.tags.length > 0) {
        // Count primary tag (first one)
        const primaryTag = holder.tags[0];
        if (breakdown[primaryTag]) {
          breakdown[primaryTag].count++;
          breakdown[primaryTag].percent += holder.percent;
          taggedPercent += holder.percent;
        }
      }
    }

    // Override BUNDLE with actual data from props if available (more accurate)
    if (bundleHoldingsPercent !== undefined && bundleHoldingsPercent > 0) {
      breakdown.BUNDLE = {
        count: bundleCount || 0,
        percent: bundleHoldingsPercent,
      };
    }

    return { breakdown, taggedPercent };
  }, [holders, bundleCount, bundleHoldingsPercent]);

  // Calculate histogram data (holder concentration by size)
  const histogram = useMemo(() => {
    const ranges = [
      { label: '>10%', min: 10, max: 100, count: 0, percent: 0, color: '#ff4444' },
      { label: '5-10%', min: 5, max: 10, count: 0, percent: 0, color: '#F59E0B' },
      { label: '1-5%', min: 1, max: 5, count: 0, percent: 0, color: '#00bcd4' },
      { label: '<1%', min: 0, max: 1, count: 0, percent: 0, color: '#00e676' },
    ];

    for (const holder of holders) {
      for (const range of ranges) {
        if (holder.percent >= range.min && holder.percent < range.max) {
          range.count++;
          range.percent += holder.percent;
          break;
        }
        // Handle exactly 10% case
        if (holder.percent >= 10 && range.label === '>10%') {
          range.count++;
          range.percent += holder.percent;
          break;
        }
      }
    }

    const maxCount = Math.max(...ranges.map(r => r.count), 1);
    return { ranges, maxCount };
  }, [holders]);

  return (
    <div className="flex flex-col h-full">
      {/* Category Breakdown */}
      <div className="mb-3">
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2">
          Holdings by Category
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(categoryBreakdown.breakdown)
            .filter(([, data]) => data.percent > 0)
            .sort((a, b) => b[1].percent - a[1].percent)
            .map(([tag, data]) => (
              <div
                key={tag}
                className="bg-[#111] p-1.5 rounded text-center"
                style={{ borderLeft: `3px solid ${TAG_COLORS[tag]?.border || '#333'}` }}
              >
                <div className="text-[0.6rem] text-[#666] uppercase">{tag}</div>
                <div className="text-[0.8rem] font-bold font-mono" style={{ color: TAG_COLORS[tag]?.text || '#fff' }}>
                  {data.percent.toFixed(1)}%
                </div>
                <div className="text-[0.55rem] text-[#555]">{data.count} wallet{data.count !== 1 ? 's' : ''}</div>
              </div>
            ))}
          {Object.values(categoryBreakdown.breakdown).every(d => d.percent === 0) && (
            <div className="col-span-3 text-[0.7rem] text-[#555] text-center py-2">
              No tagged wallets detected
            </div>
          )}
        </div>
      </div>

      {/* Holder Concentration Histogram */}
      <div className="mb-3">
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2">
          Holder Concentration
        </div>
        <div className="space-y-1">
          {histogram.ranges.map((range) => (
            <div key={range.label} className="flex items-center gap-2">
              <div className="w-12 text-[0.65rem] text-[#888] font-mono text-right">{range.label}</div>
              <div className="flex-1 h-4 bg-[#111] rounded overflow-hidden relative">
                <div
                  className="h-full rounded transition-all duration-300"
                  style={{
                    width: `${(range.count / histogram.maxCount) * 100}%`,
                    backgroundColor: range.color,
                    opacity: 0.7,
                  }}
                />
                {range.count > 0 && (
                  <div className="absolute inset-0 flex items-center px-2">
                    <span className="text-[0.6rem] font-mono text-white/80">
                      {range.count} ({range.percent.toFixed(1)}%)
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Wallet List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2 flex justify-between">
          <span>Top Holders</span>
          {totalHolders && <span className="text-[#00bcd4]">{totalHolders.toLocaleString()} total</span>}
        </div>

        <div className="space-y-2">
          {holders.slice(0, 20).map((holder) => (
            <div
              key={holder.address}
              className="bg-[#111] p-2 flex justify-between items-center font-mono text-[0.75rem] border border-transparent hover:border-[#333] transition-colors"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888]">
                  {holder.label || `${holder.address.slice(0, 6)}...${holder.address.slice(-4)}`}
                </span>
                {holder.tags && holder.tags.length > 0 && (
                  <div className="flex gap-1">
                    {holder.tags.map((tag) => (
                      <span key={tag} className={`text-[0.6rem] px-1 py-0.5 rounded ${getTagStyle(tag)}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className={`font-bold ${holder.percent > 10 ? 'text-[#ff4444]' : holder.percent > 5 ? 'text-[#F59E0B]' : 'text-[#d1d1d1]'}`}>
                {holder.percent.toFixed(1)}%
              </div>
            </div>
          ))}

          {holders.length === 0 && (
            <div className="text-[#666] text-[0.75rem] py-4 text-center">
              No holder data available
            </div>
          )}
        </div>
      </div>

      {/* Distribution Summary */}
      <div className="mt-4 pt-3 border-t border-[#222]">
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2">
          Token Distribution
        </div>
        <div className="font-mono text-[0.7rem] text-[#aaa] leading-relaxed">
          <div className="flex justify-between">
            <span>Top 1-10:</span>
            <span className={top10Percent && top10Percent > 50 ? 'text-[#ff4444]' : 'text-[#d1d1d1]'}>
              {top10Percent !== undefined ? `${top10Percent.toFixed(1)}%` : '---'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Top 11-100:</span>
            <span className="text-[#d1d1d1]">
              {top100Percent !== undefined ? `${(top100Percent - (top10Percent || 0)).toFixed(1)}%` : '---'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Retail (100+):</span>
            <span className="text-[#d1d1d1]">
              {retailPercent !== undefined ? `${retailPercent.toFixed(1)}%` : '---'}
            </span>
          </div>
        </div>

        {/* Distribution Bar */}
        {top10Percent !== undefined && (
          <div className="mt-3 h-2 bg-[#1a1a1a] rounded overflow-hidden flex">
            <div
              className="h-full bg-[#ff4444]"
              style={{ width: `${top10Percent}%` }}
              title={`Top 10: ${top10Percent.toFixed(1)}%`}
            />
            <div
              className="h-full bg-[#F59E0B]"
              style={{ width: `${(top100Percent || 0) - top10Percent}%` }}
              title={`Top 11-100: ${((top100Percent || 0) - top10Percent).toFixed(1)}%`}
            />
            <div
              className="h-full bg-[#00e676]"
              style={{ width: `${retailPercent || 0}%` }}
              title={`Retail: ${retailPercent?.toFixed(1)}%`}
            />
          </div>
        )}
      </div>
    </div>
  );
};

function getTagStyle(tag: string): string {
  switch (tag) {
    case 'DEV':
      return 'bg-[rgba(187,134,252,0.2)] text-[#bb86fc] border border-[#bb86fc]';
    case 'SNIPER':
      return 'bg-[rgba(255,68,68,0.2)] text-[#ff4444] border border-[#ff4444]';
    case 'BUNDLE':
      return 'bg-[rgba(245,158,11,0.2)] text-[#F59E0B] border border-[#F59E0B]';
    case 'DEX':
    case 'LP':
      return 'bg-[rgba(0,230,118,0.2)] text-[#00e676] border border-[#00e676]';
    case 'BURN':
      return 'bg-[rgba(136,136,136,0.2)] text-[#888] border border-[#888]';
    default:
      return 'bg-[#222] text-white border border-[#333]';
  }
}

export default WalletTopology;
