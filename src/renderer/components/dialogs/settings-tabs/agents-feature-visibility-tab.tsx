import { useSetAtom } from "jotai"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  FEATURE_VISIBILITY_REGISTRY,
  previewVisibilityPreset,
  type FeatureVisibilityPreset,
} from "../../../../shared/feature-visibility"
import { featureVisibilityGuideRerunAtom } from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"

export function AgentsFeatureVisibilityTab() {
  const query = trpc.featureVisibility.get.useQuery({ profileKind: "existing" })
  const applyChanges = trpc.featureVisibility.applyChanges.useMutation()
  const utils = trpc.useUtils()
  const rerunGuide = useSetAtom(featureVisibilityGuideRerunAtom)
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null)
  const [preset, setPreset] = useState<FeatureVisibilityPreset>("standard")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!query.data) return
    setDraft({ ...query.data.visibility })
    setPreset(query.data.preset ?? "standard")
  }, [query.data])

  const changes = useMemo(() => {
    if (!query.data || !draft) return []
    return FEATURE_VISIBILITY_REGISTRY.flatMap((feature) => {
      const before = query.data.visibility[feature.id] ?? true
      const after = draft[feature.id] ?? true
      return before === after ? [] : [{ id: feature.id, before, after }]
    })
  }, [draft, query.data])

  const selectPreset = (nextPreset: FeatureVisibilityPreset) => {
    if (!query.data) return
    const preview = previewVisibilityPreset(query.data.visibility, nextPreset, {
      preserveUnknown: true,
      existingUser: query.data.status === "upgrade-preserved",
    })
    setPreset(nextPreset)
    setDraft(preview.result)
    setError(null)
  }

  const save = async () => {
    if (!query.data || !draft) return
    setError(null)
    try {
      const applied = await applyChanges.mutateAsync({
        profileKind: "existing",
        expectedRevision: query.data.revision,
        preset,
        visibility: draft,
      })
      utils.featureVisibility.get.setData({ profileKind: "existing" }, applied)
      toast.success("Feature visibility updated")
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Feature visibility could not be saved."
      setError(message)
      await query.refetch()
    }
  }

  if (query.isLoading || !draft) {
    return <div className="p-6 text-sm text-muted-foreground">Loading feature visibility…</div>
  }

  if (query.isError || !query.data) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Feature Visibility</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Preferences could not be read. Every feature remains visible and the original file was
          left untouched.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-7 p-6">
      <header>
        <h1 className="text-lg font-semibold">Feature Visibility</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Choose which optional surfaces appear in navigation. This never changes permissions,
          starts services, or deletes data.
        </p>
      </header>

      <section data-settings-id="feature-visibility-presets">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Visibility preset</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Selecting a preset only prepares a reviewable draft.
            </p>
          </div>
          <Button variant="outline" onClick={() => rerunGuide(true)}>
            Run setup guide again
          </Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(["focused", "standard", "complete"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={preset === option}
              onClick={() => selectPreset(option)}
              className="rounded-xl border border-border px-4 py-3 text-left text-sm capitalize outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/5"
            >
              <span className="font-medium">{option}</span>
              <span className="mt-1 block text-xs normal-case leading-5 text-muted-foreground">
                {option === "focused"
                  ? "Core work with advanced surfaces tucked away."
                  : option === "standard"
                    ? "Balanced access for everyday multi-agent work."
                    : "Every optional surface visible from the start."}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3" data-settings-id="feature-visibility-controls">
        <div>
          <h2 className="text-sm font-semibold">Optional surfaces</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Hidden surfaces remain searchable here and keep their data and valid direct entry
            points.
          </p>
        </div>
        {FEATURE_VISIBILITY_REGISTRY.map((feature) => (
          <div
            key={feature.id}
            data-settings-id={`feature-visibility-${feature.id}`}
            className="flex items-start justify-between gap-5 rounded-xl border border-border p-4"
          >
            <div>
              <h3 className="text-sm font-medium">{feature.label}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {feature.explanation.purpose}
              </p>
              <dl className="mt-2 space-y-1 text-[11px] leading-4 text-muted-foreground">
                <div>
                  <dt className="inline font-medium text-foreground/80">Why: </dt>
                  <dd className="inline">{feature.explanation.why}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-foreground/80">Requires: </dt>
                  <dd className="inline">{feature.explanation.prerequisites}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-foreground/80">Authority: </dt>
                  <dd className="inline">{feature.explanation.authority}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-foreground/80">Re-enable: </dt>
                  <dd className="inline">{feature.explanation.reenable}</dd>
                </div>
              </dl>
            </div>
            <Switch
              aria-label={`Show ${feature.label}`}
              checked={draft[feature.id] ?? true}
              onCheckedChange={(visible) => {
                setDraft((current) => (current ? { ...current, [feature.id]: visible } : current))
                setError(null)
              }}
            />
          </div>
        ))}
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background py-4">
        <p className="text-xs text-muted-foreground">
          {changes.length === 0
            ? "No visibility changes."
            : `${changes.length} visibility change${changes.length === 1 ? "" : "s"} ready to apply.`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={changes.length === 0}
            onClick={() => {
              setDraft({ ...query.data.visibility })
              setPreset(query.data.preset ?? "standard")
              setError(null)
            }}
          >
            Cancel draft
          </Button>
          <Button
            disabled={changes.length === 0 || applyChanges.isPending}
            onClick={() => void save()}
          >
            {applyChanges.isPending ? "Applying…" : "Apply changes"}
          </Button>
        </div>
      </footer>
    </div>
  )
}
