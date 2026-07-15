import type { AgentActivityEvent } from "../../../../shared/agent-activity"
import type { AgentActivityInvalidation } from "../../../../shared/agent-activity"
import {
  DEFAULT_RUNTIME_ACTIVITY_FILTERS,
  filterRuntimeActivityRows,
  mergeRuntimeActivityPages,
  projectRuntimeActivityRows,
  selectRuntimeActivitySource,
  type RuntimeActivityFilters,
  type RuntimeActivityRow,
  type RuntimeActivitySource,
  type RuntimeActivityStatus,
} from "./runtime-activity-model"

export type RuntimeActivityTimelineState = {
  sources: RuntimeActivitySource[]
  rows: RuntimeActivityRow[]
  visibleRows: RuntimeActivityRow[]
  filters: RuntimeActivityFilters
  status: RuntimeActivityStatus
  error: string | null
  nextCursor: number | null
  hasMore: boolean
  selectedKey: string | null
  expandedKeys: ReadonlySet<string>
  generation: number
}

export type RuntimeActivityTimelineAction =
  | { type: "load-start" }
  | {
      type: "load-page"
      events: AgentActivityEvent[]
      nextCursor: number | null
      hasMore: boolean
      live?: boolean
    }
  | { type: "replace"; events: AgentActivityEvent[]; legacyMessages?: unknown; live?: boolean }
  | { type: "load-error"; message: string }
  | { type: "invalidated"; invalidation: AgentActivityInvalidation }
  | { type: "filters"; filters: Partial<RuntimeActivityFilters> }
  | { type: "select"; key: string | null }
  | { type: "toggle"; key: string }

export function createRuntimeActivityTimelineState(input?: {
  events?: AgentActivityEvent[]
  legacyMessages?: unknown
  filters?: Partial<RuntimeActivityFilters>
  status?: RuntimeActivityStatus
}): RuntimeActivityTimelineState {
  const filters = { ...DEFAULT_RUNTIME_ACTIVITY_FILTERS, ...input?.filters }
  const sources = selectRuntimeActivitySource(input?.events ?? [], input?.legacyMessages)
  const rows = projectRuntimeActivityRows(sources)
  return {
    sources,
    rows,
    visibleRows: filterRuntimeActivityRows(rows, filters),
    filters,
    status: input?.status ?? "ready",
    error: null,
    nextCursor: null,
    hasMore: false,
    selectedKey: null,
    expandedKeys: new Set(rows.filter((row) => row.defaultExpanded).map((row) => row.key)),
    generation: 0,
  }
}

function reproject(
  state: RuntimeActivityTimelineState,
  sources: RuntimeActivitySource[],
  filters = state.filters,
): RuntimeActivityTimelineState {
  const rows = projectRuntimeActivityRows(sources)
  return {
    ...state,
    sources,
    rows,
    filters,
    visibleRows: filterRuntimeActivityRows(rows, filters),
    selectedKey: rows.some((row) => row.key === state.selectedKey) ? state.selectedKey : null,
  }
}

export function runtimeActivityTimelineReducer(
  state: RuntimeActivityTimelineState,
  action: RuntimeActivityTimelineAction,
): RuntimeActivityTimelineState {
  switch (action.type) {
    case "load-start":
      return { ...state, status: "loading", error: null }
    case "load-page": {
      const next = reproject(state, mergeRuntimeActivityPages(state.sources, action.events))
      return {
        ...next,
        status: action.live ? "live" : "ready",
        error: null,
        nextCursor: action.nextCursor,
        hasMore: action.hasMore,
      }
    }
    case "replace": {
      const sources = selectRuntimeActivitySource(action.events, action.legacyMessages)
      const next = reproject(state, sources)
      return {
        ...next,
        status: action.live ? "live" : "ready",
        error: null,
        generation: state.generation + 1,
      }
    }
    case "load-error":
      return { ...state, status: "error", error: action.message }
    case "invalidated":
      return {
        ...state,
        status: "stale",
        generation: state.generation + 1,
      }
    case "filters":
      return reproject(state, state.sources, { ...state.filters, ...action.filters })
    case "select":
      return { ...state, selectedKey: action.key }
    case "toggle": {
      const expandedKeys = new Set(state.expandedKeys)
      if (expandedKeys.has(action.key)) expandedKeys.delete(action.key)
      else expandedKeys.add(action.key)
      return { ...state, expandedKeys }
    }
  }
}

export type RuntimeActivityBatcher = {
  push(events: AgentActivityEvent[]): void
  flush(): void
  dispose(): void
}

/** Bounds high-frequency provider deltas before one reducer/store update. */
export function createRuntimeActivityBatcher(
  emit: (events: AgentActivityEvent[]) => void,
  options: { maxBatch?: number; delayMs?: number } = {},
): RuntimeActivityBatcher {
  const maxBatch = Math.max(1, options.maxBatch ?? 100)
  const delayMs = Math.max(0, options.delayMs ?? 16)
  let pending: AgentActivityEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending.length === 0) return
    const next = pending
    pending = []
    emit(next)
  }
  return {
    push(events) {
      pending.push(...events)
      if (pending.length >= maxBatch) return flush()
      if (!timer) timer = setTimeout(flush, delayMs)
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = []
    },
  }
}
