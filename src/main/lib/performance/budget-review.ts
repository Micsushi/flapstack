import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { STAGE6_PERFORMANCE_BUDGETS, STAGE6_PERFORMANCE_BUDGET_REVIEW } from "./budgets"
import { canonicalJson, sha256Bytes } from "./canonical"

type ReviewedBudgetArtifact = {
  schemaVersion?: unknown
  budgetVersion?: unknown
  reviewStatus?: unknown
  budgetDefinitionSha256?: unknown
}

export function verifyReviewedPerformanceBudgetAuthority(): void {
  const artifactPath = resolve(process.cwd(), STAGE6_PERFORMANCE_BUDGET_REVIEW.relativePath)
  const artifactBytes = readFileSync(artifactPath)
  if (sha256Bytes(artifactBytes) !== STAGE6_PERFORMANCE_BUDGET_REVIEW.sha256) {
    throw new Error("Reviewed performance budget evidence does not match its fixed SHA-256.")
  }
  const artifact = JSON.parse(artifactBytes.toString("utf8")) as ReviewedBudgetArtifact
  if (
    artifact.schemaVersion !== 1 ||
    artifact.budgetVersion !== STAGE6_PERFORMANCE_BUDGETS.version ||
    artifact.reviewStatus !== "accepted"
  ) {
    throw new Error("Reviewed performance budget evidence does not match s6-v7 authority.")
  }
  const definitionSha256 = sha256Bytes(
    canonicalJson({
      version: STAGE6_PERFORMANCE_BUDGETS.version,
      platforms: STAGE6_PERFORMANCE_BUDGETS.platforms,
      hardwareClasses: STAGE6_PERFORMANCE_BUDGETS.hardwareClasses,
      datasets: STAGE6_PERFORMANCE_BUDGETS.datasets,
      supportLimits: STAGE6_PERFORMANCE_BUDGETS.supportLimits,
      budgets: STAGE6_PERFORMANCE_BUDGETS.budgets,
    }),
  )
  if (artifact.budgetDefinitionSha256 !== definitionSha256) {
    throw new Error("Reviewed performance budget evidence does not match the current definition.")
  }
}
