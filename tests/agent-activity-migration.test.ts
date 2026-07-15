import Database from "better-sqlite3"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { agentActivityEvents } from "../src/main/lib/db/schema"
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
  it("keeps Drizzle activity CHECK names in parity with local 0033 SQL", () => {
    const tableConfig = getTableConfig(agentActivityEvents)
    const schemaChecks = tableConfig.checks.map((check) => check.name).sort()
    const schemaIndexes = tableConfig.indexes.map((index) => index.config.name).sort()
    const database = createLegacyRuntimeDatabase()
    openDatabases.push(database)
    applyRuntimeMigration(database)
    applyActivityMigration(database)
    const tableSql = (
      database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_activity_events'",
        )
        .get() as { sql: string }
    ).sql
    const migrationChecks = [...tableSql.matchAll(/CONSTRAINT [`\"]([^`\"]+)[`\"] CHECK/g)]
      .map((match) => match[1])
      .sort()
    const migrationIndexes = (
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND tbl_name = 'agent_activity_events'
             AND name NOT LIKE 'sqlite_autoindex_%'
           ORDER BY name`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)

    expect(schemaChecks).toEqual(migrationChecks)
    expect(schemaIndexes).toEqual(migrationIndexes)
    expect(schemaChecks).toContain("agent_activity_events_kind_check")
    expect(schemaChecks).toContain("agent_activity_events_phase_check")
    expect(schemaIndexes).toContain("agent_activity_events_event_id_idx")
  })

  it("applies after authoritative 0032 without rewriting legacy messages", () => {
    const database = createLegacyRuntimeDatabase()
    openDatabases.push(database)
    const legacyMessages = JSON.stringify([
      { role: "assistant", parts: [{ type: "text", text: "legacy bytes" }] },
    ])
    database.prepare("INSERT INTO projects (id, archived_at) VALUES ('project-1', NULL)").run()
    database
      .prepare(
        `INSERT INTO chats (id, project_id, archived_at, harness, model, permission_mode)
         VALUES ('chat-legacy', 'project-1', NULL, 'codex', 'gpt-test', 'read-only')`,
      )
      .run()
    database
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, messages) VALUES ('sub-legacy', 'chat-legacy', ?)",
      )
      .run(legacyMessages)
    database
      .prepare(
        `INSERT INTO agent_runs
         (id, chat_id, sub_chat_id, harness, model, permission_mode, status)
         VALUES ('run-legacy', 'chat-legacy', 'sub-legacy', 'codex', 'gpt-test', 'read-only', 'completed')`,
      )
      .run()

    applyRuntimeMigration(database)
    applyActivityMigration(database)

    expect(
      (
        database.prepare("SELECT messages FROM sub_chats WHERE id = 'sub-legacy'").get() as {
          messages: string
        }
      ).messages,
    ).toBe(legacyMessages)
    expect(
      database
        .prepare(
          "SELECT runtime_snapshot_version, resolved_runtime FROM agent_runs WHERE id = 'run-legacy'",
        )
        .get(),
    ).toEqual({ runtime_snapshot_version: 0, resolved_runtime: "flapstack-native" })
    expect(database.prepare("SELECT COUNT(*) count FROM agent_activity_events").get()).toEqual({
      count: 0,
    })
  })

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
