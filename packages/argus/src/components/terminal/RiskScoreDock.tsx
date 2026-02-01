/**
 * RiskScoreDock - Bottom action bar with risk score and buy button
 */

import React, { useState } from 'react';

interface RiskScoreDockProps {
  score: number | null;
  tokenSymbol?: string;
  onBuy?: (amount: number) => void;
  onSell?: () => void;
  isBuying?: boolean;
  hasPosition?: boolean;
  disabled?: boolean;
}

const BUY_PRESETS = [0.1, 0.25, 0.5, 1.0];

export const RiskScoreDock: React.FC<RiskScoreDockProps> = ({
  score,
  // tokenSymbol available for future use
  onBuy,
  onSell,
  isBuying,
  hasPosition,
  disabled,
}) => {
  const [selectedAmount, setSelectedAmount] = useState(0.1);
  const [customAmount, setCustomAmount] = useState('');

  const handleBuy = () => {
    const amount = customAmount ? parseFloat(customAmount) : selectedAmount;
    if (amount > 0 && onBuy) {
      onBuy(amount);
    }
  };

  const getScoreColor = (): string => {
    if (score === null) return '#666';
    if (score >= 60) return '#22C55E';
    if (score >= 40) return '#F59E0B';
    return '#EF4444';
  };

  const getScoreLabel = (): string => {
    if (score === null) return '---';
    if (score >= 60) return 'SAFE';
    if (score >= 40) return 'CAUTION';
    return 'DANGER';
  };

  return (
    <div className="bg-black border-t border-[#222] px-6 py-4 flex items-center justify-between">
      {/* Left: Risk Score */}
      <div className="flex items-center gap-6">
        <div>
          <div className="text-[0.75rem] text-[#888] uppercase mb-1">Risk Score</div>
          <div className="flex items-center gap-3">
            <span
              className="text-[2rem] font-extrabold font-mono"
              style={{ color: getScoreColor() }}
            >
              {score !== null ? score : '--'}
            </span>
            <span className="text-[1rem] text-[#666]">/ 100</span>
          </div>
        </div>

        <div
          className="px-3 py-1 rounded text-[0.8rem] font-bold uppercase font-mono"
          style={{
            backgroundColor: `${getScoreColor()}20`,
            color: getScoreColor(),
            border: `1px solid ${getScoreColor()}`,
          }}
        >
          {getScoreLabel()}
        </div>
      </div>

      {/* Center: Amount Selector */}
      <div className="flex items-center gap-3">
        <span className="text-[0.75rem] text-[#666] uppercase">Amount (SOL):</span>
        <div className="flex gap-1">
          {BUY_PRESETS.map((amount) => (
            <button
              key={amount}
              className={`px-3 py-1.5 font-mono text-[0.8rem] rounded transition-colors ${
                selectedAmount === amount && !customAmount
                  ? 'bg-[#EF4444] text-white'
                  : 'bg-[#111] text-[#888] border border-[#333] hover:border-[#EF4444] hover:text-[#EF4444]'
              }`}
              onClick={() => {
                setSelectedAmount(amount);
                setCustomAmount('');
              }}
              disabled={disabled}
            >
              {amount}
            </button>
          ))}
        </div>
        <input
          type="number"
          className="w-20 bg-[#111] border border-[#333] text-[#FAFAFA] px-2 py-1.5 font-mono text-[0.8rem] rounded outline-none focus:border-[#EF4444]"
          placeholder="Custom"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          disabled={disabled}
        />
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-3">
        {hasPosition && onSell && (
          <button
            className="bg-[#666] hover:bg-[#888] text-white px-6 py-2.5 font-mono font-bold text-[0.9rem] uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onSell}
            disabled={disabled || isBuying}
          >
            SELL
          </button>
        )}

        <button
          className="bg-[#EF4444] hover:bg-[#cc0000] text-white px-8 py-2.5 font-mono font-bold text-[0.9rem] uppercase shadow-[0_0_15px_rgba(239,68,68,0.3)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          onClick={handleBuy}
          disabled={disabled || isBuying || score === null}
        >
          {isBuying ? 'BUYING...' : hasPosition ? 'BUY MORE' : 'BUY'}
        </button>
      </div>
    </div>
  );
};

export default RiskScoreDock;
