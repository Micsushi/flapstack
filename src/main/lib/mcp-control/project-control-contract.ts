import { z } from "zod"
import { projectRecordPathSchema } from "../../../shared/project-records"
import {
  previewRecordChatSchema,
  openRecordChatSchema,
} from "../project-records/task-chat-contract"

const id = z.string().trim().min(1).max(200)
export const projectActionSchemas = {
  create_project: z.object({ path: z.string().min(1).max(32767), name: id.optional() }).strict(),
  create_task: z
    .object({
      projectId: id.optional(),
      name: id,
      description: z.string().max(20000).optional(),
      records: z
        .object({
          projectId: id,
          path: projectRecordPathSchema.optional(),
          requestId: id,
          expectedRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  attach_record_task_chat: previewRecordChatSchema
    .omit({ claimId: true })
    .extend({ chatId: id })
    .strict(),
  detach_record_task_chat: z
    .object({
      chatId: id,
      localProjectId: id,
      recordId: id,
      path: projectRecordPathSchema,
      canonicalProjectId: id,
      storeIdentity: z.string().regex(/^sqlite:[a-f0-9]{64}$/),
    })
    .strict(),
  preview_record_task_worktree: previewRecordChatSchema,
  open_record_task_worktree: openRecordChatSchema,
}

export const desktopProjectToolNames: ReadonlySet<string> = new Set([
  "orchestrate_task",
  "create_task",
  "attach_record_task_chat",
  "detach_record_task_chat",
  "preview_record_task_worktree",
  "open_record_task_worktree",
])

export function requiresProjectApproval(
  tool: string,
  caller: { callerKind?: string; projectId?: string | null; taskId?: string | null },
  input: unknown,
) {
  if (caller.callerKind === "external-owner" || !input || typeof input !== "object") return false
  const request = input as Record<string, unknown>
  if (tool === "orchestrate_task") return false
  if (desktopProjectToolNames.has(tool)) return tool !== "create_task" || !!request.records
  if (tool === "create_project") return true
  return (
    tool === "move_chat" &&
    !!caller.projectId &&
    !caller.taskId &&
    request.scope !== "global" &&
    request.projectId !== caller.projectId
  )
}
