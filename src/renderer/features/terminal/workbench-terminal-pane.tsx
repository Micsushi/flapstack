import { useEffect, useMemo } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useTheme } from "next-themes"
import { fullThemeDataAtom } from "@/lib/atoms"
import { Terminal } from "./terminal"
import { activeTerminalIdAtom, terminalsAtom } from "./atoms"
import { getDefaultTerminalBg } from "./helpers"
import type { TerminalInstance } from "./types"

export function WorkbenchTerminalPane({
  chatId,
  cwd,
}: {
  chatId: string
  cwd: string | null | undefined
}) {
  const scopeKey = `ws:${chatId}`
  const [terminalsByScope, setTerminalsByScope] = useAtom(terminalsAtom)
  const [activeIds, setActiveIds] = useAtom(activeTerminalIdAtom)
  const fullThemeData = useAtomValue(fullThemeDataAtom)
  const { resolvedTheme } = useTheme()
  const terminal = terminalsByScope[scopeKey]?.[0] ?? null

  useEffect(() => {
    if (terminal || !cwd) return
    const id = crypto.randomUUID().slice(0, 8)
    const instance: TerminalInstance = {
      id,
      paneId: `${scopeKey}:term:${id}`,
      name: "Terminal",
      createdAt: Date.now(),
    }
    setTerminalsByScope((current) => ({ ...current, [scopeKey]: [instance] }))
    setActiveIds((current) => ({ ...current, [scopeKey]: id }))
  }, [cwd, scopeKey, setActiveIds, setTerminalsByScope, terminal])

  useEffect(() => {
    if (!terminal || activeIds[scopeKey] === terminal.id) return
    setActiveIds((current) => ({ ...current, [scopeKey]: terminal.id }))
  }, [activeIds, scopeKey, setActiveIds, terminal])

  const terminalBg = useMemo(
    () =>
      fullThemeData?.colors?.["terminal.background"] ??
      fullThemeData?.colors?.["editor.background"] ??
      getDefaultTerminalBg(resolvedTheme === "dark"),
    [fullThemeData, resolvedTheme],
  )

  if (!cwd) {
    return (
      <div className="flex h-full min-h-48 min-w-72 items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
        This chat does not have a local workspace for a Terminal.
      </div>
    )
  }

  return (
    <div
      className="h-full min-h-48 min-w-72 overflow-hidden"
      style={{ backgroundColor: terminalBg }}
      data-workbench-terminal={chatId}
    >
      {terminal ? (
        <Terminal
          paneId={terminal.paneId}
          cwd={cwd}
          workspaceId={chatId}
          scopeKey={scopeKey}
          initialCwd={cwd}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Starting Terminalâ€¦
        </div>
      )}
    </div>
  )
}
