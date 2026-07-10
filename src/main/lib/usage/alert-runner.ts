import { evaluateSample, type AlertArmState } from "./alerts"
import { sendDiscordAlert } from "./discord"
import type { UsageSettings } from "./settings"
import { listAlertArmStates, recordAlertEvent, upsertAlertArmStates, type UsageDb } from "./store"
import type { UsageProvider, UsageSampleInput } from "./types"

export async function runAlerts(params: {
  db: UsageDb
  settings: UsageSettings
  getSecret: (key: string) => Promise<string | null>
  provider: UsageProvider
  samples: UsageSampleInput[]
}): Promise<number> {
  if (!params.settings.discordAlertsEnabled || params.samples.length === 0) return 0
  const webhook = await params.getSecret("discord.webhook_url")
  if (!webhook) return 0
  const thresholds = params.settings.providers[params.provider.id]?.thresholds
  if (!thresholds) return 0
  let arm: AlertArmState[] = (await listAlertArmStates(params.db)).map((row) => ({
    providerId: row.providerId as AlertArmState["providerId"],
    accountTag: row.accountTag || null,
    alertType: row.alertType as AlertArmState["alertType"],
    thresholdValue: row.thresholdValue ?? 0,
    armed: row.armed,
  }))
  let sent = 0
  for (const sample of params.samples) {
    const { intents, armUpdates } = evaluateSample(
      {
        providerId: sample.providerId,
        accountTag: sample.accountTag,
        billingKind: params.provider.billingKind,
        costQuality: sample.costQuality,
        percentUsed: sample.percentUsed,
        spendUsd: sample.costUsd ?? sample.costUsdEstimated ?? null,
      },
      thresholds,
      arm,
    )
    await upsertAlertArmStates(params.db, armUpdates)
    // Keep this run's in-memory arm state current too. A single provider poll
    // can return several samples; without this, each one could re-send the
    // same threshold notification before the next daemon tick.
    arm = mergeArmStates(arm, armUpdates)
    for (const intent of intents) {
      const delivery = await sendDiscordAlert(webhook, {
        title: `Flapstack usage alert: ${intent.providerId}`,
        body: intent.message,
        color: intent.costQuality === "estimated" ? 0xf59e0b : 0xef4444,
      })
      await recordAlertEvent(params.db, {
        providerId: intent.providerId,
        accountTag: intent.accountTag ?? "",
        alertType: intent.alertType,
        thresholdValue: Math.round(intent.thresholdValue * 1_000_000),
        observedValue: Math.round(intent.observedValue * 1_000_000),
        costQuality: intent.costQuality,
        channel: "discord",
        deliveryStatus: delivery.ok ? "sent" : "failed",
        deliveryError: delivery.error ?? null,
        message: intent.message,
      })
      if (delivery.ok) sent++
    }
  }
  return sent
}

function mergeArmStates(current: AlertArmState[], updates: AlertArmState[]): AlertArmState[] {
  const byKey = new Map(
    current.map((state) => [
      `${state.providerId}|${state.accountTag ?? ""}|${state.alertType}|${state.thresholdValue}`,
      state,
    ]),
  )
  for (const update of updates) {
    byKey.set(
      `${update.providerId}|${update.accountTag ?? ""}|${update.alertType}|${update.thresholdValue}`,
      update,
    )
  }
  return [...byKey.values()]
}
