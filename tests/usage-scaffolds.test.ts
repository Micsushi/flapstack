import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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
import {
  buildLaunchAgentPlist,
  buildSystemdUserUnit,
  buildWindowsDaemonScript,
  uninstallLaunchAgent,
} from "../src/main/lib/usage-daemon/platform"
import {
  parseCursorTimestamp,
  pollInternalSource,
} from "../src/main/lib/usage/providers/cursor/source-internal"
import { selectNewestCredentials } from "../src/main/lib/usage/providers/cursor/token"
import { getProviderJson } from "../src/main/lib/usage/providers/http"
import { credentialAccountTag } from "../src/main/lib/usage/provider-identity"
import { elapsedWindowHours } from "../src/main/lib/usage/alert-runner"
import { pollCodexPersonal } from "../src/main/lib/usage/providers/codex-personal"
import { pollAnthropicPersonal } from "../src/main/lib/usage/providers/anthropic-personal"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("usage Track B scaffolds", () => {
  it("registers an adapter for every declared provider id", () => {
    const ids = getUsageProviders().map((p) => p.id)
    for (const id of USAGE_PROVIDER_IDS) {
      expect(ids).toContain(id)
      expect(getUsageProvider(id)).toBeDefined()
    }
  })

  it("reports honest not-configured status without fabricating usage", async () => {
    vi.stubEnv("CODEX_HOME", "/tmp/flapstack-no-codex-credentials")
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
    expect(new Set(samples.map((sample) => sample.accountTag))).toEqual(
      new Set([credentialAccountTag("openai", "sk-admin-test")]),
    )
  })

  it("keeps valid OpenAI usage when the cost endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("/costs")
            ? new Response("unavailable", { status: 503 })
            : new Response(
                JSON.stringify({
                  data: [
                    {
                      start_time: 1_783_000_000,
                      end_time: 1_783_086_400,
                      results: [{ input_tokens: 10, output_tokens: 5 }],
                    },
                  ],
                }),
              ),
        ),
      ),
    )
    const log = vi.fn()
    const samples = await getUsageProvider("codex")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "app-poll",
      getSecret: async () => "key-a",
      log,
    })
    expect(samples).toMatchObject([{ sourceTag: "organization-usage", totalTokens: 15 }])
    expect(log).toHaveBeenCalledWith(
      "warn",
      "OpenAI usage endpoint failed; preserving data from other endpoints",
      expect.any(Object),
    )
  })

  it("partitions organization history when an admin credential changes", () => {
    expect(credentialAccountTag("openai", "key-a")).not.toBe(
      credentialAccountTag("openai", "key-b"),
    )
    expect(credentialAccountTag("anthropic", "key-a")).not.toContain("key-a")
  })

  it("uses Anthropic x-api-key auth, pagination, cents, and token usage", async () => {
    vi.stubEnv("FLAPSTACK_DISABLE_LOCAL_USAGE_CREDENTIALS", "1")
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
                    results: [{ amount: "123.45", cost_usd: "999" }],
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
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("/models")
                ? { data: [] }
                : {
                    data: {
                      label: "Flapstack",
                      limit: 10,
                      limit_remaining: 7.5,
                      usage_monthly: 2.5,
                    },
                  },
            ),
          ),
        ),
      ),
    )
    const samples = await getUsageProvider("openrouter")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "app-poll",
      getSecret: async () => "sk-or-test",
      log: () => {},
    })
    expect(samples[0]).toMatchObject({
      costUsd: 2.5,
      percentUsed: 25,
      quotaUsed: 2_500_000,
      quotaLimit: 10_000_000,
      quotaUnit: "usd-micros",
    })
  })

  it("reconciles only stored OpenRouter generation ids with explicit cost provenance", async () => {
    const pending = vi.fn().mockResolvedValue(["gen-exact", "gen-reported"])
    const mark = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const parsed = new URL(url)
        if (parsed.pathname.endsWith("/key")) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: { label: "Flapstack", usage: 2 } })),
          )
        }
        const id = parsed.searchParams.get("id")
        return Promise.resolve(
          new Response(
            JSON.stringify(
              id === "gen-exact"
                ? {
                    data: {
                      id,
                      model: "openai/gpt-test",
                      total_cost: 0.0123,
                      usage: 0.02,
                      native_tokens_prompt: 100,
                      native_tokens_completion: 40,
                      native_tokens_reasoning: 10,
                    },
                  }
                : {
                    data: {
                      id,
                      model: "anthropic/claude-test",
                      usage: "0.0045",
                      tokens_prompt: 20,
                      tokens_completion: 5,
                    },
                  },
            ),
          ),
        )
      }),
    )

    const samples = await getUsageProvider("openrouter")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "daemon-poll",
      getSecret: async () => "sk-or-test",
      getPendingGenerationIds: pending,
      markGenerationReconciliation: mark,
      log: () => {},
    })

    expect(pending).toHaveBeenCalledWith("openrouter", 100)
    expect(samples.find((sample) => sample.generationId === "gen-exact")).toMatchObject({
      sourceTag: "generation-total-cost",
      costQuality: "exact",
      costUsd: 0.0123,
      inputTokens: 100,
      outputTokens: 40,
      reasoningTokens: 10,
      totalTokens: 140,
      dedupeKey: "openrouter|gen|gen-exact",
    })
    expect(samples.find((sample) => sample.generationId === "gen-reported")).toMatchObject({
      sourceTag: "generation-usage-cost",
      costQuality: "provider-reported",
      costUsd: 0.0045,
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      dedupeKey: "openrouter|gen|gen-reported",
    })
    expect(mark).not.toHaveBeenCalledWith("openrouter", expect.any(String), "resolved")
  })

  it("keeps unavailable OpenRouter generation ids as gaps instead of zero history", async () => {
    const log = vi.fn()
    const mark = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            new Response(
              url.includes("/generation")
                ? JSON.stringify({ error: "not found" })
                : JSON.stringify({ data: { label: "Flapstack", usage: 2 } }),
              { status: url.includes("/generation") ? 404 : 200 },
            ),
          ),
        ),
    )

    const samples = await getUsageProvider("openrouter")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "startup-reconcile",
      getSecret: async () => "sk-or-test",
      getPendingGenerationIds: async () => ["gen-missing"],
      markGenerationReconciliation: mark,
      log,
    })

    expect(samples).toHaveLength(1)
    expect(samples[0]?.sourceTag).toBe("key-limits")
    expect(log).toHaveBeenCalledWith(
      "warn",
      "OpenRouter generation is unavailable for reconciliation",
      { generationId: "gen-missing" },
    )
    expect(mark).toHaveBeenCalledWith(
      "openrouter",
      "gen-missing",
      "unavailable",
      "OpenRouter returned HTTP 404",
    )
  })

  it("times out provider HTTP requests with a sanitized source error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            )
          }),
      ),
    )
    await expect(
      getProviderJson({
        providerId: "openrouter",
        url: "https://openrouter.ai/api/v1/key",
        apiKey: "secret-value",
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      status: "source-unavailable",
      message: "Provider usage request timed out after 5ms",
    })
  })

  it("times out when headers arrive but the provider body stalls", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
        body: { cancel },
      }),
    )
    await expect(
      getProviderJson({
        providerId: "openrouter",
        url: "https://openrouter.ai/api/v1/key",
        apiKey: "secret-value",
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      status: "source-unavailable",
      message: "Provider usage response body timed out after 5ms",
    })
    expect(cancel).toHaveBeenCalled()
  })

  it("collapses daemon-poll and app-poll for the same window to one dedupe key", () => {
    const windowEnd = new Date("2026-07-09T12:00:00Z")
    const capturedAt = new Date("2026-07-09T11:00:30Z")
    const daemon = deriveDedupeKey({
      providerId: "cursor",
      source: "daemon-poll",
      costQuality: "provider-reported",
      windowEnd,
      capturedAt,
    })
    const app = deriveDedupeKey({
      providerId: "cursor",
      source: "app-poll",
      costQuality: "provider-reported",
      windowEnd,
      capturedAt,
    })
    expect(daemon).toBe(app)
  })

  it("retains poll snapshots from different minutes inside one quota window", () => {
    const windowEnd = new Date("2026-07-09T17:00:00Z")
    const first = deriveDedupeKey({
      providerId: "codex",
      source: "startup-reconcile",
      sourceTag: "personal-oauth",
      metricKey: "five_hour",
      costQuality: "provider-reported",
      capturedAt: new Date("2026-07-09T11:00:30Z"),
      windowEnd,
    })
    const second = deriveDedupeKey({
      providerId: "codex",
      source: "startup-reconcile",
      sourceTag: "personal-oauth",
      metricKey: "five_hour",
      costQuality: "provider-reported",
      capturedAt: new Date("2026-07-09T11:01:30Z"),
      windowEnd,
    })
    expect(first).not.toBe(second)
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
            data: [
              {
                id: "nano-test",
                pricing: { prompt: 1, completion: 2, unit: "per_million_tokens" },
              },
              {
                id: "nano-wrong-unit",
                pricing: { prompt: 0.000001, completion: 0.000002, unit: "per_token" },
              },
            ],
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
    expect(
      estimateCostUsd("nanogpt", "nano-wrong-unit", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeNull()
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

  it("keeps provider polling opt-in when settings are absent", () => {
    const settings = normalizeUsageSettings({})
    expect(Object.values(settings.providers).every((provider) => !provider.enabled)).toBe(true)
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
    expect(plist).toContain("ELECTRON_RUN_AS_NODE")
    expect(plist).toContain("/path/with &amp; chars/node")
    expect(plist).toContain("<key>KeepAlive</key><false/>")
  })

  it("builds Windows and Linux per-user daemon launch definitions", () => {
    const params = {
      nodePath: "/Applications/Flapstack.app/Contents/MacOS/Flapstack",
      daemonEntryPath: "/tmp/out/usage-daemon.js",
      dbPath: "/tmp/data/agents.db",
      configDir: "/tmp/data",
      cadenceSeconds: 300,
    }
    const windows = buildWindowsDaemonScript({
      ...params,
      nodePath: "C:\\Program Files\\Flapstack\\Flapstack.exe",
      daemonEntryPath: "C:\\Program Files\\Flapstack\\resources\\usage-daemon.js",
      dbPath: "C:\\Users\\Test User\\AppData\\Roaming\\Flapstack\\agents.db",
      configDir: "C:\\Users\\Test User\\AppData\\Roaming\\Flapstack",
    })
    expect(windows).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(windows).toContain('"C:\\Program Files\\Flapstack\\Flapstack.exe"')
    const systemd = buildSystemdUserUnit(params)
    expect(systemd).toContain('Environment="FLAPSTACK_DB_PATH=/tmp/data/agents.db"')
    expect(systemd).toContain("WantedBy=default.target")
    expect(systemd).toContain('ExecStart="/Applications/Flapstack.app/Contents/MacOS/Flapstack"')
  })

  it("does not remove a daemon plist while launchctl still reports the job loaded", () => {
    const remove = vi.fn()
    const run = vi.fn((args: string[]) => {
      if (args[0] === "bootout") throw new Error("bootout failed")
      return undefined
    })
    expect(() =>
      uninstallLaunchAgent({ path: "/tmp/test.plist", domain: "gui/501", run, remove }),
    ).toThrow(/still loaded/)
    expect(remove).not.toHaveBeenCalled()
  })

  it("removes a stale daemon plist only after launchctl confirms no job is loaded", () => {
    const remove = vi.fn()
    const run = vi.fn(() => {
      throw new Error("not loaded")
    })
    uninstallLaunchAgent({ path: "/tmp/test.plist", domain: "gui/501", run, remove })
    expect(remove).toHaveBeenCalledWith("/tmp/test.plist")
  })

  it("uses elapsed time for in-progress spend windows", () => {
    expect(
      elapsedWindowHours(
        new Date("2026-07-10T00:00:00Z"),
        new Date("2026-07-11T00:00:00Z"),
        new Date("2026-07-10T06:00:00Z"),
      ),
    ).toBe(6)
  })

  it("normalizes Cursor epoch seconds and prefers the newer Cursor login", () => {
    expect(parseCursorTimestamp("1752000000")?.getTime()).toBe(1_752_000_000_000)
    const jwt = (exp: number) =>
      `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`
    expect(
      selectNewestCredentials(
        { token: jwt(2_000_000_000), refreshToken: "sqlite-refresh" },
        { token: jwt(1_900_000_000), refreshToken: "managed-refresh", flapstackManaged: true },
      ),
    ).toMatchObject({ source: "sqlite", refreshToken: "sqlite-refresh" })
  })

  it("keeps the daemon library import side-effect free", () => {
    const entry = readFileSync(resolve(process.cwd(), "src/main/usage-daemon.ts"), "utf8")
    const library = readFileSync(
      resolve(process.cwd(), "src/main/lib/usage-daemon/index.ts"),
      "utf8",
    )
    expect(entry.match(/void runDaemon\(\)/g)).toHaveLength(1)
    expect(library).not.toContain("FLAPSTACK_RUN_DAEMON")
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
        quotaUsed: 300_000,
        quotaLimit: 1_000_000,
        percentUsed: 30,
      },
    ])
    expect(fetch.mock.calls[0]?.[1]?.headers.authorization).toBe("Bearer local-token")
    expect(JSON.stringify(samples)).not.toContain("local-token")
  })

  it("collects full Cursor source-1 plan, credits, and request quotas", async () => {
    const jwt = `x.${Buffer.from(JSON.stringify({ sub: "auth0|user-123" })).toString("base64url")}.sig`
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("GetCurrentPeriodUsage")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                billingCycleStart: "1752000000000",
                billingCycleEnd: "1754600000000",
                planUsage: { totalSpend: 2500, limit: 5000, totalPercentUsed: 50 },
              }),
            ),
          )
        }
        if (url.includes("GetPlanInfo")) {
          return Promise.resolve(new Response(JSON.stringify({ planInfo: { planName: "Pro" } })))
        }
        if (url.includes("GetCreditGrantsBalance")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ hasCreditGrants: true, totalCents: "3000", usedCents: "1500" }),
            ),
          )
        }
        if (url.includes("/api/auth/stripe")) {
          return Promise.resolve(new Response(JSON.stringify({ customerBalance: -2000 })))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              startOfMonth: "1752000000000",
              "claude-sonnet": { numRequests: 12, maxRequestUsage: 100 },
            }),
          ),
        )
      }),
    )
    const samples = await pollInternalSource(
      {
        now: new Date("2026-07-10T00:00:00Z"),
        source: "daemon-poll",
        getSecret: async () => null,
        log: () => {},
      },
      jwt,
    )
    expect(samples.map((sample) => sample.metricKey)).toEqual([
      "total_usage",
      "credits",
      "requests:claude-sonnet",
    ])
    expect(samples.find((sample) => sample.metricKey === "total_usage")).toMatchObject({
      quotaUsed: 25_000_000,
      quotaLimit: 50_000_000,
      quotaUnit: "usd-micros",
    })
    expect(samples.find((sample) => sample.metricKey === "credits")).toMatchObject({
      quotaUsed: 15_000_000,
      quotaLimit: 50_000_000,
    })
  })

  it("normalizes personal Codex and Claude subscription quota windows", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("chatgpt.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              plan_type: "plus",
              rate_limit: {
                primary_window: {
                  used_percent: 42.4,
                  reset_at: 1_784_000_000,
                  limit_window_seconds: 18_000,
                },
                secondary_window: { used_percent: 12, reset_at: 1_784_500_000 },
              },
            }),
          ),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            five_hour: {
              utilization: 21.2,
              resets_at: "2026-07-11T00:00:00Z",
              is_enabled: true,
            },
            limits: [],
          }),
        ),
      )
    })
    vi.stubGlobal("fetch", fetch)
    const ctx = {
      now: new Date("2026-07-10T00:00:00Z"),
      source: "daemon-poll" as const,
      getSecret: async () => null,
      log: () => {},
    }
    const codex = await pollCodexPersonal(ctx, {
      accessToken: "codex-token",
      accountId: "account-1",
    })
    const claude = await pollAnthropicPersonal(ctx, "claude-token")
    expect(codex.map((sample) => sample.metricKey)).toEqual(["five_hour", "seven_day"])
    expect(codex[0]).toMatchObject({ billingKind: "subscription-quota", percentUsed: 42 })
    expect(claude).toMatchObject([
      { metricKey: "five_hour", billingKind: "subscription-quota", percentUsed: 21 },
    ])
  })
})
