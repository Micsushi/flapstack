import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import { exportAdvancedUsage } from "../src/main/lib/usage/explorer"
import { applyUsageStorePragmas, insertSamples, type UsageDb } from "../src/main/lib/usage/store"

describe("advanced usage export redaction", () => {
  it("never emits an unredacted database raw payload in JSON or CSV", async () => {
    const fixture = database()
    try {
      await insertSamples(fixture.db, [
        {
          providerId: "openrouter",
          source: "external-provider",
          costQuality: "estimated",
          model: "openai/gpt-5",
          totalTokens: 1,
          costUsdEstimated: 0.0001,
          dedupeKey: "secret-export",
        },
      ])
      fixture.sqlite
        .prepare("UPDATE usage_samples SET raw_payload = ? WHERE dedupe_key = 'secret-export'")
        .run(
          JSON.stringify({
            credential: "db-credential",
            harmless: "visible",
            note: "Authorization: Bearer db-bearer-secret",
            webhook: "https://discord.com/api/webhooks/123456/db-webhook-secret",
          }),
        )
      const query = { scope: { type: "global" as const } }
      for (const format of ["json", "csv"] as const) {
        const output = exportAdvancedUsage(fixture.db, {
          query,
          format,
          includeRedactedRawPayload: true,
        })
        expect(output.rawPayloadPolicy).toBe("redacted")
        expect(output.content).toContain("visible")
        expect(output.content).toContain("redacted")
        expect(output.content).not.toContain("db-credential")
        expect(output.content).not.toContain("db-bearer-secret")
        expect(output.content).not.toContain("db-webhook-secret")
      }
      const omitted = exportAdvancedUsage(fixture.db, {
        query,
        format: "json",
        includeRedactedRawPayload: false,
      })
      expect(omitted.content).not.toContain("visible")
      expect(omitted.content).not.toContain("redactedRawPayload")
      expect(omitted.content).toContain('"rawPayload": "omitted"')
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
