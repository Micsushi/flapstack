import { createHmac, randomBytes } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { CodexProtocolClient } from "./protocol-client"

const lifetimeMs = 30_000
const secret = randomBytes(32)
type Lease = {
  command: string
  files: string[]
  identity: string | null
  deadline: number
  client?: CodexProtocolClient
  account?: string
}

async function identity(command: string, layers: string[]) {
  try {
    const cwd = process.cwd(),
      home = resolve(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"))
    const hash = createHmac("sha256", secret)
    // Environment keys include account selection, proxy, and provider endpoints.
    // Only this ephemeral digest is retained. No credential contents are opened.
    hash.update(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))))
    hash.update(JSON.stringify([cwd, await realpath(home)]))
    const files = new Set([command, join(home, "auth.json"), join(home, "config.toml"), ...layers])
    for (let dir = cwd; ; dir = dirname(dir)) {
      files.add(join(dir, ".codex", "config.toml"))
      if (dirname(dir) === dir) break
    }
    const records = await Promise.all(
      [...files].sort().map(async (file) => {
        try {
          const s = await stat(file, { bigint: true })
          if (!s.isFile()) throw new Error("Expected a regular file")
          return [file, await realpath(file), s.dev, s.ino, s.size, s.ctimeNs, s.mtimeNs].join("\0")
        } catch (err) {
          if (
            (err as NodeJS.ErrnoException).code !== "ENOENT" ||
            file === command ||
            file === join(home, "auth.json")
          )
            throw err
          return file + "\0missing"
        }
      }),
    )
    return hash.update(JSON.stringify(records)).digest("hex")
  } catch {
    return null
  }
}

export class CodexReadinessConnection {
  private slot?: Lease
  private expiry?: NodeJS.Timeout
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  dispose() {
    this.disposed = true
    clearTimeout(this.expiry)
    const current = this.slot
    this.slot = undefined
    void current?.client?.close().catch(() => {})
  }

  serialize<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  async take(command: string): Promise<Lease> {
    if (this.disposed) throw new Error("Codex readiness is shutting down.")
    clearTimeout(this.expiry)
    const old = this.slot
    this.slot = undefined
    const files = old?.files ?? []
    const key = await identity(command, files)
    if (
      key &&
      old?.identity === key &&
      old.command === command &&
      old.deadline > Date.now() &&
      old.client?.isAlive()
    )
      return old
    await old?.client?.close().catch(() => {})
    return { command, files, identity: key, deadline: Date.now() + lifetimeMs }
  }

  async keep(lease: Lease, client: CodexProtocolClient, account: unknown) {
    if (!lease.identity || lease.deadline <= Date.now() || !client.isAlive() || this.disposed)
      return false
    try {
      const nativeAccount = createHmac("sha256", secret)
        .update(JSON.stringify(account))
        .digest("hex")
      if (lease.account && lease.account !== nativeAccount) return false
      if (!lease.client) {
        const native = (await client.request("config/read", { includeLayers: true })) as {
          config?: { cli_auth_credentials_store?: string }
          layers?: { name?: { type?: string; file?: string }; version?: string }[]
        }
        if (
          native.config?.cli_auth_credentials_store !== "file" ||
          !Array.isArray(native.layers) ||
          native.layers.length > 32
        )
          return false
        const files: string[] = []
        for (const layer of native.layers) {
          const path = layer.name?.file
          if (typeof path !== "string" || !isAbsolute(path)) return false
          files.push(path)
        }
        if (lease.identity !== (await identity(lease.command, lease.files))) return false
        lease.files = files
        lease.identity = await identity(lease.command, files)
      } else if (lease.identity !== (await identity(lease.command, lease.files))) return false
      if (!lease.identity || this.disposed) return false
      lease.account = nativeAccount
      lease.client = client
      this.slot = lease
      this.expiry = setTimeout(
        () => {
          if (this.slot !== lease) return
          this.slot = undefined
          void client.close().catch(() => {})
        },
        Math.max(1, lease.deadline - Date.now()),
      )
      this.expiry.unref()
      return true
    } catch {
      return false
    }
  }
}
