/**
 * Performance Chart
 * Real-time price chart with AI decision markers, P&L curve, and win/loss stats
 */
import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface PricePoint {
  time: number;
  price: number;
  event?: 'buy' | 'sell' | 'alert' | 'target_hit' | 'stop_hit';
  eventLabel?: string;
}

interface Props {
  currentPrice: number | null;
  entryPrice: number | null;
  pnl: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  aiEnabled: boolean;
  aiLog: Array<{ time: Date; message: string; type: 'info' | 'success' | 'warning' | 'error' }>;
  tokenSymbol?: string;
}

export function PerformanceChart({
  currentPrice,
  entryPrice,
  pnl,
  takeProfitPercent,
  stopLossPercent,
  aiEnabled,
  aiLog,
  tokenSymbol = 'TOKEN',
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [stats, setStats] = useState({ wins: 0, losses: 0, totalTrades: 0 });

  // Track price history
  useEffect(() => {
    if (currentPrice === null) return;

    setPriceHistory(prev => {
      const now = Date.now();
      const newPoint: PricePoint = { time: now, price: currentPrice };

      // Check for AI events in recent logs
      const recentLog = aiLog[aiLog.length - 1];
      if (recentLog && Date.now() - recentLog.time.getTime() < 2000) {
        if (recentLog.message.includes('Take profit')) {
          newPoint.event = 'target_hit';
          newPoint.eventLabel = 'TP';
        } else if (recentLog.message.includes('Stop loss')) {
          newPoint.event = 'stop_hit';
          newPoint.eventLabel = 'SL';
        } else if (recentLog.message.includes('DUMP') || recentLog.message.includes('BUNDLE')) {
          newPoint.event = 'alert';
          newPoint.eventLabel = '!';
        }
      }

      // Keep last 5 minutes of data (300 points at 1/sec)
      const filtered = [...prev, newPoint].filter(p => now - p.time < 300000);
      return filtered;
    });
  }, [currentPrice, aiLog]);

  // Calculate stats from AI log
  useEffect(() => {
    let wins = 0;
    let losses = 0;
    aiLog.forEach(log => {
      if (log.type === 'success' && log.message.includes('%')) {
        const match = log.message.match(/([+-]?\d+\.?\d*)%/);
        if (match) {
          const pct = parseFloat(match[1]);
          if (pct > 0) wins++;
          else if (pct < 0) losses++;
        }
      }
    });
    setStats({ wins, losses, totalTrades: wins + losses });
  }, [aiLog]);

  // Draw chart
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || priceHistory.length < 2) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 30, right: 60, bottom: 40, left: 60 };

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3.scaleTime()
      .domain(d3.extent(priceHistory, d => d.time) as [number, number])
      .range([0, innerWidth]);

    const prices = priceHistory.map(d => d.price);
    const minPrice = Math.min(...prices) * 0.995;
    const maxPrice = Math.max(...prices) * 1.005;

    const yScale = d3.scaleLinear()
      .domain([minPrice, maxPrice])
      .range([innerHeight, 0]);

    // Grid
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yScale.ticks(5))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1c252f')
      .attr('stroke-dasharray', '2,2');

    // Entry price line
    if (entryPrice && entryPrice >= minPrice && entryPrice <= maxPrice) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', yScale(entryPrice))
        .attr('y2', yScale(entryPrice))
        .attr('stroke', '#3b82f6')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4');

      g.append('text')
        .attr('x', innerWidth + 5)
        .attr('y', yScale(entryPrice))
        .attr('dy', '0.35em')
        .attr('fill', '#3b82f6')
        .attr('font-size', '10px')
        .text('Entry');

      // Take profit line
      const tpPrice = entryPrice * (1 + takeProfitPercent / 100);
      if (tpPrice <= maxPrice) {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', yScale(tpPrice))
          .attr('y2', yScale(tpPrice))
          .attr('stroke', '#22c55e')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');

        g.append('text')
          .attr('x', innerWidth + 5)
          .attr('y', yScale(tpPrice))
          .attr('dy', '0.35em')
          .attr('fill', '#22c55e')
          .attr('font-size', '10px')
          .text(`TP +${takeProfitPercent}%`);
      }

      // Stop loss line
      const slPrice = entryPrice * (1 - stopLossPercent / 100);
      if (slPrice >= minPrice) {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', yScale(slPrice))
          .attr('y2', yScale(slPrice))
          .attr('stroke', '#ef4444')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');

        g.append('text')
          .attr('x', innerWidth + 5)
          .attr('y', yScale(slPrice))
          .attr('dy', '0.35em')
          .attr('fill', '#ef4444')
          .attr('font-size', '10px')
          .text(`SL -${stopLossPercent}%`);
      }
    }

    // Price line
    const line = d3.line<PricePoint>()
      .x(d => xScale(d.time))
      .y(d => yScale(d.price))
      .curve(d3.curveMonotoneX);

    // Gradient for area
    const gradient = svg.append('defs')
      .append('linearGradient')
      .attr('id', 'priceGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', pnl >= 0 ? '#22c55e' : '#ef4444')
      .attr('stop-opacity', 0.3);

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', pnl >= 0 ? '#22c55e' : '#ef4444')
      .attr('stop-opacity', 0);

    // Area under curve
    const area = d3.area<PricePoint>()
      .x(d => xScale(d.time))
      .y0(innerHeight)
      .y1(d => yScale(d.price))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(priceHistory)
      .attr('fill', 'url(#priceGradient)')
      .attr('d', area);

    // Main price line
    g.append('path')
      .datum(priceHistory)
      .attr('fill', 'none')
      .attr('stroke', pnl >= 0 ? '#22c55e' : '#ef4444')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Event markers
    const events = priceHistory.filter(d => d.event);
    g.selectAll('.event-marker')
      .data(events)
      .enter()
      .append('circle')
      .attr('cx', d => xScale(d.time))
      .attr('cy', d => yScale(d.price))
      .attr('r', 6)
      .attr('fill', d => {
        switch (d.event) {
          case 'target_hit': return '#22c55e';
          case 'stop_hit': return '#ef4444';
          case 'alert': return '#f97316';
          default: return '#3b82f6';
        }
      })
      .attr('stroke', '#0a0d12')
      .attr('stroke-width', 2);

    // Current price dot (pulsing)
    const lastPoint = priceHistory[priceHistory.length - 1];
    g.append('circle')
      .attr('cx', xScale(lastPoint.time))
      .attr('cy', yScale(lastPoint.price))
      .attr('r', 4)
      .attr('fill', pnl >= 0 ? '#22c55e' : '#ef4444');

    // Y axis
    const yAxis = d3.axisLeft(yScale)
      .ticks(5)
      .tickFormat(d => `$${(d as number).toPrecision(3)}`);

    g.append('g')
      .call(yAxis)
      .attr('color', '#3d4f5f')
      .selectAll('text')
      .attr('fill', '#71717a')
      .attr('font-size', '10px');

    // X axis
    const xAxis = d3.axisBottom(xScale)
      .ticks(5)
      .tickFormat(d => {
        const date = new Date(d as number);
        return date.toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' });
      });

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .attr('color', '#3d4f5f')
      .selectAll('text')
      .attr('fill', '#71717a')
      .attr('font-size', '10px');

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f97316')
      .attr('font-size', '12px')
      .attr('font-weight', '600')
      .text(`${tokenSymbol} PRICE - AI PERFORMANCE`);

  }, [priceHistory, entryPrice, takeProfitPercent, stopLossPercent, pnl, tokenSymbol]);

  const winRate = stats.totalTrades > 0 ? ((stats.wins / stats.totalTrades) * 100).toFixed(0) : '0';

  return (
    <div className="h-full flex flex-col bg-argus-bg">
      {/* Stats bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-argus-border">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">CURRENT</span>
            <span className="text-sm font-mono text-white">
              ${currentPrice?.toPrecision(4) || '---'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">P&L</span>
            <span className={`text-sm font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={`px-2 py-1 rounded ${aiEnabled ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'}`}>
            <span className="text-xs">AI {aiEnabled ? 'ON' : 'OFF'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-green-400 text-sm font-medium">{stats.wins}W</span>
            <span className="text-zinc-600">/</span>
            <span className="text-red-400 text-sm font-medium">{stats.losses}L</span>
          </div>
          <div className="px-2 py-1 bg-argus-card rounded border border-argus-border">
            <span className="text-xs text-zinc-500">Win Rate: </span>
            <span className={`text-sm font-bold ${parseInt(winRate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
              {winRate}%
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="flex-1 min-h-0">
        {priceHistory.length < 2 ? (
          <div className="h-full flex items-center justify-center text-zinc-500">
            <div className="text-center">
              <i className="fa-solid fa-chart-line text-4xl mb-2 opacity-30" />
              <p className="text-sm">Collecting price data...</p>
            </div>
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-full" />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 px-4 py-2 border-t border-argus-border text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-blue-500" />
          <span className="text-zinc-500">Entry</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-green-500" style={{ borderStyle: 'dashed' }} />
          <span className="text-zinc-500">Take Profit</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-red-500" style={{ borderStyle: 'dashed' }} />
          <span className="text-zinc-500">Stop Loss</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-orange-500" />
          <span className="text-zinc-500">Alert</span>
        </div>
      </div>
    </div>
  );
}
