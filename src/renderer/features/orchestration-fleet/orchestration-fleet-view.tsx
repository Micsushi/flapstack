import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useSetAtom } from "jotai"
import { RefreshCw } from "lucide-react"
import type {
  OrchestrationFleetItemDto,
  OrchestrationFleetPageDto,
  OrchestrationFleetSort,
} from "../../../shared/agent-orchestration"
import { trpc } from "../../lib/trpc"
import {
  desktopViewAtom,
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  showNewChatFormAtom,
} from "../agents/atoms"

export type OrchestrationFleetFilters = {
  projectId: string
  taskId: string
  status: string
  provider: string
  state: "all" | "active" | "terminal" | "unknown"
  archiveScope: "visible" | "archived" | "all"
  sort: OrchestrationFleetSort
}

const DEFAULT_FILTERS: OrchestrationFleetFilters = {
  projectId: "",
  taskId: "",
  status: "",
  provider: "",
  state: "all",
  archiveScope: "visible",
  sort: "updated-desc",
}

export function OrchestrationFleetView() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([])
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setOpenChatIds = useSetAtom(openAgentChatIdsAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const input = useMemo(
    () => ({
      projectIds: filters.projectId ? [filters.projectId] : [],
      taskIds: filters.taskId ? [filters.taskId] : [],
      statuses: filters.status ? [filters.status] : [],
      providers: filters.provider ? [filters.provider] : [],
      state: filters.state,
      archiveScope: filters.archiveScope,
      sort: filters.sort,
      limit: 25,
      ...(cursor ? { cursor } : {}),
    }),
    [cursor, filters],
  )
  const query = trpc.spawnedAgents.getFleet.useQuery(input, {
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  })

  const updateFilters = (next: OrchestrationFleetFilters) => {
    setFilters(next)
    setCursor(undefined)
    setCursorHistory([])
  }
  const openChat = (chatId: string) => {
    setOpenChatIds((current) => (current.includes(chatId) ? current : [...current, chatId]))
    setSelectedChatId(chatId)
    setShowNewChatForm(false)
    setDesktopView(null)
  }

  return (
    <OrchestrationFleetPanel
      data={query.data}
      filters={filters}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      canPrevious={cursorHistory.length > 0}
      onFiltersChange={updateFilters}
      onRefresh={() => void query.refetch()}
      onRetry={() => void query.refetch()}
      onNext={() => {
        if (!query.data?.nextCursor) return
        setCursorHistory((history) => [...history, cursor])
        setCursor(query.data.nextCursor)
      }}
      onPrevious={() => {
        setCursorHistory((history) => {
          if (history.length === 0) return history
          setCursor(history[history.length - 1])
          return history.slice(0, -1)
        })
      }}
      onOpenChat={openChat}
    />
  )
}

export function OrchestrationFleetPanel({
  data,
  filters,
  isLoading,
  isFetching,
  error,
  canPrevious,
  onFiltersChange,
  onRefresh,
  onRetry,
  onNext,
  onPrevious,
  onOpenChat,
}: {
  data?: OrchestrationFleetPageDto
  filters: OrchestrationFleetFilters
  isLoading: boolean
  isFetching: boolean
  error: string | null
  canPrevious: boolean
  onFiltersChange: (filters: OrchestrationFleetFilters) => void
  onRefresh: () => void
  onRetry: () => void
  onNext: () => void
  onPrevious: () => void
  onOpenChat: (chatId: string) => void
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])
  const items = data?.items ?? []
  const selected = items.find((item) => item.taskId === selectedTaskId) ?? items[0] ?? null

  useEffect(() => {
    if (items.length === 0) setSelectedTaskId(null)
    else if (!items.some((item) => item.taskId === selectedTaskId)) {
      setSelectedTaskId(items[0]!.taskId)
    }
  }, [items, selectedTaskId])

  const change = <K extends keyof OrchestrationFleetFilters>(
    key: K,
    value: OrchestrationFleetFilters[K],
  ) => onFiltersChange({ ...filters, [key]: value })

  return (
    <main
      className="h-full overflow-y-auto bg-background p-5 text-foreground"
      aria-labelledby="fleet-title"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 id="fleet-title" className="text-xl font-semibold">
            Orchestration fleet
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only durable state across projects and tasks. Reading never starts work.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={onRefresh}
          aria-label="Refresh orchestration fleet"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </header>

      <form
        className="mb-4 grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-7"
        aria-label="Fleet filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <FleetSelect
          label="Project"
          value={filters.projectId}
          onChange={(value) => change("projectId", value)}
          options={data?.facets.projects ?? []}
        />
        <FleetSelect
          label="Task"
          value={filters.taskId}
          onChange={(value) => change("taskId", value)}
          options={data?.facets.tasks ?? []}
        />
        <FleetSelect
          label="Status"
          value={filters.status}
          onChange={(value) => change("status", value)}
          options={data?.facets.statuses ?? []}
        />
        <FleetSelect
          label="Provider"
          value={filters.provider}
          onChange={(value) => change("provider", value)}
          options={data?.facets.providers ?? []}
        />
        <LabeledSelect
          label="Lifecycle"
          value={filters.state}
          onChange={(value) => change("state", value as OrchestrationFleetFilters["state"])}
          options={[
            ["all", "All"],
            ["active", "Active"],
            ["terminal", "Terminal"],
            ["unknown", "Unknown"],
          ]}
        />
        <LabeledSelect
          label="Archive scope"
          value={filters.archiveScope}
          onChange={(value) =>
            change("archiveScope", value as OrchestrationFleetFilters["archiveScope"])
          }
          options={[
            ["visible", "Visible only"],
            ["archived", "Archived only"],
            ["all", "All"],
          ]}
        />
        <LabeledSelect
          label="Sort"
          value={filters.sort}
          onChange={(value) => change("sort", value as OrchestrationFleetSort)}
          options={[
            ["updated-desc", "Recently updated"],
            ["updated-asc", "Oldest update"],
            ["created-desc", "Recently created"],
            ["created-asc", "Oldest created"],
            ["name-asc", "Task name"],
          ]}
        />
      </form>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {isLoading
          ? "Loading orchestration fleet"
          : error
            ? "Orchestration fleet failed to load"
            : `Showing ${items.length} of ${data?.total ?? 0} matching orchestrations`}
      </p>

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-4">
          <p className="font-medium">Fleet query failed</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            className="mt-3 rounded-md border px-3 py-1.5 text-sm"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : isLoading && !data ? (
        <div
          role="status"
          className="rounded-lg border p-8 text-center text-sm text-muted-foreground"
        >
          Loading orchestration fleet…
        </div>
      ) : items.length === 0 ? (
        <div role="status" className="rounded-lg border p-8 text-center">
          <p className="font-medium">No orchestrations match these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Change project, task, status, provider, lifecycle, or archive scope.
          </p>
        </div>
      ) : (
        <div className="grid min-h-[28rem] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
          <section aria-labelledby="fleet-results-title" className="min-w-0 rounded-lg border">
            <h2 id="fleet-results-title" className="border-b px-4 py-3 text-sm font-semibold">
              Fleet results
            </h2>
            <ol className="divide-y" aria-label="Orchestrations">
              {items.map((item, index) => (
                <li key={item.taskId}>
                  <button
                    ref={(element) => {
                      rowRefs.current[index] = element
                    }}
                    type="button"
                    data-fleet-row
                    tabIndex={selected?.taskId === item.taskId ? 0 : -1}
                    className={`grid w-full gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto_auto] ${
                      selected?.taskId === item.taskId ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                    aria-pressed={selected?.taskId === item.taskId}
                    aria-label={`${item.taskName}, ${item.projectName}, ${item.status}, ${item.freshness}`}
                    onClick={() => setSelectedTaskId(item.taskId)}
                    onFocus={() => setSelectedTaskId(item.taskId)}
                    onKeyDown={(event) => focusFleetRow(event, index, rowRefs.current)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.taskName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.projectName} · {item.engine.label} ·{" "}
                        {item.providers.join(", ") || "unknown provider"}
                      </span>
                    </span>
                    <StatusText status={item.status} freshness={item.freshness} />
                    <span className="text-xs text-muted-foreground">
                      {item.aggregate.active} active · {item.aggregate.total} agents
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <nav
              className="flex items-center justify-between border-t p-3"
              aria-label="Fleet pagination"
            >
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={!canPrevious}
                onClick={onPrevious}
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">{data?.total ?? 0} matching</span>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={!data?.nextCursor}
                onClick={onNext}
              >
                Next
              </button>
            </nav>
          </section>
          {selected && <FleetDetail item={selected} onOpenChat={onOpenChat} />}
        </div>
      )}
    </main>
  )
}

function FleetDetail({
  item,
  onOpenChat,
}: {
  item: OrchestrationFleetItemDto
  onOpenChat: (chatId: string) => void
}) {
  const titleId = `fleet-detail-${item.taskId}`
  return (
    <aside className="rounded-lg border" aria-labelledby={titleId}>
      <div className="border-b p-4">
        <h2 id={titleId} className="font-semibold">
          {item.taskName}
        </h2>
        <p className="text-sm text-muted-foreground">{item.projectName}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
        <dt className="text-muted-foreground">State</dt>
        <dd>
          <StatusText status={item.status} freshness={item.freshness} />
        </dd>
        <dt className="text-muted-foreground">Freshness</dt>
        <dd>{item.freshnessReason}</dd>
        <dt className="text-muted-foreground">Engine</dt>
        <dd>
          {item.engine.label} ({item.engine.provenance})
        </dd>
        <dt className="text-muted-foreground">Identity</dt>
        <dd>{item.coordinationIdentity.label}</dd>
        <dt className="text-muted-foreground">Providers</dt>
        <dd>{item.providers.join(", ") || "Unknown"}</dd>
        <dt className="text-muted-foreground">Harnesses</dt>
        <dd>{item.harnesses.join(", ") || "Unknown"}</dd>
        <dt className="text-muted-foreground">Limits</dt>
        <dd>
          {item.maxParallelAgents} parallel, depth {item.maxDepth}
        </dd>
        <dt className="text-muted-foreground">Blockers</dt>
        <dd>{item.blockerCount}</dd>
        <dt className="text-muted-foreground">Usage</dt>
        <dd>{formatFleetUsage(item)}</dd>
        <dt className="text-muted-foreground">Updated</dt>
        <dd>{formatTime(item.updatedAt)}</dd>
      </dl>
      <div className="px-4 pb-4">
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={item.initiatingChat.state !== "live"}
          onClick={() => onOpenChat(item.initiatingChat.id)}
        >
          {item.initiatingChat.state === "live"
            ? "Open initiating chat"
            : `Initiating chat ${item.initiatingChat.state}`}
        </button>
      </div>
      <div className="border-t p-4">
        <h3 className="mb-2 text-sm font-semibold">Agents, runs, and chats</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="pb-2 pr-3">
                  Agent
                </th>
                <th scope="col" className="pb-2 pr-3">
                  Provider
                </th>
                <th scope="col" className="pb-2 pr-3">
                  Run
                </th>
                <th scope="col" className="pb-2">
                  Chat
                </th>
              </tr>
            </thead>
            <tbody>
              {item.agents.map((agent) => (
                <tr key={agent.id} className="border-t align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {agent.name}
                    <span className="block font-normal text-muted-foreground">{agent.status}</span>
                  </th>
                  <td className="py-2 pr-3">
                    {agent.provider}
                    <span className="block text-muted-foreground">
                      {agent.harness} · {agent.providerProvenance}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{agent.run.status ?? "No run"}</td>
                  <td className="py-2">
                    {agent.chat.id && agent.chat.state === "live" ? (
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => onOpenChat(agent.chat.id!)}
                        aria-label={`Open agent chat ${agent.name}`}
                      >
                        Open
                      </button>
                    ) : (
                      agent.chat.state
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </aside>
  )
}

function FleetSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ id: string; label: string; count: number }>
}) {
  return (
    <LabeledSelect
      label={label}
      value={value}
      onChange={onChange}
      options={[
        ["", `All ${label.toLocaleLowerCase()}s`],
        ...options.map(
          (option) => [option.id, `${option.label} (${option.count})`] as [string, string],
        ),
      ]}
    />
  )
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<readonly [string, string]>
}) {
  const id = `fleet-${label.toLocaleLowerCase().replaceAll(" ", "-")}`
  return (
    <label htmlFor={id} className="grid gap-1 text-xs font-medium">
      {label}
      <select
        id={id}
        className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function StatusText({ status, freshness }: { status: string; freshness: string }) {
  return (
    <span className="whitespace-nowrap text-xs">
      <span className="font-medium">{status}</span>
      <span className="text-muted-foreground"> · {freshness}</span>
    </span>
  )
}

function focusFleetRow(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  rows: Array<HTMLButtonElement | null>,
) {
  let next = index
  if (event.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1)
  else if (event.key === "ArrowUp") next = Math.max(0, index - 1)
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = rows.length - 1
  else return
  event.preventDefault()
  rows[next]?.focus()
}

function formatTime(value: number): string {
  return value > 0 ? new Date(value).toLocaleString() : "Unknown"
}

function formatFleetUsage(item: OrchestrationFleetItemDto): string {
  const costs = [
    item.aggregate.exactCostUsdMicros > 0
      ? `${formatUsd(item.aggregate.exactCostUsdMicros)} exact`
      : null,
    item.aggregate.providerReportedCostUsdMicros > 0
      ? `${formatUsd(item.aggregate.providerReportedCostUsdMicros)} reported`
      : null,
    item.aggregate.estimatedCostUsdMicros > 0
      ? `${formatUsd(item.aggregate.estimatedCostUsdMicros)} estimated`
      : null,
  ].filter((value): value is string => value !== null)
  const costLabel = costs.length > 0 ? costs.join(" + ") : "no known cost"
  const unknown = item.aggregate.costQuality === "unknown" ? "; unknown values included" : ""
  return `${item.aggregate.totalTokens.toLocaleString()} tokens · ${costLabel}${unknown}`
}

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}
