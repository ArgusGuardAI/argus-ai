import { useState } from 'react';
import { useWhaleshieldWallet } from '~/hooks/useWhaleshieldWallet';
import { WHALESHIELD_TOKEN } from '@whaleshield/shared';
import { createCheckoutSession, createPortalSession } from '~/lib/api';
import '~/styles/globals.css';

function Popup() {
  const wallet = useWhaleshieldWallet();
  const isTestMode = WHALESHIELD_TOKEN.mint === 'TBD_AFTER_LAUNCH';
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isManaging, setIsManaging] = useState(false);

  const handleSubscribe = async () => {
    if (!wallet.address) return;
    setIsSubscribing(true);
    try {
      const session = await createCheckoutSession(wallet.address);
      if (session?.checkoutUrl) {
        window.open(session.checkoutUrl, '_blank');
      }
    } catch (error) {
      console.error('Failed to create checkout:', error);
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!wallet.address) return;
    setIsManaging(true);
    try {
      const session = await createPortalSession(wallet.address);
      if (session?.portalUrl) {
        window.open(session.portalUrl, '_blank');
      }
    } catch (error) {
      console.error('Failed to open portal:', error);
    } finally {
      setIsManaging(false);
    }
  };

  return (
    <div
      className="w-80"
      style={{
        background: 'linear-gradient(180deg, #030308 0%, #0a0a12 100%)',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Header */}
      <div
        className="p-4 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.05) 0%, transparent 100%)',
          borderBottom: '1px solid rgba(0, 212, 255, 0.1)',
        }}
      >
        {/* Tech grid background */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px)
            `,
            backgroundSize: '20px 20px',
          }}
        />

        <div className="relative flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.15) 0%, rgba(0, 136, 204, 0.1) 100%)',
              border: '1px solid rgba(0, 212, 255, 0.2)',
              boxShadow: '0 0 20px rgba(0, 212, 255, 0.15)',
            }}
          >
            <span className="text-2xl">🐋</span>
          </div>
          <div>
            <h1
              className="text-base font-bold tracking-wider"
              style={{
                fontFamily: "'Orbitron', monospace",
                background: 'linear-gradient(135deg, #00d4ff 0%, #00ff88 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              WHALESHIELD
            </h1>
            <p className="text-[10px] text-gray-500 tracking-wide" style={{ fontFamily: "'Orbitron', monospace" }}>
              AI SECURITY LAYER
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {!wallet.connected ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-400 leading-relaxed">
              Connect your wallet to activate <span className="text-cyan-400">WhaleShield</span> protection.
            </p>
            <button
              onClick={wallet.connect}
              disabled={wallet.connecting}
              className="w-full py-3 px-4 rounded-lg text-sm font-bold tracking-wider transition-all"
              style={{
                fontFamily: "'Orbitron', monospace",
                background: wallet.connecting
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
                color: wallet.connecting ? '#6b7280' : '#000',
                boxShadow: wallet.connecting ? 'none' : '0 0 30px rgba(0, 212, 255, 0.3)',
                cursor: wallet.connecting ? 'not-allowed' : 'pointer',
              }}
            >
              {wallet.connecting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">◐</span>
                  CONNECTING...
                </span>
              ) : (
                'CONNECT PHANTOM'
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Wallet Info */}
            <div
              className="rounded-xl p-3"
              style={{
                background: 'linear-gradient(135deg, rgba(10, 10, 18, 0.8) 0%, rgba(3, 3, 8, 0.9) 100%)',
                border: '1px solid rgba(0, 212, 255, 0.15)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: '#00ff88', boxShadow: '0 0 8px #00ff88' }}
                  />
                  <span className="text-[10px] text-green-400" style={{ fontFamily: "'Orbitron', monospace" }}>
                    CONNECTED
                  </span>
                </div>
                <button
                  onClick={wallet.disconnect}
                  className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                  style={{ fontFamily: "'Orbitron', monospace" }}
                >
                  DISCONNECT
                </button>
              </div>
              <p className="text-sm font-mono text-gray-300 truncate">
                {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-6)}
              </p>
              {wallet.balance !== null && (
                <p className="text-[10px] text-gray-500 mt-1 font-mono">
                  {wallet.balance.toFixed(4)} SOL
                </p>
              )}
            </div>

            {/* Shield Status */}
            <div
              className="rounded-xl p-3"
              style={{
                background: wallet.isPremium || isTestMode
                  ? 'linear-gradient(135deg, rgba(0, 255, 136, 0.08) 0%, rgba(0, 200, 100, 0.05) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 204, 0, 0.08) 0%, rgba(200, 150, 0, 0.05) 100%)',
                border: `1px solid ${wallet.isPremium || isTestMode ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 204, 0, 0.3)'}`,
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                  style={{
                    background: wallet.isPremium || isTestMode
                      ? 'linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 200, 100, 0.1) 100%)'
                      : 'linear-gradient(135deg, rgba(255, 204, 0, 0.2) 0%, rgba(200, 150, 0, 0.1) 100%)',
                  }}
                >
                  {wallet.isPremium || isTestMode ? '🛡️' : '🔒'}
                </div>
                <div>
                  <p
                    className="text-sm font-bold"
                    style={{
                      fontFamily: "'Orbitron', monospace",
                      color: wallet.isPremium || isTestMode ? '#00ff88' : '#ffcc00',
                    }}
                  >
                    {wallet.isPremium || isTestMode ? 'SHIELD ACTIVE' : 'SHIELD LOCKED'}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {isTestMode
                      ? 'Test Mode'
                      : wallet.isSubscribed
                      ? 'Premium Subscriber'
                      : wallet.hasTokens
                      ? 'Token Holder'
                      : `${wallet.whaleshieldBalance.toLocaleString()} / ${WHALESHIELD_TOKEN.requiredBalance.toLocaleString()} tokens`}
                  </p>
                </div>
              </div>

              {/* Subscription Management Button (if subscribed) */}
              {wallet.isSubscribed && !isTestMode && (
                <button
                  onClick={handleManageSubscription}
                  disabled={isManaging}
                  className="w-full text-center py-2 rounded-lg text-[10px] font-bold transition-all"
                  style={{
                    fontFamily: "'Orbitron', monospace",
                    background: 'rgba(0, 255, 136, 0.1)',
                    border: '1px solid rgba(0, 255, 136, 0.3)',
                    color: '#00ff88',
                    cursor: isManaging ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isManaging ? 'LOADING...' : 'MANAGE SUBSCRIPTION'}
                </button>
              )}

              {/* Unlock Options (if not premium) */}
              {!wallet.isPremium && !isTestMode && (
                <div className="space-y-2">
                  <button
                    onClick={handleSubscribe}
                    disabled={isSubscribing}
                    className="w-full text-center py-2.5 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      fontFamily: "'Orbitron', monospace",
                      background: isSubscribing
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
                      color: isSubscribing ? '#6b7280' : '#000',
                      boxShadow: isSubscribing ? 'none' : '0 0 20px rgba(0, 212, 255, 0.2)',
                      cursor: isSubscribing ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSubscribing ? 'LOADING...' : 'SUBSCRIBE $19.99/MO'}
                  </button>
                  <div className="flex items-center gap-2 justify-center">
                    <span className="text-[9px] text-gray-600">or</span>
                  </div>
                  <a
                    href="https://pump.fun"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-2 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      fontFamily: "'Orbitron', monospace",
                      background: 'rgba(0, 212, 255, 0.1)',
                      border: '1px solid rgba(0, 212, 255, 0.3)',
                      color: '#00d4ff',
                    }}
                  >
                    HOLD 1K $WHALESHIELD →
                  </a>
                </div>
              )}
            </div>

            {/* Features */}
            <div className="space-y-2">
              <h3
                className="text-[10px] text-gray-500 mb-2 tracking-wider"
                style={{ fontFamily: "'Orbitron', monospace" }}
              >
                PROTECTION MODULES
              </h3>
              <FeatureRow
                enabled={wallet.isPremium || isTestMode}
                label="AI Honeypot Detection"
                icon="🔍"
              />
              <FeatureRow
                enabled={wallet.isPremium || isTestMode}
                label="Community Graffiti"
                icon="🎨"
              />
              <FeatureRow
                enabled={wallet.isPremium || isTestMode}
                label="Deployer Intel"
                icon="👤"
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-3"
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'rgba(0, 0, 0, 0.2)',
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[9px] text-gray-600" style={{ fontFamily: "'Orbitron', monospace" }}>
            TOGETHER AI
          </p>
          <p className="text-[9px] text-gray-700 font-mono">v1.0.0</p>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ enabled, label, icon }: { enabled: boolean; label: string; icon: string }) {
  return (
    <div
      className="flex items-center gap-3 p-2 rounded-lg transition-all"
      style={{
        background: enabled ? 'rgba(0, 212, 255, 0.05)' : 'transparent',
        border: `1px solid ${enabled ? 'rgba(0, 212, 255, 0.1)' : 'transparent'}`,
      }}
    >
      <span className="text-sm">{icon}</span>
      <span className={`text-xs ${enabled ? 'text-gray-300' : 'text-gray-600'}`}>{label}</span>
      <span
        className="ml-auto w-2 h-2 rounded-full"
        style={{
          background: enabled ? '#00ff88' : '#4a5568',
          boxShadow: enabled ? '0 0 8px #00ff88' : 'none',
        }}
      />
    </div>
  );
}

export default Popup;
