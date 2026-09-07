import { createHash } from "node:crypto"
import { isUtf8 } from "node:buffer"
import { relative, sep } from "node:path"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { readFileInsideRoot, resolveInsideRoot, writeFileInsideRoot } from "../path-safety"
import { parseCustomPermissionToggles, parsePermissionMode } from "../permissions"
import { appendMcpAuditRecord } from "../mcp-control/audit-storage"
import {
  workspaceEditMaxBytes,
  workspaceEditScopeSchema,
  workspaceEditTargetSchema,
  saveWorkspaceEditSchema,
  revertWorkspaceEditSchema,
  type WorkspaceEditScope,
  type SaveWorkspaceEdit,
} from "../../../shared/workspace-edits"
import type { z } from "zod"

type Database = BetterSQLite3Database<typeof schema>
type Row = typeof schema.workspaceEdits.$inferSelect
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const locks = new Map<string, Promise<void>>()

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

  async read(input: z.infer<typeof workspaceEditTargetSchema>) {
    const value = workspaceEditTargetSchema.parse(input)
    const scope = this.scope(value)
    const path = this.path(scope.root.canonicalPath, value.relativePath)
    const bytes = await readFileInsideRoot(scope.root.canonicalPath, path, {
      maxBytes: workspaceEditMaxBytes,
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
      createdAt: row.createdAt,
    }
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
        result: { sha256: row.afterSha256, byteLength: Buffer.byteLength(row.afterContent), state },
      })
      return updated
    })
  }

  private async recover(row: Row, authority: WorkspaceEditScope = row) {
    const scope = this.scope(authority)
    if (scope.identity !== row.rootIdentity || scope.root.canonicalPath !== row.rootPath)
      throw new Error("Edit history belongs to a different registered root")
    let currentHash: string | null = null
    try {
      currentHash = hash(
        await readFileInsideRoot(row.rootPath, row.relativePath, {
          maxBytes: workspaceEditMaxBytes,
        }),
      )
    } catch {
      /* Unreadable or missing bytes cannot establish the interrupted outcome. */
    }
    if (this.scope(authority).identity !== row.rootIdentity) throw new Error("Editor root changed")
    // Recovery only reconciles metadata. It never writes historical bytes over disk.
    return this.finish(
      row,
      currentHash === row.afterSha256
        ? "applied"
        : currentHash === row.beforeSha256
          ? "failed"
          : "conflict",
    )
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
      return this.saveRecord(
        {
          ...value,
          relativePath: row.relativePath,
          expectedSha256: row.afterSha256,
          content: row.beforeContent,
          intent: "save",
        },
        row.id,
      )
    })
  }

  private async saveRecord(input: SaveWorkspaceEdit, revertsId: string | null) {
    const scope = this.writable(input, input.intent)
    const path = this.path(scope.root.canonicalPath, input.relativePath)
    const bytes = Buffer.from(input.content, "utf8")
    if (text(bytes) !== input.content) throw new Error("Draft contains invalid Unicode")
    const afterSha256 = hash(bytes)
    const requestHash = hash(
      JSON.stringify([
        input.projectId,
        input.chatId,
        path,
        input.expectedSha256,
        afterSha256,
        input.intent,
        revertsId,
      ]),
    )
    // Both callers hold the canonical-root lock through lookup, recovery and commit.
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
    const before = await this.readForSave({ ...input, relativePath: path })
    if (before.sha256 !== input.expectedSha256) throw new WorkspaceEditConflictError(before.sha256)
    const row: Row = {
      id: input.id,
      projectId: input.projectId,
      chatId: input.chatId,
      rootPath: scope.root.canonicalPath,
      rootIdentity: scope.identity,
      relativePath: path,
      requestHash,
      beforeContent: before.content,
      afterContent: input.content,
      beforeSha256: before.sha256,
      afterSha256,
      revertsId,
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
      await this.write(
        scope.root.canonicalPath,
        path,
        { data: bytes },
        {
          overwrite: true,
          createParents: false,
          expectedSha256: before.sha256,
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
        const current = await this.readForSave({ ...input, relativePath: path })
        if (current.sha256 !== before.sha256) throw new WorkspaceEditConflictError(current.sha256)
      } catch (conflict) {
        if (conflict instanceof WorkspaceEditConflictError) throw conflict
      }
      throw error
    }
  }

  private async readForSave(input: z.infer<typeof workspaceEditTargetSchema>) {
    try {
      return await this.read(input)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new WorkspaceEditConflictError(null)
      throw error
    }
  }
}
