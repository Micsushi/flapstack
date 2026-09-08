import type Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { z } from "zod"
import {
  worktreeDeclarationScopeSchema,
  setWorktreeDeclarationSchema,
  restoreWorktreeDeclarationSchema,
  type WorktreeDeclarationRevision,
  type WorktreeDeclarationState,
  type WorktreeDeclarationMember,
} from "../../../shared/worktree-declarations"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { OrchestrationReviewError } from "./review-links"
import { sharedWorktreeKey } from "./shared-worktrees"

const safeText = z
  .string()
  .min(1)
  .max(2000)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v))
const storedSchema = z
  .object({
    agentId: safeText,
    chatId: safeText,
    subChatId: safeText.nullable(),
    worktreePath: safeText,
    intent: z.enum(["read", "write"]),
    recordedAt: z.number().int().nonnegative(),
    attribution: z.literal("manual"),
    identity: z
      .object({ path: safeText, canonicalPath: safeText, deviceId: safeText, inodeId: safeText })
      .strict(),
  })
  .strict()
type Scope = z.infer<typeof worktreeDeclarationScopeSchema>
type Stored = z.infer<typeof storedSchema>
type Row = { task_id: string; run_id: string; revision: number; declaration: string | null }
type Member = {
  agentId: string
  runId: string
  chatId: string
  subChatId: string | null
  name: string | null
  runStatus: string
  path: string | null
  target: string | null
}
const terminal = new Set(["success", "failure", "cancelled"])
const live = new Set(["pending", "running"])
const fail = (message: string): never => {
  throw new OrchestrationReviewError("BAD_REQUEST", message)
}
const parse = (row: Row): Stored | null =>
  row.declaration === null ? null : storedSchema.parse(JSON.parse(row.declaration))
const dto = (row: Row): WorktreeDeclarationRevision => {
  const stored = parse(row)
  if (!stored) return { runId: row.run_id, revision: row.revision, declaration: null }
  const { identity: _identity, ...declaration } = stored
  return { runId: row.run_id, revision: row.revision, declaration }
}

/** Manual intentions, not permission changes, execution leases or filesystem locks. */
export class WorktreeDeclarationService {
  constructor(private readonly db: Database.Database) {}
  private scope(scope: Scope) {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM tasks t JOIN task_orchestrations o ON o.task_id=t.id WHERE t.id=? AND t.project_id=?",
        )
        .get(scope.taskId, scope.projectId)
    )
      throw new OrchestrationReviewError("FORBIDDEN", "Task orchestration is outside this project.")
  }
  private members(scope: Scope): Member[] {
    const rows = this.db
      .prepare(
        `SELECT a.id agentId,r.id runId,r.chat_id chatId,r.sub_chat_id subChatId,
      json_extract(a.definition,'$.name') name,r.status runStatus,r.worktree_path path,r.provider_runtime_target target
      FROM orchestration_agents a JOIN agent_runs r ON r.id=a.run_id AND r.chat_id=a.chat_id
      JOIN chats c ON c.id=r.chat_id WHERE a.task_id=? AND c.task_id=? AND c.project_id=? ORDER BY a.id LIMIT 201`,
      )
      .all(scope.taskId, scope.taskId, scope.projectId) as Member[]
    if (rows.length > 200) fail("This task exceeds the 200-member declaration view limit.")
    return rows
  }
  private identity(member: Member, verifyFilesystem = true) {
    if (member.target !== "local") fail("Declarations require a local run.")
    if (!member.path || !sharedWorktreeKey(member.path))
      fail("Run has no registered local worktree.")
    try {
      const identity = verifyFilesystem
        ? assertRegisteredFilesystemRoot(member.path!, drizzle(this.db))
        : storedSchema.shape.identity.parse(
            this.db
              .prepare(
                "SELECT path,canonical_path canonicalPath,device_id deviceId,inode_id inodeId FROM filesystem_root_registrations WHERE path=?",
              )
              .get(member.path!),
          )
      if (!identity.deviceId || !identity.inodeId)
        fail("Worktree registration needs a stable filesystem identity.")
      return { ...identity, deviceId: identity.deviceId!, inodeId: identity.inodeId! }
    } catch {
      return fail(
        "Registered worktree identity cannot be verified. Reconnect it before declaring access.",
      )
    }
  }
  private current(taskId: string, runId: string): Row {
    return (
      (this.db
        .prepare(
          "SELECT task_id,run_id,revision,declaration FROM orchestration_worktree_declarations WHERE task_id=? AND run_id=? ORDER BY revision DESC LIMIT 1",
        )
        .get(taskId, runId) as Row | undefined) ?? {
        task_id: taskId,
        run_id: runId,
        revision: 0,
        declaration: null,
      }
    )
  }
  private active(scope: Scope, runId: string, intent: "read" | "write"): Stored {
    const member = this.members(scope).find((m) => m.runId === runId)
    if (!member) return fail("Select a current run belonging to this project's task orchestration.")
    if (!live.has(member.runStatus))
      return fail(
        "Only pending or running local runs can declare access. Terminal declarations remain historical.",
      )
    const identity = this.identity(member)
    return {
      agentId: member.agentId,
      chatId: member.chatId,
      subChatId: member.subChatId,
      worktreePath: identity.canonicalPath,
      identity,
      intent,
      recordedAt: Date.now(),
      attribution: "manual",
    }
  }
  private save(scope: Scope, runId: string, revision: number, value: Stored | null) {
    if (revision === 0) {
      const count = this.db
        .prepare(
          "SELECT count(*) count FROM (SELECT d.task_id,d.run_id FROM orchestration_worktree_declarations d JOIN tasks t ON t.id=d.task_id WHERE t.project_id=? GROUP BY d.task_id,d.run_id)",
        )
        .get(scope.projectId) as { count: number }
      if (count.count >= 200) fail("This project has reached the 200-run declaration limit.")
    }
    const declaration = value ? JSON.stringify(storedSchema.parse(value)) : null
    this.db
      .prepare(
        "INSERT INTO orchestration_worktree_declarations(task_id,run_id,revision,declaration) VALUES(?,?,?,?)",
      )
      .run(scope.taskId, runId, revision + 1, declaration)
    this.db
      .prepare(
        "DELETE FROM orchestration_worktree_declarations WHERE task_id=? AND run_id=? AND revision<=?",
      )
      .run(scope.taskId, runId, revision + 1 - 50)
    return dto({ task_id: scope.taskId, run_id: runId, revision: revision + 1, declaration })
  }
  set(raw: z.input<typeof setWorktreeDeclarationSchema>) {
    const input = setWorktreeDeclarationSchema.parse(raw)
    return this.db
      .transaction(() => {
        this.scope(input)
        const row = this.current(input.taskId, input.runId)
        if (row.revision !== input.expectedRevision)
          throw new OrchestrationReviewError(
            "CONFLICT",
            "Declaration changed. Refresh before saving.",
          )
        const value = input.intent ? this.active(input, input.runId, input.intent) : null
        if (!value && !row.revision) fail("No declaration exists to release.")
        return this.save(input, input.runId, row.revision, value)
      })
      .immediate()
  }
  restore(raw: z.input<typeof restoreWorktreeDeclarationSchema>) {
    const input = restoreWorktreeDeclarationSchema.parse(raw)
    return this.db
      .transaction(() => {
        this.scope(input)
        const row = this.current(input.taskId, input.runId)
        if (row.revision !== input.expectedRevision)
          throw new OrchestrationReviewError(
            "CONFLICT",
            "Declaration changed. Refresh before undo or redo.",
          )
        if (!row.revision) fail("No declaration history exists for this run.")
        const target =
          input.targetRevision === 0
            ? { ...row, declaration: null }
            : (this.db
                .prepare(
                  "SELECT task_id,run_id,revision,declaration FROM orchestration_worktree_declarations WHERE task_id=? AND run_id=? AND revision=?",
                )
                .get(input.taskId, input.runId, input.targetRevision) as Row | undefined)
        if (!target) fail("Declaration revision is no longer available.")
        const saved = parse(target!)
        if (saved) {
          const current = this.active(input, input.runId, saved.intent)
          if (
            JSON.stringify(current.identity) !== JSON.stringify(saved.identity) ||
            current.agentId !== saved.agentId ||
            current.chatId !== saved.chatId ||
            current.subChatId !== saved.subChatId
          )
            fail(
              "Historical declaration no longer matches the current run and registered worktree.",
            )
        }
        return this.save(input, input.runId, row.revision, saved)
      })
      .immediate()
  }
  state(raw: Scope): WorktreeDeclarationState {
    const scope = worktreeDeclarationScopeSchema.parse(raw)
    this.scope(scope)
    const members = this.members(scope).map((member): WorktreeDeclarationMember => {
      let reason: string | null = null,
        worktreePath: string | null = null
      try {
        worktreePath = this.identity(member, false).canonicalPath
        if (!live.has(member.runStatus)) reason = "Run has finished or is not pending/running."
      } catch (error) {
        reason = error instanceof Error ? error.message : "Worktree unavailable."
      }
      return {
        agentId: member.agentId,
        runId: member.runId,
        chatId: member.chatId,
        subChatId: member.subChatId,
        name: (member.name ?? member.agentId).slice(0, 200),
        runStatus: member.runStatus,
        worktreePath,
        eligible: reason === null,
        reason,
      }
    })
    const rows = this.db
      .prepare(
        `SELECT d.task_id,d.run_id,d.revision,d.declaration FROM orchestration_worktree_declarations d JOIN tasks t ON t.id=d.task_id
      WHERE t.project_id=? AND d.revision=(SELECT max(revision) FROM orchestration_worktree_declarations WHERE task_id=d.task_id AND run_id=d.run_id)
      ORDER BY d.task_id,d.run_id LIMIT 201`,
      )
      .all(scope.projectId) as Row[]
    if (rows.length > 200) fail("This project exceeds the 200-run declaration view limit.")
    const memberCache = new Map<string, Member[]>([[scope.taskId, this.members(scope)]])
    const declarations: WorktreeDeclarationState["declarations"] = []
    const groups = new Map<string, WorktreeDeclarationState["conflicts"][number]>()
    for (const row of rows) {
      let activity: WorktreeDeclarationState["declarations"][number]["activity"] = "unavailable"
      let revision: WorktreeDeclarationRevision = {
        runId: row.run_id,
        revision: row.revision,
        declaration: null,
      }
      try {
        revision = dto(row)
        const saved = parse(row)
        if (!saved) activity = "released"
        else {
          let taskMembers = memberCache.get(row.task_id)
          if (!taskMembers) {
            taskMembers = this.members({ projectId: scope.projectId, taskId: row.task_id })
            memberCache.set(row.task_id, taskMembers)
          }
          const member = taskMembers.find((m) => m.runId === row.run_id)
          if (
            !member ||
            member.agentId !== saved.agentId ||
            member.chatId !== saved.chatId ||
            member.subChatId !== saved.subChatId
          )
            activity = "retired"
          else if (terminal.has(member.runStatus)) activity = "terminal"
          else if (
            live.has(member.runStatus) &&
            JSON.stringify(this.identity(member, false)) === JSON.stringify(saved.identity)
          )
            activity = "active"
          if (activity === "active") {
            const key = sharedWorktreeKey(saved.worktreePath)!
            const group = groups.get(key) ?? { worktreePath: saved.worktreePath, runs: [] }
            group.runs.push({ taskId: row.task_id, runId: row.run_id, intent: saved.intent })
            groups.set(key, group)
          }
        }
      } catch {
        /* Invalid historical or current metadata cannot establish active ownership. */
      }
      declarations.push({ ...revision, taskId: row.task_id, activity })
    }
    return {
      observedAt: Date.now(),
      scope: "project",
      advisoryOnly: true,
      members,
      declarations,
      conflicts: [...groups.values()].filter(
        (g) => g.runs.length > 1 && g.runs.some((r) => r.intent === "write"),
      ),
    }
  }
}
