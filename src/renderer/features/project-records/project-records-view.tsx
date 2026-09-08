import { useMemo, useState } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { AlertCircle, CheckCircle2, Circle, RefreshCw, Search } from "lucide-react"
import type { ProjectRecord } from "../../../shared/project-records"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { trpc, trpcClient } from "../../lib/trpc"
import { retainRecordAction } from "./record-action"

// Pending text is a recovery draft, never a replacement for the canonical answer.
const pendingDraftsAtom = atomWithStorage<Record<string, string>>("records:pending-drafts", {})
const text = (value: unknown) => (typeof value === "string" ? value : "")
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
const accepted = (value: unknown) =>
  !!value && typeof value === "object" && "accepted" in value && value.accepted === true
const tierEvidence = (value: unknown) =>
  value && typeof value === "object" && "evidence" in value ? strings(value.evidence) : []
const stateLabel: Record<string, string> = {
  planned: "Planned",
  in_progress: "In progress",
  needs_help: "Needs help",
  blocked: "Blocked",
  more_work: "More work",
  done: "Done",
  superseded: "Superseded",
  open: "Open",
  answered: "Answered",
  resolved_independently: "Resolved",
}

export function ProjectRecordsView() {
  const utils = trpc.useUtils()
  const index = trpc.projectRecords.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
    retry: false,
  })
  const [chosenPath, setChosenPath] = useState("")
  const [query, setQuery] = useState("")
  const path = chosenPath || index.data?.documents[0]?.path || ""
  const document = trpc.projectRecords.read.useQuery({ path }, { enabled: !!path, retry: false })
  const current = document.data
  const [error, setError] = useState<string | null>(null)
  const patch = trpc.projectRecords.patch.useMutation()
  const refresh = async () => {
    await index.refetch()
    if (path) await document.refetch()
  }
  const records = current?.document.records ?? []
  const groups = useMemo(() => {
    const result = new Map<string, ProjectRecord[]>()
    for (const record of records) {
      if (
        !`${record.id} ${record.title} ${text(record.description)}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      )
        continue
      const group =
        text(record.group) ||
        (record.kind === "question" ? "Questions" : record.kind === "outcome" ? "Done" : "Features")
      result.set(group, [...(result.get(group) ?? []), record])
    }
    return [...result]
  }, [records, query])
  const save = async (record: ProjectRecord, changes: Record<string, unknown>) => {
    if (!current) return false
    setError(null)
    const input = { path, expectedRevision: current.revision, recordId: record.id, changes }
    try {
      const result = await patch.mutateAsync(input)
      await utils.projectRecords.read.cancel({ path })
      utils.projectRecords.read.setData({ path }, result.snapshot)
      if (result.conflict) {
        setError(
          "This record changed elsewhere. Your draft is kept. Review the current answer before saving again.",
        )
        return false
      }
      retainRecordAction({
        before: current,
        patch: input,
        read: (path) => trpcClient.projectRecords.read.query({ path }),
        write: (patch) => trpcClient.projectRecords.patch.mutate(patch),
        changed: () => {
          void refresh()
        },
      })
      return true
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the record. Your draft is kept.",
      )
      return false
    }
  }

  return (
    <main className="flex h-full min-w-0 flex-col bg-background" aria-labelledby="records-title">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-4">
        <h1 id="records-title" className="mr-auto text-lg font-semibold">
          Project records
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh project records"
          onClick={() => void refresh()}
          disabled={index.isFetching || document.isFetching}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>
      <div className="flex flex-wrap gap-3 border-b px-5 py-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          Document
          <select
            value={path}
            onChange={(event) => {
              setChosenPath(event.target.value)
              setError(null)
            }}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2"
            aria-label="Record document"
          >
            {!index.data?.documents.length && <option value="">No documents</option>}
            {index.data?.documents.map((item) => (
              <option value={item.path} key={item.path}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records"
            aria-label="Search records"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {(error || index.error || document.error) && (
          <p role="alert" className="mb-4 flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error || index.error?.message || document.error?.message}
          </p>
        )}
        {index.isLoading || (!!path && document.isLoading) ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading records…
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query ? "No matching records." : "No records in this document yet."}
          </p>
        ) : (
          groups.map(([group, items]) => (
            <section key={group} className="mb-6" aria-label={group}>
              <h2 className="mb-2 text-sm font-semibold">{group}</h2>
              <ul className="divide-y border-y">
                {items.map((record) => (
                  <li key={record.id} className="py-3">
                    <div className="flex flex-wrap items-start gap-2">
                      {record.state === "done" ? (
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                          aria-label="Done"
                        />
                      ) : (
                        <Circle
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words text-sm font-medium">{record.title}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {record.id} · {stateLabel[record.state] ?? record.state}
                        </p>
                      </div>
                      {record.kind !== "question" && (
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={accepted(record.t3)}
                            disabled={patch.isPending}
                            onChange={(event) =>
                              void save(record, {
                                t3: {
                                  accepted: event.target.checked,
                                  evidence: ["Owner checked the behavior in Flapstack"],
                                  sourceRevision: current?.revision,
                                  acceptedAt: new Date().toISOString(),
                                },
                              })
                            }
                          />
                          Owner accepted
                        </label>
                      )}
                    </div>
                    {text(record.description || record.context) && (
                      <p className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm">
                        {text(record.description || record.context)}
                      </p>
                    )}
                    {record.kind === "question" ? (
                      <QuestionAnswer
                        record={record}
                        path={path}
                        busy={patch.isPending}
                        save={save}
                      />
                    ) : (
                      <details className="mt-2 text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          Evidence and how to try
                        </summary>
                        {(["t2", "t3", "t4"] as const).map((tier) => (
                          <div key={tier} className="mt-2">
                            <p className="font-medium">
                              {tier.toUpperCase()}:{" "}
                              {accepted(record[tier]) ? "Accepted" : "Not accepted"}
                            </p>
                            {tierEvidence(record[tier]).map((item, i) => (
                              <p
                                key={i}
                                className="whitespace-pre-wrap break-words text-muted-foreground"
                              >
                                {item}
                              </p>
                            ))}
                          </div>
                        ))}
                        {["howToTry", "environment", "limitations"].map(
                          (key) =>
                            text(record[key]) && (
                              <p key={key} className="mt-2 whitespace-pre-wrap break-words">
                                {text(record[key])}
                              </p>
                            ),
                        )}
                      </details>
                    )}
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        History ({record.history.length})
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words font-sans">
                        {JSON.stringify(record.history, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  )
}

function QuestionAnswer({
  record,
  path,
  busy,
  save,
}: {
  record: ProjectRecord
  path: string
  busy: boolean
  save: (record: ProjectRecord, changes: Record<string, unknown>) => Promise<boolean>
}) {
  const [drafts, setDrafts] = useAtom(pendingDraftsAtom)
  const key = `${path}:${record.id}`
  const draft = drafts[key] ?? text(record.draft)
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [key]: value }))
  const saveDraft = async (submit: boolean) => {
    const success = await save(
      record,
      submit ? { answer: draft, draft, state: "answered" } : { draft },
    )
    if (success)
      setDrafts((current) => {
        if (current[key] !== draft) return current
        const next = { ...current }
        delete next[key]
        return next
      })
  }
  return (
    <div className="mt-3 max-w-prose space-y-2">
      {text(record.recommendation) && (
        <p className="text-sm text-muted-foreground">Suggested: {text(record.recommendation)}</p>
      )}
      {strings(record.choices).length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={`Choices for ${record.title}`}
        >
          {strings(record.choices).map((choice) => (
            <Button
              key={choice}
              variant={draft === choice ? "secondary" : "outline"}
              size="sm"
              onClick={() => setDraft(choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      )}
      {text(record.answer) && (
        <p className="whitespace-pre-wrap break-words text-sm">
          Current answer: {text(record.answer)}
        </p>
      )}
      <textarea
        aria-label={`Answer to ${record.title}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={16_384}
        rows={3}
        className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void saveDraft(true)}>
          Submit answer
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveDraft(false)}>
          Save draft
        </Button>
      </div>
    </div>
  )
}
