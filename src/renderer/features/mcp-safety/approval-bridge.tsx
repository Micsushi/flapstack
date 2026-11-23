"use client"

import { toast } from "sonner"
import { useEffect } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { openAgentChatIdsAtom, selectedAgentChatIdAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { useDocumentVisible } from "../../hooks/use-document-visible"
import { McpApprovalSurface } from "./approval-ui"

export function McpApprovalBridge() {
  const activeChatId = useAtomValue(selectedAgentChatIdAtom)
  const setActiveChatId = useSetAtom(selectedAgentChatIdAtom)
  const setOpenChatIds = useSetAtom(openAgentChatIdsAtom)
  // This poller is mounted for the lifetime of every window, so a hidden window
  // would otherwise wake the main process twice a second forever.
  const isVisible = useDocumentVisible()
  const pending = trpc.appControl.listPendingApprovals.useQuery(undefined, {
    refetchInterval: isVisible ? 500 : false,
  })
  const utils = trpc.useUtils()

  // Approvals block an agent, so catch up immediately on becoming visible
  // instead of waiting for the next tick (refetchOnWindowFocus is globally off).
  const refetchPending = pending.refetch
  useEffect(() => {
    if (isVisible) void refetchPending()
  }, [isVisible, refetchPending])
  const decide = trpc.appControl.decideApproval.useMutation()

  return (
    <McpApprovalSurface
      approvals={pending.data ?? []}
      activeChatId={activeChatId}
      onOpenChat={(chatId) => {
        setOpenChatIds((current) => (current.includes(chatId) ? current : [...current, chatId]))
        setActiveChatId(chatId)
      }}
      onDecision={async (action) => {
        const result = await decide.mutateAsync(action).catch((error) => {
          toast.error(
            "Could not confirm your decision. Check whether the request is still pending before trying again.",
          )
          throw error
        })
        if (!result.resolved)
          toast.info(
            "This request is no longer available. It may have expired or been handled elsewhere.",
          )
        // The decision is already settled. A failed refresh must not change its outcome.
        void utils.appControl.listPendingApprovals.invalidate().catch(() => undefined)
        return result
      }}
    />
  )
}
