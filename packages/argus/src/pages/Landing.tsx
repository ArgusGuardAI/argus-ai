const styles = `
  /* --- DESIGN TOKENS (LIGHT THEME) --- */
  .landing-page {
    --bg-body: #FAFAFA;
    --bg-card: #FFFFFF;
    --text-main: #09090B;
    --text-muted: #71717A;
    --primary: #000000;
    --accent: #4F46E5;
    --border: #E4E4E7;
    --border-light: #F4F4F5;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 16px;
    --font-main: 'Inter', sans-serif;
    --max-width: 1200px;

    background-color: var(--bg-body);
    color: var(--text-main);
    font-family: var(--font-main);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }

  .landing-page * { box-sizing: border-box; }
  .landing-page a { text-decoration: none; color: inherit; transition: color 0.2s; }
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
    padding: 12px 24px;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: -0.01em;
  }

  .landing-page .btn-black {
    background-color: var(--primary);
    color: white;
    border: 1px solid var(--primary);
  }

  .landing-page .btn-black:hover {
    background-color: #27272a;
  }

  .landing-page .btn-outline {
    background-color: transparent;
    color: var(--text-main);
    border: 1px solid var(--border);
  }

  .landing-page .btn-outline:hover {
    border-color: var(--text-main);
  }

  .landing-page .badge {
    display: inline-block;
    padding: 6px 12px;
    background: #F4F4F5;
    color: var(--text-main);
    border-radius: 99px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 24px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border: 1px solid var(--border);
  }

  /* --- HEADER --- */
  .landing-page header {
    position: sticky;
    top: 0;
    width: 100%;
    z-index: 100;
    background: rgba(250, 250, 250, 0.8);
    backdrop-filter: blur(8px);
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
    gap: 10px;
    font-weight: 800;
    font-size: 1.25rem;
    letter-spacing: -0.03em;
  }

  .landing-page .logo-icon {
    position: relative;
    width: 32px;
    height: 32px;
  }

  .landing-page .nav-links {
    display: flex;
    gap: 32px;
  }

  .landing-page .nav-links a {
    font-size: 0.9rem;
    color: var(--text-muted);
    font-weight: 400;
  }

  .landing-page .nav-links a:hover { color: var(--text-main); }

  /* --- HERO --- */
  .landing-page .hero {
    padding: 140px 0 80px;
    text-align: center;
  }

  .landing-page .hero h1 {
    font-size: 4.5rem;
    line-height: 1.05;
    font-weight: 800;
    letter-spacing: -0.04em;
    margin-bottom: 24px;
    color: var(--primary);
  }

  .landing-page .hero p {
    font-size: 1.25rem;
    color: var(--text-muted);
    font-weight: 300;
    max-width: 540px;
    margin: 0 auto 40px;
    line-height: 1.6;
  }

  .landing-page .hero-actions {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-bottom: 80px;
  }

  /* --- DASHBOARD UI MOCKUP --- */
  .landing-page .ui-mockup {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 4px;
    box-shadow: 0 20px 40px -10px rgba(0,0,0,0.08);
    max-width: 1000px;
    margin: 0 auto;
    overflow: hidden;
  }

  .landing-page .ui-header {
    height: 50px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 20px;
    justify-content: space-between;
  }

  .landing-page .ui-dots { display: flex; gap: 6px; }
  .landing-page .ui-dot { width: 10px; height: 10px; border-radius: 50%; background: #E4E4E7; }
  .landing-page .ui-dot.red { background: #FECACA; }
  .landing-page .ui-dot.yellow { background: #FDE68A; }
  .landing-page .ui-dot.green { background: #BBF7D0; }

  .landing-page .ui-body {
    display: grid;
    grid-template-columns: 250px 1fr 250px;
    height: 500px;
  }

  .landing-page .ui-sidebar {
    border-right: 1px solid var(--border);
    padding: 20px;
    background: #FAFAFA;
  }
  .landing-page .ui-nav-item { padding: 8px 12px; font-size: 0.85rem; border-radius: 4px; color: var(--text-muted); margin-bottom: 4px; cursor: pointer; }
  .landing-page .ui-nav-item.active { background: white; color: var(--text-main); font-weight: 500; border: 1px solid var(--border); }

  .landing-page .ui-main {
    padding: 24px;
    background: white;
  }

  .landing-page .ui-stats-row { display: flex; justify-content: space-between; margin-bottom: 24px; }
  .landing-page .ui-stat-box { background: #FAFAFA; padding: 16px; border-radius: var(--radius-sm); flex: 1; margin-right: 12px; border: 1px solid var(--border); }
  .landing-page .ui-stat-label { font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; font-weight: 600; }
  .landing-page .ui-stat-val { font-size: 1.25rem; font-weight: 600; margin-top: 4px; }
  .landing-page .ui-stat-sub { font-size: 0.75rem; color: #10B981; font-weight: 500; }

  .landing-page .ui-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .landing-page .ui-table th { text-align: left; padding: 12px 8px; color: var(--text-muted); font-weight: 500; border-bottom: 1px solid var(--border); font-size: 0.75rem; }
  .landing-page .ui-table td { padding: 16px 8px; border-bottom: 1px solid var(--border-light); font-weight: 400; }
  .landing-page .ui-table tr:last-child td { border-bottom: none; }
  .landing-page .risk-badge { background: #DCFCE7; color: #166534; padding: 2px 8px; border-radius: 99px; font-size: 0.7rem; font-weight: 600; }

  .landing-page .ui-right {
    border-left: 1px solid var(--border);
    padding: 20px;
    background: #FAFAFA;
  }
  .landing-page .ui-title { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 16px; letter-spacing: 0.05em; }
  .landing-page .ui-setting { margin-bottom: 20px; }
  .landing-page .ui-set-label { display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 6px; font-weight: 500; }
  .landing-page .ui-slider { height: 4px; background: #E4E4E7; border-radius: 2px; width: 100%; position: relative; }
  .landing-page .ui-slider-fill { height: 100%; border-radius: 2px; }

  /* --- FEATURES GRID --- */
  .landing-page .features {
    padding: 120px 0;
    border-top: 1px solid var(--border);
  }

  .landing-page .section-header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    margin-bottom: 80px;
  }

  .landing-page .section-title h2 {
    font-size: 2.5rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.1;
    margin-bottom: 16px;
  }

  .landing-page .section-desc {
    font-size: 1.1rem;
    color: var(--text-muted);
    font-weight: 300;
    padding-top: 20px;
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
    transition: transform 0.2s;
  }

  .landing-page .feature-card:hover {
    border-color: var(--text-main);
    transform: translateY(-4px);
  }

  .landing-page .icon-bg {
    width: 48px;
    height: 48px;
    background: #F4F4F5;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
    color: var(--text-main);
  }

  .landing-page .card-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 12px;
    letter-spacing: -0.01em;
  }

  .landing-page .card-desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
    font-weight: 300;
  }

  /* --- TECH SPECS --- */
  .landing-page .specs {
    padding: 80px 0;
    background: var(--bg-card);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .landing-page .code-block {
    background: #09090B;
    color: #E4E4E7;
    padding: 24px;
    border-radius: var(--radius-md);
    font-family: 'SF Mono', 'Menlo', monospace;
    font-size: 0.85rem;
    max-width: 500px;
    margin: 0 auto 40px;
  }

  .landing-page .command { color: #A78BFA; }

  .landing-page .tech-grid {
    display: flex;
    justify-content: center;
    gap: 48px;
    flex-wrap: wrap;
  }
  .landing-page .tech-item { font-weight: 600; font-size: 0.9rem; color: var(--text-muted); }
  .landing-page .tech-item strong { color: var(--text-main); }

  /* --- FOOTER --- */
  .landing-page footer {
    padding: 80px 0 40px;
    text-align: center;
  }

  .landing-page .footer-logo {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
    font-size: 1.5rem;
    margin-bottom: 24px;
  }

  .landing-page .footer-links {
    display: flex;
    justify-content: center;
    gap: 32px;
    margin-bottom: 48px;
  }

  .landing-page .footer-links a {
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .landing-page .copyright {
    font-size: 0.8rem;
    color: #A1A1AA;
  }

  /* --- RESPONSIVE --- */
  @media (max-width: 900px) {
    .landing-page .hero h1 { font-size: 3rem; }
    .landing-page .ui-body { grid-template-columns: 1fr; }
    .landing-page .ui-sidebar, .landing-page .ui-right { display: none; }
    .landing-page .feature-grid { grid-template-columns: 1fr; }
    .landing-page .section-header { grid-template-columns: 1fr; }
  }
`;

const Logo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 2L30 28H2L16 2Z" stroke="#000" strokeWidth="1.5" fill="none"/>
    <ellipse cx="16" cy="16" rx="7" ry="5" stroke="#000" strokeWidth="1.5" fill="white"/>
    <circle cx="16" cy="16" r="2.5" fill="#000"/>
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
                <a href="#risk">Risk Analysis</a>
                <a href="#wallet">Security</a>
                <a href="#docs">Docs</a>
              </div>
              <span className="btn btn-black" style={{ opacity: 0.5, cursor: 'not-allowed' }}>Launch Dashboard</span>
            </nav>
          </div>
        </header>

        {/* HERO SECTION */}
        <section className="hero">
          <div className="container">
            <div className="badge">v2.0 Live on Solana</div>
            <h1>Automated Trading.<br/>Zero Interference.</h1>
            <p>
              Argus is a sophisticated AI sniper for Solana tokens.
              Real-time token scanning, AI risk scoring, and dedicated wallet automation in a lightweight dashboard.
            </p>

            <div className="hero-actions">
              <span className="btn btn-black" style={{ opacity: 0.5, cursor: 'not-allowed' }}>Get Started</span>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                <svg style={{ marginRight: 8 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                View Source
              </a>
            </div>

            {/* LIGHT MODE UI MOCKUP */}
            <div className="ui-mockup">
              <div className="ui-header">
                <div className="ui-dots">
                  <div className="ui-dot red"></div>
                  <div className="ui-dot yellow"></div>
                  <div className="ui-dot green"></div>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#71717A', fontWeight: 500 }}>localhost:3000</div>
              </div>
              <div className="ui-body">
                {/* Sidebar */}
                <div className="ui-sidebar">
                  <div className="ui-nav-item active">Dashboard</div>
                  <div className="ui-nav-item">Positions</div>
                  <div className="ui-nav-item">Settings</div>
                  <div className="ui-nav-item">Wallet</div>
                </div>

                {/* Main Content */}
                <div className="ui-main">
                  <div className="ui-stats-row">
                    <div className="ui-stat-box">
                      <div className="ui-stat-label">Balance</div>
                      <div className="ui-stat-val">124.5 SOL</div>
                      <div className="ui-stat-sub">+$420.00 today</div>
                    </div>
                    <div className="ui-stat-box">
                      <div className="ui-stat-label">Active Trades</div>
                      <div className="ui-stat-val">3</div>
                    </div>
                    <div className="ui-stat-box">
                      <div className="ui-stat-label">Status</div>
                      <div className="ui-stat-val" style={{ color: '#10B981' }}>Scanning</div>
                    </div>
                  </div>

                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Risk Score</th>
                        <th>Entry</th>
                        <th>P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>PEPE</strong></td>
                        <td><span className="risk-badge">12</span></td>
                        <td>0.042</td>
                        <td style={{ color: '#10B981' }}>+14.2%</td>
                      </tr>
                      <tr>
                        <td><strong>WIF</strong></td>
                        <td><span className="risk-badge">24</span></td>
                        <td>2.10</td>
                        <td style={{ color: '#EF4444' }}>-2.1%</td>
                      </tr>
                      <tr>
                        <td><strong>BONK</strong></td>
                        <td><span className="risk-badge">08</span></td>
                        <td>0.00001</td>
                        <td style={{ color: '#10B981' }}>+0.5%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Right Panel Settings */}
                <div className="ui-right">
                  <div className="ui-title">Auto-Sell</div>

                  <div className="ui-setting">
                    <div className="ui-set-label"><span>Take Profit</span><span>100%</span></div>
                    <div className="ui-slider"><div className="ui-slider-fill" style={{ width: '60%', background: '#000' }}></div></div>
                  </div>

                  <div className="ui-setting">
                    <div className="ui-set-label"><span>Stop Loss</span><span>30%</span></div>
                    <div className="ui-slider"><div className="ui-slider-fill" style={{ width: '20%', background: '#EF4444' }}></div></div>
                  </div>

                  <div className="ui-setting">
                    <div className="ui-set-label"><span>Trailing Stop</span><span>20%</span></div>
                    <div className="ui-slider"><div className="ui-slider-fill" style={{ width: '30%', background: '#F59E0B' }}></div></div>
                  </div>

                  <div style={{ marginTop: 40, padding: 12, background: 'white', border: '1px solid #E4E4E7', borderRadius: 4, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: '#71717A', fontWeight: 600, marginBottom: 4 }}>NEXT TRADE</div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>Waiting for Signal...</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="features">
          <div className="container">
            <div className="section-header">
              <div className="section-title">
                <h2>Precision tools<br/>for DeFi.</h2>
              </div>
              <div className="section-desc">
                Designed to remove emotion from trading. Argus manages the technical execution so you can focus on strategy.
              </div>
            </div>

            <div className="feature-grid">
              {/* Feature 1 */}
              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
                <div className="card-title">DexScreener Scanner</div>
                <div className="card-desc">Real-time token feed from DexScreener. Tracks trending and boosted tokens with fast latency monitoring.</div>
              </div>

              {/* Feature 2 */}
              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div className="card-title">AI Risk Analysis</div>
                <div className="card-desc">Algorithmic scoring from 0-100. We analyze liquidity locks, holder distribution, and contract metadata instantly.</div>
              </div>

              {/* Feature 3 */}
              <div className="feature-card">
                <div className="icon-bg">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><path d="m9 16 3-3 3 3"/></svg>
                </div>
                <div className="card-title">Dedicated Wallet</div>
                <div className="card-desc">An encrypted trading wallet stored locally. Signs transactions instantly without popups. Your main wallet stays safe.</div>
              </div>
            </div>
          </div>
        </section>

        {/* SPECS / DEV INFO */}
        <section className="specs">
          <div className="container" style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 32 }}>Built for Developers & Traders</h2>

            <div className="code-block">
              <div><span className="command">$</span> pnpm install</div>
              <div style={{ marginTop: 8 }}><span className="command">$</span> pnpm dev</div>
              <div style={{ marginTop: 16, color: '#71717A' }}># Ready at http://localhost:3000</div>
            </div>

            <div className="tech-grid">
              <div className="tech-item"><strong>React 18</strong> Core</div>
              <div className="tech-item"><strong>Tailwind</strong> Styling</div>
              <div className="tech-item"><strong>Jupiter</strong> Aggregator</div>
              <div className="tech-item"><strong>Web3.js</strong> Signing</div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer>
          <div className="container">
            <a href="#" className="footer-logo">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 2L30 28H2L16 2Z" stroke="#000" strokeWidth="1.5" fill="none"/>
                <ellipse cx="16" cy="16" rx="7" ry="5" stroke="#000" strokeWidth="1.5" fill="white"/>
                <circle cx="16" cy="16" r="2.5" fill="#000"/>
              </svg>
              <span>ARGUS<span style={{ fontWeight: 300 }}>AI</span></span>
            </a>
            <div className="footer-links">
              <a href="#">Documentation</a>
              <a href="#">Terms</a>
              <a href="#">Privacy</a>
              <a href="#">Discord</a>
            </div>
            <div className="copyright">
              &copy; 2026 Argus AI. Open Source.
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
