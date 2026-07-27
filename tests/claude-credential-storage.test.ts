import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  decodePlaintextClaudeToken,
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
  it("decodes a plaintext token stored as base64", () => {
    expect(decodePlaintextClaudeToken(Buffer.from("sk-ant-oat01-example").toString("base64"))).toBe(
      "sk-ant-oat01-example",
    )
  })

  it("rejects Chromium encrypted blobs when secure storage is unavailable", () => {
    const encrypted = Buffer.concat([Buffer.from("v10"), Buffer.from([0, 4, 24, 31])])
    expect(() => decodePlaintextClaudeToken(encrypted.toString("base64"))).toThrow(
      "encrypted but secure storage is unavailable",
    )
  })

  it("rejects other binary credential data", () => {
    expect(() => decodePlaintextClaudeToken(Buffer.from([65, 0, 66]).toString("base64"))).toThrow(
      "not a recognized legacy plaintext token",
    )
  })

  it("rejects reversible writes and all reads while secure storage is unavailable", () => {
    const legacy = Buffer.from("sk-ant-oat01-legacy").toString("base64")
    expect(() => encryptClaudeCredential("sk-ant-oat01-new", storage(false))).toThrow(
      "credential was not stored",
    )
    expect(() => decryptClaudeCredential(legacy, storage(false), () => undefined)).toThrow(
      "reconnect Claude",
    )
  })

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

  it.each(["plaintext", "unknown", "future_backend"])(
    "fails closed for weak or unrecognized backend %s",
    (backend) => {
      expect(() => encryptClaudeCredential("sk-ant-oat01-new", storage(true, backend))).toThrow(
        "credential was not stored",
      )
    },
  )

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

describe("Claude router credential codec integration", () => {
  const routerSources = [
    "src/main/lib/trpc/routers/claude-code.ts",
    "src/main/lib/trpc/routers/anthropic-accounts.ts",
    "src/main/lib/trpc/routers/claude.ts",
  ].map((path) => [path, readFileSync(resolve(path), "utf8")] as const)

  it.each(routerSources)(
    "%s uses the fail-closed shared reader and durable migration",
    (_, source) => {
      expect(source).toContain("decryptClaudeCredential")
      expect(source).not.toContain("decodePlaintextClaudeToken")
      expect(source).toMatch(/decryptToken\([^]*?db\.update\(/)
    },
  )

  it("uses the fail-closed shared writer in both credential-writing routers", () => {
    for (const path of [
      "src/main/lib/trpc/routers/claude-code.ts",
      "src/main/lib/trpc/routers/anthropic-accounts.ts",
    ]) {
      const source = readFileSync(resolve(path), "utf8")
      expect(source).toContain("encryptClaudeCredential")
      expect(source).not.toContain("storing as base64")
    }
  })
})
