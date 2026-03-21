import { MemoryEntry, DedupOptions, EntryMetadata } from './types.js';

function getTimestamp(entry: MemoryEntry): number {
  const meta = (entry.metadata ?? {}) as EntryMetadata;
  const ts = meta.timestamp ?? meta.createdAt;
  return typeof ts === 'number' ? ts : 0;
}

function getConfidence(entry: MemoryEntry): number {
  const meta = (entry.metadata ?? {}) as EntryMetadata;
  const conf = meta.confidence;
  return typeof conf === 'number' ? conf : 0;
}

function mergeMetadata(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...a };
  for (const [key, bVal] of Object.entries(b ?? {})) {
    const aVal = result[key];
    if (Array.isArray(aVal) && Array.isArray(bVal)) {
      // Combine arrays, deduplicate primitives
      result[key] = Array.from(new Set([...aVal, ...bVal]));
    } else if (typeof aVal === 'number' && typeof bVal === 'number') {
      // Keep newest (larger) numeric value
      result[key] = Math.max(aVal, bVal);
    } else {
      result[key] = bVal;
    }
  }
  return result;
}

export function applyMergePolicy(
  candidate: MemoryEntry,
  match: MemoryEntry,
  policy: DedupOptions['mergePolicy'],
  similarity: number
): { survivor: MemoryEntry; evicted: MemoryEntry } {
  const effectivePolicy = policy ?? 'keep-newest';

  if (typeof effectivePolicy === 'function') {
    const survivor = effectivePolicy(candidate, match, similarity);
    const evicted = survivor.id === candidate.id ? match : candidate;
    return { survivor, evicted };
  }

  switch (effectivePolicy) {
    case 'keep-newest': {
      const candTs = getTimestamp(candidate);
      const matchTs = getTimestamp(match);
      if (candTs >= matchTs) {
        return { survivor: candidate, evicted: match };
      }
      return { survivor: match, evicted: candidate };
    }

    case 'keep-oldest': {
      const candTs = getTimestamp(candidate);
      const matchTs = getTimestamp(match);
      if (candTs <= matchTs) {
        return { survivor: candidate, evicted: match };
      }
      return { survivor: match, evicted: candidate };
    }

    case 'keep-longest': {
      if (candidate.content.length >= match.content.length) {
        return { survivor: candidate, evicted: match };
      }
      return { survivor: match, evicted: candidate };
    }

    case 'keep-highest-confidence': {
      const candConf = getConfidence(candidate);
      const matchConf = getConfidence(match);
      if (candConf >= matchConf) {
        return { survivor: candidate, evicted: match };
      }
      return { survivor: match, evicted: candidate };
    }

    case 'merge': {
      const longer = candidate.content.length >= match.content.length ? candidate : match;
      const merged: MemoryEntry = {
        id: match.id,
        content: longer.content,
        metadata: mergeMetadata(candidate.metadata, match.metadata),
      };
      return { survivor: merged, evicted: candidate };
    }
  }
}
