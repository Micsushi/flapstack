import { describe, expect, it } from "vitest"
import {
  accountLabel,
  buildCurrentUsageSummaries,
  buildUsageHistorySeries,
  formatQuotaUsage,
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
})
