export const PORTABILITY_RESULT_PAGE_SIZE = 50

export type PortabilityDecision = {
  id: string
  kind: "create" | "update" | "conflict" | "skip"
}

export function unresolvedPortabilityConflicts(
  decisions: readonly PortabilityDecision[],
  resolutions: Readonly<Record<string, string>>,
): PortabilityDecision[] {
  return decisions.filter((decision) => decision.kind === "conflict" && !resolutions[decision.id])
}

export function paginatePortabilityResults<T>(
  values: readonly T[],
  page: number,
  pageSize = PORTABILITY_RESULT_PAGE_SIZE,
): T[] {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize <= 0) return []
  return values.slice(page * pageSize, (page + 1) * pageSize)
}

export function clampPortabilityPage(
  page: number,
  resultCount: number,
  pageSize = PORTABILITY_RESULT_PAGE_SIZE,
): number {
  if (
    !Number.isInteger(page) ||
    !Number.isSafeInteger(resultCount) ||
    resultCount < 0 ||
    !Number.isInteger(pageSize) ||
    pageSize <= 0
  )
    return 0
  return Math.min(Math.max(0, page), Math.max(0, Math.ceil(resultCount / pageSize) - 1))
}

export function importApplyConfirmation(summary: {
  create: number
  update: number
  conflict: number
}): string {
  return `Apply reviewed import? ${summary.create} creates, ${summary.update} updates, ${summary.conflict} conflicts, no implicit deletes. A pre-import backup will be created.`
}

export function privateSyncConfirmation(
  action: "pull" | "commit" | "push",
  fingerprint: string,
): string {
  return `Run private sync ${action}? Exact preview fingerprint: ${fingerprint.slice(0, 12)}.`
}

export function parseTargetRootMappings(value: string): Record<string, string> {
  const mappings: Record<string, string> = {}
  for (const raw of value.split(/[,\n]/)) {
    const entry = raw.trim()
    if (!entry) continue
    const separator = entry.indexOf("=")
    if (separator <= 0 || separator === entry.length - 1)
      throw new Error("Target mappings use project-id=/absolute/path.")
    const id = entry.slice(0, separator).trim()
    const path = entry.slice(separator + 1).trim()
    if (!path.startsWith("/")) throw new Error(`Target path for ${id} must be absolute.`)
    if (mappings[id]) throw new Error(`Target mapping for ${id} is duplicated.`)
    mappings[id] = path
  }
  return mappings
}
