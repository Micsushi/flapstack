import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

function canonical(path: string) {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

export function providerProbeKey(command: string, env = process.env, home?: string): string {
  const accountHome =
    home ||
    (process.platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE)
  return JSON.stringify([canonical(command), canonical(accountHome || homedir())])
}

export class ProviderProbeCache<T> {
  private readonly entries = new Map<
    string,
    { good?: { value: T; expiresAt: number }; pending?: Promise<T> }
  >()

  constructor(private readonly ttlMs: number) {}

  get(key: string, probe: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key) ?? {}
    if (entry.pending) return entry.pending
    if (entry.good && entry.good.expiresAt > Date.now()) return Promise.resolve(entry.good.value)
    this.entries.set(key, entry)
    entry.pending = Promise.resolve()
      .then(probe)
      .then((value) => {
        entry.good = { value, expiresAt: Date.now() + this.ttlMs }
        return value
      })
      .catch((error) => {
        if (entry.good) return entry.good.value
        this.entries.delete(key)
        throw error
      })
      .finally(() => {
        entry.pending = undefined
      })
    return entry.pending
  }

  invalidate(key: string): void {
    const result = this.entries.get(key)?.good
    if (result) result.expiresAt = 0
  }
}
