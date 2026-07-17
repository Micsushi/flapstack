import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  AI_TASK_PROPOSAL_BATCH_CAP,
  taskProposalApprovalSchema,
} from "../../../../shared/task-proposals"
import { getDatabasePath } from "../../db"
import { TaskProposalError, TaskProposalService } from "../../task-proposals"
import { publishLocalProductInvalidation } from "../../mcp-control/invalidation-bridge"
import { betaProcedure, router } from "../index"

const publicProcedure = betaProcedure("planning")

const user = { type: "user" as const, id: "local-user" }
const service = () => new TaskProposalService(getDatabasePath())
const proposalId = z.string().trim().min(1).max(200)
const expectedVersion = z.number().int().positive()

function handle<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (!(error instanceof TaskProposalError)) throw error
    throw new TRPCError({
      code:
        error.code === "not-found"
          ? "NOT_FOUND"
          : error.code === "invalid-input"
            ? "BAD_REQUEST"
            : error.code === "out-of-scope"
              ? "FORBIDDEN"
              : "CONFLICT",
      message: error.message,
    })
  }
}

export const taskProposalsRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().trim().min(1).max(128).optional(),
          includeArchived: z.boolean().default(false),
          limit: z.number().int().min(1).max(100).default(20),
          cursor: z.string().max(64).optional(),
        })
        .default({}),
    )
    .query(({ input }) => handle(() => service().list(user, input))),

  read: publicProcedure
    .input(z.object({ proposalId }))
    .query(({ input }) => handle(() => service().read(user, input.proposalId))),

  preview: publicProcedure
    .input(z.object({ proposalId }))
    .query(({ input }) => handle(() => service().preview(user, input.proposalId))),

  approve: publicProcedure.input(taskProposalApprovalSchema).mutation(({ input }) => {
    const result = handle(() => service().approve(user, input))
    if (result.item.created) {
      publishLocalProductInvalidation({
        version: 1,
        source: "product-mcp",
        domains: ["task-proposals", "tasks", "chats", "plan-sources"],
        projectIds: [result.item.proposal.projectId],
        proposalIds: [result.item.proposal.id],
        taskIds: [String(result.item.task.id)],
        chatIds: [String(result.item.chat.id)],
      })
    }
    return result
  }),

  approveBatch: publicProcedure
    .input(
      z.object({
        approvals: z.array(taskProposalApprovalSchema).min(1).max(AI_TASK_PROPOSAL_BATCH_CAP),
      }),
    )
    .mutation(({ input }) => {
      const result = handle(() => service().approveBatch(user, input))
      const created = result.items.filter((item) => item.created)
      if (created.length > 0) {
        publishLocalProductInvalidation({
          version: 1,
          source: "product-mcp",
          domains: ["task-proposals", "tasks", "chats", "plan-sources"],
          projectIds: [...new Set(created.map((item) => item.proposal.projectId))],
          proposalIds: created.map((item) => item.proposal.id),
          taskIds: created.map((item) => String(item.task.id)),
          chatIds: created.map((item) => String(item.chat.id)),
        })
      }
      return result
    }),

  deny: publicProcedure.input(z.object({ proposalId, expectedVersion })).mutation(({ input }) => {
    const result = handle(() => service().deny(user, input))
    if (result.changed) {
      publishLocalProductInvalidation({
        version: 1,
        source: "product-mcp",
        domains: ["task-proposals", "plan-sources"],
        projectIds: [result.record.projectId],
        proposalIds: [result.record.id],
      })
    }
    return result
  }),
})
