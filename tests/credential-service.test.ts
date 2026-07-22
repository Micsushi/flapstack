import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CredentialService,
  credentialFingerprint,
  resetCredentialServiceForTests,
  setCredentialServiceForTests,
  secureCredentialFile,
  type CredentialEncryption,
} from "../src/main/lib/credential-service"
import { credentialsRouter } from "../src/main/lib/trpc/routers/credentials"

const encryptedBackend: CredentialEncryption = {
  inspect: () => ({ available: true, backend: "test-keychain" }),
  encrypt: (secret) => Buffer.from(`sealed:${Buffer.from(secret).toString("base64")}`),
  decrypt: (ciphertext) =>
    Buffer.from(ciphertext.toString().slice("sealed:".length), "base64").toString(),
}

describe("main-process credential service", () => {
  const dirs: string[] = []

  afterEach(() => {
    resetCredentialServiceForTests()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-credentials-"))
    dirs.push(dir)
    return dir
  }

  it("persists only verified ciphertext with restrictive permissions", () => {
    const secret = "sk-never-write-this-plaintext"
    const service = new CredentialService({
      storageDir: tempDir(),
      encryption: encryptedBackend,
      now: () => 1234,
    })

    const acknowledgement = service.set("codex.api-key", secret)
    const raw = readFileSync(service.storePath, "utf8")

    expect(acknowledgement).toMatchObject({
      acknowledged: true,
      persistence: "encrypted",
      source: "encrypted-store",
      fingerprint: credentialFingerprint(secret),
    })
    expect(raw).not.toContain(secret)
    expect(raw).not.toContain(Buffer.from(secret).toString("base64"))
    if (process.platform !== "win32") {
      expect(statSync(service.storePath).mode & 0o777).toBe(0o600)
    }
    expect(service.resolve("codex.api-key")).toBe(secret)
    expect(JSON.stringify(service.status("codex.api-key"))).not.toContain(secret)
  })

  it("removes inherited Windows ACLs and grants only the current identity", () => {
    const calls: unknown[][] = []
    secureCredentialFile("C:\\data\\credentials.v1.json", "win32", {
      identity: "WORKGROUP\\sushi",
      runner: (...args: unknown[]) => {
        calls.push(args)
      },
    })
    expect(calls).toEqual([
      [
        "icacls.exe",
        ["C:\\data\\credentials.v1.json", "/inheritance:r", "/grant:r", "WORKGROUP\\sushi:(F)"],
        { stdio: "ignore", windowsHide: true },
      ],
    ])
  })

  it("reports encrypted credential status without decrypting or prompting the OS store", () => {
    let decryptions = 0
    const service = new CredentialService({
      storageDir: tempDir(),
      encryption: {
        ...encryptedBackend,
        decrypt: (ciphertext) => {
          decryptions += 1
          return encryptedBackend.decrypt(ciphertext)
        },
      },
    })
    service.set("codex.api-key", "status-must-be-passive")
    const afterVerifiedWrite = decryptions

    expect(service.status("codex.api-key")).toMatchObject({
      configured: true,
      persistence: "encrypted",
    })
    expect(service.listStatuses().find((status) => status.id === "codex.api-key")).toMatchObject({
      configured: true,
    })
    expect(decryptions).toBe(afterVerifiedWrite)
  })

  it("reports a cached warning after use discovers an undecryptable credential", () => {
    const dir = tempDir()
    new CredentialService({ storageDir: dir, encryption: encryptedBackend }).set(
      "codex.api-key",
      "machine-bound-secret",
    )
    let decryptions = 0
    const migrated = new CredentialService({
      storageDir: dir,
      encryption: {
        ...encryptedBackend,
        decrypt: () => {
          decryptions += 1
          throw new Error("wrong machine")
        },
      },
    })

    expect(migrated.status("codex.api-key").warning).toBeUndefined()
    expect(migrated.resolve("codex.api-key")).toBeNull()
    expect(migrated.status("codex.api-key")).toMatchObject({
      configured: true,
      warning: expect.stringMatching(/could not be decrypted/i),
    })
    expect(decryptions).toBe(1)
  })

  it("uses memory only when OS encryption is unavailable", () => {
    const dir = tempDir()
    const service = new CredentialService({
      storageDir: dir,
      encryption: {
        inspect: () => ({
          available: false,
          backend: "unavailable",
          warning: "Keychain denied; session only",
        }),
        encrypt: () => {
          throw new Error("must not encrypt")
        },
        decrypt: () => {
          throw new Error("must not decrypt")
        },
      },
    })

    const result = service.set("openai.voice-api-key", "sk-session-secret", {
      requirePersistence: true,
    })

    expect(result).toMatchObject({
      acknowledged: false,
      persistence: "session",
      source: "session-memory",
      warning: "Keychain denied; session only",
    })
    expect(service.resolve("openai.voice-api-key")).toBe("sk-session-secret")
    const retirement = readFileSync(service.storePath, "utf8")
    expect(retirement).not.toContain("sk-session-secret")
    expect(retirement).toContain('"openai.voice-api-key"')
  })

  it("rejects session replacement when an unreadable store cannot prove retirement", () => {
    const dir = tempDir()
    const path = join(dir, "credentials.v1.json")
    const damaged = "{not-json-and-must-survive"
    writeFileSync(path, damaged, { mode: 0o600 })
    const service = new CredentialService({ storageDir: dir, encryption: encryptedBackend })

    expect(() => service.set("claude.custom-api-token", "sk-ant-session")).toThrow()
    expect(readFileSync(path, "utf8")).toBe(damaged)
    expect(service.status("codex.api-key").warning).toMatch(/unreadable/)
    expect(service.resolve("codex.api-key")).toBeNull()
    expect(() => service.remove("codex.api-key")).toThrow()
    expect(service.resolve("claude.custom-api-token")).toBeNull()
  })

  it("rejects encryption that cannot round-trip before changing disk", () => {
    const dir = tempDir()
    const service = new CredentialService({
      storageDir: dir,
      encryption: {
        inspect: () => ({ available: true, backend: "broken" }),
        encrypt: () => Buffer.from("ciphertext"),
        decrypt: () => "wrong-value",
      },
    })

    const result = service.set("nanogpt.api-key", "nano-secret", {
      requirePersistence: true,
    })

    expect(result).toMatchObject({ acknowledged: false, persistence: "session" })
    expect(() => readFileSync(service.storePath)).toThrow()
  })

  it("retires the old durable value before Settings accepts session-only replacement", async () => {
    const dir = tempDir()
    const persisted = new CredentialService({ storageDir: dir, encryption: encryptedBackend })
    persisted.set("codex.api-key", "sk-old-durable")

    const unavailable: CredentialEncryption = {
      inspect: () => ({
        available: false,
        backend: "unavailable",
        warning: "Keychain unavailable; session only",
      }),
      encrypt: () => {
        throw new Error("must not encrypt")
      },
      decrypt: encryptedBackend.decrypt,
    }
    const session = new CredentialService({ storageDir: dir, encryption: unavailable })
    setCredentialServiceForTests(session)
    const caller = credentialsRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.set({ id: "codex.api-key", secret: "sk-new-session" }),
    ).resolves.toMatchObject({ persistence: "session", acknowledged: false })
    expect(session.resolve("codex.api-key")).toBe("sk-new-session")

    resetCredentialServiceForTests()
    const restarted = new CredentialService({ storageDir: dir, encryption: encryptedBackend })
    expect(restarted.resolve("codex.api-key")).toBeNull()
    expect(restarted.status("codex.api-key").configured).toBe(false)
  })

  it.each([
    ["codex.api-key", "onboarding:codex-api-key"],
    ["openai.voice-api-key", "agents:openai-api-key"],
    ["claude.custom-api-token", "agents:claude-custom-config"],
  ] as const)(
    "keeps a session replacement tombstone across restart for %s",
    async (id, legacyKey) => {
      const dir = tempDir()
      const unavailable: CredentialEncryption = {
        inspect: () => ({ available: false, backend: "unavailable" }),
        encrypt: () => {
          throw new Error("must not encrypt")
        },
        decrypt: encryptedBackend.decrypt,
      }
      const session = new CredentialService({ storageDir: dir, encryption: unavailable })
      session.set(id, `replacement-${id}`)
      expect(session.isLegacySourceRetired(id)).toBe(true)

      const restarted = new CredentialService({ storageDir: dir, encryption: encryptedBackend })
      setCredentialServiceForTests(restarted)
      const caller = credentialsRouter.createCaller({ getWindow: () => null })
      const stale = `stale-${id}`
      const result = await caller.migrateLegacy({
        id,
        legacyKey,
        secret: stale,
        expectedFingerprint: credentialFingerprint(stale),
      })

      expect(result).toMatchObject({ acknowledged: false, retireSource: true })
      expect(restarted.resolve(id)).toBeNull()
      expect(readFileSync(restarted.storePath, "utf8")).not.toContain(stale)
    },
  )

  it.each([
    ["codex.api-key", "onboarding:codex-api-key"],
    ["openai.voice-api-key", "agents:openai-api-key"],
    ["claude.custom-api-token", "agents:claude-custom-config"],
  ] as const)(
    "does not overwrite an encrypted %s replacement when upgrading a pre-tombstone store",
    async (id, legacyKey) => {
      const dir = tempDir()
      const replacement = `replacement-${id}`
      const beforeRestart = new CredentialService({ storageDir: dir, encryption: encryptedBackend })
      beforeRestart.set(id, replacement)
      const oldStore = JSON.parse(readFileSync(beforeRestart.storePath, "utf8"))
      delete oldStore.retiredLegacySources
      writeFileSync(beforeRestart.storePath, `${JSON.stringify(oldStore)}\n`, { mode: 0o600 })

      const restarted = new CredentialService({ storageDir: dir, encryption: encryptedBackend })
      setCredentialServiceForTests(restarted)
      const caller = credentialsRouter.createCaller({ getWindow: () => null })
      const stale = `stale-${id}`
      const result = await caller.migrateLegacy({
        id,
        legacyKey,
        secret: stale,
        expectedFingerprint: credentialFingerprint(stale),
      })

      expect(result).toMatchObject({ acknowledged: false, retireSource: true })
      expect(restarted.resolve(id)).toBe(replacement)
      expect(restarted.isLegacySourceRetired(id)).toBe(true)
    },
  )

  it("rejects metadata URLs that could leak embedded credentials", () => {
    const service = new CredentialService({ storageDir: tempDir(), encryption: encryptedBackend })
    expect(() =>
      service.set("claude.custom-api-token", "sk-ant-safe", {
        metadata: { baseUrl: "https://user:secret@example.test/v1" },
      }),
    ).toThrow(/unsafe base URL/)
    expect(() => readFileSync(service.storePath)).toThrow()
  })
})
