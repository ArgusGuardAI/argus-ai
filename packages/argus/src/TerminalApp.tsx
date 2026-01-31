/**
 * TerminalApp - New terminal-style dashboard interface
 *
 * Uses the same analysis and trading logic as App.tsx but with
 * the new hybrid terminal UI design.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAutoTrade } from './hooks/useAutoTrade';
import { TerminalDashboard } from './components/terminal';

// API configuration
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : 'https://argusguard-api.hermosillo-jessie.workers.dev';

// Store last analysis for buy/sell
let lastAnalysis: TerminalAnalysisResult | null = null;

// Analysis result interface matching the Terminal components
interface TerminalAnalysisResult {
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
  lpLockedValue?: number;
  tokenAge: string | null;
  honeypot: boolean | null;
  bundleDetected: boolean;
  bundleCount?: number;
  bundleHoldingsPercent?: number;
  bundleWallets?: Array<{ address: string; percent: number; isHolder: boolean }>;
  topHolderPercent?: number;
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
}

// Format token age from hours
function formatTokenAge(ageHours: number | null | undefined): string | null {
  if (ageHours === null || ageHours === undefined) return null;

  const hours = Math.floor(ageHours);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h`;
  if (ageHours > 0) return `${Math.round(ageHours * 60)}m`;
  return '<1h';
}

// Determine liquidity status
function getLiquidityStatus(liquidity: number | null): 'High' | 'Medium' | 'Low' | null {
  if (liquidity === null) return null;
  if (liquidity >= 100000) return 'High';
  if (liquidity >= 20000) return 'Medium';
  return 'Low';
}

export default function TerminalApp() {
  const { publicKey: connectedWallet } = useWallet();
  const prevWalletLoadedRef = useRef(false);

  const log = useCallback((msg: string, _type = 'info') => {
    console.log(`[${_type}] ${msg}`);
  }, []);

  const autoTrade = useAutoTrade({}, undefined, log);

  // Backup modal state
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [newWalletKey, setNewWalletKey] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  // Check if backup was already confirmed
  useEffect(() => {
    const confirmed = localStorage.getItem('argus_wallet_backup_confirmed');
    if (confirmed === 'true') {
      setBackupConfirmed(true);
    }
  }, []);

  // Handle new wallet creation with backup modal
  // Detect when wallet transitions from not loaded to loaded (new wallet created)
  useEffect(() => {
    const wasLoaded = prevWalletLoadedRef.current;
    const isNowLoaded = autoTrade.wallet.isLoaded && autoTrade.wallet.address;

    if (!wasLoaded && isNowLoaded && !backupConfirmed) {
      // Check if this is truly a new wallet (no backup confirmed yet)
      const alreadyBackedUp = localStorage.getItem('argus_wallet_backup_confirmed') === 'true';
      if (!alreadyBackedUp) {
        setShowBackupModal(true);
        autoTrade.exportPrivateKey().then(key => {
          if (key) setNewWalletKey(key);
        });
      }
    }

    prevWalletLoadedRef.current = !!isNowLoaded;
  }, [autoTrade.wallet.isLoaded, autoTrade.wallet.address, backupConfirmed, autoTrade.exportPrivateKey]);

  const handleBackupConfirm = () => {
    if (!keyCopied) return;
    setBackupConfirmed(true);
    localStorage.setItem('argus_wallet_backup_confirmed', 'true');
    setShowBackupModal(false);
    setNewWalletKey('');
  };

  const handleCopyKey = async () => {
    if (newWalletKey) {
      await navigator.clipboard.writeText(newWalletKey);
      setKeyCopied(true);
    }
  };

  // Analyze token and return result in Terminal format
  const handleAnalyze = async (address: string): Promise<TerminalAnalysisResult | null> => {
    const trimmed = address.trim();
    if (!trimmed) return null;

    // Validate Solana address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
      log('Invalid Solana address format', 'error');
      return null;
    }

    try {
      const walletForRateLimit = connectedWallet?.toBase58() || autoTrade.wallet.address;

      const response = await fetch(`${API_URL}/sentinel/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(walletForRateLimit ? { 'X-Wallet-Address': walletForRateLimit } : {}),
        },
        body: JSON.stringify({ tokenAddress: trimmed }),
      });

      if (!response.ok) {
        const error = await response.json();
        log(error.error || 'Analysis failed', 'error');
        return null;
      }

      const data = await response.json();

      // Map API response to Terminal format
      const holders = data.holderDistribution || [];
      const bundleWallets = new Set(data.bundleInfo?.wallets || []);

      // Known addresses - only tag what we KNOW, don't guess
      const KNOWN_DEX_PROGRAMS = [
        '5Q544fKrFoe2tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium AMM
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium V4
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
      ];
      const BURN_ADDRESS = '1111111111111111111111111111111111111111111';

      // Tag holders - ONLY use data from API, don't assume
      const taggedHolders = holders.slice(0, 20).map((h: {
        address: string;
        percent: number;
        isLp?: boolean;
        isCreator?: boolean;
        isDex?: boolean;
        isBurn?: boolean;
        label?: string;
      }) => {
        const tags: ('DEV' | 'SNIPER' | 'BUNDLE' | 'DEX' | 'LP' | 'BURN')[] = [];

        // BUNDLE - from our bundle detection
        if (bundleWallets.has(h.address)) {
          tags.push('BUNDLE');
        }

        // BURN - check if burn address
        if (h.isBurn || h.address.startsWith(BURN_ADDRESS.slice(0, 20))) {
          tags.push('BURN');
        }

        // LP - only if API says so
        if (h.isLp) {
          tags.push('LP');
        }

        // DEX - check against known DEX program addresses
        if (h.isDex || KNOWN_DEX_PROGRAMS.some(dex => h.address === dex)) {
          tags.push('DEX');
        }

        // DEV - only if API explicitly marks as creator
        if (h.isCreator) {
          tags.push('DEV');
        }

        return {
          address: h.address,
          percent: h.percent,
          tags: tags.length > 0 ? tags : undefined,
          label: h.label,
        };
      });

      // Calculate percentages
      const top10Percent = holders.slice(0, 10).reduce((sum: number, h: { percent: number }) => sum + h.percent, 0);
      const top100Percent = holders.slice(0, 100).reduce((sum: number, h: { percent: number }) => sum + h.percent, 0);
      const retailPercent = 100 - top100Percent;

      // Invert risk score (API: higher = worse, we want: higher = better)
      const apiRiskScore = data.analysis?.riskScore || 50;
      const safetyScore = 100 - apiRiskScore;

      // Determine verdict
      const getVerdict = (score: number): string => {
        if (score >= 75) return 'Low risk token with healthy metrics';
        if (score >= 50) return 'Moderate risk - proceed with caution';
        if (score >= 25) return 'High risk - significant red flags detected';
        return 'Critical risk - likely scam or rug pull';
      };

      const result: TerminalAnalysisResult = {
        tokenAddress: data.tokenInfo?.address || trimmed,
        tokenSymbol: data.tokenInfo?.symbol || 'UNKNOWN',
        tokenName: data.tokenInfo?.name || 'Unknown Token',
        price: data.tokenInfo?.price ?? null,
        priceChange5m: data.tokenInfo?.priceChange5m ?? null,
        marketCap: data.tokenInfo?.marketCap ?? null,
        fdv: data.tokenInfo?.fdv ?? null,
        liquidity: data.tokenInfo?.liquidity ?? null,
        liquidityStatus: getLiquidityStatus(data.tokenInfo?.liquidity ?? null),
        volume24h: data.tokenInfo?.volume24h ?? null,
        score: safetyScore,
        verdict: data.analysis?.verdict || getVerdict(safetyScore),
        // Security fields - API returns mintRevoked/freezeRevoked in security object
        mintAuthority: data.security?.mintRevoked === true ? 'Disabled' : 'Active',
        freezeAuthority: data.security?.freezeRevoked === true ? 'Disabled' : 'Active',
        // LP lock - API returns lpLockedPct as a percentage (0-100)
        lpLocked: (data.security?.lpLockedPct || data.tokenInfo?.lpLockedPct || 0) > 0,
        lpLockedPercent: data.security?.lpLockedPct || data.tokenInfo?.lpLockedPct,
        lpLockedValue: (data.tokenInfo?.liquidity && (data.security?.lpLockedPct || data.tokenInfo?.lpLockedPct))
          ? (data.tokenInfo.liquidity * (data.security?.lpLockedPct || data.tokenInfo?.lpLockedPct || 0) / 100)
          : undefined,
        // Token age - API returns ageHours directly
        tokenAge: formatTokenAge(data.tokenInfo?.ageHours),
        honeypot: data.analysis?.honeypot || false,
        bundleDetected: data.bundleInfo?.detected || false,
        bundleCount: data.bundleInfo?.count || 0,
        bundleHoldingsPercent: data.bundleInfo?.controlPercent || (data.bundleInfo?.wallets?.length
          ? taggedHolders
              .filter((h: { tags?: string[] }) => h.tags?.includes('BUNDLE'))
              .reduce((sum: number, h: { percent: number }) => sum + h.percent, 0)
          : undefined),
        // Use full wallets array, enriched with holdings data
        bundleWallets: data.bundleInfo?.wallets?.length
          ? data.bundleInfo.wallets.map((walletAddr: string) => {
              // Check if this wallet is still in the top holders
              const holder = taggedHolders.find((h: { address: string }) => h.address === walletAddr);
              // Also check walletsWithHoldings for more accurate data
              const withHoldings = data.bundleInfo?.walletsWithHoldings?.find(
                (w: { address: string }) => w.address === walletAddr
              );
              const percent = withHoldings?.percent ?? holder?.percent ?? 0;
              return {
                address: walletAddr,
                percent,
                isHolder: percent > 0,
              };
            })
          : data.bundleInfo?.walletsWithHoldings,
        topHolderPercent: taggedHolders[0]?.percent,
        holders: taggedHolders,
        top10Percent,
        top100Percent,
        retailPercent,
        totalHolders: data.tokenInfo?.holders || holders.length,
      };

      log(`Analyzed ${result.tokenSymbol} - Score: ${result.score}`, 'success');
      lastAnalysis = result;
      return result;
    } catch (error) {
      console.error('Analysis failed:', error);
      log('Analysis failed - network error', 'error');
      return null;
    }
  };

  // Handle buy via Jupiter
  const handleBuy = async (tokenAddress: string, amount: number) => {
    if (!autoTrade.wallet.isLoaded) {
      log('Trading wallet not loaded', 'error');
      return;
    }

    log(`Buying ${amount} SOL of ${tokenAddress.slice(0, 8)}...`, 'info');

    try {
      // Update config with the buy amount
      autoTrade.updateConfig({ buyAmountSol: amount });

      // Get the token info from last analysis
      const tokenSymbol = lastAnalysis?.tokenSymbol || 'UNKNOWN';
      const score = lastAnalysis?.score || 50;

      // Execute trade using the proper method
      const result = await autoTrade.executeTrade(tokenAddress, tokenSymbol, score);

      if (result.success) {
        log('Buy order completed', 'success');
      } else {
        log(`Buy failed: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Buy failed:', error);
      log(`Buy failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  // Handle sell
  const handleSell = async (tokenAddress: string) => {
    if (!autoTrade.wallet.isLoaded) {
      log('Trading wallet not loaded', 'error');
      return;
    }

    log(`Selling position for ${tokenAddress.slice(0, 8)}...`, 'info');

    try {
      const result = await autoTrade.manualSell(tokenAddress);
      if (result.success) {
        log('Sell order completed', 'success');
      } else {
        log(`Sell failed: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Sell failed:', error);
      log(`Sell failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  // Check if user has position in last analyzed token
  const currentHasPosition = lastAnalysis
    ? autoTrade.state.positions.some((p: { tokenAddress: string }) => p.tokenAddress === lastAnalysis?.tokenAddress)
    : false;

  return (
    <>
      <TerminalDashboard
        walletAddress={autoTrade.wallet.address || undefined}
        walletBalance={autoTrade.wallet.balance}
        onAnalyze={handleAnalyze}
        onBuy={autoTrade.wallet.isLoaded ? handleBuy : undefined}
        onSell={autoTrade.wallet.isLoaded ? handleSell : undefined}
        hasPosition={currentHasPosition}
      />

      {/* Backup Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4">
          <div className="bg-[#111] border border-[#333] rounded-lg max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-[#EF4444] mb-4">
              BACKUP YOUR WALLET
            </h2>

            <p className="text-[#888] text-sm mb-4">
              Your trading wallet has been created. Save this private key in a secure location.
              If you lose it, you will lose access to any funds in this wallet.
            </p>

            <div className="bg-black border border-[#333] rounded p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#666] uppercase">Private Key</span>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="text-xs text-[#EF4444] hover:text-white"
                >
                  {showKey ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <code className="text-xs text-[#FAFAFA] font-mono break-all">
                {showKey ? newWalletKey : '*'.repeat(64)}
              </code>
            </div>

            <button
              onClick={handleCopyKey}
              className={`w-full py-2 mb-4 font-mono text-sm rounded transition-colors ${
                keyCopied
                  ? 'bg-green-600 text-white'
                  : 'bg-[#222] text-[#FAFAFA] hover:bg-[#333]'
              }`}
            >
              {keyCopied ? 'COPIED TO CLIPBOARD' : 'COPY PRIVATE KEY'}
            </button>

            <button
              onClick={handleBackupConfirm}
              disabled={!keyCopied}
              className={`w-full py-3 font-mono font-bold rounded transition-colors ${
                keyCopied
                  ? 'bg-[#EF4444] text-white hover:bg-[#cc0000]'
                  : 'bg-[#333] text-[#666] cursor-not-allowed'
              }`}
            >
              I HAVE SAVED MY KEY
            </button>

            <p className="text-[#555] text-xs text-center mt-4">
              You must copy the key before confirming
            </p>
          </div>
        </div>
      )}
    </>
  );
}
