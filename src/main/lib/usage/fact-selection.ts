export type UsageOverlapFactAccessors<T> = {
  id(fact: T): unknown
  capturedAt(fact: T): number
  sourceClass(fact: T): unknown
  dedupeStrategy(fact: T): unknown
  dedupeGroupKey(fact: T): string | null
}

export function selectLatestUsageOverlapFacts<T>(
  facts: readonly T[],
  access: UsageOverlapFactAccessors<T>,
): T[] {
  const selected = new Map<string, T>()
  for (const fact of facts) {
    const id = String(access.id(fact))
    const groupKey = access.dedupeGroupKey(fact)
    const key =
      access.dedupeStrategy(fact) === "overlap-group" && groupKey
        ? `group:${String(access.sourceClass(fact))}:${groupKey}`
        : `fact:${id}`
    const current = selected.get(key)
    if (
      !current ||
      access.capturedAt(fact) > access.capturedAt(current) ||
      (access.capturedAt(fact) === access.capturedAt(current) &&
        compareStableIds(id, access.id(current)) > 0)
    ) {
      selected.set(key, fact)
    }
  }
  return [...selected.values()].sort((left, right) =>
    compareStableIds(access.id(left), access.id(right)),
  )
}

export function compareStableIds(left: unknown, right: unknown): number {
  const leftText = String(left)
  const rightText = String(right)
  if (/^\d+$/.test(leftText) && /^\d+$/.test(rightText)) {
    const leftNumber = BigInt(leftText)
    const rightNumber = BigInt(rightText)
    return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0
  }
  return leftText.localeCompare(rightText)
}
