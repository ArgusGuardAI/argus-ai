import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, sankeyLeft, SankeyNode } from 'd3-sankey';
import type { NetworkData } from '../types';

interface Props {
  data: NetworkData;
}

const typeColors: Record<string, string> = {
  token: '#f97316',
  creator: '#ff9500',
  whale: '#ff4444',
  insider: '#ff6b6b',
  lp: '#3b82f6',
  normal: '#71717a',
  source: '#22c55e',
};

interface FlowNode {
  id: string;
  name: string;
  type: string;
  column: number;
  isBundle?: boolean;
  isHighRisk?: boolean;
}

interface FlowLink {
  source: number;
  target: number;
  value: number;
}

export function SankeyRiver({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect bundle wallets (holdings within 0.5%, 4+ wallets)
  const bundleWallets = useMemo(() => {
    const bundles = new Set<string>();
    const clusters: Map<string, string[]> = new Map();

    data.nodes.filter(n => n.type !== 'token' && n.type !== 'lp' && n.type !== 'creator' && (n.holdingsPercent || 0) > 0.5).forEach(node => {
      const holdings = node.holdingsPercent || 0;
      const clusterKey = (Math.round(holdings / 0.5) * 0.5).toFixed(1);
      if (!clusters.has(clusterKey)) clusters.set(clusterKey, []);
      clusters.get(clusterKey)!.push(node.id);
    });

    clusters.forEach((walletIds) => {
      if (walletIds.length >= 4) {
        walletIds.forEach(id => bundles.add(id));
      }
    });

    return bundles;
  }, [data.nodes]);

  // Calculate summaries
  const highRiskCount = useMemo(() => data.nodes.filter(n => n.isHighRisk).length, [data.nodes]);

  // Transform network data into proper Sankey flow
  const sankeyData = useMemo(() => {
    const nodes: FlowNode[] = [];
    const links: FlowLink[] = [];
    const nodeIndexMap = new Map<string, number>();

    // Separate nodes by type
    const creator = data.nodes.find(n => n.type === 'creator');
    const insiders = data.nodes.filter(n => n.type === 'insider');
    const whales = data.nodes.filter(n => n.type === 'whale');
    const lps = data.nodes.filter(n => n.type === 'lp');
    const normals = data.nodes.filter(n => n.type === 'normal');

    // Column 1: Creator (start here, no external source for cleaner look)
    if (creator) {
      nodes.push({ id: creator.id, name: creator.label, type: 'creator', column: 0 });
      nodeIndexMap.set(creator.id, nodes.length - 1);
    }

    // Column 2: Insiders (early buyers, potentially funded by creator)
    insiders.forEach(insider => {
      nodes.push({
        id: insider.id,
        name: insider.label,
        type: 'insider',
        column: 1,
        isBundle: bundleWallets.has(insider.id),
        isHighRisk: insider.isHighRisk,
      });
      nodeIndexMap.set(insider.id, nodes.length - 1);
      // Link from creator to insider
      if (creator) {
        const creatorIdx = nodeIndexMap.get(creator.id);
        if (creatorIdx !== undefined) {
          links.push({
            source: creatorIdx,
            target: nodes.length - 1,
            value: Math.max(2, insider.holdingsPercent || 5),
          });
        }
      }
    });

    // Column 3: Whales
    whales.forEach((whale, i) => {
      nodes.push({
        id: whale.id,
        name: whale.label,
        type: 'whale',
        column: 2,
        isBundle: bundleWallets.has(whale.id),
        isHighRisk: whale.isHighRisk,
      });
      nodeIndexMap.set(whale.id, nodes.length - 1);

      // Some whales funded by insiders, some directly
      if (insiders.length > 0 && i < insiders.length) {
        const insiderIdx = nodeIndexMap.get(insiders[i % insiders.length].id);
        if (insiderIdx !== undefined) {
          links.push({
            source: insiderIdx,
            target: nodes.length - 1,
            value: Math.max(2, whale.holdingsPercent || 3),
          });
        }
      } else if (creator) {
        const creatorIdx = nodeIndexMap.get(creator.id);
        if (creatorIdx !== undefined) {
          links.push({
            source: creatorIdx,
            target: nodes.length - 1,
            value: Math.max(2, whale.holdingsPercent || 3),
          });
        }
      }
    });

    // Column 4: LP pools - connect from creator
    lps.forEach(lp => {
      nodes.push({ id: lp.id, name: lp.label, type: 'lp', column: 2 });
      nodeIndexMap.set(lp.id, nodes.length - 1);
      if (creator) {
        const creatorIdx = nodeIndexMap.get(creator.id);
        if (creatorIdx !== undefined) {
          links.push({
            source: creatorIdx,
            target: nodes.length - 1,
            value: Math.max(3, lp.holdingsPercent || 10),
          });
        }
      }
    });

    // Add Market node
    nodes.push({ id: 'market', name: 'Market', type: 'token', column: 3 });
    const marketIdx = nodes.length - 1;

    // Flows to market from holders (representing trading/selling)
    [...insiders, ...whales].forEach(holder => {
      const holderIdx = nodeIndexMap.get(holder.id);
      if (holderIdx !== undefined) {
        links.push({
          source: holderIdx,
          target: marketIdx,
          value: Math.max(1, (holder.holdingsPercent || 2) * 0.5),
        });
      }
    });

    // LP to market
    lps.forEach(lp => {
      const lpIdx = nodeIndexMap.get(lp.id);
      if (lpIdx !== undefined) {
        links.push({
          source: lpIdx,
          target: marketIdx,
          value: Math.max(2, (lp.holdingsPercent || 5) * 0.3),
        });
      }
    });

    // Normal holders come from market (retail buyers) - limit to 5
    normals.slice(0, 5).forEach(normal => {
      nodes.push({
        id: normal.id,
        name: normal.label,
        type: 'normal',
        column: 4,
        isBundle: bundleWallets.has(normal.id),
        isHighRisk: normal.isHighRisk,
      });
      nodeIndexMap.set(normal.id, nodes.length - 1);
      links.push({
        source: marketIdx,
        target: nodes.length - 1,
        value: Math.max(1, normal.holdingsPercent || 1),
      });
    });

    return { nodes, links };
  }, [data, bundleWallets]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !sankeyData.nodes.length) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 50, right: 120, bottom: 45, left: 30 };

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create sankey layout
    const sankeyLayout = sankey<FlowNode, FlowLink>()
      .nodeWidth(15)
      .nodePadding(12)
      .nodeAlign(sankeyLeft)
      .extent([[0, 0], [innerWidth, innerHeight]]);

    try {
      const { nodes, links } = sankeyLayout({
        nodes: sankeyData.nodes.map(d => ({ ...d })),
        links: sankeyData.links.map(d => ({ ...d })),
      });

      // Add gradient definitions
      const defs = svg.append('defs');

      links.forEach((link, i) => {
        const sourceNode = link.source as FlowNode & SankeyNode<FlowNode, FlowLink>;
        const targetNode = link.target as FlowNode & SankeyNode<FlowNode, FlowLink>;

        const gradient = defs.append('linearGradient')
          .attr('id', `gradient-${i}`)
          .attr('gradientUnits', 'userSpaceOnUse')
          .attr('x1', sourceNode.x1 || 0)
          .attr('x2', targetNode.x0 || 0);

        gradient.append('stop')
          .attr('offset', '0%')
          .attr('stop-color', typeColors[sourceNode.type] || '#71717a');

        gradient.append('stop')
          .attr('offset', '100%')
          .attr('stop-color', typeColors[targetNode.type] || '#71717a');
      });

      // Draw links with gradients
      g.append('g')
        .attr('fill', 'none')
        .selectAll('path')
        .data(links)
        .join('path')
        .attr('d', sankeyLinkHorizontal())
        .attr('stroke', (_, i) => `url(#gradient-${i})`)
        .attr('stroke-width', d => Math.max(2, d.width || 1))
        .attr('stroke-opacity', 0.5)
        .style('mix-blend-mode', 'screen')
        .on('mouseenter', function() {
          d3.select(this).attr('stroke-opacity', 0.8);
        })
        .on('mouseleave', function() {
          d3.select(this).attr('stroke-opacity', 0.5);
        })
        .append('title')
        .text(d => {
          const source = d.source as FlowNode;
          const target = d.target as FlowNode;
          return `${source.name} → ${target.name}\n${d.value.toFixed(1)}%`;
        });

      // Draw nodes
      const node = g.append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', 'node');

      // Glow background for bundled nodes
      node.filter(d => d.isBundle === true)
        .append('rect')
        .attr('x', d => (d.x0 || 0) - 3)
        .attr('y', d => (d.y0 || 0) - 3)
        .attr('height', d => Math.max(10, (d.y1 || 0) - (d.y0 || 0) + 6))
        .attr('width', d => (d.x1 || 0) - (d.x0 || 0) + 6)
        .attr('fill', 'none')
        .attr('stroke', '#a855f7')
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.6)
        .attr('rx', 4);

      // Glow for high-risk nodes
      node.filter(d => d.isHighRisk === true && d.isBundle !== true)
        .append('rect')
        .attr('x', d => (d.x0 || 0) - 2)
        .attr('y', d => (d.y0 || 0) - 2)
        .attr('height', d => Math.max(8, (d.y1 || 0) - (d.y0 || 0) + 4))
        .attr('width', d => (d.x1 || 0) - (d.x0 || 0) + 4)
        .attr('fill', 'none')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.6)
        .attr('stroke-dasharray', '3,2')
        .attr('rx', 3);

      // Node rectangles
      node.append('rect')
        .attr('x', d => d.x0 || 0)
        .attr('y', d => d.y0 || 0)
        .attr('height', d => Math.max(4, (d.y1 || 0) - (d.y0 || 0)))
        .attr('width', d => (d.x1 || 0) - (d.x0 || 0))
        .attr('fill', d => d.isBundle ? '#a855f7' : typeColors[d.type] || '#71717a')
        .attr('stroke', d => d.isBundle ? '#a855f7' : '#0a0d12')
        .attr('stroke-width', 1)
        .attr('rx', 2);

      // Node labels - truncate long names
      node.append('text')
        .attr('x', d => (d.x1 || 0) + 6)
        .attr('y', d => ((d.y1 || 0) + (d.y0 || 0)) / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', '#e4e4e7')
        .attr('font-size', '9px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(d => d.name.length > 12 ? d.name.slice(0, 12) : d.name);

      // Type labels below name
      node.append('text')
        .attr('x', d => (d.x1 || 0) + 6)
        .attr('y', d => ((d.y1 || 0) + (d.y0 || 0)) / 2 + 10)
        .attr('text-anchor', 'start')
        .attr('fill', d => typeColors[d.type] || '#71717a')
        .attr('font-size', '7px')
        .attr('font-weight', '600')
        .text(d => d.type.toUpperCase());

    } catch (e) {
      console.error('Sankey error:', e);
      g.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#71717a')
        .text('Unable to render fund flows');
    }

    // Summary badges at top
    const bundleCount = bundleWallets.size;

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

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f97316')
      .attr('font-size', '14px')
      .attr('font-weight', '600')
      .attr('font-family', 'Cinzel, serif')
      .text('THE RIVER');

    // Subtitle
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 36)
      .attr('text-anchor', 'middle')
      .attr('fill', '#71717a')
      .attr('font-size', '10px')
      .text('How funds flow from source through wallets to market');

    // Legend - horizontal at bottom left
    const legendData = [
      { type: 'creator', label: 'Creator' },
      { type: 'insider', label: 'Insider' },
      { type: 'whale', label: 'Whale' },
      { type: 'lp', label: 'LP' },
      { type: 'token', label: 'Market' },
      { type: 'normal', label: 'Retail' },
    ];

    const legend = svg.append('g')
      .attr('transform', `translate(20, ${height - 20})`);

    let xOffset = 0;
    legendData.forEach((item) => {
      legend.append('rect')
        .attr('x', xOffset)
        .attr('y', 0)
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', typeColors[item.type])
        .attr('rx', 2);

      const text = legend.append('text')
        .attr('x', xOffset + 14)
        .attr('y', 9)
        .attr('fill', '#71717a')
        .attr('font-size', '10px')
        .text(item.label);

      // Calculate next position based on text width
      const textWidth = text.node()?.getComputedTextLength() || 40;
      xOffset += 14 + textWidth + 16;
    });

    // Add bundle indicator to legend if bundles exist
    if (bundleWallets.size >= 4) {
      legend.append('rect')
        .attr('x', xOffset)
        .attr('y', 0)
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', '#a855f7')
        .attr('rx', 2);

      legend.append('text')
        .attr('x', xOffset + 14)
        .attr('y', 9)
        .attr('fill', '#a855f7')
        .attr('font-size', '10px')
        .text('Bundle');
    }

  }, [sankeyData, bundleWallets, highRiskCount]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
