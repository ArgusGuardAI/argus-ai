import { useState, useCallback } from 'react';
import { analyzeToken } from './lib/api';
import { NetworkGraph } from './components/NetworkGraph';
import { AnalysisPanel } from './components/AnalysisPanel';
import type { AnalysisResult } from './types';

function App() {
  const [tokenAddress, setTokenAddress] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!tokenAddress.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await analyzeToken(tokenAddress.trim());
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAnalyze();
    }
  };

  return (
    <div className="min-h-screen bg-argus-bg">
      {/* Header */}
      <header className="border-b border-argus-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-argus-accent/20 flex items-center justify-center animate-eye-glow">
              {/* Argus - scattered eyes like the mythological giant */}
              <svg className="w-7 h-7 text-argus-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                {/* Main central eye */}
                <ellipse cx="12" cy="8" rx="7" ry="4.5" strokeWidth="2.2"/>
                <circle cx="12" cy="8" r="2.5" fill="currentColor"/>
                {/* Lower left eye */}
                <ellipse cx="5" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="5" cy="17" r="1.5" fill="currentColor"/>
                {/* Lower right eye */}
                <ellipse cx="19" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="19" cy="17" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-white font-myth">Argus</h1>
            <span className="text-xs text-slate-400 bg-argus-card px-2 py-0.5 rounded border border-argus-border">
              The All-Seeing
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
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
              disabled={loading || !tokenAddress.trim()}
              className="px-6 py-3 bg-argus-accent text-black font-semibold rounded-lg hover:bg-argus-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>

          {error && (
            <div className="mt-3 px-4 py-2 bg-argus-danger/10 border border-argus-danger/30 rounded-lg text-argus-danger text-sm">
              {error}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Network Graph */}
            <div className="bg-argus-card border border-argus-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-argus-border">
                <h2 className="font-semibold text-white">Wallet Network</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {result.network.nodes.length} wallets connected
                </p>
              </div>
              <div className="h-[500px]">
                <NetworkGraph data={result.network} />
              </div>
            </div>

            {/* Analysis Panel */}
            <div className="space-y-4">
              <AnalysisPanel result={result} />
            </div>
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-28 h-28 rounded-full bg-argus-card border border-argus-border flex items-center justify-center mb-4">
              {/* Argus - scattered eyes like the mythological giant */}
              <svg className="w-16 h-16 text-argus-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                {/* Main central eye */}
                <ellipse cx="12" cy="8" rx="7" ry="4.5" strokeWidth="2.2"/>
                <circle cx="12" cy="8" r="2.5" fill="currentColor"/>
                {/* Lower left eye */}
                <ellipse cx="5" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="5" cy="17" r="1.5" fill="currentColor"/>
                {/* Lower right eye */}
                <ellipse cx="19" cy="17" rx="4" ry="2.5" strokeWidth="1.8"/>
                <circle cx="19" cy="17" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">
              The All-Seeing Eye
            </h2>
            <p className="text-zinc-500 max-w-md">
              Paste a token address to reveal the hidden wallet network. AI-powered
              analysis exposes coordinated manipulation and predicts outcomes.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
