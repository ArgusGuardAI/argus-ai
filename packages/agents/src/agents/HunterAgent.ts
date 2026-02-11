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
import type { Database } from '../services/Database';
import type { LLMService } from '../services/LLMService';

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
  private database: Database | undefined;
  private llm: LLMService | undefined;

  constructor(messageBus: MessageBus, options: { name?: string; rpcEndpoint?: string; database?: Database; llm?: LLMService } = {}) {
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
    this.database = options.database;
    this.llm = options.llm;
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

        // Generate AI dialogue for activity feed
        let dialogue: string | null = null;
        if (this.llm) {
          dialogue = await this.llm.generateDialogue({
            agent: 'hunter',
            event: 'profile_created',
            targetAgent: 'analyst',
            data: {
              wallet: wallet.slice(0, 8),
              pattern: pattern.pattern,
              confidence: pattern.confidence,
              connectedWallets: newProfile.connectedWallets.length,
            },
          });
        }

        // Publish profile_created for WorkersSync activity feed
        await this.messageBus.publish(`agent.${this.config.name}.profile_created`, {
          wallet,
          pattern: pattern.pattern,
          confidence: pattern.confidence,
          token,
          connectedWallets: newProfile.connectedWallets.length,
          dialogue: dialogue || `Built profile: ${wallet.slice(0, 8)}... — ${pattern.pattern} pattern detected`,
        }, { from: this.config.name, priority: 'normal' });
      }
    }

    // Persist scammer database to disk
    await this.persistScammerDatabase();

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
   * Find wallet connections using real on-chain transaction data
   */
  private async findConnections(params: { wallet: string }): Promise<{
    direct: string[];
    coordinated: string[];
    networkSize: number;
  }> {
    const { wallet } = params;

    // Get from existing network map (populated by trackScammer)
    const connected = this.walletNetwork.get(wallet) || new Set();

    // Try to discover more connections from recent transactions
    try {
      const transactions = await this.onChainTools.getTransactions(wallet, 50);

      // Find wallets that appear in this wallet's transactions
      const interactedWallets = new Set<string>();
      for (const tx of transactions) {
        if (tx.to !== 'unknown' && tx.to !== wallet) {
          interactedWallets.add(tx.to);
        }
        if (tx.from !== 'unknown' && tx.from !== wallet) {
          interactedWallets.add(tx.from);
        }
      }

      // Cross-reference with known scammer wallets
      const coordinated: string[] = [];
      for (const interacted of interactedWallets) {
        if (this.scammerProfiles.has(interacted) || connected.has(interacted)) {
          coordinated.push(interacted);
          this.addToNetwork(wallet, interacted);
        }
      }

      return {
        direct: Array.from(connected),
        coordinated,
        networkSize: connected.size + interactedWallets.size
      };
    } catch {
      return {
        direct: Array.from(connected),
        coordinated: [],
        networkSize: connected.size
      };
    }
  }

  /**
   * Detect scam pattern from wallet behavior — uses LLM when available
   */
  private async detectPattern(params: { wallet: string; profile?: any }): Promise<{
    pattern: ScammerProfile['pattern'];
    confidence: number;
    evidence: string[];
  }> {
    const profile = params.profile || await this.profileWallet(params);

    // Try LLM-powered pattern classification first
    if (this.llm) {
      try {
        // Gather connected wallet info
        const connections = this.walletNetwork.get(params.wallet);
        const connectedWallets = connections ? Array.from(connections) : [];

        // Find tokens this wallet is associated with from existing profiles
        const existing = this.scammerProfiles.get(params.wallet);

        const llmResult = await this.llm.classifyPattern({
          wallet: params.wallet,
          tokensInvolved: existing?.tokens || [],
          ruggedTokens: existing?.ruggedTokens || [],
          connectedWallets,
          evidence: existing?.evidence || [
            `Transaction count: ${profile.transactionCount || 0}`,
            `Wallet age: ${profile.age || 0} hours`,
            `Trading pattern: ${profile.tradingPattern || 'UNKNOWN'}`,
            `SOL balance: ${profile.balance || 0}`,
            `Tokens held: ${profile.tokensHeld || 0}`,
          ],
          bundleCount: connectedWallets.length > 0 ? connectedWallets.length : undefined,
          transactionCount: profile.transactionCount,
          walletAge: profile.age ? `${Math.floor(profile.age / 24)}d` : undefined,
        });

        if (llmResult) {
          console.log(`[${this.config.name}] LLM pattern: ${llmResult.pattern} (confidence: ${llmResult.confidence.toFixed(2)}, ${llmResult.evidence.length} evidence points)`);

          // Map LLM pattern to our type
          const validPatterns = ['BUNDLE_COORDINATOR', 'RUG_PULLER', 'WASH_TRADER', 'INSIDER', 'UNKNOWN'];
          const mappedPattern = validPatterns.includes(llmResult.pattern)
            ? llmResult.pattern as ScammerProfile['pattern']
            : 'UNKNOWN';

          return {
            pattern: mappedPattern,
            confidence: Math.round(llmResult.confidence * 100),
            evidence: llmResult.evidence,
          };
        }
      } catch (err) {
        console.warn(`[${this.config.name}] LLM pattern detection failed, falling back:`, err instanceof Error ? err.message : err);
      }
    }

    // Fallback: use BitNet template generation
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
      agent: 'HUNTER',
      severity: 'CRITICAL',
      title: isRepeat ? 'Known Scammer Active!' : 'New Scammer Identified',
      message: `Wallet ${wallet.slice(0, 8)}... (${profile.pattern}) ${
        newToken ? `launched ${newToken.slice(0, 8)}...` : 'detected'
      }`,
      action: 'AVOID all tokens from this wallet'
    });

    // Generate AI dialogue for activity feed
    let dialogue: string | null = null;
    if (this.llm) {
      dialogue = await this.llm.generateDialogue({
        agent: 'hunter',
        event: isRepeat ? 'repeat_scammer' : 'new_scammer',
        targetAgent: 'trader',
        data: {
          wallet: wallet.slice(0, 8),
          pattern: profile.pattern,
          rugCount: profile.ruggedTokens.length,
          isRepeat,
          newToken: newToken?.slice(0, 8),
        },
      });
    }

    // Publish scammer_detected for WorkersSync activity feed
    await this.messageBus.publish(`agent.${this.config.name}.scammer_detected`, {
      wallet,
      pattern: profile.pattern,
      confidence: profile.confidence,
      rugCount: profile.ruggedTokens.length,
      isRepeat,
      newToken,
      dialogue: dialogue || `${isRepeat ? 'REPEAT' : 'NEW'} SCAMMER: ${wallet.slice(0, 8)}... (${profile.pattern}) — ${profile.ruggedTokens.length} past rugs`,
    }, { from: this.config.name, priority: 'high' });

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
   * Check wallet for new activity using real on-chain data
   */
  private async checkWalletActivity(wallet: string): Promise<void> {
    try {
      // Get recent transactions for this wallet
      const transactions = await this.onChainTools.getTransactions(wallet, 10);

      if (transactions.length === 0) return;

      // Check for transactions newer than 2 minutes ago (check interval is 60s)
      const recentCutoff = Date.now() - 120000;
      const recentTxns = transactions.filter(tx => tx.timestamp > recentCutoff);

      if (recentTxns.length === 0) return;

      const profile = this.scammerProfiles.get(wallet);
      if (!profile) return;

      // Known scammer has new on-chain activity
      await this.think(
        'observation',
        `Known scammer ${wallet.slice(0, 8)}... has new activity (${recentTxns.length} recent txns)`
      );

      await this.broadcastScammerAlert({
        wallet,
        profile,
        isRepeat: true
      });

      // Send to analyst for investigation
      await this.sendMessage('analyst', 'investigate', {
        token: recentTxns[0].signature,
        priority: 'critical',
        context: 'Known scammer wallet activity detected',
        scammerProfile: profile
      });
    } catch {
      // Silently continue — don't spam logs for routine wallet checks
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
   * Load known scammers from local file for persistence across restarts
   */
  private async loadScammerDatabase(): Promise<void> {
    // Try PostgreSQL first
    if (this.database?.isReady()) {
      try {
        const profiles = await this.database.getAllScammerProfiles();
        for (const p of profiles) {
          const profile: ScammerProfile = {
            wallet: p.wallet,
            pattern: p.pattern as ScammerProfile['pattern'],
            confidence: p.confidence,
            tokens: p.tokens || [],
            ruggedTokens: p.rugged_tokens || [],
            firstSeen: p.first_seen.getTime(),
            lastSeen: p.last_seen.getTime(),
            totalVictims: 0,
            estimatedProfit: 0,
            connectedWallets: p.connected_wallets || [],
            evidence: p.evidence || [],
          };
          this.scammerProfiles.set(p.wallet, profile);
          this.watchlist.add(p.wallet);

          for (const connected of profile.connectedWallets) {
            this.addToNetwork(p.wallet, connected);
          }
        }
        console.log(`[Hunter] Loaded ${profiles.length} scammer profiles from database`);
        return;
      } catch (err) {
        console.warn('[Hunter] Database load failed, trying file fallback:', (err as Error).message);
      }
    }

    // Fallback to JSON file
    try {
      const fs = await import('fs').then(m => m.promises);
      const data = await fs.readFile('/opt/argus-ai/data/scammers.json', 'utf-8');
      const scammers = JSON.parse(data) as Array<{ wallet: string; profile: ScammerProfile }>;

      for (const entry of scammers) {
        this.scammerProfiles.set(entry.wallet, entry.profile);
        this.watchlist.add(entry.wallet);

        for (const connected of entry.profile.connectedWallets) {
          this.addToNetwork(entry.wallet, connected);
        }
      }

      console.log(`[Hunter] Loaded ${scammers.length} scammer profiles from disk`);
    } catch {
      console.log('[Hunter] No existing scammer database found, starting fresh');
    }
  }

  /**
   * Persist scammer database to PostgreSQL (with file fallback)
   */
  private async persistScammerDatabase(): Promise<void> {
    // Persist to PostgreSQL
    if (this.database?.isReady()) {
      try {
        for (const [wallet, profile] of this.scammerProfiles) {
          await this.database.upsertScammerProfile({
            wallet,
            pattern: profile.pattern,
            confidence: profile.confidence,
            tokens: profile.tokens,
            rugged_tokens: profile.ruggedTokens,
            connected_wallets: profile.connectedWallets,
            evidence: profile.evidence,
            first_seen: new Date(profile.firstSeen),
            last_seen: new Date(profile.lastSeen),
          });
        }
        return;
      } catch (err) {
        console.error('[Hunter] Database persist failed:', (err as Error).message);
      }
    }

    // Fallback to JSON file
    try {
      const fs = await import('fs').then(m => m.promises);
      const entries = Array.from(this.scammerProfiles.entries()).map(([wallet, profile]) => ({
        wallet,
        profile
      }));

      await fs.mkdir('/opt/argus-ai/data', { recursive: true });
      await fs.writeFile(
        '/opt/argus-ai/data/scammers.json',
        JSON.stringify(entries, null, 2)
      );
    } catch (error) {
      console.error('[Hunter] Failed to persist scammer database:', error);
    }
  }

  protected getConstraints(): Record<string, any> {
    return {
      maxWatchlistSize: 1000,
      minConfidenceForAlert: 0.7,
      maxNetworkDepth: 3
    };
  }

  protected setupMessageHandlers(): void {
    const agentType = this.config.name.replace(/-\d+$/, '');

    // Handle track requests from analysts
    const handleTrackScammer = async (msg: import('../core/MessageBus').Message) => {
      await this.trackScammer(msg.data.token, msg.data.report);
    };
    this.messageBus.subscribe(`agent.${this.config.name}.track_scammer`, handleTrackScammer);
    if (agentType !== this.config.name) {
      this.messageBus.subscribe(`agent.${agentType}.track_scammer`, handleTrackScammer);
    }

    // Handle wallet check requests
    const handleCheckWallet = async (msg: import('../core/MessageBus').Message) => {
      const result = await this.checkRepeatOffender({ wallet: msg.data.wallet });
      await this.sendMessage(msg.from, 'wallet_check_result', result);
    };
    this.messageBus.subscribe(`agent.${this.config.name}.check_wallet`, handleCheckWallet);
    if (agentType !== this.config.name) {
      this.messageBus.subscribe(`agent.${agentType}.check_wallet`, handleCheckWallet);
    }

    // Handle network query
    const handleGetNetwork = async (msg: import('../core/MessageBus').Message) => {
      const connections = await this.findConnections({ wallet: msg.data.wallet });
      await this.sendMessage(msg.from, 'network_result', connections);
    };
    this.messageBus.subscribe(`agent.${this.config.name}.get_network`, handleGetNetwork);
    if (agentType !== this.config.name) {
      this.messageBus.subscribe(`agent.${agentType}.get_network`, handleGetNetwork);
    }
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
