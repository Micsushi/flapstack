import { afterEach, describe, expect, it } from "vitest"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { createActivityTestDatabase, seedRuntimeRun } from "./agent-activity-test-db"

const databases: ReturnType<typeof createActivityTestDatabase>[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe("Agent activity ordering properties", () => {
  it("keeps every randomized retry/interleaving gap-free", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const database = createActivityTestDatabase()
      databases.push(database)
      const { runId } = seedRuntimeRun(database, { runId: `run-${seed}` })
      let eventId = 0
      const store = createAgentActivityStore(database, {
        createEventId: () => `stored-${seed}-${eventId++}`,
      })
      const providerIds = Array.from({ length: 60 }, (_, index) => `provider-${index}`)
      const deliveries = shuffle(
        [...providerIds, ...providerIds.filter((_, index) => index % 3 === 0)],
        seed,
      )
      for (const providerEventId of deliveries) {
        store.append(runId, {
          kind: "status",
          phase: "updated",
          displayClass: "status",
          privacyClass: "public",
          provider: "property-provider",
          providerEventId,
          payload: { message: providerEventId },
        })
      }
      const replay = store.replayRun(runId)
      expect(replay).toHaveLength(providerIds.length)
      expect(replay.map((event) => event.sequence)).toEqual(
        Array.from({ length: providerIds.length }, (_, index) => index + 1),
      )
      expect(new Set(replay.map((event) => event.providerEventId)).size).toBe(providerIds.length)
    }
  })

  it("orders out-of-order provider timestamps by persisted callback sequence", () => {
    const database = createActivityTestDatabase()
    databases.push(database)
    const { runId } = seedRuntimeRun(database)
    const store = createAgentActivityStore(database)
    store.appendBatch(
      runId,
      [300, 100, 200].map((providerTimestamp, index) => ({
        kind: "status" as const,
        phase: "delta" as const,
        displayClass: "status" as const,
        privacyClass: "public" as const,
        provider: "test",
        providerEventId: `timestamp-${index}`,
        providerTimestamp,
        contentIndex: index,
        payload: { message: `callback-${index}` },
      })),
    )

    expect(
      store.replayRun(runId).map((event) => [event.sequence, event.providerTimestamp]),
    ).toEqual([
      [1, 300],
      [2, 100],
      [3, 200],
    ])
  })

  it("appends and replays a 10000-event stream within the headless budget", () => {
    const database = createActivityTestDatabase()
    databases.push(database)
    const { runId } = seedRuntimeRun(database)
    let storedId = 0
    const store = createAgentActivityStore(database, {
      createEventId: () => `performance-${storedId++}`,
    })
    const startedAt = performance.now()
    for (let batch = 0; batch < 10; batch += 1) {
      store.appendBatch(
        runId,
        Array.from({ length: 1_000 }, (_, offset) => {
          const index = batch * 1_000 + offset
          return {
            kind: "status" as const,
            phase: "updated" as const,
            displayClass: "status" as const,
            privacyClass: "public" as const,
            provider: "performance-fixture",
            providerEventId: `provider-${index}`,
            payload: { message: `event-${index}` },
          }
        }),
      )
    }
    const appendMilliseconds = performance.now() - startedAt
    const replayStartedAt = performance.now()
    const replay = store.replayRun(runId, 0, 10_000)
    const replayMilliseconds = performance.now() - replayStartedAt

    console.info(
      `agent-activity-performance append_ms=${appendMilliseconds.toFixed(1)} replay_ms=${replayMilliseconds.toFixed(1)} events=${replay.length}`,
    )
    expect(replay).toHaveLength(10_000)
    expect(replay.at(-1)?.sequence).toBe(10_000)
    expect(appendMilliseconds).toBeLessThan(15_000)
    expect(replayMilliseconds).toBeLessThan(5_000)
  })
})

function shuffle<T>(values: T[], seed: number): T[] {
  let state = seed >>> 0
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1))
    ;[values[index], values[target]] = [values[target], values[index]]
  }
  return values
}
