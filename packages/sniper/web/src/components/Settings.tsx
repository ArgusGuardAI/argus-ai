import { X, Shield, Zap, Target } from 'lucide-react';
import { useState } from 'react';
import type { SniperConfig } from '../types';

interface SettingsProps {
  config: SniperConfig;
  onUpdate: (config: Partial<SniperConfig>) => void;
  onClose: () => void;
}

export function Settings({ config, onUpdate, onClose }: SettingsProps) {
  const [localConfig, setLocalConfig] = useState(config);

  const handleSave = () => {
    onUpdate(localConfig);
    onClose();
  };

  const updateField = <K extends keyof SniperConfig>(field: K, value: SniperConfig[K]) => {
    setLocalConfig((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-dark-900 cyber-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-cyber-blue/20 flex items-center justify-between">
          <h2 className="text-lg font-cyber font-semibold gradient-text">Sniper Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
          {/* Buy Settings */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-cyber-blue mb-4">
              <Zap className="w-4 h-4" />
              Buy Settings
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Buy Amount (SOL)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={localConfig.buyAmountSol}
                  onChange={(e) => updateField('buyAmountSol', parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Max Slippage (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={localConfig.maxSlippageBps / 100}
                  onChange={(e) => updateField('maxSlippageBps', (parseFloat(e.target.value) || 0) * 100)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Priority Fee (lamports)
                </label>
                <input
                  type="number"
                  step="10000"
                  value={localConfig.priorityFeeLamports}
                  onChange={(e) => updateField('priorityFeeLamports', parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Safety Filters */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-cyber-blue mb-4">
              <Shield className="w-4 h-4" />
              Safety Filters (WhaleShield)
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Max Risk Score (0-100)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={localConfig.maxRiskScore}
                  onChange={(e) => updateField('maxRiskScore', parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none transition-colors"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Only snipe tokens with risk score below this value
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Min Liquidity (USD)
                </label>
                <input
                  type="number"
                  step="100"
                  value={localConfig.minLiquidityUsd}
                  onChange={(e) => updateField('minLiquidityUsd', parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none transition-colors"
                />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localConfig.allowPumpFun}
                    onChange={(e) => updateField('allowPumpFun', e.target.checked)}
                    className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-cyber-blue focus:ring-cyber-blue focus:ring-offset-0"
                  />
                  <span className="text-sm text-gray-300">Pump.fun</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localConfig.allowRaydium}
                    onChange={(e) => updateField('allowRaydium', e.target.checked)}
                    className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-cyber-blue focus:ring-cyber-blue focus:ring-offset-0"
                  />
                  <span className="text-sm text-gray-300">Raydium</span>
                </label>
              </div>
            </div>
          </div>

          {/* Exit Strategy */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-cyber-blue mb-4">
              <Target className="w-4 h-4" />
              Exit Strategy
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Take Profit (%)
                  </label>
                  <input
                    type="number"
                    step="10"
                    value={localConfig.takeProfitPercent}
                    onChange={(e) => updateField('takeProfitPercent', parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-green-400 focus:border-green-500 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Stop Loss (%)
                  </label>
                  <input
                    type="number"
                    step="5"
                    value={localConfig.stopLossPercent}
                    onChange={(e) => updateField('stopLossPercent', parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-red-400 focus:border-red-500 focus:outline-none transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Max Hold Time (minutes)
                </label>
                <input
                  type="number"
                  step="15"
                  value={localConfig.maxHoldTimeMinutes}
                  onChange={(e) => updateField('maxHoldTimeMinutes', parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-cyber-blue/20 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors border border-dark-600"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 px-4 bg-cyber-blue/20 hover:bg-cyber-blue/30 text-cyber-blue rounded-lg font-medium transition-all border border-cyber-blue/30 hover:border-cyber-blue/50"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
