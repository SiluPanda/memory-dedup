export interface MemoryEntry {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface EntryMetadata {
  timestamp?: number;
  createdAt?: number;
  confidence?: number;
  [key: string]: unknown;
}

export interface DedupOptions {
  embedder: (text: string) => Promise<number[]>;
  threshold?: number;
  exactThreshold?: number;
  relatedThreshold?: number;
  mergePolicy?:
    | 'keep-newest'
    | 'keep-oldest'
    | 'keep-longest'
    | 'keep-highest-confidence'
    | 'merge'
    | ((a: MemoryEntry, b: MemoryEntry, sim: number) => MemoryEntry);
}

export interface DedupResult {
  classification: 'exact_duplicate' | 'semantic_duplicate' | 'related' | 'unique';
  matchId?: string;
  similarity?: number;
  hashMatch?: boolean;
  durationMs: number;
}

export interface AddResult extends DedupResult {
  action: 'added' | 'merged' | 'skipped';
  survivorId?: string;
  evictedId?: string;
}

export interface BatchResult {
  results: AddResult[];
  totalProcessed: number;
  uniqueAdded: number;
  duplicatesFound: number;
  durationMs: number;
}

export interface SweepResult {
  duplicatePairs: Array<[string, string]>;
  duplicateCount: number;
  evictedCount: number;
  evictedIds: string[];
  totalScanned: number;
  durationMs: number;
}

export interface CompactResult extends SweepResult {
  clustersFound: number;
  mergedCount: number;
}

export interface DedupStats {
  totalEntries: number;
  totalChecks: number;
  exactDuplicates: number;
  semanticDuplicates: number;
  uniqueEntries: number;
  durationMs?: number;
}

export interface MemoryDedup {
  check(entry: MemoryEntry): Promise<DedupResult>;
  add(entry: MemoryEntry): Promise<AddResult>;
  addBatch(entries: MemoryEntry[]): Promise<BatchResult>;
  sweep(): Promise<SweepResult>;
  compact(): Promise<CompactResult>;
  getEntries(): MemoryEntry[];
  remove(id: string): void;
  clear(): void;
  stats(): DedupStats;
  size(): number;
  on(event: string, fn: (payload: unknown) => void): () => void;
  off(event: string, fn: (payload: unknown) => void): void;
}

export interface StoreBackend {
  add(entry: MemoryEntry, embedding: number[], hash: string): void;
  get(id: string): MemoryEntry | null;
  remove(id: string): void;
  all(): MemoryEntry[];
  getEmbedding(id: string): number[] | null;
  getHash(hash: string): string | null;
  size(): number;
  clear(): void;
}
