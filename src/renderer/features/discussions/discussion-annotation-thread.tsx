import { useState } from "react"
import type { DiscussionScope, DiscussionTopic } from "../../../shared/discussions"
import { DiscussionAssist } from "./discussion-assist"
import { Button } from "../../components/ui/button"
import { trpc } from "../../lib/trpc"
import { discussionDraftKey, useDiscussionDraft, type useDiscussions } from "./use-discussions"

export function DiscussionAnnotationThread({
  topic,
  annotation,
  scope,
  store,
}: {
  topic: DiscussionTopic
  annotation: DiscussionTopic["annotations"][number]
  scope: DiscussionScope
  store: ReturnType<typeof useDiscussions>
}) {
  const [draft, setDraft, storageError] = useDiscussionDraft(
    discussionDraftKey(scope, annotation.id),
    "",
  )
  const [promotion, setPromotion] = useState<string | null>(null)
  const sources = trpc.discussions.sources.useQuery(
    { scope, subChatId: annotation.source.subChatId, messageId: annotation.source.messageId },
    { refetchInterval: 30_000 },
  )
  const source = sources.data?.find((message) => message.messageId === annotation.source.messageId)
  const stale = source && source.revision !== annotation.source.revision
  return (
    <section className="space-y-3 border-b pb-4" aria-label="Annotation conversation">
      <p className="text-xs text-muted-foreground break-all">
        {annotation.source.role === "user" ? "User" : "Assistant"} message ·{" "}
        {annotation.source.messageId}
      </p>
      {annotation.source.target.kind === "text" ? (
        <blockquote className="border-l pl-3 text-sm discussion-copy">
          {annotation.source.target.quote}
        </blockquote>
      ) : (
        <p className="text-sm">
          Image {annotation.source.target.partIndex + 1} · preserved image region
        </p>
      )}
      {(stale || sources.error || (!sources.isLoading && !source)) && (
        <p role="status" className="text-sm text-muted-foreground">
          {stale
            ? "Source changed. This annotation preserves the original snapshot."
            : "Source unavailable. Original snapshot retained."}
        </p>
      )}
      <p className="text-sm discussion-copy">{annotation.body}</p>
      {annotation.followups.map((reply) => (
        <div key={reply.id}>
          <span className="text-xs text-muted-foreground">
            {reply.role === "user"
              ? "You"
              : `Assistant${reply.model ? ` · ${reply.model} · Ollama` : " · model not recorded"}`}
          </span>
          <p className="text-sm discussion-copy">{reply.body}</p>
        </div>
      ))}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          void store
            .change(topic, {
              type: "followup",
              annotationId: annotation.id,
              role: "user",
              body: draft,
            })
            .then((result) => {
              if (result) setDraft((current) => (current === draft ? "" : current))
            })
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>Follow up in this annotation</span>
          <textarea
            className="discussion-field"
            rows={2}
            maxLength={16384}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <Button disabled={store.busy || !draft.trim()}>Add follow-up</Button>
        {storageError && (
          <p role="alert" className="text-sm">
            Draft storage unavailable. Save before leaving.
          </p>
        )}
      </form>
      <DiscussionAssist
        topic={topic}
        scope={scope}
        annotationId={annotation.id}
        question={draft}
        onSaved={() => setDraft((current) => (current === draft ? "" : current))}
        refresh={store.refresh}
        disabled={store.busy}
      />
      {annotation.promotedTopicId ? (
        <p className="text-xs text-muted-foreground break-all">
          Promoted to topic {annotation.promotedTopicId}
        </p>
      ) : promotion === null ? (
        <Button variant="outline" onClick={() => setPromotion(topic.title)}>
          Promote to topic
        </Button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void store
              .change(topic, { type: "promote", annotationId: annotation.id, title: promotion })
              .then((result) => {
                if (result) setPromotion(null)
              })
          }}
        >
          <label className="block text-sm space-y-1">
            <span>New topic name</span>
            <input
              className="discussion-field"
              value={promotion}
              maxLength={200}
              onChange={(event) => setPromotion(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Adds this finding to a linked topic in this project on {scope.hostId}. No task or run
            starts.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={store.busy || !promotion.trim()}>Create linked topic</Button>
            <Button type="button" variant="ghost" onClick={() => setPromotion(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
