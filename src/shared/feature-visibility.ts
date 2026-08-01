export const ALWAYS_VISIBLE_FEATURE_IDS = [
  "projects",
  "tasks",
  "chats",
  "search",
  "settings",
  "permissions",
  "recovery",
  "run-evidence",
] as const

export type FeatureVisibilityPreset = "focused" | "standard" | "complete"
export type OptionalFeatureId =
  | "plan"
  | "saved-workspaces"
  | "automations"
  | "orchestration"
  | "agent-profiles"
  | "runtimes"
  | "voice"
  | "usage"
  | "mobile-companion"
  | "visual-context"
  | "knowledge-graph"

export type FeatureExplanation = {
  version: `s6-${number}`
  purpose: string
  why: string
  prerequisites: string
  risk: string
  authority: string
  reenable: string
  enableRoute: `settings:${string}`
}

export type FeatureVisibilityEntry = {
  id: OptionalFeatureId
  label: string
  category: "workspace" | "agents" | "input" | "insights" | "knowledge"
  settingsTarget: `settings:${string}`
  routes: readonly string[]
  searchKeywords: readonly string[]
  presets: Readonly<Record<FeatureVisibilityPreset, boolean>>
  explanation: FeatureExplanation
  alwaysDiscoverable: true
  changesCapability: false
}

export type VisibilityState = Readonly<Record<string, boolean>>

export type VisibilityPreview = {
  preset: FeatureVisibilityPreset
  changes: Array<{ id: OptionalFeatureId; before: boolean; after: boolean }>
  result: Record<string, boolean>
}

export type OnboardingAnswers = {
  collaboration: "solo-pair" | "team-swarms"
  workflow: "chat-first" | "planning"
  reach: "desktop" | "cross-device"
  knowledge: "notes" | "graph"
}

export function resolveFeatureVisibilityProfileKind(input: {
  hasExistingProject: boolean
  hasLegacyProviderSetup: boolean
}): "fresh" | "existing" {
  return input.hasExistingProject || input.hasLegacyProviderSetup ? "existing" : "fresh"
}

export const FEATURE_VISIBILITY_REGISTRY: readonly FeatureVisibilityEntry[] = [
  feature(
    "plan",
    "Plan",
    "workspace",
    "settings:plan",
    ["/plan"],
    ["kanban", "planning", "tasks"],
    [false, true, true],
    "Organize project work as a reviewable plan and board.",
    "Use it when a Chat needs durable, reviewable work items instead of an informal checklist.",
    "A selected project.",
    "Moving or editing plan items changes task organization, not agent authority.",
  ),
  feature(
    "saved-workspaces",
    "Saved Workspaces",
    "workspace",
    "settings:saved-workspaces",
    ["/saved-workspaces"],
    ["layout", "panes", "windows"],
    [false, true, true],
    "Save and restore multi-pane project layouts.",
    "Use it to return to a known set of Chats, files, terminals, and diffs.",
    "A selected project and at least one Chat.",
    "Restoring a layout opens views but never launches provider work.",
  ),
  feature(
    "automations",
    "Automations",
    "agents",
    "settings:automations",
    ["/automations", "/automation-inbox"],
    ["scheduled", "background", "inbox"],
    [false, false, true],
    "Schedule bounded agent work and review its results.",
    "Use it for recurring or delayed work that should produce a reviewable inbox item.",
    "An explicit target, authority preview, and budget.",
    "Automations may run while unattended, so approvals and limits remain separate.",
  ),
  feature(
    "orchestration",
    "Orchestration",
    "agents",
    "settings:coordination",
    ["/orchestration", "/fleet"],
    ["multi-agent", "workflow", "delegate"],
    [false, true, true],
    "Coordinate several bounded agents through one durable workflow.",
    "Use it when independent tasks benefit from explicit dependencies and shared progress.",
    "Compatible Agent Profiles and Runtime targets.",
    "Children cannot exceed the parent delegation ceiling or selected budgets.",
  ),
  feature(
    "agent-profiles",
    "Agent Profiles",
    "agents",
    "settings:agent-profiles",
    ["/agent-profiles"],
    ["personality", "named agent", "profile studio"],
    [false, true, true],
    "Reuse reviewed agent identity, personality, capability, and authority settings.",
    "Use it to apply one named configuration consistently across compatible Chats.",
    "At least one compatible provider or local Runtime.",
    "A profile can request capabilities but cannot grant authority by itself.",
  ),
  feature(
    "runtimes",
    "Runtimes",
    "agents",
    "settings:runtimes",
    ["/runtimes"],
    ["codex", "claude code", "native", "adapter"],
    [false, true, true],
    "Choose the execution contract used by each compatible harness.",
    "Use it to select how a compatible provider session launches and continues.",
    "A capability-probed provider adapter.",
    "Unavailable or incompatible Runtime choices block instead of falling back.",
  ),
  feature(
    "voice",
    "Voice",
    "input",
    "settings:voice",
    ["/voice"],
    ["dictation", "speech", "microphone", "tts"],
    [false, true, true],
    "Dictate prompts and listen to selected responses.",
    "Use it when speech is a more accessible or convenient input and review method.",
    "An available microphone or speech engine for the requested action.",
    "Recording and cloud fallback always require visible, explicit state.",
  ),
  feature(
    "usage",
    "Usage",
    "insights",
    "settings:usage",
    ["/usage"],
    ["tokens", "cost", "limits", "alerts"],
    [false, true, true],
    "Inspect provider usage provenance, limits, and alerts.",
    "Use it to understand known provider consumption without treating estimates as invoices.",
    "Provider-reported facts or clearly labeled local estimates.",
    "Unavailable usage stays unknown and organization totals remain separate.",
  ),
  feature(
    "mobile-companion",
    "Mobile Companion",
    "input",
    "settings:mobile-companion",
    ["/mobile"],
    ["phone", "pair", "qr", "remote"],
    [false, false, true],
    "Monitor and steer bounded local work from a paired device.",
    "Use it to review or steer selected work away from the desktop without a hosted relay.",
    "An explicitly enabled private-network bridge and paired device.",
    "The bridge is default-off and stops when its network becomes unsafe.",
  ),
  feature(
    "visual-context",
    "Visual Context",
    "input",
    "settings:visual-context",
    ["/visual-context"],
    ["screenshot", "capture", "redact", "screen"],
    [false, false, true],
    "Attach an explicitly selected and reviewed screen derivative.",
    "Use it when visible pixels explain a UI problem better than text alone.",
    "Host capture permission and a confirmed preview.",
    "Only confirmed pixels enter context; redaction must remove source data.",
  ),
  feature(
    "knowledge-graph",
    "Knowledge Graph",
    "knowledge",
    "settings:knowledge-graph",
    ["/knowledge", "/knowledge/graph"],
    ["notes", "obsidian", "wikilink", "backlink"],
    [false, true, true],
    "Connect project Markdown notes through links, backlinks, and graphs.",
    "Use it to navigate related project knowledge and select bounded note context.",
    "A central or project-owned knowledge vault.",
    "Only explicitly selected bounded notes enter agent context.",
  ),
] as const

export function validateFeatureVisibilityRegistry(
  registry: readonly FeatureVisibilityEntry[],
): string[] {
  const issues: string[] = []
  const ids = new Set<string>()
  const routes = new Set<string>()
  for (const entry of registry) {
    if (ids.has(entry.id)) issues.push(`duplicate feature id: ${entry.id}`)
    ids.add(entry.id)
    if (ALWAYS_VISIBLE_FEATURE_IDS.includes(entry.id as never)) {
      issues.push(`always-visible feature registered as optional: ${entry.id}`)
    }
    if (entry.explanation.enableRoute !== entry.settingsTarget) {
      issues.push(`explanation enable route mismatch: ${entry.id}`)
    }
    if (!entry.alwaysDiscoverable || entry.changesCapability) {
      issues.push(`visibility contract is unsafe: ${entry.id}`)
    }
    for (const route of entry.routes) {
      if (routes.has(route)) issues.push(`duplicate feature route: ${route}`)
      routes.add(route)
    }
  }
  return issues
}

export function explainFeature(id: OptionalFeatureId): FeatureExplanation {
  const entry = FEATURE_VISIBILITY_REGISTRY.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`Unknown optional feature: ${id}`)
  return entry.explanation
}

export function resolveOnboardingPreset(answers: OnboardingAnswers): FeatureVisibilityPreset {
  if (
    answers.collaboration === "solo-pair" &&
    answers.workflow === "chat-first" &&
    answers.reach === "desktop" &&
    answers.knowledge === "notes"
  ) {
    return "focused"
  }
  if (
    answers.collaboration === "team-swarms" &&
    answers.workflow === "planning" &&
    answers.reach === "cross-device" &&
    answers.knowledge === "graph"
  ) {
    return "complete"
  }
  return "standard"
}

export function previewVisibilityPreset(
  current: VisibilityState,
  preset: FeatureVisibilityPreset,
  options: { preserveUnknown?: boolean; existingUser?: boolean } = {},
): VisibilityPreview {
  const known = new Set(FEATURE_VISIBILITY_REGISTRY.map((entry) => entry.id))
  const result: Record<string, boolean> = options.preserveUnknown
    ? { ...current }
    : Object.fromEntries(
        Object.entries(current).filter(([id]) => known.has(id as OptionalFeatureId)),
      )
  const changes: VisibilityPreview["changes"] = []
  for (const entry of FEATURE_VISIBILITY_REGISTRY) {
    const before = current[entry.id] ?? (options.existingUser ? true : entry.presets.standard)
    const after = entry.presets[preset]
    result[entry.id] = after
    if (before !== after) changes.push({ id: entry.id, before, after })
  }
  return { preset, changes, result }
}

export function applyVisibilityPreview(
  current: VisibilityState,
  preview: VisibilityPreview,
): Record<string, boolean> {
  for (const change of preview.changes) {
    const actual = Object.prototype.hasOwnProperty.call(current, change.id)
      ? current[change.id]
      : change.before
    if (actual !== change.before) {
      throw new Error(`Feature visibility changed after preview: ${change.id}`)
    }
  }
  return { ...preview.result }
}

function feature(
  id: OptionalFeatureId,
  label: string,
  category: FeatureVisibilityEntry["category"],
  settingsTarget: FeatureVisibilityEntry["settingsTarget"],
  routes: readonly string[],
  searchKeywords: readonly string[],
  [focused, standard, complete]: readonly [boolean, boolean, boolean],
  purpose: string,
  why: string,
  prerequisites: string,
  risk: string,
): FeatureVisibilityEntry {
  return {
    id,
    label,
    category,
    settingsTarget,
    routes,
    searchKeywords,
    presets: { focused, standard, complete },
    explanation: {
      version: "s6-1",
      purpose,
      why,
      prerequisites,
      risk,
      authority: risk,
      reenable:
        "Show it again in Settings > Feature Visibility. Hidden state keeps data and allowed operations intact.",
      enableRoute: settingsTarget,
    },
    alwaysDiscoverable: true,
    changesCapability: false,
  }
}
