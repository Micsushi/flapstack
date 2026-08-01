import { z } from "zod"
import {
  agentProfileArchiveInputSchema,
  agentProfileCreateInputSchema,
  agentProfileDuplicateInputSchema,
  agentProfileEvaluationInputSchema,
  agentProfileImportConfirmInputSchema,
  agentProfileImportPreviewInputSchema,
  agentProfileListInputSchema,
  agentProfileResolveInputSchema,
  agentProfileUpdateInputSchema,
  agentProfileVersionRefSchema,
  agentProfileWorkflowBindingSchema,
  standaloneAgentLaunchInputSchema,
} from "../../../../shared/agent-profiles"
import { getDatabase, getDatabasePath } from "../../db"
import { getAgentProfileDiagnostics } from "../../agent-profiles/diagnostics"
import { requestAgentProfileCapabilityApproval } from "../../agent-profiles/approval-authority"
import { AgentProfileChatBindingService } from "../../agent-profiles/chat-binding"
import { AgentProfileEvaluationService } from "../../agent-profiles/evaluation"
import { AgentProfileResolver } from "../../agent-profiles/resolver"
import { createAgentProfileService } from "../../agent-profiles/service"
import { StandaloneAgentLaunchService } from "../../agent-profiles/standalone-launch"
import { AgentProfileWorkflowBindingService } from "../../agent-profiles/workflow-binding"
import { publicProcedure, router } from "../index"

const idSchema = z.string().trim().min(1).max(200)
const standalonePreviewSchema = standaloneAgentLaunchInputSchema.omit({
  requestId: true,
  confirmedSnapshotDigest: true,
})

export const agentProfilesRouter = router({
  initialize: publicProcedure.mutation(() => {
    createAgentProfileService(getDatabase()).ensureStarterCatalog()
    return getAgentProfileDiagnostics(getDatabase())
  }),
  list: publicProcedure
    .input(agentProfileListInputSchema.optional())
    .query(({ input }) => createAgentProfileService(getDatabase()).list(input ?? {})),
  get: publicProcedure
    .input(agentProfileVersionRefSchema)
    .query(({ input }) => createAgentProfileService(getDatabase()).get(input)),
  searchForChat: publicProcedure
    .input(z.object({ chatId: idSchema, query: z.string().trim().max(200).default("") }))
    .query(({ input }) =>
      new AgentProfileChatBindingService(getDatabase()).searchForChat(input.chatId, input.query),
    ),
  searchForNewChat: publicProcedure
    .input(
      z.object({
        scope: z.enum(["global", "project", "task"]),
        projectId: idSchema.optional(),
        taskId: idSchema.optional(),
        query: z.string().trim().max(200).default(""),
      }),
    )
    .query(({ input }) =>
      new AgentProfileChatBindingService(getDatabase()).searchForNewChat(input),
    ),
  previewNewChatBinding: publicProcedure
    .input(
      z.object({
        scope: z.enum(["global", "project", "task"]),
        projectId: idSchema.optional(),
        taskId: idSchema.optional(),
        permissionMode: z.string().trim().min(1).max(80),
        runtimePreference: z.enum([
          "auto",
          "codex",
          "codex-enhanced",
          "claude-code",
          "claude-code-enhanced",
          "flapstack-native",
        ]),
        profile: agentProfileVersionRefSchema,
      }),
    )
    .query(({ input }) =>
      new AgentProfileChatBindingService(getDatabase()).previewForNewChat(input),
    ),
  previewChatBinding: publicProcedure
    .input(z.object({ chatId: idSchema, profile: agentProfileVersionRefSchema }))
    .query(({ input }) => new AgentProfileChatBindingService(getDatabase()).preview(input)),
  bindChat: publicProcedure
    .input(
      z.object({
        chatId: idSchema,
        profile: agentProfileVersionRefSchema,
        confirmedDigest: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .mutation(({ input }) =>
      new AgentProfileChatBindingService(getDatabase()).bind({
        chatId: input.chatId,
        profile: input.profile,
        expectedDigest: input.confirmedDigest,
      }),
    ),
  getChatBinding: publicProcedure
    .input(z.object({ chatId: idSchema }))
    .query(({ input }) => new AgentProfileChatBindingService(getDatabase()).get(input.chatId)),
  clearChatBinding: publicProcedure
    .input(z.object({ chatId: idSchema }))
    .mutation(({ input }) => new AgentProfileChatBindingService(getDatabase()).clear(input.chatId)),
  create: publicProcedure.input(agentProfileCreateInputSchema).mutation(async ({ input }) => {
    const profiles = createAgentProfileService(getDatabase())
    const preview = profiles.previewCreateCapabilityChange(input)
    const auditId = await capabilityApproval(profiles, preview)
    return profiles.create(input, auditId)
  }),
  update: publicProcedure.input(agentProfileUpdateInputSchema).mutation(async ({ input }) => {
    const profiles = createAgentProfileService(getDatabase())
    const preview = profiles.previewUpdateCapabilityChange(input)
    const auditId = await capabilityApproval(profiles, preview)
    return profiles.update(input, auditId)
  }),
  duplicate: publicProcedure.input(agentProfileDuplicateInputSchema).mutation(async ({ input }) => {
    const profiles = createAgentProfileService(getDatabase())
    const preview = profiles.previewDuplicateCapabilityChange(input)
    const auditId = await capabilityApproval(profiles, preview)
    return profiles.duplicate(input, auditId)
  }),
  archive: publicProcedure
    .input(agentProfileArchiveInputSchema)
    .mutation(({ input }) => createAgentProfileService(getDatabase()).archive(input)),
  restore: publicProcedure
    .input(agentProfileArchiveInputSchema)
    .mutation(({ input }) => createAgentProfileService(getDatabase()).archive(input, true)),
  export: publicProcedure
    .input(z.object({ profiles: z.array(agentProfileVersionRefSchema).min(1).max(256) }).strict())
    .mutation(({ input }) => createAgentProfileService(getDatabase()).export(input.profiles)),
  importPreview: publicProcedure
    .input(agentProfileImportPreviewInputSchema)
    .mutation(({ input }) => createAgentProfileService(getDatabase()).previewImport(input)),
  importConfirm: publicProcedure
    .input(agentProfileImportConfirmInputSchema)
    .mutation(({ input }) => createAgentProfileService(getDatabase()).confirmImport(input)),
  resolvedPreview: publicProcedure
    .input(agentProfileResolveInputSchema)
    .query(({ input }) => new AgentProfileResolver(getDatabase()).preview(input)),
  bindWorkflowStep: publicProcedure
    .input(
      z
        .object({
          binding: agentProfileWorkflowBindingSchema,
          expectedVersion: z.number().int().min(0),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).bind(
        input.binding,
        input.expectedVersion,
      ),
    ),
  workflowPreview: publicProcedure
    .input(
      z
        .object({
          workflowRunId: idSchema,
          stepId: idSchema,
        })
        .strict(),
    )
    .query(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).previewForConfirmation(
        input.workflowRunId,
        input.stepId,
      ),
    ),
  confirmWorkflowStep: publicProcedure
    .input(
      z
        .object({
          workflowRunId: idSchema,
          stepId: idSchema,
          expectedVersion: z.number().int().min(1),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).confirm(
        input.workflowRunId,
        input.stepId,
        input.expectedVersion,
      ),
    ),
  workflowBindings: publicProcedure
    .input(z.object({ workflowRunId: idSchema }).strict())
    .query(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).list(input.workflowRunId),
    ),
  forkWorkflowBinding: publicProcedure
    .input(
      z
        .object({
          sourceWorkflowRunId: idSchema,
          sourceStepId: idSchema,
          targetWorkflowRunId: idSchema,
          targetStepId: idSchema,
          profile: agentProfileVersionRefSchema.optional(),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).fork(
        input.sourceWorkflowRunId,
        input.sourceStepId,
        input.targetWorkflowRunId,
        input.targetStepId,
        input.profile,
      ),
    ),
  exportWorkflowBinding: publicProcedure
    .input(z.object({ workflowRunId: idSchema, stepId: idSchema }).strict())
    .query(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).exportTemplateReference(
        input.workflowRunId,
        input.stepId,
      ),
    ),
  importWorkflowBinding: publicProcedure
    .input(
      z
        .object({
          bundle: z.string().min(1).max(262_144),
          workflowRunId: idSchema,
          stepId: idSchema,
          expectedVersion: z.number().int().min(0),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).importTemplateReference(
        input.bundle,
        input.workflowRunId,
        input.stepId,
        input.expectedVersion,
      ),
    ),
  standalonePreview: publicProcedure.input(standalonePreviewSchema).query(({ input }) => {
    const placeholder = {
      ...input,
      requestId: "preview",
      confirmedSnapshotDigest: "0".repeat(64),
    }
    return new StandaloneAgentLaunchService(getDatabasePath()).preview(placeholder)
  }),
  launchStandalone: publicProcedure
    .input(standaloneAgentLaunchInputSchema)
    .mutation(({ input }) => new StandaloneAgentLaunchService(getDatabasePath()).launch(input)),
  standaloneFollowUp: publicProcedure
    .input(
      z
        .object({
          launchId: idSchema,
          requestId: idSchema,
          prompt: z.string().trim().min(1).max(100_000),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      new StandaloneAgentLaunchService(getDatabasePath()).followUp(
        input.launchId,
        input.requestId,
        input.prompt,
      ),
    ),
  retryStandalone: publicProcedure
    .input(z.object({ launchId: idSchema, requestId: idSchema }).strict())
    .mutation(({ input }) =>
      new StandaloneAgentLaunchService(getDatabasePath()).retry(input.launchId, input.requestId),
    ),
  continueStandaloneWithUpdatedProfile: publicProcedure
    .input(z.object({ launchId: idSchema, launch: standaloneAgentLaunchInputSchema }).strict())
    .mutation(({ input }) =>
      new StandaloneAgentLaunchService(getDatabasePath()).continueWithUpdatedProfile(
        input.launchId,
        input.launch,
      ),
    ),
  stopStandalone: publicProcedure
    .input(z.object({ launchId: idSchema }).strict())
    .mutation(({ input }) =>
      new StandaloneAgentLaunchService(getDatabasePath()).stop(input.launchId),
    ),
  reconcileStandalone: publicProcedure.mutation(() =>
    new StandaloneAgentLaunchService(getDatabasePath()).reconcile(),
  ),
  evaluate: publicProcedure
    .input(agentProfileEvaluationInputSchema)
    .mutation(({ input }) => new AgentProfileEvaluationService(getDatabase()).run(input)),
  evaluationHistory: publicProcedure
    .input(z.object({ profileId: idSchema.optional() }).strict().optional())
    .query(({ input }) =>
      new AgentProfileEvaluationService(getDatabase()).history(input?.profileId),
    ),
  audit: publicProcedure
    .input(z.object({ profileId: idSchema.optional() }).strict().optional())
    .query(({ input }) => createAgentProfileService(getDatabase()).auditEvents(input?.profileId)),
  diagnostics: publicProcedure.query(() => {
    createAgentProfileService(getDatabase()).ensureStarterCatalog()
    return getAgentProfileDiagnostics(getDatabase())
  }),
})

async function capabilityApproval(
  profiles: ReturnType<typeof createAgentProfileService>,
  preview: ReturnType<
    ReturnType<typeof createAgentProfileService>["previewCreateCapabilityChange"]
  >,
) {
  if (!preview.approvalRequired) return null
  const caller = profiles.getApprovalContext(preview.scope)
  return await requestAgentProfileCapabilityApproval(getDatabase(), {
    callerChatId: caller.chatId,
    callerRunId: caller.runId,
    authority: preview.authority,
  })
}
