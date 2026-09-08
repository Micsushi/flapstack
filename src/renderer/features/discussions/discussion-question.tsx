import { useState } from "react"
import type {
  DiscussionAnswer,
  DiscussionScope,
  DiscussionTopic,
} from "../../../shared/discussions"
import { Button } from "../../components/ui/button"
import { discussionDraftKey, useDiscussionDraft, type useDiscussions } from "./use-discussions"

type Change = ReturnType<typeof useDiscussions>["change"]
export function DiscussionQuestion({
  topic,
  question,
  scope,
  change,
  busy,
}: {
  topic: DiscussionTopic
  question: DiscussionTopic["questions"][number]
  scope: DiscussionScope
  change: Change
  busy: boolean
}) {
  const [draft, setDraft, storageError] = useDiscussionDraft<DiscussionAnswer>(
    discussionDraftKey(scope, question.id),
    question.draft,
  )
  const lastAnswer = question.answers.at(-1)
  const [editing, setEditing] = useState(!lastAnswer)
  const submit = async () => {
    if (await change(topic, { type: "answer", questionId: question.id, answer: draft }))
      setEditing(false)
  }
  return (
    <section className="space-y-3 border-b py-4" aria-labelledby={`question-${question.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`question-${question.id}`} className="font-medium discussion-copy">
          {question.prompt}
        </h3>
        <span className="text-xs text-muted-foreground">
          {lastAnswer ? "Answered" : "Awaiting answer"} ·{" "}
          {question.blocking ? "Dependent work waits" : "Independent work continues"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground break-all">Question {question.id}</p>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {question.choices.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm mb-2">Choose any that apply</legend>
              {question.choices.map((choice) => (
                <label key={choice.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.choiceIds.includes(choice.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        choiceIds: event.target.checked
                          ? [...draft.choiceIds, choice.id]
                          : draft.choiceIds.filter((id) => id !== choice.id),
                      })
                    }
                    className="mt-1"
                  />
                  <span className="discussion-copy">{choice.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="block space-y-1 text-sm">
            <span>Your answer or another option</span>
            <textarea
              className="discussion-field"
              rows={3}
              maxLength={16384}
              value={draft.text}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            />
          </label>
          {storageError && (
            <p role="alert" className="text-sm text-destructive">
              Saved draft unavailable or invalid. Original stored data is retained until you edit.
              Save draft before leaving.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={busy || (!draft.text.trim() && !draft.choiceIds.length)}
            >
              Submit answer
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void change(topic, { type: "draft", questionId: question.id, answer: draft })
              }
            >
              Save draft
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Submitting records your answer here. It does not resume an agent automatically.
          </p>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-sm discussion-copy">
            {lastAnswer?.choiceIds
              .map((id) => question.choices.find((choice) => choice.id === id)?.label ?? id)
              .join(", ")}
          </p>
          <p className="text-sm discussion-copy">{lastAnswer?.text}</p>
          <Button variant="outline" onClick={() => setEditing(true)}>
            Update answer
          </Button>
        </div>
      )}
    </section>
  )
}
