/**
 * useChat Hook
 *
 * Manages chat state, message history, and communication with the chat API.
 * Integrates with agent discoveries to show them as chat messages.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDiscoveries } from './useDiscoveries';
import type { ChatMessageData, MessageType } from '../components/chat/ChatMessage';

interface UseChatOptions {
  enabled?: boolean;
  maxMessages?: number;
  integrateDiscoveries?: boolean;
}

export interface UseChatReturn {
  messages: ChatMessageData[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  addSystemMessage: (content: string) => void;
  clearMessages: () => void;
}

const getApiBaseUrl = (): string => {
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:8787';
  }
  return 'https://argus-workers.anthropic.workers.dev';
};

// Generate unique message ID
const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const { enabled = true, maxMessages = 100, integrateDiscoveries = true } = options;

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenDiscoveryIdsRef = useRef<Set<string>>(new Set());

  // Get discoveries to integrate into chat
  const { discoveries } = useDiscoveries({ enabled: enabled && integrateDiscoveries });

  // Add a message to the chat
  const addMessage = useCallback(
    (type: MessageType, content: string, metadata?: ChatMessageData['metadata']) => {
      const newMessage: ChatMessageData = {
        id: generateId(),
        timestamp: Date.now(),
        type,
        content,
        metadata,
      };

      setMessages((prev) => {
        const updated = [...prev, newMessage];
        return updated.slice(-maxMessages);
      });

      return newMessage.id;
    },
    [maxMessages]
  );

  // Add system message
  const addSystemMessage = useCallback(
    (content: string) => {
      addMessage('system', content);
    },
    [addMessage]
  );

  // Send a user message and get Argus response
  const sendMessage = useCallback(
    async (content: string) => {
      if (!enabled || isLoading) return;

      // Add user message
      addMessage('user', content);

      // Add loading placeholder for Argus
      const loadingId = generateId();
      setMessages((prev) => [
        ...prev,
        {
          id: loadingId,
          timestamp: Date.now(),
          type: 'argus',
          content: '',
          isLoading: true,
        },
      ]);

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${getApiBaseUrl()}/chat/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content }),
        });

        if (!response.ok) {
          throw new Error(`Chat API error: ${response.status}`);
        }

        const data = await response.json();

        // Replace loading message with actual response
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === loadingId
              ? {
                  ...msg,
                  content: data.response || 'I apologize, I could not process that request.',
                  isLoading: false,
                  metadata: data.analysis
                    ? {
                        analysis: {
                          score: data.analysis.score,
                          verdict: data.analysis.verdict,
                          summary: data.analysis.summary,
                        },
                        tokenAddress: data.tokenAddress,
                        tokenSymbol: data.tokenSymbol,
                      }
                    : undefined,
                }
              : msg
          )
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);

        // Replace loading message with error
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === loadingId
              ? {
                  ...msg,
                  content: `I encountered an error: ${errorMessage}. Please try again.`,
                  isLoading: false,
                }
              : msg
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [enabled, isLoading, addMessage]
  );

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([]);
    seenDiscoveryIdsRef.current.clear();
  }, []);

  // Integrate discoveries as chat messages
  useEffect(() => {
    if (!integrateDiscoveries || discoveries.length === 0) return;

    // Find new discoveries we haven't shown yet
    const newDiscoveries = discoveries.filter(
      (d) => !seenDiscoveryIdsRef.current.has(d.id)
    );

    if (newDiscoveries.length > 0) {
      // Only show the most recent new discovery to avoid spam
      const latest = newDiscoveries[0];
      seenDiscoveryIdsRef.current.add(latest.id);

      // Format discovery as chat message
      const verdictEmoji =
        latest.analysis.verdict === 'SAFE'
          ? ''
          : latest.analysis.verdict === 'SUSPICIOUS'
          ? ''
          : '';

      const content = `${verdictEmoji} New token detected: ${latest.tokenInfo.symbol || 'Unknown'}\n` +
        `Score: ${100 - latest.analysis.score}/100 | ` +
        `${latest.analysis.summary}`;

      addMessage('discovery', content, {
        tokenAddress: latest.token,
        tokenSymbol: latest.tokenInfo.symbol || undefined,
      });
    }
  }, [discoveries, integrateDiscoveries, addMessage]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    addSystemMessage,
    clearMessages,
  };
}

export default useChat;
