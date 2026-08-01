import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { readFile, readdir, rm, rmdir } from "node:fs/promises"
import { basename, posix } from "node:path"
import { z } from "zod"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import {
  actOnPathInsideRoot,
  prepareSafeWritePath,
  readFileInsideRoot,
  removeFileInsideRoot,
  renamePathInsideRoot,
  writeFileInsideRoot,
} from "../path-safety"
import { assertProjectVaultContentSafe } from "./content-safety"
import { parseObsidianNote } from "./obsidian-markdown"

const MAX_NOTE_BYTES = 1_048_576
const MAX_ATTACHMENT_BYTES = 16 * 1_048_576
const mutationLocks = new Map<string, Promise<void>>()
const inFlightNoteDeletes = new Set<string>()

type NoteMetadata = {
  stableId: string
  relativePath: string
  version: number
  contentHash: string
  trashId: string | null
  deletedAt: number | null
}

type ProjectVaultCustomNotesHooks = {
  afterDeleteMetadataCommitted?: () => void | Promise<void>
  beforeStartupDeleteReconciliationWait?: () => void
}

export class ProjectVaultNoteConflictError extends Error {
  constructor(
    message: string,
    readonly currentHash: string,
  ) {
    super(message)
    this.name = "ProjectVaultNoteConflictError"
  }
}

export class ProjectVaultCustomNotes {
  private readonly sqlite: Database.Database
  private readonly startupDeletedNoteKeys: Set<string>

  constructor(
    database: Database.Database | object,
    private readonly hooks: ProjectVaultCustomNotesHooks = {},
  ) {
    this.sqlite =
      "prepare" in database
        ? (database as Database.Database)
        : (database as { $client: Database.Database }).$client
    const startupDeletedNotes = this.sqlite
      .prepare(
        `SELECT project_id projectId, stable_id stableId
         FROM project_vault_custom_notes
         WHERE deleted_at IS NOT NULL AND trash_id IS NOT NULL`,
      )
      .all() as Array<{ projectId: string; stableId: string }>
    this.startupDeletedNoteKeys = new Set(
      startupDeletedNotes.map(({ projectId, stableId }) => noteKey(projectId, stableId)),
    )
  }

  async create(input: { projectId: string; relativePath: string; title: string; body?: string }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeNotePath(input.relativePath)
      this.#assertNotSeed(input.projectId, relativePath)
      const title = safeTitle(input.title)
      const identity = `custom:${randomUUID()}`
      const content = `---\nflapstack_id: ${identity}\nflapstack_type: custom\n---\n\n# ${title}\n\n${input.body?.trim() ?? ""}\n`
      validateContent(content)
      await writeFileInsideRoot(
        root,
        relativePath,
        { data: content },
        {
          createParents: true,
          expectedSha256: null,
        },
      )
      try {
        this.sqlite
          .prepare(
            `INSERT INTO project_vault_custom_notes
             (project_id, stable_id, relative_path, version, content_hash, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .run(input.projectId, identity, relativePath, sha256(content), now())
      } catch (error) {
        await removeFileInsideRoot(root, relativePath, { removeEmptyParent: true }).catch(
          () => undefined,
        )
        throw error
      }
      return noteResult(relativePath, content, 1, false)
    })
  }

  async read(projectId: string, relativePathValue: string) {
    return this.#read(projectId, relativePathValue, false)
  }

  async #read(projectId: string, relativePathValue: string, mutationLockHeld: boolean) {
    const root = this.#root(projectId)
    const relativePath = safeNotePath(relativePathValue)
    const bytes = await readFileInsideRoot(root, relativePath, { maxBytes: MAX_NOTE_BYTES })
    const content = bytes.toString("utf8")
    const parsed = parseObsidianNote(content, relativePath)
    const stableId = parsed.identity?.id
    if (!stableId) throw new Error("Custom project note is missing a stable identity.")
    let metadata = this.#metadata(projectId, stableId)
    if (!metadata) {
      throw new Error("Custom project note metadata is missing or deleted.")
    }
    const contentHash = sha256(content)
    if (metadata.deletedAt !== null) {
      const reconciled = await this.#reconcileStartupInterruptedDelete({
        projectId,
        stableId,
        relativePath,
        root,
        contentHash,
        mutationLockHeld,
      })
      if (!reconciled) {
        throw new Error("Custom project note metadata is missing or deleted.")
      }
      metadata = reconciled
    }
    if (metadata.trashId) {
      const pendingTrashPath = posix.join(".flapstack-trash", `${metadata.trashId}.md`)
      try {
        await removeFileInsideRoot(root, pendingTrashPath, { removeEmptyParent: true }).catch(
          (error: unknown) => {
            if (!isMissingPathError(error)) throw error
          },
        )
        this.sqlite
          .prepare(
            `UPDATE project_vault_custom_notes
             SET trash_id = NULL, updated_at = ?
             WHERE project_id = ? AND stable_id = ? AND trash_id = ? AND deleted_at IS NULL`,
          )
          .run(now(), projectId, stableId, metadata.trashId)
      } catch {
        // The restored note is authoritative. Keep the durable trash identity so
        // a later read can retry cleanup without hiding or deleting the note.
      }
    }
    if (metadata.relativePath !== relativePath) {
      this.sqlite
        .prepare(
          `UPDATE project_vault_custom_notes
           SET relative_path = ?, updated_at = ?
           WHERE project_id = ? AND stable_id = ? AND deleted_at IS NULL`,
        )
        .run(relativePath, now(), projectId, stableId)
    }
    return noteResult(relativePath, content, metadata.version, contentHash !== metadata.contentHash)
  }

  async update(input: {
    projectId: string
    relativePath: string
    expectedVersion: number
    expectedHash: string
    content: string
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeNotePath(input.relativePath)
      validateContent(input.content)
      const current = await this.#read(input.projectId, relativePath, true)
      const beforeIdentity = parseObsidianNote(current.content, relativePath).identity
      const afterIdentity = parseObsidianNote(input.content, relativePath).identity
      if (beforeIdentity?.id && beforeIdentity.id !== afterIdentity?.id) {
        throw new Error("A project note stable identity cannot be changed by content editing.")
      }
      if (
        current.version !== input.expectedVersion ||
        current.externallyModified ||
        current.contentHash !== input.expectedHash
      ) {
        throw new ProjectVaultNoteConflictError(
          "Project note changed outside this editor.",
          current.contentHash,
        )
      }
      await writeFileInsideRoot(
        root,
        relativePath,
        { data: input.content },
        {
          overwrite: true,
          expectedSha256: input.expectedHash,
        },
      )
      const nextVersion = input.expectedVersion + 1
      this.sqlite
        .prepare(
          `UPDATE project_vault_custom_notes
           SET version = ?, content_hash = ?, updated_at = ?
           WHERE project_id = ? AND stable_id = ? AND version = ? AND content_hash = ?
             AND deleted_at IS NULL`,
        )
        .run(
          nextVersion,
          sha256(input.content),
          now(),
          input.projectId,
          beforeIdentity!.id,
          input.expectedVersion,
          input.expectedHash,
        )
      return noteResult(relativePath, input.content, nextVersion, false)
    })
  }

  async adoptExternal(input: {
    projectId: string
    relativePath: string
    expectedVersion: number
    expectedHash: string
  }) {
    return withLock(input.projectId, async () => {
      const current = await this.#read(input.projectId, input.relativePath, true)
      if (
        current.version !== input.expectedVersion ||
        current.contentHash !== input.expectedHash ||
        !current.externallyModified
      ) {
        throw new ProjectVaultNoteConflictError(
          "Project note changed before external adoption.",
          current.contentHash,
        )
      }
      const nextVersion = current.version + 1
      const updated = this.sqlite
        .prepare(
          `UPDATE project_vault_custom_notes
           SET version = ?, content_hash = ?, updated_at = ?
           WHERE project_id = ? AND stable_id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .run(
          nextVersion,
          current.contentHash,
          now(),
          input.projectId,
          current.identity!.id,
          input.expectedVersion,
        )
      if (updated.changes !== 1) {
        throw new ProjectVaultNoteConflictError(
          "Project note version changed before external adoption.",
          current.contentHash,
        )
      }
      return noteResult(current.relativePath, current.content, nextVersion, false)
    })
  }

  async keepBoth(input: {
    projectId: string
    relativePath: string
    destinationPath: string
    expectedVersion: number
    expectedCurrentHash: string
    draftContent: string
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeNotePath(input.relativePath)
      const destinationPath = safeNotePath(input.destinationPath)
      this.#assertNotSeed(input.projectId, relativePath)
      this.#assertNotSeed(input.projectId, destinationPath)
      const current = await this.#read(input.projectId, relativePath, true)
      if (
        current.version !== input.expectedVersion ||
        current.contentHash !== input.expectedCurrentHash
      ) {
        throw new ProjectVaultNoteConflictError(
          "Project note changed before keeping both versions.",
          current.contentHash,
        )
      }
      validateContent(input.draftContent)
      const draftIdentity = parseObsidianNote(input.draftContent, relativePath).identity
      if (!draftIdentity?.id || draftIdentity.id !== current.identity?.id) {
        throw new Error("The local draft no longer has the conflicted note identity.")
      }
      const stableId = `custom:${randomUUID()}`
      const content = replaceStableIdentity(input.draftContent, stableId)
      validateContent(content)
      await writeFileInsideRoot(
        root,
        destinationPath,
        { data: content },
        { createParents: true, expectedSha256: null },
      )
      try {
        this.sqlite
          .prepare(
            `INSERT INTO project_vault_custom_notes
             (project_id, stable_id, relative_path, version, content_hash, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .run(input.projectId, stableId, destinationPath, sha256(content), now())
      } catch (error) {
        await removeFileInsideRoot(root, destinationPath, { removeEmptyParent: true }).catch(
          () => undefined,
        )
        throw error
      }
      return noteResult(destinationPath, content, 1, false)
    })
  }

  async rename(input: {
    projectId: string
    relativePath: string
    newName: string
    expectedVersion: number
    expectedHash: string
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeNotePath(input.relativePath)
      this.#assertNotSeed(input.projectId, relativePath)
      const nextName = basename(
        safeNotePath(posix.join(posix.dirname(relativePath), input.newName)),
      )
      const current = await this.#read(input.projectId, relativePath, true)
      this.#assertExact(current, input.expectedVersion, input.expectedHash, "rename")
      if (!current.identity?.id) {
        throw new ProjectVaultNoteConflictError(
          "Project note identity changed before rename.",
          current.contentHash,
        )
      }
      await renamePathInsideRoot(root, relativePath, nextName, {
        beforeCommit: async () => {
          const latest = await readFileInsideRoot(root, relativePath, {
            maxBytes: MAX_NOTE_BYTES,
          })
          if (sha256(latest) !== input.expectedHash) {
            throw new ProjectVaultNoteConflictError(
              "Project note changed before rename.",
              sha256(latest),
            )
          }
        },
      })
      const nextPath = posix.join(posix.dirname(relativePath), nextName)
      const nextVersion = input.expectedVersion + 1
      this.sqlite
        .prepare(
          `UPDATE project_vault_custom_notes
           SET relative_path = ?, version = ?, updated_at = ?
           WHERE project_id = ? AND stable_id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .run(
          nextPath,
          nextVersion,
          now(),
          input.projectId,
          current.identity.id,
          input.expectedVersion,
        )
      return noteResult(nextPath, current.content, nextVersion, false)
    })
  }

  async createFolder(input: { projectId: string; relativePath: string }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeVisiblePath(input.relativePath, false)
      await prepareSafeWritePath(root, posix.join(relativePath, ".flapstack-folder-probe"), {
        createParents: true,
      })
      return { relativePath }
    })
  }

  async renameFolder(input: { projectId: string; relativePath: string; newName: string }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeVisiblePath(input.relativePath, false)
      const newName = posix.basename(
        safeVisiblePath(posix.join(posix.dirname(relativePath), input.newName), false),
      )
      this.#assertFolderContainsNoSeeds(input.projectId, relativePath)
      await renamePathInsideRoot(root, relativePath, newName)
      const nextPath = posix.join(posix.dirname(relativePath), newName)
      try {
        const rows = this.sqlite
          .prepare(
            `SELECT stable_id stableId, relative_path relativePath
             FROM project_vault_custom_notes
             WHERE project_id = ? AND deleted_at IS NULL`,
          )
          .all(input.projectId) as Array<{ stableId: string; relativePath: string }>
        this.sqlite
          .transaction(() => {
            const update = this.sqlite.prepare(
              `UPDATE project_vault_custom_notes
               SET relative_path = ?, updated_at = ?
               WHERE project_id = ? AND stable_id = ? AND deleted_at IS NULL`,
            )
            for (const row of rows) {
              if (!row.relativePath.startsWith(`${relativePath}/`)) continue
              update.run(
                `${nextPath}${row.relativePath.slice(relativePath.length)}`,
                now(),
                input.projectId,
                row.stableId,
              )
            }
          })
          .immediate()
      } catch (error) {
        await renamePathInsideRoot(root, nextPath, posix.basename(relativePath)).catch(
          () => undefined,
        )
        throw error
      }
      return { relativePath: nextPath }
    })
  }

  async removeFolder(input: { projectId: string; relativePath: string }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeVisiblePath(input.relativePath, false)
      this.#assertFolderContainsNoSeeds(input.projectId, relativePath)
      await actOnPathInsideRoot(root, relativePath, async (targetPath) => {
        if ((await readdir(targetPath)).length > 0) {
          throw new Error("Project vault folder must be empty before removal.")
        }
        await rmdir(targetPath)
      })
      return { relativePath, removed: true as const }
    })
  }

  async move(input: {
    projectId: string
    relativePath: string
    destinationPath: string
    expectedVersion: number
    expectedHash: string
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeNotePath(input.relativePath)
      const destinationPath = safeNotePath(input.destinationPath)
      this.#assertNotSeed(input.projectId, relativePath)
      this.#assertNotSeed(input.projectId, destinationPath)
      const current = await this.#read(input.projectId, relativePath, true)
      this.#assertExact(current, input.expectedVersion, input.expectedHash, "move")
      const nextVersion = input.expectedVersion + 1
      await writeFileInsideRoot(
        root,
        destinationPath,
        { data: current.content },
        {
          createParents: true,
          expectedSha256: null,
          afterCommit: () => {
            const changed = this.sqlite
              .prepare(
                `UPDATE project_vault_custom_notes
                 SET relative_path = ?, version = ?, updated_at = ?
                 WHERE project_id = ? AND stable_id = ? AND version = ? AND deleted_at IS NULL`,
              )
              .run(
                destinationPath,
                nextVersion,
                now(),
                input.projectId,
                current.identity!.id,
                input.expectedVersion,
              )
            if (changed.changes !== 1) {
              throw new Error("Project note metadata changed before move.")
            }
          },
        },
      )
      await removeFileInsideRoot(root, relativePath, {
        beforeCommit: async () => {
          const latest = await readFileInsideRoot(root, relativePath, {
            maxBytes: MAX_NOTE_BYTES,
          })
          if (sha256(latest) !== input.expectedHash) {
            throw new ProjectVaultNoteConflictError(
              "Project note changed before move.",
              sha256(latest),
            )
          }
        },
      })
      return noteResult(destinationPath, current.content, nextVersion, false)
    })
  }

  async createAttachment(input: {
    projectId: string
    relativePath: string
    declaredMimeType: string
    bytes: Uint8Array
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeVisiblePath(input.relativePath, true)
      const bytes = Buffer.from(input.bytes)
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error("Project vault attachment exceeds the safe size limit.")
      }
      const mimeType = validateAttachment(relativePath, input.declaredMimeType, bytes)
      await writeFileInsideRoot(
        root,
        relativePath,
        { data: bytes },
        { createParents: true, expectedSha256: null },
      )
      return {
        relativePath,
        mimeType,
        byteLength: bytes.byteLength,
        contentHash: sha256(bytes),
        embed: `![[${relativePath}]]`,
      }
    })
  }

  async readAttachment(projectId: string, relativePathValue: string) {
    const root = this.#root(projectId)
    const relativePath = safeAttachmentPath(relativePathValue)
    const bytes = await readFileInsideRoot(root, relativePath, {
      maxBytes: MAX_ATTACHMENT_BYTES,
    })
    return attachmentResult(relativePath, bytes)
  }

  async renameAttachment(input: {
    projectId: string
    relativePath: string
    newName: string
    expectedHash: string
  }) {
    const relativePath = safeAttachmentPath(input.relativePath)
    const destinationPath = safeAttachmentPath(
      posix.join(posix.dirname(relativePath), input.newName),
    )
    return this.moveAttachment({ ...input, relativePath, destinationPath })
  }

  async moveAttachment(input: {
    projectId: string
    relativePath: string
    destinationPath: string
    expectedHash: string
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeAttachmentPath(input.relativePath)
      const destinationPath = safeAttachmentPath(input.destinationPath)
      const current = await this.readAttachment(input.projectId, relativePath)
      assertAttachmentHash(current.contentHash, input.expectedHash, "move")
      const bytes = Buffer.from(current.dataBase64, "base64")
      validateAttachment(destinationPath, current.mimeType, bytes)
      await writeFileInsideRoot(
        root,
        destinationPath,
        { data: bytes },
        { createParents: true, expectedSha256: null },
      )
      try {
        await removeFileInsideRoot(root, relativePath, {
          beforeCommit: async () => {
            const latest = await readFileInsideRoot(root, relativePath, {
              maxBytes: MAX_ATTACHMENT_BYTES,
            })
            assertAttachmentHash(sha256(latest), input.expectedHash, "move")
          },
        })
      } catch (error) {
        await removeFileInsideRoot(root, destinationPath, { removeEmptyParent: true }).catch(
          () => undefined,
        )
        throw error
      }
      return attachmentResult(destinationPath, bytes)
    })
  }

  async removeAttachment(input: { projectId: string; relativePath: string; expectedHash: string }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeAttachmentPath(input.relativePath)
      const current = await this.readAttachment(input.projectId, relativePath)
      assertAttachmentHash(current.contentHash, input.expectedHash, "delete")
      const trashId = randomUUID()
      const trashPath = posix.join(
        ".flapstack-trash",
        `${trashId}${posix.extname(relativePath).toLocaleLowerCase("en-US")}`,
      )
      const bytes = Buffer.from(current.dataBase64, "base64")
      await writeFileInsideRoot(
        root,
        trashPath,
        { data: bytes },
        { createParents: true, expectedSha256: null },
      )
      try {
        await removeFileInsideRoot(root, relativePath, {
          beforeCommit: async () => {
            const latest = await readFileInsideRoot(root, relativePath, {
              maxBytes: MAX_ATTACHMENT_BYTES,
            })
            assertAttachmentHash(sha256(latest), input.expectedHash, "delete")
          },
        })
      } catch (error) {
        await removeFileInsideRoot(root, trashPath, { removeEmptyParent: true }).catch(
          () => undefined,
        )
        throw error
      }
      return {
        trashId,
        relativePath,
        contentHash: current.contentHash,
        mimeType: current.mimeType,
      }
    })
  }

  async restoreAttachment(input: {
    projectId: string
    trashId: string
    relativePath: string
    expectedHash: string
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeAttachmentPath(input.relativePath)
      const trashId = z.string().uuid().parse(input.trashId)
      const trashPath = posix.join(
        ".flapstack-trash",
        `${trashId}${posix.extname(relativePath).toLocaleLowerCase("en-US")}`,
      )
      const bytes = await readFileInsideRoot(root, trashPath, {
        maxBytes: MAX_ATTACHMENT_BYTES,
      })
      assertAttachmentHash(sha256(bytes), input.expectedHash, "restore")
      const result = attachmentResult(relativePath, bytes)
      await writeFileInsideRoot(
        root,
        relativePath,
        { data: bytes },
        { createParents: true, expectedSha256: null },
      )
      try {
        await removeFileInsideRoot(root, trashPath, { removeEmptyParent: true })
      } catch (error) {
        await removeFileInsideRoot(root, relativePath, { removeEmptyParent: true }).catch(
          () => undefined,
        )
        throw error
      }
      return result
    })
  }

  async remove(input: {
    projectId: string
    relativePath: string
    expectedVersion: number
    expectedHash: string
  }): Promise<{ trashId: string; relativePath: string; version: number }> {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeNotePath(input.relativePath)
      this.#assertNotSeed(input.projectId, relativePath)
      const current = await this.#read(input.projectId, relativePath, true)
      this.#assertExact(current, input.expectedVersion, input.expectedHash, "delete")
      const deletionKey = noteKey(input.projectId, current.identity!.id)
      inFlightNoteDeletes.add(deletionKey)
      try {
        const trashId = randomUUID()
        const trashPath = posix.join(".flapstack-trash", `${trashId}.md`)
        await writeFileInsideRoot(
          root,
          trashPath,
          { data: current.content },
          {
            createParents: true,
            expectedSha256: null,
          },
        )
        const nextVersion = input.expectedVersion + 1
        let marked: Database.RunResult
        try {
          marked = this.sqlite
            .prepare(
              `UPDATE project_vault_custom_notes
             SET relative_path = ?, version = ?, trash_id = ?, deleted_at = ?, updated_at = ?
             WHERE project_id = ? AND stable_id = ? AND version = ? AND deleted_at IS NULL`,
            )
            .run(
              trashPath,
              nextVersion,
              trashId,
              now(),
              now(),
              input.projectId,
              current.identity!.id,
              input.expectedVersion,
            )
        } catch (error) {
          await removeFileInsideRoot(root, trashPath, { removeEmptyParent: true }).catch(
            () => undefined,
          )
          throw error
        }
        if (marked.changes !== 1) {
          await removeFileInsideRoot(root, trashPath, { removeEmptyParent: true }).catch(
            () => undefined,
          )
          throw new ProjectVaultNoteConflictError(
            "Project note metadata changed before delete.",
            current.contentHash,
          )
        }
        try {
          await this.hooks.afterDeleteMetadataCommitted?.()
          await actOnPathInsideRoot(root, relativePath, async (targetPath) => {
            const latest = await readFile(targetPath)
            if (sha256(latest) !== input.expectedHash) {
              throw new ProjectVaultNoteConflictError(
                "Project note changed before delete.",
                sha256(latest),
              )
            }
            await rm(targetPath)
          })
        } catch (error) {
          const rolledBack = this.sqlite
            .prepare(
              `UPDATE project_vault_custom_notes
             SET relative_path = ?, version = ?, trash_id = NULL, deleted_at = NULL, updated_at = ?
             WHERE project_id = ? AND stable_id = ? AND version = ? AND trash_id = ?
               AND deleted_at IS NOT NULL`,
            )
            .run(
              relativePath,
              input.expectedVersion,
              now(),
              input.projectId,
              current.identity!.id,
              nextVersion,
              trashId,
            )
          if (rolledBack.changes === 1) {
            await removeFileInsideRoot(root, trashPath, { removeEmptyParent: true }).catch(
              () => undefined,
            )
          }
          throw error
        }
        return { trashId, relativePath, version: nextVersion }
      } finally {
        inFlightNoteDeletes.delete(deletionKey)
      }
    })
  }

  async restore(input: {
    projectId: string
    trashId: string
    relativePath: string
    expectedVersion: number
  }) {
    return withLock(input.projectId, async () => {
      const root = this.#root(input.projectId)
      const relativePath = safeNotePath(input.relativePath)
      this.#assertNotSeed(input.projectId, relativePath)
      const trashId = z.string().uuid().parse(input.trashId)
      const trashPath = posix.join(".flapstack-trash", `${trashId}.md`)
      const bytes = await readFileInsideRoot(root, trashPath, { maxBytes: MAX_NOTE_BYTES })
      const content = bytes.toString("utf8")
      validateContent(content)
      const identity = parseObsidianNote(content, relativePath).identity
      const metadata = identity?.id ? this.#metadata(input.projectId, identity.id) : undefined
      if (
        !metadata ||
        metadata.trashId !== trashId ||
        metadata.version !== input.expectedVersion ||
        metadata.deletedAt === null
      ) {
        throw new ProjectVaultNoteConflictError(
          "Project note trash version changed before restore.",
          sha256(content),
        )
      }
      const existing = await readFileInsideRoot(root, relativePath, {
        maxBytes: MAX_NOTE_BYTES,
      }).catch((error: unknown) => {
        if (isMissingPathError(error)) return null
        throw error
      })
      if (existing && sha256(existing) !== sha256(bytes)) {
        throw new ProjectVaultNoteConflictError(
          "Project note destination changed before restore.",
          sha256(existing),
        )
      }
      const createdDestination = existing === null
      if (createdDestination) {
        await writeFileInsideRoot(
          root,
          relativePath,
          { data: bytes },
          {
            createParents: true,
            expectedSha256: null,
          },
        )
      }
      const nextVersion = input.expectedVersion + 1
      try {
        const restored = this.sqlite
          .prepare(
            `UPDATE project_vault_custom_notes
             SET relative_path = ?, version = ?, deleted_at = NULL, updated_at = ?
             WHERE project_id = ? AND stable_id = ? AND version = ? AND trash_id = ?
               AND deleted_at IS NOT NULL`,
          )
          .run(
            relativePath,
            nextVersion,
            now(),
            input.projectId,
            identity!.id,
            input.expectedVersion,
            trashId,
          )
        if (restored.changes !== 1) {
          throw new ProjectVaultNoteConflictError(
            "Project note metadata changed before restore.",
            sha256(content),
          )
        }
      } catch (error) {
        if (createdDestination) {
          await removeFileInsideRoot(root, relativePath).catch(() => undefined)
        }
        throw error
      }
      try {
        await removeFileInsideRoot(root, trashPath, { removeEmptyParent: true }).catch(
          (error: unknown) => {
            if (!isMissingPathError(error)) throw error
          },
        )
        this.sqlite
          .prepare(
            `UPDATE project_vault_custom_notes
             SET trash_id = NULL, updated_at = ?
             WHERE project_id = ? AND stable_id = ? AND version = ? AND trash_id = ?
               AND deleted_at IS NULL`,
          )
          .run(now(), input.projectId, identity!.id, nextVersion, trashId)
      } catch {
        // Keep trash_id on the restored active row. read() retries the cleanup
        // without making the restored note unavailable.
      }
      return noteResult(relativePath, content, nextVersion, false)
    })
  }

  async #reconcileStartupInterruptedDelete(input: {
    projectId: string
    stableId: string
    relativePath: string
    root: string
    contentHash: string
    mutationLockHeld: boolean
  }): Promise<NoteMetadata | undefined> {
    const key = noteKey(input.projectId, input.stableId)
    this.hooks.beforeStartupDeleteReconciliationWait?.()
    const reconcile = async () => {
      const metadata = this.#metadata(input.projectId, input.stableId)
      const trashId = metadata?.trashId
      if (
        !this.startupDeletedNoteKeys.has(key) ||
        inFlightNoteDeletes.has(key) ||
        !metadata ||
        !trashId
      ) {
        return undefined
      }
      const trashPath = posix.join(".flapstack-trash", `${trashId}.md`)
      if (
        metadata.deletedAt === null ||
        metadata.relativePath !== trashPath ||
        metadata.contentHash !== input.contentHash
      ) {
        return undefined
      }
      const trashBytes = await readFileInsideRoot(input.root, trashPath, {
        maxBytes: MAX_NOTE_BYTES,
      }).catch((error: unknown) => {
        if (isMissingPathError(error)) return null
        throw error
      })
      if (!trashBytes || sha256(trashBytes) !== input.contentHash) return undefined

      // Re-read the original source after every awaited check and while holding
      // the project mutation lock. The metadata CAS below is synchronous, so a
      // completed concurrent delete cannot be resurrected without its source.
      const sourceBytes = await readFileInsideRoot(input.root, input.relativePath, {
        maxBytes: MAX_NOTE_BYTES,
      }).catch((error: unknown) => {
        if (isMissingPathError(error)) return null
        throw error
      })
      if (!sourceBytes || sha256(sourceBytes) !== input.contentHash) return undefined

      const reconciled = this.sqlite
        .prepare(
          `UPDATE project_vault_custom_notes
           SET relative_path = ?, deleted_at = NULL, updated_at = ?
           WHERE project_id = ? AND stable_id = ? AND version = ? AND content_hash = ?
             AND relative_path = ? AND trash_id = ? AND deleted_at IS NOT NULL`,
        )
        .run(
          input.relativePath,
          now(),
          input.projectId,
          input.stableId,
          metadata.version,
          input.contentHash,
          trashPath,
          trashId,
        )
      this.startupDeletedNoteKeys.delete(key)
      if (reconciled.changes === 1) {
        return {
          ...metadata,
          relativePath: input.relativePath,
          deletedAt: null,
        }
      }
      const latest = this.#metadata(input.projectId, input.stableId)
      return latest?.deletedAt === null && latest.relativePath === input.relativePath
        ? latest
        : undefined
    }
    return input.mutationLockHeld ? reconcile() : withLock(input.projectId, reconcile)
  }

  #metadata(projectId: string, stableId: string): NoteMetadata | undefined {
    return this.sqlite
      .prepare(
        `SELECT stable_id stableId, relative_path relativePath, version, content_hash contentHash,
                trash_id trashId, deleted_at deletedAt
         FROM project_vault_custom_notes WHERE project_id = ? AND stable_id = ?`,
      )
      .get(projectId, stableId) as NoteMetadata | undefined
  }

  #assertExact(
    current: ReturnType<typeof noteResult>,
    expectedVersion: number,
    expectedHash: string,
    operation: string,
  ): void {
    if (
      current.version !== expectedVersion ||
      current.externallyModified ||
      current.contentHash !== expectedHash
    ) {
      throw new ProjectVaultNoteConflictError(
        `Project note changed before ${operation}.`,
        current.contentHash,
      )
    }
  }

  #root(projectId: string): string {
    const row = this.sqlite
      .prepare("SELECT root_path AS rootPath FROM project_vaults WHERE project_id = ?")
      .get(projectId) as { rootPath: string } | undefined
    if (!row) throw new Error("Project vault is not scaffolded.")
    return assertRegisteredFilesystemRoot(row.rootPath, drizzle(this.sqlite, { schema }))
      .canonicalPath
  }

  #assertNotSeed(projectId: string, relativePath: string): void {
    const normalized = relativePath.normalize("NFKC").toLocaleLowerCase("en-US")
    const seeds = this.sqlite
      .prepare(
        "SELECT relative_path AS relativePath FROM project_vault_sections WHERE project_id = ?",
      )
      .all(projectId) as Array<{ relativePath: string }>
    if (
      seeds.some(
        (seed) =>
          seed.relativePath.replace(/\\/g, "/").normalize("NFKC").toLocaleLowerCase("en-US") ===
          normalized,
      )
    ) {
      throw new Error("Seed project notes use the typed section workflow.")
    }
  }

  #assertFolderContainsNoSeeds(projectId: string, relativePath: string): void {
    const normalized = `${relativePath.normalize("NFKC").toLocaleLowerCase("en-US")}/`
    const seeds = this.sqlite
      .prepare(
        "SELECT relative_path AS relativePath FROM project_vault_sections WHERE project_id = ?",
      )
      .all(projectId) as Array<{ relativePath: string }>
    if (
      seeds.some((seed) =>
        seed.relativePath
          .replace(/\\/g, "/")
          .normalize("NFKC")
          .toLocaleLowerCase("en-US")
          .startsWith(normalized),
      )
    ) {
      throw new Error("Folders containing seed project notes cannot be renamed or removed.")
    }
  }
}

function safeNotePath(value: string): string {
  const normalized = safeVisiblePath(value, true)
  if (!normalized.toLocaleLowerCase("en-US").endsWith(".md")) {
    throw new Error("Project notes must use the .md extension.")
  }
  if (Buffer.byteLength(normalized, "utf8") > 1_000)
    throw new Error("Project note path is too long.")
  return normalized
}

function safeVisiblePath(value: string, requireFile: boolean): string {
  if (value.includes("\0") || value.includes("\\")) throw new Error("Invalid project vault path.")
  const normalized = posix.normalize(value.normalize("NFKC").trim())
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized
      .split("/")
      .some((part) => !part || part === ".obsidian" || part.startsWith(".flapstack"))
  ) {
    throw new Error("Project vault path must stay in a visible folder inside the vault.")
  }
  if (requireFile && !posix.basename(normalized).includes(".")) {
    throw new Error("Project vault file must have an extension.")
  }
  if (Buffer.byteLength(normalized, "utf8") > 1_000)
    throw new Error("Project vault path is too long.")
  return normalized
}

function safeAttachmentPath(value: string): string {
  const relativePath = safeVisiblePath(value, true)
  if (!attachmentFormat(relativePath)) {
    throw new Error("Project vault attachment extension is unsupported.")
  }
  return relativePath
}

function safeTitle(value: string): string {
  return z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (title) => !/[\r\n\u0000]/.test(title),
      "Project note title contains invalid characters.",
    )
    .parse(value)
}

function validateContent(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_NOTE_BYTES) {
    throw new Error("Project note exceeds the 1 MiB limit.")
  }
  assertProjectVaultContentSafe(content)
}

function noteResult(
  relativePath: string,
  content: string,
  version: number,
  externallyModified: boolean,
) {
  const parsed = parseObsidianNote(content, relativePath)
  return {
    relativePath,
    content,
    version,
    contentHash: sha256(content),
    externallyModified,
    identity: parsed.identity,
    title:
      parsed.headings.find((heading) => heading.depth === 1)?.text ?? basename(relativePath, ".md"),
    diagnostics: parsed.diagnostics,
  }
}

function validateAttachment(relativePath: string, declaredMimeType: string, bytes: Buffer): string {
  const declared = declaredMimeType.trim().toLocaleLowerCase("en-US")
  const format = attachmentFormat(relativePath)
  if (!format || declared !== format.mimeType) {
    throw new Error("Project vault attachment MIME type or extension is unsupported.")
  }
  if (!format.signature(bytes)) {
    throw new Error("Project vault attachment signature does not match its MIME type.")
  }
  return format.mimeType
}

function attachmentFormat(relativePath: string) {
  const formats: Record<string, { mimeType: string; signature: (value: Buffer) => boolean }> = {
    ".png": {
      mimeType: "image/png",
      signature: (value) =>
        value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
    ".jpg": {
      mimeType: "image/jpeg",
      signature: (value) => value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff,
    },
    ".jpeg": {
      mimeType: "image/jpeg",
      signature: (value) => value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff,
    },
    ".gif": {
      mimeType: "image/gif",
      signature: (value) =>
        value.subarray(0, 6).toString("ascii") === "GIF87a" ||
        value.subarray(0, 6).toString("ascii") === "GIF89a",
    },
    ".webp": {
      mimeType: "image/webp",
      signature: (value) =>
        value.subarray(0, 4).toString("ascii") === "RIFF" &&
        value.subarray(8, 12).toString("ascii") === "WEBP",
    },
  }
  return formats[posix.extname(relativePath).toLocaleLowerCase("en-US")]
}

function attachmentResult(relativePath: string, bytes: Buffer) {
  const format = attachmentFormat(relativePath)
  if (!format) throw new Error("Project vault attachment extension is unsupported.")
  validateAttachment(relativePath, format.mimeType, bytes)
  return {
    relativePath,
    mimeType: format.mimeType,
    byteLength: bytes.byteLength,
    contentHash: sha256(bytes),
    dataBase64: bytes.toString("base64"),
    embed: `![[${relativePath}]]`,
  }
}

function assertAttachmentHash(currentHash: string, expectedHash: string, operation: string): void {
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || currentHash !== expectedHash) {
    throw new ProjectVaultNoteConflictError(
      `Project vault attachment changed before ${operation}.`,
      currentHash,
    )
  }
}

function replaceStableIdentity(content: string, stableId: string): string {
  const replaced = content.replace(/^([ \t]*flapstack(?:_|-)id[ \t]*:[ \t]*).*$/im, `$1${stableId}`)
  if (replaced === content) {
    throw new Error("The local draft is missing its reserved stable identity.")
  }
  return replaced
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function now(): number {
  return Math.floor(Date.now() / 1_000)
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function noteKey(projectId: string, stableId: string): string {
  return `${projectId}\0${stableId}`
}

async function withLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationLocks.get(projectId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => gate)
  mutationLocks.set(projectId, tail)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (mutationLocks.get(projectId) === tail) mutationLocks.delete(projectId)
  }
}
