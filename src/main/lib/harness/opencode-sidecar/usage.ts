import type { SidecarCostQuality, SidecarUsage } from "./contract"

const COST_QUALITY_RANK: Record<SidecarCostQuality, number> = {
  unknown: 0,
  estimated: 1,
  "provider-reported": 2,
}

/**
 * Combine per-message OpenCode usage into one run total. The aggregate keeps
 * the weakest quality in the set: a reported plus estimated total is still an
 * estimate, while any unknown component makes the combined cost unknown.
 */
export function mergeSidecarUsage(observations: SidecarUsage[]): SidecarUsage {
  const sum = (
    key: "inputTokens" | "outputTokens" | "reasoningTokens" | "totalTokens" | "costUsd",
  ) => {
    const values = observations.flatMap((usage) =>
      typeof usage[key] === "number" ? [usage[key] as number] : [],
    )
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined
  }
  const field = <Key extends Parameters<typeof sum>[0]>(key: Key) => {
    const value = sum(key)
    return value === undefined ? {} : { [key]: value }
  }
  const costQuality = observations.reduce<SidecarCostQuality>(
    (weakest, usage) =>
      COST_QUALITY_RANK[usage.costQuality] < COST_QUALITY_RANK[weakest]
        ? usage.costQuality
        : weakest,
    observations.length > 0 ? "provider-reported" : "unknown",
  )

  return {
    ...field("inputTokens"),
    ...field("outputTokens"),
    ...field("reasoningTokens"),
    ...field("totalTokens"),
    ...field("costUsd"),
    costQuality,
  }
}
