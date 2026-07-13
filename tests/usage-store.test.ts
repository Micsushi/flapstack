import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { runAlerts } from "../src/main/lib/usage/alert-runner"
import { UsageEngine } from "../src/main/lib/usage/engine"
import { getUsageProvider } from "../src/main/lib/usage/registry"
import {
  captureOpenCodeRunUsage,
  captureOpenCodeRunUsageBatch,
} from "../src/main/lib/usage/run-usage"
import { mergeSidecarUsage } from "../src/main/lib/harness/opencode-sidecar/usage"
import { normalizeUsageSettings } from "../src/main/lib/usage/settings"
import {
  applyUsageStorePragmas,
  insertSamples,
  listCurrentSamples,
  listPendingGenerationIds,
  listAlertArmStates,
  listProviderStates,
  listRecentAlertEvents,
  listRecentCycles,
  listRecentSamples,
  markGenerationReconciliation,
  upsertAlertArmStates,
  upsertProviderState,
  withWriteRetry,
  type UsageDb,
} from "../src/main/lib/usage/store"
import {
  UsageProviderError,
  type UsageProvider,
  type UsageSampleInput,
} from "../src/main/lib/usage/types"

describe("usage SQLite integration", () => {
  let sqlite: Database.Database | null
  let db: UsageDb

  beforeEach(() => {
    sqlite = new Database(":memory:")
    applyUsageStorePragmas(sqlite)
    sqlite.exec("CREATE TABLE agent_runs (id text PRIMARY KEY)")
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0009_exotic_red_wolf.sql"),
      "utf8",
    ).replaceAll("--> statement-breakpoint", "")
    sqlite.exec(migration)
    sqlite.exec(
      readFileSync(
        resolve(process.cwd(), "drizzle/0011_usage_generation_reconciliation.sql"),
        "utf8",
      ).replaceAll("--> statement-breakpoint", ""),
    )
    sqlite.exec(
      readFileSync(
        resolve(process.cwd(), "drizzle/0012_usage_alert_threshold_micros.sql"),
        "utf8",
      ).replaceAll("--> statement-breakpoint", ""),
    )
    sqlite.exec(
      readFileSync(
        resolve(process.cwd(), "drizzle/0013_cursor_usage_account_cleanup.sql"),
        "utf8",
      ).replaceAll("--> statement-breakpoint", ""),
    )
    sqlite.exec(
      readFileSync(resolve(process.cwd(), "drizzle/0015_dear_toad_men.sql"), "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    )
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

  it("filters samples, cycles, and alerts by provider account", async () => {
    const windowStart = new Date("2026-07-10T00:00:00Z")
    const windowEnd = new Date("2026-07-11T00:00:00Z")
    await insertSamples(db, [
      sample({
        accountTag: "team-a",
        windowStart,
        windowEnd,
        costUsd: 1,
        dedupeKey: "codex|team-a|2026-07-10",
      }),
      sample({
        accountTag: "team-b",
        windowStart,
        windowEnd,
        costUsd: 2,
        dedupeKey: "codex|team-b|2026-07-10",
      }),
    ])
    await db.insert(schema.usageAlertEvents).values([
      {
        providerId: "codex",
        accountTag: "team-a",
        alertType: "api-dollar-budget",
        deliveryStatus: "sent",
        message: "team-a alert",
      },
      {
        providerId: "codex",
        accountTag: "team-b",
        alertType: "api-dollar-budget",
        deliveryStatus: "sent",
        message: "team-b alert",
      },
    ])

    expect(await listRecentSamples(db, { providerId: "codex", accountTag: "team-a" })).toHaveLength(
      1,
    )
    expect(await listRecentCycles(db, { providerId: "codex", accountTag: "team-a" })).toHaveLength(
      1,
    )
    expect(
      await listRecentAlertEvents(db, { providerId: "codex", accountTag: "team-a" }),
    ).toMatchObject([{ accountTag: "team-a", message: "team-a alert" }])
  })

  it("loads current samples per provider instead of one global recent limit", async () => {
    const samples: UsageSampleInput[] = Array.from({ length: 30 }, (_, index) =>
      sample({
        capturedAt: new Date(1_800_000_000_000 + index),
        dedupeKey: `codex|noisy|${index}`,
      }),
    )
    samples.push(
      sample({
        providerId: "anthropic",
        capturedAt: new Date(1_700_000_000_000),
        dedupeKey: "anthropic|quiet",
      }),
    )
    await insertSamples(db, samples)
    const current = await listCurrentSamples(db, { limitPerAccount: 2 })
    expect(current.filter((row) => row.providerId === "codex")).toHaveLength(2)
    expect(current.some((row) => row.providerId === "anthropic")).toBe(true)
  })

  it("filters current and historical samples to Flapstack-linked runs", async () => {
    sqlite!.prepare("INSERT INTO agent_runs (id) VALUES (?), (?)").run("run-direct", "run-exact")
    await insertSamples(db, [
      sample({ source: "app-poll", dedupeKey: "codex|general" }),
      sample({
        source: "flapstack-run",
        runId: "run-direct",
        dedupeKey: "codex|flapstack-direct",
      }),
      sample({
        source: "startup-reconcile",
        runId: "run-exact",
        dedupeKey: "codex|flapstack-exact",
      }),
    ])

    expect(await listRecentSamples(db, { source: "flapstack-run" })).toHaveLength(1)
    expect(await listRecentSamples(db, { flapstackOnly: true })).toHaveLength(2)
    expect(await listCurrentSamples(db, { flapstackOnly: true })).toHaveLength(2)
  })

  it("removes legacy Cursor source names that were stored as account tags", async () => {
    for (const accountTag of ["internal", "admin", "cli", "real-account"]) {
      await upsertProviderState(db, {
        providerId: "cursor",
        accountTag,
        status: "ok",
        configured: true,
        supportsDaemon: true,
        supportsHistorical: false,
      })
    }

    sqlite!.exec(
      readFileSync(resolve(process.cwd(), "drizzle/0013_cursor_usage_account_cleanup.sql"), "utf8"),
    )

    expect((await listProviderStates(db)).map((state) => state.accountTag)).toEqual([
      "real-account",
    ])
  })

  it("preserves stronger exact cost when a weaker duplicate adds token metadata", async () => {
    const windowStart = new Date("2026-07-10T00:00:00Z")
    const windowEnd = new Date("2026-07-11T00:00:00Z")
    await insertSamples(db, [
      sample({
        costQuality: "exact",
        costUsd: 2,
        windowStart,
        windowEnd,
        dedupeKey: "codex|quality|2026-07-10",
      }),
    ])
    await insertSamples(db, [
      sample({
        costQuality: "estimated",
        costUsdEstimated: 9,
        totalTokens: 321,
        windowStart,
        windowEnd,
        dedupeKey: "codex|quality|2026-07-10",
      }),
    ])

    const [stored] = await listRecentSamples(db)
    const [cycle] = await listRecentCycles(db)
    expect(stored).toMatchObject({
      costQuality: "exact",
      costUsd: 2_000_000,
      costUsdEstimated: null,
      totalTokens: 321,
    })
    expect(cycle).toMatchObject({
      costQuality: "exact",
      totalCostUsd: 2_000_000,
      totalCostUsdEstimated: null,
      totalTokens: 321,
    })
  })

  it("keeps cost provenance when a metadata-only duplicate claims stronger quality", async () => {
    const windowStart = new Date("2026-07-10T00:00:00Z")
    const windowEnd = new Date("2026-07-11T00:00:00Z")
    await insertSamples(db, [
      sample({
        costQuality: "estimated",
        costUsdEstimated: 1.25,
        windowStart,
        windowEnd,
        dedupeKey: "codex|metadata-only-quality",
      }),
    ])
    await insertSamples(db, [
      sample({
        costQuality: "exact",
        totalTokens: 99,
        windowStart,
        windowEnd,
        dedupeKey: "codex|metadata-only-quality",
      }),
    ])

    expect(await listRecentSamples(db)).toMatchObject([
      {
        costQuality: "estimated",
        costUsd: null,
        costUsdEstimated: 1_250_000,
        totalTokens: 99,
      },
    ])
    expect(await listRecentCycles(db)).toMatchObject([
      {
        costQuality: "estimated",
        totalCostUsd: null,
        totalCostUsdEstimated: 1_250_000,
        totalTokens: 99,
      },
    ])
  })

  it("clears a weaker estimate when exact cost replaces it", async () => {
    const windowStart = new Date("2026-07-10T00:00:00Z")
    const windowEnd = new Date("2026-07-11T00:00:00Z")
    const dedupeKey = "codex|exact-upgrade"
    await insertSamples(db, [
      sample({
        costQuality: "estimated",
        costUsdEstimated: 8,
        windowStart,
        windowEnd,
        dedupeKey,
      }),
    ])
    await insertSamples(db, [
      sample({ costQuality: "exact", costUsd: 2, windowStart, windowEnd, dedupeKey }),
    ])

    expect(await listRecentSamples(db)).toMatchObject([
      { costQuality: "exact", costUsd: 2_000_000, costUsdEstimated: null },
    ])
    expect(await listRecentCycles(db)).toMatchObject([
      { costQuality: "exact", totalCostUsd: 2_000_000, totalCostUsdEstimated: null },
    ])
  })

  it("retries transient SQLite locks but surfaces exhausted and corrupt writes", async () => {
    let attempts = 0
    await expect(
      withWriteRetry(() => {
        attempts++
        if (attempts < 3) throw new Error("SQLITE_BUSY: database is locked")
        return "stored"
      }),
    ).resolves.toBe("stored")
    expect(attempts).toBe(3)

    await expect(
      withWriteRetry(() => {
        throw new Error("SQLITE_CORRUPT: database disk image is malformed")
      }),
    ).rejects.toThrow("SQLITE_CORRUPT")
  })

  it("continues later providers after a provider deadline", async () => {
    const settings = normalizeUsageSettings({})
    for (const provider of Object.values(settings.providers)) provider.enabled = false
    settings.providers.codex.enabled = true
    settings.providers.anthropic.enabled = true
    const providers: UsageProvider[] = [
      testProvider("codex", async () => {
        throw new UsageProviderError(
          "codex",
          "source-unavailable",
          "deadline exceeded Authorization: Bearer sk-provider-secret-value",
        )
      }),
      testProvider("anthropic", async (source) => [
        sample({
          providerId: "anthropic",
          source,
          costQuality: "unknown",
          totalTokens: 7,
          dedupeKey: "anthropic|after-codex-failure",
        }),
      ]),
    ]
    const engine = new UsageEngine("app", {
      db,
      getSecret: async () => "test",
      loadSettings: () => settings,
      loadProviders: () => providers,
    })

    await expect(engine.runOnce()).resolves.toMatchObject([
      { providerId: "codex", status: "source-unavailable", inserted: 0 },
      { providerId: "anthropic", status: "ok", inserted: 1 },
    ])
    expect(await listRecentSamples(db, { providerId: "anthropic" })).toHaveLength(1)
    expect(await listProviderStates(db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "codex",
          lastError: "deadline exceeded Authorization: [redacted]",
        }),
        expect.objectContaining({ providerId: "anthropic", lastSuccessAt: expect.any(Date) }),
      ]),
    )
    expect(JSON.stringify(await listProviderStates(db))).not.toContain("provider-secret-value")
  })

  it("persists OpenCode token usage even when model pricing is unknown", async () => {
    sqlite!.prepare("INSERT INTO agent_runs (id) VALUES (?)").run("run-unknown-price")
    await captureOpenCodeRunUsage(db, {
      providerId: "openrouter",
      runId: "run-unknown-price",
      model: "unknown-model-hardening-test",
      inputTokens: 100,
      outputTokens: 25,
      reasoningTokens: 5,
      totalTokens: 130,
      generationId: "gen-unknown-price",
    })

    const [stored] = await listRecentSamples(db)
    expect(stored).toMatchObject({
      providerId: "openrouter",
      runId: "run-unknown-price",
      generationId: "gen-unknown-price",
      inputTokens: 100,
      outputTokens: 25,
      reasoningTokens: 5,
      totalTokens: 130,
      costQuality: "unknown",
      costUsd: null,
      costUsdEstimated: null,
      dedupeKey: "openrouter|gen|gen-unknown-price",
    })
    expect(await listPendingGenerationIds(db, "openrouter")).toEqual(["gen-unknown-price"])

    await insertSamples(db, [
      {
        providerId: "openrouter",
        source: "startup-reconcile",
        sourceTag: "generation-total-cost",
        costQuality: "exact",
        costUsd: 0.0042,
        generationId: "gen-unknown-price",
        dedupeKey: "openrouter|gen|gen-unknown-price",
      },
    ])
    const [reconciled] = await listRecentSamples(db)
    expect(reconciled).toMatchObject({
      runId: "run-unknown-price",
      costQuality: "exact",
      costUsd: 4_200,
    })
    expect(await listPendingGenerationIds(db, "openrouter")).toEqual([])
  })

  it("persists every OpenRouter generation in a multi-step run", async () => {
    sqlite!.prepare("INSERT INTO agent_runs (id) VALUES (?)").run("run-multi")
    await captureOpenCodeRunUsageBatch(db, [
      {
        providerId: "openrouter",
        runId: "run-multi",
        model: "openai/gpt-4.1-mini",
        generationId: "gen-first",
        totalTokens: 10,
      },
      {
        providerId: "openrouter",
        runId: "run-multi",
        model: "openai/gpt-4.1-mini",
        generationId: "gen-second",
        totalTokens: 20,
      },
    ])
    const rows = await listRecentSamples(db, { providerId: "openrouter" })
    expect(rows.map((row) => row.generationId).sort()).toEqual(["gen-first", "gen-second"])
    expect(rows.map((row) => row.totalTokens).sort((a, b) => Number(a) - Number(b))).toEqual([
      10, 20,
    ])
  })

  it("persists an all-provider-reported sidecar total as reported cost", async () => {
    sqlite!.prepare("INSERT INTO agent_runs (id) VALUES (?)").run("run-reported-cost")
    const usage = mergeSidecarUsage([
      { inputTokens: 50, costUsd: 0.01, costQuality: "provider-reported" },
      { outputTokens: 25, costUsd: 0.02, costQuality: "provider-reported" },
    ])

    await captureOpenCodeRunUsage(db, {
      providerId: "openrouter",
      runId: "run-reported-cost",
      model: "reported-model",
      ...usage,
    })

    expect(await listRecentSamples(db)).toMatchObject([
      {
        runId: "run-reported-cost",
        costQuality: "provider-reported",
        costUsd: 30_000,
        costUsdEstimated: null,
      },
    ])
  })

  it("hydrates persisted OpenCode pricing when usage capture runs before model listing", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "flapstack-cold-pricing-"))
    const previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
    process.env.FLAPSTACK_CONFIG_DIR = configDir
    const cases = [
      {
        providerId: "openrouter" as const,
        runId: "run-cold-openrouter",
        cachedModel: "cold-openrouter-model",
        runModel: "openrouter/cold-openrouter-model",
        inputPerMTok: 1,
        outputPerMTok: 2,
      },
      {
        providerId: "nanogpt" as const,
        runId: "run-cold-nanogpt",
        cachedModel: "cold-nanogpt-model",
        runModel: "nanogpt/cold-nanogpt-model",
        inputPerMTok: 3,
        outputPerMTok: 4,
      },
    ]

    try {
      writeFileSync(
        join(configDir, "opencode-provider-models.json"),
        JSON.stringify(
          Object.fromEntries(
            cases.map((entry) => [
              entry.providerId,
              {
                provider: entry.providerId,
                updatedAt: Date.now(),
                models: [
                  {
                    id: entry.cachedModel,
                    label: entry.cachedModel,
                    pricing: {
                      inputPerMTok: entry.inputPerMTok,
                      outputPerMTok: entry.outputPerMTok,
                    },
                  },
                ],
              },
            ]),
          ),
        ),
      )

      for (const entry of cases) {
        sqlite!.prepare("INSERT INTO agent_runs (id) VALUES (?)").run(entry.runId)
        await captureOpenCodeRunUsage(db, {
          providerId: entry.providerId,
          runId: entry.runId,
          model: entry.runModel,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        })
      }

      const stored = await listRecentSamples(db)
      expect(stored.find((row) => row.runId === "run-cold-openrouter")).toMatchObject({
        costQuality: "estimated",
        costUsdEstimated: 3_000_000,
      })
      expect(stored.find((row) => row.runId === "run-cold-nanogpt")).toMatchObject({
        costQuality: "estimated",
        costUsdEstimated: 7_000_000,
      })
    } finally {
      if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
      else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it("fails open to token-only usage when the persisted model cache is malformed", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "flapstack-bad-pricing-"))
    const previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
    process.env.FLAPSTACK_CONFIG_DIR = configDir
    const malformedCaches = [
      null,
      { openrouter: { provider: "openrouter", updatedAt: Date.now(), models: null } },
    ]

    try {
      for (const [index, cache] of malformedCaches.entries()) {
        writeFileSync(join(configDir, "opencode-provider-models.json"), JSON.stringify(cache))
        const runId = `run-malformed-cache-${index}`
        sqlite!.prepare("INSERT INTO agent_runs (id) VALUES (?)").run(runId)
        await expect(
          captureOpenCodeRunUsage(db, {
            providerId: "openrouter",
            runId,
            model: `never-priced-malformed-${index}`,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          }),
        ).resolves.toBe(1)
      }

      expect(await listRecentSamples(db)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId: "run-malformed-cache-0",
            costQuality: "unknown",
            totalTokens: 15,
          }),
          expect.objectContaining({
            runId: "run-malformed-cache-1",
            costQuality: "unknown",
            totalTokens: 15,
          }),
        ]),
      )
    } finally {
      if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
      else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it("loads OpenRouter per-token pricing and estimates a prefixed OpenCode model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/models")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [
                  {
                    id: "review/priced-model",
                    pricing: { prompt: "0.000001", completion: "0.000002" },
                  },
                ],
              }),
            ),
          )
        }
        return Promise.resolve(new Response(JSON.stringify({ data: { label: "test", usage: 1 } })))
      }),
    )
    await getUsageProvider("openrouter")!.pollLatest({
      now: new Date("2026-07-10T12:00:00Z"),
      source: "app-poll",
      getSecret: async () => "sk-or-test",
      log: () => {},
    })
    sqlite!.prepare("INSERT INTO agent_runs (id) VALUES (?)").run("run-priced")
    const settings = normalizeUsageSettings({})
    settings.discordAlertsEnabled = true
    settings.providers.openrouter.thresholds.spendUsd = [2]
    await captureOpenCodeRunUsage(
      db,
      {
        providerId: "openrouter",
        runId: "run-priced",
        model: "openrouter/review/priced-model",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
      },
      {
        alerts: {
          settings,
          getSecret: async () => "https://discord.com/api/webhooks/1/test",
          provider: getUsageProvider("openrouter")!,
        },
      },
    )

    const [stored] = await listRecentSamples(db)
    expect(stored).toMatchObject({
      runId: "run-priced",
      model: "openrouter/review/priced-model",
      costQuality: "estimated",
      costUsdEstimated: 3_000_000,
    })
    expect(await listRecentAlertEvents(db)).toMatchObject([
      { alertType: "estimated-spend", costQuality: "estimated", deliveryStatus: "sent" },
    ])
  })

  it("stops retrying terminal generation ids until explicitly reset", async () => {
    await insertSamples(db, [
      sample({
        providerId: "openrouter",
        generationId: "gen-missing",
        costQuality: "unknown",
        dedupeKey: "openrouter|gen|gen-missing",
      }),
    ])
    expect(await listPendingGenerationIds(db, "openrouter")).toEqual(["gen-missing"])
    await markGenerationReconciliation(db, "openrouter", "gen-missing", "unavailable", "HTTP 404")
    expect(await listPendingGenerationIds(db, "openrouter")).toEqual([])
  })

  it("resolves only exact OpenRouter generations after their samples are stored", async () => {
    await insertSamples(db, [
      sample({
        providerId: "openrouter",
        generationId: "gen-exact",
        costQuality: "unknown",
        dedupeKey: "openrouter|gen|gen-exact",
      }),
      sample({
        providerId: "openrouter",
        generationId: "gen-reported",
        costQuality: "unknown",
        dedupeKey: "openrouter|gen|gen-reported",
      }),
    ])
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const parsed = new URL(url)
        if (parsed.pathname.endsWith("/models"))
          return Promise.resolve(new Response(JSON.stringify({ data: [] })))
        if (parsed.pathname.endsWith("/key"))
          return Promise.resolve(new Response(JSON.stringify({ data: { usage: 1 } })))
        const id = parsed.searchParams.get("id")
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: id === "gen-exact" ? { id, total_cost: 0.1 } : { id, usage: 0.2 },
            }),
          ),
        )
      }),
    )
    const settings = normalizeUsageSettings({})
    settings.providers.openrouter.enabled = true
    const engine = new UsageEngine("app", {
      db,
      getSecret: async () => "sk-or-test",
      loadSettings: () => settings,
    })
    await expect(engine.runProviderById("openrouter")).resolves.toMatchObject({ status: "ok" })
    const reconciliation = await db
      .select()
      .from(schema.usageGenerationReconciliation)
      .orderBy(schema.usageGenerationReconciliation.generationId)
    expect(reconciliation).toMatchObject([
      { generationId: "gen-exact", state: "resolved" },
      { generationId: "gen-reported", state: "retry" },
    ])
    expect(reconciliation[1]?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now())
    expect(await listPendingGenerationIds(db, "openrouter")).toEqual([])
    expect(await listRecentSamples(db, { providerId: "openrouter" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ generationId: "gen-exact", costQuality: "exact" }),
      ]),
    )
  })

  it("preserves known reconciliation metadata and keeps usage token metrics", async () => {
    await insertSamples(db, [
      sample({
        providerId: "openrouter",
        model: "model-a",
        inputTokens: 12,
        outputTokens: 5,
        requestCount: 1,
        generationId: "gen-meta",
        rawPayload: { input_tokens: 12, access_token: "secret" },
        dedupeKey: "openrouter|gen|gen-meta",
      }),
    ])
    await insertSamples(db, [
      sample({
        providerId: "openrouter",
        costQuality: "exact",
        costUsd: 0.01,
        generationId: "gen-meta",
        dedupeKey: "openrouter|gen|gen-meta",
      }),
    ])
    const [stored] = await listRecentSamples(db)
    expect(stored).toMatchObject({
      model: "model-a",
      inputTokens: 12,
      outputTokens: 5,
      requestCount: 1,
    })
    expect(JSON.parse(stored!.rawPayload!)).toEqual({
      input_tokens: 12,
      access_token: "[redacted]",
    })
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

  it("claims an alert before delivery so concurrent runners send it once", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<Response>((resolve) =>
            setTimeout(() => resolve(new Response(null, { status: 204 })), 5),
          ),
      )
    vi.stubGlobal("fetch", fetch)
    const settings = normalizeUsageSettings({})
    settings.discordAlertsEnabled = true
    settings.providers.cursor.thresholds.quotaPercent = [80]
    const samples = [cursorSample(85, new Date("2026-07-10T12:00:00Z"))]
    await insertSamples(db, samples)
    const params = {
      db,
      settings,
      getSecret: async () => "https://discord.com/api/webhooks/1/test",
      provider: getUsageProvider("cursor")!,
      samples,
    }
    expect(await Promise.all([runAlerts(params), runAlerts(params)])).toEqual(
      expect.arrayContaining([0, 1]),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("keeps a failed Discord alert armed and retries it on the next run", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetch)
    const settings = normalizeUsageSettings({})
    settings.discordAlertsEnabled = true
    settings.providers.cursor.enabled = true
    settings.providers.cursor.thresholds.quotaPercent = [80]
    const samples = [cursorSample(85, new Date("2026-07-10T12:00:00Z"))]
    const params = {
      db,
      settings,
      getSecret: async () => "https://discord.com/api/webhooks/1/test",
      provider: getUsageProvider("cursor")!,
      samples,
    }

    await expect(runAlerts(params)).resolves.toBe(0)
    await expect(runAlerts(params)).resolves.toBe(1)
    await expect(runAlerts(params)).resolves.toBe(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await listRecentAlertEvents(db)).map((event) => event.deliveryStatus)).toEqual([
      "sent",
      "failed",
    ])
  })

  it("stores alert arm thresholds in micro-units and returns evaluator decimals", async () => {
    await upsertAlertArmStates(db, [
      {
        providerId: "cursor",
        alertType: "api-spend-spike",
        thresholdValue: 2.5,
        armed: true,
      },
    ])
    const [raw] = await db.select().from(schema.usageAlertArmStates)
    expect(raw?.thresholdValue).toBe(2_500_000)
    expect(await listAlertArmStates(db)).toMatchObject([{ thresholdValue: 2.5 }])
  })

  it("records provider success and error timestamps", async () => {
    const status = {
      providerId: "cursor" as const,
      status: "ok" as const,
      configured: true,
      supportsDaemon: true,
      supportsHistorical: false,
    }
    await upsertProviderState(db, status, { kind: "success" })
    expect(await listProviderStates(db)).toMatchObject([
      { lastSuccessAt: expect.any(Date), lastErrorAt: null, lastError: null },
    ])
    await upsertProviderState(
      db,
      { ...status, status: "source-unavailable" },
      {
        kind: "error",
        message: "provider failed",
      },
    )
    expect(await listProviderStates(db)).toMatchObject([
      {
        lastSuccessAt: expect.any(Date),
        lastErrorAt: expect.any(Date),
        lastError: "provider failed",
      },
    ])
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
    for (const provider of Object.values(settings.providers)) provider.enabled = false
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
        "usage_generation_reconciliation",
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

function testProvider(
  id: "codex" | "anthropic",
  poll: (source: UsageSampleInput["source"]) => Promise<UsageSampleInput[]>,
): UsageProvider {
  return {
    id,
    label: id,
    billingKind: "api-spend",
    isConfigured: async () => true,
    getStatus: async () => ({
      providerId: id,
      status: "ok",
      configured: true,
      supportsDaemon: true,
      supportsHistorical: true,
    }),
    pollLatest: async (ctx) => poll(ctx.source),
    reconcileSince: async (ctx) => poll(ctx.source),
    supportsDaemon: () => true,
    supportsHistorical: () => true,
  }
}
