import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import {
  ProjectVaultCustomNotes,
  ProjectVaultNoteConflictError,
} from "../src/main/lib/project-vaults/custom-notes"

let container = ""
let root = ""
let database: Database.Database
let notes: ProjectVaultCustomNotes

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-custom-notes-"))
  root = join(container, "vault")
  mkdirSync(root)
  database = new Database(join(container, "agents.db"))
  database.pragma("foreign_keys = ON")
  migrate(drizzle(database, { schema }), {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  })
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-a", "Project A", join(container, "project"))
  database
    .prepare("INSERT INTO project_vaults (project_id, root_path, schema_version) VALUES (?, ?, ?)")
    .run("project-a", root, 1)
  writeFileSync(join(root, "INDEX.md"), "# Index\n")
  database
    .prepare(
      `INSERT INTO project_vault_sections
       (project_id, section_id, section_type, title, relative_path, version, content_hash, byte_length)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("project-a", "index", "index", "Index", "INDEX.md", 1, "0".repeat(64), 8)
  bindFilesystemRootIdentity(root, drizzle(database, { schema }))
  notes = new ProjectVaultCustomNotes(database)
})

afterEach(() => {
  database.close()
  rmSync(container, { recursive: true, force: true })
})

describe("project vault custom notes", () => {
  it("creates nested Obsidian-compatible notes with stable identity", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Research/Decision.md",
      title: "Decision",
      body: "See [[INDEX]].",
    })
    expect(created.identity).toMatchObject({ type: "custom" })
    expect(created.identity?.id).toMatch(/^custom:/)
    expect(created.version).toBe(1)
    expect(created.externallyModified).toBe(false)
    expect(created.content).toContain("# Decision")
    expect(readFileSync(join(root, "Research", "Decision.md"), "utf8")).toBe(created.content)
    await expect(notes.read("project-a", "Research/Decision.md")).resolves.toEqual(created)
  })

  it("uses content CAS and preserves stable identity", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Decision.md",
      title: "Decision",
    })
    writeFileSync(join(root, "Decision.md"), `${created.content}\nExternal edit\n`)
    await expect(
      notes.update({
        projectId: "project-a",
        relativePath: "Decision.md",
        expectedVersion: created.version,
        expectedHash: created.contentHash,
        content: `${created.content}\nApp edit\n`,
      }),
    ).rejects.toBeInstanceOf(ProjectVaultNoteConflictError)

    const external = await notes.read("project-a", "Decision.md")
    await expect(
      notes.update({
        projectId: "project-a",
        relativePath: "Decision.md",
        expectedVersion: external.version,
        expectedHash: external.contentHash,
        content: external.content.replace(created.identity!.id, "custom:replacement"),
      }),
    ).rejects.toThrow(/stable identity/i)
  })

  it("renames atomically and deletion remains explicitly restorable", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Plans/Old.md",
      title: "Old",
    })
    const renamed = await notes.rename({
      projectId: "project-a",
      relativePath: created.relativePath,
      newName: "New.md",
      expectedVersion: created.version,
      expectedHash: created.contentHash,
    })
    expect(renamed.relativePath).toBe("Plans/New.md")
    expect(existsSync(join(root, "Plans", "Old.md"))).toBe(false)

    const removed = await notes.remove({
      projectId: "project-a",
      relativePath: renamed.relativePath,
      expectedVersion: renamed.version,
      expectedHash: renamed.contentHash,
    })
    expect(existsSync(join(root, "Plans", "New.md"))).toBe(false)
    expect(existsSync(join(root, ".flapstack-trash", `${removed.trashId}.md`))).toBe(true)

    await notes.restore({
      projectId: "project-a",
      trashId: removed.trashId,
      relativePath: removed.relativePath,
      expectedVersion: removed.version,
    })
    expect(readFileSync(join(root, "Plans", "New.md"), "utf8")).toBe(created.content)
  })

  it("reconciles interrupted note delete and restore boundaries without losing either copy", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Plans/Crash-safe.md",
      title: "Crash safe",
    })
    const removed = await notes.remove({
      projectId: "project-a",
      relativePath: created.relativePath,
      expectedVersion: created.version,
      expectedHash: created.contentHash,
    })
    const trashPath = join(root, ".flapstack-trash", `${removed.trashId}.md`)

    // State left by a crash after durable delete metadata but before source unlink.
    writeFileSync(join(root, created.relativePath), created.content)
    const restored = await notes.restore({
      projectId: "project-a",
      trashId: removed.trashId,
      relativePath: created.relativePath,
      expectedVersion: removed.version,
    })
    expect(restored.content).toBe(created.content)
    expect(existsSync(trashPath)).toBe(false)

    // State left by a crash after restore metadata but before trash cleanup.
    mkdirSync(join(root, ".flapstack-trash"), { recursive: true })
    writeFileSync(trashPath, created.content)
    database
      .prepare(
        `UPDATE project_vault_custom_notes
         SET trash_id = ?
         WHERE project_id = ? AND stable_id = ? AND deleted_at IS NULL`,
      )
      .run(removed.trashId, "project-a", created.identity!.id)

    await expect(notes.read("project-a", created.relativePath)).resolves.toMatchObject({
      content: created.content,
      version: restored.version,
    })
    expect(existsSync(trashPath)).toBe(false)
    expect(
      database
        .prepare(
          `SELECT trash_id trashId
           FROM project_vault_custom_notes
           WHERE project_id = ? AND stable_id = ?`,
        )
        .get("project-a", created.identity!.id),
    ).toEqual({ trashId: null })
  })

  it("recovers an unacknowledged delete interrupted after its durable commit on reopen", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Plans/Unacknowledged.md",
      title: "Unacknowledged",
    })
    const trashId = randomUUID()
    const trashRelativePath = `.flapstack-trash/${trashId}.md`
    const trashPath = join(root, ".flapstack-trash", `${trashId}.md`)
    mkdirSync(join(root, ".flapstack-trash"), { recursive: true })
    writeFileSync(trashPath, created.content)

    // Exact durable state at the crash boundary: trash and deleted metadata
    // committed, original source not yet unlinked, and no remove() response.
    database
      .prepare(
        `UPDATE project_vault_custom_notes
         SET relative_path = ?, version = ?, trash_id = ?, deleted_at = ?, updated_at = ?
         WHERE project_id = ? AND stable_id = ?`,
      )
      .run(
        trashRelativePath,
        created.version + 1,
        trashId,
        1_800_000_000,
        1_800_000_000,
        "project-a",
        created.identity!.id,
      )

    database.close()
    database = new Database(join(container, "agents.db"))
    database.pragma("foreign_keys = ON")
    notes = new ProjectVaultCustomNotes(database)

    await expect(notes.read("project-a", created.relativePath)).resolves.toMatchObject({
      content: created.content,
      version: created.version + 1,
      externallyModified: false,
    })
    expect(existsSync(join(root, created.relativePath))).toBe(true)
    expect(existsSync(trashPath)).toBe(false)
    expect(
      database
        .prepare(
          `SELECT relative_path relativePath, version, trash_id trashId, deleted_at deletedAt
           FROM project_vault_custom_notes
           WHERE project_id = ? AND stable_id = ?`,
        )
        .get("project-a", created.identity!.id),
    ).toEqual({
      relativePath: created.relativePath,
      version: created.version + 1,
      trashId: null,
      deletedAt: null,
    })
  })

  it("does not resurrect a completed delete when a racing read loaded the source first", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Plans/Racing.md",
      title: "Racing",
    })
    let signalDeleteCommitted!: () => void
    const deleteCommitted = new Promise<void>((resolve) => {
      signalDeleteCommitted = resolve
    })
    let allowDeleteToContinue!: () => void
    const deleteCanContinue = new Promise<void>((resolve) => {
      allowDeleteToContinue = resolve
    })
    const removingNotes = new ProjectVaultCustomNotes(database, {
      afterDeleteMetadataCommitted: async () => {
        signalDeleteCommitted()
        await deleteCanContinue
      },
    })
    const removePromise = removingNotes.remove({
      projectId: "project-a",
      relativePath: created.relativePath,
      expectedVersion: created.version,
      expectedHash: created.contentHash,
    })
    await deleteCommitted

    let signalReconciliationWaiting!: () => void
    const reconciliationWaiting = new Promise<void>((resolve) => {
      signalReconciliationWaiting = resolve
    })
    const racingNotes = new ProjectVaultCustomNotes(database, {
      beforeStartupDeleteReconciliationWait: signalReconciliationWaiting,
    })
    const racingRead = racingNotes.read("project-a", created.relativePath)
    await reconciliationWaiting
    allowDeleteToContinue()

    const removed = await removePromise
    await expect(racingRead).rejects.toThrow(/metadata is missing or deleted/i)
    expect(existsSync(join(root, created.relativePath))).toBe(false)
    expect(existsSync(join(root, ".flapstack-trash", `${removed.trashId}.md`))).toBe(true)
    expect(
      database
        .prepare(
          `SELECT relative_path relativePath, trash_id trashId, deleted_at deletedAt
           FROM project_vault_custom_notes
           WHERE project_id = ? AND stable_id = ?`,
        )
        .get("project-a", created.identity!.id),
    ).toMatchObject({
      relativePath: `.flapstack-trash/${removed.trashId}.md`,
      trashId: removed.trashId,
    })
  })

  it("requires exact version and hash CAS and can adopt an external version", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Decision.md",
      title: "Decision",
    })
    const updated = await notes.update({
      projectId: "project-a",
      relativePath: created.relativePath,
      expectedVersion: created.version,
      expectedHash: created.contentHash,
      content: `${created.content}\nManaged edit.\n`,
    })
    expect(updated.version).toBe(2)

    await expect(
      notes.update({
        projectId: "project-a",
        relativePath: created.relativePath,
        expectedVersion: 1,
        expectedHash: updated.contentHash,
        content: `${updated.content}\nStale edit.\n`,
      }),
    ).rejects.toBeInstanceOf(ProjectVaultNoteConflictError)

    writeFileSync(join(root, "Decision.md"), `${updated.content}\nExternal edit.\n`)
    const external = await notes.read("project-a", "Decision.md")
    expect(external).toMatchObject({ version: 2, externallyModified: true })
    const adopted = await notes.adoptExternal({
      projectId: "project-a",
      relativePath: "Decision.md",
      expectedVersion: 2,
      expectedHash: external.contentHash,
    })
    expect(adopted).toMatchObject({ version: 3, externallyModified: false })
  })

  it("moves notes between folders without changing stable identity", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Inbox/Decision.md",
      title: "Decision",
    })
    await notes.createFolder({ projectId: "project-a", relativePath: "Archive/2026" })
    const moved = await notes.move({
      projectId: "project-a",
      relativePath: created.relativePath,
      destinationPath: "Archive/2026/Decision.md",
      expectedVersion: created.version,
      expectedHash: created.contentHash,
    })

    expect(moved.identity).toEqual(created.identity)
    expect(moved.version).toBe(2)
    expect(existsSync(join(root, "Inbox", "Decision.md"))).toBe(false)
    expect(readFileSync(join(root, "Archive", "2026", "Decision.md"), "utf8")).toBe(created.content)
  })

  it("keeps a recoverable copy when move metadata commit fails and permits retry", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Inbox/Recoverable.md",
      title: "Recoverable",
    })
    database.exec(`
      CREATE TRIGGER fail_custom_note_move
      BEFORE UPDATE OF relative_path ON project_vault_custom_notes
      WHEN NEW.relative_path = 'Archive/Recoverable.md'
      BEGIN
        SELECT RAISE(ABORT, 'forced metadata failure');
      END;
    `)

    await expect(
      notes.move({
        projectId: "project-a",
        relativePath: created.relativePath,
        destinationPath: "Archive/Recoverable.md",
        expectedVersion: created.version,
        expectedHash: created.contentHash,
      }),
    ).rejects.toThrow(/forced metadata failure/i)

    expect(existsSync(join(root, "Inbox", "Recoverable.md"))).toBe(true)
    expect(existsSync(join(root, "Archive", "Recoverable.md"))).toBe(false)
    expect(
      database
        .prepare(
          "SELECT relative_path relativePath FROM project_vault_custom_notes WHERE project_id = ?",
        )
        .get("project-a"),
    ).toEqual({ relativePath: "Inbox/Recoverable.md" })

    database.exec("DROP TRIGGER fail_custom_note_move")
    await expect(
      notes.move({
        projectId: "project-a",
        relativePath: created.relativePath,
        destinationPath: "Archive/Recoverable.md",
        expectedVersion: created.version,
        expectedHash: created.contentHash,
      }),
    ).resolves.toMatchObject({ relativePath: "Archive/Recoverable.md", version: 2 })
    expect(readFileSync(join(root, "Archive", "Recoverable.md"), "utf8")).toBe(created.content)
  })

  it("accepts only signature-matched bounded attachments and emits a supported embed", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("fixture"),
    ])
    const attachment = await notes.createAttachment({
      projectId: "project-a",
      relativePath: "Assets/diagram.png",
      declaredMimeType: "image/png",
      bytes: png,
    })
    expect(attachment).toMatchObject({
      relativePath: "Assets/diagram.png",
      mimeType: "image/png",
      byteLength: png.byteLength,
      embed: "![[Assets/diagram.png]]",
    })
    expect(readFileSync(join(root, "Assets", "diagram.png"))).toEqual(png)

    await expect(
      notes.createAttachment({
        projectId: "project-a",
        relativePath: "Assets/fake.png",
        declaredMimeType: "image/png",
        bytes: Buffer.from("not a png"),
      }),
    ).rejects.toThrow(/signature/i)
    await expect(
      notes.createAttachment({
        projectId: "project-a",
        relativePath: ".obsidian/plugins/unsafe.png",
        declaredMimeType: "image/png",
        bytes: png,
      }),
    ).rejects.toThrow()
  })

  it("reads, renames, moves, removes, and restores attachments with exact hash CAS", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("lifecycle"),
    ])
    const created = await notes.createAttachment({
      projectId: "project-a",
      relativePath: "Assets/diagram.png",
      declaredMimeType: "image/png",
      bytes: png,
    })
    await expect(notes.readAttachment("project-a", created.relativePath)).resolves.toMatchObject({
      contentHash: created.contentHash,
      dataBase64: png.toString("base64"),
    })

    const renamed = await notes.renameAttachment({
      projectId: "project-a",
      relativePath: created.relativePath,
      newName: "renamed.png",
      expectedHash: created.contentHash,
    })
    const moved = await notes.moveAttachment({
      projectId: "project-a",
      relativePath: renamed.relativePath,
      destinationPath: "Archive/renamed.png",
      expectedHash: renamed.contentHash,
    })
    expect(moved.contentHash).toBe(created.contentHash)

    writeFileSync(join(root, "Archive", "renamed.png"), Buffer.concat([png, Buffer.from("stale")]))
    await expect(
      notes.removeAttachment({
        projectId: "project-a",
        relativePath: moved.relativePath,
        expectedHash: moved.contentHash,
      }),
    ).rejects.toBeInstanceOf(ProjectVaultNoteConflictError)
    writeFileSync(join(root, "Archive", "renamed.png"), png)

    const removed = await notes.removeAttachment({
      projectId: "project-a",
      relativePath: moved.relativePath,
      expectedHash: moved.contentHash,
    })
    expect(existsSync(join(root, "Archive", "renamed.png"))).toBe(false)
    const restored = await notes.restoreAttachment({
      projectId: "project-a",
      trashId: removed.trashId,
      relativePath: removed.relativePath,
      expectedHash: removed.contentHash,
    })
    expect(restored.contentHash).toBe(created.contentHash)
    expect(readFileSync(join(root, "Archive", "renamed.png"))).toEqual(png)
  })

  it("renames and removes explicit empty folders without touching their notes", async () => {
    await notes.createFolder({ projectId: "project-a", relativePath: "Empty" })
    const renamed = await notes.renameFolder({
      projectId: "project-a",
      relativePath: "Empty",
      newName: "Archive",
    })
    expect(renamed.relativePath).toBe("Archive")
    await notes.removeFolder({ projectId: "project-a", relativePath: "Archive" })
    expect(existsSync(join(root, "Archive"))).toBe(false)

    await notes.create({ projectId: "project-a", relativePath: "Research/Keep.md", title: "Keep" })
    await expect(
      notes.removeFolder({ projectId: "project-a", relativePath: "Research" }),
    ).rejects.toThrow(/empty/i)
    expect(existsSync(join(root, "Research", "Keep.md"))).toBe(true)
  })

  it("keeps both conflict versions with distinct stable identities", async () => {
    const created = await notes.create({
      projectId: "project-a",
      relativePath: "Decision.md",
      title: "Decision",
    })
    const draft = `${created.content}\nLocal draft.\n`
    writeFileSync(join(root, "Decision.md"), `${created.content}\nExternal version.\n`)
    const external = await notes.read("project-a", "Decision.md")
    const kept = await notes.keepBoth({
      projectId: "project-a",
      relativePath: "Decision.md",
      destinationPath: "Decision (local copy).md",
      expectedVersion: external.version,
      expectedCurrentHash: external.contentHash,
      draftContent: draft,
    })

    expect(kept.identity?.id).toMatch(/^custom:/)
    expect(kept.identity?.id).not.toBe(created.identity?.id)
    expect(kept.content).toContain("Local draft.")
    expect(readFileSync(join(root, "Decision.md"), "utf8")).toContain("External version.")
    expect(readFileSync(join(root, "Decision (local copy).md"), "utf8")).toBe(kept.content)
  })

  it("rejects seed mutations, hidden namespaces, escapes, and unsupported extensions", async () => {
    await expect(
      notes.create({
        projectId: "project-a",
        relativePath: "INDEX.md",
        title: "Replacement",
      }),
    ).rejects.toThrow(/seed/i)
    for (const relativePath of [
      "../outside.md",
      ".obsidian/plugins/x.md",
      ".flapstack-trash/fake.md",
      "binary.pdf",
    ]) {
      await expect(
        notes.create({ projectId: "project-a", relativePath, title: "Unsafe" }),
      ).rejects.toThrow()
    }
  })
})
