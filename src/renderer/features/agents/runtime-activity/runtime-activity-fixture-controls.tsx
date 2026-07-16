import { useState } from "react"
import { trpc, trpcClient } from "../../../lib/trpc"
import {
  DEV_RUNTIME_ACTIVITY_VIEW_MODES,
  type DevRuntimeActivityViewMode,
} from "./runtime-activity-dev-fixture"

const VIEW_LABELS: Record<DevRuntimeActivityViewMode, string> = {
  activity: "Persisted activity",
  live: "Live",
  stale: "Stale",
  loading: "Loading",
  empty: "Empty",
  error: "Error",
  corrupt: "Corruption",
}

export function RuntimeActivityFixtureControls({
  ...props
}: {
  projectId: string | null
  chatId: string
  subChatId: string
  viewMode?: DevRuntimeActivityViewMode
  onViewModeChange?: (mode: DevRuntimeActivityViewMode) => void
}) {
  const settings = trpc.debug.getRuntimeActivityFixtureSettings.useQuery()
  if (!settings.data?.available || !settings.data.enabled) return null
  return <EnabledRuntimeActivityFixtureControls {...props} />
}

function EnabledRuntimeActivityFixtureControls({
  projectId,
  chatId,
  subChatId,
  viewMode,
  onViewModeChange,
}: {
  projectId: string | null
  chatId: string
  subChatId: string
  viewMode?: DevRuntimeActivityViewMode
  onViewModeChange?: (mode: DevRuntimeActivityViewMode) => void
}) {
  const [result, setResult] = useState<string | null>(null)
  const utils = trpc.useUtils()
  const fixtureApi = trpc.devRuntimeActivityFixtures!
  const fixtureUtils = utils.devRuntimeActivityFixtures!
  const input = projectId ? { projectId, chatId, subChatId } : null
  const status = fixtureApi.status.useQuery(input!, {
    enabled: input !== null,
  })
  const refresh = async () => {
    await Promise.all([
      fixtureUtils.status.invalidate(input!),
      utils.agentActivity.list.invalidate({ chatId }),
      utils.agentRuntimeDefaults.diagnostics.invalidate({ chatId }),
      utils.runs.listByChat.invalidate({ chatId }),
    ])
  }
  const seed = fixtureApi.seed.useMutation({
    onSuccess: async (data) => {
      setResult(`Seeded ${data.runs.length} terminal runs and ${data.eventCount} events.`)
      await refresh()
    },
    onError: (error) => setResult(error.message),
  })
  const reset = fixtureApi.reset.useMutation({
    onSuccess: async () => {
      setResult("Runtime activity fixture reset.")
      await refresh()
    },
    onError: (error) => setResult(error.message),
  })

  const busy = seed.isPending || reset.isPending || status.isLoading
  const replay = async () => {
    const run = status.data?.runs[0]
    if (!run) {
      setResult("Seed fixture data before replay.")
      return
    }
    try {
      const events = await trpcClient.agentActivity.replayRun.query({
        runId: run.id,
        afterSequence: 0,
        limit: 500,
      })
      setResult(`Replayed ${events.length} persisted events for the completed fixture run.`)
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <fieldset
      aria-label="Runtime activity test fixtures"
      className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs"
    >
      <legend className="px-1 font-medium">Runtime activity test fixtures</legend>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!input || busy || status.data?.present}
          onClick={() => input && seed.mutate(input)}
        >
          Seed terminal runs
        </button>
        <button
          type="button"
          disabled={!input || busy || !status.data?.present}
          onClick={() => input && reset.mutate(input)}
        >
          Reset fixture
        </button>
        <button type="button" disabled={!status.data?.present || busy} onClick={replay}>
          Replay persisted run
        </button>
        {viewMode && onViewModeChange ? (
          <label className="flex items-center gap-1">
            View state
            <select
              aria-label="Runtime activity fixture view state"
              value={viewMode}
              onChange={(event) =>
                onViewModeChange(event.currentTarget.value as DevRuntimeActivityViewMode)
              }
            >
              {DEV_RUNTIME_ACTIVITY_VIEW_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {VIEW_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="mt-1 text-muted-foreground">
        {projectId
          ? status.data?.present
            ? `${status.data.runs.length} project-scoped runs · ${status.data.eventCount} events`
            : "No fixture data in this project chat."
          : "Open a project chat to use Runtime fixtures."}
      </p>
      {result ? (
        <p role="status" className="mt-1">
          {result}
        </p>
      ) : null}
    </fieldset>
  )
}
