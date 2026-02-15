# AGI Council - Multi-Agent Architecture

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    AgentCoordinator                            │
│  - Initializes all agents                                      │
│  - MessageBus for inter-agent communication                    │
│  - DebateProtocol for consensus (if LLM available)             │
│  - WorkersSync for dashboard                                   │
└────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   ScoutAgent    │  │  AnalystAgent   │  │  HunterAgent    │
│                 │  │                 │  │                 │
│ • handleLaunch()│  │ • investigate() │  │ • trackWallet() │
│ • quickScan()   │  │ • holder check  │  │ • scammer DB    │
│ • feature       │  │ • bundle detect │  │ • network map   │
│   extraction    │  │ • LLM reasoning │  │                 │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         │   MessageBus       │                    │
         └──────────┬─────────┴────────────────────┘
                    ▼
         ┌─────────────────┐
         │  TraderAgent    │
         │                 │
         │ • executeBuy()  │
         │ • executeSell() │
         │ • position mgmt │
         │ • Jupiter swap  │
         └─────────────────┘
```

---

## Agent Roles

### ScoutAgent
**File:** `packages/agents/src/agents/ScoutAgent.ts`

Monitors for new token launches and performs quick scans.

| Method | Purpose |
|--------|---------|
| `handleLaunch()` | Receives pool events from Yellowstone |
| `quickScanFromYellowstone()` | Zero-RPC analysis using enriched data |
| `quickScan()` | RPC-based analysis (fallback) |
| `flagSuspicious()` | Triggers AnalystAgent investigation |

**Features extracted:** 29-dimension vector (liquidity, holders, security, bundles, trading, time, creator)

---

### AnalystAgent
**File:** `packages/agents/src/agents/AnalystAgent.ts`

Deep investigation of flagged tokens.

| Method | Purpose |
|--------|---------|
| `investigate()` | Full token investigation |
| `classifyHolders()` | Categorize holder wallets |
| `detectBundles()` | Find coordinated wallet clusters |
| `generateVerdict()` | LLM-powered risk assessment |

**Output:** `DiscoveryResult` with verdict (SAFE/SUSPICIOUS/DANGEROUS/SCAM)

---

### HunterAgent
**File:** `packages/agents/src/agents/HunterAgent.ts`

Tracks scammer wallets and builds network maps.

| Method | Purpose |
|--------|---------|
| `trackWallet()` | Add wallet to tracking |
| `analyzeNetwork()` | Map wallet connections |
| `checkScammerDb()` | Lookup known scammers |
| `reportScammer()` | Add to scammer database |

---

### TraderAgent
**File:** `packages/agents/src/agents/TraderAgent.ts`

Executes trades based on agent consensus.

| Method | Purpose |
|--------|---------|
| `executeBuy()` | Jupiter swap (SOL -> Token) |
| `executeSell()` | Jupiter swap (Token -> SOL) |
| `handlePriceUpdate()` | Check stop-loss/take-profit |
| `monitorPositions()` | Track open positions |

**Strategies:** SAFE_EARLY, MOMENTUM, SNIPER (configurable TP/SL/max hold)

---

## Message Flow

```
1. Pool detected (Yellowstone)
         │
         ▼
2. ScoutAgent.handleLaunch()
   └── quickScanFromYellowstone()
   └── If suspicious: messageBus.publish('analyst.investigate', {...})
         │
         ▼
3. AnalystAgent.investigate()
   └── Holder classification
   └── Bundle detection
   └── LLM reasoning
   └── messageBus.publish('trader.recommendation', {...})
         │
         ▼
4. TraderAgent receives recommendation
   └── Check strategy conditions
   └── executeBuy() via Jupiter
   └── Track position
         │
         ▼
5. Price updates (Yellowstone)
   └── handlePriceUpdate()
   └── Check TP/SL/max hold
   └── executeSell() if triggered
```

---

## Key Components

### MessageBus
**File:** `packages/agents/src/core/MessageBus.ts`

Pub/sub communication between agents.

```typescript
// Publishing
messageBus.publish('agent.analyst.investigate', { token, score, flags });

// Subscribing
messageBus.subscribe('agent.analyst.investigate', async (data) => {
  await this.investigate(data);
});
```

### DebateProtocol
**File:** `packages/agents/src/reasoning/DebateProtocol.ts`

Multi-agent consensus for high-stakes decisions.

```typescript
// Agents vote on proposals
const result = await debateProtocol.debate(proposal);
// result.consensus: true/false
// result.votes: { scout: 'approve', analyst: 'reject', ... }
```

### PatternLibrary
**File:** `packages/agents/src/learning/PatternLibrary.ts`

Known scam patterns with feature weights.

| Pattern | Severity | Rug Rate |
|---------|----------|----------|
| BUNDLE_COORDINATOR | HIGH | 75% |
| RUG_PULLER | CRITICAL | 90% |
| WASH_TRADER | MEDIUM | 60% |
| HONEYPOT | CRITICAL | 100% |
| PUMP_AND_DUMP | HIGH | 80% |

### BitNetEngine
**File:** `packages/agents/src/reasoning/BitNetEngine.ts`

1-bit quantized AI for fast CPU inference.

- 29-dimension feature vectors
- Ternary weights (-1, 0, +1)
- 13ms inference time
- Pattern matching via cosine similarity

---

## Running the System

```typescript
import { AgentCoordinator } from '@argus/agents';

const coordinator = new AgentCoordinator({
  rpcEndpoint: 'http://your-rpc-node:8899',
  enableTrading: false, // Paper mode
  llm: llmService,      // For reasoning
  database: db,         // For persistence
});

await coordinator.initialize();
await coordinator.start();

// Feed pool events
coordinator.handlePoolEvent(event);
```

---

## Data Flow (Zero RPC)

Yellowstone gRPC streams pool data directly:

```
Yellowstone → PoolMonitor → ScoutAgent → AnalystAgent → TraderAgent
                  │
                  └── Enriched data (liquidity, reserves, mints)
                      extracted from account bytes - NO RPC CALLS
```

This enables real-time analysis at $49/month flat (Chainstack Yellowstone).
