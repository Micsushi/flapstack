"use client"

import { useAtomValue, useSetAtom } from "jotai"
import { openAgentChatIdsAtom, selectedAgentChatIdAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { McpApprovalSurface } from "./approval-ui"

export function McpApprovalBridge() {
  const activeChatId = useAtomValue(selectedAgentChatIdAtom)
  const setActiveChatId = useSetAtom(selectedAgentChatIdAtom)
  const setOpenChatIds = useSetAtom(openAgentChatIdsAtom)
  const pending = trpc.appControl.listPendingApprovals.useQuery(undefined, {
    refetchInterval: 500,
  })
  const utils = trpc.useUtils()
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
        const result = await decide.mutateAsync(action)
        await utils.appControl.listPendingApprovals.invalidate()
        return result
      }}
    />
  )
}
