# Contributing to Argus Agents

Thank you for your interest in contributing to the Argus AI Agent System! This document provides guidelines for contributing.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)
- [Community](#community)

---

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to protect crypto traders from scams.

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Git
- Basic understanding of:
  - TypeScript
  - Solana blockchain
  - AI/ML concepts (helpful but not required)

### Areas for Contribution

| Area | Description | Difficulty |
|------|-------------|------------|
| **New Patterns** | Add scam pattern detection profiles | Easy |
| **Bug Fixes** | Fix issues in existing code | Easy-Medium |
| **Documentation** | Improve docs, add examples | Easy |
| **New Tools** | Add blockchain/analysis tools | Medium |
| **Agent Features** | Enhance agent capabilities | Medium |
| **Performance** | Optimize memory, speed | Medium-Hard |
| **Learning System** | Improve self-learning | Hard |
| **BitNet Engine** | AI inference improvements | Hard |

---

## Development Setup

### 1. Fork and Clone

```bash
# Fork via GitHub UI, then:
git clone https://github.com/YOUR_USERNAME/argus-agents.git
cd argus-agents
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build

```bash
pnpm build
```

### 4. Run Tests

```bash
pnpm test
```

### 5. Start Development

```bash
pnpm dev  # Watch mode
```

---

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Branch Naming

| Prefix | Use For |
|--------|---------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `refactor/` | Code refactoring |
| `test/` | Test additions |
| `perf/` | Performance improvements |

### 3. Make Your Changes

Follow the coding standards below. Keep commits focused and atomic.

### 4. Commit Messages

Use conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting (no code change)
- `refactor`: Code restructuring
- `test`: Adding tests
- `perf`: Performance improvement
- `chore`: Maintenance

**Examples**:
```
feat(patterns): add AIRDROP_SCAM pattern detection

fix(scout): handle RPC timeout errors gracefully

docs(api): add examples for MessageBus subscription

perf(memory): implement HNSW index for similarity search
```

---

## Submitting Changes

### 1. Push Your Branch

```bash
git push origin feature/your-feature-name
```

### 2. Open a Pull Request

- Go to GitHub and open a PR against `main`
- Fill out the PR template
- Link any related issues

### 3. PR Checklist

- [ ] Code follows style guidelines
- [ ] Tests pass (`pnpm test`)
- [ ] Types check (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Documentation updated (if needed)
- [ ] Commit messages are conventional

### 4. Review Process

1. Automated checks run
2. Maintainer reviews code
3. Feedback addressed
4. Approved and merged

---

## Coding Standards

### TypeScript

```typescript
// Use explicit types
function analyzeToken(address: string): Promise<AnalysisResult> {
  // ...
}

// Use interfaces for objects
interface TokenData {
  address: string;
  name: string;
  symbol: string;
}

// Use enums or union types
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Prefer const assertions
const FEATURE_INDICES = {
  LIQUIDITY_LOG: 0,
  VOLUME_TO_LIQUIDITY: 1,
} as const;
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `AgentCoordinator` |
| Interfaces | PascalCase | `TokenData` |
| Functions | camelCase | `analyzeToken` |
| Variables | camelCase | `riskScore` |
| Constants | SCREAMING_SNAKE | `MAX_POSITION_SIZE` |
| Files | PascalCase (classes) | `ScoutAgent.ts` |
| Files | camelCase (utils) | `helpers.ts` |

### Code Organization

```typescript
// 1. Imports (external first, then internal)
import { EventEmitter } from 'events';
import { MessageBus } from '../core/MessageBus';

// 2. Types/Interfaces
interface Config {
  // ...
}

// 3. Constants
const DEFAULT_TIMEOUT = 5000;

// 4. Main class/function
export class MyClass {
  // Properties first
  private readonly config: Config;

  // Constructor
  constructor(config: Config) {
    this.config = config;
  }

  // Public methods
  public async doSomething(): Promise<void> {
    // ...
  }

  // Private methods
  private helper(): void {
    // ...
  }
}

// 5. Helper functions (if any)
function utilityFunction(): void {
  // ...
}
```

### Error Handling

```typescript
// Use try/catch with proper error types
try {
  const result = await riskyOperation();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[Component] Operation failed: ${message}`);
  throw error; // Re-throw if needed
}

// Use Result types for expected failures
interface Result<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### Comments

```typescript
/**
 * Analyze a token for scam patterns.
 *
 * @param address - The token mint address
 * @param options - Analysis options
 * @returns Analysis result with risk score
 *
 * @example
 * const result = await analyzeToken('TokenAddress...', { deep: true });
 */
function analyzeToken(address: string, options?: AnalysisOptions): Promise<AnalysisResult> {
  // Implementation
}

// Use comments for complex logic
// Calculate Gini coefficient using the standard formula:
// G = (2 * Σ(i * x_i)) / (n * Σx_i) - (n + 1) / n
const gini = (2 * sumIX) / (n * mean * n) - (n + 1) / n;
```

---

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { PatternLibrary } from '../src/learning/PatternLibrary';

describe('PatternLibrary', () => {
  let library: PatternLibrary;

  beforeEach(() => {
    library = new PatternLibrary();
  });

  describe('matchPatterns', () => {
    it('should detect BUNDLE_COORDINATOR pattern', () => {
      const features = new Float32Array(29);
      features[15] = 1;  // bundleDetected
      features[17] = 0.5; // bundleControlPercent

      const matches = library.matchPatterns(features);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].pattern.id).toBe('BUNDLE_COORDINATOR');
    });

    it('should return empty array for legitimate tokens', () => {
      const features = new Float32Array(29);
      features[11] = 1; // mintDisabled
      features[12] = 1; // freezeDisabled
      features[13] = 1; // lpLocked

      const matches = library.matchPatterns(features, {
        minSimilarity: 0.7
      });

      const scamMatches = matches.filter(
        m => m.pattern.id !== 'LEGITIMATE_VC'
      );
      expect(scamMatches.length).toBe(0);
    });
  });
});
```

### Test Categories

| Category | Location | Purpose |
|----------|----------|---------|
| Unit | `src/**/*.test.ts` | Test individual functions |
| Integration | `tests/integration/` | Test component interactions |
| E2E | `tests/e2e/` | Test full flows |

---

## Documentation

### When to Update Docs

- Adding new features
- Changing APIs
- Adding new patterns
- Fixing confusing behavior

### Doc Locations

| File | Content |
|------|---------|
| `README.md` | Overview, quick start |
| `docs/API.md` | Complete API reference |
| `docs/ARCHITECTURE.md` | System design |
| `docs/PATTERNS.md` | Scam pattern details |
| `CONTRIBUTING.md` | This file |

### Doc Style

- Use clear, concise language
- Include code examples
- Add diagrams for complex flows
- Keep examples tested and working

---

## Adding a New Pattern

### 1. Research the Pattern

- Document real examples
- Identify key indicators
- Estimate rug rate

### 2. Define Feature Weights

```typescript
// In PatternLibrary.ts initializeKnownPatterns()
this.addPattern({
  id: 'NEW_PATTERN_NAME',
  name: 'Human Readable Name',
  description: 'Detailed description of the pattern...',
  severity: 'HIGH',
  featureWeights: this.createWeights({
    featureName1: 0.25,  // Most important
    featureName2: 0.20,
    featureName3: 0.15,
    // ...
  }),
  indicators: [
    'Indicator 1',
    'Indicator 2',
    // ...
  ],
  examples: [],
  detectionCount: 0,
  rugRate: 0.70,  // Estimated
  firstSeen: Date.now(),
  lastSeen: Date.now(),
  active: true
});
```

### 3. Add Tests

```typescript
it('should detect NEW_PATTERN pattern', () => {
  const features = createTestFeatures({
    featureName1: 0.9,
    featureName2: 0.8,
  });

  const matches = library.matchPatterns(features);

  expect(matches.some(m => m.pattern.id === 'NEW_PATTERN_NAME')).toBe(true);
});
```

### 4. Update Documentation

Add pattern to `docs/PATTERNS.md` with full description.

---

## Adding a New Agent

### 1. Create Agent Class

```typescript
// src/agents/NewAgent.ts
import { BaseAgent, AgentConfig } from '../core/BaseAgent';
import { MessageBus } from '../core/MessageBus';

export class NewAgent extends BaseAgent {
  constructor(messageBus: MessageBus, options: { name?: string } = {}) {
    const config: AgentConfig = {
      name: options.name || 'new-agent-1',
      role: 'Description of what this agent does',
      model: './models/argus-sentinel-v1.bitnet',
      tools: [
        // Define agent-specific tools
      ],
      memory: true,
      reasoning: true,
      maxReasoningSteps: 5
    };

    super(config, messageBus);
  }

  protected async onInitialize(): Promise<void> {
    await this.think('observation', 'Agent initialized');
  }

  protected async run(): Promise<void> {
    while (this.running) {
      // Main agent loop
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  protected setupMessageHandlers(): void {
    // Subscribe to relevant channels
  }
}
```

### 2. Register in Coordinator

```typescript
// In AgentCoordinator.ts
import { NewAgent } from '../agents/NewAgent';

// Add to constructor
this.newAgents: NewAgent[] = [];

// Add to initialize()
for (let i = 0; i < this.config.newAgents!; i++) {
  const agent = new NewAgent(this.messageBus, { name: `new-${i + 1}` });
  await agent.initialize();
  this.newAgents.push(agent);
}
```

### 3. Export from Index

```typescript
// In index.ts
export { NewAgent } from './agents/NewAgent';
```

---

## Getting Help

- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and ideas
- **Discord**: For real-time chat (if available)

---

## Recognition

Contributors are recognized in:
- GitHub contributors page
- Release notes
- README acknowledgments (for significant contributions)

---

Thank you for contributing to Argus Agents! Together we can protect crypto traders from scams.
