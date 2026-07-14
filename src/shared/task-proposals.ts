import { z } from "zod"
import {
  planPromotionPermissionModeSchema,
  planPromotionWorktreeModeSchema,
} from "./plan-task-promotion"
import { taskProposalTargetStatusSchema, taskSourceProvenanceSchema } from "./plan-kanban"

export const AI_TASK_PROPOSAL_BATCH_CAP = 10
export const AI_TASK_PROPOSAL_PENDING_CAP = 20
export const AI_TASK_PROPOSAL_RATE_CAP = 10
export const AI_TASK_PROPOSAL_RATE_WINDOW_MS = 60_000

export const taskProposalContentSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().max(20_000).nullable().default(null),
    targetStatus: taskProposalTargetStatusSchema.default("backlog"),
    source: taskSourceProvenanceSchema.nullable().default(null),
  })
  .strict()

export const taskProposalReviewSchema = z
  .object({
    taskName: z.string().trim().min(1).max(256),
    taskDescription: z.string().trim().max(20_000).nullable(),
    status: taskProposalTargetStatusSchema,
    permissionMode: planPromotionPermissionModeSchema,
    customPermissions: z.record(z.unknown()).nullable(),
    worktreeMode: planPromotionWorktreeModeSchema,
    seedText: z.string().trim().min(1).max(40_000),
  })
  .strict()

export const taskProposalApprovalSchema = z
  .object({
    proposalId: z.string().trim().min(1).max(200),
    expectedVersion: z.number().int().positive(),
    review: taskProposalReviewSchema,
  })
  .strict()

export type TaskProposalContent = z.infer<typeof taskProposalContentSchema>
export type TaskProposalReview = z.infer<typeof taskProposalReviewSchema>
export type TaskProposalApproval = z.infer<typeof taskProposalApprovalSchema>

export type TaskProposalRecord = {
  id: string
  projectId: string
  projectName: string
  proposedByChatId: string
  name: string
  description: string | null
  targetStatus: "backlog" | "planned"
  status: "pending" | "approved" | "denied" | "cancelled"
  version: number
  source: {
    sourceType: "openspec" | "markdown"
    sourcePath: string
    sourceCandidateId: string
    sourceFingerprint: string
  } | null
  createdAt: number
  updatedAt: number
  decidedAt: number | null
  archivedAt: number | null
}

export type TaskProposalPreview = {
  proposal: TaskProposalRecord
  project: { id: string; name: string; path: string }
  review: TaskProposalReview
}
