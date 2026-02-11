import React, { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useAgentStatus, type ActivityEvent, type AgentState } from "./hooks/useAgentStatus";
import { useDiscoveries } from "./hooks/useDiscoveries";

// ═══════════════════════════════════════════════════════════════════
// DESIGN TOKENS — exact match to landing page CSS variables
// ═══════════════════════════════════════════════════════════════════
const T = {
  bgVoid: "#020202",
  bgDark: "#050505",
  bgCard: "#0A0A0C",
  textMain: "#F0F0F0",
  textMuted: "#8A8A95",
  textDim: "#4A4A55",
  accent: "#DC2626",
  accentGlow: "rgba(220, 38, 38, 0.6)",
  accentDim: "rgba(220, 38, 38, 0.15)",
  purple: "#7C3AED",
  amber: "#F59E0B",
  emerald: "#22C55E",
};

// Agent-specific colors — exact from landing AgentEye components
const AGENT_COLORS: Record<string, { main: string; glow: string; shadow: string }> = {
  SCOUT:   { main: "#8B5CF6", glow: "rgba(139, 92, 246, 0.15)", shadow: "rgba(139, 92, 246, 0.4)" },
  ANALYST: { main: "#DC2626", glow: "rgba(220, 38, 38, 0.15)",  shadow: "rgba(220, 38, 38, 0.4)"  },
  HUNTER:  { main: "#F59E0B", glow: "rgba(245, 158, 11, 0.15)", shadow: "rgba(245, 158, 11, 0.4)" },
  TRADER:  { main: "#10B981", glow: "rgba(16, 185, 129, 0.15)", shadow: "rgba(16, 185, 129, 0.4)" },
};

const FONT = {
  main: "'Inter', -apple-system, sans-serif",
  mono: "'JetBrains Mono', monospace",
};

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════
const tCA = (ca: string): string => ca.slice(0, 4) + "\u2026" + ca.slice(-4);
const tAgo = (ts: number): string => { const s = Math.floor((Date.now() - ts) / 1000); return s < 3 ? "now" : s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h"; };

// Agent metadata for display
const AGENT_META: Record<string, { role: string }> = {
  scout: { role: "The First Eye" },
  analyst: { role: "The Deep Mind" },
  hunter: { role: "The Long Memory" },
  trader: { role: "The Guardian" },
};

// Map API agent type to display color
function getAgentColor(agentType: string): { main: string; glow: string; shadow: string } {
  const type = agentType.toUpperCase();
  return AGENT_COLORS[type] || AGENT_COLORS.SCOUT;
}

// ═══════════════════════════════════════════════════════════════════
// SVG COMPONENTS — exact match to landing page
// ═══════════════════════════════════════════════════════════════════

// Main Argus Eye — identical to landing ArgusEye component
function ArgusEye({ size = 32, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={style || {}}>
      <path d="M50 8L92 85H8L50 8Z" stroke="#DC2626" strokeWidth="1.5" fill="none" opacity="0.8" />
      <path d="M50 20L80 75H20L50 20Z" stroke="#DC2626" strokeWidth="0.5" fill="none" opacity="0.4" />
      <ellipse cx="50" cy="50" rx="22" ry="12" stroke="#DC2626" strokeWidth="1.5" fill="none" />
      <ellipse cx="50" cy="50" rx="18" ry="9" fill="rgba(220, 38, 38, 0.1)" />
      <circle cx="50" cy="50" r="8" fill="#DC2626" />
      <circle cx="50" cy="50" r="4" fill="#0A0A0A" />
      <circle cx="47" cy="48" r="2" fill="rgba(255, 255, 255, 0.6)" />
    </svg>
  );
}

// Agent Eye — identical to landing AgentEye component
function AgentEye({ color, glowColor }: { color: string; glowColor: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
      <path d="M50 8L92 85H8L50 8Z" stroke={color} strokeWidth="2" fill="none" opacity="0.9" />
      <path d="M50 20L80 75H20L50 20Z" stroke={color} strokeWidth="0.5" fill="none" opacity="0.4" />
      <ellipse cx="50" cy="50" rx="22" ry="12" stroke={color} strokeWidth="2" fill="none" />
      <ellipse cx="50" cy="50" rx="18" ry="9" fill={glowColor} />
      <circle cx="50" cy="50" r="8" fill={color} />
      <circle cx="50" cy="50" r="4" fill="#0A0A0A" />
      <circle cx="47" cy="48" r="2" fill="rgba(255, 255, 255, 0.7)" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// UI PRIMITIVES — matching landing card style
// ═══════════════════════════════════════════════════════════════════

function Card({ glow, style, children }: { glow?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const base: React.CSSProperties = {
    background: T.bgCard,
    border: "1px solid " + (glow ? glow + "30" : "rgba(255,255,255,0.05)"),
    borderRadius: 16,
    transition: "border-color 0.3s, box-shadow 0.3s",
  };
  if (glow) base.boxShadow = "0 0 20px " + glow + "10, 0 20px 60px rgba(0,0,0,0.5)";
  return <div style={{ ...base, ...style }}>{children}</div>;
}

function Badge({ color = T.accent, children }: { color?: string; children: React.ReactNode }) {
  return (
    <span style={{
      background: color + "15", color: color, border: "1px solid " + color + "25",
      padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
      letterSpacing: 0.3, fontFamily: FONT.mono, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Spark({ data, w = 50, h = 16, color = T.accent }: { data: number[]; w?: number; h?: number; color?: string }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data); const mx = Math.max(...data); const r = mx - mn || 1;
  const pts = data.map((v, i) => ((i / (data.length - 1)) * w) + "," + (h - ((v - mn) / r) * (h - 2) - 1)).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block", flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 3px " + color + "50)" }} />
    </svg>
  );
}

function Ring({ score, size = 24 }: { score: number; size?: number }) {
  const color = score > 70 ? "#10B981" : score > 40 ? T.amber : "#EF4444";
  const circ = 2 * Math.PI * 9;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
        <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="2" strokeDasharray={circ} strokeDashoffset={circ - (score / 100) * circ} strokeLinecap="round" style={{ filter: "drop-shadow(0 0 3px " + color + "60)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: 7, fontWeight: 700, color: color }}>{score}</div>
    </div>
  );
}

function CALabel({ ca }: { ca: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      onClick={() => { navigator.clipboard?.writeText(ca); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      title={ca}
      style={{ cursor: "pointer", fontFamily: FONT.mono, fontSize: 10.5, fontWeight: 500, color: copied ? "#10B981" : T.textMuted, transition: "color 0.2s" }}
    >{copied ? "\u2713 copied" : tCA(ca)}</span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════════
function StatCard({ label, value, trend, sub }: { label: string; value: string; trend?: number; sub?: string }) {
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: T.textDim, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: FONT.main }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: T.textMain, fontFamily: FONT.main, letterSpacing: -0.5 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        {trend !== undefined && (
          <span style={{ color: trend >= 0 ? "#10B981" : "#EF4444", fontSize: 11, fontWeight: 600, fontFamily: FONT.mono }}>
            {trend >= 0 ? "\u25B2" : "\u25BC"}{Math.abs(trend).toFixed(1)}%
          </span>
        )}
        {sub && <span style={{ color: T.textDim, fontSize: 10, fontFamily: FONT.mono }}>{sub}</span>}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AGENT CARD — with AgentEye SVG matching landing page
// ═══════════════════════════════════════════════════════════════════
interface AgentStats {
  [key: string]: string;
}

function AgentCard({ agent, lastAction, lastSeen, stats }: { agent: { id: string; role: string; color: string }; lastAction: string; lastSeen: number; stats?: AgentStats }) {
  const active = (Date.now() - lastSeen) < 30000;
  const ac = AGENT_COLORS[agent.id];
  return (
    <Card glow={active ? ac.main : undefined} style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ filter: "drop-shadow(0 4px 15px " + ac.shadow + ")", flexShrink: 0 }}>
          <AgentEye color={ac.main} glowColor={ac.glow} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT.main, fontSize: 13, fontWeight: 700, color: T.textMain }}>{agent.id}</div>
          <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: FONT.mono }}>{agent.role}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: active ? ac.main : "#333", boxShadow: active ? "0 0 10px " + ac.main + "80" : "none", transition: "all 0.3s" }} />
          <span style={{ fontSize: 10, fontFamily: FONT.mono, color: active ? ac.main : "#333", fontWeight: 600 }}>{tAgo(lastSeen)}</span>
        </div>
      </div>
      {stats && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {Object.entries(stats).map(([key, val]) => (
            <div key={key} style={{ flex: 1, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: T.textDim, fontFamily: FONT.mono, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>{key}</div>
              <div style={{ fontSize: 12, color: T.textMuted, fontFamily: FONT.mono, fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{
        fontSize: 10, color: T.textDim, fontFamily: FONT.mono, padding: "6px 10px",
        background: "rgba(255,255,255,0.02)", borderRadius: 8, lineHeight: 1.5,
        borderLeft: "2px solid " + ac.main + "30", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{lastAction}</div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FEED ITEM — Agent conversations in natural language
// ═══════════════════════════════════════════════════════════════════

const AGENT_NAMES: Record<string, string> = {
  scout: 'Scout',
  analyst: 'Analyst',
  hunter: 'Hunter',
  trader: 'Trader',
  system: 'Hunter', // Legacy fallback for Hunter alerts without agent field
};

function FeedItem({ event }: { event: ActivityEvent }) {
  const isAlert = event.severity === "critical" || event.severity === "warning";
  const color = getAgentColor(event.agent).main;
  const agentName = AGENT_NAMES[event.agent.toLowerCase()] || event.agent;
  // Use message directly from backend - no templated transformation
  const message = event.message.length > 100 ? event.message.slice(0, 97) + '...' : event.message;

  return (
    <div style={{
      padding: "10px 12px", borderRadius: 10,
      background: isAlert ? "rgba(220,38,38,0.06)" : "rgba(255,255,255,0.02)",
      borderLeft: "3px solid " + color,
      transition: "background 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: `linear-gradient(135deg, ${color}30 0%, ${color}10 100%)`,
          border: `1px solid ${color}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0
        }}>
          <AgentEye color={color} glowColor={color + "30"} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: color }}>{agentName}</span>
            <span style={{ fontSize: 9, color: T.textDim, fontFamily: FONT.mono }}>{tAgo(event.timestamp)}</span>
          </div>
          <div style={{
            fontSize: 12, color: isAlert ? "#F87171" : T.textMain,
            fontFamily: FONT.main, lineHeight: 1.45,
            fontWeight: isAlert ? 500 : 400,
          }}>
            {message}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// POSITION ROW
// ═══════════════════════════════════════════════════════════════════
interface Position {
  id: string;
  ca: string;
  size: number;
  entry: number;
  cur: number;
  safety: number;
  sl: number;
  tp: number;
  hist: number[];
  at: number;
}

function PosRow({ pos }: { pos: Position }) {
  const pnl = ((pos.cur - pos.entry) / pos.entry * 100);
  const c = pnl >= 0 ? "#10B981" : "#EF4444";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "105px 50px 70px 60px 24px 1fr",
      alignItems: "center", padding: "8px 10px", borderRadius: 10, gap: 6,
      background: pnl > 20 ? "rgba(16,185,129,0.03)" : pnl < -8 ? "rgba(239,68,68,0.03)" : "rgba(255,255,255,0.015)",
      border: "1px solid " + (pnl > 20 ? "rgba(16,185,129,0.06)" : pnl < -8 ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.03)"),
    }}>
      <CALabel ca={pos.ca} />
      <Spark data={pos.hist} w={42} h={14} color={c} />
      <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: T.textMuted }}>{pos.size.toFixed(3)} SOL</span>
      <span style={{ fontFamily: FONT.mono, fontSize: 10.5, fontWeight: 700, color: c }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%</span>
      <Ring score={pos.safety} size={22} />
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
        <Badge color="#EF4444">{"SL-" + pos.sl + "%"}</Badge>
        <Badge color="#10B981">{"TP+" + pos.tp + "%"}</Badge>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BACKGROUND — subtle particle drift matching landing intro
// ═══════════════════════════════════════════════════════════════════
function ParticleBG() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    let f: number; let t = 0;
    const resize = () => { c.width = c.offsetWidth * 0.3; c.height = c.offsetHeight * 0.3; };
    resize(); window.addEventListener("resize", resize);
    interface Particle { x: number; y: number; vx: number; vy: number; pulse: number; }
    const particles: Particle[] = [];
    for (let i = 0; i < 18; i++) {
      particles.push({ x: Math.random() * c.width, y: Math.random() * c.height, vx: (Math.random() - 0.5) * 0.08, vy: (Math.random() - 0.5) * 0.08, pulse: Math.random() * Math.PI * 2 });
    }
    function draw() {
      if (!ctx || !c) return;
      t += 0.002;
      ctx.fillStyle = "rgba(2,2,2,0.04)"; ctx.fillRect(0, 0, c.width, c.height);
      for (let k = 0; k < particles.length; k++) {
        const n = particles[k];
        n.x += n.vx; n.y += n.vy; n.pulse += 0.006;
        if (n.x < 0 || n.x > c.width) n.vx *= -1;
        if (n.y < 0 || n.y > c.height) n.vy *= -1;
        ctx.beginPath(); ctx.arc(n.x, n.y, 0.6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(220,38,38," + (0.03 + Math.sin(n.pulse) * 0.015) + ")"; ctx.fill();
      }
      for (let m = 0; m < particles.length; m++) {
        for (let n2 = m + 1; n2 < particles.length; n2++) {
          const d = Math.hypot(particles[m].x - particles[n2].x, particles[m].y - particles[n2].y);
          if (d < 70) { ctx.beginPath(); ctx.moveTo(particles[m].x, particles[m].y); ctx.lineTo(particles[n2].x, particles[n2].y); ctx.strokeStyle = "rgba(220,38,38," + (0.01 * (1 - d / 70)) + ")"; ctx.lineWidth = 0.3; ctx.stroke(); }
        }
      }
      f = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(f); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN DASHBOARD — Connected to real agent APIs
// ═══════════════════════════════════════════════════════════════════
export default function AgentDashboard() {
  const [time, setTime] = useState(new Date());
  const feedRef = useRef<HTMLDivElement>(null);

  // Real data from Workers API
  const { status, activity, stats, graduations, isConnected, isLoading } = useAgentStatus({
    enabled: true,
    statusInterval: 5000,
    activityInterval: 3000,
    statsInterval: 10000,
  });
  const { discoveries: _discoveries } = useDiscoveries({ enabled: true, interval: 10000 });

  // BitNet Engine stats (dynamic from API)
  const [bitnetStats, setBitnetStats] = useState({
    inference: '13ms',
    features: '29-dim',
    compression: '17,000×',
    patterns: '8 known',
  });

  // Fetch BitNet stats
  useEffect(() => {
    const fetchBitnetStats = async () => {
      try {
        const response = await fetch('https://argusguard-api.hermosillo-jessie.workers.dev/agents/bitnet');
        if (response.ok) {
          const data = await response.json();
          setBitnetStats({
            inference: data.inference?.label || '13ms',
            features: data.features?.label || '29-dim',
            compression: data.compression?.label || '17,000×',
            patterns: data.patterns?.label || '8 known',
          });
        }
      } catch (err) {
        // Keep defaults on error
      }
    };
    fetchBitnetStats();
    const interval = setInterval(fetchBitnetStats, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, []);

  // Derived values from real API data
  const onlineAgents = status?.online ?? 0;
  const agents = status?.agents ?? [];
  const scansToday = stats?.scans?.today ?? 0;
  const alertsToday = stats?.alerts?.today ?? 0;
  const scamsDetected = stats?.alerts?.scamsDetected ?? 0;
  const walletsTracked = stats?.hunters?.walletsTracked ?? 0;
  const activePositions = stats?.traders?.activePositions ?? 0;
  const totalPnL = stats?.traders?.totalPnL ?? 0;
  const graduationsToday = stats?.graduations?.today ?? graduations.length;

  // Clock
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  // Scroll feed to top when new events arrive
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = 0; }, [activity.length]);

  // Helper to get agent stats for display - only real data from API
  const getAgentStats = (agentType: string): Record<string, string> => {
    switch (agentType.toLowerCase()) {
      case 'scout':
        return { scanned: String(scansToday), flagged: String(alertsToday) };
      case 'analyst':
        return { analyzed: String(scansToday), alerts: String(alertsToday) };
      case 'hunter':
        return { tracked: walletsTracked > 1000 ? (walletsTracked / 1000).toFixed(1) + "K" : String(walletsTracked), blocked: String(scamsDetected) };
      case 'trader':
        return { positions: String(activePositions), pnl: (totalPnL >= 0 ? "+" : "") + totalPnL.toFixed(2) };
      default:
        return {};
    }
  };

  // Find last activity for each agent
  const getLastActivity = (agentType: string): { lastSeen: number; lastAction: string } => {
    const agentEvents = activity.filter(e => e.agent.toLowerCase() === agentType.toLowerCase());
    if (agentEvents.length > 0) {
      const latest = agentEvents[0];
      return { lastSeen: latest.timestamp, lastAction: latest.message };
    }
    return { lastSeen: Date.now() - 60000, lastAction: "Waiting for activity..." };
  };

  // P&L history - empty until real trading data exists
  const pnlData: { t: string; pnl: number }[] = [];

  // Placeholder positions (until real positions API is built)
  const positions: Position[] = [];
  const totalPosValue = positions.reduce((sum, p) => sum + p.size, 0);

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: T.bgVoid, color: T.textMain, fontFamily: FONT.main, WebkitFontSmoothing: "antialiased" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
@keyframes eyePulse{0%,100%{filter:drop-shadow(0 0 12px rgba(220,38,38,0.4))}50%{filter:drop-shadow(0 0 28px rgba(220,38,38,0.7))}}
@keyframes ping{75%,100%{transform:scale(2.2);opacity:0}}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(220,38,38,0.08);border-radius:2px}
`}</style>
      <ParticleBG />

      {/* ═══ HEADER ═══ */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50, padding: "10px 24px",
        background: "rgba(2,2,2,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ animation: "eyePulse 3s ease-in-out infinite" }}>
            <ArgusEye size={34} />
          </div>
          <div>
            <div style={{ fontFamily: FONT.main, fontWeight: 700, fontSize: 15, color: T.textMain, letterSpacing: "0.04em" }}>
              ARGUS <span style={{ color: T.accent }}>AI</span>
            </div>
            <div style={{ fontSize: 9, color: T.textDim, letterSpacing: "0.2em", fontFamily: FONT.mono, textTransform: "uppercase" }}>Autonomous Command Center</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Connection status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: "5px 12px" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: isConnected ? "#10B981" : "#EF4444", boxShadow: isConnected ? "0 0 8px #10B981" : "0 0 8px #EF4444" }} />
            <span style={{ fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>{isConnected ? "Workers API" : "Connecting..."}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.accent, fontWeight: 600 }}>{graduationsToday > 0 ? "~" + graduationsToday + "/day" : ""}</span>
          </div>
          {/* Status pill - Read-only view */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: T.accentDim,
            border: "1px solid rgba(220,38,38,0.3)",
            borderRadius: 20, padding: "5px 14px",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, boxShadow: "0 0 10px " + T.accentGlow }} />
            <span style={{ fontFamily: FONT.main, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: "0.1em" }}>LIVE VIEW</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: "5px 12px" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: T.textMain, fontWeight: 700 }}>{onlineAgents}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>AGENTS</span>
          </div>
          <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>
            {time.toLocaleTimeString("en-US", { hour12: false })}
          </span>
        </div>
      </header>

      {/* ═══ MAIN ═══ */}
      <main style={{ position: "relative", zIndex: 5, padding: "16px 24px", maxWidth: 1700, margin: "0 auto" }}>

        {/* STATS ROW — Real data from API */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 14 }}>
          <StatCard label="Total P&L" value={(totalPnL >= 0 ? "+" : "") + totalPnL.toFixed(2)} sub="SOL" />
          <StatCard label="Positions" value={String(activePositions)} sub="active" />
          <StatCard label="Scans" value={scansToday.toLocaleString()} sub="today" />
          <StatCard label="Alerts" value={String(alertsToday)} sub="today" />
          <StatCard label="Scams Caught" value={String(scamsDetected)} sub="blocked" />
          <StatCard label="Wallets" value={walletsTracked > 1000 ? (walletsTracked / 1000).toFixed(1) + "K" : String(walletsTracked)} sub="tracked" />
        </div>

        {/* 3-COLUMN LAYOUT */}
        <div style={{ display: "grid", gridTemplateColumns: "252px 1fr 300px", gap: 12 }}>

          {/* ══ LEFT: AGENTS — Real status from API ══ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5 }}>Agents</span>
              <Badge color={onlineAgents === 4 ? "#10B981" : T.amber}>{onlineAgents}/4 ONLINE</Badge>
            </div>
            {(agents.length > 0 ? agents : [
              { type: 'scout' as const, name: 'Scout', status: 'idle' as const, statusText: 'Waiting...', metric: '', lastActivity: Date.now() },
              { type: 'analyst' as const, name: 'Analyst', status: 'idle' as const, statusText: 'Waiting...', metric: '', lastActivity: Date.now() },
              { type: 'hunter' as const, name: 'Hunter', status: 'idle' as const, statusText: 'Waiting...', metric: '', lastActivity: Date.now() },
              { type: 'trader' as const, name: 'Trader', status: 'idle' as const, statusText: 'Waiting...', metric: '', lastActivity: Date.now() },
            ]).map((a: AgentState) => {
              const lastAct = getLastActivity(a.type);
              const agentStats = getAgentStats(a.type);
              return (
                <AgentCard
                  key={a.type}
                  agent={{ id: a.type.toUpperCase(), role: AGENT_META[a.type]?.role || a.name, color: getAgentColor(a.type).main }}
                  lastAction={a.statusText || lastAct.lastAction}
                  lastSeen={a.lastActivity || lastAct.lastSeen}
                  stats={agentStats}
                />
              );
            })}
            {/* BitNet Engine */}
            <Card style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted }}>BitNet Engine</span>
                <span style={{ fontSize: 9, color: T.textDim, fontFamily: FONT.mono, background: "rgba(255,255,255,0.03)", padding: "2px 6px", borderRadius: 4 }}>1-bit quantized</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                {[{ l: "Inference", v: bitnetStats.inference }, { l: "Features", v: bitnetStats.features }, { l: "Compress", v: bitnetStats.compression }, { l: "Patterns", v: bitnetStats.patterns }].map(s => (
                  <div key={s.l} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "6px 8px" }}>
                    <div style={{ fontSize: 8.5, color: T.textDim, fontFamily: FONT.mono, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>{s.l}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, fontFamily: FONT.main, letterSpacing: -0.3, background: "linear-gradient(135deg, " + T.accent + " 0%, #EF4444 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ══ CENTER: CHART + POSITIONS ══ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* P&L Chart */}
            <Card style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5 }}>Portfolio P&L</div>
                  <div style={{ fontSize: 10, color: T.textDim, fontFamily: FONT.mono, marginTop: 2 }}>cumulative today</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: totalPnL >= 0 ? "#10B981" : "#EF4444", fontFamily: FONT.main }}>
                    {totalPnL !== 0 ? ((totalPnL >= 0 ? "+" : "") + totalPnL.toFixed(3) + " SOL") : "--"}
                  </div>
                </div>
              </div>
              {pnlData.length > 0 ? (
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={pnlData}>
                    <defs>
                      <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={T.accent} stopOpacity={0.15} />
                        <stop offset="100%" stopColor={T.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" tick={{ fill: T.textDim, fontSize: 8, fontFamily: FONT.mono }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: T.textDim, fontSize: 8, fontFamily: FONT.mono }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={{ background: "rgba(10,10,12,0.95)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, fontFamily: FONT.mono, fontSize: 10 }} />
                    <Area type="monotone" dataKey="pnl" stroke={T.accent} strokeWidth={1.5} fill="url(#pnlGrad)" dot={false} style={{ filter: "drop-shadow(0 0 4px rgba(220,38,38,0.3))" }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: 130, display: "flex", alignItems: "center", justifyContent: "center", color: T.textDim, fontSize: 11, fontFamily: FONT.mono }}>
                  No trading data yet
                </div>
              )}
            </Card>

            {/* Positions */}
            <Card style={{ padding: "16px 18px", flex: 1, display: "flex", flexDirection: "column", maxHeight: 360, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5 }}>Positions</span>
                  <span style={{ fontSize: 10, color: T.textDim, fontFamily: FONT.mono }}>{positions.length + " active \u00B7 " + totalPosValue.toFixed(2) + " SOL"}</span>
                </div>
                <Badge color={T.accent}>AUTO-MANAGED</Badge>
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "105px 50px 70px 60px 24px 1fr",
                padding: "0 10px 6px", fontSize: 8.5, fontWeight: 600, color: T.textDim,
                letterSpacing: 0.8, fontFamily: FONT.mono, borderBottom: "1px solid rgba(255,255,255,0.03)", gap: 6, textTransform: "uppercase",
              }}>
                <span>Contract</span><span>Chart</span><span>Size</span><span>P&L</span><span>Risk</span><span style={{ textAlign: "right" }}>Stops</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", paddingTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                {positions.length > 0 ? (
                  positions.sort((a, b) => ((b.cur - b.entry) / b.entry) - ((a.cur - a.entry) / a.entry)).map(p => <PosRow key={p.id} pos={p} />)
                ) : (
                  <div style={{ padding: 40, textAlign: "center", color: T.textDim, fontSize: 11, fontFamily: FONT.mono }}>
                    No active positions
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* ══ RIGHT: ACTIVITY FEED ══ */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5 }}>Activity Feed</span>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ position: "relative", display: "inline-flex", width: 6, height: 6 }}>
                  <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: T.accent, animation: "ping 1.2s infinite", opacity: 0.4 }} />
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent }} />
                </span>
                <span style={{ fontSize: 10, fontFamily: FONT.mono, color: T.accent, fontWeight: 700, letterSpacing: "0.1em" }}>LIVE</span>
              </div>
            </div>
            <Card style={{ padding: 10, flex: 1, maxHeight: "calc(100vh - 215px)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div ref={feedRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                {activity.length > 0 ? (
                  activity.map(event => <FeedItem key={event.id} event={event} />)
                ) : (
                  <div style={{ padding: 20, textAlign: "center", color: T.textDim, fontSize: 11, fontFamily: FONT.mono }}>
                    {isLoading ? "Loading activity..." : "No recent activity"}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

      </main>

      {/* FOOTER — matching landing footer style */}
      <footer style={{ position: "relative", zIndex: 5, textAlign: "center", padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.03)", background: T.bgDark }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 8 }}>
          {["app.argusguard.io", "Yellowstone gRPC", "Jupiter V6", "BitNet Engine"].map(label => (
            <span key={label} style={{ color: T.textMuted, fontSize: 11, fontFamily: FONT.mono }}>{label}</span>
          ))}
        </div>
        <div style={{ color: T.textDim, fontSize: 10, fontFamily: FONT.mono }}>
          Argus AI — Built by hunters, for hunters. 100% open source.
        </div>
      </footer>
    </div>
  );
}
