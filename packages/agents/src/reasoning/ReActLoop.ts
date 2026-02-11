/**
 * ReActLoop - Thought-Action-Observation Reasoning
 *
 * Implements the ReAct pattern for autonomous agent reasoning:
 * 1. THOUGHT: Agent reasons about current situation using LLM
 * 2. ACTION: Agent selects and executes a tool
 * 3. OBSERVATION: Agent observes the result
 * 4. LOOP: Repeat until conclusion or max iterations
 *
 * Falls back to rule-based logic if LLM unavailable.
 */

import type { LLMService } from '../services/LLMService';
import type { Tool } from '../core/BaseAgent';

export interface Thought {
  reasoning: string;
  nextAction: string; // Tool name or 'CONCLUDE'
  params?: Record<string, unknown>;
  confidence: number;
}

export interface Action {
  tool: string;
  params: Record<string, unknown>;
}

export interface Observation {
  result: unknown;
  success: boolean;
  insights: string[];
  error?: string;
}

export interface ReActStep {
  iteration: number;
  thought: Thought;
  action?: Action;
  observation?: Observation;
  timestamp: number;
}

export interface ReActResult {
  conclusion: string;
  confidence: number;
  history: ReActStep[];
  decision?: {
    action: 'BUY' | 'SELL' | 'IGNORE' | 'TRACK' | 'ALERT' | 'NONE';
    target?: string;
    reason: string;
  };
  totalTimeMs: number;
}

export interface ReActConfig {
  maxIterations: number;
  confidenceThreshold: number; // Stop early if confidence exceeds this
  timeoutMs: number;
  enableDebugLogging: boolean;
}

const DEFAULT_CONFIG: ReActConfig = {
  maxIterations: 5,
  confidenceThreshold: 0.85,
  timeoutMs: 30000,
  enableDebugLogging: true,
};

const REACT_SYSTEM_PROMPT = `You are an AI agent reasoning step-by-step using the ReAct pattern.

For each step, you will:
1. THINK about the current situation and what you know
2. Decide on an ACTION to take (use a tool) or CONCLUDE if you have enough information

You MUST respond with valid JSON:
{
  "reasoning": "Your step-by-step thinking about the situation",
  "nextAction": "tool_name or CONCLUDE",
  "params": { "param1": "value1" },
  "confidence": 0.85
}

RULES:
- Only use tools from the available list
- If you have enough information, use "CONCLUDE" as nextAction
- confidence should reflect how certain you are (0.5 = uncertain, 0.9+ = very confident)
- Be concise in reasoning - focus on key insights
- Reference specific data points in your reasoning`;

export class ReActLoop {
  private llm: LLMService;
  private tools: Map<string, Tool>;
  private config: ReActConfig;
  private agentName: string;
  private systemPrompt: string;

  constructor(
    llm: LLMService,
    tools: Tool[],
    agentName: string,
    systemPrompt: string,
    config?: Partial<ReActConfig>
  ) {
    this.llm = llm;
    this.tools = new Map(tools.map(t => [t.name, t]));
    this.agentName = agentName;
    this.systemPrompt = systemPrompt;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the ReAct reasoning loop
   */
  async reason(context: string): Promise<ReActResult> {
    const startTime = Date.now();
    const history: ReActStep[] = [];
    let iteration = 0;

    this.log('Starting ReAct loop', { context: context.slice(0, 200) + '...' });

    while (iteration < this.config.maxIterations) {
      // Check timeout
      if (Date.now() - startTime > this.config.timeoutMs) {
        this.log('Timeout reached');
        break;
      }

      iteration++;
      const stepStart = Date.now();

      // THOUGHT: Get LLM to reason about current state
      const thought = await this.think(context, history);

      if (!thought) {
        this.log('Failed to get thought from LLM');
        break;
      }

      const step: ReActStep = {
        iteration,
        thought,
        timestamp: stepStart,
      };

      // Check if agent wants to conclude
      if (thought.nextAction === 'CONCLUDE') {
        history.push(step);
        this.log('Agent concluded', { reasoning: thought.reasoning });

        return this.buildResult(thought.reasoning, thought.confidence, history, startTime);
      }

      // ACTION: Execute the chosen tool
      const action: Action = {
        tool: thought.nextAction,
        params: thought.params || {},
      };
      step.action = action;

      // OBSERVATION: Get result from tool
      const observation = await this.executeAction(action);
      step.observation = observation;

      history.push(step);

      this.log(`Step ${iteration}`, {
        thought: thought.reasoning.slice(0, 100),
        action: action.tool,
        success: observation.success,
      });

      // Early exit on high confidence
      if (thought.confidence >= this.config.confidenceThreshold) {
        this.log('High confidence reached, concluding early');
        return this.buildResult(thought.reasoning, thought.confidence, history, startTime);
      }
    }

    // Max iterations reached
    const lastThought = history[history.length - 1]?.thought;
    return this.buildResult(
      lastThought?.reasoning || 'Max iterations reached without conclusion',
      lastThought?.confidence || 0.5,
      history,
      startTime
    );
  }

  /**
   * Think step - get LLM to reason about current state
   */
  private async think(context: string, history: ReActStep[]): Promise<Thought | null> {
    // Build history context
    const historyText = history.map(step => {
      let text = `[Step ${step.iteration}]\nThought: ${step.thought.reasoning}`;
      if (step.action) {
        text += `\nAction: ${step.action.tool}(${JSON.stringify(step.action.params)})`;
      }
      if (step.observation) {
        const obsText = step.observation.success
          ? JSON.stringify(step.observation.result).slice(0, 500)
          : `Error: ${step.observation.error}`;
        text += `\nObservation: ${obsText}`;
        if (step.observation.insights.length > 0) {
          text += `\nInsights: ${step.observation.insights.join(', ')}`;
        }
      }
      return text;
    }).join('\n\n');

    // Build tool list
    const toolList = Array.from(this.tools.values())
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    const prompt = `${context}

AVAILABLE TOOLS:
${toolList}

${historyText ? `PREVIOUS STEPS:\n${historyText}\n\n` : ''}What should you do next? Think step by step.`;

    const fullSystemPrompt = `${this.systemPrompt}\n\n${REACT_SYSTEM_PROMPT}`;

    const response = await this.llm.chat({
      system: fullSystemPrompt,
      prompt,
      model: 'fast',
      format: 'json',
      temperature: 0.3,
    });

    if (!response) {
      return null;
    }

    try {
      const parsed = JSON.parse(response);
      return {
        reasoning: String(parsed.reasoning || ''),
        nextAction: String(parsed.nextAction || 'CONCLUDE'),
        params: parsed.params || {},
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      };
    } catch (err) {
      this.log('Failed to parse LLM response', { error: err, response: response.slice(0, 200) });
      return null;
    }
  }

  /**
   * Execute an action using a tool
   */
  private async executeAction(action: Action): Promise<Observation> {
    const tool = this.tools.get(action.tool);

    if (!tool) {
      return {
        result: null,
        success: false,
        insights: [],
        error: `Unknown tool: ${action.tool}`,
      };
    }

    try {
      const result = await tool.execute(action.params);

      // Extract insights from result
      const insights = this.extractInsights(result);

      return {
        result,
        success: true,
        insights,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        result: null,
        success: false,
        insights: [],
        error,
      };
    }
  }

  /**
   * Extract key insights from a tool result
   */
  private extractInsights(result: unknown): string[] {
    const insights: string[] = [];

    if (!result || typeof result !== 'object') {
      return insights;
    }

    const r = result as Record<string, unknown>;

    // Common patterns to extract
    if ('score' in r) insights.push(`Score: ${r.score}`);
    if ('riskLevel' in r) insights.push(`Risk: ${r.riskLevel}`);
    if ('isScammer' in r) insights.push(`Scammer: ${r.isScammer ? 'YES' : 'NO'}`);
    if ('bundleDetected' in r) insights.push(`Bundle: ${r.bundleDetected ? 'YES' : 'NO'}`);
    if ('liquidity' in r) insights.push(`Liquidity: $${r.liquidity}`);
    if ('holderCount' in r) insights.push(`Holders: ${r.holderCount}`);
    if ('verdict' in r) insights.push(`Verdict: ${r.verdict}`);

    return insights;
  }

  /**
   * Build the final result
   */
  private buildResult(
    conclusion: string,
    confidence: number,
    history: ReActStep[],
    startTime: number
  ): ReActResult {
    // Parse decision from conclusion
    const decision = this.parseDecision(conclusion, history);

    return {
      conclusion,
      confidence,
      history,
      decision,
      totalTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Parse a decision from the conclusion
   */
  private parseDecision(
    conclusion: string,
    history: ReActStep[]
  ): ReActResult['decision'] | undefined {
    const conclusionLower = conclusion.toLowerCase();

    // Look for action keywords
    if (conclusionLower.includes('buy') || conclusionLower.includes('purchase')) {
      return { action: 'BUY', reason: conclusion };
    }
    if (conclusionLower.includes('sell') || conclusionLower.includes('exit')) {
      return { action: 'SELL', reason: conclusion };
    }
    if (conclusionLower.includes('alert') || conclusionLower.includes('warn')) {
      return { action: 'ALERT', reason: conclusion };
    }
    if (conclusionLower.includes('track') || conclusionLower.includes('watch')) {
      return { action: 'TRACK', reason: conclusion };
    }
    if (conclusionLower.includes('ignore') || conclusionLower.includes('skip') || conclusionLower.includes('avoid')) {
      return { action: 'IGNORE', reason: conclusion };
    }

    return { action: 'NONE', reason: conclusion };
  }

  /**
   * Add a tool dynamically
   */
  addTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Remove a tool
   */
  removeTool(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<ReActConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (!this.config.enableDebugLogging) return;

    const prefix = `[${this.agentName}:ReAct]`;
    if (data) {
      console.log(prefix, message, JSON.stringify(data).slice(0, 300));
    } else {
      console.log(prefix, message);
    }
  }
}

/**
 * Factory function to create a ReActLoop with fallback behavior
 */
export function createReActLoop(
  llm: LLMService | null,
  tools: Tool[],
  agentName: string,
  systemPrompt: string,
  fallbackFn: (context: string) => Promise<ReActResult>
): {
  reason: (context: string) => Promise<ReActResult>;
  isLLMAvailable: () => Promise<boolean>;
} {
  const loop = llm ? new ReActLoop(llm, tools, agentName, systemPrompt) : null;

  return {
    reason: async (context: string): Promise<ReActResult> => {
      // Try LLM-powered reasoning first
      if (loop && (await llm!.isAvailable())) {
        try {
          return await loop.reason(context);
        } catch (err) {
          console.warn(`[${agentName}] ReAct failed, using fallback:`, err);
        }
      }

      // Fall back to rule-based logic
      return fallbackFn(context);
    },
    isLLMAvailable: async () => llm?.isAvailable() ?? false,
  };
}
