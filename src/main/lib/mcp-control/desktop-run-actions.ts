import type Database from "better-sqlite3"
import { z } from "zod"
import { agentInputLifecycle } from "../agent-input/service"
import { getDatabase, getDatabasePath, getSqliteDatabase } from "../db"
import { getMainRuntimeLaunchService } from "../main-run-launcher"
import { mcpTargetPermissionAllowed } from "./permission-ceiling"
import { findPrompt, queueChatRun } from "../run-launch-service"
import {
  listPendingCodexPermissionRequests,
  replyPendingCodexPermissionRequest,
} from "../codex/permission-bridge"
import {
  listPendingOpencodeApprovals,
  replyPendingOpencodeApproval,
} from "../trpc/routers/opencode"
import {
  decideApprovalWithLocalWriteContext,
  isLocalWriteApprovalTool,
  listPendingApprovalsWithLocalWriteContext,
} from "./local-write-approval-context"
import { liveControlSchemas } from "./live-control-contract"
import { canonicalMcpChatScope } from "./scope"
import type { McpCallerIdentity, McpControlErrorCode, McpControlResponse } from "./types"

const fail = (code: McpControlErrorCode, message: string): McpControlResponse => ({
  ok: false,
  error: { code, message },
})
const stale = () =>
  fail(
    "stale-target",
    "The selected request or run is outside the active caller scope or is no longer available.",
  )

function visibleChat(db: Database.Database, caller: McpCallerIdentity, chatId: string) {
  const row = db
    .prepare(
      `SELECT c.id,c.scope,c.project_id,c.task_id,p.id valid_project_id,t.project_id task_project_id
    FROM chats c LEFT JOIN projects p ON p.id=c.project_id AND p.archived_at IS NULL
    LEFT JOIN tasks t ON t.id=c.task_id AND t.archived_at IS NULL WHERE c.id=? AND c.archived_at IS NULL`,
    )
    .get(chatId) as Record<string, unknown> | undefined
  const target = row && canonicalMcpChatScope(row)
  return (
    !!target &&
    (caller.projectId === null || caller.projectId === target.projectId) &&
    (!caller.taskId || caller.taskId === target.taskId)
  )
}
function visibleRun(db: Database.Database, caller: McpCallerIdentity, runId: string) {
  const row = db
    .prepare(
      "SELECT id,chat_id,sub_chat_id,status,initial_prompt,prompt_message_id,permission_mode,custom_permissions FROM agent_runs WHERE id=?",
    )
    .get(runId) as
    | {
        id: string
        chat_id: string
        sub_chat_id: string
        status: string
        initial_prompt: string | null
        prompt_message_id: string | null
        permission_mode: string
        custom_permissions: string | null
      }
    | undefined
  return row && visibleChat(db, caller, row.chat_id) ? row : null
}

function listPending(
  caller: McpCallerIdentity,
  input: z.infer<typeof liveControlSchemas.list_pending_approvals>,
) {
  const sqlite = getSqliteDatabase()
  const visible = (runId: string) =>
    (!input.runId || input.runId === runId) &&
    visibleRun(sqlite, caller, runId)?.status === "running"
  const app = listPendingApprovalsWithLocalWriteContext(getDatabase())
    .filter((row) => {
      if (!(
        visibleChat(sqlite, caller, row.chatId) ||
        (caller.callerKind === "external-owner" && row.chatId === caller.chatId)
      ))
        return false
      if (!input.runId) return true
      return !!sqlite
        .prepare("SELECT 1 FROM mcp_approval_requests WHERE id=? AND caller_run_id=?")
        .get(row.id, input.runId)
    })
    .map((row) => ({
      kind: "app",
      requestId: row.id,
      chatId: row.chatId,
      tool: row.toolName,
      summary: row.targetLabel,
      expiresAt: row.expiresAt,
    }))
  const requests = agentInputLifecycle
    .list()
    .filter((row) => visible(row.runId))
    .map((row) => ({
      kind: row.kind ?? "question",
      requestId: row.requestId,
      runId: row.runId,
      questions: row.questions,
    }))
  const codex = listPendingCodexPermissionRequests({ runId: input.runId })
    .filter((row) => visible(row.runId))
    .map(({ kind: toolKind, ...row }) => ({ ...row, kind: "codex", toolKind }))
  const opencode = listPendingOpencodeApprovals(input.runId)
    .filter((row) => visible(row.runId))
    .map((row) => ({
      kind: "opencode",
      requestId: row.requestId,
      runId: row.runId,
      permission: row.permission,
    }))
  return { items: [...app, ...requests, ...codex, ...opencode].slice(0, input.limit) }
}

function respond(
  caller: McpCallerIdentity,
  input: z.infer<typeof liveControlSchemas.respond_to_approval>,
): McpControlResponse {
  if (caller.callerKind !== "external-owner" || caller.permissionMode !== "full-access")
    return fail(
      "permission-denied",
      "Resolving a permission request requires a full-access owner grant.",
    )
  let resolved = false
  if (input.kind === "app") {
    const row = listPendingApprovalsWithLocalWriteContext(getDatabase()).find(
      (row) => row.id === input.requestId,
    )
    if (!row) return stale()
    if (input.decision === "approve" && isLocalWriteApprovalTool(row.toolName))
      return fail("forbidden-target", "Review this file change in the desktop approval dialog.")
    resolved = decideApprovalWithLocalWriteContext(getDatabase(), {
      id: row.id,
      decision: input.decision,
      grantSession: false,
    })
  } else if (input.kind === "permission") {
    const request = agentInputLifecycle.get(input.requestId)
    if (
      request?.kind !== "permission" ||
      visibleRun(getSqliteDatabase(), caller, request.runId)?.status !== "running"
    )
      return stale()
    const label = input.decision === "approve" ? "Allow once" : "Deny"
    if (
      !request.questions.some(
        (q) => q.id === "permission" && q.options.some((option) => option.label === label),
      )
    )
      return fail("invalid-input", "This permission requires a desktop decision.")
    resolved = agentInputLifecycle.answer({
      requestId: input.requestId,
      mode: "structured",
      answers: { permission: [label] },
      submittedAt: Date.now(),
    })
  } else if (input.kind === "codex") {
    const request = listPendingCodexPermissionRequests().find(
      (row) => row.requestId === input.requestId,
    )
    if (!request || visibleRun(getSqliteDatabase(), caller, request.runId)?.status !== "running")
      return stale()
    const option = request.options.find(
      (option) => option.kind === (input.decision === "approve" ? "allow_once" : "reject_once"),
    )
    if (!option)
      return fail("invalid-input", "This Codex request has no matching one-time decision.")
    resolved = replyPendingCodexPermissionRequest({
      requestId: input.requestId,
      optionId: option.optionId,
    }).resolved
  } else {
    const request = listPendingOpencodeApprovals().find((row) => row.requestId === input.requestId)
    if (!request || visibleRun(getSqliteDatabase(), caller, request.runId)?.status !== "running")
      return stale()
    resolved = replyPendingOpencodeApproval({
      requestId: input.requestId,
      reply: input.decision === "approve" ? "once" : "reject",
    }).resolved
  }
  return resolved ? { ok: true, data: { resolved } } : stale()
}

export async function invokeDesktopRunTool(
  name: string,
  caller: McpCallerIdentity,
  rawInput: unknown,
): Promise<McpControlResponse> {
  try {
    if (name === "list_pending_approvals")
      return {
        ok: true,
        data: listPending(caller, liveControlSchemas.list_pending_approvals.parse(rawInput)),
      }
    if (name === "respond_to_approval")
      return respond(caller, liveControlSchemas.respond_to_approval.parse(rawInput))
    const db = getSqliteDatabase()
    if (name === "answer_agent_question") {
      const input = liveControlSchemas.answer_agent_question.parse(rawInput)
      const request = agentInputLifecycle.get(input.requestId)
      if (!request || request.kind === "permission") return stale()
      const target = visibleRun(db, caller, request.runId)
      if (!target || target.status !== "running") return stale()
      if (!mcpTargetPermissionAllowed(caller, target.permission_mode, target.custom_permissions))
        return fail("permission-denied", "Target run exceeds the caller's permissions.")
      try {
        const answered = agentInputLifecycle.answer({
          ...input,
          mode: "structured",
          submittedAt: Date.now(),
        })
        return answered ? { ok: true, data: { answered, runId: request.runId } } : stale()
      } catch {
        return fail("invalid-input", "Answers must match each question and its available choices.")
      }
    }
    if (name !== "stop_run" && name !== "steer_run" && name !== "retry_run")
      return fail("tool-not-found", "Unknown desktop run control.")
    const input =
      name === "stop_run"
        ? ({ kind: name, ...liveControlSchemas.stop_run.parse(rawInput) } as const)
        : name === "steer_run"
          ? ({ kind: name, ...liveControlSchemas.steer_run.parse(rawInput) } as const)
          : ({ kind: name, ...liveControlSchemas.retry_run.parse(rawInput) } as const)
    const target = visibleRun(db, caller, input.runId)
    if (!target) return stale()
    if (target.id === caller.runId || (name !== "stop_run" && target.chat_id === caller.chatId))
      return fail(
        "forbidden-loop",
        "Cannot control the current caller run or enqueue work into its own conversation.",
      )
    if (input.kind === "stop_run") {
      if (!["pending", "running"].includes(target.status)) return stale()
      const stopped = await getMainRuntimeLaunchService(getDatabasePath()).cancel(
        target.id,
        "mcp-stop-requested",
      )
      if (stopped) agentInputLifecycle.cancelByRun(target.id)
      return stopped
        ? { ok: true, data: { stopped, chatId: target.chat_id, runId: target.id } }
        : fail("conflict", "The runtime could not confirm cancellation.")
    }
    if (!mcpTargetPermissionAllowed(caller, target.permission_mode, target.custom_permissions))
      return fail("permission-denied", "Target run exceeds the caller's permissions.")
    if (input.kind === "steer_run") {
      if (target.status !== "running") return stale()
      if (input.delivery === "steer") {
        try {
          await getMainRuntimeLaunchService(getDatabasePath()).steer(
            target.id,
            target.sub_chat_id,
            input.message,
          )
        } catch {
          return fail(
            "conflict",
            "The runtime did not confirm steering. Check the turn before sending a follow-up.",
          )
        }
        return { ok: true, data: { delivery: "steered", chatId: target.chat_id, runId: target.id } }
      }
      if (!input.idempotencyKey)
        return fail("invalid-input", "Queued follow-ups require an idempotencyKey.")
      const queued = queueChatRun(
        db,
        {
          chatId: target.chat_id,
          subChatId: target.sub_chat_id,
          initialPrompt: input.message,
          idempotencyKey: input.idempotencyKey,
        },
        caller,
      )
      return queued.ok
        ? { ok: true, data: { ...queued, delivery: "queued", chatId: target.chat_id } }
        : fail(queued.code, queued.message)
    }
    if (!["cancelled", "failure"].includes(target.status))
      return fail(
        "stale-target",
        "Retry requires a failed or cancelled run with a persisted prompt.",
      )
    const history = target.initial_prompt
      ? undefined
      : (db
          .prepare("SELECT messages FROM sub_chats WHERE id=? AND chat_id=?")
          .get(target.sub_chat_id, target.chat_id) as { messages: string } | undefined)
    const prompt = target.initial_prompt || findPrompt(history?.messages, target.prompt_message_id)
    if (!prompt)
      return fail("stale-target", "The original prompt is no longer in the conversation.")
    const queued = queueChatRun(
      db,
      {
        chatId: target.chat_id,
        subChatId: target.sub_chat_id,
        initialPrompt: prompt,
        idempotencyKey: input.idempotencyKey,
      },
      caller,
    )
    return queued.ok
      ? { ok: true, data: { ...queued, retryOf: target.id, chatId: target.chat_id } }
      : fail(queued.code, queued.message)
  } catch (error) {
    if (error instanceof z.ZodError)
      return fail("invalid-input", error.issues[0]?.message ?? "Invalid input.")
    throw error
  }
}
