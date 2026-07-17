import type { SettingsTab } from "../../lib/atoms"
import type { BetaFeatureSettings } from "../../../shared/beta-features"
import {
  isVisibleSettingsControl,
  isVisibleSettingsTab,
  SETTINGS_CONTROL_REGISTRY,
  SETTINGS_TAB_REGISTRY,
  type SettingsProviderScope,
} from "./settings-visibility"

export type SettingsSearchEntry = {
  id: string
  tab: SettingsTab
  label: string
  description: string
  keywords: string[]
  targetId: string
  developmentOnly?: boolean
  providerScope?: readonly SettingsProviderScope[]
  requiresAvailableProvider?: boolean
}

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  ...SETTINGS_TAB_REGISTRY.filter((entry) => entry.section !== "hidden").map((entry) => ({
    id: `settings-page-${entry.id}`,
    tab: entry.id,
    label: entry.label,
    description: entry.description,
    keywords: entry.keywords,
    targetId: `settings-tab-${entry.id}`,
    developmentOnly: entry.section === "development" || undefined,
  })),
  ...SETTINGS_CONTROL_REGISTRY.map((entry) => ({ ...entry })),
]

export function searchSettings(
  query: string,
  options: {
    showDevelopment: boolean
    availableProviders?: readonly SettingsProviderScope[]
    betaFeatures?: BetaFeatureSettings
  },
): SettingsSearchEntry[] {
  const normalizedQuery = normalizeSettingsSearchText(query)
  if (!normalizedQuery) return []

  const queryTokens = normalizedQuery.split(" ").filter(Boolean)

  return SETTINGS_SEARCH_ENTRIES.filter((entry) => {
    if (!options.showDevelopment && entry.developmentOnly) return false
    if (
      !isVisibleSettingsTab(entry.tab, {
        showDevelopment: options.showDevelopment,
        betaFeatures: options.betaFeatures,
      })
    )
      return false
    if (!SETTINGS_CONTROL_REGISTRY.some((control) => control.id === entry.id)) return true
    return isVisibleSettingsControl(entry, options)
  })
    .map((entry, index) => ({
      entry,
      index,
      score: scoreEntry(entry, normalizedQuery, queryTokens),
    }))
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((result) => result.entry)
}

export function normalizeSettingsSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function scoreEntry(
  entry: SettingsSearchEntry,
  normalizedQuery: string,
  queryTokens: string[],
): number {
  const label = normalizeSettingsSearchText(entry.label)
  const description = normalizeSettingsSearchText(entry.description)
  const keywords = entry.keywords.map(normalizeSettingsSearchText)

  if (label === normalizedQuery || keywords.includes(normalizedQuery)) return 0

  let score = 0
  for (const token of queryTokens) {
    const tokenScore = bestTokenScore(token, label, description, keywords)
    if (!Number.isFinite(tokenScore)) return Number.POSITIVE_INFINITY
    score += tokenScore
  }
  return score
}

function bestTokenScore(
  token: string,
  label: string,
  description: string,
  keywords: string[],
): number {
  const labelWords = label.split(" ")
  if (label.startsWith(token)) return 1
  if (labelWords.some((word) => word.startsWith(token))) return 2
  if (keywords.some((keyword) => keyword === token || keyword.startsWith(token))) return 3
  if (keywords.some((keyword) => keyword.split(" ").some((word) => word.startsWith(token))))
    return 4
  if (label.includes(token)) return 5
  if (keywords.some((keyword) => keyword.includes(token))) return 6
  if (description.includes(token)) return 7
  return Number.POSITIVE_INFINITY
}
