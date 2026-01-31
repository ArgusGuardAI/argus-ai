/**
 * SwarmStatusPanel Component
 *
 * Compact single-row agent status display.
 * Collapsible for minimal vertical space.
 */

import React, { useState } from 'react';
import type { AgentState, AgentStatusResponse } from '../hooks/useAgentStatus';

interface SwarmStatusPanelProps {
  status: AgentStatusResponse | null;
  isConnected: boolean;
  isLoading: boolean;
  onRefresh?: () => void;
}

const statusColors: Record<AgentState['status'], string> = {
  active: '#10B981',
  busy: '#F59E0B',
  idle: '#666666',
  error: '#EF4444',
};

export const SwarmStatusPanel: React.FC<SwarmStatusPanelProps> = ({
  status,
  isConnected,
  isLoading,
  onRefresh,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (isLoading && !status) {
    return (
      <div className="mb-2 px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#666] animate-pulse" />
          <span className="text-[10px] text-[#888]">Connecting...</span>
        </div>
      </div>
    );
  }

  if (!status || !isConnected) {
    return (
      <div className="mb-2 px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[rgba(239,68,68,0.3)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
            <span className="text-[10px] text-[#888]">Offline</span>
          </div>
          {onRefresh && (
            <button onClick={onRefresh} className="text-[9px] text-[#666] hover:text-[#EF4444]">
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const activeCount = status.agents.filter(a => a.status === 'active' || a.status === 'busy').length;

  return (
    <div className="mb-2 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden">
      {/* Compact header - always visible */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[rgba(255,255,255,0.02)]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-bold text-[#EF4444] tracking-wider uppercase">SWARM</span>
          <span className="text-[9px] font-semibold text-[#10B981]">{activeCount}/{status.agents.length}</span>

          {/* Inline agent status dots */}
          <div className="flex items-center gap-1 ml-1">
            {status.agents.map(agent => (
              <div
                key={agent.name}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#111]"
                title={`${agent.name}: ${agent.statusText || agent.status}`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${agent.status === 'active' || agent.status === 'busy' ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: statusColors[agent.status] }}
                />
                <span className="text-[9px] font-semibold text-[#888]">{agent.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={(e) => { e.stopPropagation(); onRefresh(); }}
              className="p-0.5 rounded hover:bg-[#111] text-[#666] hover:text-[#EF4444]"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
          )}
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-[#666] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-2 pt-1.5 border-t border-[#1a1a1a] grid grid-cols-2 lg:grid-cols-4 gap-1.5">
          {status.agents.map(agent => (
            <div key={agent.name} className="p-1.5 rounded bg-[#111] border border-[#1a1a1a]">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold text-[#fafafa]">{agent.name}</span>
                <span
                  className="text-[8px] font-bold px-1 py-0.5 rounded uppercase"
                  style={{
                    backgroundColor: `${statusColors[agent.status]}20`,
                    color: statusColors[agent.status],
                  }}
                >
                  {agent.status}
                </span>
              </div>
              <div className="text-[9px] text-[#666] line-clamp-1">{agent.statusText || 'Standby'}</div>
              <div className="text-[10px] font-mono font-semibold" style={{ color: statusColors[agent.status] }}>
                {agent.metric}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SwarmStatusPanel;
