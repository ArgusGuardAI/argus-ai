import { useState, useCallback } from 'react';
import { analyzeToken } from './lib/api';
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

function App() {
  const [tokenAddress, setTokenAddress] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeViz, setActiveViz] = useState<VisualizationType>('network');
  const [showAnalysis, setShowAnalysis] = useState(true);

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
      <main className="max-w-[1600px] mx-auto px-6 py-6">
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
              disabled={loading}
              className="px-6 py-3 bg-transparent border border-zinc-500 text-zinc-300 font-semibold rounded-lg hover:border-orange-400 hover:text-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
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
            <p className="text-zinc-500 max-w-md mb-8">
              Paste a token address to reveal the hidden wallet network. AI-powered
              analysis exposes coordinated manipulation and predicts outcomes.
            </p>

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
