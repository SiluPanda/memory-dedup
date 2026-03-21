# memory-dedup

Semantic deduplication of agent memory entries. Uses cosine similarity with configurable thresholds to detect exact duplicates, semantic duplicates, and related entries. Supports pluggable embedders and multiple merge policies.

## Install

```bash
npm install memory-dedup
```

## Quick start

```typescript
import { createDeduplicator } from 'memory-dedup';

// Provide any embedder — OpenAI, local model, or mock
const dedup = createDeduplicator({
  embedder: async (text) => {
    // Return a numeric embedding vector for the text
    const response = await openai.embeddings.create({ input: text, model: 'text-embedding-3-small' });
    return response.data[0].embedding;
  },
  threshold: 0.90,         // semantic duplicate threshold (default: 0.90)
  exactThreshold: 0.98,    // exact duplicate via cosine (default: 0.98)
  relatedThreshold: 0.75,  // related but not duplicate (default: 0.75)
  mergePolicy: 'keep-longest',
});

await dedup.add({ id: 'mem-1', content: 'The sky is blue.' });
await dedup.add({ id: 'mem-2', content: 'The sky is blue.' }); // exact dup → skipped/merged

const result = await dedup.check({ id: 'mem-3', content: 'The sky appears blue in color.' });
console.log(result.classification); // 'semantic_duplicate'
```

## API

### `createDeduplicator(options: DedupOptions): MemoryDedup`

Creates a deduplicator instance.

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `embedder` | `(text: string) => Promise<number[]>` | required | Function that returns an embedding vector |
| `threshold` | `number` | `0.90` | Cosine similarity threshold for semantic duplicates |
| `exactThreshold` | `number` | `0.98` | Cosine similarity threshold for exact duplicates |
| `relatedThreshold` | `number` | `0.75` | Cosine similarity threshold for related entries |
| `mergePolicy` | `MergePolicy` | `'keep-newest'` | How to handle duplicates |

**Merge policies:** `'keep-newest'` | `'keep-oldest'` | `'keep-longest'` | `'keep-highest-confidence'` | `'merge'` | custom function.

---

### `dedup.check(entry: MemoryEntry): Promise<DedupResult>`

Checks whether an entry is a duplicate without storing it.

```typescript
const result = await dedup.check({ id: 'x', content: 'Some text' });
// result.classification: 'exact_duplicate' | 'semantic_duplicate' | 'related' | 'unique'
// result.matchId?: string      — id of the matching stored entry
// result.similarity?: number   — cosine similarity score
// result.hashMatch?: boolean   — true if matched via content hash (no embedding call)
// result.durationMs: number
```

---

### `dedup.add(entry: MemoryEntry): Promise<AddResult>`

Checks and conditionally stores an entry.

```typescript
const result = await dedup.add({ id: 'x', content: 'Some text' });
// result.action: 'added' | 'merged' | 'skipped'
// result.survivorId?: string
// result.evictedId?: string
```

---

### `dedup.addBatch(entries: MemoryEntry[]): Promise<BatchResult>`

Adds multiple entries sequentially.

```typescript
const result = await dedup.addBatch(entries);
// result.totalProcessed: number
// result.uniqueAdded: number
// result.duplicatesFound: number
// result.results: AddResult[]
```

---

### `dedup.sweep(): Promise<SweepResult>`

O(n²) pairwise scan of all stored entries. Finds and merges duplicates that may have been added before the threshold was tuned, or loaded from an external backend.

```typescript
const result = await dedup.sweep();
// result.duplicatePairs: Array<[string, string]>
// result.duplicateCount: number
// result.evictedCount: number
// result.evictedIds: string[]
// result.totalScanned: number
```

---

### `dedup.compact(): Promise<CompactResult>`

Like `sweep()` but also handles transitive duplicates by grouping entries into clusters using union-find before merging.

```typescript
const result = await dedup.compact();
// ...all SweepResult fields, plus:
// result.clustersFound: number
// result.mergedCount: number
```

---

### Other methods

```typescript
dedup.getEntries(): MemoryEntry[]
dedup.remove(id: string): void
dedup.clear(): void
dedup.stats(): DedupStats     // totalEntries, totalChecks, exactDuplicates, semanticDuplicates, uniqueEntries
dedup.size(): number
```

---

### Events

```typescript
const unsub = dedup.on('added', (payload) => console.log('added', payload));
dedup.on('duplicate-found', (payload) => {});
dedup.on('merged', (payload) => {});
dedup.on('evicted', (payload) => {});
unsub(); // unsubscribe
```

## Types

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}
```

## License

MIT
