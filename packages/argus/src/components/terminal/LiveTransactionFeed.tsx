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
}

export const LiveTransactionFeed: React.FC<LiveTransactionFeedProps> = ({
  transactions = [],
  alerts,
  onAlertClick,
}) => {
  // Generate mock transactions if none provided
  const displayTransactions = transactions.length > 0 ? transactions : generateMockTransactions();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Transaction Stream */}
      <div className="flex-1 overflow-y-auto">
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2 flex justify-between">
          <span>Live Transaction Stream</span>
          <span className="text-[#00bcd4]">LIVE</span>
        </div>

        <div className="space-y-0">
          {displayTransactions.map((tx) => (
            <div
              key={tx.id}
              className="grid grid-cols-[50px_1fr_60px] font-mono text-[0.7rem] py-1 border-b border-[#111]"
            >
              <div className="text-[#666]">{tx.time}</div>
              <div className="text-[#aaa] overflow-hidden whitespace-nowrap text-ellipsis flex items-center gap-1">
                {tx.hash}
                {tx.tag && (
                  <span className={`text-[0.6rem] px-1 py-0.5 rounded ${getTagStyle(tx.tag)}`}>
                    {tx.tag}
                  </span>
                )}
              </div>
              <div className={`text-right ${tx.type === 'BUY' ? 'text-[#00e676]' : 'text-[#ff4444]'}`}>
                {tx.type} {tx.amount.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alert Log */}
      <div className="mt-4 pt-3 border-t border-[#222]">
        <div className="text-[0.7rem] uppercase text-[#666] border-b border-[#222] pb-1 mb-2">
          Alert Log
        </div>

        <div className="space-y-1 max-h-[150px] overflow-y-auto">
          {alerts.slice(0, 10).map((alert) => (
            <div
              key={alert.id}
              className={`font-mono text-[0.7rem] py-1.5 px-2 rounded cursor-pointer hover:bg-[#1a1a1a] ${getAlertBgStyle(alert.severity)}`}
              onClick={() => onAlertClick?.(alert)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <span className={`font-bold ${getAlertTextStyle(alert.severity)}`}>
                    [{alert.agent}]
                  </span>{' '}
                  <span className="text-[#d1d1d1]">{alert.message}</span>
                </div>
                <span className={`ml-2 text-[0.6rem] font-bold uppercase ${getAlertTextStyle(alert.severity)}`}>
                  {alert.severity === 'critical' ? 'CRIT' : alert.severity === 'warning' ? 'WARN' : 'INFO'}
                </span>
              </div>
              {alert.data?.tokenSymbol && (
                <div className="text-[#666] text-[0.65rem] mt-0.5">
                  Token: {alert.data.tokenSymbol}
                </div>
              )}
            </div>
          ))}

          {alerts.length === 0 && (
            <div className="text-[#666] text-[0.7rem] py-2 text-center">
              No alerts yet
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
      return 'bg-[rgba(255,68,68,0.2)] text-[#ff4444] border border-[#ff4444]';
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
      return 'bg-[rgba(255,68,68,0.05)] border-l-2 border-[#ff4444]';
    case 'warning':
      return 'bg-[rgba(245,158,11,0.05)] border-l-2 border-[#F59E0B]';
    default:
      return 'bg-[rgba(0,230,118,0.05)] border-l-2 border-[#00e676]';
  }
}

function getAlertTextStyle(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'text-[#ff4444]';
    case 'warning':
      return 'text-[#F59E0B]';
    default:
      return 'text-[#00e676]';
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
