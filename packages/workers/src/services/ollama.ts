/**
 * Ollama Client - Connect to self-hosted Ollama server
 *
 * Provides natural language understanding for the chat interface.
 * Configure via LLM_ENDPOINT environment variable.
 */

// Ollama server (DeepSeek-R1 32B + Qwen 3 8B)
// Set via environment variable - never hardcode IPs
const OLLAMA_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface ChatIntent {
  type: 'analyze' | 'trending' | 'positions' | 'buy' | 'sell' | 'track' | 'general';
  tokenAddress?: string;
  walletAddress?: string;
  amount?: number;
  query?: string;
}

// System prompt for Argus
const SYSTEM_PROMPT = `You are Argus, an AI assistant specialized in Solana token analysis and trading safety.

Your capabilities:
- Analyze token contracts for risks (honeypots, rug pulls, scams)
- Detect coordinated wallet bundles
- Track suspicious wallets and scammer networks
- Provide market data and holder distribution analysis
- Execute trades via Jupiter aggregator

Communication style:
- Be VERY concise - max 2-3 sentences for simple questions
- Use bullet points sparingly, only for lists of 3+ items
- No markdown headers (###) - just plain text
- Use specific numbers when available
- Warn clearly about risks
- No emojis, no filler words

When analyzing tokens, look for:
- High holder concentration (top 10 > 50%)
- Bundle activity (coordinated wallets)
- Unlocked liquidity
- Active mint/freeze authority
- Low liquidity relative to market cap
- Suspicious trading patterns

If you need to analyze a specific token, include the token address in your response with [ANALYZE:address] format.
If the user wants to track a wallet, include [TRACK:address] format.
If the user wants to buy, include [BUY:amount:address] format.`;

/**
 * Send a chat message to Ollama and get a response (non-streaming)
 */
export async function chat(
  userMessage: string,
  conversationHistory: OllamaMessage[] = []
): Promise<string> {
  const messages: OllamaMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:8b',
        messages,
        stream: false,
        think: false,
        options: {
          temperature: 0.5,
          num_predict: 100,  // Very short responses for speed
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as OllamaResponse;
    return data.message.content;
  } catch (error) {
    console.error('[Ollama] Chat error:', error);
    throw error;
  }
}

/**
 * Stream chat response from Ollama
 */
export async function chatStream(
  userMessage: string,
  conversationHistory: OllamaMessage[] = []
): Promise<ReadableStream> {
  const messages: OllamaMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3:8b',
      messages,
      stream: true,
      think: false,
      options: {
        temperature: 0.5,
        num_predict: 200,
      },
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  return response.body;
}

/**
 * Parse user intent from their message
 * This is a simple rule-based parser; Ollama handles more complex queries
 */
export function parseIntent(message: string): ChatIntent {
  const lower = message.toLowerCase().trim();

  // Check for Solana address pattern (base58, 32-44 chars)
  const addressMatch = message.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);

  // Analyze intent
  if (lower.includes('analyze') || lower.includes('check') || lower.includes('scan')) {
    return {
      type: 'analyze',
      tokenAddress: addressMatch?.[0],
    };
  }

  // Trending/discoveries
  if (lower.includes('trending') || lower.includes('discover') || lower.includes('new') || lower.includes('hot')) {
    return { type: 'trending' };
  }

  // Positions
  if (lower.includes('position') || lower.includes('portfolio') || lower.includes('holdings')) {
    return { type: 'positions' };
  }

  // Buy intent
  if (lower.includes('buy')) {
    const amountMatch = message.match(/(\d+(?:\.\d+)?)\s*sol/i);
    return {
      type: 'buy',
      tokenAddress: addressMatch?.[0],
      amount: amountMatch ? parseFloat(amountMatch[1]) : undefined,
    };
  }

  // Sell intent
  if (lower.includes('sell')) {
    return {
      type: 'sell',
      tokenAddress: addressMatch?.[0],
    };
  }

  // Track wallet - only if there's an address to track
  if ((lower.includes('track') || lower.includes('watch wallet') || lower.includes('monitor wallet')) && addressMatch) {
    return {
      type: 'track',
      walletAddress: addressMatch[0],
    };
  }

  // General question
  return {
    type: 'general',
    query: message,
  };
}

/**
 * Generate a fallback response when Ollama is unavailable
 */
export function getFallbackResponse(intent: ChatIntent): string {
  switch (intent.type) {
    case 'analyze':
      if (intent.tokenAddress) {
        return `I'll analyze ${intent.tokenAddress.slice(0, 8)}...${intent.tokenAddress.slice(-4)} for you. Running security checks now.`;
      }
      return 'Please provide a token address to analyze. You can paste any Solana token contract address.';

    case 'trending':
      return 'I\'m monitoring the latest token launches. Check the discovery feed on the right for real-time findings from my agents.';

    case 'positions':
      return 'Your active positions are shown in the panel on the right. I track P&L and can help you manage them.';

    case 'buy':
      if (!intent.tokenAddress) {
        return 'Which token would you like to buy? Provide the contract address and I\'ll check if it\'s safe first.';
      }
      if (!intent.amount) {
        return `How much SOL would you like to spend on ${intent.tokenAddress.slice(0, 8)}...? Example: "buy 0.5 SOL"`;
      }
      return `Preparing to buy ${intent.amount} SOL worth. Let me verify the token safety first.`;

    case 'sell':
      return intent.tokenAddress
        ? `I'll help you sell your position in ${intent.tokenAddress.slice(0, 8)}...`
        : 'Which position would you like to sell?';

    case 'track':
      return intent.walletAddress
        ? `I'll add ${intent.walletAddress.slice(0, 8)}... to Hunter\'s watchlist.`
        : 'Provide a wallet address to track. I\'ll alert you when it makes suspicious moves.';

    default:
      return 'I\'m here to help you analyze tokens, track wallets, and trade safely on Solana. What would you like to do?';
  }
}
