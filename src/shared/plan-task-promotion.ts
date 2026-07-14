import { z } from "zod"
import { taskWorkflowStatusSchema } from "./plan-kanban"

export const planPromotionPermissionModes = [
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
  "custom",
] as const

export const planPromotionPermissionModeSchema = z.enum(planPromotionPermissionModes)
export const planPromotionWorktreeModeSchema = z.enum(["task-primary", "project-checkout"])

export const planCandidateReferenceSchema = z
  .object({
    sourceProjectId: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1).max(4096),
    sourceFingerprint: z.string().trim().min(1).max(256),
    candidateId: z.string().trim().min(1).max(512),
    candidateFingerprint: z.string().trim().min(1).max(256),
  })
  .strict()

export const planTaskPromotionPreviewInputSchema = z
  .object({
    reference: planCandidateReferenceSchema,
    targetProjectId: z.string().trim().min(1).optional(),
  })
  .strict()

export const planTaskPromotionConfirmInputSchema = z
  .object({
    reference: planCandidateReferenceSchema,
    idempotencyKey: z.string().trim().min(8).max(256),
    targetProjectId: z.string().trim().min(1),
    taskName: z.string().trim().min(1).max(256),
    taskDescription: z.string().trim().max(20_000).nullable(),
    status: taskWorkflowStatusSchema,
    permissionMode: planPromotionPermissionModeSchema,
    customPermissions: z.record(z.unknown()).nullable(),
    worktreeMode: planPromotionWorktreeModeSchema,
    seedText: z.string().trim().min(1).max(40_000),
  })
  .strict()

export type PlanCandidateReference = z.infer<typeof planCandidateReferenceSchema>
export type PlanTaskPromotionPreviewInput = z.infer<typeof planTaskPromotionPreviewInputSchema>
export type PlanTaskPromotionConfirmInput = z.infer<typeof planTaskPromotionConfirmInputSchema>
export type PlanPromotionPermissionMode = z.infer<typeof planPromotionPermissionModeSchema>
export type PlanPromotionWorktreeMode = z.infer<typeof planPromotionWorktreeModeSchema>

export interface PlanTaskPromotionPreview {
  reference: PlanCandidateReference
  project: {
    id: string
    name: string
    path: string
    gitRemoteUrl: string | null
    gitProvider: string | null
    gitOwner: string | null
    gitRepo: string | null
  }
  source: {
    type: "openspec" | "markdown"
    path: string
    candidatePath: string
    candidateLine: number
  }
  task: {
    name: string
    description: string | null
    status: "in-progress"
  }
  permission: {
    mode: PlanPromotionPermissionMode
    customPermissions: Record<string, unknown> | null
  }
  worktree: {
    mode: "task-primary"
    label: string
    path: null
  }
  chat: {
    name: string
    seedText: string
  }
}
