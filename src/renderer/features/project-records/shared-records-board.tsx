import { useEffect, useRef, useState } from "react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import type { BoardNavigation, BoardView, BoardTaskChatRequest } from "@project-records/board"
import { mountBoard } from "@project-records/board"
import { trpc, trpcClient } from "../../lib/trpc"
import {
  desktopViewAtom,
  selectedProjectAtom,
  selectedAgentChatIdAtom,
  openAgentChatIdsAtom,
  showNewChatFormAtom,
  selectedChatIsRemoteAtom,
  selectedChatScopeAtom,
  selectedDraftIdAtom,
} from "../agents/atoms"
import { Button } from "../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog"
import type { YapReviewRequest } from "../../../shared/task-proposals"

export const recordsNavigationAtom = atom<BoardNavigation | null>(null)

export type SharedRecordsBoardProps = {
  initialView?: BoardView
  /** Durable Yap identity to open in the canonical shared review surface. */
  yapReview?: YapReviewRequest | null
}

export function SharedRecordsBoard({
  initialView = "board",
  yapReview,
}: SharedRecordsBoardProps = {}) {
  const host = useRef<HTMLDivElement>(null)
  const [navigation, setNavigation] = useAtom(recordsNavigationAtom)
  const navigationRef = useRef(navigation)
  navigationRef.current = navigation
  const setDesktopView = useSetAtom(desktopViewAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectRef = useRef(selectedProject)
  projectRef.current = selectedProject
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setOpenChatIds = useSetAtom(openAgentChatIdsAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const setRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setScope = useSetAtom(selectedChatScopeAtom)
  const setDraft = useSetAtom(selectedDraftIdAtom)
  const [pending, setPending] = useState<{
    request: BoardTaskChatRequest & { localProjectId: string }
    preview: Awaited<ReturnType<typeof trpcClient.projectRecords.previewTaskChat.query>>
  } | null>(null)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const utils = trpc.useUtils()
  useEffect(() => {
    if (!host.current) return
    const destination = navigationRef.current
    return mountBoard(host.current, {
      embedded: true,
      view: yapReview
        ? "yap"
        : initialView === "fleet"
          ? "fleet"
          : destination?.view === "setups"
            ? "setups"
            : destination?.view === "yap"
              ? "yap"
              : "board",
      selectedProposalRef:
        yapReview?.proposalId || yapReview?.proposalIds?.[0]
          ? { proposalId: yapReview.proposalId || yapReview.proposalIds?.[0] }
          : (destination?.proposalRef ?? null),
      selectedTaskRef: destination?.taskRef ?? null,
      selectedSetupRef: destination?.setupRef ?? null,
      selectedAgentRef: destination?.agentRef ?? null,
      onNavigate: (next) => {
        setNavigation(next)
        setDesktopView(next.view === "fleet" ? "orchestration-fleet" : "tasks")
      },
      onOpenTaskChat: async (task) => {
        const project = projectRef.current
        if (!project)
          throw new Error("Select a local project in the sidebar, then open the task again.")
        const request = { ...task, localProjectId: project.id }
        const preview = await trpcClient.projectRecords.previewTaskChat.query(request)
        setOpenError(null)
        setPending({ request, preview })
      },
      request: async (path, options = {}) => {
        const result = await trpcClient.projectRecords.boardRequest.mutate({
          path,
          method: options.method === "POST" ? "POST" : "GET",
          body: typeof options.body === "string" ? options.body : undefined,
        })
        return new Response(result.body, {
          status: result.status,
          headers: { "Content-Type": result.contentType },
        })
      },
    })
    // The shared controller owns navigation and in-progress form drafts until
    // the native route changes. Remounting for every callback loses those drafts.
  }, [initialView, setDesktopView, setNavigation, yapReview])
  const openChat = async () => {
    if (!pending || opening) return
    setOpening(true)
    setOpenError(null)
    try {
      const result = await trpcClient.projectRecords.openTaskChat.mutate({
        ...pending.request,
        expectedTarget: pending.preview.expectedTarget,
      })
      await utils.chats.invalidate()
      setRemote(false)
      setDraft(null)
      setScope({
        type: "project",
        id: pending.preview.projectId,
        name: pending.preview.projectName,
      })
      setOpenChatIds((current) =>
        current.includes(result.chatId) ? current : [...current, result.chatId],
      )
      setSelectedChatId(result.chatId)
      setShowNewChatForm(false)
      setPending(null)
      setDesktopView(null)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Could not open the worktree Chat.")
    } finally {
      setOpening(false)
    }
  }
  return (
    <>
      <div
        ref={host}
        className="h-full min-h-0 overflow-auto"
        aria-label="Project records workspace"
      />
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !opening) setPending(null)
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          aria-describedby={undefined}
          showCloseButton={!opening}
        >
          <DialogHeader>
            <DialogTitle>
              {pending?.preview.existingChatId ? "Open worktree Chat" : "Create worktree Chat"}
            </DialogTitle>
          </DialogHeader>
          {pending && (
            <dl className="grid min-w-0 gap-2 text-sm">
              <dt className="font-medium">Local repository</dt>
              <dd className="break-all">{pending.preview.projectPath}</dd>
              <dt className="font-medium">Branch</dt>
              <dd className="break-all">{pending.preview.branch}</dd>
              <dt className="font-medium">Starting commit</dt>
              <dd className="break-all">{pending.preview.baseCommit}</dd>
              <dt className="font-medium">Worktree</dt>
              <dd className="break-all">{pending.preview.worktreePath}</dd>
            </dl>
          )}
          {openError && (
            <p role="alert" className="break-words text-sm text-destructive">
              {openError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={opening} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button disabled={opening} onClick={() => void openChat()}>
              {opening
                ? "Opening…"
                : pending?.preview.existingChatId
                  ? "Open Chat"
                  : "Create and open Chat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
