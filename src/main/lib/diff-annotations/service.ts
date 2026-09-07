import { createHash } from "node:crypto"
import { and, asc, count, eq, inArray } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { getWorktreeDiff } from "../git/worktree"
import { splitUnifiedDiffByFile } from "../git/diff-parser"
import { appendMcpAuditRecord } from "../mcp-control/audit-storage"
import {
  createDiffAnnotationSchema,
  changeDiffAnnotationSchema,
  diffAnnotationAnchorSchema,
  diffAnnotationBodySchema,
  diffAnnotationScopeSchema,
  type DiffAnnotationScope,
  type DiffAnnotationAnchor,
  type DiffAnnotationDto,
} from "../../../shared/diff-annotations"
import { z } from "zod"

type Database = BetterSQLite3Database<typeof schema>
type Row = typeof schema.diffAnnotations.$inferSelect
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const now = () => Math.floor(Date.now() / 1000)

export class DiffAnnotationService {
  constructor(
    private readonly db: Database,
    private readonly readDiff = getWorktreeDiff,
  ) {}

  private scope(input: DiffAnnotationScope) {
    const scope = diffAnnotationScopeSchema.parse(input)
    const chat = this.db.select().from(schema.chats).where(eq(schema.chats.id, scope.chatId)).get()
    const project = this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, scope.projectId))
      .get()
    if (!chat || !project || chat.projectId !== project.id || chat.archivedAt || project.archivedAt)
      throw new Error("Review scope is unavailable or belongs to another project")
    return chat
  }

  private async current(input: DiffAnnotationScope) {
    const chat = this.scope(input)
    if (!chat.worktreePath) throw new Error("Review requires a registered worktree")
    const root = assertRegisteredFilesystemRoot(chat.worktreePath, this.db)
    const result = await this.readDiff(root.canonicalPath, chat.baseBranch ?? undefined, {
      onlyUncommitted: true,
    })
    const latest = this.scope(input)
    if (latest.worktreePath !== chat.worktreePath)
      throw new Error("Review worktree changed; refresh the diff")
    assertRegisteredFilesystemRoot(chat.worktreePath, this.db)
    if (!result.success || result.diff === undefined)
      throw new Error("Current diff is unavailable; refresh before commenting")
    if (Buffer.byteLength(result.diff) > 8 * 1024 * 1024)
      throw new Error("Review diff exceeds the 8 MiB annotation limit")
    return { diffHash: hash(result.diff), files: splitUnifiedDiffByFile(result.diff) }
  }

  async list(input: DiffAnnotationScope) {
    this.scope(input)
    let currentHash: string | undefined
    let error: string | null = null
    try {
      currentHash = (await this.current(input)).diffHash
    } catch {
      // Offline/replaced roots cannot verify anchors, but must not hide drafts.
      this.scope(input)
      error = "Current diff is unavailable. Saved comments are unverified; refresh before editing."
    }
    const rows = this.db
      .select()
      .from(schema.diffAnnotations)
      .where(
        and(
          eq(schema.diffAnnotations.projectId, input.projectId),
          eq(schema.diffAnnotations.chatId, input.chatId),
        ),
      )
      .orderBy(asc(schema.diffAnnotations.createdAt), asc(schema.diffAnnotations.id))
      .limit(1000)
      .all()
    const batchIds = [
      ...new Set(rows.flatMap((row) => (row.lastFeedbackBatchId ? [row.lastFeedbackBatchId] : []))),
    ]
    const batches = batchIds.length
      ? this.db
          .select({
            batchId: schema.diffFeedbackBatches.id,
            subChatId: schema.diffFeedbackBatches.subChatId,
            runId: schema.agentRuns.id,
            status: schema.agentRuns.status,
          })
          .from(schema.diffFeedbackBatches)
          .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.diffFeedbackBatches.runId))
          .where(
            and(
              inArray(schema.diffFeedbackBatches.id, batchIds),
              eq(schema.diffFeedbackBatches.projectId, input.projectId),
              eq(schema.diffFeedbackBatches.chatId, input.chatId),
            ),
          )
          .all()
      : []
    const feedback = new Map(batches.map((batch) => [batch.batchId, batch]))
    return {
      diffHash: currentHash ?? null,
      error,
      annotations: rows.map((row) => ({
        ...this.dto(row, currentHash),
        feedback: row.lastFeedbackBatchId ? (feedback.get(row.lastFeedbackBatchId) ?? null) : null,
      })),
    }
  }

  private row(input: DiffAnnotationScope & { id: string }) {
    this.scope(input)
    const row = this.db
      .select()
      .from(schema.diffAnnotations)
      .where(eq(schema.diffAnnotations.id, input.id))
      .get()
    if (!row || row.projectId !== input.projectId || row.chatId !== input.chatId)
      throw new Error("Comment is unavailable in this review scope")
    return row
  }

  private dto(row: Row, currentHash?: string): DiffAnnotationDto {
    const { creationHash: _creationHash, ...value } = row
    return {
      ...value,
      feedback: null,
      freshness: !currentHash ? "unverified" : row.diffHash === currentHash ? "current" : "stale",
    }
  }

  private assertAnchor(
    anchor: DiffAnnotationAnchor,
    current: Awaited<ReturnType<DiffAnnotationService["current"]>>,
  ) {
    if (anchor.diffHash !== current.diffHash)
      throw new Error("Diff changed; refresh or explicitly re-anchor the comment")
    const file = current.files.find(
      (entry) => (anchor.side === "left" ? entry.oldPath : entry.newPath) === anchor.filePath,
    )
    if (!file || !file.isValid || file.isBinary)
      throw new Error("Comment target is not a loaded text diff")
    const present = new Set<number>()
    let left = 0,
      right = 0,
      inHunk = false
    for (const line of file.diffText.split("\n")) {
      const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (header) {
        left = Number(header[1])
        right = Number(header[2])
        inHunk = true
        continue
      }
      if (!inHunk) continue
      const prefix = line[0]
      if (prefix !== " " && prefix !== "+" && prefix !== "-") continue
      const selected =
        anchor.side === "left" ? (prefix !== "+" ? left : null) : prefix !== "-" ? right : null
      if (selected !== null && selected >= anchor.startLine && selected <= anchor.endLine)
        present.add(selected)
      if (prefix !== "+") left++
      if (prefix !== "-") right++
    }
    if (present.size !== anchor.endLine - anchor.startLine + 1)
      throw new Error("Comment range includes lines outside the loaded diff")
  }

  private audit(input: DiffAnnotationScope & { id: string }, action: string, version: number) {
    appendMcpAuditRecord(this.db, {
      status: "completed",
      caller: { chatId: input.chatId, projectId: input.projectId },
      toolName: `diff_annotation_${action}`,
      tier: 1,
      input: { id: input.id, projectId: input.projectId, chatId: input.chatId },
      result: { version },
    })
  }

  async create(value: z.infer<typeof createDiffAnnotationSchema>) {
    const input = createDiffAnnotationSchema.parse(value)
    this.scope(input)
    const creationHash = hash(JSON.stringify(input))
    const committed = this.db
      .select()
      .from(schema.diffAnnotations)
      .where(eq(schema.diffAnnotations.id, input.id))
      .get()
    if (committed) {
      if (committed.creationHash !== creationHash)
        throw new Error("Comment request identity was reused with different content")
      // A lost response must remain retryable after a diff change or disconnection.
      // Return the current draft, including later edits/deletion, without a write.
      return this.dto(committed)
    }
    const current = await this.current(input)
    this.assertAnchor(input.anchor, current)
    return this.db.transaction(() => {
      this.scope(input)
      const existing = this.db
        .select()
        .from(schema.diffAnnotations)
        .where(eq(schema.diffAnnotations.id, input.id))
        .get()
      if (existing) {
        if (existing.creationHash !== creationHash)
          throw new Error("Comment request identity was reused with different content")
        return this.dto(existing, current.diffHash)
      }
      const total = this.db
        .select({ value: count() })
        .from(schema.diffAnnotations)
        .where(eq(schema.diffAnnotations.chatId, input.chatId))
        .get()!.value
      if (total >= 1000)
        throw new Error("This review reached its 1,000-comment limit, including deleted drafts")
      const row = this.db
        .insert(schema.diffAnnotations)
        .values({
          id: input.id,
          projectId: input.projectId,
          chatId: input.chatId,
          ...input.anchor,
          creationHash,
          body: input.body,
          version: 1,
          createdAt: now(),
          updatedAt: now(),
          deletedAt: null,
        })
        .returning()
        .get()
      this.audit(input, "create", row.version)
      return this.dto(row, current.diffHash)
    })
  }

  async revise(
    value: z.infer<typeof changeDiffAnnotationSchema> & {
      anchor: DiffAnnotationAnchor
      body: string
    },
  ) {
    const input = changeDiffAnnotationSchema
      .extend({ anchor: diffAnnotationAnchorSchema, body: diffAnnotationBodySchema })
      .parse(value)
    this.row(input)
    const current = await this.current(input)
    this.assertAnchor(input.anchor, current)
    return this.db.transaction(() => {
      const before = this.row(input)
      if (before.version !== input.expectedVersion || before.deletedAt !== null)
        throw new Error("Comment changed; reload before editing")
      const row = this.db
        .update(schema.diffAnnotations)
        .set({ ...input.anchor, body: input.body, version: before.version + 1, updatedAt: now() })
        .where(
          and(
            eq(schema.diffAnnotations.id, input.id),
            eq(schema.diffAnnotations.version, input.expectedVersion),
          ),
        )
        .returning()
        .get()
      if (!row) throw new Error("Comment changed; reload before editing")
      this.audit(input, "revise", row.version)
      return this.dto(row, current.diffHash)
    })
  }

  setDeleted(value: z.infer<typeof changeDiffAnnotationSchema> & { deleted: boolean }) {
    const input = changeDiffAnnotationSchema.extend({ deleted: z.boolean() }).parse(value)
    return this.db.transaction(() => {
      const before = this.row(input)
      if (before.version !== input.expectedVersion)
        throw new Error("Comment changed; reload before deleting or restoring")
      if ((before.deletedAt !== null) === value.deleted) return this.dto(before)
      const row = this.db
        .update(schema.diffAnnotations)
        .set({
          deletedAt: value.deleted ? now() : null,
          version: before.version + 1,
          updatedAt: now(),
        })
        .where(
          and(
            eq(schema.diffAnnotations.id, input.id),
            eq(schema.diffAnnotations.version, input.expectedVersion),
          ),
        )
        .returning()
        .get()
      if (!row) throw new Error("Comment changed; reload before deleting or restoring")
      this.audit(input, value.deleted ? "delete" : "restore", row.version)
      return this.dto(row)
    })
  }
}
