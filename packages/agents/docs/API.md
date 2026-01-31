# Argus Agents API Reference

Complete API documentation for the Argus AI Agent System.

---

## Table of Contents

- [Core Classes](#core-classes)
  - [AgentCoordinator](#agentcoordinator)
  - [MessageBus](#messagebus)
  - [AgentMemory](#agentmemory)
  - [BaseAgent](#baseagent)
- [Agent Classes](#agent-classes)
  - [ScoutAgent](#scoutagent)
  - [AnalystAgent](#analystagent)
  - [HunterAgent](#hunteragent)
  - [TraderAgent](#traderagent)
- [Reasoning](#reasoning)
  - [BitNetEngine](#bitnetengine)
- [Tools](#tools)
  - [OnChainTools](#onchaintools)
  - [AnalysisTools](#analysistools)
  - [TradingTools](#tradingtools)
- [Learning](#learning)
  - [OutcomeLearner](#outcomelearner)
  - [PatternLibrary](#patternlibrary)
- [Types & Interfaces](#types--interfaces)

---

## Core Classes

### AgentCoordinator

The central orchestrator that manages all agents and provides a unified API.

```typescript
import { AgentCoordinator, CoordinatorConfig } from '@argus/agents';
```

#### Constructor

```typescript
constructor(config: CoordinatorConfig)
```

**CoordinatorConfig**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `rpcEndpoint` | `string` | required | Solana RPC endpoint URL |
| `scouts` | `number` | `2` | Number of scout agents |
| `analysts` | `number` | `1` | Number of analyst agents |
| `hunters` | `number` | `1` | Number of hunter agents |
| `traders` | `number` | `1` | Number of trader agents |
| `enableTrading` | `boolean` | `false` | Enable autonomous trading |
| `maxDailyTrades` | `number` | `10` | Maximum trades per day |
| `maxPositionSize` | `number` | `0.1` | Maximum position size in SOL |

#### Methods

##### `initialize(): Promise<void>`

Initialize all agents. Must be called before `start()`.

```typescript
const coordinator = new AgentCoordinator({ rpcEndpoint: '...' });
await coordinator.initialize();
```

##### `start(): Promise<void>`

Start all agents and begin monitoring.

```typescript
await coordinator.start();
```

##### `stop(): Promise<void>`

Stop all agents gracefully.

```typescript
await coordinator.stop();
```

##### `analyzeToken(address: string, priority?: Priority): Promise<void>`

Request manual analysis of a specific token.

```typescript
await coordinator.analyzeToken('TokenMint123...', 'high');
```

**Priority**: `'low' | 'normal' | 'high' | 'critical'`

##### `checkWallet(address: string): Promise<WalletCheckResult>`

Check if a wallet is a known scammer.

```typescript
const result = await coordinator.checkWallet('WalletAddress...');
if (result.isRepeat) {
  console.log(`Known scammer with ${result.rugCount} previous rugs`);
}
```

**Returns**:
```typescript
interface WalletCheckResult {
  isRepeat: boolean;
  profile: ScammerProfile | null;
  rugCount: number;
}
```

##### `getStatus(): SystemStatus`

Get current system status.

```typescript
const status = coordinator.getStatus();
console.log(status.running, status.agents.total, status.health.healthy);
```

**Returns**:
```typescript
interface SystemStatus {
  running: boolean;
  uptime: number;
  agents: {
    scouts: number;
    analysts: number;
    hunters: number;
    traders: number;
    total: number;
  };
  stats: {
    tokensScanned: number;
    investigationsCompleted: number;
    scammersTracked: number;
    tradesExecuted: number;
    totalPnl: number;
  };
  health: {
    healthy: boolean;
    issues: string[];
  };
}
```

##### `getMessageBus(): MessageBus`

Get the message bus for external subscriptions.

```typescript
const bus = coordinator.getMessageBus();
bus.subscribe('user.alert', (msg) => console.log(msg.data));
```

##### `getAgent(name: string): BaseAgent | undefined`

Get a specific agent by name.

```typescript
const scout = coordinator.getAgent('scout-1');
```

##### `getScoutStats(): Array<{ name: string; stats: any }>`

Get statistics from all scout agents.

##### `getAnalystStats(): Array<{ name: string; stats: any }>`

Get statistics from all analyst agents.

##### `getHunterStats(): Array<{ name: string; stats: any }>`

Get statistics from all hunter agents.

##### `getTraderStats(): Array<{ name: string; stats: any }>`

Get statistics from all trader agents.

---

### MessageBus

Pub/sub messaging system for inter-agent communication.

```typescript
import { MessageBus } from '@argus/agents';
```

#### Constructor

```typescript
constructor()
```

#### Methods

##### `publish(topic: string, data: any, options?: MessageOptions): Promise<void>`

Publish a message to a topic.

```typescript
await messageBus.publish('token.analyzed', {
  token: '...',
  score: 75
}, { from: 'analyst-1' });
```

**MessageOptions**:
```typescript
interface MessageOptions {
  from?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  ttl?: number;  // Time to live in milliseconds
}
```

##### `subscribe(topic: string, handler: MessageHandler): () => void`

Subscribe to a topic. Returns unsubscribe function.

```typescript
const unsubscribe = messageBus.subscribe('alert.*', (msg) => {
  console.log(msg.topic, msg.data);
});

// Later...
unsubscribe();
```

**Wildcard Support**:
- `alert.*` - matches `alert.scam`, `alert.emergency`, etc.
- `agent.*.investigate` - matches `agent.analyst-1.investigate`, etc.

**MessageHandler**:
```typescript
type MessageHandler = (message: Message) => void | Promise<void>;

interface Message {
  topic: string;
  data: any;
  timestamp: number;
  from?: string;
  priority?: string;
}
```

##### `sendTo(agentName: string, type: string, data: any, from: string): Promise<void>`

Send a direct message to a specific agent.

```typescript
await messageBus.sendTo('analyst-1', 'investigate', {
  token: '...',
  priority: 'high'
}, 'scout-1');
```

##### `broadcastAlert(alertType: string, data: any, from: string): Promise<void>`

Broadcast an alert to all subscribers.

```typescript
await messageBus.broadcastAlert('scam_detected', {
  token: '...',
  severity: 'CRITICAL'
}, 'analyst-1');
```

##### `getHistory(topic?: string, limit?: number): Message[]`

Get recent message history.

```typescript
const recentAlerts = messageBus.getHistory('alert.*', 10);
```

---

### AgentMemory

Vector storage with cosine similarity search for pattern matching.

```typescript
import { AgentMemory } from '@argus/agents';
```

#### Constructor

```typescript
constructor(agentId: string)
```

#### Methods

##### `store(content: any, options?: StoreOptions): Promise<string>`

Store an entry in memory.

```typescript
const id = await memory.store({
  type: 'observation',
  content: 'Detected suspicious pattern'
}, { type: 'observation' });
```

**StoreOptions**:
```typescript
interface StoreOptions {
  type?: 'observation' | 'action' | 'outcome';
  vector?: Float32Array;
  tags?: string[];
}
```

##### `storeToken(address: string, features: Float32Array, metadata: any): Promise<string>`

Store a token with its feature vector for similarity search.

```typescript
const id = await memory.storeToken(
  'TokenAddress...',
  featureVector,
  { score: 75, flags: ['BUNDLE_DETECTED'] }
);
```

##### `findSimilar(vector: Float32Array, limit: number, threshold: number): Promise<SimilarityResult[]>`

Find tokens with similar feature vectors.

```typescript
const similar = await memory.findSimilar(features, 5, 0.85);
for (const result of similar) {
  console.log(result.entry.content.token, result.similarity);
}
```

**Returns**:
```typescript
interface SimilarityResult {
  entry: MemoryEntry;
  similarity: number;  // 0-1, cosine similarity
}
```

##### `recall(query: string, limit?: number): Promise<MemoryEntry[]>`

Recall entries matching a query string.

```typescript
const entries = await memory.recall('scam detected', 10);
```

##### `getStats(): MemoryStats`

Get memory statistics.

```typescript
const stats = memory.getStats();
console.log(`${stats.totalEntries} entries, ${stats.vectorCount} vectors`);
```

---

### BaseAgent

Abstract base class for all agents. Provides core functionality.

```typescript
import { BaseAgent, AgentConfig } from '@argus/agents';
```

#### Constructor

```typescript
constructor(config: AgentConfig, messageBus: MessageBus)
```

**AgentConfig**:
```typescript
interface AgentConfig {
  name: string;
  role: string;
  model: string;
  tools: Tool[];
  memory: boolean;
  reasoning: boolean;
  maxReasoningSteps?: number;
}
```

#### Abstract Methods (Implement in Subclass)

```typescript
protected abstract onInitialize(): Promise<void>;
protected abstract run(): Promise<void>;
protected abstract setupMessageHandlers(): void;
```

#### Inherited Methods

##### `initialize(): Promise<void>`

Initialize the agent. Loads model and calls `onInitialize()`.

##### `start(): Promise<void>`

Start the agent's main loop.

##### `stop(): Promise<void>`

Stop the agent gracefully.

##### `getStatus(): AgentStatus`

Get agent status.

```typescript
interface AgentStatus {
  name: string;
  role: string;
  running: boolean;
  thoughtCount: number;
  memoryStats: any;
}
```

##### `getThoughts(limit?: number): ThoughtEntry[]`

Get recent thoughts.

```typescript
interface ThoughtEntry {
  timestamp: number;
  type: 'observation' | 'reasoning' | 'action' | 'reflection';
  content: string;
  confidence?: number;
}
```

#### Protected Methods (For Subclasses)

##### `think(type: ThoughtType, content: string, confidence?: number): Promise<void>`

Record a thought.

```typescript
await this.think('observation', 'Detected new token launch');
await this.think('reasoning', 'Analyzing bundle patterns...', 0.85);
```

##### `reasoningLoop(context: string): Promise<AgentAction | null>`

Execute a multi-step reasoning loop.

```typescript
const action = await this.reasoningLoop('Evaluate this token for risks');
if (action) {
  await this.executeAction(action);
}
```

##### `executeAction(action: AgentAction): Promise<any>`

Execute a tool action.

```typescript
interface AgentAction {
  tool: string;
  params: Record<string, any>;
  reason: string;
}
```

##### `classifyRisk(features: Float32Array): Promise<ClassifierOutput>`

Classify token risk using the BitNet engine.

##### `sendMessage(target: string, type: string, data: any): Promise<void>`

Send message to another agent.

##### `broadcastAlert(type: string, data: any): Promise<void>`

Broadcast an alert.

---

## Agent Classes

### ScoutAgent

Monitors blockchain for new token launches and performs quick scans.

```typescript
import { ScoutAgent } from '@argus/agents';

const scout = new ScoutAgent(messageBus, {
  name: 'scout-1',
  rpcEndpoint: 'https://api.mainnet-beta.solana.com'
});
```

#### Methods

##### `getStats(): ScoutStats`

```typescript
interface ScoutStats {
  lastSlot: number;
  scanCount: number;
  flaggedCount: number;
  flagRate: number;
}
```

#### Tools

| Tool | Description |
|------|-------------|
| `get_current_slot` | Get current blockchain slot |
| `find_new_launches` | Find new token launches since last check |
| `quick_scan` | Perform quick security scan on token |
| `flag_suspicious` | Flag token as suspicious and alert analysts |

#### Message Channels

- **Listens**: `agent.scout-*.scan`, `agent.scout-*.checkpoint`
- **Publishes**: `agent.analyst.investigate`, `alert.high_risk_token`

---

### AnalystAgent

Performs deep investigation of suspicious tokens.

```typescript
import { AnalystAgent } from '@argus/agents';

const analyst = new AnalystAgent(messageBus, {
  name: 'analyst-1'
});
```

#### Methods

##### `getStats(): AnalystStats`

```typescript
interface AnalystStats {
  queueSize: number;
  completedCount: number;
  isInvestigating: boolean;
}
```

#### Tools

| Tool | Description |
|------|-------------|
| `get_full_token_data` | Fetch comprehensive token data |
| `analyze_bundles` | Deep analysis of bundle patterns |
| `analyze_holders` | Analyze holder distribution |
| `check_creator_history` | Check creator wallet for past rugs |
| `generate_report` | Generate investigation report |
| `recommend_action` | Recommend action based on findings |

#### Message Channels

- **Listens**: `agent.analyst-*.investigate`, `agent.analyst-*.query`
- **Publishes**: `agent.coordinator.investigation_complete`, `agent.hunter.track_scammer`, `agent.trader.opportunity`

#### Investigation Report

```typescript
interface InvestigationReport {
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
```

---

### HunterAgent

Tracks scammer networks and detects repeat offenders.

```typescript
import { HunterAgent } from '@argus/agents';

const hunter = new HunterAgent(messageBus, {
  name: 'hunter-1'
});
```

#### Methods

##### `trackScammer(token: string, report: InvestigationReport): Promise<void>`

Track a scammer from an investigation report.

##### `getStats(): HunterStats`

```typescript
interface HunterStats {
  profileCount: number;
  watchlistSize: number;
  networkNodes: number;
}
```

#### Tools

| Tool | Description |
|------|-------------|
| `profile_wallet` | Build comprehensive wallet profile |
| `find_connections` | Map wallet connections and networks |
| `detect_pattern` | Identify scam patterns from behavior |
| `add_to_watchlist` | Add wallet to active monitoring |
| `broadcast_alert` | Alert network about active scammer |
| `check_repeat_offender` | Check if wallet is known repeat offender |

#### Message Channels

- **Listens**: `agent.hunter-*.track_scammer`, `agent.hunter-*.check_wallet`, `agent.hunter-*.get_network`
- **Publishes**: `alert.scammer`, `user.alert`, `agent.analyst.investigate`

#### Scammer Profile

```typescript
interface ScammerProfile {
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
```

---

### TraderAgent

Executes trading strategies based on agent consensus.

```typescript
import { TraderAgent } from '@argus/agents';

const trader = new TraderAgent(messageBus, {
  name: 'trader-1',
  maxPositionSize: 0.1,
  maxDailyTrades: 10
});
```

#### Methods

##### `getStats(): TraderStats`

```typescript
interface TraderStats {
  positionCount: number;
  totalInvested: number;
  totalPnl: number;
  dailyTradeCount: number;
  winRate: number;
}
```

#### Tools

| Tool | Description |
|------|-------------|
| `evaluate_opportunity` | Evaluate token for trading opportunity |
| `execute_buy` | Execute buy order |
| `execute_sell` | Execute sell order |
| `update_stop_loss` | Update position stop loss |
| `emergency_exit` | Emergency exit position(s) |
| `get_position` | Get position details |

#### Message Channels

- **Listens**: `agent.trader-*.opportunity`, `agent.trader-*.exit`, `alert.scammer`, `alert.emergency`
- **Publishes**: `agent.trader-*.trade_executed`, `user.alert`

#### Trading Strategies

```typescript
type Strategy = 'SAFE_EARLY' | 'MOMENTUM' | 'SNIPER';

interface TradingStrategy {
  name: Strategy;
  minScore: number;      // Minimum safety score
  maxAge: number;        // Maximum token age (hours)
  minLiquidity: number;  // Minimum liquidity (USD)
  positionSize: number;  // Position size multiplier
  stopLoss: number;      // Stop loss percentage
  takeProfit: number;    // Take profit percentage
}
```

#### Position

```typescript
interface Position {
  token: string;
  entryPrice: number;
  amount: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  strategy: Strategy;
  currentPrice?: number;
  pnl?: number;
  pnlPercent?: number;
}
```

---

## Reasoning

### BitNetEngine

1-bit quantized AI engine for CPU inference.

```typescript
import { BitNetEngine } from '@argus/agents';

const engine = new BitNetEngine('./models/argus-sentinel-v1.bitnet');
await engine.loadModel();
```

#### Methods

##### `loadModel(): Promise<void>`

Load the BitNet model.

##### `classify(features: Float32Array): Promise<ClassifierOutput>`

Classify token risk from feature vector.

```typescript
const result = await engine.classify(features);
console.log(result.riskScore, result.verdict);
```

**Returns**:
```typescript
interface ClassifierOutput {
  riskScore: number;           // 0-100
  verdict: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  confidence: number;          // 0-1
  flags: RiskFlag[];
  processingTime: number;      // milliseconds
}

interface RiskFlag {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  contribution: number;
}
```

##### `reason(context: string, availableTools: string[]): Promise<ReasoningOutput>`

Perform multi-step reasoning.

```typescript
const result = await engine.reason(
  'Analyze this token for bundle manipulation',
  ['analyze_bundles', 'check_creator_history']
);
```

**Returns**:
```typescript
interface ReasoningOutput {
  thought: string;
  confidence: number;
  action?: AgentAction;
}
```

##### `generate(options: GenerateOptions): Promise<string>`

Generate text response.

```typescript
const response = await engine.generate({
  prompt: 'Summarize these findings...',
  maxTokens: 256,
  format: 'json'
});
```

##### `matchPatterns(features: Float32Array): Promise<PatternMatch[]>`

Match features against known scam patterns.

```typescript
const matches = await engine.matchPatterns(features);
for (const match of matches) {
  console.log(match.pattern, match.similarity);
}
```

---

## Tools

### OnChainTools

Blockchain data fetching utilities.

```typescript
import { OnChainTools } from '@argus/agents';

const tools = new OnChainTools({
  rpcEndpoint: 'https://api.mainnet-beta.solana.com',
  heliusApiKey: 'optional-api-key'
});
```

#### Methods

##### `getTokenData(address: string): Promise<TokenData | null>`

```typescript
interface TokenData {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  creator: string;
  createdAt: number;
}
```

##### `getHolders(address: string, limit?: number): Promise<HolderData[]>`

```typescript
interface HolderData {
  address: string;
  balance: number;
  percent: number;
  isCreator: boolean;
  isLP: boolean;
}
```

##### `getTransactions(address: string, limit?: number): Promise<TransactionData[]>`

```typescript
interface TransactionData {
  signature: string;
  slot: number;
  timestamp: number;
  type: 'buy' | 'sell' | 'transfer' | 'mint' | 'burn' | 'unknown';
  from: string;
  to: string;
  amount: number;
  price?: number;
}
```

##### `getLPPool(address: string): Promise<LPPoolData | null>`

```typescript
interface LPPoolData {
  address: string;
  dex: 'raydium' | 'orca' | 'meteora' | 'pumpfun' | 'unknown';
  token: string;
  pairedToken: string;
  liquidity: number;
  lpBurned: boolean;
  lpLocked: boolean;
  lockExpiry?: number;
}
```

##### `profileWallet(address: string): Promise<WalletProfile | null>`

```typescript
interface WalletProfile {
  address: string;
  age: number;
  transactionCount: number;
  tokensHeld: number;
  tokensCreated: number;
  totalVolume: number;
  lastActive: number;
}
```

##### `getCurrentSlot(): Promise<number>`

##### `getBalance(address: string): Promise<number>`

##### `batchGetTokens(addresses: string[]): Promise<Map<string, TokenData>>`

##### `watchNewMints(options?): AsyncGenerator<TokenData>`

---

### AnalysisTools

Advanced analysis utilities.

```typescript
import { AnalysisTools } from '@argus/agents';

const tools = new AnalysisTools();
```

#### Methods

##### `detectBundles(holders, transactions, options?): BundleDetectionResult`

```typescript
interface BundleDetectionResult {
  detected: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  bundles: BundleCluster[];
  totalWallets: number;
  controlPercent: number;
  assessment: string;
}

interface BundleCluster {
  id: string;
  wallets: string[];
  totalHoldings: number;
  percent: number;
  fundingSource?: string;
  createdWithin: number;
  signals: string[];
}
```

##### `mapWalletRelationships(wallets, transactions): WalletRelationship[]`

```typescript
interface WalletRelationship {
  wallet1: string;
  wallet2: string;
  relationship: 'FUNDER' | 'FUNDED' | 'SIBLING' | 'COORDINATED' | 'UNKNOWN';
  confidence: number;
  evidence: string[];
}
```

##### `analyzeTradingPattern(transactions, timeWindow?): TradingPattern`

```typescript
interface TradingPattern {
  pattern: 'ACCUMULATION' | 'DISTRIBUTION' | 'WASH_TRADING' | 'PUMP_AND_DUMP' | 'ORGANIC' | 'UNKNOWN';
  confidence: number;
  signals: string[];
  metrics: {
    buyRatio: number;
    volumeConcentration: number;
    priceImpact: number;
    uniqueTraders: number;
  };
}
```

##### `calculateRiskFactors(holders, bundleResult, tokenData): RiskFactors`

```typescript
interface RiskFactors {
  bundleRisk: number;
  concentrationRisk: number;
  liquidityRisk: number;
  securityRisk: number;
  patternRisk: number;
  creatorRisk: number;
  overall: number;
  flags: string[];
}
```

##### `calculateGini(values: number[]): number`

Calculate Gini coefficient (0 = equal, 1 = concentrated).

---

### TradingTools

Jupiter swap integration.

```typescript
import { TradingTools } from '@argus/agents';

const tools = new TradingTools({
  rpcEndpoint: 'https://api.mainnet-beta.solana.com'
});
```

#### Methods

##### `getQuote(input, output, amount, slippage?): Promise<SwapQuote | null>`

```typescript
interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  slippage: number;
  route: string[];
  fee: number;
  expiresAt: number;
}
```

##### `executeSwap(quote, wallet, signTx): Promise<TradeExecution>`

```typescript
interface TradeExecution {
  success: boolean;
  signature?: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  fee: number;
  error?: string;
  timestamp: number;
}
```

##### `calculatePositionSize(portfolio, riskScore, liquidity, options?): PositionSizing`

```typescript
interface PositionSizing {
  recommendedSize: number;
  maxSize: number;
  minSize: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  reasoning: string[];
}
```

##### `simulateTrade(input, output, amount): Promise<SimulationResult>`

```typescript
interface SimulationResult {
  wouldSucceed: boolean;
  estimatedOutput: number;
  priceImpact: number;
  warnings: string[];
  gasEstimate: number;
}
```

##### `calculateStopLoss(entryPrice, riskScore, options?): number`

##### `calculateTakeProfit(entryPrice, riskScore, options?): number`

##### `getTokenPrice(address: string): Promise<number | null>`

##### `calculatePnL(entry, current, amount, fee?): PnLResult`

##### `validateTrade(quote, constraints): ValidationResult`

##### `batchGetPrices(addresses: string[]): Promise<Map<string, number>>`

---

## Learning

### OutcomeLearner

Tracks predictions vs outcomes for self-improvement.

```typescript
import { OutcomeLearner } from '@argus/agents';

const learner = new OutcomeLearner();
```

#### Methods

##### `recordPrediction(prediction): string`

```typescript
interface Prediction {
  token: string;
  timestamp: number;
  riskScore: number;
  verdict: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
  confidence: number;
  features: Float32Array;
  patterns: string[];
  source: string;
}
```

##### `recordOutcome(predictionId, outcome): void`

```typescript
interface Outcome {
  token: string;
  outcome: 'RUG' | 'DUMP' | 'STABLE' | 'MOON' | 'UNKNOWN';
  priceChange: number;
  liquidityChange: number;
  details: string;
}
```

##### `getStats(): LearningStats`

```typescript
interface LearningStats {
  totalPredictions: number;
  totalOutcomes: number;
  accuracy: {
    overall: number;
    byVerdict: Record<string, number>;
    byPattern: Record<string, number>;
  };
  falsePositives: number;
  falseNegatives: number;
  improvements: Array<{
    date: number;
    metric: string;
    before: number;
    after: number;
  }>;
}
```

##### `getFeatureImportance(): FeatureImportance[]`

```typescript
interface FeatureImportance {
  featureIndex: number;
  featureName: string;
  importance: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}
```

##### `getWeightedRiskScore(features): number`

Get risk score using learned weights.

##### `getPendingOutcomes(maxAge?): Prediction[]`

Get predictions awaiting outcome verification.

##### `getSimilarPredictions(features, threshold?, limit?): SimilarPrediction[]`

##### `analyzeRugPatterns(): RugPatternAnalysis`

##### `exportWeights(): WeightExport`

##### `importWeights(weights): void`

##### `cleanup(maxAge?): number`

---

### PatternLibrary

Knowledge base of scam patterns.

```typescript
import { PatternLibrary } from '@argus/agents';

const library = new PatternLibrary();
```

#### Methods

##### `matchPatterns(features, options?): PatternMatch[]`

```typescript
interface PatternMatch {
  pattern: ScamPattern;
  similarity: number;
  matchedIndicators: string[];
  confidence: number;
}
```

##### `recordDetection(patternId, wasRug, tokenAddress?): void`

##### `getPattern(id): ScamPattern | undefined`

##### `getAllPatterns(): ScamPattern[]`

##### `getHighSeverityPatterns(): ScamPattern[]`

##### `getStats(): PatternStats`

```typescript
interface PatternStats {
  totalPatterns: number;
  activePatterns: number;
  totalDetections: number;
  avgRugRate: number;
  topPatterns: Array<{ name: string; detections: number; rugRate: number }>;
}
```

##### `createPatternFromObservation(name, description, examples, indicators, severity): ScamPattern`

##### `deactivatePattern(id): void`

##### `exportPatterns(): PatternExport`

##### `importPatterns(data): void`

---

## Types & Interfaces

### Common Types

```typescript
type Priority = 'low' | 'normal' | 'high' | 'critical';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Verdict = 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' | 'SCAM';
type OutcomeType = 'RUG' | 'DUMP' | 'STABLE' | 'MOON' | 'UNKNOWN';
type ThoughtType = 'observation' | 'reasoning' | 'action' | 'reflection';
type PatternType = 'BUNDLE_COORDINATOR' | 'RUG_PULLER' | 'WASH_TRADER' | 'INSIDER' | 'UNKNOWN';
```

### Feature Vector

```typescript
// 29 features, 116 bytes total
type FeatureVector = Float32Array; // length: 29

// Feature indices
const FEATURES = {
  // Market (0-4)
  LIQUIDITY_LOG: 0,
  VOLUME_TO_LIQUIDITY: 1,
  MARKET_CAP_LOG: 2,
  PRICE_VELOCITY: 3,
  VOLUME_LOG: 4,
  // Holders (5-10)
  HOLDER_COUNT_LOG: 5,
  TOP10_CONCENTRATION: 6,
  GINI_COEFFICIENT: 7,
  FRESH_WALLET_RATIO: 8,
  WHALE_COUNT: 9,
  TOP_WHALE_PERCENT: 10,
  // Security (11-14)
  MINT_DISABLED: 11,
  FREEZE_DISABLED: 12,
  LP_LOCKED: 13,
  LP_BURNED: 14,
  // Bundle (15-19)
  BUNDLE_DETECTED: 15,
  BUNDLE_COUNT_NORM: 16,
  BUNDLE_CONTROL_PERCENT: 17,
  BUNDLE_CONFIDENCE: 18,
  BUNDLE_QUALITY: 19,
  // Trading (20-23)
  BUY_RATIO_24H: 20,
  BUY_RATIO_1H: 21,
  ACTIVITY_LEVEL: 22,
  MOMENTUM: 23,
  // Time (24-25)
  AGE_DECAY: 24,
  TRADING_RECENCY: 25,
  // Creator (26-28)
  CREATOR_IDENTIFIED: 26,
  CREATOR_RUG_HISTORY: 27,
  CREATOR_HOLDINGS: 28
};
```
