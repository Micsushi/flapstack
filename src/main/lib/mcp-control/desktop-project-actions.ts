import { z } from "zod"
import { getDatabasePath, getSqliteDatabase } from "../db"
import {
  configuredProjectRecordsClient,
  ProjectRecordsOperationError,
  type ProjectRecordsClient,
} from "../project-records/client"
import { RecordTaskTargetError } from "../project-records/task-chat-contract"
import { projectRecordsEnabled } from "../project-records/mode"
import { configuredRecordTaskWorktrees } from "../project-records/configured-task-worktrees"
import { createMcpMutationService } from "./mutation-service"
import { desktopProjectToolNames, projectActionSchemas } from "./project-control-contract"
import type { McpCallerIdentity, McpControlResponse } from "./types"
import type Database from "better-sqlite3"

type ProjectInvocation = { invocationId: string; approved: boolean; desktopApproved?: boolean }

export async function invokeDesktopProjectTool(
  name: string,
  caller: McpCallerIdentity,
  input: unknown,
  context: ProjectInvocation,
): Promise<McpControlResponse> {
  try {
    return await dispatchProjectTool(name, caller, input, context)
  } catch (error) {
    if (error instanceof RecordTaskTargetError)
      return { ok: false, error: { code: error.code, message: error.message } }
    if (error instanceof ProjectRecordsOperationError) {
      if (error.status === 409)
        return {
          ok: false,
          error: {
            code: "conflict",
            message: "The Records task changed. Refresh the task before retrying.",
          },
        }
      if (error.status === 404)
        return {
          ok: false,
          error: {
            code: "stale-target",
            message: "The Records destination is no longer available.",
          },
        }
      if (error.status === 400 || error.status === 422)
        return {
          ok: false,
          error: {
            code: "invalid-input",
            message:
              "Project Records rejected the task details. Check the project, document and task fields.",
          },
        }
      if (error.status === 403)
        return {
          ok: false,
          error: { code: "permission-denied", message: "Project Records refused this operation." },
        }
    }
    return {
      ok: false,
      error: {
        code: "reconciliation-required",
        message:
          "Flapstack could not confirm the project operation. Check the task or checkout before retrying.",
      },
    }
  }
}

async function dispatchProjectTool(
  name: string,
  caller: McpCallerIdentity,
  input: unknown,
  context: ProjectInvocation,
): Promise<McpControlResponse> {
  if (name === "orchestrate_task") {
    if (projectRecordsEnabled())
      return {
        ok: false,
        error: {
          code: "tool-unavailable",
          message:
            "The canonical Records Board owns task orchestration in this profile. Use a Records Setup or spawn a Flapstack Chat.",
        },
      }
    return createMcpMutationService(getDatabasePath()).invoke(name, caller, input, context)
  }
  const schema = projectActionSchemas[name as keyof typeof projectActionSchemas]
  if (!desktopProjectToolNames.has(name) || !schema)
    return { ok: false, error: { code: "tool-not-found", message: "Unknown project action." } }
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: parsed.error.issues[0]?.message ?? "Invalid project action.",
      },
    }
  if (!projectRecordsEnabled()) {
    if (name === "create_task" && !("records" in parsed.data))
      return createMcpMutationService(getDatabasePath()).invoke(name, caller, parsed.data, context)
    return {
      ok: false,
      error: { code: "tool-unavailable", message: "Project Records is disabled in this app." },
    }
  }
  if (caller.callerKind !== "external-owner" && !context.desktopApproved)
    return {
      ok: false,
      error: {
        code: "permission-denied",
        message: "Submit a task proposal or request desktop approval for this Records action.",
      },
    }
  if (name === "create_task") {
    const data = projectActionSchemas.create_task.parse(parsed.data)
    if (!data.records)
      return {
        ok: false,
        error: {
          code: "invalid-input",
          message: "Supply records.projectId and records.requestId for a canonical task.",
        },
      }
    if (caller.projectId && data.projectId !== caller.projectId)
      return {
        ok: false,
        error: { code: "out-of-scope", message: "Select the caller's local project." },
      }
    return {
      ok: true,
      data: await createCanonicalTask(await configuredProjectRecordsClient(), data),
    }
  }
  const localProjectId = "localProjectId" in parsed.data ? parsed.data.localProjectId : null
  if (caller.taskId || (caller.projectId && caller.projectId !== localProjectId))
    return {
      ok: false,
      error: {
        code: "out-of-scope",
        message: "The selected Chat or worktree is outside the caller's scope.",
      },
    }
  if (name === "attach_record_task_chat") {
    return {
      ok: true,
      data: await attachRecordTaskChat(
        getSqliteDatabase(),
        await configuredProjectRecordsClient(),
        projectActionSchemas.attach_record_task_chat.parse(parsed.data),
      ),
    }
  }
  if (name === "detach_record_task_chat") {
    const { chatId, localProjectId, path, recordId, canonicalProjectId, storeIdentity } =
      projectActionSchemas.detach_record_task_chat.parse(parsed.data)
    const result = getSqliteDatabase()
      .prepare(
        "DELETE FROM record_chat_links WHERE chat_id=? AND record_path=? AND record_id=? AND store_identity=? AND canonical_project_id=? AND EXISTS(SELECT 1 FROM chats WHERE id=? AND project_id=? AND archived_at IS NULL)",
      )
      .run(chatId, path, recordId, storeIdentity, canonicalProjectId, chatId, localProjectId)
    if (!result.changes)
      return {
        ok: false,
        error: { code: "stale-target", message: "The Records link changed or is missing." },
      }
    return { ok: true, data: { chatId, changed: true } }
  }
  const worktrees = await configuredRecordTaskWorktrees()
  if (name === "preview_record_task_worktree")
    return {
      ok: true,
      data: await worktrees.preview(
        projectActionSchemas.preview_record_task_worktree.parse(parsed.data),
      ),
    }
  return {
    ok: true,
    data: await worktrees.open(projectActionSchemas.open_record_task_worktree.parse(parsed.data)),
  }
}

export async function createCanonicalTask(
  client: Pick<ProjectRecordsClient, "operation">,
  data: z.infer<typeof projectActionSchemas.create_task>,
) {
  if (!data.records) throw new Error("Missing Records destination.")
  const response = await client.operation("/v1/record/create", {
    ...data.records,
    kind: "task",
    title: data.name,
    description: data.description?.trim() ? data.description : data.name,
  })
  const result = z
    .object({ recordId: z.string(), path: z.string(), revision: z.string() })
    .parse(response)
  return {
    ...result,
    id: result.recordId,
    canonicalProjectId: data.records.projectId,
    authority: "records",
  }
}

export async function attachRecordTaskChat(
  db: Database.Database,
  client: Pick<ProjectRecordsClient, "read" | "storeIdentity">,
  data: z.infer<typeof projectActionSchemas.attach_record_task_chat>,
) {
  const store = await client.storeIdentity()
  const snapshot = await client.read(data.path)
  const record = snapshot.document.records.find(
    (item) => item.id === data.recordId && item.kind === "task",
  )
  if (
    snapshot.path !== data.path ||
    snapshot.revision !== data.expectedRevision ||
    !Array.isArray(record?.projects) ||
    !record.projects.some(
      (project) =>
        project &&
        typeof project === "object" &&
        "id" in project &&
        project.id === data.canonicalProjectId,
    )
  )
    throw new RecordTaskTargetError(
      "The canonical task or its project changed. Reload the selected task.",
      "stale-target",
    )
  return db
    .transaction(() => {
      if (
        !db
          .prepare(
            "SELECT c.id FROM chats c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.project_id=? AND c.task_id IS NULL AND c.archived_at IS NULL AND p.archived_at IS NULL",
          )
          .get(data.chatId, data.localProjectId)
      )
        throw new RecordTaskTargetError("Select an active project Chat without a local task.")
      if (db.prepare("SELECT 1 FROM record_task_worktrees WHERE chat_id=?").get(data.chatId))
        throw new RecordTaskTargetError("This Chat already has a claimed Records worktree.")
      db.prepare(
        "INSERT INTO record_chat_links(chat_id,store_identity,record_path,record_id,canonical_project_id,source_revision) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id) DO NOTHING",
      ).run(
        data.chatId,
        store,
        data.path,
        data.recordId,
        data.canonicalProjectId,
        data.expectedRevision,
      )
      if (
        !db
          .prepare(
            "SELECT 1 FROM record_chat_links WHERE chat_id=? AND store_identity=? AND record_path=? AND record_id=? AND canonical_project_id=?",
          )
          .get(data.chatId, store, data.path, data.recordId, data.canonicalProjectId)
      )
        throw new RecordTaskTargetError(
          "Detach the previous Records task before assigning another.",
        )
      return {
        chatId: data.chatId,
        recordId: data.recordId,
        path: data.path,
        storeIdentity: store,
        canonicalProjectId: data.canonicalProjectId,
        localProjectId: data.localProjectId,
      }
    })
    .immediate()
}
