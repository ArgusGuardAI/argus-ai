/**
 * HeroStats - Key token metrics in a dense grid
 */

import React from 'react';

interface HeroStatsProps {
  price: number | null;
  priceChange5m: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  liquidityStatus: 'High' | 'Medium' | 'Low' | null;
  top10Percent: number | null;
  volume24h?: number | null;
}

export const HeroStats: React.FC<HeroStatsProps> = ({
  price,
  priceChange5m,
  marketCap,
  fdv,
  liquidity,
  liquidityStatus,
  top10Percent,
  // volume24h available for future use
}) => {
  const formatNumber = (num: number | null, prefix = ''): string => {
    if (num === null) return '---';
    if (num >= 1_000_000) return `${prefix}${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${prefix}${(num / 1_000).toFixed(1)}K`;
    return `${prefix}${num.toFixed(2)}`;
  };

  const formatPrice = (num: number | null): string => {
    if (num === null) return '---';
    if (num < 0.0001) return `$${num.toFixed(8)}`;
    if (num < 1) return `$${num.toFixed(6)}`;
    return `$${num.toFixed(4)}`;
  };

  return (
    <div className="grid grid-cols-4 gap-3">
      {/* Price */}
      <div className="bg-[#111] border border-[#222] p-3">
        <div className="text-[0.65rem] text-[#666] uppercase">Price</div>
        <div className="text-[1.1rem] font-mono font-bold mt-1 text-[#FAFAFA]">
          {formatPrice(price)}
        </div>
        {priceChange5m !== null && (
          <div className={`text-[0.65rem] mt-0.5 ${priceChange5m >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
            {priceChange5m >= 0 ? '+' : ''}{priceChange5m.toFixed(1)}% (5m)
          </div>
        )}
      </div>

      {/* Market Cap */}
      <div className="bg-[#111] border border-[#222] p-3">
        <div className="text-[0.65rem] text-[#666] uppercase">Market Cap</div>
        <div className="text-[1.1rem] font-mono font-bold mt-1 text-[#FAFAFA]">
          {formatNumber(marketCap, '$')}
        </div>
        {fdv !== null && (
          <div className="text-[0.65rem] text-[#555] mt-0.5">
            FDV: {formatNumber(fdv, '$')}
          </div>
        )}
      </div>

      {/* Liquidity */}
      <div className="bg-[#111] border border-[#222] p-3">
        <div className="text-[0.65rem] text-[#666] uppercase">Liquidity</div>
        <div className="text-[1.1rem] font-mono font-bold mt-1 text-[#FAFAFA]">
          {formatNumber(liquidity, '$')}
        </div>
        {liquidityStatus && (
          <div className={`text-[0.65rem] mt-0.5 ${
            liquidityStatus === 'High' ? 'text-[#22C55E]' :
            liquidityStatus === 'Low' ? 'text-[#EF4444]' : 'text-[#F59E0B]'
          }`}>
            {liquidityStatus}
          </div>
        )}
      </div>

      {/* Top 10 Holders */}
      <div className="bg-[#111] border border-[#222] p-3">
        <div className="text-[0.65rem] text-[#666] uppercase">Top 10</div>
        <div className={`text-[1.1rem] font-mono font-bold mt-1 ${
          top10Percent !== null && top10Percent > 50 ? 'text-[#EF4444]' : 'text-[#FAFAFA]'
        }`}>
          {top10Percent !== null ? `${top10Percent.toFixed(1)}%` : '---'}
        </div>
        <div className="text-[0.65rem] text-[#555] mt-0.5">
          Concentration
        </div>
      </div>
    </div>
  );
};

export default HeroStats;
