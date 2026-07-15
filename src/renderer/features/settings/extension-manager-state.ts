export const extensionManagerHarnesses = [
  "all",
  "claude-code",
  "codex",
  "cursor-agent",
  "opencode",
] as const
export const extensionManagerKinds = [
  "all",
  "skill",
  "command",
  "plugin",
  "custom-agent",
  "mcp",
  "hook",
] as const
export const extensionManagerSources = ["all", "native", "plugin", "managed"] as const
export const extensionManagerScopes = ["all", "user", "project", "plugin"] as const

export type ExtensionManagerHarness = (typeof extensionManagerHarnesses)[number]
export type ExtensionManagerKind = (typeof extensionManagerKinds)[number]
export type ExtensionManagerSource = (typeof extensionManagerSources)[number]
export type ExtensionManagerScope = (typeof extensionManagerScopes)[number]

export type ExtensionManagerRow = {
  id: string
  harness: Exclude<ExtensionManagerHarness, "all">
  kind: Exclude<ExtensionManagerKind, "all">
  source: Exclude<ExtensionManagerSource, "all">
  scope: Exclude<ExtensionManagerScope, "all">
  name: string
  description: string
  path: string
  support: "supported" | "compatibility" | "disabled" | "unsupported"
  runtime: "supported" | "not-consumed" | "unknown" | "disabled"
}

export type ExtensionManagerFilters = {
  harness: ExtensionManagerHarness
  kind: ExtensionManagerKind
  source: ExtensionManagerSource
  scope: ExtensionManagerScope
  query: string
}

export type ExtensionManagerFlow =
  | "create"
  | "edit"
  | "copy"
  | "delete"
  | "policy"
  | "hook-validate"
  | "hook-dry-run"
  | "hook-enable"
  | "hook-disable"
  | null

export type ExtensionManagerState = {
  filters: ExtensionManagerFilters
  selectedId: string | null
  flow: ExtensionManagerFlow
  previewConfirmed: boolean
}

export type ExtensionManagerAction =
  | { type: "filter"; key: keyof ExtensionManagerFilters; value: string }
  | { type: "select"; id: string | null }
  | { type: "begin"; flow: Exclude<ExtensionManagerFlow, null> }
  | { type: "preview-ready" }
  | { type: "confirm-preview"; confirmed: boolean }
  | { type: "cancel" }
  | { type: "reconcile"; visibleIds: string[] }

export type ExtensionManagerInventoryStatus =
  "loading" | "error" | "refreshing" | "stale-error" | "empty" | "ready"

export type ExtensionEditorValidationInput = {
  mode: "create" | "edit" | "copy"
  kind: Exclude<ExtensionManagerKind, "all">
  name: string
  description: string
  scope: "user" | "project"
  supported: boolean
  hasProject: boolean
  command: string
}

export function createExtensionCopyFields(source: { name: string; description: string }): {
  name: string
  description: string
} {
  return { name: source.name, description: source.description }
}

export function extensionEditorBlockingReason(
  input: ExtensionEditorValidationInput,
): string | null {
  if (!input.supported) return "No supported native preview adapter is available."
  if (!input.name.trim()) return "Extension name is required."
  if (input.scope === "project" && !input.hasProject) {
    return "A verified project is required for project scope."
  }
  if (input.kind === "hook" && !input.command.trim()) return "Hook command is required."
  if (
    input.mode !== "copy" &&
    (input.kind === "skill" || input.kind === "custom-agent") &&
    !input.description.trim()
  ) {
    return "Description is required by the provider format."
  }
  return null
}

export function verifiedExtensionManagerProject<T>(
  selectedProject: T | null,
  scopedInventorySucceeded: boolean,
): T | null {
  return selectedProject && scopedInventorySucceeded ? selectedProject : null
}

export function extensionManagerPolicyMutationCwd(
  _scope: "user" | "project" | "task",
  verifiedProjectPath?: string,
): string | undefined {
  return verifiedProjectPath
}

export function createExtensionManagerState(
  initialKind: ExtensionManagerKind = "all",
): ExtensionManagerState {
  return {
    filters: { harness: "all", kind: initialKind, source: "all", scope: "all", query: "" },
    selectedId: null,
    flow: null,
    previewConfirmed: false,
  }
}

export function extensionManagerReducer(
  state: ExtensionManagerState,
  action: ExtensionManagerAction,
): ExtensionManagerState {
  switch (action.type) {
    case "filter":
      return {
        ...state,
        filters: { ...state.filters, [action.key]: action.value },
        selectedId: null,
        flow: null,
        previewConfirmed: false,
      } as ExtensionManagerState
    case "select":
      return { ...state, selectedId: action.id, flow: null, previewConfirmed: false }
    case "begin":
      return { ...state, flow: action.flow, previewConfirmed: false }
    case "preview-ready":
      return { ...state, previewConfirmed: false }
    case "confirm-preview":
      return { ...state, previewConfirmed: action.confirmed }
    case "cancel":
      return { ...state, flow: null, previewConfirmed: false }
    case "reconcile": {
      const selectedId =
        state.selectedId && action.visibleIds.includes(state.selectedId)
          ? state.selectedId
          : (action.visibleIds[0] ?? null)
      return selectedId === state.selectedId ? state : { ...state, selectedId, flow: null }
    }
  }
}

export function filterExtensionManagerRows(
  rows: ExtensionManagerRow[],
  filters: ExtensionManagerFilters,
): ExtensionManagerRow[] {
  const tokens = normalizeExtensionSearch(filters.query).split(" ").filter(Boolean)
  return rows
    .filter((row) => filters.harness === "all" || row.harness === filters.harness)
    .filter((row) => filters.kind === "all" || row.kind === filters.kind)
    .filter((row) => filters.source === "all" || row.source === filters.source)
    .filter((row) => filters.scope === "all" || row.scope === filters.scope)
    .filter((row) => {
      const haystack = normalizeExtensionSearch(
        [
          row.name,
          row.description,
          row.path,
          row.harness,
          row.kind,
          row.source,
          row.scope,
          row.support,
          row.runtime,
        ].join(" "),
      )
      return tokens.every((token) => haystack.includes(token))
    })
    .sort((left, right) =>
      `${left.name}:${left.harness}:${left.kind}:${left.scope}`.localeCompare(
        `${right.name}:${right.harness}:${right.kind}:${right.scope}`,
      ),
    )
}

export function normalizeExtensionSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function nextExtensionSelection(
  ids: string[],
  selectedId: string | null,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): string | null {
  if (ids.length === 0) return null
  if (key === "Home") return ids[0]!
  if (key === "End") return ids.at(-1)!
  const current = Math.max(0, ids.indexOf(selectedId ?? ""))
  const offset = key === "ArrowDown" ? 1 : -1
  return ids[(current + offset + ids.length) % ids.length]!
}

export function exactPolicyDiff(input: {
  scope: "user" | "project" | "task"
  enabled: boolean
  currentEnabled: boolean
  currentSource: string
}): string {
  const before = JSON.stringify({
    resolvedBefore: input.currentEnabled ? "enabled" : "disabled",
    sourceBefore: input.currentSource,
  })
  const after = JSON.stringify({
    resolvedAtOrBelowScope: input.enabled ? "enabled" : "disabled",
    [`${input.scope}Override`]: input.enabled,
  })
  return `- ${before}\n+ ${after}`
}

export function clearPolicyDiff(input: {
  scope: "user" | "project" | "task"
  currentEnabled: boolean
  currentSource: string
  inheritedEnabled: boolean
  inheritedSource: string
}): string {
  const before = JSON.stringify({
    resolvedBefore: input.currentEnabled ? "enabled" : "disabled",
    sourceBefore: input.currentSource,
    [`${input.scope}Override`]: input.currentEnabled,
  })
  const after = JSON.stringify({
    [`${input.scope}Override`]: "removed",
    resolvedAfter: input.inheritedEnabled ? "enabled" : "disabled",
    sourceAfter: input.inheritedSource,
  })
  return `- ${before}\n+ ${after}`
}

export function extensionManagerInventoryStatus(input: {
  count: number
  loading: boolean
  fetching: boolean
  hasError: boolean
}): ExtensionManagerInventoryStatus {
  if (input.loading && input.count === 0) return "loading"
  if (input.hasError && input.count === 0) return "error"
  if (input.hasError) return "stale-error"
  if (input.fetching && input.count > 0) return "refreshing"
  return input.count === 0 ? "empty" : "ready"
}

export function reverseUnifiedDiff(diff: string): string {
  const lines = diff.split("\n")
  const reversed = [...lines]
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index]?.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      reversed[index] = `--- ${lines[index + 1]!.slice(4)}`
      reversed[index + 1] = `+++ ${lines[index]!.slice(4)}`
      index += 1
    }
  }
  return reversed
    .map((reversedLine, index) => {
      if (lines[index]?.startsWith("--- ") || lines[index]?.startsWith("+++ ")) {
        return reversedLine
      }
      const hunk = /^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@(.*)$/.exec(reversedLine)
      if (hunk) return `@@ -${hunk[2]} +${hunk[1]} @@${hunk[3]}`
      if (reversedLine.startsWith("+")) return `-${reversedLine.slice(1)}`
      if (reversedLine.startsWith("-")) return `+${reversedLine.slice(1)}`
      return reversedLine
    })
    .join("\n")
}
