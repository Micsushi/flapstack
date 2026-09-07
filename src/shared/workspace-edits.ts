import { z } from "zod"

export const workspaceEditMaxBytes = 2 * 1024 * 1024
export const workspaceEditScopeSchema = z.object({
  projectId: z.string().min(1).max(200),
  chatId: z.string().min(1).max(200),
})
export const workspaceEditTargetSchema = workspaceEditScopeSchema.extend({
  relativePath: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
})
export const saveWorkspaceEditSchema = workspaceEditTargetSchema.extend({
  id: z.string().uuid(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().max(workspaceEditMaxBytes),
  intent: z.enum(["save", "autosave"]),
})
export const revertWorkspaceEditSchema = workspaceEditScopeSchema.extend({
  id: z.string().uuid(),
  operationId: z.string().uuid(),
})
export const saveAsWorkspaceEditSchema = workspaceEditTargetSchema.extend({
  id: z.string().uuid(),
  content: z.string().max(workspaceEditMaxBytes),
})
export const renameWorkspaceEditSchema = workspaceEditTargetSchema.extend({
  id: z.string().uuid(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  newName: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => value !== "." && value !== ".." && !/[\\/\0]/.test(value)),
})
export type WorkspaceEditScope = z.infer<typeof workspaceEditScopeSchema>
export type SaveWorkspaceEdit = z.infer<typeof saveWorkspaceEditSchema>
