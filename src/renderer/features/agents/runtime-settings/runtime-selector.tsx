import type { AgentRuntimePreference } from "../../../../shared/agent-runtime"
import { Check, ChevronDown, LockKeyhole } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { AgentIcon, ClaudeCodeIcon, CodexIcon, SparklesIcon } from "../../../components/ui/icons"
import {
  allowedRuntimePreferences,
  productRuntime,
  runtimePreferenceLabel,
} from "./runtime-settings-model"

export function RuntimeSelector({
  harness,
  value,
  onChange,
  disabled = false,
  locked = false,
  id,
  automaticPreference,
}: {
  harness: string
  value: AgentRuntimePreference
  onChange(value: AgentRuntimePreference): void
  disabled?: boolean
  locked?: boolean
  id?: string
  automaticPreference?: Exclude<AgentRuntimePreference, "auto">
}) {
  const preferences = allowedRuntimePreferences(harness)
  const automaticRuntimeLabel = runtimePreferenceLabel(
    automaticPreference ?? productRuntime(harness),
  )
  const selectedLabel =
    value === "auto"
      ? `Automatic runtime (${automaticRuntimeLabel})`
      : runtimePreferenceLabel(value)

  if (locked) {
    return (
      <button
        id={id}
        data-tour="runtime"
        type="button"
        aria-label={`Runtime locked after the first message: ${selectedLabel}`}
        title="Runtime locked after the first message"
        disabled
        className="flex h-7 max-w-[220px] cursor-not-allowed items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground opacity-70"
      >
        <RuntimePreferenceIcon preference={value} />
        <span className="truncate">{selectedLabel}</span>
        <LockKeyhole className="h-3 w-3 shrink-0" aria-hidden="true" />
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          id={id}
          data-tour="runtime"
          type="button"
          aria-label="Runtime"
          disabled={disabled}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-[background-color,color] duration-150 ease-out hover:bg-muted/50 hover:text-foreground outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RuntimePreferenceIcon preference={value} />
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="min-w-[180px]"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {preferences.map((preference) => (
          <DropdownMenuItem
            key={preference}
            onSelect={() => onChange(preference)}
            className="justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <RuntimePreferenceIcon preference={preference} />
              <span>
                {preference === "auto"
                  ? `Automatic runtime (${automaticRuntimeLabel})`
                  : runtimePreferenceLabel(preference)}
              </span>
            </span>
            {value === preference ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RuntimePreferenceIcon({ preference }: { preference: AgentRuntimePreference }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground"
  if (preference === "auto") return <SparklesIcon className={className} aria-hidden="true" />
  if (preference === "codex" || preference === "codex-enhanced") {
    return <CodexIcon className={className} aria-hidden="true" />
  }
  if (preference === "claude-code" || preference === "claude-code-enhanced")
    return <ClaudeCodeIcon className={className} aria-hidden="true" />
  return <AgentIcon className={className} aria-hidden="true" />
}
