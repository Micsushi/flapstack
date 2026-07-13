import type { SettingsTab } from "../../lib/atoms"
import { isVisibleSettingsTab, SETTINGS_TAB_REGISTRY } from "./settings-visibility"

export type SettingsSearchEntry = {
  id: string
  tab: SettingsTab
  label: string
  description: string
  keywords: string[]
  targetId: string
  developmentOnly?: boolean
}

const legacyEntries: SettingsSearchEntry[] = [
  page(
    "preferences",
    "Preferences",
    "General agent, notification, navigation, and privacy settings",
    ["behavior", "notifications", "editor", "analytics"],
  ),
  control(
    "preferences-reasoning",
    "preferences",
    "Reasoning output",
    "Show deeper model reasoning",
    ["thinking", "streaming", "credits"],
  ),
  control(
    "preferences-default-mode",
    "preferences",
    "Default mode",
    "Plan or Agent for new agents",
    ["plan", "agent", "read only"],
  ),
  control(
    "preferences-coauthor",
    "preferences",
    "Include Co-Authored-By",
    "Git commit attribution",
    ["git", "commit", "claude", "author"],
  ),
  control(
    "preferences-desktop-notifications",
    "preferences",
    "Desktop notifications",
    "Notify when an agent needs input or completes",
    ["alerts", "system notification"],
  ),
  control(
    "preferences-sound-notifications",
    "preferences",
    "Sound notifications",
    "Play completion sounds",
    ["audio", "alerts"],
  ),
  control(
    "preferences-focused-notifications",
    "preferences",
    "Notify when focused",
    "Show notifications while Flapstack is active",
    ["alerts", "foreground"],
  ),
  control(
    "preferences-drag-chats",
    "preferences",
    "Drag chats between sections",
    "Allow moving chats between Global, project, and task sections",
    ["sidebar", "move chats", "drag and drop", "global", "project", "task"],
  ),
  control(
    "preferences-auto-advance",
    "preferences",
    "Auto-advance",
    "Choose where to go after archiving",
    ["archive", "next chat"],
  ),
  control(
    "preferences-editor",
    "preferences",
    "Preferred editor",
    "Default app for opening project folders",
    ["vscode", "cursor", "terminal", "ide"],
  ),
  control(
    "preferences-analytics",
    "preferences",
    "Share usage analytics",
    "Anonymous product usage and performance data",
    ["privacy", "telemetry", "tracking"],
  ),

  page("permissions", "Permissions", "Manage permission prompts, defaults, providers, and chats", [
    "access",
    "approval",
    "security",
    "read only",
    "full access",
    "all chats",
  ]),
  control(
    "permissions-change-behavior",
    "permissions",
    "Permission change behavior",
    "Ask every time or remember all chats or this chat",
    [
      "remember my choice",
      "undo remember",
      "ask every time",
      "always all chats",
      "always this chat",
      "approval",
    ],
  ),
  control(
    "permissions-default",
    "permissions",
    "Default permission",
    "Choose the Global and fallback permission for new chats",
    ["default", "new chats", "global", "fallback", "access", "read only"],
  ),
  control(
    "permissions-chat-list",
    "permissions",
    "Chat permissions",
    "Inspect and edit active or archived chat permissions",
    ["different chats", "per chat", "archived", "all chats", "manage"],
  ),

  page("appearance", "Appearance", "Theme, workspace icons, and visual behavior", [
    "theme",
    "light",
    "dark",
    "colour",
    "color",
    "icon",
  ]),
  page("projects", "Projects", "Project paths, worktrees, setup commands, and removal", [
    "repository",
    "repo",
    "worktree",
    "setup command",
    "danger zone",
  ]),
  page("models", "Models", "Claude, Anthropic, Codex, and Cursor model availability", [
    "anthropic",
    "claude",
    "codex",
    "cursor",
    "account",
    "reasoning",
  ]),
  page("api-providers", "API Providers", "Configure direct model API providers and keys", [
    "openrouter",
    "nanogpt",
    "api key",
    "credentials",
    "provider",
  ]),
  page("voice", "Voice", "Dictation, transcription, text-to-speech, and voices", [
    "microphone",
    "speech",
    "tts",
    "stt",
    "read aloud",
    "openai api key",
    "whisper key",
  ]),
  page("skills", "Skills", "Discover provider-scoped skills and commands", [
    "skill",
    "commands",
    "slash command",
    "claude",
    "codex",
    "cursor",
    "opencode",
  ]),
  page("agents", "Custom Agents", "Inspect provider-scoped custom agents and runtime support", [
    "subagent",
    "extension",
    "claude",
    "opencode",
  ]),
  page("mcp", "MCP Servers", "Configure Model Context Protocol servers and tools", [
    "model context protocol",
    "server",
    "tool",
    "approval",
  ]),
  page("plugins", "Plugins", "Inspect provider-scoped plugins and honest read-only limits", [
    "extension",
    "marketplace",
    "install",
  ]),
  page("usage", "Usage", "Provider usage, limits, alerts, and history", [
    "tokens",
    "credits",
    "cost",
    "limits",
    "billing",
  ]),
  {
    ...page("debug", "Debug", "Developer diagnostics and internal controls", [
      "logs",
      "diagnostics",
      "developer tools",
    ]),
    developmentOnly: true,
  },
]

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  ...SETTINGS_TAB_REGISTRY.filter((entry) => entry.section !== "hidden").map((entry) => {
    const legacyPage = legacyEntries.find(
      (candidate) => candidate.id === `settings-page-${entry.id}`,
    )
    return {
      id: `settings-page-${entry.id}`,
      tab: entry.id,
      label: entry.label,
      description: legacyPage?.description ?? entry.description,
      keywords: [...new Set([...entry.keywords, ...(legacyPage?.keywords ?? [])])],
      targetId: `settings-tab-${entry.id}`,
      developmentOnly: entry.section === "development" || undefined,
    }
  }),
  ...legacyEntries.filter((entry) => !entry.id.startsWith("settings-page-")),
]

export function searchSettings(
  query: string,
  options: { showDevelopment: boolean },
): SettingsSearchEntry[] {
  const normalizedQuery = normalizeSettingsSearchText(query)
  if (!normalizedQuery) return []

  const queryTokens = normalizedQuery.split(" ").filter(Boolean)

  return SETTINGS_SEARCH_ENTRIES.filter(
    (entry) =>
      (options.showDevelopment || !entry.developmentOnly) &&
      isVisibleSettingsTab(entry.tab, { showDevelopment: options.showDevelopment }),
  )
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

function page(
  tab: SettingsTab,
  label: string,
  description: string,
  keywords: string[],
): SettingsSearchEntry {
  return {
    id: `settings-page-${tab}`,
    tab,
    label,
    description,
    keywords,
    targetId: `settings-tab-${tab}`,
  }
}

function control(
  id: string,
  tab: SettingsTab,
  label: string,
  description: string,
  keywords: string[],
): SettingsSearchEntry {
  return { id, tab, label, description, keywords, targetId: id }
}
