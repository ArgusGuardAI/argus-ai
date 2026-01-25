const styles = `
  /* --- DESIGN TOKENS (LIGHT THEME) --- */
  .landing-page {
    --bg-body: #FAFAFA;
    --bg-card: #FFFFFF;
    --text-main: #09090B;
    --text-muted: #71717A;
    --primary: #000000;
    --accent: #10B981;
    --border: #E4E4E7;
    --border-light: #F4F4F5;
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

  .landing-page .btn-black {
    background: linear-gradient(135deg, #09090B 0%, #27272A 100%);
    color: white;
    border: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }

  .landing-page .btn-black:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.2);
  }

  .landing-page .btn-outline {
    background-color: white;
    color: var(--text-main);
    border: 1px solid var(--border);
  }

  .landing-page .btn-outline:hover {
    border-color: var(--text-main);
    background: var(--border-light);
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
    background: rgba(250, 250, 250, 0.85);
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
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #09090B 0%, #27272A 100%);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
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
    background: var(--border-light);
  }

  .landing-page .ui-dots { display: flex; gap: 6px; }
  .landing-page .ui-dot { width: 10px; height: 10px; border-radius: 50%; }
  .landing-page .ui-dot.red { background: #FCA5A5; }
  .landing-page .ui-dot.yellow { background: #FCD34D; }
  .landing-page .ui-dot.green { background: #6EE7B7; }

  .landing-page .ui-body {
    padding: 24px;
    background: white;
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
    background: var(--border-light);
  }

  .landing-page .ui-search-btn {
    padding: 14px 24px;
    background: var(--primary);
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
    background: var(--border-light);
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
    background: var(--border-light);
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
    background: #E4E4E7;
    border-radius: 4px;
    overflow: hidden;
  }

  .landing-page .ui-holder-fill {
    height: 100%;
    border-radius: 4px;
  }

  .landing-page .ui-holder-fill.normal { background: #09090B; }
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
    background: white;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .landing-page .ui-amount.active {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
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
    border-color: var(--text-main);
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0,0,0,0.08);
  }

  .landing-page .icon-bg {
    width: 52px;
    height: 52px;
    background: var(--border-light);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    color: var(--text-main);
  }

  .landing-page .card-title {
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 10px;
    letter-spacing: -0.01em;
  }

  .landing-page .card-desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  /* --- STATS --- */
  .landing-page .stats {
    padding: 60px 0;
    background: var(--bg-card);
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
  }

  .landing-page .stat-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    font-weight: 500;
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
    background: var(--bg-card);
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
    background: var(--border-light);
    padding: 20px;
    border-radius: var(--radius-md);
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
    background: var(--border-light);
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
    background: var(--bg-card);
    border-top: 1px solid var(--border);
  }

  .landing-page .roadmap-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }

  .landing-page .roadmap-card {
    background: var(--bg-body);
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
    background: var(--border-light);
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
    background: linear-gradient(135deg, var(--border-light) 0%, var(--border) 100%);
    border-radius: 50%;
    margin: 0 auto 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.5rem;
    font-weight: 800;
    color: var(--text-muted);
  }

  .landing-page .team-name {
    font-size: 1.1rem;
    font-weight: 700;
    margin-bottom: 4px;
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
    background: var(--border-light);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .landing-page .team-social a:hover {
    background: var(--primary);
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
    color: white;
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

  /* --- RESPONSIVE --- */
  @media (max-width: 900px) {
    .landing-page .hero h1 { font-size: 2.5rem; }
    .landing-page .ui-cards { grid-template-columns: 1fr; }
    .landing-page .feature-grid { grid-template-columns: 1fr; }
    .landing-page .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .landing-page .nav-links { display: none; }
    .landing-page .steps-grid { grid-template-columns: repeat(2, 1fr); }
    .landing-page .steps-grid::before { display: none; }
    .landing-page .token-grid { grid-template-columns: 1fr; }
    .landing-page .roadmap-grid { grid-template-columns: 1fr; }
    .landing-page .team-grid { grid-template-columns: repeat(2, 1fr); }
  }
`;

const Logo = () => (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
    <path d="M16 4L28 26H4L16 4Z" stroke="white" strokeWidth="2" fill="none"/>
    <ellipse cx="16" cy="16" rx="6" ry="4" stroke="white" strokeWidth="1.5" fill="none"/>
    <circle cx="16" cy="16" r="2" fill="white"/>
  </svg>
);

export default function Landing() {
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
                <a href="#tokenomics">Token</a>
                <a href="#roadmap">Roadmap</a>
              </div>
              <a href="/app" className="btn btn-black">Launch App</a>
            </nav>
          </div>
        </header>

        {/* HERO SECTION */}
        <section className="hero">
          <div className="container">
            <div className="badge">
              <span className="badge-dot"></span>
              Token Research Tool
            </div>
            <h1>Research Tokens.<br/><span>Trade Smarter.</span></h1>
            <p>
              Comprehensive AI analysis for Solana tokens. Security checks, bundle detection,
              holder distribution, and one-click trading in a single dashboard.
            </p>

            <div className="hero-actions">
              <a href="/app" className="btn btn-black">Start Researching</a>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="btn btn-outline">
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
                <div style={{ fontSize: '0.75rem', color: '#71717A', fontWeight: 500 }}>Argus AI</div>
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

        {/* FEATURES */}
        <section id="features" className="features">
          <div className="container">
            <div className="section-header">
              <h2>Everything you need to research tokens</h2>
              <p>Comprehensive analysis tools to make informed trading decisions</p>
            </div>

            <div className="feature-grid">
              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div className="card-title">Security Analysis</div>
                <div className="card-desc">Check mint/freeze authority status, LP lock percentage, and contract risks instantly.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div className="card-title">Bundle Detection</div>
                <div className="card-desc">Identify coordinated wallet clusters that may indicate insider trading or pump groups.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
                <div className="card-title">AI Verdict</div>
                <div className="card-desc">Get instant AI-powered analysis with risk scores and trading signals.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </div>
                <div className="card-title">One-Click Trading</div>
                <div className="card-desc">Buy tokens directly from the dashboard with your dedicated trading wallet.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <div className="card-title">Auto-Sell</div>
                <div className="card-desc">Set take profit, stop loss, and trailing stop to automate your exits.</div>
              </div>

              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                </div>
                <div className="card-title">Position Tracking</div>
                <div className="card-desc">Monitor all your positions with real-time P&L and easy sell controls.</div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="how-it-works">
          <div className="container">
            <div className="section-header">
              <h2>How It Works</h2>
              <p>Research any Solana token in four simple steps</p>
            </div>

            <div className="steps-grid">
              <div className="step">
                <div className="step-number">1</div>
                <div className="step-title">Paste Address</div>
                <div className="step-desc">Enter any Solana token mint address into the search bar</div>
              </div>
              <div className="step">
                <div className="step-number">2</div>
                <div className="step-title">AI Analysis</div>
                <div className="step-desc">Proprietary AI performs deep analysis using trade-secret algorithms</div>
              </div>
              <div className="step">
                <div className="step-number">3</div>
                <div className="step-title">Review Results</div>
                <div className="step-desc">See security status, holder distribution, and risk score</div>
              </div>
              <div className="step">
                <div className="step-number">4</div>
                <div className="step-title">Trade</div>
                <div className="step-desc">Buy with one click using your dedicated trading wallet</div>
              </div>
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
                    <span>Token research dashboard</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>AI-powered analysis</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Bundle detection</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>One-click trading</span>
                  </div>
                </div>
              </div>

              <div className="roadmap-card">
                <div className="roadmap-phase">Phase 2</div>
                <div className="roadmap-title">Enhancement</div>
                <div className="roadmap-list">
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Portfolio analytics</span>
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
                    <span>Advanced AI models</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>DAO governance</span>
                  </div>
                  <div className="roadmap-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                    <span>Premium features</span>
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
                  <a href="#" aria-label="Twitter">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  </a>
                  <a href="#" aria-label="GitHub">
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
                  <a href="https://github.com" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
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
                  <a href="https://github.com" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
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
            <h2>Ready to Research Smarter?</h2>
            <p>Start analyzing tokens with AI-powered insights today.</p>
            <a href="/app" className="btn btn-accent">Launch App</a>
          </div>
        </section>

        {/* STATS */}
        <section className="stats">
          <div className="container">
            <div className="stats-grid">
              <div>
                <div className="stat-value">FREE</div>
                <div className="stat-label">Data Sources</div>
              </div>
              <div>
                <div className="stat-value">&lt;3s</div>
                <div className="stat-label">Analysis Time</div>
              </div>
              <div>
                <div className="stat-value">100%</div>
                <div className="stat-label">Open Source</div>
              </div>
              <div>
                <div className="stat-value">0.5%</div>
                <div className="stat-label">Trading Fee</div>
              </div>
            </div>
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
              <a href="#tokenomics">Token</a>
              <a href="#roadmap">Roadmap</a>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
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
