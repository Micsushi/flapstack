import type {
  CoordinationEngine,
  CoordinationEngineLaunchPreview,
  CoordinationEngineOptionPreview,
} from "../../../../shared/coordination-engine"

export function CoordinationEngineAvailability({
  options,
}: {
  options: CoordinationEngineOptionPreview[]
}) {
  return (
    <ul className="space-y-2" aria-label="Coordination engine availability">
      {options.map((option) => (
        <li key={option.engine} className="rounded-md border border-border/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">
              {option.supported ? "Available" : "Unavailable"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
          {!option.supported && option.reason && (
            <p className="mt-2 text-xs text-destructive" role="status">
              {option.reason.message} {option.reason.repair}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

export function CoordinationEngineLaunchPreviewPanel({
  preview,
  selection,
  onSelectionChange,
  loading = false,
}: {
  preview: CoordinationEngineLaunchPreview | null
  selection: CoordinationEngine | null
  onSelectionChange(engine: CoordinationEngine | null): void
  loading?: boolean
}) {
  const selectedOption = preview?.options.find((option) => option.selected)
  return (
    <fieldset
      className="space-y-3 rounded-lg border border-border/60 p-3 sm:col-span-2"
      aria-describedby="coordination-engine-launch-status"
    >
      <legend className="px-1 text-xs font-medium">Coordination engine</legend>
      <label htmlFor="coordination-engine-launch-select" className="text-xs">
        Launch override
      </label>
      <select
        id="coordination-engine-launch-select"
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={selection ?? ""}
        disabled={loading}
        onChange={(event) =>
          onSelectionChange((event.target.value || null) as CoordinationEngine | null)
        }
      >
        <option value="">Use inherited default</option>
        {preview?.options.map((option) => (
          <option key={option.engine} value={option.engine} disabled={!option.supported}>
            {option.label}
            {!option.supported ? " — unavailable" : ""}
          </option>
        ))}
      </select>
      <div id="coordination-engine-launch-status" role="status" aria-live="polite">
        {loading ? (
          <p className="text-xs text-muted-foreground">Resolving engine settings…</p>
        ) : preview?.ok && preview.resolved ? (
          <p className="text-xs text-muted-foreground">
            Resolved {selectedOption?.label ?? preview.resolved.engine} from {preview.source}.
            Version {preview.resolved.engineVersion} will be frozen before work starts.
          </p>
        ) : (
          <p className="text-xs text-destructive">
            {preview?.blockedReason?.message ?? "Engine preview unavailable."}{" "}
            {preview?.blockedReason?.repair}
          </p>
        )}
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {preview?.options
          .filter((option) => !option.supported)
          .map((option) => (
            <li key={option.engine}>
              {option.label}: {option.reason?.message} {option.reason?.repair}
            </li>
          ))}
      </ul>
    </fieldset>
  )
}
