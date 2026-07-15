import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AGENT_ACTIVITY_KINDS } from "../src/shared/agent-activity"
import {
  createDevRuntimeActivityFixtureService,
  isDevRuntimeActivityFixtureEnabled,
} from "../src/main/lib/agent-runtime/dev-activity-fixtures"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { projectDevRuntimeActivityView } from "../src/renderer/features/agents/runtime-activity"
import { createActivityTestDatabase } from "./agent-activity-test-db"
import { activity } from "./runtime-activity-test-helpers"

const databases: ReturnType<typeof createActivityTestDatabase>[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

function fixtureDatabase() {
  const database = createActivityTestDatabase()
  databases.push(database)
  database.prepare("INSERT INTO projects (id, archived_at) VALUES ('project-1', NULL)").run()
  database
    .prepare(
      `INSERT INTO chats
       (id, project_id, archived_at, harness, model, permission_mode, runtime_preference)
       VALUES ('chat-1', 'project-1', NULL, 'codex', 'fixture-model', 'read-only', 'codex')`,
    )
    .run()
  database
    .prepare(
      "INSERT INTO sub_chats (id, chat_id, session_id, messages) VALUES ('subchat-1', 'chat-1', NULL, '[]')",
    )
    .run()
  return database
}

const scope = { projectId: "project-1", chatId: "chat-1", subChatId: "subchat-1" }

describe("Flapstack Dev Runtime activity fixture", () => {
  it("is enabled only for an unpackaged development renderer", () => {
    expect(isDevRuntimeActivityFixtureEnabled(false, "http://127.0.0.1:5173")).toBe(true)
    expect(isDevRuntimeActivityFixtureEnabled(true, "http://127.0.0.1:5173")).toBe(false)
    expect(isDevRuntimeActivityFixtureEnabled(false, undefined)).toBe(false)
    expect(isDevRuntimeActivityFixtureEnabled(false, " ")).toBe(false)
  })

  it("seeds bounded project/run-scoped terminal and replay data without provider state", () => {
    const database = fixtureDatabase()
    const invalidations: string[] = []
    const activityStore = createAgentActivityStore(database, {
      onInvalidated: (event) => invalidations.push(`${event.reason}:${event.runId}`),
    })
    const service = createDevRuntimeActivityFixtureService(database, activityStore, {
      enabled: true,
      onInvalidated: (event) => invalidations.push(`${event.reason}:${event.runId}`),
    })

    expect(service.status(scope)).toMatchObject({ present: false, eventCount: 0, runs: [] })
    const seeded = service.seed(scope)
    expect(seeded.present).toBe(true)
    expect(seeded.runs.map((run) => [run.terminal, run.status, run.runtime])).toEqual([
      ["completed", "success", "codex"],
      ["cancelled", "cancelled", "claude-code"],
      ["failed", "failure", "flapstack-native"],
    ])
    expect(seeded.eventCount).toBe(26)
    expect(seeded.runs.every((run) => run.eventCount > 0)).toBe(true)

    const rows = database
      .prepare(
        `SELECT kind, phase, run_id, sequence, provider, payload_json,
                worktree_path, initial_prompt, runtime_adapter_version,
                started_at, completed_at
         FROM agent_activity_events a
         JOIN agent_runs r ON r.id = a.run_id
         ORDER BY a.storage_id`,
      )
      .all() as Array<Record<string, unknown>>
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(AGENT_ACTIVITY_KINDS))
    expect(new Set(rows.map((row) => row.phase))).toEqual(
      new Set(["queued", "started", "delta", "completed", "cancelled", "failed", "snapshot"]),
    )
    expect(rows.every((row) => row.provider === "flapstack-dev-fixture")).toBe(true)
    expect(rows.every((row) => row.worktree_path === null && row.initial_prompt === null)).toBe(
      true,
    )
    expect(
      rows.every((row) => row.runtime_adapter_version === "flapstack-dev-runtime-fixture-v1"),
    ).toBe(true)
    expect(
      rows.every(
        (row) =>
          Number(row.started_at) < 2_000_000_000 &&
          Number(row.completed_at) === Number(row.started_at) + 30,
      ),
    ).toBe(true)
    expect(JSON.stringify(rows)).not.toMatch(
      /\/Users\/|password|api[_-]?key|bearer\s|BEGIN [A-Z ]+ KEY/i,
    )

    for (const run of seeded.runs) {
      const replay = activityStore.replayRun(run.id, 0, 500)
      expect(replay.map((event) => event.sequence)).toEqual(
        Array.from({ length: replay.length }, (_, index) => index + 1),
      )
    }
    expect(invalidations.filter((value) => value.startsWith("append:")).length).toBe(3)

    const reseeded = service.seed(scope)
    expect(reseeded.eventCount).toBe(26)
    expect(database.prepare("SELECT COUNT(*) count FROM agent_runs").get()).toEqual({ count: 3 })
    expect(database.prepare("SELECT COUNT(*) count FROM agent_activity_events").get()).toEqual({
      count: 26,
    })

    expect(service.reset(scope)).toMatchObject({ present: false, eventCount: 0, runs: [] })
    expect(database.prepare("SELECT COUNT(*) count FROM agent_runs").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) count FROM agent_activity_events").get()).toEqual({
      count: 0,
    })
    expect(invalidations.some((value) => value.startsWith("retention:"))).toBe(true)
  })

  it("fails closed when disabled or when project ownership does not match", () => {
    const database = fixtureDatabase()
    const store = createAgentActivityStore(database)
    const disabled = createDevRuntimeActivityFixtureService(database, store, { enabled: false })
    expect(() => disabled.seed(scope)).toThrow("only in Flapstack Dev")
    expect(database.prepare("SELECT COUNT(*) count FROM agent_runs").get()).toEqual({ count: 0 })

    const enabled = createDevRuntimeActivityFixtureService(database, store, { enabled: true })
    expect(() => enabled.seed({ ...scope, projectId: "other-project" })).toThrow(
      "existing project chat",
    )
    expect(database.prepare("SELECT COUNT(*) count FROM agent_runs").get()).toEqual({ count: 0 })
  })

  it("projects deterministic live/loading/empty/error/stale/corrupt renderer states", () => {
    const events = [activity("agent-text", { text: "fixture answer" })]
    expect(projectDevRuntimeActivityView(events, "live", "ready", null)).toMatchObject({
      status: "live",
      events,
    })
    expect(projectDevRuntimeActivityView(events, "stale", "ready", null).status).toBe("stale")
    expect(projectDevRuntimeActivityView(events, "loading", "ready", null)).toMatchObject({
      status: "loading",
      events: [],
      suppressLegacy: true,
    })
    expect(projectDevRuntimeActivityView(events, "empty", "ready", null)).toMatchObject({
      status: "ready",
      events: [],
      suppressLegacy: true,
    })
    expect(projectDevRuntimeActivityView(events, "error", "ready", null)).toMatchObject({
      status: "error",
      events: [],
      suppressLegacy: true,
    })
    const corrupt = projectDevRuntimeActivityView(events, "corrupt", "ready", null)
    expect(corrupt.events.at(-1)).toMatchObject({
      kind: "private-metadata",
      privacyClass: "private",
      redactionState: "corrupt",
      payload: { eventType: "corrupt-row", metadata: null },
    })
    expect(JSON.stringify(corrupt.events.at(-1))).not.toContain("fixture answer")
  })

  it("keeps the router absent outside Dev and exposes controls in the normal chat UI", () => {
    const routerSource = readFileSync(
      resolve(process.cwd(), "src/main/lib/trpc/routers/index.ts"),
      "utf8",
    )
    const activeChatSource = readFileSync(
      resolve(process.cwd(), "src/renderer/features/agents/main/active-chat.tsx"),
      "utf8",
    )
    expect(routerSource).toContain(
      "const devRuntimeActivityFixturesEnabled = !app.isPackaged && IS_DEV",
    )
    expect(routerSource).toContain("devRuntimeActivityFixturesEnabled")
    expect(activeChatSource).toContain("<RuntimeActivityFixtureControls")
    expect(activeChatSource).toContain("import.meta.env.DEV")
  })
})
