import type { AgentHarness, RunPermissionMode } from "../../../../shared/harness-types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { CheckIcon, SettingsIcon } from "../../../components/ui/icons"
import {
  ChevronDown,
  CircleHelp,
  Eye,
  Pencil,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react"
import {
  getSelectableRunPermissionModes,
  isSelectableRunPermissionMode,
  RUN_PERMISSION_MODE_LABELS,
} from "../constants"

export function PermissionSelector({
  harness,
  value,
  onChange,
  disabled = false,
  options = getSelectableRunPermissionModes(harness),
  onOpenSettings,
  settingsMeta,
  customHint,
}: {
  harness?: AgentHarness | null
  value: RunPermissionMode
  onChange: (mode: RunPermissionMode) => void
  disabled?: boolean
  options?: readonly RunPermissionMode[]
  onOpenSettings?: () => void
  settingsMeta?: string
  customHint?: string
}) {
  const selectedModeIsSelectable = isSelectableRunPermissionMode(value, harness)
  const selectedLabel = selectedModeIsSelectable
    ? RUN_PERMISSION_MODE_LABELS[value]
    : "Legacy mode - change required"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Permission mode"
          disabled={disabled}
          className="flex h-7 max-w-[150px] items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-[background-color,color] duration-150 ease-out hover:bg-muted/50 hover:text-foreground outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PermissionModeIcon mode={selectedModeIsSelectable ? value : "legacy"} />
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="!min-w-[220px]"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {options.map((mode) => (
          <DropdownMenuItem
            key={mode}
            onSelect={() => onChange(mode)}
            className="justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <PermissionModeIcon mode={mode} />
              <span>{RUN_PERMISSION_MODE_LABELS[mode]}</span>
            </span>
            {value === mode ? <CheckIcon className="ml-auto h-3.5 w-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
        {onOpenSettings ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSettings} className="justify-between gap-3">
              <span className="flex items-center gap-2">
                <SettingsIcon className="h-3.5 w-3.5" />
                Change behavior
              </span>
              {settingsMeta ? (
                <span className="text-[10px] text-muted-foreground">{settingsMeta}</span>
              ) : null}
            </DropdownMenuItem>
          </>
        ) : null}
        {value === "custom" && customHint ? (
          <div className="border-t px-2 py-2 text-[11px] text-muted-foreground">{customHint}</div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PermissionModeIcon({ mode }: { mode: RunPermissionMode | "legacy" }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground"
  if (mode === "read-only") return <Eye className={className} aria-hidden="true" />
  if (mode === "ask-before-edits") return <CircleHelp className={className} aria-hidden="true" />
  if (mode === "auto-edit-project-only") return <Pencil className={className} aria-hidden="true" />
  if (mode === "full-access") return <ShieldCheck className={className} aria-hidden="true" />
  if (mode === "custom") return <SlidersHorizontal className={className} aria-hidden="true" />
  return <TriangleAlert className={className} aria-hidden="true" />
}
