import { afterEach, describe, expect, it } from "vitest"
import {
  AgentActivityError,
  createAgentActivityStore,
  normalizeUnknownAgentActivity,
} from "../src/main/lib/agent-runtime/activity-store"
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
})
