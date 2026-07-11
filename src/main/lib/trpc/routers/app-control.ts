import { z } from "zod"
import { evaluateMcpGate } from "../../mcp-control/gate"
import { mcpControlTools } from "../../mcp-control/registry"
import { publicProcedure, router } from "../index"

const riskTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

export const appControlRouter = router({
  describe: publicProcedure.query(() => {
    return {
      enabled: false,
      transport: "stdio-available" as const,
      reason:
        "Stage 3 stdio transport is implemented but exposure stays disabled until the trusted risk gate is integrated.",
      tools: mcpControlTools,
    }
  }),

  evaluateGate: publicProcedure
    .input(
      z.object({
        tier: riskTierSchema,
        permissionMode: z.string().nullable().optional(),
        approved: z.boolean().optional(),
      }),
    )
    .query(({ input }) => {
      return evaluateMcpGate(input)
    }),

  listAuditLog: publicProcedure.query(() => {
    return {
      entries: [],
      status: "scaffolded" as const,
      reason: "Audit log schema and migration are part of Stage 3 S3.4.",
    }
  }),
})
