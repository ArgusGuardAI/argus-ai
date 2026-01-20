import { Shield, Wifi, WifiOff } from 'lucide-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

interface HeaderProps {
  connected: boolean;
}

export function Header({ connected }: HeaderProps) {

  return (
    <header className="border-b border-cyber-blue/20 bg-dark-900/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyber-blue/20 to-cyber-purple/10 flex items-center justify-center cyber-border glow-pulse">
            <Shield className="w-7 h-7 text-cyber-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-cyber font-bold gradient-text">ArgusGuard Sniper</h1>
            <p className="text-xs text-gray-500">AI-Powered Smart Sniping</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Server Connection Status */}
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
              connected
                ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                : 'bg-red-500/10 text-red-400 border border-red-500/30'
            }`}
          >
            {connected ? (
              <>
                <Wifi className="w-4 h-4" />
                <span>Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4" />
                <span>Disconnected</span>
              </>
            )}
          </div>

          {/* Wallet Connect Button */}
          <div className="wallet-adapter-button-wrapper">
            <WalletMultiButton />
          </div>
        </div>
      </div>
    </header>
  );
}
