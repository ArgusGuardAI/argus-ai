/**
 * Auth Routes - Check user tier and subscription status
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import { checkTokenBalance } from '../services/auth';
import { createSupabaseClient } from '../services/supabase';
import { getUsage, getClientIP } from '../services/rate-limit';

export const authRoutes = new Hono<{ Bindings: Bindings }>();

// Token thresholds
const HOLDER_THRESHOLD = 1000;
const PRO_THRESHOLD = 10000;

// Get auth status for a wallet
authRoutes.get('/status', async (c) => {
  const wallet = c.req.query('wallet');

  if (!wallet) {
    return c.json({ error: 'wallet parameter required' }, 400);
  }

  try {
    // Check token balance
    let tokenBalance = 0;
    const mintAddress = c.env.ARGUSGUARD_MINT;

    if (mintAddress && mintAddress !== 'TBD_AFTER_LAUNCH') {
      const balanceResult = await checkTokenBalance(
        wallet,
        mintAddress,
        0, // Just get the balance, don't require a minimum
        c.env.HELIUS_API_KEY
      );
      tokenBalance = balanceResult.balance;
    }

    // Check subscription status
    let isSubscribed = false;
    try {
      const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
      const { data } = await supabase
        .from('subscribers')
        .select('status, current_period_end')
        .eq('wallet_address', wallet)
        .single();

      if (data && data.status === 'active') {
        const periodEnd = new Date(data.current_period_end);
        isSubscribed = periodEnd > new Date();
      }
    } catch {
      // No subscription found
    }

    // Calculate tier
    let tier: 'free' | 'holder' | 'pro' = 'free';
    if (isSubscribed || tokenBalance >= PRO_THRESHOLD) {
      tier = 'pro';
    } else if (tokenBalance >= HOLDER_THRESHOLD) {
      tier = 'holder';
    }

    return c.json({
      wallet,
      tokenBalance,
      isSubscribed,
      tier,
      thresholds: {
        holder: HOLDER_THRESHOLD,
        pro: PRO_THRESHOLD,
      },
    });
  } catch (error) {
    console.error('Auth status error:', error);
    return c.json({ error: 'Failed to check auth status' }, 500);
  }
});

// Get rate limit usage for a user
authRoutes.get('/usage', async (c) => {
  const wallet = c.req.query('wallet');
  const clientIP = getClientIP(c.req.raw);

  try {
    // Check token balance and determine tier
    let tokenBalance = 0;
    let isSubscribed = false;
    const mintAddress = c.env.ARGUSGUARD_MINT;

    if (wallet && mintAddress && mintAddress !== 'TBD_AFTER_LAUNCH') {
      const balanceResult = await checkTokenBalance(
        wallet,
        mintAddress,
        0,
        c.env.HELIUS_API_KEY
      );
      tokenBalance = balanceResult.balance;
    }

    // Check subscription status
    if (wallet) {
      try {
        const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
        const { data } = await supabase
          .from('subscribers')
          .select('status, current_period_end')
          .eq('wallet_address', wallet)
          .single();

        if (data && data.status === 'active') {
          const periodEnd = new Date(data.current_period_end);
          isSubscribed = periodEnd > new Date();
        }
      } catch {
        // No subscription found
      }
    }

    // Calculate tier
    let tier: 'free' | 'holder' | 'pro' = 'free';
    if (isSubscribed || tokenBalance >= PRO_THRESHOLD) {
      tier = 'pro';
    } else if (tokenBalance >= HOLDER_THRESHOLD) {
      tier = 'holder';
    }

    // Get usage stats
    const identifier = wallet || clientIP;
    const usage = await getUsage(c.env.SCAN_CACHE, identifier, tier);

    return c.json({
      tier,
      tokenBalance,
      isSubscribed,
      usage: {
        used: usage.used,
        limit: usage.limit === Infinity ? 'unlimited' : usage.limit,
        remaining: usage.remaining === Infinity ? 'unlimited' : usage.remaining,
      },
    });
  } catch (error) {
    console.error('Usage check error:', error);
    return c.json({ error: 'Failed to check usage' }, 500);
  }
});

// Create Stripe checkout session for Pro subscription
authRoutes.post('/checkout', async (c) => {
  try {
    const { walletAddress, successUrl, cancelUrl } = await c.req.json();

    if (!walletAddress) {
      return c.json({ error: 'walletAddress required' }, 400);
    }

    // Redirect to subscription route
    const response = await fetch(`${c.req.url.replace('/auth/checkout', '/subscribe/create-checkout')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, successUrl, cancelUrl }),
    });

    return response;
  } catch (error) {
    console.error('Checkout error:', error);
    return c.json({ error: 'Failed to create checkout' }, 500);
  }
});
