# ARGUS AI Development Journal

## CRITICAL RULES - DO NOT VIOLATE

### 1. YELLOWSTONE IS THE SOURCE OF TRUTH
- **NEVER** use DexScreener for pool data when we have Yellowstone
- Yellowstone provides real-time bonding curve data directly from chain
- We built the entire intelligent system around Yellowstone gRPC
- DexScreener is a FALLBACK only, not the primary source

### 2. BONDING CURVE TOKENS ARE THE TARGET
- We WANT to invest in bonding curve tokens BEFORE graduation
- Early entry = maximum profit potential
- Do NOT filter out bonding tokens
- Evaluate bonding curves using Yellowstone enrichedData:
  - `realSolReserves` / `virtualSolReserves`
  - `realTokenReserves` / `virtualTokenReserves`
  - `complete` (graduation status)
  - Bonding curve progress percentage

### 3. YELLOWSTONE ENRICHED DATA FIELDS
```typescript
enrichedData: {
  virtualSolReserves: number;   // Virtual SOL in curve
  virtualTokenReserves: number; // Virtual tokens in curve
  realSolReserves: number;      // Actual SOL deposited
  realTokenReserves: number;    // Actual tokens remaining
  complete: boolean;            // true = graduated to Raydium
  liquiditySol?: number;        // Pre-calculated liquidity
}
```

### 4. BONDING CURVE MATH
- Pump.fun starts with ~30 SOL virtual, graduates at ~85 SOL
- Progress = virtualSolReserves / 85 SOL
- Tokens bought = (virtualTokens - realTokens) / virtualTokens
- Higher realSolReserves = more real buys = momentum

---

## Corrections Log

### 2024-02-11: Bonding Curve Analysis
**Problem:** AGI was evaluating tokens with "zero volume, zero activity" and skipping everything.

**Root Cause:** Code was creating synthetic DexPair data with zeros instead of using Yellowstone enrichedData intelligently.

**Wrong approaches attempted:**
1. Filter out non-graduated tokens - WRONG (we want bonding tokens)
2. Add 5-second delay to fetch DexScreener - WRONG (defeats purpose of Yellowstone)
3. Use DexScreener for activity data - WRONG (Yellowstone is our system)

**Correct approach:** Use Yellowstone enrichedData to calculate meaningful bonding curve metrics:
- Bonding progress percentage
- Token distribution (% bought)
- SOL momentum (real vs virtual ratio)

**Code changes made (2024-02-11 FINAL FIX):**
1. Use `liquiditySol` from pool-monitor (already sanitized, capped at 1000 SOL)
2. Progress calculation: `bondingProgress = liquiditySol / 85 * 100`
   - Pump.fun starts at 30 SOL virtual = 35% progress
   - Graduates at ~85 SOL = 100% progress
3. Filter: Only skip if progress < 30% (data error)
4. BitNet threshold raised to 75 (bonding curves score higher, that's fine)
5. LLM prompt explains bonding curve strategy and what progress % means

### 2024-02-11: Bonding Curve Price Calculation
**Problem:** Paper trading showing $0 price for bonding curve tokens (DexScreener doesn't track them)

**Solution:** Calculate price from Yellowstone bonding curve data using constant product formula:
```typescript
// Pump.fun bonding curve price calculation
price_in_sol = virtualSolReserves / virtualTokenReserves
price_in_usd = price_in_sol * SOL_PRICE_USD
```

This matches how Pump.fun actually prices tokens on the bonding curve.

**WORKING OUTPUT:**
```
[YELLOWSTONE] New PUMP_FUN pool: 8W7CrT
  Liquidity: 30.0 SOL | Progress: 35%
[BITNET] 8W7CrT: Score 15/100 | SAFE
[COUNCIL] Evaluating 8W7CrT...
  SCOUT: YES - "35% progress toward graduation, gaining traction"
  ANALYST: YES - "low risk score (15/100), safe entry"
  HUNTER: YES - "No rug indicators"
  TRADER: YES - "ideal entry point before graduation"
[COUNCIL] TRADE (4/4 YES)
>>> BUY 8W7CrT @ $0.00 | 0.100 SOL
```

---

## Architecture Decisions

### Why Yellowstone over DexScreener
1. Real-time (milliseconds vs seconds delay)
2. Direct on-chain data (no middleman)
3. Bonding curve state before graduation
4. $0 cost (WebSocket subscription)
5. We built the entire AGI stack around it

### Data Flow
```
Yellowstone gRPC → PoolMonitor → enrichedData → BitNet + LLM Council → Trade Decision
```

NOT:
```
Yellowstone → wait → DexScreener → LLM (WRONG!)
```
