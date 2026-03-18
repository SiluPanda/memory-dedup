# memory-dedup -- Specification

## 1. Overview

`memory-dedup` is a semantic deduplication library for agent memory entries. It accepts memory entries -- structured text records with metadata such as timestamps, sources, confidence scores, and tags -- computes text embeddings via a pluggable embedding provider, measures cosine similarity between entry vectors, and classifies pairs as exact duplicates, semantic duplicates, related-but-different, or unique. When duplicates are detected, a configurable merge policy determines the outcome: keep the newest, keep the oldest, keep the most detailed, merge information from both, or apply a custom function. The result is a deduplicated memory store that eliminates redundant information while preserving complementary facts. The package provides both incremental dedup (check each entry on insert) and batch sweep dedup (scan all entries periodically), with an event system for observability.

The gap this package fills is specific and well-defined. AI agents that maintain long-term memory -- storing facts, observations, preferences, and instructions across sessions -- accumulate duplicate information over time. An agent that queries a user's location in three separate conversations stores three entries: "User lives in NYC", "User's location is New York City", and "The user is based in New York, NY". These are semantically identical but textually different. Exact string matching does not catch them. Even fuzzy string matching struggles: the Levenshtein distance between "User lives in NYC" and "User's location is New York City" is high despite identical meaning. The duplicates waste token budget when injected into prompts, degrade retrieval relevance by diluting the entry pool, increase embedding storage costs, and slow similarity search. As agents run longer and across more sessions, the problem compounds -- memory bloat is the inevitable result of a write-everything, clean-up-never architecture.

The existing ecosystem addresses adjacent problems but not this one. MemGPT (Letta) manages memory through a tiered architecture -- core memory, recall memory, and archival memory -- with LLM-driven compaction that summarizes and evicts entries when context windows fill. But MemGPT's compaction is coarse-grained: it summarizes entire conversation blocks rather than detecting and merging individual duplicate facts. LangChain's memory module stores conversation history and extracted facts, and LangMem provides a memory manager that can update existing memories when new information arrives, but it relies on LLM calls for each consolidation decision -- expensive, slow, and non-deterministic. Mem0 offers an intelligent memory layer with entity-level deduplication using semantic similarity, but it is a managed service and Python SDK, not an embeddable JavaScript library. The `memorix` npm package provides basic heuristic deduplication and LLM-based merging, but couples dedup logic with its storage layer and search engine. Redis Agent Memory Server implements dedup via content hashing and semantic similarity, but is Redis-specific and server-side. NVIDIA NeMo Curator's SemDedup and the `semhash` Python library demonstrate embedding-based semantic deduplication at dataset scale, but target training data curation in Python, not agent memory management in JavaScript. No npm package provides standalone, framework-agnostic semantic deduplication of memory entries with pluggable embeddings, configurable similarity thresholds, and merge policies.

`memory-dedup` provides exactly this. It is a deduplication engine, not a memory store. It accepts entries, detects duplicates using a multi-stage pipeline (normalization, content hashing, embedding similarity), applies merge policies, and emits the deduplicated result. The embedding provider is pluggable: callers supply an `(text: string) => Promise<number[]>` function that wraps any embedding API (OpenAI `text-embedding-3-small`, Cohere `embed-english-v3.0`, local models via `transformers.js`, or any other source). The package integrates with `embed-cache` from this monorepo to avoid redundant embedding API calls, with `agent-scratchpad` for deduplicating working memory entries, and with `sliding-context` for deduplicating facts extracted from conversation history.

`prompt-dedup` in this monorepo addresses a related but distinct problem: it deduplicates LLM prompt strings using deterministic text normalization and token-level similarity, operating without embeddings. `memory-dedup` targets agent memory entries -- shorter, structured facts with metadata -- using embedding-based semantic similarity that catches paraphrase equivalence. The two packages are complementary: `prompt-dedup` normalizes cache keys, `memory-dedup` compacts agent knowledge.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createDeduplicator(options)` function that returns a `MemoryDedup` instance -- a deduplication engine that accepts memory entries, detects semantic duplicates, applies merge policies, and maintains a deduplicated entry index.
- Detect semantic duplicates using embedding-based cosine similarity with configurable thresholds, catching paraphrase equivalence that exact string matching and edit distance cannot ("User lives in NYC" and "User's location is New York City" are duplicates).
- Implement a multi-stage deduplication pipeline: text normalization (fast, free), content hash matching (fast, catches exact/near-exact duplicates without embedding cost), then embedding similarity (catches semantic duplicates, requires embedding API).
- Support configurable similarity thresholds with three classification tiers: exact duplicate (cosine similarity above 0.98), semantic duplicate (above a configurable threshold, default 0.90), and related-but-different (above 0.75 but below the duplicate threshold). Entries below 0.75 are classified as unique.
- Provide six built-in merge policies for handling detected duplicates: `keep-newest`, `keep-oldest`, `keep-longest`, `keep-highest-confidence`, `merge`, and `custom`. Merge policies determine which entry survives and how metadata is combined.
- Support both incremental dedup (`add()` checks each entry against the index on insert) and batch sweep dedup (`sweep()` scans all entries for duplicate pairs, `compact()` aggressively merges clusters).
- Accept a pluggable embedding provider via a `(text: string) => Promise<number[]>` function interface, with no built-in dependency on any specific embedding API or model.
- Provide event emission (`on('duplicate-found', handler)`, `on('merged', handler)`, `on('evicted', handler)`) for observability, logging, and integration with monitoring systems.
- Integrate with `embed-cache` to cache embedding vectors and avoid redundant API calls when entries are re-embedded.
- Keep runtime dependencies at zero. All dedup logic -- normalization, hashing, cosine similarity computation, merge policies, vector indexing -- uses built-in JavaScript APIs and pure TypeScript implementations.
- Be framework-agnostic. Work with LangChain memory, MemGPT/Letta, Mem0, Vercel AI SDK, custom agent memory systems, or any other memory architecture.
- Operate as a deduplication engine, not a memory store. The package processes entries and returns results; it does not own or persist the canonical memory store.

### Non-Goals

- **Not a memory store.** This package deduplicates entries but does not provide persistent storage. It maintains an in-memory index of entries and their embeddings for dedup purposes, but the canonical memory store is the caller's responsibility. Use a vector database (Pinecone, Weaviate, Qdrant), `agent-scratchpad`, or a custom store for persistence.
- **Not an embedding provider.** This package does not generate embeddings. It accepts a caller-provided embedding function and calls it to obtain vectors. It does not bundle OpenAI, Cohere, or any model. The caller chooses the embedding model and provides the function. Use `embed-cache` to add caching on top of any provider.
- **Not a vector database.** This package does not provide general-purpose vector similarity search, indexing, or retrieval-augmented generation (RAG). It performs similarity search only for deduplication purposes -- finding entries similar to a candidate being added. For full-featured vector search, use Vectra, `hnswlib-node`, Pinecone, or Weaviate.
- **Not an LLM-based deduplication system.** This package does not call an LLM to judge whether two entries are duplicates. It uses deterministic embedding similarity. LLM-based dedup (as in LangMem or Mem0) can make nuanced judgments but is expensive, slow, and non-deterministic. `memory-dedup` provides fast, deterministic, embedding-based dedup. For LLM-enhanced merge decisions, callers can use the `custom` merge policy to invoke an LLM within the merge function.
- **Not a conversation history manager.** This package deduplicates individual memory entries (facts, observations, preferences), not conversation messages. It does not manage message ordering, summarization, or sliding window eviction. Use `sliding-context` for conversation history management.
- **Not a prompt deduplicator.** Prompt deduplication -- normalizing and hashing LLM prompt strings for cache key optimization -- is handled by `prompt-dedup`. This package targets agent memory entries, which are shorter, structured, and carry metadata that participates in merge decisions.

---

## 3. Target Users and Use Cases

### Agent Framework Authors

Teams building custom agent frameworks that include a memory subsystem. The framework stores facts, observations, and preferences extracted from conversations. Over time, the memory accumulates duplicates as the agent re-learns the same information. The framework integrates `memory-dedup` into its memory write path: before persisting a new entry, it calls `dedup.check(entry)` to determine if the entry is a duplicate of an existing one. If it is, the framework either skips the write or merges the entries. A typical integration: the framework calls `createDeduplicator({ embedder: openaiEmbed, threshold: 0.90 })` at initialization and calls `dedup.add(entry)` on every memory write.

### Long-Running Assistant Developers

Developers building assistants that maintain user profiles, preferences, and conversation history across hundreds or thousands of sessions. Each session may extract facts that overlap with previous sessions: "User prefers dark mode" extracted in session 12 and "The user likes dark mode for their interface" extracted in session 47. Without dedup, the assistant's memory grows linearly with session count, degrading retrieval quality and increasing prompt token cost. `memory-dedup` enables periodic `sweep()` or `compact()` operations that clean up accumulated duplicates, keeping memory lean.

### Memory System Operators

DevOps and platform engineers operating shared memory infrastructure for multiple agents. The memory system serves hundreds of agents, each writing entries independently. Cross-agent dedup identifies when different agents store the same fact about a shared entity (e.g., two agents both learn "Company X's API rate limit is 100 req/s"). The `sweep()` operation runs as a background job, producing statistics on dedup rate and memory savings.

### RAG Pipeline Developers

Developers building retrieval-augmented generation pipelines where extracted knowledge is stored for later retrieval. Duplicate entries in the knowledge base reduce retrieval precision: if three near-identical entries about the same topic exist, they consume three of the top-K retrieval slots, crowding out distinct relevant information. `memory-dedup` deduplicates the knowledge base entries before or after indexing, improving retrieval diversity and relevance.

### Agent Scratchpad Users

Developers using `agent-scratchpad` from this monorepo who notice that multi-step agent execution accumulates duplicate working memory entries. An agent that calls a search tool three times for similar queries stores three overlapping result sets. Before rendering the scratchpad to context via `toContext()`, the developer runs the scratchpad entries through `memory-dedup` to eliminate redundancy and maximize the information density of the context window.

---

## 4. Core Concepts

### Memory Entry

A memory entry is the unit of information that `memory-dedup` operates on. It consists of text content (the fact, observation, preference, or instruction being stored), a unique identifier, and optional metadata. Memory entries represent individual pieces of agent knowledge, not entire conversations or documents. Examples: "User's preferred language is Spanish", "The API endpoint for orders is /api/v2/orders", "User dislikes receiving emails after 9pm".

The entry structure is deliberately simple: an `id` string, a `content` string (the text to embed and compare), and an optional `metadata` object with fields like `timestamp`, `source`, `confidence`, `tags`, and `type`. This structure accommodates entries from any memory system without imposing a specific schema.

### Embedding

An embedding is a fixed-dimensional numeric vector that represents the semantic meaning of a text string. Embeddings are produced by pre-trained language models (OpenAI `text-embedding-3-small` at 1536 dimensions, Cohere `embed-english-v3.0` at 1024 dimensions, or local models via `transformers.js`). Two texts with similar meaning produce vectors with high cosine similarity, even if their surface text differs substantially. "User lives in NYC" and "User's location is New York City" produce embeddings with cosine similarity near 0.95, despite sharing few words.

`memory-dedup` does not generate embeddings. It accepts a caller-provided embedding function (`embedder`) and calls it when needed. This design keeps the package independent of any specific embedding provider, allowing callers to choose models based on their cost, latency, accuracy, and infrastructure requirements.

### Cosine Similarity

Cosine similarity measures the angle between two vectors in high-dimensional space, producing a score between -1.0 and 1.0 (for normalized embeddings, between 0.0 and 1.0). A score of 1.0 means the vectors point in the same direction (identical meaning). A score of 0.0 means they are orthogonal (unrelated meaning). OpenAI embeddings are L2-normalized, so cosine similarity reduces to a dot product.

Cosine similarity is the standard metric for comparing text embeddings because it is invariant to vector magnitude (only direction matters) and correlates well with human judgments of semantic similarity. Research on embedding-based deduplication -- including NVIDIA NeMo Curator's SemDedup and the SemHash library -- consistently uses cosine similarity as the primary metric.

### Similarity Threshold

The similarity threshold is the minimum cosine similarity score required to classify two entries as semantic duplicates. The default threshold is 0.90. Setting the threshold higher (e.g., 0.95) reduces false positives (entries incorrectly classified as duplicates) but may miss true duplicates with moderate paraphrasing. Setting it lower (e.g., 0.85) catches more duplicates but increases the risk of merging entries that are related but carry different information.

The optimal threshold depends on the embedding model, the domain, and the application's tolerance for false positives versus false negatives. A recommended approach is to label a small sample of entry pairs (100-300 pairs), examine the cosine similarity distribution for true matches versus non-matches, and choose a cutoff based on that distribution.

### Classification Tiers

`memory-dedup` classifies entry pairs into four tiers based on cosine similarity:

| Tier | Default Range | Meaning |
|---|---|---|
| Exact duplicate | >= 0.98 | Virtually identical content. Likely same text or trivial rephrasing. |
| Semantic duplicate | >= threshold (0.90) | Same information expressed differently. Paraphrases, rewordings, abbreviation differences. |
| Related | >= 0.75 | Same topic or entity but different information. Complementary, not redundant. |
| Unique | < 0.75 | Different topic or unrelated information. |

Only entries classified as exact duplicates or semantic duplicates trigger merge policies. Related entries are flagged but not merged by default -- they carry complementary information that should be preserved. Unique entries are added to the index without modification.

### Merge Policy

A merge policy determines what happens when a duplicate is detected. The policy decides which entry survives, how metadata is combined, and whether information from the discarded entry is incorporated. Six built-in policies are provided, plus a custom function escape hatch.

The analogy is database compaction in LSM-tree storage engines. LSM trees (used by LevelDB, RocksDB, Cassandra, and ScyllaDB) write all mutations as append-only entries, then periodically run compaction to merge sorted runs, remove duplicate keys, and discard tombstones. The result is a consolidated, non-redundant dataset that is faster to read and smaller to store. `memory-dedup` applies the same principle to agent memory: entries are written freely, then compaction (dedup + merge) consolidates duplicates into a single representative entry.

### Deduplication Pipeline

The deduplication pipeline is the sequence of stages that an entry passes through when being checked for duplicates. Each stage applies a progressively more expensive comparison technique, with early stages acting as fast filters that avoid unnecessary embedding API calls:

```
Entry arrives
    │
    ▼
┌─────────────────────┐
│ Stage 1: Normalize   │  Lowercase, collapse whitespace, strip punctuation
│ (free, <0.01ms)      │  → normalized text
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Stage 2: Hash Match  │  SHA-256 of normalized text
│ (free, <0.01ms)      │  → exact/near-exact match? → DONE (exact dup)
└──────────┬──────────┘
           │ no match
           ▼
┌─────────────────────┐
│ Stage 3: Embed       │  Call embedder(content)
│ (API call, ~50ms)    │  → embedding vector
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Stage 4: Similarity  │  Cosine similarity vs. all indexed vectors
│ Search               │  → best match + score
│ (~0.1ms brute-force) │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Stage 5: Classify    │  Apply threshold tiers
│                      │  → exact_dup / semantic_dup / related / unique
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Stage 6: Merge       │  Apply merge policy (if duplicate)
│                      │  → survivor entry + evicted entry
└─────────────────────┘
```

Stages 1 and 2 are free (no API calls, sub-millisecond). Stage 3 is the dominant cost -- one embedding API call per entry. Stage 4 is a vector search over the existing index. Stages 5 and 6 are deterministic classification and policy application. The hybrid approach ensures that exact duplicates (which are common when agents re-extract the same text) are caught without any embedding cost.

---

## 5. Deduplication Pipeline

### Stage 1: Normalize Entry Text

**What it does**: Transforms the entry's content text into a canonical form by applying lightweight text normalization: convert to lowercase, collapse sequences of whitespace into single spaces, trim leading and trailing whitespace, strip punctuation that does not affect meaning (trailing periods, extra commas), and normalize Unicode (NFC normalization).

**Why**: Many near-exact duplicates differ only in capitalization, whitespace, or punctuation. "User lives in NYC." and "user lives in nyc" are the same fact. Normalization makes the subsequent content hash catch these trivial variations without needing an embedding API call.

**What it never touches**: The original entry content is preserved. Normalization produces an internal canonical form used only for hashing and comparison. The original text is what gets stored and returned.

**Cost**: Sub-millisecond. String operations only, no API calls.

### Stage 2: Content Hash for Exact/Near-Exact Match

**What it does**: Computes a SHA-256 hash of the normalized text from Stage 1 and looks it up in the hash index. If a match is found, the entry is an exact duplicate (after normalization) of an existing entry. The match is classified as an exact duplicate and the merge policy is applied immediately, skipping the embedding stages entirely.

**Why**: Content hashing is effectively free -- `node:crypto` SHA-256 hashes a 200-character string in under 0.01ms. For agent memory systems where the same extraction pipeline often produces identical text (e.g., re-extracting "User prefers dark mode" from the same conversation turn), content hashing catches 30-60% of duplicates without any embedding cost. This is the same principle behind content-addressable storage in git (SHA-1), Docker (SHA-256 for image layers), and IPFS (SHA-256 via CIDs).

**Cost**: Sub-millisecond. Hash computation and Map lookup only.

### Stage 3: Embedding Generation

**What it does**: If no content hash match was found, the entry needs semantic comparison. The deduplicator calls the configured `embedder` function with the entry's original content text (not the normalized form -- embedding models handle their own tokenization and benefit from natural text). The embedder returns a numeric vector (e.g., 1536 dimensions for OpenAI `text-embedding-3-small`).

**Integration with embed-cache**: If the caller configures an `embed-cache` instance, the deduplicator checks the cache before calling the embedder. If the entry's content has been embedded before (identified by content hash), the cached vector is returned without an API call. This is especially valuable during `sweep()` operations where all entries are re-compared -- most vectors are already cached.

**Batch embedding**: For `addBatch()` and `sweep()` operations, the deduplicator collects entries that need new embeddings and calls the embedder in batches (configurable batch size, default 100) to reduce API overhead. If the embedder supports batch embedding (detected by checking for a `batchEmbed` method on the embedder object), batch calls are used.

**Cost**: Dominated by the embedding API call. OpenAI `text-embedding-3-small` has a latency of approximately 30-100ms per call, with batch calls amortizing overhead. Local models via `transformers.js` have higher per-call latency (100-500ms) but no network cost.

### Stage 4: Similarity Search Against Existing Entries

**What it does**: Computes the cosine similarity between the new entry's embedding vector and every existing entry's vector in the index. Returns the best match (highest cosine similarity) and its score.

**Implementation**: For small to medium indexes (up to 10,000 entries), brute-force linear scan is used. Cosine similarity between two 1536-dimensional vectors takes approximately 0.005ms (one dot product for normalized vectors). Scanning 10,000 entries takes approximately 50ms -- acceptable for incremental dedup where a single entry is checked per insert. For `sweep()` operations on large indexes, the quadratic cost is significant, so entries are compared within clusters (see Section 11).

**Multi-field similarity**: In addition to comparing content embeddings, the deduplicator optionally compares metadata fields. If two entries have the same `source` or overlapping `tags`, the effective similarity score receives a small boost (configurable, default +0.02 per matching metadata field, capped at +0.05). This captures the intuition that entries from the same source about the same topic are more likely to be duplicates.

**Cost**: O(n) for incremental dedup (n = number of indexed entries). O(n^2) for full sweep (mitigated by clustering).

### Stage 5: Classify

**What it does**: Takes the best-match similarity score from Stage 4 and classifies the entry-pair relationship using the configured thresholds:

- **Exact duplicate** (score >= `exactThreshold`, default 0.98): The entries encode virtually identical information. The wording may differ trivially.
- **Semantic duplicate** (score >= `threshold`, default 0.90): The entries encode the same fact or observation with different phrasing. This is the primary dedup target.
- **Related** (score >= `relatedThreshold`, default 0.75): The entries are about the same topic or entity but carry different information. Not merged by default.
- **Unique** (score < `relatedThreshold`): The entries are unrelated.

The classification result includes the match score, the matched entry's ID, and the classification tier. This result is returned to the caller and also emitted as a `duplicate-found` event (for duplicates) or logged silently (for unique entries).

### Stage 6: Apply Merge Policy

**What it does**: For entries classified as exact or semantic duplicates, the configured merge policy determines the outcome. The merge policy receives both entries (the incoming entry and the existing match) and returns a `MergeResult` indicating which entry survives, what the merged content and metadata look like, and which entry (if any) is evicted.

See Section 7 (Merge Policies) for the full description of each policy.

---

## 6. Similarity Detection

### Cosine Similarity Computation

Cosine similarity between two vectors A and B is computed as:

```
similarity(A, B) = (A . B) / (||A|| * ||B||)
```

For L2-normalized vectors (which OpenAI, Cohere, and most embedding APIs return), this simplifies to the dot product:

```
similarity(A, B) = A . B = sum(A[i] * B[i]) for i in 0..dimensions
```

The implementation uses a tight loop over the vector dimensions with no heap allocation:

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
```

For non-normalized vectors, the implementation computes magnitudes and divides. A configuration flag (`normalizedEmbeddings`, default `true`) tells the deduplicator whether to use the fast dot-product path or the full cosine formula.

### Configurable Thresholds

All thresholds are configurable:

| Threshold | Default | Purpose |
|---|---|---|
| `exactThreshold` | 0.98 | Minimum cosine similarity for exact duplicate classification |
| `threshold` | 0.90 | Minimum cosine similarity for semantic duplicate classification |
| `relatedThreshold` | 0.75 | Minimum cosine similarity for related-but-different classification |

Recommended thresholds by use case:

| Use Case | `threshold` | Rationale |
|---|---|---|
| Conservative dedup (minimize false positives) | 0.95 | Only merge entries that are near-identical paraphrases |
| Standard agent memory cleanup | 0.90 | Catches most semantic duplicates with low false positive rate |
| Aggressive dedup (maximize space savings) | 0.85 | Merges entries with moderate paraphrasing; review for false positives |
| Topic-level clustering | 0.75 | Groups entries by topic, not for merging but for analysis |

### Multi-Field Similarity Boost

When two entries share metadata attributes, the raw cosine similarity score receives a configurable boost:

- Same `source` value: +0.02
- One or more overlapping `tags`: +0.01 per overlapping tag, max +0.03
- Same `type` value: +0.02

The total metadata boost is capped at `maxMetadataBoost` (default 0.05) and added to the raw cosine similarity. The boosted score is then used for classification. The boost is small enough to avoid false positives but large enough to push borderline pairs (e.g., cosine similarity of 0.89) over the threshold when metadata supports the duplicate hypothesis.

The metadata boost can be disabled entirely by setting `metadataBoost: false` in the options.

### Efficient Similarity Search

**Small indexes (up to 10,000 entries)**: Brute-force linear scan. Each new entry is compared against all existing entries. For 1536-dimensional vectors, each comparison is approximately 0.005ms (a single dot product). Scanning 10,000 entries takes approximately 50ms. This is acceptable for incremental dedup on insert.

**Large indexes (10,000+ entries)**: The deduplicator does not bundle a full ANN (approximate nearest neighbor) library to maintain zero dependencies. Instead, it uses two optimizations:

1. **Content-hash pre-filter**: Entries whose normalized content hash matches are immediately classified as exact duplicates, skipping the vector scan entirely.
2. **Cluster-based search for sweep**: During `sweep()` and `compact()` operations, entries are grouped into clusters using a simple k-means-like partitioning on their vectors (k = sqrt(n)). Similarity search is performed within each cluster and between cluster centroids, reducing the O(n^2) full pairwise comparison to approximately O(n * sqrt(n)).

For callers who need faster similarity search on very large indexes (100,000+ entries), the `store` option accepts a pluggable backend that can delegate to `hnswlib-node`, `vectra`, or any ANN library. See Section 10 (Storage Backend).

---

## 7. Merge Policies

When a duplicate is detected, the merge policy determines the outcome. The policy receives both entries (the incoming `candidate` and the existing `match`) and produces a `MergeResult`. All policies also merge metadata according to configurable rules.

### `keep-newest`

Discards the older entry and keeps the newer one. "Newer" is determined by the `timestamp` metadata field, or by insertion order if timestamps are absent.

**When to use**: When the most recent observation is likely the most accurate. An agent that re-extracts a fact from a more recent conversation should trust the newer extraction.

**Metadata handling**: The surviving entry retains its own metadata. The evicted entry's `sources` (if present) are appended to the survivor's `sources` array to preserve provenance.

### `keep-oldest`

Discards the newer entry and keeps the original. The first time a fact enters memory, it stays.

**When to use**: When the original formulation is authoritative and subsequent repetitions are noise. For example, a user's initial preference statement ("I prefer dark mode") is more intentional than a later passing mention.

**Metadata handling**: Same as `keep-newest` but in the opposite direction.

### `keep-longest`

Keeps the entry with the longer content text (measured by character count). The longer entry is assumed to contain more detail or context.

**When to use**: When more detailed entries are preferred. "User prefers dark mode for all applications including mobile and desktop" is more informative than "User prefers dark mode".

**Metadata handling**: The surviving entry retains its own metadata. The evicted entry's metadata is merged into `mergedFrom` for provenance.

### `keep-highest-confidence`

Keeps the entry with the higher `confidence` metadata value. If neither entry has a confidence score, falls back to `keep-newest`.

**When to use**: When entries carry confidence scores from the extraction process. An entity extracted with 0.95 confidence should take priority over one extracted with 0.72 confidence, even if the lower-confidence entry is newer.

### `merge`

Combines information from both entries into a single merged entry. The merged content is the longer of the two content strings (a heuristic for "more detailed"), with a note appended indicating the merge. The merged metadata combines timestamps (keeps the oldest `createdAt` and the newest `updatedAt`), unions the tag sets, unions the source sets, and takes the higher confidence score.

**When to use**: When both entries may contain complementary details that should be preserved. This is the safest default when you are unsure whether entries are exact duplicates or carry slightly different information.

**Content merge strategy**: The merged content is the longer entry's text. The shorter entry's text is stored in the merged entry's `metadata.mergedFrom` field for audit purposes. This is a conservative strategy -- it does not attempt to synthesize new text from both entries, which would require an LLM call and introduce non-determinism.

### `custom`

The caller provides a `(candidate: MemoryEntry, match: MemoryEntry, similarity: number) => MergeResult` function. This function has full control over which entry survives, how content is combined, and how metadata is merged.

**When to use**: When the built-in policies are insufficient. For example, a caller might invoke an LLM to intelligently merge two entries: "User likes pizza" and "User likes pizza and sushi" should produce "User likes pizza and sushi", not simply pick one. The custom function can make this LLM call.

### Metadata Merge Rules

Regardless of which merge policy is used, metadata fields follow these default merge rules (overridable via `metadataMergeRules`):

| Metadata Field | Merge Rule |
|---|---|
| `timestamp` / `createdAt` | Keep the earliest value (original creation time) |
| `updatedAt` | Keep the latest value (most recent modification) |
| `source` | Union of sources from both entries |
| `tags` | Union of tags from both entries |
| `confidence` | Keep the higher value |
| `type` | Keep the survivor's value |
| Other fields | Keep the survivor's value; store evicted entry's value in `mergedFrom` |

---

## 8. API Surface

### Installation

```bash
npm install memory-dedup
```

### Primary Function: `createDeduplicator`

```typescript
import { createDeduplicator } from 'memory-dedup';

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

// Check a single entry
const result = await dedup.check({
  id: 'entry-1',
  content: 'User lives in New York City',
});
// { classification: 'unique', matchId: null, similarity: 0 }

// Add an entry with automatic dedup
const addResult = await dedup.add({
  id: 'entry-2',
  content: 'User resides in NYC',
  metadata: { source: 'conversation-42', confidence: 0.92 },
});
// { classification: 'semantic_duplicate', matchId: 'entry-1', similarity: 0.94,
//   action: 'merged', survivorId: 'entry-2', evictedId: 'entry-1' }
```

### Type Definitions

```typescript
// ── Memory Entry ────────────────────────────────────────────────────

/** A single memory entry to be deduplicated. */
interface MemoryEntry {
  /** Unique identifier for this entry. */
  id: string;

  /** The text content of the memory entry. This is what gets embedded and compared. */
  content: string;

  /**
   * Optional metadata associated with the entry.
   * Used for merge decisions, provenance tracking, and similarity boosting.
   */
  metadata?: EntryMetadata;
}

/** Metadata fields for a memory entry. All fields are optional. */
interface EntryMetadata {
  /** Unix timestamp (ms) when the entry was created. */
  timestamp?: number;

  /** Unix timestamp (ms) when the entry was created (alias for timestamp). */
  createdAt?: number;

  /** Unix timestamp (ms) when the entry was last updated. */
  updatedAt?: number;

  /** Source identifier (conversation ID, tool name, etc.). */
  source?: string;

  /** Array of source identifiers if the entry has been merged from multiple sources. */
  sources?: string[];

  /** Confidence score from the extraction process (0.0 to 1.0). */
  confidence?: number;

  /** String labels categorizing the entry. */
  tags?: string[];

  /** Entry type: 'fact', 'event', 'preference', 'instruction', 'observation'. */
  type?: string;

  /** Provenance from previous merges. */
  mergedFrom?: Array<{ id: string; content: string; metadata?: EntryMetadata }>;

  /** Additional caller-defined fields. */
  [key: string]: unknown;
}

// ── Dedup Options ───────────────────────────────────────────────────

/** Configuration for creating a MemoryDedup instance. */
interface DedupOptions {
  /**
   * Embedding function. Called with entry content text, returns an embedding vector.
   * Required. No default.
   */
  embedder: (text: string) => Promise<number[]>;

  /**
   * Minimum cosine similarity for semantic duplicate classification.
   * Default: 0.90.
   */
  threshold?: number;

  /**
   * Minimum cosine similarity for exact duplicate classification.
   * Default: 0.98.
   */
  exactThreshold?: number;

  /**
   * Minimum cosine similarity for related-but-different classification.
   * Default: 0.75.
   */
  relatedThreshold?: number;

  /**
   * Merge policy to apply when duplicates are detected.
   * Default: 'keep-newest'.
   */
  mergePolicy?: MergePolicyName | MergePolicyFunction;

  /**
   * Whether embedding vectors are L2-normalized (dot product = cosine similarity).
   * Default: true.
   */
  normalizedEmbeddings?: boolean;

  /**
   * Enable metadata-based similarity boosting.
   * Default: true.
   */
  metadataBoost?: boolean;

  /**
   * Maximum metadata boost added to cosine similarity.
   * Default: 0.05.
   */
  maxMetadataBoost?: number;

  /**
   * Custom metadata merge rules.
   * Default: built-in rules (see Section 7).
   */
  metadataMergeRules?: MetadataMergeRules;

  /**
   * Pluggable storage backend for entries and vectors.
   * Default: in-memory Map + flat array.
   */
  store?: StoreBackend;

  /**
   * Batch size for embedding API calls during addBatch() and sweep().
   * Default: 100.
   */
  embedBatchSize?: number;

  /**
   * Function that returns the current time in milliseconds.
   * Override for testing with deterministic time.
   * Default: () => Date.now().
   */
  now?: () => number;
}

/** Built-in merge policy names. */
type MergePolicyName =
  | 'keep-newest'
  | 'keep-oldest'
  | 'keep-longest'
  | 'keep-highest-confidence'
  | 'merge';

/** Custom merge policy function. */
type MergePolicyFunction = (
  candidate: MemoryEntry,
  match: MemoryEntry,
  similarity: number,
) => MergeResult | Promise<MergeResult>;

// ── Results ─────────────────────────────────────────────────────────

/** Classification of a dedup check. */
type DedupClassification = 'exact_duplicate' | 'semantic_duplicate' | 'related' | 'unique';

/** Result of dedup.check(). */
interface DedupResult {
  /** The classification of the entry relative to the index. */
  classification: DedupClassification;

  /** ID of the best-matching existing entry, or null if unique. */
  matchId: string | null;

  /** Cosine similarity score with the best match (0.0 if unique). */
  similarity: number;

  /** Raw cosine similarity before metadata boost. */
  rawSimilarity: number;

  /** The embedding vector computed for the entry. */
  embedding: number[];

  /** Whether a content hash match was found (Stage 2 hit). */
  hashMatch: boolean;

  /** Wall-clock time for the check, in milliseconds. */
  durationMs: number;
}

/** Result of dedup.add(). */
interface AddResult extends DedupResult {
  /** The action taken: 'added' (unique), 'merged' (duplicate), or 'skipped' (exact hash match). */
  action: 'added' | 'merged' | 'skipped';

  /** ID of the surviving entry after merge (the entry in the index). */
  survivorId: string;

  /** ID of the evicted entry after merge, or null if no eviction. */
  evictedId: string | null;

  /** The surviving entry after merge, with updated metadata. */
  survivor: MemoryEntry;
}

/** Result of dedup.addBatch(). */
interface BatchResult {
  /** Results for each entry in the batch, in order. */
  results: AddResult[];

  /** Total entries processed. */
  totalProcessed: number;

  /** Number of unique entries added. */
  uniqueAdded: number;

  /** Number of duplicates found and merged/skipped. */
  duplicatesFound: number;

  /** Number of entries classified as related. */
  relatedFound: number;

  /** Wall-clock time for the batch operation, in milliseconds. */
  durationMs: number;
}

/** Result of dedup.sweep(). */
interface SweepResult {
  /** Pairs of entries identified as duplicates. */
  duplicatePairs: Array<{
    entryA: string;
    entryB: string;
    similarity: number;
    classification: DedupClassification;
  }>;

  /** Number of duplicate pairs found. */
  duplicateCount: number;

  /** Number of entries evicted by merge policies. */
  evictedCount: number;

  /** IDs of entries that were evicted. */
  evictedIds: string[];

  /** Total entries scanned. */
  totalScanned: number;

  /** Wall-clock time for the sweep, in milliseconds. */
  durationMs: number;
}

/** Result of dedup.compact(). */
interface CompactResult extends SweepResult {
  /** Clusters of related entries (groups with similarity above relatedThreshold). */
  clusters: Array<{
    representative: string;
    members: string[];
    averageSimilarity: number;
  }>;

  /** Number of clusters formed. */
  clusterCount: number;

  /** Entries before compaction. */
  entriesBefore: number;

  /** Entries after compaction. */
  entriesAfter: number;

  /** Reduction ratio: 1 - (entriesAfter / entriesBefore). */
  reductionRatio: number;
}

/** Result of a merge policy application. */
interface MergeResult {
  /** The entry that survives the merge. */
  survivor: MemoryEntry;

  /** The entry that is evicted (removed), or null to keep both. */
  evicted: MemoryEntry | null;
}

/** Deduplication statistics. */
interface DedupStats {
  /** Total entries in the index. */
  totalEntries: number;

  /** Total dedup checks performed (add + check calls). */
  totalChecks: number;

  /** Total exact duplicates detected (content hash match). */
  exactDuplicates: number;

  /** Total semantic duplicates detected (embedding similarity). */
  semanticDuplicates: number;

  /** Total entries classified as related. */
  relatedEntries: number;

  /** Total unique entries added. */
  uniqueEntries: number;

  /** Total entries evicted by merge policies. */
  evictedEntries: number;

  /** Total embedding API calls made. */
  embeddingCalls: number;

  /** Total embedding API calls saved by content hash matching. */
  embeddingCallsSaved: number;

  /** Average cosine similarity of detected duplicate pairs. */
  averageDuplicateSimilarity: number;

  /** Deduplication rate: duplicatesFound / totalChecks. */
  deduplicationRate: number;
}

// ── Merge Rules ─────────────────────────────────────────────────────

/** Custom metadata merge rules. */
interface MetadataMergeRules {
  /** How to merge timestamp fields. Default: 'earliest'. */
  timestamp?: 'earliest' | 'latest' | 'survivor';

  /** How to merge source fields. Default: 'union'. */
  source?: 'union' | 'survivor' | 'candidate';

  /** How to merge tag fields. Default: 'union'. */
  tags?: 'union' | 'survivor' | 'candidate';

  /** How to merge confidence fields. Default: 'highest'. */
  confidence?: 'highest' | 'lowest' | 'average' | 'survivor';
}

// ── Storage Backend ─────────────────────────────────────────────────

/** Pluggable storage backend interface for entries and embedding vectors. */
interface StoreBackend {
  /** Store an entry and its embedding vector. */
  set(entry: MemoryEntry, embedding: number[]): Promise<void>;

  /** Retrieve an entry by ID. */
  get(id: string): Promise<{ entry: MemoryEntry; embedding: number[] } | null>;

  /** Delete an entry by ID. */
  delete(id: string): Promise<boolean>;

  /** Return all entries and their embeddings. */
  getAll(): Promise<Array<{ entry: MemoryEntry; embedding: number[] }>>;

  /** Return the number of entries. */
  size(): Promise<number>;

  /** Search for the top-k most similar entries to a query vector. */
  search(queryVector: number[], k: number): Promise<Array<{
    entry: MemoryEntry;
    embedding: number[];
    similarity: number;
  }>>;

  /** Remove all entries. */
  clear(): Promise<void>;
}

// ── Events ──────────────────────────────────────────────────────────

/** Event types emitted by the deduplicator. */
interface DedupEvents {
  /** Fired when a duplicate is detected. */
  'duplicate-found': {
    candidateId: string;
    matchId: string;
    similarity: number;
    classification: DedupClassification;
  };

  /** Fired when entries are merged. */
  'merged': {
    survivorId: string;
    evictedId: string;
    similarity: number;
    policy: string;
  };

  /** Fired when an entry is evicted (removed from the index). */
  'evicted': {
    entryId: string;
    reason: 'merge' | 'manual';
  };

  /** Fired when a new unique entry is added to the index. */
  'added': {
    entryId: string;
  };

  /** Fired when a sweep or compact operation completes. */
  'sweep-complete': SweepResult;
}

type DedupEventName = keyof DedupEvents;
type DedupEventHandler<E extends DedupEventName> = (event: DedupEvents[E]) => void;

// ── Error Classes ───────────────────────────────────────────────────

/** Base error for all memory-dedup errors. */
class DedupError extends Error {
  readonly code: string;
}

/** Thrown when configuration is invalid. */
class DedupConfigError extends DedupError {
  readonly code = 'DEDUP_CONFIG_ERROR';
}

/** Thrown when the embedder function fails. */
class DedupEmbeddingError extends DedupError {
  readonly code = 'DEDUP_EMBEDDING_ERROR';
}

/** Thrown when a store operation fails. */
class DedupStoreError extends DedupError {
  readonly code = 'DEDUP_STORE_ERROR';
}
```

### MemoryDedup API

```typescript
/**
 * Create a new deduplicator instance.
 *
 * @param options - Configuration options. `embedder` is required.
 * @returns A MemoryDedup instance.
 * @throws DedupConfigError if configuration is invalid.
 */
function createDeduplicator(options: DedupOptions): MemoryDedup;

/** The deduplicator instance. */
interface MemoryDedup {
  // ── Core Operations ───────────────────────────────────────────────

  /**
   * Check whether an entry is a duplicate of any existing entry in the index.
   * Does NOT modify the index. The entry is not added.
   *
   * Runs the full dedup pipeline: normalize, hash, embed, search, classify.
   *
   * @param entry - The memory entry to check.
   * @returns A DedupResult with classification, match info, and similarity score.
   * @throws DedupEmbeddingError if the embedder function fails.
   */
  check(entry: MemoryEntry): Promise<DedupResult>;

  /**
   * Add an entry to the index with automatic deduplication.
   *
   * Runs the full dedup pipeline. If the entry is a duplicate, the merge
   * policy is applied. If it is unique, it is added to the index.
   *
   * @param entry - The memory entry to add.
   * @returns An AddResult with the action taken and merge details.
   * @throws DedupEmbeddingError if the embedder function fails.
   */
  add(entry: MemoryEntry): Promise<AddResult>;

  /**
   * Add multiple entries to the index with automatic deduplication.
   *
   * Entries are processed sequentially. Each entry is checked against the
   * index (which includes previously added entries from this batch).
   * Embeddings are computed in batches for efficiency.
   *
   * @param entries - Array of memory entries to add.
   * @returns A BatchResult with per-entry results and summary statistics.
   */
  addBatch(entries: MemoryEntry[]): Promise<BatchResult>;

  // ── Sweep and Compact ─────────────────────────────────────────────

  /**
   * Scan all entries in the index for duplicate pairs.
   *
   * Compares every entry against every other entry (with clustering
   * optimization for large indexes). Applies merge policies to detected
   * duplicates. This is the "batch dedup" operation -- run periodically
   * as a background cleanup task.
   *
   * @returns A SweepResult with duplicate pairs and eviction details.
   */
  sweep(): Promise<SweepResult>;

  /**
   * Aggressive deduplication with clustering.
   *
   * Like sweep(), but additionally groups related entries into clusters,
   * selects a representative from each cluster, and reports the full
   * cluster structure. Useful for memory compaction: reduce N related
   * entries to one representative per cluster.
   *
   * @returns A CompactResult with clusters and reduction statistics.
   */
  compact(): Promise<CompactResult>;

  // ── Query Operations ──────────────────────────────────────────────

  /**
   * Get all deduplicated entries currently in the index.
   *
   * @returns Array of all entries.
   */
  getEntries(): MemoryEntry[];

  /**
   * Get the entry with the specified ID, or undefined if not found.
   *
   * @param id - The entry ID.
   * @returns The entry, or undefined.
   */
  getEntry(id: string): MemoryEntry | undefined;

  /**
   * Get groups of duplicate entries detected by previous add/sweep/compact
   * operations. Each group contains entries that are semantic duplicates
   * of each other.
   *
   * @returns Array of duplicate groups.
   */
  getDuplicateGroups(): Array<{
    representative: string;
    members: string[];
    averageSimilarity: number;
  }>;

  /**
   * Remove an entry from the index.
   *
   * @param id - The entry ID to remove.
   * @returns true if the entry existed and was removed.
   */
  remove(id: string): boolean;

  /**
   * Remove all entries from the index.
   */
  clear(): void;

  // ── Statistics ────────────────────────────────────────────────────

  /**
   * Get dedup statistics.
   *
   * @returns A DedupStats object with counters and rates.
   */
  stats(): DedupStats;

  /**
   * Get the number of entries in the index.
   */
  readonly size: number;

  // ── Events ────────────────────────────────────────────────────────

  /**
   * Register an event handler.
   *
   * @param event - The event name.
   * @param handler - The event handler function.
   * @returns A function that removes the handler when called.
   */
  on<E extends DedupEventName>(event: E, handler: DedupEventHandler<E>): () => void;

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Destroy the deduplicator.
   * Clears the index and removes all event handlers.
   * The instance should not be used after destroy().
   */
  destroy(): void;
}
```

---

## 9. Embedding Provider Interface

### Simple Function Interface

The embedding provider is a single async function:

```typescript
type Embedder = (text: string) => Promise<number[]>;
```

This is the only required option when creating a deduplicator. The function receives entry content text and returns an embedding vector. The deduplicator does not care which model, API, or library produces the vector -- it only needs a consistent, fixed-dimension output.

### OpenAI Adapter Example

```typescript
import { createDeduplicator } from 'memory-dedup';
import OpenAI from 'openai';

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

### Cohere Adapter Example

```typescript
import { CohereClientV2 } from 'cohere-ai';

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

### Local Model Adapter Example (transformers.js)

```typescript
import { pipeline } from '@xenova/transformers';

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

const dedup = createDeduplicator({
  embedder: async (text) => {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  },
  normalizedEmbeddings: true,
});
```

### Integration with embed-cache

`embed-cache` from this monorepo provides a content-addressable embedding cache. By wrapping the embedder with `embed-cache`, repeated embeddings of the same content are served from cache instead of making API calls:

```typescript
import { createDeduplicator } from 'memory-dedup';
import { createEmbedCache } from 'embed-cache';

const cache = createEmbedCache({ maxSize: 10_000 });

const rawEmbedder = async (text: string) => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
};

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

This is especially valuable during `sweep()` operations, where all entries need embeddings but most have been embedded before.

### Batch Embedding

For `addBatch()` and `sweep()` operations, the deduplicator collects entries that need new embeddings and processes them in batches. The `embedBatchSize` option (default 100) controls the batch size.

If the embedder function has a `batch` property that is a function, the deduplicator uses it for batch calls:

```typescript
const embedder = async (text: string) => {
  // single embedding logic
};

embedder.batch = async (texts: string[]) => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map(d => d.embedding);
};

const dedup = createDeduplicator({ embedder });
```

### Dimensionality

The deduplicator does not assume a fixed embedding dimension. It infers the dimension from the first embedding returned by the embedder and validates that subsequent embeddings have the same dimension. A `DedupConfigError` is thrown if dimensions are inconsistent.

Supported dimensions from common models:

| Model | Dimensions |
|---|---|
| OpenAI `text-embedding-3-small` | 1536 (or reduced via `dimensions` parameter) |
| OpenAI `text-embedding-3-large` | 3072 (or reduced) |
| OpenAI `text-embedding-ada-002` | 1536 |
| Cohere `embed-english-v3.0` | 1024 |
| `all-MiniLM-L6-v2` (local) | 384 |
| `nomic-embed-text-v1.5` (local) | 768 |

---

## 10. Storage Backend

### In-Memory (Default)

By default, the deduplicator stores entries and their embedding vectors in process memory using a `Map<string, { entry: MemoryEntry; embedding: number[] }>` and a flat array of vectors for similarity search. This is suitable for deduplicator instances with up to ~50,000 entries (at 1536 dimensions, each vector is ~12KB, so 50,000 entries consume ~600MB of RAM for vectors alone).

The in-memory backend provides:

- O(1) entry lookup by ID (`Map.get`)
- O(n) brute-force similarity search (linear scan over all vectors)
- O(1) entry insertion and deletion

### Pluggable Backend Interface

For persistent storage or efficient ANN search on large indexes, the caller provides a `StoreBackend` implementation:

```typescript
interface StoreBackend {
  set(entry: MemoryEntry, embedding: number[]): Promise<void>;
  get(id: string): Promise<{ entry: MemoryEntry; embedding: number[] } | null>;
  delete(id: string): Promise<boolean>;
  getAll(): Promise<Array<{ entry: MemoryEntry; embedding: number[] }>>;
  size(): Promise<number>;
  search(queryVector: number[], k: number): Promise<Array<{
    entry: MemoryEntry;
    embedding: number[];
    similarity: number;
  }>>;
  clear(): Promise<void>;
}
```

Example: wrapping `hnswlib-node` for ANN search:

```typescript
import { HierarchicalNSW } from 'hnswlib-node';

function createHnswStore(dimensions: number, maxElements: number): StoreBackend {
  const index = new HierarchicalNSW('cosine', dimensions);
  index.initIndex(maxElements);
  const entries = new Map<string, { entry: MemoryEntry; embedding: number[]; label: number }>();
  let nextLabel = 0;

  return {
    async set(entry, embedding) {
      const label = nextLabel++;
      index.addPoint(embedding, label);
      entries.set(entry.id, { entry, embedding, label });
    },
    async get(id) {
      const item = entries.get(id);
      return item ? { entry: item.entry, embedding: item.embedding } : null;
    },
    async delete(id) {
      const item = entries.get(id);
      if (!item) return false;
      index.markDelete(item.label);
      entries.delete(id);
      return true;
    },
    async getAll() {
      return Array.from(entries.values()).map(({ entry, embedding }) => ({ entry, embedding }));
    },
    async size() { return entries.size; },
    async search(queryVector, k) {
      const result = index.searchKnn(queryVector, Math.min(k, entries.size));
      return result.neighbors.map((label, i) => {
        const item = Array.from(entries.values()).find(e => e.label === label);
        return {
          entry: item!.entry,
          embedding: item!.embedding,
          similarity: 1 - result.distances[i], // hnswlib returns distances, not similarities
        };
      });
    },
    async clear() {
      entries.clear();
      index.initIndex(maxElements);
      nextLabel = 0;
    },
  };
}
```

### Index Rebuild on Load

When a deduplicator is created with a pre-populated store backend (e.g., loaded from persistent storage), it builds the content hash index on first use. The `initialize()` method (called lazily on the first `check()` or `add()` call) iterates all entries from the store, computes normalized content hashes, and populates the in-memory hash index. This ensures that Stage 2 (content hash matching) works correctly even when the store is pre-populated.

---

## 11. Incremental vs. Batch Dedup

### Incremental Dedup (Per-Insert)

Incremental dedup checks each entry against the index at the time it is added. The `add()` method runs the full dedup pipeline (normalize, hash, embed, search, classify, merge) for each entry. This is the standard mode for memory systems that add entries one at a time during agent execution.

**Characteristics:**
- Latency: 30-150ms per entry (dominated by embedding API call; sub-millisecond if content hash matches).
- Accuracy: High. Each entry is compared against the full current index.
- Cost: One embedding API call per unique entry. Zero for content hash matches.

**When to use**: Real-time memory systems where entries arrive one at a time and immediate dedup is needed. Agent loop execution, conversation-driven fact extraction, tool output storage.

### Batch Sweep (Periodic Cleanup)

Batch sweep scans all entries in the index for duplicate pairs. The `sweep()` method compares every entry against every other entry (with optimizations) and applies merge policies to detected duplicates. This is a background maintenance operation, not a real-time operation.

**Characteristics:**
- Latency: O(n^2 / k) where n is the number of entries and k is the number of clusters. For 1,000 entries with 10 clusters: approximately 10,000 comparisons taking ~50ms.
- Accuracy: Highest. Finds duplicates that incremental dedup may have missed (e.g., two entries added before either was in the index).
- Cost: Zero embedding API calls if all entries already have cached embeddings. Otherwise, one call per entry without a cached embedding.

**Optimization via clustering**: For large indexes, `sweep()` uses a simple partitioning strategy:

1. Compute the centroid of all entry vectors.
2. Partition entries into k clusters (k = max(1, sqrt(n))) by assigning each entry to the nearest of k randomly selected centroids using cosine similarity.
3. Within each cluster, perform pairwise comparison (O(n_i^2) per cluster of size n_i).
4. Between clusters, compare centroids. If two cluster centroids are above the related threshold, perform cross-cluster pairwise comparison.
5. Report all duplicate pairs and apply merge policies.

**When to use**: Periodic maintenance. Nightly cleanup jobs. Pre-retrieval dedup before re-indexing a vector database. Manual memory compaction.

### Compact (Aggressive Dedup + Clustering)

The `compact()` method extends `sweep()` with aggressive clustering. After finding and merging duplicates, it groups remaining entries into clusters of related information and selects a representative from each cluster. This is analogous to LSM-tree major compaction: a full scan that produces a maximally consolidated result.

**When to use**: Memory compaction before a major operation (context window assembly, knowledge base export). When memory has grown large and retrieval quality has degraded.

---

## 12. Configuration

### Default Values

| Option | Default | Description |
|---|---|---|
| `embedder` | (required) | Embedding function. No default. |
| `threshold` | `0.90` | Semantic duplicate threshold. |
| `exactThreshold` | `0.98` | Exact duplicate threshold. |
| `relatedThreshold` | `0.75` | Related-but-different threshold. |
| `mergePolicy` | `'keep-newest'` | Merge policy for duplicates. |
| `normalizedEmbeddings` | `true` | Whether embeddings are L2-normalized. |
| `metadataBoost` | `true` | Enable metadata similarity boosting. |
| `maxMetadataBoost` | `0.05` | Maximum metadata boost. |
| `embedBatchSize` | `100` | Batch size for embedding calls. |
| `store` | In-memory | Storage backend. |
| `now` | `() => Date.now()` | Time source function. |

### Configuration Validation

All configuration values are validated at `createDeduplicator()` call time:

- `embedder` must be a function. Throws `DedupConfigError` if missing or not a function.
- `threshold`, `exactThreshold`, `relatedThreshold` must be numbers between 0.0 and 1.0. Must satisfy `relatedThreshold` < `threshold` < `exactThreshold`. Throws `DedupConfigError` if violated.
- `mergePolicy` must be a valid policy name string or a function. Throws `DedupConfigError` for unknown policy names.
- `maxMetadataBoost` must be a non-negative number.
- `embedBatchSize` must be a positive integer.
- `store`, if provided, must implement the `StoreBackend` interface (checked via duck typing: must have `set`, `get`, `delete`, `getAll`, `size`, `search`, and `clear` functions).
- `now`, if provided, must be a function.

---

## 13. Integration

### With agent-scratchpad

`agent-scratchpad` provides working memory for agent execution. Entries accumulate as the agent processes multiple steps. Before rendering the scratchpad to context via `toContext()`, deduplicate entries to maximize information density:

```typescript
import { createScratchpad } from 'agent-scratchpad';
import { createDeduplicator } from 'memory-dedup';

const pad = createScratchpad({ defaultTtl: 600_000 });
const dedup = createDeduplicator({
  embedder: myEmbedder,
  threshold: 0.90,
  mergePolicy: 'keep-longest',
});

// Agent loop adds entries
pad.set('fact-1', 'User lives in NYC', { tags: ['fact'] });
pad.set('fact-2', "User's location is New York City", { tags: ['fact'] });
pad.set('fact-3', 'User prefers dark mode', { tags: ['preference'] });

// Before context rendering, deduplicate
const facts = pad.findByTag('fact');
const batch = facts.map(e => ({
  id: e.key,
  content: String(e.value),
  metadata: { tags: e.tags, timestamp: e.createdAt },
}));

const batchResult = await dedup.addBatch(batch);
// batchResult.duplicatesFound === 1 ("NYC" and "New York City" merged)

// Use deduplicated entries for context
const uniqueKeys = new Set(batchResult.results.map(r => r.survivorId));
const context = pad.toContext({
  format: 'xml',
  filterTags: ['fact'],
});
```

### With sliding-context

`sliding-context` manages conversation history with summarization. Facts extracted from summarized conversations can be deduplicated before storage:

```typescript
import { createContext } from 'sliding-context';
import { createDeduplicator } from 'memory-dedup';

const ctx = createContext({ tokenBudget: 8192, summarizer: mySummarizer });
const dedup = createDeduplicator({ embedder: myEmbedder });

// After a conversation is summarized, extract and deduplicate facts
async function extractAndStoreFacts(summary: string) {
  const facts = await llm.extractFacts(summary);

  for (const fact of facts) {
    const result = await dedup.add({
      id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content: fact.text,
      metadata: {
        source: 'conversation-summary',
        confidence: fact.confidence,
        tags: fact.tags,
      },
    });

    if (result.action === 'added') {
      await longTermMemory.store(result.survivor);
    }
    // Duplicates are automatically merged; no redundant storage
  }
}
```

### With embed-cache

`embed-cache` provides content-addressable caching for embedding vectors. Wrapping the embedder with `embed-cache` avoids redundant API calls:

```typescript
import { createDeduplicator } from 'memory-dedup';
import { createEmbedCache } from 'embed-cache';

const cache = createEmbedCache({ maxSize: 50_000, ttl: 86_400_000 }); // 24h TTL

const dedup = createDeduplicator({
  embedder: async (text) => {
    const cached = cache.get(text);
    if (cached) return cached;
    const embedding = await openaiEmbed(text);
    cache.set(text, embedding);
    return embedding;
  },
  threshold: 0.90,
});

// During sweep(), most entries are served from cache
const sweepResult = await dedup.sweep();
console.log(dedup.stats().embeddingCallsSaved); // high number
```

### With LangChain Memory

```typescript
import { createDeduplicator } from 'memory-dedup';
import { BufferMemory } from 'langchain/memory';

const dedup = createDeduplicator({ embedder: myEmbedder });

// Wrap LangChain's memory to deduplicate on save
class DedupMemory extends BufferMemory {
  async saveContext(inputValues: Record<string, any>, outputValues: Record<string, any>) {
    // Extract facts from the conversation turn
    const facts = await extractFacts(inputValues, outputValues);

    for (const fact of facts) {
      const result = await dedup.add({
        id: `lc-${Date.now()}`,
        content: fact,
        metadata: { source: 'langchain' },
      });

      if (result.action === 'added') {
        // Only store unique facts in the underlying memory
        await super.saveContext({ fact }, {});
      }
    }
  }
}
```

### With Custom Agent Memory Systems

```typescript
import { createDeduplicator } from 'memory-dedup';

const dedup = createDeduplicator({
  embedder: myEmbedder,
  threshold: 0.90,
  mergePolicy: 'merge',
});

class AgentMemory {
  private store: Map<string, MemoryEntry> = new Map();

  async remember(content: string, metadata?: EntryMetadata): Promise<AddResult> {
    const entry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content,
      metadata: { ...metadata, timestamp: Date.now() },
    };

    const result = await dedup.add(entry);

    if (result.action === 'added' || result.action === 'merged') {
      this.store.set(result.survivorId, result.survivor);
      if (result.evictedId) {
        this.store.delete(result.evictedId);
      }
    }

    return result;
  }

  async cleanup(): Promise<CompactResult> {
    return await dedup.compact();
  }

  getMemories(): MemoryEntry[] {
    return Array.from(this.store.values());
  }
}
```

---

## 14. Testing Strategy

### Test Categories

**Unit tests: Text normalization** -- Verify that the normalization function produces expected canonical forms. Test cases: mixed case, extra whitespace, trailing punctuation, Unicode characters, empty strings, strings that are already normalized. Verify that normalization is idempotent (normalizing a normalized string produces the same result).

**Unit tests: Content hashing** -- Verify that identical normalized texts produce identical SHA-256 hashes. Verify that different texts produce different hashes. Verify hash format (64-character hex string). Test edge cases: empty string hash, very long string hash, Unicode string hash.

**Unit tests: Cosine similarity** -- Test with known vectors: identical vectors produce 1.0, orthogonal vectors produce 0.0, opposite vectors produce -1.0 (for non-normalized) or 0.0 (for normalized). Test with real-world-like vectors of various dimensions (384, 768, 1024, 1536). Verify the fast dot-product path produces the same result as the full cosine formula for normalized vectors.

**Unit tests: Classification** -- Test that similarity scores are correctly mapped to classification tiers. Test boundary conditions: score exactly at threshold, score one epsilon below threshold. Test with custom thresholds. Verify that `exactThreshold` > `threshold` > `relatedThreshold` ordering is enforced.

**Unit tests: Merge policies** -- For each built-in merge policy (`keep-newest`, `keep-oldest`, `keep-longest`, `keep-highest-confidence`, `merge`), test with known entry pairs and verify the correct survivor, evicted entry, and merged metadata. Test the `custom` policy with a mock function. Test metadata merge rules: timestamp union, source union, tag union, confidence max.

**Unit tests: Events** -- Register handlers for `duplicate-found`, `merged`, `evicted`, `added`, and `sweep-complete`. Verify that events fire with correct payloads at correct times. Verify unsubscription.

**Integration tests: Full dedup pipeline** -- Create a deduplicator with a mock embedder that returns predetermined vectors. Add entries and verify the full pipeline: normalization, hashing, embedding, search, classification, merge. Test the content hash fast path: two entries with identical text should skip embedding.

**Integration tests: Batch operations** -- Add a batch of entries with known duplicates. Verify that `addBatch()` correctly identifies duplicates within the batch and against previously added entries. Verify that batch results match expectations.

**Integration tests: Sweep and compact** -- Populate a deduplicator with entries containing known duplicate groups. Run `sweep()` and verify that all duplicate pairs are found. Run `compact()` and verify clusters, reduction ratio, and evicted entries.

**Integration tests: Custom embedder** -- Test with a real embedding model (if available in CI) or a deterministic mock. Verify that entries with semantically similar text are classified as duplicates and entries with different text are classified as unique.

**Edge case tests** -- Empty entry content, very long content (10KB+), entry with no metadata, entry with all metadata fields populated, duplicate detection when the index has only one entry, `sweep()` on an empty index, `sweep()` on an index with no duplicates, `sweep()` on an index where all entries are duplicates, `compact()` producing a single cluster, embedder that throws, embedder that returns wrong dimensions, destroy followed by attempted use.

### Test Organization

```
src/__tests__/
  dedup.test.ts                    -- Full lifecycle integration tests
  pipeline/
    normalize.test.ts              -- Text normalization
    hash.test.ts                   -- Content hashing
    embed.test.ts                  -- Embedding integration (mock embedder)
    search.test.ts                 -- Cosine similarity search
    classify.test.ts               -- Classification tiers
  merge/
    keep-newest.test.ts            -- keep-newest policy
    keep-oldest.test.ts            -- keep-oldest policy
    keep-longest.test.ts           -- keep-longest policy
    keep-highest-confidence.test.ts
    merge-policy.test.ts           -- merge (combine) policy
    custom.test.ts                 -- Custom merge function
    metadata-merge.test.ts         -- Metadata merge rules
  operations/
    add.test.ts                    -- add() with various scenarios
    check.test.ts                  -- check() without modification
    add-batch.test.ts              -- addBatch() with duplicates
    sweep.test.ts                  -- sweep() duplicate detection
    compact.test.ts                -- compact() with clustering
  similarity/
    cosine.test.ts                 -- Cosine similarity computation
    metadata-boost.test.ts         -- Metadata boost logic
  store/
    in-memory.test.ts              -- Default in-memory store
    backend-interface.test.ts      -- Custom backend contract tests
  events/
    emission.test.ts               -- Event firing
    unsubscribe.test.ts            -- Handler removal
  fixtures/
    entries.ts                     -- Test memory entry data
    embeddings.ts                  -- Predetermined embedding vectors
    mock-embedder.ts               -- Mock embedder for testing
```

### Test Framework

Tests use Vitest, matching the project's existing `package.json` configuration. The mock embedder returns predetermined vectors from a lookup table keyed by content text, enabling deterministic testing without API calls. For entries not in the lookup table, the mock embedder generates a random vector with a fixed seed derived from the content hash, ensuring reproducibility.

---

## 15. Performance

### Incremental Dedup (add)

| Stage | Time | Notes |
|---|---|---|
| Normalize | < 0.01ms | String operations only |
| Content hash | < 0.01ms | SHA-256 via `node:crypto` |
| Hash lookup | < 0.01ms | `Map.get()` |
| Embed (API) | 30-100ms | OpenAI API call. 0ms if hash match or cache hit. |
| Embed (local) | 100-500ms | transformers.js. 0ms if hash match or cache hit. |
| Similarity search (1K entries) | ~5ms | Brute-force, 1536-dim vectors |
| Similarity search (10K entries) | ~50ms | Brute-force, 1536-dim vectors |
| Classify + merge | < 0.01ms | Threshold comparison + policy |

**Total per entry (API embedder, no cache hit)**: ~50-150ms, dominated by embedding API call.
**Total per entry (content hash match)**: < 0.1ms.
**Total per entry (cache hit)**: ~5-50ms, dominated by similarity search.

### Batch Dedup (addBatch)

For N entries with batch embedding:

- Embedding: ceil(N / batchSize) API calls. For 100 entries with batchSize 100: 1 API call (~100ms).
- Similarity search: O(N * M) where M is the current index size. For 100 new entries against a 1,000-entry index: ~50ms.
- Total for 100 entries: ~200ms.

### Sweep

For N entries in the index:

- Pairwise comparisons (brute-force): N*(N-1)/2. For 1,000 entries: 499,500 comparisons.
- Each comparison: ~0.005ms (dot product of 1536-dim vectors).
- Total brute-force for 1,000 entries: ~2.5 seconds.
- With clustering (k=32 clusters): ~250ms.

### Memory Footprint

| Component | Per-Entry Cost (1536-dim) | 1K Entries | 10K Entries |
|---|---|---|---|
| Entry object | ~0.5 KB | 0.5 MB | 5 MB |
| Embedding vector | ~12 KB | 12 MB | 120 MB |
| Content hash | 64 bytes | 64 KB | 640 KB |
| Total | ~12.5 KB | ~12.6 MB | ~126 MB |

For lower-dimensional models (384-dim `all-MiniLM-L6-v2`), per-entry vector cost drops to ~3 KB, enabling 10,000 entries in ~35 MB.

---

## 16. Dependencies

### Runtime Dependencies

None. `memory-dedup` has zero runtime dependencies. All functionality is implemented using Node.js built-in modules and pure TypeScript:

| Node.js Built-in | Purpose |
|---|---|
| `node:crypto` | SHA-256 content hashing via `createHash`. |

### Why Zero Dependencies

- **No embedding library**: The caller provides the embedding function. The package does not bundle OpenAI, Cohere, transformers.js, or any model.
- **No vector search library**: Cosine similarity is a dot product (~5 lines of code). Brute-force search is a loop. Clustering is ~50 lines. No need for `hnswlib-node`, `vectra`, or `usearch`. Callers who need ANN search provide a `StoreBackend`.
- **No math library**: Vector operations (dot product, magnitude, normalization) are implemented in ~20 lines of pure TypeScript. No need for `mathjs` or `ml-matrix`.
- **No UUID library**: Entry IDs are provided by the caller. Internal group IDs use counter-based schemes.
- **No event emitter library**: The event system is a simple `Map<string, Set<Function>>` implementation (~30 lines).

### Dev Dependencies

| Dependency | Purpose |
|---|---|
| `typescript` | TypeScript compiler (>= 5.0). |
| `vitest` | Test runner. |
| `eslint` | Linter. |

### Optional Integration Dependencies

| Package | Purpose |
|---|---|
| `embed-cache` | Caching embedding vectors to avoid redundant API calls. |
| `agent-scratchpad` | Working memory whose entries can be deduplicated. |
| `sliding-context` | Conversation history manager. Facts extracted from summaries can be deduplicated. |
| `openai` | OpenAI SDK for embedding API calls (caller provides). |
| `cohere-ai` | Cohere SDK for embedding API calls (caller provides). |
| `@xenova/transformers` | Local embedding models (caller provides). |
| `hnswlib-node` | ANN search backend for large indexes (caller provides via StoreBackend). |

These are not dependencies of `memory-dedup`. The caller imports them separately and uses them to construct the embedder function or store backend.

---

## 17. File Structure

```
memory-dedup/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                        Public API exports: createDeduplicator, types,
                                    cosineSimilarity (utility export).
    types.ts                        All TypeScript type definitions: MemoryEntry,
                                    DedupOptions, DedupResult, AddResult, BatchResult,
                                    SweepResult, CompactResult, MergeResult, DedupStats,
                                    StoreBackend, DedupEvents, error classes.
    deduplicator.ts                 MemoryDedup class implementation: add, check,
                                    addBatch, sweep, compact, stats, events, lifecycle.
    pipeline/
      index.ts                      Pipeline orchestrator: runs stages 1-6 in sequence.
      normalize.ts                  Stage 1: text normalization (lowercase, whitespace,
                                    punctuation, Unicode NFC).
      hash.ts                       Stage 2: SHA-256 content hashing and hash index
                                    lookup.
      embed.ts                      Stage 3: embedding generation via the configured
                                    embedder, with batch support.
      search.ts                     Stage 4: cosine similarity search against the
                                    index. Brute-force and clustered search.
      classify.ts                   Stage 5: threshold-based classification into
                                    tiers.
    merge/
      index.ts                      Merge policy dispatcher: selects and applies
                                    the configured policy.
      keep-newest.ts                keep-newest policy implementation.
      keep-oldest.ts                keep-oldest policy implementation.
      keep-longest.ts               keep-longest policy implementation.
      keep-highest-confidence.ts    keep-highest-confidence policy implementation.
      merge-combine.ts              merge (combine) policy implementation.
      metadata.ts                   Metadata merge logic: timestamp, source, tags,
                                    confidence rules.
    similarity/
      cosine.ts                     Cosine similarity computation (dot product path
                                    for normalized vectors, full formula for others).
      metadata-boost.ts             Metadata-based similarity boosting logic.
    store/
      in-memory.ts                  Default in-memory StoreBackend implementation
                                    using Map + flat array.
    cluster/
      kmeans.ts                     Simple k-means-like clustering for sweep
                                    optimization. Centroid computation, assignment,
                                    and iteration.
    events.ts                       Event emitter implementation: on, off, emit.
    errors.ts                       Error classes: DedupError, DedupConfigError,
                                    DedupEmbeddingError, DedupStoreError.
  src/__tests__/
    dedup.test.ts                   Full lifecycle integration tests.
    pipeline/
      normalize.test.ts
      hash.test.ts
      embed.test.ts
      search.test.ts
      classify.test.ts
    merge/
      keep-newest.test.ts
      keep-oldest.test.ts
      keep-longest.test.ts
      keep-highest-confidence.test.ts
      merge-policy.test.ts
      custom.test.ts
      metadata-merge.test.ts
    operations/
      add.test.ts
      check.test.ts
      add-batch.test.ts
      sweep.test.ts
      compact.test.ts
    similarity/
      cosine.test.ts
      metadata-boost.test.ts
    store/
      in-memory.test.ts
      backend-interface.test.ts
    events/
      emission.test.ts
      unsubscribe.test.ts
    fixtures/
      entries.ts                    Test memory entry data with known
                                    duplicate/unique relationships.
      embeddings.ts                 Predetermined embedding vectors for
                                    deterministic testing.
      mock-embedder.ts              Mock embedder that returns vectors
                                    from the lookup table.
  dist/                             Compiled output (generated by tsc, gitignored).
```

---

## 18. Implementation Roadmap

### Phase 1: Core Pipeline and Hash Dedup (v0.1.0)

Implement the dedup pipeline through Stage 2 (content hash matching) and the in-memory store.

**Deliverables:**
- Type definitions in `types.ts`: `MemoryEntry`, `DedupOptions`, `DedupResult`, `AddResult`, `MergeResult`, `DedupStats`, error classes.
- Text normalization (Stage 1): lowercase, whitespace collapse, punctuation strip, Unicode NFC.
- Content hashing (Stage 2): SHA-256 via `node:crypto`, hash index with `Map<string, string>`.
- In-memory store: `Map`-based entry and vector storage.
- `createDeduplicator()` factory with configuration validation.
- `add()` method with content hash dedup only (no embedding yet).
- `check()` method with content hash check only.
- `keep-newest` merge policy.
- Basic event emission: `duplicate-found`, `merged`, `added`.
- `stats()` method.
- Unit tests for normalization, hashing, and hash-based dedup.

### Phase 2: Embedding-Based Semantic Dedup (v0.2.0)

Add embedding integration and cosine similarity search for semantic duplicate detection.

**Deliverables:**
- Embedding generation (Stage 3): call configured `embedder` function, dimension validation.
- Cosine similarity computation (Stage 4): dot product for normalized vectors, full formula otherwise.
- Brute-force similarity search over the in-memory vector index.
- Classification (Stage 5): threshold-based tier assignment with configurable thresholds.
- `add()` updated with full pipeline: hash check first, then embed and search if no hash match.
- `check()` updated with full pipeline.
- Metadata similarity boost.
- Unit tests for cosine similarity, classification, and full pipeline integration.

### Phase 3: Merge Policies and Batch Operations (v0.3.0)

Add all merge policies and batch operations.

**Deliverables:**
- All merge policies: `keep-oldest`, `keep-longest`, `keep-highest-confidence`, `merge`, `custom`.
- Metadata merge rules (timestamp, source, tags, confidence).
- `addBatch()` method with batch embedding support.
- Batch embedding detection (`embedder.batch` property).
- `evicted` event emission.
- Unit tests for each merge policy. Integration tests for batch operations.

### Phase 4: Sweep, Compact, and Clustering (v0.4.0)

Add batch sweep dedup, compact with clustering, and performance optimizations.

**Deliverables:**
- `sweep()` method: pairwise comparison with duplicate detection and merge application.
- `compact()` method: sweep + clustering + representative selection.
- K-means-like clustering for sweep optimization on large indexes.
- `getDuplicateGroups()` method.
- `sweep-complete` event.
- `remove()` and `clear()` methods.
- Integration tests for sweep and compact with known duplicate groups.

### Phase 5: Store Backend and Polish (v1.0.0)

Add the pluggable store backend, harden edge cases, and prepare for release.

**Deliverables:**
- `StoreBackend` interface and default in-memory implementation extraction.
- Index rebuild on load for pre-populated stores.
- `destroy()` lifecycle method.
- Edge case hardening: empty index operations, dimension mismatch handling, embedder failure recovery.
- Performance benchmarks.
- Complete README with installation, quick start, API reference, integration examples.
- Published npm package with TypeScript declarations.

---

## 19. Example Use Cases

### 19.1 Agent Memory Cleanup

An AI assistant maintains a fact store about users. Over months of conversations, duplicate facts accumulate. A nightly cleanup job uses `memory-dedup` to find and merge duplicates:

```typescript
import { createDeduplicator } from 'memory-dedup';

const dedup = createDeduplicator({
  embedder: openaiEmbed,
  threshold: 0.90,
  mergePolicy: 'keep-longest',
});

// Load existing memories from the database
const memories = await db.query('SELECT id, content, metadata FROM memories WHERE user_id = $1', [userId]);

// Add all memories to the deduplicator
const batchResult = await dedup.addBatch(
  memories.map(m => ({ id: m.id, content: m.content, metadata: m.metadata })),
);

console.log(`Scanned ${batchResult.totalProcessed} memories`);
console.log(`Found ${batchResult.duplicatesFound} duplicates`);
console.log(`${batchResult.uniqueAdded} unique memories remain`);

// Apply evictions to the database
for (const result of batchResult.results) {
  if (result.evictedId) {
    await db.query('DELETE FROM memories WHERE id = $1', [result.evictedId]);
    await db.query('UPDATE memories SET content = $1, metadata = $2 WHERE id = $3',
      [result.survivor.content, result.survivor.metadata, result.survivorId]);
  }
}
```

### 19.2 Fact Deduplication During Extraction

An agent extracts facts from each conversation turn. `memory-dedup` deduplicates on insert to prevent duplicate facts from ever reaching the store:

```typescript
import { createDeduplicator } from 'memory-dedup';

const dedup = createDeduplicator({
  embedder: openaiEmbed,
  threshold: 0.92,
  mergePolicy: 'merge',
});

async function onConversationTurn(userMessage: string, assistantResponse: string) {
  // Extract facts from the conversation
  const facts = await llm.extractFacts(`User: ${userMessage}\nAssistant: ${assistantResponse}`);

  for (const fact of facts) {
    const result = await dedup.add({
      id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content: fact.text,
      metadata: {
        source: `conversation-${conversationId}`,
        confidence: fact.confidence,
        tags: fact.categories,
        type: 'fact',
        timestamp: Date.now(),
      },
    });

    if (result.action === 'added') {
      console.log(`New fact stored: "${fact.text}"`);
    } else if (result.action === 'merged') {
      console.log(`Duplicate merged (${result.similarity.toFixed(2)} similarity): "${fact.text}"`);
    }
  }
}

// Example: these are semantically identical and will be merged
// Turn 1 extracts: "User lives in NYC"
// Turn 5 extracts: "User's location is New York City"
// Turn 12 extracts: "The user is based in New York, NY"
// Result: one entry survives with the longest content and merged provenance
```

### 19.3 Long-Running Assistant Memory Compaction

A customer support assistant has accumulated 5,000 memory entries over 6 months of operation. Memory retrieval has degraded because duplicate entries consume retrieval slots. A periodic compaction job restores retrieval quality:

```typescript
import { createDeduplicator } from 'memory-dedup';

const dedup = createDeduplicator({
  embedder: openaiEmbed,
  threshold: 0.88,
  mergePolicy: 'keep-newest',
});

async function weeklyCompaction() {
  // Load all entries
  const entries = await memoryStore.getAll();
  const batch = await dedup.addBatch(entries);

  // Run compact for aggressive dedup with clustering
  const compactResult = await dedup.compact();

  console.log(`Before: ${compactResult.entriesBefore} entries`);
  console.log(`After: ${compactResult.entriesAfter} entries`);
  console.log(`Reduction: ${(compactResult.reductionRatio * 100).toFixed(1)}%`);
  console.log(`Clusters: ${compactResult.clusterCount}`);
  console.log(`Evicted: ${compactResult.evictedCount} entries`);

  // Apply evictions
  for (const id of compactResult.evictedIds) {
    await memoryStore.delete(id);
  }

  // Update survivors with merged metadata
  for (const entry of dedup.getEntries()) {
    await memoryStore.update(entry.id, entry);
  }
}
```

### 19.4 Observability and Monitoring

Track dedup performance and memory health over time:

```typescript
import { createDeduplicator } from 'memory-dedup';

const dedup = createDeduplicator({
  embedder: openaiEmbed,
  threshold: 0.90,
});

// Listen for dedup events
dedup.on('duplicate-found', (event) => {
  metrics.increment('memory.dedup.duplicates_found', {
    classification: event.classification,
  });
  metrics.histogram('memory.dedup.similarity', event.similarity);
});

dedup.on('merged', (event) => {
  metrics.increment('memory.dedup.merges', { policy: event.policy });
});

dedup.on('added', () => {
  metrics.increment('memory.dedup.unique_added');
});

// Periodically report stats
setInterval(() => {
  const stats = dedup.stats();
  metrics.gauge('memory.dedup.total_entries', stats.totalEntries);
  metrics.gauge('memory.dedup.dedup_rate', stats.deduplicationRate);
  metrics.gauge('memory.dedup.embedding_calls_saved', stats.embeddingCallsSaved);
}, 60_000);
```

### 19.5 Multi-Agent Shared Memory Dedup

Multiple agents share a memory store and independently write facts about the same entities. Cross-agent dedup prevents redundant entries:

```typescript
import { createDeduplicator } from 'memory-dedup';

const dedup = createDeduplicator({
  embedder: openaiEmbed,
  threshold: 0.90,
  mergePolicy: 'keep-highest-confidence',
  metadataBoost: true,
});

// Agent A learns: "Company X's API rate limit is 100 requests per second"
await dedup.add({
  id: 'agent-a-fact-1',
  content: "Company X's API rate limit is 100 requests per second",
  metadata: { source: 'agent-a', confidence: 0.88, tags: ['api', 'rate-limit'] },
});

// Agent B independently learns: "The rate limit for Company X API is 100 req/s"
const result = await dedup.add({
  id: 'agent-b-fact-1',
  content: 'The rate limit for Company X API is 100 req/s',
  metadata: { source: 'agent-b', confidence: 0.95, tags: ['api', 'company-x'] },
});

// Result: merged, agent-b's entry survives (higher confidence)
// Metadata: sources: ['agent-a', 'agent-b'], tags: ['api', 'rate-limit', 'company-x']
console.log(result.action);      // 'merged'
console.log(result.survivorId);  // 'agent-b-fact-1'
console.log(result.similarity);  // ~0.93
```
