// memory-dedup - Semantic deduplication of agent memory entries
export { createDeduplicator } from './deduplicator.js';
export type {
  MemoryEntry,
  EntryMetadata,
  DedupOptions,
  DedupResult,
  AddResult,
  BatchResult,
  SweepResult,
  CompactResult,
  DedupStats,
  MemoryDedup,
  StoreBackend,
} from './types.js';
