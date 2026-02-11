/**
 * ChatMessage - Individual chat message bubble
 *
 * Displays different message types with appropriate styling:
 * - user: Right-aligned, blue background
 * - argus: Left-aligned, dark background
 * - discovery: Left-aligned with amber accent
 * - system: Center-aligned, muted
 */

import React from 'react';

export type MessageType = 'user' | 'argus' | 'discovery' | 'system';

export interface ChatMessageData {
  id: string;
  timestamp: number;
  type: MessageType;
  content: string;
  isLoading?: boolean;
  metadata?: {
    tokenAddress?: string;
    tokenSymbol?: string;
    analysis?: {
      score: number;
      verdict: string;
      summary: string;
    };
  };
}

interface ChatMessageProps {
  message: ChatMessageData;
  onTokenClick?: (address: string) => void;
}

// Simple markdown renderer for chat messages
const renderMarkdown = (text: string): React.ReactNode => {
  // Split by newlines and process each line
  const lines = text.split('\n');

  return lines.map((line, i) => {
    // Headers (### Header)
    if (line.startsWith('### ')) {
      return <div key={i} className="font-bold text-[#e5e5e5] mt-2 mb-1">{line.slice(4)}</div>;
    }
    if (line.startsWith('## ')) {
      return <div key={i} className="font-bold text-[#e5e5e5] mt-2 mb-1">{line.slice(3)}</div>;
    }

    // Bullet points
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.slice(2);
      return (
        <div key={i} className="flex gap-2 ml-2">
          <span className="text-[#666]">•</span>
          <span>{renderInlineMarkdown(content)}</span>
        </div>
      );
    }

    // Numbered lists
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      return (
        <div key={i} className="flex gap-2 ml-2">
          <span className="text-[#666] min-w-[1.2rem]">{numberedMatch[1]}.</span>
          <span>{renderInlineMarkdown(numberedMatch[2])}</span>
        </div>
      );
    }

    // Empty lines
    if (line.trim() === '') {
      return <div key={i} className="h-2" />;
    }

    // Regular text with inline formatting
    return <div key={i}>{renderInlineMarkdown(line)}</div>;
  });
};

// Handle inline markdown (bold, code)
const renderInlineMarkdown = (text: string): React.ReactNode => {
  // Replace **bold** with styled spans
  const parts = text.split(/(\*\*[^*]+\*\*|\`[^`]+\`)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-[#fafafa]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-[#1a1a1a] px-1 rounded text-red-400">{part.slice(1, -1)}</code>;
    }
    return part;
  });
};

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onTokenClick }) => {
  const { type, content, isLoading, metadata, timestamp } = message;

  // Format timestamp
  const timeStr = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // System messages
  if (type === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[0.7rem] text-[#555] bg-[#111] px-3 py-1 rounded-full">
          {content}
        </span>
      </div>
    );
  }

  // User messages (right-aligned)
  if (type === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[80%]">
          <div className="bg-red-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 shadow-lg">
            <p className="text-sm whitespace-pre-wrap">{content}</p>
          </div>
          <div className="text-[0.65rem] text-[#555] mt-1 text-right">{timeStr}</div>
        </div>
      </div>
    );
  }

  // Discovery messages (amber accent)
  if (type === 'discovery') {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[85%]">
          <div className="bg-[#1a1a0f] border border-amber-900/50 rounded-2xl rounded-bl-sm px-4 py-3 shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              <span className="text-[0.7rem] text-amber-500 font-medium uppercase tracking-wide">
                Discovery
              </span>
            </div>
            <div className="text-sm text-[#e5e5e5]">{renderMarkdown(content)}</div>
            {metadata?.tokenAddress && (
              <button
                onClick={() => onTokenClick?.(metadata.tokenAddress!)}
                className="mt-2 text-[0.7rem] text-amber-400 hover:text-amber-300 underline"
              >
                Analyze {metadata.tokenSymbol || 'token'}
              </button>
            )}
          </div>
          <div className="text-[0.65rem] text-[#555] mt-1">ARGUS {timeStr}</div>
        </div>
      </div>
    );
  }

  // Argus messages (left-aligned)
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%]">
        <div className="bg-[#161616] border border-[#252525] rounded-2xl rounded-bl-sm px-4 py-3 shadow-lg">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-[#444] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-[#444] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-[#444] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-[0.75rem] text-[#666]">Thinking...</span>
            </div>
          ) : (
            <>
              <div className="text-sm text-[#e5e5e5]">{renderMarkdown(content)}</div>

              {/* Inline analysis card */}
              {metadata?.analysis && (
                <div className="mt-3 p-3 bg-[#0d0d0d] rounded-lg border border-[#222]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[0.7rem] text-[#666] uppercase">Analysis</span>
                    <span
                      className={`text-sm font-bold ${
                        metadata.analysis.score >= 60
                          ? 'text-green-500'
                          : metadata.analysis.score >= 40
                          ? 'text-amber-500'
                          : 'text-red-500'
                      }`}
                    >
                      {metadata.analysis.score}/100
                    </span>
                  </div>
                  <div
                    className={`text-[0.7rem] font-medium mb-1 ${
                      metadata.analysis.verdict === 'SAFE'
                        ? 'text-green-400'
                        : metadata.analysis.verdict === 'SUSPICIOUS'
                        ? 'text-amber-400'
                        : 'text-red-400'
                    }`}
                  >
                    {metadata.analysis.verdict}
                  </div>
                  <p className="text-[0.75rem] text-[#888]">{metadata.analysis.summary}</p>
                </div>
              )}

              {metadata?.tokenAddress && !metadata?.analysis && (
                <button
                  onClick={() => onTokenClick?.(metadata.tokenAddress!)}
                  className="mt-2 text-[0.7rem] text-red-400 hover:text-red-300 underline"
                >
                  View {metadata.tokenSymbol || 'token'} details
                </button>
              )}
            </>
          )}
        </div>
        <div className="text-[0.65rem] text-[#555] mt-1">ARGUS {timeStr}</div>
      </div>
    </div>
  );
};

export default ChatMessage;
