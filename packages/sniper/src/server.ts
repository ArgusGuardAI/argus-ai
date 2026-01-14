/**
 * WhaleShield Sniper API Server
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
console.log('║      WhaleShield Sniper API Server v0.1.0         ║');
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
