import { useState } from "react"
import { trpc } from "@/lib/trpc"
import { Button } from "@/components/ui/button"

const launchLabels = {
  unavailable: "Launch context unavailable",
  empty: "No project context included at launch",
  rejected: "Project context rejected at launch",
  included: "Project context included at launch",
}
const currentLabels = {
  changed: "Changed since launch",
  unchanged: "Unchanged since launch",
  missing: "Missing from recorded metadata",
  unknown: "Comparison unknown",
}

export function RunContextPanel({ chatId, runId }: { chatId: string; runId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section
      className="min-w-0 rounded-md bg-muted/30 px-2 py-2 text-sm"
      aria-label="Project context"
    >
      <button
        type="button"
        className="w-full rounded text-left font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Project context
      </button>
      {open && <ContextEvidence chatId={chatId} runId={runId} />}
    </section>
  )
}

function ContextEvidence({ chatId, runId }: { chatId: string; runId: string }) {
  const query = trpc.runs.getContextHealth.useQuery(
    { chatId, runId },
    { retry: false, refetchOnWindowFocus: false, refetchOnMount: "always" },
  )
  // Never show a previous run's cached evidence under a newly selected identity.
  const data = query.data?.chatId === chatId && query.data.runId === runId ? query.data : undefined
  return (
    <div className="mt-3 space-y-3 break-words">
      <p className="text-muted-foreground">
        Run: <span className="break-all">{runId}</span>
      </p>
      <p className="text-muted-foreground">
        Saved launch evidence compared with the last recorded database metadata. Current files and
        provider receipt are unverified.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        Refresh project context
      </Button>
      {query.isFetching && <p role="status">Loading project context...</p>}
      {query.error ? (
        <p role="alert" className="text-destructive">
          Could not load project context. Refresh to retry.
        </p>
      ) : data ? (
        <>
          <p className="font-medium">{launchLabels[data.status]}</p>
          {data.reason && <p>{data.reason}</p>}
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">Selection source</dt>
              <dd>{data.selectionSource ?? "Unknown"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Metadata checked</dt>
              <dd>{new Date(data.checkedAt).toLocaleString()}</dd>
            </div>
            {data.budget && (
              <div>
                <dt className="text-muted-foreground">Launch budget</dt>
                <dd>
                  {data.budget.includedBytes.toLocaleString()} /{" "}
                  {data.budget.maxBytes.toLocaleString()} bytes;{" "}
                  {data.budget.estimatedTokens.toLocaleString()} /{" "}
                  {data.budget.maxEstimatedTokens.toLocaleString()} estimated tokens
                </dd>
              </div>
            )}
            {data.graphGenerationId && (
              <div>
                <dt className="text-muted-foreground">Graph generation</dt>
                <dd className="break-all">{data.graphGenerationId}</dd>
              </div>
            )}
          </dl>
          {data.sources.length > 0 ? (
            <ul className="divide-y border-y">
              {data.sources.map((source) => (
                <li key={`${source.kind}:${source.id}`} className="space-y-2 py-3">
                  <h3 className="font-medium">{source.title}</h3>
                  <p className="break-all text-muted-foreground">{source.sourcePath}</p>
                  <p>
                    {source.kind === "graph" ? "Graph" : "Section"}:{" "}
                    <span className="break-all">{source.id}</span>; launch version{" "}
                    {source.version ?? "unknown"}
                  </p>
                  <p>{currentLabels[source.current.status]} (recorded metadata)</p>
                  <p>
                    {source.truncated ? "Truncated at launch" : "Not truncated at launch"}:{" "}
                    {source.includedBytes.toLocaleString()} of{" "}
                    {source.originalBytes.toLocaleString()} bytes included;{" "}
                    {source.estimatedTokens.toLocaleString()} estimated tokens.
                  </p>
                  {source.current.recordedAt !== null && (
                    <p className="text-muted-foreground">
                      Source metadata recorded:{" "}
                      {new Date(source.current.recordedAt).toLocaleString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No source evidence recorded.</p>
          )}
        </>
      ) : (
        !query.isFetching && (
          <p role="status">Project context evidence is unknown for this run. Refresh to retry.</p>
        )
      )}
    </div>
  )
}
