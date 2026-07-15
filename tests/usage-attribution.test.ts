import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import {
  backfillUsageAttribution,
  rebuildUsageAttributionRollups,
} from "../src/main/lib/usage/attribution"
import { applyUsageStorePragmas, insertSamples, type UsageDb } from "../src/main/lib/usage/store"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("usage attribution capture", () => {
  it("snapshots run, chat, task, project, harness, and model across rename, archive, and delete", async () => {
    const { sqlite, db } = database(":memory:")
    try {
      seedRunGraph(sqlite)
      await insertSamples(db, [runSample("run-fact", "run-1", 3)])

      expect(fact(sqlite, "run-fact")).toMatchObject({
        attribution_state: "attributed",
        attribution_harness: "openrouter",
        attribution_project_id: "project-1",
        attribution_project_name: "Original project",
        attribution_task_id: "task-1",
        attribution_task_name: "Original task",
        attribution_chat_id: "chat-1",
        attribution_chat_name: "Original chat",
        attribution_run_id: "run-1",
        model: "openai/gpt-5",
        source_class: "flapstack-run",
        dedupe_strategy: "exact-fact",
      })

      sqlite.prepare("UPDATE projects SET name = 'Renamed project' WHERE id = 'project-1'").run()
      sqlite
        .prepare("UPDATE tasks SET name = 'Renamed task', archived_at = 10 WHERE id = 'task-1'")
        .run()
      sqlite
        .prepare("UPDATE chats SET name = 'Renamed chat', archived_at = 10 WHERE id = 'chat-1'")
        .run()
      expect(fact(sqlite, "run-fact")).toMatchObject({
        attribution_project_name: "Original project",
        attribution_task_name: "Original task",
        attribution_chat_name: "Original chat",
      })

      sqlite.prepare("DELETE FROM projects WHERE id = 'project-1'").run()
      expect(fact(sqlite, "run-fact")).toMatchObject({
        run_id: null,
        attribution_project_id: "project-1",
        attribution_task_id: "task-1",
        attribution_chat_id: "chat-1",
        attribution_run_id: "run-1",
      })
    } finally {
      sqlite.close()
    }
  })

  it("captures exact automation and orchestration identities without guessing", async () => {
    const { sqlite, db } = database(":memory:")
    try {
      seedRunGraph(sqlite)
      seedAutomationAndOrchestration(sqlite)
      await insertSamples(db, [runSample("controlled-fact", "run-1", 1)])

      expect(fact(sqlite, "controlled-fact")).toMatchObject({
        attribution_automation_id: "automation-1",
        attribution_automation_name: "Nightly check",
        attribution_orchestration_id: "task-1",
        attribution_orchestration_name: "Original task",
      })
      sqlite
        .prepare("UPDATE automations SET name = 'Renamed automation' WHERE id = 'automation-1'")
        .run()
      sqlite.prepare("DELETE FROM automations WHERE id = 'automation-1'").run()
      sqlite.prepare("DELETE FROM tasks WHERE id = 'task-1'").run()
      expect(fact(sqlite, "controlled-fact")).toMatchObject({
        attribution_automation_id: "automation-1",
        attribution_automation_name: "Nightly check",
        attribution_orchestration_id: "task-1",
        attribution_orchestration_name: "Original task",
      })
    } finally {
      sqlite.close()
    }
  })

  it("upgrades a deduped external fact when exact run identity arrives", async () => {
    const { sqlite, db } = database(":memory:")
    try {
      seedRunGraph(sqlite)
      await insertSamples(db, [
        {
          providerId: "openrouter",
          source: "external-provider",
          costQuality: "exact",
          generationId: "generation-1",
          costUsd: 1,
          dedupeKey: "openrouter|gen|generation-1",
        },
      ])
      await insertSamples(db, [
        {
          ...runSample("openrouter|gen|generation-1", "run-1", 1),
          generationId: "generation-1",
        },
      ])

      expect(sqlite.prepare("SELECT count(*) AS count FROM usage_samples").get()).toEqual({
        count: 1,
      })
      expect(fact(sqlite, "openrouter|gen|generation-1")).toMatchObject({
        source: "flapstack-run",
        source_class: "flapstack-run",
        attribution_state: "attributed",
        attribution_run_id: "run-1",
      })
    } finally {
      sqlite.close()
    }
  })
})

describe("usage attribution backfill and rebuild", () => {
  it("backfills recoverable legacy facts once and leaves missing identity unknown", () => {
    const { sqlite, db } = database(":memory:")
    try {
      seedRunGraph(sqlite)
      sqlite
        .prepare(
          `INSERT INTO usage_samples (
             id, provider_id, source, cost_quality, cost_usd_micros, run_id, dedupe_key
           ) VALUES
             ('legacy-run', 'openrouter', 'flapstack-run', 'exact', 1000000, 'run-1', 'legacy-run'),
             ('legacy-missing', 'openrouter', 'flapstack-run', 'unknown', NULL, NULL, 'legacy-missing')`,
        )
        .run()

      expect(backfillUsageAttribution(db)).toEqual({
        scanned: 2,
        attributed: 1,
        classified: 2,
        unresolved: 0,
      })
      expect(fact(sqlite, "legacy-run")).toMatchObject({
        attribution_state: "attributed",
        attribution_run_id: "run-1",
        attribution_task_id: "task-1",
        source_class: "flapstack-run",
        dedupe_strategy: "exact-fact",
      })
      expect(fact(sqlite, "legacy-missing")).toMatchObject({
        attribution_state: "unknown",
        attribution_run_id: null,
        source_class: "flapstack-run",
        dedupe_strategy: "exact-fact",
      })
      expect(backfillUsageAttribution(db)).toEqual({
        scanned: 0,
        attributed: 0,
        classified: 0,
        unresolved: 0,
      })
    } finally {
      sqlite.close()
    }
  })

  it("rebuilds deterministic source-separated rollups with explicit quality and provenance", async () => {
    const { sqlite, db } = database(":memory:")
    try {
      seedRunGraph(sqlite)
      const windowStart = new Date("2026-07-01T00:00:00.000Z")
      const windowEnd = new Date("2026-08-01T00:00:00.000Z")
      await insertSamples(db, [
        {
          providerId: "openrouter",
          accountTag: "team",
          source: "app-poll",
          sourceTag: "monthly-cost",
          metricKey: "cost",
          costQuality: "exact",
          costUsd: 10,
          capturedAt: new Date("2026-07-10T00:00:00.000Z"),
          windowStart,
          windowEnd,
          dedupeKey: "provider-old",
        },
        {
          providerId: "openrouter",
          accountTag: "team",
          source: "daemon-poll",
          sourceTag: "monthly-cost",
          metricKey: "cost",
          costQuality: "exact",
          costUsd: 12,
          capturedAt: new Date("2026-07-11T00:00:00.000Z"),
          windowStart,
          windowEnd,
          dedupeKey: "provider-new",
        },
        runSample("run-exact", "run-1", 3),
        {
          providerId: "openrouter",
          source: "external-provider",
          costQuality: "provider-reported",
          costUsd: 4,
          model: "reported-model",
          dedupeKey: "external-reported",
        },
        {
          providerId: "openrouter",
          source: "external-provider",
          costQuality: "estimated",
          costUsdEstimated: 2,
          model: "estimated-model",
          dedupeKey: "external-estimated",
        },
        {
          providerId: "openrouter",
          source: "external-provider",
          costQuality: "unknown",
          model: "unknown-model",
          totalTokens: 5,
          dedupeKey: "external-unknown",
        },
      ])

      const rebuilt = rebuildUsageAttributionRollups(db)
      const providerNewId = String(fact(sqlite, "provider-new").id)
      const runExactId = String(fact(sqlite, "run-exact").id)
      expect(rebuilt.rawFactCount).toBe(6)
      expect(rebuilt.selectedFactCount).toBe(5)

      const providerTotals = rebuilt.rollups.find(
        (rollup) =>
          rollup.dimension === "provider-account" &&
          rollup.sourceClass === "provider-account-total",
      )
      expect(providerTotals).toMatchObject({
        quality: "exact",
        costUsdMicros: 12_000_000,
        factIds: [providerNewId],
      })
      const runRollup = rebuilt.rollups.find(
        (rollup) => rollup.dimension === "run" && rollup.value === "run-1",
      )
      expect(runRollup).toMatchObject({
        sourceClass: "flapstack-run",
        quality: "exact",
        factIds: [runExactId],
        provenance: [
          {
            factId: runExactId,
            source: "flapstack-run",
            sourceClass: "flapstack-run",
            costQuality: "exact",
            attributionState: "attributed",
          },
        ],
      })
      expect(
        rebuilt.rollups.find(
          (rollup) => rollup.dimension === "model" && rollup.value === "reported-model",
        )?.quality,
      ).toBe("provider-reported")
      expect(
        rebuilt.rollups.find(
          (rollup) => rollup.dimension === "model" && rollup.value === "estimated-model",
        )?.quality,
      ).toBe("estimated")
      expect(
        rebuilt.rollups.find(
          (rollup) => rollup.dimension === "model" && rollup.value === "unknown-model",
        )?.quality,
      ).toBe("unknown")
    } finally {
      sqlite.close()
    }
  })

  it("preserves the first snapshot across dedupe updates and database restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-usage-attribution-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "usage.db")
    const first = database(path)
    seedRunGraph(first.sqlite)
    await insertSamples(first.db, [runSample("restart-fact", "run-1", 1)])
    first.sqlite.prepare("UPDATE tasks SET name = 'Later task name' WHERE id = 'task-1'").run()
    await insertSamples(first.db, [runSample("restart-fact", "run-1", 2)])

    expect(fact(first.sqlite, "restart-fact")).toMatchObject({
      attribution_task_name: "Original task",
      cost_usd_micros: 2_000_000,
    })
    const beforeRestart = rebuildUsageAttributionRollups(first.db)
    expect(rebuildUsageAttributionRollups(first.db)).toEqual(beforeRestart)
    first.sqlite.close()

    const sqlite = new Database(path)
    applyUsageStorePragmas(sqlite)
    const db = drizzle(sqlite, { schema })
    try {
      expect(rebuildUsageAttributionRollups(db)).toEqual(beforeRestart)
      expect(sqlite.prepare("SELECT count(*) AS count FROM usage_samples").get()).toEqual({
        count: 1,
      })
    } finally {
      sqlite.close()
    }
  })
})

function database(path: string): { sqlite: Database.Database; db: UsageDb } {
  const sqlite = new Database(path)
  applyUsageStorePragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  migrateDatabase(db, sqlite, resolve(process.cwd(), "drizzle"))
  return { sqlite, db }
}

function seedRunGraph(sqlite: Database.Database): void {
  sqlite
    .prepare(
      "INSERT INTO projects (id, name, path) VALUES ('project-1', 'Original project', '/tmp/project-1')",
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Original task')",
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (
         id, name, project_id, task_id, scope, permission_mode, harness, model
       ) VALUES (
         'chat-1', 'Original chat', 'project-1', 'task-1', 'task',
         'ask-before-edits', 'openrouter', 'openai/gpt-5'
       )`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
         id, chat_id, harness, model, permission_mode, status
       ) VALUES (
         'run-1', 'chat-1', 'openrouter', 'openai/gpt-5', 'ask-before-edits', 'success'
       )`,
    )
    .run()
}

function seedAutomationAndOrchestration(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO task_orchestrations (
         task_id, initiating_chat_id, engine_snapshot_version, coordination_engine,
         coordination_engine_version, coordination_engine_source,
         coordination_engine_capability_snapshot, coordination_engine_provider_identity
       ) VALUES ('task-1', 'chat-1', ?, ?, ?, ?, ?, ?)`,
    )
    .run(...testCoordinationEngineSnapshotSqlValues())
  sqlite
    .prepare(
      `INSERT INTO orchestration_agents (id, task_id, chat_id, run_id, definition)
       VALUES ('agent-1', 'task-1', 'chat-1', 'run-1', '{}')`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automations (
         id, name, scope_type, chat_id, action_type, action_config, prompt,
         harness, permission_mode, state, enabled, approval_state
       ) VALUES (
         'automation-1', 'Nightly check', 'chat', 'chat-1', 'run-chat', '{}', 'Check',
         'openrouter', 'ask-before-edits', 'draft', 0, 'pending'
       )`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_triggers (id, automation_id, type)
       VALUES ('trigger-1', 'automation-1', 'manual')`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_occurrences (
         id, automation_id, trigger_id, dedupe_key, scheduled_for
       ) VALUES ('occurrence-1', 'automation-1', 'trigger-1', 'manual-1', 1)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_executions (
         id, occurrence_id, run_id, authority_snapshot, budget_snapshot
       ) VALUES ('execution-1', 'occurrence-1', 'run-1', '{}', '{}')`,
    )
    .run()
}

function runSample(id: string, runId: string, costUsd: number) {
  return {
    providerId: "openrouter" as const,
    source: "flapstack-run" as const,
    costQuality: "exact" as const,
    costUsd,
    runId,
    dedupeKey: id,
  }
}

function fact(sqlite: Database.Database, id: string): Record<string, unknown> {
  return sqlite.prepare("SELECT * FROM usage_samples WHERE dedupe_key = ?").get(id) as Record<
    string,
    unknown
  >
}
