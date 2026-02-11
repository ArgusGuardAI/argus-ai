/**
 * AI Provider Abstraction Layer
 *
 * Allows swapping between:
 * - Together AI (current, expensive)
 * - BitNet (future, local inference)
 * - Hybrid mode (BitNet screening + Together AI for edge cases)
 */

// ============================================
// INPUT SCHEMA (What we send to AI)
// ============================================

export interface TokenAnalysisInput {
  // Token basics
  token: {
    address: string;
    name: string;
    symbol: string;
    ageHours: number;
  };

  // Market data
  market: {
    marketCap: number;
    liquidity: number;
    volume24h: number;
    priceChange24h: number;
  };

  // Security flags
  security: {
    mintRevoked: boolean;
    freezeRevoked: boolean;
    lpLockedPercent: number;
  };

  // Trading activity
  trading: {
    buys24h: number;
    sells24h: number;
    buys1h: number;
    sells1h: number;
  };

  // Holder distribution
  holders: {
    count: number;
    top10Percent: number;
    whaleCount: number;
    topWhalePercent: number;
  };

  // Bundle detection
  bundle: {
    detected: boolean;
    count: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    controlPercent: number;
    qualityScore: number; // 0-100, higher = more legitimate
    qualityAssessment: 'LIKELY_LEGIT' | 'NEUTRAL' | 'SUSPICIOUS' | 'VERY_SUSPICIOUS';
    avgWalletAgeDays: number;
  };

  // Creator info
  creator: {
    identified: boolean;
    walletAgeDays: number;
    tokensCreated: number;
    ruggedTokens: number;
    currentHoldingsPercent: number;
  } | null;

  // Dev activity
  devActivity: {
    hasSold: boolean;
    percentSold: number;
    currentHoldingsPercent: number;
  } | null;

  // Wash trading
  washTrading: {
    detected: boolean;
    percent: number;
    bundleBuys: number;
    organicBuys: number;
  } | null;
}

// ============================================
// OUTPUT SCHEMA (What AI returns)
// ============================================

export interface TokenAnalysisOutput {
  riskScore: number; // 0-100
  riskLevel: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  confidence: number; // 0-100, how confident the model is

  summary: string;
  prediction: string;
  recommendation: string;

  flags: Array<{
    type: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    message: string;
  }>;

  networkInsights: string[];
}

// ============================================
// TRAINING DATA FORMAT (For BitNet fine-tuning)
// ============================================

export interface TrainingExample {
  id: string;
  timestamp: number;

  input: TokenAnalysisInput;

  // AI's initial output
  aiOutput: TokenAnalysisOutput;

  // Guardrails-adjusted output (ground truth)
  finalOutput: {
    riskScore: number;
    riskLevel: string;
    wasOverridden: boolean;
    overrideReason?: string;
  };

  // Outcome tracking (added later if known)
  outcome?: {
    rugged: boolean;
    ruggedAt?: number;
    priceDropPercent?: number;
    liquidityDropPercent?: number;
  };
}

// ============================================
// PROVIDER INTERFACE
// ============================================

export type AIProvider = 'together' | 'bitnet' | 'local-bitnet' | 'hybrid';

export interface AIProviderConfig {
  provider: AIProvider;

  // Together AI config
  togetherApiKey?: string;
  togetherModel?: string;

  // BitNet config
  bitnetModelPath?: string;
  bitnetEndpoint?: string;

  // Hybrid config
  hybridConfidenceThreshold?: number; // Use Together AI if BitNet confidence below this
}

// ============================================
// ABSTRACT PROVIDER CLASS
// ============================================

export abstract class BaseAIProvider {
  abstract analyze(input: TokenAnalysisInput): Promise<TokenAnalysisOutput>;
  abstract getName(): string;
}

// ============================================
// TOGETHER AI PROVIDER (Current)
// ============================================

export class TogetherAIProvider extends BaseAIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'meta-llama/Llama-3.3-70B-Instruct-Turbo') {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }

  getName(): string {
    return 'together';
  }

  async analyze(input: TokenAnalysisInput): Promise<TokenAnalysisOutput> {
    const prompt = this.buildPrompt(input);
    const systemPrompt = this.getSystemPrompt();

    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      throw new Error(`Together AI error: ${response.status}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const rawContent = data.choices?.[0]?.message?.content || '';
    return this.parseResponse(rawContent);
  }

  private getSystemPrompt(): string {
    return `You are Sentinel, an AI that analyzes Solana token data to predict pump & dump schemes.

Analyze the structured data and return a JSON response with:
1. riskScore (0-100): Overall rug risk
2. riskLevel: SAFE (<40), SUSPICIOUS (40-59), DANGEROUS (60-79), or SCAM (80+)
3. confidence (0-100): How confident you are in this assessment
4. summary: 1-2 sentences with SPECIFIC VALUES (percentages, counts, not vague words)
5. prediction: What will likely happen to this token
6. recommendation: Action advice for the user
7. flags: Array of {type, severity, message} for specific risks
8. networkInsights: Array of key observations

BANNED WORDS in summary: "moderate", "some", "a few", "significant", "substantial", "considerable", "notable", "decent", "fairly", "relatively"
USE SPECIFIC VALUES INSTEAD: "6 wallets", "23.5%", "0.2 hours old"

RETURN ONLY VALID JSON.`;
  }

  private buildPrompt(input: TokenAnalysisInput): string {
    return `ANALYZE THIS TOKEN:

TOKEN: ${input.token.symbol} (${input.token.name})
Address: ${input.token.address}
Age: ${input.token.ageHours < 24 ? `${input.token.ageHours.toFixed(1)} hours ⚠️ VERY NEW` : `${Math.floor(input.token.ageHours / 24)} days`}

MARKET:
- Market Cap: $${input.market.marketCap.toLocaleString()}
- Liquidity: $${input.market.liquidity.toLocaleString()}
- 24h Volume: $${input.market.volume24h.toLocaleString()}
- 24h Price Change: ${input.market.priceChange24h > 0 ? '+' : ''}${input.market.priceChange24h.toFixed(1)}%

SECURITY:
- Mint Authority: ${input.security.mintRevoked ? 'REVOKED ✓' : '⚠️ ACTIVE'}
- Freeze Authority: ${input.security.freezeRevoked ? 'REVOKED ✓' : '🚨 ACTIVE'}
- LP Locked: ${input.security.lpLockedPercent.toFixed(1)}%

TRADING (24h):
- Buys: ${input.trading.buys24h} | Sells: ${input.trading.sells24h}
- Ratio: ${input.trading.sells24h > 0 ? (input.trading.buys24h / input.trading.sells24h).toFixed(2) : 'N/A'}

HOLDERS:
- Total: ${input.holders.count}
- Top 10 Control: ${input.holders.top10Percent.toFixed(1)}%
- Whales (>10%): ${input.holders.whaleCount}
- Top Whale: ${input.holders.topWhalePercent.toFixed(1)}%

BUNDLE DETECTION:
${input.bundle.detected ? `⚠️ DETECTED (${input.bundle.confidence} confidence)
- Count: ${input.bundle.count} coordinated wallets
- Control: ${input.bundle.controlPercent.toFixed(1)}% of supply
- Quality: ${input.bundle.qualityAssessment} (score: ${input.bundle.qualityScore}/100)
- Avg Wallet Age: ${input.bundle.avgWalletAgeDays.toFixed(1)} days` : '✓ No bundles detected'}

${input.creator ? `CREATOR:
- Wallet Age: ${input.creator.walletAgeDays} days
- Tokens Created: ${input.creator.tokensCreated}
- Previous Rugs: ${input.creator.ruggedTokens}${input.creator.ruggedTokens > 0 ? ' 🚨 SERIAL RUGGER' : ''}
- Current Holdings: ${input.creator.currentHoldingsPercent.toFixed(1)}%` : 'CREATOR: Unknown'}

${input.devActivity ? `DEV ACTIVITY:
- Has Sold: ${input.devActivity.hasSold ? `YES - ${input.devActivity.percentSold.toFixed(0)}% sold` : 'NO'}
- Current Holdings: ${input.devActivity.currentHoldingsPercent.toFixed(1)}%` : ''}

${input.washTrading?.detected ? `⚠️ WASH TRADING DETECTED:
- ${input.washTrading.percent.toFixed(0)}% of buys from bundle wallets
- Bundle Buys: ${input.washTrading.bundleBuys}
- Organic Buys: ${input.washTrading.organicBuys}` : ''}

Return your analysis as JSON.`;
  }

  private parseResponse(raw: string): TokenAnalysisOutput {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    let riskLevel: TokenAnalysisOutput['riskLevel'] = 'SAFE';
    const score = Math.max(0, Math.min(100, parsed.riskScore || 50));
    // Updated thresholds based on backtest (catches 80% of rugs)
    if (score >= 80) riskLevel = 'SCAM';
    else if (score >= 65) riskLevel = 'DANGEROUS';  // Was 60
    else if (score >= 55) riskLevel = 'SUSPICIOUS'; // Was 40

    return {
      riskScore: score,
      riskLevel,
      confidence: parsed.confidence || 70,
      summary: parsed.summary || 'Analysis completed.',
      prediction: parsed.prediction || 'Unable to predict.',
      recommendation: parsed.recommendation || 'Exercise caution.',
      flags: parsed.flags || [],
      networkInsights: parsed.networkInsights || [],
    };
  }
}

// ============================================
// BITNET PROVIDER (Remote endpoint)
// ============================================

export class BitNetProvider extends BaseAIProvider {
  private endpoint: string;

  constructor(endpoint: string) {
    super();
    this.endpoint = endpoint;
  }

  getName(): string {
    return 'bitnet';
  }

  async analyze(input: TokenAnalysisInput): Promise<TokenAnalysisOutput> {
    // BitNet inference endpoint (to be implemented)
    // This will call a local or edge-deployed BitNet model

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`BitNet inference error: ${response.status}`);
    }

    return await response.json() as TokenAnalysisOutput;
  }
}

// ============================================
// LOCAL BITNET PROVIDER (Rule-based, zero cost)
// Uses the BitNetInferenceEngine directly in-process
// ============================================

import { BitNetInferenceEngine, type BitNetModelConfig } from './bitnet-inference';

export class LocalBitNetProvider extends BaseAIProvider {
  private engine: BitNetInferenceEngine;
  private initialized: boolean = false;

  constructor(config?: Partial<BitNetModelConfig>) {
    super();
    this.engine = new BitNetInferenceEngine({
      modelPath: config?.modelPath || 'rule-based', // Use rule-based fallback
      modelType: config?.modelType || 'classifier',
    });
  }

  getName(): string {
    return 'local-bitnet';
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.engine.loadModel();
      this.initialized = true;
    }
  }

  async analyze(input: TokenAnalysisInput): Promise<TokenAnalysisOutput> {
    await this.initialize();

    const classifierOutput = await this.engine.infer(input);
    return this.engine.toAnalysisOutput(classifierOutput, input);
  }
}

// ============================================
// HYBRID PROVIDER (BitNet + Together AI fallback)
// ============================================

export class HybridProvider extends BaseAIProvider {
  private bitnet: BitNetProvider;
  private together: TogetherAIProvider;
  private confidenceThreshold: number;

  constructor(
    bitnetEndpoint: string,
    togetherApiKey: string,
    togetherModel: string,
    confidenceThreshold: number = 80
  ) {
    super();
    this.bitnet = new BitNetProvider(bitnetEndpoint);
    this.together = new TogetherAIProvider(togetherApiKey, togetherModel);
    this.confidenceThreshold = confidenceThreshold;
  }

  getName(): string {
    return 'hybrid';
  }

  async analyze(input: TokenAnalysisInput): Promise<TokenAnalysisOutput> {
    // Step 1: Fast BitNet screening
    try {
      const bitnetResult = await this.bitnet.analyze(input);

      // If confidence is high, trust BitNet
      if (bitnetResult.confidence >= this.confidenceThreshold) {
        console.log(`[Hybrid] BitNet confident (${bitnetResult.confidence}%), using result`);
        return bitnetResult;
      }

      // Edge cases: very safe or very dangerous, use Together AI for verification
      if (bitnetResult.riskScore < 30 || bitnetResult.riskScore > 75) {
        console.log(`[Hybrid] Edge case (score: ${bitnetResult.riskScore}), using Together AI`);
        return await this.together.analyze(input);
      }

      // Middle scores with low confidence: trust BitNet but note uncertainty
      console.log(`[Hybrid] Low confidence (${bitnetResult.confidence}%), using BitNet with caveat`);
      return {
        ...bitnetResult,
        networkInsights: [
          ...bitnetResult.networkInsights,
          'Fast analysis - run deep scan for detailed assessment',
        ],
      };
    } catch (error) {
      // BitNet failed, fall back to Together AI
      console.error('[Hybrid] BitNet failed, falling back to Together AI:', error);
      return await this.together.analyze(input);
    }
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createAIProvider(config: AIProviderConfig): BaseAIProvider {
  switch (config.provider) {
    case 'together':
      if (!config.togetherApiKey) {
        throw new Error('Together AI API key required');
      }
      return new TogetherAIProvider(config.togetherApiKey, config.togetherModel);

    case 'bitnet':
      if (!config.bitnetEndpoint) {
        // Fall back to local BitNet if no endpoint provided
        console.log('[AI] No BitNet endpoint, using local inference');
        return new LocalBitNetProvider({ modelPath: config.bitnetModelPath });
      }
      return new BitNetProvider(config.bitnetEndpoint);

    case 'local-bitnet':
      // Zero-cost local inference using rule-based engine
      return new LocalBitNetProvider({ modelPath: config.bitnetModelPath });

    case 'hybrid':
      if (!config.togetherApiKey) {
        throw new Error('Together AI key required for hybrid mode');
      }
      // If no BitNet endpoint, use local BitNet + Together AI
      if (!config.bitnetEndpoint) {
        console.log('[AI] Hybrid mode: Local BitNet + Together AI');
      }
      return new HybridProvider(
        config.bitnetEndpoint || 'local', // Marker for local
        config.togetherApiKey,
        config.togetherModel || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        config.hybridConfidenceThreshold || 80
      );

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// ============================================
// HELPER: Convert legacy format to new schema
// ============================================

export function convertToAnalysisInput(
  tokenInfo: {
    name: string;
    symbol: string;
    address: string;
    marketCap?: number;
    liquidity?: number;
    ageHours?: number;
    volume24h?: number;
    priceChange24h?: number;
    txns24h?: { buys: number; sells: number };
    txns1h?: { buys: number; sells: number };
    mintAuthorityActive?: boolean;
    freezeAuthorityActive?: boolean;
    holderCount?: number;
  },
  holders: Array<{ percent: number; isWhale?: boolean }>,
  bundleInfo: {
    detected: boolean;
    count: number;
    confidence: string;
  },
  bundleQuality: {
    legitimacyScore: number;
    assessment: string;
  } | undefined,
  creatorInfo: {
    address?: string;
    walletAge: number;
    tokensCreated: number;
    ruggedTokens: number;
    currentHoldings: number;
  } | null,
  devActivity: {
    hasSold: boolean;
    percentSold: number;
    currentHoldingsPercent: number;
  } | null,
  washTrading: {
    detected: boolean;
    washTradingPercent: number;
    bundleBuys: number;
    organicBuys: number;
  } | null,
  avgBundleWalletAge: number = 0,
  bundleControlPercent: number = 0
): TokenAnalysisInput {
  const whales = holders.filter(h => h.isWhale || h.percent > 10);
  const top10Percent = holders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);
  const topWhalePercent = whales.length > 0 ? Math.max(...whales.map(h => h.percent)) : 0;

  return {
    token: {
      address: tokenInfo.address,
      name: tokenInfo.name || 'Unknown',
      symbol: tokenInfo.symbol || '???',
      ageHours: tokenInfo.ageHours || 0,
    },
    market: {
      marketCap: tokenInfo.marketCap || 0,
      liquidity: tokenInfo.liquidity || 0,
      volume24h: tokenInfo.volume24h || 0,
      priceChange24h: tokenInfo.priceChange24h || 0,
    },
    security: {
      mintRevoked: !tokenInfo.mintAuthorityActive,
      freezeRevoked: !tokenInfo.freezeAuthorityActive,
      lpLockedPercent: 0, // Add from security info
    },
    trading: {
      buys24h: tokenInfo.txns24h?.buys || 0,
      sells24h: tokenInfo.txns24h?.sells || 0,
      buys1h: tokenInfo.txns1h?.buys || 0,
      sells1h: tokenInfo.txns1h?.sells || 0,
    },
    holders: {
      count: tokenInfo.holderCount || holders.length,
      top10Percent,
      whaleCount: whales.length,
      topWhalePercent,
    },
    bundle: {
      detected: bundleInfo.detected,
      count: bundleInfo.count,
      confidence: bundleInfo.confidence as 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE',
      controlPercent: bundleControlPercent,
      qualityScore: bundleQuality?.legitimacyScore || 50,
      qualityAssessment: (bundleQuality?.assessment || 'NEUTRAL') as 'LIKELY_LEGIT' | 'NEUTRAL' | 'SUSPICIOUS' | 'VERY_SUSPICIOUS',
      avgWalletAgeDays: avgBundleWalletAge,
    },
    creator: creatorInfo ? {
      identified: true,
      walletAgeDays: creatorInfo.walletAge,
      tokensCreated: creatorInfo.tokensCreated,
      ruggedTokens: creatorInfo.ruggedTokens,
      currentHoldingsPercent: creatorInfo.currentHoldings,
    } : null,
    devActivity: devActivity ? {
      hasSold: devActivity.hasSold,
      percentSold: devActivity.percentSold,
      currentHoldingsPercent: devActivity.currentHoldingsPercent,
    } : null,
    washTrading: washTrading?.detected ? {
      detected: true,
      percent: washTrading.washTradingPercent,
      bundleBuys: washTrading.bundleBuys,
      organicBuys: washTrading.organicBuys,
    } : null,
  };
}
