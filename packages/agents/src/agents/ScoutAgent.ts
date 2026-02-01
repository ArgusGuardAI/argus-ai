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
import { OnChainTools } from '../tools/OnChainTools';

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

export class ScoutAgent extends BaseAgent {
  private lastSlot: number = 0;
  private scanCount: number = 0;
  private flaggedCount: number = 0;
  private rpcEndpoint: string;
  private onChainTools: OnChainTools;
  private seenTokens: Set<string> = new Set(); // Deduplicate tokens

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
          description: 'Find new token launches since last check',
          execute: (params) => this.findNewLaunches(params)
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
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', 'Scout initializing. Loading last slot checkpoint...');
    this.lastSlot = await this.getCurrentSlot();
    await this.think('observation', `Starting from slot ${this.lastSlot}`);
  }

  protected async run(): Promise<void> {
    await this.think('observation', 'Starting patrol loop...');

    while (this.running) {
      try {
        // Find new launches
        const action = await this.reasoningLoop(
          'Checking for new token launches on Solana blockchain'
        );

        if (action) {
          await this.executeAction(action);
        } else {
          // Default action: find new launches
          const launches = await this.findNewLaunches({});

          if (launches.length > 0) {
            await this.think('observation', `Found ${launches.length} new launches`);

            // Quick scan each launch
            for (const launch of launches) {
              await this.processLaunch(launch);
            }
          }
        }

        // Wait before next patrol (10 seconds)
        await new Promise(resolve => setTimeout(resolve, 10000));

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
   * Find new token launches since last check
   * Uses real RPC queries to detect InitializeMint transactions
   */
  private async findNewLaunches(params: { fromSlot?: number }): Promise<LaunchEvent[]> {
    const fromSlot = params.fromSlot || this.lastSlot;
    const currentSlot = await this.getCurrentSlot();

    // Don't search if slots haven't advanced
    if (currentSlot <= fromSlot) {
      return [];
    }

    const launches: LaunchEvent[] = [];

    try {
      // Query Token Program for recent transactions
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-sigs',
          method: 'getSignaturesForAddress',
          params: [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
            {
              limit: 50,
              minContextSlot: fromSlot
            }
          ]
        })
      });

      const data = await response.json() as {
        result?: Array<{
          signature: string;
          slot: number;
          blockTime?: number;
          err?: any;
        }>;
      };

      // Process each signature to find InitializeMint transactions
      for (const sig of data.result || []) {
        // Skip failed transactions
        if (sig.err) continue;

        try {
          // Fetch full transaction to decode
          const txResponse = await fetch(this.rpcEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'get-tx',
              method: 'getTransaction',
              params: [
                sig.signature,
                { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
              ]
            })
          });

          const txData = await txResponse.json() as any;
          const tx = txData.result;

          if (!tx) continue;

          // Look for InitializeMint instructions
          const instructions = tx.transaction?.message?.instructions || [];
          for (const ix of instructions) {
            if (ix.parsed?.type === 'initializeMint' || ix.parsed?.type === 'initializeMint2') {
              const mintAddress = ix.parsed?.info?.mint;

              // Skip if we've already seen this token
              if (mintAddress && !this.seenTokens.has(mintAddress)) {
                this.seenTokens.add(mintAddress);

                // Find the signer (creator)
                const signers = tx.transaction?.message?.accountKeys?.filter(
                  (key: any) => key.signer === true
                ) || [];
                const creator = signers[0]?.pubkey || 'unknown';

                launches.push({
                  token: mintAddress,
                  creator,
                  slot: sig.slot,
                  timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now()
                });

                await this.think('observation', `New token mint detected: ${mintAddress.slice(0, 8)}...`);
              }
            }
          }

          // Rate limiting - small delay between transaction fetches
          await new Promise(resolve => setTimeout(resolve, 50));

        } catch (txError) {
          // Skip individual transaction errors
          continue;
        }
      }

      // Update last slot
      this.lastSlot = currentSlot;

      // Limit seen tokens set size
      if (this.seenTokens.size > 10000) {
        const arr = Array.from(this.seenTokens);
        this.seenTokens = new Set(arr.slice(-5000));
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.think('reflection', `Error finding launches: ${errorMsg}`);
    }

    return launches;
  }

  /**
   * Perform quick security scan on token
   * Uses real on-chain data to extract features
   */
  private async quickScan(params: { token: string }): Promise<QuickScanResult> {
    const { token } = params;

    await this.think('action', `Quick scanning ${token.slice(0, 8)}...`);

    // Fetch real token data
    const tokenData = await this.onChainTools.getTokenData(token);
    const holders = await this.onChainTools.getHolders(token, 20);

    // Extract features from real data
    const features = this.extractFeatures(tokenData, holders);

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
      `Scan complete: ${token.slice(0, 8)}... score=${result.score} suspicious=${result.suspicious}`
    );

    return result;
  }

  /**
   * Extract 29-feature vector from real token data
   */
  private extractFeatures(
    tokenData: any | null,
    holders: Array<{ address: string; balance: number; percent: number; isLP: boolean }>
  ): Float32Array {
    const features = new Float32Array(29);

    // Default safe values if no data
    if (!tokenData) {
      return this.generateSimulatedFeatures();
    }

    // Market features (0-4) - will be enhanced with DexScreener data later
    features[0] = 0.3;  // liquidityLog placeholder
    features[1] = 0.5;  // volumeToLiquidity placeholder
    features[2] = 0.3;  // marketCapLog placeholder
    features[3] = 0;    // priceVelocity placeholder
    features[4] = 0.3;  // volumeLog placeholder

    // Holder features (5-10)
    const holderCount = holders.length;
    features[5] = Math.min(1, Math.log10(holderCount + 1) / 5);

    // Top 10 concentration
    const top10 = holders.slice(0, 10).filter(h => !h.isLP);
    const top10Percent = top10.reduce((sum, h) => sum + h.percent, 0);
    features[6] = top10Percent / 100;

    // Gini coefficient
    const holdingsArray = holders.map(h => h.percent);
    features[7] = this.calculateGini(holdingsArray);

    // Fresh wallet ratio - placeholder (would need historical data)
    features[8] = 0.2;

    // Whale analysis
    const whales = holders.filter(h => h.percent > 2 && !h.isLP);
    features[9] = Math.min(1, whales.length / 10);
    features[10] = whales.length > 0 ? whales[0].percent / 100 : 0;

    // Security features (11-14)
    features[11] = tokenData.mintAuthority === null ? 1 : 0;  // mintDisabled
    features[12] = tokenData.freezeAuthority === null ? 1 : 0;  // freezeDisabled
    features[13] = 0;  // lpLocked - would need LP check
    features[14] = 0;  // lpBurned - would need LP check

    // Bundle features (15-19) - placeholder for bundle detection
    features[15] = 0;  // bundleDetected
    features[16] = 0;  // bundleCountNorm
    features[17] = 0;  // bundleControlPercent
    features[18] = 0;  // bundleConfidence
    features[19] = 1;  // bundleQuality (1 = no bundles)

    // Trading features (20-23) - placeholder
    features[20] = 0.5;  // buyRatio24h
    features[21] = 0.5;  // buyRatio1h
    features[22] = 0.3;  // activityLevel
    features[23] = 0;    // momentum

    // Time features (24-25)
    const ageHours = (Date.now() - (tokenData.createdAt || Date.now())) / (1000 * 60 * 60);
    features[24] = Math.exp(-ageHours / 24);  // ageDecay (1 = brand new)
    features[25] = 0.5;  // tradingRecency

    // Creator features (26-28)
    features[26] = tokenData.creator ? 1 : 0;  // creatorIdentified
    features[27] = 0;  // creatorRugHistory - would need historical lookup
    features[28] = 0;  // creatorHoldings - would need to check

    return features;
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
