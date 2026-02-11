/**
 * AgentConversation - Intelligence Feed
 *
 * Shows meaningful agent activity, not noise:
 * - Aggregates routine Scout discoveries
 * - Highlights Analyst investigations
 * - Surfaces Hunter scammer alerts
 * - Shows Trader decisions
 */

import React, { useEffect, useRef, useMemo } from 'react';
import type { ActivityEvent } from '../../hooks/useAgentStatus';

interface AgentConversationProps {
  events: ActivityEvent[];
  onTokenClick?: (address: string) => void;
}

// Categorize events by importance
type EventCategory = 'critical' | 'investigation' | 'discovery' | 'routine';

function categorizeEvent(event: ActivityEvent): EventCategory {
  const { agent, type, severity, message } = event;
  const agentLower = agent.toLowerCase();
  const msgLower = message.toLowerCase();

  // Critical: Scammer alerts, dangerous tokens
  if (severity === 'critical') return 'critical';
  if (msgLower.includes('scammer') || msgLower.includes('dangerous')) return 'critical';

  // Investigation: Analyst/Hunter comms with scores
  if (agentLower === 'analyst' && type === 'comms') return 'investigation';
  if (agentLower === 'hunter') return 'investigation';
  if (agentLower === 'trader') return 'investigation';

  // Discovery: New pools with some signal
  if (type === 'discovery' && severity === 'warning') return 'discovery';

  // Everything else is routine noise
  return 'routine';
}

// Group routine events by time window
interface AggregatedView {
  type: 'single' | 'aggregate';
  event?: ActivityEvent;
  events?: ActivityEvent[];
  count?: number;
  dexCounts?: Record<string, number>;
  timeRange?: { start: number; end: number };
}

function aggregateEvents(events: ActivityEvent[]): AggregatedView[] {
  const result: AggregatedView[] = [];
  let routineBuffer: ActivityEvent[] = [];

  const flushRoutine = () => {
    if (routineBuffer.length === 0) return;

    if (routineBuffer.length <= 2) {
      // Show individually if just 1-2
      routineBuffer.forEach(e => result.push({ type: 'single', event: e }));
    } else {
      // Aggregate
      const dexCounts: Record<string, number> = {};
      routineBuffer.forEach(e => {
        const dex = e.data?.tokenSymbol || 'UNKNOWN';
        dexCounts[dex] = (dexCounts[dex] || 0) + 1;
      });

      result.push({
        type: 'aggregate',
        events: routineBuffer,
        count: routineBuffer.length,
        dexCounts,
        timeRange: {
          start: routineBuffer[routineBuffer.length - 1].timestamp,
          end: routineBuffer[0].timestamp,
        },
      });
    }
    routineBuffer = [];
  };

  // Process events (newest first)
  for (const event of events) {
    const category = categorizeEvent(event);

    if (category === 'routine') {
      routineBuffer.push(event);
    } else {
      // Flush any buffered routine events first
      flushRoutine();
      // Add important event
      result.push({ type: 'single', event });
    }
  }

  // Flush remaining
  flushRoutine();

  return result;
}

// Format time ago
function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export const AgentConversation: React.FC<AgentConversationProps> = ({
  events,
  onTokenClick,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top on new events (newest first)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length]);

  // Aggregate routine events
  const aggregatedView = useMemo(() => aggregateEvents(events), [events]);

  if (events.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-12 h-12 text-red-500" stroke="currentColor" strokeWidth="1.5">
            <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <circle cx="12" cy="12" r="3" className="fill-red-500 animate-pulse" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-[#888] mb-2">Agents Standing By</h3>
        <p className="text-sm text-[#555] max-w-md">
          Monitoring Solana for opportunities and threats.
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {aggregatedView.map((item, idx) => {
        if (item.type === 'aggregate') {
          // Collapsed routine events
          const dexList = Object.entries(item.dexCounts || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([dex, count]) => `${count} ${dex.replace('_', ' ').toLowerCase()}`)
            .join(', ');

          return (
            <div key={`agg-${idx}`} className="px-3 py-2 border-b border-[#1a1a1a] bg-[#0a0a0a]">
              <div className="flex items-center gap-2 text-xs text-[#444]">
                <span className="text-red-500/50 font-mono">[S]</span>
                <span className="flex-1">
                  Scout detected {item.count} pools ({dexList})
                </span>
                <span className="text-[#333]">{timeAgo(item.timeRange?.end || 0)}</span>
              </div>
            </div>
          );
        }

        // Single important event
        const event = item.event!;
        const category = categorizeEvent(event);
        const agent = event.agent.toLowerCase();
        const addr = event.data?.tokenAddress ? `${event.data.tokenAddress.slice(0, 8)}...` : '';

        // Critical events get special treatment
        if (category === 'critical') {
          return (
            <div
              key={event.id}
              className="px-3 py-3 border-b border-red-500/30 bg-red-500/10"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-red-500 text-lg">!</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-red-400 uppercase">{agent}</span>
                    <span className="text-[0.65rem] text-red-500/50">{timeAgo(event.timestamp)}</span>
                  </div>
                  <p className="text-sm text-red-200 font-medium">{event.message}</p>
                  {addr && (
                    <button
                      onClick={() => onTokenClick?.(event.data!.tokenAddress!)}
                      className="mt-2 text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded hover:bg-red-500/30"
                    >
                      Analyze {addr}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Investigation events (Analyst comms, Hunter tracking)
        if (category === 'investigation') {
          const score = event.data?.score;
          const target = event.data?.targetAgent?.toLowerCase();

          return (
            <div
              key={event.id}
              className="px-3 py-2.5 border-b border-[#1a1a1a] bg-[#0d0d0d]"
            >
              <div className="flex items-start gap-2">
                <span className="text-xs font-mono text-red-400/80 w-10 flex-shrink-0">[{agent.charAt(0).toUpperCase()}]</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {target && (
                      <span className="text-[0.65rem] text-[#555] bg-[#1a1a1a] px-1.5 py-0.5 rounded">
                        → {target}
                      </span>
                    )}
                    {score !== undefined && (
                      <span className={`text-[0.65rem] px-1.5 py-0.5 rounded font-mono ${
                        score >= 80 ? 'bg-red-500/20 text-red-400' :
                        score >= 60 ? 'bg-orange-500/20 text-orange-400' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        {score}/100
                      </span>
                    )}
                    <span className="text-[0.6rem] text-[#333] ml-auto">{timeAgo(event.timestamp)}</span>
                  </div>
                  <p className="text-sm text-[#888] mt-1">{event.message}</p>
                  {addr && (
                    <button
                      onClick={() => onTokenClick?.(event.data!.tokenAddress!)}
                      className="mt-1.5 text-xs text-red-500/70 hover:text-red-400"
                    >
                      [{addr}]
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Discovery events (some signal but not critical)
        return (
          <div
            key={event.id}
            className="px-3 py-2 border-b border-[#111]"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="text-red-500/40 font-mono">[S]</span>
              <span className="text-[#666] flex-1 truncate">
                {event.data?.tokenSymbol || 'Pool'}: {addr}
              </span>
              {event.severity === 'warning' && (
                <span className="text-orange-500/60 text-[0.6rem]">flagged</span>
              )}
              <span className="text-[#333]">{timeAgo(event.timestamp)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AgentConversation;
