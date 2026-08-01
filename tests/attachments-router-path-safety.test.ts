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

function jpegBytes(width = 1, height = 1): Buffer {
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])])
}

function gifBytes(width = 1, height = 1): Buffer {
  const header = Buffer.alloc(13)
  header.write("GIF89a", 0, "ascii")
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  return Buffer.concat([header, Buffer.from([0x3b])])
}

function webpBytes(width = 1, height = 1): Buffer {
  const data = Buffer.alloc(26)
  data.write("RIFF", 0, "ascii")
  data.writeUInt32LE(18, 4)
  data.write("WEBP", 8, "ascii")
  data.write("VP8L", 12, "ascii")
  data.writeUInt32LE(5, 16)
  data[20] = 0x2f
  data.writeUInt32LE((width - 1) | ((height - 1) << 14), 21)
  return data
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

  it("never persists or reads caller-controlled alternate text for imported bytes", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("verified attachment bytes").toString("base64"),
      mimeType: "text/plain",
      contentText: "unrelated caller-controlled text",
    } as Parameters<typeof caller.importFile>[0] & { contentText: string })

    expect(attachment.contentText).toBeNull()
    await expect(caller.readText({ id: attachment.id })).resolves.toBe("verified attachment bytes")
  })

  it("keeps legacy stored rows readable without inventing upload provenance", async () => {
    const root = join(state.userDataPath, "attachments")
    const storedPath = join(root, "legacy-id", "legacy.txt")
    mkdirSync(resolve(storedPath, ".."), { recursive: true })
    writeFileSync(storedPath, "legacy stored bytes")
    const sqlite = new Database(databasePath)
    sqlite
      .prepare(
        `INSERT INTO attachments
           (id, chat_id, kind, name, stored_path, source_kind, byte_length, mime_type, sha256)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
      )
      .run("legacy-id", "chat-1", "file", "legacy.txt", storedPath)
    sqlite.close()

    await expect(caller.readText({ id: "legacy-id" })).resolves.toBe("legacy stored bytes")
    await expect(
      caller.writeToWorktree({
        id: "legacy-id",
        worktreePath,
        targetRelativePath: "legacy-copy.txt",
      }),
    ).resolves.toBeDefined()
    expect(readFileSync(join(worktreePath, "legacy-copy.txt"), "utf8")).toBe("legacy stored bytes")
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

  it("uses the promoted attachment task when authorizing its worktree target", async () => {
    const taskWorktree = join(container, "task-worktree")
    mkdirSync(taskWorktree)
    const sqlite = new Database(databasePath)
    sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, name, primary_worktree_path) VALUES (?, ?, ?, ?)",
      )
      .run("task-1", "project-1", "Task", taskWorktree)
    sqlite.close()
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "promoted.txt",
      dataBase64: Buffer.from("promoted bytes").toString("base64"),
      mimeType: "text/plain",
    })
    await caller.promoteToTask({ id: attachment.id, taskId: "task-1" })

    await expect(
      caller.writeToWorktree({
        id: attachment.id,
        worktreePath: taskWorktree,
        targetRelativePath: "promoted-copy.txt",
      }),
    ).resolves.toBeDefined()
    expect(readFileSync(join(taskWorktree, "promoted-copy.txt"), "utf8")).toBe("promoted bytes")
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

  it.each(["not base64!", "YQ=", "YR==", "YQ==\n"])(
    "strictly rejects malformed or non-canonical base64 before persistence: %j",
    async (dataBase64) => {
      await expect(
        caller.importFile({
          chatId: "chat-1",
          name: "invalid.txt",
          dataBase64,
          mimeType: "text/plain",
        }),
      ).rejects.toThrow(/base64/i)

      expect(attachmentRowCount()).toBe(0)
      expect(attachmentStorageEntries()).toEqual([])
    },
  )

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

  it("validates canonical base64 at the exact decoded-byte cap without recursion failure", () => {
    const dataBase64 = Buffer.alloc(MAX_ATTACHMENT_BYTES).toString("base64")

    expect(() => decodeAttachmentBase64(dataBase64)).not.toThrow()
  })

  it.each([
    ["image/png", pngBytes()],
    ["image/jpeg", jpegBytes()],
    ["image/gif", gifBytes()],
    ["image/webp", webpBytes()],
  ])("derives %s from the uploaded image signature", async (mimeType, bytes) => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      kind: "image",
      name: "image.bin",
      dataBase64: bytes.toString("base64"),
      mimeType,
    })

    expect(attachment.mimeType).toBe(mimeType)
  })

  it("strictly allowlists MIME provenance by attachment kind", async () => {
    await expect(
      caller.importFile({
        chatId: "chat-1",
        kind: "image",
        name: "spoofed.png",
        dataBase64: Buffer.from("not an image").toString("base64"),
        mimeType: "text/html",
      }),
    ).rejects.toThrow(/MIME/i)

    expect(attachmentRowCount()).toBe(0)
    expect(attachmentStorageEntries()).toEqual([])
  })

  it("rejects allowed image MIME declarations whose bytes have no matching signature", async () => {
    await expect(
      caller.importFile({
        chatId: "chat-1",
        kind: "image",
        name: "spoofed.png",
        dataBase64: Buffer.from("plain text, not PNG").toString("base64"),
        mimeType: "image/png",
      }),
    ).rejects.toThrow(/signature|content|MIME/i)

    expect(attachmentRowCount()).toBe(0)
    expect(attachmentStorageEntries()).toEqual([])
  })

  it.each([
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["image/gif", Buffer.from("GIF89a", "ascii")],
    [
      "image/webp",
      Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]),
    ],
  ])(
    "rejects truncated %s signatures without bounded structural dimensions",
    async (mimeType, bytes) => {
      await expect(
        caller.importFile({
          chatId: "chat-1",
          kind: "image",
          name: "truncated.bin",
          dataBase64: bytes.toString("base64"),
          mimeType,
        }),
      ).rejects.toThrow(/structure|dimensions|content/i)
    },
  )

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

  it("rejects image-signature bytes imported under the generic file kind", async () => {
    await expect(
      caller.importFile({
        chatId: "chat-1",
        kind: "file",
        name: "hidden-image.bin",
        dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
          "base64",
        ),
        mimeType: "application/octet-stream",
      }),
    ).rejects.toThrow(/kind|image|MIME/i)

    expect(attachmentRowCount()).toBe(0)
    expect(attachmentStorageEntries()).toEqual([])
  })

  it("preserves a safe text subtype after authoritative UTF-8 validation", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      kind: "file",
      name: "notes.md",
      dataBase64: Buffer.from("# Notes\n").toString("base64"),
      mimeType: "text/markdown",
    })

    expect(attachment.mimeType).toBe("text/markdown")
  })

  it("preserves a safe declared OOXML subtype after authoritative ZIP sniffing", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      kind: "file",
      name: "document.docx",
      dataBase64: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })

    expect(attachment.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
  })

  it("preserves a legacy Office subtype only after authoritative OLE sniffing", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      kind: "file",
      name: "spreadsheet.xls",
      dataBase64: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).toString("base64"),
      mimeType: "application/vnd.ms-excel",
    })

    expect(attachment.mimeType).toBe("application/vnd.ms-excel")
  })

  it("keeps imported provenance immutable at the database boundary", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("inside attachment").toString("base64"),
      mimeType: "text/plain",
    })
    closeDatabase()
    const sqlite = new Database(databasePath)
    try {
      expect(() =>
        sqlite
          .prepare(
            `UPDATE attachments
             SET source_kind = ?, byte_length = ?, mime_type = ?, sha256 = ?
             WHERE id = ?`,
          )
          .run("capture", 1, "image/png", "0".repeat(64), attachment.id),
      ).toThrow(/provenance.*immutable/i)
      const stored = sqlite
        .prepare(
          `SELECT source_kind AS sourceKind, byte_length AS byteLength,
                  mime_type AS mimeType, sha256
           FROM attachments WHERE id = ?`,
        )
        .get(attachment.id)

      expect(stored).toMatchObject({
        sourceKind: "upload",
        byteLength: Buffer.byteLength("inside attachment"),
        mimeType: "text/plain",
        sha256: createHash("sha256").update("inside attachment").digest("hex"),
      })
    } finally {
      sqlite.close()
    }
  })

  it("accepts legacy null provenance and rejects partial or invalid upload provenance on insert", () => {
    closeDatabase()
    const sqlite = new Database(databasePath)
    try {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO attachments (id, chat_id, kind, name, content_text)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run("legacy-text", "chat-1", "text", "legacy.txt", "legacy inline text"),
      ).not.toThrow()

      const insert = sqlite.prepare(
        `INSERT INTO attachments
           (id, chat_id, kind, name, stored_path, content_text,
            source_kind, byte_length, mime_type, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const validHash = createHash("sha256").update("x").digest("hex")
      expect(() =>
        insert.run(
          "valid-upload",
          "chat-1",
          "file",
          "valid.txt",
          join(state.userDataPath, "attachments", "valid.txt"),
          null,
          "upload",
          1,
          "text/plain",
          validHash,
        ),
      ).not.toThrow()

      const invalidRows: Array<
        [string, string, string | null, unknown, string | null, string | null]
      > = [
        ["partial", "file", "upload", null, null, null],
        ["missing-source", "file", null, 1, "text/plain", validHash],
        ["missing-mime", "file", "upload", 1, null, validHash],
        ["missing-hash", "file", "upload", 1, "text/plain", null],
        ["bad-source", "file", "capture", 1, "text/plain", validHash],
        ["negative-size", "file", "upload", -1, "text/plain", validHash],
        ["oversize", "file", "upload", MAX_ATTACHMENT_BYTES + 1, "text/plain", validHash],
        ["fractional-size", "file", "upload", 1.5, "text/plain", validHash],
        ["bad-mime", "file", "upload", 1, "text/html; charset=utf-8", validHash],
        ["bad-hash", "file", "upload", 1, "text/plain", "A".repeat(64)],
        ["bad-kind", "text", "upload", 1, "text/plain", validHash],
      ]
      for (const [id, kind, sourceKind, byteLength, mimeType, sha256] of invalidRows) {
        expect(() =>
          insert.run(
            id,
            "chat-1",
            kind,
            `${id}.txt`,
            join(state.userDataPath, "attachments", `${id}.txt`),
            null,
            sourceKind,
            byteLength,
            mimeType,
            sha256,
          ),
        ).toThrow()
      }
      expect(() =>
        insert.run(
          "upload-with-alternate-text",
          "chat-1",
          "file",
          "alternate.txt",
          join(state.userDataPath, "attachments", "alternate.txt"),
          "unrelated alternate",
          "upload",
          1,
          "text/plain",
          validHash,
        ),
      ).toThrow()
      expect(() =>
        insert.run(
          "upload-without-storage",
          "chat-1",
          "file",
          "missing.txt",
          null,
          null,
          "upload",
          1,
          "text/plain",
          validHash,
        ),
      ).toThrow()
    } finally {
      sqlite.close()
    }
  })

  it("leaves no row or attachment payload when the rooted write cannot start", async () => {
    const storageRoot = join(state.userDataPath, "attachments")
    writeFileSync(storageRoot, "root collision")

    await expect(
      caller.importFile({
        chatId: "chat-1",
        name: "proof.txt",
        dataBase64: Buffer.from("inside attachment").toString("base64"),
        mimeType: "text/plain",
      }),
    ).rejects.toThrow()

    expect(attachmentRowCount()).toBe(0)
    expect(readFileSync(storageRoot, "utf8")).toBe("root collision")
  })

  it("removes only its owned payload when the database insert fails after writing", async () => {
    const storageRoot = join(state.userDataPath, "attachments")
    mkdirSync(storageRoot)
    const adjacentSentinel = join(storageRoot, "adjacent-sentinel.txt")
    writeFileSync(adjacentSentinel, "preserve adjacent")
    const sqlite = new Database(databasePath)
    sqlite.exec(`
      CREATE TRIGGER reject_attachment_insert
      BEFORE INSERT ON attachments
      WHEN NEW.stored_path IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'forced attachment insert failure');
      END;
      CREATE TRIGGER reject_attachment_stored_path_update
      BEFORE UPDATE OF stored_path ON attachments
      BEGIN
        SELECT RAISE(ABORT, 'forced legacy attachment update failure');
      END;
    `)
    sqlite.close()

    await expect(
      caller.importFile({
        chatId: "chat-1",
        name: "proof.txt",
        dataBase64: Buffer.from("inside attachment").toString("base64"),
        mimeType: "text/plain",
      }),
    ).rejects.toThrow(/forced attachment insert failure/i)

    expect(attachmentRowCount()).toBe(0)
    expect(attachmentStorageFiles()).toEqual([adjacentSentinel])
    expect(readFileSync(adjacentSentinel, "utf8")).toBe("preserve adjacent")
  })

  it("removes the owned payload when INSERT is ignored and returning().get() is undefined", async () => {
    const sqlite = new Database(databasePath)
    sqlite.exec(`
      CREATE TRIGGER ignore_attachment_insert
      BEFORE INSERT ON attachments
      WHEN NEW.stored_path IS NOT NULL
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `)
    sqlite.close()

    await expect(
      caller.importFile({
        chatId: "chat-1",
        name: "ignored.txt",
        dataBase64: Buffer.from("inside attachment").toString("base64"),
        mimeType: "text/plain",
      }),
    ).rejects.toThrow(/did not persist/i)

    expect(attachmentRowCount()).toBe(0)
    expect(attachmentStorageFiles()).toEqual([])
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

  it("deletes imported bytes and their now-empty attachment directory", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "proof.txt",
      dataBase64: Buffer.from("inside attachment").toString("base64"),
      mimeType: "text/plain",
    })
    expect(existsSync(attachment.storedPath!)).toBe(true)

    await expect(caller.delete({ id: attachment.id, chatId: "chat-1" })).resolves.toMatchObject({
      id: attachment.id,
    })

    expect(existsSync(attachment.storedPath!)).toBe(false)
    expect(existsSync(resolve(attachment.storedPath!, ".."))).toBe(false)
    await expect(caller.get({ id: attachment.id })).resolves.toBeUndefined()
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

  it("restores quarantined bytes when a database trigger ignores deletion", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "ignored-delete.txt",
      dataBase64: Buffer.from("preserve ignored delete").toString("base64"),
      mimeType: "text/plain",
    })
    const sqlite = new Database(databasePath)
    sqlite.exec(`
      CREATE TRIGGER ignore_attachment_delete
      BEFORE DELETE ON attachments
      WHEN OLD.id = '${attachment.id}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `)
    sqlite.close()

    await expect(caller.delete({ id: attachment.id, chatId: "chat-1" })).rejects.toThrow(
      /did not delete/i,
    )
    expect(readFileSync(attachment.storedPath!, "utf8")).toBe("preserve ignored delete")
    await expect(caller.get({ id: attachment.id })).resolves.toMatchObject({
      id: attachment.id,
    })
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

  it("reconciles bounded import orphans while preserving referenced payloads", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "referenced.txt",
      dataBase64: Buffer.from("referenced").toString("base64"),
      mimeType: "text/plain",
    })
    const orphanPath = join(state.userDataPath, "attachments", "orphan-id", "orphan.txt")
    mkdirSync(resolve(orphanPath, ".."), { recursive: true })
    writeFileSync(orphanPath, "orphan")

    const result = await reconcileAttachmentStorage({ maxEntries: 100, minAgeMs: 0 })

    expect(result).toMatchObject({ removed: 1, restored: 0, truncated: false })
    expect(existsSync(orphanPath)).toBe(false)
    expect(readFileSync(attachment.storedPath!, "utf8")).toBe("referenced")
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

  it("does not restore a corrupted upload quarantine", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "corrupt-quarantine.txt",
      dataBase64: Buffer.from("trusted quarantine").toString("base64"),
      mimeType: "text/plain",
    })
    const quarantinePath = join(
      resolve(attachment.storedPath!, ".."),
      attachmentDeletionQuarantineName(attachment.name, "corrupt-test"),
    )
    renameSync(attachment.storedPath!, quarantinePath)
    writeFileSync(quarantinePath, "hostile quarantine")

    const result = await reconcileAttachmentStorage({ maxEntries: 100, minAgeMs: 0 })

    expect(result).toMatchObject({ restored: 0, errors: 1 })
    expect(existsSync(attachment.storedPath!)).toBe(false)
    expect(readFileSync(quarantinePath, "utf8")).toBe("hostile quarantine")
  })

  it("preserves trusted quarantine when an unexpected file occupies the original path", async () => {
    const attachment = await caller.importFile({
      chatId: "chat-1",
      name: "replacement-conflict.txt",
      dataBase64: Buffer.from("trusted quarantine").toString("base64"),
      mimeType: "text/plain",
    })
    const quarantinePath = join(
      resolve(attachment.storedPath!, ".."),
      attachmentDeletionQuarantineName(attachment.name, "replacement-test"),
    )
    renameSync(attachment.storedPath!, quarantinePath)
    writeFileSync(attachment.storedPath!, "hostile replacement")

    const result = await reconcileAttachmentStorage({ maxEntries: 100, minAgeMs: 0 })

    expect(result).toMatchObject({ restored: 0, removed: 0, errors: 1 })
    expect(readFileSync(attachment.storedPath!, "utf8")).toBe("hostile replacement")
    expect(readFileSync(quarantinePath, "utf8")).toBe("trusted quarantine")
  })

  it("bounds orphan reconciliation work per invocation", async () => {
    for (const id of ["orphan-a", "orphan-b"]) {
      const orphanPath = join(state.userDataPath, "attachments", id, `${id}.txt`)
      mkdirSync(resolve(orphanPath, ".."), { recursive: true })
      writeFileSync(orphanPath, id)
    }

    const result = await reconcileAttachmentStorage({ maxEntries: 2, minAgeMs: 0 })

    expect(result.scanned).toBe(1)
    expect(result.removed).toBeLessThanOrEqual(1)
    expect(result.truncated).toBe(true)
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
