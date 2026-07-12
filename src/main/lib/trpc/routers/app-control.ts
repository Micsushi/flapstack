import { z } from "zod"
import { getDatabase } from "../../db"
import { listMcpAuditRecords, type McpAuditStatus } from "../../mcp-control/audit-storage"
import { evaluateMcpGate } from "../../mcp-control/gate"
import { getChatMcpExposureStatus, setChatMcpExposure } from "../../mcp-control/exposure"
import { mcpControlTools } from "../../mcp-control/registry"
import { publicProcedure, router } from "../index"
import { decideMcpApproval, listPendingMcpApprovals } from "../../mcp-control/approval-coordinator"

const riskTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
const auditDecisionSchema = z.enum([
  "allowed",
  "denied",
  "approval-required",
  "timed-out",
  "stale",
  "failed",
  "completed",
]) satisfies z.ZodType<McpAuditStatus>
const auditQuerySchema = z
  .object({
    callerChatId: z.string().trim().min(1).max(256).optional(),
    toolName: z.string().trim().min(1).max(256).optional(),
    decision: auditDecisionSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "from must not be after to",
    path: ["to"],
  })

export const appControlRouter = router({
  describe: publicProcedure.query(() => {
    return {
      enabled: false,
      transport: "stdio-available" as const,
      reason: "Flapstack MCP exposure is disabled by default and enabled per supported chat.",
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

  listAuditLog: publicProcedure.input(auditQuerySchema.optional()).query(({ input }) =>
    listMcpAuditRecords(getDatabase(), {
      callerChatId: input?.callerChatId,
      toolName: input?.toolName,
      decision: input?.decision,
      from: input?.from ? new Date(input.from) : undefined,
      to: input?.to ? new Date(input.to) : undefined,
      cursor: input?.cursor,
      limit: input?.limit,
    }),
  ),

  listPendingApprovals: publicProcedure.query(() => listPendingMcpApprovals(getDatabase())),

  decideApproval: publicProcedure
    .input(
      z.object({
        id: z.string().min(1).max(256),
        decision: z.enum(["approve", "deny"]),
        grantSession: z.boolean().default(false),
      }),
    )
    .mutation(({ input }) => ({ resolved: decideMcpApproval(getDatabase(), input) })),
})
