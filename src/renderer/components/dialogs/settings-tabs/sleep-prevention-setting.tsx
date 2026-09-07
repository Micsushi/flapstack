import { useRef } from "react"
import { toast } from "sonner"
import {
  SLEEP_PREVENTION_MODES,
  type SleepPreventionMode,
} from "../../../../shared/sleep-prevention"
import { trpc, trpcClient } from "../../../lib/trpc"
import { recordAppAction } from "../../../lib/app-action-history"

export function SleepPreventionSetting() {
  const utils = trpc.useUtils()
  const pending = useRef(false)
  const query = trpc.sleepPrevention.status.useQuery(undefined, { refetchInterval: 5_000 })
  const mutation = trpc.sleepPrevention.setMode.useMutation()
  const change = async (mode: SleepPreventionMode) => {
    if (pending.current || !query.data || mode === query.data.mode) return
    pending.current = true
    const previous = query.data.mode
    const apply = async (next: SleepPreventionMode, expected: SleepPreventionMode) => {
      const status = await trpcClient.sleepPrevention.setMode.mutate({
        mode: next,
        expectedMode: expected,
      })
      utils.sleepPrevention.status.setData(undefined, status)
    }
    try {
      const status = await mutation.mutateAsync({ mode, expectedMode: previous })
      utils.sleepPrevention.status.setData(undefined, status)
      recordAppAction({
        label: "Change sleep prevention",
        undo: () => apply(previous, mode),
        redo: () => apply(mode, previous),
      })
    } catch {
      toast.error("Could not save sleep prevention", {
        description: "The previous setting is unchanged. Refresh and retry.",
      })
      await query.refetch()
    } finally {
      pending.current = false
    }
  }
  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-background p-4"
      data-settings-id="preferences-sleep-prevention"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="sleep-prevention-mode" className="text-sm font-medium">
          Sleep prevention
        </label>
        <select
          id="sleep-prevention-mode"
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={query.data?.mode ?? "off"}
          disabled={!query.data || mutation.isPending || query.isError}
          onChange={(event) => void change(event.target.value as SleepPreventionMode)}
        >
          {SLEEP_PREVENTION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode === "automatic" ? "Automatic" : mode === "on" ? "On" : "Off"}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Automatic keeps the system awake while agents run or owned terminals remain open. Display
        sleep is unchanged. Off is the default.
      </p>
      <p role="status" className="text-xs text-muted-foreground">
        {query.isError
          ? "Cannot read sleep status."
          : !query.data
            ? "Loading sleep status…"
            : (query.data.error ??
              (query.data.active ? "Keeping the system awake." : "Not preventing sleep."))}
        {query.data &&
          ` Agent work: ${query.data.agentWork ? "active" : "idle"}. Open terminals: ${query.data.terminals}.`}
      </p>
      {query.isError && (
        <button type="button" className="text-xs underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      )}
    </div>
  )
}
