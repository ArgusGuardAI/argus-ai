/**
 * useAutoTrade Hook
 * Handles FULLY AUTOMATED trading when tokens are approved by AI
 *
 * Key features:
 * - Uses dedicated trading wallet (no popups!)
 * - Executes trades INSTANTLY when AI approves
 * - AUTO-SELL: Take profit, stop loss, trailing stop
 * - Configurable buy amount, slippage, and risk threshold
 * - Your main wallet stays safe - only trading wallet is used
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import { tradingWallet } from '../lib/tradingWallet';
import { buyToken, sellToken, getTokenBalance, getAllTokenBalances, getTokenValueInSol, getTokenPrice, type SwapResult } from '../lib/jupiter';

export interface AutoTradeConfig {
  enabled: boolean;
  buyAmountSol: number;      // Amount to buy per trade (in SOL)
  maxSlippageBps: number;    // Max slippage in basis points (100 = 1%)
  minScore: number;          // Only trade if score >= this (higher = better, 60+ = BUY)
  maxTradesPerSession: number; // SAFETY: Max trades before auto-stopping
  reserveBalanceSol: number;   // SAFETY: Always keep this much SOL untouched
  maxPriceDropPercent: number; // SAFETY: Skip if price dropped more than this % in 24h
  tradeCooldownSeconds: number; // SAFETY: Min seconds between trades (0 = no limit)
  // PRE-FILTER CONFIG (sent to backend)
  minMarketCapUsd: number;           // Min market cap for tokens
  maxBundleWallets: number;          // Max coordinated wallets allowed
  maxTopHolderPercent: number;       // Max % one wallet can hold (100 = disabled)
  // SELL CONFIG
  autoSellEnabled: boolean;    // Enable auto-sell functionality
  takeProfitPercent: number;   // Sell when up this % (e.g., 100 = 2x)
  stopLossPercent: number;     // Sell when down this % (e.g., 30 = -30%)
  trailingStopPercent: number; // Trailing stop - sell when drops this % from peak (0 = disabled)
}

export interface PendingTrade {
  tokenAddress: string;
  tokenSymbol: string;
  riskScore: number;
  status: 'pending' | 'executing' | 'success' | 'failed';
  error?: string;
  txSignature?: string;
  timestamp: number;
}

// Position tracking for auto-sell
export interface Position {
  tokenAddress: string;
  tokenSymbol: string;
  entryTimestamp: number;
  entrySolAmount: number;      // SOL spent to buy
  tokenAmount: number;         // Tokens received (raw units)
  tokenDecimals: number;
  currentValueSol: number;     // Current value in SOL
  highestValueSol: number;     // Highest value seen (for trailing stop)
  pnlPercent: number;          // Current P&L %
  txSignature: string;
  status: 'active' | 'selling' | 'sold' | 'failed';
  sellReason?: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'manual';
  sellTxSignature?: string;
}

export interface AutoTradeState {
  isTrading: boolean;
  pendingTrades: PendingTrade[];
  completedTrades: PendingTrade[];
  positions: Position[];       // Active positions being monitored
  soldPositions: Position[];   // History of sold positions
  totalTraded: number;
  totalSuccessful: number;
  totalFailed: number;
  totalSold: number;
  totalProfitSol: number;      // Total realized profit in SOL
}

export interface TradingWalletState {
  isLoaded: boolean;
  address: string | null;
  balance: number;
}

const ESTIMATED_FEE_SOL = 0.001; // Approximate transaction fee in SOL

const DEFAULT_CONFIG: AutoTradeConfig = {
  enabled: false,
  buyAmountSol: 0.05,      // 0.05 SOL per trade
  maxSlippageBps: 500,     // 5% slippage
  minScore: 60,            // Only trade tokens with score >= 60 (BUY or STRONG_BUY)
  maxTradesPerSession: 0,  // 0 = UNLIMITED (keeps trading as long as there's SOL)
  reserveBalanceSol: 0.1,  // SAFETY: Always keep 0.1 SOL
  maxPriceDropPercent: 30, // SAFETY: Skip if down more than 30% in 24h
  tradeCooldownSeconds: 30,  // SAFETY: 30 seconds between trades
  // PRE-FILTER DEFAULTS
  minMarketCapUsd: 10000,              // $10K min market cap
  maxBundleWallets: 12,                // Allow up to 12 bundled wallets
  maxTopHolderPercent: 70,             // Max 70% for top holder (100 = disabled)
  // SELL DEFAULTS
  autoSellEnabled: true,   // Auto-sell ON by default
  takeProfitPercent: 100,  // Sell at 2x (100% profit)
  stopLossPercent: 30,     // Sell if down 30%
  trailingStopPercent: 20, // Trailing stop at 20% from peak
};

const STORAGE_KEY = 'argus_trading_state';
const CONFIG_STORAGE_KEY = 'argus_trading_config';

interface PersistedState {
  enabled: boolean;
  positions: Position[];
  soldPositions: Position[];
  totalTraded: number;
  totalSuccessful: number;
  totalFailed: number;
  totalSold: number;
  totalProfitSol: number;
}

function loadPersistedConfig(): Partial<AutoTradeConfig> | null {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('[AutoTrade] Failed to load persisted config:', e);
  }
  return null;
}

function savePersistedConfig(config: AutoTradeConfig) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('[AutoTrade] Failed to save config:', e);
  }
}

function loadPersistedState(): Partial<PersistedState> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('[AutoTrade] Failed to load persisted state:', e);
  }
  return null;
}

function savePersistedState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[AutoTrade] Failed to save state:', e);
  }
}

export function useAutoTrade(
  initialConfig: Partial<AutoTradeConfig> = {},
  onTradeExecuted?: (trade: PendingTrade) => void,
  onLog?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void
) {
  const [config, setConfig] = useState<AutoTradeConfig>(() => {
    const persistedState = loadPersistedState();
    const persistedConfig = loadPersistedConfig();
    return {
      ...DEFAULT_CONFIG,
      ...persistedConfig,  // Restore saved config settings
      ...initialConfig,    // Allow overrides from props (should be empty now)
      enabled: persistedState?.enabled ?? false, // Restore enabled state
    };
  });

  const [state, setState] = useState<AutoTradeState>(() => {
    const persisted = loadPersistedState();
    return {
      isTrading: false,
      pendingTrades: [],
      completedTrades: [],
      positions: persisted?.positions || [],
      soldPositions: persisted?.soldPositions || [],
      totalTraded: persisted?.totalTraded || 0,
      totalSuccessful: persisted?.totalSuccessful || 0,
      totalFailed: persisted?.totalFailed || 0,
      totalSold: persisted?.totalSold || 0,
      totalProfitSol: persisted?.totalProfitSol || 0,
    };
  });

  const [wallet, setWallet] = useState<TradingWalletState>({
    isLoaded: false,
    address: null,
    balance: 0,
  });

  // Track tokens we've already attempted to trade (prevent duplicates)
  // Initialize with positions from persisted state
  const tradedTokensRef = useRef<Set<string>>(new Set(
    [...(state.positions?.map(p => p.tokenAddress) || []),
     ...(state.soldPositions?.map(p => p.tokenAddress) || [])]
  ));

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    savePersistedState({
      enabled: config.enabled,
      positions: state.positions,
      soldPositions: state.soldPositions,
      totalTraded: state.totalTraded,
      totalSuccessful: state.totalSuccessful,
      totalFailed: state.totalFailed,
      totalSold: state.totalSold,
      totalProfitSol: state.totalProfitSol,
    });
  }, [config.enabled, state.positions, state.soldPositions, state.totalTraded, state.totalSuccessful,
      state.totalFailed, state.totalSold, state.totalProfitSol]);

  // Persist config to localStorage whenever it changes
  useEffect(() => {
    savePersistedConfig(config);
  }, [config]);
  const balanceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const isSellingRef = useRef<Set<string>>(new Set()); // Prevent duplicate sells of same token
  const isBuyingRef = useRef<Set<string>>(new Set()); // Prevent duplicate buys
  const lastTradeTimeRef = useRef<number>(0); // Track last trade time for cooldown
  const sellMutexRef = useRef<boolean>(false); // Global mutex - only one sell at a time (prevents race conditions in P&L calculation)

  // Keep latest config in a ref to avoid stale closures
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const log = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    console.log(`[AutoTrade] ${message}`);
    onLog?.(message, type);
  }, [onLog]);

  // Load trading wallet on mount and recover untracked positions
  const hasRecoveredRef = useRef(false);
  useEffect(() => {
    if (tradingWallet.exists()) {
      const loaded = tradingWallet.load();
      if (loaded) {
        setWallet({
          isLoaded: true,
          address: tradingWallet.getAddress(),
          balance: 0,
        });
        refreshBalance();

        // Auto-recover untracked positions on first load
        if (!hasRecoveredRef.current) {
          hasRecoveredRef.current = true;
          // Delay recovery to allow state to settle
          setTimeout(async () => {
            const walletAddress = tradingWallet.getAddress();
            if (walletAddress) {
              console.log('[AutoTrade] Starting recovery scan...');
              try {
                const tokenBalances = await getAllTokenBalances(walletAddress);
                if (tokenBalances.length > 0) {
                  // Check against current positions from localStorage
                  const persisted = loadPersistedState();
                  const trackedAddresses = new Set([
                    ...(persisted?.positions?.map(p => p.tokenAddress) || []),
                    ...(persisted?.soldPositions?.map(p => p.tokenAddress) || []),
                  ]);

                  const untrackedCount = tokenBalances.filter(t => !trackedAddresses.has(t.mint)).length;
                  if (untrackedCount > 0) {
                    console.log(`[AutoTrade] Found ${untrackedCount} untracked tokens, triggering recovery...`);
                    // The actual recovery will be done via recoverUntrackedPositions called from UI
                    // or we can trigger it here. For now, just log to console.
                    // The UI will have a button to manually trigger recovery if needed.
                  }
                }
              } catch (e) {
                console.error('[AutoTrade] Recovery scan failed:', e);
              }
            }
          }, 2000);
        }
      }
    }
  }, []);

  // Refresh balance periodically when enabled
  useEffect(() => {
    if (wallet.isLoaded && config.enabled) {
      refreshBalance();
      balanceIntervalRef.current = setInterval(refreshBalance, 30000); // Every 30s
    }
    return () => {
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
      }
    };
  }, [wallet.isLoaded, config.enabled]);

  /**
   * Refresh wallet balance
   */
  const refreshBalance = useCallback(async () => {
    if (!tradingWallet.isReady()) return;
    const balance = await tradingWallet.getBalance();
    setWallet(prev => ({ ...prev, balance }));
  }, []);

  /**
   * Execute a sell for a position
   */
  const executeSell = useCallback(async (
    position: Position,
    reason: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'manual'
  ): Promise<SwapResult> => {
    // Use ref for latest config
    const currentConfig = configRef.current;

    // Prevent duplicate sells of same token
    if (isSellingRef.current.has(position.tokenAddress)) {
      return { success: false, error: 'Already selling' };
    }

    // GLOBAL MUTEX: Wait for any other sell to complete first
    // This prevents race conditions in balance calculation
    while (sellMutexRef.current) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    sellMutexRef.current = true;
    isSellingRef.current.add(position.tokenAddress);

    const reasonLabels = {
      take_profit: 'TAKE PROFIT',
      stop_loss: 'STOP LOSS',
      trailing_stop: 'TRAILING STOP',
      manual: 'MANUAL SELL'
    };

    log(`${reasonLabels[reason]}: Selling ${position.tokenSymbol} (${position.pnlPercent >= 0 ? '+' : ''}${position.pnlPercent.toFixed(1)}%)`,
        reason === 'take_profit' ? 'success' : reason === 'stop_loss' ? 'error' : 'warning');

    // Update position status
    setState(prev => ({
      ...prev,
      positions: prev.positions.map(p =>
        p.tokenAddress === position.tokenAddress ? { ...p, status: 'selling' as const } : p
      ),
    }));

    try {
      const publicKey = tradingWallet.getPublicKey();
      if (!publicKey) throw new Error('Wallet not ready');

      // Get current token balance
      const balanceInfo = await getTokenBalance(position.tokenAddress, publicKey.toString());
      if (!balanceInfo || balanceInfo.balance === 0) {
        throw new Error('No tokens to sell');
      }

      // Track SOL balance BEFORE sell to calculate actual profit
      // MUTEX ensures no other sell is happening, so this is accurate
      const solBalanceBefore = await tradingWallet.getBalance();

      // Sell ALL tokens
      const result = await sellToken(
        position.tokenAddress,
        balanceInfo.balance, // Sell entire balance
        publicKey,
        (tx: VersionedTransaction) => Promise.resolve(tradingWallet.signTransaction(tx)),
        currentConfig.maxSlippageBps,
        true // withAiFee
      );

      if (result.success) {
        // Wait a moment for balance to update
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get ACTUAL SOL received by checking balance difference
        const solBalanceAfter = await tradingWallet.getBalance();
        const actualSolReceived = solBalanceAfter - solBalanceBefore;

        // Calculate real profit (actual received - what we spent)
        const profitSol = actualSolReceived > 0
          ? actualSolReceived - position.entrySolAmount
          : position.currentValueSol - position.entrySolAmount; // Fallback to estimate

        const actualPnlPercent = (profitSol / position.entrySolAmount) * 100;

        log(`SOLD ${position.tokenSymbol}! ${profitSol >= 0 ? '+' : ''}${profitSol.toFixed(4)} SOL (${actualPnlPercent >= 0 ? '+' : ''}${actualPnlPercent.toFixed(1)}%)`,
            profitSol >= 0 ? 'success' : 'error');

        // Move to sold positions with actual P&L
        setState(prev => ({
          ...prev,
          positions: prev.positions.filter(p => p.tokenAddress !== position.tokenAddress),
          soldPositions: [{
            ...position,
            pnlPercent: actualPnlPercent,
            currentValueSol: actualSolReceived > 0 ? actualSolReceived : position.currentValueSol,
            status: 'sold' as const,
            sellReason: reason,
            sellTxSignature: result.signature,
          }, ...prev.soldPositions].slice(0, 50),
          totalSold: prev.totalSold + 1,
          totalProfitSol: prev.totalProfitSol + profitSol,
        }));

        refreshBalance();
      } else {
        log(`SELL FAILED: ${position.tokenSymbol} - ${result.error}`, 'error');
        setState(prev => ({
          ...prev,
          positions: prev.positions.map(p =>
            p.tokenAddress === position.tokenAddress ? { ...p, status: 'active' as const } : p
          ),
        }));
      }

      isSellingRef.current.delete(position.tokenAddress);
      sellMutexRef.current = false; // Release mutex
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log(`SELL ERROR: ${position.tokenSymbol} - ${errorMsg}`, 'error');

      setState(prev => ({
        ...prev,
        positions: prev.positions.map(p =>
          p.tokenAddress === position.tokenAddress ? { ...p, status: 'failed' as const } : p
        ),
      }));

      isSellingRef.current.delete(position.tokenAddress);
      sellMutexRef.current = false; // Release mutex on error
      return { success: false, error: errorMsg };
    }
  }, [log, refreshBalance]);

  /**
   * Monitor positions and check sell conditions
   * Optimized: Accumulates all updates and batches setState calls to prevent re-render loops.
   */
  const checkSellConditions = useCallback(async () => {
    // Use ref for latest config
    const currentConfig = configRef.current;

    if (!currentConfig.autoSellEnabled || state.positions.length === 0) return;

    const walletAddress = tradingWallet.getAddress();
    if (!walletAddress) return;

    // Accumulate state updates to avoid multiple renders in a loop
    const updatesMap = new Map<string, Partial<Position>>();
    const sellsToExecute: Array<{ position: Position; reason: 'take_profit' | 'stop_loss' | 'trailing_stop' }> = [];

    for (const position of state.positions) {
      if (position.status !== 'active') continue;

      try {
        // Get current value in SOL
        const balanceInfo = await getTokenBalance(position.tokenAddress, walletAddress);
        if (!balanceInfo) {
          // RPC error - DON'T remove, just skip this cycle
          log(`${position.tokenSymbol}: Balance check failed, skipping cycle`, 'warning');
          continue;
        }

        if (balanceInfo.balance === 0) {
          // Balance is 0 - but DON'T auto-remove!
          // Could be RPC lag, or tokens were sold externally
          // Only log it, user can manually clear if needed
          log(`${position.tokenSymbol}: Balance is 0 (may be sold externally)`, 'warning');
          // Update the position to show 0 value but DON'T delete
          updatesMap.set(position.tokenAddress, { currentValueSol: 0, pnlPercent: -100 });
          continue;
        }

        // Use FRESH decimals from balanceInfo, not stale position.tokenDecimals
        const currentValueSol = await getTokenValueInSol(position.tokenAddress, balanceInfo.balance, balanceInfo.decimals);
        if (currentValueSol === null) {
          // Rate limited or error - skip this position this cycle
          continue;
        }

        // Calculate P&L
        const pnlPercent = ((currentValueSol - position.entrySolAmount) / position.entrySolAmount) * 100;
        const newHighest = Math.max(position.highestValueSol, currentValueSol);
        const dropFromPeak = ((newHighest - currentValueSol) / newHighest) * 100;

        // Store update
        updatesMap.set(position.tokenAddress, {
          currentValueSol,
          highestValueSol: newHighest,
          pnlPercent
        });

        // Construct a temporary object with latest values for condition checking
        const updatedPosition = { ...position, currentValueSol, highestValueSol: newHighest, pnlPercent };

        // Check TAKE PROFIT
        if (pnlPercent >= currentConfig.takeProfitPercent) {
          log(`${position.tokenSymbol}: +${pnlPercent.toFixed(1)}% >= ${currentConfig.takeProfitPercent}% TP`, 'success');
          sellsToExecute.push({ position: updatedPosition, reason: 'take_profit' });
          continue;
        }

        // Check STOP LOSS (with minimum hold time protection)
        // Don't trigger stop loss in first 60 seconds - prevents false triggers from price calculation errors
        const holdTimeSeconds = (Date.now() - position.entryTimestamp) / 1000;
        const MIN_HOLD_FOR_STOPLOSS = 60; // 60 seconds minimum before stop loss can trigger

        if (pnlPercent <= -currentConfig.stopLossPercent) {
          if (holdTimeSeconds < MIN_HOLD_FOR_STOPLOSS) {
            log(`${position.tokenSymbol}: ${pnlPercent.toFixed(1)}% but PROTECTED (${Math.ceil(MIN_HOLD_FOR_STOPLOSS - holdTimeSeconds)}s remaining)`, 'warning');
          } else {
            log(`${position.tokenSymbol}: ${pnlPercent.toFixed(1)}% <= -${currentConfig.stopLossPercent}% SL`, 'error');
            sellsToExecute.push({ position: updatedPosition, reason: 'stop_loss' });
            continue;
          }
        }

        // Check TRAILING STOP (only if in profit and trailing is enabled)
        if (currentConfig.trailingStopPercent > 0 && pnlPercent > 0 && dropFromPeak >= currentConfig.trailingStopPercent) {
          log(`${position.tokenSymbol}: Dropped ${dropFromPeak.toFixed(1)}% from peak >= ${currentConfig.trailingStopPercent}% TS`, 'warning');
          sellsToExecute.push({ position: updatedPosition, reason: 'trailing_stop' });
          continue;
        }

        // Delay between positions to avoid rate limits (3 seconds between each)
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (error) {
        console.error(`[AutoTrade] Error checking ${position.tokenSymbol}:`, error);
      }
    }

    // Apply all accumulated updates in a single render
    if (updatesMap.size > 0) {
      setState(prev => ({
        ...prev,
        positions: prev.positions.map(p => {
          const update = updatesMap.get(p.tokenAddress);
          return update ? { ...p, ...update } : p;
        }),
      }));
    }

    // Execute all pending sells after state is updated
    for (const { position, reason } of sellsToExecute) {
      await executeSell(position, reason);
    }
  }, [state.positions, executeSell, log]);

  // Keep ref in sync with function for stable timer
  const checkSellConditionsRef = useRef(checkSellConditions);
  useEffect(() => {
    checkSellConditionsRef.current = checkSellConditions;
  }, [checkSellConditions]);

  // Position price monitoring loop
  useEffect(() => {
    // Check immediately if we have positions
    if (state.positions.length > 0) {
      checkSellConditionsRef.current();
      // Check every 60 seconds.
      // Dependency is ONLY positions.length, preventing timer resets when P&L updates.
      priceMonitorRef.current = setInterval(() => checkSellConditionsRef.current(), 60000);
    }

    return () => {
      if (priceMonitorRef.current) {
        clearInterval(priceMonitorRef.current);
      }
    };
  }, [state.positions.length]); // Only restart if count changes

  /**
   * Generate a new trading wallet
   * Returns both address and private key for backup prompt
   */
  const generateWallet = useCallback((): { address: string; privateKey: string } => {
    const address = tradingWallet.generate();
    const privateKey = tradingWallet.exportPrivateKey() || '';
    setWallet({
      isLoaded: true,
      address,
      balance: 0,
    });
    log(`New trading wallet created: ${address.slice(0, 8)}...`, 'success');
    return { address, privateKey };
  }, [log]);

  /**
   * Import trading wallet from private key
   */
  const importWallet = useCallback((privateKey: string) => {
    try {
      const address = tradingWallet.import(privateKey);
      setWallet({
        isLoaded: true,
        address,
        balance: 0,
      });
      refreshBalance();
      log(`Trading wallet imported: ${address.slice(0, 8)}...`, 'success');
      return address;
    } catch (error) {
      log('Failed to import wallet: Invalid private key', 'error');
      throw error;
    }
  }, [log, refreshBalance]);

  /**
   * Delete trading wallet
   */
  const deleteWallet = useCallback(() => {
    tradingWallet.delete();
    setWallet({
      isLoaded: false,
      address: null,
      balance: 0,
    });
    setConfig(prev => ({ ...prev, enabled: false }));
    log('Trading wallet deleted', 'info');
  }, [log]);

  /**
   * Export private key (for backup)
   */
  const exportPrivateKey = useCallback((): string | null => {
    return tradingWallet.exportPrivateKey();
  }, []);

  /**
   * Get wallet name
   */
  const getWalletName = useCallback((): string => {
    return tradingWallet.getName();
  }, []);

  /**
   * Set wallet name
   */
  const setWalletName = useCallback((name: string): void => {
    tradingWallet.setName(name);
  }, []);

  /**
   * Withdraw to main wallet
   */
  const withdraw = useCallback(async (destinationAddress: string, amount?: number) => {
    try {
      const signature = amount
        ? await tradingWallet.withdraw(destinationAddress, amount)
        : await tradingWallet.withdrawAll(destinationAddress);
      log(`Withdrew to ${destinationAddress.slice(0, 8)}... TX: ${signature.slice(0, 8)}...`, 'success');
      await refreshBalance();
      return signature;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Withdraw failed';
      log(msg, 'error');
      throw error;
    }
  }, [log, refreshBalance]);

  /**
   * Execute a trade for an approved token - FULLY AUTOMATED
   */
  const executeTrade = useCallback(async (
    tokenAddress: string,
    tokenSymbol: string,
    riskScore: number,
    force?: boolean
  ): Promise<SwapResult> => {
    // Use ref for latest config
    const currentConfig = configRef.current;

    log(`EXECUTING: ${tokenSymbol} (${currentConfig.buyAmountSol} SOL)...`, 'info');

    if (!tradingWallet.isReady()) {
      log(`Wallet not ready for ${tokenSymbol}`, 'error');
      return { success: false, error: 'Trading wallet not loaded' };
    }

    const publicKey = tradingWallet.getPublicKey();
    if (!publicKey) {
      return { success: false, error: 'Trading wallet not ready' };
    }

    // Check balance
    let balance: number;
    try {
      balance = await tradingWallet.getBalance();
    } catch (e) {
      log(`Failed to get wallet balance`, 'error');
      return { success: false, error: 'Failed to get wallet balance' };
    }

    if (balance < currentConfig.buyAmountSol + ESTIMATED_FEE_SOL) {
      log(`Insufficient balance: ${balance.toFixed(4)} SOL`, 'error');
      return { success: false, error: `Insufficient balance: ${balance.toFixed(4)} SOL` };
    }

    // OPTIONAL SAFETY: Check DexScreener data if available (skip when force=true)
    // For brand new tokens, DexScreener won't have data yet, so we proceed with AI validation only
    if (!force) {
      try {
        const priceData = await getTokenPrice(tokenAddress);
        if (priceData) {
          // DexScreener has data - run additional safety checks
          const buys5m = priceData.txnsBuys5m;
          const sells5m = priceData.txnsSells5m;

          // CHECK 1: Sell pressure - skip if sells > 1.5x buys (with some activity)
          if (sells5m > buys5m * 1.5 && sells5m > 5) {
            log(`SELL PRESSURE: ${tokenSymbol} has ${sells5m} sells vs ${buys5m} buys - skipping!`, 'warning');
            return { success: false, error: `Sell pressure: ${sells5m} sells vs ${buys5m} buys` };
          }

          // CHECK 2: 5-minute price change (detect fresh rugs)
          const change5m = priceData.priceChange5m;
          if (change5m < -20) {
            log(`DUMP: ${tokenSymbol} down ${change5m.toFixed(1)}% in 5min - skipping!`, 'warning');
            return { success: false, error: `5min dump: ${change5m.toFixed(1)}%` };
          }

          // CHECK 3: 1-hour change
          const change1h = priceData.priceChange1h;
          if (change1h < -40) {
            log(`DUMP: ${tokenSymbol} down ${change1h.toFixed(1)}% in 1hr - skipping!`, 'warning');
            return { success: false, error: `1hr dump: ${change1h.toFixed(1)}%` };
          }

          log(`DexScreener OK: ${buys5m} buys, ${sells5m} sells, 5m: ${change5m >= 0 ? '+' : ''}${change5m.toFixed(1)}%`, 'info');
        } else {
          // No DexScreener data (brand new token) - proceed with AI validation only
          log(`NEW TOKEN: ${tokenSymbol} - no DexScreener data yet, proceeding with AI validation`, 'info');
        }
      } catch (e) {
        // DexScreener check failed - proceed anyway since AI validated the token
        log(`DexScreener check failed for ${tokenSymbol}, proceeding with AI validation`, 'warning');
      }
    }

    // Track balance before trade to calculate actual spent
    const balanceBefore = await tradingWallet.getBalance();

    // Create pending trade entry
    const trade: PendingTrade = {
      tokenAddress,
      tokenSymbol,
      riskScore,
      status: 'executing',
      timestamp: Date.now(),
    };

    setState(prev => ({
      ...prev,
      isTrading: true,
      pendingTrades: [...prev.pendingTrades, trade],
    }));

    try {
      // Execute the buy via Jupiter with trading wallet's instant signing
      const result = await buyToken(
        tokenAddress,
        currentConfig.buyAmountSol,
        publicKey,
        // This is the key difference - trading wallet signs INSTANTLY
        (tx: VersionedTransaction) => Promise.resolve(tradingWallet.signTransaction(tx)),
        currentConfig.maxSlippageBps,
        true // withAiFee - support platform fee if configured
      );

      const completedTrade: PendingTrade = {
        ...trade,
        status: result.success ? 'success' : 'failed',
        error: result.error,
        txSignature: result.signature,
      };

      setState(prev => ({
        ...prev,
        isTrading: false,
        pendingTrades: prev.pendingTrades.filter(t => t.tokenAddress !== tokenAddress),
        completedTrades: [completedTrade, ...prev.completedTrades].slice(0, 50),
        totalTraded: prev.totalTraded + 1,
        totalSuccessful: prev.totalSuccessful + (result.success ? 1 : 0),
        totalFailed: prev.totalFailed + (result.success ? 0 : 1),
      }));

      if (result.success) {
        log(`BOUGHT ${tokenSymbol}! TX: ${result.signature?.slice(0, 8)}...`, 'success');

        // ALWAYS create position for tracking (regardless of autoSellEnabled)
        // This ensures we always know what we bought
        const createPosition = async (retryCount = 0): Promise<void> => {
          const maxRetries = 5; // Increased retries
          const delay = 1500 + (retryCount * 1000); // 1.5s, 2.5s, 3.5s, 4.5s, 5.5s

          await new Promise(resolve => setTimeout(resolve, delay));

          try {
            log(`Getting balance for ${tokenSymbol}... (attempt ${retryCount + 1})`, 'info');
            const balanceInfo = await getTokenBalance(tokenAddress, publicKey.toString());

            // Calculate actual SOL spent
            const balanceAfter = await tradingWallet.getBalance();
            const actualSolSpent = balanceBefore - balanceAfter;
            const entrySol = actualSolSpent > 0 && actualSolSpent < currentConfig.buyAmountSol * 1.5
              ? actualSolSpent
              : currentConfig.buyAmountSol;

            if (balanceInfo && balanceInfo.balance > 0) {
              const newPosition: Position = {
                tokenAddress,
                tokenSymbol,
                entryTimestamp: Date.now(),
                entrySolAmount: entrySol,
                tokenAmount: balanceInfo.balance,
                tokenDecimals: balanceInfo.decimals,
                currentValueSol: entrySol,
                highestValueSol: entrySol,
                pnlPercent: 0,
                txSignature: result.signature || '',
                status: 'active',
              };

              setState(prev => ({
                ...prev,
                positions: [...prev.positions, newPosition],
              }));

              log(`POSITION CREATED: ${tokenSymbol} (${entrySol.toFixed(4)} SOL, ${balanceInfo.balance} tokens)`, 'success');
            } else if (retryCount < maxRetries) {
              log(`No balance yet for ${tokenSymbol}, retrying...`, 'warning');
              await createPosition(retryCount + 1);
            } else {
              // Create position with estimated values after retries exhausted
              // ALWAYS create position even without balance - we can recover later
              log(`Creating ${tokenSymbol} position with estimated values (balance check failed)`, 'warning');
              const newPosition: Position = {
                tokenAddress,
                tokenSymbol,
                entryTimestamp: Date.now(),
                entrySolAmount: entrySol,
                tokenAmount: 0, // Unknown - will be recovered on next scan
                tokenDecimals: 6,
                currentValueSol: entrySol,
                highestValueSol: entrySol,
                pnlPercent: 0,
                txSignature: result.signature || '',
                status: 'active',
              };

              setState(prev => ({
                ...prev,
                positions: [...prev.positions, newPosition],
              }));
              log(`POSITION CREATED (estimated): ${tokenSymbol}`, 'warning');
            }
          } catch (e) {
            console.error('[AutoTrade] Position creation error:', e);
            log(`Position creation error for ${tokenSymbol}: ${e}`, 'error');
            if (retryCount < maxRetries) {
              await createPosition(retryCount + 1);
            } else {
              // LAST RESORT: Create position anyway with defaults
              log(`FORCE creating position for ${tokenSymbol} after all retries failed`, 'error');
              const newPosition: Position = {
                tokenAddress,
                tokenSymbol,
                entryTimestamp: Date.now(),
                entrySolAmount: currentConfig.buyAmountSol,
                tokenAmount: 0,
                tokenDecimals: 6,
                currentValueSol: currentConfig.buyAmountSol,
                highestValueSol: currentConfig.buyAmountSol,
                pnlPercent: 0,
                txSignature: result.signature || '',
                status: 'active',
              };

              setState(prev => ({
                ...prev,
                positions: [...prev.positions, newPosition],
              }));
            }
          }
        };

        // AWAIT position creation so we don't lose it
        try {
          await createPosition();
        } catch (e) {
          log(`CRITICAL: Position creation failed completely for ${tokenSymbol}`, 'error');
          console.error('[AutoTrade] CRITICAL position creation failure:', e);
        }

        refreshBalance(); // Update balance after trade
      } else {
        log(`FAILED: ${tokenSymbol} - ${result.error}`, 'error');
      }

      onTradeExecuted?.(completedTrade);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      const failedTrade: PendingTrade = {
        ...trade,
        status: 'failed',
        error: errorMsg,
      };

      setState(prev => ({
        ...prev,
        isTrading: false,
        pendingTrades: prev.pendingTrades.filter(t => t.tokenAddress !== tokenAddress),
        completedTrades: [failedTrade, ...prev.completedTrades].slice(0, 50),
        totalTraded: prev.totalTraded + 1,
        totalFailed: prev.totalFailed + 1,
      }));

      log(`ERROR: ${tokenSymbol} - ${errorMsg}`, 'error');
      onTradeExecuted?.(failedTrade);

      return { success: false, error: errorMsg };
    }
  }, [log, onTradeExecuted, refreshBalance]);

  /**
   * Handle an approved token signal from the backend
   * This is called when AI approves a token for trading
   */
  const handleApprovedToken = useCallback(async (
    tokenAddress: string,
    tokenSymbol: string,
    riskScore: number
  ) => {
    // Use ref to get latest config (avoids stale closure)
    const currentConfig = configRef.current;

    // Check if auto-trade is enabled
    if (!currentConfig.enabled) {
      log(`Auto-trade disabled, skipping ${tokenSymbol}`, 'info');
      return;
    }

    // Check trading wallet is ready - use tradingWallet directly to avoid stale state
    if (!tradingWallet.isReady()) {
      // Try to load it if it exists but wasn't loaded yet
      if (tradingWallet.exists()) {
        tradingWallet.load();
      }
      if (!tradingWallet.isReady()) {
        log(`Trading wallet not ready, skipping ${tokenSymbol}`, 'warning');
        return;
      }
    }

    // SAFETY: Check trade cooldown
    if (currentConfig.tradeCooldownSeconds > 0) {
      const timeSinceLastTrade = (Date.now() - lastTradeTimeRef.current) / 1000;
      if (timeSinceLastTrade < currentConfig.tradeCooldownSeconds) {
        const waitTime = Math.ceil(currentConfig.tradeCooldownSeconds - timeSinceLastTrade);
        log(`Cooldown: ${waitTime}s remaining, skipping ${tokenSymbol}`, 'info');
        return;
      }
    }

    // SAFETY: Check max trades per session (0 = unlimited)
    if (currentConfig.maxTradesPerSession > 0 && state.totalTraded >= currentConfig.maxTradesPerSession) {
      log(`MAX TRADES REACHED (${currentConfig.maxTradesPerSession}) - Auto-trade paused!`, 'warning');
      setConfig(prev => ({ ...prev, enabled: false }));
      return;
    }

    // SAFETY: Check reserve balance - don't go below minimum
    const currentBalance = await tradingWallet.getBalance();
    const requiredBalance = currentConfig.buyAmountSol + currentConfig.reserveBalanceSol + ESTIMATED_FEE_SOL;
    if (currentBalance < requiredBalance) {
      log(`RESERVE LIMIT: Balance ${currentBalance.toFixed(3)} SOL below reserve ${currentConfig.reserveBalanceSol} SOL - Stopping!`, 'warning');
      setConfig(prev => ({ ...prev, enabled: false }));
      return;
    }

    // Check score threshold (higher = better in new system)
    if (riskScore < currentConfig.minScore) {
      log(`Score ${riskScore} < min ${currentConfig.minScore}, skipping ${tokenSymbol}`, 'warning');
      return;
    }

    // Check if already buying this token (prevent race condition)
    if (isBuyingRef.current.has(tokenAddress)) {
      log(`Already buying ${tokenSymbol}, skipping`, 'info');
      return;
    }

    // Check if we already traded this token (check both ref AND positions)
    if (tradedTokensRef.current.has(tokenAddress)) {
      log(`Already traded ${tokenSymbol}, skipping`, 'info');
      return;
    }

    // Also check active positions to prevent race conditions
    const hasPosition = state.positions.some(p => p.tokenAddress === tokenAddress);
    if (hasPosition) {
      log(`Already holding ${tokenSymbol}, skipping`, 'info');
      tradedTokensRef.current.add(tokenAddress);
      return;
    }

    // Mark as buying AND traded IMMEDIATELY to prevent duplicates
    isBuyingRef.current.add(tokenAddress);
    tradedTokensRef.current.add(tokenAddress);

    log(`AUTO-TRADE TRIGGERED: ${tokenSymbol} (Risk: ${riskScore})`, 'success');

    // Update last trade time for cooldown
    lastTradeTimeRef.current = Date.now();

    // Execute the trade - NO CONFIRMATION NEEDED
    log(`Calling executeTrade for ${tokenSymbol}...`, 'info');
    try {
      const result = await executeTrade(tokenAddress, tokenSymbol, riskScore);
      log(`executeTrade returned for ${tokenSymbol}: ${result.success ? 'SUCCESS' : result.error}`, result.success ? 'success' : 'error');
      if (!result.success) {
        log(`Trade failed: ${tokenSymbol} - ${result.error}`, 'error');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      log(`TRADE ERROR: ${tokenSymbol} - ${msg}`, 'error');
      console.error('[AutoTrade] Trade error:', error);
    } finally {
      // Clear buying flag after trade completes (success or fail)
      isBuyingRef.current.delete(tokenAddress);
    }
  }, [state.totalTraded, state.positions, executeTrade, log]);

  /**
   * Update auto-trade configuration
   */
  const updateConfig = useCallback((updates: Partial<AutoTradeConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  /**
   * Toggle auto-trade on/off
   */
  const toggleEnabled = useCallback(() => {
    if (!wallet.isLoaded) {
      log('Create a trading wallet first', 'warning');
      return;
    }

    setConfig(prev => {
      const newEnabled = !prev.enabled;
      log(`Auto-trade ${newEnabled ? 'ENABLED' : 'DISABLED'}`, newEnabled ? 'success' : 'info');
      return { ...prev, enabled: newEnabled };
    });
  }, [wallet.isLoaded, log]);

  /**
   * Clear trade history
   */
  const clearHistory = useCallback(() => {
    setState(prev => ({
      ...prev,
      completedTrades: [],
      soldPositions: [],
      totalTraded: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      totalSold: 0,
      totalProfitSol: 0,
    }));
    tradedTokensRef.current.clear();
  }, []);

  /**
   * Manual sell a position
   */
  const manualSell = useCallback(async (tokenAddress: string): Promise<SwapResult> => {
    // Check wallet first
    if (!tradingWallet.isReady()) {
      log('Trading wallet not ready', 'error');
      return { success: false, error: 'Trading wallet not ready' };
    }

    const position = state.positions.find(p => p.tokenAddress === tokenAddress);
    if (!position) {
      log('Position not found', 'error');
      return { success: false, error: 'Position not found' };
    }

    log(`Manual sell initiated for ${position.tokenSymbol}`, 'info');
    return executeSell(position, 'manual');
  }, [state.positions, executeSell, log]);

  /**
   * Sell all positions
   */
  const sellAllPositions = useCallback(async () => {
    // Check wallet first
    if (!tradingWallet.isReady()) {
      log('Trading wallet not ready', 'error');
      return;
    }

    // Include 'active' and 'failed' positions (not 'selling' to avoid duplicates)
    const sellablePositions = state.positions.filter(p => p.status === 'active' || p.status === 'failed');

    if (sellablePositions.length === 0) {
      log('No positions to sell', 'warning');
      return;
    }

    log(`Selling ${sellablePositions.length} positions...`, 'warning');

    for (const position of sellablePositions) {
      const result = await executeSell(position, 'manual');
      if (!result.success) {
        log(`Failed to sell ${position.tokenSymbol}: ${result.error}`, 'error');
      }
      // Small delay between sells to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    log('Sell all completed', 'info');
  }, [state.positions, executeSell, log]);

  /**
   * Clear a position without selling (for tokens already sold externally)
   */
  const clearPosition = useCallback((tokenAddress: string) => {
    setState(prev => ({
      ...prev,
      positions: prev.positions.filter(p => p.tokenAddress !== tokenAddress),
    }));
    log('Position cleared', 'info');
  }, [log]);

  /**
   * Clear all positions without selling
   */
  const clearAllPositions = useCallback(() => {
    setState(prev => ({
      ...prev,
      positions: [],
    }));
    log('All positions cleared', 'info');
  }, [log]);

  /**
   * Clear sold positions history
   */
  const clearSoldHistory = useCallback(() => {
    setState(prev => ({
      ...prev,
      soldPositions: [],
      totalSold: 0,
      totalProfitSol: 0,
    }));
    log('History cleared', 'info');
  }, [log]);

  /**
   * Recover untracked positions from wallet
   * Scans wallet for token balances not in positions array
   */
  const recoverUntrackedPositions = useCallback(async (): Promise<number> => {
    const walletAddress = tradingWallet.getAddress();
    console.log('[Recovery] Starting scan, wallet:', walletAddress);

    if (!walletAddress) {
      log('Wallet not ready for recovery scan', 'warning');
      return 0;
    }

    log(`Scanning wallet ${walletAddress.slice(0, 8)}...`, 'info');

    try {
      console.log('[Recovery] Fetching all token balances...');
      const tokenBalances = await getAllTokenBalances(walletAddress);
      console.log('[Recovery] Found token balances:', tokenBalances.length, tokenBalances.map(t => ({ mint: t.mint.slice(0, 8), balance: t.balance })));

      if (tokenBalances.length === 0) {
        log('No token balances found in wallet', 'info');
        return 0;
      }

      log(`Found ${tokenBalances.length} tokens in wallet`, 'info');

      // Filter out tokens already in ACTIVE positions only
      // DO NOT filter out soldPositions - if token is still in wallet, it wasn't actually sold!
      const activePositionAddresses = new Set(state.positions.map(p => p.tokenAddress));
      console.log('[Recovery] Active positions:', state.positions.length, Array.from(activePositionAddresses).map(a => a.slice(0, 8)));

      const untrackedTokens = tokenBalances.filter(t => !activePositionAddresses.has(t.mint));
      console.log('[Recovery] Untracked tokens:', untrackedTokens.length, untrackedTokens.map(t => t.mint.slice(0, 8)));

      if (untrackedTokens.length === 0) {
        log('All tokens are already tracked as active positions', 'info');
        return 0;
      }

      log(`Found ${untrackedTokens.length} untracked token(s)`, 'warning');

      // Create recovered positions for each untracked token
      const recoveredPositions: Position[] = [];

      for (const token of untrackedTokens) {
        try {
          // Get current value in SOL
          const currentValueSol = await getTokenValueInSol(token.mint, token.balance, token.decimals);

          // Use truncated address as symbol (recovered positions don't have symbol data)
          const tokenSymbol = token.mint.slice(0, 6) + '...' + token.mint.slice(-4);

          const position: Position = {
            tokenAddress: token.mint,
            tokenSymbol: `${tokenSymbol} (recovered)`,
            entryTimestamp: Date.now(), // Unknown, use now
            entrySolAmount: currentValueSol || 0.01, // Unknown entry, estimate from current value
            tokenAmount: token.balance,
            tokenDecimals: token.decimals,
            currentValueSol: currentValueSol || 0,
            highestValueSol: currentValueSol || 0,
            pnlPercent: 0, // Unknown
            txSignature: 'recovered',
            status: 'active',
          };

          recoveredPositions.push(position);
          tradedTokensRef.current.add(token.mint);

          log(`Recovered: ${tokenSymbol} (${currentValueSol?.toFixed(4) || '?'} SOL)`, 'success');

          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          console.error(`[AutoTrade] Failed to recover token ${token.mint}:`, error);
        }
      }

      if (recoveredPositions.length > 0) {
        setState(prev => ({
          ...prev,
          positions: [...prev.positions, ...recoveredPositions],
        }));

        log(`Recovered ${recoveredPositions.length} position(s)!`, 'success');
      }

      return recoveredPositions.length;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log(`Recovery scan failed: ${errorMsg}`, 'error');
      return 0;
    }
  }, [state.positions, state.soldPositions, log]);

  /**
   * Check if ready for automated trading
   */
  const isReady = wallet.isLoaded && wallet.balance >= config.buyAmountSol;

  return {
    // State
    config,
    state,
    wallet,
    isReady,

    // Wallet actions
    generateWallet,
    importWallet,
    deleteWallet,
    exportPrivateKey,
    withdraw,
    refreshBalance,
    getWalletName,
    setWalletName,

    // Trading actions
    handleApprovedToken,
    executeTrade,
    updateConfig,
    toggleEnabled,
    clearHistory,

    // Sell actions
    manualSell,
    sellAllPositions,
    clearPosition,
    clearAllPositions,
    clearSoldHistory,

    // Recovery
    recoverUntrackedPositions,
  };
}

export type { SwapResult };