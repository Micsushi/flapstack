import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ userDataPath: "/tmp/flapstack-attachments-initial" }))

vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath, isPackaged: false },
}))

import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { bindRegisteredFilesystemRoot } from "../src/main/lib/git/security/path-validation"
import { attachmentsRouter } from "../src/main/lib/trpc/routers/attachments"

let container = ""
let databasePath = ""
let worktreePath = ""
let outsidePath = ""
const caller = attachmentsRouter.createCaller({ getWindow: () => null })

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-attachments-router-"))
  state.userDataPath = join(container, "user-data")
  worktreePath = join(container, "worktree")
  outsidePath = join(container, "outside-secret.txt")
  mkdirSync(state.userDataPath)
  mkdirSync(worktreePath)
  writeFileSync(outsidePath, "outside secret")
  databasePath = join(state.userDataPath, "agents.db")
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-1", "Project", worktreePath)
  sqlite
    .prepare(
      "INSERT INTO chats (id, project_id, scope, permission_mode, worktree_path) VALUES (?, ?, ?, ?, ?)",
    )
    .run("chat-1", "project-1", "project", "full-access", worktreePath)
  sqlite.close()
  process.env.FLAPSTACK_DB_PATH = databasePath
  bindRegisteredFilesystemRoot(worktreePath)
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(container, { recursive: true, force: true })
})

describe("attachment durable path contracts", () => {
  it("persists renderer bytes in the attachment namespace and writes through a registered root", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("inside attachment").toString("base64"),
    })

    expect(attachment.storedPath).toContain(join(state.userDataPath, "attachments"))
    await expect(caller.readText({ id: attachment.id })).resolves.toBe("inside attachment")
    await caller.writeToWorktree({
      id: attachment.id,
      worktreePath,
      targetRelativePath: "copied.txt",
    })
    expect(readFileSync(join(worktreePath, "copied.txt"), "utf8")).toBe("inside attachment")
  })

  it("deletes imported bytes and their now-empty attachment directory", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("inside attachment").toString("base64"),
    })
    expect(existsSync(attachment.storedPath!)).toBe(true)

    await expect(caller.delete({ id: attachment.id, chatId: "chat-1" })).resolves.toMatchObject({
      id: attachment.id,
    })

    expect(existsSync(attachment.storedPath!)).toBe(false)
    expect(existsSync(resolve(attachment.storedPath!, ".."))).toBe(false)
    await expect(caller.get({ id: attachment.id })).resolves.toBeUndefined()
  })

  it("deletes inline-only attachments without touching the durable file namespace", async () => {
    const attachment = await caller.createText({
      chatId: "chat-1",
      name: "inline.txt",
      contentText: "inline only",
    })

    await expect(caller.delete({ id: attachment.id, chatId: "chat-1" })).resolves.toMatchObject({
      id: attachment.id,
    })
    await expect(caller.get({ id: attachment.id })).resolves.toBeUndefined()
  })

  it("rejects a tampered durable source path before reading or writing outside content", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("inside attachment").toString("base64"),
    })
    const sqlite = new Database(databasePath)
    sqlite
      .prepare("UPDATE attachments SET stored_path = ? WHERE id = ?")
      .run(outsidePath, attachment.id)
    sqlite.close()

    await expect(caller.readText({ id: attachment.id })).rejects.toThrow(
      "outside the durable attachment namespace",
    )
    await expect(
      caller.writeToWorktree({
        id: attachment.id,
        worktreePath,
        targetRelativePath: "stolen.txt",
      }),
    ).rejects.toThrow("outside the durable attachment namespace")
    await expect(caller.delete({ id: attachment.id, chatId: "chat-1" })).rejects.toThrow(
      "outside the durable attachment namespace",
    )
    expect(existsSync(join(worktreePath, "stolen.txt"))).toBe(false)
    expect(readFileSync(outsidePath, "utf8")).toBe("outside secret")
    await expect(caller.get({ id: attachment.id })).resolves.toMatchObject({ id: attachment.id })
  })

  it("rejects a replaced registered root before attachment write", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("inside attachment").toString("base64"),
    })
    const movedRoot = join(container, "moved-worktree")
    renameSync(worktreePath, movedRoot)
    mkdirSync(worktreePath)

    await expect(
      caller.writeToWorktree({
        id: attachment.id,
        worktreePath,
        targetRelativePath: "blocked.txt",
      }),
    ).rejects.toThrow(/filesystem identity changed/)
    expect(existsSync(join(worktreePath, "blocked.txt"))).toBe(false)
    expect(existsSync(join(movedRoot, "blocked.txt"))).toBe(false)
  })
})
