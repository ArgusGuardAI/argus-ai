/**
 * AGI Council - Real-Time Deliberation Chamber
 *
 * Displays ACTUAL LLM dialogue from paper-trade-agi.ts
 * NO HARDCODED CONVERSATIONS - everything comes from real AI votes
 */

import { useState, useEffect, useRef } from 'react';
import { useAgentStatus } from '../../hooks/useAgentStatus';

const AGENTS = {
  scout: {
    id: 'scout', name: 'SCOUT', color: '#00d4ff',
    glow: '#00d4ff40', dim: '#00d4ff15',
  },
  analyst: {
    id: 'analyst', name: 'ANALYST', color: '#f0a820',
    glow: '#f0a82040', dim: '#f0a82015',
  },
  hunter: {
    id: 'hunter', name: 'HUNTER', color: '#ff2840',
    glow: '#ff284040', dim: '#ff284015',
  },
  trader: {
    id: 'trader', name: 'TRADER', color: '#00e040',
    glow: '#00e04040', dim: '#00e04015',
  },
};

type AgentKey = keyof typeof AGENTS;

interface CouncilMessage {
  id: string;
  agent: typeof AGENTS[AgentKey];
  text: string;
  vote?: 'YES' | 'NO' | 'ABSTAIN';
  timestamp: number;
}

interface CouncilSession {
  id: string;
  token: string;
  symbol: string;
  messages: CouncilMessage[];
  verdict?: 'BUY' | 'SKIP' | 'DANGEROUS';
  yesVotes: number;
  completed: boolean;
  timestamp: number;
}

function AgentBubble({ agent, text, vote, isNew, showAvatar }: {
  agent: typeof AGENTS[AgentKey];
  text: string;
  vote?: string;
  isNew: boolean;
  showAvatar: boolean;
}) {
  return (
    <div className={`flex gap-2 px-4 ${isNew ? 'animate-fade-in' : ''}`}
      style={{ marginTop: showAvatar ? 10 : 1 }}>
      {/* Avatar */}
      <div className="w-7 flex-shrink-0 flex justify-center">
        {showAvatar && (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold"
            style={{
              background: agent.dim,
              border: `1.5px solid ${agent.color}40`,
              boxShadow: `0 0 8px ${agent.glow}`,
              color: agent.color,
            }}
          >
            {agent.name.slice(0, 2)}
          </div>
        )}
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0">
        {showAvatar && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-semibold tracking-wider" style={{ color: agent.color }}>
              {agent.name}
            </span>
            {vote && (
              <span
                className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: vote === 'YES' ? '#00e04020' : vote === 'NO' ? '#ff284020' : '#ffffff10',
                  color: vote === 'YES' ? '#00e040' : vote === 'NO' ? '#ff2840' : '#666',
                }}
              >
                {vote}
              </span>
            )}
          </div>
        )}
        <div className="text-[11px] leading-relaxed text-[#8a8e9a] font-mono">
          {text}
        </div>
      </div>
    </div>
  );
}

function VerdictBanner({ verdict, symbol, yesVotes, isNew }: {
  verdict: string;
  symbol: string;
  yesVotes: number;
  isNew: boolean;
}) {
  const colors = {
    BUY: { bg: '#00e04008', border: '#00e04025', color: '#00e040' },
    SKIP: { bg: '#ffffff04', border: '#ffffff10', color: '#555' },
    DANGEROUS: { bg: '#ff284008', border: '#ff284025', color: '#ff2840' },
  };
  const c = colors[verdict as keyof typeof colors] || colors.SKIP;

  return (
    <div
      className={`mx-4 my-2 p-3 rounded-md flex items-center justify-between ${isNew ? 'animate-scale-in' : ''}`}
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest" style={{ color: c.color }}>
          VERDICT: {verdict}
        </span>
        <span className="text-[9px] text-[#666] font-mono">
          ({yesVotes}/4 YES)
        </span>
      </div>
      <span className="text-xs font-bold text-white font-mono">${symbol}</span>
    </div>
  );
}

function ConsensusRing({ votes, active }: { votes: number; active: boolean }) {
  const agentList = Object.values(AGENTS);

  return (
    <svg width={36} height={36} className={`flex-shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-30'}`}>
      {agentList.map((a, i) => {
        const startAngle = (i * 90 - 90) * Math.PI / 180;
        const endAngle = ((i + 1) * 90 - 90) * Math.PI / 180;
        const r = 14;
        const cx = 18, cy = 18;
        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const voted = votes > i;

        return (
          <path
            key={a.id}
            d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
            fill="none"
            stroke={voted ? a.color : '#1a1c22'}
            strokeWidth={2.5}
            strokeLinecap="round"
            style={{
              filter: voted ? `drop-shadow(0 0 3px ${a.color})` : 'none',
              transition: 'stroke 0.4s, filter 0.4s',
            }}
          />
        );
      })}
      <circle
        cx={18} cy={18} r={4}
        fill={votes >= 3 ? '#00e040' : votes > 0 ? '#f0a820' : '#1a1c22'}
        style={{ transition: 'fill 0.4s' }}
      />
    </svg>
  );
}

export function AGICouncil() {
  const { activity, isLoading } = useAgentStatus({
    enabled: true,
    activityInterval: 500,  // Poll every 500ms for real-time feel
    statusInterval: 2000,
  });
  const [sessions, setSessions] = useState<CouncilSession[]>([]);
  const [liveSession, setLiveSession] = useState<CouncilSession | null>(null);
  const [stats, setStats] = useState({ total: 0, buys: 0, skips: 0, dangers: 0 });
  const feedRef = useRef<HTMLDivElement>(null);
  const processedIds = useRef<Set<string>>(new Set());

  // Process real events from paper trading
  useEffect(() => {
    if (!activity.length) return;

    const now = Date.now();
    for (const event of activity) {
      if (processedIds.current.has(event.id)) continue;
      processedIds.current.add(event.id);

      // Skip old events for live session (older than 30 seconds)
      const isOldEvent = (now - event.timestamp) > 30000;

      const agentKey = event.agent?.toLowerCase() as AgentKey;
      const agent = AGENTS[agentKey] || AGENTS.scout;

      // Parse council votes: "→ COUNCIL: [YES] reason"
      // Skip old events for live session display
      const voteMatch = !isOldEvent && event.message.match(/→\s*COUNCIL:\s*\[(\w+)\]\s*(.+)/i);
      if (voteMatch) {
        const vote = voteMatch[1].toUpperCase() as 'YES' | 'NO' | 'ABSTAIN';
        const reason = voteMatch[2];
        const symbol = event.data?.tokenSymbol || '???';
        const token = event.data?.tokenAddress || '';

        setLiveSession(prev => {
          // If live session is for a DIFFERENT token, discard it and start fresh
          if (prev && prev.token && prev.token !== token) {
            // Old session for different token - start new one
            return {
              id: `council-${token.slice(0, 8)}-${event.timestamp}`,
              token,
              symbol,
              messages: [{
                id: event.id,
                agent,
                text: reason,
                vote,
                timestamp: event.timestamp,
              }],
              yesVotes: vote === 'YES' ? 1 : 0,
              completed: false,
              timestamp: event.timestamp,
            };
          }

          const session = prev || {
            id: `council-${token.slice(0, 8)}-${event.timestamp}`,
            token,
            symbol,
            messages: [],
            yesVotes: 0,
            completed: false,
            timestamp: event.timestamp,
          };

          // Skip if message already exists in session
          if (session.messages.some(m => m.id === event.id)) {
            return session;
          }

          return {
            ...session,
            messages: [...session.messages, {
              id: event.id,
              agent,
              text: reason,
              vote,
              timestamp: event.timestamp,
            }],
            yesVotes: session.yesVotes + (vote === 'YES' ? 1 : 0),
          };
        });
      }

      // Parse verdict: "VERDICT on $SYMBOL: TRADE/SKIP (X/4 YES)"
      const verdictMatch = event.message.match(/VERDICT\s+on\s+\$(\w+):\s*(\w+)\s*\((\d)\/4/i);
      if (verdictMatch) {
        const symbol = verdictMatch[1];
        const decision = verdictMatch[2].toUpperCase();
        const yesCount = parseInt(verdictMatch[3]);

        const verdict: 'BUY' | 'SKIP' | 'DANGEROUS' = decision === 'TRADE' ? 'BUY' : decision === 'SKIP' ? 'SKIP' : 'DANGEROUS';

        setLiveSession(prev => {
          if (!prev) return null;

          const completedSession: CouncilSession = {
            ...prev,
            symbol,
            verdict,
            yesVotes: yesCount,
            completed: true,
          };

          // Move to completed sessions (newest first)
          setSessions(s => [completedSession, ...s.slice(0, 19)]);
          setStats(st => ({
            ...st,
            total: st.total + 1,
            buys: st.buys + (verdict === 'BUY' ? 1 : 0),
            skips: st.skips + (verdict === 'SKIP' ? 1 : 0),
            dangers: st.dangers + (verdict === 'DANGEROUS' ? 1 : 0),
          }));

          return null;
        });
      }

      // BitNet REJECTED events - skip them, they spam the feed
      // Only show actual council decisions and trades
      if (event.message.includes('REJECTED')) {
        // Don't add to feed - just count for stats
        continue;
      }

      // Parse BUY events: "BUY $SYMBOL @ $PRICE | SIZE SOL | reason"
      const buyMatch = event.message.match(/^BUY \$(\w+) @ \$[\d.]+/);
      if (buyMatch) {
        const symbol = buyMatch[1];
        setSessions(s => [{
          id: `trade-${event.id}`,
          token: event.data?.tokenAddress || '',
          symbol,
          messages: [{
            id: event.id,
            agent: AGENTS.trader,
            text: event.message,
            vote: 'YES' as const,
            timestamp: event.timestamp,
          }],
          verdict: 'BUY',
          yesVotes: 4,
          completed: true,
          timestamp: event.timestamp,
        }, ...s.slice(0, 19)]);
        setStats(st => ({ ...st, total: st.total + 1, buys: st.buys + 1 }));
      }

      // Parse SELL events: "SELL $SYMBOL | REASON | PNL% | PNL SOL"
      // Reason can have hyphens like BC-TIMEOUT, RUG, etc.
      const sellMatch = event.message.match(/^SELL \$(\w+) \| ([\w-]+) \| ([+-]?\d+\.?\d*)%/);
      if (sellMatch) {
        const symbol = sellMatch[1];
        const reason = sellMatch[2];
        const pnl = parseFloat(sellMatch[3]);
        const verdict = pnl >= 0 ? 'BUY' : (reason === 'RUG' ? 'DANGEROUS' : 'SKIP');

        setSessions(s => [{
          id: `exit-${event.id}`,
          token: event.data?.tokenAddress || '',
          symbol,
          messages: [{
            id: event.id,
            agent: AGENTS.trader,
            text: event.message,
            timestamp: event.timestamp,
          }],
          verdict: verdict as 'BUY' | 'SKIP' | 'DANGEROUS',
          yesVotes: pnl >= 0 ? 4 : 0,
          completed: true,
          timestamp: event.timestamp,
        }, ...s.slice(0, 19)]);
      }
    }
  }, [activity]);

  // Auto-clear stale live sessions after 10 seconds
  useEffect(() => {
    if (!liveSession) return;

    const timeout = setTimeout(() => {
      setLiveSession(prev => {
        if (prev && Date.now() - prev.timestamp > 10000) {
          return null; // Clear stale session
        }
        return prev;
      });
    }, 10000);

    return () => clearTimeout(timeout);
  }, [liveSession]);

  // Keep scroll at top (newest first, no need to scroll)
  useEffect(() => {
    if (feedRef.current && feedRef.current.scrollTop < 100) {
      feedRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [sessions]);

  const liveVotes = liveSession?.messages.filter(m => m.vote).length || 0;

  return (
    <div className="h-full flex flex-col bg-[#040405] text-[#a8acb8] font-mono overflow-hidden">
      {/* Header */}
      <header className="h-11 flex-shrink-0 flex items-center justify-between px-4 bg-[#08090b] border-b border-[#131518]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00e040] animate-pulse" />
            <span className="text-xs font-bold tracking-widest text-white">ARGUS</span>
          </div>
          <span className="text-[#1c1f24]">│</span>
          <span className="text-[9px] text-[#464a56] tracking-wide">AGI COUNCIL</span>
        </div>

        {/* Agent indicators */}
        <div className="flex items-center gap-3">
          {Object.values(AGENTS).map(a => (
            <div key={a.id} className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: a.color, boxShadow: `0 0 4px ${a.glow}` }}
              />
              <span className="text-[8px] tracking-wide" style={{ color: `${a.color}88` }}>
                {a.name}
              </span>
            </div>
          ))}
        </div>

        {/* Consensus ring */}
        <div className="flex items-center gap-3">
          <ConsensusRing votes={liveVotes} active={!!liveSession} />
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff2840] animate-pulse" />
            <span className="text-[8px] tracking-widest text-[#ff2840] font-semibold">LIVE</span>
          </div>
        </div>
      </header>

      {/* Feed - newest first */}
      <main ref={feedRef} className="flex-1 overflow-y-auto overflow-x-hidden pt-2 pb-14 scrollbar-thin">
        {isLoading && sessions.length === 0 && !liveSession && (
          <div className="flex flex-col items-center justify-center h-full text-[#666]">
            <div className="w-8 h-8 border-2 border-[#333] border-t-[#00e040] rounded-full animate-spin mb-4" />
            <span className="text-sm">Connecting to AGI Council...</span>
          </div>
        )}

        {/* Live session - at TOP (newest first) */}
        {liveSession && (
          <div className="mb-4">
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="flex-1 h-px bg-[#00d4ff30]" />
              <span className="text-[8px] text-[#00d4ff] tracking-widest animate-pulse">
                LIVE SESSION
              </span>
              <div className="flex-1 h-px bg-[#00d4ff30]" />
            </div>

            {liveSession.messages.map((msg, mi) => (
              <AgentBubble
                key={msg.id}
                agent={msg.agent}
                text={msg.text}
                vote={msg.vote}
                isNew={true}
                showAvatar={mi === 0 || liveSession.messages[mi - 1].agent.id !== msg.agent.id}
              />
            ))}
          </div>
        )}

        {/* Idle state - shows when no live session */}
        {!liveSession && sessions.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 mb-2 opacity-50">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] animate-pulse" />
            <span className="text-[10px] text-[#464a56]">
              Scanning for new tokens<span className="animate-pulse">_</span>
            </span>
          </div>
        )}

        {/* Completed sessions - newest first */}
        {sessions.map((session, si) => (
          <div key={session.id} className={`mb-4 ${si === 0 ? 'new-item-flash' : ''}`}>
            <div className="flex items-center gap-3 px-4 py-2">
              <div className={`flex-1 h-px ${si === 0 ? 'bg-[#00e040]' : 'bg-[#131518]'}`} />
              <span className={`text-[8px] tracking-widest ${si === 0 ? 'text-[#00e040] font-bold' : 'text-[#252830]'}`}>
                {si === 0 ? '★ NEW ★' : `${si + 1}`}
              </span>
              <div className={`flex-1 h-px ${si === 0 ? 'bg-[#00e040]' : 'bg-[#131518]'}`} />
            </div>

            {session.messages.map((msg, mi) => (
              <AgentBubble
                key={msg.id}
                agent={msg.agent}
                text={msg.text}
                vote={msg.vote}
                isNew={si === 0}
                showAvatar={mi === 0 || session.messages[mi - 1].agent.id !== msg.agent.id}
              />
            ))}

            {session.verdict && (
              <VerdictBanner
                verdict={session.verdict}
                symbol={session.symbol}
                yesVotes={session.yesVotes}
                isNew={si === 0}
              />
            )}
          </div>
        ))}

        {/* Empty state */}
        {sessions.length === 0 && !liveSession && !isLoading && (
          <div className="flex items-center gap-2 px-4 py-4 opacity-30">
            <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-pulse" />
            <span className="text-[9px] text-[#333]">
              Scanning for new tokens<span className="animate-pulse">_</span>
            </span>
          </div>
        )}
      </main>

      {/* Stats bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-4 py-1.5 rounded-full bg-[#040405]/90 border border-[#131518] backdrop-blur-lg text-[9px] tracking-wide text-[#464a56]">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${activity.length > 0 ? 'bg-[#00e040] animate-pulse' : 'bg-[#ff2840]'}`} />
          <span className="text-[#00d4ff]">{activity.length}</span>
        </span>
        <span className="text-[#131518]">●</span>
        <span>SESSIONS <span className="text-[#a8acb8] font-semibold">{stats.total}</span></span>
        <span className="text-[#131518]">●</span>
        <span>BUY <span className="text-[#00e040] font-semibold">{stats.buys}</span></span>
        <span className="text-[#131518]">●</span>
        <span>SKIP <span className="font-semibold">{stats.skips}</span></span>
        <span className="text-[#131518]">●</span>
        <span>FLAGGED <span className={stats.dangers > 0 ? 'text-[#ff2840]' : ''} style={{ fontWeight: 600 }}>{stats.dangers}</span></span>
      </div>
    </div>
  );
}

export default AGICouncil;
