/**
 * LiveTransactionFeed - Real-time transaction stream + alerts
 */

import React from 'react';
import type { ActivityEvent } from '../../hooks/useAgentStatus';

interface Transaction {
  id: string;
  time: string;
  type: 'BUY' | 'SELL' | 'TRANSFER';
  hash: string;
  amount: number;
  tag?: 'SNIPER' | 'DEV' | 'BUNDLE';
}

interface LiveTransactionFeedProps {
  transactions?: Transaction[];
  alerts: ActivityEvent[];
  onAlertClick?: (alert: ActivityEvent) => void;
  onClearComms?: () => void;
}

export const LiveTransactionFeed: React.FC<LiveTransactionFeedProps> = ({
  transactions = [],
  alerts,
  onAlertClick,
  onClearComms,
}) => {
  // Generate mock transactions if none provided
  const displayTransactions = transactions.length > 0 ? transactions : generateMockTransactions();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Transaction Stream - Fixed height, not flex-1 */}
      <div className="overflow-y-auto" style={{ maxHeight: '55%' }}>
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2 flex justify-between">
          <span>Live Transaction Stream</span>
          <span className="text-[#DC2626] animate-pulse">LIVE</span>
        </div>

        <div className="space-y-0">
          {displayTransactions.map((tx) => (
            <div
              key={tx.id}
              className="font-mono text-[0.65rem] py-1.5 border-b border-[#111] flex justify-between items-center"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[#555] flex-shrink-0">{tx.time}</span>
                <span className="text-[#888] truncate">{tx.hash}</span>
                {tx.tag && (
                  <span className={`text-[0.55rem] px-1 py-0.5 rounded flex-shrink-0 ${getTagStyle(tx.tag)}`}>
                    {tx.tag}
                  </span>
                )}
              </div>
              <div className={`flex-shrink-0 ml-2 font-bold ${tx.type === 'BUY' ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                <span className="text-[0.6rem]">{tx.type}</span> {tx.amount.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alert Log - Takes remaining space */}
      <div className="mt-2 pt-2 border-t border-[#222] flex-1 overflow-hidden flex flex-col">
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2 flex justify-between items-center">
          <span>Agent Comms</span>
          <div className="flex items-center gap-2">
            {alerts.filter(a => a.type === 'comms').length > 0 && onClearComms && (
              <button
                onClick={onClearComms}
                className="text-[0.55rem] text-[#555] hover:text-[#888] uppercase transition-colors"
              >
                clear
              </button>
            )}
            <span className="text-[#444] text-[0.6rem] normal-case">swarm channel</span>
          </div>
        </div>

        <div className="space-y-1 flex-1 overflow-y-auto">
          {alerts
            .filter((alert) => alert.type === 'comms')
            .slice(0, 15)
            .map((alert) => (
            <div
              key={alert.id}
              className={`font-mono text-[0.65rem] py-1.5 px-2 rounded cursor-pointer hover:bg-[#1a1a1a] ${
                alert.type === 'comms' ? getCommsBgStyle(alert.severity) : getAlertBgStyle(alert.severity)
              }`}
              onClick={() => onAlertClick?.(alert)}
            >
              {alert.type === 'comms' ? (
                // Agent-to-agent communication style
                <div className="flex items-start gap-1">
                  <span className={`font-bold ${getAgentColor(alert.agent)}`}>
                    {alert.agent}
                  </span>
                  <span className="text-[#555]">{alert.message}</span>
                </div>
              ) : (
                // Regular alert style
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <span className={`font-bold ${getAlertTextStyle(alert.severity)}`}>
                      [{alert.agent}]
                    </span>{' '}
                    <span className="text-[#d1d1d1]">{alert.message}</span>
                  </div>
                  <span className={`ml-2 text-[0.55rem] font-bold uppercase ${getAlertTextStyle(alert.severity)}`}>
                    {alert.severity === 'critical' ? 'CRIT' : alert.severity === 'warning' ? 'WARN' : 'INFO'}
                  </span>
                </div>
              )}
              {alert.data?.tokenSymbol && alert.type !== 'comms' && (
                <div className="text-[#666] text-[0.6rem] mt-0.5">
                  Token: {alert.data.tokenSymbol}
                </div>
              )}
            </div>
          ))}

          {alerts.filter(a => a.type === 'comms').length === 0 && (
            <div className="text-[#666] text-[0.65rem] py-2 text-center">
              Scan a token to see agent coordination
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function getTagStyle(tag: string): string {
  switch (tag) {
    case 'SNIPER':
      return 'bg-[rgba(239,68,68,0.2)] text-[#EF4444] border border-[#EF4444]';
    case 'DEV':
      return 'bg-[rgba(187,134,252,0.2)] text-[#bb86fc] border border-[#bb86fc]';
    case 'BUNDLE':
      return 'bg-[rgba(245,158,11,0.2)] text-[#F59E0B] border border-[#F59E0B]';
    default:
      return 'bg-[#222] text-white';
  }
}

function getAlertBgStyle(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-[rgba(239,68,68,0.08)] border-l-2 border-[#EF4444]';
    case 'warning':
      return 'bg-[rgba(245,158,11,0.08)] border-l-2 border-[#F59E0B]';
    default:
      return 'bg-[rgba(220,38,38,0.05)] border-l-2 border-[#DC2626]';
  }
}

function getCommsBgStyle(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-[rgba(239,68,68,0.05)] border-l-2 border-[#444]';
    case 'warning':
      return 'bg-[rgba(245,158,11,0.03)] border-l-2 border-[#333]';
    default:
      return 'bg-[rgba(100,100,100,0.05)] border-l-2 border-[#333]';
  }
}

function getAgentColor(agent: string): string {
  switch (agent.toUpperCase()) {
    case 'SCOUT':
      return 'text-[#3B82F6]'; // Blue
    case 'ANALYST':
      return 'text-[#A855F7]'; // Purple
    case 'HUNTER':
      return 'text-[#F59E0B]'; // Orange
    case 'TRADER':
      return 'text-[#22C55E]'; // Green
    default:
      return 'text-[#DC2626]';
  }
}

function getAlertTextStyle(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'text-[#EF4444]';
    case 'warning':
      return 'text-[#F59E0B]';
    default:
      return 'text-[#DC2626]';
  }
}

function generateMockTransactions(): Transaction[] {
  const transactions: Transaction[] = [];
  const now = new Date();

  for (let i = 0; i < 15; i++) {
    const time = new Date(now.getTime() - i * 3000);
    const types: ('BUY' | 'SELL' | 'TRANSFER')[] = ['BUY', 'SELL', 'SELL', 'BUY', 'TRANSFER'];
    const type = types[Math.floor(Math.random() * types.length)];
    const tags: (undefined | 'SNIPER' | 'DEV' | 'BUNDLE')[] = [undefined, undefined, undefined, 'SNIPER', 'BUNDLE'];

    transactions.push({
      id: `tx-${i}`,
      time: time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type,
      hash: `0x${Math.random().toString(16).substr(2, 8)}...${Math.random().toString(16).substr(2, 4)}`,
      amount: Math.random() * 10,
      tag: tags[Math.floor(Math.random() * tags.length)],
    });
  }

  return transactions;
}

export default LiveTransactionFeed;
