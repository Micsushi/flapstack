import { useMemo, useState, type ReactNode } from "react"
import { trpc } from "../../../lib/trpc"

const KINDS = [
  "workflow-phase",
  "checkpoint",
  "dependency",
  "spawn",
  "replacement",
  "mailbox",
  "coordination",
  "warning",
  "usage",
  "aggregate-status",
] as const

export function OrchestrationActivityPanel({
  taskId,
  agents,
  showFilters = true,
}: {
  taskId: string
  agents: Array<{
    id: string
    runId: string | null
    definition: { name?: string; role: string }
  }>
  showFilters?: boolean
}) {
  const [agentId, setAgentId] = useState("")
  const [runId, setRunId] = useState("")
  const [runtime, setRuntime] = useState<"codex" | "claude-code" | "flapstack-native" | "">("")
  const [kind, setKind] = useState<(typeof KINDS)[number] | "">("")
  const [phase, setPhase] = useState("")
  const input = useMemo(
    () => ({
      taskId,
      ...(agentId ? { agentId } : {}),
      ...(runId ? { runId } : {}),
      ...(runtime ? { runtime } : {}),
      ...(kind ? { kind } : {}),
      ...(phase ? { phase } : {}),
    }),
    [agentId, kind, phase, runId, runtime, taskId],
  )
  const query = trpc.orchestrationOperations.listActivity.useQuery(input, {
    refetchInterval: 5_000,
  })
  return (
    <section aria-labelledby={`orchestration-activity-${taskId}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 id={`orchestration-activity-${taskId}`} className="text-[11px] font-medium">
            Group activity
          </h4>
          <p className="text-[9px] text-muted-foreground">
            Provider-neutral lifecycle and references only. Runtime activity remains authoritative.
          </p>
        </div>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 gap-1.5" aria-label="Group activity filters">
          <ActivitySelect label="Agent" value={agentId} onChange={setAgentId}>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.definition.name ?? agent.definition.role}
              </option>
            ))}
          </ActivitySelect>
          <ActivitySelect label="Run" value={runId} onChange={setRunId}>
            {Array.from(new Set(agents.flatMap((agent) => (agent.runId ? [agent.runId] : [])))).map(
              (id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ),
            )}
          </ActivitySelect>
          <ActivitySelect
            label="Runtime"
            value={runtime}
            onChange={(value) => setRuntime(value as typeof runtime)}
          >
            <option value="codex">Codex</option>
            <option value="claude-code">Claude Code</option>
            <option value="flapstack-native">Flapstack native</option>
          </ActivitySelect>
          <ActivitySelect
            label="Kind"
            value={kind}
            onChange={(value) => setKind(value as typeof kind)}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </ActivitySelect>
          <label className="text-[9px] text-muted-foreground">
            Phase
            <input
              className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-[10px] text-foreground"
              value={phase}
              onChange={(event) => setPhase(event.target.value)}
            />
          </label>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {query.isLoading
          ? "Loading group activity"
          : `Showing ${query.data?.length ?? 0} group activity events`}
      </p>
      {query.error ? (
        <p role="alert" className="text-[10px] text-red-400">
          Group activity unavailable: {query.error.message}
        </p>
      ) : query.data?.length ? (
        <ol className="max-h-52 space-y-1 overflow-y-auto" aria-label="Group activity events">
          {query.data.map((event) => (
            <li key={event.id} className="rounded border border-border/60 p-1.5 text-[9px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{event.kind}</span>
                <span className="text-muted-foreground">{event.phase}</span>
              </div>
              {event.summary && <p className="mt-0.5">{event.summary}</p>}
              <p className="mt-0.5 break-all text-muted-foreground">
                {event.agentId && `agent ${event.agentId}`}
                {event.agentId && event.runId && " · "}
                {event.runId && `run ${event.runId}`}
                {event.runtime && ` · runtime ${event.runtime}`}
                {event.sourceActivityEventId && ` · activity ref ${event.sourceActivityEventId}`}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[9px] text-muted-foreground">No matching group activity.</p>
      )}
    </section>
  )
}

function ActivitySelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className="text-[9px] text-muted-foreground">
      {label}
      <select
        className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-[10px] text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {children}
      </select>
    </label>
  )
}
