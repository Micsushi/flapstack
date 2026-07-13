import { mkdtempSync, rmSync } from "node:fs"
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
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}
