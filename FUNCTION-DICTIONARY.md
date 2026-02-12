# Argus AI - Function Dictionary

Comprehensive reference for all analysis, trading, and AI functions in the codebase.

---

## Table of Contents

1. [Workers - On-Chain Analysis](#workers---on-chain-analysis)
2. [Workers - Data Fetching](#workers---data-fetching)
3. [Workers - AI & Inference](#workers---ai--inference)
4. [Workers - Feature Extraction](#workers---feature-extraction)
5. [Workers - Pump.fun](#workers---pumpfun)
6. [Workers - Bundle & Rug Detection](#workers---bundle--rug-detection)
7. [Workers - Helius Integration](#workers---helius-integration)
8. [Agents - AI Reasoning](#agents---ai-reasoning)
9. [Agents - Learning](#agents---learning)
10. [Agents - Tools](#agents---tools)
11. [Agents - Services](#agents---services)
12. [Monitor - Real-Time](#monitor---real-time)

---

## Workers - On-Chain Analysis

### `OnChainAnalyzer` class
**File:** `packages/workers/src/services/onchain-analyzer.ts`

Full on-chain token analysis with holder distribution, bundle detection, and volume estimation.

#### `analyze(mint: string)`
Complete token analysis combining all methods.

```typescript
const analyzer = new OnChainAnalyzer(rpcClient);
const result = await analyzer.analyze('TokenMintAddress...');
// Returns: OnChainAnalysis
```

**Returns:**
```typescript
interface OnChainAnalysis {
  metadata: TokenMetadata;
  holders: TokenHolder[];
  pools: LiquidityPool[];
  totalLiquidity: number;
  price?: number;
  marketCap?: number;
  volume24h?: number;
  txns24h?: { buys: number; sells: number };
  ageHours?: number;
  bundle: BundleAnalysis;
  creatorAddress: string | null;
  creatorHoldings: number;
}
```

---

#### `getTopHolders(mint: string, limit?: number)`
**Lines:** 339-387

Fetches top token holders with LP detection.

```typescript
const holders = await analyzer.getTopHolders('TokenMint...', 20);
```

**Returns:**
```typescript
interface TokenHolder {
  address: string;
  tokenAccount: string;
  balance: number;
  percent: number;
  isLp: boolean;  // Liquidity pool detection
}
```

**RPC Calls:** 2 (`getTokenLargestAccounts`, `getMultipleAccounts`)

---

#### `detectBundles(mint: string)`
**Lines:** 425-589

Detects coordinated wallet clusters via same-block transaction analysis.

```typescript
const bundles = await analyzer.detectBundles('TokenMint...');
```

**Returns:**
```typescript
interface BundleAnalysis {
  detected: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  bundleCount: number;
  totalPercent: number;
  wallets: string[];
  sameBlockTxns: number;
}
```

**RPC Calls:** 3+ (`getSignaturesForAddress`, `getTransaction` per signature)

---

#### `estimateVolume(mint: string)`
**Lines:** 595-657

Estimates 24h volume by sampling recent transactions.

```typescript
const volume = await analyzer.estimateVolume('TokenMint...');
```

**Returns:**
```typescript
{
  volume24h: number;
  txns24h: { buys: number; sells: number };
}
```

**RPC Calls:** 1-50 (samples transactions)

---

## Workers - Data Fetching

### `fetchTokenData(mint: string, rpcEndpoint: string)`
**File:** `packages/workers/src/services/solana-data.ts:75`

Comprehensive on-chain data fetch for a token.

```typescript
const data = await fetchTokenData('TokenMint...', RPC_URL);
```

**Returns:**
```typescript
interface TokenOnChainData {
  tokenAddress: string;
  tokenName?: string;
  tokenSymbol?: string;
  decimals: number;
  totalSupply: number;
  totalHolders: number;
  topHolders: HolderInfo[];
  top10HolderPercent: number;
  top1HolderPercent: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  lpInfo?: LPInfo;
  creatorAddress?: string;
  creatorBalance?: number;
}
```

---

### `analyzeTradingPatterns(transactions: Transaction[])`
**File:** `packages/workers/src/services/solana-data.ts:521-541`

Analyzes transaction history for buy/sell patterns.

```typescript
const patterns = analyzeTradingPatterns(transactions);
```

**Returns:**
```typescript
{
  buyCount24h: number;
  sellCount24h: number;
  uniqueBuyers24h: number;
  uniqueSellers24h: number;
}
```

---

### `fetchDexScreenerData(tokenAddress: string)`
**File:** `packages/workers/src/services/dexscreener.ts:52`

Fetches market data from DexScreener API.

```typescript
const data = await fetchDexScreenerData('TokenMint...');
```

**Returns:**
```typescript
interface DexScreenerData {
  pairs: DexPair[];
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  fdv: number;
  txns24h: { buys: number; sells: number };
}
```

**Cost:** FREE (DexScreener API)

---

### `SentinelDataFetcher` class
**File:** `packages/workers/src/services/sentinel-data.ts:97`

Combined data fetcher for sentinel analysis endpoint.

```typescript
const fetcher = createSentinelDataFetcher(env);
const data = await fetcher.fetch('TokenMint...');
```

**Returns:** `SentinelDataResult` with all token info, holders, market data.

---

### `DataProvider` class
**File:** `packages/workers/src/services/data-provider.ts:101`

Unified data provider with caching.

```typescript
const provider = createDataProvider(env);
const data = await provider.getTokenData('TokenMint...');
```

---

## Workers - AI & Inference

### `BitNetInferenceEngine` class
**File:** `packages/workers/src/services/bitnet-inference.ts:77`

1-bit quantized neural network for risk classification.

#### `classify(features: Float32Array)`

```typescript
const engine = await getBitNetEngine(config);
const result = await engine.classify(featureVector);
```

**Returns:**
```typescript
interface ClassifierOutput {
  riskScore: number;        // 0-100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;       // 0-100
  signal: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'AVOID';
  flags: RiskFlag[];
  featureImportance: Record<string, number>;
}
```

**Input:** 29-dimension feature vector (Float32Array)
**Inference Time:** ~13ms on CPU

---

### `TogetherAIProvider` class (LEGACY - NOT USED)
**File:** `packages/workers/src/services/ai-provider.ts:176`

Together AI integration - **deprecated in favor of self-hosted Ollama**.

---

### `HybridProvider` class
**File:** `packages/workers/src/services/ai-provider.ts:399`

Combines BitNet + LLM for hybrid analysis.

```typescript
const provider = new HybridProvider(config);
const result = await provider.analyze(input);
```

---

### `analyzeForHoneypot(data: TokenData, apiKey: string)` (LEGACY)
**File:** `packages/workers/src/services/together-ai.ts:27`

AI-powered honeypot detection - **use BitNet + Ollama instead**.

**Preferred:** Use `BitNetEngine.classify()` + `LLMService` for self-hosted inference.

---

## Workers - Feature Extraction

### `extractFromSentinelData(data: SentinelDataResult)`
**File:** `packages/workers/src/services/feature-extractor.ts:187`

Extracts 29-dimension feature vector from sentinel data.

```typescript
const features = extractFromSentinelData(sentinelData);
```

**Returns:** `CompressedFeatures` object

---

### `toFeatureVector(features: CompressedFeatures)`
**File:** `packages/workers/src/services/feature-extractor.ts:383`

Converts features to Float32Array for BitNet input.

```typescript
const vector = toFeatureVector(features);
// Returns: Float32Array(29)
```

---

### Feature Vector Dimensions (29 total)

| Index | Feature | Description |
|-------|---------|-------------|
| 0 | liquidityLog | Log-normalized liquidity |
| 1 | volumeToLiquidity | Volume/liquidity ratio (wash trading indicator) |
| 2 | marketCapLog | Log-normalized market cap |
| 3 | priceVelocity | 24h price change normalized |
| 4 | volumeLog | Log-normalized volume |
| 5 | holderCountLog | Log-normalized holder count |
| 6 | top10Concentration | % held by top 10 |
| 7 | giniCoefficient | Holder inequality (0-1) |
| 8 | freshWalletRatio | % holders with no history |
| 9 | whaleCount | Holders with >10% |
| 10 | topWhalePercent | Largest holder % |
| 11 | mintDisabled | 1 if mint authority revoked |
| 12 | freezeDisabled | 1 if freeze authority revoked |
| 13 | lpLocked | LP lock percentage |
| 14 | lpBurned | LP burn percentage |
| 15 | bundleDetected | 1 if bundles found |
| 16 | bundleCountNorm | Normalized bundle count |
| 17 | bundleControlPercent | % held by bundles |
| 18 | bundleConfidence | Bundle detection confidence |
| 19 | bundleQuality | Bundle sophistication |
| 20 | buyRatio24h | 24h buy ratio |
| 21 | buyRatio1h | 1h buy ratio |
| 22 | activityLevel | Transaction activity |
| 23 | momentum | 1h vs 24h buy ratio diff |
| 24 | ageDecay | Token age factor |
| 25 | tradingRecency | Recent trading activity |
| 26 | creatorIdentified | 1 if creator known |
| 27 | creatorRugHistory | Creator's rug count |
| 28 | creatorHoldings | Creator's current holdings |

---

### `quantizeToInt8(features: CompressedFeatures)`
**File:** `packages/workers/src/services/feature-extractor.ts:524`

Compresses features to 29 bytes for storage.

```typescript
const compressed = quantizeToInt8(features);
// Returns: Int8Array(29) - 29 bytes total
```

---

## Workers - Pump.fun

### `getPumpfunBondingCurve(mint: string, rpcEndpoint: string)`
**File:** `packages/workers/src/services/pumpfun.ts:156`

Fetches bonding curve state for Pump.fun tokens.

```typescript
const curve = await getPumpfunBondingCurve('TokenMint...', RPC_URL);
```

**Returns:**
```typescript
interface BondingCurveState {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;  // true = graduated to Raydium
}
```

---

### `calculatePumpfunPrice(curve: BondingCurveState)`
**File:** `packages/workers/src/services/pumpfun.ts:212`

Calculates current price from bonding curve.

```typescript
const priceInSol = calculatePumpfunPrice(curve);
```

**Formula:** `virtualSolReserves / virtualTokenReserves`

---

### `calculatePumpfunLiquidity(curve: BondingCurveState)`
**File:** `packages/workers/src/services/pumpfun.ts:225`

Calculates liquidity in SOL from bonding curve.

```typescript
const liquiditySol = calculatePumpfunLiquidity(curve);
```

---

### `isPumpfunToken(mint: string)`
**File:** `packages/workers/src/services/pumpfun.ts:39`

Checks if token is a Pump.fun token.

```typescript
const isPumpfun = isPumpfunToken('TokenMint...');
```

---

## Workers - Bundle & Rug Detection

### `runRugDetection(tokens: string[], db: D1Database)`
**File:** `packages/workers/src/services/rug-detector.ts:101`

Batch rug detection for multiple tokens.

```typescript
const results = await runRugDetection(tokenList, db);
```

---

### `findRepeatOffenders(db: D1Database, minRugs?: number)`
**File:** `packages/workers/src/services/bundle-network.ts:104`

Finds wallets involved in multiple rugs.

```typescript
const offenders = await findRepeatOffenders(db, 2);
```

**Returns:** Array of wallet addresses with rug history.

---

### `storeBundleWallets(db: D1Database, wallets: BundleWallet[])`
**File:** `packages/workers/src/services/bundle-network.ts:54`

Stores bundle wallet data for tracking.

```typescript
await storeBundleWallets(db, detectedWallets);
```

---

### `markTokenAsRugged(db: D1Database, token: string, creator: string)`
**File:** `packages/workers/src/services/bundle-network.ts:207`

Records a token rug for learning.

```typescript
await markTokenAsRugged(db, tokenMint, creatorWallet);
```

---

## Workers - Helius Integration

### `findTokenCreator(mint: string, apiKey: string)`
**File:** `packages/workers/src/services/helius.ts:24`

Finds the original creator/deployer of a token.

```typescript
const creator = await findTokenCreator('TokenMint...', HELIUS_KEY);
```

**Returns:** Creator wallet address or null.

---

### `analyzeCreatorWallet(wallet: string, apiKey: string)`
**File:** `packages/workers/src/services/helius.ts:704`

Deep analysis of creator wallet history.

```typescript
const analysis = await analyzeCreatorWallet('WalletAddress...', HELIUS_KEY);
```

**Returns:**
```typescript
{
  totalTokensDeployed: number;
  rugCount: number;
  successfulProjects: number;
  avgTokenLifespan: number;
  riskScore: number;
}
```

---

### `analyzeInsiders(mint: string, apiKey: string)`
**File:** `packages/workers/src/services/helius.ts:1302`

Detects insider wallets and early buyers.

```typescript
const insiders = await analyzeInsiders('TokenMint...', HELIUS_KEY);
```

**Returns:** List of suspected insider wallets with evidence.

---

### `analyzeDevSelling(mint: string, creator: string, apiKey: string)`
**File:** `packages/workers/src/services/helius.ts:1044`

Tracks developer selling activity.

```typescript
const selling = await analyzeDevSelling(mint, creator, HELIUS_KEY);
```

**Returns:**
```typescript
{
  totalSold: number;
  percentSold: number;
  sellTransactions: Transaction[];
  isSelling: boolean;
}
```

---

### `analyzeTokenTransactions(mint: string, apiKey: string, limit?: number)`
**File:** `packages/workers/src/services/helius.ts:906`

Full transaction history analysis.

```typescript
const txns = await analyzeTokenTransactions(mint, HELIUS_KEY, 100);
```

---

### `fetchHeliusTokenMetadata(mint: string, apiKey: string)`
**File:** `packages/workers/src/services/helius.ts:614`

Fetches token metadata via Helius DAS API.

```typescript
const metadata = await fetchHeliusTokenMetadata(mint, HELIUS_KEY);
```

---

## Agents - AI Reasoning

### `BitNetEngine` class
**File:** `packages/agents/src/reasoning/BitNetEngine.ts:93`

1-bit quantized neural network for risk classification. Runs on server CPU.

**Model:** `argus-sentinel-v1.bitnet`

#### `classify(features: Float32Array)`

```typescript
const engine = new BitNetEngine();
await engine.loadWeights(weightsJson);
const result = await engine.classify(featureVector);
```

**Returns:** `ClassifierOutput` with risk score, flags, feature importance.
**Inference Time:** ~13ms on CPU

---

### `PatternLibrary` class
**File:** `packages/agents/src/learning/PatternLibrary.ts:43`

8 known scam pattern templates for matching.

#### `matchPatterns(features: Float32Array, options?: MatchOptions)`

```typescript
const library = new PatternLibrary();
const matches = library.matchPatterns(features, { minSimilarity: 0.5 });
```

**Returns:**
```typescript
interface PatternMatch {
  pattern: ScamPattern;
  confidence: number;
  matchedIndicators: string[];
}
```

**Known Patterns:**
| Pattern | Severity | Rug Rate |
|---------|----------|----------|
| BUNDLE_COORDINATOR | HIGH | 75% |
| RUG_PULLER | CRITICAL | 90% |
| WASH_TRADER | MEDIUM | 60% |
| INSIDER | HIGH | 50% |
| PUMP_AND_DUMP | HIGH | 80% |
| HONEYPOT | CRITICAL | 100% |
| MICRO_CAP_TRAP | MEDIUM | 55% |
| LEGITIMATE_VC | LOW | 5% |

---

### `OutcomeLearner` class
**File:** `packages/agents/src/learning/OutcomeLearner.ts:120`

Self-improving prediction tracker.

#### `recordPrediction(token: string, prediction: Prediction)`
#### `recordOutcome(token: string, outcome: Outcome)`
#### `getStats()`

```typescript
const learner = new OutcomeLearner();
learner.recordPrediction(token, { signal: 'BUY', score: 72 });
// Later...
learner.recordOutcome(token, { rugged: false, returnPercent: 45 });
const stats = learner.getStats();
// { accuracy: 0.73, totalPredictions: 150, ... }
```

---

### `DebateProtocol` class
**File:** `packages/agents/src/reasoning/DebateProtocol.ts:120`

Multi-agent debate for consensus decisions.

```typescript
const protocol = new DebateProtocol(agents, llmService);
const decision = await protocol.debate(proposal);
```

---

### `ReActLoop` class
**File:** `packages/agents/src/reasoning/ReActLoop.ts:90`

Reasoning + Acting loop for agent decisions.

```typescript
const loop = createReActLoop(agent, tools, llm);
const result = await loop.run(task);
```

---

## Agents - Tools

### `OnChainTools` class
**File:** `packages/agents/src/tools/OnChainTools.ts:85`

On-chain data fetching tools for agents.

**Methods:**
- `getTokenInfo(mint: string)`
- `getHolders(mint: string)`
- `getTransactions(mint: string)`
- `getCreator(mint: string)`

```typescript
const tools = new OnChainTools(rpcEndpoint);
const info = await tools.getTokenInfo('TokenMint...');
```

---

### `AnalysisTools` class
**File:** `packages/agents/src/tools/AnalysisTools.ts:64`

Analysis tools for agents.

**Methods:**
- `analyzeRisk(features: Float32Array)`
- `matchPatterns(features: Float32Array)`
- `compareToHistory(features: Float32Array)`

---

### `TradingTools` class
**File:** `packages/agents/src/tools/TradingTools.ts:58`

Trading execution tools.

**Methods:**
- `getQuote(mint: string, amount: number)`
- `executeBuy(mint: string, amount: number)`
- `executeSell(mint: string, amount: number)`
- `getPositions()`

---

## Agents - Services

### `LLMService` class
**File:** `packages/agents/src/services/LLMService.ts:89`

LLM integration for agent reasoning.

```typescript
const llm = new LLMService({
  endpoint: 'http://localhost:11434',
  model: 'qwen3:8b',
});
const response = await llm.chat(messages);
```

---

### `MarketDataService` class
**File:** `packages/agents/src/services/MarketDataService.ts:80`

Market data fetching for agents.

```typescript
const service = new MarketDataService(rpcEndpoint);
const price = await service.getPrice('TokenMint...');
const data = await service.getMarketData('TokenMint...');
```

---

### `PositionStore` class
**File:** `packages/agents/src/services/PositionStore.ts:61`

Position tracking and P&L calculation.

```typescript
const store = new PositionStore(dbPath);
await store.openPosition(position);
await store.closePosition(tokenMint, exitPrice);
const pnl = store.calculatePnL(tokenMint, currentPrice);
```

---

### `WorkersSync` class
**File:** `packages/agents/src/services/WorkersSync.ts:37`

Syncs agent events to Workers API for dashboard.

```typescript
const sync = new WorkersSync(workersUrl, apiSecret);
await sync.sendEvent(event);
await sync.sendBatch(events);
```

---

## Monitor - Real-Time

### `PoolMonitor` class
**File:** `packages/monitor/src/pool-monitor.ts:131`

Real-time pool detection via Yellowstone gRPC.

```typescript
const monitor = new PoolMonitor({
  yellowstoneEndpoint: 'http://...',
  yellowstoneToken: '...',
});

monitor.on('pool', (event: PoolEvent) => {
  console.log('New pool:', event.baseMint);
});

await monitor.start();
```

**Events:**
- `pool` - New pool detected
- `price` - Price update for tracked token
- `error` - Connection error

**Supported DEXes:**
- Raydium AMM
- Orca Whirlpool
- Pump.fun
- Meteora DLMM

---

### `QuickAnalyzer` class
**File:** `packages/monitor/src/quick-analyzer.ts:75`

Fast 2-call token assessment.

```typescript
const analyzer = new QuickAnalyzer({ rpcEndpoint: RPC_URL });
const result = await analyzer.analyze('TokenMint...');
```

**Returns:**
```typescript
interface QuickAnalysis {
  mint: string;
  supply: number;
  decimals: number;
  topHolders: Array<{
    address: string;
    amount: number;
    percentage: number;
  }>;
  metrics: {
    top10Concentration: number;
    topHolderPercent: number;
    giniCoefficient: number;
    holderCount: number;
    suspiciousPatterns: string[];
  };
  suspicious: boolean;
  suspicionScore: number;  // 0-100
  reasons: string[];
}
```

**RPC Calls:** 2 only (`getTokenSupply`, `getTokenLargestAccounts`)

---

### `ScammerDb` class
**File:** `packages/monitor/src/scammer-db.ts:37`

Local scammer wallet database.

```typescript
const db = new ScammerDb(dbPath);
const isScammer = await db.checkWallet('WalletAddress...');
await db.addScammer(wallet, { rugCount: 3, tokens: [...] });
```

---

### `AlertManager` class
**File:** `packages/monitor/src/alert-manager.ts:56`

Push alerts to multiple channels.

```typescript
const alerts = new AlertManager({
  workersUrl: '...',
  telegramToken: '...',
  telegramChannelId: '...',
});

await alerts.send({
  type: 'NEW_POOL',
  token: 'TokenMint...',
  risk: 'HIGH',
});
```

**Channels:**
- Workers API (dashboard)
- Telegram
- Console

---

## Usage Examples

### Full Token Analysis Flow

```typescript
import { OnChainAnalyzer } from './services/onchain-analyzer';
import { extractFromSentinelData } from './services/feature-extractor';
import { BitNetInferenceEngine } from './services/bitnet-inference';

// 1. Fetch on-chain data
const analyzer = new OnChainAnalyzer(rpcClient);
const onChainData = await analyzer.analyze(tokenMint);

// 2. Extract features
const features = extractFromSentinelData(onChainData);
const featureVector = toFeatureVector(features);

// 3. Run BitNet classification
const engine = await getBitNetEngine(config);
const result = await engine.classify(featureVector);

console.log(`Risk Score: ${result.riskScore}/100`);
console.log(`Signal: ${result.signal}`);
```

### Quick Assessment (2 RPC calls)

```typescript
import { QuickAnalyzer } from '@argus/monitor';

const analyzer = new QuickAnalyzer({ rpcEndpoint: RPC_URL });
const result = await analyzer.analyze(tokenMint);

if (result.suspicious) {
  console.log('SUSPICIOUS:', result.reasons.join(', '));
} else {
  console.log('Score:', result.suspicionScore);
}
```

### Real-Time Pool Monitoring

```typescript
import { PoolMonitor } from '@argus/monitor';
import { QuickAnalyzer } from '@argus/monitor';

const monitor = new PoolMonitor(config);
const analyzer = new QuickAnalyzer({ rpcEndpoint: RPC_URL });

monitor.on('pool', async (event) => {
  // Quick check new pool
  const analysis = await analyzer.analyze(event.baseMint);

  if (!analysis.suspicious && analysis.suspicionScore < 40) {
    console.log('Potential opportunity:', event.baseMint);
  }
});

await monitor.start();
```

---

## RPC Call Volume Reference

All RPC calls go to your **self-hosted Hetzner node** (`RPC_ENDPOINT`) - **$0 cost**.

| Function | RPC Calls | Speed |
|----------|-----------|-------|
| `QuickAnalyzer.analyze()` | 2 | ~100ms |
| `OnChainAnalyzer.getTopHolders()` | 2 | ~150ms |
| `OnChainAnalyzer.detectBundles()` | 3-50 | ~1-5s |
| `OnChainAnalyzer.estimateVolume()` | 1-50 | ~1-5s |
| `fetchTokenData()` | 5-10 | ~500ms |
| `getPumpfunBondingCurve()` | 1 | ~50ms |
| `PoolMonitor` (WebSocket) | 0 | Real-time |

### Infrastructure (Self-Hosted on Hetzner)

| Resource | Env Variable | Description |
|----------|--------------|-------------|
| Solana RPC | `RPC_ENDPOINT` | Full Solana node (HTTP) |
| WebSocket RPC | `RPC_WS_ENDPOINT` | Solana node (WebSocket) |
| Yellowstone gRPC | `YELLOWSTONE_ENDPOINT` | Geyser streaming for real-time data |
| LLM Server | `LLM_ENDPOINT` / `OLLAMA_ENDPOINT` | Self-hosted LLM inference |
| BitNet Model | Server-side | 1-bit quantized classifier |

### LLM Models Available

| Model | Purpose | Speed |
|-------|---------|-------|
| `deepseek-r1:32b` | Reasoning / deep analysis | ~5-10s |
| `qwen3:8b` | Fast inference / council votes | ~1-2s |
| `argus-sentinel-v1.bitnet` | Risk classification | ~13ms |

### AI Inference Options

1. **BitNet Engine** - 1-bit quantized neural network for fast risk scoring
2. **Ollama** - Self-hosted LLM server running DeepSeek and Qwen models
3. **LLMService** - Unified interface supporting multiple backends

**Total Infrastructure Cost: $0/month** (excluding server rental)

### External APIs

| API | Cost | Used For |
|-----|------|----------|
| DexScreener | FREE | Price, volume, market data |
| Jupiter | FREE | Swap execution |
| Helius DAS | OPTIONAL | Creator detection only |

**NO paid AI APIs required** - all inference is self-hosted.

---

*Last updated: February 2026*
