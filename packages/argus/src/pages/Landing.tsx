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

  /* --- RESPONSIVE --- */
  @media (max-width: 900px) {
    .landing-page .hero h1 { font-size: 2.5rem; }
    .landing-page .ui-cards { grid-template-columns: 1fr; }
    .landing-page .feature-grid { grid-template-columns: 1fr; }
    .landing-page .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .landing-page .nav-links { display: none; }
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
                <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
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
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="#">Documentation</a>
              <a href="#">Twitter</a>
              <a href="#">Discord</a>
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
