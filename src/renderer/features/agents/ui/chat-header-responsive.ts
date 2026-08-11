export type ChatHeaderTagMode = "full" | "compact" | "minimal"

export function resolveChatHeaderTagMode({
  availableWidth,
  fullTagsWidth,
  compactTagsWidth,
  controlsWidth,
  controlCount,
  gap = 8,
  overflowWidth = 28,
}: {
  availableWidth: number
  fullTagsWidth: number
  compactTagsWidth: number
  controlsWidth: number
  controlCount: number
  gap?: number
  overflowWidth?: number
}): ChatHeaderTagMode {
  const fullGap = fullTagsWidth > 0 && controlsWidth > 0 ? gap : 0
  if (fullTagsWidth + fullGap + controlsWidth <= availableWidth) return "full"

  const compactOverflowWidth = controlCount > 0 ? overflowWidth : 0
  const compactGap = compactTagsWidth > 0 && compactOverflowWidth > 0 ? gap : 0
  if (compactTagsWidth + compactGap + compactOverflowWidth <= availableWidth) return "compact"

  return "minimal"
}

export function capProjectLabel(label: string): string {
  return label.length > 30 ? `${label.slice(0, 29)}\u2026` : label
}
