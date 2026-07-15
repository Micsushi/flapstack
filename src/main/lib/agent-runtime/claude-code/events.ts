import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { Buffer } from "node:buffer"
import type {
  AgentActivityAppend,
  AgentActivityAppendBase,
  AgentActivityPhase,
} from "../../../../shared/agent-activity"
import { MAX_AGENT_ACTIVITY_PAYLOAD_BYTES } from "../../../../shared/agent-activity"
import type { RuntimeLaunchControls } from "../../../../shared/agent-runtime"

type JsonRecord = Record<string, unknown>
type BlockState = { type: string; id: string | null; name: string | null }

const MAX_ACTIVITY_TEXT_BYTES = MAX_AGENT_ACTIVITY_PAYLOAD_BYTES - 1_024
const MAX_SHORT_TEXT_BYTES = 512
const MAX_PROVIDER_ID_BYTES = 2_048
const MAX_INIT_LIST = 100
const MAX_INIT_VALUE_BYTES = 256
const MAX_PROVIDER_BLOCKS = 900

const CRITICAL_UNKNOWN =
  /(permission|session|control|interrupt|execution|tool[_-]?use|result|init)/i
const KNOWN_METADATA_TYPES = new Set([
  "auth_status",
  "control_request_progress",
  "files_persisted",
  "local_command_output",
  "memory_recall",
  "notification",
  "plugin_install",
  "prompt_suggestion",
  "rate_limit_event",
  "tool_use_summary",
])

export class ClaudeRuntimeProtocolError extends Error {
  readonly code = "claude-runtime-critical-unknown"

  constructor(readonly eventType: string) {
    super(`Unsupported execution-critical Claude SDK event: ${eventType}`)
    this.name = "ClaudeRuntimeProtocolError"
  }
}

export class ClaudeRuntimeEventMapper {
  private readonly blocks = new Map<number, BlockState>()

  constructor(private readonly controls: RuntimeLaunchControls) {}

  map(message: SDKMessage): AgentActivityAppend[] {
    const value = message as unknown as JsonRecord
    const type = string(value.type)
    if (!type) throw new ClaudeRuntimeProtocolError("missing-type")

    if (type === "stream_event") return this.mapStream(value)
    if (type === "assistant") return this.mapAssistant(value)
    if (type === "user") return this.mapUser(value)
    if (type === "result") return this.mapResult(value)
    if (type === "system") return this.mapSystem(value)
    if (type === "tool_progress") return this.mapToolProgress(value)
    if (type === "tool_use_summary") return this.mapToolSummary(value)
    if (type === "auth_status") return this.mapAuthStatus(value)

    if (KNOWN_METADATA_TYPES.has(type)) return [this.opaque(value, type)]
    throw new ClaudeRuntimeProtocolError(type)
  }

  private mapStream(message: JsonRecord): AgentActivityAppend[] {
    if (this.isSuppressedChild(message)) return []
    const event = record(message.event)
    const type = string(event.type)
    const index = integer(event.index)
    const base = this.base(message, type || "stream-event", {
      contentIndex: index,
      providerItemId: messageItemId(event),
    })

    if (type === "message_start") {
      this.blocks.clear()
      return [
        activity(base, "lifecycle", "started", "status", "public", {
          state: "message-started",
          detail: null,
        }),
      ]
    }

    if (type === "content_block_start" && index !== null) {
      const block = record(event.content_block)
      const blockType = string(block.type) || "unknown"
      const id = string(block.id)
      const name = string(block.name)
      this.blocks.set(index, { type: blockType, id, name })
      return this.mapBlockStart(base, blockType, id, name)
    }

    if (type === "content_block_delta" && index !== null) {
      const delta = record(event.delta)
      const deltaType = string(delta.type) || "unknown"
      return this.mapBlockDelta(base, this.blocks.get(index), deltaType, delta)
    }

    if (type === "content_block_stop" && index !== null) {
      const block = this.blocks.get(index)
      this.blocks.delete(index)
      return this.mapBlockStop(base, block)
    }

    if (type === "message_delta") {
      const delta = record(event.delta)
      const stopReason = string(delta.stop_reason)
      return [
        activity(base, "lifecycle", "updated", "status", "public", {
          state: "message-delta",
          detail: stopReason ? `stop_reason=${stopReason}` : null,
        }),
      ]
    }

    if (type === "message_stop") {
      return [
        activity(base, "lifecycle", "completed", "status", "public", {
          state: "message-stopped",
          detail: null,
        }),
      ]
    }

    if (CRITICAL_UNKNOWN.test(type || "")) throw new ClaudeRuntimeProtocolError(type || "stream")
    return [this.opaque(message, `stream_event:${type || "unknown"}`, base)]
  }

  private mapBlockStart(
    base: AgentActivityAppendBase,
    blockType: string,
    id: string | null,
    name: string | null,
  ): AgentActivityAppend[] {
    if (blockType === "thinking") return this.reasoning(base, "started", "", id)
    if (blockType === "redacted_thinking") return [this.privateMarker(base, "redacted-thinking")]
    if (blockType === "text") {
      return [activity(base, "agent-text", "started", "provider-visible", "public", { text: "" })]
    }
    if (blockType === "tool_use" || blockType === "server_tool_use") {
      const toolBase = { ...base, providerToolId: id }
      return [
        activity(toolBase, "tool", "started", "tool", "sensitive", {
          name: name || "unknown",
          state: "started",
        }),
      ]
    }
    if (CRITICAL_UNKNOWN.test(blockType)) throw new ClaudeRuntimeProtocolError(blockType)
    return [this.opaque({}, `content_block:${blockType}`, base)]
  }

  private mapBlockDelta(
    base: AgentActivityAppendBase,
    block: BlockState | undefined,
    deltaType: string,
    delta: JsonRecord,
  ): AgentActivityAppend[] {
    if (deltaType === "thinking_delta") {
      return this.reasoning(base, "delta", string(delta.thinking) || "", block?.id || null)
    }
    if (deltaType === "text_delta") {
      return [
        activity(base, "agent-text", "delta", "provider-visible", "public", {
          text: string(delta.text) || "",
        }),
      ]
    }
    if (deltaType === "input_json_delta" && block?.type.includes("tool")) {
      const toolBase = { ...base, providerToolId: block.id }
      return [
        activity(toolBase, "tool", "updated", "tool", "sensitive", {
          name: block.name || "unknown",
          state: "input-streaming",
          inputSummary: "[tool input redacted]",
        }),
      ]
    }
    if (deltaType === "signature_delta") return [this.privateMarker(base, "thinking-signature")]
    if (CRITICAL_UNKNOWN.test(deltaType)) throw new ClaudeRuntimeProtocolError(deltaType)
    return [this.opaque({}, `content_delta:${deltaType}`, base)]
  }

  private mapBlockStop(
    base: AgentActivityAppendBase,
    block: BlockState | undefined,
  ): AgentActivityAppend[] {
    if (!block) throw new ClaudeRuntimeProtocolError("content-block-stop-without-start")
    if (block.type === "thinking") return this.reasoning(base, "completed", "", block.id)
    if (block.type === "redacted_thinking")
      return [this.privateMarker(base, "redacted-thinking-stop")]
    if (block.type === "text") {
      return [activity(base, "agent-text", "completed", "provider-visible", "public", { text: "" })]
    }
    if (block.type === "tool_use" || block.type === "server_tool_use") {
      const toolBase = { ...base, providerToolId: block.id }
      return [
        activity(toolBase, "tool", "completed", "tool", "sensitive", {
          name: block.name || "unknown",
          state: "input-complete",
        }),
      ]
    }
    return [this.opaque({}, `content_block_stop:${block.type}`, base)]
  }

  private mapAssistant(message: JsonRecord): AgentActivityAppend[] {
    if (this.isSuppressedChild(message)) return []
    const parentId = string(message.parent_tool_use_id)
    const sdkMessage = record(message.message)
    const rawBlocks = array(sdkMessage.content)
    const blocks = rawBlocks.slice(0, MAX_PROVIDER_BLOCKS)
    const messageBase = this.base(message, "assistant", {
      providerItemId: string(sdkMessage.id),
      providerParentItemId: parentId,
    })
    const output: AgentActivityAppend[] = []

    if (string(message.error)) {
      output.push(
        activity(messageBase, "warning", "failed", "status", "sensitive", {
          message: sanitizeClaudeDiagnostic(string(message.error) || "Claude assistant error"),
          code: string(message.error),
        }),
      )
    }

    blocks.forEach((rawBlock, index) => {
      const block = record(rawBlock)
      const type = string(block.type) || "unknown"
      const base = { ...messageBase, contentIndex: index }
      if (type === "text") {
        const text = string(block.text) || ""
        if (parentId) {
          const subagentType = string(message.subagent_type)
          output.push(
            activity(base, "subagent", "completed", "provider-visible", "public", {
              agentId: parentId,
              state: subagentType ? `message:${subagentType}` : "message",
              message: text,
            }),
          )
        } else {
          output.push(
            activity(base, "agent-text", "completed", "provider-visible", "public", { text }),
          )
        }
      } else if (type === "thinking") {
        output.push(...this.reasoning(base, "completed", string(block.thinking) || "", null))
      } else if (type === "redacted_thinking") {
        output.push(this.privateMarker(base, "redacted-thinking"))
      } else if (type === "tool_use" || type === "server_tool_use") {
        const toolId = string(block.id)
        output.push(
          activity({ ...base, providerToolId: toolId }, "tool", "started", "tool", "sensitive", {
            name: string(block.name) || "unknown",
            state: "requested",
            inputSummary: "[tool input redacted]",
          }),
        )
      } else if (CRITICAL_UNKNOWN.test(type)) {
        throw new ClaudeRuntimeProtocolError(`assistant:${type}`)
      } else {
        output.push(this.opaque({}, `assistant_block:${type}`, base))
      }
    })

    if (rawBlocks.length > blocks.length) {
      output.push(
        activity(messageBase, "warning", "updated", "status", "public", {
          message: `Claude assistant content truncated from ${rawBlocks.length} to ${blocks.length} blocks.`,
          code: "content-block-limit",
        }),
      )
    }

    const usage = record(sdkMessage.usage)
    if (Object.keys(usage).length > 0 && !parentId) output.push(this.usage(messageBase, usage))
    return output
  }

  private mapUser(message: JsonRecord): AgentActivityAppend[] {
    if (this.isSuppressedChild(message)) return []
    const sdkMessage = record(message.message)
    const blocks = array(sdkMessage.content)
    const parentId = string(message.parent_tool_use_id)
    const base = this.base(message, "user", { providerParentItemId: parentId })
    const output: AgentActivityAppend[] = []

    blocks.forEach((rawBlock, index) => {
      const block = record(rawBlock)
      if (string(block.type) !== "tool_result") return
      const toolId = string(block.tool_use_id)
      output.push(
        activity(
          { ...base, contentIndex: index, providerToolId: toolId },
          "tool",
          block.is_error === true ? "failed" : "completed",
          "tool",
          "sensitive",
          {
            name: "tool-result",
            state: block.is_error === true ? "failed" : "completed",
            outputSummary: "[tool output redacted]",
          },
        ),
      )
    })
    return output
  }

  private mapResult(message: JsonRecord): AgentActivityAppend[] {
    const failed = message.is_error === true || string(message.subtype) !== "success"
    const base = this.base(message, "result", {
      providerItemId: string(message.uuid),
    })
    const detail = JSON.stringify({
      resultUuid: string(message.uuid),
      subtype: string(message.subtype),
      stopReason: string(message.stop_reason),
      terminalReason: string(message.terminal_reason),
      numTurns: finite(message.num_turns),
    })
    const output: AgentActivityAppend[] = [
      activity(base, "lifecycle", failed ? "failed" : "completed", "status", "public", {
        state: `result:${string(message.subtype) || (failed ? "error" : "success")}`,
        detail,
      }),
      this.usage(base, record(message.usage), finite(message.total_cost_usd)),
    ]

    for (const error of array(message.errors).slice(0, 100)) {
      output.push(
        activity(base, "warning", "failed", "status", "sensitive", {
          message: sanitizeClaudeDiagnostic(String(error)),
          code: "claude-result-error",
        }),
      )
    }
    for (const denialValue of array(message.permission_denials).slice(0, 100)) {
      const denial = record(denialValue)
      output.push(
        activity(
          { ...base, providerToolId: string(denial.tool_use_id) },
          "permission",
          "failed",
          "tool",
          "sensitive",
          {
            requestType: string(denial.tool_name) || "tool",
            state: "denied",
            decision: "deny",
          },
        ),
      )
    }
    return output
  }

  private mapSystem(message: JsonRecord): AgentActivityAppend[] {
    const subtype = string(message.subtype) || "unknown"
    const base = this.base(message, `system:${subtype}`)

    if (subtype === "init") {
      const tools = strings(message.tools)
      const capabilities = strings(message.capabilities)
      const skills = strings(message.skills)
      const plugins = array(message.plugins).map(
        (plugin) => string(record(plugin).name) || "unknown",
      )
      const mcpServers = array(message.mcp_servers).map((serverValue) => {
        const server = record(serverValue)
        return `${string(server.name) || "unknown"}:${string(server.status) || "unknown"}`
      })
      return [
        activity(base, "lifecycle", "started", "status", "public", {
          state: "session-initialized",
          detail: JSON.stringify({
            model: truncateUtf8(string(message.model) || "unknown", MAX_INIT_VALUE_BYTES),
            claudeCodeVersion: truncateUtf8(
              string(message.claude_code_version) || "unknown",
              MAX_INIT_VALUE_BYTES,
            ),
            permissionMode: truncateUtf8(
              string(message.permissionMode) || "unknown",
              MAX_INIT_VALUE_BYTES,
            ),
            tools: boundList(tools),
            toolsTruncated: tools.length > MAX_INIT_LIST,
            capabilities: boundList(capabilities),
            capabilitiesTruncated: capabilities.length > MAX_INIT_LIST,
            skills: boundList(skills),
            skillsTruncated: skills.length > MAX_INIT_LIST,
            plugins: boundList(plugins),
            pluginsTruncated: plugins.length > MAX_INIT_LIST,
            mcpServers: boundList(mcpServers),
            mcpServersTruncated: mcpServers.length > MAX_INIT_LIST,
          }),
        }),
      ]
    }
    if (subtype === "hook_started" || subtype === "hook_progress" || subtype === "hook_response") {
      if (!this.controls.hookDiagnostics) return []
      const phase: AgentActivityPhase =
        subtype === "hook_started"
          ? "started"
          : subtype === "hook_response"
            ? message.outcome === "success"
              ? "completed"
              : "failed"
            : "updated"
      return [
        activity(
          { ...base, providerItemId: string(message.hook_id) },
          "hook",
          phase,
          "status",
          "sensitive",
          {
            name: string(message.hook_name) || "hook",
            state: string(message.outcome) || subtype.slice("hook_".length),
            summary: hookSummary(message),
          },
        ),
      ]
    }
    if (subtype === "permission_denied") {
      return [
        activity(
          { ...base, providerToolId: string(message.tool_use_id) },
          "permission",
          "failed",
          "tool",
          "sensitive",
          {
            requestType: string(message.tool_name) || "tool",
            state: "denied",
            decision: string(message.decision_reason_type) || "deny",
          },
        ),
      ]
    }
    if (subtype === "status") {
      return [
        activity(base, "status", "updated", "status", "public", {
          message: string(message.status) || "idle",
          code: string(message.compact_result),
        }),
      ]
    }
    if (subtype === "compact_boundary") {
      return [
        activity(base, "compaction", "completed", "status", "public", {
          state: "compacted",
          summary: null,
        }),
      ]
    }
    if (subtype === "api_retry") {
      return [
        activity(base, "warning", "updated", "status", "sensitive", {
          message: `Claude API retry ${finite(message.attempt) ?? 0}/${finite(message.max_retries) ?? 0}`,
          code: string(message.error) || "api-retry",
        }),
      ]
    }
    if (subtype.startsWith("task_") || subtype === "background_tasks_changed") {
      if (!this.controls.subagentActivity) return []
      const taskId = string(message.task_id)
      return [
        activity(
          base,
          "subagent",
          subtype === "task_started" ? "started" : "updated",
          "status",
          "public",
          {
            agentId: taskId,
            state: subtype,
            message: sanitizeClaudeDiagnostic(taskMessage(message)),
          },
        ),
      ]
    }
    if (subtype === "session_state_changed") {
      return [
        activity(base, "lifecycle", "updated", "status", "public", {
          state: `session:${string(message.state) || "unknown"}`,
          detail: null,
        }),
      ]
    }
    if (subtype === "thinking_tokens") {
      return [
        activity(base, "usage", "updated", "metadata", "public", {
          reasoningTokens: finite(message.estimated_tokens),
        }),
      ]
    }

    if (CRITICAL_UNKNOWN.test(subtype)) throw new ClaudeRuntimeProtocolError(`system:${subtype}`)
    return [this.opaque(message, `system:${subtype}`, base)]
  }

  private mapToolProgress(message: JsonRecord): AgentActivityAppend[] {
    if (this.isSuppressedChild(message)) return []
    const base = this.base(message, "tool_progress", {
      providerToolId: string(message.tool_use_id),
      providerParentItemId: string(message.parent_tool_use_id),
    })
    return [
      activity(base, "tool", "updated", "tool", "sensitive", {
        name: string(message.tool_name) || "unknown",
        state: "running",
        outputSummary: `${finite(message.elapsed_time_seconds) ?? 0}s elapsed`,
      }),
    ]
  }

  private mapToolSummary(message: JsonRecord): AgentActivityAppend[] {
    const ids = strings(message.preceding_tool_use_ids)
    const base = this.base(message, "tool_use_summary", { providerToolId: ids[0] || null })
    return [
      activity(base, "status", "completed", "status", "sensitive", {
        message: sanitizeClaudeDiagnostic(string(message.summary) || "Tool use completed"),
        code: "tool-use-summary",
      }),
    ]
  }

  private mapAuthStatus(message: JsonRecord): AgentActivityAppend[] {
    const base = this.base(message, "auth_status")
    return [
      activity(base, "status", message.error ? "failed" : "updated", "status", "sensitive", {
        message: message.error
          ? sanitizeClaudeDiagnostic(string(message.error) || "Authentication failed")
          : message.isAuthenticating
            ? "Authenticating"
            : "Authentication updated",
        code: message.error ? "auth-error" : "auth-status",
      }),
    ]
  }

  private reasoning(
    base: AgentActivityAppendBase,
    phase: AgentActivityPhase,
    text: string,
    itemId: string | null,
  ): AgentActivityAppend[] {
    const identity = { ...base, providerItemId: itemId || base.providerItemId }
    if (!this.controls.reasoningDisplay) {
      if (phase === "delta") return []
      return [this.privateMarker(identity, `thinking-${phase}`)]
    }
    return [
      activity(identity, "provider-visible-reasoning", phase, "provider-visible", "public", {
        text,
        label: "Claude thinking",
      }),
    ]
  }

  private usage(
    base: AgentActivityAppendBase,
    value: JsonRecord,
    costUsd: number | null = null,
  ): AgentActivityAppend {
    const cacheRead = finite(value.cache_read_input_tokens)
    const cacheCreation = finite(value.cache_creation_input_tokens)
    return activity(base, "usage", "snapshot", "metadata", "public", {
      inputTokens: finite(value.input_tokens),
      outputTokens: finite(value.output_tokens),
      cachedTokens:
        cacheRead === null && cacheCreation === null
          ? null
          : (cacheRead ?? 0) + (cacheCreation ?? 0),
      costUsd,
    })
  }

  private privateMarker(base: AgentActivityAppendBase, eventType: string): AgentActivityAppend {
    return activity(base, "private-metadata", "snapshot", "private", "private", {
      eventType,
      metadata: { retained: false },
    })
  }

  private opaque(
    message: JsonRecord,
    eventType: string,
    providedBase?: AgentActivityAppendBase,
  ): AgentActivityAppend {
    const base = providedBase || this.base(message, eventType)
    return activity(base, "opaque-metadata", "snapshot", "metadata", "sensitive", {
      eventType,
      metadata: { subtype: string(message.subtype), retainedPayload: false },
    })
  }

  private base(
    message: JsonRecord,
    eventType: string,
    overrides: Partial<AgentActivityAppendBase> = {},
  ): AgentActivityAppendBase {
    const uuid = string(message.uuid)
    const sessionId = string(message.session_id)
    const parentId = string(message.parent_tool_use_id)
    const providerTimestamp = timestamp(message)
    return {
      provider: "anthropic",
      phase: "snapshot",
      displayClass: "metadata",
      privacyClass: "sensitive",
      providerEventId: uuid,
      providerSessionId: sessionId,
      providerMessageId: uuid,
      providerParentItemId: parentId,
      providerTimestamp,
      dedupKey: [
        "claude",
        sessionId,
        uuid,
        eventType,
        overrides.contentIndex ?? "",
        overrides.providerToolId ?? "",
      ].join(":"),
      ...overrides,
    }
  }

  private isSuppressedChild(message: JsonRecord): boolean {
    return string(message.parent_tool_use_id) !== null && !this.controls.subagentActivity
  }
}

export function mapClaudePermissionActivity(input: {
  request: unknown
  phase: "started" | "completed" | "failed" | "cancelled"
  decision?: string | null
}): AgentActivityAppend {
  const request = record(input.request)
  const toolId = string(request.toolUseID) || string(request.tool_use_id)
  const toolName = string(request.toolName) || string(request.tool_name) || "tool"
  return activity(
    {
      provider: "anthropic",
      phase: input.phase,
      displayClass: "tool",
      privacyClass: "sensitive",
      providerToolId: toolId,
      dedupKey: `claude:permission:${toolId || "unknown"}:${input.phase}`,
    },
    "permission",
    input.phase,
    "tool",
    "sensitive",
    {
      requestType: toolName,
      state: input.phase,
      decision: input.decision || null,
    },
  )
}

export function sanitizeClaudeDiagnostic(value: string): string {
  return value
    .replace(/\b(?:Bearer\s+)?(?:sk|sess|token)-[A-Za-z0-9._-]+\b/gi, "[secret]")
    .replace(/(?:\/Users|\/home|\/tmp)\/[^\s'\"]+/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s'\"]+/g, "[path]")
    .replace(/\b(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=[^\s]+/g, "$1=[secret]")
    .slice(0, 2_048)
}

function activity<K extends AgentActivityAppend["kind"]>(
  base: AgentActivityAppendBase,
  kind: K,
  phase: AgentActivityPhase,
  displayClass: AgentActivityAppendBase["displayClass"],
  privacyClass: AgentActivityAppendBase["privacyClass"],
  payload: Extract<AgentActivityAppend, { kind: K }>["payload"],
): Extract<AgentActivityAppend, { kind: K }> {
  return {
    ...boundBase(base),
    kind,
    phase,
    displayClass,
    privacyClass,
    payload: boundPayload(kind, payload),
  } as Extract<AgentActivityAppend, { kind: K }>
}

function boundBase(base: AgentActivityAppendBase): AgentActivityAppendBase {
  return {
    ...base,
    provider: truncateUtf8(base.provider, MAX_SHORT_TEXT_BYTES),
    orchestrationAgentId: boundNullable(base.orchestrationAgentId, 512),
    providerEventId: boundNullable(base.providerEventId, MAX_PROVIDER_ID_BYTES),
    providerSessionId: boundNullable(base.providerSessionId, MAX_PROVIDER_ID_BYTES),
    providerThreadId: boundNullable(base.providerThreadId, MAX_PROVIDER_ID_BYTES),
    providerTurnId: boundNullable(base.providerTurnId, MAX_PROVIDER_ID_BYTES),
    providerItemId: boundNullable(base.providerItemId, MAX_PROVIDER_ID_BYTES),
    providerParentItemId: boundNullable(base.providerParentItemId, MAX_PROVIDER_ID_BYTES),
    providerMessageId: boundNullable(base.providerMessageId, MAX_PROVIDER_ID_BYTES),
    providerToolId: boundNullable(base.providerToolId, MAX_PROVIDER_ID_BYTES),
    sectionBoundary: boundNullable(base.sectionBoundary, 512),
    dedupKey: boundNullable(base.dedupKey, MAX_PROVIDER_ID_BYTES),
  }
}

function boundPayload(kind: AgentActivityAppend["kind"], payload: unknown): unknown {
  const value = { ...record(payload) }
  const shortFields = [
    "state",
    "code",
    "label",
    "name",
    "requestType",
    "decision",
    "agentId",
    "eventType",
  ]
  const longFields = ["detail", "message", "text", "inputSummary", "outputSummary", "summary"]
  for (const field of shortFields) {
    if (typeof value[field] === "string") {
      value[field] = truncateUtf8(value[field] as string, MAX_SHORT_TEXT_BYTES)
    }
  }
  for (const field of longFields) {
    if (typeof value[field] === "string") {
      value[field] = truncateUtf8(value[field] as string, MAX_ACTIVITY_TEXT_BYTES)
    }
  }
  if (kind === "opaque-metadata" || kind === "private-metadata") {
    value.metadata = { retainedPayload: false, bounded: true }
  }
  return value
}

function boundList(values: string[]): string[] {
  return values.slice(0, MAX_INIT_LIST).map((value) => truncateUtf8(value, MAX_INIT_VALUE_BYTES))
}

function boundNullable(value: string | null | undefined, maxBytes: number) {
  return typeof value === "string" ? truncateUtf8(value, maxBytes) : value
}

export function truncateClaudeActivityText(value: string, maxBytes: number): string {
  return truncateUtf8(value, maxBytes)
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  const suffix = "…[truncated]"
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"))
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= budget) low = middle
    else high = middle - 1
  }
  let prefix = value.slice(0, low)
  const last = prefix.charCodeAt(prefix.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1)
  return prefix + suffix
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function strings(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === "string")
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function integer(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function timestamp(message: JsonRecord): number | null {
  if (typeof message.time_origin_ms === "number" && Number.isFinite(message.time_origin_ms)) {
    return message.time_origin_ms
  }
  if (typeof message.timestamp === "string") {
    const parsed = Date.parse(message.timestamp)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function messageItemId(event: JsonRecord): string | null {
  const message = record(event.message)
  return string(message.id)
}

function hookSummary(message: JsonRecord): string | null {
  const text = string(message.output) || string(message.stderr) || string(message.stdout)
  return text ? sanitizeClaudeDiagnostic(text) : null
}

function taskMessage(message: JsonRecord): string {
  const task = record(message.task)
  const patch = record(message.patch)
  return (
    string(message.summary) ||
    string(message.description) ||
    string(task.description) ||
    string(patch.description) ||
    string(patch.error) ||
    string(message.subtype) ||
    "subagent activity"
  )
}
