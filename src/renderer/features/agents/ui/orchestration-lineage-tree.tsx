"use client"

import { useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import type { OrchestrationLineageDto } from "../../../../shared/agent-orchestration"
import { Button } from "../../../components/ui/button"

export function OrchestrationLineageTree({
  lineage,
  onNavigate,
  currentChatId,
}: {
  lineage: OrchestrationLineageDto
  onNavigate: (chatId: string) => void
  currentChatId?: string
}) {
  const nodes = useMemo(
    () =>
      [...lineage.nodes].sort(
        (a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.name.localeCompare(b.name),
      ),
    [lineage.nodes],
  )
  const [focusedId, setFocusedId] = useState(nodes[0]?.agentId ?? "")
  const refs = useRef(new Map<string, HTMLLIElement>())
  const currentNode = nodes.find((node) => node.chatId === currentChatId)
  const focus = (id: string) => {
    setFocusedId(id)
    queueMicrotask(() => refs.current.get(id)?.focus())
  }
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    if (event.target !== event.currentTarget || nodes.length === 0) return
    let next = index
    if (event.key === "ArrowDown") next = Math.min(nodes.length - 1, index + 1)
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1)
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = nodes.length - 1
    else return
    event.preventDefault()
    focus(nodes[next]!.agentId)
  }
  return (
    <section aria-label="Rich agent lineage" className="rounded-md border border-border/60 p-2">
      <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">
        Lineage · {lineage.engine?.engine ?? "legacy"}
      </div>
      <ul role="tree" aria-label="Orchestration lineage tree" className="space-y-1">
        {nodes.map((node, index) => {
          const reasonId = `lineage-controls-${node.agentId}`
          const chatState = node.chatState ?? (node.chatId ? "live" : "missing")
          const relationship = !currentNode
            ? "child"
            : node.parentAgentId === currentNode.agentId
              ? "child"
              : currentNode.parentAgentId === node.agentId
                ? "parent"
                : "agent"
          return (
            <li
              key={node.agentId}
              ref={(element) => {
                if (element) refs.current.set(node.agentId, element)
                else refs.current.delete(node.agentId)
              }}
              role="treeitem"
              aria-level={Math.max(1, (node.depth ?? 0) + 1)}
              aria-selected={focusedId === node.agentId}
              tabIndex={focusedId === node.agentId ? 0 : -1}
              onFocus={() => setFocusedId(node.agentId)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="rounded border border-border/50 p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-1 text-[10px]">
                <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
                <span>{node.status}</span>
                {node.stale && <span>stale</span>}
                {node.orphaned && <span>orphan</span>}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {node.role} · {node.harness ?? "unknown"} · {chatState}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {node.chatId && chatState === "live" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px]"
                    onClick={() => onNavigate(node.chatId!)}
                    aria-label={`Open ${relationship} agent chat ${node.name}`}
                  >
                    Open chat
                  </Button>
                )}
                {(["send", "followUp", "interrupt"] as const).map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px]"
                    disabled={!node.controls?.[action]?.enabled}
                    aria-describedby={reasonId}
                  >
                    {action === "followUp"
                      ? "Follow up"
                      : action[0]!.toUpperCase() + action.slice(1)}
                  </Button>
                ))}
              </div>
              <p id={reasonId} className="mt-1 text-[9px] text-muted-foreground">
                {node.controls?.send?.reason ?? "Controls unavailable."}
              </p>
            </li>
          )
        })}
      </ul>
      <ol aria-label="Coordination messages" className="mt-2 space-y-1 text-[9px]">
        {(lineage.messages ?? []).map((message) => (
          <li key={message.id}>
            {message.kind} · {message.direction} · {message.state}
            {message.body ? ` · ${message.body}` : ""}
          </li>
        ))}
      </ol>
    </section>
  )
}
