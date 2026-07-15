import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { ExternalLink, Pin, Play, Trash2 } from "lucide-react"
import {
  savedWorkspacePaneBindingSchema,
  savedWorkspacePinnedContextSchema,
  type SavedWorkspaceOperationProjection,
  type SavedWorkspacePaneBinding,
  type SavedWorkspacePinnedContext,
} from "../../../shared/saved-workspaces"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { ChangesPanel } from "../changes"
import { FileViewerSidebar } from "../file-viewer"
import { Terminal } from "../terminal"
import { trpc } from "../../lib/trpc"
import type { SavedWorkspacePane } from "./layout-reducer"
import { WorkspacePaneOwnershipBoundary } from "./workspace-window-ownership"

export function WorkspacePaneAdapter({
  projectId,
  workspaceId,
  pane,
  ownershipChatIds,
  initiallySkipped,
  ...callbacks
}: WorkspacePaneAdapterProps & {
  projectId?: string
  ownershipChatIds?: string[]
  initiallySkipped?: boolean
}) {
  return (
    <WorkspacePaneOwnershipBoundary
      projectId={projectId}
      workspaceId={workspaceId}
      pane={pane}
      chatIds={ownershipChatIds}
      initiallySkipped={initiallySkipped}
    >
      <WorkspacePaneAdapterContent workspaceId={workspaceId} pane={pane} {...callbacks} />
    </WorkspacePaneOwnershipBoundary>
  )
}

type WorkspacePaneAdapterProps = {
  workspaceId: string
  pane: SavedWorkspacePane
  readOnly?: boolean
  onReplaceBinding: (binding: SavedWorkspacePaneBinding) => void
  onRemove: () => void
  onPinContext: (context: SavedWorkspacePinnedContext) => void
  onUnpinContext: (contextId: string) => void
  onSelectOperationAgent?: (orchestrationId: string, agentId: string) => void
}

function WorkspacePaneAdapterContent({
  workspaceId,
  pane,
  onReplaceBinding,
  onRemove,
  onPinContext,
  onUnpinContext,
  onSelectOperationAgent,
  readOnly = false,
}: WorkspacePaneAdapterProps) {
  const resolution = trpc.savedWorkspaces.resolvePane.useQuery({ workspaceId, paneId: pane.id })

  if (resolution.isLoading) {
    return <PaneStatus title="Restoring pane">Checking the saved target…</PaneStatus>
  }
  if (resolution.error) {
    return <PaneStatus title="Pane unavailable">{resolution.error.message}</PaneStatus>
  }
  if (!resolution.data || resolution.data.state !== "ready") {
    return (
      <div className="h-full overflow-auto p-4">
        <PaneStatus
          title={resolution.data?.state === "missing" ? "Pane target missing" : "Pane target stale"}
        >
          {resolution.data?.message ?? "The saved target could not be restored."}
        </PaneStatus>
        {readOnly ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Restore this archived workspace before repairing or removing panes.
          </p>
        ) : (
          <>
            <WorkspacePaneBindingForm
              initialBinding={pane.binding}
              submitLabel="Repair pane"
              onSubmit={onReplaceBinding}
            />
            <Button type="button" variant="outline" className="mt-3" onClick={onRemove}>
              <Trash2 className="mr-1 h-4 w-4" /> Remove pane
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-workspace-pane-adapter={pane.binding.type}>
      <PinnedContextBar
        resolutions={resolution.data.pinnedContext}
        onUnpin={readOnly ? undefined : onUnpinContext}
      />
      <div className="min-h-0 flex-1">
        <ReadyPane
          workspaceId={workspaceId}
          pane={pane}
          terminalCwd={resolution.data.terminalCwd}
          readOnly={readOnly}
          onRemove={onRemove}
          onSelectOperationAgent={readOnly ? undefined : onSelectOperationAgent}
        />
      </div>
      {!readOnly && (
        <details className="shrink-0 border-t border-border bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer select-none font-medium">
            <Pin className="mr-1 inline h-3.5 w-3.5" /> Pin context
          </summary>
          <PinnedContextForm pane={pane} onSubmit={onPinContext} />
        </details>
      )}
    </div>
  )
}

function ReadyPane({
  workspaceId,
  pane,
  terminalCwd,
  readOnly,
  onRemove,
  onSelectOperationAgent,
}: {
  workspaceId: string
  pane: SavedWorkspacePane
  terminalCwd: string | null
  readOnly: boolean
  onRemove: () => void
  onSelectOperationAgent?: (orchestrationId: string, agentId: string) => void
}) {
  switch (pane.binding.type) {
    case "chat":
      return <WorkspaceChatPane chatId={pane.binding.chatId} />
    case "terminal":
      return terminalCwd ? (
        <WorkspaceTerminalPane
          workspaceId={workspaceId}
          pane={pane}
          terminalCwd={terminalCwd}
          readOnly={readOnly}
        />
      ) : (
        <PaneStatus title="Terminal unavailable">Verified terminal directory missing.</PaneStatus>
      )
    case "file":
      return pane.binding.worktreePath ? (
        readOnly ? (
          <ArchivedFileReferencePane path={pane.binding.path} />
        ) : (
          <FileViewerSidebar
            filePath={pane.binding.path}
            projectPath={pane.binding.worktreePath}
            onClose={onRemove}
          />
        )
      ) : null
    case "diff":
      return <ChangesPanel worktreePath={pane.binding.worktreePath} />
    case "browser":
      return <WorkspaceBrowserPane url={pane.binding.url} />
    case "agent-roster":
    case "selected-agent":
    case "activity":
      return (
        <WorkspaceOperationPane
          workspaceId={workspaceId}
          binding={pane.binding}
          onSelectAgent={onSelectOperationAgent}
        />
      )
  }
}

export function ArchivedFileReferencePane({ path }: { path: string }) {
  return (
    <PaneStatus title="Archived file reference">
      <p className="break-all">{path}</p>
      <p className="mt-2">Restore this workspace before opening or closing its file pane.</p>
    </PaneStatus>
  )
}

function WorkspaceOperationPane({
  workspaceId,
  binding,
  onSelectAgent,
}: {
  workspaceId: string
  binding: Extract<
    SavedWorkspacePaneBinding,
    { type: "agent-roster" | "selected-agent" | "activity" }
  >
  onSelectAgent?: (orchestrationId: string, agentId: string) => void
}) {
  const operation = trpc.savedWorkspaces.getOperation.useQuery(
    { workspaceId },
    { refetchInterval: 5_000 },
  )
  if (operation.isLoading) {
    return <PaneStatus title="Restoring operation">Reading durable agent lineage…</PaneStatus>
  }
  if (operation.error || !operation.data) {
    return (
      <PaneStatus title="Operation unavailable">
        {operation.error?.message ?? "The operation workspace could not be projected."}
      </PaneStatus>
    )
  }
  if (operation.data.orchestrationId !== binding.orchestrationId) {
    return (
      <PaneStatus title="Operation identity stale">
        Repair this pane before using agent controls.
      </PaneStatus>
    )
  }
  if (binding.type === "agent-roster") {
    return (
      <OperationRosterPane
        operation={operation.data}
        onSelectAgent={
          onSelectAgent ? (agentId) => onSelectAgent(binding.orchestrationId, agentId) : undefined
        }
      />
    )
  }
  if (binding.type === "selected-agent") {
    return <OperationSelectedAgentPane operation={operation.data} agentId={binding.agentId} />
  }
  return <OperationActivityPane operation={operation.data} />
}

export function OperationRosterPane({
  operation,
  onSelectAgent,
}: {
  operation: SavedWorkspaceOperationProjection
  onSelectAgent?: (agentId: string) => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Operation agent navigator">
      <header className="shrink-0 border-b border-border px-3 py-2">
        <h3 className="truncate text-sm font-medium">{operation.taskName}</h3>
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {operation.materializedAgentCount} agent chats ready · {operation.pendingAgentCount}{" "}
          pending
          {operation.overflowChatCount > 0
            ? ` · ${operation.overflowChatCount} chats use navigator overflow`
            : ""}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="mb-2 rounded border bg-muted/20 px-2 py-1.5 text-xs">
          Lead · {operation.initiatingChatName || "Initiating chat"}
        </div>
        <ul className="space-y-1" aria-label="Operation agents">
          {operation.agents.map((agent) => (
            <li key={agent.agentId}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!agent.chatId || !onSelectAgent}
                aria-label={
                  !onSelectAgent
                    ? `${agent.name} selection is read-only`
                    : agent.chatId
                      ? `Show ${agent.name} in selected agent pane`
                      : `${agent.name} chat is not ready`
                }
                onClick={() => onSelectAgent?.(agent.agentId)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{agent.name}</span>
                  <span className="block truncate text-muted-foreground">
                    {agent.role} · {agent.status}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{agent.progressPercent}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function OperationSelectedAgentPane({
  operation,
  agentId,
}: {
  operation: SavedWorkspaceOperationProjection
  agentId: string | null
}) {
  if (!agentId) {
    return (
      <PaneStatus title="Select an agent">
        Use the agent navigator to show one descendant chat here.
      </PaneStatus>
    )
  }
  const agent = operation.agents.find((candidate) => candidate.agentId === agentId)
  if (!agent) {
    return <PaneStatus title="Selected agent missing">Repair the saved selection.</PaneStatus>
  }
  if (!agent.chatId) {
    return (
      <PaneStatus title={`${agent.name} is ${agent.status}`}>
        The durable agent exists, but its chat has not materialized yet.
      </PaneStatus>
    )
  }
  if (agent.chatState === "archived") {
    return (
      <PaneStatus title={`${agent.name} chat archived`}>
        The agent remains in lineage. Restore its chat or select another agent.
      </PaneStatus>
    )
  }
  return <WorkspaceChatPane chatId={agent.chatId} />
}

export function OperationActivityPane({
  operation,
}: {
  operation: SavedWorkspaceOperationProjection
}) {
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Operation status and artifacts">
      <header className="shrink-0 border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium">Operation {operation.status}</h3>
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {operation.agents.length} agents · {operation.materializedAgentCount} chats materialized
        </p>
      </header>
      <ul
        className="min-h-0 flex-1 space-y-2 overflow-auto p-2"
        aria-label="Agent status summaries"
      >
        {operation.agents.map((agent) => (
          <li key={agent.agentId} className="rounded border p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <strong className="truncate">{agent.name}</strong>
              <span className="shrink-0">{agent.status}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {agent.resultSummary ||
                agent.stopReason ||
                "No durable result or artifact summary yet."}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function WorkspaceChatPane({ chatId }: { chatId: string }) {
  const chat = trpc.chats.get.useQuery({ id: chatId })
  const messages = useMemo(() => {
    if (!chat.data) return []
    return chat.data.subChats.flatMap((subChat) => parseMessages(subChat.messages)).slice(-100)
  }, [chat.data])

  if (chat.isLoading)
    return <PaneStatus title="Loading chat">Reading current chat data…</PaneStatus>
  if (!chat.data) return <PaneStatus title="Chat missing">The bound chat was removed.</PaneStatus>
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={`Chat ${chat.data.name ?? chatId}`}
    >
      <header className="shrink-0 border-b border-border px-3 py-2">
        <h3 className="truncate text-sm font-medium">{chat.data.name || "Chat"}</h3>
        <p className="truncate text-xs text-muted-foreground">
          {chat.data.worktreePath || "No worktree"} · current durable transcript
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved messages.</p>
        ) : (
          messages.map((message, index) => (
            <article key={message.id ?? `${message.role}-${index}`} className="rounded border p-2">
              <p className="mb-1 text-xs font-medium capitalize">{message.role}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
            </article>
          ))
        )}
      </div>
    </section>
  )
}

export function WorkspaceTerminalPane({
  workspaceId,
  pane,
  terminalCwd,
  readOnly = false,
}: {
  workspaceId: string
  pane: SavedWorkspacePane
  terminalCwd: string
  readOnly?: boolean
}) {
  const [started, setStarted] = useState(false)
  if (pane.binding.type !== "terminal") return null
  if (readOnly) {
    return (
      <PaneStatus title="Archived terminal metadata">
        Restore this workspace before starting a new terminal process.
      </PaneStatus>
    )
  }
  if (!started) {
    return (
      <PaneStatus title="Terminal metadata restored">
        <p>No PTY process was restored. Starting creates a fresh terminal in {terminalCwd}.</p>
        <Button type="button" className="mt-3" onClick={() => setStarted(true)}>
          <Play className="mr-1 h-4 w-4" /> Start fresh terminal
        </Button>
      </PaneStatus>
    )
  }
  return (
    <Terminal
      paneId={`saved-workspace:${workspaceId}:term:${pane.id}`}
      cwd={terminalCwd}
      initialCwd={terminalCwd}
      workspaceId={workspaceId}
      scopeKey={`saved-workspace:${workspaceId}`}
      tabId={pane.id}
    />
  )
}

function WorkspaceBrowserPane({ url }: { url: string }) {
  const openExternal = trpc.external.openExternal.useMutation()
  return (
    <PaneStatus title="Web link">
      <p className="break-all">{url}</p>
      <Button
        type="button"
        className="mt-3"
        disabled={openExternal.isPending}
        onClick={() => openExternal.mutate(url)}
      >
        <ExternalLink className="mr-1 h-4 w-4" /> Open in browser
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Saved workspaces do not embed a remote browser service.
      </p>
    </PaneStatus>
  )
}

function PinnedContextBar({
  resolutions,
  onUnpin,
}: {
  resolutions: Array<{
    id: string
    state: "ready" | "missing" | "stale"
    label: string
    message: string
  }>
  onUnpin?: (contextId: string) => void
}) {
  if (resolutions.length === 0) return null
  return (
    <aside className="shrink-0 border-b border-border bg-muted/20 p-2" aria-label="Pinned context">
      <ul className="flex flex-wrap gap-2">
        {resolutions.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-1 rounded border bg-background px-2 py-1"
          >
            <span className="max-w-48 truncate" title={item.message}>
              {item.label} · {item.state}
            </span>
            {onUnpin && (
              <button
                type="button"
                className="rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Unpin ${item.label}`}
                onClick={() => onUnpin(item.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}

function PinnedContextForm({
  pane,
  onSubmit,
}: {
  pane: SavedWorkspacePane
  onSubmit: (context: SavedWorkspacePinnedContext) => void
}) {
  const [type, setType] = useState<"file" | "chat-message" | "browser">("file")
  const [first, setFirst] = useState("")
  const [second, setSecond] = useState("")
  const [error, setError] = useState("")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const id = `context-${crypto.randomUUID()}`
    const value =
      type === "file"
        ? { id, type, path: first, worktreePath: second, line: null }
        : type === "chat-message"
          ? { id, type, chatId: first, messageId: second }
          : { id, type, url: first }
    const parsed = savedWorkspacePinnedContextSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Pinned context is invalid.")
      return
    }
    if ((pane.pinnedContext ?? []).length >= 64) {
      setError("A pane can pin at most 64 context items.")
      return
    }
    onSubmit(parsed.data)
    setFirst("")
    setSecond("")
    setError("")
  }
  return (
    <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={submit}>
      <select
        aria-label="Pinned context type"
        value={type}
        onChange={(event) => setType(event.target.value as typeof type)}
        className="h-8 rounded border border-input bg-background px-2"
      >
        <option value="file">File</option>
        <option value="chat-message">Chat message</option>
        <option value="browser">Web link</option>
      </select>
      <Input
        aria-label={
          type === "file"
            ? "Pinned file path"
            : type === "browser"
              ? "Pinned URL"
              : "Pinned chat ID"
        }
        value={first}
        onChange={(event) => setFirst(event.target.value)}
        placeholder={type === "browser" ? "https://…" : type === "file" ? "src/file.ts" : "Chat ID"}
      />
      {type !== "browser" && (
        <Input
          aria-label={type === "file" ? "Pinned file worktree" : "Pinned message ID"}
          value={second}
          onChange={(event) => setSecond(event.target.value)}
          placeholder={type === "file" ? "Worktree path" : "Message ID"}
        />
      )}
      <Button type="submit" size="sm" variant="outline">
        Pin
      </Button>
      {error && (
        <p className="text-destructive sm:col-span-3" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

export function WorkspacePaneBindingForm({
  initialBinding,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialBinding?: SavedWorkspacePaneBinding
  submitLabel: string
  onSubmit: (binding: SavedWorkspacePaneBinding) => void
  onCancel?: () => void
}) {
  const initial = bindingFields(initialBinding)
  const [type, setType] = useState<SavedWorkspacePaneBinding["type"]>(initial.type)
  const [primary, setPrimary] = useState(initial.primary)
  const [worktree, setWorktree] = useState(initial.worktree)
  const [error, setError] = useState("")
  const supported = ["chat", "terminal", "file", "diff", "browser"] as const

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value: unknown =
      type === "chat"
        ? { type, chatId: primary }
        : type === "terminal"
          ? { type, cwd: primary, worktreePath: worktree || null, restorePolicy: "prompt" }
          : type === "file"
            ? { type, path: primary, worktreePath: worktree || null, line: null }
            : type === "diff"
              ? { type, worktreePath: worktree || primary, baseRef: null, targetRef: null }
              : { type: "browser", url: primary }
    const parsed = savedWorkspacePaneBindingSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Pane binding is invalid.")
      return
    }
    setError("")
    onSubmit(parsed.data)
  }

  return (
    <form className="mt-3 grid gap-2 rounded border border-border p-3" onSubmit={submit}>
      <label className="grid gap-1 text-xs font-medium">
        Pane type
        <select
          value={supported.includes(type as (typeof supported)[number]) ? type : "chat"}
          onChange={(event) => {
            setType(event.target.value as SavedWorkspacePaneBinding["type"])
            setPrimary("")
            setWorktree("")
          }}
          className="h-9 rounded border border-input bg-background px-2 text-sm"
        >
          <option value="chat">Chat</option>
          <option value="terminal">Terminal</option>
          <option value="file">File/editor</option>
          <option value="diff">Diff</option>
          <option value="browser">Web link</option>
        </select>
      </label>
      {type !== "diff" && (
        <label className="grid gap-1 text-xs font-medium">
          {primaryLabel(type)}
          <Input value={primary} onChange={(event) => setPrimary(event.target.value)} />
        </label>
      )}
      {(type === "terminal" || type === "file" || type === "diff") && (
        <label className="grid gap-1 text-xs font-medium">
          Worktree path
          <Input value={worktree} onChange={(event) => setWorktree(event.target.value)} />
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function bindingFields(binding?: SavedWorkspacePaneBinding) {
  if (!binding) return { type: "chat" as const, primary: "", worktree: "" }
  switch (binding.type) {
    case "chat":
      return { type: binding.type, primary: binding.chatId, worktree: "" }
    case "terminal":
      return { type: binding.type, primary: binding.cwd, worktree: binding.worktreePath ?? "" }
    case "file":
      return { type: binding.type, primary: binding.path, worktree: binding.worktreePath ?? "" }
    case "diff":
      return { type: binding.type, primary: "", worktree: binding.worktreePath }
    case "browser":
      return { type: binding.type, primary: binding.url, worktree: "" }
    default:
      return { type: "chat" as const, primary: "", worktree: "" }
  }
}

function primaryLabel(type: SavedWorkspacePaneBinding["type"]): string {
  if (type === "chat") return "Chat ID"
  if (type === "terminal") return "Fresh terminal directory"
  if (type === "file") return "File path"
  if (type === "browser") return "HTTP(S) URL"
  return "Target"
}

function PaneStatus({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="flex h-full min-h-40 items-center justify-center p-6 text-center"
      role="status"
    >
      <div className="max-w-xl">
        <h3 className="font-medium">{title}</h3>
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </section>
  )
}

function parseMessages(raw: string): Array<{ id?: string; role: string; text: string }> {
  try {
    const messages = JSON.parse(raw) as Array<{
      id?: string
      role?: string
      parts?: unknown[]
      content?: unknown
    }>
    if (!Array.isArray(messages)) return []
    return messages.map((message) => ({
      id: message.id,
      role: typeof message.role === "string" ? message.role : "message",
      text: messageText(message),
    }))
  } catch {
    return []
  }
}

function messageText(message: { parts?: unknown[]; content?: unknown }): string {
  if (Array.isArray(message.parts)) {
    const text = message.parts
      .flatMap((part) => {
        if (!part || typeof part !== "object") return []
        const record = part as Record<string, unknown>
        return record.type === "text" && typeof record.text === "string" ? [record.text] : []
      })
      .join("\n")
    if (text) return text
  }
  return typeof message.content === "string" ? message.content : "Non-text chat event"
}
