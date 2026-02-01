/**
 * VolumeChart - Simple bar chart for volume/price visualization
 */

import React, { useMemo } from 'react';

interface VolumeChartProps {
  data?: number[];
  title?: string;
  height?: number;
}

export const VolumeChart: React.FC<VolumeChartProps> = ({
  data,
  title = 'Volume & Price Velocity (1H)',
  height = 150,
}) => {
  // Generate mock data if none provided
  const chartData = useMemo(() => {
    if (data && data.length > 0) return data;
    // Generate 60 random values for 1 hour of data
    return Array.from({ length: 60 }, () => Math.floor(Math.random() * 80) + 20);
  }, [data]);

  const maxValue = Math.max(...chartData);

  return (
    <div>
      <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-3">
        {title}
      </div>

      <div
        className="bg-black border border-[#222] relative flex items-end px-2 py-2"
        style={{
          height,
          backgroundImage: 'linear-gradient(#111 1px, transparent 1px), linear-gradient(90deg, #111 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        {chartData.map((value, idx) => {
          const heightPercent = (value / maxValue) * 100;
          const color = heightPercent > 70 ? '#EF4444' : heightPercent < 30 ? '#22C55E' : '#DC2626';

          return (
            <div
              key={idx}
              className="flex-1 mx-px transition-all duration-200 hover:opacity-100 opacity-30 cursor-crosshair group relative"
              style={{
                height: `${heightPercent}%`,
                backgroundColor: color,
                minWidth: '2px',
              }}
            >
              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block">
                <div className="bg-[#1a1a1a] border border-[#333] px-2 py-1 rounded text-[0.65rem] font-mono whitespace-nowrap">
                  {value.toFixed(0)}
                </div>
              </div>
            </div>
          );
        })}

        {/* Y-axis labels */}
        <div className="absolute right-2 top-2 text-[0.6rem] text-[#444] font-mono">High</div>
        <div className="absolute right-2 bottom-2 text-[0.6rem] text-[#444] font-mono">Low</div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-[0.65rem] text-[#666]">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-[#EF4444] rounded-sm" />
          <span>High Volume</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-[#DC2626] rounded-sm" />
          <span>Normal</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-[#22C55E] rounded-sm" />
          <span>Low Volume</span>
        </div>
      </div>
    </div>
  );
};

export default VolumeChart;
