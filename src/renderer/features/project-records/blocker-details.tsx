import { projectBlockerDetailsSchema, type ProjectRecord } from "../../../shared/project-records"
import { Button } from "../../components/ui/button"

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
  return (
    <div className="mt-3 max-w-prose space-y-4 text-sm">
      <p className="text-muted-foreground">
        {categoryLabels[blocker.category]}
        {blocker.affectedWork.length > 0 && ` · Affects ${blocker.affectedWork.join(", ")}`}
      </p>
      <dl className="space-y-3">
        {[
          ["Why this is blocked", blocker.cause],
          ["Missing prerequisite", blocker.missingPrerequisite],
          ["Why agents cannot finish this yet", blocker.whyAgentCannotResolve],
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
        title="What agents can do meanwhile"
        items={blocker.independentWork}
        empty="No independent work is recorded for this blocker."
      />
      <BlockerList title="How resolution will be verified" items={blocker.resolutionVerification} />
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
        <summary className="cursor-pointer font-medium">Attempts and evidence</summary>
        <div className="mt-3 space-y-3">
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
        </div>
      </details>
      {!!blocker.resolutionEvidence?.length && (
        <BlockerList title="Resolution evidence" items={blocker.resolutionEvidence} />
      )}
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
