import type {
  AgentActivityEvent,
  AgentActivityKind,
  AgentActivityPayloadByKind,
  AgentActivityPhase,
} from "../../../../shared/agent-activity"
import type {
  ResolvedAgentRuntime,
  RuntimeCapabilitySnapshot,
  RuntimeLaunchControls,
} from "../../../../shared/agent-runtime"
import {
  projectLegacyActivity,
  type LegacyActivityProjection,
} from "../../../../main/lib/agent-runtime/legacy-activity-projection"

export type RuntimeActivitySource = AgentActivityEvent | LegacyActivityProjection

export type RuntimeActivityStatus = "loading" | "live" | "ready" | "stale" | "error"

export type RuntimeActivityFilters = {
  search: string
  kind: AgentActivityKind | "all"
  runtime: ResolvedAgentRuntime | "all"
  reasoningDisplay: boolean
  subagentActivity: boolean
  hookDiagnostics: boolean
}

export const DEFAULT_RUNTIME_ACTIVITY_FILTERS: RuntimeActivityFilters = {
  search: "",
  kind: "all",
  runtime: "all",
  reasoningDisplay: true,
  subagentActivity: true,
  hookDiagnostics: false,
}

export type RuntimeActivityRow = {
  key: string
  runtime: ResolvedAgentRuntime
  kind: AgentActivityKind
  phase: AgentActivityPhase
  label: string
  content: string | null
  sections: string[]
  provenance: string
  timestamp: number | null
  durationMs: number | null
  status: string
  parentId: string | null
  identity: string[]
  searchText: string
  copyable: boolean
  expandable: boolean
  defaultExpanded: boolean
  corrupt: boolean
  privateUnavailable: boolean
  source: RuntimeActivitySource
}

const REASONING_KINDS = new Set<AgentActivityKind>([
  "reasoning-summary",
  "provider-visible-reasoning",
])

const KNOWN_KINDS = new Set<AgentActivityKind>([
  "lifecycle",
  "status",
  "agent-text",
  "reasoning-summary",
  "provider-visible-reasoning",
  "plan",
  "tool",
  "command",
  "patch",
  "permission",
  "hook",
  "subagent",
  "warning",
  "compaction",
  "usage",
  "opaque-metadata",
  "private-metadata",
])

const TERMINAL_PHASES = new Set<AgentActivityPhase>(["completed", "failed", "cancelled"])

export class CriticalActivityFormatError extends Error {
  constructor(kind: string) {
    super(`Unsupported critical Runtime activity kind: ${kind}`)
    this.name = "CriticalActivityFormatError"
  }
}

function isPersisted(source: RuntimeActivitySource): source is AgentActivityEvent {
  return "eventId" in source
}

export function runtimeActivityKey(source: RuntimeActivitySource): string {
  return isPersisted(source) ? `event:${source.eventId}` : source.projectionId
}

export function compareRuntimeActivity(a: RuntimeActivitySource, b: RuntimeActivitySource): number {
  if (isPersisted(a) && isPersisted(b)) {
    return (
      a.storageId - b.storageId ||
      a.sequence - b.sequence ||
      (a.summaryIndex ?? -1) - (b.summaryIndex ?? -1) ||
      (a.contentIndex ?? -1) - (b.contentIndex ?? -1) ||
      a.eventId.localeCompare(b.eventId)
    )
  }
  if (!isPersisted(a) && !isPersisted(b)) {
    return a.sequence - b.sequence || a.projectionId.localeCompare(b.projectionId)
  }
  return isPersisted(a) ? 1 : -1
}

/** Merge forward/backward pages and replay batches without reordering or duplicate rows. */
export function mergeRuntimeActivityPages(
  existing: RuntimeActivitySource[],
  incoming: RuntimeActivitySource[],
): RuntimeActivitySource[] {
  const byKey = new Map<string, RuntimeActivitySource>()
  for (const source of [...existing, ...incoming]) byKey.set(runtimeActivityKey(source), source)
  return [...byKey.values()].sort(compareRuntimeActivity)
}

/**
 * Preserve pre-activity transcript rows while avoiding exact content duplicated
 * by the durable Runtime stream. Legacy rows always precede durable events.
 */
export function selectRuntimeActivitySource(
  events: AgentActivityEvent[],
  legacyMessages: unknown,
): RuntimeActivitySource[] {
  const legacy = projectLegacyActivity(legacyMessages)
  if (events.length === 0) return legacy

  const durableSignatures = new Map<string, number>()
  for (const event of events) {
    const signature = activityContentSignature(event)
    if (signature) durableSignatures.set(signature, (durableSignatures.get(signature) ?? 0) + 1)
  }
  const retainedLegacy = [...legacy].reverse().filter((source) => {
    const signature = activityContentSignature(source)
    const matches = signature ? (durableSignatures.get(signature) ?? 0) : 0
    if (!signature || matches === 0) return true
    durableSignatures.set(signature, matches - 1)
    return false
  })
  retainedLegacy.reverse()
  return [...retainedLegacy, ...events].sort(compareRuntimeActivity)
}

function activityContentSignature(source: RuntimeActivitySource): string | null {
  if (source.kind === "agent-text") {
    const text = (source.payload as AgentActivityPayloadByKind["agent-text"]).text.trim()
    const role = isPersisted(source) ? "assistant" : source.role
    return text ? `agent-text:${role}:${text}` : null
  }
  if (source.kind === "reasoning-summary") {
    const text = (source.payload as AgentActivityPayloadByKind["reasoning-summary"]).text.trim()
    return text ? `reasoning-summary:${text}` : null
  }
  return null
}

function sourceRuntime(source: RuntimeActivitySource): ResolvedAgentRuntime {
  return isPersisted(source) ? source.runtime : "flapstack-native"
}

function sourceProvider(source: RuntimeActivitySource): string {
  return isPersisted(source) ? source.provider : "legacy"
}

function sourceTimestamp(source: RuntimeActivitySource): number | null {
  return isPersisted(source) ? (source.providerTimestamp ?? source.receivedAt) : null
}

function payload<K extends AgentActivityKind>(
  source: RuntimeActivitySource,
  kind: K,
): AgentActivityPayloadByKind[K] {
  return source.payload as AgentActivityPayloadByKind[K]
}

function boundedLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const normalized = value.replace(/[\r\n\t]+/g, " ").trim()
  return normalized ? normalized.slice(0, 160) : fallback
}

function usageText(value: AgentActivityPayloadByKind["usage"]): string {
  const fields = [
    value.inputTokens == null ? null : `${value.inputTokens.toLocaleString()} input`,
    value.outputTokens == null ? null : `${value.outputTokens.toLocaleString()} output`,
    value.cachedTokens == null ? null : `${value.cachedTokens.toLocaleString()} cached`,
    value.reasoningTokens == null ? null : `${value.reasoningTokens.toLocaleString()} reasoning`,
    value.costUsd == null ? null : `$${value.costUsd.toFixed(4)}`,
  ].filter((field): field is string => Boolean(field))
  return fields.join(" · ")
}

function planText(value: AgentActivityPayloadByKind["plan"]): string {
  if (value.text) return value.text
  return (value.items ?? [])
    .map((item) => `${item.status ? `[${item.status}] ` : ""}${item.text}`)
    .join("\n")
}

function rowLabel(source: RuntimeActivitySource, runtime: ResolvedAgentRuntime): string {
  if (source.phase === "failed") return "Error"
  switch (source.kind) {
    case "lifecycle":
      return "Lifecycle"
    case "status":
      return "Activity summary"
    case "agent-text":
      if (!isPersisted(source) && source.role === "user") return "User message"
      return runtime === "codex"
        ? "Codex message"
        : runtime === "claude-code"
          ? "Claude Code message"
          : "Assistant message"
    case "reasoning-summary":
      return "Reasoning summary"
    case "provider-visible-reasoning":
      return runtime === "claude-code" ? "Provider-visible thinking" : "Provider-visible reasoning"
    case "plan":
      return "Plan"
    case "tool":
      return boundedLabel(payload(source, "tool").name, "Tool")
    case "command":
      return "Command"
    case "patch":
      return "Patch"
    case "permission":
      return "Permission"
    case "hook":
      return "Hook"
    case "subagent":
      return "Subagent"
    case "warning":
      return "Warning"
    case "compaction":
      return "Compaction"
    case "usage":
      return "Usage"
    case "opaque-metadata":
      return `Metadata: ${boundedLabel(payload(source, "opaque-metadata").eventType, "unknown")}`
    case "private-metadata":
      return "Private reasoning unavailable"
  }
}

function rowContent(source: RuntimeActivitySource): string | null {
  switch (source.kind) {
    case "lifecycle": {
      const value = payload(source, "lifecycle")
      return [value.state, value.detail].filter(Boolean).join(": ")
    }
    case "status":
      return payload(source, "status").message
    case "agent-text":
      return payload(source, "agent-text").text
    case "reasoning-summary":
      return payload(source, "reasoning-summary").text
    case "provider-visible-reasoning":
      return payload(source, "provider-visible-reasoning").text
    case "plan":
      return planText(payload(source, "plan"))
    case "tool": {
      const value = payload(source, "tool")
      return [value.state, value.inputSummary, value.outputSummary].filter(Boolean).join("\n")
    }
    case "command": {
      const value = payload(source, "command")
      const exit = value.exitCode == null ? null : `exit ${value.exitCode}`
      return [value.command, value.state, exit, value.outputSummary].filter(Boolean).join("\n")
    }
    case "patch": {
      const value = payload(source, "patch")
      return [value.path, value.state, value.summary].filter(Boolean).join("\n")
    }
    case "permission": {
      const value = payload(source, "permission")
      return [value.requestType, value.state, value.decision].filter(Boolean).join(" · ")
    }
    case "hook": {
      const value = payload(source, "hook")
      return [value.name, value.state, value.summary].filter(Boolean).join(" · ")
    }
    case "subagent": {
      const value = payload(source, "subagent")
      return [value.agentId, value.state, value.message].filter(Boolean).join(" · ")
    }
    case "warning":
      return payload(source, "warning").message
    case "compaction": {
      const value = payload(source, "compaction")
      return [value.state, value.summary].filter(Boolean).join(": ")
    }
    case "usage":
      return usageText(payload(source, "usage"))
    case "opaque-metadata":
    case "private-metadata":
      return null
  }
}

function providerIdentity(source: RuntimeActivitySource): string[] {
  if (!isPersisted(source)) return []
  return [
    source.providerThreadId && `thread ${source.providerThreadId}`,
    source.providerTurnId && `turn ${source.providerTurnId}`,
    source.providerItemId && `item ${source.providerItemId}`,
    source.providerMessageId && `message ${source.providerMessageId}`,
    source.providerToolId && `tool ${source.providerToolId}`,
    source.summaryIndex != null && `summary ${source.summaryIndex}`,
    source.contentIndex != null && `content ${source.contentIndex}`,
  ].filter((value): value is string => Boolean(value))
}

function isPrivateOrCorrupt(source: RuntimeActivitySource): boolean {
  return (
    isPersisted(source) &&
    (source.privacyClass === "private" ||
      source.privacyClass === "encrypted" ||
      source.displayClass === "private" ||
      source.redactionState === "corrupt")
  )
}

export function formatRuntimeActivity(source: RuntimeActivitySource): RuntimeActivityRow {
  if (!KNOWN_KINDS.has(source.kind)) throw new CriticalActivityFormatError(String(source.kind))
  const runtime = sourceRuntime(source)
  const corrupt = isPersisted(source) && source.redactionState === "corrupt"
  const privateUnavailable = isPrivateOrCorrupt(source)
  const label = corrupt
    ? "Corrupt activity unavailable"
    : privateUnavailable
      ? "Private reasoning unavailable"
      : rowLabel(source, runtime)
  const content = privateUnavailable ? null : rowContent(source)
  const timestamp = sourceTimestamp(source)
  const identity = privateUnavailable ? [] : providerIdentity(source)
  const terminal = TERMINAL_PHASES.has(source.phase)
  const expandable =
    Boolean(content) && (REASONING_KINDS.has(source.kind) || source.kind !== "agent-text")
  const provenance = isPersisted(source)
    ? `${runtime} · ${source.provider}`
    : "Flapstack Native · legacy message projection"
  return {
    key: runtimeActivityKey(source),
    runtime,
    kind: source.kind,
    phase: source.phase,
    label,
    content,
    sections: content ? [content] : [],
    provenance,
    timestamp,
    durationMs: null,
    status: source.phase,
    parentId: isPersisted(source) ? (source.providerParentItemId ?? null) : null,
    identity,
    searchText: [label, content, provenance, ...identity]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase(),
    copyable: Boolean(content) && !privateUnavailable && source.kind !== "opaque-metadata",
    expandable,
    defaultExpanded: REASONING_KINDS.has(source.kind) ? !terminal : !terminal && expandable,
    corrupt,
    privateUnavailable,
    source,
  }
}

function mergeIdentity(source: RuntimeActivitySource): string | null {
  if (!isPersisted(source)) return null
  const providerId =
    source.providerItemId ??
    source.providerMessageId ??
    source.providerToolId ??
    source.providerEventId
  if (!providerId) return null
  return [
    source.runId,
    source.runtime,
    source.kind,
    providerId,
    source.summaryIndex ?? "",
    source.contentIndex ?? "",
  ].join(":")
}

/** Collapse native delta/update events while preserving the first stable timeline position. */
export function projectRuntimeActivityRows(sources: RuntimeActivitySource[]): RuntimeActivityRow[] {
  const rows: RuntimeActivityRow[] = []
  const mergeTargets = new Map<string, number>()
  for (const source of [...sources].sort(compareRuntimeActivity)) {
    const row = formatRuntimeActivity(source)
    const mergeKey = mergeIdentity(source)
    const targetIndex = mergeKey ? mergeTargets.get(mergeKey) : undefined
    if (mergeKey && targetIndex !== undefined) {
      const target = rows[targetIndex]
      const nextContent = row.content ?? ""
      const boundary = isPersisted(source) ? source.sectionBoundary : null
      if (nextContent) {
        if (source.phase === "updated" || source.phase === "snapshot") {
          target.sections = [nextContent]
        } else if (boundary && target.sections.length > 0) {
          target.sections.push(nextContent)
        } else if (source.phase === "delta" && target.sections.length > 0) {
          target.sections[target.sections.length - 1] += nextContent
        } else {
          target.sections = [nextContent]
        }
        target.content = target.sections.join("\n\n")
        target.expandable = target.expandable || row.expandable
        target.copyable = target.copyable || row.copyable
      }
      target.phase = row.phase
      target.status = row.status
      if (row.phase === "failed") target.label = row.label
      target.defaultExpanded = row.defaultExpanded
      target.source = row.source
      if (row.timestamp != null) {
        if (target.timestamp != null && TERMINAL_PHASES.has(row.phase)) {
          target.durationMs = Math.max(0, row.timestamp - target.timestamp)
        }
      }
      target.searchText = [target.label, target.content, target.provenance, ...target.identity]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
      continue
    }
    if (mergeKey) mergeTargets.set(mergeKey, rows.length)
    rows.push(row)
  }
  return rows
}

export function filterRuntimeActivityRows(
  rows: RuntimeActivityRow[],
  filters: RuntimeActivityFilters,
): RuntimeActivityRow[] {
  const search = filters.search.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (filters.kind !== "all" && row.kind !== filters.kind) return false
    if (filters.runtime !== "all" && row.runtime !== filters.runtime) return false
    if (!filters.reasoningDisplay && REASONING_KINDS.has(row.kind)) return false
    if (!filters.subagentActivity && row.kind === "subagent") return false
    if (!filters.hookDiagnostics && row.kind === "hook") return false
    return !search || row.searchText.includes(search)
  })
}

export type RuntimeActivityExportFormat = "text" | "markdown" | "json"

export function serializeRuntimeActivity(
  rows: RuntimeActivityRow[],
  format: RuntimeActivityExportFormat,
): string {
  const safe = rows.filter((row) => row.copyable && row.content)
  if (format === "json") {
    return JSON.stringify(
      safe.map((row) => ({
        runtime: row.runtime,
        kind: row.kind,
        phase: row.phase,
        label: row.label,
        content: row.content,
        provenance: row.provenance,
        timestamp: row.timestamp,
        parentId: row.parentId,
        identity: row.identity,
      })),
      null,
      2,
    )
  }
  if (format === "markdown") {
    return safe
      .map((row) => `### ${row.label}\n\n${row.content}\n\n_${row.provenance} · ${row.status}_`)
      .join("\n\n")
  }
  return safe.map((row) => `${row.label}:\n${row.content}`).join("\n\n")
}

export type RuntimeActivityVirtualWindow = {
  start: number
  end: number
  topSpacer: number
  bottomSpacer: number
  rows: RuntimeActivityRow[]
}

export function virtualizeRuntimeActivity(
  rows: RuntimeActivityRow[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 96,
  overscan = 6,
): RuntimeActivityVirtualWindow {
  const safeRowHeight = Math.max(24, rowHeight)
  const safeViewport = Math.max(safeRowHeight, viewportHeight)
  const visibleStart = Math.floor(Math.max(0, scrollTop) / safeRowHeight)
  const start = Math.max(0, visibleStart - overscan)
  const visibleCount = Math.ceil(safeViewport / safeRowHeight)
  const end = Math.min(rows.length, visibleStart + visibleCount + overscan)
  return {
    start,
    end,
    topSpacer: start * safeRowHeight,
    bottomSpacer: Math.max(0, (rows.length - end) * safeRowHeight),
    rows: rows.slice(start, end),
  }
}

export function nextRuntimeActivityFocusIndex(
  current: number,
  key: string,
  count: number,
  pageSize = 10,
): number {
  if (count <= 0) return -1
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, current + 1)
    case "ArrowUp":
      return Math.max(0, current - 1)
    case "Home":
      return 0
    case "End":
      return count - 1
    case "PageDown":
      return Math.min(count - 1, current + pageSize)
    case "PageUp":
      return Math.max(0, current - pageSize)
    default:
      return Math.max(0, Math.min(count - 1, current))
  }
}

export function updateRuntimeLaunchControl<K extends keyof RuntimeLaunchControls>(
  controls: RuntimeLaunchControls,
  key: K,
  value: RuntimeLaunchControls[K],
): RuntimeLaunchControls {
  return { ...controls, [key]: value }
}

export function visibleRuntimeControlKeys(
  capabilities: RuntimeCapabilitySnapshot,
): Array<keyof RuntimeLaunchControls> {
  const keys: Array<keyof RuntimeLaunchControls> = []
  if (capabilities.controls.modelThinking.supported) keys.push("modelEffort", "modelThinking")
  if (capabilities.controls.reasoningDisplay.supported) keys.push("reasoningDisplay")
  if (capabilities.controls.subagentActivity.supported) keys.push("subagentActivity")
  if (capabilities.controls.hookDiagnostics.supported) keys.push("hookDiagnostics")
  return keys
}
