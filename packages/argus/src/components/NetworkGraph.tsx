import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { NetworkData, WalletNode, WalletLink } from '../types';

interface Props {
  data: NetworkData;
}

// Extend WalletNode with D3 simulation properties
type SimNode = WalletNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & WalletLink;

const nodeColors: Record<WalletNode['type'], string> = {
  token: '#f97316',
  creator: '#ff9500',
  whale: '#ff4444',
  insider: '#ff6b6b',
  lp: '#3b82f6',
  normal: '#71717a',
};

// Font Awesome icon classes for each node type
const nodeIcons: Record<WalletNode['type'], string> = {
  token: 'fa-solid fa-coins',
  creator: 'fa-solid fa-user-pen',
  whale: 'fa-solid fa-fish-fins',
  insider: 'fa-solid fa-user-secret',
  lp: 'fa-solid fa-droplet',
  normal: 'fa-solid fa-user',
};

const linkColors: Record<WalletLink['type'], string> = {
  created: '#ff9500',
  holds: '#f97316',
  funded: '#ff4444',
  coordinated: '#ff6b6b',
};

export function NetworkGraph({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data.nodes.length) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3
      .select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Add zoom
    const g = svg.append('g');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Detect bundle wallets (holdings within 0.5%, 4+ wallets)
    const bundleWallets = new Set<string>();
    const clusters: Map<string, string[]> = new Map();

    data.nodes.filter(n => n.type !== 'token' && n.type !== 'lp' && n.type !== 'creator' && (n.holdingsPercent || 0) > 0.5).forEach(node => {
      const holdings = node.holdingsPercent || 0;
      const clusterKey = (Math.round(holdings / 0.5) * 0.5).toFixed(1);
      if (!clusters.has(clusterKey)) clusters.set(clusterKey, []);
      clusters.get(clusterKey)!.push(node.id);
    });

    clusters.forEach((walletIds) => {
      if (walletIds.length >= 4) {
        walletIds.forEach(id => bundleWallets.add(id));
      }
    });

    // Calculate summaries
    const highRiskCount = data.nodes.filter(n => n.isHighRisk).length;
    const bundleCount = bundleWallets.size;

    // Add summary badges at top
    if (bundleCount >= 4) {
      svg.append('rect')
        .attr('x', 10)
        .attr('y', 8)
        .attr('width', 140)
        .attr('height', 24)
        .attr('fill', 'rgba(168, 85, 247, 0.15)')
        .attr('stroke', '#a855f7')
        .attr('stroke-width', 1)
        .attr('rx', 4);

      svg.append('text')
        .attr('x', 80)
        .attr('y', 24)
        .attr('text-anchor', 'middle')
        .attr('fill', '#a855f7')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(`⚠ ${bundleCount} bundled wallets`);
    }

    if (highRiskCount > 0) {
      const riskBadgeX = bundleCount >= 4 ? 160 : 10;
      svg.append('rect')
        .attr('x', riskBadgeX)
        .attr('y', 8)
        .attr('width', 110)
        .attr('height', 24)
        .attr('fill', 'rgba(255, 68, 68, 0.15)')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 1)
        .attr('rx', 4);

      svg.append('text')
        .attr('x', riskBadgeX + 55)
        .attr('y', 24)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ff4444')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(`⚠ ${highRiskCount} high-risk`);
    }

    // Create nodes and links with proper typing
    const nodes: SimNode[] = data.nodes.map(d => ({ ...d }));
    const links: SimLink[] = data.links.map(d => ({ ...d }));

    // Create simulation
    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(80)
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Draw links
    const link = g
      .append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', (d) => linkColors[d.type] || '#333')
      .attr('stroke-width', (d) => Math.sqrt(d.value) * 1.5)
      .attr('stroke-opacity', 0.6);

    // Draw nodes
    const node = g
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Get dynamic node radius based on holdings
    const getNodeRadius = (d: SimNode) => {
      if (d.type === 'token') return 22;
      if (d.type === 'creator') return 16;
      if (d.type === 'lp') return 12;
      // Dynamic sizing based on holdings (8-18px)
      const holdings = d.holdingsPercent || 0;
      return Math.max(8, Math.min(18, 8 + holdings * 0.8));
    };

    // Bundle glow ring (purple) - render first
    node
      .filter((d) => bundleWallets.has(d.id))
      .append('circle')
      .attr('r', (d) => getNodeRadius(d) + 6)
      .attr('fill', 'none')
      .attr('stroke', '#a855f7')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.6);

    // Node circles (background)
    node
      .append('circle')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', (d) => bundleWallets.has(d.id) ? '#a855f7' : nodeColors[d.type])
      .attr('stroke', (d) => bundleWallets.has(d.id) ? '#a855f7' : '#1e1e2e')
      .attr('stroke-width', 2);

    // Add Font Awesome icons inside nodes using foreignObject
    node
      .append('foreignObject')
      .attr('width', (d) => {
        if (d.type === 'token') return 28;
        if (d.type === 'creator') return 20;
        if (d.type === 'whale') return 18;
        return 14;
      })
      .attr('height', (d) => {
        if (d.type === 'token') return 28;
        if (d.type === 'creator') return 20;
        if (d.type === 'whale') return 18;
        return 14;
      })
      .attr('x', (d) => {
        if (d.type === 'token') return -14;
        if (d.type === 'creator') return -10;
        if (d.type === 'whale') return -9;
        return -7;
      })
      .attr('y', (d) => {
        if (d.type === 'token') return -14;
        if (d.type === 'creator') return -10;
        if (d.type === 'whale') return -9;
        return -7;
      })
      .append('xhtml:div')
      .attr('class', 'flex items-center justify-center w-full h-full')
      .html((d) => {
        const iconSize = d.type === 'token' ? 'text-sm' : d.type === 'creator' ? 'text-xs' : 'text-[10px]';
        return `<i class="${nodeIcons[d.type]} ${iconSize}" style="color: #0a0a0f;"></i>`;
      });

    // Risk indicator ring for high-risk nodes
    node
      .filter((d) => d.isHighRisk === true)
      .append('circle')
      .attr('r', (d) => getNodeRadius(d) + 4)
      .attr('fill', 'none')
      .attr('stroke', '#ff4444')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.8)
      .attr('stroke-dasharray', '4,2');

    // Node labels
    node
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', (d) => {
        if (d.type === 'token') return 34;
        if (d.type === 'creator') return 28;
        return 20;
      })
      .attr('text-anchor', 'middle')
      .text((d) => d.label);

    // Holdings percent for whales
    node
      .filter((d) => (d.holdingsPercent ?? 0) > 1)
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', (d) => {
        if (d.type === 'token') return 46;
        if (d.type === 'creator') return 40;
        return 30;
      })
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => ((d.holdingsPercent ?? 0) > 5 ? '#ff4444' : '#71717a'))
      .text((d) => `${(d.holdingsPercent ?? 0).toFixed(1)}%`);

    // Tooltip - append to body to avoid clipping
    const tooltip = d3
      .select('body')
      .append('div')
      .attr('class', 'fixed hidden bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs pointer-events-none z-[9999] shadow-xl')
      .style('max-width', '280px');

    node
      .on('mouseenter', (event, d) => {
        const typeLabel = d.type.charAt(0).toUpperCase() + d.type.slice(1);
        tooltip
          .html(
            `<div class="font-semibold text-white mb-1">${d.label}</div>
             <div class="text-zinc-500 text-[10px] mb-2">${typeLabel}</div>
             <div class="text-zinc-400 font-mono text-[10px] break-all mb-2">${d.address}</div>
             ${d.holdingsPercent ? `<div class="text-zinc-300">Holdings: <span class="${d.holdingsPercent > 5 ? 'text-red-400' : 'text-green-400'}">${d.holdingsPercent.toFixed(2)}%</span></div>` : ''}
             ${d.txCount ? `<div class="text-zinc-300">Transactions: ${d.txCount}</div>` : ''}`
          )
          .classed('hidden', false)
          .style('left', Math.min(event.clientX + 15, window.innerWidth - 300) + 'px')
          .style('top', Math.max(event.clientY - 10, 10) + 'px');
      })
      .on('mouseleave', () => {
        tooltip.classed('hidden', true);
      });

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);

      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
      tooltip.remove();
    };
  }, [data]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full" />
      {/* Legend - Centered with Font Awesome icons */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-argus-bg/95 border border-argus-border rounded-lg px-4 py-2.5 text-xs backdrop-blur-sm">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-coins text-argus-accent"></i>
            <span className="text-zinc-400">Token</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-user-pen text-orange-500"></i>
            <span className="text-zinc-400">Creator</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-fish-fins text-red-500"></i>
            <span className="text-zinc-400">Whale</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-user-secret text-red-400"></i>
            <span className="text-zinc-400">Insider</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-droplet text-blue-500"></i>
            <span className="text-zinc-400">LP</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-user text-zinc-500"></i>
            <span className="text-zinc-400">Holder</span>
          </div>
        </div>
      </div>
    </div>
  );
}
