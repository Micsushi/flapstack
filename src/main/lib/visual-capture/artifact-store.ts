import Database from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import {
  readFileInsideRoot,
  removeFileInsideRoot,
  renamePathInsideRoot,
  writeFileInsideRoot,
} from "../path-safety"
import type { VisualCaptureActor, VisualCaptureScope } from "./session"
import { createVisualCaptureDerivative } from "./derivative"

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const sourceClassSchema = z.enum(["screen", "window", "application-window", "region"])
const consumerKindSchema = z.enum(["chat", "task", "knowledge", "run"])
const MAX_ARTIFACT_BYTES = 32 * 1_048_576

export type VisualArtifactState = "ok" | "missing" | "tampered"

export type VisualArtifactRecord = {
  id: string
  projectId: string
  chatId: string | null
  taskId: string | null
  sourceClass: z.infer<typeof sourceClassSchema>
  storedPath: string
  byteLength: number
  originalSha256: string
  derivativeSha256: string
  previewSha256: string
  actorKind: VisualCaptureActor["kind"]
  actorId: string
  approvalId: string | null
  capturedAt: number
  confirmedAt: number
  width: number
  height: number
  scaleFactor: number
  redactionState: "none" | "redacted"
  redactionCount: number
  annotationCount: number
  retainedUntil: number | null
  archivedAt: number | null
  createdAt: number
}

export type VisualArtifactFileOperations = {
  renamePath?: typeof renamePathInsideRoot
  removeFile?: typeof removeFileInsideRoot
}

export class VisualArtifactStore {
  constructor(
    private readonly database: Database.Database,
    private readonly rootPath: string,
    private readonly now: () => number = Date.now,
    private readonly fileOperations: VisualArtifactFileOperations = {},
  ) {}

  async confirm(input: {
    requestId: string
    sourceClass: z.infer<typeof sourceClassSchema>
    actor: VisualCaptureActor
    scope: VisualCaptureScope
    approvalId: string | null
    capturedAt: number
    scaleFactor: number
    derivative: {
      bytes: Buffer
      width: number
      height: number
      originalSha256: string
      derivativeSha256: string
      previewSha256: string
      redactionState: "none" | "redacted"
      redactionCount: number
      annotationCount: number
    }
    retainedUntil?: number | null
    initialLinks?: Array<{
      consumerKind: z.infer<typeof consumerKindSchema>
      consumerId: string
    }>
  }): Promise<VisualArtifactRecord> {
    const sourceClass = sourceClassSchema.parse(input.sourceClass)
    const scope = validateScope(input.scope)
    validateActorApproval(input.actor, input.approvalId)
    const derivative = validateDerivative(input.derivative)
    this.#assertScopeExists(scope)
    const id = randomUUID()
    const storedPath = join(id, "capture.png")
    const confirmedAt = this.now()
    const scaleFactor = Math.round(input.scaleFactor * 1_000)
    if (scaleFactor < 1 || scaleFactor > 8_000) {
      throw new Error("Visual capture scale factor is outside the supported range.")
    }
    if (
      input.retainedUntil !== undefined &&
      input.retainedUntil !== null &&
      input.retainedUntil < confirmedAt
    ) {
      throw new Error("Visual capture retention cannot already be expired at confirmation.")
    }
    const initialLinks = z
      .array(
        z
          .object({
            consumerKind: consumerKindSchema,
            consumerId: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(4)
      .parse(input.initialLinks ?? [])
    const pendingRecord: VisualArtifactRecord = {
      id,
      projectId: scope.projectId,
      chatId: scope.chatId ?? null,
      taskId: scope.taskId ?? null,
      sourceClass,
      storedPath,
      byteLength: derivative.bytes.byteLength,
      originalSha256: derivative.originalSha256,
      derivativeSha256: derivative.derivativeSha256,
      previewSha256: derivative.previewSha256,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      approvalId: input.approvalId,
      capturedAt: input.capturedAt,
      confirmedAt,
      width: derivative.width,
      height: derivative.height,
      scaleFactor: input.scaleFactor,
      redactionState: derivative.redactionState,
      redactionCount: derivative.redactionCount,
      annotationCount: derivative.annotationCount,
      retainedUntil: input.retainedUntil ?? null,
      archivedAt: null,
      createdAt: confirmedAt,
    }
    for (const link of initialLinks) {
      this.#assertConsumerScope(pendingRecord, link.consumerKind, link.consumerId)
    }

    await mkdir(this.rootPath, { recursive: true, mode: 0o700 })
    await writeFileInsideRoot(
      this.rootPath,
      storedPath,
      { data: derivative.bytes },
      {
        createParents: true,
        expectedSha256: null,
        afterCommit: () => {
          this.database.transaction(() => {
            this.database
              .prepare(
                `INSERT INTO visual_artifacts (
                 id, project_id, chat_id, task_id, source_class, stored_path, mime_type,
                 byte_length, original_sha256, derivative_sha256, preview_sha256,
                 actor_kind, actor_id, approval_id, captured_at, confirmed_at, width,
                 height, scale_factor, redaction_state, redaction_count, annotation_count,
                 retained_until, archived_at, created_at
               ) VALUES (
                 @id, @projectId, @chatId, @taskId, @sourceClass, @storedPath, 'image/png',
                 @byteLength, @originalSha256, @derivativeSha256, @previewSha256,
                 @actorKind, @actorId, @approvalId, @capturedAt, @confirmedAt, @width,
                 @height, @scaleFactor, @redactionState, @redactionCount, @annotationCount,
                 @retainedUntil, NULL, @createdAt
               )`,
              )
              .run({
                id,
                projectId: scope.projectId,
                chatId: scope.chatId ?? null,
                taskId: scope.taskId ?? null,
                sourceClass,
                storedPath,
                byteLength: derivative.bytes.byteLength,
                originalSha256: derivative.originalSha256,
                derivativeSha256: derivative.derivativeSha256,
                previewSha256: derivative.previewSha256,
                actorKind: input.actor.kind,
                actorId: input.actor.id,
                approvalId: input.approvalId,
                capturedAt: input.capturedAt,
                confirmedAt,
                width: derivative.width,
                height: derivative.height,
                scaleFactor,
                redactionState: derivative.redactionState,
                redactionCount: derivative.redactionCount,
                annotationCount: derivative.annotationCount,
                retainedUntil: input.retainedUntil ?? null,
                createdAt: confirmedAt,
              })
            for (const link of initialLinks) {
              this.#insertLink(pendingRecord, link.consumerKind, link.consumerId)
            }
            this.#audit({
              artifactId: id,
              requestId: input.requestId,
              action: "confirm",
              actorKind: input.actor.kind,
              actorId: input.actor.id,
              projectId: scope.projectId,
              outcome: "allowed",
            })
          })()
        },
      },
    )
    return this.get(id)
  }

  get(id: string): VisualArtifactRecord {
    const row = this.database.prepare("SELECT * FROM visual_artifacts WHERE id = ?").get(id) as
      Record<string, unknown> | undefined
    if (!row) throw new Error("Visual artifact not found.")
    return mapRecord(row)
  }

  list(projectId: string): VisualArtifactRecord[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM visual_artifacts WHERE project_id = ? ORDER BY created_at DESC, id DESC",
        )
        .all(projectId) as Record<string, unknown>[]
    ).map(mapRecord)
  }

  async inspect(id: string): Promise<{ record: VisualArtifactRecord; state: VisualArtifactState }> {
    const record = this.get(id)
    try {
      const bytes = await readFileInsideRoot(this.rootPath, record.storedPath, {
        maxBytes: MAX_ARTIFACT_BYTES,
      })
      const state = sha256(bytes) === record.derivativeSha256 ? "ok" : "tampered"
      return { record, state }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { record, state: "missing" }
      }
      throw error
    }
  }

  async readVerified(id: string): Promise<{ record: VisualArtifactRecord; bytes: Buffer }> {
    const inspected = await this.inspect(id)
    if (inspected.state !== "ok") {
      throw new Error(`Visual artifact ${id} is ${inspected.state}.`)
    }
    const bytes = await readFileInsideRoot(this.rootPath, inspected.record.storedPath, {
      maxBytes: MAX_ARTIFACT_BYTES,
    })
    if (sha256(bytes) !== inspected.record.derivativeSha256) {
      throw new Error(`Visual artifact ${id} changed during verified read.`)
    }
    return { record: inspected.record, bytes }
  }

  link(input: {
    artifactId: string
    consumerKind: z.infer<typeof consumerKindSchema>
    consumerId: string
  }): void {
    const record = this.get(input.artifactId)
    if (record.archivedAt === -1) {
      throw new Error("Visual artifact deletion is already in progress.")
    }
    if (record.archivedAt !== null) {
      throw new Error("Archived visual artifacts cannot be added to new context.")
    }
    const consumerKind = consumerKindSchema.parse(input.consumerKind)
    const consumerId = z.string().min(1).max(200).parse(input.consumerId)
    this.#assertConsumerScope(record, consumerKind, consumerId)
    this.database.transaction(() => {
      this.#insertLink(record, consumerKind, consumerId)
      this.#audit({
        artifactId: record.id,
        requestId: null,
        action: "link",
        actorKind: "user",
        actorId: "owner",
        projectId: record.projectId,
        outcome: "allowed",
      })
    })()
  }

  selectedContext(consumerKind: z.infer<typeof consumerKindSchema>, consumerId: string) {
    const rows = this.database
      .prepare(
        `SELECT a.id, a.stored_path AS storedPath, a.derivative_sha256 AS sha256,
                l.context_sha256 AS contextSha256
           FROM visual_artifact_links l
           JOIN visual_artifacts a ON a.id = l.artifact_id
          WHERE l.consumer_kind = ? AND l.consumer_id = ?
          ORDER BY l.selected_at, a.id`,
      )
      .all(
        consumerKindSchema.parse(consumerKind),
        z.string().min(1).max(200).parse(consumerId),
      ) as {
      id: string
      storedPath: string
      sha256: string
      contextSha256: string
    }[]
    for (const row of rows) {
      if (row.sha256 !== row.contextSha256) {
        throw new Error("Visual artifact context snapshot no longer matches its confirmed hash.")
      }
    }
    return rows
  }

  async exportSelected(input: {
    artifactIds: string[]
    destinationRoot: string
    scan: (bytes: Buffer) => Promise<void>
  }): Promise<string[]> {
    const ids = [...new Set(z.array(z.string().min(1).max(200)).max(100).parse(input.artifactIds))]
    await mkdir(input.destinationRoot, { recursive: true, mode: 0o700 })
    const prepared: Array<{ id: string; target: string; bytes: Buffer; projectId: string }> = []
    for (const id of ids) {
      const inspected = await this.inspect(id)
      if (inspected.state !== "ok") {
        throw new Error(`Visual artifact ${id} is ${inspected.state}; export stopped.`)
      }
      const bytes = await readFileInsideRoot(this.rootPath, inspected.record.storedPath, {
        maxBytes: MAX_ARTIFACT_BYTES,
      })
      await input.scan(bytes)
      prepared.push({
        id,
        target: `${id}.png`,
        bytes,
        projectId: inspected.record.projectId,
      })
    }

    const exported: string[] = []
    try {
      for (const item of prepared) {
        await writeFileInsideRoot(
          input.destinationRoot,
          item.target,
          { data: item.bytes },
          {
            expectedSha256: null,
          },
        )
        exported.push(item.target)
      }
    } catch (error) {
      for (const target of exported.reverse()) {
        await removeFileInsideRoot(input.destinationRoot, target).catch(() => undefined)
      }
      throw error
    }
    for (const item of prepared) {
      this.#audit({
        artifactId: item.id,
        requestId: null,
        action: "export",
        actorKind: "user",
        actorId: "owner",
        projectId: item.projectId,
        outcome: "allowed",
      })
    }
    return prepared.map((item) => item.target)
  }

  async deleteIfUnreferenced(id: string, options: { retentionOverride?: boolean } = {}) {
    const deletion = this.database
      .transaction(() => {
        const current = this.get(id)
        const links = this.database
          .prepare("SELECT COUNT(*) AS count FROM visual_artifact_links WHERE artifact_id = ?")
          .get(id) as { count: number }
        if (links.count > 0) throw new Error("Referenced visual artifacts cannot be deleted.")
        if (current.archivedAt === -1) {
          return { record: current, alreadyDeleting: true }
        }
        if (
          !options.retentionOverride &&
          (current.retainedUntil === null || current.retainedUntil > this.now())
        ) {
          throw new Error("Visual artifact retention has not expired.")
        }
        this.database.prepare("UPDATE visual_artifacts SET archived_at = -1 WHERE id = ?").run(id)
        return { record: current, alreadyDeleting: false }
      })
      .immediate()

    const quarantineName = `.flapstack-delete-${id}.png`
    const quarantinePath = join(dirname(deletion.record.storedPath), quarantineName)
    const renamePath = this.fileOperations.renamePath ?? renamePathInsideRoot
    const removeFile = this.fileOperations.removeFile ?? removeFileInsideRoot
    try {
      await renamePath(this.rootPath, deletion.record.storedPath, quarantineName)
    } catch (error) {
      if (!isMissingPathError(error)) {
        if (!deletion.alreadyDeleting) {
          this.database
            .prepare(
              "UPDATE visual_artifacts SET archived_at = ? WHERE id = ? AND archived_at = -1",
            )
            .run(deletion.record.archivedAt, id)
        }
        throw error
      }
    }
    await removeFile(this.rootPath, quarantinePath, { removeEmptyParent: true })
    this.database.transaction(() => {
      this.#audit({
        artifactId: deletion.record.id,
        requestId: null,
        action: "delete",
        actorKind: "user",
        actorId: "owner",
        projectId: deletion.record.projectId,
        outcome: "allowed",
      })
      this.database.prepare("DELETE FROM visual_artifacts WHERE id = ?").run(id)
    })()
  }

  search(input: {
    projectId: string
    archived?: boolean
    query?: string
    sourceClass?: z.infer<typeof sourceClassSchema>
  }): VisualArtifactRecord[] {
    const projectId = z.string().min(1).max(200).parse(input.projectId)
    const clauses = ["project_id = ?"]
    const values: unknown[] = [projectId]
    if (input.archived !== undefined) {
      clauses.push(
        input.archived ? "archived_at IS NOT NULL AND archived_at <> -1" : "archived_at IS NULL",
      )
    }
    if (input.sourceClass) {
      clauses.push("source_class = ?")
      values.push(sourceClassSchema.parse(input.sourceClass))
    }
    if (input.query?.trim()) {
      clauses.push("(id LIKE ? OR actor_id LIKE ?)")
      const query = `%${input.query.trim().replace(/[%_]/g, "\\$&")}%`
      values.push(query, query)
    }
    return (
      this.database
        .prepare(
          `SELECT * FROM visual_artifacts
            WHERE ${clauses.join(" AND ")}
            ORDER BY created_at DESC, id DESC`,
        )
        .all(...values) as Record<string, unknown>[]
    ).map(mapRecord)
  }

  archive(id: string, archived: boolean): VisualArtifactRecord {
    const record = this.get(id)
    if (record.archivedAt === -1) throw new Error("Visual artifact deletion is in progress.")
    this.database.transaction(() => {
      this.database
        .prepare("UPDATE visual_artifacts SET archived_at = ? WHERE id = ?")
        .run(archived ? this.now() : null, id)
      this.#audit({
        artifactId: id,
        requestId: `${archived ? "archive" : "restore"}:${id}`,
        action: "delete",
        actorKind: "user",
        actorId: "owner",
        projectId: record.projectId,
        outcome: "allowed",
      })
    })()
    return this.get(id)
  }

  move(id: string, target: { chatId: string | null; taskId: string | null }): VisualArtifactRecord {
    const record = this.get(id)
    if (record.archivedAt === -1) throw new Error("Visual artifact deletion is in progress.")
    const scope: VisualCaptureScope = {
      projectId: record.projectId,
      ...(target.chatId ? { chatId: target.chatId } : {}),
      ...(target.taskId ? { taskId: target.taskId } : {}),
    }
    this.#assertScopeExists(scope)
    this.database.transaction(() => {
      this.database
        .prepare("UPDATE visual_artifacts SET chat_id = ?, task_id = ? WHERE id = ?")
        .run(target.chatId, target.taskId, id)
      this.database
        .prepare(
          "DELETE FROM visual_artifact_links WHERE artifact_id = ? AND consumer_kind IN ('chat', 'task')",
        )
        .run(id)
      const moved = { ...record, chatId: target.chatId, taskId: target.taskId }
      if (target.chatId) this.#insertLink(moved, "chat", target.chatId)
      if (target.taskId) this.#insertLink(moved, "task", target.taskId)
      this.#audit({
        artifactId: id,
        requestId: `move:${id}`,
        action: "link",
        actorKind: "user",
        actorId: "owner",
        projectId: record.projectId,
        outcome: "allowed",
      })
    })()
    return this.get(id)
  }

  setRetention(id: string, retainedUntil: number | null): VisualArtifactRecord {
    const record = this.get(id)
    if (record.archivedAt === -1) throw new Error("Visual artifact deletion is in progress.")
    if (
      retainedUntil !== null &&
      (!Number.isSafeInteger(retainedUntil) || retainedUntil <= this.now())
    ) {
      throw new Error("Visual artifact retention must be a future timestamp or explicit keep.")
    }
    this.database.transaction(() => {
      this.database
        .prepare("UPDATE visual_artifacts SET retained_until = ? WHERE id = ?")
        .run(retainedUntil, id)
      this.#audit({
        artifactId: id,
        requestId: `retention:${id}`,
        action: "link",
        actorKind: "user",
        actorId: "owner",
        projectId: record.projectId,
        outcome: "allowed",
      })
    })()
    return this.get(id)
  }

  async cleanupExpired(): Promise<{ deleted: string[]; skippedReferenced: string[] }> {
    const reconciled = await this.reconcilePendingDeletions()
    const candidates = this.database
      .prepare(
        `SELECT id FROM visual_artifacts
          WHERE retained_until IS NOT NULL AND retained_until <= ? AND archived_at IS NOT -1
          ORDER BY retained_until, id`,
      )
      .all(this.now()) as { id: string }[]
    const deleted: string[] = [...reconciled.deleted]
    const skippedReferenced: string[] = []
    for (const candidate of candidates) {
      const count = this.database
        .prepare("SELECT COUNT(*) AS count FROM visual_artifact_links WHERE artifact_id = ?")
        .get(candidate.id) as { count: number }
      if (count.count > 0) {
        skippedReferenced.push(candidate.id)
        continue
      }
      await this.deleteIfUnreferenced(candidate.id)
      deleted.push(candidate.id)
    }
    return { deleted, skippedReferenced }
  }

  async reconcilePendingDeletions(): Promise<{ deleted: string[]; failed: string[] }> {
    const candidates = this.database
      .prepare("SELECT id FROM visual_artifacts WHERE archived_at = -1 ORDER BY id")
      .all() as { id: string }[]
    const deleted: string[] = []
    const failed: string[] = []
    for (const candidate of candidates) {
      try {
        await this.deleteIfUnreferenced(candidate.id, { retentionOverride: true })
        deleted.push(candidate.id)
      } catch {
        failed.push(candidate.id)
      }
    }
    return { deleted, failed }
  }

  async importDerivative(input: {
    projectId: string
    chatId?: string
    taskId?: string
    bytes: Buffer
    actorId: string
  }): Promise<VisualArtifactRecord> {
    const derivative = await createVisualCaptureDerivative(input.bytes, {
      crop: null,
      redactions: [],
      annotations: [],
    })
    const scope: VisualCaptureScope = {
      projectId: input.projectId,
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    }
    const initialLinks = [
      ...(input.chatId ? [{ consumerKind: "chat" as const, consumerId: input.chatId }] : []),
      ...(input.taskId ? [{ consumerKind: "task" as const, consumerId: input.taskId }] : []),
    ]
    return this.confirm({
      requestId: `import:${randomUUID()}`,
      sourceClass: "region",
      actor: { kind: "user", id: input.actorId },
      scope,
      approvalId: null,
      capturedAt: this.now(),
      scaleFactor: 1,
      derivative,
      initialLinks,
    })
  }

  auditHistory(input: { projectId: string; limit?: number }) {
    const projectId = z.string().min(1).max(200).parse(input.projectId)
    const limit = z
      .number()
      .int()
      .min(1)
      .max(500)
      .parse(input.limit ?? 100)
    const rows = this.database
      .prepare(
        `SELECT id, artifact_id AS artifactId, request_id AS requestId, action,
                actor_kind AS actorKind, actor_id AS actorId, project_id AS projectId,
                outcome, occurred_at AS occurredAt
           FROM visual_capture_audit
          WHERE project_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?`,
      )
      .all(projectId, limit) as Array<{
      id: number
      artifactId: string | null
      requestId: string | null
      action: string
      actorKind: string
      actorId: string
      projectId: string
      outcome: string
      occurredAt: number
    }>
    return rows.map((row) => ({
      ...row,
      operation: row.requestId?.split(":", 1)[0] ?? row.action,
    }))
  }

  #assertScopeExists(scope: VisualCaptureScope): void {
    const project = this.database
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(scope.projectId)
    if (!project) throw new Error("Visual artifact project scope does not exist.")
    if (scope.chatId) {
      const chat = this.database
        .prepare("SELECT project_id AS projectId FROM chats WHERE id = ?")
        .get(scope.chatId) as { projectId: string | null } | undefined
      if (!chat || chat.projectId !== scope.projectId) {
        throw new Error("Visual artifact chat must belong to its project scope.")
      }
    }
    if (scope.taskId) {
      const task = this.database
        .prepare("SELECT project_id AS projectId FROM tasks WHERE id = ?")
        .get(scope.taskId) as { projectId: string } | undefined
      if (!task || task.projectId !== scope.projectId) {
        throw new Error("Visual artifact task must belong to its project scope.")
      }
    }
    if (scope.runId) {
      const run = this.database
        .prepare(
          `SELECT c.project_id AS projectId
             FROM agent_runs r JOIN chats c ON c.id = r.chat_id
            WHERE r.id = ?`,
        )
        .get(scope.runId) as { projectId: string | null } | undefined
      if (!run || run.projectId !== scope.projectId) {
        throw new Error("Visual artifact run must belong to its project scope.")
      }
    }
  }

  #assertConsumerScope(
    record: VisualArtifactRecord,
    consumerKind: z.infer<typeof consumerKindSchema>,
    consumerId: string,
  ): void {
    if (consumerKind === "chat") {
      const chat = this.database
        .prepare("SELECT project_id AS projectId FROM chats WHERE id = ?")
        .get(consumerId) as { projectId: string | null } | undefined
      if (!chat || chat.projectId !== record.projectId) throw new Error("Chat scope mismatch.")
    } else if (consumerKind === "task") {
      const task = this.database
        .prepare("SELECT project_id AS projectId FROM tasks WHERE id = ?")
        .get(consumerId) as { projectId: string } | undefined
      if (!task || task.projectId !== record.projectId) throw new Error("Task scope mismatch.")
    } else if (consumerKind === "run") {
      const run = this.database
        .prepare(
          `SELECT c.project_id AS projectId
             FROM agent_runs r JOIN chats c ON c.id = r.chat_id
            WHERE r.id = ?`,
        )
        .get(consumerId) as { projectId: string | null } | undefined
      if (!run || run.projectId !== record.projectId) throw new Error("Run scope mismatch.")
    } else {
      const node = this.database
        .prepare(
          `SELECT n.project_id AS projectId
             FROM project_vault_graph_nodes n
             JOIN project_vault_graph_state s
               ON s.project_id = n.project_id
              AND s.current_generation_id = n.generation_id
            WHERE n.node_id = ?`,
        )
        .get(consumerId) as { projectId: string } | undefined
      if (!node || node.projectId !== record.projectId) {
        throw new Error("Knowledge scope mismatch.")
      }
    }
  }

  #insertLink(
    record: VisualArtifactRecord,
    consumerKind: z.infer<typeof consumerKindSchema>,
    consumerId: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO visual_artifact_links
           (artifact_id, consumer_kind, consumer_id, context_sha256, selected_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(artifact_id, consumer_kind, consumer_id) DO NOTHING`,
      )
      .run(record.id, consumerKind, consumerId, record.derivativeSha256, this.now())
  }

  #audit(input: {
    artifactId: string | null
    requestId: string | null
    action: string
    actorKind: string
    actorId: string
    projectId: string
    outcome: string
  }): void {
    this.database
      .prepare(
        `INSERT INTO visual_capture_audit
           (artifact_id, request_id, action, actor_kind, actor_id, project_id, outcome, occurred_at)
         VALUES (@artifactId, @requestId, @action, @actorKind, @actorId, @projectId, @outcome, @occurredAt)`,
      )
      .run({ ...input, occurredAt: this.now() })
  }
}

function validateScope(scope: VisualCaptureScope): VisualCaptureScope {
  return z
    .object({
      projectId: z.string().min(1).max(200),
      taskId: z.string().min(1).max(200).optional(),
      chatId: z.string().min(1).max(200).optional(),
      runId: z.string().min(1).max(200).optional(),
    })
    .strict()
    .parse(scope)
}

function validateActorApproval(actor: VisualCaptureActor, approvalId: string | null): void {
  if (actor.kind === "agent" && !approvalId) {
    throw new Error("Agent visual artifacts require an approval identity.")
  }
  if (actor.kind === "user" && approvalId) {
    throw new Error("User visual artifacts cannot claim an agent approval.")
  }
}

function validateDerivative<
  T extends {
    bytes: Buffer
    width: number
    height: number
    originalSha256: string
    derivativeSha256: string
    previewSha256: string
    redactionState: "none" | "redacted"
    redactionCount: number
    annotationCount: number
  },
>(value: T): T {
  if (
    !Buffer.isBuffer(value.bytes) ||
    value.bytes.byteLength < 1 ||
    value.bytes.byteLength > MAX_ARTIFACT_BYTES
  ) {
    throw new Error("Visual artifact derivative exceeds its storage boundary.")
  }
  for (const hash of [value.originalSha256, value.derivativeSha256, value.previewSha256]) {
    hashSchema.parse(hash)
  }
  if (sha256(value.bytes) !== value.derivativeSha256) {
    throw new Error("Visual artifact derivative bytes do not match the confirmed hash.")
  }
  if (value.previewSha256 !== value.derivativeSha256) {
    throw new Error("Visual artifact preview does not match the confirmed derivative.")
  }
  if (
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.height < 1 ||
    value.width * value.height > 16_000_000
  ) {
    throw new Error("Visual artifact dimensions exceed the storage boundary.")
  }
  if (
    !Number.isInteger(value.redactionCount) ||
    !Number.isInteger(value.annotationCount) ||
    value.redactionCount < 0 ||
    value.annotationCount < 0 ||
    value.redactionCount > 100 ||
    value.annotationCount > 100
  ) {
    throw new Error("Visual artifact edit counts exceed the storage boundary.")
  }
  return value
}

function mapRecord(row: Record<string, unknown>): VisualArtifactRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    chatId: row.chat_id === null ? null : String(row.chat_id),
    taskId: row.task_id === null ? null : String(row.task_id),
    sourceClass: sourceClassSchema.parse(row.source_class),
    storedPath: String(row.stored_path),
    byteLength: Number(row.byte_length),
    originalSha256: String(row.original_sha256),
    derivativeSha256: String(row.derivative_sha256),
    previewSha256: String(row.preview_sha256),
    actorKind: z.enum(["user", "agent"]).parse(row.actor_kind),
    actorId: String(row.actor_id),
    approvalId: row.approval_id === null ? null : String(row.approval_id),
    capturedAt: Number(row.captured_at),
    confirmedAt: Number(row.confirmed_at),
    width: Number(row.width),
    height: Number(row.height),
    scaleFactor: Number(row.scale_factor) / 1_000,
    redactionState: z.enum(["none", "redacted"]).parse(row.redaction_state),
    redactionCount: Number(row.redaction_count),
    annotationCount: Number(row.annotation_count),
    retainedUntil: row.retained_until === null ? null : Number(row.retained_until),
    archivedAt: row.archived_at === null ? null : Number(row.archived_at),
    createdAt: Number(row.created_at),
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
