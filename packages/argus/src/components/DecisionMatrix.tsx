/**
 * Decision Matrix
 * Mission control-style dashboard with grid showing all AI factors,
 * live values, thresholds, and status indicators
 */
import { useEffect, useState } from 'react';
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
  tokenSymbol?: string;
  liquidity?: number;
  volume24h?: number;
  holders?: number;
}

interface MatrixCell {
  id: string;
  label: string;
  value: string | number;
  status: 'normal' | 'warning' | 'critical' | 'good' | 'inactive';
  threshold?: string;
  icon: string;
  description: string;
}

// Status indicator bar
function StatusBar({ value, max, color, threshold }: {
  value: number;
  max: number;
  color: string;
  threshold?: number;
}) {
  const percentage = Math.min(100, (value / max) * 100);
  const isAboveThreshold = threshold !== undefined && value >= threshold;

  return (
    <div className="relative h-2 bg-argus-bg rounded-full overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
        style={{
          width: `${percentage}%`,
          backgroundColor: isAboveThreshold ? '#ef4444' : color,
        }}
      />
      {threshold !== undefined && (
        <div
          className="absolute inset-y-0 w-0.5 bg-white/50"
          style={{ left: `${(threshold / max) * 100}%` }}
        />
      )}
    </div>
  );
}

// Matrix cell component
function Cell({ cell, size = 'normal' }: { cell: MatrixCell; size?: 'normal' | 'large' }) {
  const statusColors = {
    normal: 'border-argus-border bg-argus-card',
    warning: 'border-orange-500/50 bg-orange-500/10',
    critical: 'border-red-500/50 bg-red-500/10',
    good: 'border-green-500/50 bg-green-500/10',
    inactive: 'border-argus-border bg-argus-card opacity-50',
  };

  const statusTextColors = {
    normal: 'text-white',
    warning: 'text-orange-400',
    critical: 'text-red-400',
    good: 'text-green-400',
    inactive: 'text-zinc-500',
  };

  const statusIconColors = {
    normal: 'text-argus-accent',
    warning: 'text-orange-400',
    critical: 'text-red-400',
    good: 'text-green-400',
    inactive: 'text-zinc-600',
  };

  return (
    <div className={`rounded-lg border p-3 ${statusColors[cell.status]} ${size === 'large' ? 'col-span-2' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <i className={`fa-solid ${cell.icon} ${statusIconColors[cell.status]}`} />
          <span className="text-xs text-zinc-500 uppercase tracking-wide">{cell.label}</span>
        </div>
        {cell.status === 'critical' && (
          <span className="flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
        )}
      </div>
      <div className={`text-xl font-bold ${statusTextColors[cell.status]} font-mono`}>
        {cell.value}
      </div>
      {cell.threshold && (
        <div className="text-xs text-zinc-600 mt-1">
          Threshold: {cell.threshold}
        </div>
      )}
      <div className="text-xs text-zinc-500 mt-2 leading-tight">
        {cell.description}
      </div>
    </div>
  );
}

export function DecisionMatrix({
  riskScore,
  riskLevel,
  bundleInfo,
  currentPrice,
  entryPrice,
  pnl,
  aiEnabled,
  aiSettings,
  tokenSymbol = 'TOKEN',
  liquidity = 0,
  volume24h = 0,
  holders = 0,
}: Props) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Build matrix cells
  const cells: MatrixCell[] = [
    {
      id: 'risk',
      label: 'Risk Level',
      value: `${riskLevel} (${riskScore})`,
      status: riskScore >= 80 ? 'critical' : riskScore >= 60 ? 'warning' : riskScore >= 40 ? 'normal' : 'good',
      threshold: '70',
      icon: 'fa-shield-halved',
      description: riskScore >= 70 ? 'High risk - AI may trigger protection' : 'Within acceptable range',
    },
    {
      id: 'bundle',
      label: 'Bundle Detection',
      value: bundleInfo.detected ? `${bundleInfo.confidence} (${bundleInfo.count})` : 'CLEAR',
      status: bundleInfo.confidence === 'HIGH' ? 'critical' :
              bundleInfo.confidence === 'MEDIUM' ? 'warning' :
              bundleInfo.detected ? 'normal' : 'good',
      icon: 'fa-people-group',
      description: bundleInfo.detected
        ? `${bundleInfo.count} coordinated wallets detected`
        : 'No coordination patterns found',
    },
    {
      id: 'pnl',
      label: 'P&L',
      value: entryPrice ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '---',
      status: !entryPrice ? 'inactive' :
              pnl >= aiSettings.takeProfitPercent ? 'good' :
              pnl <= -aiSettings.stopLossPercent ? 'critical' :
              pnl >= aiSettings.takeProfitPercent * 0.8 ? 'warning' :
              pnl <= -aiSettings.stopLossPercent * 0.8 ? 'warning' : 'normal',
      icon: 'fa-chart-line',
      description: !entryPrice ? 'No position' :
                   pnl >= aiSettings.takeProfitPercent ? 'Target reached!' :
                   pnl >= 0 ? 'In profit' : 'In loss',
    },
    {
      id: 'takeprofit',
      label: 'Take Profit',
      value: `+${aiSettings.takeProfitPercent}%`,
      status: pnl >= aiSettings.takeProfitPercent ? 'good' : 'normal',
      icon: 'fa-bullseye',
      description: entryPrice
        ? `Target: $${(entryPrice * (1 + aiSettings.takeProfitPercent / 100)).toPrecision(4)}`
        : 'Set entry to calculate target',
    },
    {
      id: 'stoploss',
      label: 'Stop Loss',
      value: `-${aiSettings.stopLossPercent}%`,
      status: pnl <= -aiSettings.stopLossPercent ? 'critical' :
              pnl <= -aiSettings.stopLossPercent * 0.8 ? 'warning' : 'normal',
      icon: 'fa-hand',
      description: entryPrice
        ? `Trigger: $${(entryPrice * (1 - aiSettings.stopLossPercent / 100)).toPrecision(4)}`
        : 'Set entry to calculate trigger',
    },
    {
      id: 'rugprotection',
      label: 'Rug Protection',
      value: aiSettings.rugProtection ? 'ACTIVE' : 'OFF',
      status: aiSettings.rugProtection ? 'good' : 'inactive',
      icon: 'fa-shield-virus',
      description: aiSettings.rugProtection
        ? 'Re-analyzing risk every 30s'
        : 'Enable for automatic rug detection',
    },
    {
      id: 'price',
      label: 'Current Price',
      value: currentPrice ? `$${currentPrice.toPrecision(4)}` : '---',
      status: 'normal',
      icon: 'fa-dollar-sign',
      description: 'Live price from Helius + DexScreener',
    },
    {
      id: 'entry',
      label: 'Entry Price',
      value: entryPrice ? `$${entryPrice.toPrecision(4)}` : '---',
      status: entryPrice ? 'normal' : 'inactive',
      icon: 'fa-location-crosshairs',
      description: entryPrice ? 'Your average entry' : 'No entry recorded',
    },
  ];

  // Determine overall system status
  const systemStatus = !aiEnabled ? 'OFFLINE' :
                       cells.some(c => c.status === 'critical') ? 'ALERT' :
                       cells.some(c => c.status === 'warning') ? 'CAUTION' : 'NOMINAL';

  const systemStatusColor = systemStatus === 'ALERT' ? 'text-red-400' :
                           systemStatus === 'CAUTION' ? 'text-orange-400' :
                           systemStatus === 'OFFLINE' ? 'text-zinc-500' : 'text-green-400';

  return (
    <div className="h-full bg-argus-bg flex flex-col overflow-hidden">
      {/* Header - Mission Control Style */}
      <div className="border-b border-argus-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                systemStatus === 'ALERT' ? 'bg-red-500 animate-pulse' :
                systemStatus === 'CAUTION' ? 'bg-orange-500 animate-pulse' :
                systemStatus === 'OFFLINE' ? 'bg-zinc-600' : 'bg-green-500'
              }`} />
              <span className={`text-sm font-bold ${systemStatusColor}`}>
                SYSTEM {systemStatus}
              </span>
            </div>
            <span className="text-zinc-600">|</span>
            <span className="text-xs text-zinc-500 font-mono">
              {time.toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-zinc-500">
              <i className="fa-solid fa-microchip mr-1" />
              ARGUS v2.0
            </span>
            <span className={`px-2 py-0.5 rounded ${aiEnabled ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'}`}>
              AI {aiEnabled ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      {/* Matrix Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-4 gap-3">
          {cells.map(cell => (
            <Cell key={cell.id} cell={cell} />
          ))}
        </div>

        {/* Progress Bars Section */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="bg-argus-card rounded-lg p-4 border border-argus-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500">RISK METER</span>
              <span className={`text-sm font-bold ${
                riskScore >= 70 ? 'text-red-400' : riskScore >= 40 ? 'text-orange-400' : 'text-green-400'
              }`}>{riskScore}/100</span>
            </div>
            <StatusBar value={riskScore} max={100} color="#f97316" threshold={70} />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>SAFE</span>
              <span>SUSPICIOUS</span>
              <span>DANGEROUS</span>
              <span>SCAM</span>
            </div>
          </div>

          <div className="bg-argus-card rounded-lg p-4 border border-argus-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500">PROFIT PROGRESS</span>
              <span className={`text-sm font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {entryPrice ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%` : '---'}
              </span>
            </div>
            <StatusBar
              value={Math.max(0, pnl)}
              max={aiSettings.takeProfitPercent}
              color="#22c55e"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>Entry</span>
              <span>Target +{aiSettings.takeProfitPercent}%</span>
            </div>
          </div>
        </div>

        {/* Quick Actions / Thresholds */}
        <div className="mt-4 bg-argus-card rounded-lg p-4 border border-argus-border">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Active Thresholds</div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-zinc-400">Take Profit:</span>
              <span className="text-green-400 font-mono">+{aiSettings.takeProfitPercent}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-zinc-400">Stop Loss:</span>
              <span className="text-red-400 font-mono">-{aiSettings.stopLossPercent}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${aiSettings.rugProtection ? 'bg-argus-accent' : 'bg-zinc-600'}`} />
              <span className="text-zinc-400">Rug Protect:</span>
              <span className={aiSettings.rugProtection ? 'text-argus-accent' : 'text-zinc-500'}>
                {aiSettings.rugProtection ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Status Bar */}
      <div className="border-t border-argus-border px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4 text-zinc-500">
          <span><i className="fa-solid fa-coins mr-1" />{tokenSymbol}</span>
          {liquidity > 0 && <span>LIQ: ${(liquidity / 1000).toFixed(0)}K</span>}
          {volume24h > 0 && <span>VOL: ${(volume24h / 1000).toFixed(0)}K</span>}
          {holders > 0 && <span>HOLDERS: {holders}</span>}
        </div>
        <div className="flex items-center gap-2 text-zinc-600">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span>Live</span>
        </div>
      </div>
    </div>
  );
}
