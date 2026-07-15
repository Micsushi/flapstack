import { z } from "zod"
import { CUSTOM_PERMISSION_SCHEMA_VERSION, permissionModes } from "../permissions"
import { AGENT_HARNESSES } from "../../../shared/harness-types"

const identifierSchema = z.string().trim().min(1).max(200)
const supportedThreadSpawnHarnessSchema = z.enum(AGENT_HARNESSES)
const customPermissionsSchema = z
  .object({
    schemaVersion: z.literal(CUSTOM_PERMISSION_SCHEMA_VERSION),
    projectWrite: z.boolean(),
    shell: z.boolean(),
    network: z.boolean(),
    git: z.boolean(),
    browser: z.boolean(),
    secrets: z.boolean(),
    subagents: z.boolean(),
    thirdPartyMcp: z.boolean(),
    productMcpRead: z.boolean(),
    productMcpWrite: z.boolean(),
    productMcpTier3: z.boolean(),
  })
  .strict()

export const threadSpawnScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("project"), projectId: identifierSchema }).strict(),
  z
    .object({ kind: z.literal("task"), projectId: identifierSchema, taskId: identifierSchema })
    .strict(),
])

export const threadSpawnPermissionSchema = z
  .object({
    mode: z.enum(permissionModes),
    customPermissions: customPermissionsSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "custom" && !value.customPermissions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customPermissions"],
        message: "Custom permission mode requires explicit capability toggles.",
      })
    }
    if (value.mode !== "custom" && value.customPermissions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customPermissions"],
        message: "Capability toggles are only valid with custom permission mode.",
      })
    }
  })

export const threadSpawnWorktreeSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("inherit") }).strict(),
  z.object({ strategy: z.literal("none") }).strict(),
  z.object({ strategy: z.literal("existing"), worktreeId: identifierSchema }).strict(),
])

export const threadSpawnLaunchSchema = z
  .object({ initialPrompt: z.string().trim().min(1).max(100_000) })
  .strict()

/**
 * Untrusted tool input. It deliberately has no caller or lineage fields: those
 * are derived from the launcher-owned caller snapshot below.
 */
export const threadSpawnRequestSchema = z
  .object({
    targetHarness: supportedThreadSpawnHarnessSchema,
    model: z.string().trim().min(1).max(200).optional(),
    scope: threadSpawnScopeSchema,
    permission: threadSpawnPermissionSchema,
    worktree: threadSpawnWorktreeSchema,
    launch: threadSpawnLaunchSchema.optional(),
  })
  .strict()

/** Trusted launcher snapshot, never supplied by the MCP tool caller. */
export const threadSpawnCallerSchema = z
  .object({
    harness: supportedThreadSpawnHarnessSchema,
    chatId: identifierSchema,
    runId: identifierSchema.optional(),
    initiatorChatId: identifierSchema,
    ancestorChatIds: z.array(identifierSchema).max(100),
  })
  .strict()

export type ThreadSpawnRequest = z.infer<typeof threadSpawnRequestSchema>
export type ThreadSpawnCaller = z.infer<typeof threadSpawnCallerSchema>
export type ThreadSpawnScope = z.infer<typeof threadSpawnScopeSchema>
export type ThreadSpawnPermission = z.infer<typeof threadSpawnPermissionSchema>
export type ThreadSpawnWorktree = z.infer<typeof threadSpawnWorktreeSchema>

export type ThreadSpawnContractError = {
  code: "invalid-input" | "invalid-caller" | "forbidden-loop" | "forbidden-target"
  message: string
}

export type ThreadSpawnPlan = {
  targetHarness: z.infer<typeof supportedThreadSpawnHarnessSchema>
  model?: string
  scope: ThreadSpawnScope
  permission: ThreadSpawnPermission
  worktree: ThreadSpawnWorktree
  launch: { requested: boolean; initialPrompt?: string }
  lineage: {
    initiatorChatId: string
    parentChatId: string
    parentRunId?: string
    ancestorChatIds: string[]
  }
  approval: {
    required: true
    operations: ("create-thread" | "launch-run")[]
    summary: string
  }
}

export type ThreadSpawnContractResult =
  { ok: true; plan: ThreadSpawnPlan } | { ok: false; error: ThreadSpawnContractError }

/**
 * Validates and resolves the pure contract only. Creation, durable worktree
 * resolution, approvals, launch, auditing, and renderer behavior stay out of
 * this module for their owning tasks.
 */
export function prepareThreadSpawn(
  requestInput: unknown,
  callerInput: unknown,
): ThreadSpawnContractResult {
  const request = threadSpawnRequestSchema.safeParse(requestInput)
  if (!request.success) return invalid("invalid-input", request.error.issues[0]?.message)
  if (
    (request.data.targetHarness === "openrouter" || request.data.targetHarness === "nanogpt") &&
    !request.data.model
  ) {
    return invalid("invalid-input", `${request.data.targetHarness} threads require a model.`)
  }

  const caller = threadSpawnCallerSchema.safeParse(callerInput)
  if (!caller.success) return invalid("invalid-caller", caller.error.issues[0]?.message)

  if (request.data.targetHarness === caller.data.harness) {
    return invalid("forbidden-target", "Thread spawning requires a different target harness.")
  }

  const lineageError = validateCallerLineage(caller.data)
  if (lineageError) return invalid("forbidden-loop", lineageError)

  const operations: ("create-thread" | "launch-run")[] = ["create-thread"]
  if (request.data.launch) operations.push("launch-run")

  return {
    ok: true,
    plan: {
      targetHarness: request.data.targetHarness,
      ...(request.data.model ? { model: request.data.model } : {}),
      scope: request.data.scope,
      permission: request.data.permission,
      worktree: request.data.worktree,
      launch: request.data.launch
        ? { requested: true, initialPrompt: request.data.launch.initialPrompt }
        : { requested: false },
      lineage: {
        initiatorChatId: caller.data.initiatorChatId,
        parentChatId: caller.data.chatId,
        ...(caller.data.runId ? { parentRunId: caller.data.runId } : {}),
        ancestorChatIds: [...caller.data.ancestorChatIds, caller.data.chatId],
      },
      approval: {
        required: true,
        operations,
        summary: request.data.launch
          ? `Create a ${request.data.targetHarness} thread and launch its first run.`
          : `Create a ${request.data.targetHarness} thread.`,
      },
    },
  }
}

function validateCallerLineage(caller: ThreadSpawnCaller): string | null {
  if (new Set(caller.ancestorChatIds).size !== caller.ancestorChatIds.length) {
    return "Caller lineage contains a duplicate ancestor chat."
  }
  if (caller.ancestorChatIds.includes(caller.chatId)) {
    return "Caller lineage already contains its parent chat, which would form a loop."
  }
  if (caller.initiatorChatId === caller.chatId) {
    return caller.ancestorChatIds.length === 0
      ? null
      : "Initiator callers cannot have ancestor chats."
  }
  return caller.ancestorChatIds.includes(caller.initiatorChatId)
    ? null
    : "Non-initiator callers must retain the initiator in their ancestry."
}

function invalid(
  code: ThreadSpawnContractError["code"],
  message: string | undefined,
): ThreadSpawnContractResult {
  return { ok: false, error: { code, message: message ?? "Invalid thread spawn request." } }
}
