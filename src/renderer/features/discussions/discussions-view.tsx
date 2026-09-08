import { useState } from "react"
import type { DiscussionScope, DiscussionTopic } from "../../../shared/discussions"
import { Button } from "../../components/ui/button"
import { cn } from "../../lib/utils"
import { DiscussionAssist } from "./discussion-assist"
import { DiscussionQuestion } from "./discussion-question"
import { DiscussionAnnotationThread } from "./discussion-annotation-thread"
import { discussionDraftKey, useDiscussionDraft, useDiscussions } from "./use-discussions"
import "./discussions.css"

const statuses = {
  "more-work": "More work",
  "needs-help": "Needs help",
  blocked: "Blocked",
  done: "Done",
} as const
export function DiscussionsView({
  scope,
  onOpenRecords,
}: {
  scope: DiscussionScope
  onOpenRecords?: () => void
}) {
  return (
    <DiscussionsContent key={JSON.stringify(scope)} scope={scope} onOpenRecords={onOpenRecords} />
  )
}
function DiscussionsContent({
  scope,
  onOpenRecords,
}: {
  scope: DiscussionScope
  onOpenRecords?: () => void
}) {
  const store = useDiscussions(scope)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [showCapture, setShowCapture] = useState(false)
  const [draft, setDraft, storageError] = useDiscussionDraft(discussionDraftKey(scope, "capture"), {
    title: "",
    body: "",
    kind: "note" as "note" | "fix" | "idea",
  })
  const topics = store.topics.filter(
    (topic) =>
      !topic.archived &&
      `${topic.title} ${topic.summary}`.toLowerCase().includes(filter.toLowerCase()),
  )
  const selected = store.topics.find((topic) => topic.id === selectedId && !topic.archived)
  const capture = async () => {
    const topic = await store.create(draft.title, draft.body, draft.kind)
    if (topic) {
      setDraft({ title: "", body: "", kind: "note" })
      setSelectedId(topic.id)
      setShowCapture(false)
    }
  }
  return (
    <main
      className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"
      aria-labelledby="discussions-heading"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h1 id="discussions-heading" className="text-xl font-semibold">
            Topics
          </h1>
          <p className="text-xs text-muted-foreground break-all">
            Project {scope.projectId} ·{" "}
            {scope.chatId ? `Chat ${scope.chatId}` : "All project discussion"} · Host {scope.hostId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenRecords && (
            <Button variant="outline" onClick={onOpenRecords}>
              Project records
            </Button>
          )}
          <Button onClick={() => setShowCapture((value) => !value)} aria-expanded={showCapture}>
            Capture thoughts
          </Button>
        </div>
      </header>
      {store.error && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {store.error}{" "}
          <button className="underline" onClick={() => void store.refresh()}>
            Refresh
          </button>
        </p>
      )}
      {showCapture && (
        <form
          className="space-y-3 border-b p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void capture()
          }}
        >
          <label className="block text-sm space-y-1">
            <span>Topic name</span>
            <input
              className="discussion-field"
              required
              maxLength={200}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="block text-sm space-y-1">
            <span>Thoughts, fixes, and future ideas</span>
            <textarea
              className="discussion-field"
              required
              rows={4}
              maxLength={16384}
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-2 text-sm">
              Capture as
              <select
                className="discussion-field"
                value={draft.kind}
                onChange={(event) =>
                  setDraft({ ...draft, kind: event.target.value as typeof draft.kind })
                }
              >
                <option value="note">Mixed thoughts / note</option>
                <option value="fix">Fix</option>
                <option value="idea">Future idea</option>
              </select>
            </label>
            <Button
              type="submit"
              disabled={store.busy || !draft.title.trim() || !draft.body.trim()}
            >
              Save capture
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowCapture(false)}>
              Close
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Original text stays intact. Capturing does not start work.
          </p>
          {storageError && (
            <p role="alert">Draft storage unavailable. Save capture before leaving.</p>
          )}
        </form>
      )}
      <div className="discussions-layout" data-detail={Boolean(selected)}>
        <nav className="discussions-list" aria-label="Discussion topics">
          <div className="p-3">
            <label className="sr-only" htmlFor="topic-filter">
              Find topics
            </label>
            <input
              id="topic-filter"
              className="discussion-field text-sm"
              placeholder="Find topics"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {store.loading ? (
            <p className="p-4 text-sm" role="status">
              Loading topics…
            </p>
          ) : topics.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {filter ? "No matching topics." : "Capture a thought to start a discussion."}
            </p>
          ) : (
            <ul>
              {topics.map((topic) => (
                <li key={topic.id}>
                  <button
                    className={cn(
                      "w-full border-b p-4 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                      selectedId === topic.id && "bg-accent",
                    )}
                    aria-current={selectedId === topic.id ? "page" : undefined}
                    onClick={() => setSelectedId(topic.id)}
                  >
                    <span className="block font-medium discussion-copy">{topic.title}</span>
                    <span className="mt-1 block text-sm text-muted-foreground discussion-copy">
                      {topic.summary || "No summary yet"}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span
                        className={
                          topic.status === "blocked" ? "text-destructive" : "text-muted-foreground"
                        }
                      >
                        {statuses[topic.status]}
                      </span>
                      <span>{topic.read ? "Read" : "Unread"}</span>
                      {topic.questions.some((question) => !question.answers.length) && (
                        <span>Answer requested</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {store.hasMore && (
            <Button
              className="m-3"
              variant="outline"
              disabled={store.loadingMore}
              onClick={() => void store.loadMore()}
            >
              Load more topics
            </Button>
          )}
        </nav>
        <div className="discussions-detail">
          {selected ? (
            <TopicDetail
              key={selected.id}
              topic={selected}
              scope={scope}
              store={store}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose a topic to read its current summary, questions, and source notes.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
function TopicDetail({
  topic,
  scope,
  store,
  onBack,
}: {
  topic: DiscussionTopic
  scope: DiscussionScope
  store: ReturnType<typeof useDiscussions>
  onBack: () => void
}) {
  const [editingSummary, setEditingSummary] = useState(false)
  const [summary, setSummary, summaryError] = useDiscussionDraft(
    discussionDraftKey(scope, `summary:${topic.id}`),
    topic.summary,
  )
  const [draft, setDraft] = useDiscussionDraft(discussionDraftKey(scope, `reply:${topic.id}`), "")
  const [question, setQuestion, questionError] = useDiscussionDraft(
    discussionDraftKey(scope, `question:${topic.id}`),
    "",
  )
  const [choices, setChoices, choicesError] = useDiscussionDraft(
    discussionDraftKey(scope, `choices:${topic.id}`),
    "",
  )
  return (
    <article className="space-y-5">
      {(summaryError || questionError || choicesError) && (
        <p role="alert" className="text-sm text-destructive">
          A saved draft could not be loaded. Original stored data is retained until you edit that
          draft.
        </p>
      )}
      <Button variant="ghost" onClick={onBack}>
        Back to topics
      </Button>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold discussion-copy">{topic.title}</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-2 text-sm">
            Status
            <select
              className="discussion-field"
              value={topic.status}
              disabled={store.busy}
              onChange={(event) =>
                void store.change(topic, {
                  type: "status",
                  status: event.target.value as DiscussionTopic["status"],
                })
              }
            >
              {Object.entries(statuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={store.busy}
            onClick={() => void store.change(topic, { type: "read", read: !topic.read })}
          >
            Mark {topic.read ? "unread" : "read"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Discussion status and read state are separate from project acceptance and execution.
        </p>
      </div>
      <section className="space-y-2">
        <h3 className="font-medium">Current summary</h3>
        <DiscussionAssist
          topic={topic}
          scope={scope}
          refresh={store.refresh}
          disabled={store.busy}
        />
        {!editingSummary ? (
          <>
            <p className="text-sm discussion-copy">{topic.summary || "No summary yet."}</p>
            <Button variant="outline" onClick={() => setEditingSummary(true)}>
              Edit summary
            </Button>
          </>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              void store.change(topic, { type: "summary", summary }).then((result) => {
                if (result) setEditingSummary(false)
              })
            }}
          >
            <label className="sr-only" htmlFor="summary">
              Current summary
            </label>
            <textarea
              id="summary"
              className="discussion-field"
              rows={3}
              maxLength={2000}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
            <div className="flex gap-2">
              <Button disabled={store.busy}>Save summary</Button>
              <Button type="button" variant="ghost" onClick={() => setEditingSummary(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {topic.summaryHistory.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Earlier summaries</summary>
            {topic.summaryHistory.map((entry, index) => (
              <p key={index} className="py-2 discussion-copy">
                {entry.summary || "Empty summary"}
              </p>
            ))}
          </details>
        )}
      </section>
      {topic.questions.length > 0 && (
        <section>
          <h3 className="font-medium">Questions</h3>
          {topic.questions.map((item) => (
            <DiscussionQuestion
              key={item.id}
              question={item}
              topic={topic}
              scope={scope}
              change={store.change}
              busy={store.busy}
            />
          ))}
        </section>
      )}
      <section className="space-y-3">
        <h3 className="font-medium">Discussion</h3>
        {topic.captures.map((capture) => (
          <div key={capture.id} className="border-b pb-3">
            <span className="text-xs text-muted-foreground">
              {capture.kind === "idea" ? "Future idea" : capture.kind === "fix" ? "Fix" : "Note"}
              {capture.source ? ` · ${capture.source.role} source` : ""}
            </span>
            <p className="mt-1 text-sm discussion-copy">{capture.body}</p>
          </div>
        ))}
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void store
              .change(topic, { type: "capture", capture: { body: draft, kind: "note" } })
              .then((result) => {
                if (result) setDraft("")
              })
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>Add to this topic</span>
            <textarea
              className="discussion-field"
              rows={3}
              maxLength={16384}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <Button disabled={store.busy || !draft.trim()}>Add note</Button>
        </form>
      </section>
      {topic.annotations.length > 0 && (
        <section className="space-y-4">
          <h3 className="font-medium">Annotations</h3>
          {topic.annotations.map((annotation) => (
            <DiscussionAnnotationThread
              key={annotation.id}
              topic={topic}
              annotation={annotation}
              scope={scope}
              store={store}
            />
          ))}
        </section>
      )}
      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm">Ask a nonblocking question</summary>
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void store
              .change(topic, {
                type: "question",
                question: {
                  prompt: question,
                  blocking: false,
                  choices: choices
                    .split("\n")
                    .map((label) => label.trim())
                    .filter(Boolean)
                    .map((label, index) => ({ id: `choice-${index + 1}`, label })),
                },
              })
              .then((result) => {
                if (result) {
                  setQuestion("")
                  setChoices("")
                }
              })
          }}
        >
          <label className="block text-sm space-y-1">
            <span>Question</span>
            <textarea
              className="discussion-field"
              required
              value={question}
              maxLength={16384}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <label className="block text-sm space-y-1">
            <span>Choices, one per line (optional, up to 12)</span>
            <textarea
              className="discussion-field"
              value={choices}
              onChange={(event) => setChoices(event.target.value)}
            />
          </label>
          <Button
            disabled={
              store.busy ||
              !question.trim() ||
              choices.split("\n").filter((line) => line.trim()).length > 12
            }
          >
            Add question
          </Button>
        </form>
      </details>
      {topic.canonicalRecordIds.length > 0 && (
        <section>
          <h3 className="font-medium">Linked project records</h3>
          <ul className="text-sm">
            {topic.canonicalRecordIds.map((id) => (
              <li key={id} className="break-all">
                {id}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
