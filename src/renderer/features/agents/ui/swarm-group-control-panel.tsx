import { useMemo, useState } from "react"
import { Button } from "../../../components/ui/button"
import { Textarea } from "../../../components/ui/textarea"

export type SwarmGroupAction = "pause" | "resume" | "cancel" | "steer"

export type SwarmGroupPreviewDto = {
  action: SwarmGroupAction
  version: string
  selection: string[]
  capabilityIntersection: SwarmGroupAction[]
  permissionIntersection: Array<"control" | "steer">
  approvalRequired: boolean
  targets: Array<{
    agentId: string
    runId: string | null
    version: number
    supported: boolean
    reason: "missing-target" | "missing-run" | "unsupported-capability" | "permission-denied" | null
  }>
}

export type SwarmGroupExecutionDto = {
  status: "completed" | "partial" | "stale-selection"
  approvalAuditId: string | null
  results: Array<{
    agentId: string
    outcome: "succeeded" | "failed" | "unchanged"
    detail?: string
  }>
}

export function SwarmGroupControlPanel({
  agents,
  busy,
  onPreview,
  onExecute,
}: {
  agents: Array<{ id: string; label: string; status: string }>
  busy: boolean
  onPreview: (action: SwarmGroupAction, selectedAgentIds: string[]) => Promise<SwarmGroupPreviewDto>
  onExecute: (
    preview: SwarmGroupPreviewDto,
    steerMessage: string,
  ) => Promise<SwarmGroupExecutionDto>
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [action, setAction] = useState<SwarmGroupAction>("pause")
  const [steerMessage, setSteerMessage] = useState("")
  const [preview, setPreview] = useState<SwarmGroupPreviewDto | null>(null)
  const [execution, setExecution] = useState<SwarmGroupExecutionDto | null>(null)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("")
  const labels = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.label])), [agents])

  const resetResult = () => {
    setPreview(null)
    setExecution(null)
    setStatus("")
  }
  const selectedIds = [...selected].sort()
  const requestPreview = async () => {
    setPending(true)
    setExecution(null)
    try {
      const next = await onPreview(action, selectedIds)
      setPreview(next)
      setStatus(`Preview ready for ${next.selection.length} selected agents.`)
    } catch (error) {
      setPreview(null)
      setStatus(error instanceof Error ? error.message : "Group action preview failed.")
    } finally {
      setPending(false)
    }
  }
  const confirm = async () => {
    if (!preview) return
    setPending(true)
    try {
      const result = await onExecute(preview, steerMessage.trim())
      setExecution(result)
      setStatus(
        result.status === "completed"
          ? `Group ${preview.action} completed.`
          : result.status === "partial"
            ? `Group ${preview.action} completed with partial results.`
            : "Selection changed before confirmation. Preview the action again.",
      )
      setPreview(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Group action failed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      aria-label="Selected agent controls"
      className="space-y-2 rounded-md border border-border/60 p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-medium">Group controls</h4>
        <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {agents.map((agent) => (
          <label key={agent.id} className="flex min-h-8 items-center gap-2 text-[10px]">
            <input
              type="checkbox"
              checked={selected.has(agent.id)}
              onChange={(event) => {
                const checked = event.currentTarget.checked
                setSelected((current) => {
                  const next = new Set(current)
                  if (checked) next.add(agent.id)
                  else next.delete(agent.id)
                  return next
                })
                resetResult()
              }}
            />
            <span className="min-w-0 flex-1 truncate">{agent.label}</span>
            <span className="text-muted-foreground">{agent.status}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Group action"
          className="h-8 rounded-md border border-input bg-background px-2 text-[11px]"
          value={action}
          onChange={(event) => {
            setAction(event.currentTarget.value as SwarmGroupAction)
            resetResult()
          }}
        >
          <option value="pause">Pause</option>
          <option value="resume">Resume</option>
          <option value="cancel">Cancel</option>
          <option value="steer">Steer</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[11px]"
          disabled={busy || pending || selected.size === 0}
          onClick={() => void requestPreview()}
        >
          {pending && !preview ? "Previewing…" : "Preview action"}
        </Button>
      </div>
      {action === "steer" && (
        <Textarea
          aria-label="Steering message"
          className="min-h-16 text-[11px]"
          maxLength={10_000}
          placeholder="Message for every selected agent"
          value={steerMessage}
          onChange={(event) => {
            setSteerMessage(event.currentTarget.value)
            resetResult()
          }}
        />
      )}
      {preview && (
        <div className="space-y-2 rounded-md bg-muted/35 p-2 text-[10px]">
          <p className="font-medium">
            Exact selection:{" "}
            {preview.selection.map((agentId) => labels.get(agentId) ?? agentId).join(", ")}
          </p>
          <ul className="space-y-0.5">
            {preview.targets.map((target) => (
              <li key={target.agentId}>
                {labels.get(target.agentId) ?? target.agentId}:{" "}
                {target.supported ? "ready" : target.reason?.replaceAll("-", " ")}
              </li>
            ))}
          </ul>
          {preview.approvalRequired && (
            <p className="text-amber-400">Confirmation is recorded before this action runs.</p>
          )}
          <Button
            type="button"
            size="sm"
            className="h-8 text-[11px]"
            disabled={
              busy || pending || (preview.action === "steer" && steerMessage.trim().length === 0)
            }
            onClick={() => void confirm()}
          >
            {pending ? "Applying…" : `Confirm ${preview.action}`}
          </Button>
        </div>
      )}
      {execution && (
        <div className="space-y-1 text-[10px]">
          <p className="font-medium">
            {execution.status === "completed"
              ? "Completed"
              : execution.status === "partial"
                ? "Partial result"
                : "Stale selection"}
          </p>
          <ul>
            {execution.results.map((result) => (
              <li key={result.agentId}>
                {labels.get(result.agentId) ?? result.agentId}: {result.detail ?? result.outcome}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-[10px] text-muted-foreground">
        {status}
      </p>
    </section>
  )
}
