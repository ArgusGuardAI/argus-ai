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

export function TimelineChronicle({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate mock timeline data if not present
  const timelineData = useMemo(() => {
    const now = Date.now();
    const hourAgo = now - 3600000;

    return data.nodes
      .filter(n => n.type !== 'token')
      .map((node, i) => ({
        ...node,
        // Simulate buy times - cluster some together to show bundles
        buyTime: node.buyTime || (
          node.type === 'creator'
            ? hourAgo
            : node.type === 'insider'
              ? hourAgo + Math.floor(i / 3) * 60000 + Math.random() * 5000 // Clustered
              : hourAgo + Math.random() * 3600000
        ),
        sellTime: node.sellTime || (node.type === 'insider' ? hourAgo + 1800000 + Math.random() * 600000 : undefined),
      }))
      .sort((a, b) => a.buyTime - b.buyTime);
  }, [data.nodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !timelineData.length) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 40, right: 30, bottom: 50, left: 60 };

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Time scale
    const timeExtent = d3.extent(timelineData, d => d.buyTime) as [number, number];
    const xScale = d3.scaleTime()
      .domain([timeExtent[0] - 60000, timeExtent[1] + 60000])
      .range([0, innerWidth]);

    // Y scale - stack by type
    const types = ['creator', 'insider', 'whale', 'normal', 'lp'];
    const yScale = d3.scaleBand()
      .domain(types)
      .range([0, innerHeight])
      .padding(0.3);

    // Background
    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', '#0a0d12')
      .attr('rx', 8);

    // Grid lines
    const xAxis = d3.axisBottom(xScale)
      .ticks(6)
      .tickFormat(d => d3.timeFormat('%H:%M')(d as Date));

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .attr('color', '#3d4f5f')
      .selectAll('text')
      .attr('fill', '#71717a');

    // Y axis labels
    types.forEach(type => {
      const y = (yScale(type) || 0) + yScale.bandwidth() / 2;
      g.append('text')
        .attr('x', -10)
        .attr('y', y)
        .attr('text-anchor', 'end')
        .attr('fill', typeColors[type as WalletNode['type']] || '#71717a')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('dominant-baseline', 'middle')
        .text(type.toUpperCase());
    });

    // Detect bundle wallets by holdings similarity (within 0.5%, 4+ wallets)
    const bundleWallets = new Set<string>();
    const clusters2: Map<string, string[]> = new Map();

    timelineData.filter(n => n.type !== 'lp' && n.type !== 'creator' && (n.holdingsPercent || 0) > 0.5).forEach(node => {
      const holdings = node.holdingsPercent || 0;
      const clusterKey = (Math.round(holdings / 0.5) * 0.5).toFixed(1);
      if (!clusters2.has(clusterKey)) clusters2.set(clusterKey, []);
      clusters2.get(clusterKey)!.push(node.id);
    });

    clusters2.forEach((walletIds) => {
      if (walletIds.length >= 4) {
        walletIds.forEach(id => bundleWallets.add(id));
      }
    });

    // Calculate summaries
    const highRiskCount = timelineData.filter(n => n.isHighRisk).length;
    const sellCount = timelineData.filter(n => n.sellTime).length;

    // Detect time clusters (bundle detection)
    const clusterThreshold = 30000; // 30 seconds
    const clusters: { start: number; end: number; count: number; ids: string[] }[] = [];
    let currentCluster = { start: timelineData[0]?.buyTime || 0, end: timelineData[0]?.buyTime || 0, count: 1, ids: [timelineData[0]?.id || ''] };

    timelineData.forEach((node, i) => {
      if (i === 0) return;
      if (node.buyTime - currentCluster.end < clusterThreshold) {
        currentCluster.end = node.buyTime;
        currentCluster.count++;
        currentCluster.ids.push(node.id);
      } else {
        if (currentCluster.count >= 3) clusters.push({ ...currentCluster });
        currentCluster = { start: node.buyTime, end: node.buyTime, count: 1, ids: [node.id] };
      }
    });
    if (currentCluster.count >= 3) clusters.push(currentCluster);

    // Mark time-clustered wallets
    const timeClusteredWallets = new Set<string>();
    clusters.forEach(c => c.ids.forEach(id => timeClusteredWallets.add(id)));

    // Draw cluster highlights
    clusters.forEach(cluster => {
      g.append('rect')
        .attr('x', xScale(cluster.start) - 5)
        .attr('y', 0)
        .attr('width', Math.max(xScale(cluster.end) - xScale(cluster.start) + 10, 20))
        .attr('height', innerHeight)
        .attr('fill', 'rgba(255, 68, 68, 0.1)')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,2')
        .attr('rx', 4);

      g.append('text')
        .attr('x', xScale(cluster.start) + (xScale(cluster.end) - xScale(cluster.start)) / 2)
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ff4444')
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(`BUNDLE: ${cluster.count} wallets`);
    });

    // Draw buy events
    timelineData.forEach(node => {
      const x = xScale(node.buyTime);
      const y = (yScale(node.type) || 0) + yScale.bandwidth() / 2;
      const isBundle = bundleWallets.has(node.id) || timeClusteredWallets.has(node.id);
      const color = isBundle ? '#a855f7' : typeColors[node.type];

      // Dynamic size based on holdings (4-12px)
      const holdings = node.holdingsPercent || 0;
      const baseRadius = Math.max(4, Math.min(12, 4 + holdings * 0.8));
      const radius = node.isHighRisk ? baseRadius + 2 : baseRadius;

      // Glow ring for bundle wallets
      if (isBundle) {
        g.append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', radius + 4)
          .attr('fill', 'none')
          .attr('stroke', '#a855f7')
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.5);
      }

      // Glow ring for high-risk
      if (node.isHighRisk) {
        g.append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', radius + 3)
          .attr('fill', 'none')
          .attr('stroke', '#ff4444')
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.6);
      }

      // Buy marker
      g.append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', radius)
        .attr('fill', color)
        .attr('stroke', node.isHighRisk ? '#ff4444' : isBundle ? '#a855f7' : '#1c252f')
        .attr('stroke-width', node.isHighRisk ? 2 : isBundle ? 2 : 1)
        .style('cursor', 'pointer')
        .on('mouseenter', function(event) {
          d3.select(this).attr('r', radius + 3);
          tooltip
            .html(`
              <div class="font-semibold text-white">${node.label}</div>
              <div class="text-zinc-400 text-[10px] font-mono">${node.address.slice(0, 8)}...</div>
              <div class="text-argus-accent mt-1">Bought: ${d3.timeFormat('%H:%M:%S')(new Date(node.buyTime))}</div>
              ${node.holdingsPercent ? `<div class="text-zinc-300">Holdings: ${node.holdingsPercent.toFixed(2)}%</div>` : ''}
              ${isBundle ? '<div class="text-purple-400 font-semibold">BUNDLED</div>' : ''}
            `)
            .classed('hidden', false)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseleave', function() {
          d3.select(this).attr('r', radius);
          tooltip.classed('hidden', true);
        });

      // Sell marker (if exists)
      if (node.sellTime) {
        const sellX = xScale(node.sellTime);

        // Line connecting buy to sell
        g.append('line')
          .attr('x1', x)
          .attr('y1', y)
          .attr('x2', sellX)
          .attr('y2', y)
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.5);

        // Sell marker (X shape)
        g.append('text')
          .attr('x', sellX)
          .attr('y', y)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', '#ff4444')
          .attr('font-size', '14px')
          .attr('font-weight', 'bold')
          .text('✕');
      }
    });

    // Tooltip
    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'fixed hidden bg-storm-900 border border-argus-border rounded-lg px-3 py-2 text-xs pointer-events-none z-[9999] shadow-xl');

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f97316')
      .attr('font-size', '14px')
      .attr('font-weight', '600')
      .attr('font-family', 'Cinzel, serif')
      .text('THE CHRONICLE');

    // Summary badges at top
    if (bundleWallets.size >= 4) {
      svg.append('rect')
        .attr('x', 15)
        .attr('y', 8)
        .attr('width', 130)
        .attr('height', 22)
        .attr('fill', 'rgba(168, 85, 247, 0.15)')
        .attr('stroke', '#a855f7')
        .attr('stroke-width', 1)
        .attr('rx', 4);

      svg.append('text')
        .attr('x', 80)
        .attr('y', 23)
        .attr('text-anchor', 'middle')
        .attr('fill', '#a855f7')
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(`⚠ ${bundleWallets.size} bundled wallets`);
    }

    if (highRiskCount > 0) {
      svg.append('rect')
        .attr('x', bundleWallets.size >= 4 ? 155 : 15)
        .attr('y', 8)
        .attr('width', 110)
        .attr('height', 22)
        .attr('fill', 'rgba(255, 68, 68, 0.15)')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 1)
        .attr('rx', 4);

      svg.append('text')
        .attr('x', (bundleWallets.size >= 4 ? 155 : 15) + 55)
        .attr('y', 23)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ff4444')
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(`⚠ ${highRiskCount} high-risk`);
    }

    if (sellCount > 0) {
      const sellBadgeX = (bundleWallets.size >= 4 ? 155 : 15) + (highRiskCount > 0 ? 120 : 0);
      svg.append('rect')
        .attr('x', sellBadgeX)
        .attr('y', 8)
        .attr('width', 90)
        .attr('height', 22)
        .attr('fill', 'rgba(255, 68, 68, 0.1)')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,2')
        .attr('rx', 4);

      svg.append('text')
        .attr('x', sellBadgeX + 45)
        .attr('y', 23)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ff4444')
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(`${sellCount} dumped`);
    }

    // Key event markers
    const creatorNode = timelineData.find(n => n.type === 'creator');
    const lpNode = timelineData.find(n => n.type === 'lp');

    if (creatorNode) {
      const x = xScale(creatorNode.buyTime);
      g.append('line')
        .attr('x1', x)
        .attr('y1', 0)
        .attr('x2', x)
        .attr('y2', 25)
        .attr('stroke', '#ff9500')
        .attr('stroke-width', 2);

      g.append('text')
        .attr('x', x)
        .attr('y', 38)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ff9500')
        .attr('font-size', '8px')
        .attr('font-weight', '600')
        .text('TOKEN CREATED');
    }

    if (lpNode) {
      const x = xScale(lpNode.buyTime);
      g.append('line')
        .attr('x1', x)
        .attr('y1', innerHeight - 15)
        .attr('x2', x)
        .attr('y2', innerHeight + 5)
        .attr('stroke', '#3b82f6')
        .attr('stroke-width', 2);

      g.append('text')
        .attr('x', x)
        .attr('y', innerHeight + 15)
        .attr('text-anchor', 'middle')
        .attr('fill', '#3b82f6')
        .attr('font-size', '8px')
        .attr('font-weight', '600')
        .text('LP ADDED');
    }

    // Legend
    svg.append('circle').attr('cx', width - 150).attr('cy', height - 20).attr('r', 5).attr('fill', '#f97316');
    svg.append('text').attr('x', width - 140).attr('y', height - 16).attr('fill', '#71717a').attr('font-size', '10px').text('Buy');
    svg.append('text').attr('x', width - 105).attr('y', height - 16).attr('fill', '#ff4444').attr('font-size', '12px').text('✕');
    svg.append('text').attr('x', width - 90).attr('y', height - 16).attr('fill', '#71717a').attr('font-size', '10px').text('Sell');
    svg.append('circle').attr('cx', width - 50).attr('cy', height - 20).attr('r', 5).attr('fill', '#a855f7');
    svg.append('text').attr('x', width - 40).attr('y', height - 16).attr('fill', '#71717a').attr('font-size', '10px').text('Bundle');

    return () => {
      tooltip.remove();
    };
  }, [timelineData]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
