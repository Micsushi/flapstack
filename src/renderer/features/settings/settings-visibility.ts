import type { SettingsTab } from "../../lib/atoms"

export const HIDDEN_SETTINGS_TABS = [
  "keyboard",
  "beta",
  "agents",
  "future",
] as const satisfies readonly SettingsTab[]

const hiddenSettingsTabs = new Set<SettingsTab>(HIDDEN_SETTINGS_TABS)

export function isVisibleSettingsTab(
  tab: SettingsTab,
  options: { showDevelopment?: boolean } = {},
): boolean {
  if (tab === "debug") return options.showDevelopment === true
  return !hiddenSettingsTabs.has(tab)
}

export function normalizeVisibleSettingsTab(
  tab: SettingsTab,
  options: { showDevelopment?: boolean } = {},
): SettingsTab {
  return isVisibleSettingsTab(tab, options) ? tab : "preferences"
}
