import { randomUUID } from "node:crypto"
import { z } from "zod"
import { automationDraftSchema, automationTriggerTypes } from "../../../../shared/automation"
import { AutomationControlService } from "../../automation/control-service"
import { AutomationExecutionService } from "../../automation/execution"
import { AutomationTriggerService } from "../../automation/triggers"
import { AutomationUiService } from "../../automation/ui-service"
import { getDatabasePath } from "../../db"
import { betaProcedure, router } from "../index"

const publicProcedure = betaProcedure("automations")

const user = { type: "user" as const, id: "local-user" }
const service = () => new AutomationControlService(getDatabasePath())
const execution = () => new AutomationExecutionService(getDatabasePath())
const triggers = () => new AutomationTriggerService({ databasePath: getDatabasePath() })
const ui = () => new AutomationUiService(getDatabasePath())
const automationId = z.string().trim().min(1).max(200)
const expectedVersion = z.number().int().positive()
const approval = () => ({ approvedBy: user.id, auditId: `trpc:${randomUUID()}` })

export const automationsRouter = router({
  getCapabilities: publicProcedure.query(() => {
    return {
      enabled: true,
      scheduler: "managed-separately" as const,
      triggers: automationTriggerTypes,
      agentDraftsStartDisabled: true,
      authorityExpansionRequiresApproval: true,
    }
  }),

  list: publicProcedure
    .input(
      z
        .object({
          includeArchived: z.boolean().default(false),
          limit: z.number().int().min(1).max(100).default(20),
          cursor: z.string().max(64).optional(),
        })
        .default({}),
    )
    .query(({ input }) => service().list(user, input)),

  get: publicProcedure
    .input(z.object({ automationId }))
    .query(({ input }) => service().read(user, input.automationId)),

  history: publicProcedure
    .input(z.object({ automationId, limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ input }) => {
      service().read(user, input.automationId)
      return ui().listHistory(input.automationId, input.limit)
    }),

  inbox: publicProcedure
    .input(
      z
        .object({
          automationId: automationId.optional(),
          unreadOnly: z.boolean().default(false),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .default({}),
    )
    .query(({ input }) => ui().listInbox(input)),

  dryRun: publicProcedure.input(z.object({ automationId })).mutation(({ input }) => {
    service().read(user, input.automationId)
    return execution().dryRun(input.automationId)
  }),

  fireManual: publicProcedure.input(z.object({ automationId })).mutation(({ input }) => {
    service().read(user, input.automationId)
    const triggerId = ui().manualTriggerId(input.automationId)
    if (!triggerId) throw new Error("This automation has no enabled manual trigger.")
    return triggers().fireManual({ triggerId, idempotencyKey: randomUUID() })
  }),

  pause: publicProcedure.input(z.object({ automationId })).mutation(({ input }) => {
    service().read(user, input.automationId)
    return { changed: execution().pause(input.automationId) }
  }),

  kill: publicProcedure
    .input(z.object({ automationId, occurrenceId: z.string().trim().min(1).max(200) }))
    .mutation(async ({ input }) => {
      service().read(user, input.automationId)
      ui().assertOccurrenceOwner(input.automationId, input.occurrenceId)
      const { createAutomationExecutionRuntime } = await import("../../automation/runtime")
      return {
        changed: await createAutomationExecutionRuntime(getDatabasePath()).kill(input.occurrenceId),
      }
    }),

  markInboxRead: publicProcedure
    .input(
      z.object({
        ids: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
        unread: z.boolean().default(false),
      }),
    )
    .mutation(({ input }) => ui().markInboxRead(input.ids, input.unread)),

  markAllInboxRead: publicProcedure.mutation(() => ui().markAllInboxRead()),

  createDraft: publicProcedure
    .input(
      z.object({
        draft: automationDraftSchema,
        idempotencyKey: z.string().trim().min(1).max(128).optional(),
      }),
    )
    .mutation(({ input }) => service().createDraft(user, input)),

  classifyImpact: publicProcedure
    .input(z.object({ automationId, draft: automationDraftSchema }))
    .query(({ input }) => service().classifyImpact(user, input.automationId, input.draft)),

  update: publicProcedure
    .input(z.object({ automationId, expectedVersion, draft: automationDraftSchema }))
    .mutation(({ input }) => service().update(user, input)),

  reviewDraft: publicProcedure
    .input(
      z.object({
        automationId,
        expectedVersion,
        decision: z.enum(["approve", "deny"]),
        enable: z.boolean().default(false),
      }),
    )
    .mutation(({ input }) => service().reviewDraft(user, { ...input, approval: approval() })),

  setEnabled: publicProcedure
    .input(z.object({ automationId, expectedVersion, enabled: z.boolean() }))
    .mutation(({ input }) =>
      service().setEnabled(user, {
        ...input,
        ...(input.enabled ? { approval: approval() } : {}),
      }),
    ),

  delete: publicProcedure
    .input(z.object({ automationId, expectedVersion }))
    .mutation(({ input }) =>
      service().archive(user, { ...input, auditId: `trpc:${randomUUID()}` }),
    ),

  validateDraft: publicProcedure.input(automationDraftSchema).mutation(({ input }) => {
    return {
      ok: true,
      draft: input,
      runnable: false,
      reason: "Draft validation never enables or dispatches an automation.",
    }
  }),
})
