/**
 * DebateProtocol - Multi-Agent Consensus System
 *
 * Implements structured debate between agents for critical decisions:
 * 1. PROPOSAL: One agent proposes an action
 * 2. ARGUMENTS: Other agents provide arguments for/against
 * 3. COUNTERS: Proposer responds to arguments
 * 4. VOTING: All agents vote with weighted expertise
 * 5. CONSENSUS: Decision is made based on weighted votes
 *
 * Used for high-stakes decisions like trading, scammer alerts.
 */

import type { LLMService } from '../services/LLMService';
import type { MessageBus } from '../core/MessageBus';

export interface Proposal {
  id: string;
  agent: string;
  action: 'BUY' | 'SELL' | 'IGNORE' | 'TRACK' | 'ALERT';
  target: string; // Token address or wallet
  amount?: number; // For trades
  reasoning: string;
  confidence: number;
  context: Record<string, unknown>;
  timestamp: number;
}

export interface Argument {
  agent: string;
  position: 'SUPPORT' | 'OPPOSE' | 'NEUTRAL';
  points: string[];
  evidence: Record<string, unknown>;
  confidence: number;
}

export interface Counter {
  fromAgent: string;
  toArgument: string; // Agent name whose argument is being countered
  response: string;
  additionalEvidence?: Record<string, unknown>;
}

export interface Vote {
  agent: string;
  decision: 'YES' | 'NO' | 'ABSTAIN';
  weight: number; // Based on expertise and track record
  reasoning: string;
}

export interface DebateResult {
  proposalId: string;
  proposal: Proposal;
  arguments: Argument[];
  counters: Counter[];
  votes: Vote[];
  decision: 'APPROVED' | 'REJECTED';
  confidence: number;
  consensusReasoning: string;
  totalTimeMs: number;
  timestamp: number;
}

export interface AgentProfile {
  name: string;
  expertise: string[];
  baseWeight: number;
  successRate: number; // Historical success rate for weight adjustment
}

// Agent expertise weights - higher weight for relevant expertise
const EXPERTISE_WEIGHTS: Record<string, Record<string, number>> = {
  scout: { discovery: 1.2, speed: 1.1 },
  analyst: { risk: 1.3, security: 1.2, patterns: 1.2 },
  hunter: { scammers: 1.5, bundles: 1.3, wallets: 1.2 },
  trader: { trading: 1.4, timing: 1.2, sizing: 1.3 },
};

// Action to expertise mapping
const ACTION_EXPERTISE: Record<string, string[]> = {
  BUY: ['trading', 'risk', 'timing'],
  SELL: ['trading', 'timing'],
  ALERT: ['scammers', 'security', 'bundles'],
  TRACK: ['discovery', 'wallets'],
  IGNORE: ['risk', 'patterns'],
};

const ARGUMENT_SYSTEM = `You are an AI agent participating in a team debate about a proposed action.
You must evaluate the proposal and provide an argument for or against it.

Respond with valid JSON only:
{
  "position": "SUPPORT" | "OPPOSE" | "NEUTRAL",
  "points": ["key point 1", "key point 2"],
  "confidence": 0.85
}

RULES:
- Base your argument on the evidence provided
- SUPPORT if the proposal is sound and evidence supports it
- OPPOSE if you see flaws or risks not addressed
- NEUTRAL only if genuinely insufficient information
- Be specific in your points - reference actual data`;

const VOTE_SYSTEM = `You are an AI agent voting on a team decision after hearing all arguments.
Consider the original proposal, all arguments, and counter-arguments.

Respond with valid JSON only:
{
  "decision": "YES" | "NO" | "ABSTAIN",
  "reasoning": "Brief explanation of your vote"
}

RULES:
- Vote YES if proposal should proceed
- Vote NO if it should be rejected
- ABSTAIN only if you genuinely cannot decide
- Consider all evidence presented in the debate`;

export class DebateProtocol {
  private llm: LLMService;
  private messageBus: MessageBus;
  private agents: Map<string, AgentProfile>;
  private activeDebates: Map<string, DebateResult>;
  private debateHistory: DebateResult[] = [];
  private static readonly MAX_HISTORY = 100; // Prevent memory overflow

  constructor(llm: LLMService, messageBus: MessageBus) {
    this.llm = llm;
    this.messageBus = messageBus;
    this.agents = new Map();
    this.activeDebates = new Map();

    // Initialize default agent profiles
    this.initializeAgents();
  }

  private initializeAgents(): void {
    const defaults: AgentProfile[] = [
      { name: 'scout', expertise: ['discovery', 'speed'], baseWeight: 0.8, successRate: 0.5 },
      { name: 'analyst', expertise: ['risk', 'security', 'patterns'], baseWeight: 1.0, successRate: 0.5 },
      { name: 'hunter', expertise: ['scammers', 'bundles', 'wallets'], baseWeight: 1.0, successRate: 0.5 },
      { name: 'trader', expertise: ['trading', 'timing', 'sizing'], baseWeight: 0.9, successRate: 0.5 },
    ];

    for (const profile of defaults) {
      this.agents.set(profile.name, profile);
    }
  }

  /**
   * Start a debate on a proposal
   */
  async debate(proposal: Proposal): Promise<DebateResult> {
    const startTime = Date.now();
    console.log(`[Debate] Starting debate on ${proposal.action} for ${proposal.target.slice(0, 8)}...`);

    // Phase 1: Collect arguments from all agents (except proposer)
    const participants = Array.from(this.agents.values())
      .filter(a => a.name !== proposal.agent);

    const argumentPromises = participants.map(p => this.getArgument(p, proposal));
    const args = await Promise.all(argumentPromises);

    console.log(`[Debate] Collected ${args.length} arguments`);

    // Phase 2: Get counter-arguments from proposer
    const counters = await this.getCounterArguments(proposal.agent, args, proposal);

    console.log(`[Debate] Collected ${counters.length} counter-arguments`);

    // Phase 3: Voting
    const votePromises = Array.from(this.agents.values())
      .map(a => this.getVote(a, proposal, args, counters));
    const votes = await Promise.all(votePromises);

    console.log(`[Debate] Collected ${votes.length} votes`);

    // Calculate consensus
    const consensus = this.calculateConsensus(votes, proposal);

    const result: DebateResult = {
      proposalId: proposal.id,
      proposal,
      arguments: args,
      counters,
      votes,
      decision: consensus.decision,
      confidence: consensus.confidence,
      consensusReasoning: consensus.reasoning,
      totalTimeMs: Date.now() - startTime,
      timestamp: Date.now(),
    };

    // Store result (with overflow protection)
    this.debateHistory.push(result);
    if (this.debateHistory.length > DebateProtocol.MAX_HISTORY) {
      this.debateHistory = this.debateHistory.slice(-DebateProtocol.MAX_HISTORY);
    }

    // Publish result to message bus
    await this.messageBus.publish('debate.result', result);

    console.log(`[Debate] Completed: ${result.decision} (${(result.confidence * 100).toFixed(0)}% confidence)`);

    return result;
  }

  /**
   * Get an argument from an agent
   */
  private async getArgument(agent: AgentProfile, proposal: Proposal): Promise<Argument> {
    const prompt = `PROPOSAL from ${proposal.agent.toUpperCase()}:
Action: ${proposal.action}
Target: ${proposal.target}
Reasoning: ${proposal.reasoning}
Confidence: ${(proposal.confidence * 100).toFixed(0)}%

CONTEXT:
${JSON.stringify(proposal.context, null, 2)}

You are ${agent.name.toUpperCase()} with expertise in: ${agent.expertise.join(', ')}
Evaluate this proposal and provide your argument.`;

    const response = await this.llm.chat({
      system: ARGUMENT_SYSTEM,
      prompt,
      model: 'fast',
      format: 'json',
      temperature: 0.4,
    });

    if (!response) {
      return {
        agent: agent.name,
        position: 'NEUTRAL',
        points: ['Unable to form argument - LLM unavailable'],
        evidence: {},
        confidence: 0.3,
      };
    }

    try {
      const parsed = JSON.parse(response);
      return {
        agent: agent.name,
        position: this.validatePosition(parsed.position),
        points: Array.isArray(parsed.points) ? parsed.points.map(String) : [],
        evidence: proposal.context,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      };
    } catch {
      return {
        agent: agent.name,
        position: 'NEUTRAL',
        points: ['Failed to parse argument'],
        evidence: {},
        confidence: 0.3,
      };
    }
  }

  /**
   * Get counter-arguments from the proposer
   */
  private async getCounterArguments(
    proposerName: string,
    args: Argument[],
    proposal: Proposal
  ): Promise<Counter[]> {
    const opposingArgs = args.filter(a => a.position === 'OPPOSE');

    if (opposingArgs.length === 0) {
      return [];
    }

    const counters: Counter[] = [];

    for (const arg of opposingArgs) {
      const prompt = `You proposed: ${proposal.action} on ${proposal.target}
Your reasoning: ${proposal.reasoning}

${arg.agent.toUpperCase()} OPPOSES with these points:
${arg.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Respond to their concerns in 1-2 sentences.`;

      const response = await this.llm.chat({
        system: 'You are defending your proposal. Be concise and address the specific concerns raised.',
        prompt,
        model: 'fast',
        temperature: 0.4,
      });

      counters.push({
        fromAgent: proposerName,
        toArgument: arg.agent,
        response: response || 'No response generated',
      });
    }

    return counters;
  }

  /**
   * Get a vote from an agent
   */
  private async getVote(
    agent: AgentProfile,
    proposal: Proposal,
    args: Argument[],
    counters: Counter[]
  ): Promise<Vote> {
    // Calculate weight based on expertise match
    const weight = this.calculateWeight(agent, proposal.action);

    const argumentSummary = args.map(a =>
      `${a.agent.toUpperCase()} (${a.position}): ${a.points.slice(0, 2).join('; ')}`
    ).join('\n');

    const counterSummary = counters.map(c =>
      `${c.fromAgent.toUpperCase()} to ${c.toArgument}: ${c.response.slice(0, 100)}`
    ).join('\n');

    const prompt = `PROPOSAL: ${proposal.action} on ${proposal.target}
Proposer: ${proposal.agent.toUpperCase()}
Reasoning: ${proposal.reasoning}

ARGUMENTS:
${argumentSummary}

${counters.length > 0 ? `COUNTER-ARGUMENTS:\n${counterSummary}` : ''}

You are ${agent.name.toUpperCase()}. Cast your vote.`;

    const response = await this.llm.chat({
      system: VOTE_SYSTEM,
      prompt,
      model: 'fast',
      format: 'json',
      temperature: 0.3,
    });

    if (!response) {
      return {
        agent: agent.name,
        decision: 'ABSTAIN',
        weight,
        reasoning: 'LLM unavailable',
      };
    }

    try {
      const parsed = JSON.parse(response);
      return {
        agent: agent.name,
        decision: this.validateDecision(parsed.decision),
        weight,
        reasoning: String(parsed.reasoning || ''),
      };
    } catch {
      return {
        agent: agent.name,
        decision: 'ABSTAIN',
        weight,
        reasoning: 'Failed to parse vote',
      };
    }
  }

  /**
   * Calculate weighted consensus from votes
   */
  private calculateConsensus(
    votes: Vote[],
    proposal: Proposal
  ): { decision: 'APPROVED' | 'REJECTED'; confidence: number; reasoning: string } {
    const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
    const yesWeight = votes
      .filter(v => v.decision === 'YES')
      .reduce((sum, v) => sum + v.weight, 0);
    const noWeight = votes
      .filter(v => v.decision === 'NO')
      .reduce((sum, v) => sum + v.weight, 0);

    const yesRatio = yesWeight / totalWeight;
    const noRatio = noWeight / totalWeight;

    // Need 60% weighted approval
    const decision = yesRatio >= 0.6 ? 'APPROVED' : 'REJECTED';
    const confidence = Math.abs(yesRatio - noRatio);

    // Build reasoning summary
    const yesVoters = votes.filter(v => v.decision === 'YES').map(v => v.agent);
    const noVoters = votes.filter(v => v.decision === 'NO').map(v => v.agent);
    const abstainers = votes.filter(v => v.decision === 'ABSTAIN').map(v => v.agent);

    let reasoning = `${decision}: `;
    if (yesVoters.length > 0) reasoning += `${yesVoters.join(', ')} voted YES. `;
    if (noVoters.length > 0) reasoning += `${noVoters.join(', ')} voted NO. `;
    if (abstainers.length > 0) reasoning += `${abstainers.join(', ')} abstained. `;
    reasoning += `(${(yesRatio * 100).toFixed(0)}% approval, threshold: 60%)`;

    return { decision, confidence, reasoning };
  }

  /**
   * Calculate weight for an agent based on expertise match
   */
  private calculateWeight(agent: AgentProfile, action: Proposal['action']): number {
    let weight = agent.baseWeight;

    // Apply expertise bonus
    const relevantExpertise = ACTION_EXPERTISE[action] || [];
    const expertiseWeights = EXPERTISE_WEIGHTS[agent.name] || {};

    for (const exp of agent.expertise) {
      if (relevantExpertise.includes(exp)) {
        weight *= expertiseWeights[exp] || 1.0;
      }
    }

    // Apply success rate modifier (±20%)
    weight *= 0.8 + (agent.successRate * 0.4);

    return Math.max(0.1, Math.min(2.0, weight));
  }

  /**
   * Update agent success rate based on outcome
   */
  updateAgentSuccess(agentName: string, wasCorrect: boolean): void {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    // Exponential moving average
    const alpha = 0.1;
    agent.successRate = agent.successRate * (1 - alpha) + (wasCorrect ? 1 : 0) * alpha;
  }

  /**
   * Get debate history
   */
  getHistory(limit: number = 20): DebateResult[] {
    return this.debateHistory.slice(-limit);
  }

  /**
   * Get agent profiles
   */
  getAgents(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  private validatePosition(p: unknown): Argument['position'] {
    const valid = ['SUPPORT', 'OPPOSE', 'NEUTRAL'];
    const s = String(p).toUpperCase();
    return valid.includes(s) ? s as Argument['position'] : 'NEUTRAL';
  }

  private validateDecision(d: unknown): Vote['decision'] {
    const valid = ['YES', 'NO', 'ABSTAIN'];
    const s = String(d).toUpperCase();
    return valid.includes(s) ? s as Vote['decision'] : 'ABSTAIN';
  }
}

/**
 * Create a proposal ID
 */
export function createProposalId(): string {
  return `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if an action should trigger a debate
 */
export function shouldDebate(
  action: Proposal['action'],
  context: Record<string, unknown>
): boolean {
  // Always debate trades
  if (action === 'BUY' || action === 'SELL') {
    return true;
  }

  // Debate alerts if confidence is borderline
  if (action === 'ALERT') {
    const confidence = Number(context.confidence) || 0;
    return confidence < 0.8; // Debate if not highly confident
  }

  return false;
}
