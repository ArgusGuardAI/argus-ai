/**
 * AgentGoals - Goal-Oriented Agent Behavior
 *
 * Defines goals for each agent type with:
 * - Measurable metrics
 * - Target values
 * - Priority weights
 * - Progress tracking
 *
 * Goals influence agent decision-making and are tracked
 * for learning and optimization.
 */

export type GoalType = 'PRIMARY' | 'SECONDARY' | 'CONSTRAINT';

export interface Goal {
  id: string;
  type: GoalType;
  description: string;
  metric: string;
  target: number;
  current: number;
  weight: number;
  direction: 'maximize' | 'minimize' | 'target'; // How to optimize
  unit?: string;
}

export interface GoalProgress {
  goalId: string;
  value: number;
  timestamp: number;
  delta: number; // Change from last measurement
  onTrack: boolean;
}

export interface AgentGoalSet {
  agentName: string;
  goals: Goal[];
  lastUpdate: number;
  overallProgress: number; // 0-1 weighted average
}

/**
 * Default goals for each agent type
 */
export const AGENT_GOALS: Record<string, Goal[]> = {
  scout: [
    {
      id: 'coverage',
      type: 'PRIMARY',
      description: 'Monitor all new token launches',
      metric: 'pools_detected_ratio',
      target: 0.99,
      current: 0,
      weight: 1.0,
      direction: 'maximize',
    },
    {
      id: 'speed',
      type: 'PRIMARY',
      description: 'Detect tokens within 30s of launch',
      metric: 'avg_detection_latency_ms',
      target: 30000,
      current: 60000,
      weight: 0.8,
      direction: 'minimize',
      unit: 'ms',
    },
    {
      id: 'accuracy',
      type: 'SECONDARY',
      description: 'Flag genuine opportunities',
      metric: 'flagged_success_rate',
      target: 0.7,
      current: 0,
      weight: 0.6,
      direction: 'maximize',
    },
    {
      id: 'false_positives',
      type: 'CONSTRAINT',
      description: 'Avoid flooding with false flags',
      metric: 'false_positive_rate',
      target: 0.3,
      current: 0.5,
      weight: 0.7,
      direction: 'minimize',
    },
  ],

  analyst: [
    {
      id: 'accuracy',
      type: 'PRIMARY',
      description: 'Correct risk assessments',
      metric: 'prediction_accuracy',
      target: 0.85,
      current: 0,
      weight: 1.0,
      direction: 'maximize',
    },
    {
      id: 'thoroughness',
      type: 'PRIMARY',
      description: 'Comprehensive analysis coverage',
      metric: 'analysis_depth_score',
      target: 0.9,
      current: 0,
      weight: 0.8,
      direction: 'maximize',
    },
    {
      id: 'speed',
      type: 'CONSTRAINT',
      description: 'Complete analysis quickly',
      metric: 'avg_analysis_time_ms',
      target: 5000,
      current: 10000,
      weight: 0.5,
      direction: 'minimize',
      unit: 'ms',
    },
    {
      id: 'actionability',
      type: 'SECONDARY',
      description: 'Provide actionable recommendations',
      metric: 'recommendation_follow_rate',
      target: 0.8,
      current: 0,
      weight: 0.6,
      direction: 'maximize',
    },
  ],

  hunter: [
    {
      id: 'detection',
      type: 'PRIMARY',
      description: 'Identify scammers before rug',
      metric: 'scammer_detection_rate',
      target: 0.9,
      current: 0,
      weight: 1.0,
      direction: 'maximize',
    },
    {
      id: 'network',
      type: 'SECONDARY',
      description: 'Map scammer wallet networks',
      metric: 'network_completeness',
      target: 0.8,
      current: 0,
      weight: 0.7,
      direction: 'maximize',
    },
    {
      id: 'false_positives',
      type: 'CONSTRAINT',
      description: 'Minimize false alarms',
      metric: 'false_positive_rate',
      target: 0.1,
      current: 0.2,
      weight: 0.9,
      direction: 'minimize',
    },
    {
      id: 'early_warning',
      type: 'PRIMARY',
      description: 'Alert before significant loss',
      metric: 'avg_warning_lead_time_min',
      target: 10,
      current: 0,
      weight: 0.8,
      direction: 'maximize',
      unit: 'min',
    },
  ],

  trader: [
    {
      id: 'pnl',
      type: 'PRIMARY',
      description: 'Generate positive returns',
      metric: 'total_pnl_percent',
      target: 0.2,
      current: 0,
      weight: 1.0,
      direction: 'maximize',
    },
    {
      id: 'win_rate',
      type: 'PRIMARY',
      description: 'Win more trades than lose',
      metric: 'winning_trades_ratio',
      target: 0.6,
      current: 0,
      weight: 0.8,
      direction: 'maximize',
    },
    {
      id: 'drawdown',
      type: 'CONSTRAINT',
      description: 'Limit maximum drawdown',
      metric: 'max_drawdown_percent',
      target: 0.15,
      current: 0,
      weight: 1.0,
      direction: 'minimize',
    },
    {
      id: 'sharpe',
      type: 'SECONDARY',
      description: 'Risk-adjusted returns',
      metric: 'sharpe_ratio',
      target: 1.5,
      current: 0,
      weight: 0.7,
      direction: 'maximize',
    },
    {
      id: 'execution',
      type: 'CONSTRAINT',
      description: 'Minimize slippage',
      metric: 'avg_slippage_percent',
      target: 0.02,
      current: 0.05,
      weight: 0.6,
      direction: 'minimize',
    },
  ],
};

/**
 * GoalTracker - Tracks and updates agent goals
 */
export class GoalTracker {
  private goals: Map<string, AgentGoalSet> = new Map();
  private history: Map<string, GoalProgress[]> = new Map();

  constructor() {
    // Initialize with default goals
    for (const [agent, goals] of Object.entries(AGENT_GOALS)) {
      this.goals.set(agent, {
        agentName: agent,
        goals: goals.map(g => ({ ...g })), // Deep copy
        lastUpdate: Date.now(),
        overallProgress: 0,
      });
      this.history.set(agent, []);
    }
  }

  /**
   * Update a goal's current value
   */
  updateGoal(agentName: string, goalId: string, value: number): GoalProgress | null {
    const goalSet = this.goals.get(agentName);
    if (!goalSet) return null;

    const goal = goalSet.goals.find(g => g.id === goalId);
    if (!goal) return null;

    const delta = value - goal.current;
    goal.current = value;
    goalSet.lastUpdate = Date.now();

    // Calculate if on track
    const onTrack = this.isOnTrack(goal);

    const progress: GoalProgress = {
      goalId,
      value,
      timestamp: Date.now(),
      delta,
      onTrack,
    };

    // Store in history
    const history = this.history.get(agentName) || [];
    history.push(progress);
    if (history.length > 1000) history.shift(); // Keep last 1000
    this.history.set(agentName, history);

    // Recalculate overall progress
    goalSet.overallProgress = this.calculateOverallProgress(goalSet);

    return progress;
  }

  /**
   * Check if a goal is on track
   */
  private isOnTrack(goal: Goal): boolean {
    switch (goal.direction) {
      case 'maximize':
        return goal.current >= goal.target * 0.9; // Within 10% of target
      case 'minimize':
        return goal.current <= goal.target * 1.1;
      case 'target':
        const diff = Math.abs(goal.current - goal.target);
        return diff <= goal.target * 0.1;
    }
  }

  /**
   * Calculate weighted overall progress
   */
  private calculateOverallProgress(goalSet: AgentGoalSet): number {
    let totalWeight = 0;
    let weightedProgress = 0;

    for (const goal of goalSet.goals) {
      let progress: number;

      switch (goal.direction) {
        case 'maximize':
          progress = Math.min(1, goal.current / goal.target);
          break;
        case 'minimize':
          progress = goal.current === 0 ? 1 : Math.min(1, goal.target / goal.current);
          break;
        case 'target':
          const diff = Math.abs(goal.current - goal.target);
          progress = Math.max(0, 1 - diff / goal.target);
          break;
      }

      weightedProgress += progress * goal.weight;
      totalWeight += goal.weight;
    }

    return totalWeight > 0 ? weightedProgress / totalWeight : 0;
  }

  /**
   * Get goals for an agent
   */
  getGoals(agentName: string): AgentGoalSet | null {
    return this.goals.get(agentName) || null;
  }

  /**
   * Get goal history
   */
  getHistory(agentName: string, goalId?: string, limit: number = 100): GoalProgress[] {
    const history = this.history.get(agentName) || [];
    const filtered = goalId ? history.filter(p => p.goalId === goalId) : history;
    return filtered.slice(-limit);
  }

  /**
   * Get summary of all agents' goal status
   */
  getSummary(): Record<string, { progress: number; onTrack: number; total: number }> {
    const summary: Record<string, { progress: number; onTrack: number; total: number }> = {};

    for (const [agent, goalSet] of this.goals) {
      const onTrack = goalSet.goals.filter(g => this.isOnTrack(g)).length;
      summary[agent] = {
        progress: goalSet.overallProgress,
        onTrack,
        total: goalSet.goals.length,
      };
    }

    return summary;
  }

  /**
   * Get priority goals (PRIMARY type not on track)
   */
  getPriorityGoals(agentName: string): Goal[] {
    const goalSet = this.goals.get(agentName);
    if (!goalSet) return [];

    return goalSet.goals.filter(g =>
      g.type === 'PRIMARY' && !this.isOnTrack(g)
    );
  }

  /**
   * Format goal status for logging/display
   */
  formatGoalStatus(agentName: string): string {
    const goalSet = this.goals.get(agentName);
    if (!goalSet) return `${agentName}: No goals`;

    const lines = goalSet.goals.map(g => {
      const status = this.isOnTrack(g) ? 'OK' : 'BEHIND';
      const currentStr = g.unit ? `${g.current}${g.unit}` : g.current.toFixed(2);
      const targetStr = g.unit ? `${g.target}${g.unit}` : g.target.toFixed(2);
      return `  [${status}] ${g.id}: ${currentStr} / ${targetStr} (${g.direction})`;
    });

    return `${agentName} goals (${(goalSet.overallProgress * 100).toFixed(0)}% overall):\n${lines.join('\n')}`;
  }
}

/**
 * Singleton instance
 */
let goalTrackerInstance: GoalTracker | null = null;

export function getGoalTracker(): GoalTracker {
  if (!goalTrackerInstance) {
    goalTrackerInstance = new GoalTracker();
  }
  return goalTrackerInstance;
}
