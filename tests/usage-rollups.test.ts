import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import { queryUsageRollups, rebuildUsageRollupCache } from "../src/main/lib/usage/rollups"
import { applyUsageStorePragmas, insertSamples, type UsageDb } from "../src/main/lib/usage/store"
import { usageRollupQuerySchema } from "../src/shared/advanced-usage"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"

describe("usage rollup queries", () => {
  it("reconciles a golden provider total with overlapping run facts by metric", async () => {
    const { sqlite, db } = database()
    try {
      seedRunGraph(sqlite)
      seedAutomationAndOrchestration(sqlite)
      const windowStart = new Date("2026-07-01T00:00:00.000Z")
      const windowEnd = new Date("2026-07-02T00:00:00.000Z")
      await insertSamples(db, [
        {
          providerId: "openrouter",
          accountTag: "team",
          source: "daemon-poll",
          sourceTag: "daily-cost",
          metricKey: "cost",
          costQuality: "exact",
          costUsd: 10,
          capturedAt: new Date("2026-07-01T12:00:00.000Z"),
          windowStart,
          windowEnd,
          dedupeKey: "provider-total",
        },
        {
          providerId: "openrouter",
          accountTag: "team",
          source: "flapstack-run",
          costQuality: "exact",
          costUsd: 3,
          totalTokens: 100,
          capturedAt: new Date("2026-07-01T10:00:00.000Z"),
          runId: "run-1",
          dedupeKey: "run-exact",
        },
        {
          providerId: "openrouter",
          accountTag: "team",
          source: "flapstack-run",
          costQuality: "estimated",
          costUsdEstimated: 2,
          totalTokens: 50,
          capturedAt: new Date("2026-07-01T11:00:00.000Z"),
          runId: "run-1",
          dedupeKey: "run-estimated",
        },
      ])

      const all = queryUsageRollups(db, {
        scope: { type: "global" },
        providerIds: ["openrouter"],
      })
      expect(all.totals.metrics).toMatchObject({
        costUsdMicros: 10_000_000,
        costUsdEstimatedMicros: null,
        totalTokens: 150,
      })
      expect(all.totals.quality).toBe("estimated")
      expect(all.totals.factIds).toEqual(
        factIds(sqlite, ["provider-total", "run-exact", "run-estimated"]),
      )
      expect(all.reconciliation).toMatchObject({
        rawFactCount: 3,
        selectedFactCount: 3,
        contributingFactCount: 3,
        suppressedMetricCount: 2,
      })

      const runs = queryUsageRollups(db, {
        scope: { type: "global" },
        providerIds: ["openrouter"],
        sourceClasses: ["flapstack-run"],
      })
      expect(runs.totals.metrics).toMatchObject({
        costUsdMicros: 3_000_000,
        costUsdEstimatedMicros: 2_000_000,
        totalTokens: 150,
      })

      const project = queryUsageRollups(db, {
        scope: { type: "project", id: "project-1" },
        groupBy: "task",
      })
      expect(project.items).toHaveLength(1)
      expect(project.items[0]).toMatchObject({
        dimension: "task",
        value: "task-1",
        label: "Original task",
        quality: "estimated",
        metrics: {
          costUsdMicros: 3_000_000,
          costUsdEstimatedMicros: 2_000_000,
          totalTokens: 150,
        },
      })

      const runFactIds = factIds(sqlite, ["run-exact", "run-estimated"])
      const scopes = [
        { type: "provider-account", providerId: "openrouter", accountTag: "team" },
        { type: "project", id: "project-1" },
        { type: "task", id: "task-1" },
        { type: "chat", id: "chat-1" },
        { type: "automation", id: "automation-1" },
        { type: "orchestration", id: "task-1" },
        { type: "run", id: "run-1" },
      ] as const
      for (const scope of scopes) {
        const scoped = queryUsageRollups(db, { scope })
        expect(scoped.totals.factIds).toEqual(
          scope.type === "provider-account" ? all.totals.factIds : runFactIds,
        )
      }

      expect(
        queryUsageRollups(db, {
          scope: { type: "global" },
          harnesses: ["openrouter"],
          models: ["openai/gpt-5"],
        }).totals.factIds,
      ).toEqual(runFactIds)
    } finally {
      sqlite.close()
    }
  })

  it("does not infer that an unscoped run belongs to an organization total", async () => {
    const { sqlite, db } = database()
    try {
      seedRunGraph(sqlite)
      sqlite
        .prepare(
          `INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status)
           VALUES (?, 'chat-1', 'codex', 'ask-before-edits', 'completed')`,
        )
        .run("run-contained")
      const windowStart = new Date("2026-07-01T00:00:00.000Z")
      const windowEnd = new Date("2026-07-02T00:00:00.000Z")
      await insertSamples(db, [
        {
          providerId: "codex",
          accountTag: "openai-org:org-a:project:project-a",
          source: "daemon-poll",
          sourceTag: "organization-cost",
          metricKey: "cost",
          costQuality: "provider-reported",
          costUsd: 10,
          capturedAt: new Date("2026-07-02T01:00:00.000Z"),
          windowStart,
          windowEnd,
          dedupeKey: "org-total",
        },
        {
          providerId: "codex",
          accountTag: "legacy-run-identity",
          source: "flapstack-run",
          sourceTag: "runtime",
          costQuality: "exact",
          costUsd: 3,
          capturedAt: new Date("2026-07-01T10:00:00.000Z"),
          windowStart: new Date("2026-07-01T09:59:00.000Z"),
          windowEnd: new Date("2026-07-01T10:01:00.000Z"),
          runId: "run-contained",
          dedupeKey: "contained-run",
        },
      ])

      const combined = queryUsageRollups(db, {
        scope: { type: "global" },
        providerIds: ["codex"],
      })
      expect(combined.totals.metrics.costUsdMicros).toBe(13_000_000)
      expect(combined.reconciliation.suppressedMetricCount).toBe(0)

      const runs = queryUsageRollups(db, {
        scope: { type: "global" },
        providerIds: ["codex"],
        sourceClasses: ["flapstack-run"],
      })
      expect(runs.totals.metrics.costUsdMicros).toBe(3_000_000)
    } finally {
      sqlite.close()
    }
  })

  it("suppresses an organization-contained run only with the same exact account scope", async () => {
    const { sqlite, db } = database()
    try {
      seedRunGraph(sqlite)
      const accountTag = "openai-org:org-a:project:project-a"
      const windowStart = new Date("2026-07-01T00:00:00.000Z")
      const windowEnd = new Date("2026-07-02T00:00:00.000Z")
      await insertSamples(db, [
        {
          providerId: "codex",
          accountTag,
          source: "daemon-poll",
          sourceTag: "organization-cost",
          costQuality: "provider-reported",
          costUsd: 10,
          capturedAt: new Date("2026-07-02T01:00:00.000Z"),
          windowStart,
          windowEnd,
          dedupeKey: "org-total",
        },
        {
          providerId: "codex",
          accountTag,
          source: "flapstack-run",
          sourceTag: "runtime",
          costQuality: "exact",
          costUsd: 3,
          capturedAt: new Date("2026-07-01T10:00:00.000Z"),
          windowStart: new Date("2026-07-01T09:59:00.000Z"),
          windowEnd: new Date("2026-07-01T10:01:00.000Z"),
          runId: "run-1",
          dedupeKey: "contained-run",
        },
      ])

      const combined = queryUsageRollups(db, {
        scope: { type: "global" },
        providerIds: ["codex"],
      })
      expect(combined.totals.metrics.costUsdMicros).toBe(10_000_000)
      expect(combined.reconciliation.suppressedMetricCount).toBe(1)
    } finally {
      sqlite.close()
    }
  })

  it("does not mix explicit organization boundaries during reconciliation", async () => {
    const { sqlite, db } = database()
    try {
      seedRunGraph(sqlite)
      const windowStart = new Date("2026-07-01T00:00:00.000Z")
      const windowEnd = new Date("2026-07-02T00:00:00.000Z")
      await insertSamples(db, [
        {
          providerId: "codex",
          accountTag: "openai-org:org-a:project:project-a",
          source: "daemon-poll",
          sourceTag: "organization-cost",
          costQuality: "provider-reported",
          costUsd: 10,
          capturedAt: new Date("2026-07-02T01:00:00.000Z"),
          windowStart,
          windowEnd,
          dedupeKey: "org-a-total",
        },
        {
          providerId: "codex",
          accountTag: "openai-org:org-b:project:project-b",
          source: "flapstack-run",
          sourceTag: "runtime",
          costQuality: "exact",
          costUsd: 4,
          capturedAt: new Date("2026-07-01T10:00:00.000Z"),
          windowStart: new Date("2026-07-01T09:59:00.000Z"),
          windowEnd: new Date("2026-07-01T10:01:00.000Z"),
          runId: "run-1",
          dedupeKey: "org-b-run",
        },
      ])

      const combined = queryUsageRollups(db, {
        scope: { type: "global" },
        providerIds: ["codex"],
      })
      expect(combined.totals.metrics.costUsdMicros).toBe(14_000_000)
      expect(combined.reconciliation.suppressedMetricCount).toBe(0)
    } finally {
      sqlite.close()
    }
  })

  it("keeps only the latest cumulative fact in one overlap group", async () => {
    const { sqlite, db } = database()
    try {
      const windowStart = new Date("2026-07-01T00:00:00.000Z")
      const windowEnd = new Date("2026-08-01T00:00:00.000Z")
      await insertSamples(db, [
        providerFact("provider-old", 8, "2026-07-10T00:00:00.000Z", windowStart, windowEnd),
        providerFact("provider-new", 12, "2026-07-11T00:00:00.000Z", windowStart, windowEnd),
      ])

      const result = queryUsageRollups(db, { scope: { type: "global" } })
      expect(result.reconciliation).toMatchObject({ rawFactCount: 2, selectedFactCount: 1 })
      expect(result.totals.metrics.costUsdMicros).toBe(12_000_000)
      expect(result.totals.factIds).toEqual(factIds(sqlite, ["provider-new"]))
    } finally {
      sqlite.close()
    }
  })

  it("builds timezone-aware day buckets across local midnight", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, [
        externalFact("before-midnight", "2026-07-01T06:30:00.000Z", "model-a", 2),
        externalFact("after-midnight", "2026-07-01T07:30:00.000Z", "model-a", 3),
      ])

      const result = queryUsageRollups(db, {
        scope: { type: "global" },
        timezone: "America/Vancouver",
        bucket: "day",
      })
      expect(result.items.map((item) => item.bucketStartMs)).toEqual([
        Date.parse("2026-06-30T07:00:00.000Z"),
        Date.parse("2026-07-01T07:00:00.000Z"),
      ])
      expect(result.items.map((item) => item.metrics.totalTokens)).toEqual([2, 3])
    } finally {
      sqlite.close()
    }
  })

  it("paginates stable grouped results without changing full totals", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, [
        externalFact("model-a", "2026-07-01T01:00:00.000Z", "model-a", 1),
        externalFact("model-b", "2026-07-01T02:00:00.000Z", "model-b", 2),
        externalFact("model-c", "2026-07-01T03:00:00.000Z", "model-c", 3),
      ])

      const first = queryUsageRollups(db, {
        scope: { type: "global" },
        groupBy: "model",
        limit: 2,
      })
      expect(first.items.map((item) => item.value)).toEqual(["model-a", "model-b"])
      expect(first.page).toMatchObject({ totalItems: 3 })
      expect(first.page.nextCursor).toEqual(expect.any(String))
      expect(first.totals.metrics.totalTokens).toBe(6)

      const second = queryUsageRollups(db, {
        scope: { type: "global" },
        groupBy: "model",
        limit: 2,
        cursor: first.page.nextCursor,
      })
      expect(second.items.map((item) => item.value)).toEqual(["model-c"])
      expect(second.page.nextCursor).toBeNull()
      expect(second.totals.metrics.totalTokens).toBe(6)
    } finally {
      sqlite.close()
    }
  })

  it("invalidates on writes and can rebuild its raw-fact cache", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, [externalFact("cached", "2026-07-01T01:00:00.000Z", "m", 1)])
      const first = queryUsageRollups(db, { scope: { type: "global" } })
      sqlite.prepare("UPDATE usage_samples SET total_tokens = 9 WHERE dedupe_key = 'cached'").run()
      const updated = queryUsageRollups(db, { scope: { type: "global" } })
      expect(updated.cache.revision).not.toBe(first.cache.revision)
      expect(updated.totals.metrics.totalTokens).toBe(9)

      const rebuilt = rebuildUsageRollupCache(db)
      expect(rebuilt).toMatchObject({ rawFactCount: 1, selectedFactCount: 1 })
      expect(queryUsageRollups(db, { scope: { type: "global" } }).totals.metrics.totalTokens).toBe(
        9,
      )
    } finally {
      sqlite.close()
    }
  })

  it("preserves sparse nulls and zeroes while propagating unknown quality", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, [
        {
          providerId: "openrouter",
          source: "external-provider",
          costQuality: "unknown",
          inputTokens: 0,
          totalTokens: 7,
          dedupeKey: "sparse",
        },
      ])

      const result = queryUsageRollups(db, { scope: { type: "global" } })
      expect(result.totals).toMatchObject({
        quality: "unknown",
        metrics: {
          inputTokens: 0,
          outputTokens: null,
          totalTokens: 7,
          costUsdMicros: null,
          costUsdEstimatedMicros: null,
        },
      })
      expect(result.totals.factIds).toEqual(factIds(sqlite, ["sparse"]))
    } finally {
      sqlite.close()
    }
  })

  it("rejects invalid ranges, timezones, and cursors", () => {
    expect(
      usageRollupQuerySchema.safeParse({ fromMs: 10, toMs: 10, timezone: "UTC" }).success,
    ).toBe(false)
    expect(usageRollupQuerySchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false)

    const { sqlite, db } = database()
    try {
      expect(() =>
        queryUsageRollups(db, { scope: { type: "global" }, cursor: "not-a-cursor" }),
      ).toThrow("Invalid usage rollup cursor")
    } finally {
      sqlite.close()
    }
  })
})

function database(): { sqlite: Database.Database; db: UsageDb } {
  const sqlite = new Database(":memory:")
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
      `INSERT INTO agent_runs (id, chat_id, harness, model, permission_mode, status)
       VALUES ('run-1', 'chat-1', 'openrouter', 'openai/gpt-5', 'ask-before-edits', 'success')`,
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

function providerFact(
  dedupeKey: string,
  costUsd: number,
  capturedAt: string,
  windowStart: Date,
  windowEnd: Date,
) {
  return {
    providerId: "openrouter" as const,
    accountTag: "team",
    source: "daemon-poll" as const,
    sourceTag: "monthly-cost",
    metricKey: "cost",
    costQuality: "exact" as const,
    costUsd,
    capturedAt: new Date(capturedAt),
    windowStart,
    windowEnd,
    dedupeKey,
  }
}

function externalFact(dedupeKey: string, capturedAt: string, model: string, totalTokens: number) {
  return {
    providerId: "openrouter" as const,
    source: "external-provider" as const,
    costQuality: "exact" as const,
    capturedAt: new Date(capturedAt),
    model,
    totalTokens,
    dedupeKey,
  }
}

function factIds(sqlite: Database.Database, dedupeKeys: string[]): string[] {
  const select = sqlite.prepare("SELECT id FROM usage_samples WHERE dedupe_key = ?")
  return dedupeKeys
    .map((key) => String((select.get(key) as { id: string }).id))
    .sort((left, right) => left.localeCompare(right))
}
