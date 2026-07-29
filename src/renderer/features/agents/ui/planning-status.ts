export const PLANNING_STATUS_INTERVAL_MS = 4_000

export const PLANNING_STATUS_MESSAGES = [
  "Analyzing context",
  "Tracing code",
  "Checking constraints",
  "Planning approach",
  "Reviewing structure",
  "Mapping dependencies",
  "Inspecting behavior",
  "Comparing patterns",
  "Testing assumptions",
  "Organizing changes",
  "Evaluating tradeoffs",
  "Following data flow",
  "Reviewing interfaces",
  "Checking edge cases",
  "Preparing next steps",
  "Synthesizing findings",
] as const

export function getPlanningStatus(now = Date.now(), reducedMotion = false): string {
  if (reducedMotion) return PLANNING_STATUS_MESSAGES[0]
  const index = Math.floor(now / PLANNING_STATUS_INTERVAL_MS) % PLANNING_STATUS_MESSAGES.length
  return PLANNING_STATUS_MESSAGES[index]
}
