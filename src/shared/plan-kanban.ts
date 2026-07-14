import { z } from "zod"

export const taskWorkflowStatuses = ["backlog", "planned", "in-progress", "review", "done"] as const

export const taskWorkflowStatusSchema = z.enum(taskWorkflowStatuses)
export type TaskWorkflowStatus = z.infer<typeof taskWorkflowStatusSchema>

export const taskProposalStatuses = ["pending", "approved", "denied", "cancelled"] as const
export const taskProposalStatusSchema = z.enum(taskProposalStatuses)
export type TaskProposalStatus = z.infer<typeof taskProposalStatusSchema>

export const taskProposalTargetStatusSchema = z.enum(["backlog", "planned"])

export const taskSourceProvenanceSchema = z
  .object({
    sourceType: z.enum(["openspec", "markdown"]),
    sourcePath: z.string().trim().min(1).max(4096),
    sourceCandidateId: z.string().trim().min(1).max(512),
    sourceFingerprint: z.string().trim().min(1).max(256),
  })
  .strict()

export type TaskSourceProvenance = z.infer<typeof taskSourceProvenanceSchema>

export const taskProposalDraftSchema = z
  .object({
    projectId: z.string().trim().min(1),
    proposedByChatId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().max(20_000).nullable().optional(),
    targetStatus: taskProposalTargetStatusSchema.default("backlog"),
    source: taskSourceProvenanceSchema.nullable().optional(),
  })
  .strict()

export type TaskProposalDraft = z.infer<typeof taskProposalDraftSchema>

const taskStatusTransitions: Readonly<Record<TaskWorkflowStatus, readonly TaskWorkflowStatus[]>> = {
  backlog: ["planned"],
  planned: ["backlog", "in-progress"],
  "in-progress": ["planned", "review"],
  review: ["in-progress", "done"],
  done: ["review"],
}

const proposalStatusTransitions: Readonly<
  Record<TaskProposalStatus, readonly TaskProposalStatus[]>
> = {
  pending: ["approved", "denied", "cancelled"],
  approved: [],
  denied: [],
  cancelled: [],
}

export function isTaskStatusTransitionAllowed(
  from: TaskWorkflowStatus,
  to: TaskWorkflowStatus,
): boolean {
  return from === to || taskStatusTransitions[from].includes(to)
}

export function isTaskProposalStatusTransitionAllowed(
  from: TaskProposalStatus,
  to: TaskProposalStatus,
): boolean {
  return from === to || proposalStatusTransitions[from].includes(to)
}

export function assertTaskStatusTransition(from: TaskWorkflowStatus, to: TaskWorkflowStatus): void {
  if (!isTaskStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid task status transition: ${from} -> ${to}`)
  }
}

export function assertTaskProposalStatusTransition(
  from: TaskProposalStatus,
  to: TaskProposalStatus,
): void {
  if (!isTaskProposalStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid task proposal status transition: ${from} -> ${to}`)
  }
}
