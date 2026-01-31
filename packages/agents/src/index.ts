/**
 * Argus AI Agent System
 *
 * A multi-agent AI system for Solana token analysis and protection.
 *
 * Architecture:
 * - Scouts: Monitor blockchain for new token launches
 * - Analysts: Deep investigation of suspicious tokens
 * - Hunters: Track scammer networks and repeat offenders
 * - Traders: Execute strategies based on agent consensus
 *
 * Core Components:
 * - BitNetEngine: 1-bit quantized AI for CPU inference
 * - AgentMemory: Vector storage with 17,000x compression
 * - MessageBus: Pub/sub inter-agent communication
 * - PatternLibrary: Knowledge base of scam patterns
 * - OutcomeLearner: Self-improvement through outcome tracking
 */

// Core - Classes
export { BaseAgent } from './core/BaseAgent';
export { MessageBus } from './core/MessageBus';
export { AgentMemory } from './core/AgentMemory';
export { AgentCoordinator } from './core/AgentCoordinator';

// Core - Types
export type { AgentConfig, Tool, ThoughtEntry, AgentAction } from './core/BaseAgent';
export type { Message, MessageHandler } from './core/MessageBus';
export type { MemoryEntry, SimilarityResult } from './core/AgentMemory';
export type { CoordinatorConfig, SystemStatus } from './core/AgentCoordinator';

// Agents - Classes
export { ScoutAgent } from './agents/ScoutAgent';
export { AnalystAgent } from './agents/AnalystAgent';
export { HunterAgent } from './agents/HunterAgent';
export { TraderAgent } from './agents/TraderAgent';

// Agents - Types
export type { QuickScanResult, LaunchEvent } from './agents/ScoutAgent';
export type { InvestigationRequest, InvestigationReport } from './agents/AnalystAgent';
export type { ScammerProfile } from './agents/HunterAgent';
export type { Position, TradingStrategy, TradeResult } from './agents/TraderAgent';

// Reasoning - Classes
export { BitNetEngine } from './reasoning/BitNetEngine';

// Reasoning - Types
export type { ClassifierOutput, ReasoningOutput, GenerateOptions } from './reasoning/BitNetEngine';

// Tools - Classes
export { OnChainTools } from './tools/OnChainTools';
export { AnalysisTools } from './tools/AnalysisTools';
export { TradingTools } from './tools/TradingTools';

// Tools - Types
export type { TokenData, HolderData, TransactionData, LPPoolData, WalletProfile } from './tools/OnChainTools';
export type { BundleDetectionResult, BundleCluster, WalletRelationship, TradingPattern, RiskFactors } from './tools/AnalysisTools';
export type { SwapQuote, TradeExecution, PositionSizing, SimulationResult } from './tools/TradingTools';

// Learning - Classes
export { OutcomeLearner } from './learning/OutcomeLearner';
export { PatternLibrary } from './learning/PatternLibrary';

// Learning - Types
export type { Prediction, Outcome, LearningStats, FeatureImportance } from './learning/OutcomeLearner';
export type { ScamPattern, PatternMatch, PatternStats } from './learning/PatternLibrary';

// Re-export convenience function to create and start the system
export async function createArgusNetwork(config: {
  rpcEndpoint: string;
  enableTrading?: boolean;
  scouts?: number;
  analysts?: number;
  hunters?: number;
  traders?: number;
  maxDailyTrades?: number;
  maxPositionSize?: number;
}) {
  const coordinator = new AgentCoordinator({
    rpcEndpoint: config.rpcEndpoint,
    enableTrading: config.enableTrading || false,
    scouts: config.scouts || 2,
    analysts: config.analysts || 1,
    hunters: config.hunters || 1,
    traders: config.traders || 1,
    maxDailyTrades: config.maxDailyTrades || 10,
    maxPositionSize: config.maxPositionSize || 0.1
  });

  await coordinator.initialize();

  return coordinator;
}

// Version
export const VERSION = '1.0.0';

// Feature compression constants (from feature-extractor)
export const FEATURE_CONSTANTS = {
  FEATURE_COUNT: 29,
  BYTES_PER_FEATURE: 4,
  TOTAL_BYTES: 116,
  COMPRESSION_RATIO: '17,000x',
  MEMORY_PER_100K_TOKENS: '11.6 MB'
};
