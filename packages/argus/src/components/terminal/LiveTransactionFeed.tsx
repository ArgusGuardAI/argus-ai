/**
 * LiveTransactionFeed - Real agent-to-agent communication channel
 *
 * Shows actual MessageBus communications between agents.
 * No mock data, no simulated conversations.
 */

import React, { useRef, useEffect } from 'react';
import type { ActivityEvent } from '../../hooks/useAgentStatus';

interface LiveTransactionFeedProps {
  alerts: ActivityEvent[];
  onAlertClick?: (alert: ActivityEvent) => void;
  onClearComms?: () => void;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getAgentColor(agent: string): string {
  switch (agent.toUpperCase()) {
    case 'SCOUT': return 'text-[#3B82F6]';
    case 'ANALYST': return 'text-[#A855F7]';
    case 'HUNTER': return 'text-[#F59E0B]';
    case 'TRADER': return 'text-[#22C55E]';
    default: return 'text-[#888]';
  }
}

function getAgentBgColor(agent: string): string {
  switch (agent.toUpperCase()) {
    case 'SCOUT': return 'bg-[rgba(59,130,246,0.08)]';
    case 'ANALYST': return 'bg-[rgba(168,85,247,0.08)]';
    case 'HUNTER': return 'bg-[rgba(245,158,11,0.08)]';
    case 'TRADER': return 'bg-[rgba(34,197,94,0.08)]';
    default: return 'bg-[rgba(100,100,100,0.05)]';
  }
}

function getSeverityBorder(severity: string): string {
  switch (severity) {
    case 'critical': return 'border-l-[#EF4444]';
    case 'warning': return 'border-l-[#F59E0B]';
    default: return 'border-l-[#333]';
  }
}

function getTypeBadge(type: string): { label: string; style: string } | null {
  switch (type) {
    case 'alert':
      return { label: 'ALERT', style: 'bg-[rgba(239,68,68,0.2)] text-[#EF4444] border border-[#EF4444]' };
    case 'analysis':
      return { label: 'VERDICT', style: 'bg-[rgba(168,85,247,0.2)] text-[#A855F7] border border-[#A855F7]' };
    case 'scan':
      return { label: 'SCAN', style: 'bg-[rgba(59,130,246,0.15)] text-[#3B82F6] border border-[#3B82F6]' };
    default:
      return null;
  }
}

export const LiveTransactionFeed: React.FC<LiveTransactionFeedProps> = ({
  alerts,
  onAlertClick,
  onClearComms,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [alerts.length]);

  // Show all event types, not just comms
  const displayEvents = alerts.slice(0, 50);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span>Agent Comms</span>
          {displayEvents.length > 0 && (
            <span className="text-[#22C55E] animate-pulse text-[0.55rem]">LIVE</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {displayEvents.length > 0 && onClearComms && (
            <button
              onClick={onClearComms}
              className="text-[0.55rem] text-[#555] hover:text-[#888] uppercase transition-colors"
            >
              clear
            </button>
          )}
          <span className="text-[#444] text-[0.6rem] normal-case">real-time swarm channel</span>
        </div>
      </div>

      <div ref={scrollRef} className="space-y-1 flex-1 overflow-y-auto">
        {displayEvents.map((event) => {
          const badge = getTypeBadge(event.type);

          return (
            <div
              key={event.id}
              className={`font-mono text-[0.65rem] py-1.5 px-2 rounded cursor-pointer hover:bg-[#1a1a1a] border-l-2 ${getSeverityBorder(event.severity)} ${getAgentBgColor(event.agent)}`}
              onClick={() => onAlertClick?.(event)}
            >
              <div className="flex items-start gap-1.5">
                {/* Timestamp */}
                <span className="text-[#444] flex-shrink-0 w-6 text-right">
                  {formatTimeAgo(event.timestamp)}
                </span>

                {/* Agent name */}
                <span className={`font-bold flex-shrink-0 ${getAgentColor(event.agent)}`}>
                  {event.agent}
                </span>

                {/* Type badge (for non-comms events) */}
                {badge && (
                  <span className={`text-[0.5rem] px-1 py-0 rounded flex-shrink-0 ${badge.style}`}>
                    {badge.label}
                  </span>
                )}

                {/* Message */}
                <span className="text-[#999] min-w-0">
                  {event.message}
                </span>
              </div>

              {/* Token info (if available and not already in message) */}
              {event.data?.tokenAddress && event.type !== 'comms' && (
                <div className="text-[#555] text-[0.55rem] mt-0.5 ml-8">
                  {event.data.tokenAddress.slice(0, 8)}...{event.data.tokenAddress.slice(-4)}
                  {event.data.score !== undefined && (
                    <span className={`ml-2 ${event.data.score >= 70 ? 'text-[#EF4444]' : event.data.score >= 40 ? 'text-[#F59E0B]' : 'text-[#22C55E]'}`}>
                      risk: {event.data.score}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {displayEvents.length === 0 && (
          <div className="text-[#555] text-[0.65rem] py-4 text-center">
            <div className="text-[#444] mb-1">Waiting for agent activity...</div>
            <div className="text-[#333] text-[0.55rem]">Messages appear here as agents communicate</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveTransactionFeed;
