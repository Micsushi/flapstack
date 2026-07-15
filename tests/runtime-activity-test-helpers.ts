import type {
  AgentActivityEvent,
  AgentActivityKind,
  AgentActivityPayloadByKind,
} from "../src/shared/agent-activity"

export function activity<K extends AgentActivityKind>(
  kind: K,
  payload: AgentActivityPayloadByKind[K],
  overrides: Partial<AgentActivityEvent> = {},
): AgentActivityEvent {
  const sequence = overrides.sequence ?? overrides.storageId ?? 1
  return {
    storageId: sequence,
    eventId: `event-${sequence}`,
    runId: "run-1",
    chatId: "chat-1",
    subChatId: "subchat-1",
    runtime: "codex",
    harness: "codex",
    provider: "codex-app-server",
    sequence,
    kind,
    phase: "completed",
    displayClass: kind === "tool" ? "tool" : "provider-visible",
    privacyClass: "public",
    redactionState: "none",
    redactionReason: null,
    providerTimestamp: 1_000 + sequence,
    receivedAt: 1_100 + sequence,
    dedupKey: null,
    payload,
    createdAt: 1_200 + sequence,
    ...overrides,
  } as AgentActivityEvent
}
