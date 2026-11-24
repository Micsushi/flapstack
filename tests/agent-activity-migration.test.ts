import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import {
  applyActivityMigration,
  applyRuntimeMigration,
  createLegacyRuntimeDatabase,
  seedRuntimeRun,
} from "./agent-runtime-test-db"

const tempDirectories: string[] = []
const openDatabases: Database.Database[] = []

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close()
  while (tempDirectories.length) rmSync(tempDirectories.pop()!, { recursive: true, force: true })
})

describe("Agent activity migration and restart", () => {
  it("replays the exact durable sequence after database restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-activity-"))
    tempDirectories.push(directory)
    const filename = join(directory, "activity.sqlite")
    let database = createLegacyRuntimeDatabase(filename)
    applyRuntimeMigration(database)
    applyActivityMigration(database)
    database.pragma("foreign_keys = ON")
    const { runId } = seedRuntimeRun(database)
    const firstStore = createAgentActivityStore(database)
    firstStore.appendBatch(
      runId,
      Array.from({ length: 25 }, (_, index) => ({
        kind: "status" as const,
        phase: "updated" as const,
        displayClass: "status" as const,
        privacyClass: "public" as const,
        provider: "restart-fixture",
        providerEventId: `provider-${index}`,
        providerParentItemId: index === 0 ? "missing-provider-parent" : `provider-${index - 1}`,
        payload: { message: `event-${index}` },
      })),
    )
    database.close()

    database = new Database(filename)
    openDatabases.push(database)
    database.pragma("foreign_keys = ON")
    const restartedStore = createAgentActivityStore(database)
    const replay = restartedStore.replayRun(runId)
    expect(replay.map((event) => event.sequence)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    )
    expect(replay[0].providerParentItemId).toBe("missing-provider-parent")
    expect(
      restartedStore.append(runId, {
        kind: "status",
        phase: "completed",
        displayClass: "status",
        privacyClass: "public",
        provider: "restart-fixture",
        providerEventId: "provider-25",
        payload: { message: "after restart" },
      }).sequence,
    ).toBe(26)
  })

  it("enforces append-only identity while permitting one-way payload redaction", () => {
    const database = createLegacyRuntimeDatabase()
    openDatabases.push(database)
    applyRuntimeMigration(database)
    applyActivityMigration(database)
    database.pragma("foreign_keys = ON")
    const { runId } = seedRuntimeRun(database)
    const store = createAgentActivityStore(database)
    const event = store.append(runId, {
      kind: "agent-text",
      phase: "completed",
      displayClass: "provider-visible",
      privacyClass: "public",
      provider: "test",
      payload: { text: "visible" },
    })

    expect(() =>
      database
        .prepare("UPDATE agent_activity_events SET sequence = 99 WHERE storage_id = ?")
        .run(event.storageId),
    ).toThrow(/append-only/)
    expect(() =>
      database
        .prepare(
          `UPDATE agent_activity_events SET
             kind = 'private-metadata', display_class = 'provider-visible', privacy_class = 'private',
             redaction_state = 'redacted', redaction_reason = 'fake',
             payload_json = '{"eventType":"redacted","metadata":null}'
           WHERE storage_id = ?`,
        )
        .run(event.storageId),
    ).toThrow(/append-only/)
    expect(() =>
      database
        .prepare(
          `UPDATE agent_activity_events SET
             kind = 'private-metadata', display_class = 'private', privacy_class = 'private',
             redaction_state = 'redacted', redaction_reason = 'fake',
             payload_json = '{"eventType":"redacted","metadata":{"text":"smuggled"}}'
           WHERE storage_id = ?`,
        )
        .run(event.storageId),
    ).toThrow(/append-only/)
    expect(store.redactRun(runId, "user-request")).toBe(1)
    expect(() => store.redactRun(runId, "second-redaction")).toThrow(/append-only/)
  })

  it("keeps the sequence high-water mark after delete-all and restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-activity-high-water-"))
    tempDirectories.push(directory)
    const filename = join(directory, "activity.sqlite")
    let database = createLegacyRuntimeDatabase(filename)
    applyRuntimeMigration(database)
    applyActivityMigration(database)
    database.pragma("foreign_keys = ON")
    const { runId } = seedRuntimeRun(database)
    const store = createAgentActivityStore(database)
    store.appendBatch(runId, [
      {
        kind: "status",
        phase: "completed",
        displayClass: "status",
        privacyClass: "public",
        provider: "test",
        receivedAt: 10,
        payload: { message: "one" },
      },
      {
        kind: "status",
        phase: "completed",
        displayClass: "status",
        privacyClass: "public",
        provider: "test",
        receivedAt: 11,
        payload: { message: "two" },
      },
    ])
    expect(
      store.applyRetention({ beforeReceivedAt: 20, mode: "delete", reason: "expired", runId }),
    ).toBe(2)
    database.close()

    database = new Database(filename)
    openDatabases.push(database)
    database.pragma("foreign_keys = ON")
    expect(
      createAgentActivityStore(database).append(runId, {
        kind: "status",
        phase: "completed",
        displayClass: "status",
        privacyClass: "public",
        provider: "test",
        payload: { message: "after restart" },
      }).sequence,
    ).toBe(3)
  })
})
