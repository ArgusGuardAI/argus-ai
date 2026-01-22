import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { analyzeToken } from './lib/api';
import { buyToken, sellToken, getTokenBalance, formatTokenAmount, getTokenPrice, PriceWebSocket, getUserPurchasePrice, getTokenValueInSol } from './lib/jupiter';
import { useAuth } from './contexts/AuthContext';
import { AIBrainDashboard } from './components/AIBrainDashboard';
import { PerformanceChart } from './components/PerformanceChart';
import { NeuralFlow } from './components/NeuralFlow';
import { DecisionMatrix } from './components/DecisionMatrix';
import type { AnalysisResult, BundleInfo } from './types';

// AI Visualization types
type VisualizationType = 'brain' | 'chart' | 'neural' | 'matrix';

const visualizations: { id: VisualizationType; name: string; icon: string }[] = [
  { id: 'brain', name: 'AI Brain', icon: 'fa-brain' },
  { id: 'chart', name: 'Performance', icon: 'fa-chart-area' },
  { id: 'neural', name: 'Neural Flow', icon: 'fa-network-wired' },
  { id: 'matrix', name: 'Matrix', icon: 'fa-table-cells' },
];

// Default bundle info when not available
const defaultBundleInfo: BundleInfo = {
  detected: false,
  confidence: 'NONE',
  count: 0,
};

// Tier badge component
function TierBadge({ tier }: { tier: 'free' | 'holder' | 'pro' }) {
  const colors = {
    free: 'bg-zinc-700 text-zinc-300',
    holder: 'bg-argus-accent/20 text-argus-accent border border-argus-accent/50',
    pro: 'bg-orange-500/20 text-orange-400 border border-orange-500/50',
  };
  const labels = { free: 'Free', holder: 'Holder', pro: 'Pro' };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[tier]}`}>
      {labels[tier]}
    </span>
  );
}

// Trade Panel Component
function TradePanel({
  result,
  connected,
  tier,
  publicKey,
  signTransaction,
  bundleInfo,
  onStateChange
}: {
  result: AnalysisResult;
  connected: boolean;
  tier: 'free' | 'holder' | 'pro';
  publicKey: ReturnType<typeof useWallet>['publicKey'];
  signTransaction: ReturnType<typeof useWallet>['signTransaction'];
  bundleInfo: BundleInfo;
  onStateChange?: (state: {
    enabled: boolean;
    entryPrice: number | null;
    currentPrice: number | null;
    pnl: number;
    settings: { takeProfitPercent: number; stopLossPercent: number; rugProtection: boolean };
    log: Array<{ time: Date; message: string; type: 'info' | 'success' | 'warning' | 'error' }>;
  }) => void;
}) {
  const [amount, setAmount] = useState('0.01');
  const [slippage, setSlippage] = useState('1');
  const [isTrading, setIsTrading] = useState(false);
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string; signature?: string } | null>(null);
  const [tokenBalance, setTokenBalance] = useState<{ balance: number; decimals: number } | null>(null);
  const [sellPercent, setSellPercent] = useState(100);
  const [livePrice, setLivePrice] = useState<{ priceUsd: number; priceChange24h: number; volume24h: number; liquidity: number; marketCap?: number } | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [argusAiEnabled, setArgusAiEnabled] = useState(false);

  // Argus AI automation state
  const [entryPrice, setEntryPrice] = useState<number | null>(null);
  const [entrySource, setEntrySource] = useState<'current' | 'purchase'>('current');
  const [aiSettings, setAiSettings] = useState({
    takeProfitPercent: 10, // +10% profit target
    stopLossPercent: 30, // -30%
    rugProtection: true,
  });
  const [entrySol, setEntrySol] = useState<number | null>(null); // Track SOL spent for accurate P&L
  const [currentSolValue, setCurrentSolValue] = useState<number | null>(null); // Current SOL value of position
  const [aiLog, setAiLog] = useState<Array<{ time: Date; message: string; type: 'info' | 'success' | 'warning' | 'error' }>>([]);
  const [aiExecuting, setAiExecuting] = useState(false);
  const [lastRiskCheck, setLastRiskCheck] = useState<number | null>(null);

  // Calculate sell amount based on percentage
  const sellAmount = tokenBalance ? Math.floor((tokenBalance.balance * sellPercent) / 100) : 0;
  const sellDisplay = tokenBalance ? formatTokenAmount(sellAmount, tokenBalance.decimals) : '0';

  // Current price - prefer live price, fallback to analysis result
  const currentPrice = livePrice?.priceUsd ?? result.market?.priceUsd;
  const currentPriceChange = livePrice?.priceChange24h ?? result.market?.priceChange24h;

  // Calculate P&L when AI is active
  // USD P&L = price change percentage (updates in real-time)
  const usdPnlPercent = entryPrice && currentPrice ? ((currentPrice - entryPrice) / entryPrice) * 100 : null;
  // SOL P&L from Jupiter quote (more accurate but updates every 30s)
  const solPnlPercent = entrySol && currentSolValue ? ((currentSolValue - entrySol) / entrySol) * 100 : null;
  // Use USD P&L for display (real-time), SOL P&L for trade decisions when available
  const pnlPercent = usdPnlPercent;

  // Add to AI log
  const addAiLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setAiLog(prev => [...prev.slice(-9), { time: new Date(), message, type }]);
  };

  // Sync AI state to parent for visualization components
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        enabled: argusAiEnabled,
        entryPrice,
        currentPrice: currentPrice ?? null,
        pnl: pnlPercent ?? 0,
        settings: {
          takeProfitPercent: aiSettings.takeProfitPercent,
          stopLossPercent: aiSettings.stopLossPercent,
          rugProtection: aiSettings.rugProtection,
        },
        log: aiLog,
      });
    }
  }, [argusAiEnabled, entryPrice, currentPrice, pnlPercent, aiSettings, aiLog, onStateChange]);

  // Fetch token balance when connected
  useEffect(() => {
    if (connected && publicKey && result.tokenAddress) {
      getTokenBalance(result.tokenAddress, publicKey.toString()).then(setTokenBalance);
    }
  }, [connected, publicKey, result.tokenAddress]);

  // Fetch purchase price when user has a position (regardless of AI state)
  useEffect(() => {
    if (currentPrice && !entryPrice && publicKey && tokenBalance && tokenBalance.balance > 0) {
      // Try to get actual purchase price from transaction history
      if (argusAiEnabled) {
        addAiLog(`Fetching your purchase price...`, 'info');
      }

      getUserPurchasePrice(result.tokenAddress, publicKey.toString()).then(purchaseData => {
        if (purchaseData && purchaseData.avgPrice > 0) {
          // Use actual purchase price and SOL spent
          setEntryPrice(purchaseData.avgPrice);
          setEntrySol(purchaseData.totalSolSpent); // Store SOL for reference
          setEntrySource('purchase');
          if (argusAiEnabled) {
            addAiLog(`Found entry: $${purchaseData.avgPrice.toFixed(8)} (from tx)`, 'success');
            addAiLog(`Take profit: +${aiSettings.takeProfitPercent}% ($${(purchaseData.avgPrice * (1 + aiSettings.takeProfitPercent / 100)).toFixed(8)})`, 'info');
            addAiLog(`Stop loss: -${aiSettings.stopLossPercent}% ($${(purchaseData.avgPrice * (1 - aiSettings.stopLossPercent / 100)).toFixed(8)})`, 'info');
          }
        } else {
          // Fallback to current price
          setEntryPrice(currentPrice);
          setEntrySol(null);
          setEntrySource('current');
          if (argusAiEnabled) {
            addAiLog(`Entry: $${currentPrice.toFixed(8)} (current price)`, 'info');
            addAiLog(`Take profit: +${aiSettings.takeProfitPercent}%`, 'info');
            addAiLog(`Stop loss: -${aiSettings.stopLossPercent}%`, 'info');
          }
        }
      });
    }
    // Only clear entry when AI is disabled AND we want to reset
    if (!argusAiEnabled && entryPrice) {
      // Keep entry price for display, just clear AI-specific state
      setAiLog([]);
    }
  }, [currentPrice, publicKey, result.tokenAddress, tokenBalance, argusAiEnabled]);

  // Fetch current SOL value of position periodically for accurate P&L
  // Use 30s interval to avoid Helius rate limits (Jupiter quote uses RPC)
  useEffect(() => {
    if (!argusAiEnabled || !entrySol || !tokenBalance || tokenBalance.balance === 0) {
      return;
    }

    let isMounted = true;
    let retryCount = 0;

    const fetchSolValue = async () => {
      try {
        const solValue = await getTokenValueInSol(result.tokenAddress, tokenBalance.balance);
        if (solValue !== null && isMounted) {
          setCurrentSolValue(solValue);
          retryCount = 0; // Reset on success
          console.log(`[AI] SOL value: ${solValue.toFixed(6)} SOL (entry: ${entrySol.toFixed(6)} SOL)`);
        }
      } catch (err) {
        retryCount++;
        console.warn(`[AI] SOL value fetch failed (attempt ${retryCount})`);
      }
    };

    // Fetch immediately and then every 30 seconds to avoid rate limits
    fetchSolValue();
    const interval = setInterval(fetchSolValue, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [argusAiEnabled, entrySol, tokenBalance, result.tokenAddress]);

  // Argus AI automation - monitor and execute
  useEffect(() => {
    if (!argusAiEnabled || !entryPrice || !currentPrice || !tokenBalance || tokenBalance.balance === 0) {
      return;
    }
    if (!connected || !publicKey || !signTransaction || aiExecuting) {
      return;
    }

    const checkAndExecute = async () => {
      // Use USD P&L for decisions (real-time) - SOL P&L is too slow to update
      const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
      const takeProfitTarget = aiSettings.takeProfitPercent; // e.g., 10%

      // Check Take Profit
      if (pnl >= takeProfitTarget) {
        addAiLog(`TAKE PROFIT triggered! +${pnl.toFixed(1)}% gain`, 'success');
        setAiExecuting(true);

        try {
          const sellAmt = tokenBalance.balance; // Sell 100%
          const slippageBps = 500; // 5% slippage for AI auto-sells (low liquidity tokens need more)

          addAiLog(`Selling 100% (${slippageBps/100}% slippage)...`, 'info');
          const swapResult = await sellToken(
            result.tokenAddress,
            sellAmt,
            publicKey,
            signTransaction,
            slippageBps,
            true // withAiFee
          );

          if (swapResult.success) {
            addAiLog(`SOLD! TX: ${swapResult.signature?.slice(0, 8)}... +${pnl.toFixed(1)}%`, 'success');
            setArgusAiEnabled(false);
            setTradeResult({
              success: true,
              message: `AI Take Profit: Sold at +${pnl.toFixed(1)}%!`,
              signature: swapResult.signature
            });
            // Refresh balance
            setTimeout(() => {
              getTokenBalance(result.tokenAddress, publicKey.toString()).then(setTokenBalance);
            }, 2000);
          } else {
            addAiLog(`Sell failed: ${swapResult.error}`, 'error');
          }
        } catch (err) {
          addAiLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
        } finally {
          setAiExecuting(false);
        }
        return;
      }

      // Check Stop Loss
      if (pnl <= -aiSettings.stopLossPercent) {
        addAiLog(`STOP LOSS triggered! ${pnl.toFixed(1)}% loss`, 'warning');
        setAiExecuting(true);

        try {
          const sellAmt = tokenBalance.balance; // Sell 100%
          const slippageBps = 700; // 7% slippage for emergency stop loss (must exit!)

          addAiLog(`Emergency selling 100% (${slippageBps/100}% slippage)...`, 'warning');
          const swapResult = await sellToken(
            result.tokenAddress,
            sellAmt,
            publicKey,
            signTransaction,
            slippageBps,
            true // withAiFee
          );

          if (swapResult.success) {
            addAiLog(`SOLD! TX: ${swapResult.signature?.slice(0, 8)}... ${pnl.toFixed(1)}%`, 'success');
            setArgusAiEnabled(false);
            setTradeResult({
              success: true,
              message: `AI Stop Loss: Sold at ${pnl.toFixed(1)}%`,
              signature: swapResult.signature
            });
            setTimeout(() => {
              getTokenBalance(result.tokenAddress, publicKey.toString()).then(setTokenBalance);
            }, 2000);
          } else {
            addAiLog(`Sell failed: ${swapResult.error}`, 'error');
          }
        } catch (err) {
          addAiLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
        } finally {
          setAiExecuting(false);
        }
        return;
      }

      // Check Rug Protection - re-analyze token every 30 seconds
      if (aiSettings.rugProtection) {
        const now = Date.now();
        if (!lastRiskCheck || now - lastRiskCheck > 30000) {
          setLastRiskCheck(now);

          try {
            const freshAnalysis = await analyzeToken(result.tokenAddress);

            // If risk score jumps significantly or becomes SCAM/DANGEROUS
            if (freshAnalysis.riskScore >= 80 ||
                (freshAnalysis.riskScore - result.riskScore >= 20)) {
              addAiLog(`RUG ALERT! Risk score spiked to ${freshAnalysis.riskScore}`, 'error');
              setAiExecuting(true);

              const sellAmt = tokenBalance.balance;
              const slippageBps = 1000; // 10% slippage for rug escape (must exit immediately!)

              addAiLog(`EMERGENCY SELL - Potential rug! (10% slippage)`, 'error');
              const swapResult = await sellToken(
                result.tokenAddress,
                sellAmt,
                publicKey,
                signTransaction,
                slippageBps,
                true
              );

              if (swapResult.success) {
                addAiLog(`ESCAPED! TX: ${swapResult.signature?.slice(0, 8)}...`, 'success');
                setArgusAiEnabled(false);
                setTradeResult({
                  success: true,
                  message: `AI Rug Protection: Emergency exit!`,
                  signature: swapResult.signature
                });
                setTimeout(() => {
                  getTokenBalance(result.tokenAddress, publicKey.toString()).then(setTokenBalance);
                }, 2000);
              } else {
                addAiLog(`Emergency sell failed: ${swapResult.error}`, 'error');
              }
              setAiExecuting(false);
            }
          } catch (err) {
            // Silently fail risk checks
            console.error('[AI] Risk check failed:', err);
          }
        }
      }

      // Check Bundle Pattern - DUMP IMMINENT detection (uses backend analysis)
      // HIGH/MEDIUM confidence = definitive bundle, take action
      // LOW confidence = possible bundle, just warn
      const isDumpImminent = bundleInfo.detected && (bundleInfo.confidence === 'HIGH' || bundleInfo.confidence === 'MEDIUM');

      if (isDumpImminent && pnl > 0) {
        const confidenceLabel = bundleInfo.confidence === 'HIGH' ? 'CONFIRMED' : 'LIKELY';
        addAiLog(`BUNDLE ${confidenceLabel}! ${bundleInfo.count} coordinated wallets`, 'warning');
        if (bundleInfo.description) {
          addAiLog(bundleInfo.description, 'warning');
        }
        addAiLog(`Securing profits before potential dump...`, 'warning');
        setAiExecuting(true);

        try {
          const sellAmt = tokenBalance.balance;
          const slippageBps = bundleInfo.confidence === 'HIGH' ? 800 : 600; // High slippage for dump escape (8%/6%)

          addAiLog(`Selling 100% (${slippageBps/100}% slippage)...`, 'warning');
          const swapResult = await sellToken(
            result.tokenAddress,
            sellAmt,
            publicKey,
            signTransaction,
            slippageBps,
            true
          );

          if (swapResult.success) {
            addAiLog(`SECURED! TX: ${swapResult.signature?.slice(0, 8)}... +${pnl.toFixed(1)}%`, 'success');
            setArgusAiEnabled(false);
            setTradeResult({
              success: true,
              message: `AI Dump Protection: Secured +${pnl.toFixed(1)}% before dump!`,
              signature: swapResult.signature
            });
            setTimeout(() => {
              getTokenBalance(result.tokenAddress, publicKey.toString()).then(setTokenBalance);
            }, 2000);
          } else {
            addAiLog(`Sell failed: ${swapResult.error}`, 'error');
          }
        } catch (err) {
          addAiLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
        } finally {
          setAiExecuting(false);
        }
      } else if (bundleInfo.confidence === 'LOW' && pnl > 0) {
        // Just warn for LOW confidence, don't auto-sell
        addAiLog(`Possible bundle pattern (low confidence) - monitoring...`, 'info');
      }
    };

    // Check conditions on every price update
    checkAndExecute();
  }, [argusAiEnabled, currentPrice, entryPrice, tokenBalance, aiSettings, connected, publicKey, signTransaction, aiExecuting, lastRiskCheck, result.tokenAddress, result.riskScore, bundleInfo]);

  // WebSocket + polling for real-time price
  useEffect(() => {
    let priceWs: PriceWebSocket | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let isWsConnected = false;

    const fetchPrice = async () => {
      const price = await getTokenPrice(result.tokenAddress);
      if (price) {
        setLivePrice(price);
        setLastPriceUpdate(new Date());
      }
    };

    const setupWebSocket = async () => {
      // Initial fetch
      await fetchPrice();

      // Try WebSocket connection
      priceWs = new PriceWebSocket(result.tokenAddress, (newPrice) => {
        console.log('[Price] WebSocket update:', newPrice);
        setLivePrice(prev => prev ? { ...prev, priceUsd: newPrice } : null);
        setLastPriceUpdate(new Date());
      });

      isWsConnected = await priceWs.connect();
      setWsConnected(isWsConnected);

      if (isWsConnected) {
        console.log('[Price] Using WebSocket for real-time updates');
        // Poll every 10s for volume/liquidity updates
        pollInterval = setInterval(fetchPrice, 10000);
      } else {
        console.log('[Price] WebSocket failed, using 5s polling');
        // Fallback to polling (not too fast to avoid rate limits)
        pollInterval = setInterval(fetchPrice, 5000);
      }
    };

    setupWebSocket();

    return () => {
      if (priceWs) priceWs.disconnect();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [result.tokenAddress]);

  const handleTrade = async (action: 'buy' | 'sell') => {
    if (!connected || !publicKey || !signTransaction) return;

    setIsTrading(true);
    setTradeResult(null);

    try {
      const slippageBps = Math.floor(parseFloat(slippage) * 100); // Convert % to basis points

      let swapResult;
      if (action === 'buy') {
        const solAmount = parseFloat(amount);
        if (isNaN(solAmount) || solAmount <= 0) {
          setTradeResult({ success: false, message: 'Invalid amount' });
          setIsTrading(false);
          return;
        }
        swapResult = await buyToken(
          result.tokenAddress,
          solAmount,
          publicKey,
          signTransaction,
          slippageBps
        );
      } else {
        // Sell - use percentage of holdings
        if (!tokenBalance || tokenBalance.balance === 0) {
          setTradeResult({ success: false, message: 'No tokens to sell' });
          setIsTrading(false);
          return;
        }
        const sellAmount = Math.floor((tokenBalance.balance * sellPercent) / 100);
        swapResult = await sellToken(
          result.tokenAddress,
          sellAmount,
          publicKey,
          signTransaction,
          slippageBps
        );
      }

      if (swapResult.success) {
        setTradeResult({
          success: true,
          message: `${action === 'buy' ? 'Bought' : 'Sold'} successfully!`,
          signature: swapResult.signature
        });
        // Refresh balance after trade
        if (publicKey) {
          setTimeout(() => {
            getTokenBalance(result.tokenAddress, publicKey.toString()).then(setTokenBalance);
          }, 2000);
        }
      } else {
        setTradeResult({
          success: false,
          message: swapResult.error || 'Trade failed'
        });
      }
    } catch (error) {
      setTradeResult({
        success: false,
        message: error instanceof Error ? error.message : 'Trade failed'
      });
    } finally {
      setIsTrading(false);
    }
  };

  return (
    <div className="bg-argus-card border border-argus-border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <i className="fa-solid fa-bolt text-argus-accent" />
        Quick Trade
      </h3>

      {!connected ? (
        <p className="text-zinc-500 text-sm">Connect wallet to trade</p>
      ) : (
        <div className="space-y-3">
          {/* Position Status */}
          {tokenBalance && tokenBalance.balance > 0 && (
            <div className="bg-argus-bg/50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-500">Your Position</span>
                <span className="text-sm text-white font-semibold">
                  {formatTokenAmount(tokenBalance.balance, tokenBalance.decimals)} {result.market?.symbol}
                </span>
              </div>
              {currentPrice !== undefined && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500 flex items-center gap-1">
                      Token Price
                      {livePrice && (
                        <span className={`inline-flex items-center gap-1 ${wsConnected ? 'text-green-400' : 'text-yellow-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${wsConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
                          <span className="text-[10px]">{wsConnected ? 'WS' : '1s'}</span>
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-white">
                      ${currentPrice < 0.00001
                        ? currentPrice.toExponential(2)
                        : currentPrice < 1
                          ? currentPrice.toFixed(6)
                          : currentPrice.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500">Position Value</span>
                    <span className="text-sm text-green-400 font-semibold">
                      ${((tokenBalance.balance / Math.pow(10, tokenBalance.decimals)) * currentPrice).toFixed(2)}
                    </span>
                  </div>
                  {/* P&L Display - Always show when we have entry price */}
                  {pnlPercent !== null && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-500">
                        P&L {entrySource === 'purchase' ? '(from tx)' : ''}
                      </span>
                      <span className={`text-sm font-bold ${pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                      </span>
                    </div>
                  )}
                  {entryPrice && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-500">Entry Price</span>
                      <span className="text-xs text-zinc-400">
                        ${entryPrice < 0.00001 ? entryPrice.toExponential(2) : entryPrice.toFixed(6)}
                      </span>
                    </div>
                  )}
                  {currentPriceChange !== undefined && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-500">24h Change</span>
                      <span className={`text-sm font-medium ${currentPriceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {currentPriceChange >= 0 ? '+' : ''}{currentPriceChange.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {livePrice && (
                    <>
                      {livePrice.marketCap !== undefined && livePrice.marketCap > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-500">Market Cap</span>
                          <span className="text-sm text-white font-medium">
                            ${livePrice.marketCap >= 1e6
                              ? (livePrice.marketCap / 1e6).toFixed(2) + 'M'
                              : livePrice.marketCap >= 1e3
                                ? (livePrice.marketCap / 1e3).toFixed(1) + 'K'
                                : livePrice.marketCap.toFixed(0)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">24h Volume</span>
                        <span className="text-sm text-white">
                          ${livePrice.volume24h >= 1e6
                            ? (livePrice.volume24h / 1e6).toFixed(1) + 'M'
                            : livePrice.volume24h >= 1e3
                              ? (livePrice.volume24h / 1e3).toFixed(1) + 'K'
                              : livePrice.volume24h.toFixed(0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">Liquidity</span>
                        <span className="text-sm text-white">
                          ${livePrice.liquidity >= 1e6
                            ? (livePrice.liquidity / 1e6).toFixed(1) + 'M'
                            : livePrice.liquidity >= 1e3
                              ? (livePrice.liquidity / 1e3).toFixed(1) + 'K'
                              : livePrice.liquidity.toFixed(0)}
                        </span>
                      </div>
                    </>
                  )}
                  {lastPriceUpdate && (
                    <div className="text-[10px] text-zinc-600 text-right">
                      Updated {Math.round((Date.now() - lastPriceUpdate.getTime()) / 1000)}s ago
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Buy Section */}
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Buy Amount (SOL)</label>
            <div className="flex gap-1 mb-2">
              {['0.01', '0.05', '0.1', '0.5'].map((val) => (
                <button
                  key={val}
                  onClick={() => setAmount(val)}
                  className={`flex-1 py-1 rounded text-xs font-medium transition-all ${
                    amount === val
                      ? 'bg-green-500/30 text-green-400 border border-green-500/50'
                      : 'bg-argus-bg text-zinc-400 border border-argus-border hover:border-green-500/30'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 bg-argus-bg border border-argus-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-argus-accent/50"
                step="0.01"
                min="0.001"
              />
              <button
                onClick={() => handleTrade('buy')}
                disabled={isTrading || result.riskScore >= 80}
                className="px-4 py-2 bg-green-500/20 border border-green-500/50 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isTrading ? '...' : 'Buy'}
              </button>
            </div>
          </div>

          {/* Sell Section */}
          {tokenBalance && tokenBalance.balance > 0 && (
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-zinc-500">Sell Amount</label>
                <span className="text-xs text-zinc-400">
                  {sellDisplay} {result.market?.symbol} ({sellPercent}%)
                </span>
              </div>
              <div className="flex gap-2 items-center">
                <div className="flex-1 flex gap-1">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setSellPercent(pct)}
                      className={`flex-1 py-1.5 rounded text-xs font-medium transition-all ${
                        sellPercent === pct
                          ? 'bg-red-500/30 text-red-400 border border-red-500/50'
                          : 'bg-argus-bg text-zinc-400 border border-argus-border hover:border-red-500/30'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => handleTrade('sell')}
                  disabled={isTrading}
                  className="px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isTrading ? '...' : 'Sell'}
                </button>
              </div>
            </div>
          )}

          {/* Slippage */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Slippage:</span>
            <div className="flex gap-1">
              {['0.5', '1', '2', '5'].map((s) => (
                <button
                  key={s}
                  onClick={() => setSlippage(s)}
                  className={`px-2 py-1 rounded transition-all ${
                    slippage === s
                      ? 'bg-argus-accent/20 text-argus-accent border border-argus-accent/50'
                      : 'bg-argus-bg text-zinc-400 border border-argus-border hover:border-argus-accent/30'
                  }`}
                >
                  {s}%
                </button>
              ))}
            </div>
          </div>

          {/* Trade Result */}
          {tradeResult && (
            <div className={`text-xs p-2 rounded-lg ${
              tradeResult.success
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <div className="flex items-center gap-2">
                <i className={`fa-solid ${tradeResult.success ? 'fa-check-circle' : 'fa-times-circle'}`} />
                <span>{tradeResult.message}</span>
              </div>
              {tradeResult.signature && (
                <a
                  href={`https://solscan.io/tx/${tradeResult.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-argus-accent hover:underline"
                >
                  View on Solscan →
                </a>
              )}
            </div>
          )}

          {result.riskScore >= 80 && (
            <p className="text-xs text-red-400">
              <i className="fa-solid fa-triangle-exclamation mr-1" />
              Buying disabled - High risk token
            </p>
          )}

          {tier === 'pro' && (
            <div className={`pt-3 border-t border-argus-border space-y-2 ${argusAiEnabled ? 'bg-argus-accent/5 -mx-4 px-4 -mb-4 pb-4 rounded-b-xl' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded flex items-center justify-center ${argusAiEnabled ? 'bg-gradient-to-br from-argus-accent to-purple-500' : 'bg-argus-border'}`}>
                    <i className={`fa-solid fa-brain text-[10px] ${argusAiEnabled ? 'text-white' : 'text-zinc-500'}`} />
                  </div>
                  <span className={`text-sm font-medium ${argusAiEnabled ? 'text-argus-accent' : 'text-white'}`}>Argus AI</span>
                  {argusAiEnabled && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${aiExecuting ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' : 'bg-argus-accent/20 text-argus-accent'}`}>
                      {aiExecuting ? 'EXECUTING' : 'WATCHING'}
                    </span>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={argusAiEnabled}
                    onChange={(e) => setArgusAiEnabled(e.target.checked)}
                    disabled={!tokenBalance || tokenBalance.balance === 0}
                  />
                  <div className="w-9 h-5 bg-argus-border rounded-full peer peer-checked:bg-argus-accent peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-disabled:opacity-50"></div>
                </label>
              </div>

              {!argusAiEnabled ? (
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  {tokenBalance && tokenBalance.balance > 0
                    ? 'AI-powered auto-trading: auto take-profit, stop-loss, and rug protection.'
                    : 'Buy tokens first to enable AI trading.'}
                </p>
              ) : (
                <>
                  {/* P&L Display */}
                  {pnlPercent !== null && (
                    <div className={`text-center py-2 rounded ${pnlPercent >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                      <div className={`text-lg font-bold ${pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Entry: ${entryPrice?.toFixed(8)}
                        {entrySource === 'purchase' && (
                          <span className="text-green-400 ml-1">(from tx)</span>
                        )}
                        {' → '}Now: ${currentPrice?.toFixed(8)}
                      </div>
                      {entrySol && currentSolValue && (
                        <div className="text-[10px] text-zinc-600 mt-1">
                          SOL: {entrySol.toFixed(4)} → {currentSolValue.toFixed(4)} ({solPnlPercent !== null ? (solPnlPercent >= 0 ? '+' : '') + solPnlPercent.toFixed(1) + '%' : '...'})
                        </div>
                      )}
                    </div>
                  )}

                  {/* Settings */}
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <button
                      onClick={() => setAiSettings(s => ({ ...s, takeProfitPercent: s.takeProfitPercent === 10 ? 25 : s.takeProfitPercent === 25 ? 50 : 10 }))}
                      className="bg-argus-bg rounded p-2 text-center hover:bg-argus-bg/80 transition-colors"
                    >
                      <div className="text-green-400 font-medium">+{aiSettings.takeProfitPercent}%</div>
                      <div className="text-zinc-500">Take Profit</div>
                    </button>
                    <button
                      onClick={() => setAiSettings(s => ({ ...s, stopLossPercent: s.stopLossPercent === 30 ? 50 : s.stopLossPercent === 50 ? 20 : 30 }))}
                      className="bg-argus-bg rounded p-2 text-center hover:bg-argus-bg/80 transition-colors"
                    >
                      <div className="text-red-400 font-medium">-{aiSettings.stopLossPercent}%</div>
                      <div className="text-zinc-500">Stop Loss</div>
                    </button>
                    <button
                      onClick={() => setAiSettings(s => ({ ...s, rugProtection: !s.rugProtection }))}
                      className="bg-argus-bg rounded p-2 text-center hover:bg-argus-bg/80 transition-colors"
                    >
                      <div className={`font-medium ${aiSettings.rugProtection ? 'text-orange-400' : 'text-zinc-600'}`}>
                        {aiSettings.rugProtection ? 'ON' : 'OFF'}
                      </div>
                      <div className="text-zinc-500">Rug Guard</div>
                    </button>
                  </div>

                  {/* AI Activity Log */}
                  {aiLog.length > 0 && (
                    <div className="bg-black/30 rounded p-2 max-h-24 overflow-y-auto">
                      <div className="space-y-1">
                        {aiLog.map((log, i) => (
                          <div key={i} className={`text-[10px] font-mono ${
                            log.type === 'success' ? 'text-green-400' :
                            log.type === 'warning' ? 'text-yellow-400' :
                            log.type === 'error' ? 'text-red-400' :
                            'text-zinc-400'
                          }`}>
                            <span className="text-zinc-600">[{log.time.toLocaleTimeString()}]</span> {log.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center gap-1 text-[10px] text-zinc-600">
                <i className="fa-solid fa-info-circle" />
                <span>0.5% fee per AI-executed trade</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const { connected, publicKey, signTransaction } = useWallet();
  const { tier, scansToday, maxScans, canScan, incrementScan, isLoading: authLoading } = useAuth();

  const [tokenAddress, setTokenAddress] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeViz, setActiveViz] = useState<VisualizationType>('brain');

  // Use backend's sophisticated bundle detection (transaction-based + holder analysis)
  const bundleInfo = result?.bundleInfo || defaultBundleInfo;

  // Shared AI state (lifted from TradePanel for visualization access)
  const [sharedAiState, setSharedAiState] = useState<{
    enabled: boolean;
    entryPrice: number | null;
    currentPrice: number | null;
    pnl: number;
    settings: { takeProfitPercent: number; stopLossPercent: number; rugProtection: boolean };
    log: Array<{ time: Date; message: string; type: 'info' | 'success' | 'warning' | 'error' }>;
  }>({
    enabled: false,
    entryPrice: null,
    currentPrice: null,
    pnl: 0,
    settings: { takeProfitPercent: 10, stopLossPercent: 30, rugProtection: true },
    log: [],
  });

  // Callback for TradePanel to update shared AI state
  const updateAiState = useCallback((state: typeof sharedAiState) => {
    setSharedAiState(state);
  }, []);

  // Render the active AI visualization
  const renderVisualization = () => {
    if (!result) return null;

    const vizProps = {
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      bundleInfo,
      currentPrice: sharedAiState.currentPrice,
      entryPrice: sharedAiState.entryPrice,
      pnl: sharedAiState.pnl,
      aiEnabled: sharedAiState.enabled,
      aiSettings: sharedAiState.settings,
      aiLog: sharedAiState.log,
      tokenSymbol: result.market?.symbol,
      liquidity: result.market?.liquidity,
      volume24h: result.market?.volume24h,
      holders: result.holders?.totalHolders,
    };

    switch (activeViz) {
      case 'brain':
        return <AIBrainDashboard {...vizProps} />;
      case 'chart':
        return (
          <PerformanceChart
            currentPrice={sharedAiState.currentPrice}
            entryPrice={sharedAiState.entryPrice}
            pnl={sharedAiState.pnl}
            takeProfitPercent={sharedAiState.settings.takeProfitPercent}
            stopLossPercent={sharedAiState.settings.stopLossPercent}
            aiEnabled={sharedAiState.enabled}
            aiLog={sharedAiState.log}
            tokenSymbol={result.market?.symbol}
          />
        );
      case 'neural':
        return <NeuralFlow {...vizProps} />;
      case 'matrix':
        return <DecisionMatrix {...vizProps} />;
      default:
        return <AIBrainDashboard {...vizProps} />;
    }
  };

  const handleAnalyze = useCallback(async () => {
    if (!tokenAddress.trim()) return;

    if (!canScan) {
      setError('Daily scan limit reached. Connect wallet & upgrade for unlimited scans.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await analyzeToken(tokenAddress.trim());
      setResult(data);
      incrementScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [tokenAddress, canScan, incrementScan]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAnalyze();
  };

  return (
    <div className="min-h-screen bg-argus-bg">
      {/* Header */}
      <header className="border-b border-argus-border px-6 py-3">
        <div className="max-w-[1800px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-argus-accent/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-argus-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <ellipse cx="12" cy="8" rx="7" ry="4.5" strokeWidth="2.2"/>
                <circle cx="12" cy="8" r="2.5" fill="currentColor"/>
                <ellipse cx="5" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="5" cy="17" r="1.5" fill="currentColor"/>
                <ellipse cx="19" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="19" cy="17" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-white">Argus</h1>
          </div>

          <div className="flex items-center gap-4">
            {tier === 'free' && (
              <div className="text-xs text-zinc-400">
                <span className={scansToday >= 3 ? 'text-red-400' : 'text-argus-accent'}>{scansToday}</span>
                /{maxScans} scans
              </div>
            )}
            {connected && !authLoading && <TierBadge tier={tier} />}
            <WalletMultiButton className="!bg-argus-card !border !border-argus-border !rounded-lg !py-2 !px-4 !text-sm !font-medium hover:!border-argus-accent/50 !transition-colors" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {/* Search Bar */}
        <div className="mb-6">
          <div className="flex gap-3">
            <input
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste token address to analyze..."
              className="flex-1 bg-argus-card border border-argus-border rounded-lg px-4 py-3 text-white placeholder-zinc-500 font-mono text-sm focus:outline-none focus:border-argus-accent/50 transition-colors"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || (!canScan && tier === 'free')}
              className="px-8 py-3 bg-argus-accent text-black font-semibold rounded-lg hover:bg-argus-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Scanning...' : 'Scan'}
            </button>
          </div>
          {error && (
            <div className="mt-3 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="w-20 h-20 border-4 border-argus-border border-t-argus-accent rounded-full animate-spin mb-4" />
            <p className="text-zinc-400 text-lg">Analyzing wallet network...</p>
          </div>
        )}

        {/* Results - Bento Grid Layout */}
        {result && !loading && (
          <div className="grid gap-4" style={{ gridTemplateColumns: '280px 1fr 320px', gridTemplateRows: 'auto 1fr', height: 'calc(100vh - 180px)' }}>

            {/* LEFT COLUMN - AI Analysis */}
            <div className="row-span-2 flex flex-col gap-4">
              {/* Risk Score Card */}
              <div className={`bg-argus-card border rounded-xl p-4 ${
                result.riskScore >= 80 ? 'border-red-500/50' :
                result.riskScore >= 60 ? 'border-orange-500/50' :
                result.riskScore >= 40 ? 'border-yellow-500/50' :
                'border-green-500/50'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      result.riskScore >= 80 ? 'bg-red-500/20' :
                      result.riskScore >= 60 ? 'bg-orange-500/20' :
                      result.riskScore >= 40 ? 'bg-yellow-500/20' :
                      'bg-green-500/20'
                    }`}>
                      <i className={`fa-solid fa-shield-halved ${
                        result.riskScore >= 80 ? 'text-red-400' :
                        result.riskScore >= 60 ? 'text-orange-400' :
                        result.riskScore >= 40 ? 'text-yellow-400' :
                        'text-green-400'
                      }`} />
                    </div>
                    <span className="text-xs text-zinc-400 uppercase tracking-wider">AI Risk Analysis</span>
                  </div>
                  {/* Verification Badge */}
                  {result.verification?.verified ? (
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                      result.verification.source === 'both'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : result.verification.source === 'jupiter'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    }`}>
                      <i className="fa-solid fa-badge-check" />
                      <span>
                        {result.verification.source === 'both' ? 'Verified' :
                         result.verification.source === 'jupiter' ? 'Jupiter' : 'CoinGecko'}
                      </span>
                    </div>
                  ) : result.verification && !result.verification.verified ? (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                      <i className="fa-solid fa-triangle-exclamation" />
                      <span>Unverified</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-4">
                  <div className={`text-4xl font-bold ${
                    result.riskScore >= 80 ? 'text-red-400' :
                    result.riskScore >= 60 ? 'text-orange-400' :
                    result.riskScore >= 40 ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>
                    {result.riskScore}
                  </div>
                  <div>
                    <div className={`text-sm font-semibold ${
                      result.riskScore >= 80 ? 'text-red-400' :
                      result.riskScore >= 60 ? 'text-orange-400' :
                      result.riskScore >= 40 ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {result.riskLevel}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {result.verification?.originalRiskScore
                        ? `Capped from ${result.verification.originalRiskScore}`
                        : `Confidence: ${Math.max(60, 100 - result.riskScore)}%`}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Summary */}
              <div className="bg-argus-card border border-argus-border rounded-xl p-4 flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded bg-argus-accent/20 flex items-center justify-center">
                    <i className="fa-solid fa-brain text-argus-accent text-xs" />
                  </div>
                  <span className="text-xs text-zinc-400 uppercase tracking-wider">AI Summary</span>
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed">{result.summary}</p>

                {/* Key Flags */}
                {result.flags && result.flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length > 0 && (
                  <div className="mt-4 pt-4 border-t border-argus-border space-y-2">
                    {result.flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 3).map((flag, i) => (
                      <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded ${
                        flag.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-300' : 'bg-orange-500/10 text-orange-300'
                      }`}>
                        <i className="fa-solid fa-triangle-exclamation mt-0.5" />
                        <span>{flag.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2">
                {result.holders && (
                  <>
                    <div className="bg-argus-card border border-argus-border rounded-lg p-3">
                      <div className="text-xs text-zinc-500 mb-1">Top Holder</div>
                      <div className={`text-lg font-bold ${(result.holders.topHolder || 0) > 20 ? 'text-red-400' : 'text-white'}`}>
                        {result.holders.topHolder?.toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-argus-card border border-argus-border rounded-lg p-3">
                      <div className="text-xs text-zinc-500 mb-1">Holders</div>
                      <div className="text-lg font-bold text-white">{result.holders.totalHolders}</div>
                    </div>
                  </>
                )}
                {result.creator && (
                  <>
                    <div className="bg-argus-card border border-argus-border rounded-lg p-3">
                      <div className="text-xs text-zinc-500 mb-1">Creator Tokens</div>
                      <div className="text-lg font-bold text-white">{result.creator.tokensCreated}</div>
                    </div>
                    {result.creator.ruggedTokens !== undefined && result.creator.ruggedTokens > 0 && (
                      <div className="bg-argus-card border border-red-500/30 rounded-lg p-3">
                        <div className="text-xs text-zinc-500 mb-1">Previous Rugs</div>
                        <div className="text-lg font-bold text-red-400">{result.creator.ruggedTokens}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* CENTER - Visualization with Tabs */}
            <div className="row-span-2 bg-argus-card border border-argus-border rounded-xl overflow-hidden relative flex flex-col">
              {/* Visualization Tabs */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-argus-border">
                <div className="flex items-center gap-2">
                  {visualizations.map((viz) => (
                    <button
                      key={viz.id}
                      onClick={() => setActiveViz(viz.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeViz === viz.id
                          ? 'bg-argus-accent text-black'
                          : 'text-zinc-400 hover:text-white hover:bg-argus-bg border border-argus-border'
                      }`}
                    >
                      <i className={`fa-solid ${viz.icon}`} />
                      {viz.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  {bundleInfo.detected && (bundleInfo.confidence === 'HIGH' || bundleInfo.confidence === 'MEDIUM') && (
                    <span className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold animate-pulse ${
                      bundleInfo.confidence === 'HIGH'
                        ? 'bg-red-500/20 text-red-400 border-red-500/50'
                        : 'bg-orange-500/20 text-orange-400 border-orange-500/50'
                    }`}>
                      <i className="fa-solid fa-triangle-exclamation" />
                      {bundleInfo.confidence === 'HIGH' ? 'DUMP IMMINENT' : 'BUNDLE DETECTED'}
                    </span>
                  )}
                  <span className="text-zinc-500 text-sm">{result.network?.nodes?.length || 0} wallets connected</span>
                  <button className="px-3 py-1.5 bg-argus-accent text-black rounded-lg text-sm font-semibold hover:bg-argus-accent/90 transition-colors">
                    <i className="fa-solid fa-chart-line mr-1.5" />
                    Analysis
                  </button>
                </div>
              </div>

              {/* Visualization Content */}
              <div className="flex-1 relative">
                {renderVisualization()}
              </div>
            </div>

            {/* RIGHT COLUMN - Trade Panel */}
            <div className="row-span-2 overflow-y-auto">
              <TradePanel
                result={result}
                connected={connected}
                tier={tier}
                publicKey={publicKey}
                signTransaction={signTransaction}
                bundleInfo={bundleInfo}
                onStateChange={updateAiState}
              />
            </div>
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-32 h-32 rounded-full bg-argus-card border border-argus-border flex items-center justify-center mb-6">
              <svg className="w-20 h-20 text-argus-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <ellipse cx="12" cy="8" rx="7" ry="4.5" strokeWidth="2.2"/>
                <circle cx="12" cy="8" r="2.5" fill="currentColor"/>
                <ellipse cx="5" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="5" cy="17" r="1.5" fill="currentColor"/>
                <ellipse cx="19" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="19" cy="17" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-white mb-3">
              Scan Any Solana Token
            </h2>
            <p className="text-zinc-500 max-w-md mb-6">
              Paste a token address to reveal the wallet network, detect coordinated manipulation, and trade with confidence.
            </p>
            <div className="flex items-center gap-6 text-sm text-zinc-400">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-shield-halved text-argus-accent" />
                Risk Scoring
              </div>
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-diagram-project text-argus-accent" />
                Network Analysis
              </div>
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-bolt text-argus-accent" />
                Quick Trade
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
