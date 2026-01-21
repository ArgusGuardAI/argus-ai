import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { analyzeToken } from './lib/api';
import { useAuth } from './contexts/AuthContext';
import { NetworkGraph } from './components/NetworkGraph';
import { TimelineChronicle } from './components/TimelineChronicle';
import { SankeyRiver } from './components/SankeyRiver';
import { TreeBloodline } from './components/TreeBloodline';
import { ConspiracyBoard } from './components/ConspiracyBoard';
import { HeatPattern } from './components/HeatPattern';
import { AnalysisPanel } from './components/AnalysisPanel';
import type { AnalysisResult } from './types';

type VisualizationType = 'network' | 'timeline' | 'sankey' | 'tree' | 'conspiracy' | 'heat';

const visualizations: { id: VisualizationType; name: string; icon: string; description: string }[] = [
  { id: 'network', name: 'Network', icon: 'fa-diagram-project', description: 'Force-directed graph' },
  { id: 'timeline', name: 'Chronicle', icon: 'fa-timeline', description: 'When wallets bought' },
  { id: 'sankey', name: 'River', icon: 'fa-water', description: 'Fund flows' },
  { id: 'tree', name: 'Bloodline', icon: 'fa-sitemap', description: 'Funding hierarchy' },
  { id: 'conspiracy', name: 'Investigation', icon: 'fa-thumbtack', description: 'Detective board' },
  { id: 'heat', name: 'Pattern', icon: 'fa-grip', description: 'Activity heatmap' },
];

// Tier badge component
function TierBadge({ tier }: { tier: 'free' | 'holder' | 'pro' }) {
  const colors = {
    free: 'bg-zinc-700 text-zinc-300',
    holder: 'bg-argus-accent/20 text-argus-accent border border-argus-accent/50',
    pro: 'bg-orange-500/20 text-orange-400 border border-orange-500/50',
  };
  const labels = {
    free: 'Free',
    holder: 'Holder',
    pro: 'Pro',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[tier]}`}>
      {labels[tier]}
    </span>
  );
}

// Upgrade prompt component
function UpgradePrompt({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div className="bg-gradient-to-r from-orange-500/10 to-argus-accent/10 border border-orange-500/30 rounded-xl p-6 text-center">
      <i className="fa-solid fa-crown text-4xl text-orange-400 mb-4" />
      <h3 className="text-xl font-semibold text-white mb-2">Upgrade to Pro</h3>
      <p className="text-zinc-400 mb-4 max-w-md mx-auto">
        Unlimited scans, advanced visualizations, and access to the Sniper Bot.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={onUpgrade}
          className="px-6 py-2 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors"
        >
          Subscribe $19.99/mo
        </button>
        <span className="text-zinc-500 text-sm self-center">or hold 10,000 $ARGUSGUARD</span>
      </div>
    </div>
  );
}

function App() {
  const { connected, publicKey } = useWallet();
  const { tier, scansToday, maxScans, canScan, incrementScan, isLoading: authLoading, tokenBalance } = useAuth();

  const [tokenAddress, setTokenAddress] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeViz, setActiveViz] = useState<VisualizationType>('network');
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const handleAnalyze = useCallback(async () => {
    if (!tokenAddress.trim()) return;

    // Check if user can scan
    if (!canScan) {
      setError('Daily scan limit reached. Upgrade to Pro for unlimited scans.');
      setShowUpgradeModal(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await analyzeToken(tokenAddress.trim());
      setResult(data);
      incrementScan(); // Track scan for free users
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [tokenAddress, canScan, incrementScan]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAnalyze();
    }
  };

  const handleUpgrade = async () => {
    if (!publicKey) {
      setError('Please connect your wallet first to subscribe.');
      return;
    }

    const API_URL = import.meta.env.VITE_API_URL || 'https://api.argusguard.io';
    try {
      const response = await fetch(`${API_URL}/subscribe/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          successUrl: window.location.origin + '?upgraded=true',
          cancelUrl: window.location.origin,
        }),
      });
      const data = await response.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      console.error('Failed to create checkout:', err);
      setError('Failed to start checkout. Please try again.');
    }
  };

  const renderVisualization = () => {
    if (!result) return null;

    switch (activeViz) {
      case 'network':
        return <NetworkGraph data={result.network} />;
      case 'timeline':
        return <TimelineChronicle data={result.network} />;
      case 'sankey':
        return <SankeyRiver data={result.network} />;
      case 'tree':
        return <TreeBloodline data={result.network} />;
      case 'conspiracy':
        return <ConspiracyBoard data={result.network} />;
      case 'heat':
        return <HeatPattern data={result.network} />;
      default:
        return <NetworkGraph data={result.network} />;
    }
  };

  return (
    <div className="min-h-screen bg-argus-bg">
      {/* Header */}
      <header className="border-b border-argus-border px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-argus-accent/20 flex items-center justify-center animate-eye-glow">
              <svg className="w-7 h-7 text-argus-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <ellipse cx="12" cy="8" rx="7" ry="4.5" strokeWidth="2.2"/>
                <circle cx="12" cy="8" r="2.5" fill="currentColor"/>
                <ellipse cx="5" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="5" cy="17" r="1.5" fill="currentColor"/>
                <ellipse cx="19" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="19" cy="17" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-white font-myth">Argus</h1>
            <span className="text-xs text-slate-400 bg-argus-card px-2 py-0.5 rounded border border-argus-border">
              The All-Seeing
            </span>
          </div>

          {/* Right side - User status and wallet */}
          <div className="flex items-center gap-4">
            {/* Scan counter for free users */}
            {tier === 'free' && (
              <div className="text-xs text-zinc-400">
                <span className={scansToday >= 3 ? 'text-red-400' : 'text-argus-accent'}>{scansToday}</span>
                /{maxScans} scans today
              </div>
            )}

            {/* Token balance for holders */}
            {connected && tokenBalance > 0 && (
              <div className="text-xs text-zinc-400">
                {tokenBalance.toLocaleString()} $ARGUS
              </div>
            )}

            {/* Tier badge */}
            {connected && !authLoading && <TierBadge tier={tier} />}

            {/* Wallet connect button */}
            <WalletMultiButton className="!bg-argus-card !border !border-argus-border !rounded-lg !py-2 !px-4 !text-sm !font-medium hover:!border-argus-accent/50 !transition-colors" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        {/* Upgrade Modal */}
        {showUpgradeModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-argus-card border border-argus-border rounded-xl p-6 max-w-md w-full relative">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white"
              >
                <i className="fa-solid fa-times" />
              </button>
              <UpgradePrompt onUpgrade={handleUpgrade} />
            </div>
          </div>
        )}

        {/* Input Section */}
        <div className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste token address..."
              className="flex-1 bg-argus-card border border-argus-border rounded-lg px-4 py-3 text-white placeholder-zinc-500 font-mono text-sm focus:outline-none focus:border-argus-accent/50 transition-colors"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || (!canScan && tier === 'free')}
              className="px-6 py-3 bg-transparent border border-zinc-500 text-zinc-300 font-semibold rounded-lg hover:border-orange-400 hover:text-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>

          {error && (
            <div className="mt-3 px-4 py-2 bg-argus-danger/10 border border-argus-danger/30 rounded-lg text-argus-danger text-sm flex items-center justify-between">
              <span>{error}</span>
              {error.includes('limit') && (
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="text-orange-400 hover:text-orange-300 text-sm font-medium"
                >
                  Upgrade
                </button>
              )}
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 border-4 border-argus-border border-t-argus-accent rounded-full animate-spin mb-4" />
            <p className="text-zinc-400">Argus is watching...</p>
            <p className="text-zinc-500 text-sm mt-1">Analyzing wallet network</p>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="space-y-4">
            {/* Visualization Panel - Full Width */}
            <div className="bg-argus-card border border-argus-border rounded-xl overflow-hidden">
              {/* Visualization Tabs */}
              <div className="px-4 py-2 border-b border-argus-border flex items-center justify-between gap-4">
                <div className="flex items-center gap-1">
                  {visualizations.map((viz) => (
                    <button
                      key={viz.id}
                      onClick={() => setActiveViz(viz.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeViz === viz.id
                          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                          : 'text-zinc-500 hover:text-orange-400 hover:bg-argus-bg'
                      }`}
                      title={viz.description}
                    >
                      <i className={`fa-solid ${viz.icon}`} />
                      {viz.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-zinc-500">
                    {result.network.nodes.length} wallets connected
                  </span>
                  <button
                    onClick={() => setShowAnalysis(!showAnalysis)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      showAnalysis
                        ? 'bg-argus-accent/20 text-argus-accent'
                        : 'text-zinc-500 hover:text-white hover:bg-argus-bg'
                    }`}
                  >
                    <i className="fa-solid fa-chart-pie" />
                    Analysis
                  </button>
                </div>
              </div>
              <div className="h-[600px]">
                {renderVisualization()}
              </div>
            </div>

            {/* Analysis Panel - Collapsible */}
            {showAnalysis && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <AnalysisPanel result={result} />
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-28 h-28 rounded-full bg-argus-card border border-argus-border flex items-center justify-center mb-4">
              <svg className="w-16 h-16 text-argus-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <ellipse cx="12" cy="8" rx="7" ry="4.5" strokeWidth="2.2"/>
                <circle cx="12" cy="8" r="2.5" fill="currentColor"/>
                <ellipse cx="5" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="5" cy="17" r="1.5" fill="currentColor"/>
                <ellipse cx="19" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="19" cy="17" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">
              The All-Seeing Eye
            </h2>
            <p className="text-zinc-500 max-w-md mb-8">
              Paste a token address to reveal the hidden wallet network. AI-powered
              analysis exposes coordinated manipulation and predicts outcomes.
            </p>

            {/* Free tier notice */}
            {!connected && (
              <div className="mb-8 px-4 py-3 bg-argus-card border border-argus-border rounded-lg max-w-md">
                <p className="text-zinc-400 text-sm">
                  <i className="fa-solid fa-info-circle text-argus-accent mr-2" />
                  Connect your wallet for unlimited scans with 1,000+ $ARGUSGUARD tokens
                </p>
              </div>
            )}

            {/* Preview of visualization types */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl">
              {visualizations.map((viz) => (
                <div
                  key={viz.id}
                  className="bg-argus-card border border-argus-border rounded-lg p-4 text-center"
                >
                  <i className={`fa-solid ${viz.icon} text-2xl text-argus-accent mb-2`} />
                  <h3 className="text-sm font-semibold text-white font-myth">{viz.name}</h3>
                  <p className="text-xs text-zinc-500 mt-1">{viz.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
