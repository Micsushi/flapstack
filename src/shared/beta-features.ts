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
    description:
      "Edit connected chat text files with durable drafts, conflict-checked Save, opt-in autosave, disk review and undo. Draft discard and undo preserve the saved file.",
  },
  {
    id: "diffAnnotations",
    label: "Code review comments",
    description:
      "Diff-bound comments with editing, reversible deletion, and queued feedback to the selected conversation. Sent batches show status and offer cancellation.",
  },
  {
    id: "streamedFileSearch",
    label: "Search while scanning",
    description:
      "Show partial file discovery results while scanning. Existing search remains available when disabled.",
  },
  {
    id: "terminalRecovery",
    label: "Restore terminal output",
    description:
      "Reattach terminal views and recover saved output after restart. Restored history is stopped; processes and commands are not replayed.",
  },
  {
    id: "projectMemory",
    label: "Project knowledge",
    description: "Project knowledge sections, run context, search, backups, and editing.",
  },
  {
    id: "orchestration",
    label: "Agent workflows",
    description: "Multi-agent workflows, coordination engines, fleet controls, and recovery.",
  },
  {
    id: "savedWorkspaces",
    label: "Saved layouts",
    description: "Saved layouts, operation workspaces, pane restoration, and pop-out windows.",
  },
  {
    id: "automations",
    label: "Automations",
    description: "Automation creation, schedules, event triggers, execution, and inbox.",
  },
  {
    id: "planning",
    label: "Work board & plans",
    description: "Plan sources, task proposals, plan promotion, and Kanban controls.",
  },
  {
    id: "branchesAndWorktrees",
    label: "Branches & worktrees",
    description: "Read-only repository branch and worktree overview.",
  },
]

export function normalizeBetaFeatureSettings(
  raw: Partial<Record<BetaFeatureId, unknown>>,
): BetaFeatureSettings {
  return Object.fromEntries(
    BETA_FEATURE_IDS.map((id) => [id, raw[id] === true]),
  ) as BetaFeatureSettings
}
