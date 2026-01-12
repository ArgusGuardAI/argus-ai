import { useEffect, useState } from 'react';
import type { HoneypotResult, GraffitiNote as GraffitiNoteType } from '@whaleshield/shared';
import { WHALESHIELD_TOKEN } from '@whaleshield/shared';
import { RiskBadge } from './RiskBadge';
import { GraffitiNote } from './GraffitiNote';
import { CreateNoteForm } from './CreateNoteForm';
import { analyzeToken, getGraffitiNotes, voteOnNote, getAuthMessage } from '~/lib/api';
import { useWhaleshieldWallet } from '~/hooks/useWhaleshieldWallet';

interface PaintProps {
  tokenAddress: string;
}

type LoadingState = 'loading' | 'ready' | 'error' | 'locked';

const riskConfig = {
  SAFE: {
    borderClass: 'cyber-border-safe',
    statusText: 'LOW RISK DETECTED',
    statusIcon: '///',
  },
  SUSPICIOUS: {
    borderClass: 'cyber-border-warning',
    statusText: 'SUSPICIOUS ACTIVITY',
    statusIcon: '//!',
  },
  DANGEROUS: {
    borderClass: 'cyber-border-danger',
    statusText: 'HIGH RISK ALERT',
    statusIcon: '!!!',
  },
  SCAM: {
    borderClass: 'cyber-border-danger',
    statusText: 'SCAM DETECTED',
    statusIcon: 'XXX',
  },
};

function getCacheAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function Paint({ tokenAddress }: PaintProps) {
  const wallet = useWhaleshieldWallet();
  const [state, setState] = useState<LoadingState>('loading');
  const [result, setResult] = useState<HoneypotResult | null>(null);
  const [notes, setNotes] = useState<GraffitiNoteType[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [isCached, setIsCached] = useState(false);

  const fetchData = async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRescanning(true);
    } else {
      setState('loading');
    }

    const isTestMode = WHALESHIELD_TOKEN.mint === 'TBD_AFTER_LAUNCH';
    const isPremium = isTestMode || wallet.isPremium;

    if (!isPremium && wallet.connected) {
      setState('locked');
      setIsRescanning(false);
      return;
    }

    try {
      const [analysisResult, graffitiNotes] = await Promise.all([
        analyzeToken(tokenAddress, { forceRefresh }),
        getGraffitiNotes(tokenAddress),
      ]);

      setResult(analysisResult);
      setNotes(graffitiNotes);
      setIsCached((analysisResult as any)?.cached || false);
      setState('ready');
    } catch (error) {
      console.error('Paint fetch error:', error);
      setState('error');
    } finally {
      setIsRescanning(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tokenAddress, wallet.isPremium, wallet.connected]);

  const handleRescan = () => {
    if (!isRescanning) {
      fetchData(true);
    }
  };

  const handleVote = async (noteId: string, vote: 'up' | 'down') => {
    if (!wallet.address) {
      await wallet.connect();
      return;
    }

    try {
      const authMsg = await getAuthMessage('vote', noteId);
      if (!authMsg) return;

      const signature = await wallet.signMessage(authMsg.message);
      if (!signature) return;

      const success = await voteOnNote({
        noteId,
        vote,
        walletAddress: wallet.address,
        message: authMsg.message,
        signature,
      });

      if (success) {
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId
              ? { ...n, [vote === 'up' ? 'upvotes' : 'downvotes']: n[vote === 'up' ? 'upvotes' : 'downvotes'] + 1 }
              : n
          )
        );
      }
    } catch (error) {
      console.error('Vote error:', error);
    }
  };

  const handleNoteCreated = (note: GraffitiNoteType) => {
    setNotes((prev) => [note, ...prev]);
    setShowNotes(true);
  };

  // Loading state
  if (state === 'loading') {
    return (
      <div className="whaleshield-paint glass-card corner-deco rounded-xl p-4 scan-line">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center pulse-glow">
            <span className="text-2xl">🐋</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-cyber text-cyan-400 text-xs tracking-widest">WHALESHIELD</span>
              <span className="text-cyan-500/50 text-[10px] font-mono">v1.0</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full w-1/2 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full animate-pulse" />
            </div>
            <span className="text-[10px] text-gray-500 font-mono mt-1 block">SCANNING CONTRACT...</span>
          </div>
        </div>
      </div>
    );
  }

  // Locked state
  if (state === 'locked') {
    return (
      <div className="whaleshield-paint glass-card corner-deco rounded-xl p-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-600/20 flex items-center justify-center">
            <span className="text-3xl">🔒</span>
          </div>
          <div>
            <p className="font-cyber text-purple-400 text-sm tracking-wider">SHIELD LOCKED</p>
            <p className="text-gray-500 text-xs mt-1">
              Hold <span className="text-cyan-400 font-bold">1,000 $WHALESHIELD</span> to unlock
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error' || !result) {
    return (
      <div className="whaleshield-paint glass-card cyber-border-danger corner-deco rounded-xl p-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-red-500/20 to-pink-600/20 flex items-center justify-center">
            <span className="text-3xl">⚠</span>
          </div>
          <div>
            <p className="font-cyber text-red-400 text-sm tracking-wider">SCAN FAILED</p>
            <p className="text-gray-500 text-xs mt-1">Unable to analyze this contract</p>
          </div>
        </div>
      </div>
    );
  }

  const config = riskConfig[result.riskLevel];
  const isTestMode = WHALESHIELD_TOKEN.mint === 'TBD_AFTER_LAUNCH';
  const isPremium = isTestMode || wallet.isPremium;

  return (
    <div className={`whaleshield-paint glass-card ${config.borderClass} corner-deco rounded-xl overflow-hidden`}>
      {/* Header */}
      <div className="p-4 tech-grid-dense">
        <div className="flex items-start gap-4">
          {/* Risk Badge */}
          <RiskBadge riskLevel={result.riskLevel} riskScore={result.riskScore} size="md" />

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Top bar */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🐋</span>
              <span className="font-cyber gradient-text text-sm tracking-widest font-bold">WHALESHIELD</span>
              <span className="text-[9px] text-gray-600 font-mono ml-auto">{config.statusIcon}</span>
            </div>

            {/* Status */}
            <div
              className="text-[10px] font-cyber tracking-wider mb-2 px-2 py-1 rounded inline-block"
              style={{
                background: result.riskLevel === 'SAFE' ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 51, 102, 0.1)',
                color: result.riskLevel === 'SAFE' ? '#00ff88' : '#ff3366',
                border: `1px solid ${result.riskLevel === 'SAFE' ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 51, 102, 0.3)'}`,
              }}
            >
              {config.statusText}
            </div>

            {/* Summary */}
            <p className="text-gray-300 text-xs leading-relaxed line-clamp-2">{result.summary}</p>

            {/* Notes badge */}
            {notes.length > 0 && (
              <button
                onClick={() => {
                  setExpanded(true);
                  setShowNotes(true);
                }}
                className="mt-2 flex items-center gap-1.5 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors font-cyber"
              >
                <span className="font-graffiti">🎨</span>
                <span>{notes.length} COMMUNITY NOTE{notes.length !== 1 ? 'S' : ''}</span>
              </button>
            )}
          </div>

          {/* Expand button */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-500/30 text-gray-400 hover:text-cyan-400 transition-all flex items-center justify-center text-lg"
          >
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-white/5">
          {/* Risk Flags */}
          {result.flags.length > 0 && (
            <div className="p-5 border-b border-white/5">
              <h4 className="text-[10px] font-cyber text-gray-500 mb-4 flex items-center gap-2">
                <span className="text-red-400">⚡</span>
                THREAT ANALYSIS
              </h4>
              <div className="space-y-3">
                {result.flags.map((flag, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg text-xs ${
                      flag.severity === 'CRITICAL'
                        ? 'flag-critical'
                        : flag.severity === 'HIGH'
                        ? 'flag-high'
                        : flag.severity === 'MEDIUM'
                        ? 'flag-medium'
                        : 'flag-low'
                    }`}
                  >
                    <span className="font-cyber text-[9px] opacity-70 mr-2">[{flag.type}]</span>
                    <span className="text-gray-300">{flag.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Community Intel */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-[10px] font-cyber text-gray-500 flex items-center gap-2">
                <span className="font-graffiti text-cyan-400">🎨</span>
                COMMUNITY GRAFFITI
                {notes.length > 0 && (
                  <span className="text-cyan-400">({notes.length})</span>
                )}
              </h4>
              {notes.length > 0 && (
                <button
                  onClick={() => setShowNotes(!showNotes)}
                  className="text-[10px] text-cyan-400 hover:text-white transition-colors font-cyber"
                >
                  {showNotes ? 'HIDE' : 'SHOW'}
                </button>
              )}
            </div>

            {/* Notes list */}
            {showNotes && notes.length > 0 && (
              <div className="max-h-48 overflow-y-auto mb-5 space-y-3 pr-1">
                {notes.slice(0, 10).map((note) => (
                  <GraffitiNote key={note.id} note={note} onVote={handleVote} />
                ))}
              </div>
            )}

            {/* Create Note Form */}
            <CreateNoteForm
              tokenAddress={tokenAddress}
              walletAddress={wallet.address}
              connected={wallet.connected}
              isPremium={isPremium}
              onConnect={wallet.connect}
              signMessage={wallet.signMessage}
              onNoteCreated={handleNoteCreated}
            />
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-white/5 bg-black/20 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[9px] text-gray-600">
              <span className="font-cyber">TOGETHER AI</span>
              <span>•</span>
              <span>{result.confidence}% CONF</span>
              <span>•</span>
              <span className={isCached ? 'text-amber-500' : 'text-green-500'}>
                {isCached ? `cached ${getCacheAge(result.checkedAt)}` : 'fresh scan'}
              </span>
            </div>
            <button
              onClick={handleRescan}
              disabled={isRescanning}
              className="flex items-center gap-1.5 text-[9px] font-cyber px-2 py-1 rounded transition-all"
              style={{
                background: isRescanning ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 212, 255, 0.1)',
                border: '1px solid rgba(0, 212, 255, 0.3)',
                color: isRescanning ? '#6b7280' : '#00d4ff',
                cursor: isRescanning ? 'not-allowed' : 'pointer',
              }}
            >
              <span className={isRescanning ? 'animate-spin' : ''}>↻</span>
              {isRescanning ? 'SCANNING...' : 'RE-SCAN'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
