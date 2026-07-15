"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "../../../components/ui/button"
import { trpc } from "../../../lib/trpc"

export function OrchestrationWorkflowPanel({ taskId }: { taskId: string }) {
  const utils = trpc.useUtils()
  const templates = trpc.orchestrationOperations.listTemplates.useQuery()
  const workflows = trpc.orchestrationOperations.listWorkflows.useQuery(
    { taskId },
    { refetchInterval: 1_000 },
  )
  const [templateId, setTemplateId] = useState("")
  useEffect(() => {
    if (!templateId && templates.data?.[0]) setTemplateId(templates.data[0].id)
  }, [templateId, templates.data])

  const refresh = async () => {
    await Promise.all([
      utils.orchestrationOperations.listWorkflows.invalidate({ taskId }),
      utils.spawnedAgents.getTaskOverview.invalidate({ taskId }),
      utils.spawnedAgents.getLineage.invalidate({ taskId }),
    ])
  }
  const mutationOptions = {
    onSuccess: refresh,
    onError: (error: { message: string }) => toast.error(error.message),
  }
  const start = trpc.orchestrationOperations.startWorkflow.useMutation(mutationOptions)
  const advance = trpc.orchestrationOperations.advanceWorkflow.useMutation(mutationOptions)
  const control = trpc.orchestrationOperations.controlWorkflow.useMutation(mutationOptions)
  const gate = trpc.orchestrationOperations.decideHumanGate.useMutation(mutationOptions)
  const retry = trpc.orchestrationOperations.retryWorkflowStep.useMutation(mutationOptions)
  const busy = start.isPending || advance.isPending || control.isPending || gate.isPending

  return (
    <section aria-label="Workflow operations" className="rounded-md border border-border/60 p-2">
      <h4 className="text-[10px] font-medium text-muted-foreground">Workflow operations</h4>
      <div className="mt-1 flex flex-wrap items-end gap-1">
        <label className="grid gap-1 text-[9px] text-muted-foreground">
          Versioned template
          <select
            className="h-7 rounded border bg-background px-2 text-[10px]"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.data?.length ? (
              templates.data.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · v{template.version}
                </option>
              ))
            ) : (
              <option value="">No templates</option>
            )}
          </select>
        </label>
        <Button
          aria-label="Start workflow"
          size="sm"
          variant="outline"
          className="h-7 text-[10px]"
          disabled={!templateId || busy}
          onClick={() => start.mutate({ taskId, templateId })}
        >
          Start workflow
        </Button>
      </div>

      {workflows.data?.length ? (
        <ol className="mt-2 space-y-2" aria-label="Workflow runs">
          {workflows.data.map((run) => (
            <li key={run.id} className="rounded border border-border/50 p-2 text-[9px]">
              <div className="flex flex-wrap items-center gap-1">
                <strong className="mr-auto">{run.definition.engine}</strong>
                <span role="status" aria-live="polite">
                  {run.status}
                </span>
                {!["completed", "failed", "stopped"].includes(run.status) && (
                  <Button
                    aria-label={`Advance workflow ${run.id}`}
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px]"
                    disabled={busy || run.status === "paused"}
                    onClick={() => advance.mutate({ runId: run.id, launches: {} })}
                  >
                    Advance
                  </Button>
                )}
                {run.status === "paused" ? (
                  <Button
                    aria-label={`Resume workflow ${run.id}`}
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px]"
                    disabled={busy}
                    onClick={() => control.mutate({ runId: run.id, action: "resume" })}
                  >
                    Resume
                  </Button>
                ) : !["completed", "failed", "stopped"].includes(run.status) ? (
                  <Button
                    aria-label={`Pause workflow ${run.id}`}
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px]"
                    disabled={busy}
                    onClick={() => control.mutate({ runId: run.id, action: "pause" })}
                  >
                    Pause
                  </Button>
                ) : null}
                {!["completed", "failed", "stopped"].includes(run.status) && (
                  <Button
                    aria-label={`Stop workflow ${run.id}`}
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px]"
                    disabled={busy}
                    onClick={() => control.mutate({ runId: run.id, action: "stop" })}
                  >
                    Stop
                  </Button>
                )}
              </div>
              <ol className="mt-1 space-y-1" aria-label={`Checkpoints for ${run.id}`}>
                {run.checkpoints.map((checkpoint) => {
                  const step = run.definition.workflow.steps.find(
                    (candidate) => candidate.id === checkpoint.stepId,
                  )
                  return (
                    <li key={checkpoint.stepId} className="rounded bg-muted/30 px-1.5 py-1">
                      <span>
                        {checkpoint.stepId} · {step?.kind ?? "unknown"} · {checkpoint.status} · try{" "}
                        {checkpoint.attemptCount}
                      </span>
                      {checkpoint.error && (
                        <span className="block text-muted-foreground">{checkpoint.error}</span>
                      )}
                      {step?.kind === "human-gate" && checkpoint.status === "waiting" && (
                        <span className="mt-1 flex gap-1">
                          <Button
                            aria-label={`Approve human gate ${checkpoint.stepId}`}
                            size="sm"
                            className="h-5 px-1.5 text-[9px]"
                            onClick={() =>
                              gate.mutate({
                                runId: run.id,
                                stepId: checkpoint.stepId,
                                decision: "approve",
                              })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            aria-label={`Deny human gate ${checkpoint.stepId}`}
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[9px]"
                            onClick={() =>
                              gate.mutate({
                                runId: run.id,
                                stepId: checkpoint.stepId,
                                decision: "deny",
                              })
                            }
                          >
                            Deny
                          </Button>
                        </span>
                      )}
                      {step?.kind !== "human-gate" &&
                        ["waiting", "blocked", "failed"].includes(checkpoint.status) &&
                        checkpoint.attemptCount <= (step?.maxRetries ?? 0) && (
                          <Button
                            aria-label={`Retry workflow step ${checkpoint.stepId}`}
                            size="sm"
                            variant="ghost"
                            className="ml-1 h-5 px-1.5 text-[9px]"
                            disabled={retry.isPending}
                            onClick={() =>
                              retry.mutate({ runId: run.id, stepId: checkpoint.stepId })
                            }
                          >
                            Retry
                          </Button>
                        )}
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[9px] text-muted-foreground">No workflow runs.</p>
      )}
    </section>
  )
}
