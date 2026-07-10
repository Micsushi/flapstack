// Stage 2 Track B — usage tracking tRPC router.
//
// App/renderer surface for the shared usage engine: settings, credential
// presence, provider states, samples, manual refresh, and daemon status. Reads
// are DB-first so the dashboard loads fast before a refresh completes. Actual
// provider polling records honest capability/error states and never fabricates
// zero usage.

import { z } from "zod"
import { publicProcedure, router } from "../index"
import { getDatabase, getDatabasePath } from "../../db"
import { microsToUsd } from "../../usage/source-tags"
import { UsageEngine } from "../../usage/engine"
import { runManualRefresh } from "../../usage/catch-up"
import { getUsageProviders } from "../../usage/registry"
import { getUsageSettings, setUsageSettings } from "../../usage/settings"
import { getUsageSecret, hasUsageSecret, setUsageSecret } from "../../usage/secrets"
import { readDaemonStatus } from "../../usage-daemon/lifecycle"
import { installMacLaunchAgent, uninstallMacLaunchAgent } from "../../usage-daemon/platform"
import { app } from "electron"
import { join } from "node:path"
import { listProviderStates, listRecentAlertEvents, listRecentSamples } from "../../usage/store"
import { USAGE_PROVIDER_IDS } from "../../usage/types"

const providerIdSchema = z.enum(USAGE_PROVIDER_IDS)
const thresholdSchema = z.object({
  quotaPercent: z.array(z.number().min(0).max(100)).optional(),
  spendUsd: z.array(z.number().min(0)).optional(),
  spendRateUsdPerHour: z.number().positive().nullable().optional(),
  spikeMultiplier: z.number().positive().nullable().optional(),
})

function engineDeps() {
  return { db: getDatabase(), getSecret: async (key: string) => getUsageSecret(key) }
}

export const usageRouter = router({
  // ---- Capabilities (kept for back-compat with the earlier scaffold) ----
  getCapabilities: publicProcedure.query(() => ({
    enabled: true,
    providers: getUsageProviders().map((p) => ({
      id: p.id,
      label: p.label,
      billingKind: p.billingKind,
      supportsDaemon: p.supportsDaemon(),
      supportsHistorical: p.supportsHistorical(),
    })),
    normalizedFields: ["inputTokens", "outputTokens", "reasoningTokens", "totalTokens", "costUsd"],
    note: "Usage reads are local-first; provider capability labels distinguish account reports, key limits, and run-only data.",
  })),

  // ---- Settings ----
  getSettings: publicProcedure.query(() => getUsageSettings()),

  setSettings: publicProcedure
    .input(
      z
        .object({
          cadenceSeconds: z.number().min(30).optional(),
          daemonEnabled: z.boolean().optional(),
          daemonStartAtLogin: z.boolean().optional(),
          discordAlertsEnabled: z.boolean().optional(),
        })
        .passthrough(),
    )
    .mutation(({ input }) => setUsageSettings(input)),

  setProviderEnabled: publicProcedure
    .input(z.object({ providerId: providerIdSchema, enabled: z.boolean() }))
    .mutation(({ input }) => {
      const settings = getUsageSettings()
      settings.providers[input.providerId].enabled = input.enabled
      return setUsageSettings({ providers: settings.providers })
    }),

  setProviderSettings: publicProcedure
    .input(
      z.object({
        providerId: providerIdSchema,
        cadenceSecondsOverride: z.number().min(30).nullable().optional(),
        thresholds: thresholdSchema.optional(),
      }),
    )
    .mutation(({ input }) => {
      const settings = getUsageSettings()
      const current = settings.providers[input.providerId]
      settings.providers[input.providerId] = {
        ...current,
        ...(input.cadenceSecondsOverride !== undefined
          ? { cadenceSecondsOverride: input.cadenceSecondsOverride }
          : {}),
        thresholds: input.thresholds
          ? { ...current.thresholds, ...input.thresholds }
          : current.thresholds,
      }
      return setUsageSettings({ providers: settings.providers })
    }),

  // ---- Credentials (presence only; values never returned) ----
  getSecretPresence: publicProcedure.query(() => ({
    "openai.api_key": hasUsageSecret("openai.api_key"),
    "anthropic.admin_key": hasUsageSecret("anthropic.admin_key"),
    "openrouter.api_key": hasUsageSecret("openrouter.api_key"),
    "nanogpt.api_key": hasUsageSecret("nanogpt.api_key"),
    "discord.webhook_url": hasUsageSecret("discord.webhook_url"),
  })),

  setSecret: publicProcedure
    .input(z.object({ key: z.string().min(1), value: z.string().nullable() }))
    .mutation(({ input }) => {
      setUsageSecret(input.key, input.value)
      return { ok: true, present: hasUsageSecret(input.key) }
    }),

  // ---- Provider states + samples (DB-first reads) ----
  listProviderStates: publicProcedure.query(async () => listProviderStates(getDatabase())),

  listSamples: publicProcedure
    .input(
      z
        .object({
          providerId: providerIdSchema.optional(),
          sinceMs: z.number().optional(),
          limit: z.number().min(1).max(1000).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const rows = await listRecentSamples(getDatabase(), {
        providerId: input?.providerId,
        since: input?.sinceMs ? new Date(input.sinceMs) : undefined,
        limit: input?.limit,
      })
      // Map micro-dollars back to USD for the renderer.
      return rows.map((r) => ({
        ...r,
        costUsd: microsToUsd(r.costUsd),
        costUsdEstimated: microsToUsd(r.costUsdEstimated),
      }))
    }),

  listAlertEvents: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => listRecentAlertEvents(getDatabase(), input?.limit ?? 50)),

  // ---- Manual refresh (same reconcile path as startup catch-up) ----
  refresh: publicProcedure
    .input(z.object({ providerId: providerIdSchema.optional() }).optional())
    .mutation(async ({ input }) => runManualRefresh(engineDeps(), input?.providerId)),

  // ---- Single-shot poll for one provider (dev/debug) ----
  pollProvider: publicProcedure
    .input(z.object({ providerId: providerIdSchema }))
    .mutation(async ({ input }) => {
      const engine = new UsageEngine("app", engineDeps())
      return engine.runProviderById(input.providerId, "poll")
    }),

  // ---- Daemon status ----
  getDaemonStatus: publicProcedure.query(async () => readDaemonStatus(getDatabase())),

  installDaemon: publicProcedure.mutation(async () => {
    const settings = setUsageSettings({ daemonEnabled: true, daemonStartAtLogin: true })
    installMacLaunchAgent({
      nodePath: process.execPath,
      daemonEntryPath: join(__dirname, "../../../usage-daemon.js"),
      dbPath: getDatabasePath(),
      configDir: app.getPath("userData"),
      cadenceSeconds: settings.cadenceSeconds,
    })
    return readDaemonStatus(getDatabase())
  }),

  uninstallDaemon: publicProcedure.mutation(async () => {
    setUsageSettings({ daemonEnabled: false, daemonStartAtLogin: false })
    uninstallMacLaunchAgent()
    return readDaemonStatus(getDatabase())
  }),

  // ---- Legacy per-run summary (kept; now reads samples by runId) ----
  summarizeRun: publicProcedure.input(z.object({ runId: z.string() })).query(async ({ input }) => {
    const rows = await listRecentSamples(getDatabase(), { limit: 1000 })
    const match = rows.find((r) => r.runId === input.runId)
    if (!match) {
      return {
        runId: input.runId,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        status: "not-captured" as const,
      }
    }
    return {
      runId: input.runId,
      inputTokens: match.inputTokens,
      outputTokens: match.outputTokens,
      totalTokens: match.totalTokens,
      costUsd: microsToUsd(match.costUsd),
      status: "captured" as const,
    }
  }),
})
