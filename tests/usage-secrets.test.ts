import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
    const missingCredentialStatus =
      process.platform === "darwin" ? 44 : process.platform === "linux" ? 1 : 0
    vi.mocked(spawnSync).mockReturnValue({
      status: missingCredentialStatus,
      stdout: "",
      stderr: "",
    } as never)
  })

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
    else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
    rmSync(temp, { recursive: true, force: true })
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it("refuses to create a plaintext fallback when secure storage is unavailable", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: "", stderr: "" } as never)
    expect(() => setUsageSecret("openrouter.api_key", "must-not-be-plaintext")).toThrow(
      /Secure credential storage is unavailable|macOS login Keychain is locked or denied access|Secret Service|Windows Credential Manager/,
    )
    const path = join(temp, "usage-secrets.json")
    expect(() => readFileSync(path, "utf8")).toThrow()
  })

  it("moves a recognized legacy raw value into the native credential store before using it", () => {
    const path = join(temp, "usage-secrets.json")
    writeFileSync(path, JSON.stringify({ "openrouter.api_key": "plain:legacy-secret" }))
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const joined = (args as string[]).join(" ")
      const isRead =
        joined.includes("find-generic-password") ||
        (args as string[])[0] === "lookup" ||
        (joined.includes("-EncodedCommand") &&
          Buffer.from((args as string[]).at(-1)!, "base64")
            .toString("utf16le")
            .includes("CredRead($target"))
      return {
        status: isRead ? 1 : 0,
        stdout: "",
        stderr: "",
      } as never
    })

    expect(getUsageSecret("openrouter.api_key")).toBe("legacy-secret")
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({})
  })

  it("passes a secure-store secret through stdin instead of process arguments", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "", stderr: "" } as never)
    setUsageSecret("openrouter.api_key", "super-secret-value")
    const [, args, options] = vi.mocked(spawnSync).mock.calls.at(-1)!
    expect(args).not.toContain("super-secret-value")
    if (process.platform === "darwin") {
      expect(options).toMatchObject({
        input: "super-secret-value\nsuper-secret-value\n",
        timeout: 10_000,
      })
    } else if (process.platform === "linux") {
      expect(options).toMatchObject({ input: "super-secret-value" })
    }
  })
})
