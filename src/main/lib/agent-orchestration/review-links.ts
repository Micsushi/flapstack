import type Database from "better-sqlite3"
import { z } from "zod"
import {
  orchestrationReviewScopeSchema,
  orchestrationSetReviewSchema,
  orchestrationRestoreReviewSchema,
  type OrchestrationReview,
  type OrchestrationRunReview,
  type OrchestrationReviewState,
  type OrchestrationReviewMember,
} from "../../../shared/agent-orchestration"

export class OrchestrationReviewError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "FORBIDDEN",
    message: string,
  ) {
    super(message)
  }
}
const terminal = new Set(["success", "failure", "cancelled"])
type Scope = z.infer<typeof orchestrationReviewScopeSchema>
type Row = { source_run_id: string; revision: number; review: string | null }
const dto = (row: Row): OrchestrationRunReview => ({
  sourceRunId: row.source_run_id,
  revision: row.revision,
  review: row.review ? (JSON.parse(row.review) as OrchestrationReview) : null,
})

/** Manual evidence links only. No scheduler, provider attestation, or owner acceptance. */
export class OrchestrationReviewService {
  constructor(private readonly db: Database.Database) {}
  private scope(scope: Scope) {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM task_orchestrations o JOIN tasks t ON t.id=o.task_id WHERE t.id=? AND t.project_id=?",
        )
        .get(scope.taskId, scope.projectId)
    )
      throw new OrchestrationReviewError("FORBIDDEN", "Task orchestration is outside this project.")
  }
  private current(taskId: string, sourceRunId: string): OrchestrationRunReview {
    const row = this.db
      .prepare(
        "SELECT source_run_id,revision,review FROM orchestration_run_reviews WHERE task_id=? AND source_run_id=? ORDER BY revision DESC LIMIT 1",
      )
      .get(taskId, sourceRunId) as Row | undefined
    return row ? dto(row) : { sourceRunId, revision: 0, review: null }
  }
  private member(scope: Scope, runId: string) {
    const row = this.db
      .prepare(
        "SELECT r.status FROM orchestration_agents a JOIN agent_runs r ON r.id=a.run_id AND r.chat_id=a.chat_id JOIN chats c ON c.id=r.chat_id WHERE a.task_id=? AND r.id=? AND c.project_id=? AND c.task_id=?",
      )
      .get(scope.taskId, runId, scope.projectId, scope.taskId) as { status: string } | undefined
    if (!row)
      throw new OrchestrationReviewError(
        "BAD_REQUEST",
        "Select actual runs belonging to this project's task orchestration.",
      )
    return row
  }
  private requireTerminal(scope: Scope, sourceRunId: string, reviewerRunId: string) {
    for (const runId of [sourceRunId, reviewerRunId]) {
      const row = this.db
        .prepare(
          "SELECT r.status FROM agent_runs r JOIN chats c ON c.id=r.chat_id WHERE r.id=? AND c.project_id=? AND c.task_id=?",
        )
        .get(runId, scope.projectId, scope.taskId) as { status: string } | undefined
      if (!row || !terminal.has(row.status))
        throw new OrchestrationReviewError(
          "BAD_REQUEST",
          "Pass requires both source and reviewer runs to have finished. Record inconclusive while a run is active.",
        )
    }
  }
  state(raw: Scope): OrchestrationReviewState {
    const scope = orchestrationReviewScopeSchema.parse(raw)
    this.scope(scope)
    const members = this.db
      .prepare(
        "SELECT a.id agentId,r.id runId,r.chat_id chatId,r.sub_chat_id subChatId,json_extract(a.definition,'$.name') name,json_extract(a.definition,'$.role') role,a.status status,r.status runStatus FROM orchestration_agents a JOIN agent_runs r ON r.id=a.run_id AND r.chat_id=a.chat_id JOIN chats c ON c.id=r.chat_id WHERE a.task_id=? AND c.project_id=? AND c.task_id=? ORDER BY a.id LIMIT 201",
      )
      .all(scope.taskId, scope.projectId, scope.taskId) as OrchestrationReviewMember[]
    const rows = this.db
      .prepare(
        "SELECT source_run_id,revision,review FROM orchestration_run_reviews v WHERE task_id=? AND revision=(SELECT max(revision) FROM orchestration_run_reviews WHERE task_id=v.task_id AND source_run_id=v.source_run_id) ORDER BY source_run_id LIMIT 201",
      )
      .all(scope.taskId) as Row[]
    if (members.length > 200 || rows.length > 200)
      throw new OrchestrationReviewError(
        "BAD_REQUEST",
        "This task exceeds the 200-run review view limit. Open a smaller task.",
      )
    return {
      members: members.map((member) => ({
        ...member,
        name: member.name ?? member.agentId,
        role: member.role ?? "agent",
      })),
      reviews: rows.map(dto),
    }
  }
  set(raw: z.input<typeof orchestrationSetReviewSchema>): OrchestrationRunReview {
    const input = orchestrationSetReviewSchema.parse(raw)
    return this.db
      .transaction(() => {
        this.scope(input)
        const before = this.current(input.taskId, input.sourceRunId)
        if (before.revision !== input.expectedRevision)
          throw new OrchestrationReviewError("CONFLICT", "Review changed. Refresh before saving.")
        if (input.review) {
          if (input.sourceRunId === input.review.reviewerRunId)
            throw new OrchestrationReviewError(
              "BAD_REQUEST",
              "Reviewer run must differ from source run.",
            )
          this.member(input, input.sourceRunId)
          this.member(input, input.review.reviewerRunId)
          if (input.review.verdict === "pass")
            this.requireTerminal(input, input.sourceRunId, input.review.reviewerRunId)
        } else if (before.revision === 0) this.member(input, input.sourceRunId)
        return this.save(
          input.taskId,
          input.sourceRunId,
          before.revision,
          input.review ? { ...input.review, recordedAt: Date.now(), attribution: "manual" } : null,
        )
      })
      .immediate()
  }
  restore(raw: z.input<typeof orchestrationRestoreReviewSchema>): OrchestrationRunReview {
    const input = orchestrationRestoreReviewSchema.parse(raw)
    return this.db
      .transaction(() => {
        this.scope(input)
        const current = this.current(input.taskId, input.sourceRunId)
        if (current.revision !== input.expectedRevision)
          throw new OrchestrationReviewError(
            "CONFLICT",
            "Review changed. Refresh before undo or redo.",
          )
        if (!current.revision)
          throw new OrchestrationReviewError(
            "NOT_FOUND",
            "No saved review history exists for this run.",
          )
        const target =
          input.targetRevision === 0
            ? { review: null }
            : (this.db
                .prepare(
                  "SELECT review FROM orchestration_run_reviews WHERE task_id=? AND source_run_id=? AND revision=?",
                )
                .get(input.taskId, input.sourceRunId, input.targetRevision) as
                { review: string | null } | undefined)
        if (!target)
          throw new OrchestrationReviewError("NOT_FOUND", "Review revision is no longer available.")
        const review = target.review ? (JSON.parse(target.review) as OrchestrationReview) : null
        if (review?.verdict === "pass")
          this.requireTerminal(input, input.sourceRunId, review.reviewerRunId)
        return this.save(input.taskId, input.sourceRunId, current.revision, review)
      })
      .immediate()
  }
  private save(
    taskId: string,
    sourceRunId: string,
    revision: number,
    review: OrchestrationReview | null,
  ) {
    if (revision === 0) {
      const count = this.db
        .prepare(
          "SELECT count(DISTINCT source_run_id) count FROM orchestration_run_reviews WHERE task_id=?",
        )
        .get(taskId) as { count: number }
      if (count.count >= 200)
        throw new OrchestrationReviewError(
          "BAD_REQUEST",
          "This task has reached the 200-run review limit.",
        )
    }
    this.db
      .prepare(
        "INSERT INTO orchestration_run_reviews(task_id,source_run_id,revision,review) VALUES(?,?,?,?)",
      )
      .run(taskId, sourceRunId, revision + 1, review ? JSON.stringify(review) : null)
    this.db
      .prepare(
        "DELETE FROM orchestration_run_reviews WHERE task_id=? AND source_run_id=? AND revision<=?",
      )
      .run(taskId, sourceRunId, revision + 1 - 50)
    return { sourceRunId, revision: revision + 1, review }
  }
}
