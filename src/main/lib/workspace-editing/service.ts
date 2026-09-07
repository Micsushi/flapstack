import { createHash, randomUUID } from "node:crypto"
import { lstatSync, realpathSync } from "node:fs"
import { isUtf8 } from "node:buffer"
import { basename, dirname, join, relative, sep } from "node:path"
import { lstat } from "node:fs/promises"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import {
  actOnPathInsideRoot,
  readFileInsideRoot,
  removeFileInsideRoot,
  renameFileInsideRoot,
  resolveInsideRoot,
  writeFileInsideRoot,
} from "../path-safety"
import { parseCustomPermissionToggles, parsePermissionMode } from "../permissions"
import { appendMcpAuditRecord } from "../mcp-control/audit-storage"
import {
  workspaceEditMaxBytes,
  workspaceEditScopeSchema,
  workspaceEditTargetSchema,
  saveWorkspaceEditSchema,
  revertWorkspaceEditSchema,
  saveAsWorkspaceEditSchema,
  renameWorkspaceEditSchema,
  updateWorkspaceDraftSchema,
  releaseWorkspaceDraftSchema,
  saveWorkspaceDraftSchema,
  pendingWorkspaceDraftSaveSchema,
  readWorkspaceDraftSchema,
  type WorkspaceEditScope,
  type SaveWorkspaceEdit,
} from "../../../shared/workspace-edits"
import type { z } from "zod"

type Database = BetterSQLite3Database<typeof schema>
type Row = typeof schema.workspaceEdits.$inferSelect
type Draft = typeof schema.workspaceDrafts.$inferSelect
type EditInput = Omit<SaveWorkspaceEdit, "expectedSha256"> & { expectedSha256: string | null }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const locks = new Map<string, Promise<void>>()
export type WorkspaceDraftOwner = { windowId: number; isAlive: (id: number) => boolean }
const draftOwners = new Map<
  string,
  {
    windowId: number
    token: string
    canonicalPath: string
    fileIdentity: string
    saving?: boolean
  }
>()
const fileIdentity = (path: string) => {
  const info = lstatSync(path, { bigint: true })
  return JSON.stringify([info.dev.toString(), info.ino.toString()])
}

export class WorkspaceEditConflictError extends Error {
  constructor(public readonly diskSha256: string | null) {
    super("File changed on disk. Keep the draft and reload or review before saving.")
    this.name = "WorkspaceEditConflictError"
  }
}

function text(bytes: Buffer) {
  if (bytes.byteLength > workspaceEditMaxBytes) throw new Error("File exceeds the 2 MiB edit limit")
  if (bytes.includes(0) || !isUtf8(bytes)) throw new Error("Editing requires non-binary UTF-8 text")
  return bytes.toString("utf8")
}

// One authority per canonical root in this main process; external edits still require CAS.
async function withRootLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  root = realpathSync.native(root)
  const previous = locks.get(root) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  locks.set(root, queued)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (locks.get(root) === queued) locks.delete(root)
  }
}

export class WorkspaceEditingService {
  constructor(
    private readonly db: Database,
    private readonly write = writeFileInsideRoot,
    private readonly remove = removeFileInsideRoot,
    private readonly renameFile = renameFileInsideRoot,
  ) {}

  private scope(input: WorkspaceEditScope) {
    const scope = workspaceEditScopeSchema.parse(input)
    const chat = this.db.select().from(schema.chats).where(eq(schema.chats.id, scope.chatId)).get()
    const project = this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, scope.projectId))
      .get()
    if (!chat || !project || chat.projectId !== project.id || chat.archivedAt || project.archivedAt)
      throw new Error("Editor scope is unavailable or belongs to another project")
    if (!chat.worktreePath) throw new Error("Editing requires a registered chat worktree")
    const root = assertRegisteredFilesystemRoot(chat.worktreePath, this.db)
    const identity = JSON.stringify([root.canonicalPath, root.deviceId, root.inodeId])
    return { chat, root, identity }
  }

  private writable(input: WorkspaceEditScope, intent: "save" | "autosave") {
    const scope = this.scope(input)
    const mode = parsePermissionMode(scope.chat.permissionMode)
    if (!mode || mode === "read-only") throw new Error("This chat does not permit file edits")
    if (mode === "ask-before-edits" && intent === "autosave")
      throw new Error("This chat requires an explicit Save for each edit")
    if (mode === "custom") {
      let custom
      try {
        custom = parseCustomPermissionToggles(JSON.parse(scope.chat.customPermissions ?? "null"))
      } catch {
        /* Invalid policy denies writes. */
      }
      if (!custom?.projectWrite) throw new Error("Custom permissions do not permit project writes")
    }
    return scope
  }

  private path(root: string, path: string) {
    if (path.split(sep === "\\" ? /[\\/]/ : /\//).some((part) => part === ".."))
      throw new Error("Editor path cannot contain traversal")
    const result = relative(root, resolveInsideRoot(root, path))
    if (!result) throw new Error("Editor target must be a file")
    return result
  }

  async read(input: z.infer<typeof workspaceEditTargetSchema>, exactName = false) {
    const value = workspaceEditTargetSchema.parse(input)
    const scope = this.scope(value)
    const path = this.path(scope.root.canonicalPath, value.relativePath)
    const bytes = await readFileInsideRoot(scope.root.canonicalPath, path, {
      maxBytes: workspaceEditMaxBytes,
      exactName,
    })
    if (this.scope(value).identity !== scope.identity) throw new Error("Editor root changed")
    return { content: text(bytes), sha256: hash(bytes), byteLength: bytes.byteLength }
  }

  private dto(row: Row) {
    return {
      id: row.id,
      relativePath: row.relativePath,
      state: row.state,
      beforeSha256: row.beforeSha256,
      afterSha256: row.afterSha256,
      revertsId: row.revertsId,
      kind: row.kind,
      previousRelativePath: row.previousRelativePath,
      createdAt: row.createdAt,
    }
  }

  private draftRecoveryScope(input: WorkspaceEditScope) {
    const scope = this.scope(input)
    const path = realpathSync.native(scope.root.canonicalPath)
    return { path, identity: JSON.stringify([path, scope.root.deviceId, scope.root.inodeId]) }
  }

  private draftRoot(input: WorkspaceEditScope) {
    this.writable(input, "save")
    return this.draftRecoveryScope(input)
  }

  listDrafts(input: WorkspaceEditScope) {
    const value = workspaceEditScopeSchema.parse(input)
    const root = this.draftRecoveryScope(value)
    return this.db
      .select({
        id: schema.workspaceDrafts.id,
        relativePath: schema.workspaceDrafts.relativePath,
        revision: schema.workspaceDrafts.revision,
        updatedAt: schema.workspaceDrafts.updatedAt,
        byteLength: sql<number>`length(CAST(${schema.workspaceDrafts.content} AS BLOB))`,
      })
      .from(schema.workspaceDrafts)
      .where(
        and(
          eq(schema.workspaceDrafts.projectId, value.projectId),
          eq(schema.workspaceDrafts.chatId, value.chatId),
          eq(schema.workspaceDrafts.rootIdentity, root.identity),
        ),
      )
      .orderBy(desc(schema.workspaceDrafts.updatedAt), schema.workspaceDrafts.id)
      .limit(1000)
      .all()
  }

  readDraft(input: z.infer<typeof readWorkspaceDraftSchema>) {
    const value = readWorkspaceDraftSchema.parse(input)
    const root = this.draftRecoveryScope(value)
    const draft = this.db
      .select()
      .from(schema.workspaceDrafts)
      .where(
        and(
          eq(schema.workspaceDrafts.id, value.draftId),
          eq(schema.workspaceDrafts.projectId, value.projectId),
          eq(schema.workspaceDrafts.chatId, value.chatId),
          eq(schema.workspaceDrafts.rootIdentity, root.identity),
        ),
      )
      .get()
    if (!draft) throw new Error("Draft scope or root changed")
    return draft
  }

  private draft(input: WorkspaceEditScope, id: string) {
    this.writable(input, "save")
    return this.readDraft({ ...input, draftId: id })
  }

  private draftLease(id: string, token: string, owner: WorkspaceDraftOwner) {
    const lease = draftOwners.get(id)
    if (
      !owner.isAlive(owner.windowId) ||
      lease?.windowId !== owner.windowId ||
      lease.token !== token
    )
      throw new Error("Draft is not owned by this editor. Reopen it to recover the buffer.")
    return lease
  }

  private draftSaveHash(
    row: Pick<Draft, "id" | "projectId" | "chatId">,
    pending: z.infer<typeof pendingWorkspaceDraftSaveSchema>,
  ) {
    return hash(
      JSON.stringify([
        "draft-save-v1",
        row.projectId,
        row.chatId,
        row.id,
        pending.id,
        pending.revision,
        pending.intent,
      ]),
    )
  }

  /** Reconcile only metadata; reopening a draft never resumes a file write. */
  private async reconcileDraftSave(row: Draft, authority: WorkspaceEditScope) {
    if (!row.pendingSave) return row
    const pending = pendingWorkspaceDraftSaveSchema.parse(JSON.parse(row.pendingSave))
    let operation = this.db
      .select()
      .from(schema.workspaceEdits)
      .where(eq(schema.workspaceEdits.id, pending.id))
      .get()
    if (operation) {
      if (
        operation.requestHash !== this.draftSaveHash(row, pending) ||
        operation.rootIdentity !== this.scope(authority).identity
      )
        throw new Error("Pending draft save identity changed; buffer preserved")
      if (operation.state === "prepared") operation = await this.recover(operation, authority)
      // Expiry no longer proves whether the original operation applied or failed.
      if (operation.state === "expired") return row
    }
    const baseSha256 =
      operation?.state === "applied" && row.baseSha256 === operation.beforeSha256
        ? operation.afterSha256
        : row.baseSha256
    const updated = this.db
      .update(schema.workspaceDrafts)
      .set({
        pendingSave: null,
        baseSha256,
        revision: row.revision + (baseSha256 !== row.baseSha256 ? 1 : 0),
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(schema.workspaceDrafts.id, row.id),
          eq(schema.workspaceDrafts.revision, row.revision),
        ),
      )
      .returning()
      .get()
    if (!updated) throw new Error("Draft revision changed during save recovery")
    return updated
  }

  async saveDraft(input: z.infer<typeof saveWorkspaceDraftSchema>, owner: WorkspaceDraftOwner) {
    const value = saveWorkspaceDraftSchema.parse(input)
    this.writable(value, value.intent)
    const root = this.draftRoot(value)
    return withRootLock(root.path, async () => {
      let draft = this.draft(value, value.draftId)
      this.draftLease(draft.id, value.leaseToken, owner)
      this.writable(value, value.intent)
      const pending = { id: value.id, revision: value.expectedRevision, intent: value.intent }
      const requestHash = this.draftSaveHash(draft, pending)
      let previous = this.db
        .select()
        .from(schema.workspaceEdits)
        .where(eq(schema.workspaceEdits.id, value.id))
        .get()
      if (previous) {
        if (
          previous.requestHash !== requestHash ||
          previous.rootIdentity !== this.scope(value).identity
        )
          throw new Error("Edit id was reused for a different draft save")
        if (previous.state === "prepared") previous = await this.recover(previous, value)
        draft = await this.reconcileDraftSave(draft, value)
        return { operation: this.dto(previous), draft }
      }
      draft = await this.reconcileDraftSave(draft, value)
      if (draft.pendingSave) throw new Error("An expired draft save requires explicit recovery")
      if (draft.revision !== value.expectedRevision)
        throw new Error("Draft revision changed; keep the local buffer")
      const lease = this.draftLease(draft.id, value.leaseToken, owner)
      try {
        if (
          realpathSync.native(resolveInsideRoot(root.path, draft.relativePath)) !==
          draft.canonicalPath
        )
          throw new Error("Draft file path changed; reopen it before saving")
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT")
          throw new WorkspaceEditConflictError(null)
        throw error
      }
      const pendingDraft = this.db
        .update(schema.workspaceDrafts)
        .set({ pendingSave: JSON.stringify(pending) })
        .where(eq(schema.workspaceDrafts.id, draft.id))
        .returning()
        .get()!
      lease.saving = true
      try {
        const operation = await this.saveRecord(
          {
            ...value,
            relativePath: draft.relativePath,
            expectedSha256: draft.baseSha256,
            content: draft.content,
          },
          null,
          "save",
          0o600,
          null,
          requestHash,
        )
        return { operation, draft: await this.reconcileDraftSave(pendingDraft, value) }
      } catch (error) {
        try {
          await this.reconcileDraftSave(pendingDraft, value)
        } catch {
          /* Preserve pending recovery metadata. */
        }
        throw error
      } finally {
        lease.saving = false
      }
    })
  }

  /** Called only with a main-process window identity, never a renderer-supplied id. */
  async openDraft(input: z.infer<typeof workspaceEditTargetSchema>, owner: WorkspaceDraftOwner) {
    const value = workspaceEditTargetSchema.parse(input)
    if (!owner.isAlive(owner.windowId)) throw new Error("An active desktop window is required")
    const root = this.draftRoot(value)
    return withRootLock(root.path, async () => {
      if (this.draftRoot(value).identity !== root.identity) throw new Error("Editor root changed")
      const path = this.path(root.path, value.relativePath)
      const target = resolveInsideRoot(root.path, path)
      const before = fileIdentity(target)
      let disk = await this.read(value)
      const canonicalPath = realpathSync.native(target)
      this.path(root.path, relative(root.path, canonicalPath))
      if (before !== fileIdentity(target) || this.draftRoot(value).identity !== root.identity)
        throw new Error("Editor target changed while opening")
      if (!owner.isAlive(owner.windowId)) throw new Error("Editor window closed while opening")
      const inspectOwners = () => {
        const replacedLeases: string[] = []
        for (const [id, lease] of draftOwners) {
          if (!owner.isAlive(lease.windowId) && !lease.saving) {
            replacedLeases.push(id)
            continue
          }
          let currentIdentity = lease.fileIdentity
          try {
            currentIdentity = fileIdentity(lease.canonicalPath)
          } catch {
            /* Keep the original alias reserved. */
          }
          if (
            lease.canonicalPath === canonicalPath ||
            lease.fileIdentity === before ||
            currentIdentity === before
          ) {
            if (lease.saving) throw new Error("A save is in progress; reopen after it finishes")
            if (lease.windowId !== owner.windowId)
              throw new Error("This file is already editable in another window")
            replacedLeases.push(id)
          }
        }
        return replacedLeases
      }
      let replacedLeases = inspectOwners()
      let row = this.db
        .select()
        .from(schema.workspaceDrafts)
        .where(
          and(
            eq(schema.workspaceDrafts.chatId, value.chatId),
            eq(schema.workspaceDrafts.rootIdentity, root.identity),
            eq(schema.workspaceDrafts.canonicalPath, canonicalPath),
          ),
        )
        .get()
      if (!row) {
        this.db.transaction((tx) => {
          const usage = tx
            .select({
              count: sql<number>`count(*)`,
              bytes: sql<number>`coalesce(sum(length(cast(${schema.workspaceDrafts.content} as blob))), 0)`,
            })
            .from(schema.workspaceDrafts)
            .get()!
          if (usage.count >= 1000 || usage.bytes + disk.byteLength > 64 * 1024 * 1024)
            throw new Error("Draft storage is full; existing buffers were preserved")
          row = tx
            .insert(schema.workspaceDrafts)
            .values({
              id: randomUUID(),
              ...value,
              relativePath: relative(root.path, canonicalPath),
              rootIdentity: root.identity,
              canonicalPath,
              baseSha256: disk.sha256,
              content: disk.content,
              revision: 0,
              updatedAt: Date.now(),
            })
            .returning()
            .get()
        })
      }
      let draft = row!
      if (draft.projectId !== value.projectId) throw new Error("Draft project changed")
      if (draft.pendingSave) {
        draft = await this.reconcileDraftSave(draft, value)
        disk = await this.read(value)
        if (
          before !== fileIdentity(target) ||
          this.draftRoot(value).identity !== root.identity ||
          !owner.isAlive(owner.windowId)
        )
          throw new Error("Editor target or window changed during recovery")
        replacedLeases = inspectOwners()
      }
      if (!draftOwners.has(draft.id) && draftOwners.size - replacedLeases.length >= 64)
        throw new Error("Too many active editors; close an editor before opening another")
      // A fresh token fences delayed updates/releases from an earlier pane mount.
      const token = randomUUID()
      for (const id of replacedLeases) draftOwners.delete(id)
      draftOwners.set(draft.id, {
        windowId: owner.windowId,
        token,
        canonicalPath,
        fileIdentity: before,
      })
      return {
        draft,
        leaseToken: token,
        diskSha256: disk.sha256,
        conflict: !!draft.pendingSave || disk.sha256 !== draft.baseSha256,
      }
    })
  }

  async updateDraft(input: z.infer<typeof updateWorkspaceDraftSchema>, owner: WorkspaceDraftOwner) {
    const value = updateWorkspaceDraftSchema.parse(input)
    if (text(Buffer.from(value.content)) !== value.content)
      throw new Error("Draft contains invalid Unicode")
    const root = this.draftRoot(value)
    return withRootLock(root.path, async () => {
      const row = this.draft(value, value.draftId)
      this.draftLease(row.id, value.leaseToken, owner)
      if (row.revision !== value.expectedRevision) {
        if (row.revision === value.expectedRevision + 1 && row.content === value.content) return row
        throw new Error("Draft revision changed; keep the local buffer")
      }
      return this.db.transaction((tx) => {
        const usage = tx
          .select({
            bytes: sql<number>`coalesce(sum(length(cast(${schema.workspaceDrafts.content} as blob))), 0)`,
          })
          .from(schema.workspaceDrafts)
          .get()!
        if (
          usage.bytes - Buffer.byteLength(row.content) + Buffer.byteLength(value.content) >
          64 * 1024 * 1024
        )
          throw new Error("Draft storage is full; existing buffers were preserved")
        return tx
          .update(schema.workspaceDrafts)
          .set({ content: value.content, revision: row.revision + 1, updatedAt: Date.now() })
          .where(
            and(
              eq(schema.workspaceDrafts.id, row.id),
              eq(schema.workspaceDrafts.revision, row.revision),
            ),
          )
          .returning()
          .get()!
      })
    })
  }

  releaseDraft(input: z.infer<typeof releaseWorkspaceDraftSchema>, owner: WorkspaceDraftOwner) {
    const value = releaseWorkspaceDraftSchema.parse(input)
    const lease = draftOwners.get(value.draftId)
    // A stale unmount cannot release a newer mount's token. No buffer is deleted.
    if (lease?.windowId === owner.windowId && lease.token === value.leaseToken && !lease.saving)
      draftOwners.delete(value.draftId)
    return { released: !draftOwners.has(value.draftId) }
  }

  private finish(row: Row, state: "applied" | "failed" | "conflict") {
    return this.db.transaction((tx) => {
      const updated = tx
        .update(schema.workspaceEdits)
        .set({ state })
        .where(
          and(eq(schema.workspaceEdits.id, row.id), eq(schema.workspaceEdits.state, "prepared")),
        )
        .returning()
        .get()
      if (!updated) throw new Error("Edit journal changed during finalization")
      appendMcpAuditRecord(tx, {
        invocationId: row.id,
        caller: { chatId: row.chatId, projectId: row.projectId },
        toolName: row.revertsId ? "workspace.revert" : "workspace.save",
        tier: 2,
        status: state === "applied" ? "completed" : state === "conflict" ? "stale" : "failed",
        input: { id: row.id, sha256: row.beforeSha256 },
        result: {
          sha256: row.afterSha256,
          byteLength: Buffer.byteLength(row.afterContent),
          kind: row.kind,
          state,
        },
      })
      return updated
    })
  }

  private async recover(row: Row, authority: WorkspaceEditScope = row) {
    const scope = this.scope(authority)
    if (scope.identity !== row.rootIdentity || scope.root.canonicalPath !== row.rootPath)
      throw new Error("Edit history belongs to a different registered root")
    const exactName =
      row.kind === "rename" &&
      row.previousRelativePath?.toLowerCase() === row.relativePath.toLowerCase()
    const currentHash = await this.recoveryHash(row.rootPath, row.relativePath, exactName)
    if (row.kind === "rename") {
      if (!row.previousRelativePath) throw new Error("Rename history has no source path")
      const previousHash = await this.recoveryHash(
        row.rootPath,
        row.previousRelativePath,
        exactName,
      )
      if (this.scope(authority).identity !== row.rootIdentity)
        throw new Error("Editor root changed")
      return this.finish(
        row,
        previousHash === null && currentHash === row.afterSha256
          ? "applied"
          : previousHash === row.beforeSha256 && currentHash === null
            ? "failed"
            : "conflict",
      )
    }
    if (this.scope(authority).identity !== row.rootIdentity) throw new Error("Editor root changed")
    // Recovery only reconciles metadata. It never writes historical bytes over disk.
    return this.finish(
      row,
      currentHash === (row.kind === "remove" ? null : row.afterSha256)
        ? "applied"
        : currentHash === (row.kind === "create" ? null : row.beforeSha256)
          ? "failed"
          : "conflict",
    )
  }

  private async recoveryHash(
    root: string,
    path: string,
    exactName = false,
  ): Promise<string | null | undefined> {
    try {
      return hash(
        await readFileInsideRoot(root, path, { maxBytes: workspaceEditMaxBytes, exactName }),
      )
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
      // Unreadable bytes remain unknown, distinct from a verified missing target.
      return undefined
    }
  }

  async history(input: WorkspaceEditScope) {
    this.scope(input)
    return this.db
      .select()
      .from(schema.workspaceEdits)
      .where(
        and(
          eq(schema.workspaceEdits.projectId, input.projectId),
          eq(schema.workspaceEdits.chatId, input.chatId),
        ),
      )
      .orderBy(desc(schema.workspaceEdits.createdAt), desc(schema.workspaceEdits.id))
      .limit(100)
      .all()
      .map((row) => this.dto(row))
  }

  async save(input: SaveWorkspaceEdit) {
    const value = saveWorkspaceEditSchema.parse(input)
    const scope = this.writable(value, value.intent)
    return withRootLock(scope.root.canonicalPath, () => {
      if (this.writable(value, value.intent).identity !== scope.identity)
        throw new Error("Editor root changed")
      return this.saveRecord(value, null)
    })
  }

  async revert(input: z.infer<typeof revertWorkspaceEditSchema>) {
    const value = revertWorkspaceEditSchema.parse(input)
    const scope = this.writable(value, "save")
    return withRootLock(scope.root.canonicalPath, async () => {
      if (this.writable(value, "save").identity !== scope.identity)
        throw new Error("Editor root changed")
      const existing = this.db
        .select()
        .from(schema.workspaceEdits)
        .where(eq(schema.workspaceEdits.id, value.id))
        .get()
      if (existing) {
        if (
          existing.projectId !== value.projectId ||
          existing.chatId !== value.chatId ||
          existing.revertsId !== value.operationId ||
          existing.rootIdentity !== scope.identity ||
          existing.rootPath !== scope.root.canonicalPath
        )
          throw new Error("Edit id was reused for a different request")
        return this.dto(existing.state === "prepared" ? await this.recover(existing) : existing)
      }
      let row = this.db
        .select()
        .from(schema.workspaceEdits)
        .where(eq(schema.workspaceEdits.id, value.operationId))
        .get()
      if (!row || row.chatId !== value.chatId || row.projectId !== value.projectId)
        throw new Error("Edit is unavailable in this scope")
      if (row.state === "prepared") {
        row = await this.recover(row)
      }
      if (row.state === "expired") throw new Error("This edit is outside the retained undo history")
      if (row.state !== "applied") throw new Error("Only an applied edit can be reversed")
      if (this.scope(value).identity !== row.rootIdentity)
        throw new Error("Edit history belongs to a different registered root")
      if (row.kind === "rename" && !row.previousRelativePath)
        throw new Error("Rename history has no source path")
      return this.saveRecord(
        {
          ...value,
          relativePath: row.kind === "rename" ? row.previousRelativePath! : row.relativePath,
          expectedSha256: row.kind === "remove" ? null : row.afterSha256,
          content: row.beforeContent,
          intent: "save",
        },
        row.id,
        row.kind === "create" ? "remove" : row.kind === "remove" ? "create" : row.kind,
        row.fileMode,
        row.kind === "rename" ? row.relativePath : null,
      )
    })
  }

  async saveAs(input: z.infer<typeof saveAsWorkspaceEditSchema>) {
    const value = saveAsWorkspaceEditSchema.parse(input)
    const scope = this.writable(value, "save")
    return withRootLock(scope.root.canonicalPath, () => {
      if (this.writable(value, "save").identity !== scope.identity)
        throw new Error("Editor root changed")
      return this.saveRecord({ ...value, expectedSha256: null, intent: "save" }, null, "create")
    })
  }

  async rename(input: z.infer<typeof renameWorkspaceEditSchema>) {
    const value = renameWorkspaceEditSchema.parse(input)
    const scope = this.writable(value, "save")
    const from = this.path(scope.root.canonicalPath, value.relativePath)
    return withRootLock(scope.root.canonicalPath, () => {
      if (this.writable(value, "save").identity !== scope.identity)
        throw new Error("Editor root changed")
      return this.saveRecord(
        { ...value, relativePath: join(dirname(from), value.newName), content: "", intent: "save" },
        null,
        "rename",
        0o600,
        from,
      )
    })
  }

  private async saveRecord(
    input: EditInput,
    revertsId: string | null,
    kind: Row["kind"] = "save",
    fileMode = 0o600,
    renameFrom: string | null = null,
    draftRequestHash?: string,
  ) {
    const scope = this.writable(input, input.intent)
    const path = this.path(scope.root.canonicalPath, input.relativePath)
    if (renameFrom !== null) {
      renameFrom = this.path(scope.root.canonicalPath, renameFrom)
      if (path === renameFrom || dirname(path) !== dirname(renameFrom))
        throw new Error("Rename requires a different name in the same directory")
    }
    const exactName = renameFrom !== null && renameFrom.toLowerCase() === path.toLowerCase()
    let bytes = Buffer.from(input.content, "utf8")
    if (text(bytes) !== input.content) throw new Error("Draft contains invalid Unicode")
    const afterSha256 = kind === "rename" ? input.expectedSha256! : hash(bytes)
    const requestHash =
      draftRequestHash ??
      hash(
        JSON.stringify([
          input.projectId,
          input.chatId,
          path,
          input.expectedSha256,
          afterSha256,
          input.intent,
          revertsId,
          ...(kind === "save" ? [] : [kind]),
          ...(renameFrom === null ? [] : [renameFrom]),
        ]),
      )
    // All callers hold the canonical-root lock through lookup, recovery and commit.
    if (this.writable(input, input.intent).identity !== scope.identity)
      throw new Error("Editor root changed")
    const existing = this.db
      .select()
      .from(schema.workspaceEdits)
      .where(eq(schema.workspaceEdits.id, input.id))
      .get()
    if (existing) {
      if (existing.requestHash !== requestHash || existing.rootIdentity !== scope.identity)
        throw new Error("Edit id was reused for a different request")
      return this.dto(existing.state === "prepared" ? await this.recover(existing) : existing)
    }
    const pending = this.db
      .select()
      .from(schema.workspaceEdits)
      .where(
        and(
          eq(schema.workspaceEdits.rootPath, scope.root.canonicalPath),
          eq(schema.workspaceEdits.rootIdentity, scope.identity),
          eq(schema.workspaceEdits.state, "prepared"),
        ),
      )
      .orderBy(asc(schema.workspaceEdits.createdAt))
      .limit(1000)
      .all()
    for (const row of pending) await this.recover(row, input)
    const before = await this.readForSave(
      { ...input, relativePath: renameFrom ?? path },
      kind === "create",
      exactName,
    )
    if (before.sha256 !== input.expectedSha256) throw new WorkspaceEditConflictError(before.sha256)
    if (kind === "rename") {
      const destination = await this.readForSave({ ...input, relativePath: path }, true, exactName)
      if (destination.sha256 !== null) throw new WorkspaceEditConflictError(destination.sha256)
      bytes = Buffer.from(before.content, "utf8")
    }
    if (kind === "remove")
      fileMode = await actOnPathInsideRoot(
        scope.root.canonicalPath,
        path,
        async (target) => (await lstat(target)).mode & 0o777,
      )
    const row: Row = {
      id: input.id,
      projectId: input.projectId,
      chatId: input.chatId,
      rootPath: scope.root.canonicalPath,
      rootIdentity: scope.identity,
      relativePath: path,
      requestHash,
      beforeContent: before.content,
      afterContent: kind === "rename" ? before.content : input.content,
      beforeSha256: before.sha256 ?? hash(""),
      afterSha256,
      revertsId,
      kind,
      fileMode,
      previousRelativePath: renameFrom,
      state: "prepared",
      createdAt: Date.now(),
    }
    this.db.transaction((tx) => {
      const usage = tx
        .select({
          count: sql<number>`count(case when state != 'expired' then 1 end)`,
          bytes: sql<number>`coalesce(sum(length(cast(before_content as blob)) + length(cast(after_content as blob))), 0)`,
        })
        .from(schema.workspaceEdits)
        .get()!
      const needsSpace = () =>
        usage.count >= 1000 || usage.bytes + before.byteLength + bytes.byteLength > 64 * 1024 * 1024
      if (needsSpace()) {
        const finalized = tx
          .select()
          .from(schema.workspaceEdits)
          .where(sql`${schema.workspaceEdits.state} in ('applied', 'failed', 'conflict')`)
          .orderBy(asc(schema.workspaceEdits.createdAt), asc(schema.workspaceEdits.id))
          .limit(1000)
          .all()
        for (const old of finalized) {
          if (!needsSpace()) break
          tx.update(schema.workspaceEdits)
            .set({ state: "expired", beforeContent: "", afterContent: "" })
            .where(eq(schema.workspaceEdits.id, old.id))
            .run()
          usage.count--
          usage.bytes -= Buffer.byteLength(old.beforeContent) + Buffer.byteLength(old.afterContent)
        }
      }
      if (needsSpace()) throw new Error("Pending edit recovery fills the retained history limit")
      tx.insert(schema.workspaceEdits).values(row).run()
    })
    try {
      if (kind === "rename") {
        await this.renameFile(scope.root.canonicalPath, renameFrom!, basename(path), {
          beforeCommit: async () => {
            const current = await this.readForSave(
              { ...input, relativePath: renameFrom! },
              false,
              exactName,
            )
            if (current.sha256 !== before.sha256)
              throw new WorkspaceEditConflictError(current.sha256)
            if (this.writable(input, input.intent).identity !== scope.identity)
              throw new Error("Editor root changed")
          },
        })
        try {
          if (
            (await this.recoveryHash(scope.root.canonicalPath, renameFrom!, exactName)) !== null ||
            (await this.recoveryHash(scope.root.canonicalPath, path, exactName)) !== afterSha256
          )
            throw new WorkspaceEditConflictError(null)
          if (this.writable(input, input.intent).identity !== scope.identity)
            throw new Error("Editor root changed")
          this.finish(row, "applied")
        } catch (error) {
          if (this.scope(input).identity !== scope.identity) throw error
          await renameFileInsideRoot(scope.root.canonicalPath, path, basename(renameFrom!), {
            beforeCommit: async () => {
              const current = await this.readForSave(
                { ...input, relativePath: path },
                false,
                exactName,
              )
              if (current.sha256 !== afterSha256)
                throw new WorkspaceEditConflictError(current.sha256)
              if (this.scope(input).identity !== scope.identity)
                throw new Error("Editor root changed")
            },
          })
          throw error
        }
      } else if (kind === "remove") {
        const removed = await this.remove(scope.root.canonicalPath, path, {
          beforeCommit: async () => {
            if (this.writable(input, input.intent).identity !== scope.identity)
              throw new Error("Editor root changed")
            const current = await this.readForSave({ ...input, relativePath: path })
            if (current.sha256 !== before.sha256)
              throw new WorkspaceEditConflictError(current.sha256)
            if (this.writable(input, input.intent).identity !== scope.identity)
              throw new Error("Editor root changed")
          },
        })
        if (!removed.removed) throw new WorkspaceEditConflictError(null)
        try {
          const current = await this.readForSave({ ...input, relativePath: path }, true)
          if (current.sha256 !== null) throw new WorkspaceEditConflictError(current.sha256)
          if (this.writable(input, input.intent).identity !== scope.identity)
            throw new Error("Editor root changed")
          this.finish(row, "applied")
        } catch (error) {
          // Restore only into the still-authorized missing path, never over external bytes.
          if (this.scope(input).identity !== scope.identity) throw error
          await writeFileInsideRoot(
            scope.root.canonicalPath,
            path,
            { data: before.content },
            {
              overwrite: true,
              createParents: false,
              expectedSha256: null,
              mode: fileMode,
              beforeCommit: () => {
                if (this.scope(input).identity !== scope.identity)
                  throw new Error("Editor root changed")
              },
            },
          )
          throw error
        }
      } else {
        await this.write(
          scope.root.canonicalPath,
          path,
          { data: bytes },
          {
            overwrite: true,
            createParents: false,
            expectedSha256: before.sha256,
            mode: fileMode,
            maxExistingBytes: workspaceEditMaxBytes,
            beforeCommit: () => {
              if (this.writable(input, input.intent).identity !== scope.identity)
                throw new Error("Editor root changed")
            },
            afterCommit: () => {
              if (this.writable(input, input.intent).identity !== scope.identity)
                throw new Error("Editor root changed")
              this.finish(row, "applied")
            },
          },
        )
      }
      return this.dto({ ...row, state: "applied" })
    } catch (error) {
      // If metadata is unavailable, keep the prepared record for a later retry/restart.
      // The rooted writer already attempted safe rollback; never blindly restore here.
      try {
        await this.recover(row)
      } catch {
        /* Retain durable recovery bytes. */
      }
      try {
        const current = await this.readForSave(
          { ...input, relativePath: renameFrom ?? path },
          kind === "create",
          exactName,
        )
        if (current.sha256 !== before.sha256) throw new WorkspaceEditConflictError(current.sha256)
      } catch (conflict) {
        if (conflict instanceof WorkspaceEditConflictError) throw conflict
      }
      throw error
    }
  }

  private async readForSave(
    input: z.infer<typeof workspaceEditTargetSchema>,
    allowMissing = false,
    exactName = false,
  ) {
    try {
      return await this.read(input, exactName)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        if (allowMissing) return { content: "", sha256: null, byteLength: 0 }
        throw new WorkspaceEditConflictError(null)
      }
      throw error
    }
  }
}
