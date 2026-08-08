import { isReservedArchivedAccentColor } from "../agents/lib/open-chat-tabs"

export const PROJECT_COLOR_PRESETS = [
  "#38bdf8",
  "#22c55e",
  "#f59e0b",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#84cc16",
  "#eab308",
  "#06b6d4",
  "#64748b",
]

export const DEFAULT_PROJECT_COLOR = PROJECT_COLOR_PRESETS[0]

function parseHexColor(color?: string | null): string | null {
  const trimmed = color?.trim().toLowerCase()
  if (!trimmed) return null
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((character) => `${character}${character}`)
      .join("")}`
  }
  return null
}

export function normalizeHexColor(color?: string | null): string {
  return parseHexColor(color) ?? DEFAULT_PROJECT_COLOR
}

function colorChannels(color: string): [number, number, number] {
  const value = Number.parseInt(normalizeHexColor(color).slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function colorDistance(left: string, right: string): number {
  const a = colorChannels(left)
  const b = colorChannels(right)
  return a.reduce((total, value, index) => total + (value - b[index]) ** 2, 0)
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const huePrime = hue / 60
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1))
  const match = lightness - chroma / 2
  let red = 0
  let green = 0
  let blue = 0

  if (huePrime < 1) [red, green] = [chroma, x]
  else if (huePrime < 2) [red, green] = [x, chroma]
  else if (huePrime < 3) [green, blue] = [chroma, x]
  else if (huePrime < 4) [green, blue] = [x, chroma]
  else if (huePrime < 5) [red, blue] = [x, chroma]
  else [red, blue] = [chroma, x]

  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

function farthestColor(candidates: string[], usedColors: Set<string>): string {
  if (usedColors.size === 0) return candidates[0]
  return candidates.reduce((best, candidate) => {
    const score = Math.min(...[...usedColors].map((used) => colorDistance(candidate, used)))
    const bestScore = Math.min(...[...usedColors].map((used) => colorDistance(best, used)))
    return score > bestScore ? candidate : best
  })
}

function nextProjectColor(usedColors: Set<string>): string {
  const unusedPresets = PROJECT_COLOR_PRESETS.filter((color) => !usedColors.has(color))
  if (unusedPresets.length > 0) return farthestColor(unusedPresets, usedColors)

  const generated = Array.from({ length: 72 }, (_, index) =>
    hslToHex((index * 137.508) % 360, 0.72, 0.55),
  ).filter((color) => !usedColors.has(color))
  return generated.length > 0 ? farthestColor(generated, usedColors) : DEFAULT_PROJECT_COLOR
}

export function assignStableProjectColors(
  projects: ReadonlyArray<{ id: string }>,
  current: Record<string, string>,
): Record<string, string> {
  const next = { ...current }
  const usedColors = new Set<string>()
  let changed = false

  for (const project of projects) {
    const existing = parseHexColor(current[project.id])
    if (existing && !isReservedArchivedAccentColor(existing)) {
      usedColors.add(existing)
      if (next[project.id] !== existing) {
        next[project.id] = existing
        changed = true
      }
    }
  }

  for (const project of projects) {
    const existing = parseHexColor(current[project.id])
    if (existing && !isReservedArchivedAccentColor(existing)) continue
    const color = nextProjectColor(usedColors)
    usedColors.add(color)
    if (next[project.id] !== color) {
      next[project.id] = color
      changed = true
    }
  }

  return changed ? next : current
}
