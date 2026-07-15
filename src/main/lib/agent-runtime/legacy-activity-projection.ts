import type {
  AgentActivityDisplayClass,
  AgentActivityKind,
  AgentActivityPayloadByKind,
  AgentActivityPhase,
} from "../../../shared/agent-activity"

export type LegacyActivityProjection = {
  persisted: false
  projectionId: string
  sequence: number
  messageIndex: number
  partIndex: number
  role: string
  kind: AgentActivityKind
  phase: AgentActivityPhase
  displayClass: AgentActivityDisplayClass
  provenance: "legacy-message-projection"
  providerIdentity: null
  payload: AgentActivityPayloadByKind[AgentActivityKind]
}

/**
 * Projects already-persisted Stage 3 message parts for the shared renderer.
 * The projection is deliberately pure and carries no provider identity. It
 * never appends rows or pretends locally generated IDs came from a provider.
 */
export function projectLegacyActivity(messagesValue: unknown): LegacyActivityProjection[] {
  if (!Array.isArray(messagesValue)) return []
  const output: LegacyActivityProjection[] = []
  for (const [messageIndex, messageValue] of messagesValue.entries()) {
    if (!messageValue || typeof messageValue !== "object") continue
    const message = messageValue as Record<string, unknown>
    const role = typeof message.role === "string" ? message.role : "unknown"
    const parts = legacyParts(message)
    for (const [partIndex, partValue] of parts.entries()) {
      const projection = projectPart(partValue, role, messageIndex, partIndex, output.length + 1)
      if (projection) output.push(projection)
    }
  }
  return output
}

function legacyParts(message: Record<string, unknown>): unknown[] {
  if (Array.isArray(message.parts)) return message.parts
  if (Array.isArray(message.content)) return message.content
  if (typeof message.content === "string") return [{ type: "text", text: message.content }]
  return []
}

function projectPart(
  value: unknown,
  role: string,
  messageIndex: number,
  partIndex: number,
  sequence: number,
): LegacyActivityProjection | null {
  if (!value || typeof value !== "object") return null
  const part = value as Record<string, unknown>
  const type = typeof part.type === "string" ? part.type : "unknown"
  const base = {
    persisted: false as const,
    projectionId: `legacy:${messageIndex}:${partIndex}`,
    sequence,
    messageIndex,
    partIndex,
    role,
    phase: "completed" as const,
    provenance: "legacy-message-projection" as const,
    providerIdentity: null,
  }

  if (type === "reasoning" || type === "tool-ReasoningOutput" || type === "tool-Thinking") {
    const text = extractVisibleText(part)
    if (!text) return null
    return {
      ...base,
      kind: "reasoning-summary",
      displayClass: "summary",
      payload: { text, label: "Legacy reasoning" },
    }
  }
  if (type === "text") {
    const text = typeof part.text === "string" ? part.text : ""
    if (!text) return null
    return {
      ...base,
      kind: "agent-text",
      displayClass: "provider-visible",
      payload: { text },
    }
  }
  if (type.startsWith("tool-")) {
    return {
      ...base,
      kind: "tool",
      displayClass: "tool",
      payload: {
        name: type.slice("tool-".length) || "Legacy tool",
        state: typeof part.state === "string" ? part.state : "completed",
      },
    }
  }
  return null
}

function extractVisibleText(part: Record<string, unknown>): string | null {
  for (const candidate of [part.text, part.output, part.result]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate
  }
  if (part.input && typeof part.input === "object") {
    const input = part.input as Record<string, unknown>
    for (const key of ["reasoning", "thinking", "text", "summary"]) {
      if (typeof input[key] === "string" && input[key].trim()) return input[key]
    }
  }
  return null
}
