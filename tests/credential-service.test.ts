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
})
