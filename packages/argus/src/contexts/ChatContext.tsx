/**
 * ChatContext - Global chat state provider
 *
 * Provides chat state and methods to all components in the tree.
 */

import React, { createContext, useContext, type ReactNode } from 'react';
import { useChat, type UseChatReturn } from '../hooks/useChat';
import type { ChatMessageData } from '../components/chat/ChatMessage';

interface ChatContextValue extends UseChatReturn {
  // Additional context methods can be added here
}

const ChatContext = createContext<ChatContextValue | null>(null);

interface ChatProviderProps {
  children: ReactNode;
  enabled?: boolean;
  integrateDiscoveries?: boolean;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  enabled = true,
  integrateDiscoveries = true,
}) => {
  const chat = useChat({ enabled, integrateDiscoveries });

  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
};

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}

// Re-export types for convenience
export type { ChatMessageData };
