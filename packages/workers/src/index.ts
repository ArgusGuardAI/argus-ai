import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeRoutes } from './routes/analyze';
import { graffitiRoutes } from './routes/graffiti';
import { walletHistoryRoutes } from './routes/wallet-history';
import { subscriptionRoutes } from './routes/subscription';
import { trendsRoutes } from './routes/trends';

export type Bindings = {
  SCAN_CACHE: KVNamespace;
  TOGETHER_AI_API_KEY: string;
  TOGETHER_AI_MODEL?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  HELIUS_API_KEY?: string;
  WHALESHIELD_MINT?: string; // Token mint address for token gating (optional until launch)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for extension requests
app.use(
  '*',
  cors({
    origin: (origin) => {
      // Allow requests from browser extensions
      if (origin?.startsWith('chrome-extension://')) return origin;
      if (origin?.startsWith('moz-extension://')) return origin;
      // Allow localhost for development
      if (origin?.startsWith('http://localhost')) return origin;
      // Allow whaleshield.io website
      if (origin?.includes('whaleshield.io')) return origin;
      if (origin?.includes('whaleshield.pages.dev')) return origin;
      // Allow requests with no origin (e.g., direct API calls)
      if (!origin) return '*';
      // Default: allow all for public API
      return origin;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: Date.now(),
  });
});

// Privacy policy page
app.get('/privacy', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - WhaleShield</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; line-height: 1.7; padding: 40px 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: #00d4ff; font-size: 2.5rem; margin-bottom: 10px; }
    .subtitle { color: #888; margin-bottom: 40px; }
    h2 { color: #00d4ff; font-size: 1.4rem; margin-top: 40px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(0, 212, 255, 0.2); }
    p, li { margin-bottom: 15px; color: #ccc; }
    ul { padding-left: 25px; }
    li { margin-bottom: 10px; }
    .highlight { background: rgba(0, 212, 255, 0.1); border-left: 3px solid #00d4ff; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
    a { color: #00d4ff; }
    .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="subtitle">Last updated: January 12, 2025</p>
    <div class="highlight">
      <strong>TL;DR:</strong> WhaleShield does not collect, store, or sell your personal data. All analysis happens through our secure API, and we only process the minimum data needed to protect you from scams.
    </div>
    <h2>1. Introduction</h2>
    <p>WhaleShield ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how our browser extension handles information when you use our service to analyze tokens on Pump.fun and other supported platforms.</p>
    <h2>2. Information We Do NOT Collect</h2>
    <ul>
      <li><strong>Personal Information:</strong> We do not collect your name, email, phone number, or any personally identifiable information.</li>
      <li><strong>Browsing History:</strong> We do not track or store your browsing history.</li>
      <li><strong>Wallet Contents:</strong> We do not access, store, or track your wallet balances, transactions, or holdings beyond the single balance check for token gating.</li>
      <li><strong>Cookies or Trackers:</strong> We do not use cookies, analytics, or any third-party tracking services.</li>
    </ul>
    <h2>3. Information We Process</h2>
    <p>To provide our service, we process the following information:</p>
    <ul>
      <li><strong>Token Addresses:</strong> When you visit a token page, we send the token's contract address to our API for analysis. This is necessary to check for honeypots and scams.</li>
      <li><strong>Wallet Address (Token Gating):</strong> We check if your connected wallet holds the required $WHALESHIELD tokens. This check is performed locally and via RPC - we do not store your wallet address on our servers.</li>
      <li><strong>Community Notes:</strong> If you submit a community note, we store the note content, your wallet address (as the author), and the associated token address. This is publicly visible to other users.</li>
      <li><strong>Subscription (Optional):</strong> If you subscribe via Stripe, we store your wallet address linked to your Stripe customer ID to verify your subscription status. Payment processing is handled entirely by Stripe.</li>
    </ul>
    <h2>4. How We Use Information</h2>
    <p>The information we process is used solely to:</p>
    <ul>
      <li>Analyze token contracts for potential risks (honeypots, rug pulls, scams)</li>
      <li>Verify token holder status for premium features</li>
      <li>Display community warnings and notes from other users</li>
    </ul>
    <h2>5. Data Storage and Security</h2>
    <ul>
      <li><strong>Token Analysis Results:</strong> Cached temporarily to improve performance. No personal data is stored.</li>
      <li><strong>Community Notes:</strong> Stored in our database with the author's wallet address for attribution.</li>
      <li><strong>Local Storage:</strong> The extension stores your preferences locally in your browser. This data never leaves your device.</li>
    </ul>
    <h2>6. Third-Party Services</h2>
    <p>We use the following third-party services:</p>
    <ul>
      <li><strong>Solana RPC:</strong> To verify wallet balances and token holdings</li>
      <li><strong>Together AI:</strong> For AI-powered contract analysis (only token contract data is sent, no personal information)</li>
      <li><strong>Cloudflare:</strong> For API hosting and security</li>
      <li><strong>Stripe:</strong> For payment processing (only if you choose to subscribe). Stripe handles all payment data according to their privacy policy.</li>
    </ul>
    <p>These services have their own privacy policies and do not receive any of your personal information from us.</p>
    <h2>7. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Uninstall the extension at any time, which removes all local data</li>
      <li>Request deletion of any community notes you've submitted</li>
      <li>Use the extension without connecting a wallet (with limited features)</li>
    </ul>
    <h2>8. Children's Privacy</h2>
    <p>WhaleShield is not intended for use by anyone under the age of 18. We do not knowingly collect information from minors.</p>
    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify users of any material changes by updating the "Last updated" date at the top of this policy.</p>
    <h2>10. Contact Us</h2>
    <p>If you have any questions about this Privacy Policy, please contact us at:</p>
    <ul>
      <li>Twitter: <a href="https://twitter.com/WhaleShield">@WhaleShield</a></li>
      <li>Website: <a href="https://whaleshield.io">whaleshield.io</a></li>
    </ul>
    <div class="footer">
      <p>&copy; 2025 WhaleShield. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  return c.html(html);
});

// Bot landing page
app.get('/bot', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Safe Snipe Bot - WhaleShield</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      background: #050508;
      color: #ffffff;
      min-height: 100vh;
      background-image:
        linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px);
      background-size: 50px 50px;
    }
    .font-cyber { font-family: 'Orbitron', sans-serif; }
    .gradient-text {
      background: linear-gradient(135deg, #00d4ff 0%, #00a8e8 50%, #0088cc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 60px 20px; }
    .header {
      text-align: center;
      margin-bottom: 60px;
    }
    .header-nav {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-bottom: 40px;
    }
    .header-nav a {
      color: #888;
      text-decoration: none;
      font-size: 14px;
      transition: color 0.2s;
    }
    .header-nav a:hover { color: #00d4ff; }
    .header-nav a.active { color: #00d4ff; }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .logo-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #00d4ff, #0088cc);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 3rem;
      font-weight: 700;
      margin-bottom: 15px;
    }
    .subtitle {
      color: #888;
      font-size: 1.2rem;
      max-width: 500px;
      margin: 0 auto;
    }
    .beta-badge {
      display: inline-block;
      background: rgba(0, 212, 255, 0.15);
      color: #00d4ff;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-left: 10px;
      border: 1px solid rgba(0, 212, 255, 0.3);
    }
    .card {
      background: rgba(10, 10, 15, 0.8);
      border: 1px solid rgba(0, 212, 255, 0.2);
      border-radius: 16px;
      padding: 40px;
      margin-bottom: 30px;
      transition: all 0.3s ease;
    }
    .card:hover {
      border-color: rgba(0, 212, 255, 0.4);
      box-shadow: 0 0 40px rgba(0, 212, 255, 0.15);
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .feature {
      background: rgba(0, 212, 255, 0.05);
      border: 1px solid rgba(0, 212, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      transition: all 0.3s ease;
    }
    .feature:hover {
      border-color: rgba(0, 212, 255, 0.3);
      background: rgba(0, 212, 255, 0.08);
    }
    .feature-icon {
      width: 40px;
      height: 40px;
      background: rgba(0, 212, 255, 0.15);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 15px;
      font-size: 20px;
    }
    .feature h3 {
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .feature p {
      color: #888;
      font-size: 14px;
      line-height: 1.5;
    }
    .cta-section {
      text-align: center;
      padding: 40px;
    }
    .launch-btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #00d4ff 0%, #0088cc 100%);
      color: #000;
      font-family: 'Orbitron', sans-serif;
      font-size: 18px;
      font-weight: 600;
      padding: 18px 40px;
      border-radius: 12px;
      text-decoration: none;
      transition: all 0.3s ease;
      box-shadow: 0 0 30px rgba(0, 212, 255, 0.3);
    }
    .launch-btn:hover {
      transform: translateY(-3px);
      box-shadow: 0 0 50px rgba(0, 212, 255, 0.5);
    }
    .warning {
      background: rgba(234, 179, 8, 0.1);
      border: 1px solid rgba(234, 179, 8, 0.3);
      border-radius: 12px;
      padding: 20px;
      margin-top: 30px;
    }
    .warning-title {
      color: #eab308;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .warning p {
      color: #a3a3a3;
      font-size: 14px;
      line-height: 1.6;
    }
    .requirements {
      margin-top: 40px;
      padding-top: 30px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .requirements h3 {
      color: #888;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
    }
    .requirements ul {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
    }
    .requirements li {
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.2);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      color: #00d4ff;
    }
    .footer {
      text-align: center;
      margin-top: 60px;
      padding-top: 30px;
      border-top: 1px solid rgba(255,255,255,0.1);
      color: #555;
      font-size: 14px;
    }
    .footer a { color: #00d4ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <nav class="header-nav">
        <a href="https://whaleshield.io">Home</a>
        <a href="https://whaleshield.io/trends">Trends</a>
        <a href="/bot" class="active">Bot</a>
        <a href="https://twitter.com/WhaleShield" target="_blank">Twitter</a>
      </nav>
      <div class="logo">
        <div class="logo-icon">🐋</div>
        <h1 class="gradient-text">Safe Snipe Bot<span class="beta-badge">BETA</span></h1>
      </div>
      <p class="subtitle">AI-powered token sniping that filters out scams before you trade</p>
    </header>

    <div class="card">
      <div class="features">
        <div class="feature">
          <div class="feature-icon">🔍</div>
          <h3>Real-Time Detection</h3>
          <p>Monitors pump.fun for new token launches the moment they appear</p>
        </div>
        <div class="feature">
          <div class="feature-icon">🤖</div>
          <h3>AI Analysis</h3>
          <p>Every token is analyzed by WhaleShield AI before you trade</p>
        </div>
        <div class="feature">
          <div class="feature-icon">🛡️</div>
          <h3>Risk Filtering</h3>
          <p>Automatically skips tokens above your risk threshold</p>
        </div>
        <div class="feature">
          <div class="feature-icon">⚡</div>
          <h3>Auto TP/SL</h3>
          <p>Configurable take profit and stop loss for automated exits</p>
        </div>
        <div class="feature">
          <div class="feature-icon">📊</div>
          <h3>Manual Analysis</h3>
          <p>Paste any token address for instant risk assessment</p>
        </div>
        <div class="feature">
          <div class="feature-icon">👀</div>
          <h3>Watch-Only Mode</h3>
          <p>Observe and learn without risking any funds</p>
        </div>
      </div>

      <div class="cta-section">
        <a href="https://github.com/WhaleShield/sniper-bot" target="_blank" class="launch-btn">
          <span>🚀</span>
          Get Started
        </a>
        <p style="margin-top: 15px; color: #666; font-size: 14px;">Runs locally on your machine for maximum security</p>
      </div>

      <div class="warning">
        <div class="warning-title">
          <span>⚠️</span>
          Risk Disclaimer
        </div>
        <p>Trading meme coins involves substantial risk of loss. The Safe Snipe Bot is a tool to help filter obvious scams, but it cannot guarantee profits or prevent all losses. Only trade with funds you can afford to lose. Past performance does not indicate future results. Use at your own discretion.</p>
      </div>

      <div class="requirements">
        <h3>Requirements</h3>
        <ul>
          <li>Node.js 18+</li>
          <li>Solana Wallet</li>
          <li>Helius RPC (free tier works)</li>
        </ul>
      </div>
    </div>

    <footer class="footer">
      <p>&copy; 2025 WhaleShield | <a href="/privacy">Privacy Policy</a> | <a href="https://twitter.com/WhaleShield" target="_blank">@WhaleShield</a></p>
    </footer>
  </div>
</body>
</html>`;
  return c.html(html);
});

// Mount routes
app.route('/analyze', analyzeRoutes);
app.route('/graffiti', graffitiRoutes);
app.route('/wallet-history', walletHistoryRoutes);
app.route('/subscribe', subscriptionRoutes);
app.route('/trends', trendsRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Worker error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
