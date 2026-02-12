/**
 * LLMService - Real AI reasoning via local Ollama server
 *
 * Calls a self-hosted Ollama instance with DeepSeek-R1 32B for
 * deep reasoning and Qwen 3 8B for fast classification. Zero API costs.
 * Configure endpoint via LLM_ENDPOINT environment variable.
 *
 * Graceful degradation: if LLM server is unreachable, callers
 * get null and fall back to existing rule-based logic.
 */

export interface LLMConfig {
  endpoint: string;        // Set via LLM_ENDPOINT env var
  reasoningModel: string;  // deepseek-r1:32b
  fastModel: string;       // qwen3:8b
  reasoningTimeout: number; // 300000ms for deep reasoning (DeepSeek-R1 thinks long)
  fastTimeout: number;      // 60000ms for fast tasks
}

export interface TokenAnalysisContext {
  tokenAddress: string;
  score: number;
  riskLevel: string;
  findings: Array<{ category: string; finding: string; severity: string; evidence?: string }>;
  security: { mintDisabled: boolean; freezeDisabled: boolean; lpLocked: boolean; lpBurned: boolean };
  holders: { count: number; top10Concentration: number; topWhalePercent: number; gini: number };
  bundle: { detected: boolean; count: number; controlPercent: number; confidence: number };
  trading: { buyRatio24h: number; buyRatio1h: number; volume: number; liquidity: number };
  creator: { identified: boolean; rugHistory: number; holdings: number; isKnownScammer: boolean };
  tokenAge: string;
}

export interface TokenVerdict {
  verdict: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  confidence: number;
  reasoning: string;
  summary: string;
  attackVector: string | null;
  recommendations: string[];
}

export interface PatternClassification {
  pattern: string;
  confidence: number;
  evidence: string[];
  reasoning: string;
}

const TOKEN_ANALYSIS_SYSTEM = `You are Argus, an AI analyst specializing in Solana token security and scam detection.
You receive structured on-chain data about a token and must produce a risk assessment.

RULES:
- Only reference data you are given. Never fabricate or assume evidence.
- Your verdict must be one of: SAFE, SUSPICIOUS, DANGEROUS, SCAM
- Explain HOW the evidence connects (e.g., "bundle detected + fresh wallets + creator rug history = coordinated pump-and-dump setup")
- If evidence is insufficient for a strong conclusion, say so. Limited data with any risk signals = SUSPICIOUS, not SAFE.
- Be concise. No filler text.

You MUST respond with valid JSON only, no markdown or other text:
{
  "verdict": "DANGEROUS",
  "confidence": 0.85,
  "reasoning": "2-3 sentences connecting the evidence",
  "summary": "One paragraph synthesizing all findings for a trader",
  "attackVector": "PUMP_AND_DUMP or null if no clear pattern",
  "recommendations": ["action 1", "action 2"]
}`;

const PATTERN_DETECTION_SYSTEM = `You are Argus Hunter, an AI specialist in Solana scammer wallet analysis.
You receive wallet profile data and must classify the scam pattern.

KNOWN PATTERNS: BUNDLE_COORDINATOR, RUG_PULLER, WASH_TRADER, INSIDER, PUMP_AND_DUMP, HONEYPOT, MICRO_CAP_TRAP, LEGITIMATE_VC, UNKNOWN

RULES:
- Only use evidence from provided data. Never fabricate.
- Classify as UNKNOWN if insufficient evidence (this is expected and correct).
- Confidence must reflect actual evidence strength — 0.5 means uncertain, 0.9+ means overwhelming evidence.
- List specific evidence points that support your classification.
- Be concise.

You MUST respond with valid JSON only, no markdown or other text:
{
  "pattern": "BUNDLE_COORDINATOR",
  "confidence": 0.89,
  "evidence": ["specific evidence point 1", "specific evidence point 2"],
  "reasoning": "1-2 sentences connecting evidence to pattern"
}`;

export class LLMService {
  private config: LLMConfig;
  private available: boolean | null = null; // null = unknown, check on first call
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 60000; // re-check every 60s if unavailable

  constructor(config: Partial<LLMConfig> & { endpoint: string }) {
    this.config = {
      endpoint: config.endpoint,
      reasoningModel: config.reasoningModel || 'deepseek-r1:32b',
      fastModel: config.fastModel || 'qwen3:8b',
      reasoningTimeout: config.reasoningTimeout || 300000,
      fastTimeout: config.fastTimeout || 60000,
    };
  }

  /**
   * Check if LLM server is reachable
   */
  async isAvailable(): Promise<boolean> {
    // Cache result for healthCheckInterval
    if (this.available !== null && Date.now() - this.lastHealthCheck < this.healthCheckInterval) {
      return this.available;
    }

    try {
      const response = await fetch(`${this.config.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        const models = data.models?.map(m => m.name) || [];
        this.available = true;
        this.lastHealthCheck = Date.now();
        console.log(`[LLMService] Connected (models: ${models.join(', ')})`);
        return true;
      }
    } catch {
      // Server unreachable
    }

    this.available = false;
    this.lastHealthCheck = Date.now();
    return false;
  }

  /**
   * Core method: send a prompt to the LLM and get a response
   */
  async chat(options: {
    system: string;
    prompt: string;
    model?: 'reasoning' | 'fast';
    format?: 'json';
    temperature?: number;
  }): Promise<string | null> {
    if (!(await this.isAvailable())) {
      return null;
    }

    const modelName = options.model === 'reasoning'
      ? this.config.reasoningModel
      : this.config.fastModel;

    const timeout = options.model === 'reasoning'
      ? this.config.reasoningTimeout
      : this.config.fastTimeout;

    // Disable thinking for fast model (Qwen 3 defaults to thinking mode which adds 60-90s overhead)
    // Only keep thinking enabled for the reasoning model (DeepSeek-R1)
    const useThinking = options.model === 'reasoning';

    const body: Record<string, unknown> = {
      model: modelName,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.prompt },
      ],
      stream: false,
      think: useThinking,
      options: {
        temperature: options.temperature ?? 0.3,
        num_predict: options.model === 'reasoning' ? 2048 : 1024,
      },
    };

    if (options.format === 'json') {
      body.format = 'json';
    }

    // Retry once on failure
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${this.config.endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          console.warn(`[LLMService] HTTP ${response.status} from ${modelName}`);
          continue;
        }

        const data = await response.json() as { message?: { content: string; thinking?: string } };
        // Some models (DeepSeek-R1, Qwen 3 in think mode) put output in thinking field
        // Prefer content, fall back to thinking
        let content = data.message?.content;

        // If content is empty but thinking has data, use thinking
        if ((!content || content.trim() === '') && data.message?.thinking) {
          content = data.message.thinking;
        }

        if (!content || content.trim() === '') {
          console.warn('[LLMService] Empty response from LLM');
          continue;
        }

        // Strip any <think>...</think> tags that DeepSeek-R1 might include
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        return content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          console.warn(`[LLMService] Attempt 1 failed (${msg}), retrying...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.warn(`[LLMService] Both attempts failed for ${modelName}: ${msg}`);
          this.available = false; // Mark unavailable, will re-check after interval
        }
      }
    }

    return null;
  }

  /**
   * Analyze a token and produce a verdict with reasoning
   * Uses the deep reasoning model (DeepSeek-R1 32B)
   */
  async analyzeToken(context: TokenAnalysisContext): Promise<TokenVerdict | null> {
    const prompt = `Analyze this Solana token for scam risk:

TOKEN: ${context.tokenAddress}
AGE: ${context.tokenAge}
CURRENT SCORE: ${context.score}/100 (${context.riskLevel})

SECURITY:
- Mint authority: ${context.security.mintDisabled ? 'DISABLED (safe)' : 'ACTIVE (can mint more)'}
- Freeze authority: ${context.security.freezeDisabled ? 'DISABLED (safe)' : 'ACTIVE (can freeze wallets)'}
- LP locked: ${context.security.lpLocked ? 'YES' : 'NO'}
- LP burned: ${context.security.lpBurned ? 'YES' : 'NO'}

HOLDERS:
- Count: ${context.holders.count}
- Top 10 concentration: ${(context.holders.top10Concentration * 100).toFixed(1)}%
- Top whale: ${(context.holders.topWhalePercent * 100).toFixed(1)}%
- Gini coefficient: ${context.holders.gini.toFixed(2)}

BUNDLE DETECTION:
- Bundles detected: ${context.bundle.detected ? 'YES' : 'NO'}
${context.bundle.detected ? `- Bundle count: ${context.bundle.count}\n- Bundle control: ${(context.bundle.controlPercent * 100).toFixed(1)}%\n- Confidence: ${(context.bundle.confidence * 100).toFixed(0)}%` : ''}

TRADING:
- 24h buy ratio: ${(context.trading.buyRatio24h * 100).toFixed(0)}%
- 1h buy ratio: ${(context.trading.buyRatio1h * 100).toFixed(0)}%
- Volume: $${context.trading.volume.toLocaleString()}
- Liquidity: $${context.trading.liquidity.toLocaleString()}

CREATOR:
- Identified: ${context.creator.identified ? 'YES' : 'NO'}
- Known scammer: ${context.creator.isKnownScammer ? 'YES' : 'NO'}
- Past rug count: ${context.creator.rugHistory}
- Current holdings: ${(context.creator.holdings * 100).toFixed(1)}%

FINDINGS:
${context.findings.map(f => `- [${f.severity}] ${f.category}: ${f.finding}${f.evidence ? ' (' + f.evidence + ')' : ''}`).join('\n')}`;

    const raw = await this.chat({
      system: TOKEN_ANALYSIS_SYSTEM,
      prompt,
      model: 'fast',
      format: 'json',
      temperature: 0.2,
    });

    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return {
        verdict: this.validateVerdict(parsed.verdict),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        reasoning: String(parsed.reasoning || ''),
        summary: String(parsed.summary || ''),
        attackVector: parsed.attackVector || null,
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
      };
    } catch (err) {
      console.warn('[LLMService] Failed to parse token analysis:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Classify a wallet's scam pattern
   * Uses the deep reasoning model (DeepSeek-R1 32B)
   */
  async classifyPattern(profile: {
    wallet: string;
    tokensInvolved: string[];
    ruggedTokens: string[];
    connectedWallets: string[];
    evidence: string[];
    bundleCount?: number;
    transactionCount?: number;
    walletAge?: string;
  }): Promise<PatternClassification | null> {
    const prompt = `Classify this wallet's scam pattern:

WALLET: ${profile.wallet}
TOKENS INVOLVED: ${profile.tokensInvolved.length} (${profile.tokensInvolved.slice(0, 5).join(', ')}${profile.tokensInvolved.length > 5 ? '...' : ''})
RUGGED TOKENS: ${profile.ruggedTokens.length} (${profile.ruggedTokens.slice(0, 5).join(', ')}${profile.ruggedTokens.length > 5 ? '...' : ''})
CONNECTED WALLETS: ${profile.connectedWallets.length}
${profile.bundleCount ? `BUNDLE PARTICIPATIONS: ${profile.bundleCount}` : ''}
${profile.transactionCount ? `TRANSACTION COUNT: ${profile.transactionCount}` : ''}
${profile.walletAge ? `WALLET AGE: ${profile.walletAge}` : ''}

EVIDENCE:
${profile.evidence.map(e => `- ${e}`).join('\n') || '- No specific evidence collected yet'}`;

    const raw = await this.chat({
      system: PATTERN_DETECTION_SYSTEM,
      prompt,
      model: 'fast',
      format: 'json',
      temperature: 0.2,
    });

    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return {
        pattern: String(parsed.pattern || 'UNKNOWN'),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
        reasoning: String(parsed.reasoning || ''),
      };
    } catch (err) {
      console.warn('[LLMService] Failed to parse pattern classification:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Quick assessment using fast model (Qwen 3 8B)
   * For quick yes/no decisions, brief summaries
   */
  async quickAssess(prompt: string): Promise<string | null> {
    return this.chat({
      system: 'You are Argus, a Solana token security AI. Be concise. Answer in 1-3 sentences.',
      prompt,
      model: 'fast',
      temperature: 0.3,
    });
  }

  /**
   * General-purpose generation with the fast model
   * Replacement for BitNetEngine.templateGenerate()
   */
  async generate(prompt: string, format?: 'json' | 'text'): Promise<string | null> {
    return this.chat({
      system: 'You are Argus, an AI agent for Solana blockchain security. Respond concisely and accurately. Only use data you are given.',
      prompt,
      model: 'fast',
      format: format === 'json' ? 'json' : undefined,
      temperature: 0.3,
    });
  }

  /**
   * Validate verdict string
   */
  private validateVerdict(v: unknown): TokenVerdict['verdict'] {
    const valid = ['SAFE', 'SUSPICIOUS', 'DANGEROUS', 'SCAM'];
    const s = String(v).toUpperCase();
    return valid.includes(s) ? s as TokenVerdict['verdict'] : 'SUSPICIOUS';
  }

  /**
   * Generate natural dialogue for agent communication
   * Used for Activity Feed in the dashboard
   */
  async generateDialogue(context: {
    agent: 'scout' | 'analyst' | 'hunter' | 'trader';
    event: string;
    targetAgent?: string;
    data: Record<string, unknown>;
  }): Promise<string | null> {
    const { agent, event, targetAgent, data } = context;

    const prompt = `You are ${agent.toUpperCase()}, an AI agent in the Argus swarm. Generate a BRIEF message (1-2 sentences max) to ${targetAgent || 'the team'} about this event.

EVENT: ${event}
DATA: ${JSON.stringify(data, null, 2)}

Rules:
- Speak naturally, like a team member sharing intel
- Be concise - max 15-20 words
- Reference specific data when relevant (token symbols, scores, wallet prefixes)
- No emojis
- If talking to another agent, start with "→ AGENT_NAME:"

Example good responses:
- "→ HUNTER: Flagged token ABC... score 78. Creator looks suspicious."
- "Added wallet 8kQ2... to watchlist. Tracking for 24h."
- "→ ANALYST: Closed position on XYZ at +12%. Learning from this win."`;

    const response = await this.chat({
      system: 'You generate brief, natural AI agent dialogue. Respond with ONLY the dialogue text, no quotes or extra formatting.',
      prompt,
      model: 'fast',
      temperature: 0.7, // Slightly higher for variety
    });

    return response?.trim() || null;
  }

  /**
   * Get service info
   */
  getInfo(): { endpoint: string; reasoningModel: string; fastModel: string; available: boolean | null } {
    return {
      endpoint: this.config.endpoint,
      reasoningModel: this.config.reasoningModel,
      fastModel: this.config.fastModel,
      available: this.available,
    };
  }
}
