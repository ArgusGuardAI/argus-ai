import {
  HoneypotResult,
  HoneypotAIResponse,
  HoneypotFlag,
  getHoneypotRiskLevel,
} from '@whaleshield/shared';
import { HONEYPOT_SYSTEM_PROMPT } from '../prompts/honeypot-prompt';

const TOGETHER_API_URL = 'https://api.together.xyz/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

export interface TogetherAIConfig {
  apiKey: string;
  model?: string;
}

export interface AnalysisContext {
  tokenAddress: string;
  tokenName?: string;
  tokenSymbol?: string;
  liquidity?: number;
  deployerAddress?: string;
  contractCode?: string;
  onChainContext?: string; // Pre-formatted on-chain data
}

export async function analyzeForHoneypot(
  context: AnalysisContext,
  config: TogetherAIConfig | string
): Promise<HoneypotResult> {
  // Support both old string API key and new config object
  const apiKey = typeof config === 'string' ? config : config.apiKey;
  const model = typeof config === 'string' ? DEFAULT_MODEL : (config.model || DEFAULT_MODEL);

  const content = buildAnalysisContent(context);

  // Retry up to 2 times on parsing failure
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rawResponse = await callTogetherAI(content, apiKey, model);
      const parsed = parseAIResponse(rawResponse);

      // If parsing succeeded (confidence > 0), return result
      if (parsed.confidence > 0) {
        return {
          tokenAddress: context.tokenAddress,
          riskLevel: getHoneypotRiskLevel(parsed.riskScore),
          riskScore: parsed.riskScore,
          confidence: parsed.confidence,
          flags: parsed.flags,
          summary: parsed.summary,
          checkedAt: Date.now(),
        };
      }

      // Parsing failed, retry
      console.log(`Attempt ${attempt + 1} failed parsing, retrying...`);
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt + 1} error:`, error);
    }
  }

  // All retries failed
  console.error('All retry attempts failed:', lastError);
  return {
    tokenAddress: context.tokenAddress,
    riskLevel: 'SCAM',
    riskScore: 100,
    confidence: 0,
    flags: [
      {
        type: 'CONTRACT',
        severity: 'CRITICAL',
        message: 'ANALYSIS FAILED: Unable to parse AI response after retries',
      },
    ],
    summary:
      'Analysis failed due to AI response parsing error. Exercise extreme caution - do not interact with this token without manual verification.',
    checkedAt: Date.now(),
  };
}

function buildAnalysisContent(context: AnalysisContext): string {
  // If we have pre-formatted on-chain context, use it
  if (context.onChainContext) {
    return context.onChainContext;
  }

  // Fallback to basic context
  let content = `TOKEN ANALYSIS REQUEST:\n`;
  content += `- Address: ${context.tokenAddress}\n`;

  if (context.tokenName) {
    content += `- Name: ${context.tokenName}\n`;
  }
  if (context.tokenSymbol) {
    content += `- Symbol: ${context.tokenSymbol}\n`;
  }
  if (context.liquidity !== undefined) {
    content += `- Liquidity (USD): $${context.liquidity.toLocaleString()}\n`;
  }
  if (context.deployerAddress) {
    content += `- Deployer: ${context.deployerAddress}\n`;
  }
  if (context.contractCode) {
    content += `\nCONTRACT CODE:\n${context.contractCode}\n`;
  }

  return content;
}

async function callTogetherAI(content: string, apiKey: string, model: string): Promise<string> {
  console.log(`Calling Together AI with model: ${model}`);

  const response = await fetch(TOGETHER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: HONEYPOT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Analyze this Solana token for honeypot indicators and return ONLY a valid JSON object:\n\n${content}`,
        },
      ],
      temperature: 0.1, // Low temperature for consistent, deterministic results
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Together AI error response: ${error}`);
    throw new Error(`Together AI API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawContent = data.choices?.[0]?.message?.content || '';
  console.log(`Together AI raw response (first 500 chars): ${rawContent.slice(0, 500)}`);

  return rawContent;
}

function extractJsonFromResponse(rawResponse: string): string | null {
  // Strategy 1: Extract from markdown code blocks
  const codeBlockMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Strategy 2: Find JSON object boundaries
  const firstBrace = rawResponse.indexOf('{');
  const lastBrace = rawResponse.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return rawResponse.slice(firstBrace, lastBrace + 1);
  }

  // Strategy 3: Try the raw response directly
  const trimmed = rawResponse.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  return null;
}

function validateAIResponse(parsed: unknown): parsed is HoneypotAIResponse {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.risk_score !== 'number' || obj.risk_score < 0 || obj.risk_score > 100) {
    return false;
  }

  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 100) {
    return false;
  }

  if (!Array.isArray(obj.flags)) {
    return false;
  }

  if (typeof obj.summary !== 'string') {
    return false;
  }

  const validRiskLevels = ['SAFE', 'SUSPICIOUS', 'DANGEROUS', 'SCAM'];
  if (typeof obj.risk_level !== 'string' || !validRiskLevels.includes(obj.risk_level)) {
    return false;
  }

  return true;
}

interface ParsedHoneypotResponse {
  riskScore: number;
  confidence: number;
  flags: HoneypotFlag[];
  summary: string;
}

function parseAIResponse(rawResponse: string): ParsedHoneypotResponse {
  try {
    const jsonStr = extractJsonFromResponse(rawResponse);

    if (!jsonStr) {
      throw new Error('No valid JSON found in AI response');
    }

    const parsed = JSON.parse(jsonStr);

    if (!validateAIResponse(parsed)) {
      throw new Error('AI response failed schema validation');
    }

    return {
      riskScore: Math.max(0, Math.min(100, parsed.risk_score)),
      confidence: Math.max(0, Math.min(100, parsed.confidence)),
      flags: parsed.flags.map(
        (flag: { type: string; severity: string; message: string }): HoneypotFlag => ({
          type: flag.type as HoneypotFlag['type'],
          severity: flag.severity as HoneypotFlag['severity'],
          message: flag.message,
        })
      ),
      summary: parsed.summary,
    };
  } catch (error) {
    console.error('Failed to parse AI response:', error);

    // Return maximum risk for parsing failures
    return {
      riskScore: 100,
      confidence: 0,
      flags: [
        {
          type: 'CONTRACT',
          severity: 'CRITICAL',
          message: 'ANALYSIS FAILED: Unable to parse AI response',
        },
      ],
      summary:
        'Analysis failed due to AI response parsing error. Exercise extreme caution - do not interact with this token without manual verification.',
    };
  }
}
