import { useState, useEffect, useCallback } from 'react';
import { WHALESHIELD_TOKEN } from '@argusguard/shared';
import {
  getStoredWallet,
  setStoredWallet,
  clearStoredWallet,
  setPremiumStatus,
} from '~/lib/storage';
import { getSubscriptionStatus } from '~/lib/api';

export interface WhaleshieldWallet {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  balance: number | null;
  whaleshieldBalance: number;
  isPremium: boolean;
  isSubscribed: boolean;
  hasTokens: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  signMessage: (message: string) => Promise<string | null>;
}

// Helper to send messages to the wallet bridge and wait for response
function sendWalletRequest(action: string, payload?: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).substring(7);

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'WHALESHIELD_WALLET_RESPONSE') return;
      if (event.data?.id !== id) return;

      window.removeEventListener('message', handler);
      resolve(event.data);
    };

    window.addEventListener('message', handler);

    // Timeout after 30 seconds
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ success: false, error: 'Request timed out' });
    }, 30000);

    window.postMessage({
      type: 'WHALESHIELD_WALLET_REQUEST',
      action,
      id,
      payload,
    }, '*');
  });
}

export function useWhaleshieldWallet(): WhaleshieldWallet {
  const [address, setAddress] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [whaleshieldBalance, setWhaleshieldBalance] = useState(0);
  const [isPremium, setIsPremium] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [hasTokens, setHasTokens] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);

  // Wait for wallet bridge to be ready
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'WHALESHIELD_WALLET_BRIDGE_READY') {
        setBridgeReady(true);
      }
    };

    window.addEventListener('message', handler);

    // Check if bridge is already ready
    sendWalletRequest('getAddress').then((response) => {
      if (response.success) {
        setBridgeReady(true);
        const data = response.data as { address: string | null; isConnected: boolean };
        if (data.isConnected && data.address) {
          setAddress(data.address);
          setConnected(true);
        }
      }
    });

    return () => window.removeEventListener('message', handler);
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!address) return;

    // For now, grant premium in test mode
    const isTestMode = WHALESHIELD_TOKEN.mint === 'TBD_AFTER_LAUNCH';
    if (isTestMode) {
      setWhaleshieldBalance(0);
      setHasTokens(false);
      setIsSubscribed(false);
      setIsPremium(true);
      await setPremiumStatus(true);
      return;
    }

    try {
      // Check subscription status
      const subscription = await getSubscriptionStatus(address);
      const subscribed = subscription.subscribed;
      setIsSubscribed(subscribed);

      // TODO: Implement actual token balance fetching via API
      // For production, we'd call an API endpoint that checks the token balance
      const tokenBalance = 0; // Replace with actual balance check
      setWhaleshieldBalance(tokenBalance);
      const hasEnoughTokens = tokenBalance >= WHALESHIELD_TOKEN.requiredBalance;
      setHasTokens(hasEnoughTokens);

      // Premium if they have tokens OR have active subscription
      const premium = hasEnoughTokens || subscribed;
      setIsPremium(premium);
      await setPremiumStatus(premium);
    } catch (error) {
      console.error('Failed to refresh balances:', error);
    }
  }, [address]);

  const connect = useCallback(async () => {
    if (!bridgeReady) {
      console.warn('Wallet bridge not ready');
      return;
    }

    setConnecting(true);

    try {
      const response = await sendWalletRequest('connect');

      if (response.success && response.data) {
        const data = response.data as { address: string };
        setAddress(data.address);
        setConnected(true);

        await setStoredWallet({
          address: data.address,
          connectedAt: Date.now(),
        });
      } else if (response.error === 'Phantom wallet not found') {
        window.open('https://phantom.app/', '_blank');
      } else {
        console.error('Failed to connect:', response.error);
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    } finally {
      setConnecting(false);
    }
  }, [bridgeReady]);

  const disconnect = useCallback(async () => {
    await sendWalletRequest('disconnect');

    setAddress(null);
    setConnected(false);
    setBalance(null);
    setWhaleshieldBalance(0);
    setIsPremium(false);
    setIsSubscribed(false);
    setHasTokens(false);

    await clearStoredWallet();
    await setPremiumStatus(false);
  }, []);

  const signMessage = useCallback(
    async (message: string): Promise<string | null> => {
      if (!connected || !bridgeReady) {
        return null;
      }

      try {
        const response = await sendWalletRequest('signMessage', message);

        if (response.success && response.data) {
          const data = response.data as { signature: string };
          return data.signature;
        }

        console.error('Failed to sign message:', response.error);
        return null;
      } catch (error) {
        console.error('Failed to sign message:', error);
        return null;
      }
    },
    [connected, bridgeReady]
  );

  // Restore wallet on mount
  useEffect(() => {
    async function restore() {
      const stored = await getStoredWallet();
      if (stored && bridgeReady) {
        // Check if still connected
        const response = await sendWalletRequest('getAddress');
        if (response.success) {
          const data = response.data as { address: string | null; isConnected: boolean };
          if (data.isConnected && data.address === stored.address) {
            setAddress(data.address);
            setConnected(true);
          } else {
            await clearStoredWallet();
          }
        }
      }
    }

    if (bridgeReady) {
      restore();
    }
  }, [bridgeReady]);

  // Refresh balances when connected
  useEffect(() => {
    if (connected && address) {
      refreshBalances();
    }
  }, [connected, address, refreshBalances]);

  return {
    address,
    connected,
    connecting,
    balance,
    whaleshieldBalance,
    isPremium,
    isSubscribed,
    hasTokens,
    connect,
    disconnect,
    refreshBalances,
    signMessage,
  };
}
