/**
 * ArgusGuard Sniper API Server
 * Serves the web dashboard and WebSocket connections
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import { SniperEngine } from './engine/sniper';
import type { SniperConfig } from './types';

const PORT = parseInt(process.env.PORT || '8787');
const RPC_URL = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Extract Helius API key from RPC URL if available
function getHeliusApiKey(): string {
  const rpcUrl = process.env.HELIUS_RPC_URL || '';
  const match = rpcUrl.match(/api-key=([a-f0-9-]+)/i) || rpcUrl.match(/helius-rpc\.com\/\?api-key=([a-f0-9-]+)/i);
  if (match) return match[1];

  // Also check for explicit API key env var
  return process.env.HELIUS_API_KEY || '';
}

// Initialize sniper engine
let sniper: SniperEngine | null = null;
const clients = new Set<WebSocket>();

const app = new Hono();

// CORS for development
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Get current status
app.get('/api/status', (c) => {
  return c.json(sniper?.getState() || { status: 'stopped' });
});

// Start sniper
app.post('/api/start', async (c) => {
  try {
    const { config } = await c.req.json<{ config: Partial<SniperConfig> }>();

    if (!sniper) {
      sniper = new SniperEngine(RPC_URL, config);

      // Forward all messages to WebSocket clients
      sniper.on('message', (msg) => {
        broadcast(msg);
      });
    }

    await sniper.start();
    return c.json({ success: true, status: sniper.getState() });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Stop sniper
app.post('/api/stop', (c) => {
  if (sniper) {
    sniper.stop();
  }
  return c.json({ success: true });
});

// Update config
app.put('/api/config', async (c) => {
  const { config } = await c.req.json<{ config: Partial<SniperConfig> }>();
  if (sniper) {
    sniper.updateConfig(config);
  }
  return c.json({ success: true });
});

// Manual sell
app.post('/api/sell/:tokenAddress', async (c) => {
  const tokenAddress = c.req.param('tokenAddress');
  if (!sniper) {
    return c.json({ success: false, error: 'Sniper not running' }, 400);
  }

  try {
    const result = await sniper.manualSell(tokenAddress);
    return c.json({ success: true, result });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Manual token analysis (calls ArgusGuard API directly)
const ARGUSGUARD_API = process.env.ARGUSGUARD_API_URL || 'https://api.argusguard.io';

app.post('/api/analyze', async (c) => {
  try {
    const { tokenAddress } = await c.req.json<{ tokenAddress: string }>();

    if (!tokenAddress) {
      return c.json({ error: 'tokenAddress required' }, 400);
    }

    console.log(`[API] Manual analysis request for ${tokenAddress}`);

    const response = await fetch(`${ARGUSGUARD_API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress }),
    });

    if (!response.ok) {
      return c.json({ error: 'Analysis failed' }, 500);
    }

    const result = await response.json();
    console.log(`[API] Analysis complete: ${result.riskScore} (${result.riskLevel})`);

    return c.json(result);
  } catch (error) {
    console.error('[API] Analysis error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Jupiter API key (from sol-bot config)
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '057a176a-d2af-4ff6-a35d-84ed54fcd4b4';
const JUPITER_API_URL = 'https://api.jup.ag';

// Jupiter API proxy (using api.jup.ag v1 with API key)
app.get('/api/jupiter/quote', async (c) => {
  try {
    const url = new URL(c.req.url);
    const jupiterUrl = `${JUPITER_API_URL}/swap/v1/quote${url.search}`;

    console.log(`[API] Jupiter quote: ${url.search.slice(0, 60)}...`);

    const response = await fetch(jupiterUrl, {
      headers: {
        'x-api-key': JUPITER_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Quote failed:', response.status, errorText);
      return c.json({ error: errorText }, response.status);
    }

    const data = await response.json();
    console.log(`[API] Quote success: ${data.inAmount} -> ${data.outAmount}`);
    return c.json(data);
  } catch (error) {
    console.error('[API] Jupiter quote error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

app.post('/api/jupiter/swap', async (c) => {
  try {
    const body = await c.req.json();
    const swapUrl = `${JUPITER_API_URL}/swap/v1/swap`;

    console.log('[API] Jupiter swap request');

    const response = await fetch(swapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': JUPITER_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Swap failed:', response.status, errorText);
      return c.json({ error: errorText }, response.status);
    }

    const data = await response.json();
    console.log('[API] Swap transaction built successfully');
    return c.json(data);
  } catch (error) {
    console.error('[API] Jupiter swap error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get current price for a token (in SOL)
const SOL_MINT = 'So11111111111111111111111111111111111111112';

app.get('/api/price/:tokenMint', async (c) => {
  try {
    const tokenMint = c.req.param('tokenMint');

    // Get quote for 1M tokens -> SOL to determine price
    const amount = 1_000_000_000_000; // 1M tokens with 6 decimals
    const quoteUrl = `${JUPITER_API_URL}/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=100`;

    const response = await fetch(quoteUrl, {
      headers: {
        'x-api-key': JUPITER_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Token might not be on Jupiter yet (still on bonding curve)
      return c.json({ price: null, error: 'No route' }, 200);
    }

    const data = await response.json();

    // Price = outAmount (in lamports) / inAmount (tokens)
    const priceInSol = parseFloat(data.outAmount) / 1e9 / (parseFloat(data.inAmount) / 1e6);

    return c.json({
      price: priceInSol,
      inAmount: data.inAmount,
      outAmount: data.outAmount,
    });
  } catch (error) {
    console.error('[API] Price error:', error);
    return c.json({ price: null, error: String(error) }, 200);
  }
});

// Batch price lookup for multiple tokens
app.post('/api/prices', async (c) => {
  try {
    const { tokens } = await c.req.json<{ tokens: string[] }>();

    if (!tokens || !Array.isArray(tokens)) {
      return c.json({ error: 'tokens array required' }, 400);
    }

    const prices: Record<string, number | null> = {};

    // Fetch prices in parallel
    await Promise.all(
      tokens.map(async (tokenMint) => {
        try {
          const amount = 1_000_000_000_000; // 1M tokens
          const quoteUrl = `${JUPITER_API_URL}/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=100`;

          const response = await fetch(quoteUrl, {
            headers: {
              'x-api-key': JUPITER_API_KEY,
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            prices[tokenMint] = parseFloat(data.outAmount) / 1e9 / (parseFloat(data.inAmount) / 1e6);
          } else {
            prices[tokenMint] = null;
          }
        } catch {
          prices[tokenMint] = null;
        }
      })
    );

    return c.json({ prices });
  } catch (error) {
    console.error('[API] Prices error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

function handleClientMessage(msg: any, _ws: WebSocket) {
  switch (msg.type) {
    case 'START':
      if (!sniper) {
        sniper = new SniperEngine(RPC_URL, msg.config);
        sniper.on('message', (m) => broadcast(m));
      }
      sniper.start();
      break;

    case 'STOP':
      sniper?.stop();
      break;

    case 'UPDATE_CONFIG':
      sniper?.updateConfig(msg.config);
      break;

    case 'SELL':
      sniper?.manualSell(msg.tokenAddress);
      break;

    case 'MANUAL_SNIPE':
      if (sniper) {
        console.log(`[WS] Manual snipe request for ${msg.tokenAddress}`);
        sniper.manualBuy(msg.tokenAddress);
      }
      break;
  }
}

function broadcast(msg: any) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (err) {
        clients.delete(client);
      }
    }
  }
}

// Start server
console.log('╔═══════════════════════════════════════════════════╗');
console.log('║       ArgusGuard Sniper API Server v0.1.0         ║');
console.log('╚═══════════════════════════════════════════════════╝');
console.log('');

const server = serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`🚀 Server running at http://localhost:${info.port}`);
  console.log(`📡 WebSocket at ws://localhost:${info.port}/ws`);
  console.log('');
  console.log('Open the dashboard at http://localhost:3000');
});

// Create WebSocket server on same port
const wss = new WebSocketServer({ server: server as any, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  clients.add(ws);

  // Send current state
  if (sniper) {
    ws.send(JSON.stringify({
      type: 'STATUS_UPDATE',
      data: sniper.getState(),
    }));
  } else {
    ws.send(JSON.stringify({
      type: 'STATUS_UPDATE',
      data: { status: 'stopped', positions: [], tokensScanned: 0, tokensSniped: 0, tokensSkipped: 0, totalPnlSol: 0 },
    }));
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleClientMessage(msg, ws);
    } catch (err) {
      console.error('[WS] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
    clients.delete(ws);
  });
});

console.log('[WS] WebSocket server attached');
