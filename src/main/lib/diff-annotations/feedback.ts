import { createHash } from "node:crypto"
import type Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { and, eq } from "drizzle-orm"
import * as schema from "../db/schema"
import { DiffAnnotationService } from "./service"
import { buildDiffFeedbackPrompt } from "./prompt"
import { queueChatRun } from "../run-launch-service"
import { appendMcpAuditRecord } from "../mcp-control/audit-storage"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { getWorktreeDiff } from "../git/worktree"
import {
  diffFeedbackBatchScopeSchema,
  sendDiffFeedbackSchema,
} from "../../../shared/diff-annotations"

/** Durable feedback uses the existing run queue and never dispatches a provider itself. */
export class DiffFeedbackService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly readDiff = getWorktreeDiff,
  ) {}

  /** Resolve cancellation authority from a scoped batch, never a renderer-supplied run ID.
   * Archived chats may still cancel already queued/running work. */
  getBatchRun(value: unknown) {
    const input = diffFeedbackBatchScopeSchema.parse(value)
    const row = this.sqlite
      .prepare(
        `
      SELECT r.id runId, b.chat_id chatId FROM diff_feedback_batches b
      JOIN chats c ON c.id=b.chat_id AND c.project_id=b.project_id
      JOIN sub_chats s ON s.id=b.sub_chat_id AND s.chat_id=c.id
      JOIN agent_runs r ON r.id=b.run_id AND r.chat_id=c.id AND r.sub_chat_id=s.id
      WHERE b.id=? AND b.chat_id=? AND b.project_id=?
    `,
      )
      .get(input.id, input.chatId, input.projectId) as { runId: string; chatId: string } | undefined
    if (!row) throw new Error("Feedback batch is unavailable in this review scope")
    return row
  }

  async queue(value: unknown) {
    const input = sendDiffFeedbackSchema.parse(value)
    const db = drizzle(this.sqlite, { schema })
    const scope = () => {
      const chat = db.select().from(schema.chats).where(eq(schema.chats.id, input.chatId)).get()
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, input.projectId))
        .get()
      const conversation = db
        .select()
        .from(schema.subChats)
        .where(
          and(eq(schema.subChats.id, input.subChatId), eq(schema.subChats.chatId, input.chatId)),
        )
        .get()
      if (
        !chat ||
        !project ||
        !conversation ||
        chat.projectId !== project.id ||
        chat.archivedAt ||
        project.archivedAt
      )
        throw new Error("Feedback target is unavailable in this review scope")
      if (conversation.worktreePath && conversation.worktreePath !== chat.worktreePath)
        throw new Error("Selected conversation uses a different review worktree")
      return chat
    }
    const chat = scope()
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex")
    const replay = () => {
      const batch = db
        .select()
        .from(schema.diffFeedbackBatches)
        .where(eq(schema.diffFeedbackBatches.id, input.id))
        .get()
      if (batch && batch.requestHash !== requestHash)
        throw new Error("Feedback request identity was reused with different selection or target")
      return batch
    }
    const existing = replay()
    if (existing) return existing
    const observed = await new DiffAnnotationService(db, this.readDiff).list(input)
    if (!observed.diffHash || observed.error)
      throw new Error("Current diff cannot verify the selected feedback")
    const selected = input.comments.map((selection) => {
      const row = observed.annotations.find((row) => row.id === selection.id)
      if (
        !row ||
        row.version !== selection.version ||
        row.deletedAt !== null ||
        row.freshness !== "current"
      )
        throw new Error("Selected comment changed, was deleted, or has a stale anchor")
      return row
    })
    const prompt = buildDiffFeedbackPrompt(selected)
    return this.sqlite
      .transaction(() => {
        const latestChat = scope()
        const raced = replay()
        if (raced) return raced
        if (!chat.worktreePath || latestChat.worktreePath !== chat.worktreePath)
          throw new Error("Review worktree changed")
        assertRegisteredFilesystemRoot(chat.worktreePath, db)
        for (const selectedRow of selected) {
          const row = db
            .select()
            .from(schema.diffAnnotations)
            .where(eq(schema.diffAnnotations.id, selectedRow.id))
            .get()
          if (
            !row ||
            row.version !== selectedRow.version ||
            row.deletedAt !== null ||
            row.chatId !== input.chatId ||
            row.projectId !== input.projectId
          )
            throw new Error("Selected comment changed before queueing")
          if (row.lastFeedbackVersion === row.version)
            throw new Error(
              "Selected comment version is already queued; revise it before sending again",
            )
        }
        const conversation = db
          .select()
          .from(schema.subChats)
          .where(eq(schema.subChats.id, input.subChatId))
          .get()!
        // Local persistence cannot yet adopt a claimed run and its durable prompt.
        // Fail before consuming this comment version, not after queue dispatch.
        if ((conversation.harness ?? latestChat.harness) === "local")
          throw new Error("Local-model feedback is not yet supported; the comment remains unsent")
        const run = queueChatRun(this.sqlite, {
          chatId: input.chatId,
          subChatId: input.subChatId,
          idempotencyKey: `diff-feedback-${input.id}`,
          initialPrompt: prompt,
        })
        if (!run.ok) throw new Error(run.message)
        if (!run.created)
          throw new Error("Feedback run exists without its batch; recovery is required")
        const messages: unknown = JSON.parse(conversation.messages)
        if (!Array.isArray(messages)) throw new Error("Conversation transcript requires recovery")
        const promptMessageId = `mcp-diff-feedback-${input.id}`
        if (messages.some((message) => message?.id === promptMessageId))
          throw new Error("Feedback message exists without its batch; recovery is required")
        messages.push({
          id: promptMessageId,
          role: "user",
          parts: [{ type: "text", text: prompt }],
          metadata: { feedbackBatchId: input.id, runId: run.runId },
        })
        db.update(schema.subChats)
          .set({ messages: JSON.stringify(messages), updatedAt: new Date() })
          .where(eq(schema.subChats.id, input.subChatId))
          .run()
        const batch = db
          .insert(schema.diffFeedbackBatches)
          .values({
            id: input.id,
            projectId: input.projectId,
            chatId: input.chatId,
            subChatId: input.subChatId,
            runId: run.runId,
            requestHash,
            selection: JSON.stringify(input.comments),
            createdAt: Math.floor(Date.now() / 1000),
          })
          .returning()
          .get()
        for (const row of selected) {
          db.update(schema.diffAnnotations)
            .set({ lastFeedbackBatchId: batch.id, lastFeedbackVersion: row.version })
            .where(eq(schema.diffAnnotations.id, row.id))
            .run()
        }
        appendMcpAuditRecord(db, {
          status: "completed",
          caller: { chatId: input.chatId, projectId: input.projectId },
          toolName: "diff_feedback_queue",
          tier: 1,
          input: { id: input.id, chatId: input.chatId, projectId: input.projectId },
          result: { runId: run.runId },
        })
        return batch
      })
      .immediate()
  }
}
