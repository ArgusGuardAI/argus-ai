/**
 * StatsGrid Component
 *
 * Compact stat pills with animated values.
 * Red/black theme matching Argus branding.
 */

import React from 'react';

interface StatsGridProps {
  stats: {
    tokensAnalyzed: number;
    alertsToday: number;
    highRiskDetected: number;
    activePositions: number;
    totalPnL?: number;
  };
  isLoading?: boolean;
}

export const StatsGrid: React.FC<StatsGridProps> = ({ stats, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2 mb-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-24 rounded-lg bg-[#111] animate-pulse" />
        ))}
      </div>
    );
  }

  const items = [
    { label: 'Scans', value: stats.tokensAnalyzed, color: '#EF4444' },
    { label: 'Alerts', value: stats.alertsToday, color: stats.alertsToday > 0 ? '#F59E0B' : '#666' },
    { label: 'Risk', value: stats.highRiskDetected, color: stats.highRiskDetected > 0 ? '#EF4444' : '#666' },
    { label: 'Pos', value: stats.activePositions, color: stats.activePositions > 0 ? '#10B981' : '#666' },
    {
      label: 'P&L',
      value: `${stats.totalPnL !== undefined && stats.totalPnL >= 0 ? '+' : ''}$${(stats.totalPnL || 0).toFixed(0)}`,
      color: stats.totalPnL !== undefined && stats.totalPnL >= 0 ? '#10B981' : '#EF4444',
      isString: true
    },
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]"
        >
          <span
            className="text-sm font-bold font-mono tabular-nums"
            style={{ color: item.color }}
          >
            {item.isString ? item.value : (item.value as number).toLocaleString()}
          </span>
          <span className="text-[9px] text-[#666] uppercase tracking-wider font-medium">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
};

export default StatsGrid;
