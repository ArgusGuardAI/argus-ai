/**
 * ARGUS TERMINAL v3 — Pure Observability
 *
 * The feed IS the dashboard. Everything else gets out of the way.
 *
 * Layout:
 *   HEADER (36px)  → Brand dot, agent status dots, connection, gear icon
 *   FEED   (100%)  → AGIActivityFeed — council decisions + agent events
 *   STATS  (float) → Tiny floating overlay: scan count, verdict breakdown
 *   DRAWER (hidden) → Slide-out config: auto-trade, wallet, positions
 *
 * Wallet loaded from .env only. No generation UI.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type FC,
} from 'react';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { useDiscoveries, DiscoveryResult } from '../../hooks/useDiscoveries';
import { useAutoTrade } from '../../hooks/useAutoTrade';
import { AGICouncil } from './AGICouncil';
import { CouncilDecision, AgentVote } from './CouncilDecisionCard';


// ═══════════════════════════════════════════════════════════════
// BUSINESS LOGIC — pure, outside component
// ═══════════════════════════════════════════════════════════════

function generateVotes(d: DiscoveryResult): AgentVote[] {
  const risk = d.analysis?.score ?? 50;
  const bundle = d.bundles?.detected;
  const top10 = d.holders?.top10Concentration || 0;
  const liq = (d.market as Record<string, unknown>)?.liquiditySol as number ?? 0;
  const grad = d.lp?.burned === true;
  const holders = d.holders?.total || 0;

  return [
    {
      agent: 'scout' as const,
      vote: liq >= 10 ? 'yes' : liq >= 3 ? 'abstain' : 'no',
      reason: liq >= 10 ? `${liq.toFixed(0)} SOL liq` : liq >= 3 ? 'Low liq' : 'No liq',
      confidence: Math.min(100, liq * 5),
    },
    {
      agent: 'analyst' as const,
      vote: risk < 40 ? 'yes' : risk < 60 ? 'abstain' : 'no',
      reason: risk < 40 ? `Score ${risk} OK` : risk < 60 ? `Score ${risk} caution` : `Score ${risk} HIGH`,
      confidence: 100 - risk,
    },
    {
      agent: 'hunter' as const,
      vote: bundle ? 'no' : top10 > 90 ? 'no' : 'yes',
      reason: bundle
        ? `Bundle: ${d.bundles?.count}w ${d.bundles?.controlPercent?.toFixed(0)}%`
        : top10 > 90 ? `Concentrated ${top10.toFixed(0)}%` : 'Clean',
      confidence: bundle ? 95 : 70,
    },
    {
      agent: 'trader' as const,
      vote: (grad || liq > 50 || holders > 30) ? 'yes' : (liq > 10 && risk < 50) ? 'yes' : 'abstain',
      reason: grad ? 'Graduated' : liq > 50 ? 'High liq' : holders > 30 ? `${holders} holders` : 'Waiting',
      confidence: grad ? 85 : liq > 50 ? 75 : 50,
    },
  ];
}

function processDiscovery(d: DiscoveryResult): CouncilDecision {
  const votes = generateVotes(d);
  const yes = votes.filter(v => v.vote === 'yes').length;
  const dangerous = d.bundles?.detected || (d.analysis?.score ?? 50) >= 70;
  return {
    id: `council-${d.id}`,
    timestamp: new Date(d.timestamp).getTime(),
    tokenAddress: d.token,
    tokenSymbol: d.tokenInfo?.symbol || undefined,
    votes,
    verdict: dangerous ? 'DANGEROUS' : yes >= 3 ? 'BUY' : 'SKIP',
    unanimousYes: yes === 4,
    score: d.analysis?.score,
  };
}


// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500&display=swap');

  :root {
    --bg:   #040405;
    --srf:  #09090b;
    --brd:  #131518;
    --brd2: #1c1f24;
    --tx:   #a8acb8;
    --txd:  #464a56;
    --txg:  #252830;
    --grn:  #00e040;
    --grnd: #00e04018;
    --red:  #ff2840;
    --redd: #ff284014;
    --amb:  #f0a820;
    --cyn:  #00c8f0;
  }

  /* CRT */
  .crt::after {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:9999;
    background: repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.02) 2px,rgba(0,0,0,0.02) 4px);
  }
  .crt::before {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:9998; opacity:0.01;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  @keyframes glow { 0%,100%{box-shadow:0 0 4px var(--grnd)} 50%{box-shadow:0 0 14px var(--grn),0 0 28px var(--grnd)} }
  @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
  @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  @keyframes drawer-in { from{transform:translateX(100%)} to{transform:translateX(0)} }
  @keyframes drawer-out { from{transform:translateX(0)} to{transform:translateX(100%)} }
  @keyframes fade { from{opacity:0} to{opacity:1} }
  @keyframes count-pop { 0%{transform:scale(1)} 50%{transform:scale(1.15)} 100%{transform:scale(1)} }

  .drawer-in  { animation: drawer-in .2s ease-out both }
  .drawer-out { animation: drawer-out .15s ease-in both }

  /* Scrollbar */
  .tscr::-webkit-scrollbar { width:2px }
  .tscr::-webkit-scrollbar-track { background:transparent }
  .tscr::-webkit-scrollbar-thumb { background:var(--brd2); border-radius:2px }

  /* Toggle */
  .sw { position:relative; width:28px; height:14px; border-radius:7px; cursor:pointer; transition:all .15s }
  .sw.on { background:var(--grnd) }
  .sw.off { background:var(--brd) }
  .sw-k { position:absolute; top:2px; width:10px; height:10px; border-radius:50%; transition:all .15s }
  .sw.on .sw-k { left:16px; background:var(--grn); box-shadow:0 0 4px var(--grn) }
  .sw.off .sw-k { left:2px; background:var(--txd) }

  /* Input */
  .cin {
    width:48px; text-align:right; font-size:10px; padding:2px 5px;
    border-radius:2px; outline:none; background:var(--bg);
    border:1px solid var(--brd); color:var(--grn);
    font-family:'JetBrains Mono',monospace; transition:border .15s;
  }
  .cin:focus { border-color:var(--brd2) }

  /* Backdrop */
  .backdrop {
    position:fixed; inset:0; z-index:100;
    background:rgba(0,0,0,0.6); backdrop-filter:blur(2px);
    animation: fade .15s ease-out;
  }
`;

// Agent definitions
const AGENTS = [
  { id: 'scout',   label: 'SCT', color: 'var(--cyn)' },
  { id: 'analyst', label: 'ANL', color: 'var(--amb)' },
  { id: 'hunter',  label: 'HNT', color: 'var(--red)' },
  { id: 'trader',  label: 'TRD', color: 'var(--grn)' },
];


// ═══════════════════════════════════════════════════════════════
// FLOATING STATS OVERLAY (bottom-left)
// ═══════════════════════════════════════════════════════════════

const StatsOverlay: FC<{
  buys: number;
  dangers: number;
  pnl: number;
  armed: boolean;
}> = ({ buys, dangers, pnl, armed }) => (
  <div style={{
    position: 'absolute', bottom: 12, left: 12, zIndex: 50,
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '5px 12px', borderRadius: 4,
    background: 'rgba(4,4,5,0.85)', border: '1px solid var(--brd)',
    backdropFilter: 'blur(8px)',
    fontFamily: 'IBM Plex Mono, monospace', fontSize: 9,
    letterSpacing: '0.08em', color: 'var(--txd)',
  }}>
    <span style={{ color: 'var(--amb)', fontWeight: 600 }}>PAPER</span>
    <span style={{ color: 'var(--txg)' }}>·</span>
    <span>BUYS <span style={{ color: 'var(--grn)', fontFamily: 'JetBrains Mono' }}>{buys}</span></span>
    <span style={{ color: 'var(--txg)' }}>·</span>
    <span>FLAG <span style={{ color: dangers > 0 ? 'var(--red)' : 'var(--txd)', fontFamily: 'JetBrains Mono' }}>{dangers}</span></span>
    <span style={{ color: 'var(--txg)' }}>·</span>
    <span>P&L <span style={{
      color: pnl >= 0 ? 'var(--grn)' : 'var(--red)',
      fontFamily: 'JetBrains Mono',
    }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(3)}</span></span>
    <span style={{ color: 'var(--txg)' }}>·</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        width: 4, height: 4, borderRadius: '50%',
        background: armed ? 'var(--grn)' : 'var(--txg)',
        boxShadow: armed ? '0 0 4px var(--grn)' : 'none',
      }} />
      <span style={{ color: armed ? 'var(--grn)' : 'var(--txg)' }}>
        {armed ? 'ARMED' : 'MANUAL'}
      </span>
    </span>
  </div>
);


// ═══════════════════════════════════════════════════════════════
// CONFIG DRAWER (slides out from right)
// ═══════════════════════════════════════════════════════════════

const ConfigDrawer: FC<{
  open: boolean;
  onClose: () => void;
  at: ReturnType<typeof useAutoTrade>;
  onSettingsClick?: () => void;
}> = ({ open, onClose, at, onSettingsClick }) => {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 150);
  }, [onClose]);

  if (!open && !closing) return null;

  const pos = at.state.positions;
  const sold = at.state.soldPositions;
  const wins = sold.filter(p => (p.pnlPercent || 0) > 0).length;

  return (
    <>
      {/* Backdrop */}
      <div className="backdrop" onClick={handleClose} />

      {/* Drawer */}
      <div className={closing ? 'drawer-out' : 'drawer-in'} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 280, zIndex: 101,
        background: 'var(--srf)', borderLeft: '1px solid var(--brd)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'JetBrains Mono, monospace',
      }}>

        {/* Drawer header */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--brd)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: 9, fontWeight: 600, letterSpacing: '0.2em', color: 'var(--txd)',
            fontFamily: 'IBM Plex Mono, monospace',
          }}>CONFIGURATION</span>
          <button onClick={handleClose} style={{
            background: 'none', border: 'none', color: 'var(--txd)', cursor: 'pointer',
            fontSize: 14, lineHeight: 1, padding: '2px 4px',
          }}>✕</button>
        </div>

        {/* Drawer body */}
        <div className="tscr" style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Auto-Trade */}
          <div>
            <div style={{
              fontSize: 8, fontWeight: 600, letterSpacing: '0.2em', color: 'var(--txd)',
              fontFamily: 'IBM Plex Mono, monospace', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 3, height: 10, borderRadius: 1, background: 'var(--grn)' }} />
              AUTO-TRADE
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{
                fontSize: 10, color: at.config.enabled ? 'var(--grn)' : 'var(--txd)',
                fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.1em',
              }}>
                {at.config.enabled ? '● ARMED' : '○ DISARMED'}
              </span>
              <div className={`sw ${at.config.enabled ? 'on' : 'off'}`} onClick={at.toggleEnabled}>
                <div className="sw-k" />
              </div>
            </div>

            {[
              { label: 'BUY SIZE', val: at.config.buyAmountSol, key: 'buyAmountSol', suf: 'SOL', step: 0.1, min: 0.01, c: 'var(--grn)' },
              { label: 'TAKE PROFIT', val: at.config.takeProfitPercent, key: 'takeProfitPercent', suf: '%', int: true, c: 'var(--grn)' },
              { label: 'STOP LOSS', val: at.config.stopLossPercent, key: 'stopLossPercent', suf: '%', int: true, c: 'var(--red)' },
            ].map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0' }}>
                <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--txd)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {f.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    className="cin"
                    value={f.val}
                    step={f.step || 1}
                    min={f.min || 0}
                    style={{ color: f.c }}
                    onChange={e => {
                      const v = f.int ? parseInt(e.target.value) : parseFloat(e.target.value);
                      if (!isNaN(v)) at.updateConfig({ [f.key]: v });
                    }}
                  />
                  <span style={{ fontSize: 8, color: 'var(--txg)' }}>{f.suf}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--brd)' }} />

          {/* Wallet */}
          <div>
            <div style={{
              fontSize: 8, fontWeight: 600, letterSpacing: '0.2em', color: 'var(--txd)',
              fontFamily: 'IBM Plex Mono, monospace', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 3, height: 10, borderRadius: 1, background: 'var(--amb)' }} />
              WALLET
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
              borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--brd)',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: at.wallet.isLoaded ? 'var(--grn)' : 'var(--red)',
              }} />
              <span style={{ fontSize: 10, color: 'var(--tx)', fontFamily: 'JetBrains Mono, monospace' }}>
                {at.wallet.isLoaded ? `${at.wallet.balance.toFixed(4)} SOL` : 'Not loaded — check .env'}
              </span>
            </div>

            {onSettingsClick && at.wallet.isLoaded && (
              <button onClick={onSettingsClick} style={{
                marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 3,
                border: '1px solid var(--brd)', background: 'transparent',
                color: 'var(--txd)', fontSize: 9, letterSpacing: '0.15em', cursor: 'pointer',
                fontFamily: 'IBM Plex Mono, monospace', transition: 'all .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brd2)'; e.currentTarget.style.color = 'var(--tx)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--brd)'; e.currentTarget.style.color = 'var(--txd)' }}
              >WALLET SETTINGS</button>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--brd)' }} />

          {/* Positions */}
          <div>
            <div style={{
              fontSize: 8, fontWeight: 600, letterSpacing: '0.2em', color: 'var(--txd)',
              fontFamily: 'IBM Plex Mono, monospace', marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 3, height: 10, borderRadius: 1, background: 'var(--cyn)' }} />
                POSITIONS ({pos.length})
              </span>
              {pos.length > 1 && (
                <button onClick={at.sellAllPositions} style={{
                  fontSize: 8, padding: '2px 6px', borderRadius: 2,
                  border: '1px solid var(--redd)', color: 'var(--red)',
                  background: 'transparent', cursor: 'pointer',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}>CLOSE ALL</button>
              )}
            </div>

            {pos.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pos.map(p => {
                  const up = p.pnlPercent >= 0;
                  const c = up ? 'var(--grn)' : 'var(--red)';
                  return (
                    <div key={p.tokenAddress} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 8px', borderRadius: 3,
                      background: up ? 'var(--grnd)' : 'var(--redd)',
                      border: `1px solid ${up ? 'var(--grnd)' : 'var(--redd)'}`,
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx)' }}>{p.tokenSymbol}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: c, fontFamily: 'JetBrains Mono' }}>
                          {up ? '+' : ''}{p.pnlPercent.toFixed(1)}%
                        </span>
                        <button onClick={() => at.manualSell(p.tokenAddress)} style={{
                          fontSize: 8, padding: '1px 4px', borderRadius: 2,
                          border: '1px solid var(--redd)', color: 'var(--red)',
                          background: 'transparent', cursor: 'pointer', opacity: 0.5,
                        }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span style={{ fontSize: 9, color: 'var(--txg)', fontFamily: 'IBM Plex Mono, monospace' }}>
                No open positions
              </span>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--brd)' }} />

          {/* Trade History Summary */}
          <div>
            <div style={{
              fontSize: 8, fontWeight: 600, letterSpacing: '0.2em', color: 'var(--txd)',
              fontFamily: 'IBM Plex Mono, monospace', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 3, height: 10, borderRadius: 1, background: 'var(--txd)' }} />
              HISTORY
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { l: 'Total Trades', v: sold.length },
                { l: 'Wins', v: wins },
                { l: 'Win Rate', v: sold.length > 0 ? `${(wins / sold.length * 100).toFixed(0)}%` : '—' },
                { l: 'Net P&L', v: `${at.state.totalProfitSol >= 0 ? '+' : ''}${at.state.totalProfitSol.toFixed(3)}`,
                  c: at.state.totalProfitSol >= 0 ? 'var(--grn)' : 'var(--red)' },
              ].map(s => (
                <div key={s.l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--txg)', fontFamily: 'IBM Plex Mono, monospace' }}>
                    {s.l}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: s.c || 'var(--tx)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {s.v}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
};


// ═══════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════

interface TerminalDashboardProps {
  walletAddress?: string;
  walletBalance?: number;
  onAnalyze?: (address: string) => Promise<unknown>;
  onBuy?: (tokenAddress: string, amount: number) => Promise<void>;
  onSell?: (tokenAddress: string) => Promise<void>;
  hasPosition?: boolean;
  onSettingsClick?: () => void;
}

export const TerminalDashboard: React.FC<TerminalDashboardProps> = ({ onSettingsClick }) => {
  const [decisions, setDecisions] = useState<CouncilDecision[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  const { status, isConnected, activity } = useAgentStatus({
    enabled: true,
    activityInterval: 500,   // Poll every 500ms for fast updates
    statusInterval: 2000,    // Status every 2s
  });
  const { discoveries } = useDiscoveries({ enabled: true, interval: 1000 }); // Faster discovery polling
  const at = useAutoTrade({}, undefined, () => {});
  const atRef = useRef(at);
  atRef.current = at;

  // Process discoveries for auto-trade
  useEffect(() => {
    if (!discoveries.length) return;
    const batch: CouncilDecision[] = [];
    for (const d of discoveries) {
      if (seenRef.current.has(d.id)) continue;
      seenRef.current.add(d.id);
      const dec = processDiscovery(d);
      batch.push(dec);
      if (atRef.current.config.enabled && dec.verdict === 'BUY') {
        atRef.current.buyFromDiscovery(d);
      }
    }
    if (batch.length) setDecisions(prev => [...batch, ...prev].slice(0, 100));
  }, [discoveries]);

  // Verdicts for stats overlay
  const verdicts = useMemo(() => {
    const b = decisions.filter(d => d.verdict === 'BUY').length;
    const x = decisions.filter(d => d.verdict === 'DANGEROUS').length;
    return { b, x, total: decisions.length };
  }, [decisions]);

  // Parse paper trading P&L from activity events (BUY/SELL messages from AGI)
  const paperTradingStats = useMemo(() => {
    let totalPnl = 0;
    let buys = 0;
    let sells = 0;
    let wins = 0;

    // Parse TRADER events for BUY/SELL
    for (const event of activity) {
      if (event.agent?.toUpperCase() === 'TRADER' && event.type === 'alert') {
        const msg = event.message || '';

        // Parse BUY: "BUY $SYMBOL @ $PRICE | X.XXX SOL | reason"
        if (msg.startsWith('BUY $')) {
          buys++;
        }

        // Parse SELL: "SELL $SYMBOL | REASON | -X.X% | -X.XXXX SOL"
        // Example: "SELL $7KZmLt | RUG | -100.0% | -0.1000 SOL"
        if (msg.startsWith('SELL $')) {
          sells++;
          const pnlMatch = msg.match(/\| ([+-]?\d+\.?\d*) SOL/);
          if (pnlMatch) {
            const pnlSol = parseFloat(pnlMatch[1]);
            if (!isNaN(pnlSol)) {
              totalPnl += pnlSol;
              if (pnlSol > 0) wins++;
            }
          }
        }
      }
    }

    return { totalPnl, buys, sells, wins, winRate: sells > 0 ? (wins / sells) * 100 : 0 };
  }, [activity]);

  return (
    <div className="crt" style={{
      height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'var(--bg)', color: 'var(--tx)',
      fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
      position: 'relative',
    }}>
      <style>{CSS}</style>

      {/* ═══ HEADER — 36px. That's it. ═══ */}
      <header style={{
        height: 36, flexShrink: 0,
        background: 'var(--srf)', borderBottom: '1px solid var(--brd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px',
      }}>
        {/* Left: brand + agents */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Connection dot */}
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: isConnected ? 'var(--grn)' : 'var(--red)',
            animation: isConnected ? 'glow 2.5s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', color: '#fff' }}>
            ARGUS
          </span>

          <span style={{ color: 'var(--txg)', fontSize: 10 }}>│</span>

          {/* Agent dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {AGENTS.map(a => {
              const online = status?.agents?.some(
                ag => ag.name?.toLowerCase() === a.id && ag.status === 'active'
              ) ?? false;
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={`${a.label}: ${online ? 'online' : 'offline'}`}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: online ? a.color : 'var(--txg)',
                    boxShadow: online ? `0 0 5px ${a.color}` : 'none',
                    transition: 'all .3s',
                  }} />
                  <span style={{
                    fontSize: 8, letterSpacing: '0.1em',
                    color: online ? a.color : 'var(--txg)',
                    fontFamily: 'IBM Plex Mono, monospace',
                    transition: 'color .3s',
                  }}>{a.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: gear icon */}
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--txd)', padding: '4px 6px', borderRadius: 3,
            transition: 'color .15s',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--tx)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--txd)')}
        >
          {/* Positions badge */}
          {at.state.positions.length > 0 && (
            <span style={{
              fontSize: 8, fontFamily: 'IBM Plex Mono, monospace',
              padding: '1px 5px', borderRadius: 3,
              background: 'var(--grnd)', color: 'var(--grn)',
              letterSpacing: '0.05em',
            }}>
              {at.state.positions.length} open
            </span>
          )}
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      {/* ═══ AGI COUNCIL — Real LLM Dialogue ═══ */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <AGICouncil />

        {/* Floating stats - shows paper trading stats from AGI events */}
        <StatsOverlay
          buys={paperTradingStats.buys}
          dangers={verdicts.x}
          pnl={paperTradingStats.totalPnl}
          armed={at.config.enabled}
        />
      </main>

      {/* ═══ CONFIG DRAWER ═══ */}
      <ConfigDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        at={at}
        onSettingsClick={onSettingsClick}
      />
    </div>
  );
};

export default TerminalDashboard;