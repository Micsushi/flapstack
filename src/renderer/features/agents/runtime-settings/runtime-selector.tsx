import type { AgentRuntimePreference } from "../../../../shared/agent-runtime"
import { allowedRuntimePreferences, runtimePreferenceLabel } from "./runtime-settings-model"

export function RuntimeSelector({
  harness,
  value,
  onChange,
  disabled = false,
  id,
}: {
  harness: string
  value: AgentRuntimePreference
  onChange(value: AgentRuntimePreference): void
  disabled?: boolean
  id?: string
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>Runtime</span>
      <select
        id={id}
        aria-label="Runtime"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as AgentRuntimePreference)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {allowedRuntimePreferences(harness).map((preference) => (
          <option key={preference} value={preference}>
            {runtimePreferenceLabel(preference)}
          </option>
        ))}
      </select>
    </label>
  )
}
