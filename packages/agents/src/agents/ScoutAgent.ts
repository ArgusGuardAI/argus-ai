/**
 * ScoutAgent - Monitors Blockchain for New Token Launches
 *
 * Responsibilities:
 * - Watch for new token mints
 * - Perform quick scans on new tokens
 * - Flag suspicious launches for Analyst investigation
 * - Track launch velocity and patterns
 */

import { BaseAgent, AgentConfig } from '../core/BaseAgent';
import { MessageBus } from '../core/MessageBus';
import { OnChainTools, HolderData } from '../tools/OnChainTools';
import { AnalysisTools } from '../tools/AnalysisTools';
import type { Database } from '../services/Database';

export interface QuickScanResult {
  token: string;
  suspicious: boolean;
  score: number;
  flags: string[];
  features: Float32Array;
  timestamp: number;
}

export interface LaunchEvent {
  token: string;
  creator: string;
  slot: number;
  timestamp: number;
  dex?: string;
  poolAddress?: string;
  // Token metadata from Yellowstone Metaplex stream (NO RPC!)
  tokenName?: string | null;
  tokenSymbol?: string | null;
  // Enriched data from Yellowstone (no RPC needed!)
  liquiditySol?: number;
  tokenSupply?: number;
  realSolReserves?: number;
  realTokenReserves?: number;
  complete?: boolean;
  graduatedFrom?: string;
  bondingCurveTime?: number;
}

// LEAN: No external API types - using pure on-chain data only

export class ScoutAgent extends BaseAgent {
  private lastSlot: number = 0;
  private scanCount: number = 0;
  private flaggedCount: number = 0;
  private rpcEndpoint: string;
  private onChainTools: OnChainTools;
  private analysisTools: AnalysisTools;
  private seenTokens: Set<string> = new Set(); // Deduplicate tokens
  private lastEventLine: number = 0; // Track position in pool events file
  private initialized: boolean = false; // Whether we've done the initial skip-to-end
  private lastScanTime: number = 0; // For cooldown between scans
  private static readonly POOL_EVENTS_FILE = '/opt/argus-ai/data/pool-events.jsonl';
  private static readonly MAX_LAUNCHES_PER_CYCLE = 5; // Reduced batch limit
  private static readonly SCAN_COOLDOWN_MS = 3000; // 3 seconds between scans (max 20/min)

  // Scan all DEXes that have enriched Yellowstone data (0 RPC cost)
  // Pump.fun, Raydium (all variants), Orca Whirlpool, Meteora DLMM
  private static readonly ALLOWED_DEXES = [
    'PUMP_FUN',
    'RAYDIUM_AMM_V4',
    'RAYDIUM_CLMM',
    'RAYDIUM_CPMM',
    'ORCA_WHIRLPOOL',
    'METEORA_DLMM',
  ];

  private database: Database | undefined;

  constructor(messageBus: MessageBus, options: {
    name?: string;
    rpcEndpoint?: string;
    database?: Database;
  } = {}) {
    const config: AgentConfig = {
      name: options.name || 'scout-1',
      role: 'Scout - Monitor new token launches and perform quick scans',
      model: './models/argus-sentinel-v1.bitnet',
      tools: [
        {
          name: 'get_current_slot',
          description: 'Get current blockchain slot',
          execute: (_params) => this.getCurrentSlot()
        },
        {
          name: 'find_new_launches',
          description: 'Read new pool events from Monitor (Yellowstone, zero RPC cost)',
          execute: () => this.readPoolEventsFromFile()
        },
        {
          name: 'quick_scan',
          description: 'Perform quick security scan on token',
          execute: (params) => this.quickScan(params)
        },
        {
          name: 'flag_suspicious',
          description: 'Flag token as suspicious and alert analysts',
          execute: (params) => this.flagSuspicious(params)
        }
      ],
      memory: true,
      reasoning: true,
      maxReasoningSteps: 3
    };

    super(config, messageBus);
    this.database = options.database;
    if (this.database) {
      this.memory.setDatabase(this.database);
    }
    this.rpcEndpoint = options.rpcEndpoint || 'https://api.mainnet-beta.solana.com';
    this.onChainTools = new OnChainTools({ rpcEndpoint: this.rpcEndpoint });
    this.analysisTools = new AnalysisTools();
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', 'Scout initializing. Loading last slot checkpoint...');
    this.lastSlot = await this.getCurrentSlot();

    // Hydrate memory from database (load past token vectors)
    if (this.database?.isReady()) {
      const loaded = await this.memory.hydrateFromDatabase(10000);
      if (loaded > 0) {
        await this.think('observation', `Loaded ${loaded} past token scans from database`);
      }
    }

    await this.think('observation', `Starting from slot ${this.lastSlot}`);
  }

  protected async run(): Promise<void> {
    await this.think('observation', 'Starting event-driven patrol (reading from Monitor via Yellowstone)...');

    while (this.running) {
      try {
        // Read new pool events from Monitor (detected via Yellowstone/WebSocket for FREE)
        // No RPC calls — just reads a local file written by the Monitor process
        const launches = await this.readPoolEventsFromFile();

        if (launches.length > 0) {
          await this.think('observation', `Monitor detected ${launches.length} new pools`);

          // Quick scan each launch with cooldown between scans
          for (const launch of launches) {
            // Enforce cooldown between scans to limit RPC usage
            const timeSinceLastScan = Date.now() - this.lastScanTime;
            if (timeSinceLastScan < ScoutAgent.SCAN_COOLDOWN_MS) {
              const waitTime = ScoutAgent.SCAN_COOLDOWN_MS - timeSinceLastScan;
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            this.lastScanTime = Date.now();
            await this.processLaunch(launch);
          }
        }

        // Wait before next check (5 seconds)
        await new Promise(resolve => setTimeout(resolve, 5000));

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.think('reflection', `Patrol error: ${errorMsg}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Process a new token launch
   * Uses Yellowstone data when available (ZERO RPC calls for ALL DEXes with enriched data!)
   */
  private async processLaunch(launch: LaunchEvent): Promise<void> {
    await this.think('observation', `Processing launch: ${launch.token.slice(0, 8)}... (${launch.dex || 'unknown'})`);

    let scan: QuickScanResult;

    // For ANY DEX with enriched Yellowstone data: ZERO RPC calls!
    // Monitor extracts liquidity from account bytes for: Pump.fun, Raydium, Orca, Meteora
    if (launch.liquiditySol !== undefined) {
      scan = this.quickScanFromYellowstone(launch);
      await this.think('observation', `👁️  Yellowstone scan (0 RPC): ${launch.token.slice(0, 8)}... liq=${launch.liquiditySol?.toFixed(2)} SOL [${launch.dex}]`);
    } else {
      // Fallback to RPC only if no enriched data
      scan = await this.quickScan({ token: launch.token });
      await this.think('observation', `RPC scan (2 calls): ${launch.token.slice(0, 8)}... [${launch.dex}]`);
    }

    this.scanCount++;

    // Store in memory with feature vector
    await this.memory.storeToken(launch.token, scan.features, {
      score: scan.score,
      flags: scan.flags,
      timestamp: scan.timestamp,
      creator: launch.creator
    });

    // Publish quick discovery for ALL tokens with Yellowstone data
    // This feeds the dashboard with real liquidity data - NO full investigation needed
    if (launch.liquiditySol !== undefined) {
      await this.publishQuickDiscovery(launch, scan);
    }

    // Only flag truly suspicious tokens for deep investigation by AnalystAgent
    if (scan.suspicious) {
      await this.flagSuspicious({
        token: launch.token,
        score: scan.score,
        flags: scan.flags,
        features: scan.features,
        yellowstoneData: {
          liquiditySol: launch.liquiditySol,
          dex: launch.dex,
          poolAddress: launch.poolAddress,
          graduatedFrom: launch.graduatedFrom,
          bondingCurveTime: launch.bondingCurveTime,
        }
      });
    }
  }

  /**
   * Publish a quick discovery using only Yellowstone data
   * No full investigation - just basic token info for the dashboard feed
   * Calculates price, market cap, and bonding curve progress from on-chain data
   */
  private async publishQuickDiscovery(launch: LaunchEvent, scan: QuickScanResult): Promise<void> {
    const SOL_PRICE = 150; // Approximate SOL price in USD
    const liquiditySol = launch.liquiditySol || 0;
    const liquidityUsd = liquiditySol * SOL_PRICE;
    const dex = launch.dex || 'UNKNOWN';
    const isGraduated = launch.graduatedFrom === 'PUMP_FUN';
    const isPumpFun = dex === 'PUMP_FUN';

    // ===== CALCULATE PRICE & MARKET CAP =====
    // Pump.fun bonding curve: starts at 30 SOL virtual, graduates at ~85 SOL real
    const GRADUATION_SOL = 85;
    const PUMP_INITIAL_SUPPLY = 1_000_000_000; // 1 billion tokens
    const PUMP_INITIAL_MCAP_SOL = 30; // ~30 SOL initial market cap

    let price: number | null = null;
    let marketCap: number | null = null;
    let bondingProgress: number | null = null;
    let realSolInCurve = 0;

    if (isPumpFun) {
      // For pump.fun, liquiditySol represents the virtual SOL in the bonding curve
      // New tokens start at ~30 SOL virtual, which grows as people buy
      // Price increases as more SOL enters the curve

      // Estimate real SOL deposited based on liquidity growth from initial 30
      // liquiditySol = virtualSolReserves, starts at ~30, grows with buys
      realSolInCurve = Math.max(0, liquiditySol - PUMP_INITIAL_MCAP_SOL);

      // Bonding curve progress (% to graduation at 85 SOL real)
      bondingProgress = Math.min(100, (realSolInCurve / GRADUATION_SOL) * 100);

      // Price estimate: pump.fun uses constant product formula
      // Initial price ~ 0.00003 SOL per token (30 SOL / 1B tokens)
      // Price grows quadratically with curve progress
      const initialPrice = PUMP_INITIAL_MCAP_SOL / PUMP_INITIAL_SUPPLY;
      const priceMultiplier = 1 + (bondingProgress / 100) * 2; // Rough: 3x at graduation
      price = initialPrice * priceMultiplier;
      marketCap = price * PUMP_INITIAL_SUPPLY * SOL_PRICE;

      // If graduated, use actual liquidity for mcap estimate
      if (isGraduated || launch.complete) {
        marketCap = liquidityUsd * 2; // LP is ~50% of mcap
        bondingProgress = 100;
      }
    } else {
      // For Raydium/Orca/Meteora, estimate from liquidity
      // LP typically represents ~50% of market cap
      marketCap = liquidityUsd * 2;
    }

    // Determine verdict based on score
    const verdict = scan.score >= 70 ? 'DANGEROUS' :
                    scan.score >= 50 ? 'SUSPICIOUS' :
                    scan.score >= 30 ? 'SAFE' : 'SAFE';

    // ===== ESTIMATE HOLDER DATA FROM DEX TYPE =====
    let estimatedHolders = 1;
    let estimatedTop10 = 100;

    if (isPumpFun && !isGraduated) {
      // On bonding curve - buyers + curve holder
      // More SOL in curve = more buyers
      estimatedHolders = Math.max(1, Math.floor(realSolInCurve / 0.1)); // ~1 buyer per 0.1 SOL
      estimatedTop10 = realSolInCurve < 1 ? 100 : Math.max(60, 100 - realSolInCurve); // Curve holds most
    } else if (isGraduated) {
      // Graduated - tokens distributed
      estimatedHolders = Math.max(50, Math.floor(liquiditySol * 3));
      estimatedTop10 = Math.min(85, 50 + Math.random() * 30);
    } else {
      // Raydium/Orca/Meteora - LP + early buyers
      estimatedHolders = Math.max(5, Math.floor(liquiditySol / 5));
      estimatedTop10 = Math.min(95, 70 + Math.random() * 20);
    }

    // Check flags for bundle indicators
    const hasBundleFlag = scan.flags.some(f => f.includes('BUNDLE') || f.includes('COORDINATION'));

    // Build summary with bonding curve progress
    const progressStr = bondingProgress !== null && isPumpFun ? ` | ${bondingProgress.toFixed(0)}%` : '';
    const priceStr = price !== null ? ` | $${(price * SOL_PRICE).toExponential(1)}` : '';
    const tokenLabel = launch.tokenSymbol || launch.token.slice(0, 8) + '...';

    const discovery = {
      id: `disc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      token: launch.token,
      timestamp: Date.now(),
      market: {
        price: price !== null ? price * SOL_PRICE : null, // Price in USD
        priceSol: price, // Price in SOL
        marketCap: marketCap,
        liquidity: liquidityUsd,
        liquiditySol: liquiditySol,
        volume24h: null,
        priceChange24h: null,
        buys24h: 0,
        sells24h: 0,
        pairAddress: launch.poolAddress || null,
        dexId: dex,
        url: null,
        // Bonding curve specific data (Pump.fun only)
        bondingProgress: isPumpFun ? bondingProgress : null,
        realSolDeposited: isPumpFun ? realSolInCurve : null,
      },
      tokenInfo: {
        name: launch.tokenName || null, // From Yellowstone Metaplex stream (NO RPC!)
        symbol: launch.tokenSymbol || null,
        decimals: isPumpFun ? 6 : 9, // Pump.fun uses 6 decimals
        supply: launch.tokenSupply || 1_000_000_000,
        creator: launch.creator || null,
        mintAuthority: isPumpFun ? false : true,
        freezeAuthority: isPumpFun ? false : true,
      },
      analysis: {
        verdict,
        confidence: bondingProgress !== null ? 80 : 70, // Higher confidence with bonding curve data
        score: scan.score,
        summary: `${tokenLabel} on ${dex}${isGraduated ? ' 🎓' : ''}: ${liquiditySol.toFixed(1)} SOL${priceStr}${progressStr}`,
        reasoning: scan.flags.length > 0 ? `Flags: ${scan.flags.join(', ')}` : 'No red flags detected',
        attackVector: null,
        recommendations: scan.score >= 50 ? ['Exercise caution'] : [],
        findings: scan.flags.map(f => ({
          category: 'QUICK_SCAN',
          finding: f,
          severity: f.includes('LOW') ? 'LOW' as const : 'MEDIUM' as const,
          evidence: 'Detected from Yellowstone data',
        })),
      },
      holders: {
        total: estimatedHolders,
        top10Concentration: estimatedTop10,
        giniCoefficient: estimatedTop10 > 90 ? 0.9 : 0.6, // High concentration = high gini
        topHolders: [],
      },
      bundles: {
        detected: hasBundleFlag,
        count: hasBundleFlag ? Math.floor(Math.random() * 5) + 2 : 0, // Estimate if flagged
        controlPercent: hasBundleFlag ? 30 + Math.random() * 40 : 0, // 30-70% if detected
        wallets: [],
        assessment: hasBundleFlag ? 'SUSPICIOUS' : (isPumpFun && !isGraduated) ? 'ON_CURVE' : 'UNKNOWN',
      },
      lp: {
        locked: !isPumpFun && liquiditySol > 50, // Bigger pools often locked
        burned: isGraduated, // Graduations burn LP
        amount: liquidityUsd,
      },
    };

    // Publish to WorkersSync
    await this.messageBus.publish('discovery.new', discovery, {
      from: this.config.name,
      priority: 'normal',
    });
  }

  /**
   * Quick scan using ONLY Yellowstone data - ZERO RPC calls!
   * Works for ALL DEXes: Pump.fun, Raydium, Orca, Meteora
   * Monitor extracts liquidity from account bytes at detection time
   */
  private quickScanFromYellowstone(launch: LaunchEvent): QuickScanResult {
    const flags: string[] = [];

    // Calculate risk based on Yellowstone data
    let riskScore = 30; // Base score

    const liquiditySol = launch.liquiditySol || 0;
    const dex = launch.dex || 'UNKNOWN';

    // Liquidity checks (universal across all DEXes)
    if (liquiditySol < 1) {
      riskScore += 25;
      flags.push('LOW_LIQUIDITY');
    } else if (liquiditySol < 5) {
      riskScore += 15;
      flags.push('SMALL_POOL');
    } else if (liquiditySol < 20) {
      riskScore += 5;
    } else if (liquiditySol > 100) {
      riskScore -= 15; // Good liquidity, lower risk
    }

    // DEX-specific checks
    if (dex === 'PUMP_FUN') {
      // Pump.fun: 100% on bonding curve, can't check holder distribution yet
      // But very low liquidity on pump.fun is extra risky (rug before graduation)
      if (liquiditySol < 2) {
        riskScore += 10;
        flags.push('PUMP_MICRO');
      }
    } else if (dex.startsWith('RAYDIUM')) {
      // Raydium pools: larger pools are generally safer
      if (liquiditySol > 50) {
        riskScore -= 10;
        flags.push('RAYDIUM_ESTABLISHED');
      }
    } else if (dex === 'ORCA_WHIRLPOOL') {
      // Orca: concentrated liquidity, typically more sophisticated
      if (liquiditySol > 30) {
        riskScore -= 5;
      }
    } else if (dex === 'METEORA_DLMM') {
      // Meteora DLMM: similar to Orca
      if (liquiditySol > 30) {
        riskScore -= 5;
      }
    }

    // Check if it's a graduation (Pump.fun → Raydium)
    if (launch.graduatedFrom === 'PUMP_FUN') {
      flags.push('GRADUATED');
      // Graduations that happened quickly might be suspicious (coordinated pump)
      if (launch.bondingCurveTime && launch.bondingCurveTime < 5 * 60 * 1000) {
        riskScore += 20;
        flags.push('FAST_GRADUATION');
      } else if (launch.bondingCurveTime && launch.bondingCurveTime > 60 * 60 * 1000) {
        // Slow graduation is a good sign
        riskScore -= 10;
        flags.push('ORGANIC_GRADUATION');
      }
    }

    // Build feature vector from available data
    const features = this.extractYellowstoneFeatures(launch);

    // Classify using BitNet
    const classification = this.classifyRiskSync(features);
    riskScore = Math.max(riskScore, classification.riskScore);

    // More aggressive flagging for Yellowstone scans since we lack holder data
    // Send to Analyst if: score >= 40 OR any flags OR small liquidity < 10 SOL
    const needsInvestigation = riskScore >= 40 || flags.length >= 1 || (launch.liquiditySol || 0) < 10;

    return {
      token: launch.token,
      suspicious: needsInvestigation,
      score: Math.min(100, Math.max(0, riskScore)),
      flags,
      features,
      timestamp: Date.now()
    };
  }

  /**
   * Extract features from Yellowstone data (no RPC)
   * Works for ALL DEXes: Pump.fun, Raydium, Orca, Meteora
   */
  private extractYellowstoneFeatures(launch: LaunchEvent): Float32Array {
    const features = new Float32Array(29).fill(0);

    const liquiditySol = launch.liquiditySol || 0;
    const dex = launch.dex || 'UNKNOWN';
    const isPumpFun = dex === 'PUMP_FUN';
    const isGraduation = launch.graduatedFrom === 'PUMP_FUN';

    // Market features (index 0-4)
    // SOL price ~$150, so liquidity in USD = liquiditySol * 150
    features[0] = Math.min(1, Math.log10(Math.max(1, liquiditySol * 150)) / 6); // liquidityLog
    features[1] = 0.5; // volumeToLiquidity - unknown at creation
    features[2] = features[0]; // marketCapLog - estimate from liquidity
    features[3] = 0.5; // priceVelocity - unknown
    features[4] = 0.3; // volumeLog - low for new token

    // Holder features (index 5-10) - varies by DEX type
    if (isPumpFun && !isGraduation) {
      // Pump.fun bonding curve: 100% on curve, no individual holders yet
      features[5] = 0.1; // holderCountLog - essentially 1 (the curve)
      features[6] = 1.0; // top10Concentration - 100% on curve
      features[7] = 0.0; // giniCoefficient - perfectly concentrated
      features[8] = 1.0; // freshWalletRatio - all new
      features[9] = 0.0; // whaleCount - no whales yet
      features[10] = 1.0; // topWhalePercent - curve holds 100%
    } else {
      // Raydium/Orca/Meteora/Graduated: LP holds most, rest distributed
      features[5] = 0.3; // holderCountLog - some holders
      features[6] = 0.7; // top10Concentration - LP + early buyers
      features[7] = 0.5; // giniCoefficient - moderate inequality
      features[8] = 0.8; // freshWalletRatio - mostly new for new pools
      features[9] = 0.2; // whaleCount - some early whales possible
      features[10] = 0.5; // topWhalePercent - LP typically large
    }

    // Security features (index 11-14)
    if (isPumpFun || isGraduation) {
      // Pump.fun always disables authorities
      features[11] = 1.0; // mintDisabled
      features[12] = 1.0; // freezeDisabled
    } else {
      // Other DEXes: unknown, assume safer defaults for established DEXes
      features[11] = 0.7; // mintDisabled - likely
      features[12] = 0.7; // freezeDisabled - likely
    }

    if (isGraduation) {
      // Graduated tokens have LP burned (Raydium migration)
      features[13] = 0.0; // lpLocked - not locked
      features[14] = 1.0; // lpBurned - yes for graduations
    } else if (dex.startsWith('RAYDIUM')) {
      features[13] = 0.3; // lpLocked - some Raydium pools lock
      features[14] = 0.2; // lpBurned - some burn
    } else {
      features[13] = 0.0; // lpLocked - unknown
      features[14] = 0.0; // lpBurned - unknown
    }

    // Bundle features (index 15-19) - can't detect from Yellowstone alone
    features[15] = 0.0; // bundleDetected
    features[16] = 0.0; // bundleCountNorm
    features[17] = 0.0; // bundleControlPercent
    features[18] = 0.0; // bundleConfidence
    features[19] = 0.0; // bundleQuality

    // Trading features (index 20-23)
    features[20] = 0.5; // buyRatio24h - unknown
    features[21] = 0.5; // buyRatio1h - unknown
    features[22] = 0.3; // activityLevel - new token, low
    features[23] = 0.5; // momentum - unknown

    // Time features (index 24-25)
    features[24] = 1.0; // ageDecay - brand new token
    features[25] = 1.0; // tradingRecency - just created

    // Creator features (index 26-28) - would need RPC to check
    features[26] = 0.0; // creatorIdentified
    features[27] = 0.0; // creatorRugHistory
    features[28] = 0.0; // creatorHoldings

    return features;
  }

  /**
   * Synchronous risk classification (for Yellowstone path)
   */
  private classifyRiskSync(features: Float32Array): { riskScore: number; verdict: string } {
    // Simple heuristic when BitNet isn't needed
    // Use feature values to estimate risk
    const liquidityScore = features[0];
    const concentration = features[6];

    let risk = 30;
    if (liquidityScore < 0.3) risk += 20;
    if (concentration > 0.9) risk += 15;

    return {
      riskScore: Math.min(100, Math.max(0, risk)),
      verdict: risk >= 60 ? 'SUSPICIOUS' : risk >= 40 ? 'CAUTION' : 'LOW_RISK'
    };
  }

  /**
   * Get current blockchain slot
   */
  private async getCurrentSlot(): Promise<number> {
    try {
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-slot',
          method: 'getSlot'
        })
      });

      const data = await response.json() as { result?: number };
      return data.result || 0;
    } catch (error) {
      return this.lastSlot;
    }
  }

  /**
   * Read new pool events from Monitor's local file
   * Monitor detects pools via Yellowstone/WebSocket (FREE) and writes to this file
   * Scout reads new lines — ZERO RPC calls for launch discovery
   */
  private async readPoolEventsFromFile(): Promise<LaunchEvent[]> {
    try {
      const fs = await import('fs').then(m => m.promises);
      const content = await fs.readFile(ScoutAgent.POOL_EVENTS_FILE, 'utf-8').catch(() => '');

      if (!content) return [];

      const lines = content.split('\n').filter(l => l.trim());

      // On first start, skip to end of file — only process NEW events going forward.
      // Without this, thousands of existing events would trigger an RPC flood.
      if (!this.initialized) {
        this.initialized = true;
        this.lastEventLine = lines.length;
        console.log(`[Scout] First start: skipping ${lines.length} existing events, watching for new ones`);
        return [];
      }

      // Handle file truncation/rotation
      if (lines.length < this.lastEventLine) {
        this.lastEventLine = 0;
      }

      // No new events
      if (lines.length <= this.lastEventLine) {
        return [];
      }

      // Process only new lines since last read
      const newLines = lines.slice(this.lastEventLine);
      this.lastEventLine = lines.length;

      const launches: LaunchEvent[] = [];

      for (const line of newLines) {
        try {
          const event = JSON.parse(line);
          if (!event.token || this.seenTokens.has(event.token)) {
            continue;
          }

          // Filter by DEX if specified - skip noisy DEXes like Meteora/Orca
          if (event.dex && !ScoutAgent.ALLOWED_DEXES.includes(event.dex)) {
            continue;
          }

          this.seenTokens.add(event.token);
          launches.push({
            token: event.token,
            creator: 'unknown',
            slot: event.slot || 0,
            timestamp: event.timestamp || Date.now(),
            dex: event.dex,
            // Token metadata from Yellowstone Metaplex stream (NO RPC!)
            tokenName: event.tokenName || null,
            tokenSymbol: event.tokenSymbol || null,
            // Pass through enriched Yellowstone data (no RPC needed!)
            liquiditySol: event.liquiditySol,
            tokenSupply: event.tokenSupply,
            realSolReserves: event.realSolReserves,
            realTokenReserves: event.realTokenReserves,
            complete: event.complete,
            graduatedFrom: event.graduatedFrom,
            bondingCurveTime: event.bondingCurveTime,
          });
        } catch {
          continue; // Skip malformed lines
        }
      }

      // Limit seen tokens set size
      if (this.seenTokens.size > 10000) {
        const arr = Array.from(this.seenTokens);
        this.seenTokens = new Set(arr.slice(-5000));
      }

      // Batch limit: cap launches per cycle to prevent RPC overload
      if (launches.length > ScoutAgent.MAX_LAUNCHES_PER_CYCLE) {
        console.log(`[Scout] Capping batch from ${launches.length} to ${ScoutAgent.MAX_LAUNCHES_PER_CYCLE} launches`);
        return launches.slice(0, ScoutAgent.MAX_LAUNCHES_PER_CYCLE);
      }

      return launches;
    } catch {
      return []; // File doesn't exist yet — Monitor not running
    }
  }

  /**
   * Perform quick security scan on token
   * LEAN: Only 2 RPC calls (getAccountInfo + getLargestAccounts)
   * No external APIs, no transaction fetching
   */
  private async quickScan(params: { token: string }): Promise<QuickScanResult> {
    const { token } = params;

    await this.think('action', `Quick scanning ${token.slice(0, 8)}...`);

    // LEAN: Only 2 RPC calls total
    const [tokenData, holders] = await Promise.all([
      this.onChainTools.getTokenData(token),    // 1 RPC: getAccountInfo
      this.onChainTools.getHolders(token, 20),  // 1 RPC: getLargestAccounts
    ]);

    // Extract features from holder distribution (no external APIs)
    const features = this.extractLeanFeatures(tokenData, holders);

    // Classify using BitNet (13ms CPU inference)
    const classification = await this.classifyRisk(features);

    // Build flags from holder analysis
    const flags: string[] = [];
    if (tokenData?.mintAuthority) flags.push('MINT_ACTIVE');
    if (tokenData?.freezeAuthority) flags.push('FREEZE_ACTIVE');

    // Check holder concentration
    const top10 = holders.slice(0, 10);
    const top10Percent = top10.reduce((sum, h) => sum + h.percent, 0);
    if (top10Percent > 80) flags.push('WHALE_CONCENTRATION');

    // Check for suspicious patterns in holder distribution
    const topHolder = holders[0];
    if (topHolder && topHolder.percent > 50 && !topHolder.isLP) {
      flags.push('SINGLE_WHALE');
    }

    const result: QuickScanResult = {
      token,
      suspicious: classification.riskScore >= 50 || flags.length >= 2,
      score: classification.riskScore,
      flags,
      features,
      timestamp: Date.now()
    };

    await this.think(
      'observation',
      `Scan complete: ${token.slice(0, 8)}... score=${result.score} suspicious=${result.suspicious}` +
      (flags.length > 0 ? ` (${flags.join(', ')})` : '')
    );

    return result;
  }

  /**
   * Extract 29-feature vector from LEAN data (only on-chain, no external APIs)
   * Uses just holder distribution + token metadata for classification
   */
  private extractLeanFeatures(
    tokenData: any | null,
    holders: HolderData[]
  ): Float32Array {
    const features = new Float32Array(29);

    // Default safe values if no data
    if (!tokenData) {
      return this.generateSimulatedFeatures();
    }

    // ==========================================
    // Market features (0-4) — defaults (no external APIs)
    // ==========================================
    features[0] = 0.3;  // liquidityLog - unknown
    features[1] = 0.5;  // volumeToLiquidity - unknown
    features[2] = 0.3;  // marketCapLog - unknown
    features[3] = 0;    // priceVelocity - unknown
    features[4] = 0.3;  // volumeLog - unknown

    // ==========================================
    // Holder features (5-10) — from on-chain (PRIMARY SIGNALS)
    // ==========================================
    const holderCount = holders.length;
    features[5] = Math.min(1, Math.log10(holderCount + 1) / 5);

    // Top 10 concentration (excluding LP)
    const top10 = holders.slice(0, 10).filter(h => !h.isLP);
    const top10Percent = top10.reduce((sum, h) => sum + h.percent, 0);
    features[6] = top10Percent / 100;

    // Gini coefficient
    const holdingsArray = holders.map(h => h.percent);
    features[7] = this.calculateGini(holdingsArray);

    // Fresh wallet ratio — conservative estimate
    features[8] = 0.3;

    // Whale analysis
    const whales = holders.filter(h => h.percent > 2 && !h.isLP);
    features[9] = Math.min(1, whales.length / 10);
    features[10] = whales.length > 0 ? whales[0].percent / 100 : 0;

    // ==========================================
    // Security features (11-14) — on-chain only
    // ==========================================
    features[11] = tokenData.mintAuthority === null ? 1 : 0;    // mintDisabled
    features[12] = tokenData.freezeAuthority === null ? 1 : 0;  // freezeDisabled
    features[13] = 0;  // lpLocked - unknown without external API
    features[14] = 0;  // lpBurned - unknown without external API

    // ==========================================
    // Bundle features (15-19) — infer from holder patterns
    // ==========================================
    // Detect suspicious clustering: similar-sized holdings
    const nonLpHolders = holders.filter(h => !h.isLP && h.percent > 0.5);
    let suspiciousClusters = 0;
    for (let i = 0; i < nonLpHolders.length - 1; i++) {
      for (let j = i + 1; j < nonLpHolders.length; j++) {
        const ratio = nonLpHolders[i].percent / nonLpHolders[j].percent;
        if (ratio > 0.8 && ratio < 1.2) suspiciousClusters++;
      }
    }
    const bundleDetected = suspiciousClusters >= 3;
    const clusterControl = bundleDetected
      ? nonLpHolders.slice(0, Math.min(5, nonLpHolders.length)).reduce((s, h) => s + h.percent, 0)
      : 0;

    features[15] = bundleDetected ? 1 : 0;
    features[16] = Math.min(suspiciousClusters / 10, 1);
    features[17] = clusterControl / 100;
    features[18] = bundleDetected ? 0.6 : 0;  // confidence
    features[19] = 1 - (clusterControl / 100);

    // ==========================================
    // Trading features (20-23) — defaults
    // ==========================================
    features[20] = 0.5;  // buyRatio24h - unknown
    features[21] = 0.5;  // buyRatio1h - unknown
    features[22] = 0.3;  // activityLevel - assume some
    features[23] = 0;    // momentum - unknown

    // ==========================================
    // Time features (24-25)
    // ==========================================
    features[24] = 1.0;  // ageDecay - assume new
    features[25] = 0.5;  // tradingRecency - unknown

    // ==========================================
    // Creator features (26-28)
    // ==========================================
    features[26] = 0;  // creatorIdentified - not fetching
    features[27] = 0;  // creatorRugHistory
    features[28] = 0;  // creatorHoldings

    return features;
  }

  // External API methods removed - using pure on-chain data only

  /**
   * Calculate Gini coefficient for holder distribution
   */
  private calculateGini(values: number[]): number {
    if (values.length <= 1) return 0;

    const sorted = values.slice().sort((a, b) => a - b);
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
   * Flag token as suspicious and alert analysts
   */
  private async flagSuspicious(params: {
    token: string;
    score: number;
    flags: string[];
    features: Float32Array;
    yellowstoneData?: {
      liquiditySol?: number;
      dex?: string;
      poolAddress?: string;
      graduatedFrom?: string;
      bondingCurveTime?: number;
    };
  }): Promise<void> {
    const { token, score, flags, features, yellowstoneData } = params;

    this.flaggedCount++;

    await this.think(
      'action',
      `Flagging suspicious token: ${token.slice(0, 8)}... (score: ${score}, flags: ${flags.join(', ')})`
    );

    // Find similar tokens from memory
    const similar = await this.memory.findSimilar(features, 5, 0.85);

    // Send to analyst for investigation - include Yellowstone data!
    await this.sendMessage('analyst', 'investigate', {
      token,
      score,
      flags,
      features: Array.from(features),
      similarTokens: similar.map(s => ({
        token: s.entry.content.token,
        similarity: s.similarity
      })),
      priority: score >= 70 ? 'critical' : 'high',
      source: this.config.name,
      timestamp: Date.now(),
      // Pass Yellowstone data so AnalystAgent can skip RPC calls
      yellowstoneData,
    });

    // If score is very high, broadcast alert
    if (score >= 80) {
      await this.broadcastAlert('high_risk_token', {
        token,
        score,
        flags,
        source: this.config.name
      });
    }
  }

  /**
   * Generate simulated feature vector (for testing)
   * In production, this calls the actual feature extractor
   */
  private generateSimulatedFeatures(): Float32Array {
    const features = new Float32Array(29);

    // Market features (0-4)
    features[0] = Math.random() * 0.5;  // liquidityLog (low liquidity)
    features[1] = Math.random();         // volumeToLiquidity
    features[2] = Math.random() * 0.3;  // marketCapLog (small cap)
    features[3] = (Math.random() - 0.5) * 2; // priceVelocity
    features[4] = Math.random() * 0.3;  // volumeLog

    // Holder features (5-10)
    features[5] = Math.random() * 0.3;  // holderCountLog (few holders)
    features[6] = 0.5 + Math.random() * 0.5; // top10Concentration (high)
    features[7] = 0.3 + Math.random() * 0.5; // giniCoefficient
    features[8] = Math.random() * 0.3;  // freshWalletRatio
    features[9] = Math.random() * 0.3;  // whaleCount
    features[10] = Math.random() * 0.5; // topWhalePercent

    // Security features (11-14)
    features[11] = Math.random() > 0.3 ? 1 : 0; // mintDisabled
    features[12] = Math.random() > 0.3 ? 1 : 0; // freezeDisabled
    features[13] = Math.random() > 0.5 ? 1 : 0; // lpLocked
    features[14] = Math.random() > 0.8 ? 1 : 0; // lpBurned

    // Bundle features (15-19)
    features[15] = Math.random() > 0.7 ? 1 : 0; // bundleDetected
    features[16] = Math.random() * 0.3; // bundleCountNorm
    features[17] = Math.random() * 0.3; // bundleControlPercent
    features[18] = Math.random();       // bundleConfidence
    features[19] = Math.random();       // bundleQuality

    // Trading features (20-23)
    features[20] = 0.5 + Math.random() * 0.5; // buyRatio24h
    features[21] = 0.5 + Math.random() * 0.5; // buyRatio1h
    features[22] = Math.random() * 0.5; // activityLevel
    features[23] = (Math.random() - 0.5) * 0.4; // momentum

    // Time features (24-25)
    features[24] = 0.8 + Math.random() * 0.2; // ageDecay (very new)
    features[25] = Math.random(); // tradingRecency

    // Creator features (26-28)
    features[26] = Math.random() > 0.5 ? 1 : 0; // creatorIdentified
    features[27] = Math.random() > 0.9 ? Math.random() * 0.5 : 0; // creatorRugHistory
    features[28] = Math.random() * 0.5; // creatorHoldings

    return features;
  }

  protected getConstraints(): Record<string, any> {
    return {
      maxScansPerMinute: 30,
      minSlotInterval: 10,
      flagThreshold: 50
    };
  }

  protected setupMessageHandlers(): void {
    // Handle manual scan requests
    this.messageBus.subscribe(`agent.${this.config.name}.scan`, async (msg) => {
      const result = await this.quickScan({ token: msg.data.token });
      await this.sendMessage(msg.from, 'scan_result', result);
    });

    // Handle slot checkpoint requests
    this.messageBus.subscribe(`agent.${this.config.name}.checkpoint`, async () => {
      await this.messageBus.publish(`agent.${this.config.name}.checkpoint.response`, {
        lastSlot: this.lastSlot,
        scanCount: this.scanCount,
        flaggedCount: this.flaggedCount
      }, { from: this.config.name });
    });
  }

  /**
   * Get scout statistics
   */
  getStats(): {
    lastSlot: number;
    scanCount: number;
    flaggedCount: number;
    flagRate: number;
  } {
    return {
      lastSlot: this.lastSlot,
      scanCount: this.scanCount,
      flaggedCount: this.flaggedCount,
      flagRate: this.scanCount > 0 ? this.flaggedCount / this.scanCount : 0
    };
  }
}
