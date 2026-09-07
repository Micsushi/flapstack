import { useEffect, useRef } from "react"
import { trpc } from "../../../lib/trpc"
import { matchesRootedFileChange, type RootedFileTarget } from "../../../lib/file-target"

/** Text and Markdown previews share the same native-path refresh contract. */
export function useFileChangeRefresh(target: RootedFileTarget | null, refetch: () => unknown) {
  const refetchRef = useRef(refetch)
  useEffect(() => {
    refetchRef.current = refetch
  }, [refetch])
  trpc.files.watchChanges.useSubscription(
    { projectPath: target?.rootPath ?? "" },
    {
      enabled: !!target,
      onData: (change) => {
        if (matchesRootedFileChange(target, change.filename)) refetchRef.current()
      },
    },
  )
}
