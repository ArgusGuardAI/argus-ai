import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeRoutes } from './routes/analyze';
import { walletHistoryRoutes } from './routes/wallet-history';
import { subscriptionRoutes } from './routes/subscription';
import { authRoutes } from './routes/auth';
import { trendsRoutes } from './routes/trends';
import scoresRoutes from './routes/scores';
import { sentinelRoutes } from './routes/sentinel';
import { jupiterRoutes } from './routes/jupiter';
import { twitterRoutes } from './routes/twitter';

export type Bindings = {
  SCAN_CACHE: KVNamespace;
  TOGETHER_AI_API_KEY: string;
  TOGETHER_AI_MODEL?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  HELIUS_API_KEY?: string;
  ARGUSGUARD_MINT?: string; // Token mint address for token gating (optional until launch)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  TWITTER_API_KEY?: string;
  TWITTER_API_SECRET?: string;
  TWITTER_ACCESS_TOKEN?: string;
  TWITTER_ACCESS_TOKEN_SECRET?: string;
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
      // Allow argusguard.io website
      if (origin?.includes('argusguard.io')) return origin;
      if (origin?.includes('argusguard.pages.dev')) return origin;
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
  <title>Privacy Policy - ArgusGuard</title>
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
    <p class="subtitle">Last updated: January 2026</p>
    <div class="highlight">
      <strong>TL;DR:</strong> Argus AI does not collect, store, or sell your personal data. All analysis happens through our secure API, and we only process the minimum data needed to protect you from scams.
    </div>
    <h2>1. Introduction</h2>
    <p>Argus AI ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how our platform handles information when you use our service to analyze and trade Solana tokens.</p>
    <h2>2. Information We Do NOT Collect</h2>
    <ul>
      <li><strong>Personal Information:</strong> We do not collect your name, email, phone number, or any personally identifiable information.</li>
      <li><strong>Browsing History:</strong> We do not track or store your browsing history.</li>
      <li><strong>Wallet Contents:</strong> We do not access, store, or track your wallet balances, transactions, or holdings beyond what is needed for trading.</li>
      <li><strong>Cookies or Trackers:</strong> We do not use cookies, analytics, or any third-party tracking services.</li>
    </ul>
    <h2>3. Information We Process</h2>
    <p>To provide our service, we process the following information:</p>
    <ul>
      <li><strong>Token Addresses:</strong> When you analyze a token, we send the token's contract address to our API for analysis. This is necessary to check for risks and scams.</li>
      <li><strong>Trading Wallet:</strong> Your dedicated trading wallet is stored encrypted in your browser's localStorage. Private keys never leave your device.</li>
    </ul>
    <h2>4. How We Use Information</h2>
    <p>The information we process is used solely to:</p>
    <ul>
      <li>Analyze token contracts for potential risks (honeypots, rug pulls, scams)</li>
      <li>Execute trades via Jupiter aggregator on your behalf</li>
      <li>Track your positions and P&amp;L</li>
    </ul>
    <h2>5. Data Storage and Security</h2>
    <ul>
      <li><strong>Token Analysis Results:</strong> Cached temporarily to improve performance. No personal data is stored.</li>
      <li><strong>Trading Wallet:</strong> Stored encrypted in your browser's localStorage. Never transmitted to our servers.</li>
      <li><strong>Positions &amp; Settings:</strong> Stored locally in your browser. This data never leaves your device.</li>
    </ul>
    <h2>6. Third-Party Services</h2>
    <p>We use the following third-party services:</p>
    <ul>
      <li><strong>Solana RPC (Helius):</strong> To submit transactions and verify balances</li>
      <li><strong>Groq / Together AI:</strong> For AI-powered risk analysis (only token data is sent, no personal information)</li>
      <li><strong>DexScreener:</strong> For market data (price, volume, liquidity)</li>
      <li><strong>RugCheck:</strong> For holder distribution and security checks</li>
      <li><strong>Jupiter:</strong> For swap execution and price routing</li>
      <li><strong>Cloudflare:</strong> For API hosting and security</li>
    </ul>
    <p>These services have their own privacy policies and do not receive any of your personal information from us.</p>
    <h2>7. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Delete your trading wallet at any time, which removes all local data</li>
      <li>Export your wallet private key before deletion</li>
      <li>Use the platform without connecting a wallet (analysis only)</li>
    </ul>
    <h2>8. Children's Privacy</h2>
    <p>ArgusGuard is not intended for use by anyone under the age of 18. We do not knowingly collect information from minors.</p>
    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify users of any material changes by updating the "Last updated" date at the top of this policy.</p>
    <h2>10. Contact Us</h2>
    <p>If you have any questions about this Privacy Policy, please contact us at:</p>
    <ul>
      <li>X: <a href="https://x.com/ArgusPanoptes7z">@ArgusPanoptes7z</a></li>
      <li>Website: <a href="https://argusguard.io">argusguard.io</a></li>
    </ul>
    <div class="footer">
      <p>&copy; 2026 Argus AI. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  return c.html(html);
});

// Mount routes
app.route('/analyze', analyzeRoutes);
app.route('/wallet-history', walletHistoryRoutes);
app.route('/subscribe', subscriptionRoutes);
app.route('/auth', authRoutes);
app.route('/trends', trendsRoutes);
app.route('/scores', scoresRoutes);
app.route('/sentinel', sentinelRoutes);
app.route('/jupiter', jupiterRoutes);
app.route('/twitter', twitterRoutes);

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
