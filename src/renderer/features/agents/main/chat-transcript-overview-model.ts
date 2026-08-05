import type { AgentActivityEvent, AgentActivityKind } from "../../../../shared/agent-activity"

export type ChatProgressSummary = {
  state: "Ready" | "Working" | "Compacting"
  currentStep: string | null
  messageCount: number | null
  changeCount: number | null
  plan: { completed: number; total: number } | null
}

export type TranscriptMarker = {
  id: string
  ordinal: number
  total: number
  promptPreview: string
  responsePreview: string | null
}

const PRIVATE_KINDS = new Set<AgentActivityKind>([
  "reasoning-summary",
  "provider-visible-reasoning",
  "private-metadata",
])
const COMPLETED_PLAN_STATES = new Set(["built", "completed", "done", "finished"])

export function summarizeChatProgress(input: {
  events: readonly AgentActivityEvent[]
  isStreaming: boolean
  isCompacting: boolean
  messageCount: number
  changeCount: number
}): ChatProgressSummary {
  const safeEvents = input.events.filter(
    (event) =>
      event.privacyClass !== "private" &&
      event.privacyClass !== "encrypted" &&
      !PRIVATE_KINDS.has(event.kind),
  )
  const latest = [...safeEvents].sort((left, right) => right.storageId - left.storageId)[0]
  const latestPlan = [...safeEvents]
    .sort((left, right) => right.storageId - left.storageId)
    .find((event) => event.kind === "plan" && Array.isArray(event.payload.items))
  const planItems = latestPlan?.kind === "plan" ? (latestPlan.payload.items ?? []) : []
  return {
    state: input.isCompacting ? "Compacting" : input.isStreaming ? "Working" : "Ready",
    currentStep: latest ? `${activityLabel(latest.kind)} ${latest.phase}` : null,
    messageCount: input.messageCount > 0 ? input.messageCount : null,
    changeCount: input.changeCount > 0 ? input.changeCount : null,
    plan:
      planItems.length > 0
        ? {
            completed: planItems.filter((item) =>
              COMPLETED_PLAN_STATES.has(item.status?.toLocaleLowerCase("en") ?? ""),
            ).length,
            total: planItems.length,
          }
        : null,
  }
}

export function buildTranscriptMarkers(
  messages: readonly unknown[],
  maximum = 12,
): TranscriptMarker[] {
  const turns: Array<Pick<TranscriptMarker, "id" | "promptPreview" | "responsePreview">> = []
  for (const message of messages) {
    if (!message || typeof message !== "object") continue
    const candidate = message as { id?: unknown; role?: unknown; parts?: unknown }
    if (candidate.role === "user" && typeof candidate.id === "string") {
      turns.push({
        id: candidate.id,
        promptPreview: publicTextPreview(candidate.parts) || "Untitled prompt",
        responsePreview: null,
      })
      continue
    }
    if (candidate.role === "assistant" && turns.length > 0) {
      const currentTurn = turns.at(-1)!
      if (currentTurn.responsePreview === null) {
        currentTurn.responsePreview = publicTextPreview(candidate.parts) || null
      }
    }
  }
  if (turns.length === 0) return []
  const count = Math.max(1, Math.min(maximum, turns.length))
  const indexes = new Set<number>()
  for (let marker = 0; marker < count; marker++) {
    indexes.add(count === 1 ? 0 : Math.round((marker * (turns.length - 1)) / (count - 1)))
  }
  return [...indexes].map((index) => ({
    ...turns[index]!,
    ordinal: index + 1,
    total: turns.length,
  }))
}

function publicTextPreview(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  return parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") return []
      const candidate = part as { type?: unknown; text?: unknown }
      return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : []
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function activityLabel(kind: AgentActivityKind): string {
  switch (kind) {
    case "agent-text":
      return "Response"
    case "plan":
      return "Plan"
    case "tool":
      return "Tool"
    case "command":
      return "Command"
    case "patch":
      return "Change"
    case "permission":
      return "Permission"
    case "subagent":
      return "Subagent"
    case "compaction":
      return "Compaction"
    case "usage":
      return "Usage"
    case "warning":
      return "Warning"
    case "hook":
      return "Hook"
    case "lifecycle":
      return "Run"
    case "status":
      return "Status"
    case "opaque-metadata":
      return "Activity"
    case "reasoning-summary":
    case "provider-visible-reasoning":
    case "private-metadata":
      return "Private activity"
  }
}
