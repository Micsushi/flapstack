import { useMemo, useState } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { AlertCircle, CheckCircle2, Circle, RefreshCw, Search } from "lucide-react"
import type { ProjectRecord, ProjectRecordSnapshot } from "../../../shared/project-records"
import { questionNeedsOwner, questionReviewState } from "../../../shared/project-records"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { trpc, trpcClient } from "../../lib/trpc"
import { retainRecordAction } from "./record-action"
import {
  projectBlockerEntries,
  projectRecordGroups,
  type ProjectRecordEntry,
} from "./project-record-projection"
import { BlockerDetails } from "./blocker-details"

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
  open: "Waiting for your answer",
  answered: "Answer recorded",
  resolved_independently: "AI resolved",
  agent_research: "Agent is checking",
  resolved: "Resolved with evidence",
}
const viewLabels = {
  question: "Questions",
  blocker: "Blockers",
  outcome: "Completed",
  feature: "Checklist",
} as const

export function ProjectRecordsView() {
  const utils = trpc.useUtils()
  const index = trpc.projectRecords.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    retry: false,
  })
  const [chosenProject, setChosenProject] = useState("")
  const [chosenView, setChosenView] = useState<keyof typeof viewLabels>("question")
  const [query, setQuery] = useState("")
  const documents = trpc.useQueries((t) =>
    (index.data?.documents ?? []).map((document) =>
      t.projectRecords.read(
        { path: document.path },
        { retry: false, refetchOnWindowFocus: true, refetchInterval: 15_000 },
      ),
    ),
  )
  const snapshots = documents.flatMap((document) =>
    document.data ? [document.data] : [],
  ) as ProjectRecordSnapshot[]
  const projects = projectRecordGroups(snapshots)
  const selectedProject = projects.find((project) => project.id === chosenProject)
  const views = Object.keys(viewLabels) as (keyof typeof viewLabels)[]
  const selectedView = chosenView
  const [error, setError] = useState<string | null>(null)
  const patch = trpc.projectRecords.patch.useMutation()
  const refresh = async () => {
    await index.refetch()
    await utils.projectRecords.read.invalidate()
  }
  const visibleProjects = selectedProject ? [selectedProject] : projects
  const groups = useMemo(() => {
    const result: {
      key: string
      label: string
      waiting: boolean
      blocker?: boolean
      entries: ProjectRecordEntry[]
    }[] = []
    for (const project of visibleProjects) {
      const matches = (record: ProjectRecord) =>
        JSON.stringify([
          record.id,
          record.title,
          record.description,
          record.context,
          record.cause,
          record.missingPrerequisite,
          record.ownerAction,
          record.affectedWork,
          record.resolutionSteps,
          record.answer,
          record.agentReview,
          record.followUps,
          project.name,
        ])
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      if (selectedView === "question" || selectedView === "blocker") {
        const blockers = projectBlockerEntries(project.entries).filter(({ record }) =>
          matches(record),
        )
        for (const active of [true, false]) {
          if (!active && selectedView === "question") continue
          const items = blockers.filter(({ record }) => (record.state === "blocked") === active)
          if (items.length)
            result.push({
              key: `${project.id}:blockers:${active}`,
              label: `${project.name}: ${active ? "Blockers" : "Resolved and superseded blockers"}`,
              waiting: active,
              blocker: true,
              entries: items,
            })
        }
      }
      const entries = project.entries.filter(({ record }) => {
        const inView =
          selectedView === "question"
            ? record.kind === "question"
            : selectedView === "outcome"
              ? record.kind === "outcome" && record.state === "done"
              : selectedView === "feature" &&
                (record.kind === "feature" ||
                  (record.kind === "outcome" && record.state !== "done"))
        return inView && matches(record)
      })
      if (selectedView === "question") {
        for (const waiting of [true, false]) {
          const items = entries.filter(({ record }) => questionNeedsOwner(record) === waiting)
          if (items.length)
            result.push({
              key: `${project.id}:${waiting}`,
              label: `${project.name}: ${waiting ? "Waiting for your answer" : "Saved answers and agent follow-up"}`,
              waiting,
              entries: items,
            })
        }
      } else {
        const sections = new Map<string, ProjectRecordEntry[]>()
        for (const entry of entries) {
          const group =
            text(entry.record.group) ||
            (entry.record.kind === "outcome"
              ? entry.record.state === "done"
                ? "Completed"
                : "Needs follow-up"
              : "Features")
          sections.set(group, [...(sections.get(group) ?? []), entry])
        }
        for (const [group, items] of sections) {
          result.push({
            key: `${project.id}:${group}`,
            label: `${project.name}: ${group}`,
            waiting: false,
            entries: items,
          })
        }
      }
    }
    // Active blockers remain visible even when there are no unanswered questions.
    return result.sort(
      (a, b) =>
        Number(b.blocker ?? false) - Number(a.blocker ?? false) ||
        Number(b.waiting) - Number(a.waiting),
    )
  }, [visibleProjects, selectedView, query])
  const blockerCount = new Set(
    visibleProjects.flatMap((project) =>
      projectBlockerEntries(project.entries)
        .filter(({ record }) => record.state === "blocked")
        .map(({ record, snapshot }) => `${snapshot.path}:${record.id}`),
    ),
  ).size
  const save = async (
    { record, snapshot: current }: ProjectRecordEntry,
    changes: Record<string, unknown>,
  ) => {
    const path = current.path
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
          disabled={index.isFetching || documents.some((document) => document.isFetching)}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>
      <div className="space-y-3 border-b px-5 py-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            Project
            <select
              value={selectedProject?.id ?? ""}
              onChange={(event) => {
                setChosenProject(event.target.value)
                setError(null)
              }}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2"
              aria-label="Record project"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
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
        {selectedView === "question" && (
          <p className="text-sm text-muted-foreground">
            {selectedProject ? selectedProject.name : "All projects"}: blockers and questions are
            kept separately. Only the affected work waits.
          </p>
        )}
        {projects.length > 0 && (
          <nav className="flex flex-wrap gap-2" aria-label="Project record views">
            {views.map((view) => (
              <Button
                key={view}
                variant={view === selectedView ? "secondary" : "ghost"}
                size="sm"
                aria-current={view === selectedView ? "page" : undefined}
                onClick={() => {
                  setChosenView(view)
                  setError(null)
                }}
              >
                {viewLabels[view]}
                {view === "blocker" && (
                  <span
                    className="ml-1 tabular-nums"
                    aria-label={`${blockerCount} active blockers`}
                  >
                    {blockerCount}
                  </span>
                )}
              </Button>
            ))}
          </nav>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {(error || index.error || documents.some((document) => document.error)) && (
          <p role="alert" className="mb-4 flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error ||
              index.error?.message ||
              "Some project records could not be loaded. Refresh to retry."}
          </p>
        )}
        {index.isLoading ||
        (snapshots.length === 0 && documents.some((document) => document.isLoading)) ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading records…
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query
              ? "No matching records."
              : selectedView === "question"
                ? "No questions or active blockers recorded. Unfinished work remains in Checklist."
                : `No ${viewLabels[selectedView].toLowerCase()} records ${selectedProject ? "for this project" : "across projects"} yet.`}
          </p>
        ) : (
          groups.map(({ key, label, blocker, entries: items }) => (
            <section key={key} className="mb-6" aria-label={label}>
              <h2 className="mb-2 text-sm font-semibold">{label}</h2>
              <ul className="divide-y border-y">
                {items.map((entry) => {
                  const { record, snapshot } = entry
                  return (
                    <li key={`${snapshot.path}:${record.id}`} className="py-3">
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
                            {record.id} ·{" "}
                            {record.state === "answered" && record.answerSource === "owner"
                              ? "Owner answered"
                              : (stateLabel[record.state] ?? record.state)}
                          </p>
                        </div>
                        {record.kind !== "question" && record.kind !== "blocker" && !blocker && (
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={accepted(record.t3)}
                              disabled={patch.isPending}
                              onChange={(event) =>
                                void save(entry, {
                                  t3: {
                                    accepted: event.target.checked,
                                    evidence: ["Owner checked the behavior in Flapstack"],
                                    sourceRevision: snapshot.revision,
                                    acceptedAt: new Date().toISOString(),
                                  },
                                })
                              }
                            />
                            Owner accepted
                          </label>
                        )}
                      </div>
                      {record.kind !== "blocker" && text(record.description || record.context) && (
                        <p className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm">
                          {text(record.description || record.context)}
                        </p>
                      )}
                      {blocker ? (
                        <BlockerDetails
                          record={record}
                          openQuestion={(id) => {
                            setChosenView("question")
                            setChosenProject("")
                            setQuery(id)
                            setError(null)
                          }}
                        />
                      ) : record.kind === "question" ? (
                        <QuestionAnswer
                          record={record}
                          path={snapshot.path}
                          busy={patch.isPending}
                          save={(changes) => save(entry, changes)}
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
                  )
                })}
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
  draftKey,
}: {
  record: ProjectRecord
  path: string
  busy: boolean
  save: (changes: Record<string, unknown>) => Promise<boolean>
  draftKey?: string
}) {
  const [drafts, setDrafts] = useAtom(pendingDraftsAtom)
  const key = draftKey ?? `${path}:${record.id}`
  const reviewState = questionReviewState(record)
  const canAnswer = record.state !== "superseded" && record.state !== "agent_research"
  const draft = drafts[key] ?? text(record.draft)
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [key]: value }))
  const saveDraft = async (submit: boolean) => {
    const success = await save(
      submit ? { answer: draft, answerSource: "owner", draft, state: "answered" } : { draft },
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
    <div className="mt-3 max-w-prose space-y-3">
      {record.state === "agent_research" && (
        <p className="text-sm">The agent is checking this. No answer is needed from you.</p>
      )}
      <p className="text-sm whitespace-pre-wrap break-words">
        <span className="font-medium">AI recommendation: </span>
        {text(record.recommendation) || "No recommendation recorded yet."}
      </p>
      {canAnswer && strings(record.choices).length > 0 && (
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
          <span className="font-medium">
            {record.answerSource === "owner"
              ? "Saved owner answer: "
              : record.answerSource === "ai"
                ? "AI resolution: "
                : "Saved answer (source unverified): "}
          </span>
          {text(record.answer)}
        </p>
      )}
      {(text(record.answer) || record.agentReview) && (
        <div className="space-y-1 text-sm" aria-label={`Agent review for ${record.title}`}>
          <p className="font-medium">
            {reviewState === "unrecorded"
              ? "Agent review not recorded"
              : reviewState === "stale"
                ? "Answer changed. Agent needs to review it again."
                : reviewState === "confirmed"
                  ? "Agent confirmed this answer"
                  : "Agent needs clarification"}
          </p>
          {record.agentReview && (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {reviewState === "stale" && "Previous review: "}
              {record.agentReview.note}
            </p>
          )}
        </div>
      )}
      {canAnswer && (
        <>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Your answer</span>
            <textarea
              aria-label={`Answer to ${record.title}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={16_384}
              rows={3}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void saveDraft(true)}>
              Submit answer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void saveDraft(false)}
            >
              Save draft
            </Button>
          </div>
        </>
      )}
      {!!record.followUps?.length && (
        <section
          className="space-y-4 border-t pt-4"
          aria-label={`Follow-up questions for ${record.title}`}
        >
          <h4 className="text-sm font-semibold">Follow-up questions</h4>
          {record.followUps.map((child) => (
            <div key={child.id} className="space-y-1" role="group" aria-label={child.title}>
              <h5 className="break-words text-sm font-medium">{child.title}</h5>
              <p className="text-xs text-muted-foreground">
                {child.state === "answered" && child.answerSource === "owner"
                  ? "Owner answered"
                  : stateLabel[child.state]}
              </p>
              {child.context && (
                <p className="whitespace-pre-wrap break-words text-sm">{child.context}</p>
              )}
              <QuestionAnswer
                record={{ ...child, kind: "question", history: [] }}
                path={path}
                draftKey={`followUp:${JSON.stringify([path, record.id, child.id])}`}
                busy={busy}
                save={(changes) =>
                  save({
                    followUps: record.followUps!.map((current) =>
                      current.id === child.id ? { ...current, ...changes } : current,
                    ),
                  })
                }
              />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
