/**
 * TerminalDashboard - Main hybrid dashboard layout
 *
 * 3-column layout:
 * - Left: Live transaction feed + alerts
 * - Center: Token analysis (stats, chart, forensics)
 * - Right: Wallet topology + distribution
 */

import React, { useState, useCallback } from 'react';
import { TerminalHeader } from './TerminalHeader';
import { LiveTransactionFeed } from './LiveTransactionFeed';
import { HeroStats } from './HeroStats';
import { VolumeChart } from './VolumeChart';
import { AIForensics } from './AIForensics';
import { WalletTopology } from './WalletTopology';
import { RiskScoreDock } from './RiskScoreDock';
import { ScanOverlay } from './ScanOverlay';
import { useAgentStatus } from '../../hooks/useAgentStatus';

// Types for analysis result
interface AnalysisResult {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  price: number | null;
  priceChange5m: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  liquidityStatus: 'High' | 'Medium' | 'Low' | null;
  volume24h: number | null;
  score: number;
  verdict: string;
  mintAuthority: 'Disabled' | 'Active' | null;
  freezeAuthority: 'Disabled' | 'Active' | null;
  lpLocked: boolean | null;
  lpLockedPercent?: number;
  lpLockedValue?: number; // Dollar value of locked LP
  tokenAge: string | null;
  honeypot: boolean | null;
  bundleDetected: boolean;
  bundleCount?: number;
  bundleHoldingsPercent?: number; // % of supply held by bundles
  bundleWallets?: Array<{ address: string; percent: number; isHolder: boolean }>;
  holders: Array<{
    address: string;
    percent: number;
    tags?: ('DEV' | 'SNIPER' | 'BUNDLE' | 'DEX' | 'LP' | 'BURN')[];
    label?: string;
  }>;
  top10Percent: number | null;
  top100Percent?: number;
  retailPercent?: number;
  totalHolders?: number;
  topHolderPercent?: number; // Largest single holder
}

interface TerminalDashboardProps {
  walletAddress?: string;
  walletBalance?: number;
  onAnalyze: (address: string) => Promise<AnalysisResult | null>;
  onBuy?: (tokenAddress: string, amount: number) => Promise<void>;
  onSell?: (tokenAddress: string) => Promise<void>;
  hasPosition?: boolean;
  onSettingsClick?: () => void;
}

export const TerminalDashboard: React.FC<TerminalDashboardProps> = ({
  walletAddress,
  walletBalance,
  onAnalyze,
  onBuy,
  onSell,
  hasPosition = false,
  onSettingsClick,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [scanStage, setScanStage] = useState<'connecting' | 'fetching' | 'analyzing' | 'complete'>('connecting');
  const [scanningAddress, setScanningAddress] = useState<string>('');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isBuying, setIsBuying] = useState(false);

  // Agent status for activity feed
  const { activity, clearActivity } = useAgentStatus({ enabled: true });

  const handleSearch = useCallback(async (address: string) => {
    setIsScanning(true);
    setScanningAddress(address);
    setScanStage('connecting');

    try {
      // Simulate stage progression
      await new Promise(r => setTimeout(r, 500));
      setScanStage('fetching');

      await new Promise(r => setTimeout(r, 800));
      setScanStage('analyzing');

      // Actual analysis
      const result = await onAnalyze(address);

      setScanStage('complete');
      await new Promise(r => setTimeout(r, 300));

      setAnalysisResult(result);
    } catch (error) {
      console.error('Analysis failed:', error);
      setAnalysisResult(null);
    } finally {
      setIsScanning(false);
    }
  }, [onAnalyze]);

  const handleBuy = useCallback(async (amount: number) => {
    if (!analysisResult || !onBuy) return;

    setIsBuying(true);
    try {
      await onBuy(analysisResult.tokenAddress, amount);
    } catch (error) {
      console.error('Buy failed:', error);
    } finally {
      setIsBuying(false);
    }
  }, [analysisResult, onBuy]);

  const handleSell = useCallback(async () => {
    if (!analysisResult || !onSell) return;

    try {
      await onSell(analysisResult.tokenAddress);
    } catch (error) {
      console.error('Sell failed:', error);
    }
  }, [analysisResult, onSell]);

  return (
    <div className="h-screen flex flex-col bg-[#080808] text-[#d1d1d1] font-sans overflow-hidden">
      {/* Scan Overlay */}
      <ScanOverlay
        isVisible={isScanning}
        tokenAddress={scanningAddress}
        stage={scanStage}
      />

      {/* Header */}
      <TerminalHeader
        walletAddress={walletAddress}
        walletBalance={walletBalance}
        onSearch={handleSearch}
        isScanning={isScanning}
        onSettingsClick={onSettingsClick}
      />

      {/* Main 3-Column Layout */}
      <main className="flex-1 grid grid-cols-[300px_1fr_350px] overflow-hidden">
        {/* LEFT: Transaction Feed */}
        <div className="border-r border-[#222] p-3 overflow-y-auto bg-[#080808]">
          <LiveTransactionFeed
            alerts={activity}
            onAlertClick={(alert) => {
              if (alert.data?.tokenAddress) {
                handleSearch(alert.data.tokenAddress);
              }
            }}
            onClearComms={clearActivity}
          />
        </div>

        {/* CENTER: Analysis Stage */}
        <div className="flex flex-col overflow-hidden bg-[#0b0b0b]">
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {analysisResult ? (
              <>
                {/* Token Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-[#FAFAFA]">
                      {analysisResult.tokenSymbol}
                      <span className="ml-2 text-sm text-[#666] font-normal">
                        {analysisResult.tokenName}
                      </span>
                    </h2>
                    <div className="text-[0.7rem] text-[#555] font-mono mt-1">
                      {analysisResult.tokenAddress}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold font-mono ${
                      analysisResult.score >= 60 ? 'text-[#22C55E]' :
                      analysisResult.score >= 40 ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                    }`}>
                      {analysisResult.score}/100
                    </div>
                    <div className="text-[0.7rem] text-[#666] uppercase">Safety Score</div>
                  </div>
                </div>

                {/* Hero Stats */}
                <HeroStats
                  price={analysisResult.price}
                  priceChange5m={analysisResult.priceChange5m}
                  marketCap={analysisResult.marketCap}
                  fdv={analysisResult.fdv}
                  liquidity={analysisResult.liquidity}
                  liquidityStatus={analysisResult.liquidityStatus}
                  top10Percent={analysisResult.top10Percent}
                />

                {/* Volume Chart */}
                <VolumeChart />

                {/* AI Forensics */}
                <AIForensics
                  data={{
                    mintAuthority: analysisResult.mintAuthority,
                    freezeAuthority: analysisResult.freezeAuthority,
                    lpLocked: analysisResult.lpLocked,
                    lpLockedPercent: analysisResult.lpLockedPercent,
                    lpLockedValue: analysisResult.lpLockedValue,
                    tokenAge: analysisResult.tokenAge,
                    honeypot: analysisResult.honeypot,
                    bundleDetected: analysisResult.bundleDetected,
                    bundleCount: analysisResult.bundleCount,
                    bundleHoldingsPercent: analysisResult.bundleHoldingsPercent,
                    bundleWallets: analysisResult.bundleWallets,
                    topHolderPercent: analysisResult.topHolderPercent,
                    liquidity: analysisResult.liquidity ?? undefined,
                    marketCap: analysisResult.marketCap ?? undefined,
                  }}
                  tokenSymbol={analysisResult.tokenSymbol}
                  tokenAddress={analysisResult.tokenAddress}
                  verdict={analysisResult.verdict}
                  score={analysisResult.score}
                />
              </>
            ) : (
              /* Empty State */
              <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                <div className="w-20 h-20 mb-6 rounded-full bg-[#111] border border-[#222] flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-[#333]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-[#666] mb-2">No Token Selected</h3>
                <p className="text-[#555] text-sm max-w-md">
                  Paste a Solana token address in the search bar above to analyze its safety,
                  detect bundles, and view holder distribution.
                </p>
                <div className="mt-6 flex gap-2 text-[0.7rem] text-[#444]">
                  <span className="px-2 py-1 bg-[#111] border border-[#222] rounded">SCOUT: ONLINE</span>
                  <span className="px-2 py-1 bg-[#111] border border-[#222] rounded">ANALYST: STANDBY</span>
                  <span className="px-2 py-1 bg-[#111] border border-[#222] rounded">HUNTER: STANDBY</span>
                </div>
              </div>
            )}
          </div>

          {/* Action Dock */}
          {analysisResult && (
            <RiskScoreDock
              score={analysisResult.score}
              tokenSymbol={analysisResult.tokenSymbol}
              onBuy={onBuy ? handleBuy : undefined}
              onSell={onSell ? handleSell : undefined}
              isBuying={isBuying}
              hasPosition={hasPosition}
              disabled={!walletAddress}
            />
          )}
        </div>

        {/* RIGHT: Wallet Topology */}
        <div className="border-l border-[#222] p-3 overflow-y-auto bg-[#080808]">
          {analysisResult ? (
            <WalletTopology
              holders={analysisResult.holders}
              totalHolders={analysisResult.totalHolders}
              top10Percent={analysisResult.top10Percent || undefined}
              top100Percent={analysisResult.top100Percent}
              retailPercent={analysisResult.retailPercent}
              bundleCount={analysisResult.bundleCount}
              bundleHoldingsPercent={analysisResult.bundleHoldingsPercent}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="text-[#444] text-sm">
                Wallet topology will appear here after scanning a token
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default TerminalDashboard;
