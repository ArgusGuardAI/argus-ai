/**
 * Token Analyzer v2
 * Combines heuristic scoring + on-chain security + tiered AI analysis
 *
 * Flow:
 * 1. Fetch on-chain security data (mint/freeze authority, holders)
 * 2. Calculate heuristic score (0-100)
 * 3. Tiered AI analysis:
 *    - Score >= 50: Full AI analysis with reasoning
 *    - Score 30-49: Quick AI "hidden gem" check
 *    - Score < 30: Skip AI (AVOID signal)
 */

import type { NewTokenEvent, SnipeDecision, SniperConfig } from '../types';
import { calculateHeuristicScore, getAITier, type SignalType, type HeuristicResult } from './heuristic-scorer';
import { getOnChainSecurity, type OnChainData } from './onchain-security';
import { getTokenSecurity } from './token-security-api';

// AI Providers - Try Groq first (FREE), fallback to Together AI
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const TOGETHER_AI_API_KEY = process.env.TOGETHER_AI_API_KEY || '';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const TOGETHER_ENDPOINT = 'https://api.together.xyz/v1/chat/completions';
const TOGETHER_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// Track Groq rate limits
let groqRateLimited = false;
let groqRateLimitReset = 0;

// Helper to make AI request with fallback
async function makeAIRequest(messages: any[], maxTokens: number): Promise<{ content: string; tokens: number } | null> {
  // Try Groq first if available and not rate limited
  if (GROQ_API_KEY && !groqRateLimited) {
    try {
      const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        return {
          content: data.choices?.[0]?.message?.content || '',
          tokens: data.usage?.total_tokens || 0,
        };
      }

      if (response.status === 429) {
        console.log('[Analyzer] Groq rate limited, switching to Together AI');
        groqRateLimited = true;
        groqRateLimitReset = Date.now() + 60000; // Reset after 1 minute
      }
    } catch (e) {
      console.log('[Analyzer] Groq error, trying Together AI');
    }
  }

  // Reset Groq rate limit after timeout
  if (groqRateLimited && Date.now() > groqRateLimitReset) {
    groqRateLimited = false;
  }

  // Fallback to Together AI
  if (TOGETHER_AI_API_KEY) {
    try {
      const response = await fetch(TOGETHER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOGETHER_AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: TOGETHER_MODEL,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        return {
          content: data.choices?.[0]?.message?.content || '',
          tokens: data.usage?.total_tokens || 0,
        };
      }
      console.log('[Analyzer] Together AI error:', response.status);
    } catch (e) {
      console.log('[Analyzer] Together AI error:', e);
    }
  }

  return null;
}

// For compatibility - check if any AI is available
const AI_API_KEY = GROQ_API_KEY || TOGETHER_AI_API_KEY;

// Security check modes:
// - 'api': Use FREE APIs (RugCheck, Birdeye) - DEFAULT
// - 'rpc': Use Solana RPC (requires Helius or similar)
// - 'skip': Skip all security checks
const SECURITY_MODE = process.env.SECURITY_MODE || 'api';
const SKIP_ONCHAIN_CHECKS = SECURITY_MODE === 'skip' || process.env.SKIP_ONCHAIN_CHECKS === 'true';

// Rate limiting
const MAX_ANALYSES_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60000;

export interface AIAnalysis {
  tier: 'full' | 'quick' | 'skip';
  signal?: SignalType;
  risk?: number;
  confidence?: number;
  verdict?: string;
  reasoning?: string;
  redFlags?: string[];
  greenFlags?: string[];
  watch?: boolean;
}

export class TokenAnalyzer {
  private config: SniperConfig;
  private analysisTimestamps: number[] = [];
  private aiTokensUsed = 0;

  constructor(config: SniperConfig) {
    this.config = config;
  }

  /**
   * Main analysis entry point
   * Returns heuristic score, on-chain data, and optional AI analysis
   */
  async analyze(token: NewTokenEvent): Promise<SnipeDecision & { ai?: AIAnalysis }> {
    console.log(`\n[Analyzer] ══════════════════════════════════════`);
    console.log(`[Analyzer] 🔍 Analyzing ${token.symbol} (${token.address.slice(0, 8)}...)`);

    // Step 1: Fetch security data
    let onChain: OnChainData | null = null;

    if (SKIP_ONCHAIN_CHECKS) {
      console.log(`[Analyzer] ⏭️ Skipping security checks (SECURITY_MODE=skip)`);
    } else if (SECURITY_MODE === 'api') {
      // Use FREE APIs (RugCheck, Birdeye) - no RPC needed!
      console.log(`[Analyzer] 🔐 Fetching security data (FREE API)...`);
      onChain = await getTokenSecurity(token.address);

      if (onChain) {
        console.log(`[Analyzer]    Mint: ${onChain.mintAuthorityRevoked ? '✅ Revoked' : '⚠️ Active'}`);
        console.log(`[Analyzer]    Freeze: ${onChain.freezeAuthorityRevoked ? '✅ Revoked' : '⚠️ Active'}`);
        console.log(`[Analyzer]    Top holder: ${onChain.topHolderPercent.toFixed(1)}%`);
      } else {
        console.log(`[Analyzer]    ⚠️ Could not fetch security data from API`);
      }
    } else {
      // Use RPC (requires Helius or similar)
      console.log(`[Analyzer] 📡 Fetching on-chain data (RPC)...`);
      onChain = await getOnChainSecurity(token.address);

      if (onChain) {
        console.log(`[Analyzer]    Mint: ${onChain.mintAuthorityRevoked ? '✅ Revoked' : '⚠️ Active'}`);
        console.log(`[Analyzer]    Freeze: ${onChain.freezeAuthorityRevoked ? '✅ Revoked' : '⚠️ Active'}`);
        console.log(`[Analyzer]    Top holder: ${onChain.topHolderPercent.toFixed(1)}%`);
      } else {
        console.log(`[Analyzer]    ⚠️ Could not fetch on-chain data`);
      }
    }

    // Step 2: Calculate heuristic score
    const heuristic = calculateHeuristicScore(token, onChain);
    console.log(`[Analyzer] 📊 Heuristic Score: ${heuristic.score}/100 → ${heuristic.signal}`);
    console.log(`[Analyzer]    Breakdown: Security ${heuristic.breakdown.security}, Liquidity ${heuristic.breakdown.liquidity}, Volume ${heuristic.breakdown.volume}, Momentum ${heuristic.breakdown.momentum}, Activity ${heuristic.breakdown.activity}`);

    // Step 3: Determine AI tier
    const aiTier = getAITier(heuristic.score);
    console.log(`[Analyzer] 🤖 AI Tier: ${aiTier.toUpperCase()}`);

    // Step 4: Run AI analysis based on tier
    let ai: AIAnalysis | undefined;

    if (aiTier === 'skip') {
      console.log(`[Analyzer] ⏭️ Skipping AI (score too low)`);
      ai = { tier: 'skip' };
    } else if (!AI_API_KEY) {
      console.log(`[Analyzer] ⚠️ No AI API key configured (set GROQ_API_KEY for FREE AI)`);
      ai = { tier: aiTier };
    } else if (!this.checkRateLimit()) {
      console.log(`[Analyzer] ⚠️ Rate limited, skipping AI`);
      ai = { tier: aiTier };
    } else if (aiTier === 'full') {
      ai = await this.runFullAnalysis(token, heuristic, onChain);
    } else {
      ai = await this.runQuickCheck(token, heuristic, onChain);
    }

    // Step 5: Determine final signal
    let finalSignal = heuristic.signal;
    let shouldBuy = heuristic.score >= 45; // WATCH or higher

    // AI can override signal if confidence is high
    if (ai?.tier === 'full' && ai.signal && ai.confidence && ai.confidence >= 70) {
      finalSignal = ai.signal;
      shouldBuy = ['STRONG_BUY', 'BUY', 'WATCH'].includes(ai.signal);
      console.log(`[Analyzer] 🧠 AI Override: ${ai.signal} (${ai.confidence}% confidence)`);
    }

    // Quick check can promote HOLD → WATCH
    if (ai?.tier === 'quick' && ai.watch && finalSignal === 'HOLD') {
      finalSignal = 'WATCH';
      shouldBuy = true;
      console.log(`[Analyzer] 👀 AI found hidden gem, promoting to WATCH`);
    }

    // Check against min score threshold (higher score = better in new system)
    // In new system: 75+=STRONG_BUY, 60-74=BUY, 45-59=WATCH, 30-44=HOLD, <30=AVOID
    // Default to 45 (WATCH level) - reasonable threshold for auto-trading
    // Note: Old config values (like 75) are too restrictive - cap at 60 max
    const configuredMin = this.config.minScore || 60;
    const minScore = Math.min(configuredMin, 60); // Cap at BUY level, don't require STRONG_BUY
    if (heuristic.score < minScore) {
      shouldBuy = false;
      console.log(`[Analyzer] ❌ Score ${heuristic.score} below min threshold ${minScore}`);
    }

    console.log(`[Analyzer] ══════════════════════════════════════`);
    console.log(`[Analyzer] ${shouldBuy ? '✅' : '❌'} Final: ${finalSignal} | Score: ${heuristic.score} | Buy: ${shouldBuy}`);

    return {
      token,
      shouldBuy,
      reason: this.generateReason(heuristic, ai, finalSignal),
      riskScore: heuristic.score,
      analysis: {
        flags: heuristic.factors.filter(f => f.includes('⚠️') || f.includes('🚨')),
        summary: ai?.verdict || heuristic.factors.slice(0, 3).join(', '),
      },
      stage: 'AI_ANALYSIS',
      ai,
    };
  }

  /**
   * Full AI analysis with detailed reasoning
   * Used for tokens with score >= 50
   */
  private async runFullAnalysis(
    token: NewTokenEvent,
    heuristic: HeuristicResult,
    onChain: OnChainData | null
  ): Promise<AIAnalysis> {
    console.log(`[Analyzer] 🔮 Running FULL AI analysis...`);

    const prompt = this.buildFullPrompt(token, heuristic, onChain);

    const systemPrompt = `You are an expert crypto analyst for a meme token trading system. Analyze tokens and provide structured recommendations.

Return ONLY valid JSON in this exact format:
{
  "signal": "STRONG_BUY" | "BUY" | "WATCH" | "HOLD" | "AVOID",
  "risk": 1-10,
  "confidence": 0-100,
  "verdict": "One sentence verdict",
  "reasoning": "Brief explanation of your analysis",
  "redFlags": ["list", "of", "concerns"],
  "greenFlags": ["list", "of", "positives"]
}

Consider:
- On-chain security (mint/freeze authority)
- Holder concentration
- Liquidity depth
- Price momentum
- Overall market sentiment for meme tokens`;

    try {
      const result = await makeAIRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], 300);

      this.recordAnalysis();

      if (!result) {
        console.log(`[Analyzer] AI request failed`);
        return { tier: 'full' };
      }

      this.aiTokensUsed += result.tokens;
      return this.parseFullResponse(result.content);
    } catch (error) {
      console.error(`[Analyzer] AI error:`, error);
      return { tier: 'full' };
    }
  }

  /**
   * Quick AI check for potential hidden gems
   * Used for tokens with score 30-49
   */
  private async runQuickCheck(
    token: NewTokenEvent,
    heuristic: HeuristicResult,
    onChain: OnChainData | null
  ): Promise<AIAnalysis> {
    console.log(`[Analyzer] ⚡ Running QUICK AI check...`);

    const prompt = `Quick check this token:
${token.symbol} | Score: ${heuristic.score} | Liq: $${(token.liquidityUsd || 0).toFixed(0)}
Mint revoked: ${onChain?.mintAuthorityRevoked ?? 'unknown'}
Top holder: ${onChain?.topHolderPercent?.toFixed(0) ?? '?'}%
Momentum: ${token.priceChange1h?.toFixed(0) ?? 0}% (1h)

Is this worth watching? Reply JSON only: {"watch": true/false, "risk": 1-10, "reason": "brief"}`;

    try {
      const result = await makeAIRequest([
        { role: 'system', content: 'You are a quick crypto screener. Respond with JSON only.' },
        { role: 'user', content: prompt }
      ], 100);

      this.recordAnalysis();

      if (!result) {
        return { tier: 'quick' };
      }

      this.aiTokensUsed += result.tokens;
      return this.parseQuickResponse(result.content);
    } catch (error) {
      return { tier: 'quick' };
    }
  }

  private buildFullPrompt(
    token: NewTokenEvent,
    heuristic: HeuristicResult,
    onChain: OnChainData | null
  ): string {
    return `Analyze this Solana meme token:

TOKEN: ${token.name} (${token.symbol})
Address: ${token.address}
Source: ${token.source}

MARKET DATA:
- Liquidity: $${(token.liquidityUsd || 0).toLocaleString()}
- Market Cap: $${(token.initialMarketCap || 0).toLocaleString()}
- Volume (24h): $${(token.volume24h || 0).toLocaleString()}
- Price Change (1h): ${token.priceChange1h?.toFixed(1) || 0}%
- Buys/Sells (1h): ${token.buys1h || 0}/${token.sells1h || 0}

ON-CHAIN SECURITY:
- Mint Authority: ${onChain?.mintAuthorityRevoked ? 'REVOKED (safe)' : 'ACTIVE (risky)'}
- Freeze Authority: ${onChain?.freezeAuthorityRevoked ? 'REVOKED (safe)' : 'ACTIVE (risky)'}
- Top Holder: ${onChain?.topHolderPercent?.toFixed(1) || '?'}%
- Top 10 Holders: ${onChain?.top10HoldersPercent?.toFixed(1) || '?'}%
- Holder Count: ${onChain?.holderCount || '?'}

HEURISTIC ANALYSIS:
- Score: ${heuristic.score}/100 → ${heuristic.signal}
- Factors: ${heuristic.factors.join(', ')}

Provide your analysis as JSON.`;
  }

  private parseFullResponse(content: string): AIAnalysis {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const result: AIAnalysis = {
          tier: 'full',
          signal: this.validateSignal(parsed.signal),
          risk: Math.min(10, Math.max(1, parsed.risk || 5)),
          confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
          verdict: parsed.verdict || '',
          reasoning: parsed.reasoning || '',
          redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
          greenFlags: Array.isArray(parsed.greenFlags) ? parsed.greenFlags : [],
        };
        console.log(`[Analyzer]    → ${result.signal} (risk ${result.risk}/10, ${result.confidence}% conf)`);
        console.log(`[Analyzer]    "${result.verdict}"`);
        return result;
      }
    } catch (e) {
      console.log(`[Analyzer] Failed to parse AI response`);
    }
    return { tier: 'full' };
  }

  private parseQuickResponse(content: string): AIAnalysis {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const result: AIAnalysis = {
          tier: 'quick',
          watch: parsed.watch === true,
          risk: Math.min(10, Math.max(1, parsed.risk || 5)),
          verdict: parsed.reason || '',
        };
        console.log(`[Analyzer]    → ${result.watch ? '👀 Worth watching' : '⏭️ Skip'}: ${result.verdict}`);
        return result;
      }
    } catch (e) {
      // Silent fail for quick checks
    }
    return { tier: 'quick', watch: false };
  }

  private validateSignal(signal: string): SignalType {
    const valid: SignalType[] = ['STRONG_BUY', 'BUY', 'WATCH', 'HOLD', 'AVOID'];
    return valid.includes(signal as SignalType) ? signal as SignalType : 'HOLD';
  }

  private generateReason(
    heuristic: HeuristicResult,
    ai: AIAnalysis | undefined,
    signal: SignalType
  ): string {
    if (ai?.verdict) {
      return ai.verdict;
    }
    return `${signal}: Score ${heuristic.score}, ${heuristic.factors.slice(0, 2).join(', ')}`;
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    this.analysisTimestamps = this.analysisTimestamps.filter(
      ts => now - ts < RATE_LIMIT_WINDOW_MS
    );
    return this.analysisTimestamps.length < MAX_ANALYSES_PER_MINUTE;
  }

  private recordAnalysis() {
    this.analysisTimestamps.push(Date.now());
  }

  getStats() {
    return {
      aiTokensUsed: this.aiTokensUsed,
      currentRate: this.analysisTimestamps.length,
      maxRate: MAX_ANALYSES_PER_MINUTE,
    };
  }

  updateConfig(config: Partial<SniperConfig>) {
    this.config = { ...this.config, ...config };
  }
}
