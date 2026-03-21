import { MemoryEntry, DedupOptions, DedupResult, AddResult, BatchResult, SweepResult, CompactResult, DedupStats, MemoryDedup } from './types.js';
import { cosine, contentHash, normalizeText } from './similarity.js';
import { InMemoryStore } from './store.js';
import { applyMergePolicy } from './merge.js';
import { EventEmitter } from './events.js';

interface CheckInternal {
  result: DedupResult;
  embedding: number[] | null; // null when hash-matched (no embedding computed)
  hash: string;
}

export function createDeduplicator(options: DedupOptions): MemoryDedup {
  const threshold = options.threshold ?? 0.90;
  const exactThreshold = options.exactThreshold ?? 0.98;
  const relatedThreshold = options.relatedThreshold ?? 0.75;
  const mergePolicy = options.mergePolicy ?? 'keep-newest';

  const store = new InMemoryStore();
  const emitter = new EventEmitter();

  // Counters for stats
  let totalChecks = 0;
  let exactDuplicates = 0;
  let semanticDuplicates = 0;
  let uniqueEntries = 0;

  async function checkInternal(entry: MemoryEntry): Promise<CheckInternal> {
    const start = Date.now();
    totalChecks++;

    const normalized = normalizeText(entry.content);
    const hash = contentHash(normalized);

    // Fast path: hash match — no embedding needed
    const existingId = store.getHash(hash);
    if (existingId !== null) {
      exactDuplicates++;
      return {
        result: {
          classification: 'exact_duplicate',
          matchId: existingId,
          similarity: 1.0,
          hashMatch: true,
          durationMs: Date.now() - start,
        },
        embedding: null,
        hash,
      };
    }

    // Embedding path — compute once and reuse
    const embedding = await options.embedder(entry.content);
    const allEntries = store.all();

    let maxSimilarity = 0;
    let bestMatchId: string | undefined;

    for (const stored of allEntries) {
      const storedEmbedding = store.getEmbedding(stored.id);
      if (!storedEmbedding) continue;
      const sim = cosine(embedding, storedEmbedding);
      if (sim > maxSimilarity) {
        maxSimilarity = sim;
        bestMatchId = stored.id;
      }
    }

    if (maxSimilarity >= exactThreshold) {
      exactDuplicates++;
      return {
        result: {
          classification: 'exact_duplicate',
          matchId: bestMatchId,
          similarity: maxSimilarity,
          hashMatch: false,
          durationMs: Date.now() - start,
        },
        embedding,
        hash,
      };
    }

    if (maxSimilarity >= threshold) {
      semanticDuplicates++;
      return {
        result: {
          classification: 'semantic_duplicate',
          matchId: bestMatchId,
          similarity: maxSimilarity,
          hashMatch: false,
          durationMs: Date.now() - start,
        },
        embedding,
        hash,
      };
    }

    if (maxSimilarity >= relatedThreshold) {
      return {
        result: {
          classification: 'related',
          matchId: bestMatchId,
          similarity: maxSimilarity,
          hashMatch: false,
          durationMs: Date.now() - start,
        },
        embedding,
        hash,
      };
    }

    uniqueEntries++;
    return {
      result: {
        classification: 'unique',
        similarity: maxSimilarity > 0 ? maxSimilarity : undefined,
        hashMatch: false,
        durationMs: Date.now() - start,
      },
      embedding,
      hash,
    };
  }

  async function check(entry: MemoryEntry): Promise<DedupResult> {
    const { result } = await checkInternal(entry);
    return result;
  }

  async function add(entry: MemoryEntry): Promise<AddResult> {
    const start = Date.now();
    const { result, embedding: candidateEmbedding, hash } = await checkInternal(entry);

    if (result.classification === 'unique' || result.classification === 'related') {
      // Reuse already-computed embedding — no second embedder call
      const emb = candidateEmbedding ?? await options.embedder(entry.content);
      store.add(entry, emb, hash);

      emitter.emit('added', { entry });

      return {
        ...result,
        action: 'added',
        survivorId: entry.id,
        durationMs: Date.now() - start,
      };
    }

    // Duplicate found — apply merge policy
    const matchId = result.matchId!;
    const matchEntry = store.get(matchId)!;

    emitter.emit('duplicate-found', { candidate: entry, match: matchEntry, similarity: result.similarity });

    const { survivor, evicted } = applyMergePolicy(entry, matchEntry, mergePolicy, result.similarity ?? 1.0);

    // Remove the evicted entry from store
    store.remove(evicted.id);

    // Get or compute the survivor's embedding
    let survivorEmbedding: number[];
    if (survivor.id === matchId && survivor.content === matchEntry.content) {
      // Survivor is unchanged existing entry — reuse its stored embedding
      survivorEmbedding = store.getEmbedding(survivor.id) ?? await options.embedder(survivor.content);
    } else {
      // Survivor is the candidate or a merged variant — compute embedding
      survivorEmbedding = candidateEmbedding ?? await options.embedder(survivor.content);
    }

    const survivorNorm = normalizeText(survivor.content);
    const survivorHash = contentHash(survivorNorm);
    store.add(survivor, survivorEmbedding, survivorHash);

    emitter.emit('merged', { survivor, evicted });
    emitter.emit('evicted', { entry: evicted });

    return {
      ...result,
      action: 'merged',
      survivorId: survivor.id,
      evictedId: evicted.id,
      durationMs: Date.now() - start,
    };
  }

  async function addBatch(entries: MemoryEntry[]): Promise<BatchResult> {
    const start = Date.now();
    const results: AddResult[] = [];
    let uniqueAdded = 0;
    let duplicatesFound = 0;

    for (const entry of entries) {
      const result = await add(entry);
      results.push(result);
      if (result.action === 'added') {
        uniqueAdded++;
      } else {
        duplicatesFound++;
      }
    }

    return {
      results,
      totalProcessed: entries.length,
      uniqueAdded,
      duplicatesFound,
      durationMs: Date.now() - start,
    };
  }

  async function sweep(): Promise<SweepResult> {
    const start = Date.now();
    const allEntries = store.all();
    const duplicatePairs: Array<[string, string]> = [];
    const evictedIds: string[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < allEntries.length; i++) {
      const a = allEntries[i];
      if (processed.has(a.id)) continue;

      for (let j = i + 1; j < allEntries.length; j++) {
        const b = allEntries[j];
        if (processed.has(b.id)) continue;

        const embA = store.getEmbedding(a.id);
        const embB = store.getEmbedding(b.id);
        if (!embA || !embB) continue;

        const sim = cosine(embA, embB);
        if (sim >= threshold) {
          duplicatePairs.push([a.id, b.id]);

          const { survivor, evicted } = applyMergePolicy(a, b, mergePolicy, sim);

          store.remove(evicted.id);

          // Reuse the surviving entry's embedding if content unchanged
          let survivorEmb: number[];
          if (survivor.id === a.id && survivor.content === a.content) {
            survivorEmb = embA;
          } else if (survivor.id === b.id && survivor.content === b.content) {
            survivorEmb = embB;
          } else {
            survivorEmb = await options.embedder(survivor.content);
          }

          const survivorNorm = normalizeText(survivor.content);
          const survivorHash = contentHash(survivorNorm);
          store.add(survivor, survivorEmb, survivorHash);

          emitter.emit('evicted', { entry: evicted });
          evictedIds.push(evicted.id);
          processed.add(evicted.id);
          break;
        }
      }
    }

    return {
      duplicatePairs,
      duplicateCount: duplicatePairs.length,
      evictedCount: evictedIds.length,
      evictedIds,
      totalScanned: allEntries.length,
      durationMs: Date.now() - start,
    };
  }

  async function compact(): Promise<CompactResult> {
    const start = Date.now();
    const allEntries = store.all();
    const evictedIds: string[] = [];
    const duplicatePairs: Array<[string, string]> = [];

    // Build clusters using union-find
    const parent = new Map<string, string>();
    for (const e of allEntries) parent.set(e.id, e.id);

    function find(id: string): string {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root)!;
      // Path compression
      let cur = id;
      while (cur !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    }

    function union(a: string, b: string): void {
      parent.set(find(a), find(b));
    }

    // O(n²) pairwise comparison
    for (let i = 0; i < allEntries.length; i++) {
      for (let j = i + 1; j < allEntries.length; j++) {
        const a = allEntries[i];
        const b = allEntries[j];
        const embA = store.getEmbedding(a.id);
        const embB = store.getEmbedding(b.id);
        if (!embA || !embB) continue;
        const sim = cosine(embA, embB);
        if (sim >= threshold) {
          duplicatePairs.push([a.id, b.id]);
          union(a.id, b.id);
        }
      }
    }

    // Group by cluster root
    const clusters = new Map<string, MemoryEntry[]>();
    for (const entry of allEntries) {
      const root = find(entry.id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(entry);
    }

    let mergedCount = 0;
    const clustersFound = Array.from(clusters.values()).filter(c => c.length > 1).length;

    for (const cluster of clusters.values()) {
      if (cluster.length <= 1) continue;

      // Merge all cluster members into a single survivor
      let survivor = cluster[0];
      let survivorEmb = store.getEmbedding(survivor.id) ?? await options.embedder(survivor.content);

      for (let k = 1; k < cluster.length; k++) {
        const candidate = cluster[k];
        const embA = survivorEmb;
        const embB = store.getEmbedding(candidate.id);
        const sim = embB ? cosine(embA, embB) : 1.0;
        const { survivor: newSurvivor, evicted } = applyMergePolicy(survivor, candidate, mergePolicy, sim);

        store.remove(evicted.id);
        evictedIds.push(evicted.id);
        emitter.emit('evicted', { entry: evicted });
        mergedCount++;

        if (newSurvivor.id !== survivor.id || newSurvivor.content !== survivor.content) {
          survivorEmb = await options.embedder(newSurvivor.content);
        }
        survivor = newSurvivor;
      }

      // Re-add the final survivor
      const survivorNorm = normalizeText(survivor.content);
      const survivorHash = contentHash(survivorNorm);
      store.add(survivor, survivorEmb, survivorHash);
    }

    return {
      duplicatePairs,
      duplicateCount: duplicatePairs.length,
      evictedCount: evictedIds.length,
      evictedIds,
      totalScanned: allEntries.length,
      durationMs: Date.now() - start,
      clustersFound,
      mergedCount,
    };
  }

  function stats(): DedupStats {
    return {
      totalEntries: store.size(),
      totalChecks,
      exactDuplicates,
      semanticDuplicates,
      uniqueEntries,
    };
  }

  return {
    check,
    add,
    addBatch,
    sweep,
    compact,
    getEntries: () => store.all(),
    remove: (id: string) => store.remove(id),
    clear: () => {
      store.clear();
      totalChecks = 0;
      exactDuplicates = 0;
      semanticDuplicates = 0;
      uniqueEntries = 0;
    },
    stats,
    size: () => store.size(),
    on: (event: string, fn: (payload: unknown) => void) => emitter.on(event, fn),
    off: (event: string, fn: (payload: unknown) => void) => emitter.off(event, fn),
  };
}
