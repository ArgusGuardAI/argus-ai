/**
 * TerminalHeader - Dense header with SOL stats and search
 */

import React, { useState, useEffect } from 'react';

interface TerminalHeaderProps {
  walletAddress?: string;
  walletBalance?: number;
  onSearch: (address: string) => void;
  isScanning: boolean;
  onSettingsClick?: () => void;
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  walletAddress,
  walletBalance,
  onSearch,
  isScanning,
  onSettingsClick,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [solChange, setSolChange] = useState<number | null>(null);

  // Fetch SOL price
  useEffect(() => {
    const fetchSolPrice = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true');
        const data = await res.json();
        setSolPrice(data.solana?.usd || null);
        setSolChange(data.solana?.usd_24h_change || null);
      } catch {
        // Fallback
        setSolPrice(142.50);
        setSolChange(1.2);
      }
    };
    fetchSolPrice();
    const interval = setInterval(fetchSolPrice, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  const handleScan = () => {
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  return (
    <header className="h-[50px] bg-black border-b border-[#222] flex items-center px-4 justify-between text-[0.8rem]">
      {/* Left: Logo + Stats */}
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          {/* Argus Eye Logo */}
          <svg className="w-7 h-7" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 8px rgba(220, 38, 38, 0.5))' }}>
            {/* Outer triangle */}
            <path
              d="M50 8L92 85H8L50 8Z"
              stroke="#DC2626"
              strokeWidth="1.5"
              fill="none"
              opacity="0.8"
            />
            {/* Inner triangle glow */}
            <path
              d="M50 20L80 75H20L50 20Z"
              stroke="#DC2626"
              strokeWidth="0.5"
              fill="none"
              opacity="0.4"
            />
            {/* Eye outer */}
            <ellipse
              cx="50"
              cy="50"
              rx="22"
              ry="12"
              stroke="#DC2626"
              strokeWidth="1.5"
              fill="none"
            />
            {/* Eye inner glow */}
            <ellipse
              cx="50"
              cy="50"
              rx="18"
              ry="9"
              fill="rgba(220, 38, 38, 0.1)"
            />
            {/* Pupil */}
            <circle
              cx="50"
              cy="50"
              r="8"
              fill="#DC2626"
            />
            {/* Pupil inner */}
            <circle
              cx="50"
              cy="50"
              r="4"
              fill="#0A0A0A"
            />
            {/* Highlight */}
            <circle
              cx="47"
              cy="48"
              r="2"
              fill="rgba(255, 255, 255, 0.6)"
            />
          </svg>
          <div className="font-extrabold tracking-wider text-[0.9rem]">
            <span className="text-[#F0F0F0]">ARGUS</span> <span className="text-[#DC2626]">TERMINAL</span>
          </div>
        </div>

        <div className="flex gap-5 font-mono text-[#F0F0F0]">
          <div className="flex items-center gap-1">
            <span className="text-[#666]">SOL</span>
            <span className="text-[#DC2626]">${solPrice?.toFixed(2) || '---'}</span>
            {solChange !== null && (
              <span className={solChange >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                ({solChange >= 0 ? '+' : ''}{solChange.toFixed(1)}%)
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[#666]">TPS</span>
            <span>4,203</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[#666]">GAS</span>
            <span>0.000005</span>
          </div>
        </div>
      </div>

      {/* Center: Search */}
      <div className="flex-1 max-w-[500px] mx-8 relative flex items-center">
        <span className="text-[#EF4444] font-bold mr-2">&gt;</span>
        <input
          type="text"
          className="w-full bg-[#0a0a0a] border border-[#333] text-[#FAFAFA] px-4 py-2 font-mono text-[0.85rem] rounded outline-none transition-all focus:border-[#EF4444] focus:shadow-[0_0_10px_rgba(239,68,68,0.2)]"
          placeholder="Paste token address..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={isScanning}
        />
        <button
          className="absolute right-1 bg-[#EF4444] text-white border-none px-4 py-1.5 rounded-sm font-mono text-[0.7rem] font-bold uppercase cursor-pointer hover:bg-[#cc0000] disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleScan}
          disabled={isScanning || !searchQuery.trim()}
        >
          {isScanning ? 'SCANNING...' : 'SCAN'}
        </button>
      </div>

      {/* Right: Wallet + Settings */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[#666]">WALLET:</span>
          {walletAddress ? (
            <span className="font-mono text-[#DC2626]">
              {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
              {walletBalance !== undefined && (
                <span className="ml-2 text-[#888]">[{walletBalance.toFixed(2)} SOL]</span>
              )}
            </span>
          ) : (
            <span className="font-mono text-[#666]">Not Connected</span>
          )}
        </div>
        {/* Settings Button */}
        <button
          onClick={onSettingsClick}
          className="p-1.5 rounded hover:bg-[#222] transition-colors group"
          title="Wallet Settings"
        >
          <svg
            className="w-4 h-4 text-[#666] group-hover:text-[#DC2626] transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default TerminalHeader;
