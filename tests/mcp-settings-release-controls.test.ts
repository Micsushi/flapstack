import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { closeDatabase } from "../src/main/lib/db"
import {
  CredentialService,
  resetCredentialServiceForTests,
  setCredentialServiceForTests,
  type CredentialEncryption,
} from "../src/main/lib/credential-service"
import {
  getCredentialStatus,
  getPermissionState,
  listRegisteredProviderExtensions,
  migrateLegacyCredential,
  mutateRegisteredProjectProviderExtension,
  previewPermission,
  removeCredential,
  resolveTestChatSelection,
  setChatPermission,
  setOrReplaceCredential,
} from "../src/main/lib/mcp-test-control/settings-release-controls"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-mcp-settings-release", isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
}))

const directories: string[] = []
const encryptedBackend: CredentialEncryption = {
  inspect: () => ({ available: true, backend: "test-keychain" }),
  encrypt: (secret) => Buffer.from(`sealed:${Buffer.from(secret).toString("base64")}`),
  decrypt: (ciphertext) =>
    Buffer.from(ciphertext.toString().slice("sealed:".length), "base64").toString(),
}
const exactCustom = {
  schemaVersion: 1 as const,
  projectWrite: true,
  shell: false,
  network: true,
  git: false,
  browser: true,
  secrets: false,
  subagents: true,
  thirdPartyMcp: false,
  productMcpRead: true,
  productMcpWrite: false,
  productMcpTier3: false,
}

beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-release-controls-"))
  directories.push(directory)
  const databasePath = join(directory, "agents.db")
  const projectPath = join(directory, "project")
  mkdirSync(projectPath)
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-1", "Project", projectPath)
  const projectIdentity = statSync(projectPath, { bigint: true })
  sqlite
    .prepare(
      `INSERT INTO filesystem_root_registrations
        (path, canonical_path, device_id, inode_id, bound_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      projectPath,
      realpathSync(projectPath),
      projectIdentity.dev.toString(),
      projectIdentity.ino.toString(),
      Date.now(),
    )
  sqlite
    .prepare(
      `INSERT INTO chats
        (id, name, scope, project_id, permission_mode, custom_permissions, worktree_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "chat-1",
      "Chat",
      "project",
      "project-1",
      "custom",
      JSON.stringify(exactCustom),
      projectPath,
    )
  sqlite
    .prepare(
      `INSERT INTO sub_chats
        (id, chat_id, name, mode, messages, worktree_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("sub-chat-1", "chat-1", "Sub-chat", "agent", "[]", projectPath)
  sqlite.close()
  process.env.FLAPSTACK_DB_PATH = databasePath
  process.env.FLAPSTACK_CONFIG_DIR = directory
  setCredentialServiceForTests(
    new CredentialService({
      storageDir: join(directory, "credentials"),
      encryption: encryptedBackend,
    }),
  )
})

afterEach(() => {
  closeDatabase()
  resetCredentialServiceForTests()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_CONFIG_DIR
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("credential dev MCP DTOs", () => {
  it("sets, replaces, lists, migrates, and removes without returning plaintext", async () => {
    const secret = "sk-dev-mcp-must-never-return"
    const created = await setOrReplaceCredential({ id: "codex.api-key", secret })
    const replaced = await setOrReplaceCredential({ id: "codex.api-key", secret: `${secret}-new` })
    const statuses = await getCredentialStatus({ id: "codex.api-key" })
    const mismatch = await migrateLegacyCredential({
      id: "openai.voice-api-key",
      legacyKey: "agents:openai-api-key",
      secret,
      expectedFingerprint: "000000000000",
    })
    const removed = await removeCredential({ id: "codex.api-key" })
    const serialized = JSON.stringify({ created, replaced, statuses, mismatch, removed })

    expect(created).toMatchObject({ operation: "created", status: { configured: true } })
    expect(replaced).toMatchObject({ operation: "replaced", status: { configured: true } })
    expect(mismatch.status).toMatchObject({ acknowledged: false, configured: false })
    expect(removed.status).toMatchObject({ configured: false })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(`${secret}-new`)
  })
})

describe("provider extension project boundaries", () => {
  it("resolves project scope by ID, omits content, and rejects unknown IDs", async () => {
    const created = await mutateRegisteredProjectProviderExtension({
      operation: "create",
      provider: "codex",
      kind: "skill",
      projectId: "project-1",
      name: "release-proof",
      description: "Release proof",
      content: "private extension body",
    })
    const listed = await listRegisteredProviderExtensions({ projectId: "project-1" })

    expect(created.projectId).toBe("project-1")
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "release-proof", source: "project" }),
      ]),
    )
    expect(JSON.stringify(listed)).not.toContain("private extension body")
    await expect(
      listRegisteredProviderExtensions({ projectId: "missing-project" }),
    ).rejects.toThrow("Project not found")
  })
})

describe("permission dev MCP production routing", () => {
  it("returns exact stored custom state, mutates it, and previews the same toggles", async () => {
    expect(await getPermissionState({ chatId: "chat-1" })).toMatchObject({
      chat: { mode: "custom", customPermissions: exactCustom },
    })
    const updated = { ...exactCustom, shell: true, network: false }
    await setChatPermission({
      chatId: "chat-1",
      mode: "custom",
      scope: "current-chat",
      customPermissions: updated,
    })
    const preview = await previewPermission({
      chatId: "chat-1",
      harness: "openrouter",
      mode: "custom",
    })

    expect((await getPermissionState({ chatId: "chat-1" })).chat?.customPermissions).toEqual(
      updated,
    )
    expect(preview).toMatchObject({
      requested: "custom",
      warnings: [
        "Provider permission rules: unknown=deny, edit=allow, bash=deny, webfetch=deny.",
        expect.any(String),
      ],
    })
  })

  it("rejects custom mutation and preview without explicit or stored capabilities", async () => {
    await expect(
      setChatPermission({ chatId: "chat-1", mode: "custom", scope: "current-chat" }),
    ).rejects.toThrow("requires explicit capability toggles")
    await setChatPermission({
      chatId: "chat-1",
      mode: "ask-before-edits",
      scope: "current-chat",
    })
    await expect(
      previewPermission({ chatId: "chat-1", harness: "codex", mode: "custom" }),
    ).rejects.toThrow("requires explicit or stored capability toggles")
  })
})

describe("test chat renderer selection boundary", () => {
  it("resolves only an exact active chat and owned sub-chat", () => {
    expect(resolveTestChatSelection({ chatId: "chat-1", subChatId: "sub-chat-1" })).toEqual({
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      project: expect.objectContaining({ id: "project-1", name: "Project" }),
    })
    expect(() => resolveTestChatSelection({ chatId: "chat-1", subChatId: "missing" })).toThrow(
      "does not belong",
    )
    expect(() => resolveTestChatSelection({ chatId: "missing", subChatId: "sub-chat-1" })).toThrow(
      "Active test chat not found",
    )
  })
})
