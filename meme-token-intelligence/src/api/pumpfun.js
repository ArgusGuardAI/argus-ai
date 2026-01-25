/**
 * PumpFun API Integration
 * PumpFun is a Solana memecoin launchpad with bonding curve mechanics
 *
 * Key concepts:
 * - Tokens start on a bonding curve (price increases as more is bought)
 * - At ~$69k market cap, tokens "graduate" to Raydium with real liquidity
 * - Most tokens never graduate (high failure rate)
 */

const PUMPFUN_API = 'https://frontend-api.pump.fun';
const PUMPFUN_CLIENT = 'https://client-api-2-74b1891ee9f9.herokuapp.com';

/**
 * Get latest token launches from PumpFun
 */
export async function getLatestTokens(limit = 50, offset = 0) {
  const response = await fetch(
    `${PUMPFUN_API}/coins?offset=${offset}&limit=${limit}&sort=created_timestamp&order=DESC`
  );
  const data = await response.json();
  return data || [];
}

/**
 * Get tokens about to graduate (near $69k market cap)
 */
export async function getTokensAboutToGraduate(limit = 20) {
  const response = await fetch(
    `${PUMPFUN_API}/coins?offset=0&limit=${limit}&sort=market_cap&order=DESC&includeNsfw=false`
  );
  const data = await response.json();
  // Filter for tokens close to graduation (~85%+ of bonding curve)
  return (data || []).filter(t => t.bonding_curve_progress >= 85);
}

/**
 * Get specific token details by mint address
 */
export async function getTokenDetails(mintAddress) {
  const response = await fetch(`${PUMPFUN_API}/coins/${mintAddress}`);
  return await response.json();
}

/**
 * Get recent trades for a token
 */
export async function getTokenTrades(mintAddress, limit = 100) {
  const response = await fetch(
    `${PUMPFUN_API}/trades/latest?mint=${mintAddress}&limit=${limit}`
  );
  return await response.json();
}

/**
 * Get king of the hill (current top token)
 */
export async function getKingOfTheHill() {
  const response = await fetch(`${PUMPFUN_API}/coins/king-of-the-hill`);
  return await response.json();
}

/**
 * Parse PumpFun token data into our standard format
 */
export function parsePumpFunToken(token) {
  const bondingCurveProgress = token.bonding_curve_progress || 0;
  const marketCap = token.usd_market_cap || 0;
  const graduationTarget = 69000; // $69k to graduate

  return {
    address: token.mint,
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    image: token.image_uri,
    twitter: token.twitter,
    telegram: token.telegram,
    website: token.website,

    // PumpFun specific metrics
    bondingCurveProgress,
    marketCap,
    graduationTarget,
    distanceToGraduation: graduationTarget - marketCap,
    willGraduate: bondingCurveProgress >= 100,
    nearGraduation: bondingCurveProgress >= 85,

    // Creator info
    creator: token.creator,
    createdAt: token.created_timestamp,

    // Activity
    replyCount: token.reply_count || 0,

    // Computed
    ageMinutes: Math.floor((Date.now() - token.created_timestamp) / 60000),

    // Platform
    platform: 'pumpfun',
    dex: 'pumpfun-bonding-curve',
  };
}

/**
 * Calculate buy/sell pressure from recent trades
 */
export function analyzeTradePressure(trades) {
  if (!trades?.length) return { buyPressure: 0.5, sentiment: 'neutral' };

  const recentTrades = trades.slice(0, 50);
  const buys = recentTrades.filter(t => t.is_buy);
  const sells = recentTrades.filter(t => !t.is_buy);

  const buyVolume = buys.reduce((sum, t) => sum + (t.sol_amount || 0), 0);
  const sellVolume = sells.reduce((sum, t) => sum + (t.sol_amount || 0), 0);
  const totalVolume = buyVolume + sellVolume;

  const buyPressure = totalVolume > 0 ? buyVolume / totalVolume : 0.5;

  let sentiment = 'neutral';
  if (buyPressure > 0.65) sentiment = 'bullish';
  else if (buyPressure > 0.55) sentiment = 'slightly_bullish';
  else if (buyPressure < 0.35) sentiment = 'bearish';
  else if (buyPressure < 0.45) sentiment = 'slightly_bearish';

  return {
    buyPressure,
    sellPressure: 1 - buyPressure,
    buyVolume,
    sellVolume,
    buyCount: buys.length,
    sellCount: sells.length,
    sentiment,
  };
}

/**
 * Estimate graduation probability based on momentum
 */
export function estimateGraduationProbability(token, tradePressure) {
  let score = 0;

  // Bonding curve progress (max 40 points)
  score += Math.min(40, token.bondingCurveProgress * 0.4);

  // Buy pressure (max 25 points)
  score += tradePressure.buyPressure * 25;

  // Age penalty - very new tokens are risky (max 15 points)
  if (token.ageMinutes > 30) score += 15;
  else if (token.ageMinutes > 10) score += 10;
  else if (token.ageMinutes > 5) score += 5;

  // Community engagement (max 20 points)
  if (token.replyCount > 100) score += 20;
  else if (token.replyCount > 50) score += 15;
  else if (token.replyCount > 20) score += 10;
  else if (token.replyCount > 5) score += 5;

  return Math.min(100, Math.round(score));
}
