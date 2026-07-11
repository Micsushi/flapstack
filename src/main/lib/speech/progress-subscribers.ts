export class ProgressSubscribers<Key, State> {
  private readonly listeners = new Map<Key, Set<(state: State) => void>>()

  subscribe(key: Key, listener: (state: State) => void, initialState: State): () => void {
    const listeners = this.listeners.get(key) ?? new Set()
    listeners.add(listener)
    this.listeners.set(key, listeners)
    listener(initialState)
    return () => {
      const current = this.listeners.get(key)
      current?.delete(listener)
      if (!current?.size) this.listeners.delete(key)
    }
  }

  publish(key: Key, state: State): void {
    for (const listener of this.listeners.get(key) ?? []) listener(state)
  }
}
