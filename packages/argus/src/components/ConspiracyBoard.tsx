import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import type { NetworkData, WalletNode, WalletLink } from '../types';

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

const typeIcons: Record<WalletNode['type'], string> = {
  token: '🪙',
  creator: '👤',
  whale: '🐋',
  insider: '🕵️',
  lp: '💧',
  normal: '👥',
};

const linkColors: Record<WalletLink['type'], string> = {
  funded: '#ff4444',
  created: '#ff9500',
  holds: '#f97316',
  coordinated: '#ff6b6b',
};

interface CardNode extends WalletNode {
  x: number;
  y: number;
}

export function ConspiracyBoard({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Position nodes as cards on a board
  const cardData = useMemo(() => {
    const width = 1200;
    const height = 750;
    const cardWidth = 100;
    const cardHeight = 60;
    const topPadding = 70; // Extra space for bundle banner
    const rowGap = 50; // Gap between rows

    // Group by type
    const groups: Record<string, WalletNode[]> = {
      token: [],
      creator: [],
      insider: [],
      whale: [],
      lp: [],
      normal: [],
    };

    data.nodes.forEach(node => {
      groups[node.type]?.push(node);
    });

    const cards: CardNode[] = [];

    // Position token at center top (below banner area)
    groups.token.forEach((node) => {
      cards.push({
        ...node,
        x: width / 2 - cardWidth / 2,
        y: topPadding,
      });
    });

    // Position creator below token
    groups.creator.forEach((node) => {
      cards.push({
        ...node,
        x: width / 2 - cardWidth / 2,
        y: topPadding + cardHeight + rowGap,
      });
    });

    // Position insiders in a row below creator
    const insiderGap = 15;
    const insiderWidth = (groups.insider.length * (cardWidth + insiderGap)) - insiderGap;
    groups.insider.forEach((node, i) => {
      cards.push({
        ...node,
        x: (width - insiderWidth) / 2 + i * (cardWidth + insiderGap),
        y: topPadding + (cardHeight + rowGap) * 2,
      });
    });

    // Position whales in third row
    const whaleGap = 15;
    const whaleWidth = (groups.whale.length * (cardWidth + whaleGap)) - whaleGap;
    groups.whale.forEach((node, i) => {
      cards.push({
        ...node,
        x: (width - whaleWidth) / 2 + i * (cardWidth + whaleGap),
        y: topPadding + (cardHeight + rowGap) * 3,
      });
    });

    // Position normals at bottom
    const normalGap = 10;
    const normalWidth = (groups.normal.length * (cardWidth + normalGap)) - normalGap;
    groups.normal.forEach((node, i) => {
      cards.push({
        ...node,
        x: Math.max(20, (width - normalWidth) / 2 + i * (cardWidth + normalGap)),
        y: height - cardHeight - 30,
      });
    });

    // Position LP on the side
    groups.lp.forEach((node, i) => {
      cards.push({
        ...node,
        x: width - cardWidth - 20,
        y: topPadding + (cardHeight + rowGap) * (i + 1),
      });
    });

    return cards;
  }, [data.nodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !cardData.length) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    // Cork board background pattern
    const defs = svg.append('defs');

    // Paper texture pattern
    const pattern = defs.append('pattern')
      .attr('id', 'corkPattern')
      .attr('width', 100)
      .attr('height', 100)
      .attr('patternUnits', 'userSpaceOnUse');

    pattern.append('rect')
      .attr('width', 100)
      .attr('height', 100)
      .attr('fill', '#1a1a1f');

    // Add subtle noise
    for (let i = 0; i < 50; i++) {
      pattern.append('circle')
        .attr('cx', Math.random() * 100)
        .attr('cy', Math.random() * 100)
        .attr('r', Math.random() * 2)
        .attr('fill', `rgba(255, 255, 255, ${Math.random() * 0.03})`);
    }

    // Background
    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'url(#corkPattern)');

    // Scale cards to fit - use larger canvas for more cards
    const canvasWidth = 1200;
    const canvasHeight = 750;
    const scaleX = width / canvasWidth;
    const scaleY = height / canvasHeight;
    const initialScale = Math.min(scaleX, scaleY, 1) * 0.9;
    const offsetX = (width - canvasWidth * initialScale) / 2;
    const offsetY = (height - canvasHeight * initialScale) / 2;

    const g = svg.append('g')
      .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${initialScale})`);

    // Add zoom/pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 2])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity.translate(offsetX, offsetY).scale(initialScale));

    const baseCardWidth = 100;
    const baseCardHeight = 60;

    // Scale card size by holdings (min 0.8x, max 1.4x)
    const getCardScale = (holdings: number | undefined) => {
      if (!holdings || holdings < 1) return 1;
      if (holdings > 20) return 1.4;
      return 1 + (holdings / 50); // Scale up based on holdings
    };

    // Create card position map
    const cardPositions = new Map<string, { x: number; y: number; scale: number }>();
    cardData.forEach(card => {
      const scale = getCardScale(card.holdingsPercent);
      const cardWidth = baseCardWidth * scale;
      const cardHeight = baseCardHeight * scale;
      cardPositions.set(card.id, {
        x: card.x + cardWidth / 2,
        y: card.y + cardHeight / 2,
        scale
      });
    });

    // Detect bundle wallets - holdings within 0.5% AND 4+ wallets in cluster
    const bundleWallets: string[] = [];

    // Get all non-token, non-lp, non-creator wallets with holdings
    const eligibleCards = cardData.filter(card =>
      card.type !== 'token' && card.type !== 'lp' && card.type !== 'creator' && card.holdingsPercent && card.holdingsPercent > 0.5
    );

    // Group wallets by similar holdings (within 0.5%)
    const clusters: Map<string, string[]> = new Map();

    eligibleCards.forEach(card => {
      const holdings = card.holdingsPercent || 0;
      // Round to nearest 0.5% to find cluster key
      const clusterKey = (Math.round(holdings / 0.5) * 0.5).toFixed(1);

      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, []);
      }
      clusters.get(clusterKey)!.push(card.id);
    });

    // Only mark as bundle if cluster has 4+ wallets (coordinated buying)
    clusters.forEach((walletIds) => {
      if (walletIds.length >= 4) {
        walletIds.forEach(id => {
          if (!bundleWallets.includes(id)) bundleWallets.push(id);
        });
      }
    });

    // Add pulsing glow filter for high-risk
    const glowFilter = defs.append('filter')
      .attr('id', 'riskGlow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');

    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '4')
      .attr('result', 'coloredBlur');

    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Draw bundle connections (dotted lines between wallets with similar holdings)
    // Connect each bundle wallet to its nearest neighbor to create a visual chain
    const bundleSet = new Set(bundleWallets);

    if (bundleWallets.length >= 3) {
      for (let i = 0; i < bundleWallets.length - 1; i++) {
        const pos1 = cardPositions.get(bundleWallets[i]);
        const pos2 = cardPositions.get(bundleWallets[i + 1]);
        if (!pos1 || !pos2) continue;

        g.append('line')
          .attr('x1', pos1.x)
          .attr('y1', pos1.y)
          .attr('x2', pos2.x)
          .attr('y2', pos2.y)
          .attr('stroke', '#a855f7')
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '5,3')
          .attr('stroke-opacity', 0.8);
      }

      // PROMINENT BUNDLE WARNING BANNER below title
      const bannerWidth = 320;
      const bannerX = (width - bannerWidth) / 2;

      svg.append('rect')
        .attr('x', bannerX)
        .attr('y', 48)
        .attr('width', bannerWidth)
        .attr('height', 24)
        .attr('fill', 'rgba(168, 85, 247, 0.2)')
        .attr('stroke', '#a855f7')
        .attr('stroke-width', 2)
        .attr('rx', 4);

      svg.append('text')
        .attr('x', width / 2)
        .attr('y', 65)
        .attr('text-anchor', 'middle')
        .attr('fill', '#a855f7')
        .attr('font-size', '11px')
        .attr('font-weight', '700')
        .text(`⚠ BUNDLE DETECTED: ${bundleWallets.length} coordinated wallets`);
    }

    // Draw strings (links) - red yarn effect
    data.links.forEach(link => {
      const source = cardPositions.get(link.source);
      const target = cardPositions.get(link.target);
      if (!source || !target) return;

      // Create wavy line for string effect
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const offset = (Math.random() - 0.5) * 20;

      const path = d3.path();
      path.moveTo(source.x, source.y);
      path.quadraticCurveTo(midX + offset, midY + offset, target.x, target.y);

      g.append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', linkColors[link.type] || '#ff4444')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6)
        .attr('stroke-linecap', 'round');

      // Pin at connection points
      [source, target].forEach(pos => {
        g.append('circle')
          .attr('cx', pos.x)
          .attr('cy', pos.y)
          .attr('r', 3)
          .attr('fill', '#dc2626')
          .attr('stroke', '#991b1b')
          .attr('stroke-width', 0.5);
      });
    });

    // Draw cards with dynamic sizing
    const cards = g.selectAll('.card')
      .data(cardData)
      .join('g')
      .attr('class', 'card')
      .attr('transform', d => {
        const scale = getCardScale(d.holdingsPercent);
        return `translate(${d.x}, ${d.y}) scale(${scale})`;
      });

    // Pulsing glow background for high-risk
    cards.filter(d => d.isHighRisk === true)
      .append('rect')
      .attr('x', -5)
      .attr('y', -5)
      .attr('width', baseCardWidth + 10)
      .attr('height', baseCardHeight + 10)
      .attr('fill', 'none')
      .attr('stroke', '#ff4444')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.6)
      .attr('rx', 6)
      .attr('filter', 'url(#riskGlow)')
      .style('animation', 'pulse 1.5s ease-in-out infinite');

    // Card shadow
    cards.append('rect')
      .attr('x', 2)
      .attr('y', 2)
      .attr('width', baseCardWidth)
      .attr('height', baseCardHeight)
      .attr('fill', 'rgba(0, 0, 0, 0.3)')
      .attr('rx', 3);

    // Card background (paper effect) - purple border for bundle wallets
    cards.append('rect')
      .attr('width', baseCardWidth)
      .attr('height', baseCardHeight)
      .attr('fill', d => d.isHighRisk ? '#2a1a1a' : bundleSet.has(d.id) ? '#1e1a24' : '#1e1e24')
      .attr('stroke', d => d.isHighRisk ? '#ff4444' : bundleSet.has(d.id) ? '#a855f7' : typeColors[d.type])
      .attr('stroke-width', d => d.isHighRisk ? 2.5 : bundleSet.has(d.id) ? 2 : 1.5)
      .attr('rx', 3);

    // Purple corner indicator for bundle wallets
    cards.filter(d => bundleSet.has(d.id) && !d.isHighRisk)
      .append('polygon')
      .attr('points', `0,0 0,12 12,0`)
      .attr('fill', '#a855f7');

    // Red corner for high risk
    cards.filter(d => d.isHighRisk === true)
      .append('polygon')
      .attr('points', `${baseCardWidth - 12},0 ${baseCardWidth},0 ${baseCardWidth},12`)
      .attr('fill', '#ff4444');

    // Type badge
    cards.append('rect')
      .attr('x', 3)
      .attr('y', 3)
      .attr('width', 38)
      .attr('height', 12)
      .attr('fill', d => typeColors[d.type])
      .attr('rx', 2);

    cards.append('text')
      .attr('x', 22)
      .attr('y', 11)
      .attr('text-anchor', 'middle')
      .attr('fill', '#0a0a0f')
      .attr('font-size', '6px')
      .attr('font-weight', 'bold')
      .text(d => d.type.toUpperCase());

    // Icon
    cards.append('text')
      .attr('x', baseCardWidth - 14)
      .attr('y', 14)
      .attr('font-size', '10px')
      .text(d => typeIcons[d.type]);

    // Wallet label
    cards.append('text')
      .attr('x', 5)
      .attr('y', 28)
      .attr('fill', '#e4e4e7')
      .attr('font-size', '9px')
      .attr('font-weight', '600')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(d => d.label);

    // Address
    cards.append('text')
      .attr('x', 5)
      .attr('y', 40)
      .attr('fill', '#71717a')
      .attr('font-size', '6px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(d => `${d.address.slice(0, 6)}...${d.address.slice(-4)}`);

    // Holdings
    cards.filter(d => d.holdingsPercent !== undefined && d.holdingsPercent > 0)
      .append('text')
      .attr('x', 5)
      .attr('y', 52)
      .attr('fill', d => (d.holdingsPercent || 0) > 5 ? '#ff4444' : '#71717a')
      .attr('font-size', '7px')
      .attr('font-weight', '600')
      .text(d => `${d.holdingsPercent?.toFixed(1)}%`);

    // Risk indicator
    cards.filter(d => d.isHighRisk === true)
      .append('text')
      .attr('x', baseCardWidth - 5)
      .attr('y', 52)
      .attr('text-anchor', 'end')
      .attr('fill', '#ff4444')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .text('⚠ RISK');

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f97316')
      .attr('font-size', '16px')
      .attr('font-weight', '600')
      .attr('font-family', 'Cinzel, serif')
      .text('THE INVESTIGATION');

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(20, ${height - 80})`);

    legend.append('rect')
      .attr('width', 160)
      .attr('height', 70)
      .attr('fill', 'rgba(0, 0, 0, 0.5)')
      .attr('rx', 4);

    const legendItems = [
      { color: '#ff4444', label: 'Funded', dashed: false },
      { color: '#ff9500', label: 'Created', dashed: false },
      { color: '#f97316', label: 'Holds', dashed: false },
      { color: '#a855f7', label: 'Bundle', dashed: true },
    ];

    legendItems.forEach((item, i) => {
      legend.append('line')
        .attr('x1', 10)
        .attr('y1', 15 + i * 15)
        .attr('x2', 35)
        .attr('y2', 15 + i * 15)
        .attr('stroke', item.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', item.dashed ? '4,4' : 'none');

      legend.append('text')
        .attr('x', 42)
        .attr('y', 18 + i * 15)
        .attr('fill', '#71717a')
        .attr('font-size', '10px')
        .text(item.label);
    });

  }, [cardData, data.links]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
