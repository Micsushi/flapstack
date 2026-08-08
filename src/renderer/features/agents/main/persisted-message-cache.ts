type PersistedMessageCacheOptions<T> = {
  parse: (raw: string) => unknown[]
  normalize: (messages: unknown[]) => T[]
}

export function createPersistedMessageCache<T>({
  parse,
  normalize,
}: PersistedMessageCacheOptions<T>) {
  const entries = new Map<string, { raw: string; messages: T[] }>()

  return {
    read(id: string, raw: string): T[] {
      const cached = entries.get(id)
      if (cached?.raw === raw) return cached.messages
      let parsed: unknown[] = []
      try {
        const value = parse(raw)
        if (Array.isArray(value)) parsed = value
      } catch {
        // Invalid legacy payloads hydrate as an empty transcript.
      }
      const messages = normalize(parsed)
      entries.set(id, { raw, messages })
      return messages
    },
    delete(id: string) {
      entries.delete(id)
    },
  }
}
