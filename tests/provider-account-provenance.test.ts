import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import {
  providerAccountSnapshotFromRow,
  resolveProviderAccountSnapshot,
} from "../src/main/lib/provider-accounts/snapshot"

vi.mock("../src/main/lib/credential-service", () => ({
  getCredentialService: () => ({ status: () => ({ configured: false }) }),
}))

describe("provider account provenance", () => {
  it("migrates existing runs and accounts without changing credential ciphertext", () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
        CREATE TABLE agent_runs (id TEXT, harness TEXT);
        CREATE TABLE anthropic_accounts (id TEXT, oauth_token TEXT);
        CREATE TABLE anthropic_settings (id TEXT, active_account_id TEXT);
        INSERT INTO agent_runs VALUES ('old-run', 'claude-code');
        INSERT INTO anthropic_accounts VALUES ('account-a', 'encrypted-secret');
        INSERT INTO anthropic_settings VALUES ('singleton', 'account-a');
      `)
      db.exec(readFileSync("drizzle/0059_shiny_ogun.sql", "utf8"))
      const historical = db.prepare("SELECT * FROM agent_runs").get() as Record<string, unknown>
      expect(providerAccountSnapshotFromRow(historical)).toMatchObject({
        authMode: "legacy",
        accountId: "legacy-system-default",
      })
      const snapshot = resolveProviderAccountSnapshot(db, "claude-code")
      expect(snapshot).toEqual({
        provider: "anthropic",
        accountId: "account-a",
        authMode: "subscription",
        runtimeTarget: "local",
        credentialRevision: "1",
      })
      const custom = resolveProviderAccountSnapshot(db, "claude-code", () => ({
        status: (id) => ({
          id,
          configured: true,
          persistence: null,
          source: null,
          fingerprint: null,
          updatedAt: 123,
          encryptionBackend: null,
          metadata: { model: "custom-model", baseUrl: "https://example.com" },
        }),
      }))
      expect(custom).toMatchObject({
        accountId: "app-managed:claude.custom-api-token",
        authMode: "api-key",
        credentialRevision: "123",
      })
      db.exec("UPDATE anthropic_accounts SET credential_revision = 2")
      expect(snapshot.credentialRevision).toBe("1")
      expect(resolveProviderAccountSnapshot(db, "claude-code").credentialRevision).toBe("2")
      expect(JSON.stringify(snapshot)).not.toContain("encrypted-secret")
      expect(db.prepare("SELECT oauth_token FROM anthropic_accounts").get()).toEqual({
        oauth_token: "encrypted-secret",
      })
    } finally {
      db.close()
    }
  })

  it("reads pre-migration accounts and fails closed on malformed provenance", () => {
    const db = new Database(":memory:")
    try {
      db.exec(`CREATE TABLE anthropic_accounts (id TEXT);
        CREATE TABLE anthropic_settings (id TEXT, active_account_id TEXT);
        INSERT INTO anthropic_accounts VALUES ('old-account');
        INSERT INTO anthropic_settings VALUES ('singleton', 'old-account');`)
      expect(resolveProviderAccountSnapshot(db, "claude-code")).toMatchObject({
        accountId: "old-account",
        authMode: "subscription",
        credentialRevision: "1",
      })
      expect(() => providerAccountSnapshotFromRow({ provider_auth_mode: "invalid" })).toThrow()
      expect(resolveProviderAccountSnapshot(db, "codex").accountId).toBe("system-default")
      expect(resolveProviderAccountSnapshot(db, "local").authMode).toBe("local")
    } finally {
      db.close()
    }
  })

  it("does not expose a plaintext token RPC to renderers", () => {
    expect(readFileSync("src/main/lib/trpc/routers/claude-code.ts", "utf8")).not.toMatch(
      /(?:getToken|getSystemToken)\s*:/,
    )
    expect(readFileSync("src/main/lib/trpc/routers/anthropic-accounts.ts", "utf8")).not.toMatch(
      /getActiveToken\s*:/,
    )
  })
})
