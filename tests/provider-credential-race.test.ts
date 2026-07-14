import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const usageSecrets = vi.hoisted(() => ({
  get: vi.fn(() => null as string | null),
  getAsync: vi.fn<() => Promise<string | null>>(),
  set: vi.fn(),
  setAsync: vi.fn(async () => undefined),
}))

vi.mock("../src/main/lib/usage/secrets", async () => {
  const actual = await vi.importActual<typeof import("../src/main/lib/usage/secrets")>(
    "../src/main/lib/usage/secrets",
  )
  return {
    ...actual,
    getUsageSecret: usageSecrets.get,
    getUsageSecretAsync: usageSecrets.getAsync,
    setUsageSecret: usageSecrets.set,
    setUsageSecretAsync: usageSecrets.setAsync,
  }
})

import { resetCredentialServiceForTests } from "../src/main/lib/credential-service"
import {
  clearProviderKey,
  clearProviderKeyAsync,
  getProviderKey,
  getProviderKeyAsync,
  setProviderKey,
  setProviderKeyAsync,
} from "../src/main/lib/harness/opencode-sidecar/credentials"

let directory = ""
let previousNodeEnv: string | undefined

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-provider-race-"))
  process.env.FLAPSTACK_CONFIG_DIR = directory
  previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = "production"
  delete process.env.FLAPSTACK_OPENROUTER_API_KEY
  usageSecrets.get.mockReset().mockReturnValue(null)
  usageSecrets.getAsync.mockReset().mockResolvedValue(null)
  usageSecrets.set.mockReset()
  usageSecrets.setAsync.mockReset().mockResolvedValue(undefined)
  resetCredentialServiceForTests()
})

afterEach(() => {
  resetCredentialServiceForTests()
  delete process.env.FLAPSTACK_CONFIG_DIR
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  rmSync(directory, { recursive: true, force: true })
})

describe("provider credential read-clear ordering", () => {
  it("does not import an async legacy read after synchronous clear", async () => {
    const pending = deferred<string | null>()
    usageSecrets.getAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(null)

    const read = getProviderKeyAsync("openrouter")
    await vi.waitFor(() => expect(usageSecrets.getAsync).toHaveBeenCalledOnce())
    clearProviderKey("openrouter")
    pending.resolve("legacy-secret")

    await expect(read).resolves.toBeNull()
    await expect(getProviderKeyAsync("openrouter")).resolves.toBeNull()
    expect(getProviderKey("openrouter")).toBeNull()
  })

  it("serializes async clear after an in-flight legacy migration", async () => {
    const pending = deferred<string | null>()
    usageSecrets.getAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(null)

    const read = getProviderKeyAsync("openrouter")
    await vi.waitFor(() => expect(usageSecrets.getAsync).toHaveBeenCalledOnce())
    const clear = clearProviderKeyAsync("openrouter")
    pending.resolve("legacy-secret")

    await expect(read).resolves.toBe("legacy-secret")
    await clear
    await expect(getProviderKeyAsync("openrouter")).resolves.toBeNull()
    expect(getProviderKey("openrouter")).toBeNull()
  })

  it("keeps an explicit replacement authoritative over an old async read", async () => {
    const pending = deferred<string | null>()
    usageSecrets.getAsync.mockReturnValueOnce(pending.promise)

    const read = getProviderKeyAsync("openrouter")
    await vi.waitFor(() => expect(usageSecrets.getAsync).toHaveBeenCalledOnce())
    setProviderKey("openrouter", "replacement-secret")
    pending.resolve("legacy-secret")

    await expect(read).resolves.toBe("replacement-secret")
    expect(getProviderKey("openrouter")).toBe("replacement-secret")
  })

  it("durably tombstones legacy file and Keychain sources for a session-only replacement", () => {
    writeFileSync(
      join(directory, "opencode-provider-credentials.json"),
      JSON.stringify({
        openrouter: { value: "legacy-file-secret", encrypted: false },
      }),
      { mode: 0o600 },
    )
    usageSecrets.get.mockReturnValue("legacy-keychain-secret")

    setProviderKey("openrouter", "session-replacement")
    expect(usageSecrets.set).toHaveBeenCalledWith("opencode.openrouter.api_key", null)
    resetCredentialServiceForTests()

    expect(getProviderKey("openrouter")).toBeNull()
    expect(usageSecrets.get).not.toHaveBeenCalled()
  })

  it("makes a newer synchronous clear win over an in-flight async set", async () => {
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)

    const olderSet = setProviderKeyAsync("openrouter", "older-async-secret")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    clearProviderKey("openrouter")
    pending.resolve()
    await olderSet

    expect(getProviderKey("openrouter")).toBeNull()
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual(["openrouter.api_key", null])
  })

  it("makes a newer synchronous set win over an in-flight async clear", async () => {
    setProviderKey("openrouter", "initial-secret")
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)

    const olderClear = clearProviderKeyAsync("openrouter")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    setProviderKey("openrouter", "newer-sync-secret")
    pending.resolve()
    await olderClear

    expect(getProviderKey("openrouter")).toBe("newer-sync-secret")
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual([
      "openrouter.api_key",
      "newer-sync-secret",
    ])
  })

  it("skips a queued async mutation superseded by a synchronous mutation", async () => {
    const pendingRead = deferred<string | null>()
    usageSecrets.getAsync.mockReturnValueOnce(pendingRead.promise)
    const read = getProviderKeyAsync("openrouter")
    await vi.waitFor(() => expect(usageSecrets.getAsync).toHaveBeenCalledOnce())

    const queuedSet = setProviderKeyAsync("openrouter", "queued-secret")
    setProviderKey("openrouter", "latest-secret")
    pendingRead.resolve(null)

    await read
    await queuedSet
    expect(getProviderKey("openrouter")).toBe("latest-secret")
  })

  it("rolls desired state back when a newer synchronous clear fails", async () => {
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const olderSet = setProviderKeyAsync("openrouter", "accepted-async-secret")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    writeFileSync(join(directory, "opencode-provider-credentials.json"), "{broken-json", {
      mode: 0o600,
    })

    expect(() => clearProviderKey("openrouter")).toThrow(/Could not clear the legacy openrouter/)
    pending.resolve()
    await olderSet

    expect(getProviderKey("openrouter")).toBe("accepted-async-secret")
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual([
      "openrouter.api_key",
      "accepted-async-secret",
    ])
  })

  it("does not accept a replacement when its durable tombstone cannot be written", async () => {
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const olderSet = setProviderKeyAsync("openrouter", "accepted-before-set-failure")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    const settings = join(directory, "opencode-provider-settings.json")
    rmSync(settings, { force: true })
    mkdirSync(settings)

    expect(() => setProviderKey("openrouter", "rejected-replacement")).toThrow()
    pending.resolve()
    await olderSet

    expect(getProviderKey("openrouter")).toBe("accepted-before-set-failure")
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual([
      "openrouter.api_key",
      "accepted-before-set-failure",
    ])
  })

  it("rolls desired state and daemon state back when a newer async clear fails", async () => {
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const olderSet = setProviderKeyAsync("openrouter", "accepted-before-async-failure")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    writeFileSync(join(directory, "opencode-provider-credentials.json"), "{broken-json", {
      mode: 0o600,
    })
    const failingClear = clearProviderKeyAsync("openrouter")

    pending.resolve()
    await olderSet
    await expect(failingClear).rejects.toThrow(/Could not clear the legacy openrouter/)

    expect(getProviderKey("openrouter")).toBe("accepted-before-async-failure")
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual([
      "openrouter.api_key",
      "accepted-before-async-failure",
    ])
  })

  it("gives the last async set precedence over an in-flight async set", async () => {
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const first = setProviderKeyAsync("openrouter", "first-async-secret")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    const second = setProviderKeyAsync("openrouter", "second-async-secret")

    pending.resolve()
    await Promise.all([first, second])

    expect(getProviderKey("openrouter")).toBe("second-async-secret")
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual([
      "openrouter.api_key",
      "second-async-secret",
    ])
  })

  it("gives the last async clear precedence over an in-flight async set", async () => {
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const first = setProviderKeyAsync("openrouter", "cleared-async-secret")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    const second = clearProviderKeyAsync("openrouter")

    pending.resolve()
    await Promise.all([first, second])

    expect(getProviderKey("openrouter")).toBeNull()
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual(["openrouter.api_key", null])
  })

  it("gives the last async set precedence over an in-flight async clear", async () => {
    setProviderKey("openrouter", "initial-before-async-clear")
    const pending = deferred<void>()
    usageSecrets.setAsync.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const first = clearProviderKeyAsync("openrouter")
    await vi.waitFor(() => expect(usageSecrets.setAsync).toHaveBeenCalledOnce())
    const second = setProviderKeyAsync("openrouter", "set-after-async-clear")

    pending.resolve()
    await Promise.all([first, second])

    expect(getProviderKey("openrouter")).toBe("set-after-async-clear")
    expect(usageSecrets.setAsync.mock.calls.at(-1)).toEqual([
      "openrouter.api_key",
      "set-after-async-clear",
    ])
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}
