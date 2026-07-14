import type {
  PlanCandidate,
  PlanCandidateKind,
  PlanSourceSnapshot,
  PlanSourceStatus,
  ProjectPlanSnapshot,
} from "./plan-sources"

export type PlanWorkStatus = "proposed" | "active" | "built"
export type PlanStatusFilter = "all" | PlanWorkStatus

export interface PlanViewNode {
  candidate: PlanCandidate
  status: PlanWorkStatus
  children: PlanViewNode[]
}

export interface PlanProgress {
  completed: number
  total: number
  percent: number | null
}

export interface PlanViewModel {
  source: PlanSourceSnapshot | null
  nodes: PlanViewNode[]
  progress: PlanProgress
  resultCount: number
}

export interface PlanOpenTarget {
  path: string
  cwd: string
  line?: number
}

export interface PlanViewState {
  selectedSourceId: string | null
  query: string
  status: PlanStatusFilter
}

export type PlanViewAction =
  | { type: "select-source"; sourceId: string }
  | { type: "set-query"; query: string }
  | { type: "set-status"; status: PlanStatusFilter }
  | { type: "reset-project" }

const CHECKABLE_KINDS = new Set<PlanCandidateKind>(["task", "checklist"])

export function planViewReducer(state: PlanViewState, action: PlanViewAction): PlanViewState {
  switch (action.type) {
    case "select-source":
      return { ...state, selectedSourceId: action.sourceId }
    case "set-query":
      return { ...state, query: action.query }
    case "set-status":
      return { ...state, status: action.status }
    case "reset-project":
      return { selectedSourceId: null, query: "", status: "all" }
  }
}

export function resolvePlanWorkStatus(candidate: PlanCandidate): PlanWorkStatus {
  if (candidate.completed === true) return "built"
  if (candidate.kind === "proposal") return "proposed"
  return "active"
}

export function buildPlanViewModel(
  snapshot: ProjectPlanSnapshot | null | undefined,
  state: PlanViewState,
): PlanViewModel {
  const source = selectPlanSource(snapshot?.sources ?? [], state.selectedSourceId)
  if (!source) {
    return {
      source: null,
      nodes: [],
      progress: { completed: 0, total: 0, percent: null },
      resultCount: 0,
    }
  }

  const normalizedQuery = state.query.trim().toLocaleLowerCase()
  const byId = new Map(source.candidates.map((candidate) => [candidate.id, candidate]))
  const directlyVisible = new Set(
    source.candidates
      .filter((candidate) => {
        if (state.status !== "all" && resolvePlanWorkStatus(candidate) !== state.status)
          return false
        if (!normalizedQuery) return true
        return `${candidate.title}\n${candidate.body ?? ""}\n${candidate.path}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      })
      .map((candidate) => candidate.id),
  )
  const visible = new Set(directlyVisible)
  for (const candidateId of directlyVisible) {
    let parentId = byId.get(candidateId)?.parentId ?? null
    while (parentId) {
      visible.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }

  const nodesByParent = new Map<string | null, PlanViewNode[]>()
  for (const candidate of source.candidates) {
    if (!visible.has(candidate.id)) continue
    const parentId =
      candidate.parentId && visible.has(candidate.parentId) ? candidate.parentId : null
    const nodes = nodesByParent.get(parentId) ?? []
    nodes.push({ candidate, status: resolvePlanWorkStatus(candidate), children: [] })
    nodesByParent.set(parentId, nodes)
  }
  const attachChildren = (nodes: PlanViewNode[]): PlanViewNode[] =>
    nodes.map((node) => ({
      ...node,
      children: attachChildren(nodesByParent.get(node.candidate.id) ?? []),
    }))

  const checkable = source.candidates.filter((candidate) => CHECKABLE_KINDS.has(candidate.kind))
  const completed = checkable.filter((candidate) => candidate.completed === true).length
  return {
    source,
    nodes: attachChildren(nodesByParent.get(null) ?? []),
    progress: {
      completed,
      total: checkable.length,
      percent: checkable.length === 0 ? null : Math.round((completed / checkable.length) * 100),
    },
    resultCount: directlyVisible.size,
  }
}

export function selectPlanSource(
  sources: readonly PlanSourceSnapshot[],
  selectedSourceId: string | null,
): PlanSourceSnapshot | null {
  if (selectedSourceId) {
    const selected = sources.find((source) => source.id === selectedSourceId)
    if (selected) return selected
  }
  return sources.find((source) => source.status === "current") ?? sources[0] ?? null
}

export function describePlanSourceStatus(status: PlanSourceStatus): string {
  if (status === "current") return "Current"
  if (status === "stale") return "Stale — refresh required"
  return "Malformed — review errors"
}

export function buildPlanOpenTarget(
  rootPath: string,
  relativePath: string,
  line?: number,
): PlanOpenTarget | null {
  const absoluteRoot =
    rootPath.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(rootPath) ||
    /^\\\\[^\\]+\\[^\\]+/.test(rootPath)
  const normalized = relativePath.replaceAll("\\", "/")
  if (
    !rootPath.trim() ||
    !absoluteRoot ||
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return null
  }
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null

  const separator = rootPath.includes("\\") ? "\\" : "/"
  const cleanRoot = rootPath.replace(/[\\/]+$/, "") || separator
  const rootWithSeparator = cleanRoot.endsWith(separator) ? cleanRoot : `${cleanRoot}${separator}`
  return {
    path: `${rootWithSeparator}${segments.join(separator)}`,
    cwd: cleanRoot,
    ...(line && line > 0 ? { line } : {}),
  }
}
