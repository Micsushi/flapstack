export type ChatHeaderTagMode = "full" | "compact"

export type ChatHeaderTagLayout = {
  mode: ChatHeaderTagMode
  visibleAuxiliaryTagCount: number
}

export function resolveChatHeaderTagLayout({
  availableWidth,
  fullTagsWidth,
  compactTagWidths,
  projectTagWidth,
  controlCount,
  gap = 8,
  overflowWidth = 28,
}: {
  availableWidth: number
  fullTagsWidth: number
  compactTagWidths: number[]
  projectTagWidth: number
  controlCount: number
  gap?: number
  overflowWidth?: number
}): ChatHeaderTagLayout {
  const overflowReservedWidth = controlCount > 0 ? overflowWidth : 0
  const widthWithOverflow = (tagsWidth: number) =>
    tagsWidth + (tagsWidth > 0 && overflowReservedWidth > 0 ? gap : 0) + overflowReservedWidth

  if (widthWithOverflow(fullTagsWidth) <= availableWidth) {
    return { mode: "full", visibleAuxiliaryTagCount: compactTagWidths.length }
  }

  for (let visibleCount = compactTagWidths.length; visibleCount >= 0; visibleCount -= 1) {
    const visibleWidths = compactTagWidths.slice(0, visibleCount)
    const tagCount = (projectTagWidth > 0 ? 1 : 0) + visibleWidths.length
    const compactTagsWidth =
      projectTagWidth +
      visibleWidths.reduce((total, width) => total + width, 0) +
      Math.max(0, tagCount - 1) * gap

    if (widthWithOverflow(compactTagsWidth) <= availableWidth) {
      return { mode: "compact", visibleAuxiliaryTagCount: visibleCount }
    }
  }

  return { mode: "compact", visibleAuxiliaryTagCount: 0 }
}

export function capProjectLabel(label: string): string {
  return label.length > 30 ? `${label.slice(0, 29)}\u2026` : label
}
