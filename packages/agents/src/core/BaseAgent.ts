/**
 * BaseAgent - Foundation for All AI Agents
 *
 * Provides core capabilities:
 * - LLM-powered reasoning via ReActLoop (primary)
 * - BitNet-powered reasoning (fallback)
 * - Memory (short-term + long-term with vector storage)
 * - Inter-agent communication via MessageBus
 * - Tool execution framework
 * - Goal tracking and optimization
 * - Autonomous reasoning loops
 */

import { BitNetEngine, ClassifierOutput } from '../reasoning/BitNetEngine';
import { ReActLoop, ReActResult, createReActLoop } from '../reasoning/ReActLoop';
import { AgentMemory } from './AgentMemory';
import { MessageBus } from './MessageBus';
import { GoalTracker, getGoalTracker, Goal } from './AgentGoals';
import { buildSystemPrompt } from '../prompts/SystemPrompts';
import type { LLMService } from '../services/LLMService';

export interface Tool {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

export interface AgentConfig {
  name: string;
  role: string;
  model: string;
  tools: Tool[];
  memory: boolean;
  reasoning: boolean;
  maxReasoningSteps?: number;
  llmService?: LLMService; // Optional LLM for autonomous reasoning
}

export interface ThoughtEntry {
  timestamp: number;
  type: 'observation' | 'reasoning' | 'action' | 'reflection';
  content: string;
  confidence?: number;
}

export interface AgentAction {
  tool: string;
  params: Record<string, any>;
  reason: string;
}

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected engine: BitNetEngine;
  protected memory: AgentMemory;
  protected messageBus: MessageBus;
  protected thoughts: ThoughtEntry[] = [];
  protected running: boolean = false;
  protected static readonly MAX_THOUGHTS = 1000; // Prevent memory overflow

  // LLM-powered reasoning (optional, falls back to BitNet)
  protected llmService: LLMService | null = null;
  protected reactLoop: ReActLoop | null = null;
  protected systemPrompt: string;

  // Goal tracking
  protected goalTracker: GoalTracker;

  constructor(config: AgentConfig, messageBus: MessageBus) {
    this.config = config;
    this.messageBus = messageBus;
    this.engine = new BitNetEngine(config.model);
    this.memory = new AgentMemory(config.name);
    this.goalTracker = getGoalTracker();
    this.systemPrompt = buildSystemPrompt(config.name);

    // Initialize LLM-powered reasoning if service provided
    if (config.llmService) {
      this.llmService = config.llmService;
      this.reactLoop = new ReActLoop(
        config.llmService,
        config.tools,
        config.name,
        this.systemPrompt,
        { maxIterations: config.maxReasoningSteps || 5 }
      );
    }

    // Setup message handlers
    this.setupBaseMessageHandlers();
    this.setupMessageHandlers();
  }

  /**
   * Set or update the LLM service (can be called after construction)
   */
  setLLMService(llm: LLMService): void {
    this.llmService = llm;
    this.reactLoop = new ReActLoop(
      llm,
      this.config.tools,
      this.config.name,
      this.systemPrompt,
      { maxIterations: this.config.maxReasoningSteps || 5 }
    );
    console.log(`[${this.config.name}] LLM service configured`);
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing...`);

    // Load BitNet model
    await this.engine.loadModel();

    // Agent-specific initialization
    await this.onInitialize();

    console.log(`[${this.config.name}] Ready`);
  }

  /**
   * Start the agent's main loop
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    await this.think('observation', `Agent ${this.config.name} starting`);

    // Run the main loop
    this.run().catch(error => {
      console.error(`[${this.config.name}] Error in run loop:`, error);
      this.running = false;
    });
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    this.running = false;
    await this.think('observation', `Agent ${this.config.name} stopping`);
  }

  /**
   * Record a thought
   */
  protected async think(
    type: ThoughtEntry['type'],
    content: string,
    confidence?: number
  ): Promise<void> {
    const thought: ThoughtEntry = {
      timestamp: Date.now(),
      type,
      content,
      confidence
    };

    this.thoughts.push(thought);

    // Prevent memory overflow - trim oldest thoughts when limit exceeded
    if (this.thoughts.length > BaseAgent.MAX_THOUGHTS) {
      this.thoughts = this.thoughts.slice(-BaseAgent.MAX_THOUGHTS);
    }

    // Store in memory
    if (this.config.memory) {
      await this.memory.store(thought, { type: 'observation' });
    }

    // Log thought
    const prefix = {
      observation: '👁️ ',
      reasoning: '🧠',
      action: '⚡',
      reflection: '💭'
    }[type];

    console.log(`[${this.config.name}] ${prefix} ${content}`);
  }

  /**
   * Execute autonomous reasoning using LLM (ReAct) with BitNet fallback
   *
   * This is the primary reasoning method for autonomous agents.
   * Uses LLM-powered ReAct loop when available, falls back to BitNet rules.
   */
  protected async autonomousReason(context: string): Promise<ReActResult> {
    // Try LLM-powered reasoning first
    if (this.reactLoop && this.llmService) {
      try {
        const isAvailable = await this.llmService.isAvailable();
        if (isAvailable) {
          await this.think('reasoning', 'Starting LLM-powered reasoning...');
          const result = await this.reactLoop.reason(context);
          await this.think('reasoning', `Concluded: ${result.conclusion.slice(0, 100)}...`, result.confidence);
          return result;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.think('reflection', `LLM reasoning failed: ${msg}, using fallback`);
      }
    }

    // Fall back to BitNet-based reasoning
    return this.fallbackReason(context);
  }

  /**
   * BitNet-based fallback reasoning (rule-based)
   */
  protected async fallbackReason(context: string): Promise<ReActResult> {
    await this.think('reasoning', 'Using rule-based reasoning (BitNet fallback)');

    const action = await this.reasoningLoop(context);
    const startTime = Date.now();

    return {
      conclusion: action ? `Action: ${action.tool} - ${action.reason}` : 'No action determined',
      confidence: action ? 0.7 : 0.4,
      history: [],
      decision: action ? {
        action: 'NONE',
        reason: action.reason,
      } : undefined,
      totalTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a reasoning loop to determine next action (BitNet-based)
   */
  protected async reasoningLoop(context: string): Promise<AgentAction | null> {
    if (!this.config.reasoning) {
      return null;
    }

    const maxSteps = this.config.maxReasoningSteps || 5;
    let steps = 0;

    while (steps < maxSteps) {
      steps++;

      // Get recent thoughts for context
      const recentThoughts = this.thoughts.slice(-10).map(t => t.content).join('\n');

      // Reason about next action
      const reasoning = await this.engine.reason(
        `${context}\n\nRecent thoughts:\n${recentThoughts}`,
        this.config.tools.map(t => t.name)
      );

      await this.think('reasoning', reasoning.thought, reasoning.confidence);

      if (reasoning.action) {
        return reasoning.action;
      }

      // No clear action, reflect and try again
      await this.think('reflection', 'No clear action determined, reconsidering...');
    }

    return null;
  }

  /**
   * Execute an action using a tool
   */
  protected async executeAction(action: AgentAction): Promise<any> {
    const tool = this.config.tools.find(t => t.name === action.tool);

    if (!tool) {
      throw new Error(`Tool not found: ${action.tool}`);
    }

    await this.think('action', `Executing ${action.tool}: ${action.reason}`);

    try {
      const result = await tool.execute(action.params);

      // Store action in memory
      if (this.config.memory) {
        await this.memory.store({
          action: action.tool,
          params: action.params,
          result,
          reason: action.reason
        }, { type: 'action' });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.think('reflection', `Action failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Classify token risk using feature vector
   */
  protected async classifyRisk(features: Float32Array): Promise<ClassifierOutput> {
    return this.engine.classify(features);
  }

  /**
   * Send message to another agent
   */
  protected async sendMessage(
    targetAgent: string,
    type: string,
    data: any
  ): Promise<void> {
    await this.messageBus.sendTo(targetAgent, type, data, this.config.name);
  }

  /**
   * Broadcast alert to all agents
   */
  protected async broadcastAlert(alertType: string, data: any): Promise<void> {
    await this.messageBus.broadcastAlert(alertType, data, this.config.name);
  }

  /**
   * Get agent status
   */
  getStatus(): {
    name: string;
    role: string;
    running: boolean;
    thoughtCount: number;
    memoryStats: any;
    llmEnabled: boolean;
    goalProgress: number;
    goals: Goal[];
  } {
    const goalSet = this.goalTracker.getGoals(this.config.name);

    return {
      name: this.config.name,
      role: this.config.role,
      running: this.running,
      thoughtCount: this.thoughts.length,
      memoryStats: this.memory.getStats(),
      llmEnabled: this.llmService !== null,
      goalProgress: goalSet?.overallProgress || 0,
      goals: goalSet?.goals || [],
    };
  }

  /**
   * Update a goal metric
   */
  protected updateGoal(goalId: string, value: number): void {
    const progress = this.goalTracker.updateGoal(this.config.name, goalId, value);
    if (progress && !progress.onTrack) {
      this.log('warn', `Goal ${goalId} is behind target: ${value} vs target`);
    }
  }

  /**
   * Get priority goals (PRIMARY type not on track)
   */
  protected getPriorityGoals(): Goal[] {
    return this.goalTracker.getPriorityGoals(this.config.name);
  }

  /**
   * Check if LLM is available for reasoning
   */
  async isLLMAvailable(): Promise<boolean> {
    return this.llmService?.isAvailable() ?? false;
  }

  /**
   * Log helper that uses agent name prefix
   */
  protected log(level: 'info' | 'warn' | 'error', message: string): void {
    const prefix = `[${this.config.name}]`;
    switch (level) {
      case 'info':
        console.log(prefix, message);
        break;
      case 'warn':
        console.warn(prefix, message);
        break;
      case 'error':
        console.error(prefix, message);
        break;
    }
  }

  /**
   * Get recent thoughts
   */
  getThoughts(limit: number = 20): ThoughtEntry[] {
    return this.thoughts.slice(-limit);
  }

  /**
   * Configure BitNet metrics reporting URL
   */
  setMetricsUrl(url: string): void {
    this.engine.setMetricsUrl(url);
  }

  /**
   * Get BitNet inference stats
   */
  getBitNetStats(): { lastMs: number; avgMs: number; totalInferences: number } {
    return this.engine.getInferenceStats();
  }

  /**
   * Setup base message handlers
   */
  private setupBaseMessageHandlers(): void {
    // Handle status requests
    this.messageBus.subscribe(`agent.${this.config.name}.status`, async () => {
      await this.messageBus.publish(`agent.${this.config.name}.status.response`, this.getStatus(), {
        from: this.config.name
      });
    });

    // Handle stop requests
    this.messageBus.subscribe(`agent.${this.config.name}.stop`, async () => {
      await this.stop();
    });
  }

  /**
   * Get constraints for this agent (override in subclasses)
   */
  protected getConstraints(): Record<string, any> {
    return {};
  }

  // Abstract methods to implement in subclasses
  protected abstract onInitialize(): Promise<void>;
  protected abstract run(): Promise<void>;
  protected abstract setupMessageHandlers(): void;
}
