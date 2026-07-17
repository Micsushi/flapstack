import { afterEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRuntimeDefaultsService } from "../src/main/lib/agent-runtime/defaults"
import {
  constructRuntimeSnapshot,
  interpretRuntimeSnapshot,
  runtimePermissionSnapshot,
  runtimeSnapshotSqlValues,
} from "../src/main/lib/agent-runtime/snapshot"
import {
  applyRuntimeMigration,
  applyRuntimeModeMigration,
  createLegacyRuntimeDatabase,
} from "./agent-runtime-test-db"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("Agent Runtime migration", () => {
  it("preserves legacy messages and provider session IDs byte-for-byte across reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-runtime-migration-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "agents.db")
    const messages = '[{"id":"m-1","text":"nul-\\u0000-snowman-☃"}]'
    const sessionId = "claude/session\u0000exact/雪"
    let database = createLegacyRuntimeDatabase(path)
    database.prepare("INSERT INTO projects (id) VALUES ('project-1')").run()
    database
      .prepare(
        "INSERT INTO chats (id, project_id, harness, model, permission_mode) VALUES ('chat-1', 'project-1', 'claude-code', 'sonnet', 'read-only')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, session_id, messages) VALUES ('sub-1', 'chat-1', ?, ?)",
      )
      .run(sessionId, messages)
    database
      .prepare(
        `INSERT INTO agent_runs (id, chat_id, sub_chat_id, harness, model, permission_mode, status)
         VALUES ('legacy-run', 'chat-1', 'sub-1', 'claude-code', 'sonnet', 'read-only', 'running')`,
      )
      .run()

    applyRuntimeMigration(database)
    expect(database.prepare("SELECT session_id, messages FROM sub_chats").get()).toEqual({
      session_id: sessionId,
      messages,
    })
    const legacy = database
      .prepare("SELECT * FROM agent_runs WHERE id = 'legacy-run'")
      .get() as Record<string, unknown>
    expect(interpretRuntimeSnapshot(legacy)).toMatchObject({
      runtimeSnapshotVersion: 0,
      runtimePreferenceSource: "legacy",
      resolvedRuntime: "flapstack-native",
      runtimeAdapterVersion: "legacy-stage3",
    })
    database.close()

    database = new Database(path)
    expect(database.prepare("SELECT session_id, messages FROM sub_chats").get()).toEqual({
      session_id: sessionId,
      messages,
    })
    expect(database.pragma("integrity_check", { simple: true })).toBe("ok")
    database.close()
  })

  it("enforces complete immutable snapshots for every new pending/running row", () => {
    const database = createLegacyRuntimeDatabase()
    applyRuntimeMigration(database)
    database.prepare("INSERT INTO chats (id) VALUES ('chat-1')").run()
    expect(() =>
      database
        .prepare(
          `INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status)
           VALUES ('missing-snapshot', 'chat-1', 'codex', 'read-only', 'pending')`,
        )
        .run(),
    ).toThrow(/requires Runtime snapshot/i)
    database
      .prepare(
        `INSERT INTO agent_runs (
          id, chat_id, harness, permission_mode, status, runtime_snapshot_version,
          runtime_preference, runtime_preference_source, resolved_runtime,
          runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
          runtime_control_snapshot
        ) VALUES ('run-1', 'chat-1', 'codex', 'read-only', 'pending', 1, 'auto',
          'product', 'codex', 'unresolved', 'unresolved', '{"schemaVersion":1}',
          '{"schemaVersion":1}')`,
      )
      .run()
    expect(() =>
      database
        .prepare("UPDATE agent_runs SET resolved_runtime = 'flapstack-native' WHERE id = 'run-1'")
        .run(),
    ).toThrow(/immutable/i)
    expect(
      database.prepare("UPDATE agent_runs SET status = 'running' WHERE id = 'run-1'").run(),
    ).toMatchObject({ changes: 1 })
    database.close()
  })

  it("rejects legacy terminal-to-active transitions but permits active-to-terminal cleanup", () => {
    const database = createLegacyRuntimeDatabase()
    database
      .prepare(
        `INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status) VALUES
          ('legacy-cancelled', 'chat-1', 'codex', 'read-only', 'cancelled'),
          ('legacy-completed', 'chat-1', 'codex', 'read-only', 'completed'),
          ('legacy-pending', 'chat-1', 'codex', 'read-only', 'pending'),
          ('legacy-running', 'chat-1', 'codex', 'read-only', 'running')`,
      )
      .run()
    applyRuntimeMigration(database)

    expect(() =>
      database
        .prepare("UPDATE agent_runs SET status = 'pending' WHERE id = 'legacy-cancelled'")
        .run(),
    ).toThrow(/requires Runtime snapshot/i)
    expect(() =>
      database
        .prepare("UPDATE agent_runs SET status = 'running' WHERE id = 'legacy-completed'")
        .run(),
    ).toThrow(/requires Runtime snapshot/i)
    expect(
      database
        .prepare("UPDATE agent_runs SET status = 'cancelled' WHERE id = 'legacy-pending'")
        .run(),
    ).toMatchObject({ changes: 1 })
    expect(
      database
        .prepare("UPDATE agent_runs SET status = 'completed' WHERE id = 'legacy-running'")
        .run(),
    ).toMatchObject({ changes: 1 })
    database.close()
  })

  it("rollback changes defaults only and leaves historical and new snapshots readable", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-runtime-rollback-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "agents.db")
    let database = createLegacyRuntimeDatabase(path)
    applyRuntimeMigration(database)
    database.prepare("INSERT INTO projects (id) VALUES ('project-1')").run()
    database
      .prepare(
        `INSERT INTO chats (id, project_id, harness, permission_mode)
         VALUES ('chat-1', 'project-1', 'codex', 'read-only')`,
      )
      .run()
    const defaults = createRuntimeDefaultsService(database)
    const native = defaults.write({
      scope: { type: "global", id: null },
      harness: "codex",
      preference: "codex",
      expectedVersion: 0,
    })
    const snapshot = constructRuntimeSnapshot(database, {
      chatId: "chat-1",
      harness: "codex",
      permission: runtimePermissionSnapshot("read-only", null),
    })
    database
      .prepare(
        `INSERT INTO agent_runs (
          id, chat_id, harness, permission_mode, runtime_snapshot_version,
          runtime_preference, runtime_preference_source, resolved_runtime,
          runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
          runtime_control_snapshot, status
        ) VALUES ('run-1', 'chat-1', 'codex', 'read-only', ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(...runtimeSnapshotSqlValues(snapshot))
    defaults.write({
      scope: native.scope,
      harness: "codex",
      preference: "flapstack-native",
      expectedVersion: native.version,
    })
    expect(defaults.get(native.scope, "codex")).toMatchObject({
      preference: "flapstack-native",
      version: 2,
    })
    database.close()

    database = new Database(path)
    expect(createRuntimeDefaultsService(database).get(native.scope, "codex")).toMatchObject({
      preference: "flapstack-native",
      version: 2,
    })
    expect(
      database.prepare("SELECT resolved_runtime FROM agent_runs WHERE id = 'run-1'").get(),
    ).toEqual({ resolved_runtime: "codex" })
    database.close()
  })

  it("adds enhanced preferences without rewriting existing Runtime identity", () => {
    const database = createLegacyRuntimeDatabase()
    applyRuntimeMigration(database)
    database.prepare("INSERT INTO projects (id) VALUES ('project-1')").run()
    database
      .prepare(
        `INSERT INTO chats (id, project_id, harness, permission_mode)
         VALUES ('chat-1', 'project-1', 'codex', 'read-only')`,
      )
      .run()
    const defaults = createRuntimeDefaultsService(database)
    defaults.write({
      scope: { type: "global", id: null },
      harness: "codex",
      preference: "codex",
      expectedVersion: 0,
    })
    database
      .prepare(
        `INSERT INTO agent_runs (
          id, chat_id, harness, permission_mode, status, runtime_snapshot_version,
          runtime_preference, runtime_preference_source, resolved_runtime,
          runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
          runtime_control_snapshot
        ) VALUES ('before-split', 'chat-1', 'codex', 'read-only', 'completed', 1,
          'auto', 'product', 'codex', 'adapter', 'protocol',
          '{"schemaVersion":1}', '{"schemaVersion":1}')`,
      )
      .run()

    applyRuntimeModeMigration(database)

    expect(defaults.get({ type: "global", id: null }, "codex")).toMatchObject({
      preference: "codex-enhanced",
    })
    expect(
      database.prepare("SELECT runtime_preference FROM chats WHERE id = 'chat-1'").get(),
    ).toEqual({ runtime_preference: "codex-enhanced" })
    expect(
      database.prepare("SELECT runtime_preference FROM agent_runs WHERE id = 'before-split'").get(),
    ).toEqual({ runtime_preference: "codex-enhanced" })
    defaults.write({
      scope: { type: "project", id: "project-1" },
      harness: "codex",
      preference: "codex-enhanced",
      expectedVersion: 0,
    })
    expect(() =>
      database
        .prepare(
          `INSERT INTO agent_runs (
            id, chat_id, harness, permission_mode, status, runtime_snapshot_version,
            runtime_preference, runtime_preference_source, resolved_runtime,
            runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
            runtime_control_snapshot
          ) VALUES ('enhanced', 'chat-1', 'codex', 'read-only', 'pending', 1,
            'codex-enhanced', 'project', 'codex', 'adapter', 'protocol',
            '{"schemaVersion":1}', '{"schemaVersion":1}')`,
        )
        .run(),
    ).not.toThrow()
    expect(() =>
      database
        .prepare(
          `INSERT INTO agent_runs (
            id, chat_id, harness, permission_mode, status, runtime_snapshot_version,
            runtime_preference, runtime_preference_source, resolved_runtime,
            runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
            runtime_control_snapshot
          ) VALUES ('invalid', 'chat-1', 'codex', 'read-only', 'pending', 1,
            'codex-imaginary', 'project', 'codex', 'adapter', 'protocol',
            '{"schemaVersion":1}', '{"schemaVersion":1}')`,
        )
        .run(),
    ).toThrow(/requires Runtime snapshot/i)
    expect(database.pragma("integrity_check", { simple: true })).toBe("ok")
    database.close()
  })
})
