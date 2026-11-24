import { afterEach, describe, expect, it } from "vitest"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { createActivityTestDatabase, seedRuntimeRun } from "./agent-activity-test-db"

const databases: ReturnType<typeof createActivityTestDatabase>[] = []

function setup() {
  const database = createActivityTestDatabase()
  databases.push(database)
  const ids = seedRuntimeRun(database)
  let nextId = 1
  const invalidations: unknown[] = []
  const store = createAgentActivityStore(database, {
    now: () => 1_700_000_000_000 + nextId,
    createEventId: () => `event-${nextId++}`,
    onInvalidated: (value) => invalidations.push(value),
  })
  return { database, store, invalidations, ...ids }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe("AgentActivityStore", () => {
  it("appends one transactional batch with native identity and gap-free sequence", () => {
    const { store, runId, invalidations } = setup()
    const events = store.appendBatch(runId, [
      {
        kind: "lifecycle",
        phase: "started",
        displayClass: "status",
        privacyClass: "public",
        provider: "codex-app-server",
        providerEventId: "thread:start:1",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        providerItemId: "item-1",
        providerTimestamp: 100,
        payload: { state: "started" },
      },
      {
        kind: "reasoning-summary",
        phase: "delta",
        displayClass: "summary",
        privacyClass: "sensitive",
        provider: "codex-app-server",
        providerEventId: "summary:1:0",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        providerItemId: "item-1",
        providerParentItemId: "parent-1",
        providerMessageId: "message-1",
        providerToolId: "tool-1",
        summaryIndex: 2,
        contentIndex: 3,
        partIndex: 4,
        sectionBoundary: "section-start",
        payload: { text: "Visible provider summary" },
      },
    ])

    expect(events.map((event) => event.sequence)).toEqual([1, 2])
    expect(events[1]).toMatchObject({
      runtime: "codex",
      harness: "codex",
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
      providerItemId: "item-1",
      providerParentItemId: "parent-1",
      providerMessageId: "message-1",
      providerToolId: "tool-1",
      summaryIndex: 2,
      contentIndex: 3,
      partIndex: 4,
      sectionBoundary: "section-start",
    })
    expect(invalidations).toEqual([
      expect.objectContaining({
        reason: "append",
        runId,
        firstSequence: 1,
        lastSequence: 2,
        insertedCount: 2,
      }),
    ])
  })

  it("deduplicates stable provider delivery before allocating sequence", () => {
    const { store, runId, database } = setup()
    const input = {
      kind: "agent-text" as const,
      phase: "delta" as const,
      displayClass: "provider-visible" as const,
      privacyClass: "public" as const,
      provider: "codex-app-server",
      providerEventId: "message-1:content-0:delta-1",
      payload: { text: "same delivery" },
    }
    const first = store.append(runId, input)
    const retry = store.append(runId, input)
    expect(
      database
        .prepare("SELECT next_sequence FROM agent_activity_sequences WHERE run_id = ?")
        .get(runId),
    ).toEqual({ next_sequence: 2 })
    const repeatedText = store.append(runId, {
      ...input,
      providerEventId: "message-2:content-0:delta-1",
    })

    expect(retry.eventId).toBe(first.eventId)
    expect(repeatedText.eventId).not.toBe(first.eventId)
    expect(repeatedText.sequence).toBe(2)
    expect(
      database.prepare("SELECT sequence FROM agent_activity_events ORDER BY sequence").all(),
    ).toEqual([{ sequence: 1 }, { sequence: 2 }])
  })

  it("rolls the high-water mark back with a failed SQL batch", () => {
    const database = createActivityTestDatabase()
    databases.push(database)
    const { runId } = seedRuntimeRun(database)
    const store = createAgentActivityStore(database, { createEventId: () => "duplicate-id" })
    const input = {
      kind: "status" as const,
      phase: "completed" as const,
      displayClass: "status" as const,
      privacyClass: "public" as const,
      provider: "test",
      payload: { message: "valid" },
    }
    expect(() => store.appendBatch(runId, [input, input])).toThrow(/not appended/)
    expect(database.prepare("SELECT COUNT(*) count FROM agent_activity_events").get()).toEqual({
      count: 0,
    })
    expect(database.prepare("SELECT COUNT(*) count FROM agent_activity_sequences").get()).toEqual({
      count: 0,
    })
  })

  it("never reuses a sequence after retention deletes the tail or all rows", () => {
    const { store, runId, database } = setup()
    for (let index = 0; index < 3; index += 1) {
      store.append(runId, {
        kind: "status",
        phase: "completed",
        displayClass: "status",
        privacyClass: "public",
        provider: "test",
        receivedAt: 10 + index,
        payload: { message: `event-${index}` },
      })
    }
    expect(
      database
        .prepare("DELETE FROM agent_activity_events WHERE run_id = ? AND sequence = 3")
        .run(runId).changes,
    ).toBe(1)
    expect(
      store.append(runId, {
        kind: "status",
        phase: "completed",
        displayClass: "status",
        privacyClass: "public",
        provider: "test",
        receivedAt: 20,
        payload: { message: "after-tail-delete" },
      }).sequence,
    ).toBe(4)
    expect(
      store.applyRetention({ beforeReceivedAt: 30, mode: "delete", reason: "expired", runId }),
    ).toBe(3)
    expect(
      store.append(runId, {
        kind: "status",
        phase: "completed",
        displayClass: "status",
        privacyClass: "public",
        provider: "test",
        payload: { message: "after-delete-all" },
      }).sequence,
    ).toBe(5)
  })
})
