/**
 * TerminalHeader - Dense header with SOL stats and search
 */

import React, { useState, useEffect } from 'react';

interface TerminalHeaderProps {
  walletAddress?: string;
  walletBalance?: number;
  onSearch: (address: string) => void;
  isScanning: boolean;
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  walletAddress,
  walletBalance,
  onSearch,
  isScanning,
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
        <div className="font-extrabold tracking-wider text-[0.9rem]">
          ARGUS <span className="text-[#00bcd4]">TERMINAL</span>
        </div>

        <div className="flex gap-5 font-mono text-[#00bcd4]">
          <div className="flex items-center gap-1">
            <span className="text-[#666]">SOL</span>
            <span>${solPrice?.toFixed(2) || '---'}</span>
            {solChange !== null && (
              <span className={solChange >= 0 ? 'text-[#00e676]' : 'text-[#ff4444]'}>
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

      {/* Right: Wallet */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-[#666]">WALLET:</span>
        {walletAddress ? (
          <span className="font-mono text-[#00bcd4]">
            {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
            {walletBalance !== undefined && (
              <span className="ml-2 text-[#888]">[{walletBalance.toFixed(2)} SOL]</span>
            )}
          </span>
        ) : (
          <span className="font-mono text-[#666]">Not Connected</span>
        )}
      </div>
    </header>
  );
};

export default TerminalHeader;
