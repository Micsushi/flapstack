import type { AgentActivityEvent } from "../../../../shared/agent-activity"
import type { RuntimeActivityStatus } from "./runtime-activity-model"

export const DEV_RUNTIME_ACTIVITY_VIEW_MODES = [
  "activity",
  "live",
  "stale",
  "loading",
  "empty",
  "error",
  "corrupt",
] as const

export type DevRuntimeActivityViewMode = (typeof DEV_RUNTIME_ACTIVITY_VIEW_MODES)[number]

export type DevRuntimeActivityView = {
  events: AgentActivityEvent[]
  status: RuntimeActivityStatus
  error: string | null
  suppressLegacy: boolean
}

export function projectDevRuntimeActivityView(
  events: AgentActivityEvent[],
  mode: DevRuntimeActivityViewMode,
  actualStatus: RuntimeActivityStatus,
  actualError: string | null,
): DevRuntimeActivityView {
  switch (mode) {
    case "activity":
      return { events, status: actualStatus, error: actualError, suppressLegacy: false }
    case "live":
      return { events, status: "live", error: null, suppressLegacy: false }
    case "stale":
      return { events, status: "stale", error: null, suppressLegacy: false }
    case "loading":
      return { events: [], status: "loading", error: null, suppressLegacy: true }
    case "empty":
      return { events: [], status: "ready", error: null, suppressLegacy: true }
    case "error":
      return {
        events: [],
        status: "error",
        error: "Simulated Flapstack Dev Runtime activity read failure.",
        suppressLegacy: true,
      }
    case "corrupt":
      return {
        events: [...events, corruptFixtureEvent(events)],
        status: "ready",
        error: null,
        suppressLegacy: false,
      }
  }
}

function corruptFixtureEvent(events: AgentActivityEvent[]): AgentActivityEvent {
  const last = events.at(-1)
  const storageId = Math.max(0, ...events.map((event) => event.storageId)) + 1
  const sequence = Math.max(0, ...events.map((event) => event.sequence)) + 1
  return {
    storageId,
    eventId: "dev-runtime-fixture-corrupt-placeholder",
    runId: last?.runId ?? "dev-runtime-fixture-corrupt",
    chatId: last?.chatId ?? "dev-runtime-fixture-chat",
    subChatId: last?.subChatId ?? null,
    runtime: last?.runtime ?? "flapstack-native",
    harness: last?.harness ?? "local",
    provider: "flapstack-dev-fixture",
    sequence,
    kind: "private-metadata",
    phase: "snapshot",
    displayClass: "private",
    privacyClass: "private",
    redactionState: "corrupt",
    redactionReason: "Simulated renderer corruption state.",
    providerTimestamp: null,
    receivedAt: Date.UTC(2026, 0, 15, 12, 10, 0),
    dedupKey: "dev-fixture:corrupt-placeholder",
    payload: { eventType: "corrupt-row", metadata: null },
    createdAt: Math.floor(Date.UTC(2026, 0, 15, 12, 10, 0) / 1_000),
  }
}
