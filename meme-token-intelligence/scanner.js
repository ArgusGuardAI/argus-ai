/**
 * Meme Token Scanner with On-Chain Analysis + AI
 *
 * Hybrid AI Approach:
 *   - Tier 1: All tokens → Fast heuristics
 *   - Tier 2: Score >= 50 → Full AI analysis with reasoning
 *   - Tier 3: Score 30-49 → Quick AI "hidden gem" check
 *
 * Uses FREE APIs:
 *   - DexScreener: Token discovery (FREE)
 *   - RugCheck: Security checks (FREE, no API key)
 *   - Together AI: AI analysis (pay per use)
 *
 * Usage:
 *   export TOGETHER_AI_API_KEY="..."  # Required for AI
 *   node scanner.js
 */

const DEXSCREENER_API = 'https://api.dexscreener.com';
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1';

// AI Provider: Groq (FREE!) or Together AI (paid)
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const TOGETHER_AI_API_KEY = process.env.TOGETHER_AI_API_KEY || '';

// Use Groq if available (FREE), otherwise Together AI
const AI_PROVIDER = GROQ_API_KEY ? 'groq' : (TOGETHER_AI_API_KEY ? 'together' : 'none');
const AI_API_KEY = GROQ_API_KEY || TOGETHER_AI_API_KEY;
const AI_ENDPOINT = GROQ_API_KEY
  ? 'https://api.groq.com/openai/v1/chat/completions'
  : 'https://api.together.xyz/v1/chat/completions';
const AI_MODEL = GROQ_API_KEY
  ? 'llama-3.3-70b-versatile'
  : 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// Security data cache
const securityCache = new Map();

// === CONFIGURATION ===
const CONFIG = {
  scanInterval: 60000,
  minLiquidity: 1000,
  minScore: 30,           // Lowered to catch Tier 3 tokens for AI review
  maxResults: 20,
  enableOnChain: true,    // Uses RugCheck API (FREE)
  enableAI: true,         // Toggle AI analysis
  // Pump & dump filters
  maxPriceChange1h: 500,
  minAge: 5,
  // AI Tiers
  aiFullThreshold: 50,    // Score >= 50 gets full AI analysis
  aiQuickThreshold: 30,   // Score 30-49 gets quick AI check
};

console.log('🔐 Security: RugCheck API (FREE)');
const aiStatus = AI_PROVIDER === 'groq' ? 'ENABLED (Groq - FREE!)'
  : AI_PROVIDER === 'together' ? 'ENABLED (Together AI)'
  : 'DISABLED - set GROQ_API_KEY or TOGETHER_AI_API_KEY';
console.log('🧠 AI: ' + aiStatus);

// === AI ANALYSIS (Together AI) ===

async function aiAnalyzeFull(tokenData) {
  if (!AI_API_KEY) return { success: false, error: 'No API key' };

  const prompt = `You are a crypto meme token analyst. Analyze this Solana token.

TOKEN: $${tokenData.symbol} (${tokenData.name})
- Price: $${tokenData.price} | Age: ${tokenData.age}
- Liquidity: $${(tokenData.liquidity / 1000).toFixed(1)}k | Volume 24h: $${(tokenData.volume24h / 1000).toFixed(1)}k
- Price Change: ${tokenData.priceChange5m?.toFixed(1)}% (5m) | ${tokenData.priceChange1h?.toFixed(1)}% (1h) | ${tokenData.priceChange24h?.toFixed(1)}% (24h)
- Buys/Sells (1h): ${tokenData.buys1h}/${tokenData.sells1h}
- DEX: ${tokenData.dex}

ON-CHAIN:
- Mint Authority: ${tokenData.onChain?.mintRevoked ? 'REVOKED ✓' : 'ACTIVE ⚠️'}
- Freeze Authority: ${tokenData.onChain?.freezeRevoked ? 'REVOKED ✓' : 'ACTIVE ⚠️'}
- Top Holder: ${tokenData.onChain?.topHolderPct?.toFixed(1) || '?'}% | Top 10: ${tokenData.onChain?.top10Pct?.toFixed(1) || '?'}%

HEURISTIC SCORE: ${tokenData.score}/100

Analyze for:
1. Rug pull / pump & dump risk
2. Genuine interest vs manipulation
3. Entry opportunity

Reply ONLY with JSON:
{"risk":1-10,"signal":"STRONG_BUY|BUY|WATCH|AVOID","confidence":0-100,"reasoning":"2-3 sentences","redFlags":[],"greenFlags":[],"verdict":"one sentence"}`;

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert crypto analyst. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      console.error('   AI error:', response.status);
      return { success: false, error: 'API error: ' + response.status };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const tokens = data.usage?.total_tokens || 0;
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return {
        success: true,
        tier: 'full',
        ...JSON.parse(jsonMatch[0]),
        tokens,
      };
    }
    return { success: false };
  } catch (error) {
    console.error('   AI error:', error.message);
    return { success: false, error: error.message };
  }
}

async function aiAnalyzeQuick(tokenData) {
  if (!AI_API_KEY) return { success: false, error: 'No API key' };

  const prompt = `Quick meme token check. $${tokenData.symbol}:
Liq $${(tokenData.liquidity/1000).toFixed(0)}k | Vol $${(tokenData.volume24h/1000).toFixed(0)}k | 1h ${tokenData.priceChange1h>0?'+':''}${tokenData.priceChange1h?.toFixed(0)}%
Mint: ${tokenData.onChain?.mintRevoked?'revoked':'ACTIVE'} | Top holder: ${tokenData.onChain?.topHolderPct?.toFixed(0)||'?'}% | Age: ${tokenData.age}

Hidden gem potential? Reply ONLY: {"watch":true/false,"reason":"<10 words>","risk":1-10}`;

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are a quick crypto screener. Respond with JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      return { success: false, error: 'API error: ' + response.status };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const tokens = data.usage?.total_tokens || 0;
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return {
        success: true,
        tier: 'quick',
        ...JSON.parse(jsonMatch[0]),
        tokens,
      };
    }
    return { success: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// === SECURITY ANALYSIS (RugCheck API - FREE) ===

async function getRugCheckData(mintAddress) {
  // Check cache first (1 minute TTL)
  const cached = securityCache.get(mintAddress);
  if (cached && Date.now() - cached.timestamp < 60000) {
    return cached.data;
  }

  try {
    const response = await fetch(`${RUGCHECK_API}/tokens/${mintAddress}/report`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.log('   [RugCheck] Rate limited');
      }
      return null;
    }

    const data = await response.json();

    // Extract holder data from topHolders or markets
    let topHolderPct = 0;
    let top10Pct = 0;
    let holderCount = 0;

    if (data.topHolders && data.topHolders.length > 0) {
      topHolderPct = data.topHolders[0]?.pct || 0;
      top10Pct = data.topHolders.slice(0, 10).reduce((sum, h) => sum + (h.pct || 0), 0);
      holderCount = data.topHolders.length;
    } else if (data.markets && data.markets.length > 0) {
      for (const market of data.markets) {
        if (market.lp?.holders && market.lp.holders.length > 0) {
          const nonLpHolders = market.lp.holders.filter(h => !h.insider);
          if (nonLpHolders.length > 0) {
            const maxHolder = nonLpHolders.reduce((max, h) => h.pct > max.pct ? h : max, nonLpHolders[0]);
            topHolderPct = Math.max(topHolderPct, maxHolder.pct);
            top10Pct = Math.max(top10Pct, nonLpHolders.slice(0, 10).reduce((sum, h) => sum + h.pct, 0));
            holderCount = Math.max(holderCount, nonLpHolders.length);
          }
          break;
        }
      }
    }

    // Cap at 100%
    topHolderPct = Math.min(topHolderPct, 100);
    top10Pct = Math.min(top10Pct, 100);

    const result = {
      mintAuthorityRevoked: data.mintAuthority === null,
      freezeAuthorityRevoked: data.freezeAuthority === null,
      topHolderPct,
      top10Pct,
      holderCount,
      rugScore: data.score || 0,
      risks: data.risks || [],
    };

    // Cache it
    securityCache.set(mintAddress, { data: result, timestamp: Date.now() });
    return result;

  } catch (error) {
    console.log('   [RugCheck] Error:', error.message);
    return null;
  }
}

async function performOnChainAudit(mintAddress) {
  const data = await getRugCheckData(mintAddress);

  let score = 100;
  const issues = [];

  if (data) {
    if (!data.mintAuthorityRevoked) {
      score -= 25;
      issues.push('⚠️ MINT ACTIVE');
    } else {
      issues.push('✅ Mint revoked');
    }

    if (!data.freezeAuthorityRevoked) {
      score -= 15;
      issues.push('⚠️ FREEZE ACTIVE');
    } else {
      issues.push('✅ Freeze revoked');
    }

    if (data.topHolderPct > 50) {
      score -= 30;
      issues.push('🚨 WHALE: ' + data.topHolderPct.toFixed(1) + '%');
    } else if (data.top10Pct > 80) {
      score -= 15;
      issues.push('⚠️ Top10: ' + data.top10Pct.toFixed(1) + '%');
    } else if (data.top10Pct > 0) {
      issues.push('✅ Top10: ' + data.top10Pct.toFixed(1) + '%');
    }

    // Check RugCheck risks
    if (data.risks && data.risks.length > 0) {
      const highRisks = data.risks.filter(r => r.level === 'danger' || r.level === 'warn');
      for (const risk of highRisks.slice(0, 2)) {
        issues.push('⚠️ ' + risk.name);
        score -= 10;
      }
    }

    return {
      score: Math.max(0, score),
      issues,
      authorities: {
        mintAuthorityRevoked: data.mintAuthorityRevoked,
        freezeAuthorityRevoked: data.freezeAuthorityRevoked,
      },
      holders: {
        topHolderPercentage: data.topHolderPct,
        top10Percentage: data.top10Pct,
        totalHolders: data.holderCount,
        isSingleWhale: data.topHolderPct > 50,
        isConcentrated: data.top10Pct > 80,
      },
      safe: score >= 50,
    };
  } else {
    return {
      score: 50,
      issues: ['⚠️ Could not verify (API unavailable)'],
      authorities: null,
      holders: null,
      safe: false,
    };
  }
}

// === DATA FETCHING ===

async function fetchDexScreenerTrending() {
  try {
    const response = await fetch(DEXSCREENER_API + '/token-boosts/latest/v1');
    const data = await response.json();
    return (data || []).filter(t => t.chainId === 'solana');
  } catch (error) {
    return [];
  }
}

async function fetchDexScreenerSearch(query) {
  try {
    const response = await fetch(DEXSCREENER_API + '/latest/dex/search?q=' + query);
    const data = await response.json();
    return (data.pairs || []).filter(p => p.chainId === 'solana');
  } catch (error) {
    return [];
  }
}

async function fetchTokenDetails(address) {
  try {
    const response = await fetch(DEXSCREENER_API + '/latest/dex/tokens/' + address);
    const data = await response.json();
    return data.pairs?.[0] || null;
  } catch (error) {
    return null;
  }
}

// === ANALYSIS ===

function isPumpAndDump(pair) {
  const priceChange1h = pair.priceChange?.h1 || 0;
  const priceChange5m = pair.priceChange?.m5 || 0;

  if (priceChange1h > CONFIG.maxPriceChange1h) {
    return { is: true, reason: '+' + priceChange1h.toFixed(0) + '% in 1h' };
  }
  if (priceChange5m > 200) {
    return { is: true, reason: '+' + priceChange5m.toFixed(0) + '% in 5m' };
  }

  if (pair.pairCreatedAt) {
    const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
    if (ageMinutes < CONFIG.minAge) {
      return { is: true, reason: 'Too new (' + Math.round(ageMinutes) + 'm)' };
    }
  }

  return { is: false };
}

async function analyzeToken(pair) {
  const address = pair.baseToken?.address;
  if (!address) return null;

  const liquidity = pair.liquidity?.usd || 0;
  if (liquidity < CONFIG.minLiquidity) return null;

  const pumpCheck = isPumpAndDump(pair);
  if (pumpCheck.is) {
    return {
      address,
      symbol: pair.baseToken?.symbol || '???',
      score: 0,
      signal: 'AVOID',
      factors: ['🚨 ' + pumpCheck.reason],
      skipped: true,
    };
  }

  const volume24h = pair.volume?.h24 || 0;
  const priceChange24h = pair.priceChange?.h24 || 0;
  const priceChange1h = pair.priceChange?.h1 || 0;
  const priceChange5m = pair.priceChange?.m5 || 0;
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;

  let onChainAudit = null;
  if (CONFIG.enableOnChain && liquidity > 3000) {
    onChainAudit = await performOnChainAudit(address);
  }

  let score = 0;
  const factors = [];

  // ON-CHAIN (max 40)
  if (onChainAudit) {
    score += onChainAudit.score * 0.4;
    factors.push(...onChainAudit.issues.slice(0, 2));
  } else {
    score += 20;
    factors.push('ℹ️ On-chain skipped');
  }

  // LIQUIDITY (max 20)
  if (liquidity > 100000) { score += 20; factors.push('✅ Liq $' + (liquidity/1000).toFixed(0) + 'k'); }
  else if (liquidity > 30000) { score += 15; factors.push('✅ Liq $' + (liquidity/1000).toFixed(0) + 'k'); }
  else if (liquidity > 10000) { score += 10; }
  else { score += 5; }

  // VOLUME (max 15)
  if (volume24h > 100000) { score += 15; factors.push('✅ Vol $' + (volume24h/1000).toFixed(0) + 'k'); }
  else if (volume24h > 30000) { score += 10; }
  else if (volume24h > 5000) { score += 5; }

  // MOMENTUM (max 15)
  if (priceChange1h > 10 && priceChange1h < 100) {
    score += 15;
    factors.push('🚀 +' + priceChange1h.toFixed(0) + '% (1h)');
  } else if (priceChange1h > 0 && priceChange1h <= 10) {
    score += 8;
    factors.push('📈 +' + priceChange1h.toFixed(1) + '% (1h)');
  } else if (priceChange1h < -20) {
    score -= 5;
    factors.push('📉 ' + priceChange1h.toFixed(0) + '% (1h)');
  }

  // BUY/SELL RATIO (max 10)
  const totalTxns = buys1h + sells1h;
  if (totalTxns > 10) {
    const buyRatio = buys1h / totalTxns;
    if (buyRatio > 0.6) { score += 10; factors.push('✅ ' + (buyRatio * 100).toFixed(0) + '% buys'); }
    else if (buyRatio < 0.35) { score -= 5; factors.push('⚠️ ' + ((1-buyRatio) * 100).toFixed(0) + '% sells'); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let signal = 'HOLD';
  if (score >= 75) signal = 'STRONG_BUY';
  else if (score >= 60) signal = 'BUY';
  else if (score >= 45) signal = 'WATCH';
  else if (score < 30) signal = 'AVOID';

  let ageText = '?';
  if (pair.pairCreatedAt) {
    const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
    const ageHours = ageMinutes / 60;
    if (ageHours < 1) ageText = Math.round(ageMinutes) + 'm';
    else if (ageHours < 24) ageText = Math.round(ageHours) + 'h';
    else ageText = Math.round(ageHours / 24) + 'd';
  }

  return {
    address,
    name: pair.baseToken?.name || 'Unknown',
    symbol: pair.baseToken?.symbol || '???',
    dex: pair.dexId || 'unknown',
    price: parseFloat(pair.priceUsd) || 0,
    priceChange5m,
    priceChange1h,
    priceChange24h,
    volume24h,
    liquidity,
    marketCap: pair.marketCap || 0,
    buys1h,
    sells1h,
    score,
    signal,
    factors,
    age: ageText,
    onChain: onChainAudit ? {
      mintRevoked: onChainAudit.authorities?.mintAuthorityRevoked,
      freezeRevoked: onChainAudit.authorities?.freezeAuthorityRevoked,
      topHolderPct: onChainAudit.holders?.topHolderPercentage,
      top10Pct: onChainAudit.holders?.top10Percentage,
      isToken2022: onChainAudit.authorities?.isToken2022,
    } : null,
    url: 'https://dexscreener.com/solana/' + address,
  };
}

// === MAIN SCANNER ===

async function scan() {
  const startTime = Date.now();
  console.log('\n' + '='.repeat(60));
  console.log('🔍 SCANNING... ' + new Date().toLocaleTimeString());
  console.log('='.repeat(60));

  const opportunities = [];
  const skipped = [];
  const seenAddresses = new Set();

  console.log('\n📡 Fetching trending Solana tokens...');
  const trending = await fetchDexScreenerTrending();
  console.log('   Found ' + trending.length + ' trending');

  console.log('📡 Searching recent activity...');
  const recent = await fetchDexScreenerSearch('SOL');
  console.log('   Found ' + recent.length + ' pairs');

  console.log('\n🔬 Analyzing with on-chain checks...');

  // Analyze trending
  for (const token of trending.slice(0, 15)) {
    if (seenAddresses.has(token.tokenAddress)) continue;
    seenAddresses.add(token.tokenAddress);

    const details = await fetchTokenDetails(token.tokenAddress);
    if (details) {
      process.stdout.write('.');
      const analysis = await analyzeToken(details);
      if (analysis) {
        if (analysis.skipped) skipped.push(analysis);
        else if (analysis.score >= CONFIG.minScore) opportunities.push(analysis);
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }

  // Analyze recent
  for (const pair of recent.slice(0, 15)) {
    const address = pair.baseToken?.address;
    if (!address || seenAddresses.has(address)) continue;
    seenAddresses.add(address);

    process.stdout.write('.');
    const analysis = await analyzeToken(pair);
    if (analysis) {
      if (analysis.skipped) skipped.push(analysis);
      else if (analysis.score >= CONFIG.minScore) opportunities.push(analysis);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('\n');

  // === AI ANALYSIS ===
  let totalAiTokens = 0;

  if (CONFIG.enableAI && opportunities.length > 0) {
    console.log('🧠 AI ANALYSIS '.padEnd(60, '='));

    for (const token of opportunities) {
      if (token.score >= CONFIG.aiFullThreshold) {
        // Tier 2: Full analysis
        console.log(`\n   🔮 Full analysis: $${token.symbol} (score ${token.score})...`);
        const ai = await aiAnalyzeFull(token);

        if (ai.success) {
          token.ai = ai;
          totalAiTokens += ai.tokens || 0;

          // AI can override signal
          if (ai.signal && ai.confidence > 70) {
            token.signal = ai.signal;
          }

          console.log(`      → ${ai.signal} (risk ${ai.risk}/10, confidence ${ai.confidence}%)`);
          console.log(`      "${ai.verdict}"`);
        }
      } else if (token.score >= CONFIG.aiQuickThreshold) {
        // Tier 3: Quick check
        console.log(`   ⚡ Quick check: $${token.symbol} (score ${token.score})...`);
        const ai = await aiAnalyzeQuick(token);

        if (ai.success) {
          token.ai = ai;
          totalAiTokens += ai.tokens || 0;

          // Promote to WATCH if AI says it's worth it
          if (ai.watch && token.signal === 'HOLD') {
            token.signal = 'WATCH';
            token.factors.push('🧠 AI: ' + ai.reason);
          }

          console.log(`      → ${ai.watch ? '👀 Watch' : '⏭️ Skip'}: ${ai.reason}`);
        }
      }

      await new Promise(r => setTimeout(r, 300));
    }

    // Groq is FREE, Together AI is ~$0.88/M tokens
    const estimatedCost = AI_PROVIDER === 'groq' ? 0 : (totalAiTokens / 1000000) * 0.88;
    const costStr = AI_PROVIDER === 'groq' ? 'FREE!' : `~$${estimatedCost.toFixed(4)}`;
    console.log(`\n   💰 AI tokens used: ${totalAiTokens} (${costStr})`);
  }

  // Sort by score
  opportunities.sort((a, b) => b.score - a.score);
  const top = opportunities.slice(0, CONFIG.maxResults);

  // Show skipped
  if (skipped.length > 0) {
    console.log('\n⚠️  FILTERED OUT (pump & dump / too new):');
    for (const s of skipped.slice(0, 5)) {
      console.log('   $' + s.symbol + ' - ' + s.factors[0]);
    }
  }

  console.log('\n🏆 TOP OPPORTUNITIES '.padEnd(60, '='));

  if (top.length === 0) {
    console.log('\n   No tokens passed filters.');
  } else {
    for (const t of top) {
      const colors = {
        STRONG_BUY: '\x1b[32m',
        BUY: '\x1b[92m',
        WATCH: '\x1b[33m',
        HOLD: '\x1b[37m',
        AVOID: '\x1b[31m',
      };
      const c = colors[t.signal] || '\x1b[0m';
      const r = '\x1b[0m';

      console.log('\n' + c + '[' + t.signal + ']' + r + ' $' + t.symbol + ' — Score: ' + t.score + '/100');
      console.log('   💰 $' + t.price.toFixed(8) + ' | ' + (t.priceChange1h >= 0 ? '+' : '') + t.priceChange1h?.toFixed(1) + '% (1h) | Liq: $' + (t.liquidity/1000).toFixed(1) + 'k');

      if (t.onChain) {
        const mint = t.onChain.mintRevoked ? '✅Mint' : '❌Mint';
        const freeze = t.onChain.freezeRevoked ? '✅Freeze' : '❌Freeze';
        const holders = t.onChain.top10Pct ? 'Top10: ' + t.onChain.top10Pct.toFixed(0) + '%' : '';
        console.log('   🔗 ' + mint + ' | ' + freeze + ' | ' + holders);
      }

      if (t.ai) {
        if (t.ai.tier === 'full') {
          console.log('   🧠 AI: Risk ' + t.ai.risk + '/10 | ' + t.ai.verdict);
          if (t.ai.redFlags?.length) console.log('   🚩 ' + t.ai.redFlags.join(', '));
          if (t.ai.greenFlags?.length) console.log('   ✅ ' + t.ai.greenFlags.join(', '));
        } else {
          console.log('   ⚡ AI: ' + t.ai.reason);
        }
      }

      console.log('   📊 ' + t.factors.slice(0, 4).join(' | '));
      console.log('   🕐 ' + t.age + ' old | ' + t.dex + ' | ' + t.url);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n⏱️  ' + elapsed + 's | ' + opportunities.length + ' passed | ' + skipped.length + ' filtered | ' + seenAddresses.size + ' scanned');

  // Save results
  const fs = await import('fs');
  fs.writeFileSync('scan-results.json', JSON.stringify({
    timestamp: Date.now(),
    lastUpdate: new Date().toISOString(),
    opportunities: top,
    filtered: skipped.length,
    scanned: seenAddresses.size,
    aiEnabled: CONFIG.enableAI,
    aiTokensUsed: totalAiTokens,
  }, null, 2));
  console.log('💾 Saved to scan-results.json');
}

// === RUN ===
console.log('\n🧠 Meme Token Scanner + AI Analysis (FREE APIs!)');
console.log('='.repeat(50));
console.log('📡 Token Discovery: DexScreener (FREE)');
console.log('🔐 Security Checks: RugCheck API (FREE)');
const aiProviderName = AI_PROVIDER === 'groq' ? 'Groq (FREE!)'
  : AI_PROVIDER === 'together' ? 'Together AI'
  : 'DISABLED - set GROQ_API_KEY';
console.log('🧠 AI Analysis: ' + aiProviderName);
console.log('');
console.log('Filters: Min score ' + CONFIG.minScore + ' | Min liq $' + CONFIG.minLiquidity);
console.log('AI Tiers: Full (>=' + CONFIG.aiFullThreshold + ') | Quick (' + CONFIG.aiQuickThreshold + '-' + (CONFIG.aiFullThreshold-1) + ')');
console.log('');

scan();
setInterval(scan, CONFIG.scanInterval);
