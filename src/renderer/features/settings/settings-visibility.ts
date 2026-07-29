import type { SettingsTab } from "../../lib/atoms"
import {
  DEFAULT_BETA_FEATURE_SETTINGS,
  type BetaFeatureId,
  type BetaFeatureSettings,
} from "../../../shared/beta-features"

export type SettingsTabMetadata = {
  id: SettingsTab
  label: string
  description: string
  keywords: string[]
  section: "main" | "advanced" | "development" | "hidden"
  released: boolean
  betaFeature?: BetaFeatureId
}

export type SettingsProviderScope =
  "claude" | "codex" | "cursor" | "opencode" | "openrouter" | "nanogpt" | "openai-voice"

export type SettingsControlMetadata = {
  id: string
  tab: SettingsTab
  label: string
  description: string
  keywords: string[]
  targetId: string
  providerScope?: readonly SettingsProviderScope[]
  requiresAvailableProvider?: boolean
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
    id: "runtimes",
    label: "Runtimes",
    description: "Select Runtime defaults per harness and project",
    keywords: ["agent runtime", "codex", "claude code", "native", "automatic"],
    section: "advanced",
    released: true,
  },
  {
    id: "local-models",
    label: "Local Models",
    description: "Connect Ollama and inspect local model capabilities and permissions",
    keywords: ["ollama", "offline", "loopback", "local ai", "no cloud"],
    section: "advanced",
    released: true,
  },
  {
    id: "coordination",
    label: "Coordination",
    description: "Choose multi-agent workflow and Codex coordination engines",
    keywords: ["orchestration", "workflow", "codex v2", "codex v1", "multi agent"],
    section: "advanced",
    released: true,
    betaFeature: "orchestration",
  },
  {
    id: "agent-profiles",
    label: "Agent Profiles",
    description: "Create named agents with separate capabilities and personalities",
    keywords: ["profile studio", "personality", "named agent", "starter", "workflow"],
    section: "advanced",
    released: true,
  },
  {
    id: "api-providers",
    label: "API Providers",
    description: "Configure direct model API providers",
    keywords: ["provider", "api key", "credentials"],
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
    id: "agents",
    label: "Custom Agents",
    description: "Configure custom agents and provider extensions",
    keywords: ["custom agent", "subagent", "provider extension", "catalog"],
    section: "advanced",
    released: true,
  },
  {
    id: "mcp",
    label: "MCP Servers",
    description: "Configure third-party MCP servers for Claude Code and Codex",
    keywords: ["model context protocol", "server", "tool", "third party"],
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
    id: "portability",
    label: "Portability & Sync",
    description: "Export, dry-run import, restore backups, and private git sync",
    keywords: ["backup", "restore", "import", "export", "sync", "git", "migration"],
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
    id: "worktrees",
    label: "Worktrees",
    description: "Legacy worktree settings route",
    keywords: [],
    section: "hidden",
    released: false,
  },
  {
    id: "beta",
    label: "Beta Features",
    description: "Opt in to untested advanced feature groups",
    keywords: ["experimental", "feature flags", "early access", "preview"],
    section: "advanced",
    released: true,
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

export const SETTINGS_CONTROL_REGISTRY: readonly SettingsControlMetadata[] = [
  control(
    "agent-profile-studio",
    "agent-profiles",
    "Profile Studio",
    "Create, version, duplicate, archive, preview, import, export, and test named agents",
    ["capability", "personality", "inheritance", "runtime", "permission", "evaluation"],
  ),
  control(
    "runtime-settings-table",
    "runtimes",
    "Runtime defaults",
    "Choose Automatic or an explicit compatible Runtime per harness and project",
    ["agent runtime", "inherit", "override", "reset", "compatibility"],
  ),
  control(
    "runtime-diagnostics",
    "runtimes",
    "Runtime diagnostics",
    "Inspect native adapter availability and exact blocked reasons",
    ["adapter", "protocol", "version", "unavailable", "troubleshoot"],
  ),
  control(
    "coordination-engine-default",
    "coordination",
    "Coordination engine default",
    "Set Workflow, Codex task tree V2, or advanced Codex V1 precedence",
    ["orchestration", "multi agent", "fallback", "project override", "launch override"],
  ),
  control(
    "coordination-engine-availability",
    "coordination",
    "Coordination engine availability",
    "Inspect capability probes and exact unsupported reasons",
    ["capability", "unsupported", "codex task tree", "legacy"],
  ),
  control(
    "portability-export-import",
    "portability",
    "Import and export",
    "Select portable scopes and review a dry-run before import",
    ["backup", "restore", "bundle", "conflict", "migration"],
  ),
  control(
    "portability-private-sync",
    "portability",
    "Private git sync",
    "Link a user-owned repository and preview every pull, commit, and push",
    ["git", "remote", "branch", "secret scan"],
  ),
  control(
    "local-model-endpoint",
    "local-models",
    "Ollama endpoint",
    "Configure a loopback-only Ollama origin",
    ["localhost", "127.0.0.1", "port", "connect"],
  ),
  control(
    "local-model-catalog",
    "local-models",
    "Local model catalog",
    "Refresh Ollama availability and installed models",
    ["refresh", "available", "empty", "stale", "error"],
  ),
  control(
    "local-model-picker",
    "local-models",
    "Local model picker",
    "Inspect declared chat, streaming, tool, and vision capabilities",
    ["capability", "limitation", "chat only", "vision", "tools"],
  ),
  control(
    "local-model-permission-preview",
    "local-models",
    "Local permission and tool preview",
    "Preview permission-gated local chat and tool tiers before launch",
    ["read only", "write", "shell", "git", "network", "approval"],
  ),
  control(
    "local-model-no-cloud-fallback",
    "local-models",
    "No cloud fallback",
    "Stop local launches instead of sending prompts to a cloud provider",
    ["offline", "privacy", "credential", "fallback disabled"],
  ),
  control(
    "preferences-reasoning",
    "preferences",
    "Reasoning output",
    "Show provider-visible model reasoning",
    ["thinking", "streaming", "credits"],
  ),
  control(
    "preferences-default-mode",
    "preferences",
    "Default chat mode",
    "Write, Plan, Read, or Review for new chats",
    ["write", "plan", "read", "review", "read only"],
  ),
  control(
    "preferences-coauthor",
    "preferences",
    "Claude commit attribution",
    "Add a Claude Co-authored-by trailer to commits made by Claude Code",
    ["git", "commit", "claude", "author"],
    ["claude"],
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
    "preferences-product-tour",
    "preferences",
    "Main-page tutorial",
    "Review the main Flapstack controls",
    ["guide", "help", "onboarding", "tour", "run tutorial"],
  ),
  control(
    "preferences-runtime-activity-fixtures",
    "preferences",
    "Runtime activity test controls",
    "Show controls that create provider-free test runs in project chats",
    ["developer", "testing", "fixtures", "terminal runs", "runtime activity"],
  ),
  control(
    "preferences-analytics",
    "preferences",
    "Share usage analytics",
    "Anonymous product usage and performance data",
    ["privacy", "telemetry", "tracking"],
  ),
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
  control(
    "credential-codex-api-key",
    "api-providers",
    "Codex API key",
    "Manage the write-only Codex API credential and authentication priority",
    ["openai", "codex", "credential", "chatgpt subscription", "remove", "replace"],
    ["codex"],
  ),
  control(
    "credential-openai-voice-api-key",
    "api-providers",
    "OpenAI transcription API key",
    "Manage the write-only OpenAI Whisper credential",
    ["voice", "whisper", "speech", "stt", "openai api key", "remove", "replace"],
    ["openai-voice"],
  ),
  control(
    "credential-claude-custom-api-token",
    "api-providers",
    "Claude API key or custom endpoint token",
    "Manage the write-only Anthropic or custom Claude credential",
    ["anthropic", "claude", "custom model", "base url", "remove", "replace"],
    ["claude"],
  ),
  control(
    "openrouter-provider-card",
    "api-providers",
    "OpenRouter API key",
    "Manage the write-only OpenRouter provider credential",
    ["openrouter", "credential", "remove", "replace"],
    ["openrouter"],
    true,
  ),
  control(
    "nanogpt-provider-card",
    "api-providers",
    "NanoGPT API key",
    "Manage the write-only NanoGPT provider credential",
    ["nanogpt", "credential", "remove", "replace"],
    ["nanogpt"],
    true,
  ),
  control(
    "skills-provider-extensions",
    "skills",
    "Provider skills and commands",
    "Discover provider-scoped skills and commands with honest runtime limits",
    ["claude skills", "codex skills", "cursor commands", "opencode skills", "slash command"],
    ["claude", "codex", "cursor", "opencode"],
    false,
    "provider-extensions",
  ),
  control(
    "agents-provider-extensions",
    "agents",
    "Provider custom agents",
    "Inspect Claude and read-only OpenCode custom agents",
    ["custom agents", "subagent", "claude agents", "opencode agents"],
    ["claude", "opencode"],
    false,
    "provider-extensions",
  ),
  control(
    "plugins-provider-extensions",
    "plugins",
    "Provider plugins",
    "Inspect read-only Claude and OpenCode plugin inventories",
    ["claude plugins", "opencode plugins", "extension", "marketplace"],
    ["claude", "opencode"],
    false,
    "provider-extensions",
  ),
] as const

export const HIDDEN_SETTINGS_TABS = SETTINGS_TAB_REGISTRY.filter((entry) => !entry.released).map(
  (entry) => entry.id,
)

export function getVisibleSettingsTabs(
  section: "main" | "advanced",
  options: { showDevelopment?: boolean; betaFeatures?: BetaFeatureSettings } = {},
): SettingsTabMetadata[] {
  const betaFeatures = options.betaFeatures ?? DEFAULT_BETA_FEATURE_SETTINGS
  const tabs = SETTINGS_TAB_REGISTRY.filter(
    (entry) =>
      entry.released &&
      entry.section === section &&
      (!entry.betaFeature || betaFeatures[entry.betaFeature]),
  )
  if (section === "main" && options.showDevelopment) {
    const debug = SETTINGS_TAB_REGISTRY.find((entry) => entry.id === "debug")
    return debug ? [...tabs, debug] : tabs
  }
  return tabs
}

export function isVisibleSettingsTab(
  tab: SettingsTab,
  options: { showDevelopment?: boolean; betaFeatures?: BetaFeatureSettings } = {},
): boolean {
  const entry = SETTINGS_TAB_REGISTRY.find((candidate) => candidate.id === tab)
  if (!entry?.released) return false
  if (
    entry.betaFeature &&
    !(options.betaFeatures ?? DEFAULT_BETA_FEATURE_SETTINGS)[entry.betaFeature]
  ) {
    return false
  }
  if (entry.section === "development") return options.showDevelopment === true
  return entry.section !== "hidden"
}

export function normalizeVisibleSettingsTab(
  tab: SettingsTab,
  options: { showDevelopment?: boolean; betaFeatures?: BetaFeatureSettings } = {},
): SettingsTab {
  return isVisibleSettingsTab(tab, options) ? tab : "preferences"
}

export function isVisibleSettingsControl(
  control: SettingsControlMetadata,
  options: {
    showDevelopment?: boolean
    availableProviders?: readonly SettingsProviderScope[]
    betaFeatures?: BetaFeatureSettings
  } = {},
): boolean {
  if (!isVisibleSettingsTab(control.tab, options)) return false
  if (!control.requiresAvailableProvider || !options.availableProviders) return true
  return (
    control.providerScope?.some((provider) => options.availableProviders?.includes(provider)) ===
    true
  )
}

function control(
  id: string,
  tab: SettingsTab,
  label: string,
  description: string,
  keywords: string[],
  providerScope?: readonly SettingsProviderScope[],
  requiresAvailableProvider = false,
  targetId = id,
): SettingsControlMetadata {
  return {
    id,
    tab,
    label,
    description,
    keywords,
    targetId,
    providerScope,
    requiresAvailableProvider,
  }
}
