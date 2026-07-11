import { evaluateSample, type AlertArmState } from "./alerts"
import { sendDiscordAlert } from "./discord"
import type { UsageSettings } from "./settings"
import { deriveDedupeKey, microsToUsd } from "./source-tags"
import {
  claimAlertArmState,
  listAlertArmStates,
  listRecentSamples,
  recordAlertEvent,
  updateDaemonStatus,
  upsertAlertArmStates,
  type UsageDb,
} from "./store"
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
  // A failed delivery stays armed for the next daemon tick, but do not hammer
  // the same webhook repeatedly when one poll returned several high samples.
  const attemptedThisRun = new Set<string>()
  for (const sample of params.samples) {
    const spendUsd = sample.costUsd ?? sample.costUsdEstimated ?? null
    const history =
      spendUsd != null
        ? await listRecentSamples(params.db, {
            providerId: sample.providerId,
            accountTag: sample.accountTag ?? "",
            limit: 20,
          })
        : []
    const priorSpend = history
      .filter(
        (row) =>
          row.accountTag === (sample.accountTag ?? "") &&
          row.dedupeKey !== deriveDedupeKey(sample) &&
          row.sourceTag === (sample.sourceTag ?? null) &&
          compatibleWindow(row.windowStart, row.windowEnd, sample.windowStart, sample.windowEnd),
      )
      .map((row) => microsToUsd(row.costUsd ?? row.costUsdEstimated))
      .filter((value): value is number => value != null && value > 0)
      .slice(0, 5)
    const trailingAverage =
      priorSpend.length >= 3
        ? priorSpend.reduce((total, value) => total + value, 0) / priorSpend.length
        : null
    const windowHours = elapsedWindowHours(
      sample.windowStart,
      sample.windowEnd,
      sample.capturedAt ?? new Date(),
    )
    const { intents, armUpdates } = evaluateSample(
      {
        providerId: sample.providerId,
        accountTag: sample.accountTag,
        billingKind: sample.billingKind ?? params.provider.billingKind,
        costQuality: sample.costQuality,
        percentUsed: sample.percentUsed,
        spendUsd,
        spendRateUsdPerHour:
          spendUsd != null && windowHours != null && windowHours > 0
            ? spendUsd / windowHours
            : null,
        spikeMultiplierObserved:
          spendUsd != null && trailingAverage != null && trailingAverage > 0
            ? spendUsd / trailingAverage
            : null,
      },
      thresholds,
      arm,
    )
    const rearmUpdates = armUpdates.filter((update) => update.armed)
    await upsertAlertArmStates(params.db, rearmUpdates)
    arm = mergeArmStates(arm, rearmUpdates)
    for (const intent of intents) {
      const key = alertStateKey(intent)
      if (attemptedThisRun.has(key)) continue
      attemptedThisRun.add(key)
      const claimed = await claimAlertArmState(params.db, intent)
      if (!claimed) continue
      const claimedState = { ...intent, armed: false }
      arm = mergeArmStates(arm, [claimedState])
      const delivery = await sendDiscordAlert(webhook, {
        title: `Flapstack usage alert: ${intent.providerId}`,
        body: intent.message,
        color: intent.costQuality === "estimated" ? 0xf59e0b : 0xef4444,
      })
      if (!delivery.ok) {
        // Release the claim before any fallible bookkeeping so a failed
        // delivery is always retried on the next daemon tick.
        const rearm = { ...intent, armed: true }
        await upsertAlertArmStates(params.db, [rearm])
        arm = mergeArmStates(arm, [rearm])
      }
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
      if (delivery.ok) {
        await updateDaemonStatus(params.db, { lastAlertAt: new Date() })
      }
    }
  }
  return sent
}

export function elapsedWindowHours(
  windowStart: Date | null | undefined,
  windowEnd: Date | null | undefined,
  now: Date,
): number | null {
  if (!windowStart || !windowEnd) return null
  const effectiveEnd = new Date(Math.min(windowEnd.getTime(), now.getTime()))
  const elapsedMs = effectiveEnd.getTime() - windowStart.getTime()
  return elapsedMs > 0 ? elapsedMs / 3_600_000 : null
}

function compatibleWindow(
  priorStart: Date | null,
  priorEnd: Date | null,
  currentStart?: Date | null,
  currentEnd?: Date | null,
): boolean {
  const priorWindowed = Boolean(priorStart && priorEnd)
  const currentWindowed = Boolean(currentStart && currentEnd)
  if (priorWindowed !== currentWindowed) return false
  if (!priorWindowed) return true
  const priorDuration = priorEnd!.getTime() - priorStart!.getTime()
  const currentDuration = currentEnd!.getTime() - currentStart!.getTime()
  return Math.abs(priorDuration - currentDuration) <= 60_000
}

function alertStateKey(state: {
  providerId: string
  accountTag?: string | null
  alertType: string
  thresholdValue: number
}): string {
  return `${state.providerId}|${state.accountTag ?? ""}|${state.alertType}|${state.thresholdValue}`
}

function mergeArmStates(current: AlertArmState[], updates: AlertArmState[]): AlertArmState[] {
  const byKey = new Map(current.map((state) => [alertStateKey(state), state]))
  for (const update of updates) {
    byKey.set(alertStateKey(update), update)
  }
  return [...byKey.values()]
}
