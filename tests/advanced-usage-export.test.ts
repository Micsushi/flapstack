import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import { exportAdvancedUsage, queryAdvancedUsageExplorer } from "../src/main/lib/usage/explorer"
import { applyUsageStorePragmas, insertSamples, type UsageDb } from "../src/main/lib/usage/store"

describe("advanced usage normalized export", () => {
  it("uses the exact selected filters for explorer, JSON, and CSV facts", async () => {
    const fixture = database()
    try {
      await insertSamples(fixture.db, [
        {
          providerId: "openrouter",
          accountTag: "team",
          source: "external-provider",
          sourceTag: "generation",
          costQuality: "estimated",
          capturedAt: new Date("2026-07-10T10:00:00.000Z"),
          model: "openai/gpt-5",
          totalTokens: 900,
          costUsdEstimated: 0.012,
          pricingVersion: "catalog-2026-07",
          dedupeKey: "selected",
        },
        {
          providerId: "openrouter",
          accountTag: "other",
          source: "external-provider",
          costQuality: "exact",
          capturedAt: new Date("2026-07-10T11:00:00.000Z"),
          model: "openai/gpt-5",
          totalTokens: 500,
          costUsd: 0.02,
          dedupeKey: "wrong-quality",
        },
        {
          providerId: "anthropic",
          source: "external-provider",
          costQuality: "estimated",
          capturedAt: new Date("2026-07-10T12:00:00.000Z"),
          model: "claude-sonnet",
          totalTokens: 700,
          costUsdEstimated: 0.03,
          dedupeKey: "wrong-provider",
        },
      ])
      const query = {
        scope: { type: "global" as const },
        providerIds: ["openrouter"],
        accountTags: ["team"],
        models: ["openai/gpt-5"],
        sources: ["external-provider"],
        sourceClasses: ["external-provider" as const],
        qualities: ["estimated" as const],
        fromMs: Date.parse("2026-07-10T00:00:00.000Z"),
        toMs: Date.parse("2026-07-11T00:00:00.000Z"),
        timezone: "UTC",
        bucket: "day" as const,
        groupBy: "model" as const,
        limit: 100,
        cursor: null,
      }

      const explorer = queryAdvancedUsageExplorer(fixture.db, query)
      expect(explorer.facts).toHaveLength(1)
      expect(explorer.facts[0]).toMatchObject({
        providerId: "openrouter",
        accountTag: "team",
        model: "openai/gpt-5",
        quality: "estimated",
        provenance: { pricingVersion: "catalog-2026-07", rawPayload: "omitted" },
      })
      expect(explorer.rollup.items[0]?.factIds).toEqual([explorer.facts[0]!.id])

      const json = exportAdvancedUsage(
        fixture.db,
        { query, format: "json", includeRedactedRawPayload: false },
        Date.parse("2026-07-14T12:00:00.000Z"),
      )
      const jsonBody = JSON.parse(json.content) as {
        query: typeof query
        facts: Array<{ id: string; redactedRawPayload?: unknown }>
        aggregates: Array<{ factIds: string[] }>
      }
      expect(jsonBody.query).toMatchObject(query)
      expect(jsonBody.facts).toEqual([{ ...explorer.facts[0] }])
      expect(jsonBody.facts[0]).not.toHaveProperty("redactedRawPayload")
      expect(jsonBody.aggregates[0]?.factIds).toEqual([explorer.facts[0]!.id])

      const csv = exportAdvancedUsage(fixture.db, {
        query,
        format: "csv",
        includeRedactedRawPayload: false,
      })
      expect(csv.content).toContain("fact_id,provider_id,account_tag")
      expect(csv.content).toContain("openrouter,team")
      expect(csv.content).toContain("openai/gpt-5")
      expect(csv.content).not.toContain("anthropic")
      expect(csv.content.trim().split("\n")).toHaveLength(2)
    } finally {
      fixture.sqlite.close()
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
