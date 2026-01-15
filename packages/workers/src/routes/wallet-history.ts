import { Hono } from 'hono';
import type { Bindings } from '../index';
import { getWalletRiskLevel } from '@whaleshield/shared';
import { createSupabaseClient, getWalletReputation, upsertWalletReputation } from '../services/supabase';

export const walletHistoryRoutes = new Hono<{ Bindings: Bindings }>();

// Get wallet reputation
walletHistoryRoutes.get('/:address', async (c) => {
  const address = c.req.param('address');

  const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
  let reputation = await getWalletReputation(supabase, address);

  // If no reputation found, return default
  if (!reputation) {
    reputation = {
      address,
      deployedTokens: 0,
      rugCount: 0,
      successfulProjects: 0,
      firstSeen: Date.now(),
      lastActive: Date.now(),
      riskScore: 50, // Unknown = medium risk
      tags: ['NEW_WALLET'],
    };
  }

  return c.json({
    reputation,
    riskLevel: getWalletRiskLevel(reputation),
  });
});

// Report a rug (admin/community moderation)
walletHistoryRoutes.post('/:address/report', async (c) => {
  try {
    const address = c.req.param('address');
    const body = await c.req.json<{
      type: 'rug' | 'success';
      tokenAddress: string;
      evidence?: string;
      reporterWallet: string;
      signature: string;
    }>();

    // TODO: Verify signature
    // TODO: Implement moderation/verification system

    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
    let reputation = await getWalletReputation(supabase, address);

    if (!reputation) {
      reputation = {
        address,
        deployedTokens: 1,
        rugCount: 0,
        successfulProjects: 0,
        firstSeen: Date.now(),
        lastActive: Date.now(),
        riskScore: 50,
        tags: [],
      };
    }

    // Update based on report type
    if (body.type === 'rug') {
      reputation.rugCount += 1;
      reputation.riskScore = Math.min(100, reputation.riskScore + 25);

      if (reputation.rugCount >= 3 && !reputation.tags.includes('SERIAL_RUGGER')) {
        reputation.tags.push('SERIAL_RUGGER');
      }
      if (reputation.rugCount >= 1 && !reputation.tags.includes('KNOWN_SCAMMER')) {
        reputation.tags.push('KNOWN_SCAMMER');
      }
    } else if (body.type === 'success') {
      reputation.successfulProjects += 1;
      reputation.riskScore = Math.max(0, reputation.riskScore - 10);

      if (reputation.successfulProjects >= 3 && !reputation.tags.includes('ESTABLISHED')) {
        reputation.tags.push('ESTABLISHED');
      }
    }

    reputation.lastActive = Date.now();

    // Remove NEW_WALLET tag if they have activity
    const newWalletIndex = reputation.tags.indexOf('NEW_WALLET');
    if (newWalletIndex > -1 && (reputation.rugCount > 0 || reputation.successfulProjects > 0)) {
      reputation.tags.splice(newWalletIndex, 1);
    }

    await upsertWalletReputation(supabase, reputation);

    return c.json({
      success: true,
      reputation,
      riskLevel: getWalletRiskLevel(reputation),
    });
  } catch (error) {
    console.error('Report error:', error);
    return c.json({ error: 'Failed to process report' }, 500);
  }
});
