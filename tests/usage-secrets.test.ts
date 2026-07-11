import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }))

import { getUsageSecret, setUsageSecret } from "../src/main/lib/usage/secrets"

describe("usage credential hardening", () => {
  let temp: string
  let previousConfigDir: string | undefined

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), "flapstack-usage-secrets-"))
    previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
    process.env.FLAPSTACK_CONFIG_DIR = temp
    vi.mocked(spawnSync).mockReturnValue({ status: 44, stdout: "", stderr: "" } as never)
  })

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
    else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
    rmSync(temp, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it("clears stale fallback values and repairs the secrets file to mode 0600", () => {
    const path = join(temp, "usage-secrets.json")
    writeFileSync(path, JSON.stringify({ "openrouter.api_key": "plain:stale-value" }), {
      mode: 0o644,
    })

    setUsageSecret("openrouter.api_key", null)

    expect(getUsageSecret("openrouter.api_key")).toBeNull()
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({})
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it("refuses to create a plaintext fallback when secure storage is unavailable", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: "", stderr: "" } as never)
    expect(() => setUsageSecret("openrouter.api_key", "must-not-be-plaintext")).toThrow(
      /Secure credential storage is unavailable|Unable to store the usage credential in macOS Keychain/,
    )
    const path = join(temp, "usage-secrets.json")
    expect(() => readFileSync(path, "utf8")).toThrow()
  })

  it("passes a Keychain secret through stdin instead of process arguments", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "", stderr: "" } as never)
    setUsageSecret("openrouter.api_key", "super-secret-value")
    const [, args, options] = vi.mocked(spawnSync).mock.calls.at(-1)!
    expect(args).not.toContain("super-secret-value")
    expect(options).toMatchObject({ input: "super-secret-value\n" })
  })
})
