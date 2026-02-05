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
import { OnChainTools, HolderData, TransactionData } from '../tools/OnChainTools';
import { AnalysisTools, BundleDetectionResult } from '../tools/AnalysisTools';

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
}

// DexScreener API response (free, no rate limits)
interface DexScreenerPairData {
  priceUsd: string | null;
  liquidity: { usd: number } | null;
  volume: { h24: number } | null;
  txns: { h24: { buys: number; sells: number } } | null;
  marketCap: number | null;
  priceChange: { h24: number } | null;
}

// RugCheck API response (free)
interface RugCheckReport {
  score: number;
  risks: Array<{ name: string; level: string; description: string }>;
  markets: Array<{ lp: { lpLockedPct: number; lpBurnedPct: number } }>;
}

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
  private static readonly POOL_EVENTS_FILE = '/opt/argus-ai/data/pool-events.jsonl';
  private static readonly MAX_LAUNCHES_PER_CYCLE = 10; // Batch limit to prevent RPC overload

  constructor(messageBus: MessageBus, options: {
    name?: string;
    rpcEndpoint?: string;
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
    this.rpcEndpoint = options.rpcEndpoint || 'https://api.mainnet-beta.solana.com';
    this.onChainTools = new OnChainTools({ rpcEndpoint: this.rpcEndpoint });
    this.analysisTools = new AnalysisTools();
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', 'Scout initializing. Loading last slot checkpoint...');
    this.lastSlot = await this.getCurrentSlot();
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

          // Quick scan each launch
          for (const launch of launches) {
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
   */
  private async processLaunch(launch: LaunchEvent): Promise<void> {
    await this.think('observation', `Processing launch: ${launch.token.slice(0, 8)}...`);

    // Quick scan
    const scan = await this.quickScan({ token: launch.token });

    this.scanCount++;

    // Store in memory with feature vector
    await this.memory.storeToken(launch.token, scan.features, {
      score: scan.score,
      flags: scan.flags,
      timestamp: scan.timestamp,
      creator: launch.creator
    });

    // Flag if suspicious
    if (scan.suspicious) {
      await this.flagSuspicious({
        token: launch.token,
        score: scan.score,
        flags: scan.flags,
        features: scan.features
      });
    }
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
          if (event.token && !this.seenTokens.has(event.token)) {
            this.seenTokens.add(event.token);
            launches.push({
              token: event.token,
              creator: 'unknown', // Monitor doesn't know creator — Scout will find out
              slot: 0,
              timestamp: event.timestamp || Date.now()
            });
          }
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
   * Uses real on-chain data + DexScreener + RugCheck + bundle detection
   */
  private async quickScan(params: { token: string }): Promise<QuickScanResult> {
    const { token } = params;

    await this.think('action', `Quick scanning ${token.slice(0, 8)}...`);

    // Fetch all data in parallel: on-chain + free APIs
    const [tokenData, holders, dexData, rugCheckData, transactions] = await Promise.all([
      this.onChainTools.getTokenData(token),
      this.onChainTools.getHolders(token, 20),
      this.fetchDexScreenerData(token),
      this.fetchRugCheckData(token),
      this.onChainTools.getTransactions(token, 100),
    ]);

    // Run bundle detection using real holder + transaction data
    const bundleResult = this.analysisTools.detectBundles(holders, transactions);

    // Extract features from real data
    const features = this.extractFeatures(tokenData, holders, dexData, rugCheckData, bundleResult, transactions);

    // Classify using BitNet
    const classification = await this.classifyRisk(features);

    const result: QuickScanResult = {
      token,
      suspicious: classification.riskScore >= 50,
      score: classification.riskScore,
      flags: classification.flags.map(f => f.type),
      features,
      timestamp: Date.now()
    };

    await this.think(
      'observation',
      `Scan complete: ${token.slice(0, 8)}... score=${result.score} suspicious=${result.suspicious}` +
      (dexData ? ` liq=$${dexData.liquidity?.usd?.toFixed(0) || '?'} mcap=$${dexData.marketCap?.toFixed(0) || '?'}` : ' (no DexScreener)') +
      (bundleResult.detected ? ` BUNDLES=${bundleResult.totalWallets}wallets/${bundleResult.controlPercent.toFixed(1)}%` : '')
    );

    return result;
  }

  /**
   * Extract 29-feature vector from real token data + DexScreener + RugCheck + bundles
   */
  private extractFeatures(
    tokenData: any | null,
    holders: HolderData[],
    dexData: DexScreenerPairData | null,
    rugCheckData: RugCheckReport | null,
    bundleResult: BundleDetectionResult | null,
    transactions: TransactionData[]
  ): Float32Array {
    const features = new Float32Array(29);

    // Default safe values if no data
    if (!tokenData) {
      return this.generateSimulatedFeatures();
    }

    // ==========================================
    // Market features (0-4) — from DexScreener
    // ==========================================
    if (dexData) {
      const liquidity = dexData.liquidity?.usd || 0;
      const volume24h = dexData.volume?.h24 || 0;
      const marketCap = dexData.marketCap || 0;
      const priceChange24h = dexData.priceChange?.h24 || 0;

      features[0] = Math.log10(Math.max(liquidity, 1)) / 7;               // liquidityLog (normalized 0-1)
      features[1] = Math.min(volume24h / Math.max(liquidity, 1), 10) / 10; // volumeToLiquidity
      features[2] = Math.log10(Math.max(marketCap, 1)) / 10;              // marketCapLog
      features[3] = Math.max(-1, Math.min(1, priceChange24h / 100));       // priceVelocity (-1 to 1)
      features[4] = Math.log10(Math.max(volume24h, 1)) / 8;               // volumeLog
    } else {
      // Token too new for DexScreener — conservative defaults
      features[0] = 0.1;
      features[1] = 0;
      features[2] = 0.1;
      features[3] = 0;
      features[4] = 0;
    }

    // ==========================================
    // Holder features (5-10) — from on-chain
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

    // Fresh wallet ratio — placeholder (expensive to compute, low priority)
    features[8] = 0.2;

    // Whale analysis
    const whales = holders.filter(h => h.percent > 2 && !h.isLP);
    features[9] = Math.min(1, whales.length / 10);
    features[10] = whales.length > 0 ? whales[0].percent / 100 : 0;

    // ==========================================
    // Security features (11-14) — on-chain + RugCheck
    // ==========================================
    features[11] = tokenData.mintAuthority === null ? 1 : 0;  // mintDisabled
    features[12] = tokenData.freezeAuthority === null ? 1 : 0;  // freezeDisabled

    // LP lock/burn from RugCheck API
    if (rugCheckData?.markets && rugCheckData.markets.length > 0) {
      const lp = rugCheckData.markets[0]?.lp;
      const lpLockedPct = lp?.lpLockedPct || 0;
      const lpBurnedPct = lp?.lpBurnedPct || 0;
      features[13] = lpLockedPct > 50 ? 1 : lpLockedPct / 100;  // lpLocked
      features[14] = lpBurnedPct > 95 ? 1 : 0;                   // lpBurned
    } else {
      features[13] = 0;
      features[14] = 0;
    }

    // ==========================================
    // Bundle features (15-19) — from AnalysisTools
    // ==========================================
    if (bundleResult) {
      features[15] = bundleResult.detected ? 1 : 0;
      features[16] = Math.min(bundleResult.totalWallets / 20, 1);
      features[17] = bundleResult.controlPercent / 100;
      features[18] = bundleResult.confidence === 'HIGH' ? 1 :
                     bundleResult.confidence === 'MEDIUM' ? 0.6 : 0.3;
      features[19] = 1 - (bundleResult.controlPercent / 100);  // quality = inverse of control
    } else {
      features[15] = 0;
      features[16] = 0;
      features[17] = 0;
      features[18] = 0;
      features[19] = 1;  // no bundles = good quality
    }

    // ==========================================
    // Trading features (20-23) — from DexScreener txns
    // ==========================================
    if (dexData?.txns?.h24) {
      const buys = dexData.txns.h24.buys;
      const sells = dexData.txns.h24.sells;
      const total = buys + sells;
      features[20] = total > 0 ? buys / total : 0.5;            // buyRatio24h
      features[21] = total > 0 ? buys / total : 0.5;            // buyRatio1h (approx with 24h)
      features[22] = Math.min(total / 100, 1);                  // activityLevel
      features[23] = total > 0 ? (buys - sells) / total : 0;    // momentum
    } else if (transactions.length > 0) {
      // Fallback: use transaction count as activity proxy
      features[20] = 0.5;
      features[21] = 0.5;
      features[22] = Math.min(transactions.length / 100, 1);
      features[23] = 0;
    } else {
      features[20] = 0.5;
      features[21] = 0.5;
      features[22] = 0;
      features[23] = 0;
    }

    // ==========================================
    // Time features (24-25)
    // ==========================================
    const ageHours = (Date.now() - (tokenData.createdAt || Date.now())) / (1000 * 60 * 60);
    features[24] = Math.exp(-ageHours / 24);  // ageDecay (1 = brand new)
    features[25] = transactions.length > 0
      ? Math.exp(-(Date.now() - transactions[0].timestamp) / (1000 * 60 * 60))
      : 0.5;  // tradingRecency

    // ==========================================
    // Creator features (26-28)
    // ==========================================
    features[26] = tokenData.creator ? 1 : 0;  // creatorIdentified
    features[27] = 0;  // creatorRugHistory — needs scammer database cross-reference
    features[28] = 0;  // creatorHoldings — needs holder cross-reference

    return features;
  }

  /**
   * Fetch market data from DexScreener (free API)
   */
  private async fetchDexScreenerData(tokenMint: string): Promise<DexScreenerPairData | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
        { signal: controller.signal }
      );

      clearTimeout(timeout);
      if (!response.ok) return null;

      const data = await response.json() as { pairs?: DexScreenerPairData[] };

      // Return the highest-liquidity pair
      if (data.pairs && data.pairs.length > 0) {
        return data.pairs.sort((a, b) =>
          (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        )[0];
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch security data from RugCheck (free API)
   */
  private async fetchRugCheckData(tokenMint: string): Promise<RugCheckReport | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(
        `https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`,
        { signal: controller.signal }
      );

      clearTimeout(timeout);
      if (!response.ok) return null;

      return await response.json() as RugCheckReport;
    } catch {
      return null;
    }
  }

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
  }): Promise<void> {
    const { token, score, flags, features } = params;

    this.flaggedCount++;

    await this.think(
      'action',
      `Flagging suspicious token: ${token.slice(0, 8)}... (score: ${score}, flags: ${flags.join(', ')})`
    );

    // Find similar tokens from memory
    const similar = await this.memory.findSimilar(features, 5, 0.85);

    // Send to analyst for investigation
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
      timestamp: Date.now()
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
