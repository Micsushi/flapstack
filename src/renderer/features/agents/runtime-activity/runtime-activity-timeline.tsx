"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { AgentActivityEvent, AgentActivityKind } from "../../../../shared/agent-activity"
import { AGENT_ACTIVITY_KINDS } from "../../../../shared/agent-activity"
import type {
  RuntimeCapabilitySnapshot,
  RuntimeLaunchControls,
} from "../../../../shared/agent-runtime"
import { cn } from "../../../lib/utils"
import {
  DEFAULT_RUNTIME_ACTIVITY_FILTERS,
  filterRuntimeActivityRows,
  nextRuntimeActivityFocusIndex,
  projectRuntimeActivityRows,
  selectRuntimeActivitySource,
  serializeRuntimeActivity,
  updateRuntimeLaunchControl,
  virtualizeRuntimeActivity,
  visibleRuntimeControlKeys,
  type RuntimeActivityExportFormat,
  type RuntimeActivityFilters,
  type RuntimeActivityRow,
  type RuntimeActivityStatus,
} from "./runtime-activity-model"

export type RuntimeActivityTimelineProps = {
  events?: AgentActivityEvent[]
  legacyMessages?: unknown
  status?: RuntimeActivityStatus
  error?: string | null
  hasMore?: boolean
  initialFilters?: Partial<RuntimeActivityFilters>
  estimatedRowHeight?: number
  viewportHeight?: number
  diagnosticsHref?: string
  onLoadMore?: () => void
  onRetry?: () => void
  onCopy?: (content: string) => void | Promise<void>
  onExport?: (format: RuntimeActivityExportFormat, content: string) => void | Promise<void>
}

function formatTimestamp(timestamp: number | null): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs == null) return null
  if (durationMs < 1_000) return `${durationMs} ms`
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`
}

function defaultCopy(content: string): Promise<void> | void {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard.writeText(content)
  }
}

function defaultExport(format: RuntimeActivityExportFormat, content: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return
  const blob = new Blob([content], {
    type: format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `runtime-activity.${format === "markdown" ? "md" : format}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function RuntimeActivityRowView({
  row,
  index,
  total,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  row: RuntimeActivityRow
  index: number
  total: number
  expanded: boolean
  selected: boolean
  onToggle: () => void
  onSelect: () => void
}) {
  const timestamp = formatTimestamp(row.timestamp)
  const duration = formatDuration(row.durationMs)
  return (
    <article
      id={`runtime-activity-${row.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
      role="article"
      aria-posinset={index + 1}
      aria-setsize={total}
      aria-label={`${row.label}. ${row.status}. ${row.provenance}`}
      data-runtime-activity-key={row.key}
      data-runtime={row.runtime}
      data-kind={row.kind}
      data-phase={row.phase}
      data-corrupt={row.corrupt || undefined}
      tabIndex={selected ? 0 : -1}
      onFocus={onSelect}
      className={cn(
        "rounded-md border border-border/60 px-3 py-2 outline-none",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        row.corrupt && "border-destructive/60",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${row.label}`}
          aria-expanded={row.expandable ? expanded : undefined}
          disabled={!row.expandable}
          onClick={onToggle}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          <span className="block truncate text-sm font-medium">{row.label}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.provenance} · {row.status}
            {duration ? ` · ${duration}` : ""}
          </span>
        </button>
        {timestamp && <time className="shrink-0 text-xs text-muted-foreground">{timestamp}</time>}
      </div>
      {row.parentId && (
        <div className="mt-1 text-xs text-muted-foreground">Child of {row.parentId}</div>
      )}
      {row.identity.length > 0 && (
        <div className="mt-1 truncate text-xs text-muted-foreground" aria-label="Provider identity">
          {row.identity.join(" · ")}
        </div>
      )}
      {row.privateUnavailable && (
        <p className="mt-2 text-sm text-muted-foreground">
          Provider-private content is not stored or displayed.
        </p>
      )}
      {row.content && (!row.expandable || expanded) && (
        <div className="mt-2 whitespace-pre-wrap break-words text-sm">
          {row.sections.map((section, sectionIndex) => (
            <section
              key={`${row.key}:section:${sectionIndex}`}
              aria-label={`${row.label} section ${sectionIndex + 1}`}
              className={cn(sectionIndex > 0 && "mt-3 border-t border-border/50 pt-3")}
            >
              {section}
            </section>
          ))}
        </div>
      )}
    </article>
  )
}

export const RuntimeActivityTimeline = memo(function RuntimeActivityTimeline({
  events = [],
  legacyMessages,
  status = "ready",
  error = null,
  hasMore = false,
  initialFilters,
  estimatedRowHeight = 96,
  viewportHeight = 640,
  diagnosticsHref,
  onLoadMore,
  onRetry,
  onCopy,
  onExport,
}: RuntimeActivityTimelineProps) {
  const [filters, setFilters] = useState<RuntimeActivityFilters>({
    ...DEFAULT_RUNTIME_ACTIVITY_FILTERS,
    ...initialFilters,
  })
  const [transcriptMode, setTranscriptMode] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const manualExpansionRef = useRef(new Map<string, boolean>())
  const viewportRef = useRef<HTMLDivElement>(null)

  const allRows = useMemo(
    () => projectRuntimeActivityRows(selectRuntimeActivitySource(events, legacyMessages)),
    [events, legacyMessages],
  )
  const filteredRows = useMemo(() => {
    const rows = filterRuntimeActivityRows(allRows, filters)
    if (!transcriptMode) return rows
    return rows.filter((row) =>
      [
        "agent-text",
        "reasoning-summary",
        "provider-visible-reasoning",
        "tool",
        "command",
        "patch",
      ].includes(row.kind),
    )
  }, [allRows, filters, transcriptMode])
  const window = useMemo(
    () => virtualizeRuntimeActivity(filteredRows, scrollTop, viewportHeight, estimatedRowHeight),
    [estimatedRowHeight, filteredRows, scrollTop, viewportHeight],
  )

  useEffect(() => {
    setExpandedKeys(() => {
      const next = new Set<string>()
      for (const row of allRows) {
        const manual = manualExpansionRef.current.get(row.key)
        if (manual ?? row.defaultExpanded) next.add(row.key)
      }
      return next
    })
  }, [allRows])

  useEffect(() => {
    if (filteredRows.length === 0) {
      setSelectedKey(null)
      return
    }
    if (!filteredRows.some((row) => row.key === selectedKey)) setSelectedKey(filteredRows[0].key)
  }, [filteredRows, selectedKey])

  const updateFilter = useCallback(
    <K extends keyof RuntimeActivityFilters>(key: K, value: RuntimeActivityFilters[K]) => {
      setFilters((current) => ({ ...current, [key]: value }))
      setScrollTop(0)
    },
    [],
  )

  const copy = useCallback(async () => {
    const content = serializeRuntimeActivity(filteredRows, "text")
    await (onCopy ? onCopy(content) : defaultCopy(content))
  }, [filteredRows, onCopy])

  const exportRows = useCallback(
    async (format: RuntimeActivityExportFormat) => {
      const content = serializeRuntimeActivity(filteredRows, format)
      if (onExport) await onExport(format, content)
      else defaultExport(format, content)
    },
    [filteredRows, onExport],
  )

  const onTimelineKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const current = Math.max(
        0,
        filteredRows.findIndex((row) => row.key === selectedKey),
      )
      if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
        event.preventDefault()
        const nextIndex = nextRuntimeActivityFocusIndex(current, event.key, filteredRows.length)
        const next = filteredRows[nextIndex]
        if (!next) return
        setSelectedKey(next.key)
        const nextTop = nextIndex * estimatedRowHeight
        setScrollTop(nextTop)
        viewportRef.current
          ?.querySelector<HTMLElement>(`[data-runtime-activity-key="${CSS.escape(next.key)}"]`)
          ?.focus()
      } else if ((event.key === "Enter" || event.key === " ") && selectedKey) {
        event.preventDefault()
        setExpandedKeys((currentKeys) => {
          const next = new Set(currentKeys)
          const expanded = !next.has(selectedKey)
          manualExpansionRef.current.set(selectedKey, expanded)
          if (expanded) next.add(selectedKey)
          else next.delete(selectedKey)
          return next
        })
      }
    },
    [estimatedRowHeight, filteredRows, selectedKey],
  )

  const stateMessage =
    status === "live"
      ? `Live activity. ${filteredRows.length} events visible.`
      : status === "stale"
        ? "Activity changed in another window. Refreshing is required."
        : `${filteredRows.length} events visible.`

  return (
    <section aria-label="Runtime transcript and activity timeline" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="search">
        <input
          type="search"
          aria-label="Search Runtime activity"
          value={filters.search}
          onChange={(event) => updateFilter("search", event.currentTarget.value)}
          placeholder="Search transcript"
          className="min-w-48 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
        <select
          aria-label="Filter Runtime activity type"
          value={filters.kind}
          onChange={(event) =>
            updateFilter("kind", event.currentTarget.value as AgentActivityKind | "all")
          }
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All activity</option>
          {AGENT_ACTIVITY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setTranscriptMode((current) => !current)}
          aria-pressed={transcriptMode}
        >
          {transcriptMode ? "Activity mode" : "Transcript mode"}
        </button>
        <button type="button" onClick={copy} disabled={filteredRows.every((row) => !row.copyable)}>
          Copy visible
        </button>
        <button type="button" onClick={() => exportRows("markdown")}>
          Export Markdown
        </button>
        <button type="button" onClick={() => exportRows("json")}>
          Export JSON
        </button>
        {diagnosticsHref && <a href={diagnosticsHref}>Runtime diagnostics</a>}
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {stateMessage}
      </div>
      {status === "live" && <div role="status">Live</div>}
      {status === "stale" && (
        <div role="status">Activity is stale. Refresh to replay new events.</div>
      )}
      {status === "loading" && filteredRows.length === 0 && (
        <div role="status">Loading Runtime activity…</div>
      )}
      {status === "error" && (
        <div role="alert">
          <p>Runtime activity could not be loaded. {error || "Unknown error."}</p>
          {onRetry && <button onClick={onRetry}>Retry</button>}
        </div>
      )}
      {status !== "error" && filteredRows.length === 0 && status !== "loading" && (
        <div role="status">No Runtime activity matches the current filters.</div>
      )}

      {filteredRows.length > 0 && (
        <div
          ref={viewportRef}
          role="feed"
          aria-label="Runtime activity"
          aria-busy={status === "loading"}
          tabIndex={0}
          onKeyDown={onTimelineKeyDown}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          style={{ height: viewportHeight, overflowY: "auto" }}
          className="space-y-2 overflow-y-auto rounded-md border border-border/60 p-2"
        >
          <div aria-hidden="true" style={{ height: window.topSpacer }} />
          {window.rows.map((row, localIndex) => {
            const absoluteIndex = window.start + localIndex
            const expanded = expandedKeys.has(row.key)
            return (
              <RuntimeActivityRowView
                key={row.key}
                row={row}
                index={absoluteIndex}
                total={filteredRows.length}
                expanded={expanded}
                selected={selectedKey === row.key}
                onSelect={() => setSelectedKey(row.key)}
                onToggle={() =>
                  setExpandedKeys((current) => {
                    const next = new Set(current)
                    const expanded = !next.has(row.key)
                    manualExpansionRef.current.set(row.key, expanded)
                    if (expanded) next.add(row.key)
                    else next.delete(row.key)
                    return next
                  })
                }
              />
            )
          })}
          <div aria-hidden="true" style={{ height: window.bottomSpacer }} />
        </div>
      )}
      {hasMore && onLoadMore && (
        <button type="button" onClick={onLoadMore} disabled={status === "loading"}>
          Load earlier activity
        </button>
      )}
    </section>
  )
})

export const RuntimeActivityControls = memo(function RuntimeActivityControls({
  controls,
  capabilities,
  onChange,
}: {
  controls: RuntimeLaunchControls
  capabilities: RuntimeCapabilitySnapshot
  onChange: (next: RuntimeLaunchControls, changed: keyof RuntimeLaunchControls) => void
}) {
  const visible = new Set(visibleRuntimeControlKeys(capabilities))
  const change = <K extends keyof RuntimeLaunchControls>(key: K, value: RuntimeLaunchControls[K]) =>
    onChange(updateRuntimeLaunchControl(controls, key, value), key)
  return (
    <fieldset aria-label="Runtime activity controls" className="flex flex-wrap items-center gap-3">
      <legend className="sr-only">Runtime activity controls</legend>
      {visible.has("modelEffort") && (
        <label>
          Model effort
          <select
            value={controls.modelEffort ?? ""}
            onChange={(event) => change("modelEffort", event.currentTarget.value || null)}
          >
            <option value="">Provider default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      )}
      {visible.has("modelThinking") && (
        <label>
          <input
            type="checkbox"
            checked={controls.modelThinking ?? false}
            onChange={(event) => change("modelThinking", event.currentTarget.checked)}
          />
          Model thinking
        </label>
      )}
      {visible.has("reasoningDisplay") && (
        <label>
          <input
            type="checkbox"
            checked={controls.reasoningDisplay}
            onChange={(event) => change("reasoningDisplay", event.currentTarget.checked)}
          />
          Show provider-visible reasoning
        </label>
      )}
      {visible.has("subagentActivity") && (
        <label>
          <input
            type="checkbox"
            checked={controls.subagentActivity}
            onChange={(event) => change("subagentActivity", event.currentTarget.checked)}
          />
          Show child and subagent activity
        </label>
      )}
      {visible.has("hookDiagnostics") && (
        <label>
          <input
            type="checkbox"
            checked={controls.hookDiagnostics}
            onChange={(event) => change("hookDiagnostics", event.currentTarget.checked)}
          />
          Show hook diagnostics
        </label>
      )}
    </fieldset>
  )
})
