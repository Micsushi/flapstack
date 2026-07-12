import { z } from "zod"
import { evaluateMcpGate } from "../../mcp-control/gate"
import { getChatMcpExposureStatus, setChatMcpExposure } from "../../mcp-control/exposure"
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

  getExposure: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input }) => getChatMcpExposureStatus(input.chatId)),

  setExposure: publicProcedure
    .input(z.object({ chatId: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => ({ enabled: setChatMcpExposure(input.chatId, input.enabled) })),

  listAuditLog: publicProcedure.query(() => {
    return {
      entries: [],
      status: "scaffolded" as const,
      reason: "Audit log schema and migration are part of Stage 3 S3.4.",
    }
  }),
})
