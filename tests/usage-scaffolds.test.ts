import { afterEach, describe, expect, it, vi } from "vitest"
import { getUsageProviders, getUsageProvider } from "../src/main/lib/usage/registry"
import { USAGE_PROVIDER_IDS } from "../src/main/lib/usage/types"
import {
  deriveDedupeKey,
  isStrongerCostQuality,
  microsToUsd,
  usdToMicros,
} from "../src/main/lib/usage/source-tags"
import { estimateCostUsd, upsertModelPricing } from "../src/main/lib/usage/pricing"
import { evaluateSample, type AlertArmState } from "../src/main/lib/usage/alerts"
import { sendDiscordAlert } from "../src/main/lib/usage/discord"
import { normalizeUsageSettings, resolveCadenceSeconds } from "../src/main/lib/usage/settings"
import { buildLaunchAgentPlist } from "../src/main/lib/usage-daemon/platform"
import { pollInternalSource } from "../src/main/lib/usage/providers/cursor/source-internal"
import { captureOpenCodeRunUsage } from "../src/main/lib/usage/run-usage"

afterEach(() => vi.unstubAllGlobals())

describe("usage Track B scaffolds", () => {
  it("registers an adapter for every declared provider id", () => {
    const ids = getUsageProviders().map((p) => p.id)
    for (const id of USAGE_PROVIDER_IDS) {
      expect(ids).toContain(id)
      expect(getUsageProvider(id)).toBeDefined()
    }
  })

  it("reports honest not-configured status without fabricating usage", async () => {
    const ctx = {
      now: new Date(),
      source: "app-poll" as const,
      getSecret: async () => null,
      log: () => {},
    }
    const codex = getUsageProvider("codex")!
    const status = await codex.getStatus(ctx)
    expect(status.configured).toBe(false)
    expect(status.status).toBe("not-configured")
  })

  it("normalizes OpenAI organization cost buckets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.includes("/costs")
                ? {
                    data: [
                      {
                        start_time: 1_783_000_000,
                        end_time: 1_783_086_400,
                        results: [{ amount: { value: 1.25 } }],
                      },
                    ],
                  }
                : {
                    data: [
                      {
                        start_time: 1_783_000_000,
                        end_time: 1_783_086_400,
                        results: [{ input_tokens: 10, output_tokens: 5, num_model_requests: 2 }],
                      },
                    ],
                  },
            ),
          ),
        ),
      ),
    )
    const samples = await getUsageProvider("codex")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "app-poll",
      getSecret: async () => "sk-admin-test",
      log: () => {},
    })
    expect(samples.find((sample) => sample.sourceTag === "organization-cost")?.costUsd).toBe(1.25)
    expect(samples.find((sample) => sample.sourceTag === "organization-usage")?.totalTokens).toBe(
      15,
    )
  })

  it("uses Anthropic x-api-key auth, pagination, cents, and token usage", async () => {
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      const secondPage = parsed.searchParams.get("page") === "next"
      const isCost = parsed.pathname.endsWith("cost_report")
      const body = isCost
        ? {
            data: secondPage
              ? []
              : [
                  {
                    starting_at: "2026-07-10T00:00:00Z",
                    ending_at: "2026-07-11T00:00:00Z",
                    results: [{ amount: "123.45" }],
                  },
                ],
            has_more: !secondPage,
            next_page: secondPage ? null : "next",
          }
        : {
            data: secondPage
              ? []
              : [
                  {
                    starting_at: "2026-07-10T00:00:00Z",
                    ending_at: "2026-07-11T00:00:00Z",
                    results: [
                      {
                        uncached_input_tokens: 10,
                        cache_read_input_tokens: 5,
                        cache_creation: { ephemeral_1h_input_tokens: 2 },
                        output_tokens: 3,
                      },
                    ],
                  },
                ],
            has_more: !secondPage,
            next_page: secondPage ? null : "next",
          }
      expect(new Headers(init?.headers).get("x-api-key")).toBe("sk-ant-admin-test")
      expect(new Headers(init?.headers).get("authorization")).toBeNull()
      return Promise.resolve(new Response(JSON.stringify(body)))
    })
    vi.stubGlobal("fetch", fetch)
    const samples = await getUsageProvider("anthropic")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "app-poll",
      getSecret: async () => "sk-ant-admin-test",
      log: () => {},
    })
    expect(samples.find((sample) => sample.sourceTag === "organization-cost")?.costUsd).toBeCloseTo(
      1.2345,
    )
    expect(samples.find((sample) => sample.sourceTag === "organization-usage")?.totalTokens).toBe(
      20,
    )
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it("normalizes OpenRouter key credit usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { label: "Flapstack", limit: 10, limit_remaining: 7.5, usage_monthly: 2.5 },
          }),
        ),
      ),
    )
    const samples = await getUsageProvider("openrouter")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "app-poll",
      getSecret: async () => "sk-or-test",
      log: () => {},
    })
    expect(samples[0]?.costUsd).toBe(2.5)
    expect(samples[0]?.percentUsed).toBe(25)
  })

  it("collapses daemon-poll and app-poll for the same window to one dedupe key", () => {
    const windowEnd = new Date("2026-07-09T12:00:00Z")
    const daemon = deriveDedupeKey({
      providerId: "cursor",
      source: "daemon-poll",
      costQuality: "provider-reported",
      windowEnd,
    })
    const app = deriveDedupeKey({
      providerId: "cursor",
      source: "app-poll",
      costQuality: "provider-reported",
      windowEnd,
    })
    expect(daemon).toBe(app)
  })

  it("collapses timestamp-only poll snapshots within one minute", () => {
    const daemon = deriveDedupeKey({
      providerId: "cursor",
      source: "daemon-poll",
      costQuality: "provider-reported",
      capturedAt: new Date("2026-07-09T12:00:01Z"),
    })
    const app = deriveDedupeKey({
      providerId: "cursor",
      source: "app-poll",
      costQuality: "provider-reported",
      capturedAt: new Date("2026-07-09T12:00:59Z"),
    })
    expect(daemon).toBe(app)
  })

  it("prefers an explicit generation-id dedupe key", () => {
    const key = deriveDedupeKey({
      providerId: "openrouter",
      source: "flapstack-run",
      costQuality: "estimated",
      dedupeKey: "openrouter|gen|abc123",
    })
    expect(key).toBe("openrouter|gen|abc123")
  })

  it("ranks cost quality so estimates never beat exact", () => {
    expect(isStrongerCostQuality("exact", "estimated")).toBe(true)
    expect(isStrongerCostQuality("estimated", "exact")).toBe(false)
    expect(isStrongerCostQuality("provider-reported", "unknown")).toBe(true)
  })

  it("round-trips USD <-> micro-dollars", () => {
    expect(usdToMicros(1.23)).toBe(1_230_000)
    expect(microsToUsd(1_230_000)).toBeCloseTo(1.23)
    expect(usdToMicros(null)).toBeNull()
  })

  it("returns null (not zero) when pricing is a placeholder", () => {
    expect(estimateCostUsd("openrouter", "some-model", { inputTokens: 1000 })).toBeNull()
  })

  it("estimates cost once real pricing is loaded", () => {
    upsertModelPricing({
      providerId: "nanogpt",
      model: "test-model",
      inputPerMTok: 1,
      outputPerMTok: 2,
      reasoningPerMTok: 4,
    })
    const cost = estimateCostUsd("nanogpt", "test-model", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      reasoningTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(1 + 2 + 4)
  })

  it("uses NanoGPT detailed model prices as per-million values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: "nano-test", pricing: { prompt: 1, completion: 2 } }],
          }),
        ),
      ),
    )
    await getUsageProvider("nanogpt")!.pollLatest({
      now: new Date(),
      source: "app-poll",
      getSecret: async () => "nano-key",
      log: () => {},
    })
    expect(
      estimateCostUsd("nanogpt", "nano-test", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(3)
  })

  it("fires a quota alert once, then re-arms only after a reset below band", () => {
    const thresholds = {
      quotaPercent: [80],
      spendUsd: [],
      spendRateUsdPerHour: null,
      spikeMultiplier: null,
    }
    const arm: AlertArmState[] = []
    const first = evaluateSample(
      {
        providerId: "cursor",
        billingKind: "subscription-quota",
        costQuality: "provider-reported",
        percentUsed: 85,
      },
      thresholds,
      arm,
    )
    expect(first.intents).toHaveLength(1)
    // Persist disarm.
    const disarmed = first.armUpdates
    // Still high -> no re-fire.
    const second = evaluateSample(
      {
        providerId: "cursor",
        billingKind: "subscription-quota",
        costQuality: "provider-reported",
        percentUsed: 90,
      },
      thresholds,
      disarmed,
    )
    expect(second.intents).toHaveLength(0)
    // Reset well below band -> re-arm.
    const reset = evaluateSample(
      {
        providerId: "cursor",
        billingKind: "subscription-quota",
        costQuality: "provider-reported",
        percentUsed: 10,
      },
      thresholds,
      disarmed,
    )
    expect(reset.armUpdates.some((a) => a.armed)).toBe(true)
  })

  it("keeps alert arm state separate for each account", () => {
    const thresholds = {
      quotaPercent: [80],
      spendUsd: [],
      spendRateUsdPerHour: null,
      spikeMultiplier: null,
    }
    const first = evaluateSample(
      {
        providerId: "cursor",
        accountTag: "work",
        billingKind: "subscription-quota",
        costQuality: "provider-reported",
        percentUsed: 90,
      },
      thresholds,
      [],
    )
    const second = evaluateSample(
      {
        providerId: "cursor",
        accountTag: "personal",
        billingKind: "subscription-quota",
        costQuality: "provider-reported",
        percentUsed: 90,
      },
      thresholds,
      first.armUpdates,
    )
    expect(second.intents).toHaveLength(1)
  })

  it("labels estimated spend alerts distinctly", () => {
    const thresholds = {
      quotaPercent: [],
      spendUsd: [10],
      spendRateUsdPerHour: null,
      spikeMultiplier: null,
    }
    const result = evaluateSample(
      {
        providerId: "openrouter",
        billingKind: "api-spend",
        costQuality: "estimated",
        spendUsd: 12,
      },
      thresholds,
      [],
    )
    expect(result.intents[0]?.alertType).toBe("estimated-spend")
  })

  it("evaluates spend-rate and spike alerts", () => {
    const result = evaluateSample(
      {
        providerId: "anthropic",
        billingKind: "api-spend",
        costQuality: "provider-reported",
        spendRateUsdPerHour: 5,
        spikeMultiplierObserved: 4,
      },
      {
        quotaPercent: [],
        spendUsd: [],
        spendRateUsdPerHour: 3,
        spikeMultiplier: 2,
      },
      [],
    )
    expect(result.intents.map((intent) => intent.alertType)).toEqual([
      "api-spend-rate",
      "api-spend-spike",
    ])
  })

  it("rejects an invalid Discord webhook URL without leaking it", async () => {
    const result = await sendDiscordAlert("not-a-webhook", { title: "t", body: "b" })
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain("not-a-webhook")
  })

  it("normalizes settings and resolves per-provider cadence overrides", () => {
    const settings = normalizeUsageSettings({
      cadenceSeconds: 600,
      providers: {
        codex: { enabled: true, cadenceSecondsOverride: 120, thresholds: undefined as never },
      } as never,
    })
    expect(settings.cadenceSeconds).toBe(600)
    expect(resolveCadenceSeconds(settings, "codex")).toBe(120)
    expect(resolveCadenceSeconds(settings, "cursor")).toBe(600)
  })

  it("does not share mutable default provider settings", () => {
    const first = normalizeUsageSettings({})
    first.providers.codex.enabled = true
    const second = normalizeUsageSettings({})
    expect(second.providers.codex.enabled).toBe(false)
  })

  it("allows users to clear all quota thresholds", () => {
    const settings = normalizeUsageSettings({
      providers: {
        cursor: {
          enabled: true,
          cadenceSecondsOverride: null,
          thresholds: {
            quotaPercent: [],
            spendUsd: [],
            spendRateUsdPerHour: null,
            spikeMultiplier: null,
          },
        },
      } as never,
    })
    expect(settings.providers.cursor.thresholds.quotaPercent).toEqual([])
  })

  it("builds a safe daemon LaunchAgent that can actually enter daemon mode", () => {
    const plist = buildLaunchAgentPlist({
      nodePath: "/path/with & chars/node",
      daemonEntryPath: "/app/usage-daemon.js",
      dbPath: "/app/data/agents.db",
      configDir: "/app/data",
      cadenceSeconds: 300,
    })
    expect(plist).toContain("FLAPSTACK_RUN_DAEMON")
    expect(plist).toContain("ELECTRON_RUN_AS_NODE")
    expect(plist).toContain("/path/with &amp; chars/node")
    expect(plist).toContain("<key>KeepAlive</key><false/>")
  })

  it("keeps OpenCode run-usage capture out of the DB when pricing is unknown", async () => {
    const db = {} as Parameters<typeof captureOpenCodeRunUsage>[0]
    await expect(
      captureOpenCodeRunUsage(db, {
        providerId: "openrouter",
        runId: "run-unknown-price",
        model: "unknown-model",
        inputTokens: 100,
      }),
    ).resolves.toBe(0)
  })

  it("normalizes Cursor source-1 quota responses without storing the token", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          billingCycleStart: "1752000000000",
          billingCycleEnd: "1754600000000",
          planUsage: { totalSpend: 30, limit: 100, totalPercentUsed: 30.4 },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetch)
    const samples = await pollInternalSource(
      {
        now: new Date("2026-07-10T00:00:00Z"),
        source: "daemon-poll",
        getSecret: async () => null,
        log: () => {},
      },
      "local-token",
    )
    expect(samples).toMatchObject([
      {
        providerId: "cursor",
        sourceTag: "internal",
        quotaUsed: 30,
        quotaLimit: 100,
        percentUsed: 30,
      },
    ])
    expect(fetch.mock.calls[0]?.[1]?.headers.authorization).toBe("Bearer local-token")
    expect(JSON.stringify(samples)).not.toContain("local-token")
  })
})
