/**
 * Training Data API Routes
 *
 * Endpoints for managing BitNet training data:
 * - GET /stats - Get training data statistics
 * - GET /export - Export training data as JSONL
 * - POST /outcome - Report token outcome (rugged/safe)
 * - POST /init - Initialize database schema
 */

import { Hono } from 'hono';
import {
  exportTrainingData,
  exportAsJSONL,
  getTrainingStats,
  updateOutcome,
  initTrainingDataSchema,
  ExportOptions,
} from '../services/training-data';

type Bindings = {
  BUNDLE_DB: D1Database;
  ADMIN_SECRET?: string;
};

export const trainingRoutes = new Hono<{ Bindings: Bindings }>();

// Admin auth middleware
trainingRoutes.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const adminSecret = c.env.ADMIN_SECRET;

  if (!adminSecret) {
    return c.json({ error: 'Training API not configured' }, 503);
  }

  if (!authHeader || authHeader.replace('Bearer ', '') !== adminSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});

// GET /training/stats - Get training data statistics
trainingRoutes.get('/stats', async (c) => {
  try {
    const stats = await getTrainingStats(c.env.BUNDLE_DB);
    return c.json(stats);
  } catch (error) {
    console.error('[Training] Stats error:', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

// GET /training/export - Export training data
trainingRoutes.get('/export', async (c) => {
  try {
    const options: ExportOptions = {};

    // Parse query params
    const minScore = c.req.query('minScore');
    const maxScore = c.req.query('maxScore');
    const outcomeKnown = c.req.query('outcomeKnown');
    const rugged = c.req.query('rugged');
    const limit = c.req.query('limit');
    const offset = c.req.query('offset');
    const format = c.req.query('format') || 'json';

    if (minScore) options.minScore = parseInt(minScore);
    if (maxScore) options.maxScore = parseInt(maxScore);
    if (outcomeKnown) options.outcomeKnown = outcomeKnown === 'true';
    if (rugged) options.rugged = rugged === 'true';
    if (limit) options.limit = parseInt(limit);
    if (offset) options.offset = parseInt(offset);

    if (format === 'jsonl') {
      const jsonl = await exportAsJSONL(c.env.BUNDLE_DB, options);
      return new Response(jsonl, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="argus-training-${Date.now()}.jsonl"`,
        },
      });
    } else {
      const data = await exportTrainingData(c.env.BUNDLE_DB, options);
      return c.json(data);
    }
  } catch (error) {
    console.error('[Training] Export error:', error);
    return c.json({ error: 'Failed to export data' }, 500);
  }
});

// POST /training/outcome - Report token outcome
trainingRoutes.post('/outcome', async (c) => {
  try {
    const body = await c.req.json<{
      tokenAddress: string;
      rugged: boolean;
      priceDropPercent?: number;
      liquidityDropPercent?: number;
    }>();

    if (!body.tokenAddress || body.rugged === undefined) {
      return c.json({ error: 'tokenAddress and rugged required' }, 400);
    }

    const updated = await updateOutcome(
      c.env.BUNDLE_DB,
      body.tokenAddress,
      body.rugged,
      body.priceDropPercent,
      body.liquidityDropPercent
    );

    return c.json({
      success: true,
      updated,
      tokenAddress: body.tokenAddress,
      rugged: body.rugged,
    });
  } catch (error) {
    console.error('[Training] Outcome error:', error);
    return c.json({ error: 'Failed to update outcome' }, 500);
  }
});

// POST /training/init - Initialize database schema
trainingRoutes.post('/init', async (c) => {
  try {
    await initTrainingDataSchema(c.env.BUNDLE_DB);
    return c.json({ success: true, message: 'Schema initialized' });
  } catch (error) {
    console.error('[Training] Init error:', error);
    return c.json({ error: 'Failed to initialize schema' }, 500);
  }
});

// POST /training/batch-outcome - Report multiple outcomes at once
trainingRoutes.post('/batch-outcome', async (c) => {
  try {
    const body = await c.req.json<{
      outcomes: Array<{
        tokenAddress: string;
        rugged: boolean;
        priceDropPercent?: number;
        liquidityDropPercent?: number;
      }>;
    }>();

    if (!body.outcomes || !Array.isArray(body.outcomes)) {
      return c.json({ error: 'outcomes array required' }, 400);
    }

    let totalUpdated = 0;
    const results: Array<{ tokenAddress: string; updated: number }> = [];

    for (const outcome of body.outcomes) {
      const updated = await updateOutcome(
        c.env.BUNDLE_DB,
        outcome.tokenAddress,
        outcome.rugged,
        outcome.priceDropPercent,
        outcome.liquidityDropPercent
      );
      totalUpdated += updated;
      results.push({ tokenAddress: outcome.tokenAddress, updated });
    }

    return c.json({
      success: true,
      totalUpdated,
      results,
    });
  } catch (error) {
    console.error('[Training] Batch outcome error:', error);
    return c.json({ error: 'Failed to update outcomes' }, 500);
  }
});
