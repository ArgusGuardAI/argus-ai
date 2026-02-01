/**
 * HunterAgent - Tracks and Profiles Scammer Networks
 *
 * Responsibilities:
 * - Track known scammer wallets
 * - Build scammer profiles
 * - Detect repeat offenders
 * - Map wallet networks and connections
 * - Alert when known scammers launch new tokens
 */

import { BaseAgent, AgentConfig } from '../core/BaseAgent';
import { MessageBus } from '../core/MessageBus';
import { OnChainTools } from '../tools/OnChainTools';

export interface ScammerProfile {
  wallet: string;
  pattern: 'BUNDLE_COORDINATOR' | 'RUG_PULLER' | 'WASH_TRADER' | 'INSIDER' | 'UNKNOWN';
  confidence: number;
  tokens: string[];
  ruggedTokens: string[];
  firstSeen: number;
  lastSeen: number;
  totalVictims: number;
  estimatedProfit: number;
  connectedWallets: string[];
  evidence: string[];
}

export class HunterAgent extends BaseAgent {
  private scammerProfiles: Map<string, ScammerProfile> = new Map();
  private watchlist: Set<string> = new Set();
  private walletNetwork: Map<string, Set<string>> = new Map(); // wallet -> connected wallets
  private onChainTools: OnChainTools;
  private rpcEndpoint: string;

  constructor(messageBus: MessageBus, options: { name?: string; rpcEndpoint?: string } = {}) {
    const config: AgentConfig = {
      name: options.name || 'hunter-1',
      role: 'Hunter - Track scammer networks and repeat offenders',
      model: './models/argus-sentinel-v1.bitnet',
      tools: [
        {
          name: 'profile_wallet',
          description: 'Build comprehensive wallet profile',
          execute: (params) => this.profileWallet(params)
        },
        {
          name: 'find_connections',
          description: 'Map wallet connections and networks',
          execute: (params) => this.findConnections(params)
        },
        {
          name: 'detect_pattern',
          description: 'Identify scam patterns from behavior',
          execute: (params) => this.detectPattern(params)
        },
        {
          name: 'add_to_watchlist',
          description: 'Add wallet to active monitoring',
          execute: (params) => this.addToWatchlist(params)
        },
        {
          name: 'broadcast_alert',
          description: 'Alert network about active scammer',
          execute: (params) => this.broadcastScammerAlert(params)
        },
        {
          name: 'check_repeat_offender',
          description: 'Check if wallet is known repeat offender',
          execute: (params) => this.checkRepeatOffender(params)
        }
      ],
      memory: true,
      reasoning: true,
      maxReasoningSteps: 5
    };

    super(config, messageBus);
    this.rpcEndpoint = options.rpcEndpoint || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    this.onChainTools = new OnChainTools({ rpcEndpoint: this.rpcEndpoint });
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', 'Hunter initialized. Loading known scammer database...');
    await this.loadScammerDatabase();
    await this.think('observation', `Loaded ${this.scammerProfiles.size} known scammer profiles`);
  }

  protected async run(): Promise<void> {
    await this.think('observation', 'Starting watchlist monitoring...');

    while (this.running) {
      try {
        // Monitor watchlist for new activity
        for (const wallet of this.watchlist) {
          await this.checkWalletActivity(wallet);
        }

        // Periodic profile updates (every hour)
        if (Date.now() % 3600000 < 60000) {
          await this.updateProfiles();
        }

        await new Promise(resolve => setTimeout(resolve, 60000)); // Check every minute

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.think('reflection', `Monitoring error: ${errorMsg}`);
      }
    }
  }

  /**
   * Track a scammer from investigation report
   */
  async trackScammer(token: string, report: any): Promise<void> {
    await this.think('observation', `New scam detected: ${token.slice(0, 8)}...`);

    // Extract suspicious wallets
    const suspiciousWallets = this.extractSuspiciousWallets(report);

    for (const wallet of suspiciousWallets) {
      // Check if already tracked
      const existing = this.scammerProfiles.get(wallet);

      if (existing) {
        // Update existing profile
        await this.think('observation', `Known scammer active again: ${wallet.slice(0, 8)}...`);
        existing.tokens.push(token);
        existing.lastSeen = Date.now();

        if (report.verdict === 'SCAM') {
          existing.ruggedTokens.push(token);
        }

        // Broadcast alert for repeat offender
        await this.broadcastScammerAlert({
          wallet,
          profile: existing,
          newToken: token,
          isRepeat: true
        });

      } else {
        // Create new profile
        await this.think('reasoning', `Building profile for new scammer: ${wallet.slice(0, 8)}...`);

        const profile = await this.profileWallet({ wallet });
        const pattern = await this.detectPattern({ wallet, profile });

        const newProfile: ScammerProfile = {
          wallet,
          pattern: pattern.pattern,
          confidence: pattern.confidence,
          tokens: [token],
          ruggedTokens: report.verdict === 'SCAM' ? [token] : [],
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          totalVictims: 0,
          estimatedProfit: 0,
          connectedWallets: profile.connections || [],
          evidence: pattern.evidence
        };

        this.scammerProfiles.set(wallet, newProfile);

        // Add to watchlist
        await this.addToWatchlist({ wallet });

        // Find connected wallets
        const connections = await this.findConnections({ wallet });
        for (const connected of connections.coordinated || []) {
          this.addToNetwork(wallet, connected);
        }

        await this.think(
          'action',
          `Created scammer profile: ${wallet.slice(0, 8)}... pattern=${pattern.pattern}`
        );
      }
    }

    // Store in memory
    await this.memory.store({
      action: 'track_scammer',
      token,
      wallets: suspiciousWallets,
      timestamp: Date.now()
    });
  }

  /**
   * Build comprehensive wallet profile using real on-chain data
   */
  private async profileWallet(params: { wallet: string }): Promise<any> {
    const { wallet } = params;

    try {
      const profile = await this.onChainTools.profileWallet(wallet);

      if (!profile) {
        return {
          wallet,
          age: 0,
          transactionCount: 0,
          tokensCreated: 0,
          connections: [],
          balanceHistory: [],
          tradingPattern: 'UNKNOWN'
        };
      }

      // Get SOL balance
      const balance = await this.onChainTools.getBalance(wallet);

      return {
        wallet,
        age: profile.age,
        transactionCount: profile.transactionCount,
        tokensCreated: profile.tokensHeld, // Approximation
        tokensHeld: profile.tokensHeld,
        balance,
        lastActive: profile.lastActive,
        connections: [], // Would need transaction analysis
        balanceHistory: [],
        tradingPattern: profile.transactionCount > 500 ? 'ACTIVE' :
                       profile.transactionCount > 100 ? 'MODERATE' : 'LIGHT'
      };
    } catch (error) {
      console.error('[HunterAgent] Error profiling wallet:', error);
      return {
        wallet,
        age: 0,
        transactionCount: 0,
        tokensCreated: 0,
        connections: [],
        balanceHistory: [],
        tradingPattern: 'UNKNOWN'
      };
    }
  }

  /**
   * Find wallet connections
   */
  private async findConnections(params: { wallet: string }): Promise<{
    direct: string[];
    coordinated: string[];
    networkSize: number;
  }> {
    const { wallet } = params;

    // Get from network map
    const connected = this.walletNetwork.get(wallet) || new Set();

    // In production, query blockchain for funding sources, etc.
    return {
      direct: Array.from(connected),
      coordinated: Array.from(connected).filter(() => Math.random() > 0.5),
      networkSize: connected.size
    };
  }

  /**
   * Detect scam pattern from wallet behavior
   */
  private async detectPattern(params: { wallet: string; profile?: any }): Promise<{
    pattern: ScammerProfile['pattern'];
    confidence: number;
    evidence: string[];
  }> {
    const profile = params.profile || await this.profileWallet(params);

    // Use BitNet to classify pattern
    const prompt = `
Analyze this wallet profile for scam patterns:
${JSON.stringify(profile, null, 2)}

Patterns to detect:
- BUNDLE_COORDINATOR: Creates and distributes to bundle wallets
- RUG_PULLER: Creates tokens and dumps
- WASH_TRADER: Self-trades to fake volume
- INSIDER: Front-runs or has privileged access

Return JSON with pattern, confidence (0-100), and evidence array.
`;

    const result = await this.engine.generate({
      prompt,
      maxTokens: 256,
      format: 'json'
    });

    try {
      const parsed = JSON.parse(result);
      return {
        pattern: parsed.pattern || 'UNKNOWN',
        confidence: parsed.confidence || 50,
        evidence: parsed.evidence || []
      };
    } catch {
      return {
        pattern: 'UNKNOWN',
        confidence: 50,
        evidence: ['Unable to determine pattern']
      };
    }
  }

  /**
   * Add wallet to watchlist
   */
  private async addToWatchlist(params: { wallet: string }): Promise<void> {
    this.watchlist.add(params.wallet);
    await this.think('action', `Added ${params.wallet.slice(0, 8)}... to watchlist`);
  }

  /**
   * Broadcast scammer alert
   */
  private async broadcastScammerAlert(params: {
    wallet: string;
    profile: ScammerProfile;
    newToken?: string;
    isRepeat?: boolean;
  }): Promise<void> {
    const { wallet, profile, newToken, isRepeat } = params;

    const alert = {
      type: isRepeat ? 'REPEAT_SCAMMER' : 'NEW_SCAMMER',
      wallet,
      pattern: profile.pattern,
      confidence: profile.confidence,
      rugCount: profile.ruggedTokens.length,
      newToken,
      timestamp: Date.now()
    };

    // Broadcast to all agents
    await this.broadcastAlert('scammer', alert);

    // User alert
    await this.messageBus.publish('user.alert', {
      severity: 'CRITICAL',
      title: isRepeat ? 'Known Scammer Active!' : 'New Scammer Identified',
      message: `Wallet ${wallet.slice(0, 8)}... (${profile.pattern}) ${
        newToken ? `launched ${newToken.slice(0, 8)}...` : 'detected'
      }`,
      action: 'AVOID all tokens from this wallet'
    });

    await this.think('action', `Broadcast scammer alert: ${wallet.slice(0, 8)}...`);
  }

  /**
   * Check if wallet is repeat offender
   */
  private async checkRepeatOffender(params: { wallet: string }): Promise<{
    isRepeat: boolean;
    profile: ScammerProfile | null;
    rugCount: number;
  }> {
    const profile = this.scammerProfiles.get(params.wallet);

    return {
      isRepeat: profile !== null && profile !== undefined,
      profile: profile || null,
      rugCount: profile?.ruggedTokens.length || 0
    };
  }

  /**
   * Check wallet for new activity
   */
  private async checkWalletActivity(wallet: string): Promise<void> {
    // In production, query for recent transactions
    // Simulated: 1% chance of new token launch
    if (Math.random() < 0.01) {
      const profile = this.scammerProfiles.get(wallet);

      if (profile) {
        const newToken = `NEW_TOKEN_${Date.now()}`;

        await this.think(
          'observation',
          `Known scammer ${wallet.slice(0, 8)}... launched new token!`
        );

        await this.broadcastScammerAlert({
          wallet,
          profile,
          newToken,
          isRepeat: true
        });

        // Send to analyst for immediate investigation
        await this.sendMessage('analyst', 'investigate', {
          token: newToken,
          priority: 'critical',
          context: 'Known scammer wallet',
          scammerProfile: profile
        });
      }
    }
  }

  /**
   * Update all profiles
   */
  private async updateProfiles(): Promise<void> {
    await this.think('action', 'Updating scammer profiles...');

    for (const [wallet, profile] of this.scammerProfiles) {
      // Refresh profile data
      const updated = await this.profileWallet({ wallet });
      profile.connectedWallets = updated.connections || [];
      profile.lastSeen = Date.now();
    }
  }

  /**
   * Extract suspicious wallets from report
   */
  private extractSuspiciousWallets(report: any): string[] {
    const wallets: string[] = [];

    if (report.bundleAnalysis?.wallets) {
      wallets.push(...report.bundleAnalysis.wallets);
    }

    // Add creator if suspicious
    if (report.verdict === 'SCAM' || report.verdict === 'DANGEROUS') {
      wallets.push(`creator_${report.token}`);
    }

    return [...new Set(wallets)];
  }

  /**
   * Add connection to wallet network
   */
  private addToNetwork(wallet1: string, wallet2: string): void {
    if (!this.walletNetwork.has(wallet1)) {
      this.walletNetwork.set(wallet1, new Set());
    }
    if (!this.walletNetwork.has(wallet2)) {
      this.walletNetwork.set(wallet2, new Set());
    }

    this.walletNetwork.get(wallet1)!.add(wallet2);
    this.walletNetwork.get(wallet2)!.add(wallet1);
  }

  /**
   * Load known scammers from storage
   */
  private async loadScammerDatabase(): Promise<void> {
    // In production, load from D1/KV
    // For now, start empty
  }

  protected getConstraints(): Record<string, any> {
    return {
      maxWatchlistSize: 1000,
      minConfidenceForAlert: 0.7,
      maxNetworkDepth: 3
    };
  }

  protected setupMessageHandlers(): void {
    // Handle track requests from analysts
    this.messageBus.subscribe(`agent.${this.config.name}.track_scammer`, async (msg) => {
      await this.trackScammer(msg.data.token, msg.data.report);
    });

    // Handle wallet check requests
    this.messageBus.subscribe(`agent.${this.config.name}.check_wallet`, async (msg) => {
      const result = await this.checkRepeatOffender({ wallet: msg.data.wallet });
      await this.sendMessage(msg.from, 'wallet_check_result', result);
    });

    // Handle network query
    this.messageBus.subscribe(`agent.${this.config.name}.get_network`, async (msg) => {
      const connections = await this.findConnections({ wallet: msg.data.wallet });
      await this.sendMessage(msg.from, 'network_result', connections);
    });
  }

  /**
   * Get hunter statistics
   */
  getStats(): {
    profileCount: number;
    watchlistSize: number;
    networkNodes: number;
  } {
    return {
      profileCount: this.scammerProfiles.size,
      watchlistSize: this.watchlist.size,
      networkNodes: this.walletNetwork.size
    };
  }
}
