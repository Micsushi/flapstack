import { z } from "zod"

export const CHAT_ASSIGNED_ROLES = ["discussion", "lead", "worker"] as const
const id = z.string().min(1).max(200)
export const chatAssignmentSchema = z
  .object({
    assignedRole: z.enum(CHAT_ASSIGNED_ROLES).nullable(),
    leadChatId: id.nullable(),
    discussionChatId: id.nullable(),
  })
  .strict()
export type ChatAssignment = z.infer<typeof chatAssignmentSchema>
export const updateChatAssignmentSchema = z
  .object({
    subChatId: id,
    expected: chatAssignmentSchema,
    assignment: chatAssignmentSchema,
  })
  .strict()
