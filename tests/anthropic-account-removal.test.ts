import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { anthropicAccountsRouter } from "../src/main/lib/trpc/routers/anthropic-accounts"

const state = vi.hoisted(() => ({ db: null as unknown, clearCaches: vi.fn() }))
vi.mock("../src/main/lib/db", async () => ({
  ...(await import("../src/main/lib/db/schema")),
  getDatabase: () => state.db,
}))
vi.mock("../src/main/index", () => ({ getAuthManager: vi.fn() }))
vi.mock("../src/main/lib/trpc/routers/claude", () => ({
  clearClaudeCaches: state.clearCaches,
}))
vi.mock("../src/main/lib/trpc/index", async () => {
  const { initTRPC } = await import("@trpc/server")
  const t = initTRPC.create()
  return { router: t.router, publicProcedure: t.procedure }
})
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    decryptString: (value: Buffer) => {
      if (value.toString() === "corrupt") throw new Error("corrupt ciphertext")
      return "sk-ant-oat01-test"
    },
  },
}))

describe("Anthropic account removal", () => {
  let sqlite: Database.Database
  const caller = () => anthropicAccountsRouter.createCaller({ getWindow: () => null })
  const token = (id: string) => Buffer.from(`sealed:${id}`).toString("base64")
  const active = () => sqlite.prepare("SELECT active_account_id FROM anthropic_settings").get()
  const credential = () => sqlite.prepare("SELECT oauth_token FROM claude_code_credentials").get()

  beforeEach(() => {
    sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE anthropic_accounts (
        id TEXT PRIMARY KEY, email TEXT, display_name TEXT, oauth_token TEXT NOT NULL,
        auth_mode TEXT NOT NULL DEFAULT 'subscription', runtime_target TEXT NOT NULL DEFAULT 'local',
        credential_revision INTEGER NOT NULL DEFAULT 1, connected_at INTEGER,
        last_used_at INTEGER, desktop_user_id TEXT
      );
      CREATE TABLE anthropic_settings (id TEXT PRIMARY KEY, active_account_id TEXT, updated_at INTEGER);
      CREATE TABLE claude_code_credentials (id TEXT PRIMARY KEY, oauth_token TEXT NOT NULL, connected_at INTEGER, user_id TEXT);
      INSERT INTO anthropic_settings VALUES ('singleton', 'a', 1);
    `)
    const db = drizzle(sqlite, { schema })
    state.db = db
    db.insert(schema.anthropicAccounts)
      .values([
        { id: "a", oauthToken: token("a") },
        { id: "b", oauthToken: token("b") },
      ])
      .run()
    db.insert(schema.claudeCodeCredentials)
      .values({ id: "default", oauthToken: token("a") })
      .run()
    state.clearCaches.mockClear()
  })

  afterEach(() => sqlite.close())

  it("switches both selection and launch credentials, then clears SDK caches", async () => {
    expect(await caller().remove({ accountId: "a" })).toEqual({ success: true })
    expect(active()).toEqual({ active_account_id: "b" })
    expect(credential()).toEqual({ oauth_token: token("b") })
    expect(state.clearCaches).toHaveBeenCalledOnce()
  })

  it("clears the launch credential when the last managed account is removed", async () => {
    await caller().remove({ accountId: "b" })
    expect(state.clearCaches).not.toHaveBeenCalled()
    expect(credential()).toEqual({ oauth_token: token("a") })
    await caller().remove({ accountId: "a" })
    expect(active()).toEqual({ active_account_id: null })
    expect(credential()).toBeUndefined()
    expect(state.clearCaches).toHaveBeenCalledOnce()
  })

  it("rolls back removal and selection if the replacement credential is corrupt", async () => {
    sqlite
      .prepare("UPDATE anthropic_accounts SET oauth_token = ? WHERE id = 'b'")
      .run(Buffer.from("corrupt").toString("base64"))
    await expect(caller().remove({ accountId: "a" })).rejects.toThrow()
    expect(active()).toEqual({ active_account_id: "a" })
    expect(credential()).toEqual({ oauth_token: token("a") })
    expect(sqlite.prepare("SELECT id FROM anthropic_accounts WHERE id = 'a'").get()).toEqual({
      id: "a",
    })
    expect(state.clearCaches).not.toHaveBeenCalled()
  })

  it("rolls back the credential replacement if updating selection fails", async () => {
    sqlite.exec(`CREATE TRIGGER reject_selection BEFORE UPDATE ON anthropic_settings
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`)
    await expect(caller().remove({ accountId: "a" })).rejects.toThrow("simulated write failure")
    expect(active()).toEqual({ active_account_id: "a" })
    expect(credential()).toEqual({ oauth_token: token("a") })
    expect(sqlite.prepare("SELECT id FROM anthropic_accounts WHERE id = 'a'").get()).toEqual({
      id: "a",
    })
    expect(state.clearCaches).not.toHaveBeenCalled()
  })
})
