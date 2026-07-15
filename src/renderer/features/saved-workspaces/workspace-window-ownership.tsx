import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "../../components/ui/button"
import type { WorkspacePaneClaimResult } from "../../../shared/workspace-window-ownership"
import type { SavedWorkspacePane } from "./layout-reducer"

export function workspacePaneChatIds(pane: SavedWorkspacePane): string[] {
  return pane.binding.type === "chat" ? [pane.binding.chatId] : []
}

export function WorkspacePaneOwnershipBoundary({
  projectId,
  workspaceId,
  pane,
  initiallySkipped = false,
  children,
}: {
  projectId?: string
  workspaceId: string
  pane: SavedWorkspacePane
  initiallySkipped?: boolean
  children: ReactNode
}) {
  const [claim, setClaim] = useState<WorkspacePaneClaimResult | null>(null)
  const [skipped, setSkipped] = useState(initiallySkipped)
  const [status, setStatus] = useState(initiallySkipped ? "Pane skipped in this window." : "")
  const requestGeneration = useRef(0)
  const mounted = useRef(true)
  const boundChatId = pane.binding.type === "chat" ? pane.binding.chatId : null
  const targetKey = `${projectId ?? ""}\0${workspaceId}\0${pane.id}\0${boundChatId ?? ""}`
  const activeTargetKey = useRef(targetKey)
  activeTargetKey.current = targetKey
  const target = useMemo(
    () => ({
      projectId,
      workspaceId,
      paneId: pane.id,
      chatIds: boundChatId ? [boundChatId] : [],
    }),
    [boundChatId, pane.id, projectId, workspaceId],
  )

  const claimHere = useCallback(
    async (mode: "claim" | "move" = "claim") => {
      const requestId = ++requestGeneration.current
      const requestTargetKey = targetKey
      const isCurrent = () =>
        mounted.current &&
        requestId === requestGeneration.current &&
        requestTargetKey === activeTargetKey.current
      const api = window.desktopApi
      if (!api?.claimWorkspacePane) {
        if (isCurrent()) setClaim({ ok: true, state: "claimed", ownerStableId: "browser" })
        return
      }
      if (isCurrent()) setClaim(null)
      try {
        const result = await api.claimWorkspacePane(target, mode)
        if (!isCurrent()) {
          if (result.ok && (!mounted.current || requestTargetKey !== activeTargetKey.current)) {
            try {
              void api.releaseWorkspacePane(target).catch(() => undefined)
            } catch {
              // Best effort only. Never disturb the current target for stale cleanup.
            }
          }
          return
        }
        setClaim(result)
        setSkipped(false)
        setStatus(
          result.ok
            ? mode === "move"
              ? "Pane moved to this window."
              : "Pane is active in this window."
            : `Pane is active in ${result.ownerStableId}.`,
        )
      } catch (error) {
        if (!isCurrent()) return
        setClaim({
          ok: false,
          ownerStableId: "unknown",
          conflicts: [{ kind: "workspace-pane", ownerStableId: "unknown" }],
        })
        setStatus(error instanceof Error ? error.message : "Pane ownership could not be confirmed.")
      }
    },
    [target, targetKey],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestGeneration.current += 1
    }
  }, [])

  useEffect(() => {
    if (skipped) return
    void claimHere()
  }, [claimHere, skipped])

  useEffect(() => {
    const api = window.desktopApi
    if (!api?.onWorkspaceOwnershipChanged || skipped) return
    return api.onWorkspaceOwnershipChanged((event) => {
      const relevantPane = event.workspaceId === workspaceId && event.paneId === pane.id
      const relevantChat = target.chatIds.some((chatId) => event.chatIds.includes(chatId))
      if (!relevantPane && !relevantChat) return
      void claimHere()
    })
  }, [claimHere, pane.id, skipped, target.chatIds, workspaceId])

  useEffect(
    () => () => {
      void window.desktopApi?.releaseWorkspacePane?.(target)
    },
    [target],
  )

  if (skipped) {
    return (
      <OwnershipNotice title="Pane skipped" status={status}>
        <Button type="button" size="sm" onClick={() => void claimHere()}>
          Restore pane here
        </Button>
      </OwnershipNotice>
    )
  }

  if (claim && !claim.ok) {
    const focusOwner = async () => {
      const focused = await window.desktopApi?.focusWorkspacePaneOwner?.(workspaceId, pane.id)
      if (!focused && target.chatIds[0]) {
        await window.desktopApi?.focusChatOwner?.(target.chatIds[0])
      }
      setStatus(`Focused ${claim.ownerStableId}.`)
    }
    const openRemainder = async () => {
      const result = await window.desktopApi?.openWorkspaceRemainder?.({
        projectId,
        workspaceId,
        skipPaneId: pane.id,
      })
      setStatus(
        result?.ok
          ? "Opened remaining workspace in another window."
          : result?.reason === "recovering"
            ? "The remaining workspace window is recovering."
            : "Could not open another window.",
      )
    }
    return (
      <OwnershipNotice
        title="Pane is already active"
        status={status}
        detail={`Exclusive live ownership belongs to ${claim.ownerStableId}. Choose how to recover without creating a second live controller.`}
      >
        <Button type="button" size="sm" onClick={() => void focusOwner()}>
          Focus owner
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void claimHere("move")}>
          Move here
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setSkipped(true)
            setStatus("Pane skipped in this window.")
          }}
        >
          Skip pane
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void openRemainder()}>
          Open remaining workspace separately
        </Button>
      </OwnershipNotice>
    )
  }

  if (!claim) {
    return <OwnershipNotice title="Claiming pane" status="Checking exclusive window ownership…" />
  }

  return (
    <div className="h-full min-h-0" data-workspace-live-owner={claim.ownerStableId}>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
      {children}
    </div>
  )
}

function OwnershipNotice({
  title,
  detail,
  status,
  children,
}: {
  title: string
  detail?: string
  status: string
  children?: ReactNode
}) {
  return (
    <section
      className="flex h-full min-h-40 items-center justify-center p-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-xl">
        <h3 className="font-medium">{title}</h3>
        {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
        {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
        <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </section>
  )
}
