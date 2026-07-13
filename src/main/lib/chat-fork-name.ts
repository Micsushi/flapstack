export function getChatForkBaseName(name: string | null | undefined): string {
  return (name?.trim() || "Chat").replace(/ \((\d+)\)$/, "")
}

export function getNextChatForkName(
  sourceName: string | null | undefined,
  siblingNames: Array<string | null>,
): string {
  const baseName = getChatForkBaseName(sourceName)
  let maxCopyNumber = 1

  for (const siblingName of siblingNames) {
    if (!siblingName) continue
    if (siblingName === baseName) {
      maxCopyNumber = Math.max(maxCopyNumber, 1)
      continue
    }

    const match = siblingName.match(/^(.*) \((\d+)\)$/)
    if (match?.[1] === baseName) {
      maxCopyNumber = Math.max(maxCopyNumber, Number(match[2]))
    }
  }

  return `${baseName} (${maxCopyNumber + 1})`
}
