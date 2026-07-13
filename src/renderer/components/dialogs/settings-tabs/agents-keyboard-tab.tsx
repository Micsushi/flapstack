"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAtom } from "jotai"
import { RotateCcw } from "lucide-react"
import { customHotkeysAtom, recordingHotkeyForActionAtom } from "../../../lib/atoms"
import {
  CATEGORY_LABELS,
  getResolvedHotkey,
  getShortcutPlatform,
  getShortcutsByCategory,
  hotkeyStringToKeys,
  keyToDisplay,
  mutateShortcutConfig,
  parseHotkeysConfig,
  type ShortcutAction,
  type ShortcutActionId,
  type ShortcutCategory,
  type CustomHotkeysConfig,
} from "../../../lib/hotkeys"
import { useHotkeyRecorder } from "../../../lib/hotkeys/use-hotkey-recorder"
import { cn } from "../../../lib/utils"

function ShortcutKeys({ hotkey }: { hotkey: string | null }) {
  if (!hotkey) return <span className="text-xs text-muted-foreground">Not set</span>
  const platform = getShortcutPlatform()
  return (
    <span className="inline-flex gap-1" aria-label={hotkey}>
      {hotkeyStringToKeys(hotkey).map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="inline-flex min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
        >
          {keyToDisplay(key, platform)}
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
  config: CustomHotkeysConfig
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
  const platform = getShortcutPlatform()
  const parsedConfig = useMemo(
    () => parseHotkeysConfig(storedConfig, platform),
    [platform, storedConfig],
  )
  const config = parsedConfig.config
  const [query, setQuery] = useState("")
  const [recordingId, setRecordingId] = useAtom(recordingHotkeyForActionAtom)
  const [errors, setErrors] = useState<Partial<Record<ShortcutActionId, string>>>({})
  const [migrationDiagnostics, setMigrationDiagnostics] = useState<string[]>([])

  useEffect(() => {
    if (
      storedConfig.version !== 2 ||
      JSON.stringify(storedConfig.bindings) !== JSON.stringify(config.bindings)
    ) {
      setStoredConfig(config)
    }
    if (parsedConfig.diagnostics.length > 0) {
      setMigrationDiagnostics(
        parsedConfig.diagnostics.map((item) => `${item.actionId}: ${item.reason}`),
      )
    }
  }, [config, parsedConfig.diagnostics, setStoredConfig, storedConfig])

  const categories = useMemo(() => {
    const grouped = getShortcutsByCategory({ platform })
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
  }, [platform, query])

  const saveBinding = useCallback(
    (actionId: ShortcutActionId, hotkey: string) => {
      const result = mutateShortcutConfig(config, { operation: "set", actionId, hotkey }, platform)
      if (!result.ok) {
        setErrors((current) => ({
          ...current,
          [actionId]: result.error,
        }))
        setRecordingId(null)
        return
      }
      setStoredConfig(result.config)
      setErrors((current) => ({ ...current, [actionId]: undefined }))
      setRecordingId(null)
    },
    [config, platform, setRecordingId, setStoredConfig],
  )

  const resetBinding = useCallback(
    (actionId: ShortcutActionId) => {
      const result = mutateShortcutConfig(config, { operation: "reset", actionId }, platform)
      if (!result.ok) return
      setStoredConfig(result.config)
      setErrors((current) => ({ ...current, [actionId]: undefined }))
    },
    [config, platform, setStoredConfig],
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

      {migrationDiagnostics.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground" role="status">
          Invalid saved shortcuts were ignored and restored to safe defaults.
        </p>
      )}

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
