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

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'wallet' | 'import'>('wallet');
  const [importKey, setImportKey] = useState('');
  const [showExportKey, setShowExportKey] = useState(false);
  const [exportedKey, setExportedKey] = useState('');
  const [walletName, setWalletName] = useState('Trading Wallet');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Check if backup was already confirmed and load wallet name
  useEffect(() => {
    const confirmed = localStorage.getItem('argus_wallet_backup_confirmed');
    if (confirmed === 'true') {
      setBackupConfirmed(true);
    }
    const savedName = localStorage.getItem('argus_trading_wallet_name');
    if (savedName) {
      setWalletName(savedName);
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

  // Settings handlers
  const handleCreateWallet = async () => {
    await autoTrade.generateWallet();
    setShowSettings(false);
  };

  const handleExportKey = async () => {
    const key = await autoTrade.exportPrivateKey();
    if (key) {
      setExportedKey(key);
      setShowExportKey(true);
    }
  };

  const handleImportWallet = async () => {
    if (!importKey.trim()) return;
    try {
      await autoTrade.importWallet(importKey.trim());
      setImportKey('');
      setSettingsTab('wallet');
      log('Wallet imported successfully', 'success');
    } catch (error) {
      log('Failed to import wallet - invalid key', 'error');
    }
  };

  const handleDeleteWallet = async () => {
    await autoTrade.deleteWallet();
    setShowDeleteConfirm(false);
    setShowSettings(false);
    localStorage.removeItem('argus_wallet_backup_confirmed');
    setBackupConfirmed(false);
  };

  const handleSaveWalletName = (name: string) => {
    setWalletName(name);
    localStorage.setItem('argus_trading_wallet_name', name);
    autoTrade.setWalletName(name);
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
        onSettingsClick={() => setShowSettings(true)}
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

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4">
          <div className="bg-[#0a0a0a] border border-[#333] rounded-lg max-w-md w-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#222]">
              <h2 className="text-lg font-bold text-[#FAFAFA]">Settings</h2>
              <button
                onClick={() => {
                  setShowSettings(false);
                  setShowExportKey(false);
                  setShowDeleteConfirm(false);
                }}
                className="p-1 hover:bg-[#222] rounded transition-colors"
              >
                <svg className="w-5 h-5 text-[#666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[#222]">
              <button
                onClick={() => setSettingsTab('wallet')}
                className={`flex-1 py-2 text-sm font-mono transition-colors ${
                  settingsTab === 'wallet'
                    ? 'text-[#DC2626] border-b-2 border-[#DC2626]'
                    : 'text-[#666] hover:text-[#888]'
                }`}
              >
                WALLET
              </button>
              <button
                onClick={() => setSettingsTab('import')}
                className={`flex-1 py-2 text-sm font-mono transition-colors ${
                  settingsTab === 'import'
                    ? 'text-[#DC2626] border-b-2 border-[#DC2626]'
                    : 'text-[#666] hover:text-[#888]'
                }`}
              >
                IMPORT
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {settingsTab === 'wallet' ? (
                autoTrade.wallet.isLoaded ? (
                  <div className="space-y-4">
                    {/* Wallet Info */}
                    <div>
                      <label className="text-xs text-[#666] uppercase">Wallet Name</label>
                      <input
                        type="text"
                        value={walletName}
                        onChange={(e) => handleSaveWalletName(e.target.value)}
                        className="w-full mt-1 px-3 py-2 bg-[#111] border border-[#333] rounded text-[#FAFAFA] font-mono text-sm focus:outline-none focus:border-[#DC2626]"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-[#666] uppercase">Address</label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 px-3 py-2 bg-[#111] border border-[#333] rounded text-[#888] text-xs truncate">
                          {autoTrade.wallet.address}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(autoTrade.wallet.address || '');
                          }}
                          className="p-2 bg-[#111] border border-[#333] rounded hover:border-[#DC2626] transition-colors"
                        >
                          <svg className="w-4 h-4 text-[#888]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-[#666] uppercase">Balance</label>
                      <div className="mt-1 px-3 py-2 bg-[#111] border border-[#333] rounded text-[#22C55E] font-mono font-bold">
                        {autoTrade.wallet.balance.toFixed(4)} SOL
                      </div>
                    </div>

                    {/* Export Key */}
                    {showExportKey ? (
                      <div className="bg-[#1a0a0a] border border-[#DC2626]/30 rounded p-3">
                        <label className="text-xs text-[#DC2626] uppercase">Private Key (Keep Secret!)</label>
                        <code className="block mt-2 text-xs text-[#FAFAFA] font-mono break-all bg-black p-2 rounded">
                          {exportedKey}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(exportedKey);
                          }}
                          className="mt-2 w-full py-2 bg-[#DC2626] text-white text-sm font-mono rounded hover:bg-[#b91c1c] transition-colors"
                        >
                          COPY KEY
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleExportKey}
                        className="w-full py-2 bg-[#222] text-[#888] text-sm font-mono rounded hover:bg-[#333] hover:text-[#FAFAFA] transition-colors"
                      >
                        EXPORT PRIVATE KEY
                      </button>
                    )}

                    {/* Delete Wallet */}
                    {showDeleteConfirm ? (
                      <div className="bg-[#1a0a0a] border border-[#DC2626]/30 rounded p-3">
                        <p className="text-[#DC2626] text-sm mb-3">
                          Are you sure? This will permanently delete your wallet. Make sure you have backed up your private key!
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className="flex-1 py-2 bg-[#222] text-[#888] text-sm font-mono rounded hover:bg-[#333]"
                          >
                            CANCEL
                          </button>
                          <button
                            onClick={handleDeleteWallet}
                            className="flex-1 py-2 bg-[#DC2626] text-white text-sm font-mono rounded hover:bg-[#b91c1c]"
                          >
                            DELETE
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="w-full py-2 border border-[#DC2626]/30 text-[#DC2626] text-sm font-mono rounded hover:bg-[#DC2626]/10 transition-colors"
                      >
                        DELETE WALLET
                      </button>
                    )}
                  </div>
                ) : (
                  /* No Wallet - Create */
                  <div className="text-center py-6">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#111] border border-[#333] flex items-center justify-center">
                      <svg className="w-8 h-8 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-[#FAFAFA] mb-2">No Wallet</h3>
                    <p className="text-[#666] text-sm mb-6">
                      Create a trading wallet to analyze tokens and execute trades.
                    </p>
                    <button
                      onClick={handleCreateWallet}
                      className="w-full py-3 bg-[#DC2626] text-white font-mono font-bold rounded hover:bg-[#b91c1c] transition-colors"
                    >
                      CREATE WALLET
                    </button>
                  </div>
                )
              ) : (
                /* Import Tab */
                <div className="space-y-4">
                  <p className="text-[#888] text-sm">
                    Import an existing wallet by pasting your private key below.
                  </p>
                  <div>
                    <label className="text-xs text-[#666] uppercase">Private Key</label>
                    <textarea
                      value={importKey}
                      onChange={(e) => setImportKey(e.target.value)}
                      placeholder="Paste your private key here..."
                      className="w-full mt-1 px-3 py-2 bg-[#111] border border-[#333] rounded text-[#FAFAFA] font-mono text-sm focus:outline-none focus:border-[#DC2626] resize-none h-24"
                    />
                  </div>
                  <button
                    onClick={handleImportWallet}
                    disabled={!importKey.trim()}
                    className="w-full py-3 bg-[#DC2626] text-white font-mono font-bold rounded hover:bg-[#b91c1c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    IMPORT WALLET
                  </button>
                  <p className="text-[#555] text-xs text-center">
                    Warning: Importing will replace your current wallet if one exists.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
