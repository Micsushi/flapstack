// Stage 2 Track B - usage tracking tRPC router.
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
import {
  getUsageCredentialNamespace,
  getUsageSecret,
  hasUsageSecret,
  setUsageSecret,
} from "../../usage/secrets"
import { getAppUsageSecret } from "../../usage/app-secrets"
import { validateOpenAiOrganizationBinding } from "../../usage/providers/codex"
import { validateAnthropicOrganizationBinding } from "../../usage/providers/anthropic"
import { syncOnWatchUsageHistory } from "../../usage/onwatch-history"
import { readDaemonStatus } from "../../usage-daemon/lifecycle"
import {
  describeInstall,
  installUsageDaemon,
  uninstallUsageDaemon,
} from "../../usage-daemon/platform"
import { app } from "electron"
import { join } from "node:path"
import {
  listProviderStates,
  listRecentAlertEvents,
  listCurrentSamples,
  listRecentCycles,
  listRecentSamples,
  resetGenerationReconciliation,
  updateDaemonStatus,
} from "../../usage/store"
import { SAMPLE_SOURCES, USAGE_PROVIDER_IDS } from "../../usage/types"
import {
  usageBudgetContextSchema,
  usageBudgetCreateSchema,
  usageBudgetOverrideRequestSchema,
  usageBudgetUpdateSchema,
  usageInsightQuerySchema,
  usageRollupQuerySchema,
} from "../../../../shared/advanced-usage"
import {
  saveUsageExplorerViewSchema,
  usageExplorerExportSchema,
} from "../../../../shared/advanced-usage-explorer"
import { queryUsageRollups } from "../../usage/rollups"
import { queryUsageInsights } from "../../usage/insights"
import { exportAdvancedUsage, queryAdvancedUsageExplorer } from "../../usage/explorer"
import {
  deleteUsageExplorerView,
  listUsageExplorerViews,
  saveUsageExplorerView,
} from "../../usage/explorer-views"
import {
  appendUsageBudgetOverrideAudit,
  createUsageBudget,
  createUsageBudgetOverride,
  deleteUsageBudget,
  getUsageBudget,
  listUsageBudgets,
  resolveUsageBudgets,
  updateUsageBudget,
} from "../../usage/budgets"
import { McpApprovalLifecycle } from "../../mcp-control/approval-lifecycle"
import { createSqliteMcpApprovalCoordinator } from "../../mcp-control/approval-coordinator"
import { publishProductMcpInvalidation } from "../../mcp-control/invalidation-bridge"
import { randomUUID } from "node:crypto"

const providerIdSchema = z.enum(USAGE_PROVIDER_IDS)
const sampleSourceSchema = z.enum(SAMPLE_SOURCES)
const accountTagSchema = z.string().max(500).optional()
const thresholdSchema = z.object({
  quotaPercent: z.array(z.number().min(0).max(100)).optional(),
  spendUsd: z.array(z.number().min(0)).optional(),
  spendRateUsdPerHour: z.number().positive().nullable().optional(),
  spikeMultiplier: z.number().positive().nullable().optional(),
})
const secretKeySchema = z.enum([
  "openai.api_key",
  "anthropic.admin_key",
  "openrouter.api_key",
  "nanogpt.api_key",
  "cursor.api_key",
  "cursor.access_token",
  "discord.webhook_url",
])

function engineDeps() {
  return { db: getDatabase(), getSecret: getAppUsageSecret }
}

export const usageRouter = router({
  // ---- Capabilities (kept for back-compat with the earlier scaffold) ----
  getCapabilities: publicProcedure.query(() => ({
    enabled: true,
    daemonInstall: describeInstall(join(app.getPath("userData"), "data")),
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

  setOrganizationScope: publicProcedure
    .input(
      z
        .object({
          provider: z.enum(["openai", "anthropic"]),
          organizationId: z.string().trim().min(1).max(200).nullable(),
          scopeIds: z.array(z.string().trim().min(1).max(200)).max(100),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const settings = getUsageSettings()
      const scopeIds = [...new Set(input.scopeIds)].sort()
      const organization =
        input.provider === "openai"
          ? {
              ...settings.organization,
              openai: {
                organizationId: input.organizationId,
                projectIds: scopeIds,
                validatedBinding: null,
              },
            }
          : {
              ...settings.organization,
              anthropic: {
                organizationId: input.organizationId,
                workspaceIds: scopeIds,
                validatedBinding: null,
              },
            }
      const next = setUsageSettings({ organization })
      if (!input.organizationId) return next
      const secretKey = input.provider === "openai" ? "openai.api_key" : "anthropic.admin_key"
      const apiKey = getUsageSecret(secretKey)
      if (!apiKey) return next
      if (input.provider === "openai") {
        await validateOpenAiOrganizationBinding(
          apiKey,
          input.organizationId,
          next.organization.openai.projectIds,
        )
      } else {
        await validateAnthropicOrganizationBinding(
          apiKey,
          input.organizationId,
          next.organization.anthropic.workspaceIds,
        )
      }
      return getUsageSettings()
    }),

  // ---- Credentials (presence only; values never returned) ----
  getSecretPresence: publicProcedure.query(async () => ({
    "openai.api_key": hasUsageSecret("openai.api_key"),
    "anthropic.admin_key": hasUsageSecret("anthropic.admin_key"),
    "openrouter.api_key": (await getAppUsageSecret("openrouter.api_key")) != null,
    "nanogpt.api_key": (await getAppUsageSecret("nanogpt.api_key")) != null,
    "cursor.api_key": hasUsageSecret("cursor.api_key"),
    "cursor.access_token": hasUsageSecret("cursor.access_token"),
    "discord.webhook_url": hasUsageSecret("discord.webhook_url"),
  })),

  setSecret: publicProcedure
    .input(z.object({ key: secretKeySchema, value: z.string().nullable() }))
    .mutation(async ({ input }) => {
      setUsageSecret(input.key, input.value)
      if (input.key === "openai.api_key") {
        const settings = getUsageSettings()
        setUsageSettings({
          organization: {
            ...settings.organization,
            openai: {
              ...settings.organization.openai,
              validatedBinding: null,
            },
          },
        })
        if (input.value && settings.organization.openai.organizationId) {
          await validateOpenAiOrganizationBinding(
            input.value,
            settings.organization.openai.organizationId,
            settings.organization.openai.projectIds,
          )
        }
      } else if (input.key === "anthropic.admin_key") {
        const settings = getUsageSettings()
        setUsageSettings({
          organization: {
            ...settings.organization,
            anthropic: {
              ...settings.organization.anthropic,
              validatedBinding: null,
            },
          },
        })
        if (input.value && settings.organization.anthropic.organizationId) {
          await validateAnthropicOrganizationBinding(
            input.value,
            settings.organization.anthropic.organizationId,
            settings.organization.anthropic.workspaceIds,
          )
        }
      }
      return { ok: true, present: hasUsageSecret(input.key) }
    }),

  queryRollups: publicProcedure.input(usageRollupQuerySchema).query(async ({ input }) => {
    if (
      !input.providerIds ||
      input.providerIds.some((id) => id === "codex" || id === "anthropic")
    ) {
      await syncOnWatchUsageHistory(getDatabasePath())
    }
    return queryUsageRollups(getDatabase(), input)
  }),

  queryInsights: publicProcedure.input(usageInsightQuerySchema).query(async ({ input }) => {
    if (
      !input.rollup.providerIds ||
      input.rollup.providerIds.some((id) => id === "codex" || id === "anthropic")
    ) {
      await syncOnWatchUsageHistory(getDatabasePath())
    }
    return queryUsageInsights(getDatabase(), input)
  }),

  queryExplorer: publicProcedure.input(usageRollupQuerySchema).query(async ({ input }) => {
    if (
      !input.providerIds ||
      input.providerIds.some((id) => id === "codex" || id === "anthropic")
    ) {
      await syncOnWatchUsageHistory(getDatabasePath())
    }
    return queryAdvancedUsageExplorer(getDatabase(), input)
  }),

  exportAdvancedUsage: publicProcedure
    .input(usageExplorerExportSchema)
    .mutation(async ({ input }) => {
      if (
        !input.query.providerIds ||
        input.query.providerIds.some((id) => id === "codex" || id === "anthropic")
      ) {
        await syncOnWatchUsageHistory(getDatabasePath())
      }
      return exportAdvancedUsage(getDatabase(), input)
    }),

  listExplorerViews: publicProcedure.query(() => listUsageExplorerViews()),

  saveExplorerView: publicProcedure
    .input(saveUsageExplorerViewSchema)
    .mutation(({ input }) => saveUsageExplorerView(input)),

  deleteExplorerView: publicProcedure
    .input(z.object({ id: z.string().trim().min(1).max(200) }).strict())
    .mutation(({ input }) => deleteUsageExplorerView(input.id)),

  listBudgets: publicProcedure
    .input(z.object({ enabledOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listUsageBudgets(getDatabase(), input?.enabledOnly ?? false)),

  getBudget: publicProcedure
    .input(z.object({ id: z.string().trim().min(1).max(200) }))
    .query(({ input }) => getUsageBudget(getDatabase(), input.id)),

  createBudget: publicProcedure.input(usageBudgetCreateSchema).mutation(({ input }) =>
    createUsageBudget(getDatabase(), input, {
      callerChatId: "flapstack-settings-usage",
    }),
  ),

  updateBudget: publicProcedure.input(usageBudgetUpdateSchema).mutation(({ input }) =>
    updateUsageBudget(getDatabase(), input, {
      callerChatId: "flapstack-settings-usage",
    }),
  ),

  deleteBudget: publicProcedure
    .input(
      z.object({
        id: z.string().trim().min(1).max(200),
        expectedVersion: z.number().int().min(1),
      }),
    )
    .mutation(({ input }) =>
      deleteUsageBudget(getDatabase(), {
        ...input,
        callerChatId: "flapstack-settings-usage",
      }),
    ),

  resolveBudgets: publicProcedure
    .input(
      z.object({
        context: usageBudgetContextSchema,
        overrideToken: z.string().min(1).max(500).nullable().optional(),
      }),
    )
    .query(({ input }) =>
      resolveUsageBudgets(getDatabase(), input.context, {
        overrideToken: input.overrideToken,
      }),
    ),

  requestBudgetOverride: publicProcedure
    .input(usageBudgetOverrideRequestSchema)
    .mutation(async ({ input }) => requestBudgetOverride(input)),

  listCycles: publicProcedure
    .input(
      z
        .object({
          providerId: providerIdSchema.optional(),
          accountTag: accountTagSchema,
          limit: z.number().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const rows = await listRecentCycles(getDatabase(), input)
      return rows.map((row) => ({
        ...row,
        totalCostUsd: microsToUsd(row.totalCostUsd),
        totalCostUsdEstimated: microsToUsd(row.totalCostUsdEstimated),
      }))
    }),

  // ---- Provider states + samples (DB-first reads) ----
  listProviderStates: publicProcedure.query(async () => listProviderStates(getDatabase())),

  listSamples: publicProcedure
    .input(
      z
        .object({
          providerId: providerIdSchema.optional(),
          accountTag: accountTagSchema,
          source: sampleSourceSchema.optional(),
          flapstackOnly: z.boolean().optional(),
          sinceMs: z.number().optional(),
          limit: z.number().min(1).max(20_000).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      if (
        !input?.flapstackOnly &&
        (!input?.providerId || input.providerId === "codex" || input.providerId === "anthropic")
      ) {
        await syncOnWatchUsageHistory(getDatabasePath())
      }
      const rows = await listRecentSamples(getDatabase(), {
        providerId: input?.providerId,
        accountTag: input?.accountTag,
        source: input?.source,
        flapstackOnly: input?.flapstackOnly,
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

  listCurrentSamples: publicProcedure
    .input(
      z
        .object({
          providerId: providerIdSchema.optional(),
          accountTag: accountTagSchema,
          source: sampleSourceSchema.optional(),
          flapstackOnly: z.boolean().optional(),
          limitPerAccount: z.number().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      if (
        !input?.flapstackOnly &&
        (!input?.providerId || input.providerId === "codex" || input.providerId === "anthropic")
      ) {
        await syncOnWatchUsageHistory(getDatabasePath())
      }
      const rows = await listCurrentSamples(getDatabase(), input)
      return rows.map((row) => ({
        ...row,
        costUsd: microsToUsd(row.costUsd),
        costUsdEstimated: microsToUsd(row.costUsdEstimated),
      }))
    }),

  listAlertEvents: publicProcedure
    .input(
      z
        .object({
          providerId: providerIdSchema.optional(),
          accountTag: accountTagSchema,
          limit: z.number().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listRecentAlertEvents(getDatabase(), input ?? {})),

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

  retryGenerationReconciliation: publicProcedure
    .input(z.object({ providerId: providerIdSchema, generationId: z.string().min(1).optional() }))
    .mutation(async ({ input }) => {
      await resetGenerationReconciliation(getDatabase(), input.providerId, input.generationId)
      return { ok: true }
    }),

  // ---- Daemon status ----
  getDaemonStatus: publicProcedure.query(async () => readDaemonStatus(getDatabase())),

  installDaemon: publicProcedure.mutation(async () => {
    const previous = getUsageSettings()
    const settings = setUsageSettings({ daemonEnabled: true, daemonStartAtLogin: true })
    try {
      installUsageDaemon({
        nodePath: process.execPath,
        daemonEntryPath: join(__dirname, "usage-daemon.js"),
        dbPath: getDatabasePath(),
        configDir: join(app.getPath("userData"), "data"),
        cadenceSeconds: settings.cadenceSeconds,
        secretNamespace: getUsageCredentialNamespace(),
      })
    } catch (error) {
      setUsageSettings({
        daemonEnabled: previous.daemonEnabled,
        daemonStartAtLogin: previous.daemonStartAtLogin,
      })
      throw error
    }
    return readDaemonStatus(getDatabase())
  }),

  uninstallDaemon: publicProcedure.mutation(async () => {
    const previous = getUsageSettings()
    setUsageSettings({ daemonEnabled: false, daemonStartAtLogin: false })
    try {
      uninstallUsageDaemon(join(app.getPath("userData"), "data"))
    } catch (error) {
      setUsageSettings({
        daemonEnabled: previous.daemonEnabled,
        daemonStartAtLogin: previous.daemonStartAtLogin,
      })
      throw error
    }
    await updateDaemonStatus(getDatabase(), {
      enabled: false,
      running: false,
      pid: null,
    })
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

async function requestBudgetOverride(input: z.infer<typeof usageBudgetOverrideRequestSchema>) {
  const db = getDatabase()
  for (const id of input.budgetIds) {
    const budget = getUsageBudget(db, id)
    if (!budget || !budget.enabled || budget.action !== "hard-stop") {
      throw new Error("Budget override target must be an enabled hard-stop budget.")
    }
  }
  const publishApprovalChange = () => {
    void publishProductMcpInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["approvals"],
    })
  }
  const lifecycle = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(db, publishApprovalChange),
    publishApprovalChange,
  )
  const id = randomUUID()
  appendUsageBudgetOverrideAudit(db, {
    status: "approval-required",
    callerChatId: input.callerChatId,
    callerRunId: input.callerRunId,
    budgetIds: input.budgetIds,
    context: input.context,
    durationMs: input.durationMs,
  })
  try {
    const wait = lifecycle.request({
      id,
      invocationId: id,
      caller: { chatId: input.callerChatId, runId: input.callerRunId ?? undefined },
      toolName: "usage_budget.override",
      tier: 3,
      timeoutMs: 60_000,
      input: {
        target: input.budgetIds.join(","),
        budgetIds: input.budgetIds,
        scope: input.context,
        durationMs: input.durationMs,
        reason: input.reason,
      },
    })
    const decision = await wait.decision
    if (decision.state !== "approved") {
      appendUsageBudgetOverrideAudit(db, {
        status: decision.state === "denied" ? "denied" : "failed",
        callerChatId: input.callerChatId,
        callerRunId: input.callerRunId,
        budgetIds: input.budgetIds,
        context: input.context,
        durationMs: input.durationMs,
      })
      return { approved: false as const, decision: decision.state, override: null }
    }
    const override = createUsageBudgetOverride({
      budgetIds: input.budgetIds,
      context: input.context,
      durationMs: input.durationMs,
    })
    appendUsageBudgetOverrideAudit(db, {
      status: "completed",
      callerChatId: input.callerChatId,
      callerRunId: input.callerRunId,
      budgetIds: input.budgetIds,
      context: input.context,
      durationMs: input.durationMs,
    })
    return { approved: true as const, decision: decision.state, override }
  } finally {
    lifecycle.shutdown()
  }
}
