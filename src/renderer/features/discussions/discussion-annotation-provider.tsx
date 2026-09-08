import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { MessageSquarePlus } from "lucide-react"
import type { DiscussionScope, DiscussionSource } from "../../../shared/discussions"
import { Button } from "../../components/ui/button"
import { trpc } from "../../lib/trpc"
import { quoteOccurrences, selectedMessageQuote } from "./annotation-source"
import { DiscussionAnnotationThread } from "./discussion-annotation-thread"
import { discussionDraftKey, useDiscussionDraft, useDiscussions } from "./use-discussions"
import "./discussions.css"

type Request = { messageId: string; role: "user" | "assistant"; quote?: string }
const AnnotationContext = createContext<((request: Request, returnTo: HTMLElement) => void) | null>(
  null,
)
export function DiscussionAnnotationAction({
  messageId,
  role,
}: {
  messageId: string
  role: Request["role"]
}) {
  const open = useContext(AnnotationContext)
  const quote = useRef<string | undefined>(undefined)
  if (!open) return null
  return (
    <button
      type="button"
      title="Annotate text or image"
      aria-label={`Annotate ${role} message text or image`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      onPointerDown={() => {
        quote.current = selectedMessageQuote(messageId)
      }}
      onClick={(event) => {
        open(
          { messageId, role, quote: quote.current ?? selectedMessageQuote(messageId) },
          event.currentTarget,
        )
        quote.current = undefined
      }}
    >
      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}
export function DiscussionAnnotationProvider({
  scope,
  subChatId,
  children,
}: {
  scope: DiscussionScope | null
  subChatId: string
  children: ReactNode
}) {
  const [request, setRequest] = useState<Request | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  useEffect(() => setRequest(null), [scope?.projectId, scope?.chatId, scope?.hostId, subChatId])
  const close = () => {
    setRequest(null)
    requestAnimationFrame(() => {
      if (returnTo.current?.isConnected) returnTo.current.focus()
    })
  }
  return (
    <AnnotationContext.Provider
      value={
        scope
          ? (next, element) => {
              returnTo.current = element
              setRequest(next)
            }
          : null
      }
    >
      <div className="discussion-annotation-layout" data-open={Boolean(request && scope)}>
        <div className="discussion-annotation-chat">{children}</div>
        {request && scope && (
          <aside
            className="discussion-annotation-panel"
            aria-label="Message annotation"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                close()
              }
            }}
          >
            <AnnotationEditor
              key={JSON.stringify([scope, subChatId, request])}
              scope={scope}
              subChatId={subChatId}
              request={request}
              close={close}
            />
          </aside>
        )}
      </div>
    </AnnotationContext.Provider>
  )
}
function AnnotationEditor({
  scope,
  subChatId,
  request,
  close,
}: {
  scope: DiscussionScope
  subChatId: string
  request: Request
  close: () => void
}) {
  const store = useDiscussions(scope)
  const sources = trpc.discussions.sources.useQuery(
    { scope, subChatId, messageId: request.messageId },
    { refetchOnWindowFocus: false },
  )
  const message = sources.data?.find(
    (item) => item.messageId === request.messageId && item.role === request.role,
  )
  const [topicId, setTopicId] = useState("")
  const [newTopic, setNewTopic] = useState("")
  const [savedId, setSavedId] = useState<string | null>(null)
  const [targetKind, setTargetKind] = useState("text")
  const [occurrence, setOccurrence] = useState("")
  const [body, setBody, storageError] = useDiscussionDraft(
    discussionDraftKey(
      scope,
      `annotation:${subChatId}:${request.messageId}:${request.quote ?? "whole"}`,
    ),
    "",
  )
  const [region, setRegion] = useState({ x: 0, y: 0, width: 100, height: 100 })
  const quote = request.quote ?? message?.text ?? ""
  const occurrences = quoteOccurrences(message?.text ?? "", quote)
  const start =
    occurrences.length === 1 ? occurrences[0] : occurrence ? Number(occurrence) : undefined
  const topic = store.topics.find((item) => item.id === topicId)
  const annotation = topic?.annotations.find((item) => item.id === savedId)
  const image = message?.images.find((item) => item.imageIdentity === targetKind)
  const validRegion =
    Object.values(region).every(Number.isFinite) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= 100 &&
    region.y + region.height <= 100
  const source: DiscussionSource | null =
    message &&
    (targetKind === "text"
      ? start !== undefined && quote.length > 0 && quote.length <= 16384
      : image && validRegion)
      ? {
          subChatId,
          messageId: message.messageId,
          role: message.role,
          revision: message.revision,
          target:
            targetKind === "text"
              ? { kind: "text", quote, start: start!, end: start! + quote.length }
              : {
                  kind: "image",
                  partIndex: image!.partIndex,
                  imageIdentity: image!.imageIdentity,
                  region: {
                    x: region.x / 100,
                    y: region.y / 100,
                    width: region.width / 100,
                    height: region.height / 100,
                  },
                },
        }
      : null
  const save = async () => {
    if (!topic || !source) return
    const updated = await store.change(topic, { type: "annotation", source, body })
    if (updated) {
      setSavedId(updated.annotations.at(-1)?.id ?? null)
      setBody((current) => (current === body ? "" : current))
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Annotation</h2>
        <Button variant="ghost" onClick={close}>
          Back to chat
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Local to this discussion · {request.role} source · Host {scope.hostId}
      </p>
      {store.error && (
        <p role="alert" className="text-sm text-destructive">
          {store.error}
        </p>
      )}
      {annotation && topic ? (
        <DiscussionAnnotationThread
          topic={topic}
          annotation={annotation}
          scope={scope}
          store={store}
        />
      ) : sources.isLoading ? (
        <p role="status">Loading source…</p>
      ) : !message ? (
        <p role="alert">
          Source unavailable or not saved yet. Return to the message after it finishes saving.
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label className="block text-sm space-y-1">
            <span>Source</span>
            <select
              className="discussion-field"
              value={targetKind}
              onChange={(event) => setTargetKind(event.target.value)}
            >
              <option value="text">{request.quote ? "Selected text" : "Message text"}</option>
              {message.images.map((item, imageIndex) => (
                <option key={item.imageIdentity} value={item.imageIdentity}>
                  Image {imageIndex + 1}
                </option>
              ))}
            </select>
          </label>
          {targetKind === "text" ? (
            <>
              <blockquote className="max-h-48 overflow-y-auto border-l pl-3 text-sm discussion-copy">
                {quote || "This message has no text. Choose an image."}
              </blockquote>
              {occurrences.length > 1 && (
                <label className="block text-sm space-y-1">
                  <span>This quote repeats. Choose its source occurrence.</span>
                  <select
                    className="discussion-field"
                    required
                    value={occurrence}
                    onChange={(event) => setOccurrence(event.target.value)}
                  >
                    <option value="">Choose occurrence</option>
                    {occurrences.map((offset, index) => (
                      <option key={offset} value={offset}>
                        Occurrence {index + 1}:{" "}
                        {message.text.slice(Math.max(0, offset - 35), offset + quote.length + 35)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {quote && !occurrences.length && (
                <p role="alert" className="text-sm">
                  Selection differs from stored source. Return to the message and select plain text.
                </p>
              )}
              {quote.length > 16384 && (
                <p role="alert" className="text-sm">
                  Select a shorter passage to annotate.
                </p>
              )}
            </>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-sm">Image region (percent from top left)</legend>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(region).map(([name, value]) => (
                  <label key={name} className="text-sm capitalize">
                    {name}
                    <input
                      className="discussion-field"
                      type="number"
                      min={name === "width" || name === "height" ? 1 : 0}
                      max={100}
                      value={value}
                      onChange={(event) =>
                        setRegion({ ...region, [name]: event.target.valueAsNumber })
                      }
                    />
                  </label>
                ))}
              </div>
              {!validRegion && (
                <p role="alert" className="text-sm">
                  Region must stay inside the image.
                </p>
              )}
            </fieldset>
          )}
          <label className="block text-sm space-y-1">
            <span>Discussion topic</span>
            <select
              className="discussion-field"
              required
              value={topicId}
              onChange={(event) => setTopicId(event.target.value)}
            >
              <option value="">Choose a topic</option>
              {store.topics
                .filter((item) => !item.archived)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
          {store.hasMore && (
            <Button
              type="button"
              variant="outline"
              disabled={store.loadingMore}
              onClick={() => void store.loadMore()}
            >
              Load more topics
            </Button>
          )}
          <details>
            <summary className="cursor-pointer text-sm">Create a topic here</summary>
            <label className="block mt-2 text-sm space-y-1">
              <span>Topic name</span>
              <input
                className="discussion-field"
                maxLength={200}
                value={newTopic}
                onChange={(event) => setNewTopic(event.target.value)}
              />
            </label>
            <Button
              type="button"
              className="mt-2"
              variant="outline"
              disabled={store.busy || !newTopic.trim()}
              onClick={() =>
                void store
                  .create(newTopic, "Discussion opened from a message annotation.", "note")
                  .then((topic) => {
                    if (topic) {
                      setTopicId(topic.id)
                      setNewTopic("")
                    }
                  })
              }
            >
              Create topic
            </Button>
          </details>
          <label className="block text-sm space-y-1">
            <span>Question or note</span>
            <textarea
              className="discussion-field"
              rows={4}
              maxLength={16384}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <Button disabled={store.busy || !source || !topic || !body.trim()}>
            Save annotation
          </Button>
          {storageError && (
            <p role="alert" className="text-sm">
              Draft storage unavailable. Save before leaving.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Follow-ups stay here. Promote explicitly to create a discussion topic.
          </p>
        </form>
      )}
    </div>
  )
}
