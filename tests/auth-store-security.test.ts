import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  available: false,
  backend: "dpapi",
  encryptString: vi.fn((value: string) =>
    Buffer.from(Buffer.from(value).toString("base64url"), "utf8"),
  ),
  decryptString: vi.fn((value: Buffer) =>
    Buffer.from(value.toString("utf8"), "base64url").toString("utf8"),
  ),
}))

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => mocks.available,
    getSelectedStorageBackend: () => mocks.backend,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString,
  },
}))

import { AuthStore, type AuthData } from "../src/main/auth-store"

const authData: AuthData = {
  token: "access-secret",
  refreshToken: "refresh-secret",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "user@example.com",
    name: "User",
    imageUrl: null,
    username: "user",
  },
}
const directories: string[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-auth-store-"))
  directories.push(directory)
  return directory
}

describe("desktop auth storage security", () => {
  beforeEach(() => {
    mocks.available = false
    mocks.backend = "dpapi"
    mocks.encryptString.mockClear()
    mocks.decryptString.mockClear()
  })
  afterEach(() => {
    while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
  })

  it("fails closed instead of persisting plaintext when OS encryption is unavailable", () => {
    const directory = temporaryDirectory()
    const store = new AuthStore(directory)

    expect(() => store.save(authData)).toThrow(/secure.*encryption.*unavailable/i)
    expect(existsSync(join(directory, "auth.dat"))).toBe(false)
    expect(existsSync(join(directory, "auth.dat.json"))).toBe(false)
  })

  it("fails closed when encryption reports Chromium basic_text", () => {
    const directory = temporaryDirectory()
    const store = new AuthStore(directory)
    mocks.available = true
    mocks.backend = "basic_text"

    expect(() => store.save(authData)).toThrow(/secure.*encryption.*unavailable/i)
    expect(store.load()).toBeNull()
    expect(mocks.encryptString).not.toHaveBeenCalled()
    expect(mocks.decryptString).not.toHaveBeenCalled()
    expect(existsSync(join(directory, "auth.dat"))).toBe(false)
  })

  it("does not consume a legacy plaintext token until it can migrate it to encryption", () => {
    const directory = temporaryDirectory()
    const fallback = join(directory, "auth.dat.json")
    writeFileSync(fallback, JSON.stringify(authData))
    const store = new AuthStore(directory)

    expect(store.load()).toBeNull()
    expect(readFileSync(fallback, "utf8")).toContain("access-secret")

    mocks.available = true
    expect(store.load()).toEqual(authData)
    expect(existsSync(fallback)).toBe(false)
    expect(readFileSync(join(directory, "auth.dat"), "utf8")).not.toContain("access-secret")
  })

  it.each(["auth.dat.json", "auth.json"])(
    "retries failed %s cleanup before returning encrypted credentials",
    (legacyFileName) => {
      const directory = temporaryDirectory()
      const legacyPath = join(directory, legacyFileName)
      writeFileSync(legacyPath, JSON.stringify(authData))
      mocks.available = true

      class RetryCleanupAuthStore extends AuthStore {
        cleanupAttempts = 0

        protected override removeCredentialFile(credentialPath: string): void {
          if (credentialPath === legacyPath) {
            this.cleanupAttempts += 1
            if (this.cleanupAttempts === 1) {
              throw Object.assign(new Error("file is locked"), { code: "EPERM" })
            }
          }
          super.removeCredentialFile(credentialPath)
        }
      }

      const store = new RetryCleanupAuthStore(directory)
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

      expect(store.load()).toBeNull()
      expect(errorLog).toHaveBeenCalledWith(
        "Failed to load auth data:",
        expect.objectContaining({
          message:
            "Encrypted authentication data is available, but legacy plaintext cleanup failed",
        }),
      )
      expect(existsSync(join(directory, "auth.dat"))).toBe(true)
      expect(existsSync(legacyPath)).toBe(true)

      expect(store.load()).toEqual(authData)
      expect(store.cleanupAttempts).toBe(2)
      expect(existsSync(legacyPath)).toBe(false)
      errorLog.mockRestore()
    },
  )

  it("attempts every credential deletion and reports a partial logout failure", () => {
    const directory = temporaryDirectory()
    const encrypted = join(directory, "auth.dat")
    const fallback = join(directory, "auth.dat.json")
    const legacy = join(directory, "auth.json")
    writeFileSync(encrypted, "encrypted")
    writeFileSync(fallback, JSON.stringify(authData))
    writeFileSync(legacy, JSON.stringify(authData))

    class PartiallyFailingAuthStore extends AuthStore {
      protected override removeCredentialFile(credentialPath: string): void {
        if (credentialPath === encrypted) {
          throw Object.assign(new Error("file is locked"), { code: "EPERM" })
        }
        super.removeCredentialFile(credentialPath)
      }
    }

    const store = new PartiallyFailingAuthStore(directory)
    expect(() => store.clear()).toThrow(/failed to clear all/i)
    expect(existsSync(encrypted)).toBe(true)
    expect(existsSync(fallback)).toBe(false)
    expect(existsSync(legacy)).toBe(false)
  })
})
