import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import type { getDatabase } from "../db"
import { chats, extensionEnablementPolicies, projects, tasks } from "../db/schema"
import { discoverProviderExtensions, type ProviderExtensionManifest } from "../provider-extensions"
import {
  extensionHarnesses,
  extensionCapabilityRegistry,
  extensionKinds,
  extensionScopes,
  getExtensionCapabilityForManifest,
  type ExtensionHarness,
  type ExtensionKind,
  type ExtensionScope,
} from "./capability-registry"
import {
  buildExtensionLaunchPolicy,
  ExtensionPolicyRunBlockedError,
  getExtensionRuntimeEnforcementSupport,
  type ExtensionLaunchPolicy,
  type ExtensionRuntimeEnforcement,
} from "./runtime-enforcement"
import type { AgentProfileRuntimeAuthority } from "../../../shared/agent-profiles"

type Database = ReturnType<typeof getDatabase>

export const EXTENSION_ENABLEMENT_POLICY_SCHEMA_VERSION = 1 as const
export const extensionPolicyScopes = ["user", "project", "task"] as const
export const extensionPolicySources = ["fixed-default", ...extensionPolicyScopes] as const

export type ExtensionPolicyScope = (typeof extensionPolicyScopes)[number]
export type ExtensionPolicySource = (typeof extensionPolicySources)[number]

export const extensionPolicyTargetSchema = z
  .object({
    extensionId: z.string().min(1),
    harness: z.enum(extensionHarnesses),
    kind: z.enum(extensionKinds),
    nativeScope: z.enum(extensionScopes),
  })
  .strict()

export type ExtensionPolicyTarget = z.infer<typeof extensionPolicyTargetSchema>

export const extensionPolicyLocationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user") }).strict(),
  z.object({ type: z.literal("project"), projectId: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("task"),
      projectId: z.string().min(1),
      taskId: z.string().min(1),
    })
    .strict(),
])

export type ExtensionPolicyLocation = z.infer<typeof extensionPolicyLocationSchema>

export type ResolvedExtensionEnablement = {
  schemaVersion: typeof EXTENSION_ENABLEMENT_POLICY_SCHEMA_VERSION
  target: ExtensionPolicyTarget
  support: "supported" | "unsupported"
  supportedScopes: ExtensionPolicyScope[]
  enabled: boolean
  source: ExtensionPolicySource | "unsupported"
  reason: string | null
  runtimeEnforcement: ExtensionRuntimeEnforcement
}

export type ExtensionRunContextManifest = {
  schemaVersion: typeof EXTENSION_ENABLEMENT_POLICY_SCHEMA_VERSION
  harness: ExtensionHarness
  projectId: string | null
  taskId: string | null
  entries: Array<{
    extensionId: string
    name: string
    kind: ExtensionKind
    nativeScope: ExtensionScope
    enabled: boolean
    source: ExtensionPolicySource
  }>
  enabledExtensionIds: string[]
  disabledExtensionIds: string[]
  unsupported: Array<{ extensionId: string; reason: string }>
}

export class UnsupportedExtensionPolicyScopeError extends Error {
  readonly code = "UNSUPPORTED_EXTENSION_POLICY_SCOPE"

  constructor(
    readonly target: ExtensionPolicyTarget,
    readonly scope: ExtensionPolicyScope,
    message: string,
  ) {
    super(message)
    this.name = "UnsupportedExtensionPolicyScopeError"
  }
}

export function extensionPolicyTargetFromManifest(
  manifest: ProviderExtensionManifest,
): ExtensionPolicyTarget {
  const capability = getExtensionCapabilityForManifest(manifest)
  return {
    extensionId: manifest.id,
    harness: capability.harness,
    kind: capability.kind,
    nativeScope: capability.scope,
  }
}

export function getExtensionPolicyScopeSupport(
  target: ExtensionPolicyTarget,
  scope: ExtensionPolicyScope,
): { support: "supported" | "unsupported"; reason: string | null } {
  const parsed = extensionPolicyTargetSchema.parse(target)
  const capability = getCapability(parsed)
  if (!capability) {
    return { support: "unsupported", reason: "The extension capability is not registered." }
  }
  if (capability.inventory === "unsupported" || capability.inventory === "disabled") {
    return {
      support: "unsupported",
      reason: `The ${parsed.harness} ${parsed.kind} ${parsed.nativeScope} capability is ${capability.inventory}.`,
    }
  }
  if (parsed.kind === "hook") {
    return {
      support: "unsupported",
      reason: "Managed hooks use their explicit validated lifecycle instead of run policy.",
    }
  }
  if (capability.runtimeConsumption !== "supported") {
    return {
      support: "unsupported",
      reason: `The ${parsed.harness} ${parsed.kind} ${parsed.nativeScope} capability has no supported managed-run consumption path.`,
    }
  }
  if (scope !== "user" && !managedRunPolicyHarnesses.includes(parsed.harness)) {
    return {
      support: "unsupported",
      reason: `${parsed.harness} does not support project or task run-context policy.`,
    }
  }
  return { support: "supported", reason: null }
}

export function setExtensionEnablementPolicy(
  database: Database,
  input: {
    target: ExtensionPolicyTarget
    location: ExtensionPolicyLocation
    enabled: boolean
  },
): ResolvedExtensionEnablement {
  const target = extensionPolicyTargetSchema.parse(input.target)
  const location = extensionPolicyLocationSchema.parse(input.location)
  assertScopeSupported(target, location.type)
  validateLocation(database, location)

  const scopeId = policyScopeId(location)
  const now = new Date()
  database
    .insert(extensionEnablementPolicies)
    .values({
      extensionId: target.extensionId,
      harness: target.harness,
      kind: target.kind,
      nativeScope: target.nativeScope,
      scopeType: location.type,
      scopeId,
      projectId: location.type === "user" ? null : location.projectId,
      taskId: location.type === "task" ? location.taskId : null,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        extensionEnablementPolicies.extensionId,
        extensionEnablementPolicies.scopeType,
        extensionEnablementPolicies.scopeId,
      ],
      set: {
        harness: target.harness,
        kind: target.kind,
        nativeScope: target.nativeScope,
        enabled: input.enabled,
        updatedAt: now,
      },
    })
    .run()

  return resolveExtensionEnablement(database, {
    target,
    ...(location.type === "project" ? { projectId: location.projectId } : {}),
    ...(location.type === "task" ? { projectId: location.projectId, taskId: location.taskId } : {}),
  })
}

export function clearExtensionEnablementPolicy(
  database: Database,
  input: { target: ExtensionPolicyTarget; location: ExtensionPolicyLocation },
): ResolvedExtensionEnablement {
  const target = extensionPolicyTargetSchema.parse(input.target)
  const location = extensionPolicyLocationSchema.parse(input.location)
  validateLocation(database, location)
  database
    .delete(extensionEnablementPolicies)
    .where(
      and(
        eq(extensionEnablementPolicies.extensionId, target.extensionId),
        eq(extensionEnablementPolicies.scopeType, location.type),
        eq(extensionEnablementPolicies.scopeId, policyScopeId(location)),
      ),
    )
    .run()

  return resolveExtensionEnablement(database, {
    target,
    ...(location.type === "project" ? { projectId: location.projectId } : {}),
    ...(location.type === "task" ? { projectId: location.projectId, taskId: location.taskId } : {}),
  })
}

export function resolveExtensionEnablement(
  database: Database,
  input: { target: ExtensionPolicyTarget; projectId?: string; taskId?: string },
): ResolvedExtensionEnablement {
  return resolveExtensionEnablementInternal(database, input)
}

export function previewClearExtensionEnablementPolicy(
  database: Database,
  input: { target: ExtensionPolicyTarget; location: ExtensionPolicyLocation },
): ResolvedExtensionEnablement {
  const location = extensionPolicyLocationSchema.parse(input.location)
  validateLocation(database, location)
  return resolveExtensionEnablementInternal(
    database,
    {
      target: input.target,
      ...(location.type === "project" ? { projectId: location.projectId } : {}),
      ...(location.type === "task"
        ? { projectId: location.projectId, taskId: location.taskId }
        : {}),
    },
    location,
  )
}

function resolveExtensionEnablementInternal(
  database: Database,
  input: { target: ExtensionPolicyTarget; projectId?: string; taskId?: string },
  ignoredLocation?: ExtensionPolicyLocation,
): ResolvedExtensionEnablement {
  const target = extensionPolicyTargetSchema.parse(input.target)
  const context = validateContext(database, input.projectId, input.taskId)
  const supportedScopes = extensionPolicyScopes.filter(
    (scope) => getExtensionPolicyScopeSupport(target, scope).support === "supported",
  )
  const support = getExtensionPolicyScopeSupport(
    target,
    context.taskId ? "task" : context.projectId ? "project" : "user",
  )
  if (support.support === "unsupported") {
    return {
      schemaVersion: EXTENSION_ENABLEMENT_POLICY_SCHEMA_VERSION,
      target,
      support: "unsupported",
      supportedScopes,
      enabled: false,
      source: "unsupported",
      reason: support.reason,
      runtimeEnforcement: getExtensionRuntimeEnforcementSupport(target),
    }
  }

  const precedence = [
    ...(context.taskId ? [{ source: "task" as const, scopeId: context.taskId }] : []),
    ...(context.projectId ? [{ source: "project" as const, scopeId: context.projectId }] : []),
    { source: "user" as const, scopeId: "user" },
  ]
  const rows = database
    .select({
      scopeType: extensionEnablementPolicies.scopeType,
      scopeId: extensionEnablementPolicies.scopeId,
      enabled: extensionEnablementPolicies.enabled,
    })
    .from(extensionEnablementPolicies)
    .where(
      and(
        eq(extensionEnablementPolicies.extensionId, target.extensionId),
        eq(extensionEnablementPolicies.harness, target.harness),
        eq(extensionEnablementPolicies.kind, target.kind),
        eq(extensionEnablementPolicies.nativeScope, target.nativeScope),
        inArray(
          extensionEnablementPolicies.scopeId,
          precedence.map((entry) => entry.scopeId),
        ),
      ),
    )
    .all()
  for (const candidate of precedence) {
    if (
      ignoredLocation?.type === candidate.source &&
      policyScopeId(ignoredLocation) === candidate.scopeId
    ) {
      continue
    }
    const row = rows.find(
      (entry) => entry.scopeType === candidate.source && entry.scopeId === candidate.scopeId,
    )
    if (row) {
      return {
        schemaVersion: EXTENSION_ENABLEMENT_POLICY_SCHEMA_VERSION,
        target,
        support: "supported",
        supportedScopes,
        enabled: row.enabled,
        source: candidate.source,
        reason: null,
        runtimeEnforcement: getExtensionRuntimeEnforcementSupport(target),
      }
    }
  }
  return {
    schemaVersion: EXTENSION_ENABLEMENT_POLICY_SCHEMA_VERSION,
    target,
    support: "supported",
    supportedScopes,
    enabled: true,
    source: "fixed-default",
    reason: null,
    runtimeEnforcement: getExtensionRuntimeEnforcementSupport(target),
  }
}

export async function resolveExtensionInventoryState(
  database: Database,
  input: {
    cwd?: string
    homeDir?: string
    projectId?: string
    taskId?: string
    harness?: ExtensionHarness
  },
): Promise<
  Array<{
    extension: ProviderExtensionManifest
    resolved: ResolvedExtensionEnablement
  }>
> {
  const context = validateContext(database, input.projectId, input.taskId)
  const manifests = await discoverProviderExtensions({ cwd: input.cwd, homeDir: input.homeDir })
  return manifests
    .map((extension) => {
      const target = extensionPolicyTargetFromManifest(extension)
      const resolved = resolveExtensionEnablement(database, {
        target,
        ...(context.projectId ? { projectId: context.projectId } : {}),
        ...(context.taskId ? { taskId: context.taskId } : {}),
      })
      return {
        extension,
        resolved:
          extension.capabilities.discovery === "unknown"
            ? unsupportedManifestState(
                resolved,
                extension.limitations[0] ?? "Extension discovery is unavailable.",
              )
            : resolved,
      }
    })
    .filter((entry) => !input.harness || entry.resolved.target.harness === input.harness)
}

export async function buildExtensionRunContext(
  database: Database,
  input: {
    chatId: string
    harness: ExtensionHarness
    cwd?: string
    homeDir?: string
    profileRuntimeAuthority?: AgentProfileRuntimeAuthority
  },
): Promise<{
  context: string
  manifest: ExtensionRunContextManifest
  launchPolicy: ExtensionLaunchPolicy
}> {
  if (!managedRunPolicyHarnesses.includes(input.harness)) {
    throw new UnsupportedExtensionPolicyScopeError(
      {
        extensionId: `${input.harness}:managed-run`,
        harness: input.harness,
        kind: "skill",
        nativeScope: "user",
      },
      "task",
      `${input.harness} does not support extension policy in managed run context.`,
    )
  }
  const chat = database
    .select({ projectId: chats.projectId, taskId: chats.taskId })
    .from(chats)
    .where(eq(chats.id, input.chatId))
    .get()
  if (!chat) throw new Error("Chat not found")
  const context = validateContext(database, chat.projectId ?? undefined, chat.taskId ?? undefined)
  let state = await resolveExtensionInventoryState(database, {
    cwd: input.cwd,
    homeDir: input.homeDir,
    harness: input.harness,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.taskId ? { taskId: context.taskId } : {}),
  })
  if (input.profileRuntimeAuthority) {
    const allowed = new Set(input.profileRuntimeAuthority.allowedSkills)
    const skills = state.filter((entry) => entry.resolved.target.kind === "skill")
    const installedIds = new Set(skills.map((entry) => entry.extension.id))
    const unavailable = [...allowed].filter((id) => !installedIds.has(id))
    const denied = skills
      .filter((entry) => allowed.has(entry.extension.id))
      .filter((entry) => entry.resolved.support !== "supported" || !entry.resolved.enabled)
      .map((entry) => entry.extension.id)
    const blocked = [...new Set([...unavailable, ...denied])].sort()
    if (blocked.length > 0) {
      throw new ExtensionPolicyRunBlockedError(
        input.harness,
        blocked,
        `Run blocked: frozen Agent Profile skills are missing, unsupported, or disabled: ${blocked.join(", ")}.`,
      )
    }
    state = state.map((entry) =>
      entry.resolved.target.kind === "skill" && !allowed.has(entry.extension.id)
        ? {
            ...entry,
            resolved: {
              ...entry.resolved,
              enabled: false,
            },
          }
        : entry,
    )
  }
  const entries = state
    .filter((entry) => entry.resolved.support === "supported")
    .map((entry) => ({
      extensionId: entry.extension.id,
      name: entry.extension.name,
      kind: entry.resolved.target.kind,
      nativeScope: entry.resolved.target.nativeScope,
      enabled: entry.resolved.enabled,
      source: entry.resolved.source as ExtensionPolicySource,
    }))
  const unsupported = state
    .filter((entry) => entry.resolved.support === "unsupported")
    .map((entry) => ({
      extensionId: entry.extension.id,
      reason: entry.resolved.reason ?? "Unsupported extension policy.",
    }))
  const manifest: ExtensionRunContextManifest = {
    schemaVersion: EXTENSION_ENABLEMENT_POLICY_SCHEMA_VERSION,
    harness: input.harness,
    projectId: context.projectId,
    taskId: context.taskId,
    entries,
    enabledExtensionIds: entries.filter((entry) => entry.enabled).map((entry) => entry.extensionId),
    disabledExtensionIds: entries
      .filter((entry) => !entry.enabled)
      .map((entry) => entry.extensionId),
    unsupported,
  }
  return {
    context: formatRunContext(manifest),
    manifest,
    launchPolicy: buildExtensionLaunchPolicy(input.harness, state),
  }
}

function getCapability(target: ExtensionPolicyTarget) {
  return extensionCapabilityRegistry.find(
    (capability) =>
      capability.harness === target.harness &&
      capability.kind === target.kind &&
      capability.scope === target.nativeScope,
  )
}

const managedRunPolicyHarnesses: ExtensionHarness[] = ["claude-code", "codex", "cursor-agent"]

function assertScopeSupported(target: ExtensionPolicyTarget, scope: ExtensionPolicyScope): void {
  const result = getExtensionPolicyScopeSupport(target, scope)
  if (result.support === "unsupported") {
    throw new UnsupportedExtensionPolicyScopeError(
      target,
      scope,
      result.reason ?? "Extension policy scope is unsupported.",
    )
  }
}

function policyScopeId(location: ExtensionPolicyLocation): string {
  if (location.type === "user") return "user"
  return location.type === "project" ? location.projectId : location.taskId
}

function validateLocation(database: Database, location: ExtensionPolicyLocation): void {
  if (location.type === "user") return
  validateContext(
    database,
    location.projectId,
    location.type === "task" ? location.taskId : undefined,
  )
}

function validateContext(
  database: Database,
  projectId?: string,
  taskId?: string,
): { projectId: string | null; taskId: string | null } {
  let resolvedProjectId = projectId ?? null
  if (taskId) {
    const task = database
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get()
    if (!task) throw new Error("Task not found")
    if (resolvedProjectId && task.projectId !== resolvedProjectId) {
      throw new Error("Task does not belong to the requested project")
    }
    resolvedProjectId = task.projectId
  }
  if (resolvedProjectId) {
    const project = database
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, resolvedProjectId))
      .get()
    if (!project) throw new Error("Project not found")
  }
  return { projectId: resolvedProjectId, taskId: taskId ?? null }
}

function formatRunContext(manifest: ExtensionRunContextManifest): string {
  if (manifest.entries.length === 0) return ""
  const enabled = manifest.entries
    .filter((entry) => entry.enabled)
    .map(
      (entry) =>
        `- ${singleLine(entry.extensionId)} | ${entry.kind} | ${singleLine(entry.name)} | policy=${entry.source}`,
    )
  const disabled = manifest.entries
    .filter((entry) => !entry.enabled)
    .map((entry) => `- ${singleLine(entry.extensionId)} | policy=${entry.source}`)
  return `--- FLAPSTACK ENFORCED EXTENSION POLICY (DO NOT QUOTE) ---
Harness: ${manifest.harness}
Flapstack applied native discovery controls before provider launch. A run whose
disabled policy could not be enforced was blocked before this prompt existed.

Enabled:
${enabled.length ? enabled.join("\n") : "- None"}

Disabled:
${disabled.length ? disabled.join("\n") : "- None"}
--- END FLAPSTACK ENFORCED EXTENSION POLICY ---`
}

function unsupportedManifestState(
  resolved: ResolvedExtensionEnablement,
  reason: string,
): ResolvedExtensionEnablement {
  return {
    ...resolved,
    support: "unsupported",
    enabled: false,
    source: "unsupported",
    reason,
  }
}

function singleLine(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 256)
}
