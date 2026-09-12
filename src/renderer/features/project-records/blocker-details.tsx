import { useState } from "react"
import { projectBlockerDetailsSchema, type ProjectRecord } from "../../../shared/project-records"
import { Button } from "../../components/ui/button"
import { writeClipboardText } from "../../lib/clipboard"

const categoryLabels: Record<string, string> = {
  authority: "Authorization",
  access: "Access",
  credentials: "Sign-in",
  environment: "Test environment",
  external_dependency: "External dependency",
  review_budget: "Review limit",
  decision: "Decision",
}

export function BlockerDetails({
  record,
  openQuestion,
}: {
  record: ProjectRecord
  openQuestion: (id: string) => void
}) {
  const parsed = projectBlockerDetailsSchema.safeParse(record)
  if (!parsed.success) {
    return (
      <p className="mt-3 max-w-prose text-sm">
        This work is marked blocked, but its resolution details have not been recorded. Human help
        has not been established as necessary.
      </p>
    )
  }
  const blocker = parsed.data
  const closed = record.state === "resolved" || record.state === "superseded"
  return (
    <div className="mt-3 max-w-prose space-y-4 text-sm">
      <p className="text-muted-foreground">
        {categoryLabels[blocker.category]}
        {blocker.affectedWork.length > 0 && ` · Affects ${blocker.affectedWork.join(", ")}`}
      </p>
      {closed ? (
        <p className="font-medium">
          {record.state === "resolved"
            ? "Resolved. No further action is needed for this blocker."
            : "This blocker was replaced. No action is requested here."}
        </p>
      ) : (
        <>
          <dl className="space-y-3">
            {[
              ["Why this is blocked", blocker.cause],
              [
                "Your action",
                blocker.ownerAction ?? "No owner-specific action is currently established.",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="font-medium">{label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <BlockerList title="Steps to resolve" items={blocker.resolutionSteps} ordered />
          <BlockerList
            title="How resolution will be verified"
            items={blocker.resolutionVerification}
          />
          {blocker.continuationPrompt ? (
            <ContinuationPrompt
              key={blocker.continuationPrompt}
              prompt={blocker.continuationPrompt}
            />
          ) : (
            <p className="text-muted-foreground">
              A continuation message is not available for this blocker.
            </p>
          )}
        </>
      )}
      {blocker.questionIds.length > 0 && (
        <div>
          <p className="font-medium">Related questions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {blocker.questionIds.map((id) => (
              <Button key={id} size="sm" variant="outline" onClick={() => openQuestion(id)}>
                Open {id}
              </Button>
            ))}
          </div>
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          {closed ? "Previous blocker details" : "Technical details"}
        </summary>
        <div className="mt-3 space-y-3">
          {closed && (
            <>
              <BlockerList title="Original problem" items={[blocker.cause]} />
              {blocker.ownerAction && (
                <BlockerList title="Previously requested action" items={[blocker.ownerAction]} />
              )}
              <BlockerList
                title="Previous resolution steps"
                items={blocker.resolutionSteps}
                ordered
              />
              <BlockerList
                title="Recorded completion checks"
                items={blocker.resolutionVerification}
              />
              {blocker.continuationPrompt && (
                <div>
                  <p className="font-medium">Previous continuation message</p>
                  <pre className="mt-1 select-text whitespace-pre-wrap break-words font-sans">
                    {blocker.continuationPrompt}
                  </pre>
                </div>
              )}
            </>
          )}
          <dl className="space-y-3">
            {(
              [
                [
                  closed ? "Original prerequisite" : "Missing prerequisite",
                  blocker.missingPrerequisite,
                ],
                [
                  closed ? "Original reason help was needed" : "Why agents cannot finish this yet",
                  blocker.whyAgentCannotResolve,
                ],
                ["Additional context", record.description || record.context],
              ] as const
            ).map(([label, value]) =>
              typeof value === "string" && value ? (
                <div key={label}>
                  <dt className="font-medium">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
          <BlockerList
            title={closed ? "Work that could continue" : "What agents can do meanwhile"}
            items={blocker.independentWork}
            empty="No independent work is recorded for this blocker."
          />
          <BlockerList
            title="Already tried"
            items={blocker.attemptedResolutions}
            empty="No attempts recorded."
          />
          <BlockerList title="Evidence" items={blocker.evidence} empty="No evidence recorded." />
          <BlockerList
            title="Sources"
            items={blocker.sourceLinks}
            empty="No source references recorded."
          />
          {!!blocker.resolutionEvidence?.length && (
            <BlockerList title="Resolution evidence" items={blocker.resolutionEvidence} />
          )}
        </div>
      </details>
    </div>
  )
}

function ContinuationPrompt({ prompt }: { prompt: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle")
  const copy = async () => {
    setCopyState("copying")
    try {
      await writeClipboardText(prompt)
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }
  }
  return (
    <div className="space-y-2">
      <p className="font-medium">Continue in any chat</p>
      <pre
        aria-label="Continuation message"
        tabIndex={0}
        className="select-text whitespace-pre-wrap break-words rounded-md border p-3 font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {prompt}
      </pre>
      <Button
        size="sm"
        variant="outline"
        disabled={copyState === "copying"}
        onClick={() => void copy()}
      >
        {copyState === "copying" ? "Copying..." : "Copy continuation message"}
      </Button>
      <p role="status" className="text-muted-foreground">
        {copyState === "copied"
          ? "Continuation message copied."
          : copyState === "failed"
            ? "Could not copy. Select the message above and use your device's Copy command."
            : "Paste this message into the chat that will continue this work."}
      </p>
    </div>
  )
}

function BlockerList({
  title,
  items,
  ordered = false,
  empty,
}: {
  title: string
  items: string[]
  ordered?: boolean
  empty?: string
}) {
  const List = ordered ? "ol" : "ul"
  return (
    <div>
      <p className="font-medium">{title}</p>
      {items.length > 0 ? (
        <List className={`mt-1 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, index) => (
            <li key={index} className="whitespace-pre-wrap break-words">
              {item}
            </li>
          ))}
        </List>
      ) : (
        <p className="mt-1 text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}
