import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import { exportAdvancedUsage, redactUsageRawPayload } from "../src/main/lib/usage/explorer"
import { applyUsageStorePragmas, insertSamples, type UsageDb } from "../src/main/lib/usage/store"

describe("advanced usage export redaction", () => {
  it("redacts secret keys and secret-shaped values recursively", () => {
    const redacted = redactUsageRawPayload({
      apiKey: "plain-api-secret",
      nested: {
        authorization: "Bearer bearer-secret",
        token: "generic-token-secret",
        webhook: "generic-webhook-secret",
        clientSecret: "camel-client-secret",
        dbPassword: "camel-db-password",
        authToken: "camel-auth-token",
        safe: "pricing-2026-07",
        url: "https://example.test/report?token=query-secret&mode=full",
        clientSecretUrl: "https://example.test/report?client_secret=query-client-secret",
        basicUrl: "https://user:basic-secret@example.test/report",
        databaseUrl: "postgres://user:database-secret@example.test/flapstack",
        basicAuth: "Authorization: Basic YmFzaWMtc2VjcmV0",
        awsAccessKey: "AKIA1234567890ABCDEF",
        googleApiKey: "AIza1234567890abcdefghijklmnopqrstuv",
        npmToken: "npm_1234567890abcdefghijklmnopqrstuvwxyz",
        text: "password=hunter2",
        privateKey: "-----BEGIN PRIVATE KEY-----\nprivate-key-secret",
      },
      array: [
        "sk-live_123456789",
        "ghp_123456789abcdefgh",
        "Authorization: Basic YmFzaWMtc2VjcmV0",
        "https://example.test/report?client_secret=query-client-secret",
        "postgres://user:database-secret@example.test/flapstack",
        "AKIA1234567890ABCDEF",
        "AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
        "npm_1234567890abcdefghijklmnopqrstuvwxyz",
        "ordinary",
      ],
    })
    const serialized = JSON.stringify(redacted)
    for (const secret of [
      "plain-api-secret",
      "bearer-secret",
      "generic-token-secret",
      "generic-webhook-secret",
      "camel-client-secret",
      "camel-db-password",
      "camel-auth-token",
      "query-secret",
      "query-client-secret",
      "basic-secret",
      "ghp_123456789abcdefgh",
      "database-secret",
      "YmFzaWMtc2VjcmV0",
      "AKIA1234567890ABCDEF",
      "AIza1234567890abcdefghijklmnopqrstuv",
      "AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
      "npm_1234567890abcdefghijklmnopqrstuvwxyz",
      "hunter2",
      "private-key-secret",
      "sk-live_123456789",
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).toContain("pricing-2026-07")
    expect(serialized).toContain("ordinary")
  })

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
