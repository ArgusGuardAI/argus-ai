/**
 * CouncilDecisionCard - Prominent display for AGI council votes
 *
 * Shows the 4-agent voting council with individual votes, reasons,
 * and final verdict (BUY/SKIP/DANGEROUS).
 */

import React from 'react';

// Agent colors
const AGENT_COLORS: Record<string, { main: string; glow: string }> = {
  scout:   { main: '#8B5CF6', glow: 'rgba(139, 92, 246, 0.3)' },
  analyst: { main: '#DC2626', glow: 'rgba(220, 38, 38, 0.3)' },
  hunter:  { main: '#F59E0B', glow: 'rgba(245, 158, 11, 0.3)' },
  trader:  { main: '#10B981', glow: 'rgba(16, 185, 129, 0.3)' },
};

const VERDICT_COLORS = {
  BUY: '#10B981',
  SKIP: '#6B7280',
  DANGEROUS: '#EF4444',
};

export interface AgentVote {
  agent: string;
  vote: 'yes' | 'no' | 'abstain';
  reason: string;
  confidence?: number;
}

export interface CouncilDecision {
  id: string;
  timestamp: number;
  tokenAddress: string;
  tokenSymbol?: string;
  votes: AgentVote[];
  verdict: 'BUY' | 'SKIP' | 'DANGEROUS';
  unanimousYes?: boolean;
  score?: number;
}

interface CouncilDecisionCardProps {
  decision: CouncilDecision;
  onAnalyze?: (address: string) => void;
}

export const CouncilDecisionCard: React.FC<CouncilDecisionCardProps> = ({
  decision,
  onAnalyze,
}) => {
  const tCA = (ca: string): string => ca.slice(0, 4) + '...' + ca.slice(-4);

  const tAgo = (ts: number): string => {
    const s = Math.floor((Date.now() - ts) / 1000);
    return s < 3 ? 'now' : s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h';
  };

  const yesCount = decision.votes.filter(v => v.vote === 'yes').length;
  const verdictColor = VERDICT_COLORS[decision.verdict];

  return (
    <div
      className="rounded-xl p-4 mb-3 animate-fade-in"
      style={{
        background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.08) 0%, rgba(20, 20, 20, 0.95) 100%)',
        border: '2px solid rgba(212, 175, 55, 0.3)',
        boxShadow: '0 0 20px rgba(212, 175, 55, 0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#D4AF37] tracking-wider">COUNCIL DECISION</span>
          {decision.unanimousYes && (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-[#10B981]/20 text-[#10B981] rounded border border-[#10B981]/30">
              UNANIMOUS
            </span>
          )}
        </div>
        <span className="text-[10px] text-[#666] font-mono">{tAgo(decision.timestamp)}</span>
      </div>

      {/* Token Info */}
      <div className="flex items-center gap-3 mb-4">
        {decision.tokenSymbol ? (
          <span className="text-lg font-bold text-white">${decision.tokenSymbol}</span>
        ) : null}
        <button
          onClick={() => onAnalyze?.(decision.tokenAddress)}
          className="text-xs font-mono text-[#888] hover:text-white transition-colors px-2 py-1 rounded bg-[#1a1a1a] hover:bg-[#222]"
        >
          {tCA(decision.tokenAddress)}
        </button>
        {decision.score !== undefined && (
          <span
            className="text-xs font-mono font-bold px-2 py-0.5 rounded"
            style={{
              background: decision.score < 40 ? 'rgba(16, 185, 129, 0.2)' : decision.score < 60 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: decision.score < 40 ? '#10B981' : decision.score < 60 ? '#F59E0B' : '#EF4444',
            }}
          >
            Score: {decision.score}
          </span>
        )}
      </div>

      {/* Votes Grid */}
      <div className="bg-black/30 rounded-lg p-3 mb-4">
        {decision.votes.map(vote => {
          const color = AGENT_COLORS[vote.agent.toLowerCase()] || AGENT_COLORS.scout;
          const voteColor = vote.vote === 'yes' ? '#10B981' : vote.vote === 'no' ? '#EF4444' : '#6B7280';
          const voteIcon = vote.vote === 'yes' ? '✓' : vote.vote === 'no' ? '✗' : '○';

          return (
            <div
              key={vote.agent}
              className="flex items-center gap-3 py-2 border-b border-[#222] last:border-0"
            >
              <span className="w-16 text-xs font-bold font-mono" style={{ color: color.main }}>
                {vote.agent.toUpperCase()}:
              </span>
              <span className="text-base font-bold w-6" style={{ color: voteColor }}>
                {voteIcon}
              </span>
              <span className="text-xs font-bold" style={{ color: voteColor }}>
                {vote.vote.toUpperCase()}
              </span>
              <span className="flex-1 text-xs text-[#888] italic truncate">
                "{vote.reason}"
              </span>
              {vote.confidence !== undefined && (
                <span className="text-[10px] text-[#555] font-mono">
                  {vote.confidence}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Verdict Bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-[#666] font-mono">VERDICT:</span>
        <div className="flex-1 h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${(yesCount / 4) * 100}%`,
              background: verdictColor,
            }}
          />
        </div>
        <span
          className="px-3 py-1 text-xs font-bold rounded"
          style={{
            background: `${verdictColor}20`,
            color: verdictColor,
            border: `1px solid ${verdictColor}40`,
          }}
        >
          {decision.verdict} ({yesCount}/4)
        </span>
      </div>
    </div>
  );
};

export default CouncilDecisionCard;
