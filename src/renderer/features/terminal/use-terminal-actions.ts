import { useCallback, useEffect, useRef, useState } from "react"
import { useStore } from "jotai"
import { toast } from "sonner"
import { trpc } from "@/lib/trpc"
import { activeTerminalForScopeAtomFamily, terminalsForScopeAtomFamily } from "./atoms"
import { isSharedTerminalScope } from "./utils"

export function useTerminalClose(scopeKey: string) {
  const store = useStore()
  const { mutateAsync: kill } = trpc.terminal.kill.useMutation()
  const pending = useRef(new Set<string>())

  return useCallback(
    async (ids: string[]) => {
      const terminalsAtom = terminalsForScopeAtomFamily(scopeKey)
      const activeAtom = activeTerminalForScopeAtomFamily(scopeKey)
      const targets = store.get(terminalsAtom).filter((terminal) => ids.includes(terminal.id))
      await Promise.all(
        targets.map(async (terminal) => {
          if (pending.current.has(terminal.paneId)) return
          pending.current.add(terminal.paneId)
          try {
            await kill({ paneId: terminal.paneId })
            // Keep newer tabs and selection, including when the view has changed scopes.
            const remaining = store
              .get(terminalsAtom)
              .filter((item) => item.paneId !== terminal.paneId)
            store.set(terminalsAtom, remaining)
            if (store.get(activeAtom) === terminal.id) {
              store.set(activeAtom, remaining[remaining.length - 1]?.id ?? null)
            }
          } catch (error) {
            toast.error(`Could not close ${terminal.name}. Try closing it again.`, {
              description: error instanceof Error ? error.message : "The stop request failed",
            })
          } finally {
            pending.current.delete(terminal.paneId)
          }
        }),
      )
    },
    [scopeKey, store, kill],
  )
}

export function useTerminalDiscovery(
  scopeKey: string,
  enabled: boolean,
  terminalCount: number,
  createTerminal: () => void,
) {
  const store = useStore()
  const utils = trpc.useUtils()
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || terminalCount > 0) return
    const terminalsAtom = terminalsForScopeAtomFamily(scopeKey)
    if (store.get(terminalsAtom).length > 0) return
    setFailure(null)
    if (!isSharedTerminalScope(scopeKey)) {
      createTerminal()
      return
    }
    let cancelled = false
    void utils.terminal.listSessionsByScopeKey
      .fetch({ scopeKey })
      .then((sessions) => {
        if (cancelled || store.get(terminalsAtom).length > 0) return
        if (sessions.length === 0) {
          createTerminal()
          return
        }
        const instances = sessions.map((session, index) => ({
          id: session.paneId.split(":term:")[1] || crypto.randomUUID().slice(0, 8),
          paneId: session.paneId,
          name: `Terminal ${index + 1}`,
          createdAt: session.lastActive,
        }))
        store.set(terminalsAtom, instances)
        store.set(activeTerminalForScopeAtomFamily(scopeKey), instances[0]!.id)
      })
      .catch((error: unknown) => {
        if (cancelled || store.get(terminalsAtom).length > 0) return
        setFailure({
          scope: scopeKey,
          message: error instanceof Error ? error.message : "The request failed",
        })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, terminalCount, scopeKey, createTerminal, utils, store, attempt])
  return {
    error: enabled && terminalCount === 0 && failure?.scope === scopeKey ? failure.message : null,
    retry: () => setAttempt((value) => value + 1),
  }
}
