/**
 * Chat Routes - Conversational interface for Argus
 *
 * Handles natural language queries and routes them to appropriate handlers.
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import { chat, chatStream, parseIntent, getFallbackResponse, type ChatIntent } from '../services/ollama';
import { SentinelDataFetcher } from '../services/sentinel-data';

const chatRoutes = new Hono<{ Bindings: Bindings }>();

interface ChatRequest {
  message: string;
  walletAddress?: string;
}

interface ChatResponse {
  response: string;
  intent?: ChatIntent;
  analysis?: {
    score: number;
    verdict: string;
    summary: string;
  };
  tokenAddress?: string;
  tokenSymbol?: string;
  action?: {
    type: string;
    data?: Record<string, unknown>;
  };
}

/**
 * POST /chat/message
 * Process a chat message and return Argus's response
 */
chatRoutes.post('/message', async (c) => {
  const start = Date.now();

  try {
    const body = await c.req.json<ChatRequest>();
    const { message, walletAddress } = body;

    if (!message || typeof message !== 'string') {
      return c.json({ error: 'Message is required' }, 400);
    }

    console.log(`[Chat] Processing message: "${message.slice(0, 50)}..."`);

    // Parse user intent
    const intent = parseIntent(message);
    console.log(`[Chat] Detected intent: ${intent.type}`);

    let response: string;
    let analysis: ChatResponse['analysis'];
    let tokenAddress: string | undefined;
    let tokenSymbol: string | undefined;

    // Handle different intents
    switch (intent.type) {
      case 'analyze': {
        if (intent.tokenAddress) {
          // Run actual analysis
          try {
            const fetcher = new SentinelDataFetcher(c.env);
            const data = await fetcher.fetch(intent.tokenAddress);

            // Convert to safety score (inverted from risk)
            const safetyScore = Math.max(0, 100 - (data.analysis?.riskScore || 50));
            const verdict = safetyScore >= 60 ? 'SAFE' : safetyScore >= 40 ? 'SUSPICIOUS' : 'DANGEROUS';

            analysis = {
              score: safetyScore,
              verdict,
              summary: data.analysis?.reasoning || 'Analysis complete.',
            };
            tokenAddress = intent.tokenAddress;
            tokenSymbol = data.tokenInfo?.symbol || undefined;

            response = `I've analyzed ${tokenSymbol || 'this token'}.\n\n` +
              `Safety Score: ${safetyScore}/100 (${verdict})\n` +
              `${data.analysis?.reasoning || ''}\n\n` +
              (data.bundleInfo?.bundleDetected ? `Warning: Bundle activity detected with ${data.bundleInfo.bundleCount} coordinated wallets.\n` : '') +
              (data.security?.mintDisabled === false ? 'Warning: Mint authority is still active.\n' : '') +
              (data.security?.lpLocked === false ? 'Warning: Liquidity is not locked.\n' : '');
          } catch (err) {
            console.error('[Chat] Analysis error:', err);
            response = `I encountered an error analyzing ${intent.tokenAddress}. Please try again.`;
          }
        } else {
          response = 'Please provide a token address to analyze. You can paste any Solana contract address.';
        }
        break;
      }

      case 'trending': {
        // Return info about recent discoveries
        response = 'I\'m constantly monitoring Solana for new opportunities. ' +
          'Check the discovery feed for my latest findings. ' +
          'I\'ll alert you here when I find something particularly interesting.';
        break;
      }

      case 'positions': {
        response = 'Your positions are shown in the panel on the right. ' +
          'I track your P&L in real-time and can help you manage exits.';
        break;
      }

      case 'buy': {
        if (!intent.tokenAddress) {
          response = 'Which token would you like to buy? Provide the contract address.';
        } else if (!intent.amount) {
          response = `How much SOL would you like to spend? Example: "buy 0.5 SOL of ${intent.tokenAddress.slice(0, 8)}..."`;
        } else {
          // Validate token first
          response = `To buy ${intent.amount} SOL of this token, please use the Buy panel. I'll monitor the position for you.`;
          tokenAddress = intent.tokenAddress;
        }
        break;
      }

      case 'sell': {
        response = intent.tokenAddress
          ? `To sell your position, use the Sell button in the positions panel.`
          : 'Which position would you like to sell?';
        break;
      }

      case 'track': {
        if (intent.walletAddress) {
          response = `I've noted wallet ${intent.walletAddress.slice(0, 8)}...${intent.walletAddress.slice(-4)}. ` +
            'Hunter will monitor it for suspicious activity.';
        } else {
          response = 'Provide a wallet address to track. I\'ll alert you when it makes moves.';
        }
        break;
      }

      default: {
        // Try Ollama for general queries
        try {
          response = await chat(message);
        } catch (err) {
          console.log('[Chat] Ollama unavailable, using fallback');
          response = getFallbackResponse(intent);
        }
      }
    }

    const result: ChatResponse = {
      response,
      intent,
      analysis,
      tokenAddress,
      tokenSymbol,
    };

    console.log(`[Chat] Response generated in ${Date.now() - start}ms`);

    return c.json(result);
  } catch (error) {
    console.error('[Chat] Error:', error);
    return c.json(
      {
        response: 'I encountered an error processing your request. Please try again.',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /chat/stream
 * Stream chat response via Server-Sent Events
 */
chatRoutes.get('/stream', async (c) => {
  const message = c.req.query('message');

  if (!message) {
    return c.json({ error: 'Message query param required' }, 400);
  }

  console.log(`[Chat] Streaming: "${message.slice(0, 50)}..."`);

  // Parse intent first
  const intent = parseIntent(message);

  // For non-general intents, return quick response (no streaming needed)
  if (intent.type !== 'general') {
    const quickResponse = getFallbackResponse(intent);
    return new Response(
      `data: ${JSON.stringify({ content: quickResponse, done: true })}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  }

  try {
    const ollamaStream = await chatStream(message);

    // Transform Ollama's NDJSON stream to SSE
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk);
        const lines = text.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const content = data.message?.content || '';
            const done = data.done || false;

            if (content || done) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content, done })}\n\n`)
              );
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      },
    });

    const sseStream = ollamaStream.pipeThrough(transformStream);

    return new Response(sseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[Chat] Stream error:', err);
    return new Response(
      `data: ${JSON.stringify({ content: getFallbackResponse(intent), done: true })}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      }
    );
  }
});

/**
 * GET /chat/health
 * Check chat service health (including Ollama connectivity)
 */
chatRoutes.get('/health', async (c) => {
  let ollamaStatus = 'unknown';
  let models: string[] = [];

  try {
    // Quick check to Ollama on RPC node
    const response = await fetch('http://144.XX.XX.XXX:8899/api/tags', {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { models?: Array<{ name: string }> };
      models = data.models?.map(m => m.name) || [];
      ollamaStatus = 'online';
    } else {
      ollamaStatus = 'error';
    }
  } catch {
    ollamaStatus = 'offline';
  }

  return c.json({
    status: 'ok',
    ollama: ollamaStatus,
    models,
    timestamp: Date.now(),
  });
});

export { chatRoutes };
