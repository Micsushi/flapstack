import Database from "better-sqlite3"
import { z } from "zod"
import { getDatabase, getDatabasePath } from "../../db"
import {
  classifyPolicyChange,
  createOrchestrationOperationsService,
  policyApprovalAuthority,
  templateLaunchAuthority,
} from "../../agent-orchestration/operations-config"
import {
  POLICY_APPROVAL_TOOL,
  requestOrchestrationAuthorityApproval,
  TEMPLATE_LAUNCH_APPROVAL_TOOL,
} from "../../agent-orchestration/approval-authority"
import {
  OrchestrationActivityProjectionService,
  type OrchestrationActivityKind,
} from "../../agent-orchestration/activity-projection"
import { interpretCoordinationEngineSnapshot } from "../../agent-orchestration/coordination-engine"
import {
  getCascadeControl,
  getCodexCoordination,
  getWorkflowEngine,
} from "../../agent-orchestration/operations-runtime"
import {
  orchestrationPolicyUpdateSchema,
  orchestrationTemplateArchiveSchema,
  orchestrationTemplateCreateSchema,
  orchestrationTemplateDefinitionSchema,
  orchestrationTemplateUpdateSchema,
} from "../../../../shared/orchestration-operations"
import type {
  CoordinationEngineAction,
  CoordinationEngineContext,
  CoordinationEngineProviderIdentity,
} from "../../../../shared/coordination-engine"
import { publicProcedure, router } from "../index"

const service = () => createOrchestrationOperationsService(getDatabasePath())
const activity = () => new OrchestrationActivityProjectionService(getDatabasePath())
const activityKinds = [
  "workflow-phase",
  "checkpoint",
  "dependency",
  "spawn",
  "replacement",
  "mailbox",
  "coordination",
  "warning",
  "usage",
  "aggregate-status",
] as const satisfies readonly OrchestrationActivityKind[]
const taskIdSchema = z.string().trim().min(1).max(200)
const cascadeActionSchema = z.enum(["pause", "resume", "stop"])
const providerIdentitySchema = z.discriminatedUnion("engine", [
  z.object({
    schemaVersion: z.literal(1),
    engine: z.literal("workflow"),
    workflowRunId: z.string().min(1).max(512),
  }),
  z.object({
    schemaVersion: z.literal(1),
    engine: z.literal("codex-v2"),
    canonicalTaskPath: z.string().min(1).max(1_000),
    taskName: z.string().min(1).max(200),
    providerTaskId: z.string().max(512).nullable(),
  }),
  z.object({
    schemaVersion: z.literal(1),
    engine: z.literal("codex-v1"),
    providerAgentId: z.string().min(1).max(512),
    nickname: z.string().max(200).nullable(),
  }),
])
const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.enum(["prepare", "start", "resume", "reconcile", "cancel", "cleanup"]),
    orchestrationId: taskIdSchema,
    providerIdentity: providerIdentitySchema.nullable(),
  }),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.enum(["send", "follow-up", "interrupt"]),
    orchestrationId: taskIdSchema,
    providerIdentity: providerIdentitySchema,
    targetAgentId: z.string().trim().min(1).max(200),
    message: z.string().max(10_000).nullable(),
  }),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("wait"),
    orchestrationId: taskIdSchema,
    providerIdentity: providerIdentitySchema,
    targetAgentIds: z.array(z.string().trim().min(1).max(200)).max(256),
    timeoutMs: z.number().int().min(1).max(86_400_000).nullable(),
  }),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("complete"),
    orchestrationId: taskIdSchema,
    providerIdentity: providerIdentitySchema,
    resultSummary: z.string().max(10_000).nullable(),
  }),
])

export const orchestrationOperationsRouter = router({
  getPolicy: publicProcedure
    .input(z.object({ taskId: taskIdSchema }))
    .query(({ input }) => service().getPolicy(input.taskId)),
  previewPolicy: publicProcedure
    .input(orchestrationPolicyUpdateSchema)
    .query(({ input }) => service().previewPolicy(input)),
  updatePolicy: publicProcedure
    .input(orchestrationPolicyUpdateSchema)
    .mutation(async ({ input }) => {
      const operations = service()
      const preview = operations.previewPolicy(input)
      let auditId: string | null = null
      if (preview.approvalRequired) {
        const caller = operations.getApprovalContext(input.taskId)
        auditId = await requestOrchestrationAuthorityApproval(getDatabase(), {
          toolName: POLICY_APPROVAL_TOOL,
          callerChatId: caller.chatId,
          callerRunId: caller.runId,
          authority: policyApprovalAuthority(input, preview.changeKind),
        })
      }
      return operations.updatePolicy(input, auditId)
    }),
  listTemplates: publicProcedure.query(() => service().listTemplates()),
  createTemplate: publicProcedure
    .input(orchestrationTemplateCreateSchema)
    .mutation(({ input }) => service().createTemplate(input)),
  updateTemplate: publicProcedure
    .input(orchestrationTemplateUpdateSchema)
    .mutation(({ input }) => service().updateTemplate(input)),
  archiveTemplate: publicProcedure
    .input(orchestrationTemplateArchiveSchema)
    .mutation(({ input }) => service().archiveTemplate(input)),
  previewTemplate: publicProcedure
    .input(z.object({ definition: z.unknown() }))
    .query(({ input }) => service().previewTemplate(input.definition)),
  listMessages: publicProcedure
    .input(z.object({ taskId: taskIdSchema }))
    .query(({ input }) => service().listMessages(input.taskId)),

  previewWorkflow: publicProcedure
    .input(z.object({ definition: orchestrationTemplateDefinitionSchema }))
    .query(({ input }) => getWorkflowEngine(getDatabasePath()).preview(input.definition)),
  startWorkflow: publicProcedure
    .input(
      z
        .object({
          taskId: taskIdSchema,
          definition: orchestrationTemplateDefinitionSchema.optional(),
          templateId: z.string().trim().min(1).max(200).optional(),
        })
        .refine((value) => Boolean(value.definition) !== Boolean(value.templateId), {
          message: "Provide exactly one workflow definition or templateId.",
        }),
    )
    .mutation(async ({ input }) => {
      const engine = getWorkflowEngine(getDatabasePath())
      const operations = service()
      const definition = input.definition ?? operations.getTemplate(input.templateId!).definition
      const current = operations.getPolicy(input.taskId)
      const changeKind = classifyPolicyChange(current.policy, definition.policy)
      const approvalRequired =
        changeKind === "relax" ||
        changeKind === "mixed" ||
        definition.policy.maxTotalTokens !== null ||
        definition.policy.maxCostUsdMicros !== null
      let auditId: string | null = null
      if (approvalRequired) {
        const caller = operations.getApprovalContext(input.taskId)
        const authority = templateLaunchAuthority(input.taskId, definition, current.version)
        auditId = await requestOrchestrationAuthorityApproval(getDatabase(), {
          toolName: TEMPLATE_LAUNCH_APPROVAL_TOOL,
          callerChatId: caller.chatId,
          callerRunId: caller.runId,
          authority,
        })
        operations.verifyTemplateLaunchApproval(input.taskId, definition, auditId)
      }
      return engine.start(input.taskId, definition, auditId)
    }),
  getWorkflow: publicProcedure
    .input(z.object({ runId: z.string().trim().min(1).max(200) }))
    .query(({ input }) => getWorkflowEngine(getDatabasePath()).get(input.runId)),
  listWorkflows: publicProcedure
    .input(z.object({ taskId: taskIdSchema }))
    .query(({ input }) => getWorkflowEngine(getDatabasePath()).list(input.taskId)),
  advanceWorkflow: publicProcedure
    .input(
      z.object({
        runId: z.string().trim().min(1).max(200),
        launches: z
          .record(
            z.string().trim().min(1).max(200),
            z.object({
              runId: z.string().trim().min(1).max(200),
              chatId: z.string().trim().min(1).max(200),
              subChatId: z.string().trim().min(1).max(200),
            }),
          )
          .refine((value) => Object.keys(value).length <= 256, {
            message: "Workflow advance accepts at most 256 launch identities.",
          })
          .default({}),
      }),
    )
    .mutation(({ input }) =>
      getWorkflowEngine(getDatabasePath()).advance(input.runId, input.launches),
    ),
  controlWorkflow: publicProcedure
    .input(z.object({ runId: z.string().trim().min(1).max(200), action: cascadeActionSchema }))
    .mutation(async ({ input }) => {
      const workflow = getWorkflowEngine(getDatabasePath())
      const run = workflow.get(input.runId)
      const cascade = getCascadeControl(getDatabasePath())
      const preview = cascade.preview(run.taskId, input.action)
      const request = cascade.request(run.taskId, input.action, preview.fingerprint)
      const reconciliation = await cascade.reconcile(request.intentId)
      if (reconciliation.state !== "completed")
        throw new Error(
          `Workflow ${input.action} is ${reconciliation.state}; failed Runtime targets remain visible and retryable.`,
        )
      return workflow.get(input.runId)
    }),
  decideHumanGate: publicProcedure
    .input(
      z.object({
        runId: z.string().trim().min(1).max(200),
        stepId: z.string().trim().min(1).max(200),
        decision: z.enum(["approve", "deny"]),
      }),
    )
    .mutation(({ input }) =>
      getWorkflowEngine(getDatabasePath()).decideHumanGate(
        input.runId,
        input.stepId,
        input.decision,
      ),
    ),
  resolveLoop: publicProcedure
    .input(
      z.object({
        runId: z.string().trim().min(1).max(200),
        stepId: z.string().trim().min(1).max(200),
        continue: z.boolean(),
        output: z.unknown(),
      }),
    )
    .mutation(({ input }) =>
      getWorkflowEngine(getDatabasePath()).resolveLoop(input.runId, input.stepId, {
        continue: input.continue,
        output: input.output ?? null,
      }),
    ),
  retryWorkflowStep: publicProcedure
    .input(
      z.object({
        runId: z.string().trim().min(1).max(200),
        stepId: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(({ input }) =>
      getWorkflowEngine(getDatabasePath()).retryStep(input.runId, input.stepId),
    ),

  previewCascade: publicProcedure
    .input(z.object({ taskId: taskIdSchema, action: cascadeActionSchema }))
    .query(({ input }) => getCascadeControl(getDatabasePath()).preview(input.taskId, input.action)),
  requestCascade: publicProcedure
    .input(
      z.object({
        taskId: taskIdSchema,
        action: cascadeActionSchema,
        expectedFingerprint: z.string().length(64),
      }),
    )
    .mutation(({ input }) =>
      getCascadeControl(getDatabasePath()).request(
        input.taskId,
        input.action,
        input.expectedFingerprint,
      ),
    ),
  reconcileCascade: publicProcedure
    .input(z.object({ intentId: z.string().trim().min(1).max(200) }))
    .mutation(({ input }) => getCascadeControl(getDatabasePath()).reconcile(input.intentId)),

  executeCoordinationAction: publicProcedure
    .input(z.object({ taskId: taskIdSchema, action: actionSchema }))
    .mutation(async ({ input }) => {
      const context = loadCoordinationContext(input.taskId)
      if (context.snapshot.engine === "workflow")
        throw new Error("Workflow actions use WorkflowEngine routes.")
      const action = {
        ...input.action,
        orchestrationId: input.taskId,
        providerIdentity: context.snapshot.providerIdentity,
      } as CoordinationEngineAction
      return getCodexCoordination(context.snapshot.engine).execute(context, action)
    }),
  reconcileCoordination: publicProcedure
    .input(z.object({ taskId: taskIdSchema }))
    .mutation(({ input }) => {
      const context = loadCoordinationContext(input.taskId)
      if (context.snapshot.engine === "workflow")
        throw new Error("Workflow reconciliation uses WorkflowEngine.")
      return getCodexCoordination(context.snapshot.engine).reconcile(context)
    }),

  listActivity: publicProcedure
    .input(
      z.object({
        taskId: taskIdSchema,
        agentId: z.string().trim().min(1).max(200).optional(),
        runId: z.string().trim().min(1).max(512).optional(),
        runtime: z.enum(["codex", "claude-code", "flapstack-native"]).optional(),
        kind: z.enum(activityKinds).optional(),
        phase: z.string().trim().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(1_000).default(250),
      }),
    )
    .query(({ input: { taskId, ...filters } }) => activity().list(taskId, filters)),
})

function loadCoordinationContext(taskId: string): CoordinationEngineContext {
  const db = new Database(getDatabasePath(), { readonly: true })
  try {
    const row = db.prepare("SELECT * FROM task_orchestrations WHERE task_id = ?").get(taskId) as
      Record<string, unknown> | undefined
    if (!row) throw new Error("Orchestration not found.")
    let snapshot = interpretCoordinationEngineSnapshot(row)
    if (snapshot.engine !== "workflow") {
      const provider = db
        .prepare(
          `SELECT provider_identity_json
           FROM coordination_action_intents
           WHERE task_id = ? AND engine = ?
             AND json_type(provider_identity_json, '$') = 'object'
             AND json_extract(provider_identity_json, '$.engine') = ?
           ORDER BY updated_at DESC, id DESC LIMIT 1`,
        )
        .get(taskId, snapshot.engine, snapshot.engine) as
        { provider_identity_json: string } | undefined
      if (provider) {
        const providerIdentity = JSON.parse(
          provider.provider_identity_json,
        ) as CoordinationEngineProviderIdentity
        snapshot = { ...snapshot, providerIdentity }
      }
    }
    return {
      orchestrationId: taskId,
      snapshot,
      signal: new AbortController().signal,
    }
  } finally {
    db.close()
  }
}
