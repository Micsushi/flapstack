import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import { queryUsageInsights } from "../src/main/lib/usage/insights"
import { applyUsageStorePragmas, insertSamples, type UsageDb } from "../src/main/lib/usage/store"
import type { UsageSampleInput } from "../src/main/lib/usage/types"

const FROM_MS = Date.parse("2026-07-01T00:00:00.000Z")
const NOW_MS = Date.parse("2026-07-05T00:00:00.000Z")
const RESET_END_MS = Date.parse("2026-07-09T00:00:00.000Z")

describe("usage insights", () => {
  it("calculates exact headroom, burn rate, and a bounded forecast", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, dailyCostSamples([1, 1, 1, 1], "exact"))

      const result = queryUsageInsights(db, insightInput())

      expect(result.coverage.status).toBe("sufficient")
      expect(result.headroom).toMatchObject({
        status: "available",
        used: 4_000_000,
        remaining: 6_000_000,
      })
      expect(result.burnRate).toMatchObject({ status: "available", perDay: 1_000_000 })
      expect(result.forecast).toMatchObject({
        status: "range",
        throughMs: RESET_END_MS,
        central: 8_000_000,
      })
      expect(result.forecast.lower).toBeLessThan(result.forecast.central!)
      expect(result.forecast.upper).toBeGreaterThan(result.forecast.central!)
      expect(result.pricing.status).toBe("not-applicable")
    } finally {
      sqlite.close()
    }
  })

  it("returns ranges instead of exact values for estimated usage", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, dailyCostSamples([1, 1, 1, 1], "estimated", "prices-v1"))

      const result = queryUsageInsights(db, insightInput())

      expect(result.coverage.status).toBe("sufficient")
      expect(result.headroom).toMatchObject({
        status: "estimated",
        used: null,
        remaining: null,
      })
      expect(result.headroom.remainingRange).toEqual({ lower: 5_000_000, upper: 7_000_000 })
      expect(result.burnRate).toMatchObject({
        status: "range",
        perDay: null,
        perDayRange: { lower: 750_000, upper: 1_250_000 },
      })
      expect(result.resetAwarePace).toMatchObject({
        status: "uncertain",
        usedRatio: null,
        paceRatio: null,
      })
      expect(result.forecast).toMatchObject({
        status: "range",
        central: null,
        reason: "estimated-source",
      })
      expect(result.pricing).toMatchObject({ status: "single", missingFactIds: [] })
      expect(result.pricing.versions.map((entry) => entry.version)).toEqual(["prices-v1"])
    } finally {
      sqlite.close()
    }
  })

  it("keeps forecasts and anomaly claims unavailable for sparse history", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, dailyCostSamples([1], "exact"))

      const result = queryUsageInsights(db, insightInput())

      expect(result.coverage).toMatchObject({ status: "insufficient", sampleCount: 1 })
      expect(result.coverage.reasons).toEqual(
        expect.arrayContaining(["too-few-samples", "too-few-buckets"]),
      )
      expect(result.burnRate).toMatchObject({
        status: "unavailable",
        reason: "insufficient-coverage",
      })
      expect(result.forecast).toMatchObject({
        status: "unavailable",
        reason: "insufficient-coverage",
      })
      expect(result.anomaly).toMatchObject({
        status: "unavailable",
        reason: "insufficient-anomaly-baseline",
      })
    } finally {
      sqlite.close()
    }
  })

  it("includes the reset window in headroom pace and forecast calculations", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, dailyCostSamples([1, 1, 1, 1], "exact"))

      const result = queryUsageInsights(db, insightInput())

      expect(result.resetAwarePace).toMatchObject({
        status: "behind",
        resetWindow: {
          startMs: FROM_MS,
          endMs: RESET_END_MS,
          source: "explicit",
        },
        elapsedRatio: 0.5,
        usedRatio: 0.4,
        paceRatio: 0.8,
      })
      expect(result.forecast.throughMs).toBe(RESET_END_MS)
    } finally {
      sqlite.close()
    }
  })

  it("exposes mixed pricing versions and removes the false central forecast", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, [
        ...dailyCostSamples([1, 1], "estimated", "prices-v1", 0),
        ...dailyCostSamples([1, 1], "estimated", "prices-v2", 2),
      ])

      const result = queryUsageInsights(db, insightInput())

      expect(result.pricing.status).toBe("mixed")
      expect(result.pricing.versions.map((entry) => entry.version)).toEqual([
        "prices-v1",
        "prices-v2",
      ])
      expect(result.forecast).toMatchObject({
        status: "range",
        central: null,
        reason: "estimated-source",
      })
    } finally {
      sqlite.close()
    }
  })

  it("detects a deterministic spike against a covered robust baseline", async () => {
    const { sqlite, db } = database()
    try {
      await insertSamples(db, dailyCostSamples([1, 1, 1, 5], "exact"))

      const result = queryUsageInsights(db, insightInput())

      expect(result.anomaly).toMatchObject({
        status: "spike",
        observed: 5_000_000,
        baselineMedian: 1_000_000,
        multiplier: 5,
        threshold: 3_000_000,
        bucketStartMs: Date.parse("2026-07-04T00:00:00.000Z"),
      })
    } finally {
      sqlite.close()
    }
  })
})

function insightInput() {
  return {
    rollup: {
      scope: { type: "global" as const },
      fromMs: FROM_MS,
      toMs: NOW_MS,
      timezone: "UTC",
    },
    metric: "cost-usd-micros" as const,
    nowMs: NOW_MS,
    capacity: {
      value: 10_000_000,
      unit: "usd-micros" as const,
      source: "explicit" as const,
      resetWindow: {
        startMs: FROM_MS,
        endMs: RESET_END_MS,
        source: "explicit" as const,
      },
    },
  }
}

function dailyCostSamples(
  values: number[],
  quality: "exact" | "estimated",
  pricingVersion?: string,
  dayOffset = 0,
): UsageSampleInput[] {
  return values.map((cost, index) => ({
    providerId: "openrouter",
    source: "external-provider",
    sourceTag: "daily-run-cost",
    costQuality: quality,
    capturedAt: new Date(
      FROM_MS + (dayOffset + index) * 24 * 60 * 60 * 1_000 + 12 * 60 * 60 * 1_000,
    ),
    model: "openai/gpt-5",
    ...(quality === "estimated" ? { costUsdEstimated: cost, pricingVersion } : { costUsd: cost }),
    dedupeKey: `insight-${quality}-${pricingVersion ?? "exact"}-${dayOffset + index}`,
  }))
}

function database(): { sqlite: Database.Database; db: UsageDb } {
  const sqlite = new Database(":memory:")
  applyUsageStorePragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  migrateDatabase(db, sqlite, resolve(process.cwd(), "drizzle"))
  return { sqlite, db }
}
