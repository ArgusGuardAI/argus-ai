/**
 * AnalystAgent - Deep Investigation of Flagged Tokens
 *
 * Responsibilities:
 * - Receive suspicious tokens from Scouts
 * - Perform comprehensive analysis using ON-CHAIN DATA
 * - Build investigation reports with classified holders
 * - Recommend actions to Traders
 * - Hand off scammer profiles to Hunters
 */

import { BaseAgent, AgentConfig } from '../core/BaseAgent';
import { MessageBus } from '../core/MessageBus';
import { OnChainTools, ClassifiedHolder, HolderClassificationResult } from '../tools/OnChainTools';
import { MarketDataService } from '../services/MarketDataService';
import { PatternLibrary } from '../learning/PatternLibrary';
import type { Database } from '../services/Database';
import type { LLMService, TokenAnalysisContext } from '../services/LLMService';

export interface InvestigationRequest {
  token: string;
  score: number;
  flags: string[];
  features: number[];
  similarTokens?: Array<{ token: string; similarity: number }>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  source: string;
  timestamp: number;
  // Yellowstone data passed from ScoutAgent - avoids RPC calls!
  yellowstoneData?: {
    liquiditySol?: number;
    dex?: string;
    poolAddress?: string;
    graduatedFrom?: string;
    bondingCurveTime?: number;
  };
}

export interface DiscoveryResult {
  id: string;
  token: string;
  timestamp: number;

  market: {
    price: string | null;
    marketCap: number | null;
    liquidity: number | null;
    volume24h: number | null;
    priceChange24h: number | null;
    buys24h: number;
    sells24h: number;
    pairAddress: string | null;
    dexId: string | null;
    url: string | null;
  };

  tokenInfo: {
    name: string | null;
    symbol: string | null;
    decimals: number;
    supply: number;
    creator: string | null;
    mintAuthority: boolean;
    freezeAuthority: boolean;
  };

  analysis: {
    verdict: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
    confidence: number;
    score: number;
    summary: string;
    reasoning: string;
    attackVector: string | null;
    recommendations: string[];
    findings: Array<{
      category: string;
      finding: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      evidence: string;
    }>;
  };

  holders: {
    total: number;
    top10Concentration: number;
    giniCoefficient: number;
    topHolders: Array<{
      address: string;
      percent: number;
      isLP: boolean;
      isBundle: boolean;
    }>;
  };

  bundles: {
    detected: boolean;
    count: number;
    controlPercent: number;
    wallets: string[];
    assessment: string;
  };

  lp: {
    locked: boolean;
    burned: boolean;
    amount: number | null;
  };
}

export interface InvestigationReport {
  token: string;
  verdict: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  confidence: number;
  score: number;
  summary: string;
  findings: Array<{
    category: string;
    finding: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    evidence: string;
  }>;
  bundleAnalysis?: {
    detected: boolean;
    count: number;
    controlPercent: number;
    wallets: string[];
    assessment: string;
  };
  recommendation: string;
  timestamp: number;
}

export class AnalystAgent extends BaseAgent {
  private investigationQueue: InvestigationRequest[] = [];
  private completedInvestigations: Map<string, InvestigationReport> = new Map();
  private isInvestigating: boolean = false;
  private onChainTools: OnChainTools;
  private marketDataService: MarketDataService;
  private patternLibrary: PatternLibrary;
  private database: Database | undefined;
  private llm: LLMService | undefined;
  private scammerDB: Map<string, { rugCount: number; pattern: string; ruggedTokens: string[] }> = new Map();

  constructor(messageBus: MessageBus, options: { name?: string; rpcEndpoint?: string; database?: Database; llm?: LLMService } = {}) {
    // Initialize on-chain tools with RPC endpoint
    const rpcEndpoint = options.rpcEndpoint || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const config: AgentConfig = {
      name: options.name || 'analyst-1',
      role: 'Analyst - Deep investigation of suspicious tokens',
      model: './models/argus-sentinel-v1.bitnet',
      tools: [
        {
          name: 'get_full_token_data',
          description: 'Fetch comprehensive token data from blockchain',
          execute: (params) => this.getFullTokenData(params)
        },
        {
          name: 'analyze_bundles',
          description: 'Deep analysis of bundle/coordination patterns',
          execute: (params) => this.analyzeBundles(params)
        },
        {
          name: 'analyze_holders',
          description: 'Analyze holder distribution and behavior',
          execute: (params) => this.analyzeHolders(params)
        },
        {
          name: 'check_creator_history',
          description: 'Check creator wallet history for past rugs',
          execute: (params) => this.checkCreatorHistory(params)
        },
        {
          name: 'generate_report',
          description: 'Generate investigation report',
          execute: (params) => this.generateReport(params)
        },
        {
          name: 'recommend_action',
          description: 'Recommend action based on findings',
          execute: (params) => this.recommendAction(params)
        },
        {
          name: 'classify_holders_onchain',
          description: 'Classify all holders using pure on-chain data (LP, DEV, DEX, BURN, BUNDLE)',
          execute: (params) => this.classifyHoldersOnChain(params)
        },
        {
          name: 'get_token_creator',
          description: 'Find the original creator of a token from mint transaction',
          execute: (params) => this.getTokenCreator(params)
        }
      ],
      memory: true,
      reasoning: true,
      maxReasoningSteps: 7
    };

    super(config, messageBus);
    this.database = options.database;
    this.llm = options.llm;

    // Initialize on-chain tools
    this.onChainTools = new OnChainTools({ rpcEndpoint });

    // Initialize market data service (pure on-chain, no DexScreener)
    this.marketDataService = new MarketDataService(rpcEndpoint);

    // Initialize pattern library for scam pattern matching
    this.patternLibrary = new PatternLibrary();
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', 'Analyst initialized. Ready to investigate.');
  }

  protected async run(): Promise<void> {
    await this.think('observation', 'Starting investigation loop...');

    while (this.running) {
      try {
        // Process investigation queue
        if (this.investigationQueue.length > 0 && !this.isInvestigating) {
          // Sort by priority
          this.investigationQueue.sort((a, b) => {
            const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          });

          const request = this.investigationQueue.shift()!;
          await this.investigate(request);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.think('reflection', `Investigation error: ${errorMsg}`);
        this.isInvestigating = false;
      }
    }
  }

  /**
   * Investigate a suspicious token
   */
  private async investigate(request: InvestigationRequest): Promise<void> {
    this.isInvestigating = true;

    await this.think(
      'observation',
      `Starting investigation of ${request.token.slice(0, 8)}... (priority: ${request.priority})`
    );

    const findings: InvestigationReport['findings'] = [];
    let totalScore = request.score;

    try {
      // ═══════════════════════════════════════════════════════════════════
      // RPC-FREE ANALYSIS: Use Scout's data + our algorithms (BitNet, PatternLibrary)
      // No external calls - all analysis from feature vector and local data
      // ═══════════════════════════════════════════════════════════════════

      // Build token data from Scout's feature vector (0 RPC calls)
      const features = new Float32Array(request.features || []);
      const tokenData = this.buildTokenDataFromFeatures(
        request.token,
        features,
        request.yellowstoneData,
        request.flags
      );

      // Step 1: Analyze from feature vector using PatternLibrary
      await this.think('reasoning', 'Matching against known scam patterns...');
      const patternMatches = this.patternLibrary.matchPatterns(features);
      const patternMatch = patternMatches.length > 0 ? patternMatches[0] : null;

      if (patternMatch && patternMatch.confidence > 0.6) {
        const rugRate = patternMatch.pattern.rugRate;
        findings.push({
          category: 'PATTERN',
          finding: `Matches ${patternMatch.pattern.name} pattern (${(patternMatch.confidence * 100).toFixed(0)}% confidence)`,
          severity: rugRate > 0.7 ? 'CRITICAL' : 'HIGH',
          evidence: `Historical rug rate: ${(rugRate * 100).toFixed(0)}%`
        });
        totalScore += Math.round(patternMatch.confidence * 30);
      }

      // Step 2: Check bundle signals from features
      await this.think('reasoning', 'Checking coordination signals from features...');
      const bundleDetected = features[16] > 0.5; // bundleDetected feature
      const bundleControl = features[18] * 100; // bundleControlPercent

      if (bundleDetected) {
        const bundleCount = Math.round(features[17] * 20); // Denormalize
        findings.push({
          category: 'COORDINATION',
          finding: `~${bundleCount} coordinated wallets detected controlling ${bundleControl.toFixed(1)}%`,
          severity: bundleControl > 30 ? 'CRITICAL' : 'HIGH',
          evidence: 'Bundle pattern detected from holder distribution'
        });
        totalScore += bundleControl > 30 ? 20 : 10;
      }

      // Step 3: Check concentration from features
      await this.think('reasoning', 'Analyzing holder concentration from features...');
      const top10Concentration = features[6] * 100; // top10Concentration
      const topWhalePercent = features[10] * 100; // topWhalePercent
      const gini = features[7]; // giniCoefficient

      if (top10Concentration > 80 || topWhalePercent > 40) {
        findings.push({
          category: 'CONCENTRATION',
          finding: `Top 10 hold ${top10Concentration.toFixed(1)}%, top whale ${topWhalePercent.toFixed(1)}%`,
          severity: 'CRITICAL',
          evidence: `Gini coefficient: ${gini.toFixed(2)}`
        });
        totalScore += 15;
      }

      // Step 4: Check creator from local scammer database (0 RPC calls)
      await this.think('reasoning', 'Checking creator against scammer database...');
      const creatorAddress = tokenData.creator;
      let creatorHistory = { rugCount: 0, isKnownScammer: false, pattern: '', ruggedTokens: [] as string[] };
      if (creatorAddress && creatorAddress !== 'unknown') {
        const scammerCheck = await this.checkLocalScammerDB(creatorAddress);
        creatorHistory = {
          rugCount: scammerCheck.rugCount,
          isKnownScammer: scammerCheck.isKnown,
          pattern: scammerCheck.pattern,
          ruggedTokens: scammerCheck.ruggedTokens || [],
        };
        if (scammerCheck.isKnown) {
          findings.push({
            category: 'CREATOR',
            finding: `Creator is KNOWN SCAMMER with ${scammerCheck.rugCount} previous rugs`,
            severity: 'CRITICAL',
            evidence: `Pattern: ${scammerCheck.pattern}`
          });
          totalScore += 40;
        } else if (features[27] > 0.3) {
          // creatorRugHistory feature indicates past rugs
          findings.push({
            category: 'CREATOR',
            finding: 'Creator has suspicious history indicators',
            severity: 'HIGH',
            evidence: 'Feature analysis suggests past rug behavior'
          });
          totalScore += 20;
        }
      }

      // Step 5: Check security flags from Scout
      for (const flag of request.flags) {
        if (flag === 'MINT_ACTIVE') {
          findings.push({
            category: 'SECURITY',
            finding: 'Mint authority is active - creator can mint more tokens',
            severity: 'HIGH',
            evidence: 'Mint authority not revoked'
          });
          totalScore += 10;
        }
        if (flag === 'FREEZE_ACTIVE') {
          findings.push({
            category: 'SECURITY',
            finding: 'Freeze authority is active - creator can freeze accounts',
            severity: 'CRITICAL',
            evidence: 'Freeze authority not revoked'
          });
          totalScore += 15;
        }
        if (flag === 'LOW_LIQUIDITY' || flag === 'SMALL_POOL') {
          findings.push({
            category: 'LIQUIDITY',
            finding: 'Very low liquidity - high manipulation risk',
            severity: 'HIGH',
            evidence: `Flag: ${flag}`
          });
          totalScore += 10;
        }
      }

      // Step 6: Check liquidity from Yellowstone data
      const liquiditySol = request.yellowstoneData?.liquiditySol || 0;
      if (liquiditySol < 5) {
        findings.push({
          category: 'LIQUIDITY',
          finding: `Only ${liquiditySol.toFixed(2)} SOL liquidity - high rug risk`,
          severity: liquiditySol < 1 ? 'CRITICAL' : 'HIGH',
          evidence: 'Insufficient liquidity for safe trading'
        });
        totalScore += liquiditySol < 1 ? 15 : 8;
      }

      // Step 6: Check similar tokens
      if (request.similarTokens && request.similarTokens.length > 0) {
        await this.think('reasoning', 'Checking pattern matches from memory...');

        for (const similar of request.similarTokens) {
          const pastReport = this.completedInvestigations.get(similar.token);
          if (pastReport && pastReport.verdict === 'SCAM') {
            findings.push({
              category: 'PATTERN_MATCH',
              finding: `${(similar.similarity * 100).toFixed(0)}% similar to known scam ${similar.token.slice(0, 8)}...`,
              severity: 'HIGH',
              evidence: `Past verdict: ${pastReport.verdict}`
            });
            totalScore += 15;
          }
        }
      }

      // Cap score at 100
      totalScore = Math.min(100, totalScore);

      // Build analysis objects from features for report generation
      const bundleAnalysis = {
        detected: bundleDetected,
        count: bundleDetected ? Math.round(features[17] * 20) : 0,
        controlPercent: bundleControl,
        wallets: [] as string[],
        confidence: features[19],
        assessment: bundleDetected
          ? `Coordination detected: ~${Math.round(features[17] * 20)} wallets control ${bundleControl.toFixed(1)}%`
          : 'No coordination pattern detected',
      };
      const holderAnalysis = {
        whaleConcentration: top10Concentration,
        topWhalePercent,
        gini,
        freshWalletRatio: features[8] * 100,
        holderCount: Math.round(Math.pow(10, features[5] * 4)), // Denormalize from log
        totalHolders: Math.round(Math.pow(10, features[5] * 4)),
      };

      // Generate report (pass all gathered data for LLM context)
      const report = await this.generateReport({
        token: request.token,
        score: totalScore,
        findings,
        bundleAnalysis,
        tokenData,
        holderAnalysis,
        creatorHistory,
      });

      // Store report
      this.completedInvestigations.set(request.token, report);

      // Store in memory
      await this.memory.store({
        token: request.token,
        report,
        features: request.features
      }, { type: 'outcome', tags: ['investigation', report.verdict] });

      // Send recommendations
      await this.recommendAction({ report });

      // Use Yellowstone data if available (ZERO RPC), otherwise fetch from on-chain pools
      let marketData: DiscoveryResult['market'];

      if (request.yellowstoneData?.liquiditySol !== undefined) {
        // Use Yellowstone data - NO RPC calls needed!
        const liquiditySol = request.yellowstoneData.liquiditySol;
        const SOL_PRICE = 150; // Approximate SOL price in USD
        const liquidityUsd = liquiditySol * SOL_PRICE;

        await this.think('reasoning', `Using Yellowstone data: ${liquiditySol.toFixed(2)} SOL liquidity [${request.yellowstoneData.dex}]`);

        marketData = {
          price: null, // Price requires more complex calculation
          marketCap: liquidityUsd * 2, // Rough estimate: mcap ~= 2x liquidity for new tokens
          liquidity: liquidityUsd,
          volume24h: null,
          priceChange24h: null,
          buys24h: 0,
          sells24h: 0,
          pairAddress: request.yellowstoneData.poolAddress || null,
          dexId: request.yellowstoneData.dex || null,
          url: null,
        };
      } else {
        // Fallback: Fetch market data from on-chain pools (makes RPC calls)
        await this.think('reasoning', 'Fetching market data from on-chain pools...');
        const onChainMarket = await this.marketDataService.getMarketData(request.token, tokenData.supply || 0);

        marketData = {
          price: onChainMarket.price ? String(onChainMarket.price) : null,
          marketCap: onChainMarket.marketCap,
          liquidity: onChainMarket.liquidity,
          volume24h: onChainMarket.volume24h,
          priceChange24h: onChainMarket.priceChange24h,
          buys24h: onChainMarket.buys24h,
          sells24h: onChainMarket.sells24h,
          pairAddress: onChainMarket.pairAddress,
          dexId: onChainMarket.dexId,
          url: null,
        };
      }

      const bundleWalletSet = new Set(bundleAnalysis?.wallets || []);
      const discovery: DiscoveryResult = {
        id: `disc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        token: request.token,
        timestamp: Date.now(),
        market: marketData,
        tokenInfo: {
          name: marketData.price ? (tokenData.name || null) : tokenData.name || null,
          symbol: tokenData.symbol !== '???' ? tokenData.symbol : null,
          decimals: tokenData.decimals || 9,
          supply: tokenData.supply || 0,
          creator: tokenData.creator !== 'unknown' ? tokenData.creator : null,
          mintAuthority: !!tokenData.mintAuthority,
          freezeAuthority: !!tokenData.freezeAuthority,
        },
        analysis: {
          verdict: report.verdict,
          confidence: report.confidence,
          score: report.score,
          summary: report.summary,
          reasoning: report.summary, // LLM reasoning is in the summary for rule-based fallback
          attackVector: null,
          recommendations: [report.recommendation],
          findings: report.findings,
        },
        holders: {
          total: holderAnalysis.totalHolders,
          top10Concentration: holderAnalysis.whaleConcentration,
          giniCoefficient: holderAnalysis.gini,
          topHolders: (tokenData.holders || []).slice(0, 10).map((h: any) => ({
            address: h.address,
            percent: h.percent,
            isLP: h.isLP || false,
            isBundle: bundleWalletSet.has(h.address),
          })),
        },
        bundles: {
          detected: bundleAnalysis.detected,
          count: bundleAnalysis.count,
          controlPercent: bundleAnalysis.controlPercent,
          wallets: bundleAnalysis.wallets,
          assessment: bundleAnalysis.assessment,
        },
        lp: {
          locked: tokenData.lpLocked || false,
          burned: tokenData.lpBurned || false,
          amount: tokenData.liquidity || null,
        },
      };

      // Publish discovery to MessageBus for WorkersSync to pick up
      await this.messageBus.publish('discovery.new', discovery, {
        from: this.config.name,
        priority: 'high',
      });

      await this.think(
        'observation',
        `Investigation complete: ${request.token.slice(0, 8)}... verdict=${report.verdict} score=${report.score}`
      );

      console.log(`[${this.config.name}] Discovery published: $${tokenData.symbol} (${report.verdict}, score=${report.score})`);

      // Generate AI dialogue for activity feed
      let dialogue: string | null = null;
      if (this.llm) {
        const targetAgent = report.score >= 60 ? 'hunter' : 'scout';
        dialogue = await this.llm.generateDialogue({
          agent: 'analyst',
          event: 'investigation_complete',
          targetAgent,
          data: {
            token: request.token.slice(0, 8),
            symbol: tokenData.symbol,
            verdict: report.verdict,
            score: report.score,
            criticalFindings: report.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
          },
        });
      }

      // Publish investigation_complete for WorkersSync activity feed
      await this.messageBus.publish(`agent.${this.config.name}.investigation_complete`, {
        token: request.token,
        symbol: tokenData.symbol,
        verdict: report.verdict,
        score: report.score,
        findings: report.findings,
        dialogue: dialogue || `Investigation complete: ${tokenData.symbol} — ${report.verdict} (${report.score}/100)`,
      }, { from: this.config.name, priority: 'normal' });

      // If high risk, notify Hunter and emit alert for dashboard
      const creator = tokenData.creator !== 'unknown' ? tokenData.creator : null;
      if (report.score >= 60 && creator) {
        // Generate alert dialogue
        let alertDialogue: string | null = null;
        if (this.llm) {
          alertDialogue = await this.llm.generateDialogue({
            agent: 'analyst',
            event: 'high_risk_alert',
            targetAgent: 'hunter',
            data: {
              token: request.token.slice(0, 8),
              symbol: tokenData.symbol,
              score: report.score,
              creator: creator.slice(0, 8),
              verdict: report.verdict,
            },
          });
        }

        await this.messageBus.publish('alert.high_risk_token', {
          token: request.token,
          symbol: tokenData.symbol,
          score: report.score,
          creator,
          verdict: report.verdict,
          dialogue: alertDialogue || `HIGH RISK: ${tokenData.symbol} (${report.score}/100) — flagging for Hunter`,
        }, { from: this.config.name, priority: 'high' });
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.think('reflection', `Investigation failed: ${errorMsg}`);
    }

    this.isInvestigating = false;
  }

  // DexScreener removed — market data now comes from on-chain via MarketDataService

  /**
   * Get full token data using real on-chain queries
   */
  private async getFullTokenData(params: { token: string }): Promise<any> {
    const { token } = params;

    try {
      // Fetch token metadata
      const tokenData = await this.onChainTools.getTokenData(token);

      // Fetch holders
      const holders = await this.onChainTools.getHolders(token, 50);

      // Get token creator
      const creator = await this.onChainTools.getTokenCreator(token);

      // Get LP pool info
      const lpPool = await this.onChainTools.getLPPool(token);

      // Calculate age in hours
      const ageHours = tokenData?.createdAt
        ? (Date.now() - tokenData.createdAt) / (1000 * 60 * 60)
        : 0;

      return {
        token,
        name: tokenData?.name || 'Unknown',
        symbol: tokenData?.symbol || '???',
        supply: tokenData?.supply || 0,
        decimals: tokenData?.decimals || 9,
        mintAuthority: tokenData?.mintAuthority,
        freezeAuthority: tokenData?.freezeAuthority,
        holders: holders.map(h => ({
          address: h.address,
          percent: h.percent,
          isLP: h.isLP
        })),
        creator: creator || tokenData?.creator || 'unknown',
        liquidity: lpPool?.liquidity || 0,
        lpLocked: lpPool?.lpLocked || false,
        lpBurned: lpPool?.lpBurned || false,
        age: ageHours
      };
    } catch (error) {
      console.error('[AnalystAgent] Error fetching token data:', error);
      // Return minimal data on error
      return {
        token,
        name: 'Unknown',
        symbol: '???',
        supply: 0,
        holders: [],
        creator: 'unknown',
        liquidity: 0,
        age: 0
      };
    }
  }

  /**
   * Analyze bundle/coordination patterns using real holder data
   */
  private async analyzeBundles(params: { token: string; holders: any[] }): Promise<{
    detected: boolean;
    count: number;
    controlPercent: number;
    wallets: string[];
    assessment: string;
  }> {
    const { holders } = params;

    // Filter out LP and known program accounts
    const suspiciousHolders = holders.filter(h => !h.isLP && h.percent > 0.5);

    // Group by similar percentages (potential coordinated buyers)
    const percentGroups: Map<number, string[]> = new Map();
    for (const holder of suspiciousHolders) {
      // Round to nearest 0.1%
      const roundedPercent = Math.round(holder.percent * 10) / 10;
      if (!percentGroups.has(roundedPercent)) {
        percentGroups.set(roundedPercent, []);
      }
      percentGroups.get(roundedPercent)!.push(holder.address);
    }

    // Find groups with 3+ wallets at same percentage (likely bundle)
    const bundleWallets: string[] = [];
    for (const [, wallets] of percentGroups) {
      if (wallets.length >= 3) {
        bundleWallets.push(...wallets);
      }
    }

    const detected = bundleWallets.length >= 3;
    const count = bundleWallets.length;
    const controlPercent = detected
      ? suspiciousHolders
          .filter(h => bundleWallets.includes(h.address))
          .reduce((sum, h) => sum + h.percent, 0)
      : 0;

    let assessment = 'LIKELY_LEGIT';
    if (detected) {
      if (controlPercent > 30) {
        assessment = 'VERY_SUSPICIOUS';
      } else if (controlPercent > 15) {
        assessment = 'SUSPICIOUS';
      } else {
        assessment = 'MINOR_COORDINATION';
      }
    }

    return {
      detected,
      count,
      controlPercent,
      wallets: bundleWallets.slice(0, 10), // Limit to top 10
      assessment
    };
  }

  /**
   * Analyze holder distribution
   */
  private async analyzeHolders(params: { token: string; holders: any[] }): Promise<{
    totalHolders: number;
    whaleConcentration: number;
    topWhalePercent: number;
    gini: number;
  }> {
    const holders = params.holders;
    const totalHolders = holders.length;
    const topWhalePercent = holders[0]?.percent || 0;
    const top10Percent = holders.slice(0, 10).reduce((sum, h) => sum + h.percent, 0);
    const gini = this.calculateGini(holders.map(h => h.percent));

    return {
      totalHolders,
      whaleConcentration: top10Percent,
      topWhalePercent,
      gini
    };
  }

  /**
   * Check creator wallet history using real on-chain data
   * Estimates rug count from wallet age + token creation patterns
   */
  private async checkCreatorHistory(params: { creator: string }): Promise<{
    walletAge: number;
    tokensCreated: number;
    rugCount: number;
    ruggedTokens: string[];
    isKnownScammer: boolean;
  }> {
    const { creator } = params;

    try {
      // 1. Check database for past tokens by this creator (real data)
      let dbTokensCreated = 0;
      let dbRugCount = 0;
      let dbRuggedTokens: string[] = [];

      if (this.database?.isReady()) {
        const pastTokens = await this.database.findTokensByCreator(creator);
        dbTokensCreated = pastTokens.length;

        // Count tokens scored >= 70 as "high risk" (proxy for rug)
        for (const t of pastTokens) {
          if (t.score >= 70) {
            dbRugCount++;
            dbRuggedTokens.push(t.token_address);
          }
        }

        // Check scammer profiles table
        const scammerProfile = await this.database.getScammerProfile(creator);
        if (scammerProfile) {
          return {
            walletAge: 0, // Will be filled by wallet profile below
            tokensCreated: Math.max(dbTokensCreated, scammerProfile.tokens.length),
            rugCount: Math.max(dbRugCount, scammerProfile.rugged_tokens.length),
            ruggedTokens: [...new Set([...dbRuggedTokens, ...scammerProfile.rugged_tokens])],
            isKnownScammer: true,
          };
        }
      }

      // 2. Profile the wallet on-chain for age info
      const profile = await this.onChainTools.profileWallet(creator);
      const walletAge = profile?.age || 0;

      // If we had DB data, use it
      if (dbTokensCreated > 0) {
        return {
          walletAge,
          tokensCreated: dbTokensCreated,
          rugCount: dbRugCount,
          ruggedTokens: dbRuggedTokens,
          isKnownScammer: false,
        };
      }

      // 3. Fallback: wallet profiling heuristic (no DB data yet)
      // Only use wallet age as a risk signal, don't fabricate rug counts
      return {
        walletAge,
        tokensCreated: 0, // Unknown — honest about what we don't know
        rugCount: 0,
        ruggedTokens: [],
        isKnownScammer: false,
      };
    } catch (error) {
      console.error('[AnalystAgent] Error checking creator history:', error);
      return { walletAge: 0, tokensCreated: 0, rugCount: 0, ruggedTokens: [], isKnownScammer: false };
    }
  }

  /**
   * Generate investigation report — uses LLM for real AI reasoning when available
   */
  private async generateReport(params: {
    token: string;
    score: number;
    findings: InvestigationReport['findings'];
    bundleAnalysis: any;
    tokenData?: any;
    holderAnalysis?: any;
    creatorHistory?: any;
  }): Promise<InvestigationReport> {
    const { token, score, findings, bundleAnalysis, tokenData, holderAnalysis, creatorHistory } = params;

    // Try LLM-powered analysis first
    if (this.llm) {
      try {
        const ageHours = tokenData?.age || 0;
        const context: TokenAnalysisContext = {
          tokenAddress: token,
          score,
          riskLevel: score >= 80 ? 'SCAM' : score >= 60 ? 'DANGEROUS' : score >= 40 ? 'SUSPICIOUS' : 'SAFE',
          findings: findings.map(f => ({
            category: f.category,
            finding: f.finding,
            severity: f.severity,
            evidence: f.evidence,
          })),
          security: {
            mintDisabled: !tokenData?.mintAuthority,
            freezeDisabled: !tokenData?.freezeAuthority,
            lpLocked: tokenData?.lpLocked || false,
            lpBurned: tokenData?.lpBurned || false,
          },
          holders: {
            count: holderAnalysis?.totalHolders || 0,
            top10Concentration: (holderAnalysis?.whaleConcentration || 0) / 100,
            topWhalePercent: (holderAnalysis?.topWhalePercent || 0) / 100,
            gini: holderAnalysis?.gini || 0,
          },
          bundle: {
            detected: bundleAnalysis?.detected || false,
            count: bundleAnalysis?.count || 0,
            controlPercent: (bundleAnalysis?.controlPercent || 0) / 100,
            confidence: bundleAnalysis?.detected ? 0.8 : 0,
          },
          trading: {
            buyRatio24h: 0.5,
            buyRatio1h: 0.5,
            volume: 0,
            liquidity: tokenData?.liquidity || 0,
          },
          creator: {
            identified: creatorHistory?.walletAge > 0 || false,
            rugHistory: creatorHistory?.rugCount || 0,
            holdings: 0,
            isKnownScammer: creatorHistory?.isKnownScammer || false,
          },
          tokenAge: ageHours > 24 ? `${Math.floor(ageHours / 24)}d` : `${Math.floor(ageHours)}h`,
        };

        const llmVerdict = await this.llm.analyzeToken(context);

        if (llmVerdict) {
          console.log(`[${this.config.name}] LLM verdict: ${llmVerdict.verdict} (confidence: ${llmVerdict.confidence.toFixed(2)}) — "${llmVerdict.reasoning.slice(0, 100)}..."`);

          return {
            token,
            verdict: llmVerdict.verdict,
            confidence: Math.round(llmVerdict.confidence * 100),
            score,
            summary: llmVerdict.summary,
            findings,
            bundleAnalysis,
            recommendation: llmVerdict.recommendations.join('. ') || 'No specific recommendations.',
            timestamp: Date.now(),
          };
        }
      } catch (err) {
        console.warn(`[${this.config.name}] LLM analysis failed, falling back to rules:`, err instanceof Error ? err.message : err);
      }
    }

    // Fallback: rule-based verdict (existing logic)
    let verdict: InvestigationReport['verdict'] = 'SAFE';
    if (score >= 80) verdict = 'SCAM';
    else if (score >= 60) verdict = 'DANGEROUS';
    else if (score >= 40) verdict = 'SUSPICIOUS';

    const criticalFindings = findings.filter(f => f.severity === 'CRITICAL');
    const summary = criticalFindings.length > 0
      ? `CRITICAL: ${criticalFindings.map(f => f.finding).join('. ')}`
      : findings.length > 0
        ? `${findings.length} risk indicators found. ${findings[0].finding}`
        : 'No significant risk indicators found.';

    let recommendation = 'No action needed.';
    if (verdict === 'SCAM') {
      recommendation = 'AVOID. High probability of rug pull. Do not invest.';
    } else if (verdict === 'DANGEROUS') {
      recommendation = 'HIGH RISK. Only invest small amounts you can afford to lose.';
    } else if (verdict === 'SUSPICIOUS') {
      recommendation = 'CAUTION. Monitor closely. Set tight stop losses.';
    }

    return {
      token,
      verdict,
      confidence: Math.min(95, 60 + findings.length * 5),
      score,
      summary,
      findings,
      bundleAnalysis,
      recommendation,
      timestamp: Date.now()
    };
  }

  /**
   * Recommend action based on findings
   */
  private async recommendAction(params: { report: InvestigationReport }): Promise<void> {
    const { report } = params;

    // Notify coordinator
    await this.sendMessage('coordinator', 'investigation_complete', {
      token: report.token,
      verdict: report.verdict,
      score: report.score,
      findings: report.findings,
      recommendation: report.recommendation
    });

    // If scam detected, alert hunters
    if (report.verdict === 'SCAM' || report.verdict === 'DANGEROUS') {
      await this.sendMessage('hunter', 'track_scammer', {
        token: report.token,
        report
      });

      // Broadcast alert
      await this.broadcastAlert('scam_detected', {
        token: report.token,
        verdict: report.verdict,
        score: report.score,
        summary: report.summary
      });
    }

    // If potentially good opportunity, notify traders
    if (report.verdict === 'SAFE' && report.score < 30) {
      await this.sendMessage('trader', 'opportunity', {
        token: report.token,
        analysis: report
      });
    }
  }

  /**
   * Calculate Gini coefficient
   */
  private calculateGini(values: number[]): number {
    if (values.length <= 1) return 0;

    const sorted = values.sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / n;

    if (mean === 0) return 0;

    let sumIX = 0;
    for (let i = 0; i < n; i++) {
      sumIX += (i + 1) * sorted[i];
    }

    const gini = (2 * sumIX) / (n * mean * n) - (n + 1) / n;
    return Math.min(1, Math.max(0, gini));
  }

  /**
   * Build token data from Scout's feature vector (RPC-FREE)
   * Reconstructs token info from the 29-dimensional feature vector
   */
  private buildTokenDataFromFeatures(
    token: string,
    features: Float32Array,
    yellowstoneData?: InvestigationRequest['yellowstoneData'],
    flags?: string[]
  ): {
    address: string;
    symbol: string;
    name: string;
    creator: string;
    holders: Array<{ address: string; percent: number }>;
    mintAuthority: boolean;
    freezeAuthority: boolean;
    lpLocked: boolean;
    lpBurned: boolean;
    supply: number;
    decimals: number;
    liquidity: number;
  } {
    // Extract creator from Yellowstone data or mark as unknown
    const creator = yellowstoneData?.poolAddress
      ? yellowstoneData.poolAddress.slice(0, 8) + '...' // Pool address as proxy
      : 'unknown';

    // Reconstruct holder distribution from features
    const top10Concentration = features[6] * 100;

    // Generate synthetic holders based on feature distribution
    const holders: Array<{ address: string; percent: number }> = [];
    const topWhalePercent = features[10] * 100;
    if (topWhalePercent > 0) {
      holders.push({ address: 'whale_1', percent: topWhalePercent });
    }
    const remaining = top10Concentration - topWhalePercent;
    for (let i = 1; i < 10 && remaining > 0; i++) {
      holders.push({ address: `holder_${i}`, percent: remaining / 9 });
    }

    // LP info from features
    const lpLocked = features[13] > 0.5;
    const lpBurned = features[14] > 0.5;

    // Liquidity from Yellowstone or features
    const liquiditySol = yellowstoneData?.liquiditySol || 0;
    const liquidityUsd = liquiditySol * 150; // Approximate SOL price

    return {
      address: token,
      symbol: yellowstoneData?.dex || 'UNKNOWN',
      name: yellowstoneData?.dex || 'Unknown Token',
      creator,
      holders,
      mintAuthority: flags?.includes('MINT_ACTIVE') ?? false,
      freezeAuthority: flags?.includes('FREEZE_ACTIVE') ?? false,
      lpLocked,
      lpBurned,
      supply: 1_000_000_000, // Default 1B supply
      decimals: 6, // Most SPL tokens use 6 decimals
      liquidity: liquidityUsd,
    };
  }

  /**
   * Check creator against local scammer database (RPC-FREE)
   * Uses in-memory database and Hunter's scammer profiles
   */
  private async checkLocalScammerDB(creator: string): Promise<{
    isKnown: boolean;
    rugCount: number;
    pattern: string;
    ruggedTokens: string[];
  }> {
    // Check in-memory scammer database (synced from HunterAgent)
    const profile = this.scammerDB.get(creator);
    if (profile) {
      return {
        isKnown: true,
        rugCount: profile.rugCount,
        pattern: profile.pattern,
        ruggedTokens: profile.ruggedTokens,
      };
    }

    // Check if Hunter has flagged this creator via MessageBus
    // Listen for hunter broadcasts about this wallet
    // (In future: query shared PostgreSQL database)

    return {
      isKnown: false,
      rugCount: 0,
      pattern: 'UNKNOWN',
      ruggedTokens: [],
    };
  }

  /**
   * Update local scammer database from Hunter broadcasts
   */
  updateScammerDB(wallet: string, profile: { rugCount: number; pattern: string; ruggedTokens: string[] }): void {
    this.scammerDB.set(wallet, profile);
  }

  /**
   * Generate simulated holders (for testing)
   */
  private generateSimulatedHolders(): Array<{ address: string; percent: number }> {
    const holders: Array<{ address: string; percent: number }> = [];
    let remaining = 100;

    for (let i = 0; i < 50 && remaining > 0; i++) {
      const percent = Math.min(remaining, Math.random() * (remaining / 2));
      holders.push({
        address: `holder${i}`,
        percent
      });
      remaining -= percent;
    }

    return holders.sort((a, b) => b.percent - a.percent);
  }

  protected getConstraints(): Record<string, any> {
    return {
      maxConcurrentInvestigations: 1,
      maxQueueSize: 50,
      investigationTimeout: 60000
    };
  }

  protected setupMessageHandlers(): void {
    // Handler for investigation requests
    const handleInvestigateRequest = async (msg: import('../core/MessageBus').Message) => {
      const request = msg.data as InvestigationRequest;

      // Deduplicate: skip if already in queue or completed
      if (this.investigationQueue.some(r => r.token === request.token) ||
          this.completedInvestigations.has(request.token)) {
        return;
      }

      // Add to queue
      this.investigationQueue.push(request);

      await this.think(
        'observation',
        `Queued investigation for ${request.token.slice(0, 8)}... (queue size: ${this.investigationQueue.length})`
      );
    };

    // Subscribe to both specific name (analyst-1) and type-based (analyst) topics
    this.messageBus.subscribe(`agent.${this.config.name}.investigate`, handleInvestigateRequest);
    const agentType = this.config.name.replace(/-\d+$/, '');
    if (agentType !== this.config.name) {
      this.messageBus.subscribe(`agent.${agentType}.investigate`, handleInvestigateRequest);
    }

    // Handle direct queries
    this.messageBus.subscribe(`agent.${this.config.name}.query`, async (msg) => {
      const { token } = msg.data;
      const report = this.completedInvestigations.get(token);

      await this.messageBus.publish(`agent.${this.config.name}.query.response`, {
        token,
        report: report || null
      }, { from: this.config.name });
    });
  }

  /**
   * Get analyst statistics
   */
  getStats(): {
    queueSize: number;
    completedCount: number;
    isInvestigating: boolean;
  } {
    return {
      queueSize: this.investigationQueue.length,
      completedCount: this.completedInvestigations.size,
      isInvestigating: this.isInvestigating
    };
  }

  // ============================================
  // ON-CHAIN CLASSIFICATION METHODS
  // These use ONLY RPC data, no external APIs
  // ============================================

  /**
   * Classify all holders using pure on-chain data
   * This is the REAL classification - no guessing, no external APIs
   */
  private async classifyHoldersOnChain(params: {
    token: string;
    bundleWallets?: string[];
  }): Promise<HolderClassificationResult> {
    await this.think('reasoning', `Classifying holders on-chain for ${params.token.slice(0, 8)}...`);

    const bundleSet = new Set(params.bundleWallets || []);

    try {
      const result = await this.onChainTools.classifyAllHolders(
        params.token,
        bundleSet,
        50 // Top 50 holders
      );

      await this.think('observation',
        `Classified ${result.totalClassified}/${result.holders.length} holders. ` +
        `Creator: ${result.creator?.slice(0, 8) || 'unknown'}... ` +
        `LP accounts: ${result.lpAccounts.length}, DEX: ${result.dexAccounts.length}`
      );

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.think('reflection', `On-chain classification failed: ${errorMsg}`);

      // Return empty result on error
      return {
        holders: [],
        creator: null,
        lpAccounts: [],
        dexAccounts: [],
        burnAccounts: [],
        totalClassified: 0
      };
    }
  }

  /**
   * Get the token creator from on-chain data
   */
  private async getTokenCreator(params: { token: string }): Promise<{
    creator: string | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    source: string;
  }> {
    await this.think('reasoning', `Finding creator for ${params.token.slice(0, 8)}...`);

    try {
      const creator = await this.onChainTools.getTokenCreator(params.token);

      if (creator) {
        await this.think('observation', `Found creator: ${creator.slice(0, 8)}... (from mint tx)`);
        return {
          creator,
          confidence: 'HIGH',
          source: 'mint_transaction_signer'
        };
      }

      // Fallback: check mint authority
      const tokenData = await this.onChainTools.getTokenData(params.token);
      if (tokenData?.mintAuthority) {
        await this.think('observation', `Found mint authority: ${tokenData.mintAuthority.slice(0, 8)}...`);
        return {
          creator: tokenData.mintAuthority,
          confidence: 'MEDIUM',
          source: 'mint_authority'
        };
      }

      await this.think('reflection', 'Could not determine token creator');
      return {
        creator: null,
        confidence: 'LOW',
        source: 'not_found'
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.think('reflection', `Creator lookup failed: ${errorMsg}`);
      return {
        creator: null,
        confidence: 'LOW',
        source: 'error'
      };
    }
  }

  /**
   * Get classified holder data formatted for dashboard display
   */
  async getClassifiedHoldersForDashboard(tokenAddress: string, bundleWallets: string[] = []): Promise<{
    holders: Array<{
      address: string;
      percent: number;
      tags: string[];
      label?: string;
    }>;
    creator: string | null;
    summary: {
      totalHolders: number;
      lpCount: number;
      devCount: number;
      bundleCount: number;
      burnCount: number;
    };
  }> {
    const result = await this.classifyHoldersOnChain({
      token: tokenAddress,
      bundleWallets
    });

    return {
      holders: result.holders.map(h => ({
        address: h.address,
        percent: h.percent,
        tags: h.tags,
        label: h.label
      })),
      creator: result.creator,
      summary: {
        totalHolders: result.holders.length,
        lpCount: result.lpAccounts.length,
        devCount: result.holders.filter(h => h.tags.includes('DEV')).length,
        bundleCount: result.holders.filter(h => h.tags.includes('BUNDLE')).length,
        burnCount: result.burnAccounts.length
      }
    };
  }
}
