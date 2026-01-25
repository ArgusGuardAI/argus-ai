/**
 * AI Token Analyzer using Claude API
 * Hybrid approach:
 *   - Tier 2 (score >= 50): Full analysis with reasoning
 *   - Tier 3 (score 30-49): Quick "hidden gem" check
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Token costs (Claude 3.5 Sonnet)
// Input: $3/1M tokens, Output: $15/1M tokens
// Avg request: ~500 input + ~200 output = ~$0.004 per full analysis

/**
 * Full AI analysis for promising tokens (Tier 2)
 */
export async function analyzeTokenFull(tokenData) {
  const prompt = `You are a crypto meme token analyst. Analyze this Solana token and provide a risk assessment.

TOKEN DATA:
- Symbol: $${tokenData.symbol}
- Name: ${tokenData.name}
- Price: $${tokenData.price}
- Age: ${tokenData.age}
- Liquidity: $${(tokenData.liquidity / 1000).toFixed(1)}k
- 24h Volume: $${(tokenData.volume24h / 1000).toFixed(1)}k
- Price Change (5m): ${tokenData.priceChange5m?.toFixed(1)}%
- Price Change (1h): ${tokenData.priceChange1h?.toFixed(1)}%
- Price Change (24h): ${tokenData.priceChange24h?.toFixed(1)}%
- Buys/Sells (1h): ${tokenData.buys1h}/${tokenData.sells1h}
- DEX: ${tokenData.dex}

ON-CHAIN SECURITY:
- Mint Authority: ${tokenData.onChain?.mintRevoked ? 'REVOKED ✓' : 'ACTIVE ⚠️'}
- Freeze Authority: ${tokenData.onChain?.freezeRevoked ? 'REVOKED ✓' : 'ACTIVE ⚠️'}
- Top Holder: ${tokenData.onChain?.topHolderPct?.toFixed(1) || '?'}%
- Top 10 Holders: ${tokenData.onChain?.top10Pct?.toFixed(1) || '?'}%
- Token Standard: ${tokenData.onChain?.isToken2022 ? 'Token-2022' : 'SPL Token'}

HEURISTIC SCORE: ${tokenData.score}/100
CURRENT SIGNAL: ${tokenData.signal}

Analyze this token. Consider:
1. Is this a potential rug pull or pump & dump?
2. What's the risk level (1-10)?
3. Is there genuine trading interest or fake volume?
4. Would you buy, watch, or avoid?

Respond in this exact JSON format:
{
  "risk": <1-10>,
  "signal": "<STRONG_BUY|BUY|WATCH|AVOID>",
  "confidence": <0-100>,
  "reasoning": "<2-3 sentences explaining your analysis>",
  "redFlags": ["<flag1>", "<flag2>"],
  "greenFlags": ["<flag1>", "<flag2>"],
  "verdict": "<one sentence final verdict>"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        tier: 'full',
        ...analysis,
        tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens,
      };
    }

    return { success: false, error: 'Could not parse AI response' };
  } catch (error) {
    console.error('AI analysis error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Quick AI check for borderline tokens (Tier 3)
 * Cheaper and faster - just yes/no with brief reason
 */
export async function analyzeTokenQuick(tokenData) {
  const prompt = `Quick crypto token check. $${tokenData.symbol} on Solana:
- Liq: $${(tokenData.liquidity / 1000).toFixed(0)}k | Vol: $${(tokenData.volume24h / 1000).toFixed(0)}k
- 1h: ${tokenData.priceChange1h > 0 ? '+' : ''}${tokenData.priceChange1h?.toFixed(0)}%
- Mint: ${tokenData.onChain?.mintRevoked ? 'revoked' : 'ACTIVE'} | Freeze: ${tokenData.onChain?.freezeRevoked ? 'revoked' : 'ACTIVE'}
- Top holder: ${tokenData.onChain?.topHolderPct?.toFixed(0) || '?'}%
- Age: ${tokenData.age} | Score: ${tokenData.score}/100

Is this worth watching for a potential opportunity? Reply ONLY with:
{"watch": true/false, "reason": "<10 words max>"}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        tier: 'quick',
        watch: result.watch,
        reason: result.reason,
        tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens,
      };
    }

    return { success: false, error: 'Could not parse' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Batch analyze multiple tokens efficiently
 */
export async function batchAnalyze(tokens) {
  const results = [];
  let totalTokens = 0;

  for (const token of tokens) {
    let analysis;

    if (token.score >= 50) {
      // Tier 2: Full analysis
      console.log(`   🧠 Full AI analysis: $${token.symbol}...`);
      analysis = await analyzeTokenFull(token);
    } else if (token.score >= 30) {
      // Tier 3: Quick check
      console.log(`   ⚡ Quick AI check: $${token.symbol}...`);
      analysis = await analyzeTokenQuick(token);
    } else {
      // Skip low scores
      continue;
    }

    if (analysis.success) {
      totalTokens += analysis.tokensUsed || 0;
      results.push({
        address: token.address,
        symbol: token.symbol,
        ai: analysis,
      });
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  // Estimate cost (Claude 3.5 Sonnet pricing)
  const estimatedCost = (totalTokens / 1000000) * 10; // rough average

  return {
    results,
    totalTokens,
    estimatedCost: estimatedCost.toFixed(4),
  };
}
