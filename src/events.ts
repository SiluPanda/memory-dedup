export type DedupEvent = 'duplicate-found' | 'merged' | 'evicted' | 'added';

export class EventEmitter {
  private listeners = new Map<string, Set<Function>>();

  on(event: string, fn: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Function): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, payload: unknown): void {
    const fns = this.listeners.get(event);
    if (!fns) return;
    for (const fn of fns) {
      fn(payload);
    }
  }
}
