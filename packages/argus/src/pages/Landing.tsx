import { useState, useEffect, useRef } from 'react';

// Set this to the $ARGUS token mint address once launched
const ARGUS_TOKEN_MINT = '';

function formatMarketCap(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPrice(p: number): string {
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(6)}`;
}

const styles = `
  /* --- DESIGN TOKENS (DARK THEME) --- */
  .landing-page {
    --bg-body: #09090B;
    --bg-card: #111113;
    --bg-elevated: #18181B;
    --text-main: #FAFAFA;
    --text-muted: #A1A1AA;
    --primary: #FFFFFF;
    --accent: #10B981;
    --accent-glow: rgba(16, 185, 129, 0.15);
    --border: #27272A;
    --border-light: #1F1F23;
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --font-main: 'Inter', -apple-system, sans-serif;
    --max-width: 1200px;

    background-color: var(--bg-body);
    color: var(--text-main);
    font-family: var(--font-main);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }

  .landing-page * { box-sizing: border-box; }
  .landing-page a { text-decoration: none; color: inherit; transition: all 0.2s; }
  .landing-page ul { list-style: none; margin: 0; padding: 0; }

  .landing-page .container {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 0 24px;
  }

  .landing-page .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 14px 28px;
    border-radius: var(--radius-md);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: -0.01em;
  }

  .landing-page .btn-primary {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    border: none;
    box-shadow: 0 4px 20px rgba(16, 185, 129, 0.3);
  }

  .landing-page .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(16, 185, 129, 0.4);
  }

  .landing-page .btn-outline {
    background-color: transparent;
    color: var(--text-main);
    border: 1px solid var(--border);
  }

  .landing-page .btn-outline:hover {
    border-color: var(--accent);
    background: var(--accent-glow);
  }

  .landing-page .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    border-radius: 99px;
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 24px;
    letter-spacing: 0.02em;
  }

  .landing-page .badge-dot {
    width: 8px;
    height: 8px;
    background: white;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* --- HEADER --- */
  .landing-page header {
    position: sticky;
    top: 0;
    width: 100%;
    z-index: 100;
    background: rgba(9, 9, 11, 0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }

  .landing-page nav {
    height: 70px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .landing-page .logo {
    display: flex;
    align-items: center;
    gap: 12px;
    font-weight: 800;
    font-size: 1.3rem;
    letter-spacing: -0.03em;
  }

  .landing-page .logo-icon {
    width: 44px;
    height: 44px;
    background: linear-gradient(135deg, #18181B 0%, #09090B 100%);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #27272A;
  }

  .landing-page .nav-links {
    display: flex;
    gap: 32px;
  }

  .landing-page .nav-links a {
    font-size: 0.9rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .landing-page .nav-links a:hover { color: var(--text-main); }

  /* --- HERO --- */
  .landing-page .hero {
    padding: 100px 0 60px;
    text-align: center;
    position: relative;
  }

  .landing-page .hero h1 {
    font-size: 4rem;
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: -0.04em;
    margin-bottom: 24px;
    color: var(--primary);
  }

  .landing-page .hero h1 span {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .landing-page .hero p {
    font-size: 1.2rem;
    color: var(--text-muted);
    font-weight: 400;
    max-width: 560px;
    margin: 0 auto 40px;
    line-height: 1.7;
  }

  .landing-page .hero .container {
    position: relative;
    z-index: 1;
  }

  /* --- HERO BACKGROUND LOGO --- */
  .landing-page .hero-bg-logo {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 1000px;
    height: 1000px;
    opacity: 0.10;
    pointer-events: none;
    z-index: 0;
    will-change: transform, opacity;
  }

  .landing-page .hero-bg-logo svg {
    width: 100%;
    height: 100%;
  }

  /* --- TOKEN TICKER --- */
  .landing-page .token-ticker {
    display: inline-flex;
    align-items: center;
    gap: 24px;
    padding: 16px 32px;
    background: rgba(17, 17, 19, 0.8);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    backdrop-filter: blur(12px);
    margin-bottom: 32px;
  }

  .landing-page .ticker-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .landing-page .ticker-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  .landing-page .ticker-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-main);
    font-variant-numeric: tabular-nums;
  }

  .landing-page .ticker-value.green { color: var(--accent); }
  .landing-page .ticker-value.red { color: #EF4444; }

  .landing-page .ticker-divider {
    width: 1px;
    height: 32px;
    background: var(--border);
  }

  .landing-page .ticker-coming-soon {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.02em;
  }

  .landing-page .hero-actions {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-bottom: 60px;
  }

  /* --- UI MOCKUP --- */
  .landing-page .ui-mockup {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 48px -12px rgba(0,0,0,0.1);
    max-width: 900px;
    margin: 0 auto;
    overflow: hidden;
  }

  .landing-page .ui-header {
    height: 48px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 16px;
    justify-content: space-between;
    background: var(--bg-elevated);
  }

  .landing-page .ui-dots { display: flex; gap: 6px; }
  .landing-page .ui-dot { width: 10px; height: 10px; border-radius: 50%; }
  .landing-page .ui-dot.red { background: #FCA5A5; }
  .landing-page .ui-dot.yellow { background: #FCD34D; }
  .landing-page .ui-dot.green { background: #6EE7B7; }

  .landing-page .ui-body {
    padding: 24px;
    background: var(--bg-card);
  }

  /* Search Bar */
  .landing-page .ui-search {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
  }

  .landing-page .ui-search-input {
    flex: 1;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    color: var(--text-muted);
    background: var(--bg-elevated);
  }

  .landing-page .ui-search-btn {
    padding: 14px 24px;
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 0.9rem;
  }

  /* Token Header */
  .landing-page .ui-token-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border-light);
  }

  .landing-page .ui-token-info {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .landing-page .ui-token-icon {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #09090B 0%, #27272A 100%);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 1rem;
  }

  .landing-page .ui-token-name {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .landing-page .ui-token-addr {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: monospace;
  }

  .landing-page .ui-signal {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .landing-page .ui-signal-badge {
    padding: 6px 12px;
    background: #10B981;
    color: white;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .landing-page .ui-score {
    font-size: 2rem;
    font-weight: 800;
    color: #10B981;
  }

  /* Cards Grid */
  .landing-page .ui-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 20px;
  }

  .landing-page .ui-card {
    background: var(--bg-elevated);
    border-radius: var(--radius-sm);
    padding: 16px;
  }

  .landing-page .ui-card-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 600;
    margin-bottom: 12px;
  }

  .landing-page .ui-card-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    margin-bottom: 8px;
  }

  .landing-page .ui-card-row:last-child { margin-bottom: 0; }

  .landing-page .ui-card-label { color: var(--text-muted); }
  .landing-page .ui-card-value { font-weight: 600; }
  .landing-page .ui-card-value.green { color: #10B981; }
  .landing-page .ui-card-value.red { color: #EF4444; }

  /* Holders Section */
  .landing-page .ui-holders {
    background: var(--bg-elevated);
    border-radius: var(--radius-sm);
    padding: 16px;
    margin-bottom: 20px;
  }

  .landing-page .ui-holders-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .landing-page .ui-bundle-badge {
    padding: 4px 10px;
    background: #FEE2E2;
    color: #DC2626;
    border-radius: 6px;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .landing-page .ui-holder-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  .landing-page .ui-holder-bar {
    flex: 1;
    height: 8px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .landing-page .ui-holder-fill {
    height: 100%;
    border-radius: 4px;
  }

  .landing-page .ui-holder-fill.normal { background: var(--accent); }
  .landing-page .ui-holder-fill.bundle { background: #EF4444; }

  .landing-page .ui-holder-pct {
    font-size: 0.8rem;
    font-weight: 600;
    width: 50px;
    text-align: right;
  }

  .landing-page .ui-holder-pct.bundle { color: #EF4444; }

  /* Buy Controls */
  .landing-page .ui-buy {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .landing-page .ui-amounts {
    display: flex;
    gap: 8px;
  }

  .landing-page .ui-amount {
    padding: 10px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .landing-page .ui-amount.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .landing-page .ui-buy-btn {
    padding: 12px 32px;
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-size: 0.9rem;
  }

  /* --- FEATURES GRID --- */
  .landing-page .features {
    padding: 100px 0;
    border-top: 1px solid var(--border);
  }

  .landing-page .section-header {
    text-align: center;
    margin-bottom: 60px;
  }

  .landing-page .section-header h2 {
    font-size: 2.5rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    margin-bottom: 16px;
    color: var(--accent);
  }

  .landing-page .section-header p {
    font-size: 1.1rem;
    color: var(--text-muted);
    max-width: 500px;
    margin: 0 auto;
  }

  .landing-page .feature-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }

  .landing-page .feature-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    padding: 32px;
    border-radius: var(--radius-lg);
    transition: all 0.2s;
  }

  .landing-page .feature-card:hover {
    border-color: var(--accent);
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(16, 185, 129, 0.15);
  }

  .landing-page .icon-bg {
    width: 52px;
    height: 52px;
    background: var(--accent-glow);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    color: var(--accent);
  }

  .landing-page .card-title {
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 10px;
    letter-spacing: -0.01em;
    color: var(--accent);
  }

  .landing-page .card-desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  /* --- STATS --- */
  .landing-page .stats {
    padding: 60px 0;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .landing-page .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 32px;
    text-align: center;
  }

  .landing-page .stat-value {
    font-size: 2.5rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    margin-bottom: 4px;
    color: var(--accent);
  }

  .landing-page .stat-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  /* --- TOKEN TEASER --- */
  .landing-page .token-teaser {
    padding: 80px 0;
    background: linear-gradient(135deg, #09090B 0%, #18181B 100%);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .landing-page .teaser-content {
    max-width: 800px;
    margin: 0 auto;
    text-align: center;
  }

  .landing-page .teaser-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
    color: white;
    border-radius: 99px;
    font-size: 0.8rem;
    font-weight: 700;
    margin-bottom: 24px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .landing-page .teaser-content h2 {
    font-size: 2.5rem;
    font-weight: 800;
    margin-bottom: 16px;
    letter-spacing: -0.03em;
    color: var(--accent);
  }

  .landing-page .teaser-content p {
    font-size: 1.1rem;
    color: var(--text-muted);
    margin-bottom: 32px;
    line-height: 1.7;
  }

  .landing-page .ca-box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 24px;
    margin-bottom: 32px;
  }

  .landing-page .ca-label {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .landing-page .ca-address {
    font-family: 'Courier New', monospace;
    font-size: 1.1rem;
    color: var(--accent);
    font-weight: 700;
    word-break: break-all;
  }

  .landing-page .teaser-benefits {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
    margin-bottom: 32px;
  }

  .landing-page .benefit-item {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 20px;
  }

  .landing-page .benefit-icon {
    font-size: 1.5rem;
    margin-bottom: 12px;
    color: var(--accent);
  }

  .landing-page .benefit-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 6px;
  }

  .landing-page .benefit-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* --- FOOTER --- */
  .landing-page footer {
    padding: 60px 0 40px;
    text-align: center;
  }

  .landing-page .footer-logo {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-weight: 800;
    font-size: 1.4rem;
    margin-bottom: 24px;
  }

  .landing-page .footer-links {
    display: flex;
    justify-content: center;
    gap: 32px;
    margin-bottom: 32px;
  }

  .landing-page .footer-links a {
    font-size: 0.9rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .landing-page .footer-links a:hover { color: var(--text-main); }

  .landing-page .copyright {
    font-size: 0.85rem;
    color: #A1A1AA;
  }

  /* --- HOW IT WORKS --- */
  .landing-page .how-it-works {
    padding: 100px 0;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
  }

  .landing-page .steps-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 32px;
    position: relative;
  }

  .landing-page .steps-grid::before {
    content: '';
    position: absolute;
    top: 40px;
    left: 60px;
    right: 60px;
    height: 2px;
    background: var(--border);
  }

  .landing-page .step {
    text-align: center;
    position: relative;
  }

  .landing-page .step-number {
    width: 80px;
    height: 80px;
    background: linear-gradient(135deg, #09090B 0%, #27272A 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    font-size: 1.5rem;
    font-weight: 800;
    color: white;
    position: relative;
    z-index: 1;
  }

  .landing-page .step-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin-bottom: 8px;
    color: var(--accent);
  }

  .landing-page .step-desc {
    font-size: 0.9rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  /* --- TOKENOMICS --- */
  .landing-page .tokenomics {
    padding: 100px 0;
    border-top: 1px solid var(--border);
  }

  .landing-page .token-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 60px;
    align-items: center;
  }

  .landing-page .token-info h3 {
    font-size: 1.8rem;
    font-weight: 800;
    margin-bottom: 16px;
    letter-spacing: -0.02em;
    color: var(--accent);
  }

  .landing-page .token-info p {
    font-size: 1rem;
    color: var(--text-muted);
    line-height: 1.7;
    margin-bottom: 24px;
  }

  .landing-page .token-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  .landing-page .token-stat {
    background: var(--bg-elevated);
    padding: 20px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
  }

  .landing-page .token-stat-value {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--accent);
    margin-bottom: 4px;
  }

  .landing-page .token-stat-label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .landing-page .token-chart {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 32px;
  }

  .landing-page .chart-title {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 24px;
    text-align: center;
    color: var(--accent);
  }

  .landing-page .chart-bars {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .landing-page .chart-bar {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .landing-page .chart-label {
    width: 120px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .landing-page .chart-track {
    flex: 1;
    height: 24px;
    background: var(--border);
    border-radius: 12px;
    overflow: hidden;
  }

  .landing-page .chart-fill {
    height: 100%;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 12px;
    font-size: 0.75rem;
    font-weight: 700;
    color: white;
  }

  .landing-page .chart-fill.community { background: linear-gradient(135deg, #10B981 0%, #059669 100%); }
  .landing-page .chart-fill.development { background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); }
  .landing-page .chart-fill.team { background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%); }
  .landing-page .chart-fill.liquidity { background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); }
  .landing-page .chart-fill.reserve { background: linear-gradient(135deg, #6366F1 0%, #4F46E5 100%); }

  /* --- ROADMAP --- */
  .landing-page .roadmap {
    padding: 100px 0;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
  }

  .landing-page .roadmap-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }

  .landing-page .roadmap-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 32px;
    position: relative;
  }

  .landing-page .roadmap-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
  }

  .landing-page .roadmap-phase {
    display: inline-block;
    padding: 6px 12px;
    background: var(--border);
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
    margin-bottom: 16px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .landing-page .roadmap-card.active .roadmap-phase {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
  }

  .landing-page .roadmap-title {
    font-size: 1.25rem;
    font-weight: 700;
    margin-bottom: 16px;
    color: var(--accent);
  }

  .landing-page .roadmap-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .landing-page .roadmap-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .landing-page .roadmap-item svg {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .landing-page .roadmap-card.active .roadmap-item {
    color: var(--text-main);
  }

  /* --- TEAM --- */
  .landing-page .team {
    padding: 100px 0;
    border-top: 1px solid var(--border);
  }

  .landing-page .team-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 32px;
  }

  .landing-page .team-card {
    text-align: center;
  }

  .landing-page .team-avatar {
    width: 120px;
    height: 120px;
    background: linear-gradient(135deg, var(--bg-elevated) 0%, var(--border) 100%);
    border-radius: 50%;
    margin: 0 auto 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.5rem;
    font-weight: 800;
    color: var(--accent);
    border: 1px solid var(--border);
  }

  .landing-page .team-name {
    font-size: 1.1rem;
    font-weight: 700;
    margin-bottom: 4px;
    color: var(--accent);
  }

  .landing-page .team-role {
    font-size: 0.9rem;
    color: var(--accent);
    font-weight: 600;
    margin-bottom: 12px;
  }

  .landing-page .team-bio {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .landing-page .team-social {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin-top: 16px;
  }

  .landing-page .team-social a {
    width: 36px;
    height: 36px;
    background: var(--border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .landing-page .team-social a:hover {
    background: var(--accent);
    color: white;
  }

  /* --- CTA SECTION --- */
  .landing-page .cta {
    padding: 100px 0;
    background: linear-gradient(135deg, #09090B 0%, #18181B 100%);
    text-align: center;
  }

  .landing-page .cta h2 {
    font-size: 2.5rem;
    font-weight: 800;
    color: var(--accent);
    margin-bottom: 16px;
    letter-spacing: -0.03em;
  }

  .landing-page .cta p {
    font-size: 1.1rem;
    color: #A1A1AA;
    margin-bottom: 32px;
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
  }

  .landing-page .cta .btn-accent {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    padding: 16px 40px;
    font-size: 1rem;
  }

  .landing-page .cta .btn-accent:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
  }

  /* --- COMPARISON SECTION --- */
  .landing-page .comparison {
    padding: 100px 0;
    border-top: 1px solid var(--border-light);
  }

  .landing-page .category-badge {
    display: inline-block;
    padding: 6px 14px;
    background: var(--accent-glow);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 16px;
  }

  .landing-page .comparison-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: 0 -24px;
    padding: 0 24px;
  }

  .landing-page .comparison-table {
    width: 100%;
    min-width: 700px;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .landing-page .comparison-table th {
    padding: 14px 16px;
    text-align: center;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  .landing-page .comparison-table th:first-child {
    text-align: left;
    color: var(--text-main);
    font-size: 0.9rem;
  }

  .landing-page .comparison-table th.highlight {
    color: var(--accent);
    position: relative;
  }

  .landing-page .comparison-table td {
    padding: 14px 16px;
    text-align: center;
    border-bottom: 1px solid var(--border-light);
    color: var(--text-muted);
  }

  .landing-page .comparison-table td:first-child {
    text-align: left;
    color: var(--text-main);
    font-weight: 500;
  }

  .landing-page .comparison-table td.highlight {
    background: rgba(16, 185, 129, 0.04);
  }

  .landing-page .comparison-table tr:last-child td {
    border-bottom: none;
  }

  .landing-page .comparison-table .check {
    color: var(--accent);
    font-size: 1.1rem;
  }

  .landing-page .comparison-table .dash {
    color: #3F3F46;
  }

  .landing-page .comparison-table .exclusive {
    color: var(--accent);
    font-weight: 600;
    font-size: 0.8rem;
    letter-spacing: 0.02em;
  }

  .landing-page .comparison-callout {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    margin-top: 48px;
    padding: 28px 32px;
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(16, 185, 129, 0.02) 100%);
    border: 1px solid rgba(16, 185, 129, 0.15);
    border-radius: var(--radius-lg);
  }

  .landing-page .callout-icon {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-glow);
    border-radius: var(--radius-md);
    color: var(--accent);
    font-size: 1.2rem;
  }

  .landing-page .callout-content h4 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0 0 6px;
    color: var(--text-main);
  }

  .landing-page .callout-content p {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.6;
  }

  /* --- TRADING SHOWCASE --- */
  .landing-page .trading-showcase {
    padding: 100px 0;
    background: var(--bg-body);
    border-top: 1px solid var(--border);
  }

  .landing-page .trading-showcase .ui-mockup {
    position: relative;
    z-index: 1;
  }

  .landing-page .ui-trade-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .landing-page .ui-trade-row-label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
    margin-right: 4px;
    white-space: nowrap;
  }

  .landing-page .ui-trade-btn {
    padding: 8px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .landing-page .ui-trade-btn.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .landing-page .ui-trade-btn.active-red {
    background: #EF4444;
    color: white;
    border-color: #EF4444;
  }

  .landing-page .ui-trade-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .landing-page .ui-action-sell {
    padding: 10px 24px;
    background: #EF4444;
    color: white;
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-size: 0.85rem;
  }

  .landing-page .ui-action-buy {
    padding: 10px 24px;
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-size: 0.85rem;
  }

  .landing-page .ui-settings-row {
    display: flex;
    gap: 40px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .landing-page .ui-settings-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 200px;
  }

  .landing-page .ui-settings-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .landing-page .ui-settings-options {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .landing-page .ui-autosell {
    background: var(--bg-elevated);
    border-radius: var(--radius-sm);
    padding: 16px;
    margin-bottom: 20px;
  }

  .landing-page .ui-autosell-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }

  .landing-page .ui-autosell-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-main);
  }

  .landing-page .ui-toggle {
    width: 40px;
    height: 22px;
    background: var(--accent);
    border-radius: 11px;
    position: relative;
  }

  .landing-page .ui-toggle::after {
    content: '';
    position: absolute;
    top: 3px;
    right: 3px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
  }

  .landing-page .ui-autosell-groups {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }

  .landing-page .ui-autosell-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .landing-page .ui-autosell-group-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .landing-page .ui-autosell-options {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .landing-page .ui-positions {
    margin-top: 20px;
  }

  .landing-page .ui-positions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .landing-page .ui-positions-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--accent);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .landing-page .ui-positions-badge {
    width: 20px;
    height: 20px;
    background: var(--accent);
    color: white;
    border-radius: 50%;
    font-size: 0.7rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .landing-page .ui-positions-summary {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .landing-page .ui-positions-pnl {
    color: #EF4444;
    font-weight: 600;
  }

  .landing-page .ui-pos-actions {
    display: flex;
    gap: 8px;
  }

  .landing-page .ui-pos-action-btn {
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .landing-page .ui-pos-action-btn.sell {
    background: #EF4444;
    color: white;
  }

  .landing-page .ui-pos-action-btn.clear {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-main);
  }

  .landing-page .ui-positions-table {
    width: 100%;
    border-collapse: collapse;
  }

  .landing-page .ui-positions-table th {
    padding: 10px 12px;
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 600;
    border-bottom: 1px solid var(--border);
  }

  .landing-page .ui-positions-table td {
    padding: 14px 12px;
    font-size: 0.85rem;
    color: var(--text-main);
    font-weight: 500;
    border-bottom: 1px solid var(--border-light);
  }

  .landing-page .ui-positions-table td.token-name {
    font-weight: 700;
  }

  .landing-page .ui-positions-table td.pnl-positive {
    color: var(--accent);
    font-weight: 700;
  }

  .landing-page .ui-pos-sell-btn {
    padding: 6px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-main);
  }

  /* --- RESPONSIVE --- */
  @media (max-width: 900px) {
    .landing-page .hero h1 { font-size: 2.5rem; }
    .landing-page .ui-cards { grid-template-columns: 1fr; }
    .landing-page .feature-grid { grid-template-columns: 1fr; }
    .landing-page .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .landing-page .token-ticker { gap: 16px; padding: 12px 20px; }
    .landing-page .ticker-value { font-size: 1rem; }
    .landing-page .nav-links { display: none; }
    .landing-page .steps-grid { grid-template-columns: repeat(2, 1fr); }
    .landing-page .steps-grid::before { display: none; }
    .landing-page .token-grid { grid-template-columns: 1fr; }
    .landing-page .roadmap-grid { grid-template-columns: 1fr; }
    .landing-page .team-grid { grid-template-columns: repeat(2, 1fr); }
    .landing-page .teaser-benefits { grid-template-columns: 1fr; }
    .landing-page .comparison-callout { flex-direction: column; gap: 12px; padding: 20px; }
    .landing-page .comparison-table { font-size: 0.8rem; }
    .landing-page .comparison-table th,
    .landing-page .comparison-table td { padding: 10px 10px; }
    .landing-page .ui-trade-actions { margin-left: 0; width: 100%; }
    .landing-page .ui-action-sell, .landing-page .ui-action-buy { flex: 1; text-align: center; }
    .landing-page .ui-settings-row { gap: 16px; }
    .landing-page .ui-autosell-groups { gap: 16px; }
    .landing-page .ui-positions-summary { font-size: 0.7rem; }
    .landing-page .ui-positions-table { font-size: 0.75rem; }
    .landing-page .ui-positions-table th, .landing-page .ui-positions-table td { padding: 8px 6px; }
  }
`;

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
    <path d="M16 4L28 26H4L16 4Z" stroke="white" strokeWidth="2" fill="none"/>
    <ellipse cx="16" cy="16" rx="6" ry="4" stroke="white" strokeWidth="1.5" fill="none"/>
    <circle cx="16" cy="16" r="2" fill="white"/>
  </svg>
);

export default function Landing() {
  const [tokenData, setTokenData] = useState<{
    marketCap: number;
    price: number;
    priceChange24h: number;
  } | null>(null);

  useEffect(() => {
    if (!ARGUS_TOKEN_MINT) return;

    const fetchTokenData = async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ARGUS_TOKEN_MINT}`);
        if (!res.ok) return;
        const data = await res.json();
        const pair = data.pairs?.[0];
        if (pair) {
          setTokenData({
            marketCap: pair.marketCap || pair.fdv || 0,
            price: parseFloat(pair.priceUsd) || 0,
            priceChange24h: pair.priceChange?.h24 || 0,
          });
        }
      } catch {
        // Silently fail — ticker just won't update
      }
    };

    fetchTokenData();
    const interval = setInterval(fetchTokenData, 30000);
    return () => clearInterval(interval);
  }, []);

  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!bgRef.current) return;
      const y = window.scrollY;
      bgRef.current.style.transform = `translate(-50%, calc(-50% + ${y * 0.08}px))`;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <style>{styles}</style>
      <div className="landing-page">
        {/* NAVIGATION */}
        <header>
          <div className="container">
            <nav>
              <div className="logo">
                <div className="logo-icon">
                  <Logo />
                </div>
                <span>ARGUS<span style={{ color: '#71717A', fontWeight: 300 }}>AI</span></span>
              </div>
              <div className="nav-links">
                <a href="#features">Features</a>
                <a href="#how-it-works">How It Works</a>
                <a href="#compare">Compare</a>
                <a href="#token">Token</a>
                <a href="#roadmap">Roadmap</a>
              </div>
              <a href="https://app.argusguard.io" className="btn btn-primary">Launch App</a>
            </nav>
          </div>
        </header>

        {/* BACKGROUND LOGO (parallax) */}
        <div className="hero-bg-logo" ref={bgRef}>
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 4L28 26H4L16 4Z" stroke="#10B981" strokeWidth="0.7" fill="none"/>
            <ellipse cx="16" cy="16" rx="6" ry="4" stroke="#10B981" strokeWidth="0.5" fill="none"/>
            <circle cx="16" cy="16" r="2" fill="#10B981"/>
          </svg>
        </div>

        {/* HERO SECTION */}
        <section className="hero">
          <div className="container">
            <div className="badge">
              <span className="badge-dot"></span>
              Detect Insider Trading
            </div>
            <h1>Detect Coordinated Wallets<br/><span>Before They Dump</span></h1>
            <p>
              Expose insider clusters and pump groups on Solana with bundle detection.
              See what coordinated wallets are hiding before you invest.
            </p>

            <div className="token-ticker">
              {ARGUS_TOKEN_MINT && tokenData ? (
                <>
                  <div className="ticker-stat">
                    <span className="ticker-label">Market Cap</span>
                    <span className="ticker-value">{formatMarketCap(tokenData.marketCap)}</span>
                  </div>
                  <div className="ticker-divider" />
                  <div className="ticker-stat">
                    <span className="ticker-label">Price</span>
                    <span className="ticker-value">{formatPrice(tokenData.price)}</span>
                  </div>
                  <div className="ticker-divider" />
                  <div className="ticker-stat">
                    <span className="ticker-label">24h</span>
                    <span className={`ticker-value ${tokenData.priceChange24h >= 0 ? 'green' : 'red'}`}>
                      {tokenData.priceChange24h >= 0 ? '+' : ''}{tokenData.priceChange24h.toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <div className="ticker-coming-soon">
                  <span className="badge-dot"></span>
                  $ARGUS — Token Launching Soon
                </div>
              )}
            </div>

            <div className="hero-actions">
              <a href="https://app.argusguard.io" className="btn btn-primary">Start Detecting Bundles</a>
              <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                <svg style={{ marginRight: 8 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                View Source
              </a>
            </div>

            {/* UI MOCKUP */}
            <div className="ui-mockup">
              <div className="ui-header">
                <div className="ui-dots">
                  <div className="ui-dot red"></div>
                  <div className="ui-dot yellow"></div>
                  <div className="ui-dot green"></div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Argus AI</div>
              </div>
              <div className="ui-body">
                {/* Search Bar */}
                <div className="ui-search">
                  <div className="ui-search-input">Enter token address...</div>
                  <div className="ui-search-btn">Analyze</div>
                </div>

                {/* Token Header */}
                <div className="ui-token-header">
                  <div className="ui-token-info">
                    <div className="ui-token-icon">BO</div>
                    <div>
                      <div className="ui-token-name">$BONK</div>
                      <div className="ui-token-addr">DezX...5gkR</div>
                    </div>
                  </div>
                  <div className="ui-signal">
                    <div className="ui-signal-badge">BUY</div>
                    <div className="ui-score">72</div>
                  </div>
                </div>

                {/* Cards */}
                <div className="ui-cards">
                  <div className="ui-card">
                    <div className="ui-card-title">Security</div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">Mint Authority</span>
                      <span className="ui-card-value green">Revoked</span>
                    </div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">Freeze Authority</span>
                      <span className="ui-card-value green">Revoked</span>
                    </div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">LP Locked</span>
                      <span className="ui-card-value">100%</span>
                    </div>
                  </div>

                  <div className="ui-card">
                    <div className="ui-card-title">Market</div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">Market Cap</span>
                      <span className="ui-card-value">$1.2B</span>
                    </div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">Liquidity</span>
                      <span className="ui-card-value">$45.2M</span>
                    </div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">24h Change</span>
                      <span className="ui-card-value green">+12.5%</span>
                    </div>
                  </div>

                  <div className="ui-card">
                    <div className="ui-card-title">Activity</div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">Buys (1h)</span>
                      <span className="ui-card-value green">1,234</span>
                    </div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">Sells (1h)</span>
                      <span className="ui-card-value red">456</span>
                    </div>
                    <div className="ui-card-row">
                      <span className="ui-card-label">Buy Ratio</span>
                      <span className="ui-card-value">2.7:1</span>
                    </div>
                  </div>
                </div>

                {/* Holders */}
                <div className="ui-holders">
                  <div className="ui-holders-header">
                    <div className="ui-card-title" style={{ marginBottom: 0 }}>Top Holders</div>
                    <div className="ui-bundle-badge">2 BUNDLES</div>
                  </div>
                  <div className="ui-holder-row">
                    <div className="ui-holder-bar"><div className="ui-holder-fill normal" style={{ width: '45%' }}></div></div>
                    <span className="ui-holder-pct">24.5%</span>
                  </div>
                  <div className="ui-holder-row">
                    <div className="ui-holder-bar"><div className="ui-holder-fill normal" style={{ width: '24%' }}></div></div>
                    <span className="ui-holder-pct">12.1%</span>
                  </div>
                  <div className="ui-holder-row">
                    <div className="ui-holder-bar"><div className="ui-holder-fill bundle" style={{ width: '16%' }}></div></div>
                    <span className="ui-holder-pct bundle">8.3%</span>
                  </div>
                  <div className="ui-holder-row">
                    <div className="ui-holder-bar"><div className="ui-holder-fill bundle" style={{ width: '16%' }}></div></div>
                    <span className="ui-holder-pct bundle">8.2%</span>
                  </div>
                </div>

                {/* Buy Controls */}
                <div className="ui-buy">
                  <div className="ui-amounts">
                    <div className="ui-amount">0.01 SOL</div>
                    <div className="ui-amount active">0.05 SOL</div>
                    <div className="ui-amount">0.1 SOL</div>
                    <div className="ui-amount">0.25 SOL</div>
                  </div>
                  <div className="ui-buy-btn">Buy $BONK</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* STATS */}
        <section className="stats">
          <div className="container">
            <div className="stats-grid">
              <div>
                <div className="stat-value">10,000+</div>
                <div className="stat-label">Tokens Analyzed</div>
              </div>
              <div>
                <div className="stat-value">500+</div>
                <div className="stat-label">Bundles Detected</div>
              </div>
              <div>
                <div className="stat-value">&lt;3s</div>
                <div className="stat-label">Analysis Time</div>
              </div>
              <div>
                <div className="stat-value">100%</div>
                <div className="stat-label">Free Data</div>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="features">
          <div className="container">
            <div className="section-header">
              <h2>Stop Getting Rugged</h2>
              <p>Comprehensive analysis tools to detect manipulation before you invest</p>
            </div>

            <div className="feature-grid">
              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div className="card-title">Bundle Detection</div>
                <div className="card-desc">Expose coordinated wallet clusters that indicate insider trading, pump groups, or coordinated dumps. See the manipulation others miss.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <div className="card-title">Auto-Sell Protection</div>
                <div className="card-desc">Set take profit, stop loss, and trailing stops to automatically exit positions. Lock in gains and limit losses while you sleep.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div className="card-title">Security Analysis</div>
                <div className="card-desc">Instant checks on mint/freeze authority, LP lock percentage, and contract risks. Know if the token can be rugpulled.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </div>
                <div className="card-title">One-Click Trading</div>
                <div className="card-desc">Buy tokens directly from the dashboard with your dedicated trading wallet. No popup confirmations, just instant execution.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
                <div className="card-title">Risk Scoring</div>
                <div className="card-desc">Get instant risk scores and trading signals with written analysis explaining the verdict. Make informed decisions fast.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                </div>
                <div className="card-title">Position Tracking</div>
                <div className="card-desc">Monitor all your positions with real-time P&L, entry/exit prices, and easy sell controls. Everything in one dashboard.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                </div>
                <div className="card-title">Price Crash Detection</div>
                <div className="card-desc">Automatically flags tokens that have crashed 30%, 50%, or 80%+. Deterministic guardrails override AI scores to protect you from already-rugged tokens.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div className="card-title">Dev Wallet Tracking</div>
                <div className="card-desc">Analyzes creator wallet age, deployment history, and activity patterns. Unknown or brand-new deployer wallets trigger automatic risk escalation.</div>
              </div>
            </div>
          </div>
        </section>

        {/* TRADING SHOWCASE */}
        <section className="trading-showcase">
          <div className="container">
            <div className="section-header">
              <h2>Trade With Protection</h2>
              <p>Auto-sell shields your positions while you sleep</p>
            </div>

            <div className="ui-mockup" style={{ maxWidth: 900, margin: '0 auto' }}>
              <div className="ui-header">
                <div className="ui-dots">
                  <div className="ui-dot red"></div>
                  <div className="ui-dot yellow"></div>
                  <div className="ui-dot green"></div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Trading Panel</div>
              </div>
              <div className="ui-body">
                {/* Trading Controls */}
                <div className="ui-trade-row">
                  <span className="ui-trade-row-label">Amount:</span>
                  <div className="ui-trade-btn active">0.05 SOL</div>
                  <div className="ui-trade-btn">0.1 SOL</div>
                  <div className="ui-trade-btn">0.2 SOL</div>
                  <div className="ui-trade-btn">0.5 SOL</div>
                  <div className="ui-trade-btn">1 SOL</div>
                  <div className="ui-trade-btn">Custom</div>
                  <div className="ui-trade-actions">
                    <div className="ui-action-sell">Sell STARTUP</div>
                    <div className="ui-action-buy">Buy STARTUP</div>
                  </div>
                </div>

                {/* Settings */}
                <div className="ui-settings-row">
                  <div className="ui-settings-group">
                    <div className="ui-settings-label">Max Slippage</div>
                    <div className="ui-settings-options">
                      <div className="ui-trade-btn">1%</div>
                      <div className="ui-trade-btn active">3%</div>
                      <div className="ui-trade-btn">5%</div>
                      <div className="ui-trade-btn">10%</div>
                    </div>
                  </div>
                  <div className="ui-settings-group">
                    <div className="ui-settings-label">Reserve Balance</div>
                    <div className="ui-settings-options">
                      <div className="ui-trade-btn">0.05 SOL</div>
                      <div className="ui-trade-btn active">0.1 SOL</div>
                      <div className="ui-trade-btn">0.2 SOL</div>
                      <div className="ui-trade-btn">0.5 SOL</div>
                    </div>
                  </div>
                </div>

                {/* Auto-Sell */}
                <div className="ui-autosell">
                  <div className="ui-autosell-header">
                    <div className="ui-autosell-title">Auto-Sell</div>
                    <div className="ui-toggle"></div>
                  </div>
                  <div className="ui-autosell-groups">
                    <div className="ui-autosell-group">
                      <div className="ui-autosell-group-label">Take Profit</div>
                      <div className="ui-autosell-options">
                        <div className="ui-trade-btn active">+50%</div>
                        <div className="ui-trade-btn">+100%</div>
                        <div className="ui-trade-btn">+200%</div>
                        <div className="ui-trade-btn">+500%</div>
                      </div>
                    </div>
                    <div className="ui-autosell-group">
                      <div className="ui-autosell-group-label">Stop Loss</div>
                      <div className="ui-autosell-options">
                        <div className="ui-trade-btn">-20%</div>
                        <div className="ui-trade-btn active-red">-30%</div>
                        <div className="ui-trade-btn">-50%</div>
                        <div className="ui-trade-btn">-70%</div>
                      </div>
                    </div>
                    <div className="ui-autosell-group">
                      <div className="ui-autosell-group-label">Trailing Stop</div>
                      <div className="ui-autosell-options">
                        <div className="ui-trade-btn">Off</div>
                        <div className="ui-trade-btn">-10%</div>
                        <div className="ui-trade-btn">-20%</div>
                        <div className="ui-trade-btn active-red">-30%</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Positions */}
                <div className="ui-positions">
                  <div className="ui-positions-header">
                    <div className="ui-positions-title">
                      Your Positions
                      <span className="ui-positions-badge">1</span>
                    </div>
                    <div className="ui-positions-summary">
                      <span>25 trades</span>
                      <span className="ui-positions-pnl">-0.1706 SOL</span>
                      <div className="ui-pos-actions">
                        <div className="ui-pos-action-btn sell">Sell All</div>
                        <div className="ui-pos-action-btn clear">Clear All</div>
                      </div>
                    </div>
                  </div>
                  <table className="ui-positions-table">
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Entry</th>
                        <th>Current</th>
                        <th>P&L</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="token-name">STARTUP</td>
                        <td>0.0522 SOL</td>
                        <td>0.0564 SOL</td>
                        <td className="pnl-positive">+8.1%</td>
                        <td><div className="ui-pos-sell-btn">Sell</div></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="how-it-works">
          <div className="container">
            <div className="section-header">
              <h2>How It Works</h2>
              <p>Expose insider trading in four simple steps</p>
            </div>

            <div className="steps-grid">
              <div className="step">
                <div className="step-number">1</div>
                <div className="step-title">Paste Address</div>
                <div className="step-desc">Enter any Solana token mint address into the search bar</div>
              </div>
              <div className="step">
                <div className="step-number">2</div>
                <div className="step-title">Detect Bundles</div>
                <div className="step-desc">Algorithm analyzes holder patterns to find coordinated wallet clusters</div>
              </div>
              <div className="step">
                <div className="step-number">3</div>
                <div className="step-title">Review Analysis</div>
                <div className="step-desc">See security status, bundle warnings, and risk assessment</div>
              </div>
              <div className="step">
                <div className="step-number">4</div>
                <div className="step-title">Trade Smart</div>
                <div className="step-desc">Buy with confidence or avoid the rug—your choice</div>
              </div>
            </div>
          </div>
        </section>

        {/* WHY ARGUS - COMPETITIVE COMPARISON */}
        <section id="compare" className="comparison">
          <div className="container">
            <div className="section-header">
              <div className="category-badge">Research-to-Trade Platform</div>
              <h2>One Tool, Not Five</h2>
              <p>Other traders juggle RugCheck, DexScreener, Bubble Maps, a DEX, and a price tracker. Argus replaces them all in a single interface.</p>
            </div>

            <div className="comparison-table-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>RugCheck</th>
                    <th>DexScreener</th>
                    <th>Bubble Maps</th>
                    <th>Sniper Bots</th>
                    <th className="highlight">Argus</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><i className="fa-solid fa-shield-halved" style={{ marginRight: 8, color: 'var(--text-muted)' }}></i>Security Analysis</td>
                    <td><span className="check"><i className="fa-solid fa-check"></i></span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td className="highlight"><span className="check"><i className="fa-solid fa-check"></i></span></td>
                  </tr>
                  <tr>
                    <td><i className="fa-solid fa-chart-line" style={{ marginRight: 8, color: 'var(--text-muted)' }}></i>Market Data</td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="check"><i className="fa-solid fa-check"></i></span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td className="highlight"><span className="check"><i className="fa-solid fa-check"></i></span></td>
                  </tr>
                  <tr>
                    <td><i className="fa-solid fa-users-between-lines" style={{ marginRight: 8, color: 'var(--text-muted)' }}></i>Same-Block Bundle Detection</td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td className="highlight"><span className="exclusive">ONLY ARGUS</span></td>
                  </tr>
                  <tr>
                    <td><i className="fa-solid fa-chart-line" style={{ marginRight: 8, color: 'var(--text-muted)' }}></i>Price Crash Guardrails</td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td className="highlight"><span className="exclusive">ONLY ARGUS</span></td>
                  </tr>
                  <tr>
                    <td><i className="fa-solid fa-bolt" style={{ marginRight: 8, color: 'var(--text-muted)' }}></i>One-Click Trading</td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="check"><i className="fa-solid fa-check"></i></span></td>
                    <td className="highlight"><span className="check"><i className="fa-solid fa-check"></i></span></td>
                  </tr>
                  <tr>
                    <td><i className="fa-solid fa-lock" style={{ marginRight: 8, color: 'var(--text-muted)' }}></i>Auto-Sell Protection</td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td className="highlight"><span className="exclusive">ONLY ARGUS</span></td>
                  </tr>
                  <tr>
                    <td><i className="fa-solid fa-brain" style={{ marginRight: 8, color: 'var(--text-muted)' }}></i>AI Risk Scoring</td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td><span className="dash">&mdash;</span></td>
                    <td className="highlight"><span className="exclusive">ONLY ARGUS</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="comparison-callout">
              <div className="callout-icon">
                <i className="fa-solid fa-lightbulb"></i>
              </div>
              <div className="callout-content">
                <h4>You're not comparing apples to apples</h4>
                <p>
                  RugCheck does security. DexScreener does charts. Sniper bots do trading. Nobody combines research <em>and</em> execution in one place. Argus is the first <strong>Research-to-Trade</strong> platform&mdash;analyze a token and act on it instantly, with auto-sell protecting your position. No more tab-hopping between five different tools.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* TOKEN TEASER */}
        <section id="token" className="token-teaser">
          <div className="container">
            <div className="teaser-content">
              <div className="teaser-badge">
                🔥 COMING SOON
              </div>
              <h2>$ARGUS Token Launch</h2>
              <p>
                Early holders gain access to premium features, reduced trading fees, and governance rights.
                Position yourself before the public launch for maximum upside.
              </p>

              <div className="ca-box">
                <div className="ca-label">Contract Address</div>
                <div className="ca-address">TBA - Launching Soon</div>
              </div>

              <div className="teaser-benefits">
                <div className="benefit-item">
                  <div className="benefit-icon"><i className="fa-solid fa-gem"></i></div>
                  <div className="benefit-title">Premium Features</div>
                  <div className="benefit-desc">Advanced analytics, unlimited scans, priority support</div>
                </div>
                <div className="benefit-item">
                  <div className="benefit-icon"><i className="fa-solid fa-coins"></i></div>
                  <div className="benefit-title">Revenue Share</div>
                  <div className="benefit-desc">Earn from platform trading fees as a holder</div>
                </div>
                <div className="benefit-item">
                  <div className="benefit-icon"><i className="fa-solid fa-check-to-slot"></i></div>
                  <div className="benefit-title">Governance Rights</div>
                  <div className="benefit-desc">Vote on protocol upgrades and feature priorities</div>
                </div>
              </div>

              <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Regulation tokenomics incoming. Early investors could see significant upside as platform adoption grows.
              </p>
            </div>
          </div>
        </section>

        {/* TOKENOMICS */}
        <section id="tokenomics" className="tokenomics">
          <div className="container">
            <div className="section-header">
              <h2>Tokenomics</h2>
              <p>Fair launch with community-first distribution</p>
            </div>

            <div className="token-grid">
              <div className="token-info">
                <h3>$ARGUS Token</h3>
                <p>
                  The $ARGUS token powers the ecosystem, providing holders with premium features,
                  reduced trading fees, and governance rights over protocol decisions.
                </p>
                <div className="token-stats">
                  <div className="token-stat">
                    <div className="token-stat-value">1B</div>
                    <div className="token-stat-label">Total Supply</div>
                  </div>
                  <div className="token-stat">
                    <div className="token-stat-value">0%</div>
                    <div className="token-stat-label">Buy/Sell Tax</div>
                  </div>
                  <div className="token-stat">
                    <div className="token-stat-value">100%</div>
                    <div className="token-stat-label">LP Locked</div>
                  </div>
                  <div className="token-stat">
                    <div className="token-stat-value">Revoked</div>
                    <div className="token-stat-label">Mint Authority</div>
                  </div>
                </div>
              </div>

              <div className="token-chart">
                <div className="chart-title">Token Distribution</div>
                <div className="chart-bars">
                  <div className="chart-bar">
                    <span className="chart-label">Community</span>
                    <div className="chart-track">
                      <div className="chart-fill community" style={{ width: '50%' }}>50%</div>
                    </div>
                  </div>
                  <div className="chart-bar">
                    <span className="chart-label">Liquidity</span>
                    <div className="chart-track">
                      <div className="chart-fill liquidity" style={{ width: '25%' }}>25%</div>
                    </div>
                  </div>
                  <div className="chart-bar">
                    <span className="chart-label">Development</span>
                    <div className="chart-track">
                      <div className="chart-fill development" style={{ width: '15%' }}>15%</div>
                    </div>
                  </div>
                  <div className="chart-bar">
                    <span className="chart-label">Team</span>
                    <div className="chart-track">
                      <div className="chart-fill team" style={{ width: '10%' }}>10%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ROADMAP */}
        <section id="roadmap" className="roadmap">
          <div className="container">
            <div className="section-header">
              <h2>Roadmap</h2>
              <p>Our vision for the future of token research</p>
            </div>

            <div className="roadmap-grid">
              <div className="roadmap-card active">
                <div className="roadmap-phase">Phase 1 - Current</div>
                <div className="roadmap-title">Foundation</div>
                <div className="roadmap-list">
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Bundle detection system</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Security analysis</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Auto-sell protection</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>One-click trading</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Price crash &amp; sell pressure guardrails</span>
                  </div>
                </div>
              </div>

              <div className="roadmap-card">
                <div className="roadmap-phase">Phase 2</div>
                <div className="roadmap-title">Enhancement</div>
                <div className="roadmap-list">
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>$ARGUS token launch</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Wallet tracking</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Price alerts</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Mobile app</span>
                  </div>
                </div>
              </div>

              <div className="roadmap-card">
                <div className="roadmap-phase">Phase 3</div>
                <div className="roadmap-title">Expansion</div>
                <div className="roadmap-list">
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Multi-chain support</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Advanced detection models</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>DAO governance</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Enterprise features</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TEAM */}
        <section id="team" className="team">
          <div className="container">
            <div className="section-header">
              <h2>Meet the Team</h2>
              <p>Building the future of token research</p>
            </div>

            <div className="team-grid">
              <div className="team-card">
                <div className="team-avatar">JH</div>
                <div className="team-name">Jessie H.</div>
                <div className="team-role">Founder & Lead Dev</div>
                <div className="team-bio">Full-stack developer with a passion for DeFi and AI technologies.</div>
                <div className="team-social">
                  <a href="https://x.com/ArgusPanoptes7z" target="_blank" rel="noopener noreferrer" aria-label="Twitter">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  </a>
                  <a href="https://t.me/ArgusAIAlerts" target="_blank" rel="noopener noreferrer" aria-label="Telegram">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                  </a>
                  <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  </a>
                </div>
              </div>

              <div className="team-card">
                <div className="team-avatar">AI</div>
                <div className="team-name">Claude</div>
                <div className="team-role">AI Assistant</div>
                <div className="team-bio">Anthropic's AI model helping build intelligent DeFi tools.</div>
                <div className="team-social">
                  <a href="https://anthropic.com" target="_blank" rel="noopener noreferrer" aria-label="Website">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </a>
                </div>
              </div>

              <div className="team-card">
                <div className="team-avatar">OS</div>
                <div className="team-name">Open Source</div>
                <div className="team-role">Community</div>
                <div className="team-bio">Built with love by the open source community.</div>
                <div className="team-social">
                  <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  </a>
                </div>
              </div>

              <div className="team-card">
                <div className="team-avatar">+</div>
                <div className="team-name">You?</div>
                <div className="team-role">Contributor</div>
                <div className="team-bio">Join us! We're always looking for contributors.</div>
                <div className="team-social">
                  <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="cta">
          <div className="container">
            <h2>Ready to Stop Getting Rugged?</h2>
            <p>Start detecting coordinated dumps before they happen.</p>
            <a href="https://app.argusguard.io" className="btn btn-accent">Launch App</a>
          </div>
        </section>

        {/* FOOTER */}
        <footer>
          <div className="container">
            <div className="footer-logo">
              <div className="logo-icon">
                <Logo />
              </div>
              <span>ARGUS<span style={{ fontWeight: 300 }}>AI</span></span>
            </div>
            <div className="footer-links">
              <a href="#features">Features</a>
              <a href="#token">Token</a>
              <a href="#roadmap">Roadmap</a>
              <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://x.com/ArgusPanoptes7z" target="_blank" rel="noopener noreferrer">Twitter</a>
              <a href="https://t.me/ArgusAIAlerts" target="_blank" rel="noopener noreferrer">Telegram</a>
            </div>
            <div className="copyright">
              2026 Argus AI. Open Source under MIT License.
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}