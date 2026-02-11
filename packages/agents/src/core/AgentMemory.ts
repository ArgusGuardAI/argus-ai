/**
 * AgentMemory - Memory System with Vector Storage
 *
 * Uses compressed feature vectors (116 bytes each) for efficient
 * storage and similarity search. Enables agents to:
 * - Remember past observations
 * - Find similar patterns
 * - Learn from outcomes
 *
 * Supports optional PostgreSQL persistence via Database service.
 * In-memory arrays remain the primary query engine (fast cosine similarity).
 * DB is the persistence layer — survives restarts.
 */

import type { Database } from '../services/Database';

export interface MemoryEntry {
  id: string;
  agent: string;
  timestamp: number;
  type: 'observation' | 'action' | 'outcome' | 'pattern' | 'token';
  content: any;
  vector?: Float32Array;  // Compressed feature vector (29 floats = 116 bytes)
  tags: string[];
}

export interface SimilarityResult {
  entry: MemoryEntry;
  similarity: number;
}

export class AgentMemory {
  private agentName: string;
  private shortTerm: MemoryEntry[] = [];
  private longTerm: MemoryEntry[] = [];
  private vectorIndex: Map<string, Float32Array> = new Map();  // id -> vector
  private database: Database | undefined;

  private readonly maxShortTerm: number = 100;
  private readonly maxLongTerm: number = 100000;  // 100K tokens * 116 bytes = ~11.6MB

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  /**
   * Enable database persistence
   */
  setDatabase(db: Database): void {
    this.database = db;
  }

  /**
   * Load token vectors from database into memory (call on startup)
   */
  async hydrateFromDatabase(limit: number = 10000): Promise<number> {
    if (!this.database?.isReady()) return 0;

    try {
      const vectors = await this.database.loadRecentTokenVectors(limit);
      let loaded = 0;

      for (const v of vectors) {
        const entry: MemoryEntry = {
          id: `db-${v.token_address}`,
          agent: this.agentName,
          timestamp: v.scanned_at.getTime(),
          type: 'token',
          content: {
            token: v.token_address,
            score: v.score,
            verdict: v.verdict,
            creator: v.creator,
            flags: v.flags,
          },
          vector: v.features,
          tags: ['token', v.token_address.slice(0, 8)],
        };

        this.longTerm.push(entry);
        this.vectorIndex.set(entry.id, v.features);
        loaded++;
      }

      if (loaded > 0) {
        console.log(`[${this.agentName}] Hydrated ${loaded} token vectors from database`);
      }
      return loaded;
    } catch (err) {
      console.error(`[${this.agentName}] Failed to hydrate from database:`, (err as Error).message);
      return 0;
    }
  }

  /**
   * Store new memory entry
   */
  async store(content: any, options: {
    type?: MemoryEntry['type'];
    vector?: Float32Array;
    tags?: string[];
  } = {}): Promise<string> {
    const entry: MemoryEntry = {
      id: this.generateId(),
      agent: this.agentName,
      timestamp: Date.now(),
      type: options.type || this.inferType(content),
      content,
      vector: options.vector,
      tags: options.tags || []
    };

    // Add to short-term
    this.shortTerm.push(entry);

    // Index vector if provided
    if (entry.vector) {
      this.vectorIndex.set(entry.id, entry.vector);
    }

    // Manage memory limits
    await this.consolidate();

    return entry.id;
  }

  /**
   * Store token with compressed feature vector
   */
  async storeToken(
    tokenAddress: string,
    features: Float32Array,
    metadata: any
  ): Promise<string> {
    const id = await this.store({
      token: tokenAddress,
      ...metadata
    }, {
      type: 'token',
      vector: features,
      tags: ['token', tokenAddress.slice(0, 8)]
    });

    // Persist to database (fire and forget)
    if (this.database?.isReady()) {
      this.database.upsertTokenVector({
        token_address: tokenAddress,
        features,
        score: metadata.score || 0,
        verdict: metadata.verdict || 'UNKNOWN',
        creator: metadata.creator || null,
        flags: metadata.flags || [],
        scanned_at: new Date(),
      }).catch(err => {
        console.error(`[${this.agentName}] DB persist error:`, (err as Error).message);
      });
    }

    return id;
  }

  /**
   * Find similar tokens using cosine similarity
   */
  async findSimilar(
    queryVector: Float32Array,
    limit: number = 10,
    threshold: number = 0.8
  ): Promise<SimilarityResult[]> {
    const results: SimilarityResult[] = [];

    // Search all entries with vectors
    const allEntries = [...this.shortTerm, ...this.longTerm];

    for (const entry of allEntries) {
      if (!entry.vector) continue;

      const similarity = this.cosineSimilarity(queryVector, entry.vector);

      if (similarity >= threshold) {
        results.push({ entry, similarity });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  /**
   * Recall memories matching a query
   */
  async recall(query: string, options: {
    type?: MemoryEntry['type'];
    limit?: number;
    timeRange?: { start: number; end: number };
  } = {}): Promise<MemoryEntry[]> {
    const queryLower = query.toLowerCase();
    const allMemories = [...this.shortTerm, ...this.longTerm];

    let filtered = allMemories.filter(entry => {
      // Type filter
      if (options.type && entry.type !== options.type) return false;

      // Time range filter
      if (options.timeRange) {
        if (entry.timestamp < options.timeRange.start) return false;
        if (entry.timestamp > options.timeRange.end) return false;
      }

      // Content search
      const contentStr = JSON.stringify(entry.content).toLowerCase();
      return contentStr.includes(queryLower) ||
             entry.tags.some(tag => tag.toLowerCase().includes(queryLower));
    });

    // Sort by timestamp (most recent first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    return filtered.slice(0, options.limit || 10);
  }

  /**
   * Get recent memories
   */
  async getRecent(limit: number = 10, type?: MemoryEntry['type']): Promise<MemoryEntry[]> {
    let entries = this.shortTerm;

    if (type) {
      entries = entries.filter(e => e.type === type);
    }

    return entries.slice(-limit).reverse();
  }

  /**
   * Get memory by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    return this.shortTerm.find(e => e.id === id) ||
           this.longTerm.find(e => e.id === id) ||
           null;
  }

  /**
   * Update memory entry
   */
  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const entry = await this.get(id);
    if (entry) {
      Object.assign(entry, updates);
      entry.timestamp = Date.now();
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    shortTermCount: number;
    longTermCount: number;
    vectorCount: number;
    memoryUsageBytes: number;
  } {
    const vectorMemory = this.vectorIndex.size * 29 * 4; // 29 floats * 4 bytes
    const entryMemory = (this.shortTerm.length + this.longTerm.length) * 200; // Estimate

    return {
      shortTermCount: this.shortTerm.length,
      longTermCount: this.longTerm.length,
      vectorCount: this.vectorIndex.size,
      memoryUsageBytes: vectorMemory + entryMemory
    };
  }

  /**
   * Clear all memories
   */
  async clear(): Promise<void> {
    this.shortTerm = [];
    this.longTerm = [];
    this.vectorIndex.clear();
  }

  /**
   * Consolidate memory (move old short-term to long-term)
   */
  private async consolidate(): Promise<void> {
    while (this.shortTerm.length > this.maxShortTerm) {
      const old = this.shortTerm.shift()!;
      this.longTerm.push(old);
    }

    // Trim long-term if needed
    while (this.longTerm.length > this.maxLongTerm) {
      const removed = this.longTerm.shift()!;
      this.vectorIndex.delete(removed.id);
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Infer memory type from content
   */
  private inferType(content: any): MemoryEntry['type'] {
    if (content.action) return 'action';
    if (content.outcome || content.pnl !== undefined) return 'outcome';
    if (content.token || content.tokenAddress) return 'token';
    if (content.pattern) return 'pattern';
    return 'observation';
  }

  private generateId(): string {
    return `${this.agentName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
