/**
 * Telegram Bot Routes
 * Webhook handler for interactive analysis + channel alerts
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import {
  sendMessage,
  setWebhook,
  deleteWebhook,
  getMe,
  formatAlertHtml,
  formatAnalysisHtml,
  formatHelpHtml,
  isSolanaAddress,
  type TelegramUpdate,
} from '../services/telegram';

export const telegramRoutes = new Hono<{ Bindings: Bindings }>();

// ============================================
// POST /telegram/webhook
// Incoming updates from Telegram
// ============================================
telegramRoutes.post('/webhook', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ ok: false, error: 'Bot token not configured' }, 500);
  }

  const update = (await c.req.json()) as TelegramUpdate;

  if (!update.message?.text || !update.message.chat) {
    return c.json({ ok: true }); // Ignore non-text updates
  }

  const chatId = update.message.chat.id.toString();
  const text = update.message.text.trim();

  // Handle commands
  if (text === '/start' || text === '/help') {
    await sendMessage(botToken, chatId, formatHelpHtml());
    return c.json({ ok: true });
  }

  // Check if it's a Solana token address
  if (isSolanaAddress(text)) {
    // Send "analyzing" message
    await sendMessage(botToken, chatId, '\u{1F50D} Analyzing token...');

    // Call sentinel analysis
    const baseUrl = new URL(c.req.url);
    const sentinelUrl = `${baseUrl.protocol}//${baseUrl.host}/sentinel/analyze`;

    try {
      const analysisResponse = await fetch(sentinelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: text }),
      });

      if (!analysisResponse.ok) {
        const errorBody = await analysisResponse.text();
        console.error(`[Telegram] Sentinel error: ${analysisResponse.status} ${errorBody}`);
        await sendMessage(
          botToken,
          chatId,
          `\u{274C} Analysis failed (${analysisResponse.status}). The token may not be listed on any DEX yet.`
        );
        return c.json({ ok: true });
      }

      const result = (await analysisResponse.json()) as {
        tokenInfo: {
          name: string;
          symbol: string;
          address: string;
          price?: number;
          marketCap?: number;
          liquidity?: number;
          ageHours?: number;
          holderCount?: number;
          volume24h?: number;
        };
        analysis: {
          riskScore: number;
          riskLevel: string;
          summary: string;
          recommendation: string;
          flags: Array<{ type: string; severity: string; message: string }>;
        };
        bundleInfo?: { detected: boolean; count: number; confidence: string };
        devActivity?: { hasSold: boolean; percentSold: number; currentHoldingsPercent: number };
        creatorInfo?: { address: string; currentHoldings: number };
      };

      const html = formatAnalysisHtml(result);
      await sendMessage(botToken, chatId, html);
    } catch (error) {
      console.error('[Telegram] Analysis fetch error:', error);
      await sendMessage(
        botToken,
        chatId,
        '\u{274C} Something went wrong. Please try again in a moment.'
      );
    }

    return c.json({ ok: true });
  }

  // Unknown input
  await sendMessage(
    botToken,
    chatId,
    'Send me a Solana token address to analyze, or /help for more info.'
  );

  return c.json({ ok: true });
});

// ============================================
// POST /telegram/alert
// Post a security alert to the channel
// Body: { analysisResult } (same format as twitter/alert)
// ============================================
telegramRoutes.post('/alert', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  const channelId = c.env.TELEGRAM_CHANNEL_ID;

  if (!botToken || !channelId) {
    return c.json({ error: 'Telegram bot token or channel ID not configured' }, 500);
  }

  const body = (await c.req.json()) as {
    tokenAddress?: string;
    analysisResult?: {
      tokenInfo: { name: string; symbol: string; liquidity: number; marketCap: number; ageHours: number };
      analysis: { riskScore: number; riskLevel: string; flags: Array<{ type: string; severity: string; message: string }>; summary: string };
      bundleInfo?: { detected: boolean; count: number; confidence: string };
    };
  };

  if (!body.tokenAddress || !body.analysisResult) {
    return c.json({ error: 'Missing tokenAddress or analysisResult' }, 400);
  }

  const { analysisResult } = body;

  const html = formatAlertHtml({
    tokenAddress: body.tokenAddress,
    name: analysisResult.tokenInfo.name,
    symbol: analysisResult.tokenInfo.symbol,
    riskScore: analysisResult.analysis.riskScore,
    riskLevel: analysisResult.analysis.riskLevel,
    liquidity: analysisResult.tokenInfo.liquidity,
    marketCap: analysisResult.tokenInfo.marketCap,
    ageHours: analysisResult.tokenInfo.ageHours,
    bundleDetected: analysisResult.bundleInfo?.detected || false,
    bundleCount: analysisResult.bundleInfo?.count || 0,
    bundleConfidence: analysisResult.bundleInfo?.confidence || 'NONE',
    flags: analysisResult.analysis.flags,
    summary: analysisResult.analysis.summary,
  });

  const result = await sendMessage(botToken, channelId, html);

  return c.json({
    sent: result.ok,
    messageId: result.messageId,
    error: result.error,
  });
});

// ============================================
// POST /telegram/setup
// Register webhook URL with Telegram
// ============================================
telegramRoutes.post('/setup', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: 'Bot token not configured' }, 500);
  }

  const baseUrl = new URL(c.req.url);
  const webhookUrl = `${baseUrl.protocol}//${baseUrl.host}/telegram/webhook`;

  const result = await setWebhook(botToken, webhookUrl);

  return c.json({
    webhookUrl,
    ...result,
  });
});

// ============================================
// DELETE /telegram/setup
// Remove webhook
// ============================================
telegramRoutes.delete('/setup', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: 'Bot token not configured' }, 500);
  }

  const result = await deleteWebhook(botToken);
  return c.json(result);
});

// ============================================
// GET /telegram/status
// Check bot info and configuration
// ============================================
telegramRoutes.get('/status', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  const channelId = c.env.TELEGRAM_CHANNEL_ID;

  if (!botToken) {
    return c.json({
      configured: false,
      botToken: false,
      channelId: !!channelId,
    });
  }

  const botInfo = await getMe(botToken);

  return c.json({
    configured: true,
    botToken: true,
    channelId: !!channelId,
    bot: botInfo.ok ? botInfo.result : null,
  });
});

// ============================================
// POST /telegram/test
// Send a test message to the channel
// ============================================
telegramRoutes.post('/test', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  const channelId = c.env.TELEGRAM_CHANNEL_ID;

  if (!botToken || !channelId) {
    return c.json({ error: 'Bot token or channel ID not configured' }, 500);
  }

  const testMessage = [
    '\u{1F6E1}\u{FE0F} <b>Argus AI is online.</b>',
    '',
    'The hundred-eyed guardian scanning Solana for pump syndicates, insider wallets, and coordinated dumps.',
    '',
    'Nothing hides from Argus.',
    '',
    `\u{1F310} <a href="https://argusguard.io">Website</a> | <a href="https://x.com/ArgusPanoptes7z">Twitter</a>`,
  ].join('\n');

  const result = await sendMessage(botToken, channelId, testMessage);

  return c.json({
    sent: result.ok,
    messageId: result.messageId,
    error: result.error,
  });
});

// ============================================
// POST /telegram/post
// Post a custom message to the channel (HTML)
// Body: { text: string }
// ============================================
telegramRoutes.post('/post', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  const channelId = c.env.TELEGRAM_CHANNEL_ID;

  if (!botToken || !channelId) {
    return c.json({ error: 'Bot token or channel ID not configured' }, 500);
  }

  const body = (await c.req.json()) as { text?: string };
  if (!body.text || body.text.length === 0) {
    return c.json({ error: 'Missing text' }, 400);
  }

  const result = await sendMessage(botToken, channelId, body.text);

  return c.json({
    sent: result.ok,
    messageId: result.messageId,
    error: result.error,
  });
});
