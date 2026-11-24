import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  userDataPath: "/tmp/flapstack-attachments-initial",
  beforeFailureCleanup: null as ((targetPath: string) => void) | null,
}))

vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath, isPackaged: false },
}))

vi.mock("../src/main/lib/path-safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/lib/path-safety")>()
  return {
    ...actual,
    writeFileInsideRoot(
      ...args: Parameters<typeof actual.writeFileInsideRoot>
    ): ReturnType<typeof actual.writeFileInsideRoot> {
      const [rootPath, targetRelativePath, source, options = {}] = args
      return actual.writeFileInsideRoot(rootPath, targetRelativePath, source, {
        ...options,
        beforeFailureCleanup: state.beforeFailureCleanup ?? options.beforeFailureCleanup,
      })
    },
  }
})

import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { bindRegisteredFilesystemRoot } from "../src/main/lib/git/security/path-validation"
import {
  attachmentDeletionQuarantineName,
  reconcileAttachmentStorage,
} from "../src/main/lib/attachments/reconcile"
import { attachmentsRouter, decodeAttachmentBase64 } from "../src/main/lib/trpc/routers/attachments"

let container = ""
let databasePath = ""
let worktreePath = ""
let outsidePath = ""
const caller = attachmentsRouter.createCaller({ getWindow: () => null })
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000

function pngBytes(width = 1, height = 1): Buffer {
  const header = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  header.writeUInt32BE(13, 8)
  header.write("IHDR", 12, "ascii")
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header[24] = 8
  header[25] = 6
  return Buffer.concat([
    header,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("IEND", "ascii"),
    Buffer.alloc(4),
  ])
}

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-attachments-router-"))
  state.beforeFailureCleanup = null
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

function attachmentRowCount(): number {
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    return (sqlite.prepare("SELECT COUNT(*) AS count FROM attachments").get() as { count: number })
      .count
  } finally {
    sqlite.close()
  }
}

function attachmentStorageEntries(): string[] {
  const root = join(state.userDataPath, "attachments")
  return existsSync(root) ? readdirSync(root) : []
}

function attachmentStorageFiles(path = join(state.userDataPath, "attachments")): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name)
    return entry.isDirectory() ? attachmentStorageFiles(entryPath) : [entryPath]
  })
}

describe("attachment durable path contracts", () => {
  it("persists renderer bytes in the attachment namespace and writes through a registered root", async () => {
    const bytes = Buffer.from("inside attachment")
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: bytes.toString("base64"),
      mimeType: "text/plain",
    })

    expect(attachment.storedPath).toContain(join(state.userDataPath, "attachments"))
    expect(attachment).toMatchObject({
      sourceKind: "upload",
      sourcePath: null,
      byteLength: bytes.byteLength,
      mimeType: "text/plain",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    await expect(caller.readText({ id: attachment.id })).resolves.toBe("inside attachment")
    await caller.writeToWorktree({
      id: attachment.id,
      worktreePath,
      targetRelativePath: "copied.txt",
    })
    expect(readFileSync(join(worktreePath, "copied.txt"), "utf8")).toBe("inside attachment")
  })

  it("rejects importing a chat attachment into a task owned by another project", async () => {
    const secondProject = join(container, "second-project")
    mkdirSync(secondProject)
    const sqlite = new Database(databasePath)
    sqlite
      .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
      .run("project-2", "Other project", secondProject)
    sqlite
      .prepare("INSERT INTO tasks (id, project_id, name) VALUES (?, ?, ?)")
      .run("task-2", "project-2", "Other task")
    sqlite.close()

    await expect(
      caller.importFile({
        chatId: "chat-1",
        taskId: "task-2",
        name: "cross-scope.txt",
        dataBase64: Buffer.from("secret").toString("base64"),
        mimeType: "text/plain",
      }),
    ).rejects.toThrow(/task|project|scope/i)
    expect(attachmentRowCount()).toBe(0)
    expect(attachmentStorageEntries()).toEqual([])
  })

  it("fails closed when durable attachment bytes are replaced or corrupted", async () => {
    const replaced = await caller.importFile({
      chatId: "chat-1",
      name: "replaced.txt",
      dataBase64: Buffer.from("trusted bytes").toString("base64"),
      mimeType: "text/plain",
    })
    renameSync(replaced.storedPath!, `${replaced.storedPath!}.original`)
    writeFileSync(replaced.storedPath!, "hostile bytes")

    await expect(caller.readText({ id: replaced.id })).rejects.toThrow(/integrity/i)
    await expect(
      caller.writeToWorktree({
        id: replaced.id,
        worktreePath,
        targetRelativePath: "replaced-copy.txt",
      }),
    ).rejects.toThrow(/integrity/i)
    expect(existsSync(join(worktreePath, "replaced-copy.txt"))).toBe(false)

    const corrupted = await caller.importFile({
      chatId: "chat-1",
      name: "corrupted.txt",
      dataBase64: Buffer.from("same length").toString("base64"),
      mimeType: "text/plain",
    })
    writeFileSync(corrupted.storedPath!, "evil length")

    await expect(caller.readText({ id: corrupted.id })).rejects.toThrow(/integrity/i)
    await expect(
      caller.writeToWorktree({
        id: corrupted.id,
        worktreePath,
        targetRelativePath: "corrupted-copy.txt",
      }),
    ).rejects.toThrow(/integrity/i)
    expect(existsSync(join(worktreePath, "corrupted-copy.txt"))).toBe(false)
  })

  it("rejects decoded bytes over the attachment cap before creating storage", async () => {
    const dataBase64 = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64")
    let decoderCalled = false
    let rejection: unknown
    try {
      decodeAttachmentBase64(dataBase64, () => {
        decoderCalled = true
        return Buffer.alloc(0)
      })
    } catch (error) {
      rejection = error
    }
    expect(decoderCalled).toBe(false)
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toBe(
      `Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte size limit`,
    )

    expect(attachmentRowCount()).toBe(0)
    expect(existsSync(join(state.userDataPath, "attachments"))).toBe(false)
  })

  it("rejects images whose decoded pixel area exceeds the bounded cap", async () => {
    const width = 10_000
    const height = Math.floor(MAX_IMAGE_PIXELS / width) + 1

    await expect(
      caller.importFile({
        chatId: "chat-1",
        kind: "image",
        name: "pixel-bomb.png",
        dataBase64: pngBytes(width, height).toString("base64"),
        mimeType: "image/png",
      }),
    ).rejects.toThrow(/pixel|dimensions|limit/i)
  })

  it("preserves adjacent and replacement sentinels when DB-failure cleanup loses inode ownership", async () => {
    const storageRoot = join(state.userDataPath, "attachments")
    mkdirSync(storageRoot)
    const adjacentSentinel = join(storageRoot, "adjacent-race-sentinel.txt")
    const movedOwnedPayload = join(storageRoot, "moved-owned-payload.txt")
    writeFileSync(adjacentSentinel, "preserve adjacent")
    const sqlite = new Database(databasePath)
    sqlite.exec(`
      CREATE TRIGGER reject_attachment_insert
      BEFORE INSERT ON attachments
      WHEN NEW.stored_path IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'forced attachment insert failure');
      END;
    `)
    sqlite.close()

    let replacementPath = ""
    state.beforeFailureCleanup = (targetPath) => {
      replacementPath = targetPath
      renameSync(targetPath, movedOwnedPayload)
      writeFileSync(targetPath, "replacement sentinel")
    }

    await expect(
      caller.importFile({
        chatId: "chat-1",
        name: "proof.txt",
        dataBase64: Buffer.from("inside attachment").toString("base64"),
        mimeType: "text/plain",
      }),
    ).rejects.toThrow(/forced attachment insert failure/i)

    expect(attachmentRowCount()).toBe(0)
    expect(readFileSync(adjacentSentinel, "utf8")).toBe("preserve adjacent")
    expect(readFileSync(replacementPath, "utf8")).toBe("replacement sentinel")
    expect(readFileSync(movedOwnedPayload, "utf8")).toBe("inside attachment")
  })

  it("restores quarantined bytes when the database delete aborts", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "rollback-delete.txt",
      dataBase64: Buffer.from("preserve on delete failure").toString("base64"),
      mimeType: "text/plain",
    })
    const sqlite = new Database(databasePath)
    sqlite.exec(`
      CREATE TRIGGER reject_attachment_delete
      BEFORE DELETE ON attachments
      WHEN OLD.id = '${attachment.id}'
      BEGIN
        SELECT RAISE(ABORT, 'forced attachment delete failure');
      END;
    `)
    sqlite.close()

    await expect(caller.delete({ id: attachment.id, chatId: "chat-1" })).rejects.toThrow(
      /forced attachment delete failure/i,
    )

    expect(readFileSync(attachment.storedPath!, "utf8")).toBe("preserve on delete failure")
    await expect(caller.get({ id: attachment.id })).resolves.toMatchObject({
      id: attachment.id,
    })
    expect(attachmentStorageFiles()).toEqual([attachment.storedPath])
  })

  it("restores a quarantined payload when its database row survived a crash", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "restore-after-crash.txt",
      dataBase64: Buffer.from("restore after crash").toString("base64"),
      mimeType: "text/plain",
    })
    const quarantinePath = join(
      resolve(attachment.storedPath!, ".."),
      attachmentDeletionQuarantineName(attachment.name, "crash-test"),
    )
    renameSync(attachment.storedPath!, quarantinePath)

    const result = await reconcileAttachmentStorage({ maxEntries: 100, minAgeMs: 0 })

    expect(result).toMatchObject({ removed: 0, restored: 1, truncated: false })
    expect(readFileSync(attachment.storedPath!, "utf8")).toBe("restore after crash")
    expect(existsSync(quarantinePath)).toBe(false)
  })

  it("rejects a tampered durable source path before reading or writing outside content", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("inside attachment").toString("base64"),
      mimeType: "text/plain",
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
      mimeType: "text/plain",
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
