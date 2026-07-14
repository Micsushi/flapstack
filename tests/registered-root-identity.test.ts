import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import {
  assertRegisteredWorktree,
  bindRegisteredFilesystemRoot,
} from "../src/main/lib/git/security/path-validation"
import { filesRouter } from "../src/main/lib/trpc/routers/files"
import { runsRouter } from "../src/main/lib/trpc/routers/runs"

const trashItem = vi.hoisted(() => vi.fn())

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-root-identity-test", isPackaged: false },
  shell: { trashItem },
}))

const directories: string[] = []
const filesCaller = filesRouter.createCaller({ getWindow: () => null })
const runsCaller = runsRouter.createCaller({ getWindow: () => null })

afterEach(() => {
  closeDatabase()
  trashItem.mockReset()
  delete process.env.FLAPSTACK_DB_PATH
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("durable registered filesystem root identity", () => {
  it("fails closed until an existing pathname is explicitly bound", () => {
    const { root } = createRegisteredProject()

    expect(() => assertRegisteredWorktree(root)).toThrow("no durable filesystem identity")
    expect(bindRegisteredFilesystemRoot(root)).toMatchObject({
      path: root,
      canonicalPath: realpathSync(root),
    })
    expect(assertRegisteredWorktree(root)).toMatchObject({
      path: root,
      canonicalPath: realpathSync(root),
    })
  })

  it("rejects a replaced root before read, rename, or trash can dispatch", async () => {
    const { container, root } = createRegisteredProject()
    bindRegisteredFilesystemRoot(root)
    writeFileSync(join(root, "inside.txt"), "inside")
    const run = await runsCaller.createRun({
      chatId: "chat-1",
      harness: "codex",
      permissionMode: "full-access",
      worktreePath: root,
    })
    const outside = join(container, "outside")
    mkdirSync(outside)
    await expect(
      runsCaller.createRun({
        chatId: "chat-1",
        harness: "codex",
        permissionMode: "full-access",
        worktreePath: outside,
      }),
    ).rejects.toThrow("owned by its chat")
    const movedRoot = join(container, "moved-root")
    renameSync(root, movedRoot)
    mkdirSync(root)

    expect(() => assertRegisteredWorktree(root)).toThrow(/filesystem identity changed/)
    await expect(
      filesCaller.readFile({ rootPath: root, relativePath: "inside.txt" }),
    ).rejects.toThrow(/filesystem identity changed/)
    await expect(
      filesCaller.renameFile({
        worktreePath: root,
        relativePath: "inside.txt",
        newName: "renamed.txt",
      }),
    ).rejects.toThrow(/filesystem identity changed/)
    await expect(
      filesCaller.deleteFile({ worktreePath: root, relativePath: "inside.txt" }),
    ).rejects.toThrow(/filesystem identity changed/)
    await expect(runsCaller.completeRun({ runId: run.id })).rejects.toThrow(
      /filesystem identity changed/,
    )
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("rejects a registered root replaced by a symlink", () => {
    const { container, root } = createRegisteredProject()
    bindRegisteredFilesystemRoot(root)
    const movedRoot = join(container, "moved-root")
    renameSync(root, movedRoot)
    symlinkSync(movedRoot, root)

    expect(() => assertRegisteredWorktree(root)).toThrow(/replaced or symlinked/)
  })
})

function createRegisteredProject(): { container: string; root: string } {
  const container = mkdtempSync(join(tmpdir(), "flapstack-root-identity-"))
  directories.push(container)
  const root = join(container, "root")
  mkdirSync(root)
  const databasePath = join(container, "agents.db")
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-1", "Root", root)
  sqlite
    .prepare(
      "INSERT INTO chats (id, project_id, scope, permission_mode, worktree_path) VALUES (?, ?, ?, ?, ?)",
    )
    .run("chat-1", "project-1", "project", "full-access", root)
  sqlite.close()
  process.env.FLAPSTACK_DB_PATH = databasePath
  return { container, root }
}
