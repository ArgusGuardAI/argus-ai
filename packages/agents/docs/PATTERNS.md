# Argus Pattern Library

A comprehensive guide to scam patterns detected by the Argus AI Agent System.

---

## Overview

The Pattern Library contains detection profiles for known scam types. Each pattern defines:

- **Feature Weights**: Which features indicate this pattern
- **Indicators**: Human-readable warning signs
- **Rug Rate**: Historical probability of rug pull
- **Severity**: Risk level (LOW, MEDIUM, HIGH, CRITICAL)

---

## Pattern Detection

When analyzing a token, the system:

1. Extracts 29 features into a normalized vector
2. Compares against each pattern's weight profile
3. Calculates similarity scores
4. Returns matches above threshold (default: 50%)

```typescript
const matches = await patternLibrary.matchPatterns(features, {
  minSimilarity: 0.5,
  maxResults: 5
});

// Returns:
// [
//   { pattern: BUNDLE_COORDINATOR, similarity: 0.82, confidence: 0.78 },
//   { pattern: RUG_PULLER, similarity: 0.65, confidence: 0.61 },
//   ...
// ]
```

---

## Scam Patterns

### BUNDLE_COORDINATOR

**Severity**: HIGH | **Rug Rate**: 75%

#### Description

Multiple wallets coordinating to manipulate supply distribution. These wallets are typically:
- Funded from the same source within minutes
- Created shortly before the token launch
- Hold similar percentages of the supply
- Act in unison (buy/sell at the same times)

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `bundleDetected` | 0.25 | Primary signal |
| `bundleCountNorm` | 0.20 | More wallets = worse |
| `bundleControlPercent` | 0.25 | Higher control = worse |
| `bundleConfidence` | 0.15 | Detection certainty |
| `top10Concentration` | 0.10 | Concentration indicator |
| `freshWalletRatio` | 0.05 | New wallets suspicious |

#### Indicators

- Multiple wallets bought within seconds
- Common funding source detected
- Similar holding percentages
- Fresh wallets (< 24h old)
- Coordinated sell timing

#### Example Scenario

```
Token: FAKEMOON
Launch: 2:00 PM

2:00:01 PM - Wallet A buys 5% (funded from Wallet X at 1:55 PM)
2:00:02 PM - Wallet B buys 5% (funded from Wallet X at 1:56 PM)
2:00:03 PM - Wallet C buys 5% (funded from Wallet X at 1:57 PM)
...
2:00:10 PM - 10 wallets control 50%

6:00 PM - All 10 wallets sell simultaneously
         Price drops 95%
```

#### Detection Tips

- Look for wallets created within 24 hours of launch
- Check funding sources for common origins
- Monitor for synchronized trading activity

---

### RUG_PULLER

**Severity**: CRITICAL | **Rug Rate**: 90%

#### Description

Creator or insider wallet holding large supply with intent to dump. Often accompanied by:
- Active mint authority (can create more tokens)
- Active freeze authority (can lock your tokens)
- Unlocked liquidity (can pull the LP)

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `creatorHoldings` | 0.20 | Large holdings = dump risk |
| `mintDisabled` | -0.20 | Active mint is bad |
| `freezeDisabled` | -0.15 | Active freeze is bad |
| `lpLocked` | -0.15 | Unlocked LP is bad |
| `lpBurned` | -0.10 | Unburned LP is risky |
| `creatorRugHistory` | 0.20 | Past behavior predicts |

#### Indicators

- Creator holds >10% of supply
- Mint authority active
- Freeze authority active
- LP not locked or burned
- Creator has rug history

#### Example Scenario

```
Token: SCAMCOIN
Creator Wallet: 7xKXtg...

Pre-launch:
- Creator holds 20% of supply
- Mint authority: ACTIVE (can create infinite tokens)
- Freeze authority: ACTIVE (can lock your wallet)
- LP Lock: NONE

Launch Day:
- Price pumps 500%
- Community excited

Day 2:
- Creator mints 100M more tokens
- Sells everything
- LP pulled
- Price: -100%
```

#### Detection Tips

- Always check if mint/freeze authority is revoked
- Verify LP is locked for >6 months minimum
- Research creator's wallet history

---

### WASH_TRADER

**Severity**: MEDIUM | **Rug Rate**: 60%

#### Description

Artificial volume through self-trading to attract buyers. The same entity controls multiple wallets and trades between them to create the illusion of activity.

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `volumeToLiquidity` | 0.30 | High ratio = fake volume |
| `activityLevel` | 0.15 | Suspicious activity |
| `holderCountLog` | -0.15 | Few holders suspicious |
| `buyRatio24h` | 0.15 | Unnatural ratios |
| `momentum` | 0.15 | Artificial momentum |
| `liquidityLog` | -0.10 | Low liquidity common |

#### Indicators

- Volume/Liquidity ratio > 5x
- Repetitive buy/sell patterns
- Few unique traders
- Price maintained artificially
- Sudden volume spikes

#### Example Scenario

```
Token: FAKETOKEN
Liquidity: $10,000
24h Volume: $80,000 (8x ratio!)

Transaction Analysis:
- Wallet A sells 1000 tokens to Wallet B
- Wallet B sells 1000 tokens to Wallet C
- Wallet C sells 1000 tokens to Wallet A
- Repeat...

All three wallets funded by same source.
Volume is fake, designed to attract real buyers.
```

#### Detection Tips

- Compare volume to liquidity (>5x is suspicious)
- Look for circular trading patterns
- Check if unique trader count matches volume

---

### HONEYPOT

**Severity**: CRITICAL | **Rug Rate**: 100%

#### Description

Contract designed to prevent selling. You can buy, but when you try to sell, the transaction fails. This is achieved through:
- Hidden sell taxes (99%)
- Blacklist functions
- Transfer restrictions
- Freeze authority abuse

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `freezeDisabled` | -0.30 | Active freeze = honeypot |
| `buyRatio24h` | 0.25 | Only buys = red flag |
| `holderCountLog` | 0.15 | Growing holders stuck |
| `tradingRecency` | 0.15 | Recent buys, no sells |
| `liquidityLog` | 0.15 | LP exists but locked |

#### Indicators

- Sells consistently failing
- High tax on sells
- Freeze authority active
- Blacklist function present
- Only buys, no sells

#### Example Scenario

```
Token: HONEYTRAP

Transaction History:
- Buy: SUCCESS (0.5 SOL → 1000 tokens)
- Buy: SUCCESS (1.0 SOL → 2000 tokens)
- Buy: SUCCESS (0.3 SOL → 600 tokens)
- Sell: FAILED (Error: Blacklisted)
- Sell: FAILED (Error: Transfer restricted)
- Sell: FAILED (Error: Insufficient output)

Buy count: 847
Sell count: 0 successful

All buyers are trapped.
```

#### Detection Tips

- Try a small test sell before large buys
- Check if anyone has successfully sold
- Verify no blacklist functions in contract

---

### PUMP_AND_DUMP

**Severity**: HIGH | **Rug Rate**: 80%

#### Description

Coordinated price inflation followed by massive sell-off. Often accompanied by:
- Heavy social media promotion
- Influencer shills
- Fake "partnership" announcements
- FOMO-inducing tactics

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `priceVelocity` | 0.25 | Rapid price increase |
| `momentum` | 0.20 | Artificial momentum |
| `buyRatio1h` | 0.20 | Recent buying frenzy |
| `volumeLog` | 0.15 | High volume |
| `top10Concentration` | 0.10 | Insiders accumulated |
| `tradingRecency` | 0.10 | Recent activity spike |

#### Indicators

- Rapid price increase (>100% in hours)
- Heavy social media promotion
- Large holder accumulation
- Sudden sentiment shift
- Mass sell-off within hours

#### Example Scenario

```
Token: MOONSHOT

Timeline:
Day 1, 6 AM:  Launch, price $0.001
Day 1, 8 AM:  Twitter threads appear
Day 1, 10 AM: Influencer posts "next 100x gem"
Day 1, 12 PM: Price $0.01 (1000% up)
Day 1, 2 PM:  "Partnership announcement" (fake)
Day 1, 4 PM:  Price $0.05 (5000% up)
Day 1, 6 PM:  Insiders dump
Day 1, 7 PM:  Price $0.0001 (-98%)

Early buyers made money.
FOMO buyers lost everything.
```

#### Detection Tips

- Be skeptical of sudden hype
- Check when large holders accumulated
- Verify "partnerships" independently

---

### INSIDER

**Severity**: HIGH | **Rug Rate**: 50%

#### Description

Wallets with privileged access accumulating before public awareness. These insiders:
- Know about launches before announcement
- Get allocation at lower prices
- Coordinate with project team
- Sell during retail FOMO

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `top10Concentration` | 0.25 | Insider accumulation |
| `giniCoefficient` | 0.20 | Unequal distribution |
| `topWhalePercent` | 0.20 | Large whale holdings |
| `freshWalletRatio` | 0.15 | New wallets suspicious |
| `ageDecay` | 0.10 | Early accumulation |
| `creatorIdentified` | -0.10 | Unknown team worse |

#### Indicators

- Large accumulation before announcement
- Connected to project team
- Early large buys at low prices
- Coordinated with marketing
- Sells during pumps

#### Example Scenario

```
Token: INSIDER_COIN

Week before launch:
- 5 wallets accumulate 30% at $0.0001
- No public announcement yet

Launch day:
- Public price: $0.001 (10x higher)
- Marketing campaign starts
- Retail buys in

Week after launch:
- Price pumps to $0.01
- 5 insider wallets sell
- Price dumps to $0.002

Insiders made 100x.
Retail buyers down 80%.
```

#### Detection Tips

- Check pre-launch accumulation
- Research team connections
- Watch for early large buyers

---

### MICRO_CAP_TRAP

**Severity**: MEDIUM | **Rug Rate**: 55%

#### Description

Very low liquidity token designed to trap small investors. With liquidity under $5,000:
- Any buy causes massive price impact
- Difficult to exit without losing value
- Easy for insiders to manipulate

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `liquidityLog` | -0.30 | Very low liquidity |
| `marketCapLog` | -0.20 | Very low market cap |
| `volumeToLiquidity` | 0.20 | Fake volume signal |
| `priceVelocity` | 0.15 | Easy to pump |
| `ageDecay` | 0.15 | New tokens risky |

#### Indicators

- Liquidity < $5,000
- Market cap < $50,000
- Easy to move price
- Thin order book
- High slippage on trades

#### Example Scenario

```
Token: TINY_TRAP
Liquidity: $2,000
Market Cap: $10,000

You buy $100:
- Price impact: +25%
- You now hold 5% of supply

You try to sell $100:
- Price impact: -30%
- You get back $70

You're trapped.
Can't exit without massive loss.
```

#### Detection Tips

- Avoid tokens with <$10K liquidity
- Test with tiny amounts first
- Calculate price impact before buying

---

## Legitimate Patterns

### LEGITIMATE_VC

**Severity**: LOW | **Rug Rate**: 5%

#### Description

Healthy token with proper distribution, locked liquidity, and legitimate team. Signs of a legitimate project:
- Authorities revoked
- LP locked long-term
- Wide distribution
- Known team
- Active development

#### Feature Weights

| Feature | Weight | Reason |
|---------|--------|--------|
| `mintDisabled` | 0.15 | Authorities revoked |
| `freezeDisabled` | 0.15 | Authorities revoked |
| `lpLocked` | 0.15 | LP secured |
| `lpBurned` | 0.15 | LP permanently locked |
| `giniCoefficient` | -0.10 | Good distribution |
| `holderCountLog` | 0.15 | Many holders |
| `creatorIdentified` | 0.15 | Known team |

#### Indicators

- Mint/Freeze authority revoked
- LP locked or burned
- Wide holder distribution
- Team is doxxed
- Active development

---

## Creating Custom Patterns

You can create new patterns from observed behavior:

```typescript
import { PatternLibrary } from '@argus/agents';

const library = new PatternLibrary();

// Create pattern from examples
const newPattern = library.createPatternFromObservation(
  'AIRDROP_SCAM',
  'Fake airdrop to collect wallet signatures',
  [
    exampleFeatures1,
    exampleFeatures2,
    exampleFeatures3
  ],
  [
    'Claims free airdrop',
    'Requires wallet connection',
    'No real token utility',
    'Team unknown'
  ],
  'HIGH'
);

// Pattern is now active for detection
```

---

## Pattern Statistics

Track pattern effectiveness:

```typescript
const stats = library.getStats();

console.log(`
Pattern Library Stats
=====================
Total Patterns: ${stats.totalPatterns}
Active Patterns: ${stats.activePatterns}
Total Detections: ${stats.totalDetections}
Average Rug Rate: ${(stats.avgRugRate * 100).toFixed(1)}%

Top Patterns by Detection:
${stats.topPatterns.map(p =>
  `  ${p.name}: ${p.detections} detections, ${(p.rugRate * 100).toFixed(0)}% rug rate`
).join('\n')}
`);
```

---

## Pattern Export/Import

Share patterns between instances:

```typescript
// Export
const exported = library.exportPatterns();
fs.writeFileSync('patterns.json', JSON.stringify(exported));

// Import
const imported = JSON.parse(fs.readFileSync('patterns.json'));
library.importPatterns(imported);
```

---

## Best Practices

### For Users

1. **Multiple Signals**: Don't act on a single pattern match
2. **Verify Independently**: Cross-check findings manually
3. **Test Small**: Always test with small amounts first
4. **Stay Updated**: Pattern library evolves with new scams

### For Developers

1. **Update Rug Rates**: Record outcomes to improve accuracy
2. **Add New Patterns**: Document emerging scam types
3. **Tune Weights**: Adjust based on false positive/negative rates
4. **Share Knowledge**: Export patterns for community benefit

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01 | Initial patterns (7 scam + 1 legitimate) |

---

## Contributing

Found a new scam pattern? Help improve the library:

1. Document the pattern with examples
2. Identify key feature indicators
3. Submit via GitHub issue or PR
4. Include rug rate estimate if known
