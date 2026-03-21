/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector is a zero vector.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;

  return dot / denom;
}

/**
 * L2-normalize a vector. Returns zero vector if magnitude is 0.
 */
export function normalize(vec: number[]): number[] {
  let mag = 0;
  for (const v of vec) mag += v * v;
  mag = Math.sqrt(mag);
  if (mag === 0) return vec.map(() => 0);
  return vec.map(v => v / mag);
}

/**
 * djb2 hash of a string, returned as an 8-char hex string.
 * Used for fast exact/near-exact matching before embedding.
 */
export function contentHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Normalize text for comparison:
 * lowercase, collapse whitespace, trim, remove punctuation except meaningful chars.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
