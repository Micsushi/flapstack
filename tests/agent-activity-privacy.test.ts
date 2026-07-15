import { afterEach, describe, expect, it } from "vitest"
import {
  AgentActivityError,
  createAgentActivityStore,
  normalizeUnknownAgentActivity,
} from "../src/main/lib/agent-runtime/activity-store"
import { projectLegacyActivity } from "../src/main/lib/agent-runtime/legacy-activity-projection"
import { createActivityTestDatabase, seedRuntimeRun } from "./agent-activity-test-db"

const databases: ReturnType<typeof createActivityTestDatabase>[] = []

function setup() {
  const database = createActivityTestDatabase()
  databases.push(database)
  const { runId } = seedRuntimeRun(database)
  return { database, runId, store: createAgentActivityStore(database) }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe("Agent activity privacy", () => {
  it("rejects private display text and stores encrypted metadata without plaintext", () => {
    const { database, runId, store } = setup()
    expect(() =>
      store.append(runId, {
        kind: "provider-visible-reasoning",
        phase: "delta",
        displayClass: "private",
        privacyClass: "encrypted",
        provider: "test",
        payload: { text: "private chain of thought" },
      }),
    ).toThrowError(AgentActivityError)

    store.append(runId, {
      kind: "private-metadata",
      phase: "snapshot",
      displayClass: "private",
      privacyClass: "encrypted",
      provider: "test",
      payload: {
        eventType: "encrypted-reasoning",
        metadata: { ciphertext: "plaintext-must-not-survive", tokenCount: 42 },
      },
    })
    const raw = database.prepare("SELECT payload_json FROM agent_activity_events").get() as {
      payload_json: string
    }
    expect(raw.payload_json).not.toContain("plaintext-must-not-survive")
    expect(raw.payload_json).toContain("[redacted]")
    expect(store.query({ runId }).events[0].displayClass).toBe("private")
  })

  it("bounds metadata depth, entries, strings, and known secrets", () => {
    const { runId, store } = setup()
    const normalized = normalizeUnknownAgentActivity({
      provider: "future-provider",
      eventType: "new-observability-event",
      criticality: "metadata",
      metadata: {
        apiKey: "sk-super-secret-value",
        long: "x".repeat(10_000),
        nested: { a: { b: { c: { d: { e: { f: { g: "too-deep" } } } } } } },
        many: Object.fromEntries(
          Array.from({ length: 150 }, (_, index) => [`key-${index}`, index]),
        ),
      },
    })
    const event = store.append(runId, normalized)
    const payload = event.payload as { metadata: Record<string, unknown> }
    expect(payload.metadata.apiKey).toBe("[redacted]")
    expect(String(payload.metadata.long)).toHaveLength(4_096)
    expect(JSON.stringify(payload)).not.toContain("too-deep")
    expect(Object.keys(payload.metadata.many as object)).toHaveLength(100)
  })

  it.each(["execution", "permission", "identity"] as const)(
    "fails closed for unknown %s-critical events",
    (criticality) => {
      expect(() =>
        normalizeUnknownAgentActivity({
          provider: "future-provider",
          eventType: "unknown-critical",
          criticality,
        }),
      ).toThrow(/fail closed/)
    },
  )

  it("fails closed on corrupt rows or returns a private placeholder", () => {
    const { database, runId, store } = setup()
    const event = store.append(runId, {
      kind: "status",
      phase: "completed",
      displayClass: "status",
      privacyClass: "public",
      provider: "test",
      payload: { message: "valid" },
    })
    database.pragma("ignore_check_constraints = ON")
    database.pragma("recursive_triggers = OFF")
    database.prepare("DROP TRIGGER agent_activity_events_append_only").run()
    database
      .prepare("UPDATE agent_activity_events SET payload_json = 'not-json' WHERE storage_id = ?")
      .run(event.storageId)

    expect(() => store.query({ runId })).toThrow(/Corrupt activity row/)
    expect(store.query({ runId, corruptionMode: "redacted-placeholder" }).events[0]).toMatchObject({
      sequence: 1,
      kind: "private-metadata",
      privacyClass: "private",
      redactionState: "corrupt",
    })
  })

  it("projects legacy visible parts without database writes or provider identity", () => {
    const { database } = setup()
    const before = database.prepare("SELECT COUNT(*) count FROM agent_activity_events").get()
    const projection = projectLegacyActivity([
      {
        role: "assistant",
        parts: [
          { type: "text", text: "answer" },
          { type: "tool-ReasoningOutput", input: { reasoning: "summary" } },
          { type: "tool-Bash", state: "output-available" },
        ],
      },
    ])
    expect(projection.map((item) => [item.kind, item.sequence])).toEqual([
      ["agent-text", 1],
      ["reasoning-summary", 2],
      ["tool", 3],
    ])
    expect(projection.every((item) => !item.persisted && item.providerIdentity === null)).toBe(true)
    expect(database.prepare("SELECT COUNT(*) count FROM agent_activity_events").get()).toEqual(
      before,
    )
  })
})
