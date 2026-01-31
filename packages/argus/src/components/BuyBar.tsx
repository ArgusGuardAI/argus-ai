/**
 * BuyBar Component
 *
 * Fixed buy/sell bar at bottom of viewport.
 * Always visible when analysis is active.
 */

import React, { useState } from 'react';

interface BuyBarProps {
  tokenSymbol: string;
  tokenAddress: string;
  signal: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'AVOID';
  score: number;
  walletLoaded: boolean;
  walletBalance: number;
  hasPosition: boolean;
  isBuying: boolean;
  isSelling: boolean;
  onBuy: (amount: number) => void;
  onSell: () => void;
}

const PRESETS = [0.05, 0.1, 0.2, 0.5, 1];

export const BuyBar: React.FC<BuyBarProps> = ({
  tokenSymbol,
  signal,
  score,
  walletLoaded,
  walletBalance,
  hasPosition,
  isBuying,
  isSelling,
  onBuy,
  onSell,
}) => {
  const [amount, setAmount] = useState(0.1);
  const [showCustom, setShowCustom] = useState(false);
  const [customValue, setCustomValue] = useState('0.1');

  const isAvoid = signal === 'AVOID';
  const canBuy = walletLoaded && walletBalance >= amount && !isBuying;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-[rgba(239,68,68,0.3)]">
      {/* Gradient accent */}
      <div className="h-[1px] bg-gradient-to-r from-[#EF4444] via-[#991B1B] to-transparent" />

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-2">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Token info + Score */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-[#fafafa] truncate">{tokenSymbol}</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: score >= 70 ? 'rgba(16,185,129,0.2)' : score >= 40 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)',
                  color: score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444',
                }}
              >
                {score}
              </span>
            </div>

            {!walletLoaded && (
              <span className="text-[9px] text-[#F59E0B]">Create wallet</span>
            )}
          </div>

          {/* Center: Amount presets */}
          <div className="hidden sm:flex items-center gap-1.5">
            {PRESETS.map(amt => (
              <button
                key={amt}
                onClick={() => { setAmount(amt); setShowCustom(false); }}
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${
                  amount === amt && !showCustom
                    ? 'bg-[#EF4444] text-white'
                    : 'bg-[#111] border border-[#1a1a1a] text-[#888] hover:text-[#fafafa]'
                }`}
              >
                {amt}
              </button>
            ))}
            {showCustom ? (
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={customValue}
                onChange={(e) => {
                  setCustomValue(e.target.value);
                  const val = parseFloat(e.target.value);
                  if (val > 0) setAmount(val);
                }}
                className="w-14 px-1.5 py-1 rounded text-[10px] font-semibold bg-[#111] border border-[#EF4444] text-white text-center outline-none"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setShowCustom(true)}
                className="px-2 py-1 rounded text-[10px] font-semibold bg-[#111] border border-[#1a1a1a] text-[#888] hover:text-[#fafafa] transition-all"
              >
                Custom
              </button>
            )}
            <span className="text-[10px] text-[#666]">SOL</span>
          </div>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-1.5">
            {hasPosition && (
              <button
                onClick={onSell}
                disabled={!walletLoaded || isSelling}
                className="px-3 sm:px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-red-600 to-red-700 text-white disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-red-500/20"
              >
                {isSelling ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    ...
                  </span>
                ) : 'Sell'}
              </button>
            )}
            <button
              onClick={() => onBuy(amount)}
              disabled={!canBuy}
              className={`px-4 sm:px-8 py-2 rounded-lg text-xs font-bold transition-all hover:shadow-lg ${
                isAvoid
                  ? 'bg-gradient-to-r from-red-600 to-red-700 text-white hover:shadow-red-500/20'
                  : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:shadow-emerald-500/20'
              } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
            >
              {isBuying ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  ...
                </span>
              ) : (
                <>
                  <span className="sm:hidden">Buy</span>
                  <span className="hidden sm:inline">Buy {tokenSymbol}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BuyBar;
