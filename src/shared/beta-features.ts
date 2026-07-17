export const BETA_FEATURE_IDS = [
  "projectMemory",
  "orchestration",
  "savedWorkspaces",
  "automations",
  "planning",
] as const

export type BetaFeatureId = (typeof BETA_FEATURE_IDS)[number]
export type BetaFeatureSettings = Record<BetaFeatureId, boolean>

export const DEFAULT_BETA_FEATURE_SETTINGS: BetaFeatureSettings = {
  projectMemory: false,
  orchestration: false,
  savedWorkspaces: false,
  automations: false,
  planning: false,
}

export const BETA_FEATURE_REGISTRY: ReadonlyArray<{
  id: BetaFeatureId
  label: string
  description: string
}> = [
  {
    id: "projectMemory",
    label: "Project Memory",
    description: "Project knowledge sections, run context, search, backups, and editing.",
  },
  {
    id: "orchestration",
    label: "Orchestration",
    description: "Multi-agent workflows, coordination engines, fleet controls, and recovery.",
  },
  {
    id: "savedWorkspaces",
    label: "Saved Workspaces",
    description: "Saved layouts, operation workspaces, pane restoration, and pop-out windows.",
  },
  {
    id: "automations",
    label: "Automations",
    description: "Automation creation, schedules, event triggers, execution, and inbox.",
  },
  {
    id: "planning",
    label: "Planning & Task Board",
    description: "Plan sources, task proposals, plan promotion, and Kanban controls.",
  },
]

export function normalizeBetaFeatureSettings(
  raw: Partial<Record<BetaFeatureId, unknown>>,
): BetaFeatureSettings {
  return Object.fromEntries(
    BETA_FEATURE_IDS.map((id) => [id, raw[id] === true]),
  ) as BetaFeatureSettings
}
