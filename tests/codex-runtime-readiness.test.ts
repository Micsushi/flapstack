import { mkdtemp, writeFile, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { CodexReadinessConnection } from "../src/main/lib/agent-runtime/codex/readiness"
import type { CodexProtocolClient } from "../src/main/lib/agent-runtime/codex/protocol-client"

describe("Codex authenticated readiness connection", () => {
  it("revalidates the fixed binary, file credential context, configuration, environment, native account, and bounded lifetime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-readiness-")),
      binary = join(dir, "codex-test"),
      auth = join(dir, "auth.json"),
      config = join(dir, "config.toml")
    const cache = new CodexReadinessConnection(),
      close = vi.fn(async () => {}),
      account = { type: "chatgpt", email: "fixture@example.invalid" }
    let store = "file"
    const client = {
      isAlive: () => true,
      close,
      request: vi.fn(async () => ({
        config: { cli_auth_credentials_store: store },
        layers: [{ name: { type: "user", file: config } }],
      })),
    } as unknown as CodexProtocolClient
    const activate = async () => {
      const lease = await cache.take(binary)
      expect(lease.client).toBeUndefined()
      expect(await cache.keep(lease, client, account)).toBe(true)
    }
    try {
      vi.stubEnv("CODEX_HOME", dir)
      await Promise.all([
        writeFile(auth, "synthetic-one"),
        writeFile(binary, "pinned"),
        writeFile(config, ""),
      ])
      await activate()
      const same = await cache.take(binary)
      expect(same.client).toBe(client)
      expect(await cache.keep(same, client, account)).toBe(true)
      await writeFile(join(dir, "new-auth"), "synthetic-two")
      await rename(join(dir, "new-auth"), auth)
      await activate()
      vi.stubEnv("OPENAI_BASE_URL", "https://example.invalid")
      await activate()
      await writeFile(config, "changed")
      await activate()
      await writeFile(binary, "replacement")
      await activate()
      const differentAccount = await cache.take(binary)
      expect(await cache.keep(differentAccount, client, { type: "apiKey" })).toBe(false)
      store = "keyring"
      expect(await cache.keep(await cache.take(binary), client, account)).toBe(false)
      store = "file"
      await activate()
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(Date.now() + 31_000)
      await activate()
      await rm(auth)
      const signedOut = await cache.take(binary)
      expect(signedOut.client).toBeUndefined()
      expect(await cache.keep(signedOut, client, account)).toBe(false)
      expect(close).toHaveBeenCalled()
    } finally {
      cache.dispose()
      vi.useRealTimers()
      vi.unstubAllEnvs()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
