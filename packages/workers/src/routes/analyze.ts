import { Hono } from 'hono';
import type { Bindings } from '../index';
import { HoneypotAnalysisRequest, HoneypotResult, HoneypotFlag } from '@argusguard/shared';
import { analyzeForHoneypot } from '../services/together-ai';
import { createSupabaseClient, cacheScanResult } from '../services/supabase';
import { fetchTokenData, buildOnChainContext, TokenOnChainData } from '../services/solana-data';
import { fetchDexScreenerData, buildMarketContext, DexScreenerData } from '../services/dexscreener';
import { fetchPumpFunData, buildPumpFunContext, isPumpFunToken, PumpFunTokenData } from '../services/pumpfun';
import {
  fetchHeliusTokenMetadata,
  analyzeCreatorWallet,
  analyzeTokenTransactions,
  analyzeDevSelling,
  analyzeInsiders,
  buildHeliusContext,
  findTokenCreator,
  CreatorAnalysis,
  DevSellingAnalysis,
  InsiderAnalysis,
  TransactionAnalysis,
} from '../services/helius';
import { checkRateLimit, getUserTier, getClientIP } from '../services/rate-limit';

interface AnalysisData {
  dexScreener: DexScreenerData | null;
  pumpFun: PumpFunTokenData | null;
  creator: CreatorAnalysis | null;
  devSelling: DevSellingAnalysis | null;
  insiders: InsiderAnalysis | null;
  holderData: TokenOnChainData | null;
  bundleData: TransactionAnalysis | null;
  isPumpFun: boolean;
  ageInDays: number;
  marketCapUsd: number;
  liquidityUsd: number;
  hasUnknownDeployer: boolean;
  hasMintAuthority: boolean;
  hasFreezeAuthority: boolean;
}

/**
 * Apply hardcoded minimum score rules for critical red flags
 * These rules OVERRIDE the AI score when specific conditions are met
 */
function applyHardcodedRules(
  result: HoneypotResult,
  data: AnalysisData
): HoneypotResult {
  let adjustedScore = result.riskScore;
  let adjustedLevel = result.riskLevel;
  const additionalFlags: HoneypotFlag[] = [];

  const { dexScreener, pumpFun, creator, isPumpFun, ageInDays, liquidityUsd, marketCapUsd } = data;

  // ============================================
  // RULE 1: CREATOR/DEPLOYER RISK (CRITICAL)
  // ============================================
  if (creator) {
    // Previous rugs = immediate high risk
    if (creator.ruggedTokens > 0) {
      const penalty = Math.min(creator.ruggedTokens * 20, 50);
      if (adjustedScore < 70 + penalty / 2) {
        adjustedScore = Math.min(95, 70 + penalty / 2);
        additionalFlags.push({
          type: 'DEPLOYER',
          severity: 'CRITICAL',
          message: `CRITICAL: Creator has ${creator.ruggedTokens} previous dead/rugged tokens`,
        });
      }
    }

    // Brand new wallet = higher risk baseline
    // Only adjust score here - AI will add the appropriate flag
    if (creator.walletAge === 0) {
      if (adjustedScore < 65) {
        adjustedScore = 65;
      }
    } else if (creator.walletAge < 7) {
      if (adjustedScore < 55) {
        adjustedScore = 55;
      }
    }

    // Serial token creator - VERY suspicious, most are rug farmers
    if (creator.tokensCreated >= 20) {
      // 20+ tokens = professional rug farmer
      if (adjustedScore < 85) {
        adjustedScore = 85;
      }
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'CRITICAL',
        message: `🚨 SERIAL RUG FARMER: Creator has deployed ${creator.tokensCreated} tokens - extremely high rug risk`,
      });
      console.log(`[Rules] Serial creator (${creator.tokensCreated} tokens) penalty applied - score: ${adjustedScore}`);
    } else if (creator.tokensCreated >= 10) {
      // 10-19 tokens = almost certainly a serial rugger
      if (adjustedScore < 80) {
        adjustedScore = 80;
      }
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'CRITICAL',
        message: `🚨 Serial token creator: ${creator.tokensCreated} tokens deployed - high rug risk`,
      });
      console.log(`[Rules] Serial creator (${creator.tokensCreated} tokens) penalty applied - score: ${adjustedScore}`);
    } else if (creator.tokensCreated >= 5) {
      // 5-9 tokens = very suspicious
      if (adjustedScore < 75) {
        adjustedScore = 75;
      }
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'HIGH',
        message: `⚠️ Serial token creator: ${creator.tokensCreated} tokens deployed - suspicious pattern`,
      });
      console.log(`[Rules] Serial creator (${creator.tokensCreated} tokens) penalty applied - score: ${adjustedScore}`);
    } else if (creator.tokensCreated >= 3) {
      // 3-4 tokens = suspicious, especially for new micro-cap tokens
      const minScore = (marketCapUsd < 50000 && ageInDays < 1) ? 70 : 60;
      if (adjustedScore < minScore) {
        adjustedScore = minScore;
      }
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'MEDIUM',
        message: `Creator has deployed ${creator.tokensCreated} tokens previously`,
      });
    }
  }

  // Unknown deployer = significant risk flag
  if (data.hasUnknownDeployer) {
    if (adjustedScore < 60) {
      adjustedScore = 60;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'HIGH',
        message: 'Deployer/creator could not be identified - higher risk',
      });
    }
  }

  // Creator address known but analysis failed = still risky (can't verify history)
  // This catches cases where pump.fun gives us address but analyzeCreatorWallet fails
  if (!data.hasUnknownDeployer && !creator) {
    if (adjustedScore < 60) {
      adjustedScore = 60;
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'MEDIUM',
        message: 'Creator wallet history could not be verified - exercise caution',
      });
    }
  }

  // ============================================
  // RULE 2: TOKEN AGE RISK
  // ============================================
  // Brand new tokens are inherently risky - NEVER allow them in SAFE range
  if (ageInDays < 1) {
    // Minimum 55 for ALL new tokens (SUSPICIOUS range)
    const baseMinScore = 55;
    if (adjustedScore < baseMinScore) {
      adjustedScore = baseMinScore;
      additionalFlags.push({
        type: 'TOKEN',
        severity: 'HIGH',
        message: `Very new token (<1 day old) - high risk of rug pull`,
      });
    }
  } else if (ageInDays < 3) {
    // Tokens 1-3 days old still risky
    if (adjustedScore < 50) {
      adjustedScore = 50;
      additionalFlags.push({
        type: 'TOKEN',
        severity: 'MEDIUM',
        message: `New token (${ageInDays} days old) - exercise caution`,
      });
    }
  }

  // ============================================
  // RULE 3: ZERO LIQUIDITY = HONEYPOT
  // ============================================
  // IMPORTANT: Pump.fun bonding curve tokens report $0 liquidity on DexScreener
  // but they CAN be sold via the bonding curve. Only flag as honeypot if:
  // 1. NOT a pump.fun token, OR
  // 2. IS a pump.fun token that has GRADUATED (complete=true) but has $0 LP
  const isOnBondingCurve = isPumpFun && pumpFun && !pumpFun.complete;
  const isGraduatedWithNoLiquidity = isPumpFun && pumpFun?.complete && liquidityUsd <= 0;

  if (!isOnBondingCurve && liquidityUsd <= 0) {
    // Only flag if NOT on bonding curve
    if (isGraduatedWithNoLiquidity) {
      // Graduated pump.fun token with no LP = real problem
      if (adjustedScore < 90) {
        adjustedScore = 90;
        additionalFlags.push({
          type: 'LIQUIDITY',
          severity: 'CRITICAL',
          message: `🚨 HONEYPOT: Graduated from pump.fun but $0 LP - YOU CANNOT SELL`,
        });
      }
    } else if (!isPumpFun) {
      // Non-pump.fun token with no liquidity
      if (adjustedScore < 90) {
        adjustedScore = 90;
        additionalFlags.push({
          type: 'LIQUIDITY',
          severity: 'CRITICAL',
          message: `🚨 HONEYPOT: $0 liquidity - YOU CANNOT SELL THIS TOKEN`,
        });
      }
    }
  } else if (!isOnBondingCurve && liquidityUsd < 100) {
    if (adjustedScore < 85) {
      adjustedScore = 85;
      additionalFlags.push({
        type: 'LIQUIDITY',
        severity: 'CRITICAL',
        message: `CRITICAL: Only $${liquidityUsd.toFixed(2)} liquidity - extremely high rug risk`,
      });
    }
  }

  // ============================================
  // RULE 3b: LIQUIDITY RULES (NON-PUMP.FUN)
  // ============================================
  if (!isPumpFun && dexScreener) {
    // Very low liquidity = DANGEROUS
    if (liquidityUsd < 1000 && liquidityUsd >= 100) {
      if (adjustedScore < 80) {
        adjustedScore = 80;
        additionalFlags.push({
          type: 'LIQUIDITY',
          severity: 'HIGH',
          message: `Very low liquidity ($${liquidityUsd.toFixed(2)}) - high rug pull risk`,
        });
      }
    }
    // Low liquidity on new token = SUSPICIOUS
    else if (liquidityUsd < 10000 && ageInDays < 3) {
      if (adjustedScore < 70) {
        adjustedScore = 70;
        additionalFlags.push({
          type: 'LIQUIDITY',
          severity: 'MEDIUM',
          message: `Low liquidity ($${liquidityUsd.toFixed(2)}) on new token (${ageInDays} days old)`,
        });
      }
    }
  }

  // ============================================
  // RULE 4: PUMP.FUN SPECIFIC RULES
  // ============================================
  if (isPumpFun && pumpFun) {
    // Low bonding curve reserves
    if (pumpFun.realSolReserves < 1) {
      if (adjustedScore < 70) {
        adjustedScore = 70;
        additionalFlags.push({
          type: 'LIQUIDITY',
          severity: 'HIGH',
          message: `Very low bonding curve reserves (${pumpFun.realSolReserves.toFixed(2)} SOL)`,
        });
      }
    }

    // No socials on pump.fun = higher risk
    if (!pumpFun.twitter && !pumpFun.telegram && !pumpFun.website) {
      if (adjustedScore < 55 && ageInDays < 1) {
        adjustedScore = 55;
        additionalFlags.push({
          type: 'SOCIAL',
          severity: 'MEDIUM',
          message: 'No social links provided on pump.fun',
        });
      }
    }
  }

  // ============================================
  // RULE 5: AUTHORITY RISKS
  // ============================================
  if (data.hasMintAuthority) {
    if (adjustedScore < 50) {
      adjustedScore = 50;
    }
    additionalFlags.push({
      type: 'OWNERSHIP',
      severity: 'MEDIUM',
      message: 'Mint authority not revoked - more tokens can be created',
    });
  }

  if (data.hasFreezeAuthority) {
    if (adjustedScore < 55) {
      adjustedScore = 55;
    }
    additionalFlags.push({
      type: 'OWNERSHIP',
      severity: 'HIGH',
      message: 'Freeze authority exists - accounts can be frozen',
    });
  }

  // ============================================
  // RULE 6: SOCIAL PRESENCE CREDIT
  // ============================================
  // Give credit for having real social presence (website + Twitter)
  // This indicates some level of legitimacy and accountability
  const hasKnownRugs = creator && creator.ruggedTokens > 0;
  const hasWebsite = dexScreener?.websites && dexScreener.websites.length > 0;
  const hasTwitter = dexScreener?.socials?.some(s =>
    s.type === 'twitter' || s.url?.includes('twitter.com') || s.url?.includes('x.com')
  );

  // PENALTY: Micro cap + no socials = high rug risk
  const noSocials = !hasWebsite && !hasTwitter;
  if (marketCapUsd < 50000 && noSocials && ageInDays < 1) {
    if (adjustedScore < 70) {
      adjustedScore = 70;
      additionalFlags.push({
        type: 'SOCIAL',
        severity: 'HIGH',
        message: `Micro cap ($${(marketCapUsd / 1000).toFixed(1)}K) with no social presence - high rug risk`,
      });
    }
  }

  // CREDIT: Website + Twitter presence
  if (hasWebsite && hasTwitter && !hasKnownRugs) {
    // Reduce score by 5 for having social presence (min 50 to stay in SUSPICIOUS)
    const reduction = 5;
    if (adjustedScore > 50 && adjustedScore - reduction >= 50) {
      adjustedScore -= reduction;
      additionalFlags.push({
        type: 'SOCIAL',
        severity: 'LOW',
        message: 'Website and Twitter presence verified - slightly lower risk',
      });
    }
  }

  // ============================================
  // RULE 7: STRONG FUNDAMENTALS CREDIT
  // ============================================
  // Give credit for tokens showing exceptional organic growth
  // Even new tokens can demonstrate legitimacy through metrics
  const volume24h = dexScreener?.volume24h || 0;
  const txns24h = (dexScreener?.txns24h?.buys || 0) + (dexScreener?.txns24h?.sells || 0);

  let fundamentalsCredit = 0;

  // High liquidity shows real investment
  if (liquidityUsd >= 100_000) {
    fundamentalsCredit += 5;
    additionalFlags.push({
      type: 'LIQUIDITY',
      severity: 'LOW',
      message: `Strong liquidity ($${(liquidityUsd / 1000).toFixed(0)}K) - positive signal`,
    });
  }

  // High volume relative to market cap shows organic trading
  if (volume24h >= 1_000_000 && marketCapUsd > 0) {
    fundamentalsCredit += 5;
    additionalFlags.push({
      type: 'TRADING',
      severity: 'LOW',
      message: `High trading volume ($${(volume24h / 1_000_000).toFixed(1)}M) - active market`,
    });
  }

  // Large number of transactions shows real user activity
  if (txns24h >= 10_000) {
    fundamentalsCredit += 5;
    additionalFlags.push({
      type: 'TRADING',
      severity: 'LOW',
      message: `High transaction count (${txns24h.toLocaleString()} txns) - organic activity`,
    });
  }

  // Apply fundamentals credit (max 10 point reduction, floor at 50)
  if (fundamentalsCredit > 0 && !hasKnownRugs) {
    const maxCredit = Math.min(fundamentalsCredit, 10);
    if (adjustedScore > 50 && adjustedScore - maxCredit >= 50) {
      adjustedScore -= maxCredit;
    } else if (adjustedScore > 50) {
      adjustedScore = 50; // Floor at SUSPICIOUS threshold
    }
  }

  // ============================================
  // RULE 8: MARKET CAP CAPS (established tokens)
  // ============================================
  // Large established tokens should have score capped

  if (marketCapUsd >= 100_000_000 && ageInDays >= 30 && !hasKnownRugs) {
    // $100M+ market cap, 30+ days old - very established
    if (adjustedScore > 35) {
      adjustedScore = 35;
      additionalFlags.push({
        type: 'CONTRACT',
        severity: 'LOW',
        message: `Established token ($${(marketCapUsd / 1_000_000).toFixed(1)}M MC, ${ageInDays} days) - score capped`,
      });
    }
  } else if (marketCapUsd >= 50_000_000 && ageInDays >= 14 && !hasKnownRugs) {
    // $50M+ market cap, 14+ days old
    if (adjustedScore > 45) {
      adjustedScore = 45;
      additionalFlags.push({
        type: 'CONTRACT',
        severity: 'LOW',
        message: `Established token ($${(marketCapUsd / 1_000_000).toFixed(1)}M MC, ${ageInDays} days) - score capped`,
      });
    }
  } else if (marketCapUsd >= 10_000_000 && ageInDays >= 7 && !hasKnownRugs) {
    // $10M+ market cap, 7+ days old
    if (adjustedScore > 55) {
      adjustedScore = 55;
    }
  }

  // ============================================
  // RULE 9: DEV EXIT STATUS (Informational)
  // ============================================
  // NOTE: Dev having ALREADY sold is NOT necessarily bad for new buyers
  // If dev exited and token has sustained activity, it's actually safer
  // The PROACTIVE risk is in RULE 10 (current holdings)
  const { devSelling } = data;

  if (devSelling && devSelling.hasSold) {
    const { percentSold, currentHoldingsPercent } = devSelling;

    // If dev sold 100% and holds 0%, token is "community-owned"
    if (percentSold >= 90 && currentHoldingsPercent === 0) {
      // Dev has completely exited - this is NEUTRAL/POSITIVE for new buyers
      // Only flag as info, don't increase score
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'LOW',
        message: `Dev has exited (sold ${percentSold.toFixed(0)}%) - token is community-owned`,
      });
      // Give slight credit if token has sustained activity after dev exit
      if (marketCapUsd > 100000 && liquidityUsd > 10000) {
        if (adjustedScore > 50) {
          adjustedScore -= 5; // Credit for surviving dev exit
        }
      }
    } else if (percentSold >= 50 && currentHoldingsPercent > 0) {
      // Dev sold significant amount but STILL HOLDS some - mixed signal
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'MEDIUM',
        message: `Dev sold ${percentSold.toFixed(0)}% but still holds ${currentHoldingsPercent.toFixed(1)}%`,
      });
    }
    // Note: Active selling while holding is handled by RULE 10 (current holdings)
  }

  // ============================================
  // RULE 10: CREATOR CURRENT HOLDINGS (PROACTIVE)
  // ============================================
  // Even if dev hasn't sold yet, check if they COULD dump
  if (devSelling && devSelling.currentHoldingsPercent > 0) {
    const { currentHoldingsPercent } = devSelling;

    if (currentHoldingsPercent >= 50) {
      // Creator holds 50%+ - CRITICAL dump risk
      if (adjustedScore < 75) {
        adjustedScore = 75;
      }
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'CRITICAL',
        message: `⚠️ Creator holds ${currentHoldingsPercent.toFixed(1)}% of supply - major dump risk`,
      });
    } else if (currentHoldingsPercent >= 30) {
      // Creator holds 30%+ - HIGH risk
      if (adjustedScore < 65) {
        adjustedScore = 65;
      }
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'HIGH',
        message: `Creator holds ${currentHoldingsPercent.toFixed(1)}% of supply - significant dump risk`,
      });
    } else if (currentHoldingsPercent >= 20) {
      // Creator holds 20%+ - MEDIUM risk
      if (adjustedScore < 55) {
        adjustedScore = 55;
      }
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'MEDIUM',
        message: `Creator holds ${currentHoldingsPercent.toFixed(1)}% of supply`,
      });
    } else if (currentHoldingsPercent >= 10) {
      // Creator holds 10%+ - worth noting
      additionalFlags.push({
        type: 'DEPLOYER',
        severity: 'LOW',
        message: `Creator still holds ${currentHoldingsPercent.toFixed(1)}% of supply`,
      });
    }
  }

  // ============================================
  // RULE 11: INSIDER/SNIPER DETECTION (PROACTIVE)
  // ============================================
  // Check if early buyers (potential insiders) hold large amounts
  const { insiders } = data;

  if (insiders && insiders.insiders.length > 0) {
    if (insiders.severity === 'CRITICAL') {
      // 3+ insiders each holding 5%+
      if (adjustedScore < 80) {
        adjustedScore = 80;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'CRITICAL',
        message: `🚨 ${insiders.message}`,
      });
    } else if (insiders.severity === 'HIGH') {
      // 2 insiders holding 5%+
      if (adjustedScore < 70) {
        adjustedScore = 70;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'HIGH',
        message: `⚠️ ${insiders.message}`,
      });
    } else if (insiders.severity === 'MEDIUM') {
      // Collective 20%+ holdings
      if (adjustedScore < 60) {
        adjustedScore = 60;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'MEDIUM',
        message: insiders.message,
      });
    } else if (insiders.severity === 'LOW') {
      // Some early buyer concentration
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'LOW',
        message: insiders.message,
      });
    }
  }

  // ============================================
  // RULE 11.5: BUNDLE DETECTION (PROACTIVE)
  // ============================================
  // Coordinated buying is a MAJOR red flag - often precedes rugs
  const { bundleData } = data;
  let bundleDetectedFromHelius = false;

  if (bundleData && bundleData.coordinatedWallets > 0) {
    const coordWallets = bundleData.coordinatedWallets;
    const bundledPercent = bundleData.bundledBuyPercent;
    bundleDetectedFromHelius = true;

    if (coordWallets >= 10 || bundledPercent >= 25) {
      // CRITICAL: 10+ coordinated wallets or 25%+ bundled buys - definite rug setup
      if (adjustedScore < 80) {
        adjustedScore = 80;
      }
      additionalFlags.push({
        type: 'BUNDLE',
        severity: 'CRITICAL',
        message: `🚨 ${coordWallets} coordinated wallets detected buying in same slot - likely rug setup`,
      });
    } else if (coordWallets >= 5 || bundledPercent >= 15) {
      // HIGH: 5+ coordinated wallets or 15%+ bundled - very suspicious
      if (adjustedScore < 75) {
        adjustedScore = 75;
      }
      additionalFlags.push({
        type: 'BUNDLE',
        severity: 'HIGH',
        message: `⚠️ ${coordWallets} coordinated wallets detected buying in same slot - suspicious activity`,
      });
    } else if (coordWallets >= 3) {
      // MEDIUM: 3+ coordinated wallets - red flag
      if (adjustedScore < 70) {
        adjustedScore = 70;
      }
      additionalFlags.push({
        type: 'BUNDLE',
        severity: 'MEDIUM',
        message: `${coordWallets} coordinated wallets detected buying in same slot`,
      });
    } else {
      // Less than 3 coordinated wallets - still flag it but lower severity
      if (adjustedScore < 60) {
        adjustedScore = 60;
      }
      additionalFlags.push({
        type: 'BUNDLE',
        severity: 'LOW',
        message: `${coordWallets} coordinated wallet(s) detected in same slot`,
      });
    }
  }

  // ============================================
  // RULE 11.6: BUNDLE PENALTY (+15 for ANY bundle detection)
  // ============================================
  // Bundle activity is a PRIMARY rug indicator - this is how scammers coordinate buys
  // Any bundle activity adds +15 risk points - bundling is always suspicious
  // This applies ON TOP of the minimum score rules above
  if (bundleDetectedFromHelius) {
    adjustedScore += 15;
    console.log(`[Rules] Bundle penalty +15 applied (Helius detected bundles) - new score: ${adjustedScore}`);
  }

  // ============================================
  // RULE 11.7: AI BUNDLE MENTION PENALTY (+10)
  // ============================================
  // If AI mentions bundles in text but we didn't detect via Helius, add +10
  // This catches cases where AI sees bundle patterns we missed
  const bundleKeywords = ['bundle', 'bundled', 'coordinated wallet', 'same slot', 'sniping'];
  const aiTextToSearch = [
    result.summary.toLowerCase(),
    ...result.flags.map(f => f.message.toLowerCase()),
  ].join(' ');

  const aiBundleMentioned = bundleKeywords.some(keyword => aiTextToSearch.includes(keyword));

  if (aiBundleMentioned && !bundleDetectedFromHelius) {
    // AI mentioned bundles but Helius didn't detect them - add penalty
    adjustedScore += 10;
    additionalFlags.push({
      type: 'BUNDLE',
      severity: 'HIGH',
      message: 'AI detected potential bundle/coordinated activity',
    });
    console.log(`[Rules] AI bundle mention penalty +10 applied - new score: ${adjustedScore}`);
  } else if (aiBundleMentioned && bundleDetectedFromHelius) {
    // Both detected - add another +10 for double confirmation (strong rug signal)
    adjustedScore += 10;
    console.log(`[Rules] AI bundle confirmation penalty +10 applied - new score: ${adjustedScore}`);
  }

  // ============================================
  // RULE 11.8: SIMILAR HOLDINGS BUNDLE DETECTION (BACKUP)
  // ============================================
  // If Helius transaction detection missed bundles, check for similar holdings patterns
  // Bundles often result in many wallets holding nearly identical percentages
  let similarHoldingsBundleDetected = false;
  if (!bundleDetectedFromHelius && data.holderData && data.holderData.topHolders.length > 0) {
    // Get non-LP, non-deployer holders sorted by percentage
    const regularHolders = data.holderData.topHolders
      .filter(h => !h.isLiquidityPool && !h.isDeployer && h.percentage > 0.5)
      .sort((a, b) => b.percentage - a.percentage);

    // Look for clusters of wallets with similar holdings (within 0.5% of each other)
    let clusterCount = 0;
    for (let i = 1; i < regularHolders.length; i++) {
      const diff = Math.abs(regularHolders[i].percentage - regularHolders[i - 1].percentage);
      if (diff < 0.5) {
        clusterCount++;
      }
    }

    // If 5+ wallets have similar holdings, it's a strong bundle signal
    if (clusterCount >= 10) {
      similarHoldingsBundleDetected = true;
      if (adjustedScore < 80) {
        adjustedScore = 80;
      }
      additionalFlags.push({
        type: 'BUNDLE',
        severity: 'CRITICAL',
        message: `🚨 ${clusterCount + 1}+ wallets with suspiciously similar holdings - likely coordinated bundle`,
      });
      console.log(`[Rules] Similar holdings bundle (${clusterCount + 1} wallets) - CRITICAL - score: ${adjustedScore}`);
    } else if (clusterCount >= 5) {
      similarHoldingsBundleDetected = true;
      if (adjustedScore < 75) {
        adjustedScore = 75;
      }
      additionalFlags.push({
        type: 'BUNDLE',
        severity: 'HIGH',
        message: `⚠️ ${clusterCount + 1} wallets with similar holdings detected - potential bundle`,
      });
      console.log(`[Rules] Similar holdings bundle (${clusterCount + 1} wallets) - HIGH - score: ${adjustedScore}`);
    } else if (clusterCount >= 3) {
      similarHoldingsBundleDetected = true;
      if (adjustedScore < 70) {
        adjustedScore = 70;
      }
      additionalFlags.push({
        type: 'BUNDLE',
        severity: 'MEDIUM',
        message: `${clusterCount + 1} wallets with similar holdings detected`,
      });
      console.log(`[Rules] Similar holdings bundle (${clusterCount + 1} wallets) - MEDIUM - score: ${adjustedScore}`);
    }

    // Apply bundle penalty if detected via similar holdings
    if (similarHoldingsBundleDetected) {
      adjustedScore += 15;
      console.log(`[Rules] Similar holdings bundle penalty +15 applied - new score: ${adjustedScore}`);
    }
  }

  // ============================================
  // RULE 12: PUMP.FUN DISTRIBUTION CHECK (CRITICAL)
  // ============================================
  // Check if token has REAL distribution or if most is still in bonding curve
  // A token where 95%+ is in bonding curve means almost nobody has bought!
  if (isPumpFun && data.holderData) {
    const topHolderPercent = data.holderData.top1HolderPercent;
    const top10NonLpPercent = data.holderData.top10NonLpHolderPercent;

    // If bonding curve holds 95%+ and total non-LP distribution is < 5%
    // This means almost no one has actually bought - VERY THIN market
    if (topHolderPercent >= 95 && top10NonLpPercent < 5) {
      if (adjustedScore < 70) {
        adjustedScore = 70;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'HIGH',
        message: `⚠️ Only ${top10NonLpPercent.toFixed(1)}% of supply distributed - ${topHolderPercent.toFixed(1)}% still in bonding curve`,
      });
    } else if (topHolderPercent >= 90 && top10NonLpPercent < 10) {
      // 90%+ in bonding curve, < 10% distributed - still risky
      if (adjustedScore < 65) {
        adjustedScore = 65;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'MEDIUM',
        message: `Low distribution: ${top10NonLpPercent.toFixed(1)}% of supply distributed, ${topHolderPercent.toFixed(1)}% in bonding curve`,
      });
    }
  }

  // ============================================
  // RULE 12.5: SINGLE WHALE CONCENTRATION (CRITICAL)
  // ============================================
  // A single non-LP wallet holding >25% = major dump risk
  // This catches whales that accumulated during bonding curve
  if (data.holderData) {
    const top1NonLp = data.holderData.top1NonLpHolderPercent;

    if (top1NonLp >= 30) {
      // CRITICAL: One wallet holds 30%+ - guaranteed crash if they sell
      if (adjustedScore < 80) {
        adjustedScore = 80;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'CRITICAL',
        message: `🚨 CRITICAL: Single wallet holds ${top1NonLp.toFixed(1)}% of supply - major dump risk`,
      });
      console.log(`[Rules] Single whale >30% penalty applied (${top1NonLp.toFixed(1)}%) - score: ${adjustedScore}`);
    } else if (top1NonLp >= 25) {
      // HIGH: One wallet holds 25-30%
      if (adjustedScore < 75) {
        adjustedScore = 75;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'HIGH',
        message: `⚠️ Single wallet holds ${top1NonLp.toFixed(1)}% of supply - high dump risk`,
      });
      console.log(`[Rules] Single whale >25% penalty applied (${top1NonLp.toFixed(1)}%) - score: ${adjustedScore}`);
    } else if (top1NonLp >= 15) {
      // MEDIUM: One wallet holds 15-25%
      if (adjustedScore < 65) {
        adjustedScore = 65;
      }
      additionalFlags.push({
        type: 'HOLDERS',
        severity: 'MEDIUM',
        message: `Single wallet holds ${top1NonLp.toFixed(1)}% of supply - moderate dump risk`,
      });
      console.log(`[Rules] Single whale >15% penalty applied (${top1NonLp.toFixed(1)}%) - score: ${adjustedScore}`);
    }
  }

  // ============================================
  // RULE 13: PUMP.FUN GOOD FUNDAMENTALS CREDIT
  // ============================================
  // For pump.fun tokens on bonding curve with GOOD indicators, reduce score
  // This counterbalances the age/creator penalties for tokens showing healthy signs
  // CRITICAL: NEVER apply credits when we have incomplete data!
  if (isPumpFun && !hasKnownRugs) {
    // Check if we have REAL, VERIFIED data before giving ANY credit
    const hasVerifiedData = !!creator && // Must have verified creator
      !!data.holderData && // Must have holder data
      data.holderData.totalHolders > 0; // Must have actual holder count

    const hasRealDistribution = data.holderData &&
      data.holderData.top1HolderPercent < 90 &&
      data.holderData.top10NonLpHolderPercent >= 10;

    // Only give credit if we have VERIFIED data AND real distribution
    if (hasVerifiedData && hasRealDistribution) {
      let goodIndicatorCredit = 0;

      // Dev has completely exited (0% holdings)
      // ONLY give credit if token has OTHER positive signals too
      // A dev dumping on a no-socials, micro-cap, new-wallet token is NOT positive!
      const hasSocials = hasTwitter || hasWebsite;
      const hasDecentMarketCap = marketCapUsd >= 50000;

      if (devSelling && devSelling.currentHoldingsPercent === 0 && devSelling.hasSold) {
        // Only give credit if token has positive fundamentals
        if (hasSocials && hasDecentMarketCap) {
          goodIndicatorCredit += 10;
        } else if (hasSocials || hasDecentMarketCap) {
          goodIndicatorCredit += 5; // Partial credit
        }
        // NO credit if no socials AND micro cap - dev just dumped and ran
      }

      // Excellent holder distribution (top non-LP holder < 5% AND there's real distribution)
      if (data.holderData && data.holderData.top1NonLpHolderPercent < 5 && data.holderData.top10NonLpHolderPercent >= 10) {
        goodIndicatorCredit += 5;
        additionalFlags.push({
          type: 'HOLDERS',
          severity: 'LOW',
          message: `Top 1 Non-LP Holder owns ${data.holderData.top1NonLpHolderPercent.toFixed(2)}% of supply`,
        });
      }

      // No suspicious insiders detected
      if (insiders && insiders.insiders.length === 0) {
        goodIndicatorCredit += 5;
      }

      // Has socials (Twitter or website via DexScreener)
      if (hasTwitter || hasWebsite) {
        goodIndicatorCredit += 5;
      }

      // Both authorities revoked (mint and freeze)
      if (!data.hasMintAuthority && !data.hasFreezeAuthority) {
        goodIndicatorCredit += 5;
      }

      // Apply credit (cap reduction to keep minimum based on risk factors)
      if (goodIndicatorCredit > 0) {
        const maxCredit = Math.min(goodIndicatorCredit, 20); // Cap at 20 point reduction

        // Floor depends on risk factors - no socials + micro cap = higher floor
        let floor = 40;
        if (ageInDays < 1) {
          floor = 50; // New tokens minimum 50
          if (!hasSocials && marketCapUsd < 50000) {
            floor = 60; // No socials + micro cap = minimum 60
          }
        }

        if (adjustedScore - maxCredit >= floor) {
          adjustedScore -= maxCredit;
          console.log(`[Rules] Pump.fun good fundamentals credit: -${maxCredit} points (new score: ${adjustedScore})`);
        } else if (adjustedScore > floor) {
          adjustedScore = floor;
          console.log(`[Rules] Pump.fun good fundamentals credit: reduced to floor ${floor}`);
        }
      }
    } else {
      console.log(`[Rules] Skipping good fundamentals credit - insufficient verified data or distribution`);
    }
  }

  // ============================================
  // RULE 14: INCOMPLETE DATA PENALTY
  // ============================================
  // If we couldn't verify key data, score should be HIGHER not lower
  // Missing data = can't verify safety = higher risk
  const hasIncompleteData = result.confidence === 0 || // AI failed
    (!creator && !data.hasUnknownDeployer) || // Creator known but analysis failed
    (data.holderData && data.holderData.totalHolders === 0); // Holder data fetch failed

  if (hasIncompleteData && isPumpFun && ageInDays < 1) {
    // New pump.fun token with incomplete data = HIGH RISK
    if (adjustedScore < 65) {
      adjustedScore = 65;
      if (result.confidence === 0) {
        additionalFlags.push({
          type: 'CONTRACT',
          severity: 'HIGH',
          message: 'Analysis incomplete - unable to fully verify token safety',
        });
      }
      console.log(`[Rules] Incomplete data penalty applied - new score: ${adjustedScore}`);
    }
  }

  // ============================================
  // DETERMINE FINAL RISK LEVEL
  // ============================================
  if (adjustedScore >= 90) {
    adjustedLevel = 'SCAM';
  } else if (adjustedScore >= 70) {
    adjustedLevel = 'DANGEROUS';
  } else if (adjustedScore >= 50) {
    adjustedLevel = 'SUSPICIOUS';
  } else {
    adjustedLevel = 'SAFE';
  }

  // Merge additional flags (avoid duplicates)
  const existingFlagMessages = new Set(result.flags.map(f => f.message));
  const newFlags = additionalFlags.filter(f => !existingFlagMessages.has(f.message));

  return {
    ...result,
    riskScore: adjustedScore,
    riskLevel: adjustedLevel,
    flags: [...newFlags, ...result.flags], // New critical flags first
  };
}

const CACHE_TTL_SECONDS = 3600; // 1 hour

// Fetch current SOL price from CoinGecko (cached)
let solPriceCache: { price: number; timestamp: number } | null = null;
const SOL_PRICE_CACHE_TTL = 60000; // 1 minute

async function getSolPrice(): Promise<number> {
  const now = Date.now();

  if (solPriceCache && now - solPriceCache.timestamp < SOL_PRICE_CACHE_TTL) {
    return solPriceCache.price;
  }

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    const data = await response.json() as { solana?: { usd?: number } };
    const price = data.solana?.usd || 150;

    solPriceCache = { price, timestamp: now };
    return price;
  } catch (error) {
    console.warn('Failed to fetch SOL price, using fallback:', error);
    return solPriceCache?.price || 150;
  }
}

export const analyzeRoutes = new Hono<{ Bindings: Bindings }>();

analyzeRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<HoneypotAnalysisRequest & { forceRefresh?: boolean; walletAddress?: string }>();

    if (!body.tokenAddress) {
      return c.json({ error: 'tokenAddress is required' }, 400);
    }

    // ============================================
    // RATE LIMITING CHECK
    // ============================================
    const walletAddress = body.walletAddress || c.req.header('X-Wallet-Address') || null;
    const clientIP = getClientIP(c.req.raw);

    // Determine user tier
    const { tier } = await getUserTier(
      walletAddress,
      c.env.ARGUSGUARD_MINT,
      c.env.HELIUS_API_KEY,
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY
    );

    // Use wallet address if connected, otherwise use IP
    const rateLimitIdentifier = walletAddress || clientIP;

    // Check rate limit
    const rateLimitResult = await checkRateLimit(c.env.SCAN_CACHE, rateLimitIdentifier, tier);

    if (!rateLimitResult.allowed) {
      return c.json({
        error: rateLimitResult.error,
        tier,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit,
        resetAt: rateLimitResult.resetAt,
      }, 429);
    }

    // Add rate limit headers to response
    c.header('X-RateLimit-Limit', String(rateLimitResult.limit));
    c.header('X-RateLimit-Remaining', String(rateLimitResult.remaining));
    c.header('X-RateLimit-Reset', String(rateLimitResult.resetAt));
    c.header('X-User-Tier', tier);

    // Check KV cache first (unless force refresh requested)
    const cacheKey = `scan:${body.tokenAddress}`;

    if (!body.forceRefresh) {
      const cached = await c.env.SCAN_CACHE.get(cacheKey, 'json');

      if (cached) {
        return c.json({
          ...(cached as HoneypotResult),
          cached: true,
        });
      }
    }

    console.log(`[Analyze] Starting comprehensive analysis for ${body.tokenAddress}`);

    // Initialize analysis data
    const analysisData: AnalysisData = {
      dexScreener: null,
      pumpFun: null,
      creator: null,
      devSelling: null,
      insiders: null,
      holderData: null,
      bundleData: null,
      isPumpFun: isPumpFunToken(body.tokenAddress),
      ageInDays: 0,
      marketCapUsd: 0,
      liquidityUsd: 0,
      hasUnknownDeployer: true,
      hasMintAuthority: false,
      hasFreezeAuthority: false,
    };

    // Build combined context for AI
    let combinedContext = '';

    // ============================================
    // PHASE 1: Fetch all data sources in parallel
    // ============================================
    const heliusApiKey = c.env.HELIUS_API_KEY || '';

    const [
      solPrice,
      dexScreenerResult,
      pumpFunResult,
      heliusMetadata,
    ] = await Promise.all([
      getSolPrice(),
      fetchDexScreenerData(body.tokenAddress),
      analysisData.isPumpFun ? fetchPumpFunData(body.tokenAddress) : Promise.resolve(null),
      heliusApiKey ? fetchHeliusTokenMetadata(body.tokenAddress, heliusApiKey) : Promise.resolve(null),
    ]);

    // Store DexScreener data
    if (dexScreenerResult) {
      analysisData.dexScreener = dexScreenerResult;
      analysisData.ageInDays = dexScreenerResult.ageInDays || 0;
      analysisData.marketCapUsd = dexScreenerResult.marketCap || 0;
      analysisData.liquidityUsd = dexScreenerResult.liquidityUsd || 0;
    }

    // Store pump.fun data
    if (pumpFunResult) {
      analysisData.pumpFun = pumpFunResult;
      analysisData.ageInDays = pumpFunResult.ageInDays;
      analysisData.marketCapUsd = pumpFunResult.marketCapSol * solPrice;
      analysisData.hasUnknownDeployer = false; // We have the creator
    }

    // Check authorities from Helius metadata
    if (heliusMetadata) {
      analysisData.hasMintAuthority = !!heliusMetadata.mintAuthority;
      analysisData.hasFreezeAuthority = !!heliusMetadata.freezeAuthority;
    }

    // Build list of known LP addresses from multiple sources (used in multiple analyses)
    const knownLpAddresses: string[] = [];
    if (pumpFunResult?.bondingCurveAddress) {
      knownLpAddresses.push(pumpFunResult.bondingCurveAddress);
    }
    if (dexScreenerResult?.pairAddress) {
      knownLpAddresses.push(dexScreenerResult.pairAddress);
      console.log(`[Analyze] Detected LP pair: ${dexScreenerResult.pairAddress}`);
    }

    // ============================================
    // PHASE 2: Creator Detection (with caching)
    // ============================================
    let creatorAddress = pumpFunResult?.creator || heliusMetadata?.mintAuthority;

    // Check creator cache first (creator never changes for a token)
    const creatorCacheKey = `creator:${body.tokenAddress}`;
    if ((!creatorAddress || creatorAddress === 'unknown') && heliusApiKey) {
      // Try cache first
      const cachedCreator = await c.env.SCAN_CACHE.get(creatorCacheKey);
      if (cachedCreator) {
        creatorAddress = cachedCreator;
        console.log(`[Analyze] Creator from cache: ${creatorAddress}`);
      } else {
        console.log(`[Analyze] Creator not found via API, searching transaction history...`);
        // Pass pre-fetched dexId and pairCreatedAt to avoid duplicate DexScreener calls
        const dexId = dexScreenerResult?.dex?.toLowerCase();
        const pairCreatedAt = dexScreenerResult?.pairCreatedAt;
        const foundCreator = await findTokenCreator(body.tokenAddress, heliusApiKey, dexId, pairCreatedAt).catch(err => {
          console.warn('findTokenCreator failed:', err);
          return null;
        });
        if (foundCreator) {
          creatorAddress = foundCreator;
          // Cache creator permanently (it never changes)
          await c.env.SCAN_CACHE.put(creatorCacheKey, foundCreator, { expirationTtl: 86400 * 365 });
          console.log(`[Analyze] Found and cached creator: ${creatorAddress}`);
        }
      }
    }

    // ============================================
    // PHASE 3: PARALLEL Analysis (creator, dev selling, insiders, tx, holders)
    // ============================================
    // Run all analyses in parallel for speed
    let txAnalysis = null;
    let holderData = null;

    if (creatorAddress && creatorAddress !== 'unknown' && heliusApiKey) {
      console.log(`[Analyze] Running parallel analysis for creator: ${creatorAddress}`);
      analysisData.hasUnknownDeployer = false;

      // Check for cached creator analysis (includes tokensCreated, ruggedTokens)
      const creatorAnalysisCacheKey = `creator-analysis:${creatorAddress}`;
      const cachedCreatorAnalysis = await c.env.SCAN_CACHE.get(creatorAnalysisCacheKey, 'json') as CreatorAnalysis | null;

      // Run ALL analyses in parallel
      const [creatorAnalysis, devSellingAnalysis, insiderAnalysis, txResult, holderResult] = await Promise.all([
        // Creator wallet analysis - use cache if available
        cachedCreatorAnalysis ? Promise.resolve(cachedCreatorAnalysis) :
          analyzeCreatorWallet(creatorAddress, heliusApiKey).catch(err => {
            console.warn('Creator analysis failed:', err);
            return null;
          }),
        // Dev selling analysis - CRITICAL
        analyzeDevSelling(creatorAddress, body.tokenAddress, heliusApiKey).catch(err => {
          console.warn('Dev selling analysis failed:', err);
          return null;
        }),
        // Insider/sniper detection - PROACTIVE
        analyzeInsiders(body.tokenAddress, creatorAddress, heliusApiKey, knownLpAddresses).catch(err => {
          console.warn('Insider analysis failed:', err);
          return null;
        }),
        // Transaction analysis (bundle detection)
        analyzeTokenTransactions(body.tokenAddress, heliusApiKey).catch(err => {
          console.warn('Transaction analysis failed:', err);
          return null;
        }),
        // Holder data
        fetchTokenData(body.tokenAddress, heliusApiKey, knownLpAddresses).catch(() => null),
      ]);

      if (creatorAnalysis) {
        analysisData.creator = creatorAnalysis;
        // Cache creator analysis for 24 hours (tokensCreated and ruggedTokens change slowly)
        if (!cachedCreatorAnalysis) {
          await c.env.SCAN_CACHE.put(creatorAnalysisCacheKey, JSON.stringify(creatorAnalysis), {
            expirationTtl: 86400, // 24 hours
          });
          console.log(`[Analyze] Cached creator analysis for ${creatorAddress}`);
        }
      }
      if (devSellingAnalysis) analysisData.devSelling = devSellingAnalysis;
      if (insiderAnalysis) analysisData.insiders = insiderAnalysis;
      txAnalysis = txResult;
      holderData = holderResult;
    } else {
      // No creator found - still fetch holder data and tx analysis
      console.log(`[Analyze] No creator found, running limited parallel analysis`);
      const [txResult, holderResult] = await Promise.all([
        heliusApiKey ? analyzeTokenTransactions(body.tokenAddress, heliusApiKey).catch(() => null) : null,
        fetchTokenData(body.tokenAddress, heliusApiKey || undefined, knownLpAddresses).catch(() => null),
      ]);
      txAnalysis = txResult;
      holderData = holderResult;
    }

    // Update analysisData with holder data and bundle data for hardcoded rules
    analysisData.holderData = holderData;
    analysisData.bundleData = txAnalysis;

    // ============================================
    // PHASE 5: Build context string for AI
    // ============================================

    // Add data source header
    combinedContext += `COMPREHENSIVE TOKEN ANALYSIS\n`;
    combinedContext += `============================\n`;
    combinedContext += `Token: ${body.tokenAddress}\n`;
    combinedContext += `Type: ${analysisData.isPumpFun ? 'PUMP.FUN (bonding curve)' : 'Standard DEX token'}\n\n`;

    // Add pump.fun specific context
    if (analysisData.isPumpFun && pumpFunResult) {
      combinedContext += buildPumpFunContext(pumpFunResult, solPrice);
    } else if (analysisData.isPumpFun) {
      combinedContext += `\nPUMP.FUN TOKEN NOTICE:\n`;
      combinedContext += `- This is a PUMP.FUN token (address ends in 'pump')\n`;
      // Check bonding curve status via DexScreener dexId
      const dexId = dexScreenerResult?.dex?.toLowerCase();
      const isOnPumpswap = dexId === 'pumpswap';
      const isOnRaydium = dexId === 'raydium';
      const isStillOnBondingCurve = dexId === 'pumpfun';

      if (isOnPumpswap || isOnRaydium) {
        combinedContext += `- Bonding curve COMPLETE ✓ (graduated to ${isOnPumpswap ? 'Pumpswap' : 'Raydium'})\n`;
        combinedContext += `- Token has real liquidity pool\n\n`;
      } else if (isStillOnBondingCurve) {
        combinedContext += `- Token is STILL ON BONDING CURVE (not yet graduated)\n`;
        combinedContext += `- Trading via pump.fun bonding curve mechanism\n`;
        combinedContext += `- Note: Pump.fun API unavailable, status confirmed via DexScreener\n\n`;
      } else {
        combinedContext += `- Pump.fun API data unavailable\n`;
        combinedContext += `- ⚠️ Unable to verify bonding curve status\n\n`;
      }
    }

    // Add DexScreener market data
    if (dexScreenerResult) {
      combinedContext += buildMarketContext(dexScreenerResult);
    }

    // Add Helius data (metadata, creator analysis, tx analysis)
    combinedContext += buildHeliusContext(heliusMetadata, analysisData.creator, txAnalysis);

    // Add dev selling analysis - CRITICAL
    if (analysisData.devSelling && analysisData.devSelling.hasSold) {
      combinedContext += `\n\n🚨 DEV SELLING ANALYSIS:\n`;
      combinedContext += `- Dev Has Sold: YES\n`;
      combinedContext += `- Percent Sold: ${analysisData.devSelling.percentSold.toFixed(1)}%\n`;
      combinedContext += `- Total Sales: ${analysisData.devSelling.sellCount}\n`;
      combinedContext += `- Severity: ${analysisData.devSelling.severity}\n`;
      combinedContext += `- Status: ${analysisData.devSelling.message}\n`;
      if (analysisData.devSelling.severity === 'CRITICAL' || analysisData.devSelling.severity === 'HIGH') {
        combinedContext += `\n⚠️ MAJOR RED FLAG: Developer is dumping tokens!\n`;
      }
    } else if (analysisData.devSelling) {
      combinedContext += `\n\nDEV SELLING ANALYSIS:\n`;
      combinedContext += `- Dev Has Sold: NO ✓\n`;
      combinedContext += `- Status: Creator still holding\n`;
    }

    // Add proactive creator holdings warning
    if (analysisData.devSelling && analysisData.devSelling.currentHoldingsPercent > 0) {
      const holdingsPercent = analysisData.devSelling.currentHoldingsPercent;
      combinedContext += `\n\n⚠️ PROACTIVE RISK - CREATOR HOLDINGS:\n`;
      combinedContext += `- Creator Current Balance: ${holdingsPercent.toFixed(1)}% of total supply\n`;
      if (holdingsPercent >= 50) {
        combinedContext += `- CRITICAL: Creator holds majority of supply - CAN DUMP AT ANY TIME\n`;
      } else if (holdingsPercent >= 30) {
        combinedContext += `- HIGH RISK: Creator holds large portion - significant dump potential\n`;
      } else if (holdingsPercent >= 20) {
        combinedContext += `- MEDIUM RISK: Creator holds notable amount\n`;
      }
    }

    // Add insider/sniper analysis - PROACTIVE
    if (analysisData.insiders && analysisData.insiders.insiders.length > 0) {
      combinedContext += `\n\n⚠️ INSIDER/SNIPER ANALYSIS:\n`;
      combinedContext += `- Early Buyers Detected: ${analysisData.insiders.insiders.length}\n`;
      combinedContext += `- High-Risk Insiders (5%+ each): ${analysisData.insiders.highRiskInsiderCount}\n`;
      combinedContext += `- Total Insider Holdings: ${analysisData.insiders.totalInsiderHoldingsPercent.toFixed(1)}%\n`;
      combinedContext += `- Severity: ${analysisData.insiders.severity}\n`;
      combinedContext += `- Assessment: ${analysisData.insiders.message}\n`;
      if (analysisData.insiders.severity === 'CRITICAL' || analysisData.insiders.severity === 'HIGH') {
        combinedContext += `\n⚠️ WARNING: Multiple wallets bought early and hold significant amounts!\n`;
      }
    }

    // Add on-chain holder data
    if (holderData) {
      combinedContext += '\n' + buildOnChainContext(holderData);
    }

    // Add data completeness notice
    combinedContext += `\n\nDATA COMPLETENESS:\n`;
    combinedContext += `- DexScreener: ${dexScreenerResult ? 'YES' : 'NO'}\n`;
    combinedContext += `- Pump.fun API: ${pumpFunResult ? 'YES' : 'NO'}\n`;
    combinedContext += `- Helius Metadata: ${heliusMetadata ? 'YES' : 'NO'}\n`;
    combinedContext += `- Creator Analysis: ${analysisData.creator ? 'YES' : 'NO'}\n`;
    combinedContext += `- Holder Data: ${holderData ? 'YES' : 'NO'}\n`;

    if (analysisData.hasUnknownDeployer) {
      combinedContext += `\n⚠️ WARNING: Creator/deployer could not be identified - INCREASE RISK SCORE\n`;
    }

    console.log(`[Analyze] Context built (${combinedContext.length} chars), calling AI...`);

    // ============================================
    // PHASE 6: AI Analysis
    // ============================================
    let result = await analyzeForHoneypot(
      {
        tokenAddress: body.tokenAddress,
        onChainContext: combinedContext,
      },
      {
        apiKey: c.env.TOGETHER_AI_API_KEY,
        model: c.env.TOGETHER_AI_MODEL,
      }
    );

    // ============================================
    // PHASE 7: Apply hardcoded rules
    // ============================================
    result = applyHardcodedRules(result, analysisData);

    console.log(`[Analyze] Final score: ${result.riskScore} (${result.riskLevel})`);

    // Build comprehensive response with all valuable data
    const response = {
      ...result,
      cached: false,
      // Market Data
      market: dexScreenerResult ? {
        name: dexScreenerResult.name,
        symbol: dexScreenerResult.symbol,
        priceUsd: dexScreenerResult.priceUsd,
        priceChange24h: dexScreenerResult.priceChange24h,
        marketCap: dexScreenerResult.marketCap,
        liquidity: dexScreenerResult.liquidityUsd,
        volume24h: dexScreenerResult.volume24h,
        txns24h: dexScreenerResult.txns24h,
        dex: dexScreenerResult.dex,
        ageInDays: dexScreenerResult.ageInDays,
      } : null,
      // Holder Data
      holders: holderData ? {
        topHolder: holderData.top1HolderPercent,
        top10Holders: holderData.top10HolderPercent,
        top1NonLp: holderData.top1NonLpHolderPercent,
        top10NonLp: holderData.top10NonLpHolderPercent,
        totalHolders: holderData.totalHolders,
      } : null,
      // Creator Data
      creator: analysisData.creator ? {
        address: analysisData.creator.creatorAddress,
        walletAge: analysisData.creator.walletAge,
        tokensCreated: analysisData.creator.tokensCreated,
        ruggedTokens: analysisData.creator.ruggedTokens,
      } : null,
      // Dev Selling Analysis
      devSelling: analysisData.devSelling ? {
        hasSold: analysisData.devSelling.hasSold,
        percentSold: analysisData.devSelling.percentSold,
        sellCount: analysisData.devSelling.sellCount,
        currentHoldingsPercent: analysisData.devSelling.currentHoldingsPercent,
        severity: analysisData.devSelling.severity,
        message: analysisData.devSelling.message,
      } : null,
      // Insider/Sniper Analysis (PROACTIVE)
      insiders: analysisData.insiders ? {
        count: analysisData.insiders.insiders.length,
        highRiskCount: analysisData.insiders.highRiskInsiderCount,
        totalHoldingsPercent: analysisData.insiders.totalInsiderHoldingsPercent,
        severity: analysisData.insiders.severity,
        message: analysisData.insiders.message,
        wallets: analysisData.insiders.insiders.map(i => ({
          address: i.address,
          holdingsPercent: i.currentHoldingsPercent,
          isHighRisk: i.isHighRisk,
        })),
      } : null,
      // Social Links
      socials: {
        website: dexScreenerResult?.websites?.[0] || null,
        twitter: dexScreenerResult?.socials?.find(s => s.type === 'twitter')?.url || null,
      },
      // Authorities
      authorities: {
        mintRevoked: !analysisData.hasMintAuthority,
        freezeRevoked: !analysisData.hasFreezeAuthority,
      },
    };

    // Only cache if AI analysis succeeded (confidence > 0)
    // Don't cache incomplete results - let them retry on next request
    if (result.confidence > 0) {
      // Cache the FULL response (including market data, holders, etc.) in KV
      await c.env.SCAN_CACHE.put(cacheKey, JSON.stringify(response), {
        expirationTtl: CACHE_TTL_SECONDS,
      });

      // Also cache in Supabase for persistence (just the core result)
      const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
      await cacheScanResult(supabase, result);
    } else {
      console.log(`[Analyze] AI failed (confidence=0), NOT caching result for ${body.tokenAddress}`);
    }

    return c.json(response);
  } catch (error) {
    console.error('Analyze error:', error);
    return c.json(
      {
        error: 'Analysis failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Get cached result without triggering new analysis
analyzeRoutes.get('/:tokenAddress', async (c) => {
  const tokenAddress = c.req.param('tokenAddress');

  const cacheKey = `scan:${tokenAddress}`;
  const cached = await c.env.SCAN_CACHE.get(cacheKey, 'json');

  if (cached) {
    return c.json({
      ...(cached as HoneypotResult),
      cached: true,
    });
  }

  return c.json({ error: 'No cached result found' }, 404);
});
