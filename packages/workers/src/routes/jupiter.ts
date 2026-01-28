/**
 * Jupiter Proxy Routes
 * Proxies requests to Jupiter paid API to avoid CORS issues
 * Uses authenticated endpoints for better reliability
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';

// Jupiter paid API with authentication
const JUPITER_API = 'https://api.jup.ag';

export const jupiterRoutes = new Hono<{ Bindings: Bindings }>();

// Proxy quote requests - uses /swap/v1/quote endpoint
jupiterRoutes.get('/quote', async (c) => {
  try {
    if (!c.env.JUPITER_API_KEY) {
      return c.json({ error: 'Jupiter API key not configured' }, 500);
    }

    const inputMint = c.req.query('inputMint');
    const outputMint = c.req.query('outputMint');
    const amount = c.req.query('amount');
    const slippageBps = c.req.query('slippageBps') || '100';

    if (!inputMint || !outputMint || !amount) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    // Use /swap/v1/quote endpoint (paid API)
    const jupiterUrl = `${JUPITER_API}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
    console.log('[Jupiter Proxy] Fetching quote:', jupiterUrl);

    const response = await fetch(jupiterUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-api-key': c.env.JUPITER_API_KEY,
        'User-Agent': 'ArgusGuard/1.0',
      },
    });

    const responseText = await response.text();
    console.log('[Jupiter Proxy] Quote response status:', response.status);

    if (!response.ok) {
      console.error('[Jupiter Proxy] Quote error:', responseText);
      return c.json({ error: responseText }, 502);
    }

    try {
      const data = JSON.parse(responseText);
      return c.json(data);
    } catch {
      return c.json({ error: 'Invalid JSON response from Jupiter' }, 500);
    }
  } catch (error) {
    console.error('[Jupiter Proxy] Quote failed:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get quote' }, 500);
  }
});

// Proxy swap requests - uses /swap/v1/swap endpoint
jupiterRoutes.post('/swap', async (c) => {
  try {
    if (!c.env.JUPITER_API_KEY) {
      return c.json({ error: 'Jupiter API key not configured' }, 500);
    }

    const body = await c.req.json();
    console.log('[Jupiter Proxy] Building swap transaction for:', body.userPublicKey);

    // Build the swap request with correct parameters for v1 API
    const swapRequest = {
      quoteResponse: body.quoteResponse,
      userPublicKey: body.userPublicKey,
      wrapAndUnwrapSol: body.wrapAndUnwrapSol ?? true,
      dynamicComputeUnitLimit: true,
      // Use computeUnitPriceMicroLamports instead of prioritizationFeeLamports for v1
      computeUnitPriceMicroLamports: body.prioritizationFeeLamports ? body.prioritizationFeeLamports * 1000 : 50000,
    };

    console.log('[Jupiter Proxy] Swap request:', JSON.stringify(swapRequest).slice(0, 200));

    // Use /swap/v1/swap endpoint (paid API)
    const response = await fetch(`${JUPITER_API}/swap/v1/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.env.JUPITER_API_KEY,
        'User-Agent': 'ArgusGuard/1.0',
      },
      body: JSON.stringify(swapRequest),
    });

    const responseText = await response.text();
    console.log('[Jupiter Proxy] Swap response status:', response.status);
    console.log('[Jupiter Proxy] Swap response:', responseText.slice(0, 500));

    if (!response.ok) {
      console.error('[Jupiter Proxy] Swap error:', responseText);
      return c.json({ error: responseText }, 502);
    }

    try {
      const data = JSON.parse(responseText);
      return c.json(data);
    } catch {
      return c.json({ error: 'Invalid JSON response from Jupiter' }, 500);
    }
  } catch (error) {
    console.error('[Jupiter Proxy] Swap failed:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to build swap' }, 500);
  }
});
