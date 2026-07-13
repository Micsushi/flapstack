import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CredentialService,
  credentialFingerprint,
  type CredentialEncryption,
} from "../src/main/lib/credential-service"

const encryptedBackend: CredentialEncryption = {
  inspect: () => ({ available: true, backend: "test-keychain" }),
  encrypt: (secret) => Buffer.from(`sealed:${Buffer.from(secret).toString("base64")}`),
  decrypt: (ciphertext) =>
    Buffer.from(ciphertext.toString().slice("sealed:".length), "base64").toString(),
}

describe("main-process credential service", () => {
  const dirs: string[] = []

  afterEach(() => {
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
      fingerprint: credentialFingerprint(secret),
    })
    expect(raw).not.toContain(secret)
    expect(raw).not.toContain(Buffer.from(secret).toString("base64"))
    expect(statSync(service.storePath).mode & 0o777).toBe(0o600)
    expect(service.resolve("codex.api-key")).toBe(secret)
    expect(JSON.stringify(service.status("codex.api-key"))).not.toContain(secret)
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
      warning: "Keychain denied; session only",
    })
    expect(service.resolve("openai.voice-api-key")).toBe("sk-session-secret")
    expect(() => readFileSync(service.storePath)).toThrow()
  })

  it("does not overwrite an unreadable store", () => {
    const dir = tempDir()
    const path = join(dir, "credentials.v1.json")
    const damaged = "{not-json-and-must-survive"
    writeFileSync(path, damaged, { mode: 0o600 })
    const service = new CredentialService({ storageDir: dir, encryption: encryptedBackend })

    const result = service.set("claude.custom-api-token", "sk-ant-session")

    expect(result.persistence).toBe("session")
    expect(result.acknowledged).toBe(false)
    expect(readFileSync(path, "utf8")).toBe(damaged)
    expect(service.status("codex.api-key").warning).toMatch(/unreadable/)
    expect(service.resolve("codex.api-key")).toBeNull()
    expect(() => service.remove("codex.api-key")).toThrow()
    expect(service.resolve("claude.custom-api-token")).toBe("sk-ant-session")
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
