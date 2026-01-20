import { X, Shield, Zap, Target, TrendingUp, Layers, Timer, Rocket } from 'lucide-react';
import { useState } from 'react';
import type { SniperConfig } from '../types';

interface SettingsProps {
  config: SniperConfig;
  onUpdate: (config: Partial<SniperConfig>) => void;
  onClose: () => void;
}

export function Settings({ config, onUpdate, onClose }: SettingsProps) {
  const [localConfig, setLocalConfig] = useState(config);
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');

  const handleSave = () => {
    onUpdate(localConfig);
    onClose();
  };

  const updateField = <K extends keyof SniperConfig>(field: K, value: SniperConfig[K]) => {
    setLocalConfig((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-dark-900 cyber-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
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

        {/* Tabs */}
        <div className="px-6 pt-4 flex gap-2 border-b border-dark-700">
          <button
            onClick={() => setActiveTab('basic')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
              activeTab === 'basic'
                ? 'bg-dark-800 text-cyber-blue border-b-2 border-cyber-blue'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Basic
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
              activeTab === 'advanced'
                ? 'bg-dark-800 text-cyber-blue border-b-2 border-cyber-blue'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Advanced Strategy
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[55vh] space-y-6">
          {activeTab === 'basic' ? (
            <>
              {/* Buy Settings */}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-cyber-blue mb-4">
                  <Zap className="w-4 h-4" />
                  Buy Settings
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Buy Amount (SOL)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={localConfig.buyAmountSol}
                      onChange={(e) => updateField('buyAmountSol', parseFloat(e.target.value) || 0)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Max Slippage (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={localConfig.maxSlippageBps / 100}
                      onChange={(e) => updateField('maxSlippageBps', (parseFloat(e.target.value) || 0) * 100)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Priority Fee (lamports)</label>
                    <input
                      type="number"
                      step="10000"
                      value={localConfig.priorityFeeLamports}
                      onChange={(e) => updateField('priorityFeeLamports', parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Max Risk Score</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={localConfig.maxRiskScore}
                      onChange={(e) => updateField('maxRiskScore', parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Safety Filters */}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-cyber-blue mb-4">
                  <Shield className="w-4 h-4" />
                  Safety Filters
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Min Liquidity (USD)</label>
                    <input
                      type="number"
                      step="100"
                      value={localConfig.minLiquidityUsd}
                      onChange={(e) => updateField('minLiquidityUsd', parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localConfig.allowPumpFun}
                        onChange={(e) => updateField('allowPumpFun', e.target.checked)}
                        className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-cyber-blue"
                      />
                      <span className="text-sm text-gray-300">Pump.fun</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localConfig.allowRaydium}
                        onChange={(e) => updateField('allowRaydium', e.target.checked)}
                        className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-cyber-blue"
                      />
                      <span className="text-sm text-gray-300">Raydium</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Basic Exit Strategy */}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-cyber-blue mb-4">
                  <Target className="w-4 h-4" />
                  Exit Strategy
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Take Profit (%)</label>
                    <input
                      type="number"
                      step="10"
                      value={localConfig.takeProfitPercent}
                      onChange={(e) => updateField('takeProfitPercent', parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-green-400 focus:border-green-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Stop Loss (%)</label>
                    <input
                      type="number"
                      step="5"
                      value={localConfig.stopLossPercent}
                      onChange={(e) => updateField('stopLossPercent', parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-red-400 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Max Hold (min)</label>
                    <input
                      type="number"
                      step="15"
                      value={localConfig.maxHoldTimeMinutes}
                      onChange={(e) => updateField('maxHoldTimeMinutes', parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white focus:border-cyber-blue focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Tiered Buy Strategy */}
              <div className="cyber-border rounded-xl p-4 bg-dark-800/30">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-cyber-blue">
                    <Layers className="w-4 h-4" />
                    Tiered Buy Strategy
                  </h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localConfig.enableTieredBuys}
                      onChange={(e) => updateField('enableTieredBuys', e.target.checked)}
                      className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-cyber-blue"
                    />
                    <span className="text-xs text-gray-400">Enabled</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 mb-4">Adjust buy amount based on risk score. Lower risk = bigger position.</p>
                <div className={`grid grid-cols-2 gap-3 ${!localConfig.enableTieredBuys ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Low Risk Threshold</label>
                    <input
                      type="number"
                      value={localConfig.tierLowRisk}
                      onChange={(e) => updateField('tierLowRisk', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-white text-sm"
                    />
                    <p className="text-[10px] text-green-400 mt-1">0-{localConfig.tierLowRisk}: 100% buy</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Medium Risk Threshold</label>
                    <input
                      type="number"
                      value={localConfig.tierMediumRisk}
                      onChange={(e) => updateField('tierMediumRisk', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-white text-sm"
                    />
                    <p className="text-[10px] text-yellow-400 mt-1">{localConfig.tierLowRisk + 1}-{localConfig.tierMediumRisk}: {(localConfig.tierMediumMultiplier * 100).toFixed(0)}% buy</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Medium Multiplier</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={localConfig.tierMediumMultiplier}
                      onChange={(e) => updateField('tierMediumMultiplier', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-yellow-400 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">High Risk Multiplier</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={localConfig.tierHighMultiplier}
                      onChange={(e) => updateField('tierHighMultiplier', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-orange-400 text-sm"
                    />
                    <p className="text-[10px] text-orange-400 mt-1">{localConfig.tierMediumRisk + 1}-{localConfig.maxRiskScore}: {(localConfig.tierHighMultiplier * 100).toFixed(0)}% buy</p>
                  </div>
                </div>
              </div>

              {/* Scale Out Strategy */}
              <div className="cyber-border rounded-xl p-4 bg-dark-800/30">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-green-400">
                    <TrendingUp className="w-4 h-4" />
                    Scale Out (Partial Takes)
                  </h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localConfig.enableScaleOut}
                      onChange={(e) => updateField('enableScaleOut', e.target.checked)}
                      className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-green-400"
                    />
                    <span className="text-xs text-gray-400">Enabled</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 mb-4">Lock in profits progressively. Sell portions at different profit levels.</p>
                <div className={`space-y-3 ${!localConfig.enableScaleOut ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span className="text-xs text-gray-400">TP1:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={localConfig.scaleOut1Percent}
                        onChange={(e) => updateField('scaleOut1Percent', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 bg-dark-900 border border-dark-600 rounded text-green-400 text-sm"
                      />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                    <span className="text-xs text-gray-400 text-center">@ +</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={localConfig.scaleOut1Target}
                        onChange={(e) => updateField('scaleOut1Target', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 bg-dark-900 border border-dark-600 rounded text-white text-sm"
                      />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span className="text-xs text-gray-400">TP2:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={localConfig.scaleOut2Percent}
                        onChange={(e) => updateField('scaleOut2Percent', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 bg-dark-900 border border-dark-600 rounded text-green-400 text-sm"
                      />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                    <span className="text-xs text-gray-400 text-center">@ +</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={localConfig.scaleOut2Target}
                        onChange={(e) => updateField('scaleOut2Target', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 bg-dark-900 border border-dark-600 rounded text-white text-sm"
                      />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span className="text-xs text-gray-400">TP3:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={localConfig.scaleOut3Percent}
                        onChange={(e) => updateField('scaleOut3Percent', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 bg-dark-900 border border-dark-600 rounded text-green-400 text-sm"
                      />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                    <span className="text-xs text-gray-400 text-center">@ +</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={localConfig.scaleOut3Target}
                        onChange={(e) => updateField('scaleOut3Target', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 bg-dark-900 border border-dark-600 rounded text-white text-sm"
                      />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500">Remaining {100 - localConfig.scaleOut1Percent - localConfig.scaleOut2Percent - localConfig.scaleOut3Percent}% rides with trailing stop or final TP</p>
                </div>
              </div>

              {/* Trailing Stop */}
              <div className="cyber-border rounded-xl p-4 bg-dark-800/30">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-amber-400">
                    <Target className="w-4 h-4" />
                    Trailing Stop Loss
                  </h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localConfig.enableTrailingStop}
                      onChange={(e) => updateField('enableTrailingStop', e.target.checked)}
                      className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-amber-400"
                    />
                    <span className="text-xs text-gray-400">Enabled</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 mb-4">Lock in gains as price rises. Stop follows peak price at set distance.</p>
                <div className={`grid grid-cols-2 gap-3 ${!localConfig.enableTrailingStop ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Activation (% profit)</label>
                    <input
                      type="number"
                      value={localConfig.trailingStopActivation}
                      onChange={(e) => updateField('trailingStopActivation', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-white text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Trailing starts after +{localConfig.trailingStopActivation}%</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Trail Distance (%)</label>
                    <input
                      type="number"
                      value={localConfig.trailingStopDistance}
                      onChange={(e) => updateField('trailingStopDistance', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-amber-400 text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Stop trails {localConfig.trailingStopDistance}% below peak</p>
                  </div>
                </div>
              </div>

              {/* Quick Flip Mode */}
              <div className="cyber-border rounded-xl p-4 bg-dark-800/30">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="flex items-center gap-2 text-sm font-cyber font-medium text-purple-400">
                    <Rocket className="w-4 h-4" />
                    Quick Flip Mode
                  </h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localConfig.enableQuickFlip}
                      onChange={(e) => updateField('enableQuickFlip', e.target.checked)}
                      className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-purple-400"
                    />
                    <span className="text-xs text-gray-400">Enabled</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 mb-4">Fast in/out strategy. Exit quickly with small profit or timeout.</p>
                <div className={`grid grid-cols-2 gap-3 ${!localConfig.enableQuickFlip ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Target Profit (%)</label>
                    <input
                      type="number"
                      value={localConfig.quickFlipTarget}
                      onChange={(e) => updateField('quickFlipTarget', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-purple-400 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Timeout (seconds)</label>
                    <input
                      type="number"
                      value={localConfig.quickFlipTimeout}
                      onChange={(e) => updateField('quickFlipTimeout', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-white text-sm"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 mt-2">Sells at +{localConfig.quickFlipTarget}% or exits after {localConfig.quickFlipTimeout}s if target not reached</p>
              </div>
            </>
          )}
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
