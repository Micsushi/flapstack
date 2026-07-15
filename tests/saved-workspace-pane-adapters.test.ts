import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-saved-workspace-pane-test", isPackaged: false },
}))

import { closeDatabase } from "../src/main/lib/db"
import { bindRegisteredFilesystemRoot } from "../src/main/lib/git/security/path-validation"
import { resolveSavedWorkspacePane } from "../src/main/lib/saved-workspaces/pane-adapters"
import {
  SAVED_WORKSPACE_LAYOUT_VERSION,
  savedWorkspacePaneBindingSchema,
  type SavedWorkspaceLayout,
} from "../src/shared/saved-workspaces"

let container = ""
let root = ""
let databasePath = ""

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-workspace-panes-"))
  root = join(container, "worktree")
  databasePath = join(container, "agents.db")
  mkdirSync(root)
  mkdirSync(join(root, "nested"))
  writeFileSync(join(root, "ready.ts"), "export const ready = true\n")

  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS saved_workspaces (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      scope_type text NOT NULL,
      project_id text,
      task_id text,
      owner_kind text NOT NULL,
      orchestration_id text,
      layout_version integer NOT NULL,
      layout_json text NOT NULL,
      sort_order text NOT NULL,
      version integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      archived_at integer
    );
  `)
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-1", "Project", root)
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, project_id, scope, permission_mode, worktree_path) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("chat-1", "Current chat", "project-1", "project", "full-access", root)
  sqlite
    .prepare("INSERT INTO sub_chats (id, chat_id, permission_mode, messages) VALUES (?, ?, ?, ?)")
    .run(
      "sub-1",
      "chat-1",
      "full-access",
      JSON.stringify([{ id: "message-1", role: "user", parts: [{ type: "text", text: "hello" }] }]),
    )
  sqlite.close()

  process.env.FLAPSTACK_DB_PATH = databasePath
  bindRegisteredFilesystemRoot(root)
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(container, { recursive: true, force: true })
})

describe("saved workspace pane adapters", () => {
  it("restores chat, terminal metadata, file, diff, browser, and pinned context", () => {
    insertWorkspace(
      layout([
        pane("chat-pane", { type: "chat", chatId: "chat-1" }, [
          { id: "message-context", type: "chat-message", chatId: "chat-1", messageId: "message-1" },
        ]),
        pane("terminal-pane", {
          type: "terminal",
          cwd: "nested",
          worktreePath: root,
          restorePolicy: "prompt",
        }),
        pane("file-pane", { type: "file", path: "ready.ts", worktreePath: root, line: 1 }),
        pane("diff-pane", { type: "diff", worktreePath: root, baseRef: null, targetRef: null }),
        pane("browser-pane", { type: "browser", url: "https://example.com/docs" }),
      ]),
    )

    expect(resolveSavedWorkspacePane(databasePath, "workspace-1", "chat-pane")).toMatchObject({
      state: "ready",
      label: "Current chat",
      pinnedContext: [{ id: "message-context", state: "ready" }],
    })
    expect(resolveSavedWorkspacePane(databasePath, "workspace-1", "terminal-pane")).toMatchObject({
      state: "ready",
      requiresExplicitTerminalStart: true,
      terminalCwd: realpathSync(join(root, "nested")),
    })
    for (const paneId of ["file-pane", "diff-pane", "browser-pane"]) {
      expect(resolveSavedWorkspacePane(databasePath, "workspace-1", paneId).state).toBe("ready")
    }
  })

  it("keeps valid siblings ready when a file or worktree target disappears", () => {
    insertWorkspace(
      layout([
        pane("chat-pane", { type: "chat", chatId: "chat-1" }),
        pane("file-pane", { type: "file", path: "moved.ts", worktreePath: root, line: null }),
      ]),
    )

    expect(resolveSavedWorkspacePane(databasePath, "workspace-1", "file-pane").state).toBe(
      "missing",
    )
    expect(resolveSavedWorkspacePane(databasePath, "workspace-1", "chat-pane").state).toBe("ready")

    renameSync(root, `${root}-removed`)
    expect(resolveSavedWorkspacePane(databasePath, "workspace-1", "file-pane")).toMatchObject({
      state: "missing",
      message: expect.stringMatching(/worktree was removed/i),
    })
  })

  it("fails closed for replaced identity, traversal, unsafe URLs, and removed messages", () => {
    insertWorkspace(
      layout([
        pane("file-pane", { type: "file", path: "../secret", worktreePath: root, line: null }, [
          {
            id: "stale-message",
            type: "chat-message",
            chatId: "chat-1",
            messageId: "removed-message",
          },
        ]),
      ]),
    )

    expect(resolveSavedWorkspacePane(databasePath, "workspace-1", "file-pane")).toMatchObject({
      state: "stale",
      pinnedContext: [{ id: "stale-message", state: "stale" }],
    })
    expect(() =>
      savedWorkspacePaneBindingSchema.parse({ type: "browser", url: "javascript:alert(1)" }),
    ).toThrow()
    expect(() =>
      savedWorkspacePaneBindingSchema.parse({ type: "browser", url: "file:///tmp/a" }),
    ).toThrow()

    rmSync(root, { recursive: true, force: true })
    mkdirSync(root)
    expect(resolveSavedWorkspacePane(databasePath, "workspace-1", "file-pane").state).toBe("stale")
  })
})

function insertWorkspace(workspaceLayout: SavedWorkspaceLayout) {
  const sqlite = new Database(databasePath)
  sqlite
    .prepare(
      `INSERT INTO saved_workspaces
    (id, name, scope_type, project_id, task_id, owner_kind, orchestration_id,
     layout_version, layout_json, sort_order, version, created_at, updated_at, archived_at)
    VALUES (?, ?, 'project', 'project-1', NULL, 'manual', NULL, 1, ?, 'a0', 1, 1, 1, NULL)`,
    )
    .run("workspace-1", "Workspace", JSON.stringify(workspaceLayout))
  sqlite.close()
}

function layout(panes: Array<ReturnType<typeof pane>>): SavedWorkspaceLayout {
  return {
    version: SAVED_WORKSPACE_LAYOUT_VERSION,
    root: { type: "tabs", id: "group-1", activePaneId: panes[0].id, panes },
  }
}

function pane(
  id: string,
  binding: import("../src/shared/saved-workspaces").SavedWorkspacePaneBinding,
  pinnedContext?: import("../src/shared/saved-workspaces").SavedWorkspacePinnedContext[],
) {
  return { id, binding, ...(pinnedContext ? { pinnedContext } : {}) }
}
