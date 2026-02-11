/**
 * ChatContainer - Main chat interface wrapper
 *
 * Contains the message list and input, handles scrolling behavior.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { ChatMessage, type ChatMessageData } from './ChatMessage';
import { ChatInput } from './ChatInput';

interface ChatContainerProps {
  messages: ChatMessageData[];
  onSendMessage: (message: string) => void;
  onTokenClick?: (address: string) => void;
  isLoading?: boolean;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  onSendMessage,
  onTokenClick,
  isLoading = false,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track if user is at bottom
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive (if user is at bottom)
  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-[#080808]">
      {/* Messages area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <WelcomeMessage />
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onTokenClick={onTokenClick}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <ChatInput onSend={onSendMessage} disabled={isLoading} />
    </div>
  );
};

// Welcome message shown when chat is empty
const WelcomeMessage: React.FC = () => (
  <div className="h-full flex flex-col items-center justify-center text-center px-8">
    {/* Argus Logo */}
    <div className="w-20 h-20 mb-6 rounded-full bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] border border-[#252525] flex items-center justify-center shadow-xl">
      <svg
        className="w-10 h-10 text-red-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    </div>

    <h2 className="text-xl font-bold text-[#fafafa] mb-2">Welcome to Argus</h2>
    <p className="text-sm text-[#777] max-w-md mb-6">
      I'm monitoring Solana for opportunities and risks. Ask me anything about tokens,
      or I'll alert you when I discover something interesting.
    </p>

    {/* Example prompts */}
    <div className="flex flex-wrap gap-2 justify-center max-w-lg">
      <ExamplePrompt text="What's trending right now?" />
      <ExamplePrompt text="Analyze a token" />
      <ExamplePrompt text="Show my positions" />
      <ExamplePrompt text="What scams have you detected?" />
    </div>

    <div className="mt-8 flex items-center gap-4 text-[0.7rem] text-[#444]">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
        SCOUT ACTIVE
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
        ANALYST READY
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
        HUNTER READY
      </span>
    </div>
  </div>
);

const ExamplePrompt: React.FC<{ text: string }> = ({ text }) => (
  <button className="px-3 py-1.5 bg-[#111] border border-[#222] rounded-full text-[0.75rem] text-[#888] hover:text-[#bbb] hover:border-[#333] transition-colors">
    {text}
  </button>
);

export default ChatContainer;
