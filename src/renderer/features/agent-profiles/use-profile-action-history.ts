import { toast } from "sonner"
import { trpc, trpcClient } from "../../lib/trpc"
import { recordAppAction, invalidateAppActionRedo } from "../../lib/app-action-history"

export function useProfileActionHistory() {
  const utils = trpc.useUtils()
  return (
    kind: "profiles" | "personalities",
    result: {
      history?: { actionId: string } | null
      historyUnavailable?: string | null
    },
    label: string,
  ) => {
    const receipt = result.history
    if (!receipt) {
      if (result.historyUnavailable) {
        invalidateAppActionRedo()
        toast.info(result.historyUnavailable)
      }
      return
    }
    let sequence = 1
    const apply = async (direction: "undo" | "redo") => {
      const input = { actionId: receipt.actionId, direction, sequence }
      const acknowledgment =
        kind === "profiles"
          ? await trpcClient.agentProfiles.applyHistory.mutate(input)
          : await trpcClient.agentPersonalities.applyHistory.mutate(input)
      if (acknowledgment.sequence !== sequence || acknowledgment.direction !== direction)
        throw new Error("Profile history acknowledgment did not match. Retry this action.")
      sequence += 1
      if (kind === "profiles") {
        try {
          const channel = new BroadcastChannel("flapstack-agent-profiles-v1")
          try {
            channel.postMessage({ kind: "changed" })
          } finally {
            channel.close()
          }
        } catch {
          toast.error(
            "Change restored, but other windows could not be notified. Refresh them to see it.",
          )
        }
      }
      try {
        if (kind === "profiles") {
          await Promise.all([
            utils.agentProfiles.list.invalidate(undefined, undefined, { throwOnError: true }),
            utils.agentProfiles.get.invalidate(undefined, undefined, { throwOnError: true }),
            utils.agentProfiles.diagnostics.invalidate(undefined, undefined, {
              throwOnError: true,
            }),
          ])
        } else {
          await Promise.all([
            utils.agentPersonalities.list.invalidate(undefined, undefined, { throwOnError: true }),
            utils.agentPersonalities.get.invalidate(undefined, undefined, { throwOnError: true }),
          ])
        }
      } catch {
        toast.error(
          "Change restored, but the editor could not refresh. Retry its reads; unsaved drafts are kept.",
        )
      }
    }
    recordAppAction({ label, undo: () => apply("undo"), redo: () => apply("redo") })
  }
}
