import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import {
  AgentRuntimeResolutionError,
  constructRuntimeSnapshot,
  runtimePermissionSnapshot,
  runtimeSnapshotSqlValues,
} from "../src/main/lib/agent-runtime/types"
import { createRuntimeDefaultsService } from "../src/main/lib/agent-runtime/defaults"
import type { RuntimeAdapterProbe } from "../src/shared/agent-runtime"
import { applyRuntimeMigration, createLegacyRuntimeDatabase } from "./agent-runtime-test-db"

describe("Agent Runtime run creation", () => {
  let database: Database.Database

  beforeEach(() => {
    database = createLegacyRuntimeDatabase()
    applyRuntimeMigration(database)
    database.prepare("INSERT INTO projects (id) VALUES ('project-1')").run()
    database
      .prepare(
        `INSERT INTO chats (id, project_id, harness, model, permission_mode)
         VALUES ('chat-1', 'project-1', 'codex', 'gpt', 'read-only')`,
      )
      .run()
  })

  afterEach(() => database.close())

  it("constructs the same project-resolved snapshot for direct, MCP, and orchestration stubs", () => {
    createRuntimeDefaultsService(database).write({
      scope: { type: "project", id: "project-1" },
      harness: "codex",
      preference: "flapstack-native",
      expectedVersion: 0,
    })
    const snapshots = ["direct", "mcp", "orchestration"].map(() =>
      constructRuntimeSnapshot(database, {
        chatId: "chat-1",
        harness: "codex",
        model: "gpt",
        permission: runtimePermissionSnapshot("read-only", null),
      }),
    )
    expect(new Set(snapshots.map((snapshot) => JSON.stringify(snapshot))).size).toBe(1)
    expect(snapshots[0]).toMatchObject({
      runtimeSnapshotVersion: 1,
      runtimePreferenceSource: "project",
      resolvedRuntime: "flapstack-native",
    })
  })

  it("blocks missing or archived chat projects before wider defaults can launch", () => {
    createRuntimeDefaultsService(database).write({
      scope: { type: "global", id: null },
      harness: "codex",
      preference: "flapstack-native",
      expectedVersion: 0,
    })
    database
      .prepare(
        `INSERT INTO chats (id, project_id, harness, permission_mode)
         VALUES ('orphan-chat', 'missing-project', 'codex', 'read-only')`,
      )
      .run()
    database.prepare("INSERT INTO projects (id, archived_at) VALUES ('archived-project', 1)").run()
    database
      .prepare(
        `INSERT INTO chats (id, project_id, harness, permission_mode)
         VALUES ('archived-project-chat', 'archived-project', 'codex', 'read-only')`,
      )
      .run()

    for (const chatId of ["orphan-chat", "archived-project-chat"]) {
      expect(() =>
        constructRuntimeSnapshot(database, {
          chatId,
          harness: "codex",
          permission: runtimePermissionSnapshot("read-only", null),
        }),
      ).toThrowError(
        expect.objectContaining<Partial<AgentRuntimeResolutionError>>({
          reason: expect.objectContaining({ code: "project-missing" }),
        }),
      )
    }
  })

  it("blocks archived chats and unavailable explicit adapters before provider intent", () => {
    database.prepare("UPDATE chats SET archived_at = 1 WHERE id = 'chat-1'").run()
    expect(() =>
      constructRuntimeSnapshot(database, {
        chatId: "chat-1",
        harness: "codex",
        permission: runtimePermissionSnapshot("read-only", null),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentRuntimeResolutionError>>({
        reason: expect.objectContaining({ code: "chat-archived" }),
      }),
    )

    database
      .prepare(
        "UPDATE chats SET archived_at = NULL, runtime_preference = 'codex' WHERE id = 'chat-1'",
      )
      .run()
    expect(() =>
      constructRuntimeSnapshot(database, {
        chatId: "chat-1",
        harness: "codex",
        permission: runtimePermissionSnapshot("read-only", null),
        adapterProbes: { codex: unavailableCodexProbe() },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentRuntimeResolutionError>>({
        reason: expect.objectContaining({ code: "adapter-disabled", runtime: "codex" }),
      }),
    )
  })

  it("persists the snapshot before pending intent and retry/restart cannot mutate it", () => {
    const snapshot = constructRuntimeSnapshot(database, {
      chatId: "chat-1",
      harness: "codex",
      model: "gpt",
      permission: runtimePermissionSnapshot("read-only", null),
    })
    database
      .prepare(
        `INSERT INTO agent_runs (
          id, chat_id, harness, model, permission_mode, runtime_snapshot_version,
          runtime_preference, runtime_preference_source, resolved_runtime,
          runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
          runtime_control_snapshot, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run("run-1", "chat-1", "codex", "gpt", "read-only", ...runtimeSnapshotSqlValues(snapshot))
    const beforeRetry = database.prepare("SELECT * FROM agent_runs WHERE id = 'run-1'").get()
    database.prepare("UPDATE agent_runs SET status = 'running' WHERE id = 'run-1'").run()
    database.prepare("UPDATE agent_runs SET status = 'pending' WHERE id = 'run-1'").run()
    const afterRestart = database
      .prepare("SELECT * FROM agent_runs WHERE id = 'run-1'")
      .get() as Record<string, unknown>
    expect({ ...afterRestart, status: (beforeRetry as Record<string, unknown>).status }).toEqual(
      beforeRetry,
    )
  })

  it("covers every direct, MCP, automation, local, test, and orchestration insertion seam", () => {
    let coveredInsertCount = 0
    const drizzleInsertFiles = [
      "src/main/lib/trpc/routers/runs.ts",
      "src/main/lib/trpc/routers/codex.ts",
      "src/main/lib/trpc/routers/claude.ts",
      "src/main/lib/trpc/routers/cursor.ts",
      "src/main/lib/trpc/routers/opencode.ts",
      "src/main/lib/harness/local-model-stream.ts",
      "src/main/lib/mcp-test-control/service.ts",
      "src/main/lib/mcp-test-control/carryover-controls.ts",
    ]
    for (const path of drizzleInsertFiles) {
      const source = read(path)
      const inserts = [...source.matchAll(/\.insert\(agentRuns\)/g)]
      expect(inserts.length, path).toBeGreaterThan(0)
      coveredInsertCount += inserts.length
      for (const insert of inserts) {
        expect(source.slice(insert.index, insert.index + 1_500), path).toMatch(
          /constructRuntimeSnapshot|runtimeSnapshot/,
        )
      }
    }
    const rawInsertFiles = [
      "src/main/lib/run-launch-service.ts",
      "src/main/lib/mcp-control/mutation-service.ts",
      "src/main/lib/agent-orchestration/service.ts",
      "src/main/lib/automation/execution.ts",
    ]
    for (const path of rawInsertFiles) {
      const source = read(path)
      expect(source, path).toContain("constructRuntimeSnapshot")
      const inserts = [...source.matchAll(/INSERT INTO agent_runs[\s\S]*?\) VALUES/g)]
      coveredInsertCount += inserts.length
      for (const insert of inserts) {
        expect(insert[0], path).toContain("runtime_snapshot_version")
      }
    }
    expect(coveredInsertCount).toBe(12)
    expect(read("src/main/lib/main-run-launcher.ts")).not.toContain("INSERT INTO agent_runs")
  })
})

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

function unavailableCodexProbe(): RuntimeAdapterProbe {
  const reason = {
    code: "adapter-disabled" as const,
    harness: "codex",
    runtime: "codex" as const,
    message: "Codex Runtime adapter is disabled.",
    repair: "Enable it or explicitly choose Flapstack Native.",
  }
  return {
    runtime: "codex",
    harness: "codex",
    available: false,
    versions: { adapterVersion: "disabled", protocolVersion: "unresolved" },
    capabilities: {
      schemaVersion: 1,
      status: "unavailable",
      capturedAt: null,
      controls: {
        modelThinking: { supported: false, reason: reason.message },
        reasoningDisplay: { supported: false, reason: reason.message },
        subagentActivity: { supported: false, reason: reason.message },
        hookDiagnostics: { supported: false, reason: reason.message },
      },
      limitations: [reason.message],
      unavailableReason: reason,
    },
    reason,
  }
}
