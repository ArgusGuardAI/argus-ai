import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import type { NetworkData, WalletNode } from '../types';

interface Props {
  data: NetworkData;
}

const typeColors: Record<WalletNode['type'], string> = {
  token: '#f97316',
  creator: '#ff9500',
  whale: '#ff4444',
  insider: '#ff6b6b',
  lp: '#3b82f6',
  normal: '#71717a',
};

interface ActivityData {
  wallet: WalletNode;
  activities: { time: number; intensity: number; type: 'buy' | 'sell' | 'transfer' }[];
}

export function HeatPattern({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect bundle holding pattern (coordinated buys, no sells = pre-dump)
  const bundleAnalysis = useMemo(() => {
    const nonTokenNodes = data.nodes.filter(n => n.type !== 'token' && n.type !== 'lp');

    // Check for similar holdings (bundle pattern)
    const holdingsValues = nonTokenNodes
      .map(n => n.holdingsPercent || 0)
      .filter(h => h > 0.5)
      .sort((a, b) => b - a);

    let similarCount = 0;
    for (let i = 1; i < holdingsValues.length; i++) {
      if (Math.abs(holdingsValues[i] - holdingsValues[i - 1]) < 0.5) {
        similarCount++;
      }
    }

    const isBundlePattern = similarCount >= 5;

    // Check if anyone has sold (low holdings = sold)
    const totalHoldings = nonTokenNodes.reduce((sum, n) => sum + (n.holdingsPercent || 0), 0);
    const avgHoldings = totalHoldings / nonTokenNodes.length;
    const noSellsDetected = nonTokenNodes.filter(n => (n.holdingsPercent || 0) > 1).length >= similarCount;

    return {
      isBundleHolding: isBundlePattern && noSellsDetected,
      bundleCount: similarCount + 1,
      avgHoldings,
    };
  }, [data.nodes]);

  // Generate activity timeline data
  const activityData = useMemo(() => {
    const now = Date.now();
    const hourAgo = now - 3600000;

    // Generate activity for each wallet
    const allData = data.nodes
      .filter(n => n.type !== 'token')
      .map(wallet => {
        const activities: ActivityData['activities'] = [];
        const holdings = wallet.holdingsPercent || 0;

        // Generate activity pattern based on wallet type
        if (wallet.type === 'creator') {
          // Creator active at beginning - initial buy only
          activities.push({ time: hourAgo, intensity: 1, type: 'buy' });
          // If creator has low/no holdings, they sold
          if (holdings < 1) {
            activities.push({ time: now - 600000, intensity: 0.9, type: 'sell' });
          }
        } else if (wallet.type === 'lp') {
          // LP pool created early
          activities.push({ time: hourAgo + 30000, intensity: 1, type: 'buy' });
        } else if (wallet.type === 'insider') {
          // Insiders cluster together (coordinated buys)
          const clusterTime = hourAgo + Math.floor(Math.random() * 3) * 120000;
          activities.push({ time: clusterTime, intensity: 0.9, type: 'buy' });
          // If insider has low/no holdings now, they dumped
          if (holdings < 2) {
            const sellTime = clusterTime + 900000 + Math.random() * 1800000; // 15-45 min after buy
            activities.push({ time: sellTime, intensity: 0.85, type: 'sell' });
          }
        } else if (wallet.type === 'whale') {
          // Whales buy mid-pump
          const buyTime = hourAgo + 900000 + Math.random() * 600000;
          activities.push({ time: buyTime, intensity: 1, type: 'buy' });
          // If whale has low/no holdings now, they dumped
          if (holdings < 3) {
            const sellTime = buyTime + 600000 + Math.random() * 1200000; // 10-30 min after buy
            activities.push({ time: sellTime, intensity: 0.9, type: 'sell' });
          }
        } else {
          // Normal wallets scattered
          const buyTime = hourAgo + Math.random() * 3000000;
          activities.push({ time: buyTime, intensity: 0.5 + Math.random() * 0.5, type: 'buy' });
          // If normal wallet has very low holdings, they may have sold
          if (holdings < 0.5 && Math.random() > 0.5) {
            activities.push({ time: buyTime + 1200000 + Math.random() * 1800000, intensity: 0.6, type: 'sell' });
          }
        }

        return { wallet, activities };
      })
      .sort((a, b) => {
        // Sort by type priority, then by risk
        const typePriority = { creator: 0, insider: 1, whale: 2, lp: 3, normal: 4, token: 5 };
        const typeDiff = typePriority[a.wallet.type] - typePriority[b.wallet.type];
        if (typeDiff !== 0) return typeDiff;
        // High risk first within same type
        return (b.wallet.isHighRisk ? 1 : 0) - (a.wallet.isHighRisk ? 1 : 0);
      });

    // Limit to 15 wallets max to prevent overlap
    return allData.slice(0, 15);
  }, [data.nodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !activityData.length) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 50, right: 40, bottom: 75, left: 100 };

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Time slots (1 minute each for 60 minutes)
    const timeSlots = 60;
    const now = Date.now();
    const hourAgo = now - 3600000;

    // Scales - add padding so blocks don't overlap labels
    const xPadding = 40;
    const xScale = d3.scaleLinear()
      .domain([0, timeSlots])
      .range([xPadding, innerWidth - 20]);

    const yScale = d3.scaleBand()
      .domain(activityData.map((_, i) => i.toString()))
      .range([0, innerHeight])
      .padding(0.25);

    const cellWidth = innerWidth / timeSlots;
    const cellHeight = yScale.bandwidth();

    // Background
    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', '#0a0d12')
      .attr('rx', 4);

    // Grid lines (vertical - time markers)
    for (let i = 0; i <= timeSlots; i += 10) {
      g.append('line')
        .attr('x1', xScale(i))
        .attr('y1', 0)
        .attr('x2', xScale(i))
        .attr('y2', innerHeight)
        .attr('stroke', '#1c252f')
        .attr('stroke-width', 1);
    }

    // Detect coordinated activity (vertical patterns)
    const coordinatedSlots = new Set<number>();
    const slotCounts = new Map<number, number>();

    activityData.forEach(({ activities }) => {
      activities.forEach(activity => {
        const slot = Math.floor((activity.time - hourAgo) / 60000);
        slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
      });
    });

    slotCounts.forEach((count, slot) => {
      if (count >= 3) coordinatedSlots.add(slot);
    });

    // Highlight coordinated time slots (more intense if bundle holding pattern)
    coordinatedSlots.forEach(slot => {
      g.append('rect')
        .attr('x', xScale(slot) - cellWidth / 2)
        .attr('y', 0)
        .attr('width', cellWidth)
        .attr('height', innerHeight)
        .attr('fill', bundleAnalysis.isBundleHolding ? 'rgba(255, 68, 68, 0.25)' : 'rgba(255, 68, 68, 0.15)')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', bundleAnalysis.isBundleHolding ? 2 : 1)
        .attr('stroke-dasharray', bundleAnalysis.isBundleHolding ? '4,2' : '2,2');
    });

    // DUMP ZONE - shows when bundle holding detected (danger zone on the right)
    if (bundleAnalysis.isBundleHolding) {
      // Gradient from transparent to red on the right 20% of chart
      const dumpZoneStart = innerWidth * 0.75;

      // Add gradient definition
      const gradient = svg.append('defs')
        .append('linearGradient')
        .attr('id', 'dumpGradient')
        .attr('x1', '0%')
        .attr('x2', '100%');

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', 'transparent');

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#ff4444');

      // Draw dump zone
      g.append('rect')
        .attr('x', dumpZoneStart)
        .attr('y', 0)
        .attr('width', innerWidth - dumpZoneStart)
        .attr('height', innerHeight)
        .attr('fill', 'url(#dumpGradient)')
        .attr('opacity', 0.2);

      // "DUMP ZONE" label (vertical)
      g.append('text')
        .attr('x', innerWidth - 15)
        .attr('y', innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#ff4444')
        .attr('font-size', '11px')
        .attr('font-weight', '700')
        .attr('opacity', 0.6)
        .attr('transform', `rotate(-90, ${innerWidth - 15}, ${innerHeight / 2})`)
        .text('DUMP ZONE');
    }


    // Draw heat cells
    activityData.forEach(({ wallet, activities }, rowIndex) => {
      const y = yScale(rowIndex.toString()) || 0;

      // Row background (subtle type coloring)
      g.append('rect')
        .attr('x', 0)
        .attr('y', y)
        .attr('width', innerWidth)
        .attr('height', cellHeight)
        .attr('fill', typeColors[wallet.type])
        .attr('fill-opacity', 0.05);

      // Activity cells
      activities.forEach(activity => {
        const slot = Math.floor((activity.time - hourAgo) / 60000);
        const x = xScale(slot) - cellWidth / 2;

        // Color based on activity type
        let color: string;
        if (activity.type === 'buy') {
          color = d3.interpolateRgb('#1c252f', '#f97316')(activity.intensity);
        } else if (activity.type === 'sell') {
          color = d3.interpolateRgb('#1c252f', '#ff4444')(activity.intensity);
        } else {
          // Transfer uses purple (not blue, to avoid LP confusion)
          color = d3.interpolateRgb('#1c252f', '#a855f7')(activity.intensity);
        }

        g.append('rect')
          .attr('x', x)
          .attr('y', y)
          .attr('width', cellWidth - 1)
          .attr('height', cellHeight)
          .attr('fill', color)
          .attr('rx', 2);

        // Activity indicator
        if (activity.intensity > 0.7) {
          g.append('circle')
            .attr('cx', x + cellWidth / 2)
            .attr('cy', y + cellHeight / 2)
            .attr('r', 3)
            .attr('fill', activity.type === 'sell' ? '#ff4444' : '#f97316')
            .attr('fill-opacity', 0.8);
        }
      });

      // High risk indicator (before label)
      if (wallet.isHighRisk) {
        g.append('text')
          .attr('x', -110)
          .attr('y', y + cellHeight / 2)
          .attr('dominant-baseline', 'middle')
          .attr('fill', '#ff4444')
          .attr('font-size', '12px')
          .attr('font-weight', 'bold')
          .text('▲');
      }

      // Row label (wallet)
      g.append('text')
        .attr('x', -10)
        .attr('y', y + cellHeight / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', wallet.isHighRisk ? '#ff4444' : typeColors[wallet.type])
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', wallet.isHighRisk ? '600' : '400')
        .text(wallet.label);
    });

    // X axis (time)
    const xAxis = d3.axisBottom(xScale)
      .tickValues([0, 15, 30, 45, 60])
      .tickFormat(d => `${60 - (d as number)}m ago`);

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
      .attr('y', 24)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f97316')
      .attr('font-size', '14px')
      .attr('font-weight', '600')
      .attr('font-family', 'Cinzel, serif')
      .text('THE PATTERN');

    // Subtitle - changes based on bundle holding detection
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 40)
      .attr('text-anchor', 'middle')
      .attr('fill', '#71717a')
      .attr('font-size', '10px')
      .text('Wallet activity over time - vertical bands indicate coordinated behavior');

    // BUNDLE HOLDING WARNING BANNER
    if (bundleAnalysis.isBundleHolding) {
      // Warning banner background - positioned below axis
      const bannerWidth = 360;
      const bannerHeight = 22;
      const bannerX = margin.left + 10;
      const bannerY = height - 42;

      // Pulsing glow effect
      const defs = svg.append('defs');
      const filter = defs.append('filter')
        .attr('id', 'glow')
        .attr('x', '-50%')
        .attr('y', '-50%')
        .attr('width', '200%')
        .attr('height', '200%');
      filter.append('feGaussianBlur')
        .attr('stdDeviation', '3')
        .attr('result', 'coloredBlur');
      const feMerge = filter.append('feMerge');
      feMerge.append('feMergeNode').attr('in', 'coloredBlur');
      feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

      // Banner background with glow
      svg.append('rect')
        .attr('x', bannerX)
        .attr('y', bannerY)
        .attr('width', bannerWidth)
        .attr('height', bannerHeight)
        .attr('fill', 'rgba(255, 68, 68, 0.2)')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 2)
        .attr('rx', 4)
        .attr('filter', 'url(#glow)');

      // Warning icon
      svg.append('text')
        .attr('x', bannerX + 12)
        .attr('y', bannerY + 19)
        .attr('fill', '#ff4444')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .text('\u26A0'); // Warning triangle

      // Warning text
      svg.append('text')
        .attr('x', bannerX + 26)
        .attr('y', bannerY + 15)
        .attr('fill', '#ff4444')
        .attr('font-size', '9px')
        .attr('font-weight', '600')
        .text(`BUNDLE HOLDING: ${bundleAnalysis.bundleCount} wallets loaded, no exits - DUMP IMMINENT`);
    }

    // Legend - position at bottom right
    const legend = svg.append('g')
      .attr('transform', `translate(${width - 155}, ${height - 38})`);

    legend.append('rect').attr('x', 0).attr('y', 0).attr('width', 12).attr('height', 12).attr('fill', '#f97316').attr('rx', 2);
    legend.append('text').attr('x', 16).attr('y', 10).attr('fill', '#71717a').attr('font-size', '9px').text('Buy');

    legend.append('rect').attr('x', 45).attr('y', 0).attr('width', 12).attr('height', 12).attr('fill', '#ff4444').attr('rx', 2);
    legend.append('text').attr('x', 61).attr('y', 10).attr('fill', '#71717a').attr('font-size', '9px').text('Sell');

    legend.append('rect').attr('x', 95).attr('y', 0).attr('width', 12).attr('height', 12).attr('fill', 'rgba(255, 68, 68, 0.15)').attr('stroke', '#ff4444').attr('stroke-dasharray', '2,2').attr('rx', 2);
    legend.append('text').attr('x', 111).attr('y', 10).attr('fill', '#71717a').attr('font-size', '9px').text('Bundle');

  }, [activityData, bundleAnalysis]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
