import type {
  AgentActivityAppend,
  AgentActivityAppendBase,
  AgentActivityPhase,
} from "../../../../shared/agent-activity"
import {
  MAX_AGENT_ACTIVITY_METADATA_DEPTH,
  MAX_AGENT_ACTIVITY_METADATA_ENTRIES,
  MAX_AGENT_ACTIVITY_METADATA_STRING,
  MAX_AGENT_ACTIVITY_PAYLOAD_BYTES,
  type BoundedActivityMetadata,
} from "../../../../shared/agent-activity"
import type { CodexProtocolNotification } from "./protocol-client"
import {
  eventArray as array,
  eventFiniteNumber as finite,
  eventRecord as record,
  eventString as string,
} from "../event-values"

const PROVIDER = "codex-app-server"
const MAX_DISPLAY_TEXT = 24_000
const MAX_PLAN_ITEMS = 20
const MAX_PLAN_ITEM_TEXT = 1_024

type ActivityIdentity = Omit<AgentActivityAppendBase, "phase" | "displayClass" | "privacyClass">

const PINNED_METADATA_NOTIFICATIONS = new Set([
  "skills/changed",
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/settings/updated",
  "turn/diff/updated",
  "rawResponseItem/completed",
  "command/exec/outputDelta",
  "process/outputDelta",
  "process/exited",
  "item/commandExecution/terminalInteraction",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "account/rateLimits/updated",
  "app/list/updated",
  "remoteControl/status/changed",
  "externalAgentConfig/import/progress",
  "externalAgentConfig/import/completed",
  "fs/changed",
  "model/verification",
  "turn/moderationMetadata",
  "model/safetyBuffering/updated",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
  "account/login/completed",
])

export class CodexProtocolDriftError extends Error {
  constructor(readonly method: string) {
    super(`[codex-runtime] Unknown execution-critical App Server notification: ${method}`)
    this.name = "CodexProtocolDriftError"
  }
}

export function mapCodexNotification(
  notification: CodexProtocolNotification,
): AgentActivityAppend[] {
  const params = notification.params
  const base = identityBase(notification)
  switch (notification.method) {
    case "thread/started":
      return [lifecycle(base, "started", "thread-started", null)]
    case "thread/archived":
      return [lifecycle(base, "completed", "thread-archived", null)]
    case "thread/unarchived":
      return [lifecycle(base, "completed", "thread-unarchived", null)]
    case "thread/closed":
      return [lifecycle(base, "completed", "thread-closed", null)]
    case "thread/deleted":
      return [lifecycle(base, "completed", "thread-deleted", null)]
    case "thread/status/changed":
      return [
        {
          ...base,
          kind: "status",
          phase: "updated",
          displayClass: "status",
          privacyClass: "public",
          payload: { message: boundedText(statusLabel(params.status)), code: "thread-status" },
        },
      ]
    case "turn/started":
      return [lifecycle(base, "started", "turn-started", null)]
    case "turn/completed": {
      const turn = record(params.turn)
      const status = string(turn.status) ?? "completed"
      const phase: AgentActivityPhase =
        status === "failed" ? "failed" : status === "interrupted" ? "cancelled" : "completed"
      return [lifecycle(base, phase, `turn-${status}`, safeErrorDetail(turn.error))]
    }
    case "item/started":
      return mapItem(record(params.item), "started", base)
    case "item/completed":
      return mapItem(record(params.item), "completed", base)
    case "item/agentMessage/delta":
      return [
        {
          ...base,
          kind: "agent-text",
          phase: "delta",
          displayClass: "provider-visible",
          privacyClass: "public",
          payload: { text: boundedText(string(params.delta) ?? "") },
        },
      ]
    case "item/plan/delta":
      return [
        {
          ...base,
          kind: "plan",
          phase: "delta",
          displayClass: "provider-visible",
          privacyClass: "public",
          payload: { text: boundedText(string(params.delta) ?? "") },
        },
      ]
    case "turn/plan/updated":
      return [
        {
          ...base,
          kind: "plan",
          phase: "updated",
          displayClass: "provider-visible",
          privacyClass: "public",
          payload: {
            text: boundedNullable(string(params.explanation)),
            items: array(params.plan)
              .slice(0, MAX_PLAN_ITEMS)
              .map((step) => {
                const value = record(step)
                return {
                  id: boundedNullable(string(value.id)),
                  text: (string(value.step) ?? string(value.text) ?? "").slice(
                    0,
                    MAX_PLAN_ITEM_TEXT,
                  ),
                  status: boundedNullable(string(value.status)),
                }
              }),
          },
        },
      ]
    case "item/reasoning/summaryTextDelta":
      return [
        {
          ...base,
          kind: "reasoning-summary",
          phase: "delta",
          displayClass: "summary",
          privacyClass: "public",
          payload: { text: boundedText(string(params.delta) ?? ""), label: "Reasoning summary" },
        },
      ]
    case "item/reasoning/summaryPartAdded":
      return [
        {
          ...base,
          kind: "reasoning-summary",
          phase: "updated",
          displayClass: "summary",
          privacyClass: "public",
          sectionBoundary: "summary-part-added",
          payload: { text: "", label: "Reasoning summary" },
        },
      ]
    case "item/reasoning/textDelta":
      return reasoningTextDelta(params, base)
    case "item/commandExecution/outputDelta":
      return [
        {
          ...base,
          kind: "command",
          phase: "delta",
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: { state: "running", outputSummary: boundedNullable(string(params.delta)) },
        },
      ]
    case "item/fileChange/outputDelta":
      return [patch(base, "delta", "running", null, string(params.delta))]
    case "item/fileChange/patchUpdated":
      return [
        patch(
          base,
          "updated",
          "running",
          firstChangePath(params.changes),
          summarizeChanges(params.changes),
          params.changes,
        ),
      ]
    case "turn/diff/updated":
      return [
        patch(
          base,
          "updated",
          "running",
          null,
          string(params.diff),
          undefined,
          string(params.diff),
        ),
      ]
    case "command/exec/outputDelta":
    case "process/outputDelta":
    case "item/commandExecution/terminalInteraction":
      return [
        {
          ...base,
          kind: "command",
          phase: "delta",
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: {
            state: "running",
            outputSummary: boundedNullable(
              string(params.delta) ?? string(params.input) ?? string(params.text),
            ),
          },
        },
      ]
    case "process/exited":
      return [
        {
          ...base,
          kind: "command",
          phase: "completed",
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: {
            state: "completed",
            exitCode: integerOrNull(params.exitCode),
          },
        },
      ]
    case "item/mcpToolCall/progress":
      return [
        {
          ...base,
          kind: "tool",
          phase: "updated",
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: {
            name: boundedShort(string(params.tool) ?? "MCP tool"),
            state: boundedShort(string(params.status) ?? "running"),
            outputSummary: boundedNullable(string(params.message)),
          },
        },
      ]
    case "thread/tokenUsage/updated":
      return [usage(base, params.tokenUsage)]
    case "thread/compacted":
      return [
        {
          ...base,
          kind: "compaction",
          phase: "completed",
          displayClass: "status",
          privacyClass: "public",
          payload: { state: "completed" },
        },
      ]
    case "warning":
    case "guardianWarning":
    case "deprecationNotice":
    case "configWarning":
      return [warning(base, params)]
    case "model/rerouted":
      return [
        {
          ...base,
          kind: "warning",
          phase: "updated",
          displayClass: "status",
          privacyClass: "public",
          payload: {
            message: boundedText(
              `Model rerouted from ${string(params.fromModel) ?? "unknown"} to ${string(params.toModel) ?? "unknown"}: ${string(params.reason) ?? "provider decision"}`,
            ),
            code: "model-rerouted",
          },
        },
      ]
    case "error": {
      const retry = params.willRetry === true
      return retry
        ? [warning(base, record(params.error), "provider-retry")]
        : [lifecycle(base, "failed", "turn-error", safeErrorDetail(params.error))]
    }
    case "hook/started":
    case "hook/completed":
      return [
        {
          ...base,
          kind: "hook",
          phase: notification.method.endsWith("started") ? "started" : "completed",
          displayClass: "metadata",
          privacyClass: "sensitive",
          payload: {
            name: boundedShort(string(params.hookName) ?? string(params.name) ?? "Codex hook"),
            state: notification.method.endsWith("started") ? "started" : "completed",
            summary: boundedNullable(string(params.message)),
          },
        },
      ]
    case "serverRequest/resolved":
      return [
        {
          ...base,
          kind: "permission",
          phase: "completed",
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: {
            requestType: boundedShort(string(params.method) ?? "server-request"),
            state: "resolved",
          },
        },
      ]
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
      return [
        {
          ...base,
          kind: "permission",
          phase: notification.method.endsWith("started") ? "started" : "completed",
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: {
            requestType: "auto-approval-review",
            state: notification.method.endsWith("started") ? "started" : "completed",
            decision: boundedNullable(string(params.decision) ?? string(params.status)),
          },
        },
      ]
    case "thread/name/updated":
    case "thread/goal/updated":
    case "thread/goal/cleared":
    case "mcpServer/startupStatus/updated":
    case "model/verification":
    case "model/safetyBuffering/updated":
      return [
        {
          ...base,
          kind: "status",
          phase: "updated",
          displayClass: "status",
          privacyClass: "sensitive",
          payload: { message: boundedText(statusMessage(notification.method, params)) },
        },
      ]
    case "windows/worldWritableWarning":
      return [warning(base, params, "windows-world-writable")]
    default:
      if (PINNED_METADATA_NOTIFICATIONS.has(notification.method)) {
        return [opaque(base, notification.method, params)]
      }
      if (isCriticalUnknown(notification.method))
        throw new CodexProtocolDriftError(notification.method)
      return [opaque(base, notification.method, params)]
  }
}

export function permissionActivity(
  method: string,
  params: Record<string, unknown>,
  phase: "started" | "completed" | "failed",
  decision?: string,
): AgentActivityAppend {
  const base = identityBase({ method, params })
  return {
    ...base,
    kind: "permission",
    phase,
    displayClass: "tool",
    privacyClass: "sensitive",
    payload: {
      requestType: boundedShort(method),
      state: phase,
      decision: boundedNullable(decision),
    },
  }
}

function mapItem(
  item: Record<string, unknown>,
  phase: "started" | "completed",
  base: ActivityIdentity,
): AgentActivityAppend[] {
  const type = string(item.type) ?? "unknown"
  const state = phase === "started" ? "running" : (string(item.status) ?? "completed")
  switch (type) {
    case "agentMessage":
      return [
        {
          ...base,
          kind: "agent-text",
          phase,
          displayClass: "provider-visible",
          privacyClass: "public",
          sectionBoundary: boundedNullable(string(item.phase)),
          payload: { text: boundedText(string(item.text) ?? "") },
        },
      ]
    case "plan":
      return [
        {
          ...base,
          kind: "plan",
          phase,
          displayClass: "provider-visible",
          privacyClass: "public",
          payload: { text: boundedNullable(string(item.text)) },
        },
      ]
    case "reasoning": {
      const summaries = array(item.summary)
        .map(string)
        .filter((value): value is string => value !== null)
      const events: AgentActivityAppend[] = summaries.map((text, summaryIndex) => ({
        ...base,
        kind: "reasoning-summary",
        phase,
        displayClass: "summary",
        privacyClass: "public",
        summaryIndex,
        payload: { text: boundedText(text), label: "Reasoning summary" },
      }))
      const privateParts = array(item.content)
      events.push({
        ...base,
        kind: "private-metadata",
        phase: "snapshot",
        displayClass: "private",
        privacyClass: "private",
        payload: {
          eventType: "reasoning-private-content",
          metadata: { present: privateParts.length > 0, partCount: privateParts.length },
        },
      })
      return events
    }
    case "commandExecution":
      return [
        {
          ...base,
          kind: "command",
          phase,
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: {
            command: boundedNullable(string(item.command)),
            state: boundedShort(state),
            exitCode: integerOrNull(item.exitCode),
            outputSummary: boundedNullable(string(item.aggregatedOutput)),
          },
        },
      ]
    case "fileChange":
      return [
        patch(
          base,
          phase,
          state,
          firstChangePath(item.changes),
          summarizeChanges(item.changes),
          item.changes,
        ),
      ]
    case "mcpToolCall":
    case "dynamicToolCall": {
      const toolInput = item.arguments ?? item.input
      const toolOutput = item.result ?? item.error
      return [
        {
          ...base,
          kind: "tool",
          phase,
          displayClass: "tool",
          privacyClass: "sensitive",
          providerToolId: string(item.id),
          payload: {
            name: boundedShort(
              type === "mcpToolCall"
                ? `${string(item.server) ?? "MCP"}/${string(item.tool) ?? "tool"}`
                : (string(item.tool) ?? "dynamic-tool"),
            ),
            state: boundedShort(state),
            ...(toolInput === undefined ? {} : { input: fitMetadata(toolInput) }),
            ...(toolOutput === undefined ? {} : { output: fitMetadata(toolOutput) }),
            outputSummary: boundedNullable(toolResultSummary(item)),
          },
        },
      ]
    }
    case "collabAgentToolCall":
    case "subAgentActivity":
      return [
        {
          ...base,
          kind: "subagent",
          phase,
          displayClass: "status",
          privacyClass: "sensitive",
          payload: {
            agentId: boundedNullable(
              string(item.agentThreadId) ??
                array(item.receiverThreadIds).map(string).find(Boolean) ??
                null,
            ),
            state: boundedShort(string(item.status) ?? string(item.kind) ?? state),
            message: boundedNullable(string(item.tool)),
          },
        },
      ]
    case "contextCompaction":
      return [
        {
          ...base,
          kind: "compaction",
          phase,
          displayClass: "status",
          privacyClass: "public",
          payload: { state },
        },
      ]
    case "hookPrompt":
      return [
        {
          ...base,
          kind: "hook",
          phase,
          displayClass: "metadata",
          privacyClass: "sensitive",
          payload: { name: "Codex hook prompt", state },
        },
      ]
    case "webSearch":
    case "imageView":
    case "imageGeneration":
    case "sleep":
    case "enteredReviewMode":
    case "exitedReviewMode":
      return [
        {
          ...base,
          kind: "tool",
          phase,
          displayClass: "tool",
          privacyClass: "sensitive",
          payload: { name: boundedShort(type), state: boundedShort(state) },
        },
      ]
    case "userMessage":
      return [opaque(base, "user-message-lifecycle", { itemId: item.id, phase })]
    default:
      throw new CodexProtocolDriftError(`item/${type}`)
  }
}

function reasoningTextDelta(
  params: Record<string, unknown>,
  base: ActivityIdentity,
): AgentActivityAppend[] {
  const displayable =
    params.displayable === true ||
    params.visibility === "provider-visible" ||
    params.contentVisibility === "provider-visible"
  const delta = string(params.delta) ?? ""
  if (!displayable) {
    return [
      {
        ...base,
        kind: "private-metadata",
        phase: "delta",
        displayClass: "private",
        privacyClass: "private",
        payload: {
          eventType: "reasoning-private-delta",
          metadata: { present: delta.length > 0, byteLength: Buffer.byteLength(delta, "utf8") },
        },
      },
    ]
  }
  return [
    {
      ...base,
      kind: "provider-visible-reasoning",
      phase: "delta",
      displayClass: "provider-visible",
      privacyClass: "public",
      payload: { text: boundedText(delta), label: "Reasoning" },
    },
  ]
}

function identityBase(notification: CodexProtocolNotification): ActivityIdentity {
  const params = notification.params
  const item = record(params.item)
  const turn = record(params.turn)
  const thread = record(params.thread)
  return {
    provider: PROVIDER,
    providerTimestamp:
      finite(notification.emittedAtMs) ??
      finite(params.startedAtMs) ??
      finite(params.completedAtMs),
    providerEventId: string(params.eventId),
    providerSessionId: string(params.sessionId) ?? string(thread.sessionId),
    providerThreadId: string(params.threadId) ?? string(thread.id),
    providerTurnId: string(params.turnId) ?? string(turn.id),
    providerItemId: string(params.itemId) ?? string(item.id),
    providerParentItemId: string(params.parentItemId),
    providerMessageId: string(params.messageId),
    providerToolId: string(params.toolId),
    summaryIndex: nonNegativeInteger(params.summaryIndex),
    contentIndex: nonNegativeInteger(params.contentIndex),
    partIndex: nonNegativeInteger(params.partIndex),
  }
}

function lifecycle(
  base: ActivityIdentity,
  phase: AgentActivityPhase,
  state: string,
  detail: string | null,
): AgentActivityAppend {
  return {
    ...base,
    kind: "lifecycle",
    phase,
    displayClass: "status",
    privacyClass: "public",
    payload: { state: boundedShort(state), detail: boundedNullable(detail) },
  }
}

function patch(
  base: ActivityIdentity,
  phase: AgentActivityPhase,
  state: string,
  path: string | null,
  summary: string | null,
  rawChanges?: unknown,
  diff?: string | null,
): AgentActivityAppend {
  return {
    ...base,
    kind: "patch",
    phase,
    displayClass: "tool",
    privacyClass: "sensitive",
    payload: {
      state: boundedShort(state),
      path: boundedNullable(path),
      summary: boundedNullable(summary),
      diff: boundedNullable(diff),
      ...(rawChanges === undefined ? {} : { changes: normalizeChanges(rawChanges) }),
    },
  }
}

function normalizeChanges(value: unknown) {
  return array(value)
    .slice(0, 500)
    .map((change) => {
      const item = record(change)
      return {
        path: boundedText(string(item.path) ?? "unknown"),
        kind: boundedNullable(string(item.kind) ?? string(item.type)),
        diff: boundedNullable(string(item.diff) ?? string(item.patch) ?? string(item.unified_diff)),
      }
    })
}

function usage(base: ActivityIdentity, value: unknown): AgentActivityAppend {
  const usage = record(record(value).last)
  return {
    ...base,
    kind: "usage",
    phase: "snapshot",
    displayClass: "metadata",
    privacyClass: "sensitive",
    payload: {
      inputTokens: finiteOrNull(usage.inputTokens),
      outputTokens: finiteOrNull(usage.outputTokens),
      cachedTokens: finiteOrNull(usage.cachedInputTokens),
      reasoningTokens: finiteOrNull(usage.reasoningOutputTokens),
    },
  }
}

function warning(
  base: ActivityIdentity,
  params: Record<string, unknown>,
  code = "codex-warning",
): AgentActivityAppend {
  return {
    ...base,
    kind: "warning",
    phase: "updated",
    displayClass: "status",
    privacyClass: "public",
    payload: {
      message: boundedText(
        string(params.message) ??
          string(params.summary) ??
          safeErrorDetail(params) ??
          "Codex warning",
      ),
      code,
    },
  }
}

function opaque(base: ActivityIdentity, eventType: string, metadata: unknown): AgentActivityAppend {
  return {
    ...base,
    kind: "opaque-metadata",
    phase: "snapshot",
    displayClass: "metadata",
    privacyClass: "sensitive",
    payload: { eventType: boundedShort(eventType), metadata: fitMetadata(metadata) },
  }
}

function boundMetadata(value: unknown, depth = 0): BoundedActivityMetadata {
  if (depth > MAX_AGENT_ACTIVITY_METADATA_DEPTH) return "[truncated-depth]"
  if (value === null || value === undefined) return null
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") return value.slice(0, MAX_AGENT_ACTIVITY_METADATA_STRING)
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AGENT_ACTIVITY_METADATA_ENTRIES)
      .map((entry) => boundMetadata(entry, depth + 1))
  }
  if (typeof value === "object") {
    const result: Record<string, BoundedActivityMetadata> = {}
    for (const [key, entry] of Object.entries(value).slice(
      0,
      MAX_AGENT_ACTIVITY_METADATA_ENTRIES,
    )) {
      result[key.slice(0, 256)] = secretKey(key) ? "[redacted]" : boundMetadata(entry, depth + 1)
    }
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_AGENT_ACTIVITY_PAYLOAD_BYTES / 2) {
      return "[truncated-size]"
    }
    return result
  }
  return String(value).slice(0, MAX_AGENT_ACTIVITY_METADATA_STRING)
}

function fitMetadata(value: unknown): BoundedActivityMetadata {
  const bounded = boundMetadata(value)
  return Buffer.byteLength(JSON.stringify(bounded), "utf8") <= MAX_AGENT_ACTIVITY_PAYLOAD_BYTES / 2
    ? bounded
    : "[truncated-size]"
}

function secretKey(key: string): boolean {
  return /(?:secret|token|password|credential|api[_-]?key|private[_-]?key|authorization)/i.test(key)
}

function isCriticalUnknown(method: string): boolean {
  return (
    method.startsWith("turn/") ||
    method.startsWith("item/") ||
    method.includes("requestApproval") ||
    method.includes("permission") ||
    method === "thread/compacted" ||
    method === "thread/status/changed"
  )
}

function statusLabel(value: unknown): string {
  const status = record(value)
  const type = string(status.type)
  return type ? `Thread ${type}` : "Thread status updated"
}

function statusMessage(method: string, params: Record<string, unknown>): string {
  return (
    string(params.message) ??
    string(params.threadName) ??
    string(params.status) ??
    `${method} updated`
  )
}

function firstChangePath(value: unknown): string | null {
  const first = record(array(value)[0])
  return string(first.path) ?? null
}

function summarizeChanges(value: unknown): string | null {
  const changes = array(value)
  if (changes.length === 0) return null
  return boundedText(
    changes
      .slice(0, 100)
      .map((change) => {
        const item = record(change)
        return `${string(item.kind) ?? string(item.type) ?? "change"}: ${string(item.path) ?? "unknown"}`
      })
      .join("\n"),
  )
}

function toolResultSummary(item: Record<string, unknown>): string | null {
  const error = record(item.error)
  if (string(error.message)) return string(error.message)
  const result = record(item.result)
  return string(result.summary) ?? null
}

function safeErrorDetail(value: unknown): string | null {
  const error = record(value)
  return boundedNullable(
    string(error.message) ?? string(error.code) ?? string(error.type) ?? string(value),
  )
}

function finiteOrNull(value: unknown): number | null {
  const result = finite(value)
  return result !== null && result >= 0 ? result : null
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

function boundedText(value: string): string {
  return value.slice(0, MAX_DISPLAY_TEXT)
}

function boundedNullable(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : boundedText(value)
}

function boundedShort(value: string): string {
  return value.trim().slice(0, 512) || "unknown"
}
