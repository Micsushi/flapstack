import { z } from "zod"
const id = z.string().trim().min(1).max(200)
export const worktreeDeclarationScopeSchema = z.object({ projectId: id, taskId: id }).strict()
export const setWorktreeDeclarationSchema = worktreeDeclarationScopeSchema
  .extend({
    runId: id,
    expectedRevision: z.number().int().nonnegative(),
    intent: z.enum(["read", "write"]).nullable(),
  })
  .strict()
export const restoreWorktreeDeclarationSchema = setWorktreeDeclarationSchema
  .omit({ intent: true })
  .extend({
    targetRevision: z.number().int().nonnegative(),
  })
  .strict()
export type WorktreeDeclaration = {
  agentId: string
  chatId: string
  subChatId: string | null
  worktreePath: string
  intent: "read" | "write"
  recordedAt: number
  attribution: "manual"
}
export type WorktreeDeclarationRevision = {
  runId: string
  revision: number
  declaration: WorktreeDeclaration | null
}
export type WorktreeDeclarationMember = {
  agentId: string
  runId: string
  chatId: string
  subChatId: string | null
  name: string
  runStatus: string
  worktreePath: string | null
  eligible: boolean
  reason: string | null
}
export type WorktreeDeclarationState = {
  observedAt: number
  scope: "project"
  advisoryOnly: true
  members: WorktreeDeclarationMember[]
  declarations: Array<
    WorktreeDeclarationRevision & {
      taskId: string
      activity: "active" | "released" | "terminal" | "retired" | "unavailable"
    }
  >
  conflicts: Array<{
    worktreePath: string
    runs: Array<{ taskId: string; runId: string; intent: "read" | "write" }>
  }>
}
