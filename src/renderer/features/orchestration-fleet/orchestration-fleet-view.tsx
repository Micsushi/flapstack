import { WorkspaceRow } from "../../components/ui/workspace"
import { WorkspaceHeader, WorkspaceTitle, WorkspacePage } from "../../components/ui/workspace"
import { NativeSelect } from "../../components/ui/native-select"
import { Button } from "../../components/ui/button"
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
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../agents/atoms"
import { OrchestrationActivityPanel } from "../agents/ui/orchestration-activity-panel"
import { writeSavedWorkspaceSelection } from "../saved-workspaces/selection-storage"
import { SharedRecordsBoard } from "../project-records/shared-records-board"

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
  const utils = trpc.useUtils()
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const workspaceRequest = useRef(0)
  useEffect(
    () => () => {
      workspaceRequest.current += 1
    },
    [],
  )
  const [source, setSource] = useState("records")
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
  const openWorkspace = async (projectId: string, workspaceId: string) => {
    const request = ++workspaceRequest.current
    setWorkspaceError(null)
    try {
      const [project, workspace] = await Promise.all([
        utils.projects.get.fetch({ id: projectId }),
        utils.savedWorkspaces.get.fetch({ workspaceId }),
      ])
      if (request !== workspaceRequest.current) return
      if (!project) throw new Error("This workspace's project is no longer available.")
      if (!workspace || workspace.archivedAt !== null) {
        throw new Error("This workspace is no longer available. Refresh the runs and try again.")
      }
      writeSavedWorkspaceSelection(projectId, workspaceId)
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
      setShowNewChatForm(false)
      setDesktopView("saved-workspaces")
    } catch (error) {
      if (request === workspaceRequest.current) {
        setWorkspaceError(
          error instanceof Error ? error.message : "Could not open the workspace. Try again.",
        )
      }
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background" aria-label="Agent runs">
      <WorkspaceHeader className="border-b px-5 py-3">
        <WorkspaceTitle className="mr-auto">Agent runs</WorkspaceTitle>
        <label className="flex items-center gap-2 text-sm">
          Runs
          <NativeSelect value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="records">Records task runs</option>
            <option value="local">Local runs</option>
          </NativeSelect>
        </label>
      </WorkspaceHeader>
      {workspaceError && (
        <p role="alert" className="px-5 py-3 text-sm text-destructive">
          {workspaceError}
        </p>
      )}
      <section
        hidden={source !== "records"}
        className="min-h-[32rem]"
        aria-labelledby="records-fleet-heading"
      >
        <div className="sr-only" id="records-fleet-heading">
          Records runtime fleet
        </div>
        <SharedRecordsBoard initialView="fleet" />
      </section>
      <section hidden={source !== "local"} aria-label="Local runs">
        <div className="mt-3 min-h-[24rem]">
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
              if (cursorHistory.length === 0) return
              setCursorHistory((history) => {
                setCursor(history[history.length - 1])
                return history.slice(0, -1)
              })
            }}
            onOpenChat={openChat}
            onOpenWorkspace={openWorkspace}
          />
        </div>
      </section>
    </main>
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
  onOpenWorkspace,
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
  onOpenWorkspace: (projectId: string, workspaceId: string) => void
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value !== DEFAULT_FILTERS[key as keyof OrchestrationFleetFilters],
  ).length
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
    <WorkspacePage className="overflow-y-auto p-6 text-foreground" aria-labelledby="fleet-title">
      <WorkspaceHeader className="mb-4">
        <div>
          <WorkspaceTitle id="fleet-title">Local runs</WorkspaceTitle>
        </div>
        <Button
          variant="outline"
          size="workspace"
          type="button"
          className="gap-2"
          onClick={onRefresh}
          aria-label="Refresh orchestration fleet"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </Button>
      </WorkspaceHeader>

      <details className="beta-disclosure mb-4">
        <summary className="cursor-pointer text-sm">
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ""}
        </summary>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
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
            label="Run state"
            value={filters.state}
            onChange={(value) => change("state", value as OrchestrationFleetFilters["state"])}
            options={[
              ["all", "All"],
              ["active", "Active"],
              ["terminal", "Finished"],
              ["unknown", "Unknown"],
            ]}
          />
          <LabeledSelect
            label="Show"
            value={filters.archiveScope}
            onChange={(value) =>
              change("archiveScope", value as OrchestrationFleetFilters["archiveScope"])
            }
            options={[
              ["visible", "Unarchived"],
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
      </details>

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
          <Button
            variant="outline"
            size="workspace"
            type="button"
            className="mt-3"
            onClick={onRetry}
          >
            Retry
          </Button>
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
          <p className="font-medium">No matching runs</p>
        </div>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
          <section aria-labelledby="fleet-results-title" className="min-w-0">
            <h2 id="fleet-results-title" className="sr-only">
              Runs
            </h2>
            <ol className="divide-y" aria-label="Orchestrations">
              {items.map((item, index) => (
                <li key={item.taskId}>
                  <WorkspaceRow
                    ref={(element) => {
                      rowRefs.current[index] = element
                    }}
                    type="button"
                    data-fleet-row
                    tabIndex={selected?.taskId === item.taskId ? 0 : -1}
                    className={`grid gap-2 px-4 py-3 focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto] ${
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
                      {!filters.projectId && (data?.facets.projects.length ?? 0) > 1 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.projectName}
                        </span>
                      )}
                    </span>
                    <StatusText status={item.status} freshness={item.freshness} />
                  </WorkspaceRow>
                </li>
              ))}
            </ol>
            {(canPrevious || data?.nextCursor) && (
              <nav
                className="flex items-center justify-between border-t p-3"
                aria-label="Fleet pagination"
              >
                <Button
                  variant="outline"
                  size="workspace"
                  type="button"

                  disabled={!canPrevious}
                  onClick={onPrevious}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">{data?.total ?? 0} matching</span>
                <Button
                  variant="outline"
                  size="workspace"
                  type="button"

                  disabled={!data?.nextCursor}
                  onClick={onNext}
                >
                  Next
                </Button>
              </nav>
            )}
          </section>
          {selected && (
            <FleetDetail
              item={selected}
              onOpenChat={onOpenChat}
              onOpenWorkspace={onOpenWorkspace}
            />
          )}
        </div>
      )}
    </WorkspacePage>
  )
}

function FleetDetail({
  item,
  onOpenChat,
  onOpenWorkspace,
}: {
  item: OrchestrationFleetItemDto
  onOpenChat: (chatId: string) => void
  onOpenWorkspace: (projectId: string, workspaceId: string) => void
}) {
  const titleId = `fleet-detail-${item.taskId}`
  const operationWorkspace = item.operationWorkspace ?? { id: null, state: "missing" as const }
  return (
    <aside className="overflow-hidden rounded-xl bg-card" aria-labelledby={titleId}>
      <div className="border-b p-4">
        <h2 id={titleId} className="font-semibold">
          {item.taskName}
        </h2>
      </div>
      <details className="beta-disclosure p-4">
        <summary className="cursor-pointer text-sm font-medium">Run details</summary>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 break-words text-sm">
          <dt className="text-muted-foreground">Project</dt>
          <dd>{item.projectName}</dd>
          <dt className="text-muted-foreground">Agents</dt>
          <dd>
            {item.aggregate.active} active · {item.aggregate.total} total
          </dd>
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
      </details>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <Button
          variant="outline"
          size="workspace"
          type="button"

          disabled={operationWorkspace.state !== "live"}
          onClick={() =>
            operationWorkspace.id && onOpenWorkspace(item.projectId, operationWorkspace.id)
          }
        >
          {operationWorkspace.state === "live"
            ? "Open operation workspace"
            : "Operation workspace missing"}
        </Button>
        <Button
          variant="outline"
          size="workspace"
          type="button"

          disabled={item.initiatingChat.state !== "live"}
          onClick={() => onOpenChat(item.initiatingChat.id)}
        >
          {item.initiatingChat.state === "live"
            ? "Open initiating chat"
            : `Initiating chat ${item.initiatingChat.state}`}
        </Button>
      </div>
      <div className="border-t p-4">
        <h3 className="mb-2 text-sm font-semibold">Agents</h3>
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
                  <td className="py-2 pr-3">{agent.provider}</td>
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
      <div className="border-t p-4">
        <OrchestrationActivityPanel
          taskId={item.taskId}
          showFilters={false}
          agents={item.agents.map((agent) => ({
            id: agent.id,
            runId: agent.run.id,
            definition: { name: agent.name, role: agent.role },
          }))}
        />
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
        ["", label === "Status" ? "All statuses" : `All ${label.toLocaleLowerCase()}s`],
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
      <NativeSelect
        id={id}
        className="min-w-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </NativeSelect>
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
