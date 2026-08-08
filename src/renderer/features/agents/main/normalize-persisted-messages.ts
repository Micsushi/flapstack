import { normalizeCodexToolPart } from "../../../../shared/codex-tool-normalizer"

type AnyRecord = Record<string, any>

function normalizeToolPart(part: AnyRecord): AnyRecord {
  let normalized = part
  if (part.type === "tool-invocation" && part.toolName) {
    normalized = {
      ...part,
      type: `tool-${part.toolName}`,
      toolCallId: part.toolCallId || part.toolInvocationId,
      input: part.input || part.args,
    }
  }
  if (
    normalized.type?.startsWith("tool-Tool:") ||
    normalized.toolName?.startsWith("Tool:") ||
    normalized.input?.toolName?.startsWith("Tool:")
  ) {
    normalized = normalizeCodexToolPart(normalized) as AnyRecord
  }
  if (normalized.type?.startsWith("tool-") && normalized.state === "result") {
    return {
      ...normalized,
      state: normalized.result?.success === false ? "output-error" : "output-available",
      output: normalized.output || normalized.result,
    }
  }
  return normalized
}

export function normalizePersistedMessages(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message
    const record = message as AnyRecord
    if (!Array.isArray(record.parts)) return record
    return { ...record, parts: record.parts.map(normalizeToolPart) }
  })
}
