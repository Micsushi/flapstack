import { useEffect, useRef } from "react"
import { atom, useAtom, useSetAtom } from "jotai"
import type { BoardNavigation, BoardView } from "@project-records/board"
import { mountBoard } from "@project-records/board"
import { trpcClient } from "../../lib/trpc"
import { desktopViewAtom } from "../agents/atoms"
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
  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-auto"
      aria-label="Project records workspace"
    />
  )
}
