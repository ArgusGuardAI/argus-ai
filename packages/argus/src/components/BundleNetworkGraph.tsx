import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface BundleWallet {
  address: string;
  percent: number;
  isHolder: boolean;
}

interface BundleNetworkGraphProps {
  tokenSymbol: string;
  tokenAddress: string;
  wallets: BundleWallet[];
  controlPercent: number;
  onClose: () => void;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'token' | 'wallet';
  label: string;
  percent?: number;
  isHolder?: boolean;
  radius: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export function BundleNetworkGraph({
  tokenSymbol,
  tokenAddress: _tokenAddress,
  wallets,
  controlPercent,
  onClose
}: BundleNetworkGraphProps) {
  void _tokenAddress; // Reserved for future use (e.g., linking to explorer)
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 });

  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setDimensions({ width: Math.max(width - 40, 400), height: Math.max(height - 100, 400) });
    }
  }, []);

  useEffect(() => {
    if (!svgRef.current || wallets.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;
    const centerX = width / 2;
    const centerY = height / 2;

    // Create nodes: token center + wallet nodes
    const nodes: GraphNode[] = [
      {
        id: 'token',
        type: 'token',
        label: `$${tokenSymbol}`,
        radius: 40,
        fx: centerX,
        fy: centerY,
      },
      ...wallets.slice(0, 20).map((w) => ({
        id: w.address,
        type: 'wallet' as const,
        label: `${w.address.slice(0, 4)}...${w.address.slice(-4)}`,
        percent: w.percent,
        isHolder: w.isHolder,
        radius: Math.max(12, Math.min(30, 12 + (w.percent || 0) * 3)),
      })),
    ];

    // Create links: all wallets connect to token (same-block coordination)
    const links: GraphLink[] = wallets.slice(0, 20).map(w => ({
      source: 'token',
      target: w.address,
    }));

    // Create force simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(centerX, centerY))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => d.radius + 10));

    // Create container group
    const g = svg.append('g');

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Create gradient definitions
    const defs = svg.append('defs');

    // Red glow gradient for holders
    const holderGradient = defs.append('radialGradient')
      .attr('id', 'holder-gradient');
    holderGradient.append('stop').attr('offset', '0%').attr('stop-color', '#ef4444');
    holderGradient.append('stop').attr('offset', '100%').attr('stop-color', '#7f1d1d');

    // Gray gradient for sold
    const soldGradient = defs.append('radialGradient')
      .attr('id', 'sold-gradient');
    soldGradient.append('stop').attr('offset', '0%').attr('stop-color', '#71717a');
    soldGradient.append('stop').attr('offset', '100%').attr('stop-color', '#3f3f46');

    // Token gradient
    const tokenGradient = defs.append('radialGradient')
      .attr('id', 'token-gradient');
    tokenGradient.append('stop').attr('offset', '0%').attr('stop-color', '#10b981');
    tokenGradient.append('stop').attr('offset', '100%').attr('stop-color', '#064e3b');

    // Draw links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#3f3f46')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    // Draw nodes
    const node = g.append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
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
          if (d.type !== 'token') {
            d.fx = null;
            d.fy = null;
          }
        }));

    // Add circles
    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => {
        if (d.type === 'token') return 'url(#token-gradient)';
        return d.isHolder ? 'url(#holder-gradient)' : 'url(#sold-gradient)';
      })
      .attr('stroke', d => {
        if (d.type === 'token') return '#34d399';
        return d.isHolder ? '#f87171' : '#52525b';
      })
      .attr('stroke-width', 2);

    // Add labels
    node.append('text')
      .text(d => d.label)
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.type === 'token' ? 4 : -d.radius - 6)
      .attr('fill', d => d.type === 'token' ? '#fff' : '#a1a1aa')
      .attr('font-size', d => d.type === 'token' ? 14 : 10)
      .attr('font-weight', d => d.type === 'token' ? 'bold' : 'normal')
      .attr('font-family', 'JetBrains Mono, monospace');

    // Add percentage labels for wallets
    node.filter(d => d.type === 'wallet' && d.isHolder === true)
      .append('text')
      .text(d => `${(d.percent || 0).toFixed(1)}%`)
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('fill', '#fff')
      .attr('font-size', 9)
      .attr('font-weight', 'bold')
      .attr('font-family', 'JetBrains Mono, monospace');

    // Add "sold" label for non-holders
    node.filter(d => d.type === 'wallet' && d.isHolder === false)
      .append('text')
      .text('sold')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('fill', '#71717a')
      .attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono, monospace');

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x || 0)
        .attr('y1', d => (d.source as GraphNode).y || 0)
        .attr('x2', d => (d.target as GraphNode).x || 0)
        .attr('y2', d => (d.target as GraphNode).y || 0);

      node.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [wallets, tokenSymbol, dimensions]);

  const holdersCount = wallets.filter(w => w.isHolder).length;
  const soldCount = wallets.length - holdersCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="relative w-[90vw] max-w-4xl h-[80vh] max-h-[700px] bg-zinc-900 rounded-2xl border border-zinc-700 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/90">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Bundle Network Map
            </h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Same-block sniping coordination for ${tokenSymbol}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Graph */}
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="mx-auto"
        />

        {/* Legend */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between px-4 py-3 bg-zinc-800/90 rounded-xl border border-zinc-700">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-900 border border-emerald-400"></span>
              <span className="text-zinc-400">Token</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-gradient-to-br from-red-500 to-red-900 border border-red-400"></span>
              <span className="text-zinc-400">Holding ({holdersCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 border border-zinc-500"></span>
              <span className="text-zinc-400">Sold ({soldCount})</span>
            </div>
          </div>
          <div className="text-sm">
            <span className="text-zinc-500">Total Control:</span>
            <span className="ml-2 text-red-400 font-bold">{controlPercent.toFixed(1)}%</span>
          </div>
        </div>

        {/* Instructions */}
        <div className="absolute top-20 right-4 text-xs text-zinc-600">
          Drag nodes &bull; Scroll to zoom
        </div>
      </div>
    </div>
  );
}
