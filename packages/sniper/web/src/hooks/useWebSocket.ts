import { useEffect, useRef, useCallback, useState } from 'react';

interface UseWebSocketOptions {
  url: string;
  onMessage: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useWebSocket({ url, onMessage, onConnect, onDisconnect }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const [isConnected, setIsConnected] = useState(false);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (connectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    connectingRef.current = true;

    try {
      console.log('[WS] Connecting to', url);
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[WS] Connected');
        connectingRef.current = false;
        if (mountedRef.current) {
          setIsConnected(true);
          onConnect?.();
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (mountedRef.current) {
            onMessage(data);
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        connectingRef.current = false;
        if (mountedRef.current) {
          setIsConnected(false);
          onDisconnect?.();

          // Reconnect after 5 seconds (longer delay)
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = window.setTimeout(() => {
            if (mountedRef.current) {
              console.log('[WS] Reconnecting...');
              connect();
            }
          }, 5000);
        }
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        connectingRef.current = false;
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[WS] Connection failed:', err);
      connectingRef.current = false;
    }
  }, [url, onMessage, onConnect, onDisconnect]);

  const sendMessage = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('[WS] Not connected, cannot send message');
    }
  }, []);

  const disconnect = useCallback(() => {
    mountedRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent reconnect on intentional close
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      disconnect();
    };
  }, []); // Empty deps - only run once on mount

  return { isConnected, sendMessage, disconnect };
}
