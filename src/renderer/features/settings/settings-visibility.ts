import type { SettingsTab } from "../../lib/atoms"

export type SettingsTabMetadata = {
  id: SettingsTab
  label: string
  description: string
  keywords: string[]
  section: "main" | "advanced" | "development" | "hidden"
  released: boolean
}

export const SETTINGS_TAB_REGISTRY: readonly SettingsTabMetadata[] = [
  {
    id: "preferences",
    label: "Preferences",
    description: "General agent, notification, navigation, and privacy settings",
    keywords: ["behavior", "notifications", "editor", "analytics"],
    section: "main",
    released: true,
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "Manage permission prompts, defaults, providers, and chats",
    keywords: ["access", "approval", "security", "read only", "full access"],
    section: "main",
    released: true,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, workspace icons, and visual behavior",
    keywords: ["theme", "light", "dark", "color"],
    section: "main",
    released: true,
  },
  {
    id: "projects",
    label: "Projects",
    description: "Project paths, worktrees, setup commands, and removal",
    keywords: ["repository", "repo", "worktree"],
    section: "advanced",
    released: true,
  },
  {
    id: "models",
    label: "Models",
    description: "Provider model availability and accounts",
    keywords: ["anthropic", "claude", "codex", "cursor", "account", "reasoning"],
    section: "advanced",
    released: true,
  },
  {
    id: "api-providers",
    label: "API Providers",
    description: "Configure direct model API providers",
    keywords: ["openrouter", "nanogpt", "provider", "api key", "credentials"],
    section: "advanced",
    released: true,
  },
  {
    id: "voice",
    label: "Voice",
    description: "Dictation, transcription, text-to-speech, and voices",
    keywords: ["microphone", "speech", "tts", "stt"],
    section: "advanced",
    released: true,
  },
  {
    id: "keyboard",
    label: "Keyboard",
    description: "View and customize working application shortcuts",
    keywords: ["shortcut", "hotkey", "keys", "binding"],
    section: "advanced",
    released: true,
  },
  {
    id: "skills",
    label: "Skills",
    description: "Discover and manage installed agent skills",
    keywords: ["skill", "commands", "slash command"],
    section: "advanced",
    released: true,
  },
  {
    id: "mcp",
    label: "MCP Servers",
    description: "Configure Model Context Protocol servers and tools",
    keywords: ["model context protocol", "server", "tool"],
    section: "advanced",
    released: true,
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Manage plugin-provided commands and skills",
    keywords: ["extension", "marketplace", "install"],
    section: "advanced",
    released: true,
  },
  {
    id: "usage",
    label: "Usage",
    description: "Provider usage, limits, alerts, and history",
    keywords: ["tokens", "credits", "cost", "limits"],
    section: "advanced",
    released: true,
  },
  {
    id: "debug",
    label: "Debug",
    description: "Developer diagnostics and internal controls",
    keywords: ["logs", "diagnostics", "developer tools"],
    section: "development",
    released: true,
  },
  {
    id: "profile",
    label: "Profile",
    description: "Legacy profile settings",
    keywords: [],
    section: "hidden",
    released: false,
  },
  {
    id: "agents",
    label: "Custom Agents",
    description: "Unreleased custom agent settings",
    keywords: [],
    section: "hidden",
    released: false,
  },
  {
    id: "worktrees",
    label: "Worktrees",
    description: "Legacy worktree settings route",
    keywords: [],
    section: "hidden",
    released: false,
  },
  {
    id: "beta",
    label: "Legacy Beta",
    description: "Retired beta settings",
    keywords: [],
    section: "hidden",
    released: false,
  },
  {
    id: "future",
    label: "Future",
    description: "Unreleased future settings",
    keywords: [],
    section: "hidden",
    released: false,
  },
] as const

export const HIDDEN_SETTINGS_TABS = SETTINGS_TAB_REGISTRY.filter((entry) => !entry.released).map(
  (entry) => entry.id,
)

export function getVisibleSettingsTabs(
  section: "main" | "advanced",
  options: { showDevelopment?: boolean } = {},
): SettingsTabMetadata[] {
  const tabs = SETTINGS_TAB_REGISTRY.filter((entry) => entry.released && entry.section === section)
  if (section === "main" && options.showDevelopment) {
    const debug = SETTINGS_TAB_REGISTRY.find((entry) => entry.id === "debug")
    return debug ? [...tabs, debug] : tabs
  }
  return tabs
}

export function isVisibleSettingsTab(
  tab: SettingsTab,
  options: { showDevelopment?: boolean } = {},
): boolean {
  const entry = SETTINGS_TAB_REGISTRY.find((candidate) => candidate.id === tab)
  if (!entry?.released) return false
  if (entry.section === "development") return options.showDevelopment === true
  return entry.section !== "hidden"
}

export function normalizeVisibleSettingsTab(
  tab: SettingsTab,
  options: { showDevelopment?: boolean } = {},
): SettingsTab {
  return isVisibleSettingsTab(tab, options) ? tab : "preferences"
}
