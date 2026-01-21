import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

export type UserTier = 'free' | 'holder' | 'pro';

interface AuthContextType {
  tier: UserTier;
  tokenBalance: number;
  isSubscribed: boolean;
  isLoading: boolean;
  scansToday: number;
  maxScans: number;
  canScan: boolean;
  incrementScan: () => void;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Token requirements
const HOLDER_THRESHOLD = 1000;
const PRO_THRESHOLD = 10000;
const FREE_DAILY_SCANS = 3;

// API base URL
const API_URL = import.meta.env.VITE_API_URL || 'https://api.argusguard.io';

function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected } = useWallet();

  const [tokenBalance, setTokenBalance] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [scansToday, setScansToday] = useState(0);

  // Load scan count from localStorage
  useEffect(() => {
    const today = new Date().toDateString();
    const stored = localStorage.getItem('argus_scans');
    if (stored) {
      const { date, count } = JSON.parse(stored);
      if (date === today) {
        setScansToday(count);
      } else {
        localStorage.setItem('argus_scans', JSON.stringify({ date: today, count: 0 }));
        setScansToday(0);
      }
    }
  }, []);

  // Check auth status when wallet connects
  const refreshAuth = async () => {
    if (!publicKey) {
      setTokenBalance(0);
      setIsSubscribed(false);
      return;
    }

    setIsLoading(true);
    const walletAddress = publicKey.toBase58();
    console.log('[Auth] Checking status for wallet:', walletAddress);

    try {
      const url = `${API_URL}/auth/status?wallet=${walletAddress}`;
      console.log('[Auth] Fetching:', url);
      const response = await fetch(url);
      console.log('[Auth] Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('[Auth] Response data:', data);
        setTokenBalance(data.tokenBalance || 0);
        setIsSubscribed(data.isSubscribed === true);
        console.log('[Auth] Set isSubscribed to:', data.isSubscribed === true);
      } else {
        console.error('[Auth] Response not OK:', await response.text());
      }
    } catch (error) {
      console.error('[Auth] Failed to check auth status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (connected && publicKey) {
      console.log('[Auth] Wallet connected, refreshing auth...');
      refreshAuth();
    } else {
      console.log('[Auth] Wallet disconnected, resetting state');
      setTokenBalance(0);
      setIsSubscribed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()]);

  // Calculate tier
  const tier: UserTier = useMemo(() => {
    let calculatedTier: UserTier = 'free';
    if (isSubscribed || tokenBalance >= PRO_THRESHOLD) {
      calculatedTier = 'pro';
    } else if (tokenBalance >= HOLDER_THRESHOLD) {
      calculatedTier = 'holder';
    }
    console.log('[Auth] Tier calculation:', { isSubscribed, tokenBalance, calculatedTier });
    return calculatedTier;
  }, [tokenBalance, isSubscribed]);

  // Max scans based on tier
  const maxScans = tier === 'free' ? FREE_DAILY_SCANS : Infinity;
  const canScan = tier !== 'free' || scansToday < FREE_DAILY_SCANS;

  const incrementScan = () => {
    if (tier === 'free') {
      const newCount = scansToday + 1;
      setScansToday(newCount);
      const today = new Date().toDateString();
      localStorage.setItem('argus_scans', JSON.stringify({ date: today, count: newCount }));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        tier,
        tokenBalance,
        isSubscribed,
        isLoading,
        scansToday,
        maxScans,
        canScan,
        incrementScan,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => clusterApiUrl('mainnet-beta'), []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
