import { MemoryEntry, StoreBackend } from './types.js';

export class InMemoryStore implements StoreBackend {
  private entries = new Map<string, MemoryEntry>();
  private embeddings = new Map<string, number[]>();
  private hashes = new Map<string, string>(); // hash → id

  add(entry: MemoryEntry, embedding: number[], hash: string): void {
    this.entries.set(entry.id, entry);
    this.embeddings.set(entry.id, embedding);
    this.hashes.set(hash, entry.id);
  }

  get(id: string): MemoryEntry | null {
    return this.entries.get(id) ?? null;
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    // Remove the hash reverse-lookup entry
    for (const [hash, mappedId] of this.hashes.entries()) {
      if (mappedId === id) {
        this.hashes.delete(hash);
        break;
      }
    }

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
