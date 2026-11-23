import { useEffect } from "react"
import { trpcClient } from "../../../lib/trpc"
import type { RunPermissionMode } from "../../../../shared/harness-types"

export function useCheckpointPreparation(
  scope: "chat" | "project" | "task",
  id: string | null | undefined,
  path: string | null | undefined,
  permissionMode: RunPermissionMode,
  subChatId?: string,
) {
  useEffect(() => {
    if (!id || !path || permissionMode === "read-only") return
    const lease = crypto.randomUUID()
    void trpcClient.runs.prepareSelectedCheckout
      .mutate({ scope, id, path, permissionMode, lease, subChatId })
      .catch(() => {})
    return () => {
      void trpcClient.runs.prepareSelectedCheckout
        .mutate({ scope: "release", lease })
        .catch(() => {})
    }
  }, [scope, id, path, permissionMode, subChatId])
}
