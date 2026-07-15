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
  const [status, setStatus] = useState("")

  useEffect(() => {
    if (open && !profileId && profiles.data?.[0]) setProfileId(profiles.data[0].id)
  }, [open, profileId, profiles.data])

  useEffect(() => {
    setPreview(null)
  }, [includeParentChat, includeTask, profileId, source])

  const launch = trpc.agentProfiles.launchStandalone.useMutation({
    onSuccess: (result) => {
      setStatus(`Started ${selected?.name ?? "named agent"}; run ${result.runId}.`)
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
      orchestrationTaskId: null,
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
        runtime: resolved.evaluation.runtime,
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
  const launchBlocked = Boolean(
    preview?.conflicts.some((conflict) =>
      AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
    ),
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
                <ul className="list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300">
                  {preview.conflicts.map((conflict) => (
                    <li key={`${conflict.code}-${conflict.message}`}>{conflict.message}</li>
                  ))}
                </ul>
              )}
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
          <Button variant="outline" disabled={!selected} onClick={() => void resolvePreview()}>
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
