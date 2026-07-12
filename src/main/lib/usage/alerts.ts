// Stage 2 Track B - U10: threshold alert evaluation + debounce/re-arm.
//
// The evaluator is pure (sample + thresholds + arm-state -> alert intents) so it
// is unit-testable. An alert fires once when a threshold is crossed and re-arms
// only after usage resets below the threshold band. The daemon runs the runner
// (evaluate -> send Discord -> persist event); the app may show a desktop
// notification while open but the daemon is the source of truth for background
// alerts.

import { microsToUsd } from "./source-tags"
import type { UsageAlertThresholds } from "./settings"
import type { CostQuality, ProviderBillingKind, UsageProviderId } from "./types"

export type AlertType =
  | "quota-percent"
  | "quota-reset"
  | "throttle-risk"
  | "api-dollar-budget"
  | "api-spend-rate"
  | "api-spend-spike"
  | "estimated-spend"

export interface AlertArmState {
  providerId: UsageProviderId
  accountTag?: string | null
  alertType: AlertType
  thresholdValue: number
  armed: boolean
}

/** Minimal projection of a sample the evaluator needs. */
export interface AlertInputSample {
  providerId: UsageProviderId
  accountTag?: string | null
  billingKind: ProviderBillingKind
  costQuality: CostQuality
  percentUsed?: number | null
  /** Spend in USD for the current window (micros converted by caller). */
  spendUsd?: number | null
  /** Spend normalized by the sample window duration. */
  spendRateUsdPerHour?: number | null
  /** Current spend divided by the trailing historical average. */
  spikeMultiplierObserved?: number | null
}

export interface AlertIntent {
  providerId: UsageProviderId
  accountTag?: string | null
  alertType: AlertType
  thresholdValue: number
  observedValue: number
  costQuality: CostQuality
  message: string
}

function isArmed(
  arm: AlertArmState[],
  providerId: UsageProviderId,
  accountTag: string | null | undefined,
  alertType: AlertType,
  thresholdValue: number,
): boolean {
  const found = arm.find(
    (a) =>
      a.providerId === providerId &&
      (a.accountTag ?? null) === (accountTag ?? null) &&
      a.alertType === alertType &&
      a.thresholdValue === thresholdValue,
  )
  // Default armed=true when no state exists yet.
  return found ? found.armed : true
}

/**
 * Evaluate a single sample against configured thresholds. Returns the alert
 * intents that should fire now (respecting arm state) plus the arm-state updates
 * to persist (fire => disarm; reset below band => re-arm).
 */
export function evaluateSample(
  sample: AlertInputSample,
  thresholds: UsageAlertThresholds,
  arm: AlertArmState[],
): { intents: AlertIntent[]; armUpdates: AlertArmState[] } {
  const intents: AlertIntent[] = []
  const armUpdates: AlertArmState[] = []

  // --- Subscription/quota: percent-used thresholds ---
  if (sample.billingKind === "subscription-quota" && sample.percentUsed != null) {
    const pct = sample.percentUsed
    for (const threshold of thresholds.quotaPercent) {
      const armed = isArmed(arm, sample.providerId, sample.accountTag, "quota-percent", threshold)
      if (pct >= threshold && armed) {
        intents.push({
          providerId: sample.providerId,
          accountTag: sample.accountTag,
          alertType: "quota-percent",
          thresholdValue: threshold,
          observedValue: pct,
          costQuality: sample.costQuality,
          message: `${sample.providerId} usage at ${pct}% (>= ${threshold}%).`,
        })
        armUpdates.push({
          providerId: sample.providerId,
          accountTag: sample.accountTag,
          alertType: "quota-percent",
          thresholdValue: threshold,
          armed: false,
        })
      } else if (pct < threshold - 5 && !armed) {
        // Re-arm once usage falls a band below the threshold.
        armUpdates.push({
          providerId: sample.providerId,
          accountTag: sample.accountTag,
          alertType: "quota-percent",
          thresholdValue: threshold,
          armed: true,
        })
      }
    }
  }

  // --- API spend: dollar budget thresholds ---
  if (sample.billingKind === "api-spend" && sample.spendUsd != null) {
    const spend = sample.spendUsd
    const estimated = sample.costQuality === "estimated"
    const alertType: AlertType = estimated ? "estimated-spend" : "api-dollar-budget"
    for (const threshold of thresholds.spendUsd) {
      const armed = isArmed(arm, sample.providerId, sample.accountTag, alertType, threshold)
      if (spend >= threshold && armed) {
        intents.push({
          providerId: sample.providerId,
          accountTag: sample.accountTag,
          alertType,
          thresholdValue: threshold,
          observedValue: spend,
          costQuality: sample.costQuality,
          message: `${sample.providerId} ${estimated ? "estimated " : ""}spend $${spend.toFixed(2)} (>= $${threshold}).`,
        })
        armUpdates.push({
          providerId: sample.providerId,
          accountTag: sample.accountTag,
          alertType,
          thresholdValue: threshold,
          armed: false,
        })
      } else if (spend < threshold * 0.9 && !armed) {
        armUpdates.push({
          providerId: sample.providerId,
          accountTag: sample.accountTag,
          alertType,
          thresholdValue: threshold,
          armed: true,
        })
      }
    }
  }

  if (
    sample.billingKind === "api-spend" &&
    sample.spendRateUsdPerHour != null &&
    thresholds.spendRateUsdPerHour != null
  ) {
    evaluateSingleThreshold({
      sample,
      arm,
      intents,
      armUpdates,
      alertType: "api-spend-rate",
      threshold: thresholds.spendRateUsdPerHour,
      observed: sample.spendRateUsdPerHour,
      message: `${sample.providerId} spend rate $${sample.spendRateUsdPerHour.toFixed(2)}/hour (>= $${thresholds.spendRateUsdPerHour}/hour).`,
    })
  }

  if (
    sample.billingKind === "api-spend" &&
    sample.spikeMultiplierObserved != null &&
    thresholds.spikeMultiplier != null
  ) {
    evaluateSingleThreshold({
      sample,
      arm,
      intents,
      armUpdates,
      alertType: "api-spend-spike",
      threshold: thresholds.spikeMultiplier,
      observed: sample.spikeMultiplierObserved,
      message: `${sample.providerId} spend spike ${sample.spikeMultiplierObserved.toFixed(1)}x trailing average (>= ${thresholds.spikeMultiplier}x).`,
    })
  }

  return { intents, armUpdates }
}

function evaluateSingleThreshold(params: {
  sample: AlertInputSample
  arm: AlertArmState[]
  intents: AlertIntent[]
  armUpdates: AlertArmState[]
  alertType: Extract<AlertType, "api-spend-rate" | "api-spend-spike">
  threshold: number
  observed: number
  message: string
}): void {
  const armed = isArmed(
    params.arm,
    params.sample.providerId,
    params.sample.accountTag,
    params.alertType,
    params.threshold,
  )
  if (params.observed >= params.threshold && armed) {
    params.intents.push({
      providerId: params.sample.providerId,
      accountTag: params.sample.accountTag,
      alertType: params.alertType,
      thresholdValue: params.threshold,
      observedValue: params.observed,
      costQuality: params.sample.costQuality,
      message: params.message,
    })
    params.armUpdates.push({
      providerId: params.sample.providerId,
      accountTag: params.sample.accountTag,
      alertType: params.alertType,
      thresholdValue: params.threshold,
      armed: false,
    })
  } else if (params.observed < params.threshold * 0.9 && !armed) {
    params.armUpdates.push({
      providerId: params.sample.providerId,
      accountTag: params.sample.accountTag,
      alertType: params.alertType,
      thresholdValue: params.threshold,
      armed: true,
    })
  }
}

/** Convert a stored micro-dollar spend to USD for the evaluator. */
export function spendUsdFromMicros(micros: number | null | undefined): number | null {
  return microsToUsd(micros)
}
