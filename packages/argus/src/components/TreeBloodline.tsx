import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import type { NetworkData, WalletNode } from '../types';

interface Props {
  data: NetworkData;
}

interface TreeNode {
  id: string;
  name: string;
  type: WalletNode['type'];
  address: string;
  holdingsPercent?: number;
  isHighRisk?: boolean;
  children?: TreeNode[];
}

const typeColors: Record<WalletNode['type'], string> = {
  token: '#f97316',
  creator: '#ff9500',
  whale: '#ff4444',
  insider: '#ff6b6b',
  lp: '#3b82f6',
  normal: '#71717a',
};

export function TreeBloodline({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Transform network data into tree structure
  const treeData = useMemo(() => {
    // Find root node - prefer creator, then token, then first node
    const creator = data.nodes.find(n => n.type === 'creator');
    const token = data.nodes.find(n => n.type === 'token');
    const rootNode = creator || token || data.nodes[0];

    if (!rootNode) return null;

    // Build adjacency map from funded links
    const fundedBy = new Map<string, string>();
    data.links.forEach(link => {
      if (link.type === 'funded') {
        fundedBy.set(link.target, link.source);
      }
    });

    // Group nodes by their funder
    const childrenMap = new Map<string, WalletNode[]>();
    data.nodes.forEach(node => {
      if (node.id === rootNode.id || node.type === 'token') return;

      const funder = fundedBy.get(node.id) || rootNode.id;
      if (!childrenMap.has(funder)) {
        childrenMap.set(funder, []);
      }
      childrenMap.get(funder)!.push(node);
    });

    // If no funding relationships, create hierarchy by risk/holdings
    if (childrenMap.size === 0) {
      // Separate nodes by risk and holdings (not just type)
      const otherNodes = data.nodes.filter(n => n.id !== rootNode.id && n.type !== 'token');

      // LP pools - special category, direct connection to creator
      const lps = otherNodes.filter(n => n.type === 'lp');

      // Tier 1: High risk wallets (likely insiders) - direct creator connection
      const highRisk = otherNodes.filter(n => n.isHighRisk && n.type !== 'lp');

      // Tier 2: Large holders (whales) - connected through high risk
      const largeHolders = otherNodes.filter(n =>
        !n.isHighRisk && n.type !== 'lp' && (n.holdingsPercent || 0) > 2
      );

      // Tier 3: Small holders (retail)
      const smallHolders = otherNodes.filter(n =>
        !n.isHighRisk && n.type !== 'lp' && (n.holdingsPercent || 0) <= 2
      );

      // Build the tree: Creator → [LP + High Risk] → Large Holders → Small Holders
      // Start with root's direct children (LP pools + high risk wallets)
      const rootChildren: WalletNode[] = [...lps];

      if (highRisk.length > 0) {
        // Limit high risk to 4 nodes max for cleaner visualization
        const tier1 = highRisk.slice(0, 4);
        rootChildren.push(...tier1);
        childrenMap.set(rootNode.id, rootChildren);

        // Distribute large holders among high risk nodes
        if (largeHolders.length > 0) {
          largeHolders.forEach((holder, i) => {
            const parent = tier1[i % tier1.length];
            if (!childrenMap.has(parent.id)) childrenMap.set(parent.id, []);
            childrenMap.get(parent.id)!.push(holder);
          });
        }

        // Distribute small holders among large holders (or high risk if no large)
        const tier2 = largeHolders.length > 0 ? largeHolders : tier1;
        if (smallHolders.length > 0 && tier2.length > 0) {
          const shownSmall = smallHolders.slice(0, 8);
          shownSmall.forEach((holder, i) => {
            const parent = tier2[i % tier2.length];
            if (!childrenMap.has(parent.id)) childrenMap.set(parent.id, []);
            childrenMap.get(parent.id)!.push(holder);
          });
        }

        // Remaining high risk nodes go to root too
        if (highRisk.length > 4) {
          childrenMap.get(rootNode.id)!.push(...highRisk.slice(4));
        }
      } else if (largeHolders.length > 0) {
        // No high risk, use LP + large holders as tier 1
        const tier1 = largeHolders.slice(0, 4);
        childrenMap.set(rootNode.id, [...lps, ...tier1]);

        // Small holders under large holders
        if (smallHolders.length > 0) {
          const shownSmall = smallHolders.slice(0, 8);
          shownSmall.forEach((holder, i) => {
            const parent = tier1[i % tier1.length];
            if (!childrenMap.has(parent.id)) childrenMap.set(parent.id, []);
            childrenMap.get(parent.id)!.push(holder);
          });
        }

        // Remaining large holders
        if (largeHolders.length > 4) {
          childrenMap.get(rootNode.id)!.push(...largeHolders.slice(4));
        }
      } else {
        // Only LP and small holders
        childrenMap.set(rootNode.id, [...lps, ...smallHolders.slice(0, 10)]);
      }
    }

    // Build tree recursively
    const buildTree = (node: WalletNode, depth = 0): TreeNode => {
      const children = childrenMap.get(node.id) || [];
      return {
        id: node.id,
        name: node.label,
        type: node.type,
        address: node.address,
        holdingsPercent: node.holdingsPercent,
        isHighRisk: node.isHighRisk,
        children: depth < 4 && children.length > 0
          ? children.map(c => buildTree(c, depth + 1))
          : undefined,
      };
    };

    return buildTree(rootNode);
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !treeData) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 50, right: 120, bottom: 30, left: 120 };

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Detect bundle wallets - holdings within 0.5% AND 4+ wallets in cluster
    const allNodes = data.nodes.filter(n => n.type !== 'token' && n.type !== 'lp' && n.type !== 'creator' && (n.holdingsPercent || 0) > 0.5);
    const bundleWallets = new Set<string>();

    // Group wallets by similar holdings (within 0.5%)
    const clusters: Map<string, string[]> = new Map();

    allNodes.forEach(node => {
      const holdings = node.holdingsPercent || 0;
      // Round to nearest 0.5% to find cluster key
      const clusterKey = (Math.round(holdings / 0.5) * 0.5).toFixed(1);

      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, []);
      }
      clusters.get(clusterKey)!.push(node.id);
    });

    // Only mark as bundle if cluster has 4+ wallets (coordinated buying)
    clusters.forEach((walletIds) => {
      if (walletIds.length >= 4) {
        walletIds.forEach(id => bundleWallets.add(id));
      }
    });

    // Calculate risk summary
    const highRiskNodes = data.nodes.filter(n => n.isHighRisk);
    const highRiskHoldings = highRiskNodes.reduce((sum, n) => sum + (n.holdingsPercent || 0), 0);

    // Add glow filter for high-risk
    const defs = svg.append('defs');
    const glowFilter = defs.append('filter')
      .attr('id', 'riskGlow')
      .attr('x', '-100%')
      .attr('y', '-100%')
      .attr('width', '300%')
      .attr('height', '300%');

    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '4')
      .attr('result', 'coloredBlur');

    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Bundle glow filter (purple)
    const bundleGlowFilter = defs.append('filter')
      .attr('id', 'bundleGlow')
      .attr('x', '-100%')
      .attr('y', '-100%')
      .attr('width', '300%')
      .attr('height', '300%');

    bundleGlowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur');

    const bundleMerge = bundleGlowFilter.append('feMerge');
    bundleMerge.append('feMergeNode').attr('in', 'coloredBlur');
    bundleMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Create tree layout
    const treeLayout = d3.tree<TreeNode>()
      .size([innerHeight, innerWidth]);

    const root = d3.hierarchy(treeData);
    const treeNodes = treeLayout(root);

    // Draw links
    g.append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(treeNodes.links())
      .join('path')
      .attr('d', d3.linkHorizontal<d3.HierarchyPointLink<TreeNode>, d3.HierarchyPointNode<TreeNode>>()
        .x(d => d.y)
        .y(d => d.x)
      )
      .attr('stroke', d => {
        const targetData = d.target.data;
        return targetData.isHighRisk ? '#ff4444' : typeColors[targetData.type];
      })
      .attr('stroke-width', d => d.target.data.isHighRisk ? 2 : 1.5)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', d => d.target.data.isHighRisk ? '4,2' : 'none');

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(treeNodes.descendants())
      .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`);

    // Get node radius based on holdings (dynamic sizing)
    const getNodeRadius = (d: d3.HierarchyPointNode<TreeNode>) => {
      if (d.data.type === 'creator') return 18;
      if (d.data.type === 'lp') return 12;
      const holdings = d.data.holdingsPercent || 0;
      // Scale from 6 to 16 based on holdings (0-10%)
      return Math.max(6, Math.min(16, 6 + holdings * 1));
    };

    // Bundle glow ring (purple) - render first so it's behind
    node.filter(d => bundleWallets.has(d.data.id))
      .append('circle')
      .attr('r', d => getNodeRadius(d) + 6)
      .attr('fill', 'none')
      .attr('stroke', '#a855f7')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.6)
      .attr('filter', 'url(#bundleGlow)');

    // High risk glow ring (red) - render before main circle
    node.filter(d => d.data.isHighRisk === true)
      .append('circle')
      .attr('r', d => getNodeRadius(d) + 5)
      .attr('fill', 'none')
      .attr('stroke', '#ff4444')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.7)
      .attr('filter', 'url(#riskGlow)');

    // Node circles (main)
    node.append('circle')
      .attr('r', d => getNodeRadius(d))
      .attr('fill', d => bundleWallets.has(d.data.id) ? '#a855f7' : typeColors[d.data.type])
      .attr('stroke', d => d.data.isHighRisk ? '#ff4444' : bundleWallets.has(d.data.id) ? '#a855f7' : '#1c252f')
      .attr('stroke-width', d => d.data.isHighRisk ? 3 : 2);

    // Labels
    node.append('text')
      .attr('dy', '0.31em')
      .attr('x', d => d.children ? -20 : 20)
      .attr('text-anchor', d => d.children ? 'end' : 'start')
      .attr('fill', '#e4e4e7')
      .attr('font-size', '11px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(d => d.data.name);

    // Holdings percent
    node.filter(d => d.data.holdingsPercent !== undefined && d.data.holdingsPercent > 0)
      .append('text')
      .attr('dy', '1.5em')
      .attr('x', d => d.children ? -20 : 20)
      .attr('text-anchor', d => d.children ? 'end' : 'start')
      .attr('fill', d => (d.data.holdingsPercent || 0) > 5 ? '#ff4444' : '#71717a')
      .attr('font-size', '9px')
      .text(d => `${d.data.holdingsPercent?.toFixed(1)}%`);

    // Type badges
    node.append('text')
      .attr('dy', d => d.data.type === 'creator' ? -22 : -14)
      .attr('text-anchor', 'middle')
      .attr('fill', d => typeColors[d.data.type])
      .attr('font-size', '8px')
      .attr('font-weight', '600')
      .text(d => d.data.type.toUpperCase());

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 24)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f97316')
      .attr('font-size', '14px')
      .attr('font-weight', '600')
      .attr('font-family', 'Cinzel, serif')
      .text('THE BLOODLINE');

    // Subtitle
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 38)
      .attr('text-anchor', 'middle')
      .attr('fill', '#71717a')
      .attr('font-size', '10px')
      .text('Creator → High Risk → Large Holders → Retail');

    // Risk summary badge (top right)
    if (highRiskNodes.length > 0) {
      const badgeX = width - 180;
      const badgeY = 15;

      svg.append('rect')
        .attr('x', badgeX)
        .attr('y', badgeY)
        .attr('width', 165)
        .attr('height', 24)
        .attr('fill', 'rgba(255, 68, 68, 0.15)')
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 1)
        .attr('rx', 4);

      svg.append('text')
        .attr('x', badgeX + 82)
        .attr('y', badgeY + 16)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ff4444')
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(`⚠ ${highRiskNodes.length} high-risk (${highRiskHoldings.toFixed(1)}%)`);
    }

    // Bundle summary badge (top left)
    if (bundleWallets.size >= 3) {
      const badgeX = 15;
      const badgeY = 15;

      svg.append('rect')
        .attr('x', badgeX)
        .attr('y', badgeY)
        .attr('width', 145)
        .attr('height', 24)
        .attr('fill', 'rgba(168, 85, 247, 0.15)')
        .attr('stroke', '#a855f7')
        .attr('stroke-width', 1)
        .attr('rx', 4);

      svg.append('text')
        .attr('x', badgeX + 72)
        .attr('y', badgeY + 16)
        .attr('text-anchor', 'middle')
        .attr('fill', '#a855f7')
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(`⚠ ${bundleWallets.size} bundled wallets`);
    }

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on('zoom', (event) => {
        g.attr('transform', `translate(${margin.left + event.transform.x},${margin.top + event.transform.y}) scale(${event.transform.k})`);
      });

    svg.call(zoom);

  }, [treeData, data.nodes]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
