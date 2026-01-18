import { Play, Square, Settings, Zap } from 'lucide-react';
import type { SniperConfig } from '../types';

interface ControlsProps {
  status: 'stopped' | 'running' | 'paused';
  onStart: () => void;
  onStop: () => void;
  onSettings: () => void;
  config: SniperConfig;
}

export function Controls({ status, onStart, onStop, onSettings, config }: ControlsProps) {
  return (
    <div className="bg-dark-800/50 cyber-border rounded-xl p-5 card-hover">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {status === 'running' ? (
            <button
              onClick={onStop}
              className="flex items-center gap-2 px-6 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-all border border-red-500/30 hover:border-red-500/50"
            >
              <Square className="w-5 h-5" />
              Stop Sniper
            </button>
          ) : (
            <button
              onClick={onStart}
              className="flex items-center gap-2 px-6 py-3 bg-cyber-blue/20 hover:bg-cyber-blue/30 text-cyber-blue rounded-lg font-medium transition-all border border-cyber-blue/30 hover:border-cyber-blue/50 glow-pulse"
            >
              <Play className="w-5 h-5" />
              Start Sniper
            </button>
          )}

          <button
            onClick={onSettings}
            className="flex items-center gap-2 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg transition-colors border border-gray-700/50"
          >
            <Settings className="w-5 h-5" />
            Settings
          </button>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-gray-400">Buy:</span>
            <span className="text-white font-medium">{config.buyAmountSol} SOL</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-400">Max Risk:</span>
            <span className="text-white font-medium">{config.maxRiskScore}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-400">TP/SL:</span>
            <span className="text-green-400">+{config.takeProfitPercent}%</span>
            <span className="text-gray-500">/</span>
            <span className="text-red-400">-{config.stopLossPercent}%</span>
          </div>
        </div>
      </div>

      {status === 'running' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-cyber-blue">
          <div className="w-2 h-2 rounded-full bg-cyber-blue animate-pulse" />
          <span>Scanning for new tokens...</span>
        </div>
      )}
    </div>
  );
}
