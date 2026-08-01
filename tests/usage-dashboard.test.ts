import { describe, expect, it } from "vitest"
import {
  accountLabel,
  buildCurrentUsageSummaries,
  buildUsageHistorySeries,
  compactHistoryPoints,
  filterSupersededPersonalAccountRows,
  formatQuotaUsage,
  providerFreshness,
  prepareUsageHistorySeries,
  quotaPercentRemaining,
  quotaPercentUsed,
  usageSeverity,
  usagePaceStatus,
} from "../src/renderer/components/dialogs/settings-tabs/agents-usage-helpers"

describe("usage dashboard helpers", () => {
  it("composes latest non-null metrics without fabricating missing values", () => {
    const summaries = buildCurrentUsageSummaries([
      {
        providerId: "codex",
        accountTag: "team-a",
        capturedAt: "2026-07-10T12:00:00Z",
        source: "startup-reconcile",
        sourceTag: "organization-usage",
        costQuality: "unknown",
        totalTokens: 1_200,
      },
      {
        providerId: "codex",
        accountTag: "team-a",
        capturedAt: "2026-07-10T11:59:00Z",
        source: "startup-reconcile",
        sourceTag: "organization-cost",
        costQuality: "provider-reported",
        costUsd: 1.25,
      },
      {
        providerId: "cursor",
        capturedAt: "2026-07-10T11:58:00Z",
        source: "app-poll",
        percentUsed: 70,
        resetAt: "2026-07-11T00:00:00Z",
      },
    ])

    expect(summaries).toEqual([
      {
        providerId: "codex",
        accountTag: "team-a",
        capturedAt: "2026-07-10T12:00:00Z",
        source: "startup-reconcile",
        sourceTag: "organization-usage",
        metricKey: null,
        costQuality: "provider-reported",
        costUsd: 1.25,
        costUsdEstimated: null,
        totalTokens: 1_200,
        percentUsed: null,
        quotaUsed: null,
        quotaLimit: null,
        quotaUnit: null,
        resetAt: null,
      },
      {
        providerId: "cursor",
        accountTag: "",
        capturedAt: "2026-07-10T11:58:00Z",
        source: "app-poll",
        sourceTag: null,
        metricKey: null,
        costQuality: null,
        costUsd: null,
        costUsdEstimated: null,
        totalTokens: null,
        percentUsed: 70,
        quotaUsed: null,
        quotaLimit: null,
        quotaUnit: null,
        resetAt: "2026-07-11T00:00:00Z",
      },
    ])
  })

  it("keeps multiple quota windows for one provider account distinct", () => {
    const summaries = buildCurrentUsageSummaries([
      { providerId: "codex", accountTag: "me", metricKey: "five_hour", percentUsed: 30 },
      { providerId: "codex", accountTag: "me", metricKey: "seven_day", percentUsed: 70 },
    ])
    expect(summaries.map((summary) => [summary.metricKey, summary.percentUsed])).toEqual([
      ["five_hour", 30],
      ["seven_day", 70],
    ])
  })

  it("keeps only the newest personal OAuth identity on the current board", () => {
    const rows = [
      {
        providerId: "anthropic",
        accountTag: "old-login",
        sourceTag: "personal-oauth",
        metricKey: "five_hour",
        capturedAt: "2026-07-12T12:00:00Z",
      },
      {
        providerId: "anthropic",
        accountTag: "current-login",
        sourceTag: "personal-oauth",
        metricKey: "five_hour",
        capturedAt: "2026-07-13T12:00:00Z",
      },
      {
        providerId: "anthropic",
        accountTag: "organization",
        sourceTag: "organization-cost",
        capturedAt: "2026-07-11T12:00:00Z",
      },
    ]

    expect(filterSupersededPersonalAccountRows(rows).map((row) => row.accountTag)).toEqual([
      "current-login",
      "organization",
    ])
    expect(rows).toHaveLength(3)
  })

  it("builds bounded historical series per provider account and metric", () => {
    const series = buildUsageHistorySeries(
      [
        {
          providerId: "codex",
          accountTag: "me",
          metricKey: "five_hour",
          capturedAt: 2,
          percentUsed: 20,
        },
        {
          providerId: "codex",
          accountTag: "me",
          metricKey: "five_hour",
          capturedAt: 1,
          percentUsed: 10,
        },
        {
          providerId: "codex",
          accountTag: "me",
          metricKey: "seven_day",
          capturedAt: 2,
          percentUsed: 40,
        },
      ],
      "quota",
    )
    expect(series).toMatchObject([
      {
        label: "codex · me · five_hour",
        points: [
          { at: 1, value: 10 },
          { at: 2, value: 20 },
        ],
      },
      { label: "codex · me · seven_day", points: [{ at: 2, value: 40 }] },
    ])
  })

  it("matches OnWatch ranges and cumulative/per-period graph modes", () => {
    const base = Date.parse("2026-07-11T12:00:00Z")
    const source = [
      {
        key: "quota",
        label: "codex · me · five_hour",
        periodStrategy: "delta" as const,
        points: [
          { at: base - 8 * 60 * 60 * 1_000, value: 5 },
          { at: base - 60 * 60 * 1_000, value: 20 },
          { at: base - 30 * 60 * 1_000, value: 35 },
        ],
      },
    ]

    expect(prepareUsageHistorySeries(source, "quota", "6h", "cumulative", base)[0]?.points).toEqual(
      [
        { at: base - 60 * 60 * 1_000, value: 20 },
        { at: base - 30 * 60 * 1_000, value: 35 },
      ],
    )
    expect(prepareUsageHistorySeries(source, "quota", "6h", "period", base)[0]?.points).toEqual([
      { at: base - 45 * 60 * 1_000, value: 0 },
      { at: base - 15 * 60 * 1_000, value: 15 },
    ])
  })

  it("sums observed cost rows in per-period buckets without inventing empty buckets", () => {
    const base = Date.parse("2026-07-11T12:00:00Z")
    const [series] = prepareUsageHistorySeries(
      [
        {
          key: "cost",
          label: "openrouter · default",
          periodStrategy: "sum" as const,
          points: [
            { at: base - 10 * 60 * 1_000, value: 0.02 },
            { at: base - 5 * 60 * 1_000, value: 0.03 },
          ],
        },
      ],
      "cost",
      "1h",
      "period",
      base,
    )

    expect(series?.points).toHaveLength(2)
    expect(series?.points.reduce((sum, point) => sum + point.value, 0)).toBeCloseTo(0.05)
  })

  it("builds cumulative cost growth and limits small charts to twenty-four points", () => {
    const base = Date.parse("2026-07-11T12:00:00Z")
    const points = Array.from({ length: 100 }, (_, index) => ({
      at: base - (100 - index) * 60_000,
      value: 0.25,
    }))
    const [series] = prepareUsageHistorySeries(
      [{ key: "cost", label: "codex", periodStrategy: "sum", points }],
      "cost",
      "24h",
      "cumulative",
      base,
    )
    expect(series?.points).toHaveLength(24)
    expect(series?.points.at(-1)?.value).toBe(25)
  })

  it("places provider history buckets on their real window instead of poll time", () => {
    const [series] = buildUsageHistorySeries(
      [
        {
          providerId: "codex",
          accountTag: "team",
          sourceTag: "organization-cost",
          capturedAt: "2026-07-11T12:00:00Z",
          windowStart: "2026-07-09T00:00:00Z",
          windowEnd: "2026-07-10T00:00:00Z",
          costUsd: 2.5,
        },
      ],
      "cost",
    )

    expect(series?.label).toBe("codex · team · organization-cost")
    expect(series?.periodStrategy).toBe("sum")
    expect(series?.points[0]?.at).toBe(Date.parse("2026-07-09T00:00:00Z"))
  })

  it("keeps a newer estimate instead of mixing it with an older reported cost", () => {
    const [summary] = buildCurrentUsageSummaries([
      {
        providerId: "openrouter",
        capturedAt: 20,
        costQuality: "estimated",
        costUsdEstimated: 0.02,
      },
      {
        providerId: "openrouter",
        capturedAt: 10,
        costQuality: "provider-reported",
        costUsd: 0.01,
      },
    ])

    expect(summary).toMatchObject({
      costQuality: "estimated",
      costUsd: null,
      costUsdEstimated: 0.02,
    })
  })

  it("labels blank account tags without hiding that they are the default", () => {
    expect(accountLabel("")).toBe("Default account")
    expect(accountLabel("workspace-1")).toBe("workspace-1")
  })

  it("distinguishes current, stale last-known, and unavailable provider data", () => {
    const now = Date.parse("2026-07-10T12:00:00Z")
    expect(
      providerFreshness(
        {
          status: "ok",
          lastSuccessAt: new Date(now - 30_000),
          lastErrorAt: null,
        },
        now,
        60,
      ),
    ).toEqual({ state: "current", label: "Current" })
    expect(
      providerFreshness(
        {
          status: "source-unavailable",
          lastSuccessAt: new Date(now - 120_000),
          lastErrorAt: new Date(now - 10_000),
        },
        now,
        60,
      ),
    ).toEqual({ state: "stale", label: "Stale · last-known data" })
    expect(
      providerFreshness(
        {
          status: "source-unavailable",
          lastSuccessAt: null,
          lastErrorAt: new Date(now - 10_000),
        },
        now,
        60,
      ),
    ).toEqual({ state: "unavailable", label: "Unavailable · no successful poll" })
  })

  it("formats quota units without exposing stored micro-dollar integers", () => {
    expect(
      formatQuotaUsage({
        quotaUsed: 5_000_000,
        quotaLimit: 20_000_000,
        quotaUnit: "usd-micros",
      }),
    ).toBe("$5 / $20")
    expect(formatQuotaUsage({ quotaUsed: 30, quotaLimit: 100, quotaUnit: "provider-native" })).toBe(
      "30 / 100",
    )
    expect(
      formatQuotaUsage({
        percentUsed: 25,
        quotaUsed: 5_000_000,
        quotaLimit: 20_000_000,
        quotaUnit: "usd-micros",
      }),
    ).toBe("25% used")
  })

  it("derives bounded used and remaining percentages for headroom cards", () => {
    expect(quotaPercentUsed({ quotaUsed: 30, quotaLimit: 120 })).toBe(25)
    expect(quotaPercentRemaining({ quotaUsed: 30, quotaLimit: 120 })).toBe(75)
    expect(quotaPercentRemaining({ percentUsed: 140 })).toBe(0)
    expect(quotaPercentRemaining({})).toBeNull()
  })

  it("uses consistent utilization severity thresholds", () => {
    expect(usageSeverity(20)).toBe("healthy")
    expect(usageSeverity(50)).toBe("warning")
    expect(usageSeverity(80)).toBe("danger")
    expect(usageSeverity(95)).toBe("critical")
  })

  it("matches OnWatch weekly pace states against time until reset", () => {
    const now = Date.parse("2026-05-27T12:00:00Z")
    const reset = now + 4 * 24 * 60 * 60 * 1_000
    const cases = [
      [43, reset, "healthy", "On pace"],
      [53, reset, "warning", "Overpace: extra +10% | time-left +18%"],
      [72, reset, "critical", "Very overpace: extra +29% | time-left +51%"],
      [28, reset, "very_underuse", "Very under pace: reserve +15% | elapsed +35%"],
      [11, now + 6 * 24 * 60 * 60 * 1_000, "underuse", "Under pace: reserve +3% | elapsed +23%"],
    ] as const

    for (const [used, resetsAt, status, label] of cases) {
      expect(usagePaceStatus(used, "seven_day", resetsAt, now)).toMatchObject({
        status,
        label,
        paceApplied: true,
      })
    }
    expect(usagePaceStatus(80, "five_hour", reset, now)).toMatchObject({
      status: "danger",
      paceApplied: false,
    })
  })

  it("keeps quota history points data-only so series colors remain fixed", () => {
    const capturedAt = Date.parse("2026-05-27T12:00:00Z")
    const [series] = buildUsageHistorySeries(
      [
        {
          providerId: "codex",
          metricKey: "seven_day",
          capturedAt,
          resetAt: capturedAt + 4 * 24 * 60 * 60 * 1_000,
          percentUsed: 72,
        },
      ],
      "quota",
    )
    expect(series?.points[0]).toEqual({ at: capturedAt, value: 72 })
  })

  it("compacts dense history without losing its full span or reset extremes", () => {
    const points = Array.from({ length: 1_000 }, (_, at) => ({
      at,
      value: at === 500 ? 100 : at === 501 ? 0 : at % 100,
    }))
    const compacted = compactHistoryPoints(points, 100)
    expect(compacted.length).toBeLessThanOrEqual(100)
    expect(compacted[0]).toEqual(points[0])
    expect(compacted.at(-1)).toEqual(points.at(-1))
    expect(compacted.some((point) => point.value === 100)).toBe(true)
    expect(compacted.some((point) => point.at === 501 && point.value === 0)).toBe(true)
  })
})
