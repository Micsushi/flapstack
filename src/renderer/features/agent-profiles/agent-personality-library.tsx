import { useEffect, useMemo, useState } from "react"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Textarea } from "../../components/ui/textarea"
import type { AgentPersonalityMetadata } from "../../../shared/agent-personalities"
import { trpc, trpcClient } from "../../lib/trpc"
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
  const [draft, setDraft] = useState<Draft>(() => blankDraft(Boolean(props.projectId)))
  const [status, setStatus] = useState("")
  const [bundle, setBundle] = useState("")
  const [preview, setPreview] = useState<{
    digest: string
    name: string
    unresolvedBase: { personalityId: string; version: number } | null
    baseStatus: "none" | "validated" | "unresolved"
  } | null>(null)
  const [baseResolution, setBaseResolution] = useState<"preserve-validated" | "remove" | null>(null)

  useEffect(() => {
    if (!details.data) return
    setDraft({
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
  }, [details.data])

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
    base: details.data?.metadata.base ?? null,
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
      setSelectedId(result.metadata.id)
      setStatus(`Created ${result.metadata.name} v1.`)
      await list.refetch()
    },
    onError: (error) => setStatus(error.message),
  })
  const update = trpc.agentPersonalities.update.useMutation({
    onSuccess: async (result) => {
      setStatus(`Saved immutable personality v${result.metadata.version}.`)
      await Promise.all([list.refetch(), details.refetch()])
    },
    onError: (error) => setStatus(error.message),
  })
  const archive = trpc.agentPersonalities.archive.useMutation({
    onSuccess: async () => {
      setStatus("Archived for future launches. Historical content is unchanged.")
      await list.refetch()
    },
    onError: (error) => setStatus(error.message),
  })
  const restore = trpc.agentPersonalities.restore.useMutation({
    onSuccess: async () => {
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
      setSelectedId(result.metadata.id)
      setPreview(null)
      setStatus(`Imported ${result.metadata.name} without capabilities or authority.`)
      await list.refetch()
    },
    onError: (error) => setStatus(error.message),
  })

  const newPersonality = () => {
    setSelectedId(null)
    setDraft(blankDraft(Boolean(props.projectId)))
    setStatus("")
  }

  return (
    <div
      className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(12rem,0.65fr)_minmax(0,1.35fr)] lg:grid-cols-[minmax(240px,0.75fr)_minmax(460px,1.5fr)] lg:grid-rows-1"
      data-settings-id="agent-personality-library"
    >
      <aside className="min-h-0 overflow-y-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={props.onBack}>
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
              onClick={() => setSelectedId(item.personalityId)}
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

        <div className="space-y-5">
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
                  }
                }}
              >
                Export selected
              </Button>
              <Button
                variant="outline"
                disabled={!bundle.trim()}
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
                  !preview ||
                  (preview.unresolvedBase !== null &&
                    (baseResolution === null ||
                      (baseResolution === "preserve-validated" &&
                        preview.baseStatus !== "validated")))
                }
                onClick={() =>
                  preview &&
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
              {status || "Ready."}
            </p>
            <div className="flex gap-2">
              {selected && details.data && (
                <Button
                  variant="outline"
                  onClick={() => create.mutate({ ...content(), name: `${draft.name} copy` })}
                >
                  Duplicate
                </Button>
              )}
              {selected && (
                <Button
                  variant="outline"
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
                  create.isPending ||
                  update.isPending ||
                  (draft.scopeType === "project" && !props.projectId)
                }
                onClick={() => {
                  if (!selected) {
                    create.mutate(content())
                    return
                  }
                  update.mutate({
                    ...content(),
                    personalityId: selected.personalityId,
                    expectedVersion: selected.currentVersion,
                  })
                }}
              >
                {selected ? "Save new version" : "Create personality"}
              </Button>
            </div>
          </footer>
        </div>
      </main>
    </div>
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
