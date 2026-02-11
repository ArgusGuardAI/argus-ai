/**
 * ToolRegistry - Per-Agent Tool Definitions
 *
 * Defines the tools available to each agent type.
 * Tools are the actions agents can take during ReAct reasoning.
 *
 * Each tool has:
 * - name: Unique identifier
 * - description: What it does (shown to LLM)
 * - parameters: Expected input schema
 * - execute: Actual implementation (injected at runtime)
 */

import type { Tool } from '../core/BaseAgent';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object';
    description: string;
    required: boolean;
  }[];
}

/**
 * Tool definitions per agent (without implementations)
 * Implementations are injected when agents are created
 */
export const AGENT_TOOL_DEFINITIONS: Record<string, ToolDefinition[]> = {
  scout: [
    {
      name: 'check_token_age',
      description: 'Get how old a token is since creation',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'check_liquidity',
      description: 'Get current liquidity in USD for a token',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'quick_holder_scan',
      description: 'Get top 10 holders and concentration percentage',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'check_creator',
      description: 'Lookup token creator in scammer database',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'flag_for_analysis',
      description: 'Send token to Analyst for deep investigation',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
        { name: 'reason', type: 'string', description: 'Why this token was flagged', required: true },
        { name: 'priority', type: 'string', description: 'Priority level: low, medium, high', required: false },
      ],
    },
  ],

  analyst: [
    {
      name: 'get_full_analysis',
      description: 'Run complete on-chain analysis including security, holders, trading',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'detect_bundles',
      description: 'Identify coordinated wallet clusters holding the token',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'check_security',
      description: 'Verify mint authority, freeze authority, LP lock status',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'compare_patterns',
      description: 'Match token features against known scam patterns',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'calculate_risk_score',
      description: 'Generate 0-100 risk score using BitNet model',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'recommend_action',
      description: 'Provide trading recommendation: BUY, AVOID, or WATCH',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
        { name: 'analysis', type: 'object', description: 'Analysis results to base recommendation on', required: true },
      ],
    },
  ],

  hunter: [
    {
      name: 'lookup_wallet',
      description: 'Check if wallet address is in scammer database',
      parameters: [
        { name: 'walletAddress', type: 'string', description: 'Solana wallet address', required: true },
      ],
    },
    {
      name: 'trace_funding',
      description: 'Find where a wallet received its initial SOL from',
      parameters: [
        { name: 'walletAddress', type: 'string', description: 'Solana wallet address', required: true },
      ],
    },
    {
      name: 'map_network',
      description: 'Build wallet relationship graph for a suspected scammer',
      parameters: [
        { name: 'walletAddress', type: 'string', description: 'Starting wallet address', required: true },
        { name: 'depth', type: 'number', description: 'How many hops to trace (1-3)', required: false },
      ],
    },
    {
      name: 'detect_bundle_coordination',
      description: 'Check if wallets are coordinating buys on a token',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Solana token mint address', required: true },
      ],
    },
    {
      name: 'flag_scammer',
      description: 'Add wallet to scammer database with evidence',
      parameters: [
        { name: 'walletAddress', type: 'string', description: 'Wallet to flag', required: true },
        { name: 'pattern', type: 'string', description: 'Scam pattern type', required: true },
        { name: 'evidence', type: 'object', description: 'Evidence supporting the flag', required: true },
      ],
    },
    {
      name: 'alert_team',
      description: 'Broadcast urgent scammer warning to all agents',
      parameters: [
        { name: 'walletAddress', type: 'string', description: 'Scammer wallet', required: true },
        { name: 'severity', type: 'string', description: 'CRITICAL, HIGH, or MEDIUM', required: true },
        { name: 'message', type: 'string', description: 'Alert message', required: true },
      ],
    },
  ],

  trader: [
    {
      name: 'check_balance',
      description: 'Get current SOL balance of trading wallet',
      parameters: [],
    },
    {
      name: 'get_positions',
      description: 'List all open token positions with P&L',
      parameters: [],
    },
    {
      name: 'calculate_position_size',
      description: 'Determine optimal position size based on risk and confidence',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Token to buy', required: true },
        { name: 'confidence', type: 'number', description: 'Confidence level 0-1', required: true },
        { name: 'riskScore', type: 'number', description: 'Token risk score 0-100', required: true },
      ],
    },
    {
      name: 'execute_buy',
      description: 'Buy token via Jupiter swap',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Token to buy', required: true },
        { name: 'amountSol', type: 'number', description: 'Amount of SOL to spend', required: true },
        { name: 'slippageBps', type: 'number', description: 'Slippage tolerance in basis points', required: false },
      ],
    },
    {
      name: 'execute_sell',
      description: 'Sell token position via Jupiter swap',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Token to sell', required: true },
        { name: 'percentAmount', type: 'number', description: 'Percentage of position to sell (0-100)', required: true },
      ],
    },
    {
      name: 'set_stop_loss',
      description: 'Configure automatic stop-loss for a position',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Token address', required: true },
        { name: 'triggerPercent', type: 'number', description: 'Trigger when price drops this %', required: true },
      ],
    },
    {
      name: 'emergency_exit',
      description: 'Immediately sell all holdings of a token (bypass normal flow)',
      parameters: [
        { name: 'tokenAddress', type: 'string', description: 'Token to exit', required: true },
        { name: 'reason', type: 'string', description: 'Why emergency exit', required: true },
      ],
    },
  ],
};

/**
 * Get tool definitions for an agent
 */
export function getToolDefinitions(agentName: string): ToolDefinition[] {
  return AGENT_TOOL_DEFINITIONS[agentName.toLowerCase()] || [];
}

/**
 * Create Tool objects with implementations
 */
export function createTools(
  agentName: string,
  implementations: Map<string, (params: Record<string, unknown>) => Promise<unknown>>
): Tool[] {
  const definitions = getToolDefinitions(agentName);

  return definitions.map(def => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters.reduce((acc, p) => {
      acc[p.name] = { type: p.type, description: p.description, required: p.required };
      return acc;
    }, {} as Record<string, unknown>),
    execute: async (params: Record<string, unknown>) => {
      const impl = implementations.get(def.name);
      if (!impl) {
        throw new Error(`No implementation for tool: ${def.name}`);
      }
      return impl(params);
    },
  }));
}

/**
 * Validate tool parameters
 */
export function validateToolParams(
  toolName: string,
  agentName: string,
  params: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const definitions = getToolDefinitions(agentName);
  const toolDef = definitions.find(d => d.name === toolName);

  if (!toolDef) {
    return { valid: false, errors: [`Unknown tool: ${toolName}`] };
  }

  const errors: string[] = [];

  for (const param of toolDef.parameters) {
    if (param.required && !(param.name in params)) {
      errors.push(`Missing required parameter: ${param.name}`);
    }

    if (param.name in params) {
      const value = params[param.name];
      const actualType = typeof value;

      if (param.type === 'object' && (actualType !== 'object' || value === null)) {
        errors.push(`Parameter ${param.name} must be an object`);
      } else if (param.type !== 'object' && actualType !== param.type) {
        errors.push(`Parameter ${param.name} must be ${param.type}, got ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format tool list for LLM prompt
 */
export function formatToolsForPrompt(agentName: string): string {
  const definitions = getToolDefinitions(agentName);

  return definitions.map(def => {
    const paramList = def.parameters.length > 0
      ? `(${def.parameters.map(p => `${p.name}: ${p.type}${p.required ? '' : '?'}`).join(', ')})`
      : '()';
    return `- ${def.name}${paramList}: ${def.description}`;
  }).join('\n');
}
