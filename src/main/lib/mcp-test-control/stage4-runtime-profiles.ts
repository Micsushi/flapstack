import type Database from "better-sqlite3"
import type {
  AgentRuntimePreference,
  ResolvedAgentRuntime,
  RuntimeAdapterProbe,
  RuntimeDefaultScope,
} from "../../../shared/agent-runtime"
import type { AgentProfileVersionRef } from "../../../shared/agent-profiles"
import { createAgentActivityStore, type AgentActivityStore } from "../agent-runtime/activity-store"
import { createRuntimeChatLifecycleService } from "../agent-runtime/chat-lifecycle"
import { createRuntimeDefaultsService } from "../agent-runtime/defaults"
import { createDevRuntimeActivityFixtureService } from "../agent-runtime/dev-activity-fixtures"
import { getRuntimeDiagnostics } from "../agent-runtime/diagnostics"
import { AgentProfileResolver } from "../agent-profiles/resolver"
import { createAgentProfileService } from "../agent-profiles/service"
import { StandaloneAgentLaunchService } from "../agent-profiles/standalone-launch"
import { AgentProfileWorkflowBindingService } from "../agent-profiles/workflow-binding"
import { sanitizeStage4ControlBoundary } from "./stage4-boundary"
export { sanitizeStage4ControlBoundary, sanitizeStage4ControlError } from "./stage4-boundary"

type DatabaseLike = Database.Database | object
type Payload = Record<string, unknown>

export const STAGE4_RUNTIME_MUTATION_ACTIONS = [
  "write-default",
  "delete-default",
  "set-empty-chat",
  "continue-chat",
  "undo-continuation",
  "seed-activity",
  "cleanup-activity",
] as const

export const STAGE4_PROFILE_READ_ACTIONS = [
  "list",
  "get",
  "resolve",
  "audit",
  "workflow-get",
  "workflow-list",
  "workflow-preview",
  "standalone-preview",
  "standalone-get",
] as const

export const STAGE4_PROFILE_MUTATION_ACTIONS = [
  "ensure-starters",
  "create",
  "update",
  "duplicate",
  "archive",
  "restore",
  "export",
  "preview-import",
  "confirm-import",
  "workflow-bind",
  "workflow-confirm",
  "workflow-fork",
  "workflow-export",
  "workflow-import",
  "standalone-launch",
  "standalone-follow-up",
  "standalone-retry",
  "standalone-continue-with-updated-profile",
  "standalone-stop",
] as const

export type Stage4RuntimeControlInput = {
  action: (typeof STAGE4_RUNTIME_MUTATION_ACTIONS)[number]
  payload: unknown
}

export type Stage4ProfileReadInput = {
  action: (typeof STAGE4_PROFILE_READ_ACTIONS)[number]
  payload: unknown
}

export type Stage4ProfileMutationInput = {
  action: (typeof STAGE4_PROFILE_MUTATION_ACTIONS)[number]
  payload: unknown
}

export function getStage4RuntimeState(
  database: DatabaseLike,
  input: {
    scope?: RuntimeDefaultScope
    harness?: string
    chatId?: string
    runId?: string
    activityLimit?: number
  } = {},
  activityStore: AgentActivityStore = createAgentActivityStore(database),
) {
  const defaults = createRuntimeDefaultsService(database).list({
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.harness ? { harness: input.harness } : {}),
  })
  const diagnostics = input.chatId ? getRuntimeDiagnostics(database, input.chatId) : null
  const activity = input.runId
    ? activityStore.query({
        runId: input.runId,
        limit: boundedActivityLimit(input.activityLimit),
      })
    : null
  return { defaults, diagnostics, activity }
}

export function mutateStage4Runtime(
  database: DatabaseLike,
  input: Stage4RuntimeControlInput,
  activityStore: AgentActivityStore = createAgentActivityStore(database),
) {
  const payload = boundedPayload(input.payload)
  const defaults = createRuntimeDefaultsService(database)
  const lifecycle = createRuntimeChatLifecycleService(database, stage4FixtureProbe)
  const fixture = createDevRuntimeActivityFixtureService(database, activityStore, { enabled: true })
  switch (input.action) {
    case "write-default":
      return defaults.write(payload)
    case "delete-default":
      return { deleted: defaults.delete(payload) }
    case "set-empty-chat":
      return lifecycle.setEmptyChatPreference({
        chatId: requiredString(payload.chatId, "chatId"),
        preference: requiredRuntimePreference(payload.preference),
      })
    case "continue-chat":
      return lifecycle.continueWithRuntime({
        sourceChatId: requiredString(payload.sourceChatId, "sourceChatId"),
        preference: requiredRuntimePreference(payload.preference),
        requestId: requiredString(payload.requestId, "requestId"),
        name: optionalString(payload.name),
      })
    case "undo-continuation":
      return {
        undone: lifecycle.undoContinuation({
          sourceChatId: requiredString(payload.sourceChatId, "sourceChatId"),
          targetChatId: requiredString(payload.targetChatId, "targetChatId"),
        }),
      }
    case "seed-activity":
      return fixture.seed(activityFixtureInput(payload))
    case "cleanup-activity":
      return fixture.reset(activityFixtureInput(payload))
  }
}

function stage4FixtureProbe(harness: string, runtime: ResolvedAgentRuntime): RuntimeAdapterProbe {
  const supported = { supported: true, reason: null }
  return {
    runtime,
    harness,
    available: true,
    versions: { adapterVersion: "mcp-test-control", protocolVersion: "fixture-v1" },
    capabilities: {
      schemaVersion: 1,
      status: "available",
      capturedAt: null,
      controls: {
        modelThinking: supported,
        reasoningDisplay: supported,
        subagentActivity: supported,
        hookDiagnostics: supported,
      },
      execution: {
        continuation: supported,
        delegation: supported,
        structuredOutput: supported,
        cancellation: supported,
      },
      limitations: ["Deterministic MCP test-control capability fixture."],
      unavailableReason: null,
    },
    reason: null,
  }
}

export function getStage4ProfileState(
  database: DatabaseLike,
  databasePath: string,
  input: Stage4ProfileReadInput,
) {
  const payload = boundedPayload(input.payload)
  const profiles = createAgentProfileService(database)
  const workflow = new AgentProfileWorkflowBindingService(database)
  const standalone = new StandaloneAgentLaunchService(databasePath)
  let value: unknown
  switch (input.action) {
    case "list":
      value = profiles.list(payload)
      break
    case "get":
      value = profiles.get(profileRef(payload))
      break
    case "resolve":
      value = new AgentProfileResolver(database).preview(payload)
      break
    case "audit":
      value = profiles.auditEvents(optionalString(payload.profileId) ?? undefined)
      break
    case "workflow-get":
      value = workflow.get(
        requiredString(payload.workflowRunId, "workflowRunId"),
        requiredString(payload.stepId, "stepId"),
      )
      break
    case "workflow-list":
      value = workflow.list(requiredString(payload.workflowRunId, "workflowRunId"))
      break
    case "workflow-preview":
      value = workflow.previewForConfirmation(
        requiredString(payload.workflowRunId, "workflowRunId"),
        requiredString(payload.stepId, "stepId"),
      )
      break
    case "standalone-preview":
      value = standalone.preview(payload)
      break
    case "standalone-get":
      value = standalone.get(requiredString(payload.launchId, "launchId"))
      break
  }
  return sanitizeStage4ControlBoundary(value)
}

export function mutateStage4Profile(
  database: DatabaseLike,
  databasePath: string,
  input: Stage4ProfileMutationInput,
): unknown {
  const payload = boundedPayload(input.payload)
  const profiles = createAgentProfileService(database)
  const workflow = new AgentProfileWorkflowBindingService(database)
  const standalone = new StandaloneAgentLaunchService(databasePath)
  switch (input.action) {
    case "ensure-starters":
      profiles.ensureStarterCatalog()
      return {
        installed: profiles.list({}).filter((profile) => profile.source === "built-in").length,
      }
    case "create":
      return profiles.create(
        withoutKey(payload, "approvalAuditId"),
        optionalString(payload.approvalAuditId),
      )
    case "update":
      return profiles.update(
        withoutKey(payload, "approvalAuditId"),
        optionalString(payload.approvalAuditId),
      )
    case "duplicate":
      return profiles.duplicate(
        withoutKey(payload, "approvalAuditId"),
        optionalString(payload.approvalAuditId),
      )
    case "archive":
      return profiles.archive(payload)
    case "restore":
      return profiles.archive(payload, true)
    case "export":
      return {
        bundle: profiles.export(requiredProfileRefs(payload.profiles)),
      }
    case "preview-import":
      return profiles.previewImport(payload)
    case "confirm-import":
      return profiles.confirmImport(payload)
    case "workflow-bind":
      return workflow.bind(payload.binding, requiredInteger(payload.expectedVersion, 0))
    case "workflow-confirm":
      return workflow.confirm(
        requiredString(payload.workflowRunId, "workflowRunId"),
        requiredString(payload.stepId, "stepId"),
        requiredInteger(payload.expectedVersion, 1),
      )
    case "workflow-fork":
      return workflow.fork(
        requiredString(payload.sourceWorkflowRunId, "sourceWorkflowRunId"),
        requiredString(payload.sourceStepId, "sourceStepId"),
        requiredString(payload.targetWorkflowRunId, "targetWorkflowRunId"),
        requiredString(payload.targetStepId, "targetStepId"),
        payload.profile ? profileRef(boundedPayload(payload.profile)) : undefined,
      )
    case "workflow-export":
      return {
        bundle: workflow.exportTemplateReference(
          requiredString(payload.workflowRunId, "workflowRunId"),
          requiredString(payload.stepId, "stepId"),
        ),
      }
    case "workflow-import":
      return workflow.importTemplateReference(
        requiredString(payload.bundle, "bundle"),
        requiredString(payload.workflowRunId, "workflowRunId"),
        requiredString(payload.stepId, "stepId"),
        requiredInteger(payload.expectedVersion, 0),
      )
    case "standalone-launch":
      return standalone.launch(payload, false)
    case "standalone-follow-up":
      return standalone.followUp(
        requiredString(payload.launchId, "launchId"),
        requiredString(payload.requestId, "requestId"),
        requiredString(payload.prompt, "prompt"),
        false,
      )
    case "standalone-retry":
      return standalone.retry(
        requiredString(payload.launchId, "launchId"),
        requiredString(payload.requestId, "requestId"),
        false,
      )
    case "standalone-continue-with-updated-profile":
      return standalone.continueWithUpdatedProfile(
        requiredString(payload.launchId, "launchId"),
        boundedPayload(payload.launch),
        false,
      )
    case "standalone-stop":
      return standalone.stop(
        requiredString(payload.launchId, "launchId"),
        optionalString(payload.reason) ?? "stage4-test-control-cleanup",
      )
  }
}

function activityFixtureInput(payload: Payload) {
  return {
    projectId: requiredString(payload.projectId, "projectId"),
    chatId: requiredString(payload.chatId, "chatId"),
    subChatId: requiredString(payload.subChatId, "subChatId"),
  }
}

function boundedPayload(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stage 4 test-control payload must be an object.")
  }
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, "utf8") > 4_000_000) {
    throw new Error("Stage 4 test-control payload exceeds four megabytes.")
  }
  return value as Payload
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function requiredInteger(value: unknown, minimum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new Error(`Expected an integer greater than or equal to ${minimum}.`)
  }
  return Number(value)
}

function requiredRuntimePreference(value: unknown): AgentRuntimePreference {
  const preferences = [
    "auto",
    "codex",
    "codex-enhanced",
    "claude-code",
    "claude-code-enhanced",
    "flapstack-native",
  ] as const
  if (!preferences.includes(value as AgentRuntimePreference)) {
    throw new Error("Unsupported Agent Runtime preference.")
  }
  return value as AgentRuntimePreference
}

function profileRef(payload: Payload): AgentProfileVersionRef {
  return {
    profileId: requiredString(payload.profileId, "profileId"),
    version: requiredInteger(payload.version, 1),
  }
}

function requiredProfileRefs(value: unknown): AgentProfileVersionRef[] {
  if (!Array.isArray(value)) throw new Error("profiles must be an array.")
  return value.map((entry) => profileRef(boundedPayload(entry)))
}

function boundedActivityLimit(value: unknown): number {
  if (value === undefined) return 100
  return Math.min(requiredInteger(value, 1), 500)
}

function withoutKey(payload: Payload, key: string): Payload {
  const copy = { ...payload }
  delete copy[key]
  return copy
}
