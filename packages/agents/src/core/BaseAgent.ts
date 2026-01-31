/**
 * BaseAgent - Foundation for All AI Agents
 *
 * Provides core capabilities:
 * - BitNet-powered reasoning
 * - Memory (short-term + long-term with vector storage)
 * - Inter-agent communication via MessageBus
 * - Tool execution framework
 * - Autonomous reasoning loops
 */

import { BitNetEngine, ClassifierOutput } from '../reasoning/BitNetEngine';
import { AgentMemory } from './AgentMemory';
import { MessageBus } from './MessageBus';

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

  constructor(config: AgentConfig, messageBus: MessageBus) {
    this.config = config;
    this.messageBus = messageBus;
    this.engine = new BitNetEngine(config.model);
    this.memory = new AgentMemory(config.name);

    // Setup message handlers
    this.setupBaseMessageHandlers();
    this.setupMessageHandlers();
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
   * Execute a reasoning loop to determine next action
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
  } {
    return {
      name: this.config.name,
      role: this.config.role,
      running: this.running,
      thoughtCount: this.thoughts.length,
      memoryStats: this.memory.getStats()
    };
  }

  /**
   * Get recent thoughts
   */
  getThoughts(limit: number = 20): ThoughtEntry[] {
    return this.thoughts.slice(-limit);
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
