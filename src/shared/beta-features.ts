export const BETA_FEATURE_IDS = [
  "projectMemory",
  "orchestration",
  "savedWorkspaces",
  "automations",
  "planning",
  "branchesAndWorktrees",
  "terminalRecovery",
  "streamedFileSearch",
  "diffAnnotations",
  "workspaceEditing",
] as const

export type BetaFeatureId = (typeof BETA_FEATURE_IDS)[number]
export type BetaFeatureSettings = Record<BetaFeatureId, boolean>

export const BETA_FEATURE_SEARCH_ALIASES: Record<BetaFeatureId, string[]> = {
  projectMemory: ["project memory", "vault"],
  orchestration: ["orchestration", "agent runs & workflows"],
  savedWorkspaces: ["saved workspaces"],
  automations: ["scheduled tasks"],
  planning: ["work board & planning", "task board & plans", "kanban"],
  branchesAndWorktrees: ["repository overview"],
  terminalRecovery: ["terminal recovery", "terminal reattachment"],
  streamedFileSearch: ["streamed file search", "progressive file search"],
  diffAnnotations: ["diff comments", "diff annotations"],
  workspaceEditing: ["workspace editing"],
}

export const DEFAULT_BETA_FEATURE_SETTINGS: BetaFeatureSettings = {
  projectMemory: false,
  orchestration: false,
  savedWorkspaces: false,
  automations: false,
  planning: false,
  branchesAndWorktrees: false,
  terminalRecovery: false,
  streamedFileSearch: false,
  diffAnnotations: false,
  workspaceEditing: false,
}

export const BETA_FEATURE_REGISTRY: ReadonlyArray<{
  id: BetaFeatureId
  label: string
  description: string
}> = [
  {
    id: "workspaceEditing",
    label: "File editing",
    description: "Edit project files with recoverable drafts and conflict-checked saves.",
  },
  {
    id: "diffAnnotations",
    label: "Code review comments",
    description: "Send comments on specific changes to a chat.",
  },
  {
    id: "streamedFileSearch",
    label: "Search while scanning",
    description: "Show matching files as the project is scanned.",
  },
  {
    id: "terminalRecovery",
    label: "Restore terminal output",
    description: "Recover terminal output after restart without rerunning commands.",
  },
  {
    id: "projectMemory",
    label: "Project knowledge",
    description: "Save and search notes that agents can use as project context.",
  },
  {
    id: "orchestration",
    label: "Agent workflows",
    description: "Coordinate multiple agents on a shared task.",
  },
  {
    id: "savedWorkspaces",
    label: "Saved layouts",
    description: "Restore saved pane layouts and pop-out windows.",
  },
  {
    id: "automations",
    label: "Automations",
    description: "Run tasks on a schedule or in response to events.",
  },
  {
    id: "planning",
    label: "Work board & plans",
    description: "Organize tasks on a board and turn proposals into plans.",
  },
  {
    id: "branchesAndWorktrees",
    label: "Branches & worktrees",
    description: "Inspect branches and worktrees for a repository.",
  },
]

export function normalizeBetaFeatureSettings(
  raw: Partial<Record<BetaFeatureId, unknown>>,
): BetaFeatureSettings {
  return Object.fromEntries(
    BETA_FEATURE_IDS.map((id) => [id, raw[id] === true]),
  ) as BetaFeatureSettings
}
