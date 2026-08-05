import Database from "better-sqlite3"
import {
  DEFAULT_RUNTIME_CONTROLS,
  type AgentRuntimePreference,
  type ResolvedAgentRuntime,
  type ResolvedRuntimeLaunch,
  type RuntimeAdapterProbe,
  type RuntimeCapabilitySnapshot,
  type RuntimeLaunchControls,
  type RuntimePermissionSnapshot,
} from "../../../shared/agent-runtime"
import { checkRuntimeCompatibility } from "./compatibility"
import type { RunPermissionMode } from "../../../shared/harness-types"
import { createRuntimeDefaultsService } from "./defaults"
import { AgentRuntimeResolutionError, assertResolvedAgentRuntime } from "./resolver"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object

export const LEGACY_RUNTIME_CAPABILITIES: RuntimeCapabilitySnapshot = {
  schemaVersion: 1,
  status: "legacy",
  capturedAt: null,
  controls: {
    modelThinking: { supported: false, reason: "Legacy Stage 3 snapshot." },
    reasoningDisplay: { supported: true, reason: null },
    subagentActivity: { supported: false, reason: "Legacy Stage 3 snapshot." },
    hookDiagnostics: { supported: false, reason: "Legacy Stage 3 snapshot." },
  },
  limitations: ["Historical run created before Agent Runtime snapshots."],
  unavailableReason: null,
}

export type RuntimeSnapshotColumns = {
  runtimeSnapshotVersion: number
  runtimePreference: AgentRuntimePreference
  runtimePreferenceSource: ResolvedRuntimeLaunch["preferenceSource"]
  resolvedRuntime: ResolvedAgentRuntime
  runtimeAdapterVersion: string
  runtimeProtocolVersion: string
  runtimeCapabilitySnapshot: string
  runtimeControlSnapshot: string
}

export type RuntimeSnapshotInput = {
  chatId: string
  harness: string
  model?: string | null
  permission: RuntimePermissionSnapshot
  controls?: Partial<Omit<RuntimeLaunchControls, "schemaVersion">>
  adapterProbes?: Partial<Record<ResolvedAgentRuntime, RuntimeAdapterProbe>>
}

export function constructRuntimeSnapshot(
  database: DatabaseLike,
  input: RuntimeSnapshotInput,
): RuntimeSnapshotColumns {
  const sqlite = rawClient(database)
  const chat = sqlite
    .prepare(
      `SELECT c.id, c.project_id, c.archived_at, c.runtime_preference,
              p.id project_exists, p.archived_at project_archived_at
       FROM chats c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = ?`,
    )
    .get(input.chatId) as
    | {
        id: string
        project_id: string | null
        archived_at: number | null
        runtime_preference: AgentRuntimePreference | null
        project_exists: string | null
        project_archived_at: number | null
      }
    | undefined
  if (!chat) {
    throw new AgentRuntimeResolutionError({
      code: "chat-missing",
      harness: input.harness,
      runtime: null,
      message: "Runtime launch chat is missing.",
      repair: "Create or restore the chat before launching.",
    })
  }
  if (chat.archived_at !== null) {
    throw new AgentRuntimeResolutionError({
      code: "chat-archived",
      harness: input.harness,
      runtime: null,
      message: "Runtime launch chat is archived.",
      repair: "Restore the chat before launching.",
    })
  }
  if (chat.project_id !== null && (!chat.project_exists || chat.project_archived_at !== null)) {
    throw new AgentRuntimeResolutionError({
      code: "project-missing",
      harness: input.harness,
      runtime: null,
      message: chat.project_exists
        ? "Runtime launch project is archived."
        : "Runtime launch project is missing.",
      repair: "Restore or rebind the chat project before launching.",
    })
  }

  const defaults = createRuntimeDefaultsService(sqlite)
  const projectPreference = chat.project_id
    ? defaults.preference({ type: "project", id: chat.project_id }, input.harness)
    : null
  const globalPreference = defaults.preference({ type: "global", id: null }, input.harness)
  const launch = assertResolvedAgentRuntime({
    harness: input.harness,
    model: input.model,
    chatPreference: chat.runtime_preference,
    projectPreference,
    globalPreference,
    controls: input.controls,
    permission: input.permission,
    adapterProbes: input.adapterProbes,
  })
  return runtimeSnapshotColumns(launch)
}

export function runtimeSnapshotColumns(launch: ResolvedRuntimeLaunch): RuntimeSnapshotColumns {
  return {
    runtimeSnapshotVersion: 1,
    runtimePreference: launch.requestedPreference,
    runtimePreferenceSource: launch.preferenceSource,
    resolvedRuntime: launch.resolvedRuntime,
    runtimeAdapterVersion: launch.versions.adapterVersion,
    runtimeProtocolVersion: launch.versions.protocolVersion,
    runtimeCapabilitySnapshot: JSON.stringify(launch.capabilities),
    runtimeControlSnapshot: JSON.stringify(launch.controls),
  }
}

export function legacyRuntimeSnapshot(): RuntimeSnapshotColumns {
  return {
    runtimeSnapshotVersion: 0,
    runtimePreference: "flapstack-native",
    runtimePreferenceSource: "legacy",
    resolvedRuntime: "flapstack-native",
    runtimeAdapterVersion: "legacy-stage3",
    runtimeProtocolVersion: "legacy-stage3",
    runtimeCapabilitySnapshot: JSON.stringify(LEGACY_RUNTIME_CAPABILITIES),
    runtimeControlSnapshot: JSON.stringify(DEFAULT_RUNTIME_CONTROLS),
  }
}

export function interpretRuntimeSnapshot(row: Record<string, unknown>): RuntimeSnapshotColumns {
  if (Number(row.runtime_snapshot_version ?? row.runtimeSnapshotVersion ?? 0) < 1) {
    return legacyRuntimeSnapshot()
  }
  return {
    runtimeSnapshotVersion: Number(row.runtime_snapshot_version ?? row.runtimeSnapshotVersion),
    runtimePreference: String(
      row.runtime_preference ?? row.runtimePreference,
    ) as AgentRuntimePreference,
    runtimePreferenceSource: String(
      row.runtime_preference_source ?? row.runtimePreferenceSource,
    ) as ResolvedRuntimeLaunch["preferenceSource"],
    resolvedRuntime: String(row.resolved_runtime ?? row.resolvedRuntime) as ResolvedAgentRuntime,
    runtimeAdapterVersion: String(row.runtime_adapter_version ?? row.runtimeAdapterVersion),
    runtimeProtocolVersion: String(row.runtime_protocol_version ?? row.runtimeProtocolVersion),
    runtimeCapabilitySnapshot: String(
      row.runtime_capability_snapshot ?? row.runtimeCapabilitySnapshot,
    ),
    runtimeControlSnapshot: String(row.runtime_control_snapshot ?? row.runtimeControlSnapshot),
  }
}

export function resolvedLaunchFromSnapshotRow(row: Record<string, unknown>): ResolvedRuntimeLaunch {
  const snapshot = interpretRuntimeSnapshot(row)
  const harness = String(row.harness)
  const capabilities = parseSnapshotJson<RuntimeCapabilitySnapshot>(
    snapshot.runtimeCapabilitySnapshot,
    snapshot.runtimeSnapshotVersion === 0 ? LEGACY_RUNTIME_CAPABILITIES : null,
    "Runtime capability snapshot",
  )
  const compatibility = checkRuntimeCompatibility(
    harness,
    snapshot.resolvedRuntime,
    capabilities.composition,
  )
  if (!compatibility.compatible) throw new AgentRuntimeResolutionError(compatibility.reason)
  return {
    schemaVersion: 1,
    harness,
    model: typeof row.model === "string" ? row.model : null,
    requestedPreference: snapshot.runtimePreference,
    preferenceSource: snapshot.runtimePreferenceSource,
    resolvedRuntime: snapshot.resolvedRuntime,
    compatibility,
    versions: {
      adapterVersion: snapshot.runtimeAdapterVersion,
      protocolVersion: snapshot.runtimeProtocolVersion,
    },
    capabilities,
    controls: parseSnapshotJson(
      snapshot.runtimeControlSnapshot,
      snapshot.runtimeSnapshotVersion === 0 ? DEFAULT_RUNTIME_CONTROLS : null,
      "Runtime control snapshot",
    ),
    permission: runtimePermissionSnapshot(
      String(row.permission_mode ?? row.permissionMode) as RunPermissionMode,
      row.custom_permissions ?? row.customPermissions,
    ),
  }
}

export function runtimeSnapshotSqlValues(snapshot: RuntimeSnapshotColumns): readonly unknown[] {
  return [
    snapshot.runtimeSnapshotVersion,
    snapshot.runtimePreference,
    snapshot.runtimePreferenceSource,
    snapshot.resolvedRuntime,
    snapshot.runtimeAdapterVersion,
    snapshot.runtimeProtocolVersion,
    snapshot.runtimeCapabilitySnapshot,
    snapshot.runtimeControlSnapshot,
  ]
}

export function runtimePermissionSnapshot(
  mode: RunPermissionMode,
  customPermissions: unknown,
): RuntimePermissionSnapshot {
  if (!customPermissions) return { mode, customPermissions: null }
  let parsed: unknown = customPermissions
  try {
    if (typeof customPermissions === "string") parsed = JSON.parse(customPermissions) as unknown
  } catch {
    return { mode, customPermissions: null }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { mode, customPermissions: null }
  }
  const normalized: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "boolean") normalized[key] = value
  }
  return { mode, customPermissions: normalized }
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") {
    return database as Sqlite
  }
  return (database as unknown as { $client: Sqlite }).$client
}

function parseSnapshotJson<T>(value: string, legacy: T | null, label: string): T {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T
  } catch {
    // Fail below with a bounded diagnostic.
  }
  if (legacy) return legacy
  throw new Error(`${label} is corrupt.`)
}
