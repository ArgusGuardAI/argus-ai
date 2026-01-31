/**
 * AnalystAgent - Deep Investigation of Flagged Tokens
 *
 * Responsibilities:
 * - Receive suspicious tokens from Scouts
 * - Perform comprehensive analysis
 * - Build investigation reports
 * - Recommend actions to Traders
 * - Hand off scammer profiles to Hunters
 */

import { BaseAgent, AgentConfig, AgentAction } from '../core/BaseAgent';
import { MessageBus } from '../core/MessageBus';

export interface InvestigationRequest {
  token: string;
  score: number;
  flags: string[];
  features: number[];
  similarTokens?: Array<{ token: string; similarity: number }>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  source: string;
  timestamp: number;
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

  constructor(messageBus: MessageBus, options: { name?: string } = {}) {
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
        }
      ],
      memory: true,
      reasoning: true,
      maxReasoningSteps: 7
    };

    super(config, messageBus);
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
      // Step 1: Get full token data
      await this.think('reasoning', 'Fetching comprehensive token data...');
      const tokenData = await this.getFullTokenData({ token: request.token });

      // Step 2: Analyze bundles
      await this.think('reasoning', 'Analyzing coordination patterns...');
      const bundleAnalysis = await this.analyzeBundles({
        token: request.token,
        holders: tokenData.holders
      });

      if (bundleAnalysis.detected) {
        findings.push({
          category: 'COORDINATION',
          finding: `${bundleAnalysis.count} coordinated wallets control ${bundleAnalysis.controlPercent.toFixed(1)}%`,
          severity: bundleAnalysis.controlPercent > 30 ? 'CRITICAL' : 'HIGH',
          evidence: `Wallets: ${bundleAnalysis.wallets.slice(0, 3).join(', ')}...`
        });
        totalScore += bundleAnalysis.controlPercent > 30 ? 20 : 10;
      }

      // Step 3: Analyze holders
      await this.think('reasoning', 'Analyzing holder distribution...');
      const holderAnalysis = await this.analyzeHolders({
        token: request.token,
        holders: tokenData.holders
      });

      if (holderAnalysis.whaleConcentration > 50) {
        findings.push({
          category: 'CONCENTRATION',
          finding: `Top whale controls ${holderAnalysis.topWhalePercent.toFixed(1)}% of supply`,
          severity: 'CRITICAL',
          evidence: `Gini coefficient: ${holderAnalysis.gini.toFixed(2)}`
        });
        totalScore += 15;
      }

      // Step 4: Check creator history
      await this.think('reasoning', 'Investigating creator wallet...');
      const creatorHistory = await this.checkCreatorHistory({
        creator: tokenData.creator
      });

      if (creatorHistory.rugCount > 0) {
        findings.push({
          category: 'CREATOR',
          finding: `Creator has ${creatorHistory.rugCount} previous rugs`,
          severity: 'CRITICAL',
          evidence: `Known rugged tokens: ${creatorHistory.ruggedTokens.slice(0, 3).join(', ')}`
        });
        totalScore += 40;
      }

      // Step 5: Check for existing flags
      for (const flag of request.flags) {
        if (flag === 'MINT_ACTIVE') {
          findings.push({
            category: 'SECURITY',
            finding: 'Mint authority is active - creator can mint more tokens',
            severity: 'HIGH',
            evidence: 'Mint authority not revoked'
          });
        }
        if (flag === 'FREEZE_ACTIVE') {
          findings.push({
            category: 'SECURITY',
            finding: 'Freeze authority is active - creator can freeze accounts',
            severity: 'CRITICAL',
            evidence: 'Freeze authority not revoked'
          });
        }
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

      // Generate report
      const report = await this.generateReport({
        token: request.token,
        score: totalScore,
        findings,
        bundleAnalysis
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

      await this.think(
        'observation',
        `Investigation complete: ${request.token.slice(0, 8)}... verdict=${report.verdict} score=${report.score}`
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.think('reflection', `Investigation failed: ${errorMsg}`);
    }

    this.isInvestigating = false;
  }

  /**
   * Get full token data (simulated - in production calls Sentinel API)
   */
  private async getFullTokenData(params: { token: string }): Promise<any> {
    // In production, this calls our Sentinel API
    return {
      token: params.token,
      name: 'Test Token',
      symbol: 'TEST',
      supply: 1000000000,
      holders: this.generateSimulatedHolders(),
      creator: 'SIMULATED_CREATOR',
      liquidity: Math.random() * 50000,
      marketCap: Math.random() * 100000,
      age: Math.random() * 24
    };
  }

  /**
   * Analyze bundle/coordination patterns
   */
  private async analyzeBundles(params: { token: string; holders: any[] }): Promise<{
    detected: boolean;
    count: number;
    controlPercent: number;
    wallets: string[];
    assessment: string;
  }> {
    // Simulate bundle detection
    const detected = Math.random() > 0.5;
    const count = detected ? Math.floor(Math.random() * 20) + 3 : 0;
    const controlPercent = detected ? Math.random() * 40 : 0;

    return {
      detected,
      count,
      controlPercent,
      wallets: detected ? ['wallet1...', 'wallet2...', 'wallet3...'] : [],
      assessment: detected
        ? controlPercent > 30 ? 'VERY_SUSPICIOUS' : 'SUSPICIOUS'
        : 'LIKELY_LEGIT'
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
   * Check creator wallet history
   */
  private async checkCreatorHistory(params: { creator: string }): Promise<{
    walletAge: number;
    tokensCreated: number;
    rugCount: number;
    ruggedTokens: string[];
  }> {
    // Simulate creator history check
    const rugCount = Math.random() > 0.9 ? Math.floor(Math.random() * 3) + 1 : 0;

    return {
      walletAge: Math.floor(Math.random() * 365),
      tokensCreated: Math.floor(Math.random() * 10) + 1,
      rugCount,
      ruggedTokens: rugCount > 0 ? ['RUGGED1', 'RUGGED2'] : []
    };
  }

  /**
   * Generate investigation report
   */
  private async generateReport(params: {
    token: string;
    score: number;
    findings: InvestigationReport['findings'];
    bundleAnalysis: any;
  }): Promise<InvestigationReport> {
    const { token, score, findings, bundleAnalysis } = params;

    // Determine verdict
    let verdict: InvestigationReport['verdict'] = 'SAFE';
    if (score >= 80) verdict = 'SCAM';
    else if (score >= 60) verdict = 'DANGEROUS';
    else if (score >= 40) verdict = 'SUSPICIOUS';

    // Generate summary
    const criticalFindings = findings.filter(f => f.severity === 'CRITICAL');
    const summary = criticalFindings.length > 0
      ? `CRITICAL: ${criticalFindings.map(f => f.finding).join('. ')}`
      : findings.length > 0
        ? `${findings.length} risk indicators found. ${findings[0].finding}`
        : 'No significant risk indicators found.';

    // Generate recommendation
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
    // Handle investigation requests
    this.messageBus.subscribe(`agent.${this.config.name}.investigate`, async (msg) => {
      const request = msg.data as InvestigationRequest;

      // Add to queue
      this.investigationQueue.push(request);

      await this.think(
        'observation',
        `Queued investigation for ${request.token.slice(0, 8)}... (queue size: ${this.investigationQueue.length})`
      );
    });

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
}
