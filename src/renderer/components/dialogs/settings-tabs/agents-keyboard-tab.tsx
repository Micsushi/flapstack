"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { RotateCcw } from "lucide-react"
import { customHotkeysAtom, betaKanbanEnabledAtom } from "../../../lib/atoms"
import {
  CATEGORY_LABELS,
  detectConflicts,
  getResolvedHotkey,
  getShortcutAction,
  getShortcutsByCategory,
  hotkeyStringToKeys,
  migrateHotkeysConfig,
  validateHotkey,
  type ShortcutAction,
  type ShortcutActionId,
  type ShortcutCategory,
} from "../../../lib/hotkeys"
import { useHotkeyRecorder } from "../../../lib/hotkeys/use-hotkey-recorder"
import { cn } from "../../../lib/utils"

function ShortcutKeys({ hotkey }: { hotkey: string | null }) {
  if (!hotkey) return <span className="text-xs text-muted-foreground">Not set</span>
  return (
    <span className="inline-flex gap-1" aria-label={hotkey}>
      {hotkeyStringToKeys(hotkey).map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="inline-flex min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
        >
          {key === "cmd"
            ? "⌘"
            : key === "ctrl"
              ? "⌃"
              : key === "opt"
                ? "⌥"
                : key === "shift"
                  ? "⇧"
                  : key}
        </kbd>
      ))}
    </span>
  )
}

function ShortcutRow({
  action,
  config,
  recording,
  error,
  onStart,
  onSave,
  onCancel,
  onReset,
}: {
  action: ShortcutAction
  config: ReturnType<typeof migrateHotkeysConfig>
  recording: boolean
  error: string | null
  onStart: () => void
  onSave: (hotkey: string) => void
  onCancel: () => void
  onReset: () => void
}) {
  const { currentDisplay } = useHotkeyRecorder({
    onRecord: onSave,
    onCancel,
    isRecording: recording,
  })
  const hotkey = getResolvedHotkey(action.id, config)
  const customized = action.editable && config.bindings[action.id] !== undefined

  return (
    <div
      data-settings-id={`keyboard-shortcut-${action.id}`}
      className="rounded-lg border border-border bg-background p-3 outline-none"
      tabIndex={-1}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{action.label}</span>
            {!action.editable && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Fixed
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{action.description}</p>
        </div>
        <button
          type="button"
          disabled={!action.editable}
          onClick={onStart}
          aria-label={`Change ${action.label} shortcut`}
          className={cn(
            "min-w-28 rounded-md border px-3 py-2 text-center",
            recording && "border-primary ring-2 ring-primary/20",
            action.editable ? "hover:bg-muted" : "cursor-not-allowed opacity-70",
          )}
          title={action.reservedReason}
        >
          {recording ? (
            <span className="text-xs text-muted-foreground">{currentDisplay || "Press keys…"}</span>
          ) : (
            <ShortcutKeys hotkey={hotkey} />
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {customized && !recording && (
        <button
          type="button"
          onClick={onReset}
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Reset to platform default
        </button>
      )}
    </div>
  )
}

export function AgentsKeyboardTab() {
  const [storedConfig, setStoredConfig] = useAtom(customHotkeysAtom)
  const betaKanbanEnabled = useAtomValue(betaKanbanEnabledAtom)
  const config = useMemo(() => migrateHotkeysConfig(storedConfig), [storedConfig])
  const [query, setQuery] = useState("")
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null)
  const [errors, setErrors] = useState<Partial<Record<ShortcutActionId, string>>>({})

  useEffect(() => {
    if (
      storedConfig.version !== 2 ||
      JSON.stringify(storedConfig.bindings) !== JSON.stringify(config.bindings)
    ) {
      setStoredConfig(config)
    }
  }, [config, setStoredConfig, storedConfig])

  const categories = useMemo(() => {
    const grouped = getShortcutsByCategory({ betaKanbanEnabled })
    const normalized = query.trim().toLowerCase()
    if (!normalized) return grouped
    return Object.fromEntries(
      Object.entries(grouped).map(([category, actions]) => [
        category,
        actions.filter((action) =>
          `${action.label} ${action.description}`.toLowerCase().includes(normalized),
        ),
      ]),
    ) as Record<ShortcutCategory, ShortcutAction[]>
  }, [betaKanbanEnabled, query])

  const saveBinding = useCallback(
    (actionId: ShortcutActionId, hotkey: string) => {
      const validation = validateHotkey(hotkey)
      if (!validation.valid) {
        setErrors((current) => ({ ...current, [actionId]: validation.reason }))
        setRecordingId(null)
        return
      }
      const candidate = {
        version: 2 as const,
        bindings: { ...config.bindings, [actionId]: validation.hotkey },
      }
      const conflict = detectConflicts(candidate).get(actionId)
      if (conflict) {
        const other = getShortcutAction(conflict.conflictingActionIds[0])
        setErrors((current) => ({
          ...current,
          [actionId]: `${other?.label ?? "Another action"} already uses this shortcut`,
        }))
        setRecordingId(null)
        return
      }
      setStoredConfig(candidate)
      setErrors((current) => ({ ...current, [actionId]: undefined }))
      setRecordingId(null)
    },
    [config.bindings, setStoredConfig],
  )

  const resetBinding = useCallback(
    (actionId: ShortcutActionId) => {
      const { [actionId]: _removed, ...bindings } = config.bindings
      setStoredConfig({ version: 2, bindings })
      setErrors((current) => ({ ...current, [actionId]: undefined }))
    },
    [config.bindings, setStoredConfig],
  )

  const hasOverrides = Object.keys(config.bindings).length > 0

  return (
    <div className="mx-auto max-w-3xl p-6" data-settings-id="settings-tab-keyboard">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Keyboard shortcuts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Changes apply immediately. Fixed menu and hold shortcuts are shown but cannot be edited.
          </p>
        </div>
        {hasOverrides && (
          <button
            type="button"
            onClick={() => setStoredConfig({ version: 2, bindings: {} })}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset all
          </button>
        )}
      </div>

      <label
        className="mt-5 block text-xs font-medium text-muted-foreground"
        htmlFor="shortcut-search"
      >
        Search shortcuts
      </label>
      <input
        id="shortcut-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
        placeholder="Search actions"
      />

      <div className="mt-6 space-y-6">
        {(["general", "workspaces", "agents"] as ShortcutCategory[]).map((category) => {
          const actions = categories[category]
          if (actions.length === 0) return null
          return (
            <section key={category} aria-labelledby={`shortcut-category-${category}`}>
              <h3
                id={`shortcut-category-${category}`}
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {CATEGORY_LABELS[category]}
              </h3>
              <div className="space-y-2">
                {actions.map((action) => (
                  <ShortcutRow
                    key={action.id}
                    action={action}
                    config={config}
                    recording={recordingId === action.id}
                    error={errors[action.id] ?? null}
                    onStart={() => {
                      setErrors((current) => ({ ...current, [action.id]: undefined }))
                      setRecordingId(action.id)
                    }}
                    onSave={(hotkey) => saveBinding(action.id, hotkey)}
                    onCancel={() => setRecordingId(null)}
                    onReset={() => resetBinding(action.id)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
