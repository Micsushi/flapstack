import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import {
  usageAttributionSnapshotSchema,
  usageBudgetActions,
  usageBudgetPolicyDtoSchema,
  usageBudgetResetTypes,
  usageBudgetScopeTypes,
  usageBudgetThresholdTypes,
  usageFactClassificationSchema,
  usageSourceClasses,
} from "../src/shared/advanced-usage"

const migrations = resolve(process.cwd(), "drizzle")
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("advanced usage contracts", () => {
  it("publishes stable source, scope, threshold, action, and reset contracts", () => {
    expect(usageSourceClasses).toEqual([
      "provider-account-total",
      "flapstack-run",
      "external-provider",
      "unknown",
    ])
    expect(usageBudgetScopeTypes).toEqual([
      "global",
      "provider-account",
      "project",
      "task",
      "automation",
      "orchestration",
    ])
    expect(usageBudgetThresholdTypes).toEqual([
      "cost-usd-micros",
      "total-tokens",
      "request-count",
      "quota-percent-micros",
    ])
    expect(usageBudgetActions).toEqual(["soft-alert", "hard-stop"])
    expect(usageBudgetResetTypes).toEqual(["none", "daily", "weekly", "monthly", "provider-cycle"])
  })

  it("keeps unknown attribution explicit and rejects inferred unknown values", () => {
    const unknown = {
      state: "unknown" as const,
      harness: null,
      projectId: null,
      projectName: null,
      taskId: null,
      taskName: null,
      chatId: null,
      chatName: null,
      automationId: null,
      automationName: null,
      orchestrationId: null,
      orchestrationName: null,
      runId: null,
    }
    expect(usageAttributionSnapshotSchema.parse(unknown)).toEqual(unknown)
    expect(
      usageAttributionSnapshotSchema.safeParse({ ...unknown, projectId: "project-1" }).success,
    ).toBe(false)
    expect(
      usageAttributionSnapshotSchema.safeParse({ ...unknown, state: "attributed" }).success,
    ).toBe(false)
  })

  it("requires explicit overlap groups and rejects invalid budget combinations", () => {
    expect(
      usageFactClassificationSchema.safeParse({
        sourceClass: "provider-account-total",
        dedupeStrategy: "overlap-group",
        dedupeGroupKey: null,
      }).success,
    ).toBe(false)
    expect(
      usageFactClassificationSchema.safeParse({
        sourceClass: "provider-account-total",
        dedupeStrategy: "overlap-group",
        dedupeGroupKey: "codex|team|2026-07",
      }).success,
    ).toBe(true)

    const policy = validPolicy()
    expect(usageBudgetPolicyDtoSchema.parse(policy)).toEqual(policy)
    expect(
      usageBudgetPolicyDtoSchema.safeParse({
        ...policy,
        scope: { type: "provider-account", providerId: "codex", accountTag: null },
        action: "hard-stop",
      }).success,
    ).toBe(false)
    expect(
      usageBudgetPolicyDtoSchema.safeParse({
        ...policy,
        threshold: { type: "quota-percent-micros", value: 80_000_000 },
      }).success,
    ).toBe(false)
    expect(
      usageBudgetPolicyDtoSchema.safeParse({
        ...policy,
        reset: { type: "provider-cycle" },
      }).success,
    ).toBe(false)
  })
})

describe("advanced usage schema", () => {
  it("persists attributed facts and constrained saved budgets", () => {
    const { sqlite } = database("fresh")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      seedProjectTask(sqlite)
      sqlite
        .prepare(
          `INSERT INTO usage_samples (
            id, provider_id, source, cost_quality, attribution_state,
            attribution_harness, attribution_project_id, attribution_project_name,
            attribution_run_id, source_class, dedupe_strategy, dedupe_group_key, dedupe_key
          ) VALUES (
            'sample-1', 'codex', 'flapstack-run', 'exact', 'attributed',
            'codex', 'project-1', 'Original project', 'run-1',
            'flapstack-run', 'overlap-group', 'codex|team|window-1', 'sample-1'
          )`,
        )
        .run()
      sqlite
        .prepare(
          `INSERT INTO usage_budgets (
            id, name, scope_type, project_id, threshold_type, threshold_value,
            action, reset_type, reset_timezone
          ) VALUES (
            'budget-1', 'Project cap', 'project', 'project-1', 'cost-usd-micros',
            1000000, 'hard-stop', 'monthly', 'America/Vancouver'
          )`,
        )
        .run()

      expect(
        sqlite
          .prepare(
            `SELECT attribution_state, attribution_project_id, attribution_project_name,
                    source_class, dedupe_strategy, dedupe_group_key
             FROM usage_samples WHERE id = 'sample-1'`,
          )
          .get(),
      ).toEqual({
        attribution_state: "attributed",
        attribution_project_id: "project-1",
        attribution_project_name: "Original project",
        source_class: "flapstack-run",
        dedupe_strategy: "overlap-group",
        dedupe_group_key: "codex|team|window-1",
      })
      expect(indexNames(sqlite, "usage_samples")).toEqual(
        expect.arrayContaining([
          "usage_samples_source_class_captured_idx",
          "usage_samples_project_captured_idx",
          "usage_samples_dedupe_group_idx",
        ]),
      )
      expect(indexNames(sqlite, "usage_budgets")).toEqual(
        expect.arrayContaining(["usage_budgets_scope_idx", "usage_budgets_enabled_action_idx"]),
      )

      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO usage_budgets (
              id, name, scope_type, provider_id, threshold_type, threshold_value, action
            ) VALUES (
              'bad-hard-stop', 'Bad', 'provider-account', 'codex',
              'cost-usd-micros', 1000000, 'hard-stop'
            )`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO usage_samples (
              id, provider_id, source, attribution_state, attribution_project_id,
              source_class, dedupe_strategy, dedupe_key
            ) VALUES (
              'bad-unknown', 'codex', 'flapstack-run', 'unknown', 'project-1',
              'unknown', 'unknown', 'bad-unknown'
            )`,
          )
          .run(),
      ).toThrow(/check constraint/i)
    } finally {
      sqlite.close()
    }
  })

  it.each([
    { name: "usage-baseline", lastMigration: 15 },
    { name: "consolidated-main", lastMigration: 20 },
    { name: "Stage-3-release", lastMigration: 22 },
    { name: "automation-contracts", lastMigration: 28 },
  ])(
    "migrates the $name fixture without changing prior sample facts",
    ({ name, lastMigration }) => {
      const { directory, sqlite } = database(name)
      try {
        migrate(drizzle(sqlite, { schema }), {
          migrationsFolder: migrationSubset(directory, lastMigration),
        })
        seedLegacySample(sqlite)
        const before = legacySample(sqlite)

        migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)

        expect(legacySample(sqlite)).toEqual(before)
        expect(
          sqlite
            .prepare(
              `SELECT attribution_state, attribution_harness, attribution_project_id,
                    attribution_task_id, attribution_chat_id, attribution_automation_id,
                    attribution_orchestration_id, attribution_run_id, source_class,
                    dedupe_strategy, dedupe_group_key
             FROM usage_samples WHERE id = 'legacy-sample'`,
            )
            .get(),
        ).toEqual({
          attribution_state: "unknown",
          attribution_harness: null,
          attribution_project_id: null,
          attribution_task_id: null,
          attribution_chat_id: null,
          attribution_automation_id: null,
          attribution_orchestration_id: null,
          attribution_run_id: null,
          source_class: "unknown",
          dedupe_strategy: "unknown",
          dedupe_group_key: null,
        })
        expect(sqlite.prepare("SELECT count(*) count FROM usage_budgets").get()).toEqual({
          count: 0,
        })
        expect(sqlite.pragma("foreign_key_check")).toEqual([])
      } finally {
        sqlite.close()
      }
    },
  )
})

function validPolicy() {
  return {
    id: "budget-1",
    name: "Project budget",
    enabled: true,
    scope: { type: "project" as const, projectId: "project-1" },
    threshold: { type: "cost-usd-micros" as const, value: 5_000_000 },
    action: "hard-stop" as const,
    reset: { type: "monthly" as const, timezone: "America/Vancouver" },
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function database(name: string): { directory: string; sqlite: Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-advanced-usage-${name}-`))
  temporaryDirectories.push(directory)
  const sqlite = new Database(join(directory, "agents.db"))
  sqlite.pragma("foreign_keys = ON")
  return { directory, sqlite }
}

function seedProjectTask(sqlite: Database.Database): void {
  sqlite.prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/p1')").run()
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
}

function seedLegacySample(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO usage_samples (
        id, provider_id, account_tag, source, cost_quality, source_tag, metric_key,
        captured_at, window_start, window_end, input_tokens, output_tokens,
        reasoning_tokens, total_tokens, request_count, cost_usd_micros,
        cost_usd_estimated_micros, currency, percent_used, quota_used, quota_limit,
        quota_unit, reset_at, model, generation_id, raw_payload, dedupe_key, created_at
      ) VALUES (
        'legacy-sample', 'codex', 'team-a', 'daemon-poll', 'provider-reported',
        'organization-cost', 'credits', 100, 10, 200, 11, 12, 13, 36, 2,
        1234567, 1200000, 'USD', 45, 9, 20, 'provider-native', 300,
        'gpt-5', 'generation-1', '{"safe":true}', 'legacy-dedupe', 101
      )`,
    )
    .run()
}

function legacySample(sqlite: Database.Database): unknown {
  return sqlite
    .prepare(
      `SELECT id, provider_id, account_tag, source, cost_quality, source_tag, metric_key,
              captured_at, window_start, window_end, input_tokens, output_tokens,
              reasoning_tokens, total_tokens, request_count, cost_usd_micros,
              cost_usd_estimated_micros, currency, percent_used, quota_used, quota_limit,
              quota_unit, reset_at, model, generation_id, raw_payload, dedupe_key, created_at
       FROM usage_samples WHERE id = 'legacy-sample'`,
    )
    .get()
}

function migrationSubset(directory: string, lastIndex: number): string {
  const target = join(directory, `migrations-through-${lastIndex}`)
  mkdirSync(join(target, "meta"), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8")) as {
    version: string
    dialect: string
    entries: Array<{ idx: number; tag: string }>
  }
  const subset = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= lastIndex) }
  writeFileSync(join(target, "meta", "_journal.json"), `${JSON.stringify(subset, null, 2)}\n`)
  for (const entry of subset.entries) {
    cpSync(join(migrations, `${entry.tag}.sql`), join(target, `${entry.tag}.sql`))
  }
  return target
}

function indexNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.pragma(`index_list('${table}')`) as Array<{ name: string }>).map((row) => row.name)
}
