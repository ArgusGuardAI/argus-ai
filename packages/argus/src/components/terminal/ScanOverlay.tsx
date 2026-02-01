/**
 * ScanOverlay - Full-screen scanning animation
 */

import React from 'react';

interface ScanOverlayProps {
  isVisible: boolean;
  tokenAddress?: string;
  stage?: 'connecting' | 'fetching' | 'analyzing' | 'complete';
}

export const ScanOverlay: React.FC<ScanOverlayProps> = ({
  isVisible,
  tokenAddress,
  stage = 'analyzing',
}) => {
  if (!isVisible) return null;

  const getStageText = (): string => {
    switch (stage) {
      case 'connecting':
        return 'CONNECTING TO BLOCKCHAIN...';
      case 'fetching':
        return 'FETCHING TOKEN DATA...';
      case 'analyzing':
        return 'ANALYZING CONTRACT...';
      case 'complete':
        return 'ANALYSIS COMPLETE';
      default:
        return 'SCANNING...';
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(0,0,0,0.9)] flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="text-center">
        {/* Scanning Animation */}
        <div className="relative w-32 h-32 mx-auto mb-6">
          {/* Outer ring */}
          <div className="absolute inset-0 border-4 border-[#EF4444] rounded-full opacity-20" />

          {/* Spinning ring */}
          <div
            className="absolute inset-0 border-4 border-transparent border-t-[#EF4444] rounded-full animate-spin"
            style={{ animationDuration: '1s' }}
          />

          {/* Inner pulse */}
          <div className="absolute inset-4 bg-[#EF4444] rounded-full opacity-20 animate-pulse" />

          {/* Center icon - Argus Eye */}
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              className="w-12 h-12 text-[#EF4444]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {/* Eye outline */}
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
              {/* Pupil */}
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        </div>

        {/* Status Text */}
        <div className="text-[#EF4444] text-xl font-mono font-bold animate-pulse mb-2">
          {getStageText()}
        </div>

        {/* Token Address */}
        {tokenAddress && (
          <div className="text-[#666] font-mono text-sm">
            {tokenAddress.slice(0, 8)}...{tokenAddress.slice(-8)}
          </div>
        )}

        {/* Progress dots */}
        <div className="flex justify-center gap-1 mt-4">
          <div
            className={`w-2 h-2 rounded-full ${
              stage === 'connecting' || stage === 'fetching' || stage === 'analyzing' || stage === 'complete'
                ? 'bg-[#EF4444]'
                : 'bg-[#333]'
            }`}
          />
          <div
            className={`w-2 h-2 rounded-full ${
              stage === 'fetching' || stage === 'analyzing' || stage === 'complete'
                ? 'bg-[#EF4444]'
                : 'bg-[#333]'
            }`}
          />
          <div
            className={`w-2 h-2 rounded-full ${
              stage === 'analyzing' || stage === 'complete' ? 'bg-[#EF4444]' : 'bg-[#333]'
            }`}
          />
          <div
            className={`w-2 h-2 rounded-full ${stage === 'complete' ? 'bg-[#EF4444]' : 'bg-[#333]'}`}
          />
        </div>

        {/* Agent status during scan */}
        <div className="mt-6 text-[0.7rem] text-[#555] font-mono space-y-1">
          <div className={stage !== 'connecting' ? 'text-[#DC2626]' : 'animate-pulse'}>
            [SCOUT] {stage === 'connecting' ? 'Initializing...' : 'Connected'}
          </div>
          <div className={stage === 'fetching' || stage === 'analyzing' || stage === 'complete' ? 'text-[#DC2626]' : 'text-[#333]'}>
            [ANALYST] {stage === 'fetching' ? 'Fetching data...' : stage === 'analyzing' || stage === 'complete' ? 'Analysis running' : 'Standby'}
          </div>
          <div className={stage === 'analyzing' || stage === 'complete' ? 'text-[#F59E0B]' : 'text-[#333]'}>
            [HUNTER] {stage === 'analyzing' ? 'Checking bundles...' : stage === 'complete' ? 'Scan complete' : 'Standby'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScanOverlay;
