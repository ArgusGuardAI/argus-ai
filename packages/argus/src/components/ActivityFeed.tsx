/**
 * ActivityFeed Component
 *
 * Always-visible live alert feed with scrolling alerts.
 * Styled as a command center monitoring panel.
 */

import React, { useRef, useEffect } from 'react';
import type { ActivityEvent } from '../hooks/useAgentStatus';

interface ActivityFeedProps {
  events: ActivityEvent[];
  maxVisible?: number;
  onAnalyze?: (tokenAddress: string) => void;
  onViewWallet?: (walletAddress: string) => void;
  onClear?: () => void;
}

const severityConfig = {
  critical: { border: '#EF4444', bg: 'rgba(239, 68, 68, 0.08)', text: '#EF4444' },
  warning: { border: '#F59E0B', bg: 'rgba(245, 158, 11, 0.08)', text: '#F59E0B' },
  info: { border: '#10B981', bg: 'rgba(16, 185, 129, 0.08)', text: '#10B981' },
};

const formatTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
};

const AlertItem: React.FC<{
  event: ActivityEvent;
  onAnalyze?: (address: string) => void;
}> = ({ event, onAnalyze }) => {
  const config = severityConfig[event.severity];

  return (
    <div
      className="px-3 py-2 border-l-2 mb-1.5 last:mb-0 rounded-r-lg transition-all hover:bg-[rgba(255,255,255,0.02)]"
      style={{ borderLeftColor: config.border, backgroundColor: config.bg }}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="text-[9px] font-bold uppercase tracking-wide"
              style={{ color: config.text }}
            >
              {event.severity}
            </span>
            <span className="text-[9px] text-[#666]">{formatTime(event.timestamp)}</span>
          </div>
          <div className="text-[10px] text-[#fafafa] font-medium leading-tight line-clamp-2">
            <span className="text-[#888]">{event.agent}:</span> {event.message}
          </div>
          {event.data?.tokenSymbol && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] font-mono text-[#EF4444]">
                {event.data.tokenSymbol}
              </span>
              {event.data.score !== undefined && (
                <span
                  className="text-[9px] font-mono font-bold"
                  style={{
                    color: event.data.score >= 70 ? '#10B981' : event.data.score >= 40 ? '#F59E0B' : '#EF4444',
                  }}
                >
                  {event.data.score}
                </span>
              )}
              {event.data.tokenAddress && onAnalyze && (
                <button
                  onClick={() => onAnalyze(event.data!.tokenAddress!)}
                  className="text-[9px] text-[#666] hover:text-[#EF4444] transition-colors"
                >
                  →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  events,
  maxVisible = 15,
  onAnalyze,
  onClear,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top on new events
  useEffect(() => {
    if (scrollRef.current && events.length > 0) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const visibleEvents = events.slice(0, maxVisible);

  return (
    <div className="rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#EF4444] tracking-wider uppercase">
            ALERTS
          </span>
          <div className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
          {events.length > 0 && (
            <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-[rgba(239,68,68,0.2)] text-[#EF4444]">
              {events.length}
            </span>
          )}
        </div>
        {onClear && events.length > 0 && (
          <button
            onClick={onClear}
            className="text-[9px] text-[#666] hover:text-[#888] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2"
        style={{ maxHeight: 'calc(100vh - 350px)', minHeight: '200px' }}
      >
        {visibleEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-6 text-center">
            <div className="w-8 h-8 rounded-full bg-[#111] flex items-center justify-center mb-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <span className="text-[10px] text-[#666]">Monitoring...</span>
          </div>
        ) : (
          visibleEvents.map((event) => (
            <AlertItem key={event.id} event={event} onAnalyze={onAnalyze} />
          ))
        )}
      </div>

      {/* Footer stats */}
      {events.length > maxVisible && (
        <div className="px-2 py-1.5 border-t border-[#1a1a1a] text-center flex-shrink-0">
          <span className="text-[9px] text-[#666]">
            +{events.length - maxVisible} more
          </span>
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
