import { invalidateAppActionRedo } from "../../lib/app-action-history"
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Textarea } from "../../components/ui/textarea"
import type { AgentPersonalityMetadata } from "../../../shared/agent-personalities"
import { trpc, trpcClient } from "../../lib/trpc"
import { useProfileActionHistory } from "./use-profile-action-history"
import { handleListboxKeyDown } from "../../lib/listbox-keyboard"

type Draft = {
  name: string
  scopeType: "user" | "project"
  tone: AgentPersonalityMetadata["traits"]["tone"]
  verbosity: AgentPersonalityMetadata["traits"]["verbosity"]
  formatting: AgentPersonalityMetadata["traits"]["formatting"]
  responseStructure: string
  labels: string
  color: string
  body: string
}

export function AgentPersonalityLibrary(props: { projectId: string; onBack: () => void }) {
  const utils = trpc.useUtils()
  const recordHistory = useProfileActionHistory()
  const list = trpc.agentPersonalities.list.useQuery({
    projectId: props.projectId || undefined,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = list.data?.find((item) => item.personalityId === selectedId) ?? null
  const details = trpc.agentPersonalities.get.useQuery(
    {
      ref: {
        personalityId: selected?.personalityId ?? "00000000-0000-4000-8000-000000000000",
        version: selected?.currentVersion ?? 1,
      },
      scope: selected?.scope ?? { type: "user", projectId: null },
      allowArchivedHistory: true,
    },
    { enabled: Boolean(selected) },
  )
  const [draft, replaceDraft] = useState<Draft>(() => blankDraft(Boolean(props.projectId)))
  const editorElement = useRef<HTMLFieldSetElement>(null)
  const lastAction = useRef<HTMLButtonElement | null>(null)
  const edited = useRef(false)
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  const setDraft: Dispatch<SetStateAction<Draft>> = (value) => {
    edited.current = true
    setStatus("")
    replaceDraft(value)
    setPreview(null)
  }
  const leaveDraft = () => !edited.current || window.confirm("Discard unsaved personality edits?")
  const resetEditor = () => {
    edited.current = false
    setLoadedVersion(null)
    setStatus("")
    setPreview(null)
  }
  const readError = list.error ?? details.error
  const unavailable =
    list.isLoading ||
    Boolean(list.error) ||
    (Boolean(selectedId) &&
      (!selected ||
        details.isLoading ||
        Boolean(details.error) ||
        details.data?.metadata.id !== selectedId ||
        details.data?.metadata.version !== selected?.currentVersion ||
        loadedVersion === null))
  const retryReads = async () => {
    await list.refetch()
    if (selected) await details.refetch()
  }
  const [status, setStatus] = useState("")
  const [bundle, setBundle] = useState("")
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<{
    digest: string
    name: string
    unresolvedBase: { personalityId: string; version: number } | null
    baseStatus: "none" | "validated" | "unresolved"
  } | null>(null)
  const [baseResolution, setBaseResolution] = useState<"preserve-validated" | "remove" | null>(null)

  useEffect(() => {
    if (
      !selectedId ||
      details.data?.metadata.id !== selectedId ||
      details.data.metadata.version !== selected?.currentVersion ||
      edited.current
    )
      return
    setLoadedVersion(details.data.metadata.version)
    replaceDraft({
      name: details.data.metadata.name,
      scopeType: details.data.metadata.scope.type,
      tone: details.data.metadata.traits.tone,
      verbosity: details.data.metadata.traits.verbosity,
      formatting: details.data.metadata.traits.formatting,
      responseStructure: details.data.metadata.traits.responseStructure,
      labels: details.data.metadata.traits.labels.join(", "),
      color: details.data.metadata.traits.color ?? "",
      body: details.data.body,
    })
  }, [details.data, selectedId, selected?.currentVersion, loadedVersion])

  useEffect(
    () =>
      window.desktopApi.onAgentPersonalitiesChanged(() => {
        void utils.agentPersonalities.list.invalidate()
        void utils.agentPersonalities.get.invalidate()
      }),
    [utils.agentPersonalities.get, utils.agentPersonalities.list],
  )

  const scope = useMemo(
    () =>
      draft.scopeType === "project"
        ? ({ type: "project", projectId: props.projectId } as const)
        : ({ type: "user", projectId: null } as const),
    [draft.scopeType, props.projectId],
  )
  const content = () => ({
    name: draft.name,
    scope,
    base: selected && details.data?.metadata.id === selectedId ? details.data.metadata.base : null,
    traits: {
      tone: draft.tone,
      verbosity: draft.verbosity,
      formatting: draft.formatting,
      responseStructure: draft.responseStructure,
      labels: draft.labels
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
      color: draft.color.trim() || null,
    },
    body: draft.body,
  })

  const create = trpc.agentPersonalities.create.useMutation({
    onSuccess: async (result) => {
      invalidateAppActionRedo()
      edited.current = false
      setSelectedId(result.metadata.id)
      setStatus(`Created ${result.metadata.name} v1.`)
      await list.refetch()
    },
    onError: (error) => setStatus(error.message),
  })
  const update = trpc.agentPersonalities.update.useMutation({
    onSuccess: async (result) => {
      recordHistory("personalities", result, "Edit Personality")
      edited.current = false
      setStatus(`Saved immutable personality v${result.metadata.version}.`)
      await Promise.all([list.refetch(), details.refetch()])
    },
    onError: (error) => setStatus(error.message),
  })
  const archive = trpc.agentPersonalities.archive.useMutation({
    onSuccess: async (result) => {
      recordHistory("personalities", result, "Archive Personality")
      setStatus("Archived for future launches. Historical content is unchanged.")
      await list.refetch()
    },
    onError: (error) => setStatus(error.message),
  })
  const restore = trpc.agentPersonalities.restore.useMutation({
    onSuccess: async (result) => {
      recordHistory("personalities", result, "Restore Personality")
      setStatus("Restored personality.")
      await list.refetch()
    },
    onError: (error) => setStatus(error.message),
  })
  const previewImport = trpc.agentPersonalities.previewImport.useMutation({
    onSuccess: (result) => {
      setPreview({
        digest: result.digest,
        name: result.metadata.name,
        unresolvedBase: result.unresolvedBase,
        baseStatus: result.baseStatus,
      })
      setBaseResolution(result.baseStatus === "none" ? null : "preserve-validated")
      setStatus("Import parsed as untrusted presentation text. Review before creating a copy.")
    },
    onError: (error) => setStatus(error.message),
  })
  const confirmImport = trpc.agentPersonalities.confirmImport.useMutation({
    onSuccess: async (result) => {
      invalidateAppActionRedo()
      edited.current = false
      setSelectedId(result.metadata.id)
      setPreview(null)
      setStatus(`Imported ${result.metadata.name} without capabilities or authority.`)
      await list.refetch()
    },
    onError: (error) => setStatus(error.message),
  })

  const busy =
    exporting ||
    create.isPending ||
    update.isPending ||
    archive.isPending ||
    restore.isPending ||
    previewImport.isPending ||
    confirmImport.isPending
  useEffect(() => {
    if (busy) return
    const action = lastAction.current
    if (action && document.activeElement === document.body) {
      if (action.isConnected && !action.matches(":disabled")) action.focus()
      else editorElement.current?.querySelector<HTMLElement>("main input:not(:disabled)")?.focus()
    }
    lastAction.current = null
  }, [busy])

  const newPersonality = () => {
    if (!leaveDraft()) return
    resetEditor()
    setSelectedId(null)
    replaceDraft(blankDraft(Boolean(props.projectId)))
    setStatus("")
  }

  return (
    <fieldset
      ref={editorElement}
      onClickCapture={(event) => {
        if (event.target instanceof Element) lastAction.current = event.target.closest("button")
      }}
      disabled={busy}
      aria-busy={busy}
      aria-label="Agent Personality Library"
      className="min-w-0 grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(12rem,0.65fr)_minmax(0,1.35fr)] lg:grid-cols-[minmax(240px,0.75fr)_minmax(460px,1.5fr)] lg:grid-rows-1"
      data-settings-id="agent-personality-library"
    >
      <aside className="min-h-0 overflow-y-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              if (
                (!edited.current && !bundle.trim()) ||
                window.confirm(
                  "Leave the library and discard unsaved edits and import/export text?",
                )
              )
                props.onBack()
            }}
          >
            Profiles
          </Button>
          <Button variant="outline" onClick={newPersonality}>
            New
          </Button>
        </div>
        <h2 className="mb-1 text-sm font-semibold">Personality Library</h2>
        <p className="mb-3 text-xs leading-5 text-muted-foreground">
          Versioned Markdown presentation only. No tools, permissions, skills, memory, or Runtime.
        </p>
        {!list.isLoading && !list.error && list.data?.length === 0 && (
          <p role="status" className="text-sm">
            No personalities yet. Create one or preview an import.
          </p>
        )}
        <div
          className="space-y-1"
          role="listbox"
          aria-label="Agent Personalities"
          aria-orientation="vertical"
          onKeyDown={handleListboxKeyDown}
        >
          {list.data?.map((item, index) => (
            <button
              key={item.personalityId}
              type="button"
              role="option"
              aria-selected={selectedId === item.personalityId}
              tabIndex={selectedId === item.personalityId || (!selectedId && index === 0) ? 0 : -1}
              onClick={() => {
                if (item.personalityId !== selectedId && leaveDraft()) {
                  resetEditor()
                  setSelectedId(item.personalityId)
                }
              }}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                selectedId === item.personalityId
                  ? "border-primary bg-primary/5"
                  : "border-transparent hover:bg-foreground/5"
              }`}
            >
              <span className="block font-medium">{item.name}</span>
              <span className="block text-xs text-muted-foreground">
                {item.scope.type} · v{item.currentVersion} · {item.provenance.kind}
                {item.archivedAt ? " · archived" : ""}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto p-6">
        {readError && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">
              Personality data unavailable: {readError.message}
            </p>
            <Button
              variant="outline"
              disabled={list.isFetching || details.isFetching}
              onClick={() => void retryReads()}
            >
              Retry reads
            </Button>
          </div>
        )}
        {selectedId &&
          (!selected || (loadedVersion !== null && loadedVersion !== selected.currentVersion)) && (
            <p role="status" className="mb-3 text-sm">
              Your draft is kept. The saved personality changed. Reload the saved version before
              saving.
            </p>
          )}
        {selected && details.data && (
          <Button
            variant="outline"
            className="mb-3"
            onClick={() => {
              if (!leaveDraft()) return
              resetEditor()
              void retryReads()
            }}
          >
            Reload saved version
          </Button>
        )}
        <header className="mb-5">
          <h3 className="text-base font-semibold">
            {selected ? `${selected.name} v${selected.currentVersion}` : "New Personality"}
          </h3>
          <p className="text-sm text-muted-foreground">
            Markdown is untrusted style guidance and cannot grant capability.
          </p>
          {details.data && (
            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
              {details.data.metadata.id}@{details.data.metadata.version} · {details.data.digest}
            </p>
          )}
        </header>

        <fieldset
          className="min-w-0 space-y-5"
          disabled={
            Boolean(selectedId) && (details.isLoading || details.data?.metadata.id !== selectedId)
          }
        >
          <section className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field label="Scope">
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={draft.scopeType}
                disabled={Boolean(selected)}
                onChange={(event) =>
                  setDraft({ ...draft, scopeType: event.target.value as Draft["scopeType"] })
                }
              >
                <option value="user">User</option>
                <option value="project" disabled={!props.projectId}>
                  Project
                </option>
              </select>
            </Field>
            <TraitSelect
              label="Tone"
              value={draft.tone}
              options={["neutral", "direct", "warm", "formal", "playful"]}
              onChange={(tone) => setDraft({ ...draft, tone })}
            />
            <TraitSelect
              label="Verbosity"
              value={draft.verbosity}
              options={["terse", "balanced", "detailed"]}
              onChange={(verbosity) => setDraft({ ...draft, verbosity })}
            />
            <TraitSelect
              label="Formatting"
              value={draft.formatting}
              options={["plain", "structured", "markdown"]}
              onChange={(formatting) => setDraft({ ...draft, formatting })}
            />
            <Field label="Color">
              <Input
                placeholder="#4f46e5"
                value={draft.color}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
              />
            </Field>
            <Field label="Response structure" wide>
              <Input
                value={draft.responseStructure}
                onChange={(event) => setDraft({ ...draft, responseStructure: event.target.value })}
              />
            </Field>
            <Field label="Labels (comma separated)" wide>
              <Input
                value={draft.labels}
                onChange={(event) => setDraft({ ...draft, labels: event.target.value })}
              />
            </Field>
            <Field label="Personality Markdown" wide>
              <Textarea
                className="min-h-56 font-mono text-xs"
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
            </Field>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h4 className="text-sm font-semibold">Local import and export</h4>
              <p className="text-xs text-muted-foreground">
                Imports are secret-scanned, non-executable, untrusted, and copied to a new stable
                ID. External base references are never silently substituted.
              </p>
            </div>
            <Textarea
              className="min-h-36 font-mono text-xs"
              aria-label="Personality export or import bundle"
              value={bundle}
              onChange={(event) => {
                setBundle(event.target.value)
                setPreview(null)
              }}
              placeholder="Exported personality Markdown or a file to preview"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!selected}
                onClick={async () => {
                  if (!selected) return
                  setExporting(true)
                  try {
                    const result = await trpcClient.agentPersonalities.exportMarkdown.query({
                      ref: {
                        personalityId: selected.personalityId,
                        version: selected.currentVersion,
                      },
                      scope: selected.scope,
                    })
                    setBundle(result.source)
                    setStatus("Exact immutable personality version exported.")
                  } catch (error) {
                    setStatus(error instanceof Error ? error.message : String(error))
                  } finally {
                    setExporting(false)
                  }
                }}
              >
                Export selected
              </Button>
              <Button
                variant="outline"
                disabled={!bundle.trim() || unavailable}
                onClick={() =>
                  previewImport.mutate({
                    source: bundle,
                    sourceLabel: "Profile Studio paste",
                    scope,
                  })
                }
              >
                Preview import
              </Button>
              <Button
                disabled={
                  unavailable ||
                  !preview ||
                  (preview.unresolvedBase !== null &&
                    (baseResolution === null ||
                      (baseResolution === "preserve-validated" &&
                        preview.baseStatus !== "validated")))
                }
                onClick={() =>
                  preview &&
                  leaveDraft() &&
                  confirmImport.mutate({
                    source: bundle,
                    sourceLabel: "Profile Studio paste",
                    expectedDigest: preview.digest,
                    scope,
                    baseResolution: preview.unresolvedBase
                      ? (baseResolution ?? undefined)
                      : undefined,
                  })
                }
              >
                Confirm untrusted copy
              </Button>
            </div>
            {preview && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {preview.name} · {preview.digest}
                {preview.unresolvedBase
                  ? ` · exact base ${preview.unresolvedBase.personalityId}@${preview.unresolvedBase.version} is ${preview.baseStatus}`
                  : ""}
              </p>
            )}
            {preview?.unresolvedBase && (
              <label className="text-xs">
                Base handling
                <select
                  className="ml-2 h-8 rounded-md border border-input bg-background px-2"
                  value={baseResolution ?? ""}
                  onChange={(event) =>
                    setBaseResolution(event.target.value as "preserve-validated" | "remove")
                  }
                >
                  <option value="">Choose explicitly</option>
                  <option value="preserve-validated" disabled={preview.baseStatus !== "validated"}>
                    Preserve validated exact base
                  </option>
                  <option value="remove">Import without base</option>
                </select>
              </label>
            )}
          </section>

          <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {busy ? "Working… Your draft is kept." : status || "Ready."}
            </p>
            <div className="flex gap-2">
              {selected && details.data && (
                <Button
                  variant="outline"
                  disabled={unavailable || loadedVersion !== selected.currentVersion}
                  onClick={() => create.mutate({ ...content(), name: `${draft.name} copy` })}
                >
                  Duplicate
                </Button>
              )}
              {selected && (
                <Button
                  variant="outline"
                  disabled={unavailable}
                  onClick={() =>
                    (selected.archivedAt ? restore : archive).mutate({
                      personalityId: selected.personalityId,
                      expectedVersion: selected.currentVersion,
                      scope: selected.scope,
                    })
                  }
                >
                  {selected.archivedAt ? "Restore" : "Archive"}
                </Button>
              )}
              <Button
                disabled={
                  busy ||
                  unavailable ||
                  Boolean(selected?.archivedAt) ||
                  (Boolean(selected) && loadedVersion !== selected?.currentVersion) ||
                  (draft.scopeType === "project" && !props.projectId)
                }
                onClick={() => {
                  if (busy || unavailable) return
                  if (!selectedId) {
                    create.mutate(content())
                    return
                  }
                  if (!selected || loadedVersion === null) return
                  update.mutate({
                    ...content(),
                    personalityId: selected.personalityId,
                    expectedVersion: loadedVersion,
                  })
                }}
              >
                {selected ? "Save new version" : "Create personality"}
              </Button>
            </div>
          </footer>
        </fieldset>
      </main>
    </fieldset>
  )
}

function blankDraft(hasProject: boolean): Draft {
  return {
    name: "",
    scopeType: hasProject ? "project" : "user",
    tone: "direct",
    verbosity: "balanced",
    formatting: "markdown",
    responseStructure: "Lead with the outcome, then evidence and blockers.",
    labels: "",
    color: "",
    body: "",
  }
}

function Field(props: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={props.wide ? "sm:col-span-2" : undefined}>
      <span className="mb-1 block text-xs font-medium">{props.label}</span>
      {props.children}
    </label>
  )
}

function TraitSelect<T extends string>(props: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <Field label={props.label}>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  )
}
