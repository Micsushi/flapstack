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
const PROMPT_PREVIEW_LIMIT = 96
const RESPONSE_PREVIEW_LIMIT = 160
const MAX_TRANSCRIPT_MARKERS = 12

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

export function buildTranscriptTurns(messages: readonly unknown[]): TranscriptMarker[] {
  const turns: Array<Pick<TranscriptMarker, "id" | "promptPreview" | "responsePreview">> = []
  for (const message of messages) {
    if (!message || typeof message !== "object") continue
    const candidate = message as { id?: unknown; role?: unknown; parts?: unknown }
    if (candidate.role === "user" && typeof candidate.id === "string") {
      turns.push({
        id: candidate.id,
        promptPreview:
          publicTextPreview(candidate.parts, PROMPT_PREVIEW_LIMIT) || "Untitled prompt",
        responsePreview: null,
      })
      continue
    }
    if (candidate.role === "assistant" && turns.length > 0) {
      const currentTurn = turns.at(-1)!
      if (currentTurn.responsePreview === null) {
        currentTurn.responsePreview =
          publicTextPreview(candidate.parts, RESPONSE_PREVIEW_LIMIT) || null
      }
    }
  }
  return turns.map((turn, index) => ({
    ...turn,
    ordinal: index + 1,
    total: turns.length,
  }))
}

export function selectTranscriptMarkers(
  turns: readonly TranscriptMarker[],
  active: TranscriptMarker | undefined,
): readonly TranscriptMarker[] {
  if (turns.length <= MAX_TRANSCRIPT_MARKERS) return turns
  const indexes = Array.from({ length: MAX_TRANSCRIPT_MARKERS }, (_, index) =>
    Math.round((index * (turns.length - 1)) / (MAX_TRANSCRIPT_MARKERS - 1)),
  )
  const activeIndex = (active?.ordinal ?? 0) - 1
  if (activeIndex > 0 && !indexes.includes(activeIndex)) {
    // Keep room for the current prompt without dropping either end of the rail.
    const nearest = indexes
      .slice(1, -1)
      .reduce((closest, index) =>
        Math.abs(index - activeIndex) < Math.abs(closest - activeIndex) ? index : closest,
      )
    indexes[indexes.indexOf(nearest)] = activeIndex
  }
  return indexes.map((index) => turns[index]!)
}

function publicTextPreview(parts: unknown, maximumLength: number): string {
  if (!Array.isArray(parts)) return ""
  const normalizedParts = parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") return []
      const candidate = part as { type?: unknown; text?: unknown }
      return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : []
    })
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const uniqueParts = normalizedParts.filter(
    (text, index) => normalizedParts.indexOf(text) === index,
  )
  return truncatePreview(uniqueParts.join(" "), maximumLength)
}

function truncatePreview(text: string, maximumLength: number): string {
  if (text.length <= maximumLength) return text
  const lastCharacter = maximumLength - 1
  const wordBoundary = text.lastIndexOf(" ", lastCharacter)
  const cutAt = wordBoundary >= Math.floor(maximumLength * 0.6) ? wordBoundary : lastCharacter
  return `${text.slice(0, cutAt).trimEnd()}…`
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
