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
    // onlyDirectRoutes=true restricts to 2 hops max for faster, more reliable execution
    const jupiterUrl = `${JUPITER_API}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=true`;
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
    // CRITICAL: Convert total fee (lamports) to price-per-compute-unit (micro-lamports)
    // Helius returns total fee for transaction, Jupiter expects price per CU
    // Typical swap uses ~1,400,000 compute units
    const ESTIMATED_COMPUTE_UNITS = 1_400_000;
    const DEFAULT_FEE_MICRO_LAMPORTS = 50; // ~0.07 SOL total at 1.4M CU

    let computeUnitPrice = DEFAULT_FEE_MICRO_LAMPORTS;
    if (body.prioritizationFeeLamports && body.prioritizationFeeLamports > 0) {
      // Convert: total lamports → lamports per CU → micro-lamports per CU
      const feePerUnit = body.prioritizationFeeLamports / ESTIMATED_COMPUTE_UNITS;
      computeUnitPrice = Math.ceil(feePerUnit * 1_000_000);
      // Clamp to reasonable bounds (1 to 10,000 micro-lamports)
      computeUnitPrice = Math.max(1, Math.min(computeUnitPrice, 10_000));
    }

    console.log(`[Jupiter Proxy] Fee: ${body.prioritizationFeeLamports || 0} lamports → ${computeUnitPrice} micro-lamports/CU`);

    const swapRequest = {
      quoteResponse: body.quoteResponse,
      userPublicKey: body.userPublicKey,
      wrapAndUnwrapSol: body.wrapAndUnwrapSol ?? true,
      dynamicComputeUnitLimit: true,
      computeUnitPriceMicroLamports: computeUnitPrice,
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
