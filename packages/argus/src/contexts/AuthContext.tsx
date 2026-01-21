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
    try {
      const response = await fetch(`${API_URL}/auth/status?wallet=${publicKey.toBase58()}`);
      if (response.ok) {
        const data = await response.json();
        setTokenBalance(data.tokenBalance || 0);
        setIsSubscribed(data.isSubscribed || false);
      }
    } catch (error) {
      console.error('Failed to check auth status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (connected && publicKey) {
      refreshAuth();
    } else {
      setTokenBalance(0);
      setIsSubscribed(false);
    }
  }, [connected, publicKey]);

  // Calculate tier
  const tier: UserTier = useMemo(() => {
    if (isSubscribed || tokenBalance >= PRO_THRESHOLD) return 'pro';
    if (tokenBalance >= HOLDER_THRESHOLD) return 'holder';
    return 'free';
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
