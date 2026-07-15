import { useMemo } from "react"
import type {
  CoordinationEngine,
  CoordinationEngineOptionPreview,
  CoordinationEngineProbe,
} from "../../../../shared/coordination-engine"
import { trpc } from "../../../lib/trpc"
import { CoordinationEngineAvailability } from "../../../features/agents/ui/coordination-engine-launch-preview"

export function AgentsCoordinationEnginesTab() {
  const defaults = trpc.coordinationEngines.listDefaults.useQuery({
    scope: { type: "global", id: null },
  })
  const capabilities = trpc.coordinationEngines.capabilities.useQuery()
  const utils = trpc.useUtils()
  const write = trpc.coordinationEngines.writeDefault.useMutation({
    onSuccess: () => utils.coordinationEngines.listDefaults.invalidate(),
  })
  const current = defaults.data?.[0]
  const selected = current?.engine ?? "workflow"
  const options = useMemo(
    () => capabilityOptions(capabilities.data, selected),
    [capabilities.data, selected],
  )
  const blocked = options.find((option) => option.engine === selected && !option.supported)

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1.5">
        <h3 className="text-sm font-semibold">Coordination engines</h3>
        <p className="text-sm text-muted-foreground">
          Choose how multi-agent groups cooperate. This is separate from each worker&apos;s Agent
          Runtime and profile.
        </p>
      </header>

      <section
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        data-settings-id="coordination-engine-default"
        tabIndex={-1}
      >
        <label htmlFor="coordination-engine-default-select" className="text-sm font-medium">
          Global default
        </label>
        <select
          id="coordination-engine-default-select"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={selected}
          disabled={defaults.isLoading || capabilities.isLoading || write.isPending}
          aria-describedby="coordination-engine-default-help coordination-engine-default-status"
          onChange={(event) => {
            const engine = event.target.value as CoordinationEngine
            const option = options.find((candidate) => candidate.engine === engine)
            if (!option?.supported) return
            write.mutate({
              scope: { type: "global", id: null },
              engine,
              expectedVersion: current?.version ?? 0,
            })
          }}
        >
          {options.map((option) => (
            <option key={option.engine} value={option.engine} disabled={!option.supported}>
              {option.label}
              {!option.supported ? " — unavailable" : ""}
            </option>
          ))}
        </select>
        <p id="coordination-engine-default-help" className="text-xs text-muted-foreground">
          Per-launch override wins over project override, then this global default. Without any
          saved choice, Workflow is used.
        </p>
        <p
          id="coordination-engine-default-status"
          className={blocked ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          role="status"
          aria-live="polite"
        >
          {write.error?.message ??
            (blocked
              ? `${blocked.reason?.message ?? "Selected engine is unavailable."} ${blocked.reason?.repair ?? ""}`
              : "Engine choice is snapshotted when an orchestration starts. Active runs cannot switch.")}
        </p>
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        data-settings-id="coordination-engine-availability"
        tabIndex={-1}
      >
        <h4 className="text-sm font-medium">Availability and capability probes</h4>
        <CoordinationEngineAvailability options={options} />
        <details>
          <summary className="cursor-pointer text-xs font-medium">Advanced legacy mode</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Codex V1 keeps provider agent IDs, resume, and close semantics. It never presents V2
            names or mailbox support and is not the default.
          </p>
        </details>
      </section>
    </div>
  )
}

function capabilityOptions(
  probes: Record<CoordinationEngine, CoordinationEngineProbe> | undefined,
  selected: CoordinationEngine,
): CoordinationEngineOptionPreview[] {
  const labels: Record<CoordinationEngine, [string, string]> = {
    workflow: [
      "Workflow",
      "Deterministic, inspectable Flapstack workflow. Recommended for mixed workers.",
    ],
    "codex-v2": [
      "Codex task tree (V2)",
      "Native named tasks, mailboxes, follow-up turns, and selective context forks.",
    ],
    "codex-v1": [
      "Codex legacy threads (V1)",
      "Advanced provider agent-ID compatibility without V2 task-tree features.",
    ],
  }
  return (["workflow", "codex-v2", "codex-v1"] as const).map((engine) => ({
    engine,
    label: labels[engine][0],
    description: labels[engine][1],
    advanced: engine === "codex-v1",
    selected: engine === selected,
    supported: probes?.[engine]?.available ?? engine === "workflow",
    reason: probes?.[engine]?.reason ?? null,
  }))
}
