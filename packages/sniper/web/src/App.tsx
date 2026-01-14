import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { TokenFeed } from './components/TokenFeed';
import { Positions } from './components/Positions';
import { Controls } from './components/Controls';
import { Stats } from './components/Stats';
import { Settings } from './components/Settings';
import { useWebSocket } from './hooks/useWebSocket';
import type { SniperState, TokenEvent, Position, SniperConfig } from './types';

const DEFAULT_CONFIG: SniperConfig = {
  buyAmountSol: 0.1,
  maxSlippageBps: 1500,
  priorityFeeLamports: 100000,
  useJito: false,
  maxRiskScore: 40,
  minLiquidityUsd: 1000,
  allowPumpFun: true,
  allowRaydium: false,
  takeProfitPercent: 100,
  stopLossPercent: 30,
  maxHoldTimeMinutes: 60,
};

export default function App() {
  const [status, setStatus] = useState<'stopped' | 'running' | 'paused'>('stopped');
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [stats, setStats] = useState({
    tokensScanned: 0,
    tokensSniped: 0,
    tokensSkipped: 0,
    totalPnlSol: 0,
  });
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);

  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'NEW_TOKEN':
        setTokens((prev) => [{ ...msg.data, status: 'analyzing' }, ...prev].slice(0, 50));
        break;

      case 'ANALYSIS_RESULT':
        setTokens((prev) =>
          prev.map((t) =>
            t.address === msg.data.token.address
              ? {
                  ...t,
                  status: msg.data.shouldBuy ? 'sniping' : 'skipped',
                  riskScore: msg.data.riskScore,
                  reason: msg.data.reason,
                }
              : t
          )
        );
        break;

      case 'SNIPE_ATTEMPT':
        setTokens((prev) =>
          prev.map((t) =>
            t.address === msg.data.token
              ? { ...t, status: msg.data.status === 'success' ? 'sniped' : 'failed' }
              : t
          )
        );
        break;

      case 'POSITION_UPDATE':
        setPositions((prev) =>
          prev.map((p) => (p.tokenAddress === msg.data.tokenAddress ? msg.data : p))
        );
        break;

      case 'TRADE_EXECUTED':
        if (msg.data.type === 'BUY' && msg.data.success) {
          // Position will be added via STATUS_UPDATE
        }
        break;

      case 'STATUS_UPDATE':
        setStatus(msg.data.status);
        setPositions(msg.data.positions || []);
        setStats({
          tokensScanned: msg.data.tokensScanned,
          tokensSniped: msg.data.tokensSniped,
          tokensSkipped: msg.data.tokensSkipped,
          totalPnlSol: msg.data.totalPnlSol,
        });
        break;
    }
  }, []);

  const { sendMessage } = useWebSocket({
    url: 'ws://localhost:8787/ws',
    onMessage: handleMessage,
    onConnect: () => setConnected(true),
    onDisconnect: () => setConnected(false),
  });

  const handleStart = () => {
    sendMessage({ type: 'START', config });
  };

  const handleStop = () => {
    sendMessage({ type: 'STOP' });
  };

  const handleSell = (tokenAddress: string) => {
    sendMessage({ type: 'SELL', tokenAddress });
  };

  const handleConfigUpdate = (newConfig: Partial<SniperConfig>) => {
    const updated = { ...config, ...newConfig };
    setConfig(updated);
    sendMessage({ type: 'UPDATE_CONFIG', config: updated });
  };

  return (
    <div className="min-h-screen bg-dark-950 tech-grid">
      <Header connected={connected} />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Top row: Controls + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2">
            <Controls
              status={status}
              onStart={handleStart}
              onStop={handleStop}
              onSettings={() => setShowSettings(true)}
              config={config}
            />
          </div>
          <Stats stats={stats} />
        </div>

        {/* Main content: Token Feed + Positions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TokenFeed tokens={tokens} />
          <Positions positions={positions} onSell={handleSell} />
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <Settings
          config={config}
          onUpdate={handleConfigUpdate}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
