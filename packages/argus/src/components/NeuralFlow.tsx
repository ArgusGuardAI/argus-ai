/**
 * Neural Flow Visualization
 * Animated data flow showing inputs flowing through AI 'neurons' to output decisions
 */
import { useEffect, useRef, useState } from 'react';
import type { BundleInfo } from '../types';

interface Props {
  riskScore: number;
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  bundleInfo: BundleInfo;
  currentPrice: number | null;
  entryPrice: number | null;
  pnl: number;
  aiEnabled: boolean;
  aiSettings: {
    takeProfitPercent: number;
    stopLossPercent: number;
    rugProtection: boolean;
  };
}

interface Particle {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  color: string;
  speed: number;
  stage: number;
  label?: string;
}

// Neural node component
function NeuralNode({ x, y, size, color, label, value, active, pulsing }: {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  value?: string;
  active: boolean;
  pulsing?: boolean;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Glow effect */}
      {active && (
        <circle
          r={size + 8}
          fill="none"
          stroke={color}
          strokeWidth="2"
          opacity={0.3}
          className={pulsing ? 'animate-pulse' : ''}
        />
      )}
      {/* Main node */}
      <circle
        r={size}
        fill={active ? color : '#1c252f'}
        stroke={color}
        strokeWidth="2"
        opacity={active ? 1 : 0.4}
      />
      {/* Label */}
      <text
        y={size + 16}
        textAnchor="middle"
        fill="#71717a"
        fontSize="10"
      >
        {label}
      </text>
      {/* Value */}
      {value && (
        <text
          y={4}
          textAnchor="middle"
          fill={active ? '#fff' : '#71717a'}
          fontSize="11"
          fontWeight="bold"
        >
          {value}
        </text>
      )}
    </g>
  );
}

export function NeuralFlow({
  riskScore,
  riskLevel,
  bundleInfo,
  currentPrice,
  entryPrice,
  pnl,
  aiEnabled,
  aiSettings,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [decision, setDecision] = useState<'HOLD' | 'BUY' | 'SELL' | 'ALERT'>('HOLD');
  const particleIdRef = useRef(0);

  // Determine current AI decision
  useEffect(() => {
    if (!aiEnabled) {
      setDecision('HOLD');
      return;
    }

    if (bundleInfo.detected && bundleInfo.confidence === 'HIGH') {
      setDecision('ALERT');
    } else if (pnl >= aiSettings.takeProfitPercent) {
      setDecision('SELL');
    } else if (pnl <= -aiSettings.stopLossPercent) {
      setDecision('SELL');
    } else if (riskLevel === 'SCAM' || riskLevel === 'DANGEROUS') {
      setDecision('ALERT');
    } else {
      setDecision('HOLD');
    }
  }, [aiEnabled, bundleInfo, pnl, riskScore, aiSettings]);

  // Spawn and animate particles
  useEffect(() => {
    if (!aiEnabled) return;

    const spawnParticle = () => {
      const inputs = [
        { y: 80, color: '#3b82f6', label: 'PRICE' },
        { y: 160, color: '#22c55e', label: 'P&L' },
        { y: 240, color: '#f97316', label: 'RISK' },
        { y: 320, color: '#a855f7', label: 'BUNDLE' },
      ];

      const input = inputs[Math.floor(Math.random() * inputs.length)];

      const newParticle: Particle = {
        id: particleIdRef.current++,
        x: 60,
        y: input.y,
        targetX: 200,
        targetY: 200,
        color: input.color,
        speed: 2 + Math.random() * 2,
        stage: 0,
        label: input.label,
      };

      setParticles(prev => [...prev, newParticle].slice(-30));
    };

    const interval = setInterval(spawnParticle, 300);
    return () => clearInterval(interval);
  }, [aiEnabled]);

  // Animate particles
  useEffect(() => {
    if (!aiEnabled) return;

    const animate = () => {
      setParticles(prev => prev.map(p => {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 10) {
          // Move to next stage
          if (p.stage === 0) {
            // Move from input to processing layer
            return {
              ...p,
              stage: 1,
              targetX: 350,
              targetY: 200,
            };
          } else if (p.stage === 1) {
            // Move from processing to decision layer
            return {
              ...p,
              stage: 2,
              targetX: 500,
              targetY: 200,
            };
          } else if (p.stage === 2) {
            // Move to output
            return {
              ...p,
              stage: 3,
              targetX: 620,
              targetY: decision === 'SELL' ? 120 :
                       decision === 'ALERT' ? 200 :
                       decision === 'HOLD' ? 280 : 200,
            };
          }
          // Remove when done
          return { ...p, x: -100 };
        }

        return {
          ...p,
          x: p.x + (dx / dist) * p.speed,
          y: p.y + (dy / dist) * p.speed,
        };
      }).filter(p => p.x > -50));
    };

    const animationFrame = setInterval(animate, 16);
    return () => clearInterval(animationFrame);
  }, [aiEnabled, decision]);

  const decisionColor = decision === 'SELL' ? '#ef4444' :
                        decision === 'ALERT' ? '#f97316' :
                        decision === 'BUY' ? '#22c55e' : '#3b82f6';

  return (
    <div className="h-full bg-argus-bg p-4 flex flex-col">
      {/* Title */}
      <div className="text-center mb-4">
        <h2 className="text-lg font-semibold text-argus-accent">NEURAL FLOW</h2>
        <p className="text-xs text-zinc-500">Real-time AI decision pathway</p>
      </div>

      {/* Neural network visualization */}
      <div className="flex-1 relative">
        <svg ref={svgRef} viewBox="0 0 700 400" className="w-full h-full">
          {/* Background grid */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1c252f" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Connection lines */}
          <g opacity={0.2}>
            {/* Input to Processing */}
            <line x1="80" y1="80" x2="180" y2="140" stroke="#3b82f6" strokeWidth="1" />
            <line x1="80" y1="80" x2="180" y2="200" stroke="#3b82f6" strokeWidth="1" />
            <line x1="80" y1="80" x2="180" y2="260" stroke="#3b82f6" strokeWidth="1" />

            <line x1="80" y1="160" x2="180" y2="140" stroke="#22c55e" strokeWidth="1" />
            <line x1="80" y1="160" x2="180" y2="200" stroke="#22c55e" strokeWidth="1" />
            <line x1="80" y1="160" x2="180" y2="260" stroke="#22c55e" strokeWidth="1" />

            <line x1="80" y1="240" x2="180" y2="140" stroke="#f97316" strokeWidth="1" />
            <line x1="80" y1="240" x2="180" y2="200" stroke="#f97316" strokeWidth="1" />
            <line x1="80" y1="240" x2="180" y2="260" stroke="#f97316" strokeWidth="1" />

            <line x1="80" y1="320" x2="180" y2="140" stroke="#a855f7" strokeWidth="1" />
            <line x1="80" y1="320" x2="180" y2="200" stroke="#a855f7" strokeWidth="1" />
            <line x1="80" y1="320" x2="180" y2="260" stroke="#a855f7" strokeWidth="1" />

            {/* Processing to Analysis */}
            <line x1="220" y1="140" x2="330" y2="170" stroke="#f97316" strokeWidth="1" />
            <line x1="220" y1="200" x2="330" y2="200" stroke="#f97316" strokeWidth="1" />
            <line x1="220" y1="260" x2="330" y2="230" stroke="#f97316" strokeWidth="1" />

            {/* Analysis to Decision */}
            <line x1="370" y1="170" x2="480" y2="200" stroke="#f97316" strokeWidth="1" />
            <line x1="370" y1="200" x2="480" y2="200" stroke="#f97316" strokeWidth="1" />
            <line x1="370" y1="230" x2="480" y2="200" stroke="#f97316" strokeWidth="1" />

            {/* Decision to Output */}
            <line x1="520" y1="200" x2="600" y2="120" stroke={decisionColor} strokeWidth="2" />
            <line x1="520" y1="200" x2="600" y2="200" stroke={decisionColor} strokeWidth="2" />
            <line x1="520" y1="200" x2="600" y2="280" stroke={decisionColor} strokeWidth="2" />
          </g>

          {/* Input Layer */}
          <text x="60" y="30" textAnchor="middle" fill="#71717a" fontSize="10" fontWeight="bold">INPUT</text>
          <NeuralNode x={60} y={80} size={18} color="#3b82f6" label="Price" value={currentPrice?.toFixed(6) || '---'} active={aiEnabled} />
          <NeuralNode x={60} y={160} size={18} color="#22c55e" label="P&L" value={`${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`} active={aiEnabled && entryPrice !== null} />
          <NeuralNode x={60} y={240} size={18} color="#f97316" label="Risk" value={riskScore.toString()} active={aiEnabled} pulsing={riskScore >= 70} />
          <NeuralNode x={60} y={320} size={18} color="#a855f7" label="Bundle" value={bundleInfo.confidence} active={bundleInfo.detected} pulsing={bundleInfo.confidence === 'HIGH'} />

          {/* Processing Layer */}
          <text x="200" y="30" textAnchor="middle" fill="#71717a" fontSize="10" fontWeight="bold">PROCESS</text>
          <NeuralNode x={200} y={140} size={14} color="#f97316" label="Analyze" active={aiEnabled} />
          <NeuralNode x={200} y={200} size={14} color="#f97316" label="Compare" active={aiEnabled} />
          <NeuralNode x={200} y={260} size={14} color="#f97316" label="Weight" active={aiEnabled} />

          {/* Analysis Layer */}
          <text x={350} y={30} textAnchor="middle" fill="#71717a" fontSize="10" fontWeight="bold">ANALYZE</text>
          <NeuralNode x={350} y={170} size={14} color="#f97316" label="Profit?" active={aiEnabled && pnl > 0} />
          <NeuralNode x={350} y={200} size={14} color="#f97316" label="Risk?" active={aiEnabled && riskScore > 50} />
          <NeuralNode x={350} y={230} size={14} color="#f97316" label="Dump?" active={bundleInfo.detected} />

          {/* Decision Layer */}
          <text x={500} y={30} textAnchor="middle" fill="#71717a" fontSize="10" fontWeight="bold">DECIDE</text>
          <NeuralNode x={500} y={200} size={24} color={decisionColor} label="Decision" value={decision} active={aiEnabled} pulsing={decision !== 'HOLD'} />

          {/* Output Layer */}
          <text x={620} y={30} textAnchor="middle" fill="#71717a" fontSize="10" fontWeight="bold">OUTPUT</text>
          <NeuralNode x={620} y={120} size={16} color="#ef4444" label="SELL" active={decision === 'SELL'} />
          <NeuralNode x={620} y={200} size={16} color="#f97316" label="ALERT" active={decision === 'ALERT'} />
          <NeuralNode x={620} y={280} size={16} color="#3b82f6" label="HOLD" active={decision === 'HOLD'} />

          {/* Particles */}
          {particles.map(p => (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={p.color}
              opacity={0.8}
            >
              <animate
                attributeName="opacity"
                values="0.8;0.4;0.8"
                dur="0.5s"
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </svg>

        {/* AI Status Overlay */}
        {!aiEnabled && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-center">
              <i className="fa-solid fa-brain text-4xl text-zinc-600 mb-2" />
              <p className="text-zinc-500">Enable AI to see neural flow</p>
            </div>
          </div>
        )}
      </div>

      {/* Current Decision */}
      <div className={`mt-4 py-3 px-4 rounded-lg border text-center ${
        decision === 'SELL' ? 'bg-red-500/10 border-red-500/50 text-red-400' :
        decision === 'ALERT' ? 'bg-orange-500/10 border-orange-500/50 text-orange-400' :
        decision === 'BUY' ? 'bg-green-500/10 border-green-500/50 text-green-400' :
        'bg-blue-500/10 border-blue-500/50 text-blue-400'
      }`}>
        <span className="text-xs uppercase tracking-wide">Current Decision: </span>
        <span className="font-bold text-lg">{decision}</span>
      </div>
    </div>
  );
}
