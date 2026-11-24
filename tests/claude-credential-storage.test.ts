import { describe, expect, it } from "vitest"
import {
  decryptClaudeCredential,
  encryptClaudeCredential,
  type ClaudeCredentialSafeStorage,
} from "../src/main/lib/claude-credential-storage"

function storage(available = true, backend = "gnome_libsecret"): ClaudeCredentialSafeStorage {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`),
    decryptString: (encrypted) => {
      const value = encrypted.toString()
      if (!value.startsWith("sealed:")) throw new Error("not secure ciphertext")
      return value.slice("sealed:".length)
    },
  }
}

describe("decodePlaintextClaudeToken", () => {
  it("rejects OAuth and custom-token storage on Chromium basic_text", () => {
    const weakStorage = storage(true, "basic_text")
    const legacy = Buffer.from("sk-ant-oat01-legacy").toString("base64")

    expect(() => encryptClaudeCredential("sk-ant-oat01-oauth", weakStorage)).toThrow(
      "credential was not stored",
    )
    expect(() => encryptClaudeCredential("sk-ant-api03-custom", weakStorage)).toThrow(
      "credential was not stored",
    )
    expect(() => decryptClaudeCredential(legacy, weakStorage, () => undefined)).toThrow(
      "reconnect Claude",
    )
  })

  it("decrypts secure ciphertext without rewriting it", () => {
    let migrated = false
    const encrypted = Buffer.from("sealed:sk-ant-oat01-current").toString("base64")
    expect(
      decryptClaudeCredential(encrypted, storage(), () => {
        migrated = true
      }),
    ).toBe("sk-ant-oat01-current")
    expect(migrated).toBe(false)
  })

  it("migrates only a recognized legacy token before returning it", () => {
    const legacy = Buffer.from("sk-ant-oat01-legacy").toString("base64")
    let migrated = ""
    expect(
      decryptClaudeCredential(legacy, storage(), (encrypted) => {
        migrated = encrypted
      }),
    ).toBe("sk-ant-oat01-legacy")
    expect(Buffer.from(migrated, "base64").toString()).toBe("sealed:sk-ant-oat01-legacy")

    expect(() =>
      decryptClaudeCredential(
        Buffer.from("printable-but-ambiguous").toString("base64"),
        storage(),
        () => undefined,
      ),
    ).toThrow("not a recognized legacy plaintext token")
  })

  it("does not expose a legacy token when its durable migration fails", () => {
    const legacy = Buffer.from("sk-ant-oat01-legacy").toString("base64")
    expect(() =>
      decryptClaudeCredential(legacy, storage(), () => {
        throw new Error("database is read only")
      }),
    ).toThrow("database is read only")
  })
})
