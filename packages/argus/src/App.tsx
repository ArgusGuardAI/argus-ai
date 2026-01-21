import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { analyzeToken } from './lib/api';
import { buyToken, sellToken, getTokenBalance, formatTokenAmount, getTokenPrice, PriceWebSocket, getUserPurchasePrice } from './lib/jupiter';
import { useAuth } from './contexts/AuthContext';
import { NetworkGraph } from './components/NetworkGraph';
import type { AnalysisResult } from './types';

// Risk level colors
const riskColors = {
  SAFE: { bg: 'bg-green-500', text: 'text-green-400', border: 'border-green-500' },
  SUSPICIOUS: { bg: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500' },
  DANGEROUS: { bg: 'bg-orange-500', text: 'text-orange-400', border: 'border-orange-500' },
  SCAM: { bg: 'bg-red-500', text: 'text-red-400', border: 'border-red-500' },
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
  signTransaction
}: {
  result: AnalysisResult;
  connected: boolean;
  tier: 'free' | 'holder' | 'pro';
  publicKey: ReturnType<typeof useWallet>['publicKey'];
  signTransaction: ReturnType<typeof useWallet>['signTransaction'];
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
    takeProfitMultiplier: 2, // 2x = 100% profit
    stopLossPercent: 30, // -30%
    rugProtection: true,
  });
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
  const pnlPercent = entryPrice && currentPrice ? ((currentPrice - entryPrice) / entryPrice) * 100 : null;

  // Add to AI log
  const addAiLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setAiLog(prev => [...prev.slice(-9), { time: new Date(), message, type }]);
  };

  // Fetch token balance when connected
  useEffect(() => {
    if (connected && publicKey && result.tokenAddress) {
      getTokenBalance(result.tokenAddress, publicKey.toString()).then(setTokenBalance);
    }
  }, [connected, publicKey, result.tokenAddress]);

  // Set entry price when AI is enabled - try to fetch actual purchase price
  useEffect(() => {
    if (argusAiEnabled && currentPrice && !entryPrice && publicKey) {
      // Try to get actual purchase price from transaction history
      addAiLog(`Fetching your purchase price...`, 'info');

      getUserPurchasePrice(result.tokenAddress, publicKey.toString()).then(purchaseData => {
        if (purchaseData && purchaseData.avgPrice > 0) {
          // Use actual purchase price
          setEntryPrice(purchaseData.avgPrice);
          setEntrySource('purchase');
          addAiLog(`Found entry: $${purchaseData.avgPrice.toFixed(8)} (from tx history)`, 'success');
          addAiLog(`Take profit: ${aiSettings.takeProfitMultiplier}x ($${(purchaseData.avgPrice * aiSettings.takeProfitMultiplier).toFixed(8)})`, 'info');
          addAiLog(`Stop loss: -${aiSettings.stopLossPercent}% ($${(purchaseData.avgPrice * (1 - aiSettings.stopLossPercent / 100)).toFixed(8)})`, 'info');
        } else {
          // Fallback to current price
          setEntryPrice(currentPrice);
          setEntrySource('current');
          addAiLog(`Entry: $${currentPrice.toFixed(8)} (current price)`, 'info');
          addAiLog(`Take profit: ${aiSettings.takeProfitMultiplier}x ($${(currentPrice * aiSettings.takeProfitMultiplier).toFixed(8)})`, 'info');
          addAiLog(`Stop loss: -${aiSettings.stopLossPercent}% ($${(currentPrice * (1 - aiSettings.stopLossPercent / 100)).toFixed(8)})`, 'info');
        }
      });
    }
    if (!argusAiEnabled) {
      setEntryPrice(null);
      setEntrySource('current');
      setAiLog([]);
    }
  }, [argusAiEnabled, currentPrice, publicKey, result.tokenAddress]);

  // Argus AI automation - monitor and execute
  useEffect(() => {
    if (!argusAiEnabled || !entryPrice || !currentPrice || !tokenBalance || tokenBalance.balance === 0) {
      return;
    }
    if (!connected || !publicKey || !signTransaction || aiExecuting) {
      return;
    }

    const checkAndExecute = async () => {
      const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
      const takeProfitTarget = (aiSettings.takeProfitMultiplier - 1) * 100; // e.g., 2x = 100%

      // Check Take Profit
      if (pnl >= takeProfitTarget) {
        addAiLog(`TAKE PROFIT triggered! +${pnl.toFixed(1)}% gain`, 'success');
        setAiExecuting(true);

        try {
          const sellAmt = tokenBalance.balance; // Sell 100%
          const slippageBps = 200; // 2% slippage for auto-trades

          addAiLog(`Selling 100% of position...`, 'info');
          const swapResult = await sellToken(
            result.tokenAddress,
            sellAmt,
            publicKey,
            signTransaction,
            slippageBps,
            true // withAiFee
          );

          if (swapResult.success) {
            addAiLog(`SOLD! TX: ${swapResult.signature?.slice(0, 8)}...`, 'success');
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
          const slippageBps = 300; // 3% slippage for emergency sells

          addAiLog(`Emergency selling 100%...`, 'warning');
          const swapResult = await sellToken(
            result.tokenAddress,
            sellAmt,
            publicKey,
            signTransaction,
            slippageBps,
            true // withAiFee
          );

          if (swapResult.success) {
            addAiLog(`SOLD! TX: ${swapResult.signature?.slice(0, 8)}...`, 'success');
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
              const slippageBps = 500; // 5% slippage for emergency rug escape

              addAiLog(`EMERGENCY SELL - Potential rug detected!`, 'error');
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
    };

    // Check conditions on every price update
    checkAndExecute();
  }, [argusAiEnabled, currentPrice, entryPrice, tokenBalance, aiSettings, connected, publicKey, signTransaction, aiExecuting, lastRiskCheck, result.tokenAddress, result.riskScore]);

  // WebSocket + polling for real-time price
  useEffect(() => {
    let priceWs: PriceWebSocket | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let wsConnected = false;

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

      wsConnected = await priceWs.connect();
      setWsConnected(wsConnected);

      if (wsConnected) {
        console.log('[Price] Using WebSocket for real-time updates');
        // Still poll every 5s for volume/liquidity updates
        pollInterval = setInterval(fetchPrice, 5000);
      } else {
        console.log('[Price] WebSocket failed, using 1s polling');
        // Fallback to fast polling
        pollInterval = setInterval(fetchPrice, 1000);
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
                    </div>
                  )}

                  {/* Settings */}
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <button
                      onClick={() => setAiSettings(s => ({ ...s, takeProfitMultiplier: s.takeProfitMultiplier === 2 ? 3 : s.takeProfitMultiplier === 3 ? 5 : 2 }))}
                      className="bg-argus-bg rounded p-2 text-center hover:bg-argus-bg/80 transition-colors"
                    >
                      <div className="text-green-400 font-medium">{aiSettings.takeProfitMultiplier}x</div>
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

// Risk Score Display
function RiskScoreOverlay({ result }: { result: AnalysisResult }) {
  const colors = riskColors[result.riskLevel] || riskColors.SUSPICIOUS;

  return (
    <div className="absolute top-4 left-4 z-10">
      <div className={`${colors.bg}/20 border ${colors.border}/50 rounded-xl p-4 backdrop-blur-sm`}>
        <div className="flex items-center gap-3">
          <div className={`text-4xl font-bold ${colors.text}`}>
            {result.riskScore}
          </div>
          <div>
            <div className={`text-sm font-semibold ${colors.text}`}>
              {result.riskLevel}
            </div>
            <div className="text-xs text-zinc-400">Risk Score</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Key Flags Display
function KeyFlags({ result }: { result: AnalysisResult }) {
  const criticalFlags = result.flags?.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH') || [];

  if (criticalFlags.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-10 max-w-xs">
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 backdrop-blur-sm space-y-2">
        {criticalFlags.slice(0, 3).map((flag, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <i className="fa-solid fa-triangle-exclamation text-red-400 mt-0.5" />
            <span className="text-red-300">{flag.message}</span>
          </div>
        ))}
        {criticalFlags.length > 3 && (
          <div className="text-xs text-red-400">+{criticalFlags.length - 3} more warnings</div>
        )}
      </div>
    </div>
  );
}

// Token Info Bar
function TokenInfoBar({ result }: { result: AnalysisResult }) {
  const market = result.market;

  const formatNumber = (n: number) => {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  return (
    <div className="absolute bottom-4 left-4 right-4 z-10">
      <div className="bg-argus-card/90 border border-argus-border rounded-xl px-4 py-3 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-white font-semibold">{market?.name || 'Unknown'}</span>
            <span className="text-zinc-500 ml-2">${market?.symbol || '???'}</span>
          </div>
          {market?.marketCap && (
            <div className="text-sm">
              <span className="text-zinc-500">MC:</span>
              <span className="text-white ml-1">{formatNumber(market.marketCap)}</span>
            </div>
          )}
          {market?.liquidity && (
            <div className="text-sm">
              <span className="text-zinc-500">Liq:</span>
              <span className="text-white ml-1">{formatNumber(market.liquidity)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {market?.priceChange24h !== undefined && (
            <span className={market.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}>
              {market.priceChange24h >= 0 ? '+' : ''}{market.priceChange24h.toFixed(1)}%
            </span>
          )}
          <span className="text-xs text-zinc-500">
            {result.network?.nodes?.length || 0} wallets
          </span>
        </div>
      </div>
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

        {/* Results */}
        {result && !loading && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Main Visualization - 3 columns */}
            <div className="lg:col-span-3 bg-argus-card border border-argus-border rounded-xl overflow-hidden relative" style={{ height: '700px' }}>
              {result.network ? (
                <>
                  <RiskScoreOverlay result={result} />
                  <KeyFlags result={result} />
                  <TokenInfoBar result={result} />
                  <NetworkGraph data={result.network} />
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-zinc-500">
                  <p>No network data available</p>
                </div>
              )}
            </div>

            {/* Side Panel - 1 column */}
            <div className="space-y-4">
              {/* Trade Panel */}
              <TradePanel
                result={result}
                connected={connected}
                tier={tier}
                publicKey={publicKey}
                signTransaction={signTransaction}
              />

              {/* Summary */}
              <div className="bg-argus-card border border-argus-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-2">AI Summary</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{result.summary}</p>
              </div>

              {/* Holder Stats */}
              {result.holders && (
                <div className="bg-argus-card border border-argus-border rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">Holder Distribution</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Top Holder</span>
                      <span className={`font-medium ${(result.holders.topHolder || 0) > 20 ? 'text-red-400' : 'text-white'}`}>
                        {result.holders.topHolder?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Top 10 Combined</span>
                      <span className={`font-medium ${(result.holders.top10Holders || 0) > 50 ? 'text-red-400' : 'text-white'}`}>
                        {result.holders.top10Holders?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Total Holders</span>
                      <span className="text-white font-medium">{result.holders.totalHolders}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Creator Info */}
              {result.creator && (
                <div className="bg-argus-card border border-argus-border rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">Creator</h3>
                  <div className="space-y-2 text-sm">
                    {result.creator.ruggedTokens !== undefined && result.creator.ruggedTokens > 0 && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Previous Rugs</span>
                        <span className="text-red-400 font-medium">{result.creator.ruggedTokens}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Tokens Created</span>
                      <span className="text-white">{result.creator.tokensCreated}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Current Holdings</span>
                      <span className="text-white">{result.creator.currentHoldings?.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              )}
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
