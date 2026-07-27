import { useEffect, useState } from "react"
import { AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES } from "../../../shared/agent-profiles"
import { trpc, trpcClient } from "../../lib/trpc"
import { Button } from "../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"

type StartSource = { kind: "task"; taskId: string } | { kind: "chat"; chatId: string }
type StandaloneLaunch = {
  id: string
  chatId: string
  runId: string
  runStatus: string
  state: string
  orchestrationTaskId: string | null
  profile: { profileId: string; version: number }
}

export function StartAgentDialog({
  open,
  onOpenChange,
  source,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: StartSource
  projectId: string | null
}) {
  const profiles = trpc.agentProfiles.list.useQuery(
    { projectId: projectId ?? undefined, includeArchived: false },
    { enabled: open },
  )
  const taskOrchestration = trpc.spawnedAgents.getTaskOverview.useQuery(
    { taskId: source.kind === "task" ? source.taskId : "" },
    {
      enabled: open && source.kind === "task",
      retry: false,
    },
  )
  const [profileId, setProfileId] = useState("")
  const selected = profiles.data?.find((profile) => profile.id === profileId) ?? null
  const [includeTask, setIncludeTask] = useState(source.kind === "task")
  const [includeParentChat, setIncludeParentChat] = useState(source.kind === "chat")
  const [preview, setPreview] = useState<{
    digest: string
    permissionMode: string
    runtime: string
    conflicts: Array<{ code: string; message: string }>
  } | null>(null)
  const [continuationPreview, setContinuationPreview] = useState<{
    digest: string
    permissionMode: string
    runtime: string
    conflicts: Array<{ code: string; message: string }>
  } | null>(null)
  const [currentLaunch, setCurrentLaunch] = useState<StandaloneLaunch | null>(null)
  const [includeContinuationChat, setIncludeContinuationChat] = useState(true)
  const [status, setStatus] = useState("")
  const orchestrationTaskId =
    source.kind === "task" &&
    taskOrchestration.data &&
    !["completed", "failed", "stopped"].includes(taskOrchestration.data.orchestration.status)
      ? source.taskId
      : null

  useEffect(() => {
    if (open && !profileId && profiles.data?.[0]) setProfileId(profiles.data[0].id)
  }, [open, profileId, profiles.data])

  useEffect(() => {
    setPreview(null)
    setContinuationPreview(null)
  }, [includeParentChat, includeTask, profileId, source])

  const launch = trpc.agentProfiles.launchStandalone.useMutation({
    onSuccess: (result) => {
      setCurrentLaunch(result)
      setPreview(null)
      setStatus(`Started ${selected?.name ?? "named agent"}; run ${result.runId}.`)
      const channel = new BroadcastChannel("flapstack-agent-profiles-v1")
      channel.postMessage({ kind: "standalone-launched", chatId: result.chatId })
      channel.close()
    },
    onError: (error) => setStatus(error.message),
  })
  const retry = trpc.agentProfiles.retryStandalone.useMutation({
    onSuccess: (result) => {
      setCurrentLaunch(result)
      setStatus(`Retry started as run ${result.runId} with the frozen profile snapshot.`)
    },
    onError: (error) => setStatus(error.message),
  })
  const stop = trpc.agentProfiles.stopStandalone.useMutation({
    onSuccess: (result) => {
      setCurrentLaunch(result)
      setStatus(
        result.stopped
          ? `Stopped named-agent run ${result.runId}.`
          : `Stop requested; durable run state is ${result.runStatus}.`,
      )
    },
    onError: (error) => setStatus(error.message),
  })
  const continueWithUpdatedProfile =
    trpc.agentProfiles.continueStandaloneWithUpdatedProfile.useMutation({
      onSuccess: (result) => {
        setCurrentLaunch(result)
        setContinuationPreview(null)
        setStatus(`Updated profile started in a new chat and run ${result.runId}.`)
        const channel = new BroadcastChannel("flapstack-agent-profiles-v1")
        channel.postMessage({ kind: "standalone-launched", chatId: result.chatId })
        channel.close()
      },
      onError: (error) => setStatus(error.message),
    })

  const input = () => {
    if (!selected) return null
    return {
      source,
      profile: { profileId: selected.id, version: selected.currentVersion },
      context: { includeTask, includeParentChat },
      overrides: null,
      orchestrationTaskId,
    }
  }

  const continuationInput = () => {
    if (!selected || !currentLaunch) return null
    return {
      source: { kind: "chat" as const, chatId: currentLaunch.chatId },
      profile: { profileId: selected.id, version: selected.currentVersion },
      context: { includeTask, includeParentChat: includeContinuationChat },
      overrides: null,
      orchestrationTaskId: currentLaunch.orchestrationTaskId,
    }
  }

  const resolvePreview = async () => {
    const value = input()
    if (!value) return
    try {
      const resolved = await trpcClient.agentProfiles.standalonePreview.query(value)
      setPreview({
        digest: resolved.digest,
        permissionMode: resolved.capability.permissionMode,
        runtime: resolved.runtimeResolution.preference,
        conflicts: resolved.conflicts,
      })
      const blocking = resolved.conflicts.filter((conflict) =>
        AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
      )
      setStatus(
        blocking.length
          ? `Launch blocked: ${blocking.map((conflict) => conflict.message).join(" ")}`
          : "Preview ready. Confirm to create exactly one durable chat and run.",
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preview failed.")
    }
  }

  const confirm = () => {
    const value = input()
    if (!value || !preview) return
    launch.mutate({
      ...value,
      requestId: crypto.randomUUID(),
      confirmedSnapshotDigest: preview.digest,
    })
  }
  const resolveContinuationPreview = async () => {
    const value = continuationInput()
    if (!value || !currentLaunch) return
    if (
      value.profile.profileId === currentLaunch.profile.profileId &&
      value.profile.version === currentLaunch.profile.version
    ) {
      setStatus("Select a different profile or a newer profile version before continuing.")
      return
    }
    try {
      const resolved = await trpcClient.agentProfiles.standalonePreview.query(value)
      setContinuationPreview({
        digest: resolved.digest,
        permissionMode: resolved.capability.permissionMode,
        runtime: resolved.runtimeResolution.preference,
        conflicts: resolved.conflicts,
      })
      const blocking = resolved.conflicts.filter((conflict) =>
        AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
      )
      setStatus(
        blocking.length
          ? `Continuation blocked: ${blocking.map((conflict) => conflict.message).join(" ")}`
          : "Updated-profile preview ready. Confirm to create a separate chat and run.",
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Continuation preview failed.")
    }
  }
  const confirmContinuation = () => {
    const value = continuationInput()
    if (!value || !currentLaunch || !continuationPreview) return
    continueWithUpdatedProfile.mutate({
      launchId: currentLaunch.id,
      launch: {
        ...value,
        requestId: crypto.randomUUID(),
        confirmedSnapshotDigest: continuationPreview.digest,
      },
    })
  }
  const launchBlocked = Boolean(
    preview?.conflicts.some((conflict) =>
      AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
    ),
  )
  const continuationBlocked = Boolean(
    continuationPreview?.conflicts.some((conflict) =>
      AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
    ),
  )
  const runActive = Boolean(
    currentLaunch && ["pending", "running"].includes(currentLaunch.runStatus),
  )
  const selectedProfileIsUpdated = Boolean(
    selected &&
    currentLaunch &&
    (selected.id !== currentLaunch.profile.profileId ||
      selected.currentVersion !== currentLaunch.profile.version),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="start-agent-description">
        <DialogHeader>
          <DialogTitle>Start named agent</DialogTitle>
          <DialogDescription id="start-agent-description">
            Choose one exact profile version, inspect resolved authority, then confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1 text-sm font-medium">
            <span>Agent Profile</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            >
              {(profiles.data ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · v{profile.currentVersion} · {profile.scope.type}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Explicit context</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeTask}
                onChange={(event) => setIncludeTask(event.target.checked)}
              />
              Include visible task name and description
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeParentChat}
                disabled={source.kind !== "chat"}
                onChange={(event) => setIncludeParentChat(event.target.checked)}
              />
              Include visible parent-chat messages; provider-private state stays excluded
            </label>
          </fieldset>
          {preview && (
            <section
              aria-label="Resolved launch preview"
              className="space-y-2 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <strong>Snapshot:</strong> <code>{preview.digest.slice(0, 16)}</code>
              </div>
              <div>
                <strong>Resolved permission:</strong> {preview.permissionMode}
              </div>
              <div>
                <strong>Resolved Runtime:</strong> {preview.runtime}
              </div>
              {preview.conflicts.length > 0 && (
                <ul
                  aria-label="Agent Profile launch limitations"
                  className="list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300"
                >
                  {preview.conflicts.map((conflict) => (
                    <li key={`${conflict.code}-${conflict.message}`}>{conflict.message}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {currentLaunch && (
            <section
              aria-label="Named-agent lifecycle"
              className="space-y-3 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <strong>Current run:</strong> <code>{currentLaunch.runId}</code> ·{" "}
                {currentLaunch.runStatus}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!runActive || stop.isPending}
                  onClick={() => stop.mutate({ launchId: currentLaunch.id })}
                >
                  {stop.isPending ? "Stopping…" : "Stop"}
                </Button>
                <Button
                  variant="outline"
                  disabled={runActive || retry.isPending}
                  onClick={() =>
                    retry.mutate({ launchId: currentLaunch.id, requestId: crypto.randomUUID() })
                  }
                >
                  {retry.isPending ? "Retrying…" : "Retry frozen snapshot"}
                </Button>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Select a different profile or save a newer version, then preview the explicit new
                  chat/run boundary.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeContinuationChat}
                    onChange={(event) => {
                      setIncludeContinuationChat(event.target.checked)
                      setContinuationPreview(null)
                    }}
                  />
                  Include visible messages from the prior named-agent chat
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!selectedProfileIsUpdated || runActive}
                    onClick={() => void resolveContinuationPreview()}
                  >
                    Preview updated profile
                  </Button>
                  <Button
                    disabled={
                      !continuationPreview ||
                      continuationBlocked ||
                      runActive ||
                      continueWithUpdatedProfile.isPending
                    }
                    onClick={confirmContinuation}
                  >
                    {continueWithUpdatedProfile.isPending
                      ? "Continuing…"
                      : "Continue with updated profile"}
                  </Button>
                </div>
                {continuationPreview && (
                  <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
                    <div>New snapshot: {continuationPreview.digest.slice(0, 16)}</div>
                    <div>Permission: {continuationPreview.permissionMode}</div>
                    <div>Runtime: {continuationPreview.runtime}</div>
                    {continuationPreview.conflicts.map((conflict) => (
                      <div key={`${conflict.code}-${conflict.message}`}>{conflict.message}</div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {status}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={!selected || taskOrchestration.isLoading}
            onClick={() => void resolvePreview()}
          >
            Preview
          </Button>
          <Button disabled={!preview || launchBlocked || launch.isPending} onClick={confirm}>
            {launch.isPending ? "Starting…" : "Confirm and start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
