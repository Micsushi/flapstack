import type { HarnessPermissionApplication } from "../../../../shared/harness-types"
import type { NormalizedSidecarEvent } from "./contract"

const MAX_STRING_LENGTH = 4_000
const MAX_ARRAY_ITEMS = 50
const MAX_OBJECT_KEYS = 50
const MAX_DEPTH = 4
const REDACTED = "[redacted]"

export type PersistedOpencodeToolActivity = {
  id: string
  name: string
  state: "input-streaming" | "input-available" | "output-available" | "output-error"
  input?: unknown
  output?: unknown
  errorText?: string
}

export type PersistedOpencodeApprovalActivity = {
  requestId: string
  toolCallId: string
  permission: string
  patterns: string[]
  command?: string
  state: "pending" | "resolved" | "no-longer-pending"
  decision?: "once" | "always" | "reject"
  decisionSource?: "policy" | "user" | "fallback"
  message?: string
}

export type PersistedOpencodeRunAudit = {
  engine: "opencode"
  permissionApplication?: HarnessPermissionApplication
  limitations: HarnessPermissionApplication["limitations"]
  toolActivity: PersistedOpencodeToolActivity[]
  approvalActivity: PersistedOpencodeApprovalActivity[]
}

/** Merge snapshots without erasing messages or metadata written while a run
 * was active. Incoming ids replace matching rows; new ids append in order. */
export function mergeMessagesById(current: any[], incoming: any[]): any[] {
  const merged = [...current]
  const indexes = new Map<string, number>()
  merged.forEach((message, index) => {
    if (typeof message?.id === "string") indexes.set(message.id, index)
  })
  for (const message of incoming) {
    const id = typeof message?.id === "string" ? message.id : null
    const index = id ? indexes.get(id) : undefined
    if (index === undefined) {
      if (id) indexes.set(id, merged.length)
      merged.push(message)
    } else {
      merged[index] = message
    }
  }
  return merged
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}… [truncated]`
}

function redactKnownSecrets(value: string, secrets: readonly string[]): string {
  let sanitized = value
  for (const secret of secrets) {
    if (secret.length >= 6) sanitized = sanitized.split(secret).join(REDACTED)
  }
  return sanitized
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase()
  return [
    "apikey",
    "authorization",
    "cookie",
    "credential",
    "password",
    "privatekey",
    "secret",
    "token",
  ].some((suffix) => normalized === suffix || normalized.endsWith(suffix))
}

/** Redact common inline credential forms before a command enters durable history. */
export function sanitizeOpencodeCommand(command: string, secrets: readonly string[] = []): string {
  return truncate(
    redactKnownSecrets(command, secrets)
      .replace(
        /(\b(?:[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)|api[-_]?key|token|secret|password)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
        `$1${REDACTED}`,
      )
      .replace(
        /(--(?:api[-_]?key|token|secret|password)\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
        `$1${REDACTED}`,
      )
      .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s'"]+/gi, `$1${REDACTED}`),
  )
}

/**
 * Bound and redact provider/tool payloads before writing them into message metadata.
 * Cycles, deep objects, huge arrays, and secret-shaped keys cannot escape this seam.
 */
export function sanitizeOpencodeAuditValue(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  const seen = new WeakSet<object>()

  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key && isSensitiveKey(key)) return REDACTED
    if (current == null || typeof current === "boolean" || typeof current === "number") {
      return current
    }
    if (typeof current === "string") return sanitizeOpencodeCommand(current, secrets)
    if (typeof current === "bigint") return current.toString()
    if (typeof current !== "object") return String(current)
    if (depth >= MAX_DEPTH) return "[depth-limited]"
    if (seen.has(current)) return "[circular]"
    seen.add(current)

    if (Array.isArray(current)) {
      const sanitized = current.slice(0, MAX_ARRAY_ITEMS).map((item) => visit(item, depth + 1))
      if (current.length > MAX_ARRAY_ITEMS) sanitized.push("[items-truncated]")
      return sanitized
    }

    const entries = Object.entries(current as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)
    const sanitized: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of entries) {
      sanitized[entryKey] = visit(entryValue, depth + 1, entryKey)
    }
    if (Object.keys(current).length > MAX_OBJECT_KEYS) sanitized.__truncated__ = true
    return sanitized
  }

  return visit(value, 0)
}

function sanitizeLabel(value: string): string {
  return truncate(value)
}

export class OpencodeRunAuditAccumulator {
  private readonly tools = new Map<string, PersistedOpencodeToolActivity>()
  private readonly approvals = new Map<string, PersistedOpencodeApprovalActivity>()
  private permissionApplication?: HarnessPermissionApplication

  constructor(private readonly secrets: readonly string[] = []) {}

  apply(event: NormalizedSidecarEvent): void {
    switch (event.kind) {
      case "permission-application":
        this.permissionApplication = event.application
        return
      case "tool-input-start": {
        const existing = this.tools.get(event.toolCallId)
        this.tools.set(event.toolCallId, {
          ...(existing ?? {}),
          id: event.toolCallId,
          name: sanitizeLabel(event.toolName),
          state: existing?.state ?? "input-streaming",
        })
        return
      }
      case "tool-input-delta": {
        const existing = this.tools.get(event.toolCallId)
        const previous = typeof existing?.input === "string" ? existing.input : ""
        this.tools.set(event.toolCallId, {
          ...(existing ?? {}),
          id: event.toolCallId,
          name: existing?.name ?? "tool",
          state: "input-streaming",
          input: sanitizeOpencodeCommand(previous + event.delta, this.secrets),
        })
        return
      }
      case "tool-input-available": {
        const existing = this.tools.get(event.toolCallId)
        this.tools.set(event.toolCallId, {
          ...(existing ?? {}),
          id: event.toolCallId,
          name: sanitizeLabel(event.toolName),
          state: "input-available",
          input: sanitizeOpencodeAuditValue(event.input, this.secrets),
        })
        return
      }
      case "tool-output": {
        const existing = this.tools.get(event.toolCallId)
        this.tools.set(event.toolCallId, {
          ...(existing ?? {}),
          id: event.toolCallId,
          name: existing?.name ?? "tool",
          state: "output-available",
          output: sanitizeOpencodeAuditValue(event.output, this.secrets),
        })
        return
      }
      case "tool-error": {
        const existing = this.tools.get(event.toolCallId)
        this.tools.set(event.toolCallId, {
          ...(existing ?? {}),
          id: event.toolCallId,
          name: existing?.name ?? "tool",
          state: "output-error",
          errorText: sanitizeOpencodeCommand(event.errorText, this.secrets),
        })
        return
      }
      case "permission-asked": {
        const existing = this.approvals.get(event.requestId)
        this.approvals.set(event.requestId, {
          ...(existing ?? {}),
          requestId: event.requestId,
          toolCallId: event.toolCallId,
          permission: sanitizeLabel(event.permission),
          patterns: event.patterns
            .slice(0, MAX_ARRAY_ITEMS)
            .map((pattern) => sanitizeOpencodeCommand(pattern, this.secrets)),
          ...(event.command
            ? { command: sanitizeOpencodeCommand(event.command, this.secrets) }
            : {}),
          state: existing?.state ?? "pending",
        })
        return
      }
      case "permission-decision": {
        const existing = this.approvals.get(event.requestId)
        this.approvals.set(event.requestId, {
          ...(existing ?? {}),
          requestId: event.requestId,
          toolCallId: event.toolCallId,
          permission: sanitizeLabel(event.permission),
          patterns: event.patterns
            .slice(0, MAX_ARRAY_ITEMS)
            .map((pattern) => sanitizeOpencodeCommand(pattern, this.secrets)),
          state: event.replyStatus === "applied" ? "resolved" : "no-longer-pending",
          decision: event.reply,
          decisionSource: event.source,
          ...(event.message
            ? { message: sanitizeOpencodeCommand(event.message, this.secrets) }
            : {}),
        })
        return
      }
      default:
        return
    }
  }

  snapshot(): PersistedOpencodeRunAudit {
    return {
      engine: "opencode",
      ...(this.permissionApplication ? { permissionApplication: this.permissionApplication } : {}),
      limitations: this.permissionApplication?.limitations ?? [],
      toolActivity: Array.from(this.tools.values()),
      approvalActivity: Array.from(this.approvals.values()),
    }
  }

  toMessageParts(): Array<Record<string, unknown>> {
    return Array.from(this.tools.values()).map((tool) => ({
      type: `tool-${tool.name}`,
      toolCallId: tool.id,
      toolName: tool.name,
      state: tool.state,
      ...(tool.input !== undefined ? { input: tool.input } : {}),
      ...(tool.output !== undefined ? { output: tool.output } : {}),
      ...(tool.errorText ? { errorText: tool.errorText } : {}),
    }))
  }

  hasActivity(): boolean {
    return this.tools.size > 0 || this.approvals.size > 0 || Boolean(this.permissionApplication)
  }
}

type FinalizationStage = "after-checkpoint" | "run-status" | "subchat-status" | "manifest" | "usage"

/**
 * Keep required status writes independent from optional checkpoint, manifest,
 * and usage enrichment. One failing stage never skips the remaining stages.
 */
export async function finalizeOpencodeRunPersistence(input: {
  captureAfter: () => Promise<string | undefined>
  updateRunStatus: (afterCheckpointId?: string) => void | Promise<void>
  updateSubChatStatus: () => void | Promise<void>
  captureManifest: () => void | Promise<unknown>
  captureUsage?: () => unknown | Promise<unknown>
  onError?: (stage: FinalizationStage, error: unknown) => void
}): Promise<void> {
  let afterCheckpointId: string | undefined
  try {
    afterCheckpointId = await input.captureAfter()
  } catch (error) {
    input.onError?.("after-checkpoint", error)
  }

  try {
    await input.updateRunStatus(afterCheckpointId)
  } catch (error) {
    input.onError?.("run-status", error)
  }
  try {
    await input.updateSubChatStatus()
  } catch (error) {
    input.onError?.("subchat-status", error)
  }
  try {
    await input.captureManifest()
  } catch (error) {
    input.onError?.("manifest", error)
  }
  if (input.captureUsage) {
    try {
      await input.captureUsage()
    } catch (error) {
      input.onError?.("usage", error)
    }
  }
}
