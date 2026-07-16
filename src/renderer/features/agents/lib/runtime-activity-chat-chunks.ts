import type { UIMessageChunk } from "ai"
import type { AgentActivityEvent } from "../../../../shared/agent-activity"

export class RuntimeActivityChatChunkMapper {
  private readonly reasoningStarted = new Set<string>()
  private readonly reasoningHasDelta = new Set<string>()
  private readonly reasoningCompleted = new Set<string>()
  private readonly toolStarted = new Set<string>()
  private readonly toolCompleted = new Set<string>()
  private readonly toolNames = new Map<string, string>()
  private readonly toolInputs = new Map<string, unknown>()
  private readonly toolOutputs = new Map<string, string[]>()

  constructor(private readonly runId: string) {}

  map(events: readonly AgentActivityEvent[]): UIMessageChunk[] {
    return events.flatMap((event) => this.mapEvent(event))
  }

  beforeText(): UIMessageChunk[] {
    return this.closeOpenReasoning()
  }

  finish(): UIMessageChunk[] {
    return this.closeOpenReasoning()
  }

  private mapEvent(event: AgentActivityEvent): UIMessageChunk[] {
    if (event.kind === "reasoning-summary" || event.kind === "provider-visible-reasoning") {
      return this.mapReasoning(event)
    }
    if (event.kind === "tool" || event.kind === "command" || event.kind === "patch") {
      return [...this.closeOpenReasoning(), ...this.mapTool(event)]
    }
    if (event.kind === "plan") return [...this.closeOpenReasoning(), ...this.mapPlan(event)]
    return []
  }

  private mapReasoning(
    event: AgentActivityEvent & {
      kind: "reasoning-summary" | "provider-visible-reasoning"
    },
  ): UIMessageChunk[] {
    const id = this.reasoningPartId(event)
    if (this.reasoningCompleted.has(id)) return []
    const output: UIMessageChunk[] = []
    if (!this.reasoningStarted.has(id)) {
      this.reasoningStarted.add(id)
      output.push({ type: "reasoning-start", id })
    }
    const text = event.payload.text
    if (event.phase === "delta" && text) {
      this.reasoningHasDelta.add(id)
      output.push({ type: "reasoning-delta", id, delta: text })
    } else if (event.phase === "completed") {
      if (text && !this.reasoningHasDelta.has(id)) {
        output.push({ type: "reasoning-delta", id, delta: text })
      }
      this.reasoningCompleted.add(id)
      output.push({ type: "reasoning-end", id })
    }
    return output
  }

  private mapTool(
    event: AgentActivityEvent & { kind: "tool" | "command" | "patch" },
  ): UIMessageChunk[] {
    const toolCallId = this.partId(event, event.kind)
    const descriptor = toolDescriptor(event, this.toolNames.get(toolCallId))
    this.toolNames.set(toolCallId, descriptor.name)
    if (descriptor.hasInput) this.toolInputs.set(toolCallId, descriptor.input)
    const output: UIMessageChunk[] = []

    if (!this.toolStarted.has(toolCallId) && (descriptor.hasInput || isTerminal(event))) {
      this.toolStarted.add(toolCallId)
      output.push({
        type: "tool-input-available",
        toolCallId,
        toolName: descriptor.name,
        input: this.toolInputs.get(toolCallId) ?? descriptor.input,
        providerExecuted: true,
      })
    }

    const outputText = toolOutputText(event)
    if (outputText) {
      if (isTerminal(event)) {
        // Provider terminal events contain the authoritative aggregate snapshot.
        this.toolOutputs.set(toolCallId, [outputText])
      } else {
        const chunks = this.toolOutputs.get(toolCallId) ?? []
        chunks.push(outputText)
        this.toolOutputs.set(toolCallId, chunks)
      }
    }

    if (this.toolCompleted.has(toolCallId) || !isTerminal(event)) return output
    this.toolCompleted.add(toolCallId)
    if (event.phase === "failed" || descriptor.state === "failed") {
      output.push({
        type: "tool-output-error",
        toolCallId,
        errorText: this.toolOutputs.get(toolCallId)?.join("") || `${descriptor.name} failed`,
        providerExecuted: true,
      })
    } else {
      output.push({
        type: "tool-output-available",
        toolCallId,
        output: toolOutput(event, this.toolOutputs.get(toolCallId)?.join("") ?? ""),
        providerExecuted: true,
      })
    }
    return output
  }

  private mapPlan(event: AgentActivityEvent & { kind: "plan" }): UIMessageChunk[] {
    if (event.phase !== "updated" && event.phase !== "completed") return []
    const toolCallId = this.partId(event, "plan")
    if (this.toolCompleted.has(toolCallId)) return []
    this.toolCompleted.add(toolCallId)
    const plan =
      event.payload.text ?? event.payload.items?.map((item) => `- ${item.text}`).join("\n") ?? ""
    return [
      {
        type: "tool-input-available",
        toolCallId,
        toolName: "PlanWrite",
        input: { plan },
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId,
        output: { state: event.phase },
        providerExecuted: true,
      },
    ]
  }

  private partId(event: AgentActivityEvent, prefix: string): string {
    const identity =
      event.providerToolId ??
      event.providerItemId ??
      event.providerMessageId ??
      [event.contentIndex, event.summaryIndex, event.partIndex]
        .filter((value) => value != null)
        .join("-") ??
      event.eventId
    return `runtime-${this.runId}-${prefix}-${safeId(identity || event.eventId)}`
  }

  private reasoningPartId(
    event: AgentActivityEvent & {
      kind: "reasoning-summary" | "provider-visible-reasoning"
    },
  ): string {
    const identity = [
      event.providerMessageId ?? event.providerItemId ?? event.eventId,
      event.contentIndex ?? "",
      event.summaryIndex ?? "",
      event.kind,
    ].join("-")
    return `runtime-${this.runId}-reasoning-${safeId(identity)}`
  }

  private closeOpenReasoning(): UIMessageChunk[] {
    const output: UIMessageChunk[] = []
    for (const id of this.reasoningStarted) {
      if (this.reasoningCompleted.has(id)) continue
      this.reasoningCompleted.add(id)
      output.push({ type: "reasoning-end", id })
    }
    return output
  }
}

function toolDescriptor(
  event: AgentActivityEvent & { kind: "tool" | "command" | "patch" },
  existingName?: string,
): { name: string; input: unknown; state: string; hasInput: boolean } {
  if (event.kind === "command") {
    const hasInput = event.payload.command != null && event.payload.command !== ""
    return {
      name: "Bash",
      input: { command: event.payload.command ?? "" },
      state: event.payload.state,
      hasInput,
    }
  }
  if (event.kind === "patch") {
    const changes = event.payload.changes ?? []
    const hasInput = Boolean(event.payload.path || event.payload.diff || changes.length > 0)
    return {
      name: "ApplyPatch",
      input: {
        path: event.payload.path ?? null,
        changes,
        diff: event.payload.diff ?? null,
      },
      state: event.payload.state,
      hasInput,
    }
  }
  const name =
    event.payload.name === "tool-result" && existingName ? existingName : event.payload.name
  return {
    name: normalizeToolName(name),
    input:
      event.payload.input ??
      (event.payload.inputSummary ? { summary: event.payload.inputSummary } : {}),
    state: event.payload.state,
    hasInput: event.payload.input !== undefined || Boolean(event.payload.inputSummary),
  }
}

function toolOutput(
  event: AgentActivityEvent & { kind: "tool" | "command" | "patch" },
  text: string,
): unknown {
  if (event.kind === "command") {
    return { stdout: text, exitCode: event.payload.exitCode ?? null }
  }
  if (event.kind === "patch") {
    return {
      summary: text,
      path: event.payload.path ?? null,
      changes: event.payload.changes ?? [],
      diff: event.payload.diff ?? null,
      state: event.payload.state,
    }
  }
  return event.payload.output ?? { summary: text, state: event.payload.state }
}

function toolOutputText(
  event: AgentActivityEvent & { kind: "tool" | "command" | "patch" },
): string {
  if (event.kind === "command") return event.payload.outputSummary ?? ""
  if (event.kind === "patch") return event.payload.summary ?? ""
  return event.payload.outputSummary ?? ""
}

function isTerminal(event: AgentActivityEvent & { kind: "tool" | "command" | "patch" }): boolean {
  const state = event.payload.state.toLowerCase()
  return (
    event.phase === "completed" ||
    event.phase === "failed" ||
    event.phase === "cancelled" ||
    ["completed", "failed", "cancelled", "denied", "rejected"].includes(state)
  )
}

function normalizeToolName(name: string): string {
  const normalized = name.trim()
  const aliases: Record<string, string> = {
    bash: "Bash",
    command: "Bash",
    edit: "Edit",
    glob: "Glob",
    grep: "Grep",
    read: "Read",
    reasoningoutput: "ReasoningOutput",
    webfetch: "WebFetch",
    websearch: "WebSearch",
    write: "Write",
  }
  const alias = aliases[normalized.replace(/[^a-zA-Z]/g, "").toLowerCase()]
  if (alias) return alias
  if (normalized.includes("/")) return `mcp__${normalized.replaceAll("/", "__")}`
  return normalized || "Tool"
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 180)
}
