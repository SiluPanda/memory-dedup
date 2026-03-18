# memory-dedup -- Task Breakdown

This file tracks all implementation tasks derived from SPEC.md. Tasks are grouped by phase following the implementation roadmap (Section 18), with additional phases for testing, documentation, and publishing.

---

## Phase 0: Project Scaffolding and Dev Environment

- [ ] **Install dev dependencies** — Add `typescript` (>=5.0), `vitest`, and `eslint` as devDependencies in `package.json`. Run `npm install` to generate `node_modules` and `package-lock.json`. | Status: not_done
- [ ] **Configure ESLint** — Create an ESLint configuration file (`.eslintrc` or `eslint.config.js`) suitable for TypeScript. Ensure `npm run lint` works against `src/`. | Status: not_done
- [ ] **Verify build pipeline** — Confirm `npm run build` compiles `src/` to `dist/` using the existing `tsconfig.json`. Ensure `declaration`, `declarationMap`, and `sourceMap` outputs are generated. | Status: not_done
- [ ] **Verify test pipeline** — Confirm `npm run test` runs Vitest correctly. Create a trivial placeholder test to validate the runner works. | Status: not_done
- [ ] **Create source directory structure** — Create all directories specified in Section 17: `src/pipeline/`, `src/merge/`, `src/similarity/`, `src/store/`, `src/cluster/`, and `src/__tests__/` with its subdirectories (`pipeline/`, `merge/`, `operations/`, `similarity/`, `store/`, `events/`, `fixtures/`). | Status: not_done
- [ ] **Add .gitignore entries** — Ensure `dist/`, `node_modules/`, and any build artifacts are gitignored. | Status: not_done

---

## Phase 1: Core Types and Error Classes

- [ ] **Define MemoryEntry interface** — Create `src/types.ts` with the `MemoryEntry` interface: `id: string`, `content: string`, `metadata?: EntryMetadata`. | Status: not_done
- [ ] **Define EntryMetadata interface** — In `src/types.ts`, define `EntryMetadata` with all optional fields: `timestamp`, `createdAt`, `updatedAt`, `source`, `sources`, `confidence`, `tags`, `type`, `mergedFrom`, and index signature `[key: string]: unknown`. | Status: not_done
- [ ] **Define DedupOptions interface** — In `src/types.ts`, define the full `DedupOptions` interface with all fields: `embedder`, `threshold`, `exactThreshold`, `relatedThreshold`, `mergePolicy`, `normalizedEmbeddings`, `metadataBoost`, `maxMetadataBoost`, `metadataMergeRules`, `store`, `embedBatchSize`, `now`. | Status: not_done
- [ ] **Define MergePolicyName and MergePolicyFunction types** — `MergePolicyName` as a union of the five built-in policy strings. `MergePolicyFunction` as `(candidate, match, similarity) => MergeResult | Promise<MergeResult>`. | Status: not_done
- [ ] **Define DedupClassification type** — Union type: `'exact_duplicate' | 'semantic_duplicate' | 'related' | 'unique'`. | Status: not_done
- [ ] **Define DedupResult interface** — Fields: `classification`, `matchId`, `similarity`, `rawSimilarity`, `embedding`, `hashMatch`, `durationMs`. | Status: not_done
- [ ] **Define AddResult interface** — Extends `DedupResult` with `action` (`'added' | 'merged' | 'skipped'`), `survivorId`, `evictedId`, `survivor`. | Status: not_done
- [ ] **Define BatchResult interface** — Fields: `results`, `totalProcessed`, `uniqueAdded`, `duplicatesFound`, `relatedFound`, `durationMs`. | Status: not_done
- [ ] **Define SweepResult interface** — Fields: `duplicatePairs`, `duplicateCount`, `evictedCount`, `evictedIds`, `totalScanned`, `durationMs`. | Status: not_done
- [ ] **Define CompactResult interface** — Extends `SweepResult` with `clusters`, `clusterCount`, `entriesBefore`, `entriesAfter`, `reductionRatio`. | Status: not_done
- [ ] **Define MergeResult interface** — Fields: `survivor: MemoryEntry`, `evicted: MemoryEntry | null`. | Status: not_done
- [ ] **Define DedupStats interface** — Fields: `totalEntries`, `totalChecks`, `exactDuplicates`, `semanticDuplicates`, `relatedEntries`, `uniqueEntries`, `evictedEntries`, `embeddingCalls`, `embeddingCallsSaved`, `averageDuplicateSimilarity`, `deduplicationRate`. | Status: not_done
- [ ] **Define MetadataMergeRules interface** — Fields: `timestamp`, `source`, `tags`, `confidence` with their respective option unions. | Status: not_done
- [ ] **Define StoreBackend interface** — Methods: `set`, `get`, `delete`, `getAll`, `size`, `search`, `clear`. All async. | Status: not_done
- [ ] **Define DedupEvents interface** — Event map: `'duplicate-found'`, `'merged'`, `'evicted'`, `'added'`, `'sweep-complete'` with their payload types. Also define `DedupEventName` and `DedupEventHandler<E>`. | Status: not_done
- [ ] **Define MemoryDedup interface** — The public API surface: `check`, `add`, `addBatch`, `sweep`, `compact`, `getEntries`, `getEntry`, `getDuplicateGroups`, `remove`, `clear`, `stats`, `size`, `on`, `destroy`. | Status: not_done
- [ ] **Implement DedupError base class** — In `src/errors.ts`, create `DedupError extends Error` with a `readonly code: string` property. | Status: not_done
- [ ] **Implement DedupConfigError** — Extends `DedupError`, `code = 'DEDUP_CONFIG_ERROR'`. | Status: not_done
- [ ] **Implement DedupEmbeddingError** — Extends `DedupError`, `code = 'DEDUP_EMBEDDING_ERROR'`. | Status: not_done
- [ ] **Implement DedupStoreError** — Extends `DedupError`, `code = 'DEDUP_STORE_ERROR'`. | Status: not_done

---

## Phase 2: Event System

- [ ] **Implement event emitter** — In `src/events.ts`, implement a simple typed event emitter using `Map<string, Set<Function>>`. Methods: `on(event, handler)` returning an unsubscribe function, `emit(event, payload)`, and `removeAll()` to clear all handlers. No external dependencies. | Status: not_done
- [ ] **Write event emitter unit tests** — In `src/__tests__/events/emission.test.ts`, test: registering handlers, emitting events with correct payloads, multiple handlers on the same event, emitting events with no handlers (no error). | Status: not_done
- [ ] **Write unsubscribe tests** — In `src/__tests__/events/unsubscribe.test.ts`, test: unsubscribe function returned by `on()`, handler not called after unsubscribe, `removeAll()` clears everything. | Status: not_done

---

## Phase 3: Pipeline Stage 1 -- Text Normalization

- [ ] **Implement text normalization** — In `src/pipeline/normalize.ts`, implement `normalizeText(text: string): string`. Operations: convert to lowercase, collapse sequences of whitespace into single spaces, trim leading/trailing whitespace, strip trailing periods and extra commas, apply Unicode NFC normalization. Preserve the original entry content (normalization is internal only). | Status: not_done
- [ ] **Handle normalization edge cases** — Empty strings return empty. Already-normalized strings are unchanged (idempotent). Very long strings (10KB+) are handled without issues. | Status: not_done
- [ ] **Write normalization unit tests** — In `src/__tests__/pipeline/normalize.test.ts`. Test cases: mixed case, extra whitespace, trailing punctuation, Unicode characters (accented letters, CJK), empty string, already-normalized string, idempotency (normalize(normalize(x)) === normalize(x)), very long strings. | Status: not_done

---

## Phase 4: Pipeline Stage 2 -- Content Hashing

- [ ] **Implement content hashing** — In `src/pipeline/hash.ts`, implement `computeHash(normalizedText: string): string` using SHA-256 via `node:crypto`. Returns a 64-character hex string. | Status: not_done
- [ ] **Implement hash index** — In `src/pipeline/hash.ts`, implement a `HashIndex` class (or equivalent) that stores `Map<hash, entryId>` and provides `lookup(hash): string | null` and `add(hash, entryId)` methods. Support `delete(hash)` and `clear()`. | Status: not_done
- [ ] **Handle hashing edge cases** — Empty string produces a valid hash. Very long strings produce a valid hash. Unicode strings are hashed correctly after NFC normalization. | Status: not_done
- [ ] **Write hashing unit tests** — In `src/__tests__/pipeline/hash.test.ts`. Test: identical normalized texts produce identical hashes, different texts produce different hashes, hash format is 64-char hex, empty string hash, very long string hash, Unicode string hash, hash index lookup/add/delete. | Status: not_done

---

## Phase 5: In-Memory Store Backend

- [ ] **Implement InMemoryStore** — In `src/store/in-memory.ts`, implement the `StoreBackend` interface using `Map<string, { entry: MemoryEntry; embedding: number[] }>`. Methods: `set`, `get`, `delete`, `getAll`, `size`, `search` (brute-force cosine similarity over all vectors), `clear`. | Status: not_done
- [ ] **Implement brute-force search in InMemoryStore** — The `search(queryVector, k)` method iterates all stored entries, computes cosine similarity against the query vector, sorts by similarity descending, and returns the top-k results. | Status: not_done
- [ ] **Write InMemoryStore unit tests** — In `src/__tests__/store/in-memory.test.ts`. Test: set and get entries, delete entries, getAll returns all, size returns count, search returns correct ordering, clear empties the store, search on empty store returns empty array. | Status: not_done
- [ ] **Write StoreBackend contract tests** — In `src/__tests__/store/backend-interface.test.ts`. Define a test suite that validates any `StoreBackend` implementation. Run it against `InMemoryStore`. Test the interface contract: set/get roundtrip, delete removes entry, search finds nearest, etc. | Status: not_done

---

## Phase 6: Cosine Similarity

- [ ] **Implement cosine similarity (dot product path)** — In `src/similarity/cosine.ts`, implement `cosineSimilarity(a: number[], b: number[]): number`. For the default case (`normalizedEmbeddings: true`), compute the dot product: `sum(a[i] * b[i])`. Tight loop, no heap allocation. | Status: not_done
- [ ] **Implement cosine similarity (full formula path)** — For non-normalized vectors, compute `dot / (magA * magB)` where `magA = sqrt(sum(a[i]^2))` and `magB = sqrt(sum(b[i]^2))`. Handle edge case where magnitude is zero (return 0.0). | Status: not_done
- [ ] **Export a factory or config-aware function** — Provide a way to select the dot-product or full-formula path based on the `normalizedEmbeddings` config flag. | Status: not_done
- [ ] **Write cosine similarity unit tests** — In `src/__tests__/similarity/cosine.test.ts`. Test: identical vectors produce 1.0, orthogonal vectors produce 0.0, known vector pairs with precomputed similarity, various dimensions (384, 768, 1024, 1536), dot-product path matches full formula for normalized vectors, zero-magnitude vector edge case. | Status: not_done

---

## Phase 7: Metadata Similarity Boost

- [ ] **Implement metadata boost logic** — In `src/similarity/metadata-boost.ts`, implement `computeMetadataBoost(entryA: MemoryEntry, entryB: MemoryEntry, config: { metadataBoost: boolean; maxMetadataBoost: number }): number`. Rules: same `source` = +0.02, overlapping `tags` = +0.01 per overlap (max +0.03), same `type` = +0.02. Total capped at `maxMetadataBoost` (default 0.05). Return 0 if `metadataBoost` is false. | Status: not_done
- [ ] **Write metadata boost unit tests** — In `src/__tests__/similarity/metadata-boost.test.ts`. Test: same source adds +0.02, overlapping tags add correctly, same type adds +0.02, total capped at maxMetadataBoost, boost disabled returns 0, no metadata on either entry returns 0, partial metadata (one entry has tags, other doesn't). | Status: not_done

---

## Phase 8: Pipeline Stage 5 -- Classification

- [ ] **Implement classification logic** — In `src/pipeline/classify.ts`, implement `classify(similarity: number, thresholds: { exactThreshold: number; threshold: number; relatedThreshold: number }): DedupClassification`. Map similarity score to tier: `>= exactThreshold` => `'exact_duplicate'`, `>= threshold` => `'semantic_duplicate'`, `>= relatedThreshold` => `'related'`, else `'unique'`. | Status: not_done
- [ ] **Write classification unit tests** — In `src/__tests__/pipeline/classify.test.ts`. Test: score at exact threshold boundary, score between thresholds, score below related threshold, custom thresholds, boundary values (score exactly at threshold, one epsilon below). | Status: not_done

---

## Phase 9: Merge Policies

- [ ] **Implement merge policy dispatcher** — In `src/merge/index.ts`, implement a dispatcher that accepts a `MergePolicyName | MergePolicyFunction` and returns the appropriate merge function. Look up built-in policies by name; pass through custom functions directly. | Status: not_done
- [ ] **Implement keep-newest merge policy** — In `src/merge/keep-newest.ts`. Compare `timestamp` (or `createdAt`) metadata. Keep the entry with the more recent timestamp. If timestamps are absent, keep the candidate (incoming entry). Append evicted entry's `sources` to survivor's `sources`. | Status: not_done
- [ ] **Implement keep-oldest merge policy** — In `src/merge/keep-oldest.ts`. Opposite of keep-newest: keep the entry with the earlier timestamp. If timestamps are absent, keep the existing match. | Status: not_done
- [ ] **Implement keep-longest merge policy** — In `src/merge/keep-longest.ts`. Compare `content.length`. Keep the entry with longer content. Store evicted entry metadata in survivor's `mergedFrom`. | Status: not_done
- [ ] **Implement keep-highest-confidence merge policy** — In `src/merge/keep-highest-confidence.ts`. Compare `metadata.confidence`. Keep higher confidence entry. Fall back to `keep-newest` if neither has a confidence score. | Status: not_done
- [ ] **Implement merge (combine) policy** — In `src/merge/merge-combine.ts`. Merged content is the longer of the two texts. Merged metadata: earliest `createdAt`/`timestamp`, latest `updatedAt`, union of `tags`, union of `sources`, higher `confidence`. Store shorter entry's text in `metadata.mergedFrom`. | Status: not_done
- [ ] **Implement metadata merge logic** — In `src/merge/metadata.ts`. Default merge rules per Section 7: `timestamp` => earliest, `updatedAt` => latest, `source` => union, `tags` => union, `confidence` => highest, `type` => survivor's, other fields => survivor's with evicted in `mergedFrom`. Support `MetadataMergeRules` overrides. | Status: not_done
- [ ] **Write keep-newest tests** — In `src/__tests__/merge/keep-newest.test.ts`. Test with entries having timestamps, without timestamps, with sources arrays that need merging. | Status: not_done
- [ ] **Write keep-oldest tests** — In `src/__tests__/merge/keep-oldest.test.ts`. Mirror of keep-newest tests but with opposite expected survivor. | Status: not_done
- [ ] **Write keep-longest tests** — In `src/__tests__/merge/keep-longest.test.ts`. Test with entries of different lengths, same length (tiebreaker behavior), mergedFrom metadata tracking. | Status: not_done
- [ ] **Write keep-highest-confidence tests** — In `src/__tests__/merge/keep-highest-confidence.test.ts`. Test with confidence scores, without confidence (fallback to keep-newest), equal confidence. | Status: not_done
- [ ] **Write merge (combine) policy tests** — In `src/__tests__/merge/merge-policy.test.ts`. Test content selection (longer wins), metadata union, mergedFrom population, tag union, source union. | Status: not_done
- [ ] **Write custom merge policy tests** — In `src/__tests__/merge/custom.test.ts`. Test with a mock custom function, verify it receives correct arguments (candidate, match, similarity), verify its return value is used. Test async custom function. | Status: not_done
- [ ] **Write metadata merge rules tests** — In `src/__tests__/merge/metadata-merge.test.ts`. Test default rules, custom rules overriding defaults, edge cases (missing fields, empty arrays). | Status: not_done

---

## Phase 10: Pipeline Stage 3 -- Embedding Generation

- [ ] **Implement embedding stage** — In `src/pipeline/embed.ts`, implement the embedding generation stage. Call the configured `embedder(content)` with the original entry content (not normalized). Store the dimension of the first embedding and validate subsequent embeddings have the same dimension. Throw `DedupEmbeddingError` if the embedder fails. Throw `DedupConfigError` if dimensions are inconsistent. | Status: not_done
- [ ] **Implement batch embedding support** — In `src/pipeline/embed.ts`, implement batch embedding. Collect entries needing embeddings, chunk them by `embedBatchSize` (default 100). If the embedder has a `batch` property that is a function, call `embedder.batch(texts)` for each chunk. Otherwise, call the single embedder in parallel within each chunk. | Status: not_done
- [ ] **Track embedding call statistics** — Increment `embeddingCalls` counter for each API call. Increment `embeddingCallsSaved` when a content hash match skips the embedding stage. | Status: not_done
- [ ] **Write embedding stage tests** — In `src/__tests__/pipeline/embed.test.ts`. Test: mock embedder is called with correct text, dimension validation (first call sets dimension, mismatched dimension throws), embedder failure wraps error in `DedupEmbeddingError`, batch embedding with `embedder.batch`, batch chunking respects `embedBatchSize`. | Status: not_done

---

## Phase 11: Pipeline Stage 4 -- Similarity Search

- [ ] **Implement similarity search** — In `src/pipeline/search.ts`, implement `findBestMatch(queryVector, store, config)`. Compute cosine similarity between the query vector and all indexed vectors. Apply metadata boost. Return the best match (highest boosted similarity) and its score. Return null match if the index is empty. | Status: not_done
- [ ] **Write similarity search tests** — In `src/__tests__/pipeline/search.test.ts`. Test: search against empty index returns null, search finds the most similar entry, metadata boost affects ranking, multiple entries with varying similarity. | Status: not_done

---

## Phase 12: Pipeline Orchestrator

- [ ] **Implement pipeline orchestrator** — In `src/pipeline/index.ts`, implement the full 6-stage pipeline orchestrator. Stages: (1) normalize, (2) hash lookup, (3) embed (if no hash match), (4) similarity search, (5) classify, (6) merge (if duplicate). Return `DedupResult` or `AddResult`. Track timing via `durationMs`. | Status: not_done
- [ ] **Implement content hash fast path** — When Stage 2 finds a hash match, skip Stages 3 and 4 entirely. Set `hashMatch: true` in the result. Classify as `'exact_duplicate'`. Apply merge policy immediately. | Status: not_done
- [ ] **Handle pipeline errors gracefully** — Wrap embedder calls in try/catch and throw `DedupEmbeddingError`. Wrap store operations in try/catch and throw `DedupStoreError`. | Status: not_done

---

## Phase 13: Configuration Validation

- [ ] **Implement configuration validation** — Validate all `DedupOptions` at `createDeduplicator()` call time. Rules from Section 12: `embedder` must be a function; `threshold`, `exactThreshold`, `relatedThreshold` must be numbers in [0, 1] with `relatedThreshold < threshold < exactThreshold`; `mergePolicy` must be a valid name or function; `maxMetadataBoost` must be non-negative; `embedBatchSize` must be a positive integer; `store` must implement `StoreBackend` (duck-type check); `now` must be a function. Throw `DedupConfigError` for violations. | Status: not_done
- [ ] **Apply default values** — Set defaults for optional fields: `threshold` = 0.90, `exactThreshold` = 0.98, `relatedThreshold` = 0.75, `mergePolicy` = `'keep-newest'`, `normalizedEmbeddings` = true, `metadataBoost` = true, `maxMetadataBoost` = 0.05, `embedBatchSize` = 100, `store` = new InMemoryStore, `now` = `() => Date.now()`. | Status: not_done

---

## Phase 14: Deduplicator Core -- `createDeduplicator` and Basic Operations

- [ ] **Implement createDeduplicator factory** — In `src/deduplicator.ts`, implement the `createDeduplicator(options)` function. Validate config, apply defaults, create internal state (hash index, event emitter, stats counters), and return a `MemoryDedup` object. | Status: not_done
- [ ] **Implement lazy initialization** — On first `check()` or `add()` call, if the store is pre-populated, iterate all entries via `store.getAll()`, compute normalized content hashes, and populate the hash index. This ensures Stage 2 works correctly with pre-populated stores. | Status: not_done
- [ ] **Implement check() method** — Run the full dedup pipeline (stages 1-5) without modifying the index. Return a `DedupResult`. Increment `totalChecks` stat. | Status: not_done
- [ ] **Implement add() method** — Run the full dedup pipeline (stages 1-6). If unique, add the entry and its embedding to the store and hash index. If duplicate, apply the merge policy: update the survivor in the store, remove the evicted entry, update the hash index. Emit appropriate events (`'added'`, `'duplicate-found'`, `'merged'`, `'evicted'`). Return an `AddResult`. | Status: not_done
- [ ] **Implement getEntries() method** — Return all entries currently in the store. | Status: not_done
- [ ] **Implement getEntry(id) method** — Return a specific entry by ID, or undefined if not found. | Status: not_done
- [ ] **Implement remove(id) method** — Remove an entry from the store and hash index. Return true if the entry existed. Emit `'evicted'` with reason `'manual'`. | Status: not_done
- [ ] **Implement clear() method** — Remove all entries from the store and hash index. Reset stats counters that represent current state (e.g., `totalEntries`). | Status: not_done
- [ ] **Implement size getter** — Return the number of entries in the store. | Status: not_done
- [ ] **Implement stats() method** — Return a `DedupStats` object with all counters: `totalEntries`, `totalChecks`, `exactDuplicates`, `semanticDuplicates`, `relatedEntries`, `uniqueEntries`, `evictedEntries`, `embeddingCalls`, `embeddingCallsSaved`, `averageDuplicateSimilarity`, `deduplicationRate`. | Status: not_done
- [ ] **Implement on() method** — Delegate to the internal event emitter. Return an unsubscribe function. | Status: not_done
- [ ] **Implement destroy() method** — Clear the store, hash index, and event emitter. Mark the instance as destroyed. Throw if any method is called after destroy. | Status: not_done

---

## Phase 15: Batch Operations

- [ ] **Implement addBatch() method** — Accept an array of `MemoryEntry`. Process entries sequentially (each entry is checked against the index, which includes previously added entries from this batch). Compute embeddings in batches using the batch embedding logic from Phase 10. Return a `BatchResult` with per-entry results and summary statistics. | Status: not_done
- [ ] **Optimize addBatch embedding calls** — Pre-filter entries that have content hash matches (they skip embedding). Batch remaining entries for embedding. Use `embedder.batch` if available; otherwise, call single embedder concurrently within batch-size chunks. | Status: not_done
- [ ] **Write addBatch tests** — In `src/__tests__/operations/add-batch.test.ts`. Test: batch with no duplicates, batch with duplicates within the batch, batch with duplicates against previously added entries, empty batch, batch statistics accuracy. | Status: not_done

---

## Phase 16: Sweep Operation

- [ ] **Implement sweep() method** — Scan all entries in the index for duplicate pairs. For small indexes (<=10,000), use brute-force pairwise comparison. Apply merge policies to detected duplicates. Return a `SweepResult`. Emit `'sweep-complete'` event. | Status: not_done
- [ ] **Implement cluster-based sweep optimization** — For indexes > some threshold, partition entries into k clusters (k = max(1, sqrt(n))) using simple k-means on embedding vectors. Perform pairwise comparison within each cluster. Compare cluster centroids; if two centroids are above `relatedThreshold`, perform cross-cluster pairwise comparison. | Status: not_done
- [ ] **Implement getDuplicateGroups() method** — Return groups of entries that have been identified as duplicates of each other. Each group has a representative, list of member IDs, and average similarity. | Status: not_done
- [ ] **Write sweep tests** — In `src/__tests__/operations/sweep.test.ts`. Test: sweep on empty index, sweep with no duplicates, sweep with known duplicate pairs, sweep applies merge policies correctly, sweep statistics, sweep-complete event fires. | Status: not_done

---

## Phase 17: Compact Operation

- [ ] **Implement compact() method** — Extends sweep: after merging duplicates, group remaining entries into clusters of related information. Select a representative from each cluster (the entry closest to the cluster centroid). Return a `CompactResult` with clusters, reduction statistics, and entries before/after counts. | Status: not_done
- [ ] **Implement k-means clustering** — In `src/cluster/kmeans.ts`, implement simple k-means-like clustering. Input: array of vectors and entry IDs. Steps: (1) select k random centroids, (2) assign each entry to nearest centroid, (3) recompute centroids as mean of assigned vectors, (4) repeat for a fixed number of iterations (e.g., 10). Return clusters with centroid, member IDs, and average intra-cluster similarity. | Status: not_done
- [ ] **Write compact tests** — In `src/__tests__/operations/compact.test.ts`. Test: compact on empty index, compact with distinct entries (no merging, each entry is its own cluster), compact with known duplicate groups, cluster formation, reduction ratio calculation, compact producing a single cluster. | Status: not_done

---

## Phase 18: Pluggable Store Backend

- [ ] **Extract InMemoryStore to implement StoreBackend interface** — Ensure the in-memory store from Phase 5 fully conforms to the `StoreBackend` interface. The deduplicator should interact with entries exclusively through this interface. | Status: not_done
- [ ] **Support custom store backends via DedupOptions** — When `options.store` is provided, use it instead of the default `InMemoryStore`. Duck-type validate the store at construction time (check for `set`, `get`, `delete`, `getAll`, `size`, `search`, `clear` functions). | Status: not_done
- [ ] **Implement index rebuild on load** — When a pre-populated store is provided, on first use (`check()` or `add()`), iterate all entries via `store.getAll()`, compute normalized content hashes, and populate the in-memory hash index. | Status: not_done
- [ ] **Write store backend interface tests** — In `src/__tests__/store/backend-interface.test.ts`. Create a mock custom store backend. Test that the deduplicator correctly delegates to the custom store for all operations. | Status: not_done

---

## Phase 19: Public API Exports

- [ ] **Set up src/index.ts exports** — Export `createDeduplicator` as the primary function. Export all TypeScript types: `MemoryEntry`, `EntryMetadata`, `DedupOptions`, `DedupResult`, `AddResult`, `BatchResult`, `SweepResult`, `CompactResult`, `MergeResult`, `DedupStats`, `MergePolicyName`, `MergePolicyFunction`, `DedupClassification`, `StoreBackend`, `MetadataMergeRules`, `DedupEvents`, `DedupEventName`, `DedupEventHandler`, `MemoryDedup`. Export error classes: `DedupError`, `DedupConfigError`, `DedupEmbeddingError`, `DedupStoreError`. Export `cosineSimilarity` as a utility. | Status: not_done

---

## Phase 20: Integration Tests

- [ ] **Write check() integration tests** — In `src/__tests__/operations/check.test.ts`. Test: check against empty index (unique), check with content hash match (exact_duplicate), check with semantic match (semantic_duplicate), check with related entry, check does not modify the index. | Status: not_done
- [ ] **Write add() integration tests** — In `src/__tests__/operations/add.test.ts`. Test: add unique entry, add exact duplicate (hash match), add semantic duplicate, add with each merge policy, add emits correct events, add returns correct AddResult fields, add with metadata boost affecting classification. | Status: not_done
- [ ] **Write full lifecycle integration tests** — In `src/__tests__/dedup.test.ts`. Test the complete workflow: create deduplicator, add entries, check duplicates, sweep, compact, stats, events, remove, clear, destroy. Use a mock embedder with predetermined vectors. | Status: not_done
- [ ] **Write custom embedder integration tests** — Test with a deterministic mock embedder that returns different vectors for semantically different content and similar vectors for semantically similar content. Verify classification accuracy. | Status: not_done

---

## Phase 21: Test Fixtures

- [ ] **Create test entry fixtures** — In `src/__tests__/fixtures/entries.ts`. Define a set of `MemoryEntry` objects with known duplicate/unique relationships. Include: exact text duplicates, semantic paraphrases (e.g., "User lives in NYC" / "User's location is New York City"), related-but-different entries, completely unique entries. Include entries with various metadata combinations. | Status: not_done
- [ ] **Create test embedding fixtures** — In `src/__tests__/fixtures/embeddings.ts`. Define predetermined embedding vectors for the test entries. Ensure duplicate entries have vectors with cosine similarity above the default threshold (0.90). Ensure unique entries have low similarity. | Status: not_done
- [ ] **Create mock embedder** — In `src/__tests__/fixtures/mock-embedder.ts`. Implement a mock embedder function that returns vectors from a lookup table keyed by content text. For entries not in the lookup table, generate a deterministic random vector seeded by content hash. | Status: not_done

---

## Phase 22: Edge Case Tests

- [ ] **Test empty entry content** — Add an entry with empty string content. Verify normalization, hashing, and embedding all handle empty input. | Status: not_done
- [ ] **Test very long content** — Add an entry with 10KB+ content. Verify all pipeline stages handle large input without errors or performance issues. | Status: not_done
- [ ] **Test entry with no metadata** — Add entries without the optional `metadata` field. Verify merge policies handle undefined metadata gracefully. | Status: not_done
- [ ] **Test entry with all metadata fields populated** — Add entries with every `EntryMetadata` field populated. Verify metadata merging handles the full set. | Status: not_done
- [ ] **Test duplicate detection with single entry in index** — Add one entry, then add a duplicate. Verify detection works with minimal index. | Status: not_done
- [ ] **Test sweep on empty index** — Run `sweep()` on an empty deduplicator. Verify it returns an empty result without errors. | Status: not_done
- [ ] **Test sweep with no duplicates** — Add only unique entries, run `sweep()`. Verify no duplicates are detected. | Status: not_done
- [ ] **Test sweep with all entries as duplicates** — Add entries that are all duplicates of each other. Run `sweep()`. Verify correct pairwise detection and merging. | Status: not_done
- [ ] **Test compact producing a single cluster** — Add entries that are all related. Run `compact()`. Verify a single cluster is formed. | Status: not_done
- [ ] **Test embedder that throws** — Configure an embedder that throws an error. Call `add()`. Verify `DedupEmbeddingError` is thrown with the original error as cause. | Status: not_done
- [ ] **Test embedder returning wrong dimensions** — First call returns 1536-dim vector, second call returns 768-dim. Verify `DedupConfigError` is thrown. | Status: not_done
- [ ] **Test destroy followed by method calls** — Call `destroy()`, then attempt `add()`, `check()`, `sweep()`. Verify appropriate errors are thrown. | Status: not_done
- [ ] **Test configuration validation errors** — Missing embedder, invalid threshold values, threshold ordering violation (`relatedThreshold > threshold`), invalid mergePolicy name, negative `maxMetadataBoost`, non-integer `embedBatchSize`, invalid store (missing methods). Verify `DedupConfigError` for each. | Status: not_done

---

## Phase 23: Performance Verification

- [ ] **Benchmark incremental add (1K entries)** — Add 1,000 entries with a mock embedder. Measure total time. Verify similarity search time is acceptable (~5ms per add at 1K index size). | Status: not_done
- [ ] **Benchmark sweep (1K entries)** — Run `sweep()` on 1,000 entries. Measure total time. Compare brute-force vs. clustered approach timing. | Status: not_done
- [ ] **Benchmark content hash fast path** — Add entries that are all exact duplicates (after normalization). Verify sub-millisecond per-entry dedup time since embedding is skipped. | Status: not_done
- [ ] **Verify memory footprint** — Track memory usage when adding 1,000 entries with 1536-dim vectors. Verify it aligns with the estimate from Section 15 (~12.6 MB). | Status: not_done

---

## Phase 24: Documentation

- [ ] **Write README.md** — Create `README.md` with: package description, installation instructions (`npm install memory-dedup`), quick start example (create deduplicator, add entries, check for duplicates), API reference (all methods with signatures and descriptions), configuration options table, merge policies explanation, integration examples (OpenAI, Cohere, transformers.js, embed-cache, agent-scratchpad, sliding-context, LangChain), performance characteristics, and license. | Status: not_done
- [ ] **Add JSDoc comments to all public exports** — Ensure `createDeduplicator`, all interfaces, all type aliases, and all error classes have complete JSDoc documentation matching the spec descriptions. | Status: not_done

---

## Phase 25: Build and Publish Preparation

- [ ] **Verify package.json fields** — Confirm `name`, `version`, `description`, `main` (`dist/index.js`), `types` (`dist/index.d.ts`), `files` (`["dist"]`), `engines` (`>=18`), `license` (`MIT`), `publishConfig` (`{ "access": "public" }`). Add `keywords` relevant to the package (e.g., `memory`, `deduplication`, `semantic`, `embedding`, `agent`, `llm`). | Status: not_done
- [ ] **Bump version per monorepo workflow** — Bump version appropriately in `package.json` before committing final changes. | Status: not_done
- [ ] **Run full build** — `npm run build` must succeed with zero errors. Verify `dist/` contains `.js`, `.d.ts`, `.js.map`, and `.d.ts.map` files. | Status: not_done
- [ ] **Run full test suite** — `npm run test` must pass with all tests green. | Status: not_done
- [ ] **Run lint** — `npm run lint` must pass with zero errors. | Status: not_done
- [ ] **Verify package contents** — Run `npm pack --dry-run` to verify only `dist/` files are included. No source files, test files, or unnecessary artifacts. | Status: not_done
