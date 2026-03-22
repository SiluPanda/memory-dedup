# memory-dedup

Semantic deduplication of agent memory entries using embedding-based cosine similarity.

[![npm version](https://img.shields.io/npm/v/memory-dedup.svg)](https://www.npmjs.com/package/memory-dedup)
[![npm downloads](https://img.shields.io/npm/dt/memory-dedup.svg)](https://www.npmjs.com/package/memory-dedup)
[![license](https://img.shields.io/npm/l/memory-dedup.svg)](https://github.com/SiluPanda/memory-dedup/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/memory-dedup.svg)](https://nodejs.org)

---

## Description

`memory-dedup` is a deduplication engine for AI agent memory entries. It detects and merges semantically equivalent entries -- records like "User lives in NYC" and "User's location is New York City" -- using a multi-stage pipeline: text normalization, content hashing for exact matches, embedding-based cosine similarity for semantic matches, and configurable merge policies to resolve duplicates.

The package solves a specific problem: AI agents that maintain long-term memory accumulate duplicate information across sessions. These duplicates waste token budget when injected into prompts, degrade retrieval relevance, increase storage costs, and slow similarity search. `memory-dedup` eliminates this redundancy while preserving complementary facts.

Key design decisions:

- **Zero runtime dependencies.** All dedup logic -- normalization, hashing, cosine similarity, merge policies -- uses built-in JavaScript APIs and pure TypeScript.
- **Pluggable embedding provider.** Supply any `(text: string) => Promise<number[]>` function. Works with OpenAI, Cohere, local models via `transformers.js`, or any other embedding source.
- **Framework-agnostic.** Works with LangChain, MemGPT/Letta, Vercel AI SDK, or custom agent memory systems.
- **Deduplication engine, not a memory store.** Processes entries and returns results; does not own or persist the canonical memory store.

---

## Installation

```bash
npm install memory-dedup
```

Requires Node.js >= 18.

---

## Quick Start

```typescript
import { createDeduplicator } from 'memory-dedup';

// Provide any embedding function
const dedup = createDeduplicator({
  embedder: async (text) => {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  },
  threshold: 0.90,
  mergePolicy: 'keep-newest',
});

// Add entries with automatic deduplication
const result1 = await dedup.add({
  id: 'entry-1',
  content: 'User lives in New York City',
  metadata: { timestamp: Date.now(), source: 'conversation-10' },
});
// result1.action === 'added', result1.classification === 'unique'

const result2 = await dedup.add({
  id: 'entry-2',
  content: 'User resides in NYC',
  metadata: { timestamp: Date.now(), source: 'conversation-42' },
});
// result2.classification === 'semantic_duplicate'
// result2.action === 'merged', result2.survivorId === 'entry-2'

// Check without modifying the index
const checkResult = await dedup.check({
  id: 'entry-3',
  content: 'User is based in New York',
});
// checkResult.classification === 'semantic_duplicate'

// Get deduplicated entries
const entries = dedup.getEntries();

// View statistics
const stats = dedup.stats();
console.log(`Dedup rate: ${stats.exactDuplicates + stats.semanticDuplicates} / ${stats.totalChecks}`);
```

---

## Features

### Multi-Stage Deduplication Pipeline

Entries pass through progressively more expensive comparison stages. Early stages act as fast filters to avoid unnecessary embedding API calls:

1. **Text normalization** -- Lowercase, collapse whitespace, strip punctuation. Sub-millisecond, free.
2. **Content hash matching** -- djb2 hash of normalized text catches exact/near-exact duplicates without any embedding cost. Sub-millisecond, free.
3. **Embedding generation** -- Calls the configured embedder for semantic comparison. Only reached when no hash match is found.
4. **Similarity search** -- Cosine similarity against all indexed vectors. Finds the best match.
5. **Classification** -- Maps similarity score to one of four tiers: exact duplicate, semantic duplicate, related, or unique.
6. **Merge policy** -- Applies the configured merge policy to resolve detected duplicates.

### Four Classification Tiers

| Tier | Default Threshold | Meaning |
|---|---|---|
| Exact duplicate | >= 0.98 | Virtually identical content |
| Semantic duplicate | >= 0.90 | Same information, different phrasing |
| Related | >= 0.75 | Same topic, different information |
| Unique | < 0.75 | Unrelated content |

### Six Built-In Merge Policies

- **`keep-newest`** -- Keep the entry with the most recent timestamp. Default policy.
- **`keep-oldest`** -- Keep the original entry; discard subsequent duplicates.
- **`keep-longest`** -- Keep the entry with the longer content text.
- **`keep-highest-confidence`** -- Keep the entry with the higher `metadata.confidence` score. Falls back to `keep-newest` if neither has a confidence score.
- **`merge`** -- Combine information from both entries. Content from the longer entry is kept; metadata is merged (arrays are unioned, numeric values take the maximum).
- **Custom function** -- Supply a `(candidate, match, similarity) => MemoryEntry` function for full control.

### Incremental and Batch Deduplication

- **`add(entry)`** -- Check and deduplicate on insert. Each new entry is compared against the existing index.
- **`addBatch(entries)`** -- Process multiple entries sequentially, with each entry checked against the index including previously added batch entries.
- **`sweep()`** -- Scan all indexed entries for duplicate pairs. Run periodically as a background cleanup task.
- **`compact()`** -- Aggressive deduplication with clustering. Groups related entries into clusters using union-find, then merges within clusters.

### Event System

Subscribe to deduplication events for observability, logging, and monitoring:

```typescript
const unsub = dedup.on('duplicate-found', (payload) => {
  console.log('Duplicate detected:', payload);
});

dedup.on('merged', (payload) => {
  console.log('Entries merged:', payload);
});

dedup.on('evicted', (payload) => {
  console.log('Entry evicted:', payload);
});

dedup.on('added', (payload) => {
  console.log('Entry added:', payload);
});

// Unsubscribe when done
unsub();
```

### Pluggable Storage Backend

Supply a custom `StoreBackend` implementation to use persistent storage or ANN (approximate nearest neighbor) libraries for large indexes:

```typescript
const dedup = createDeduplicator({
  embedder: myEmbedder,
  store: myCustomStore, // implements StoreBackend interface
});
```

---

## API Reference

### `createDeduplicator(options: DedupOptions): MemoryDedup`

Factory function that creates a new deduplicator instance. The `embedder` option is required; all other options have sensible defaults.

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `embedder` | `(text: string) => Promise<number[]>` | **required** | Function that returns an embedding vector |
| `threshold` | `number` | `0.90` | Cosine similarity threshold for semantic duplicates |
| `exactThreshold` | `number` | `0.98` | Cosine similarity threshold for exact duplicates |
| `relatedThreshold` | `number` | `0.75` | Cosine similarity threshold for related entries |
| `mergePolicy` | `string \| function` | `'keep-newest'` | How to handle detected duplicates (see Merge Policies) |

```typescript
import { createDeduplicator } from 'memory-dedup';

const dedup = createDeduplicator({
  embedder: async (text) => { /* return number[] */ },
  threshold: 0.90,
  mergePolicy: 'keep-newest',
});
```

---

### MemoryDedup Instance Methods

#### `check(entry: MemoryEntry): Promise<DedupResult>`

Check whether an entry is a duplicate of any existing entry in the index. Does **not** modify the index -- the entry is not added. Runs the full dedup pipeline: normalize, hash, embed, search, classify.

```typescript
const result = await dedup.check({ id: 'e1', content: 'User likes coffee' });
```

Returns a `DedupResult`:

| Field | Type | Description |
|---|---|---|
| `classification` | `'exact_duplicate' \| 'semantic_duplicate' \| 'related' \| 'unique'` | Classification tier |
| `matchId` | `string \| undefined` | ID of the best-matching existing entry |
| `similarity` | `number \| undefined` | Cosine similarity with the best match |
| `hashMatch` | `boolean \| undefined` | `true` if matched via content hash (no embedding call needed) |
| `durationMs` | `number` | Wall-clock time for the check in milliseconds |

---

#### `add(entry: MemoryEntry): Promise<AddResult>`

Add an entry to the index with automatic deduplication. Runs the full dedup pipeline. If the entry is a duplicate, the configured merge policy is applied. If unique, the entry is added to the index.

```typescript
const result = await dedup.add({
  id: 'e2',
  content: 'User enjoys coffee',
  metadata: { confidence: 0.9 },
});
```

Returns an `AddResult` (extends `DedupResult`):

| Field | Type | Description |
|---|---|---|
| `action` | `'added' \| 'merged' \| 'skipped'` | Action taken |
| `survivorId` | `string \| undefined` | ID of the surviving entry after merge |
| `evictedId` | `string \| undefined` | ID of the evicted entry after merge |

---

#### `addBatch(entries: MemoryEntry[]): Promise<BatchResult>`

Add multiple entries with automatic deduplication. Entries are processed sequentially; each entry is checked against the index which includes previously added entries from this batch.

```typescript
const batch = await dedup.addBatch([
  { id: 'e1', content: 'User likes tea' },
  { id: 'e2', content: 'User enjoys tea' },
  { id: 'e3', content: 'Server runs on port 3000' },
]);
```

Returns a `BatchResult`:

| Field | Type | Description |
|---|---|---|
| `results` | `AddResult[]` | Per-entry results in input order |
| `totalProcessed` | `number` | Total entries processed |
| `uniqueAdded` | `number` | Number of unique entries added |
| `duplicatesFound` | `number` | Number of duplicates found and merged/skipped |
| `durationMs` | `number` | Wall-clock time for the batch operation |

---

#### `sweep(): Promise<SweepResult>`

Scan all entries in the index for duplicate pairs using O(n^2) pairwise comparison. Applies merge policies to detected duplicates. Run periodically as a background cleanup task, or after loading entries from an external store.

```typescript
const result = await dedup.sweep();
```

Returns a `SweepResult`:

| Field | Type | Description |
|---|---|---|
| `duplicatePairs` | `Array<[string, string]>` | Pairs of duplicate entry IDs |
| `duplicateCount` | `number` | Number of duplicate pairs found |
| `evictedCount` | `number` | Number of entries evicted by merge policies |
| `evictedIds` | `string[]` | IDs of evicted entries |
| `totalScanned` | `number` | Total entries scanned |
| `durationMs` | `number` | Wall-clock time for the sweep |

---

#### `compact(): Promise<CompactResult>`

Aggressive deduplication with clustering. Extends `sweep()` by grouping related entries into clusters using union-find before merging within each cluster.

```typescript
const result = await dedup.compact();
```

Returns a `CompactResult` (extends `SweepResult`):

| Field | Type | Description |
|---|---|---|
| `clustersFound` | `number` | Number of clusters formed |
| `mergedCount` | `number` | Number of entries merged |

---

#### `getEntries(): MemoryEntry[]`

Returns all entries currently in the index.

```typescript
const entries = dedup.getEntries();
```

---

#### `remove(id: string): void`

Remove an entry from the index by ID.

```typescript
dedup.remove('entry-1');
```

---

#### `clear(): void`

Remove all entries from the index and reset internal state.

```typescript
dedup.clear();
```

---

#### `stats(): DedupStats`

Returns deduplication statistics.

```typescript
const s = dedup.stats();
```

Returns a `DedupStats`:

| Field | Type | Description |
|---|---|---|
| `totalEntries` | `number` | Entries currently in the index |
| `totalChecks` | `number` | Total dedup checks performed |
| `exactDuplicates` | `number` | Total exact duplicates detected |
| `semanticDuplicates` | `number` | Total semantic duplicates detected |
| `uniqueEntries` | `number` | Total unique entries added |
| `durationMs` | `number \| undefined` | Cumulative processing time |

---

#### `size(): number`

Returns the number of entries in the index.

```typescript
const count = dedup.size();
```

---

#### `on(event: string, fn: (payload: unknown) => void): () => void`

Register an event handler. Returns an unsubscribe function.

Events:

| Event | Payload Description |
|---|---|
| `'duplicate-found'` | Fired when a duplicate is detected |
| `'merged'` | Fired when two entries are merged |
| `'evicted'` | Fired when an entry is removed from the index |
| `'added'` | Fired when a new unique entry is added |

```typescript
const unsub = dedup.on('duplicate-found', (payload) => {
  console.log(payload);
});
unsub(); // remove the handler
```

---

#### `off(event: string, fn: (payload: unknown) => void): void`

Remove a previously registered event handler.

```typescript
dedup.off('duplicate-found', myHandler);
```

---

### Exported Types

All types are exported from the package entry point:

#### `MemoryEntry`

```typescript
interface MemoryEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** The text content of the memory entry. Embedded and compared for similarity. */
  content: string;
  /** Optional metadata for merge decisions, provenance, and similarity boosting. */
  metadata?: Record<string, unknown>;
}
```

#### `EntryMetadata`

```typescript
interface EntryMetadata {
  /** Unix timestamp (ms) when the entry was created. */
  timestamp?: number;
  /** Unix timestamp (ms), alias for timestamp. */
  createdAt?: number;
  /** Confidence score from extraction (0.0 to 1.0). */
  confidence?: number;
  /** Additional caller-defined fields. */
  [key: string]: unknown;
}
```

#### `DedupOptions`

```typescript
interface DedupOptions {
  embedder: (text: string) => Promise<number[]>;
  threshold?: number;            // default: 0.90
  exactThreshold?: number;       // default: 0.98
  relatedThreshold?: number;     // default: 0.75
  mergePolicy?:
    | 'keep-newest'
    | 'keep-oldest'
    | 'keep-longest'
    | 'keep-highest-confidence'
    | 'merge'
    | ((a: MemoryEntry, b: MemoryEntry, sim: number) => MemoryEntry);
}
```

#### `DedupResult`

```typescript
interface DedupResult {
  classification: 'exact_duplicate' | 'semantic_duplicate' | 'related' | 'unique';
  matchId?: string;
  similarity?: number;
  hashMatch?: boolean;
  durationMs: number;
}
```

#### `AddResult`

```typescript
interface AddResult extends DedupResult {
  action: 'added' | 'merged' | 'skipped';
  survivorId?: string;
  evictedId?: string;
}
```

#### `BatchResult`

```typescript
interface BatchResult {
  results: AddResult[];
  totalProcessed: number;
  uniqueAdded: number;
  duplicatesFound: number;
  durationMs: number;
}
```

#### `SweepResult`

```typescript
interface SweepResult {
  duplicatePairs: Array<[string, string]>;
  duplicateCount: number;
  evictedCount: number;
  evictedIds: string[];
  totalScanned: number;
  durationMs: number;
}
```

#### `CompactResult`

```typescript
interface CompactResult extends SweepResult {
  clustersFound: number;
  mergedCount: number;
}
```

#### `DedupStats`

```typescript
interface DedupStats {
  totalEntries: number;
  totalChecks: number;
  exactDuplicates: number;
  semanticDuplicates: number;
  uniqueEntries: number;
  durationMs?: number;
}
```

#### `StoreBackend`

Interface for pluggable storage backends:

```typescript
interface StoreBackend {
  add(entry: MemoryEntry, embedding: number[], hash: string): void;
  get(id: string): MemoryEntry | null;
  remove(id: string): void;
  all(): MemoryEntry[];
  getEmbedding(id: string): number[] | null;
  getHash(hash: string): string | null;
  size(): number;
  clear(): void;
}
```

#### `MemoryDedup`

The full public interface of the deduplicator instance. See the instance methods section above for details on each method.

---

## Configuration

### Threshold Tuning

| Use Case | `threshold` | Rationale |
|---|---|---|
| Conservative (minimize false positives) | 0.95 | Only merge near-identical paraphrases |
| Standard agent memory cleanup | 0.90 | Catches most semantic duplicates with low false positive rate |
| Aggressive (maximize space savings) | 0.85 | Merges entries with moderate paraphrasing; review for false positives |

All three thresholds are independently configurable:

```typescript
const dedup = createDeduplicator({
  embedder: myEmbedder,
  threshold: 0.92,         // semantic duplicate threshold
  exactThreshold: 0.99,    // exact duplicate threshold
  relatedThreshold: 0.80,  // related-but-different threshold
});
```

Thresholds must satisfy: `relatedThreshold < threshold < exactThreshold`.

### Merge Policy Selection

| Policy | Best For |
|---|---|
| `keep-newest` | Most recent observation is most accurate |
| `keep-oldest` | Original formulation is authoritative |
| `keep-longest` | More detailed entries are preferred |
| `keep-highest-confidence` | Entries carry extraction confidence scores |
| `merge` | Both entries may contain complementary details |
| Custom function | Application-specific merge logic |

### Merge Metadata Handling

When entries are merged, metadata fields are combined as follows:

- **Arrays** -- Values are combined and deduplicated (union).
- **Numbers** -- The maximum value is kept.
- **Other fields** -- The incoming entry's value takes precedence.

---

## Error Handling

All errors thrown by `memory-dedup` are standard `Error` instances. Common failure modes:

- **Embedder failure** -- If the configured `embedder` function throws, the error propagates from `check()`, `add()`, `addBatch()`, `sweep()`, and `compact()`. Wrap the embedder in a try/catch or use retry logic for resilience.
- **Dimension mismatch** -- If the embedder returns vectors of inconsistent dimensions across calls, cosine similarity returns 0 and entries are classified as unique.
- **Empty content** -- Entries with empty string content are handled gracefully. The normalization and hashing stages produce valid outputs for empty strings.

```typescript
try {
  await dedup.add({ id: 'e1', content: 'Some fact' });
} catch (err) {
  // Handle embedder or store errors
  console.error('Dedup failed:', err.message);
}
```

---

## Advanced Usage

### Custom Merge Policy

Supply a function for full control over merge behavior:

```typescript
const dedup = createDeduplicator({
  embedder: myEmbedder,
  mergePolicy: (candidate, match, similarity) => {
    // Keep the entry with more metadata fields
    const candidateKeys = Object.keys(candidate.metadata ?? {}).length;
    const matchKeys = Object.keys(match.metadata ?? {}).length;
    return candidateKeys >= matchKeys ? candidate : match;
  },
});
```

### Integration with embed-cache

Wrap the embedder with `embed-cache` to avoid redundant embedding API calls, particularly valuable during `sweep()` operations:

```typescript
import { createDeduplicator } from 'memory-dedup';
import { createEmbedCache } from 'embed-cache';

const cache = createEmbedCache({ maxSize: 10_000 });

const dedup = createDeduplicator({
  embedder: async (text) => {
    const cached = cache.get(text);
    if (cached) return cached;
    const embedding = await rawEmbedder(text);
    cache.set(text, embedding);
    return embedding;
  },
});
```

### OpenAI Embeddings

```typescript
import OpenAI from 'openai';
import { createDeduplicator } from 'memory-dedup';

const openai = new OpenAI();

const dedup = createDeduplicator({
  embedder: async (text) => {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  },
});
```

### Cohere Embeddings

```typescript
import { CohereClientV2 } from 'cohere-ai';
import { createDeduplicator } from 'memory-dedup';

const cohere = new CohereClientV2();

const dedup = createDeduplicator({
  embedder: async (text) => {
    const response = await cohere.embed({
      texts: [text],
      model: 'embed-english-v3.0',
      inputType: 'search_document',
      embeddingTypes: ['float'],
    });
    return response.embeddings.float[0];
  },
});
```

### Local Models (transformers.js)

```typescript
import { pipeline } from '@xenova/transformers';
import { createDeduplicator } from 'memory-dedup';

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

const dedup = createDeduplicator({
  embedder: async (text) => {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  },
});
```

### Custom Store Backend

Implement the `StoreBackend` interface for persistent storage or ANN search:

```typescript
import { createDeduplicator, StoreBackend, MemoryEntry } from 'memory-dedup';

class MyStore implements StoreBackend {
  private entries = new Map<string, MemoryEntry>();
  private embeddings = new Map<string, number[]>();
  private hashes = new Map<string, string>();

  add(entry: MemoryEntry, embedding: number[], hash: string): void {
    this.entries.set(entry.id, entry);
    this.embeddings.set(entry.id, embedding);
    this.hashes.set(hash, entry.id);
  }

  get(id: string): MemoryEntry | null {
    return this.entries.get(id) ?? null;
  }

  remove(id: string): void {
    this.entries.delete(id);
    this.embeddings.delete(id);
  }

  all(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }

  getEmbedding(id: string): number[] | null {
    return this.embeddings.get(id) ?? null;
  }

  getHash(hash: string): string | null {
    return this.hashes.get(hash) ?? null;
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.embeddings.clear();
    this.hashes.clear();
  }
}

const dedup = createDeduplicator({
  embedder: myEmbedder,
  store: new MyStore(),
});
```

### Periodic Sweep

Run sweep as a background cleanup task to catch duplicates that accumulated over time:

```typescript
setInterval(async () => {
  const result = await dedup.sweep();
  console.log(
    `Sweep: scanned=${result.totalScanned}, ` +
    `duplicates=${result.duplicateCount}, ` +
    `evicted=${result.evictedCount}`
  );
}, 5 * 60 * 1000);
```

---

## TypeScript

`memory-dedup` is written in TypeScript and ships type declarations (`dist/index.d.ts`). All public interfaces and types are exported from the package entry point:

```typescript
import {
  createDeduplicator,
  // Types
  type MemoryEntry,
  type EntryMetadata,
  type DedupOptions,
  type DedupResult,
  type AddResult,
  type BatchResult,
  type SweepResult,
  type CompactResult,
  type DedupStats,
  type MemoryDedup,
  type StoreBackend,
} from 'memory-dedup';
```

Compile target: ES2022. Module format: CommonJS. Strict mode enabled.

---

## License

MIT
