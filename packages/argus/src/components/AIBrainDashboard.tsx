/**
 * AI Brain Dashboard
 * Central AI status with real-time decision factors, risk gauges, and live activity feed
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
  aiLog: Array<{ time: Date; message: string; type: 'info' | 'success' | 'warning' | 'error' }>;
  tokenSymbol?: string;
}

// Animated gauge component
function Gauge({ value, max, label, color, threshold }: {
  value: number;
  max: number;
  label: string;
  color: string;
  threshold?: number;
}) {
  const percentage = Math.min(100, (value / max) * 100);
  const isAboveThreshold = threshold !== undefined && value >= threshold;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full transform -rotate-90">
          {/* Background arc */}
          <circle
            cx="40"
            cy="40"
            r="32"
            fill="none"
            stroke="#1c252f"
            strokeWidth="8"
          />
          {/* Value arc */}
          <circle
            cx="40"
            cy="40"
            r="32"
            fill="none"
            stroke={isAboveThreshold ? '#ff4444' : color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${percentage * 2.01} 201`}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-bold ${isAboveThreshold ? 'text-red-400' : 'text-white'}`}>
            {value.toFixed(0)}
          </span>
        </div>
      </div>
      <span className="text-xs text-zinc-500 mt-1">{label}</span>
    </div>
  );
}

// Status indicator with pulse animation
function StatusIndicator({ status, label }: { status: 'active' | 'monitoring' | 'alert' | 'idle'; label: string }) {
  const colors = {
    active: 'bg-green-500',
    monitoring: 'bg-argus-accent',
    alert: 'bg-red-500',
    idle: 'bg-zinc-600',
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`relative w-3 h-3 rounded-full ${colors[status]}`}>
        {status !== 'idle' && (
          <div className={`absolute inset-0 rounded-full ${colors[status]} animate-ping opacity-75`} />
        )}
      </div>
      <span className="text-sm text-zinc-400">{label}</span>
    </div>
  );
}

export function AIBrainDashboard({
  riskScore,
  riskLevel,
  bundleInfo,
  currentPrice,
  entryPrice,
  pnl,
  aiEnabled,
  aiSettings,
  aiLog,
  tokenSymbol = 'TOKEN',
}: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const [pulsePhase, setPulsePhase] = useState(0);

  // Animate brain pulse
  useEffect(() => {
    if (!aiEnabled) return;
    const interval = setInterval(() => {
      setPulsePhase(p => (p + 1) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, [aiEnabled]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [aiLog]);

  const getAiStatus = () => {
    if (!aiEnabled) return { status: 'idle' as const, label: 'AI Disabled' };
    if (bundleInfo.detected && bundleInfo.confidence === 'HIGH') return { status: 'alert' as const, label: 'DUMP ALERT' };
    if (pnl >= aiSettings.takeProfitPercent * 0.8) return { status: 'active' as const, label: 'Near Target' };
    if (pnl <= -aiSettings.stopLossPercent * 0.8) return { status: 'alert' as const, label: 'Near Stop Loss' };
    return { status: 'monitoring' as const, label: 'Monitoring' };
  };

  const aiStatus = getAiStatus();
  const takeProfitProgress = entryPrice ? Math.max(0, Math.min(100, (pnl / aiSettings.takeProfitPercent) * 100)) : 0;
  const stopLossProgress = entryPrice ? Math.max(0, Math.min(100, (Math.abs(Math.min(0, pnl)) / aiSettings.stopLossPercent) * 100)) : 0;

  return (
    <div className="h-full flex flex-col bg-argus-bg p-4 overflow-hidden">
      {/* Header with AI Brain visualization */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          {/* Animated AI Brain */}
          <div className="relative w-16 h-16">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              {/* Outer ring */}
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke={aiEnabled ? '#f97316' : '#3d4f5f'}
                strokeWidth="2"
                strokeDasharray="8 4"
                style={{ transform: `rotate(${pulsePhase}deg)`, transformOrigin: 'center' }}
              />
              {/* Inner brain shape */}
              <path
                d="M50 15 C25 15 20 35 20 50 C20 70 35 85 50 85 C65 85 80 70 80 50 C80 35 75 15 50 15"
                fill="none"
                stroke={aiEnabled ? '#f97316' : '#3d4f5f'}
                strokeWidth="2"
              />
              {/* Neural connections */}
              {aiEnabled && (
                <>
                  <circle cx="35" cy="40" r="4" fill="#f97316" opacity={Math.sin(pulsePhase * 0.1) * 0.5 + 0.5} />
                  <circle cx="65" cy="40" r="4" fill="#f97316" opacity={Math.cos(pulsePhase * 0.1) * 0.5 + 0.5} />
                  <circle cx="50" cy="55" r="5" fill="#f97316" opacity={Math.sin(pulsePhase * 0.15) * 0.5 + 0.5} />
                  <circle cx="40" cy="65" r="3" fill="#f97316" opacity={Math.cos(pulsePhase * 0.12) * 0.5 + 0.5} />
                  <circle cx="60" cy="65" r="3" fill="#f97316" opacity={Math.sin(pulsePhase * 0.08) * 0.5 + 0.5} />
                </>
              )}
            </svg>
            {/* Status dot */}
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-argus-bg ${
              aiStatus.status === 'active' ? 'bg-green-500' :
              aiStatus.status === 'alert' ? 'bg-red-500' :
              aiStatus.status === 'monitoring' ? 'bg-argus-accent' : 'bg-zinc-600'
            }`} />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">ARGUS AI <span className="text-argus-accent">{tokenSymbol}</span></h2>
            <StatusIndicator status={aiStatus.status} label={aiStatus.label} />
          </div>
        </div>

        {/* Current Price & P&L */}
        <div className="text-right">
          <div className="text-xs text-zinc-500 uppercase">Price</div>
          <div className="text-sm font-mono text-white mb-1">
            ${currentPrice?.toPrecision(4) || '---'}
          </div>
          <div className="text-xs text-zinc-500 uppercase">P&L</div>
          <div className={`text-2xl font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Gauges row */}
      <div className="flex justify-around mb-4 py-3 bg-argus-card rounded-lg border border-argus-border">
        <Gauge value={riskScore} max={100} label="Risk Score" color="#f97316" threshold={70} />
        <Gauge value={takeProfitProgress} max={100} label="Take Profit" color="#22c55e" />
        <Gauge value={stopLossProgress} max={100} label="Stop Loss" color="#ef4444" threshold={80} />
        <Gauge value={bundleInfo.count} max={20} label="Bundle Wallets" color="#a855f7" threshold={5} />
      </div>

      {/* Decision factors grid */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-argus-card rounded-lg p-3 border border-argus-border">
          <div className="text-xs text-zinc-500 mb-1">Bundle Detection</div>
          <div className={`text-sm font-medium ${
            bundleInfo.confidence === 'HIGH' ? 'text-red-400' :
            bundleInfo.confidence === 'MEDIUM' ? 'text-orange-400' :
            bundleInfo.confidence === 'LOW' ? 'text-yellow-400' : 'text-green-400'
          }`}>
            {bundleInfo.detected ? `${bundleInfo.confidence} (${bundleInfo.count} wallets)` : 'None Detected'}
          </div>
        </div>

        <div className="bg-argus-card rounded-lg p-3 border border-argus-border">
          <div className="text-xs text-zinc-500 mb-1">Risk Level</div>
          <div className={`text-sm font-medium ${
            riskLevel === 'SCAM' ? 'text-red-400' :
            riskLevel === 'DANGEROUS' ? 'text-orange-400' :
            riskLevel === 'SUSPICIOUS' ? 'text-yellow-400' : 'text-green-400'
          }`}>
            {riskLevel}
          </div>
        </div>

        <div className="bg-argus-card rounded-lg p-3 border border-argus-border">
          <div className="text-xs text-zinc-500 mb-1">Take Profit Target</div>
          <div className="text-sm font-medium text-green-400">+{aiSettings.takeProfitPercent}%</div>
        </div>

        <div className="bg-argus-card rounded-lg p-3 border border-argus-border">
          <div className="text-xs text-zinc-500 mb-1">Stop Loss</div>
          <div className="text-sm font-medium text-red-400">-{aiSettings.stopLossPercent}%</div>
        </div>
      </div>

      {/* AI Activity Log */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-2">
          <i className="fa-solid fa-brain" />
          AI Activity Log
        </div>
        <div
          ref={logRef}
          className="flex-1 overflow-y-auto bg-argus-card rounded-lg border border-argus-border p-2 font-mono text-xs space-y-1"
        >
          {aiLog.length === 0 ? (
            <div className="text-zinc-600 italic">Enable AI to see activity...</div>
          ) : (
            aiLog.slice(-20).map((log, i) => (
              <div key={i} className={`flex gap-2 ${
                log.type === 'error' ? 'text-red-400' :
                log.type === 'warning' ? 'text-orange-400' :
                log.type === 'success' ? 'text-green-400' : 'text-zinc-400'
              }`}>
                <span className="text-zinc-600 shrink-0">
                  {log.time.toLocaleTimeString('en-US', { hour12: false })}
                </span>
                <span className="shrink-0">
                  {log.type === 'error' ? '[ERR]' :
                   log.type === 'warning' ? '[WRN]' :
                   log.type === 'success' ? '[OK]' : '[INF]'}
                </span>
                <span>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
