import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { runAlerts } from "../src/main/lib/usage/alert-runner"
import { UsageEngine } from "../src/main/lib/usage/engine"
import { getUsageProvider } from "../src/main/lib/usage/registry"
import { normalizeUsageSettings } from "../src/main/lib/usage/settings"
import {
  insertSamples,
  listRecentAlertEvents,
  listRecentCycles,
  listRecentSamples,
  upsertProviderState,
  type UsageDb,
} from "../src/main/lib/usage/store"
import type { UsageSampleInput } from "../src/main/lib/usage/types"

describe("usage SQLite integration", () => {
  let sqlite: Database.Database | null
  let db: UsageDb

  beforeEach(() => {
    sqlite = new Database(":memory:")
    sqlite.exec("CREATE TABLE agent_runs (id text PRIMARY KEY)")
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0009_exotic_red_wolf.sql"),
      "utf8",
    ).replaceAll("--> statement-breakpoint", "")
    sqlite.exec(migration)
    db = drizzle(sqlite, { schema })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sqlite?.close()
    sqlite = null
  })

  it("refreshes a changing bucket and merges cost plus tokens into one cycle", async () => {
    const windowStart = new Date("2026-07-10T00:00:00Z")
    const windowEnd = new Date("2026-07-11T00:00:00Z")
    await insertSamples(db, [
      sample({
        sourceTag: "organization-cost",
        costUsd: 1,
        windowStart,
        windowEnd,
        dedupeKey: "codex|cost|2026-07-10",
      }),
    ])
    await insertSamples(db, [
      sample({
        sourceTag: "organization-cost",
        costUsd: 2,
        windowStart,
        windowEnd,
        dedupeKey: "codex|cost|2026-07-10",
      }),
      sample({
        sourceTag: "organization-usage",
        costQuality: "unknown",
        totalTokens: 123,
        windowStart,
        windowEnd,
        dedupeKey: "codex|usage|2026-07-10",
      }),
    ])

    const samples = await listRecentSamples(db)
    const cycles = await listRecentCycles(db)
    expect(samples).toHaveLength(2)
    expect(samples.find((row) => row.sourceTag === "organization-cost")?.costUsd).toBe(2_000_000)
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatchObject({ totalCostUsd: 2_000_000, totalTokens: 123 })
  })

  it("sends one Discord alert for multiple high samples in the same poll", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetch)
    const settings = normalizeUsageSettings({})
    settings.discordAlertsEnabled = true
    settings.providers.cursor.enabled = true
    settings.providers.cursor.thresholds.quotaPercent = [80]
    const samples: UsageSampleInput[] = [
      cursorSample(85, new Date("2026-07-10T12:00:00Z")),
      cursorSample(90, new Date("2026-07-10T12:01:00Z")),
    ]
    await insertSamples(db, samples)
    const sent = await runAlerts({
      db,
      settings,
      getSecret: async () => "https://discord.com/api/webhooks/1/test",
      provider: getUsageProvider("cursor")!,
      samples,
    })
    expect(sent).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await listRecentAlertEvents(db)).toHaveLength(1)
  })

  it("skips a daemon provider until its cadence elapses", async () => {
    await upsertProviderState(db, {
      providerId: "cursor",
      status: "ok",
      configured: true,
      supportsDaemon: true,
      supportsHistorical: false,
    })
    const settings = normalizeUsageSettings({})
    settings.providers.cursor.enabled = true
    settings.providers.cursor.cadenceSecondsOverride = 600
    const engine = new UsageEngine("daemon", {
      db,
      getSecret: async () => null,
      loadSettings: () => settings,
    })
    await expect(engine.runOnce()).resolves.toEqual([])
  })

  it("runs the complete Drizzle migration chain with usage tables queryable", () => {
    const fullSqlite = new Database(":memory:")
    try {
      const fullDb = drizzle(fullSqlite, { schema })
      migrate(fullDb, { migrationsFolder: resolve(process.cwd(), "drizzle") })
      const names = fullSqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'usage_%'")
        .all() as Array<{ name: string }>
      expect(names.map((row) => row.name).sort()).toEqual([
        "usage_alert_arm_states",
        "usage_alert_events",
        "usage_cycles",
        "usage_daemon_status",
        "usage_provider_states",
        "usage_samples",
      ])
    } finally {
      fullSqlite.close()
    }
  })
})

function sample(overrides: Partial<UsageSampleInput>): UsageSampleInput {
  return {
    providerId: "codex",
    source: "daemon-poll",
    costQuality: "provider-reported",
    capturedAt: new Date("2026-07-10T12:00:00Z"),
    ...overrides,
  }
}

function cursorSample(percentUsed: number, capturedAt: Date): UsageSampleInput {
  return {
    providerId: "cursor",
    source: "daemon-poll",
    sourceTag: "internal",
    costQuality: "provider-reported",
    percentUsed,
    capturedAt,
  }
}
