"use client"

import { useAtomValue } from "jotai"
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  lastSelectedAgentIdAtom,
  selectedProjectAtom,
  settingsMcpSidebarWidthAtom,
} from "../../../features/agents/atoms"
import { useIsMobile } from "../../../lib/hooks/use-mobile"
import { trpc, trpcClient } from "../../../lib/trpc"
import { recordAppAction } from "../../../lib/app-action-history"
import { cn } from "../../../lib/utils"
import { Button } from "../../ui/button"
import { LoadingDot, OriginalMCPIcon } from "../../ui/icons"
import { Input } from "../../ui/input"
import { Textarea } from "../../ui/textarea"
import { Label } from "../../ui/label"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { Switch } from "../../ui/switch"
import { DeleteServerConfirm, getStatusText, type McpServer, type ScopeType } from "./mcp"
import { useListKeyboardNav } from "./use-list-keyboard-nav"

type McpProvider = "claude-code" | "codex"
const getDiscoveryError = (data: object | undefined) =>
  data && "error" in data && typeof data.error === "string" ? data.error : undefined
function useRecordMcpAction() {
  const utils = trpc.useUtils()
  return (provider: McpProvider, receipt: { actionId: string }, label: string) => {
    const apply = async (direction: "undo" | "redo") => {
      const client = provider === "codex" ? trpcClient.codex : trpcClient.claude
      await client.applyMcpAction.mutate({ actionId: receipt.actionId, direction })
      // History advances after the confirmed write, even if discovery fails.
      try {
        await client.refreshMcpConfig.mutate()
        const query =
          provider === "codex" ? utils.codex.getAllMcpConfig : utils.claude.getAllMcpConfig
        await query.invalidate(undefined, { refetchType: "none" })
        const data = await query.fetch()
        if (getDiscoveryError(data)) throw new Error()
      } catch {
        toast.error(
          "MCP configuration restored, but discovery failed. Refresh MCP servers to retry discovery.",
        )
      }
    }
    recordAppAction({ label, undo: () => apply("undo"), redo: () => apply("redo") })
  }
}

type ProviderSection = {
  provider: McpProvider
  title: "CODEX" | "CLAUDE CODE"
}

type ListedServer = {
  key: string
  provider: McpProvider
  groupName: string
  projectPath: string | null
  server: McpServer
}

// Status indicator dot - exported for reuse in other components
export function McpStatusDot({ status, disabled }: { status: string; disabled?: boolean }) {
  if (disabled) {
    return <span className="w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0" />
  }

  switch (status) {
    case "connected":
      return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
    case "failed":
      return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
    case "needs-auth":
      return <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
    case "pending":
      return <LoadingDot isLoading={true} className="w-3 h-3 text-muted-foreground shrink-0" />
    case "pending-approval":
      return <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
    default:
      return <span className="w-2 h-2 rounded-full bg-muted-foreground/50 shrink-0" />
  }
}

// Extract connection info from server config
function getConnectionInfo(config: Record<string, unknown>) {
  const url = config.url as string | undefined
  const command = config.command as string | undefined
  const args = config.args as string[] | undefined
  const env = config.env as Record<string, string> | undefined

  if (url) {
    return { type: "HTTP" as const, url, command: undefined, args: undefined, env: undefined }
  }
  if (command) {
    return { type: "stdio" as const, url: undefined, command, args, env }
  }
  return {
    type: "unknown" as const,
    url: undefined,
    command: undefined,
    args: undefined,
    env: undefined,
  }
}

function isCodexHttpServer(provider: McpProvider, server: McpServer): boolean {
  if (provider !== "codex") return false
  const transportType = String(
    (server.config as Record<string, unknown>).transportType || "",
  ).toLowerCase()
  if (transportType === "http" || transportType === "sse" || transportType === "streamable_http") {
    return true
  }
  return typeof (server.config as Record<string, unknown>).url === "string"
}

function isServerDisabled(server: McpServer): boolean {
  const config = server.config as Record<string, unknown>
  return config.disabled === true || config.enabled === false
}

// --- Detail Panel ---
function McpServerDetail({
  provider,
  server,
  onAuth,
  onLogout,
  onDelete,
  onEdit,
  scopeLabel,
  onToggleEnabled,
  onApproveProjectConfig,
  isEditable,
  isToggleable,
  isToggling,
}: {
  provider: McpProvider
  server: McpServer
  onAuth?: () => void
  onLogout?: () => void
  onDelete?: () => void
  onEdit?: () => void
  scopeLabel: string
  onToggleEnabled?: (enabled: boolean) => void
  onApproveProjectConfig?: () => void
  isEditable?: boolean
  isToggleable?: boolean
  isToggling?: boolean
}) {
  const { tools, needsAuth } = server
  const hasTools = tools.length > 0
  const isConnected = server.status === "connected"
  const isDisabled = isServerDisabled(server)
  const connection = getConnectionInfo(server.config)
  const hideToolsCount = isCodexHttpServer(provider, server)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{server.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isDisabled
                ? "Disabled"
                : isConnected
                  ? hideToolsCount
                    ? "Connected"
                    : hasTools
                      ? `${tools.length} tool${tools.length !== 1 ? "s" : ""}`
                      : "No tools"
                  : getStatusText(server.status)}
              {server.serverInfo?.version && ` \u00B7 v${server.serverInfo.version}`}
            </p>
          </div>
          {onEdit && (
            <Button variant="outline" size="sm" disabled={isToggling} onClick={onEdit}>
              Edit configuration
            </Button>
          )}
          {needsAuth && onAuth && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={onAuth}
              disabled={isToggling}
            >
              {isConnected ? "Reconnect" : "Authenticate"}
            </Button>
          )}
          {server.status === "pending-approval" && onApproveProjectConfig && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={onApproveProjectConfig}
              disabled={isToggling}
            >
              Approve project config
            </Button>
          )}
          {onLogout && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={onLogout}
              disabled={isToggling}
            >
              Logout
            </Button>
          )}
          {isEditable && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
              onClick={onDelete}
              disabled={isToggling}
              aria-label="Delete server"
              title="Delete server"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <p className="break-all text-xs text-muted-foreground">{scopeLabel}</p>
        {provider === "codex" ? (
          <p className="text-xs text-muted-foreground">
            Editing and enable/disable are not available here for Codex servers.
          </p>
        ) : (
          !isEditable && (
            <p className="text-xs text-muted-foreground">
              External configuration is read-only here. Edit it at its source.
            </p>
          )
        )}
        {/* Enable/Disable Toggle */}
        {isToggleable && onToggleEnabled && (
          <div className="flex items-center justify-between">
            <div>
              <h5 className="text-xs font-medium text-foreground">Enabled</h5>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Applies to new connections; existing sessions may need reconnecting
              </p>
            </div>
            <Switch
              aria-label="Server enabled"
              checked={!isDisabled}
              onCheckedChange={onToggleEnabled}
              disabled={isToggling}
            />
          </div>
        )}

        {/* Connection Section */}
        <div>
          <h5 className="text-xs font-medium text-foreground mb-2">Connection</h5>
          <div className="rounded-md border border-border bg-background overflow-hidden">
            <div className="divide-y divide-border">
              <div className="flex gap-3 px-3 py-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">Type</span>
                <span className="text-xs text-foreground font-mono select-text">
                  {connection.type}
                </span>
              </div>
              {connection.url && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">URL</span>
                  <span className="text-xs text-foreground font-mono break-all select-text">
                    {connection.url}
                  </span>
                </div>
              )}
              {connection.command && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">Command</span>
                  <span className="text-xs text-foreground font-mono break-all select-text">
                    {connection.command}
                  </span>
                </div>
              )}
              {connection.args && connection.args.length > 0 && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">Args</span>
                  <span className="text-xs text-foreground font-mono break-all select-text">
                    {connection.args.join(" ")}
                  </span>
                </div>
              )}
              {connection.env && Object.keys(connection.env).length > 0 && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">Env</span>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(connection.env).map((key) => (
                      <span
                        key={key}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground select-text"
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error Section */}
        {server.error && (
          <div>
            <h5 className="text-xs font-medium text-red-500 mb-2">Error</h5>
            <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
              <p className="text-xs text-red-400 font-mono break-all select-text">{server.error}</p>
            </div>
          </div>
        )}

        {/* Tools Section */}
        {hasTools && (
          <div>
            <h5 className="text-xs font-medium text-foreground mb-3">
              {hideToolsCount ? "Tools" : `Tools (${tools.length})`}
            </h5>
            <div className="grid gap-2">
              {tools.map((tool, i) => {
                const toolName = typeof tool === "string" ? tool : tool.name
                const toolDesc = typeof tool === "string" ? undefined : tool.description
                return (
                  <div
                    key={toolName || i}
                    className="rounded-lg border border-border bg-background px-3.5 py-2.5"
                  >
                    <p className="text-[13px] font-medium text-foreground font-mono">{toolName}</p>
                    {toolDesc && (
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                        {toolDesc}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Add and edit share a draft pinned to the configuration target opened by the user.
function CreateMcpServerForm({
  onCreated,
  onCancel,
  defaultProvider,
  projectPath,
  projectName,
  editing,
}: {
  onCreated: (provider: McpProvider) => Promise<boolean>
  onCancel: () => void
  defaultProvider: McpProvider
  projectPath?: string
  projectName?: string
  editing?: ListedServer | null
}) {
  const recordMcpAction = useRecordMcpAction()
  const addClaude = trpc.claude.addMcpServer.useMutation()
  const addCodex = trpc.codex.addMcpServer.useMutation()
  const updateClaude = trpc.claude.updateMcpServer.useMutation()
  const [provider, setProvider] = useState<McpProvider>(editing?.provider ?? defaultProvider)
  const [target] = useState(() => ({
    path: editing ? (editing.projectPath ?? undefined) : projectPath,
    name: editing ? editing.groupName : projectName,
  }))
  const [name, setName] = useState(editing?.server.name ?? "")
  const [type, setType] = useState<"stdio" | "http">(editing?.server.config.url ? "http" : "stdio")
  const [command, setCommand] = useState(String(editing?.server.config.command ?? ""))
  const [args, setArgs] = useState(
    (editing?.server.config.args as string[] | undefined)?.join("\n") ?? "",
  )
  const [url, setUrl] = useState(String(editing?.server.config.url ?? ""))
  const [scope, setScope] = useState<"global" | "project">(
    editing?.projectPath ? "project" : "global",
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const effectiveScope = provider === "codex" ? "global" : scope
  const targetChanged = !editing && effectiveScope === "project" && projectPath !== target.path
  const canSave =
    !saving &&
    !saved &&
    !targetChanged &&
    name.trim() &&
    (effectiveScope !== "project" || target.path) &&
    (type === "stdio" ? command.trim() : url.trim())
  const handleSubmit = async () => {
    if (!canSave || pending.current) return
    pending.current = true
    setSaving(true)
    setMessage(null)
    const connection =
      type === "stdio"
        ? {
            command: command.trim(),
            args:
              editing && args === (editing.server.config.args as string[] | undefined)?.join("\n")
                ? (editing.server.config.args as string[])
                : args.split(/\r?\n/).filter((line) => line.length > 0),
          }
        : { url: url.trim() }
    try {
      const result = editing
        ? await updateClaude.mutateAsync({
            name: editing.server.name,
            scope: effectiveScope,
            projectPath: effectiveScope === "project" ? target.path : undefined,
            ...connection,
          })
        : provider === "codex"
          ? await addCodex.mutateAsync({
              name: name.trim(),
              transport: type,
              scope: "global",
              ...connection,
            })
          : await addClaude.mutateAsync({
              name: name.trim(),
              transport: type,
              scope: effectiveScope,
              projectPath: effectiveScope === "project" ? target.path : undefined,
              ...connection,
            })
      if (!result.success) throw new Error("The provider did not confirm the configuration write.")
      recordMcpAction(provider, result, editing ? "Edit MCP server" : "Add MCP server")
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : "Configuration could not be saved.")
        setSaving(false)
      }
      pending.current = false
      return
    }
    // A confirmed write is distinct from discovery. Never invite a duplicate add after refresh fails.
    if (mounted.current) {
      setSaved(true)
      setMessage("Configuration saved. Checking discovery…")
    }
    const refreshed = await onCreated(provider)
    if (mounted.current) {
      setSaving(false)
      setMessage(
        refreshed
          ? "Configuration saved. Review its connection status in the server list."
          : "Configuration saved, but discovery failed. Use Refresh MCP servers to retry discovery.",
      )
    }
    pending.current = false
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {editing ? "Edit MCP Server" : "New MCP Server"}
          </h3>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              {saved ? "Done" : "Cancel"}
            </Button>
            <Button size="sm" onClick={() => void handleSubmit()} disabled={!canSave}>
              {saving ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </div>
        </div>
        {message && (
          <p role={saved ? "status" : "alert"} className="text-sm break-words">
            {message}
          </p>
        )}
        {targetChanged && (
          <p role="alert" className="text-sm">
            This draft still targets {target.name ?? target.path}. Return to that project to save,
            or cancel to choose another target.
          </p>
        )}
        <fieldset disabled={saving || saved} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-provider">Provider</Label>
            <Select
              value={provider}
              disabled={Boolean(editing) || saving || saved}
              onValueChange={(value) => setProvider(value as McpProvider)}
            >
              <SelectTrigger id="mcp-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-code">Claude Code</SelectItem>
                <SelectItem value="codex">OpenAI Codex</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={Boolean(editing)}
              placeholder="my-server"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-transport">Transport</Label>
            <Select
              value={type}
              disabled={Boolean(editing) || saving || saved}
              onValueChange={(value) => setType(value as "stdio" | "http")}
            >
              <SelectTrigger id="mcp-transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio (local command)</SelectItem>
                <SelectItem value="http">HTTP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "stdio" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx, python, node..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-args">Arguments (one per line)</Label>
                <Textarea id="mcp-args" value={args} onChange={(e) => setArgs(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Spaces within each argument are preserved.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-url">URL</Label>
              <Input
                id="mcp-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.test/mcp"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-scope">Scope</Label>
            <Select
              value={effectiveScope}
              disabled={Boolean(editing) || provider === "codex" || saving || saved}
              onValueChange={(value) => setScope(value as "global" | "project")}
            >
              <SelectTrigger id="mcp-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global</SelectItem>
                {target.path && (
                  <SelectItem value="project">Project: {target.name ?? target.path}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground break-all">
              {effectiveScope === "project"
                ? `Project configuration: ${target.path}`
                : provider === "codex"
                  ? "~/.codex/config.toml"
                  : "~/.claude.json"}
            </p>
          </div>
          {editing && (
            <p className="text-xs text-muted-foreground">
              Other settings, including authentication and environment variables, are preserved.
            </p>
          )}
        </fieldset>
      </div>
    </div>
  )
}

export function AgentsMcpTab() {
  const isMobile = useIsMobile()
  const lastSelectedAgentId = useAtomValue(lastSelectedAgentIdAtom)
  const defaultAddProvider: McpProvider = lastSelectedAgentId === "codex" ? "codex" : "claude-code"
  const [selectedServerKey, setSelectedServerKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingServer, setEditingServer] = useState<ListedServer | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [refreshErrors, setRefreshErrors] = useState<string[]>([])
  const actionRequest = useRef(0)
  const refreshRequest = useRef(0)
  const [deletingServer, setDeletingServer] = useState<{
    provider: McpProvider
    server: McpServer
    scope: ScopeType
    projectPath?: string | null
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedProject = useAtomValue(selectedProjectAtom)
  useEffect(() => {
    actionRequest.current++
    setActionMessage(null)
    setDeletingServer(null)
    return () => {
      actionRequest.current++
    }
  }, [selectedServerKey, selectedProject?.path])
  useEffect(
    () => () => {
      refreshRequest.current++
    },
    [],
  )
  const providerSections = useMemo<ProviderSection[]>(
    () => [
      { provider: "claude-code", title: "CLAUDE CODE" },
      { provider: "codex", title: "CODEX" },
    ],
    [],
  )

  // Focus search on "/" hotkey
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const claudeMcpQuery = trpc.claude.getAllMcpConfig.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  })
  const codexMcpQuery = trpc.codex.getAllMcpConfig.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  })
  const hasAnyData = Boolean(claudeMcpQuery.data || codexMcpQuery.data)
  const isLoadingConfig = !hasAnyData && (claudeMcpQuery.isLoading || codexMcpQuery.isLoading)
  const refreshClaudeMcpMutation = trpc.claude.refreshMcpConfig.useMutation()
  const refreshCodexMcpMutation = trpc.codex.refreshMcpConfig.useMutation()
  const isRefreshingConfig =
    claudeMcpQuery.isFetching ||
    codexMcpQuery.isFetching ||
    refreshClaudeMcpMutation.isPending ||
    refreshCodexMcpMutation.isPending
  const discoveryErrors = [
    claudeMcpQuery.error?.message ?? getDiscoveryError(claudeMcpQuery.data),
    codexMcpQuery.error?.message ?? getDiscoveryError(codexMcpQuery.data),
    ...refreshErrors,
  ].filter(Boolean)
  const configError = discoveryErrors.length ? { message: discoveryErrors.join("; ") } : null

  const startClaudeOAuthMutation = trpc.claude.startMcpOAuth.useMutation()
  const startCodexOAuthMutation = trpc.codex.startMcpOAuth.useMutation()
  const logoutCodexMcpMutation = trpc.codex.logoutMcpServer.useMutation()
  const recordMcpAction = useRecordMcpAction()
  const updateMutation = trpc.claude.updateMcpServer.useMutation()
  const removeClaudeMcpMutation = trpc.claude.removeMcpServer.useMutation()
  const removeCodexMcpMutation = trpc.codex.removeMcpServer.useMutation()
  const approveProjectMcpMutation = trpc.claudeSettings.approveProjectMcpConfig.useMutation()

  const sortedGroupsByProvider = useMemo(() => {
    const statusOrder: Record<string, number> = {
      connected: 0,
      pending: 1,
      "needs-auth": 2,
      failed: 3,
    }

    const sortGroups = (
      groups: Array<{ groupName: string; projectPath: string | null; mcpServers: McpServer[] }>,
    ) =>
      groups.map((g) => ({
        ...g,
        mcpServers: [...g.mcpServers].sort(
          (a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3),
        ),
      }))

    return {
      codex: sortGroups(codexMcpQuery.data?.groups || []),
      claudeCode: sortGroups(claudeMcpQuery.data?.groups || []),
    }
  }, [codexMcpQuery.data?.groups, claudeMcpQuery.data?.groups])

  const allListedServers = useMemo<ListedServer[]>(() => {
    return providerSections.flatMap((section) => {
      const groups =
        section.provider === "codex"
          ? sortedGroupsByProvider.codex
          : sortedGroupsByProvider.claudeCode

      return groups.flatMap((group) =>
        group.mcpServers.map((server) => ({
          key: JSON.stringify([section.provider, group.projectPath, group.groupName, server.name]),
          provider: section.provider,
          groupName: group.groupName,
          projectPath: group.projectPath,
          server,
        })),
      )
    })
  }, [providerSections, sortedGroupsByProvider])

  const filteredListedServers = useMemo(() => {
    if (!searchQuery.trim()) return allListedServers
    const q = searchQuery.toLowerCase()
    return allListedServers.filter((item) => item.server.name.toLowerCase().includes(q))
  }, [allListedServers, searchQuery])

  const filteredSections = useMemo(
    () =>
      providerSections
        .map((section) => ({
          ...section,
          servers: filteredListedServers.filter((server) => server.provider === section.provider),
        }))
        .filter((section) => section.servers.length > 0),
    [providerSections, filteredListedServers],
  )

  const totalServers = allListedServers.length

  // Flat list of all server keys for keyboard navigation
  const allServerKeys = useMemo(
    () => filteredListedServers.map((server) => server.key),
    [filteredListedServers],
  )

  const { containerRef: listRef, onKeyDown: listKeyDown } = useListKeyboardNav({
    items: allServerKeys,
    selectedItem: selectedServerKey,
    onSelect: (key) => {
      if (!showAddForm) setSelectedServerKey(key)
    },
  })

  // Auto-select first server when data loads (sorted, so connected first)
  useEffect(() => {
    if (isMobile || selectedServerKey || isLoadingConfig) return
    const firstServer = allListedServers[0]
    if (firstServer) {
      setSelectedServerKey(firstServer.key)
    }
  }, [allListedServers, selectedServerKey, isLoadingConfig, isMobile])

  // Find selected server
  const selectedServer = useMemo<ListedServer | null>(() => {
    if (!selectedServerKey) return null
    return allListedServers.find((server) => server.key === selectedServerKey) || null
  }, [selectedServerKey, allListedServers])

  const handleRefresh = useCallback(
    async (silent = false, targetProvider?: McpProvider) => {
      const request = ++refreshRequest.current
      const providers = targetProvider ? [targetProvider] : (["claude-code", "codex"] as const)
      const results = await Promise.allSettled(
        providers.map(async (provider) => {
          try {
            const mutation =
              provider === "codex" ? refreshCodexMcpMutation : refreshClaudeMcpMutation
            const query = provider === "codex" ? codexMcpQuery : claudeMcpQuery
            await mutation.mutateAsync()
            const result = await query.refetch({ cancelRefetch: false, throwOnError: true })
            const error = result.error?.message ?? getDiscoveryError(result.data)
            if (error) throw new Error(error)
          } catch (error) {
            throw new Error(
              `${provider}: ${error instanceof Error ? error.message : "Discovery failed"}`,
            )
          }
        }),
      )
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [String(result.reason.message)] : [],
      )
      if (request === refreshRequest.current) {
        setRefreshErrors(errors)
        if (!silent && errors.length === 0) toast.success("Refreshed MCP servers")
      }
      return errors.length === 0
    },
    [codexMcpQuery, claudeMcpQuery, refreshCodexMcpMutation, refreshClaudeMcpMutation],
  )

  const handleAuth = async (
    provider: McpProvider,
    serverName: string,
    projectPath: string | null,
  ) => {
    const request = ++actionRequest.current
    setActionMessage(null)
    try {
      const result =
        provider === "codex"
          ? await startCodexOAuthMutation.mutateAsync({
              serverName,
              ...(projectPath ? { projectPath } : {}),
            })
          : await startClaudeOAuthMutation.mutateAsync({
              serverName,
              projectPath: projectPath ?? "__global__",
            })

      if (request !== actionRequest.current) {
        if (result.success) await handleRefresh(true, provider)
        return
      }
      if (result.success) {
        toast.success(`"${serverName}" is authenticated, refreshing...`)
        // Plugin servers get promoted to Global after OAuth - update selection
        // Discovery may relocate a plugin entry; do not overwrite a newer selection.
        await handleRefresh(true, provider)
      } else {
        setActionMessage(result.error || "Authentication failed")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed"
      if (request === actionRequest.current) setActionMessage(message)
    }
  }

  const handleCodexAuthLogout = async (serverName: string, projectPath?: string | null) => {
    const request = ++actionRequest.current
    setActionMessage(null)
    try {
      const result = await logoutCodexMcpMutation.mutateAsync({
        serverName,
        ...(projectPath ? { projectPath } : {}),
      })
      if (request !== actionRequest.current) {
        if (result.success) await handleRefresh(true, "codex")
        return
      }
      if (result.success) {
        toast.success(`"${serverName}" is logged out, refreshing...`)
        await handleRefresh(true, "codex")
      } else {
        setActionMessage(result.error || "Logout failed")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Logout failed"
      if (request === actionRequest.current) setActionMessage(message)
    }
  }

  const handleToggleEnabled = async (item: ListedServer, enabled: boolean) => {
    if (item.provider !== "claude-code") return
    const request = ++actionRequest.current
    setActionMessage(null)
    try {
      const result = await updateMutation.mutateAsync({
        name: item.server.name,
        scope: getScopeFromServer(item),
        projectPath: item.projectPath ?? undefined,
        disabled: !enabled,
      })
      recordMcpAction("claude-code", result, enabled ? "Enable MCP server" : "Disable MCP server")
      if (request !== actionRequest.current) {
        await handleRefresh(true, "claude-code")
        return
      }
      setActionMessage(
        enabled
          ? `"${item.server.name}" enable setting saved; checking discovery...`
          : `"${item.server.name}" disable setting saved; checking discovery...`,
      )
      const refreshed = await handleRefresh(true, "claude-code")
      if (request === actionRequest.current) {
        setActionMessage(
          `"${item.server.name}" ${enabled ? "enable" : "disable"} setting saved. ${refreshed ? "Review the updated connection status." : "Discovery failed; retry discovery."}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to toggle server"
      if (request === actionRequest.current) setActionMessage(message)
    }
  }

  const handleApproveProjectConfig = async (item: ListedServer) => {
    if (!item.projectPath) return
    const request = ++actionRequest.current
    setActionMessage(null)
    try {
      await approveProjectMcpMutation.mutateAsync({ projectPath: item.projectPath })
      if (request !== actionRequest.current) {
        await handleRefresh(true, "claude-code")
        return
      }
      setActionMessage("Project MCP configuration approved for its current contents")
      await handleRefresh(true, "claude-code")
    } catch (error) {
      if (request === actionRequest.current)
        setActionMessage(
          error instanceof Error ? error.message : "Failed to approve project MCP config",
        )
    }
  }

  const handleDelete = async () => {
    if (!deletingServer) return
    const request = ++actionRequest.current
    setActionMessage(null)
    try {
      if (deletingServer.provider === "codex") {
        const result = await removeCodexMcpMutation.mutateAsync({
          name: deletingServer.server.name,
          scope: "global",
        })
        recordMcpAction("codex", result, "Remove MCP server")
      } else {
        const result = await removeClaudeMcpMutation.mutateAsync({
          name: deletingServer.server.name,
          scope: deletingServer.scope,
          projectPath: deletingServer.projectPath ?? undefined,
        })
        recordMcpAction("claude-code", result, "Remove MCP server")
      }
      if (request !== actionRequest.current) {
        await handleRefresh(true, deletingServer.provider)
        return
      }
      toast.success(`"${deletingServer.server.name}" configuration removed`)
      setDeletingServer(null)
      setSelectedServerKey(null)
      await handleRefresh(true, deletingServer.provider)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove server"
      if (request === actionRequest.current) setActionMessage(message)
    }
  }

  const canCodexLogout = (server: McpServer) => {
    const authStatus = String((server.config as Record<string, unknown>).authStatus || "")
      .trim()
      .toLowerCase()
    return authStatus === "o_auth" || authStatus === "bearer_token"
  }

  const isEditableServer = (item: ListedServer): boolean => {
    if (item.provider === "codex") {
      // Codex edit/delete currently supports global scope only.
      return !item.projectPath
    }
    return item.server.managedConfig === true
  }

  const getScopeFromServer = (item: ListedServer): ScopeType =>
    item.projectPath ? "project" : "global"

  const isToggleableServer = (item: ListedServer): boolean =>
    item.provider === "claude-code" && item.server.managedConfig === true

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - server list */}
      <ResizableSidebar
        isOpen={!isMobile || (!selectedServer && !showAddForm)}
        className={isMobile ? "!w-full" : undefined}
        onClose={() => {}}
        widthAtom={settingsMcpSidebarWidthAtom}
        minWidth={200}
        maxWidth={400}
        side="left"
        animationDuration={0}
        initialWidth={240}
        exitWidth={240}
        disableClickToClose={true}
      >
        <div
          className="flex flex-col h-full bg-background border-r overflow-hidden"
          style={{ borderRightWidth: "0.5px" }}
        >
          {/* Search + Add */}
          <div className="px-2 pt-2 flex-shrink-0 flex items-center">
            <input
              ref={searchInputRef}
              placeholder="Search servers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={listKeyDown}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-none mr-1.5"
            />
            <button
              onClick={() => {
                setEditingServer(null)
                setShowAddForm(true)
                setSelectedServerKey(null)
              }}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
              title="Add MCP server"
              aria-label="Add MCP server"
              disabled={showAddForm}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                void handleRefresh()
              }}
              disabled={isRefreshingConfig}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
              title="Refresh MCP servers"
              aria-label="Refresh MCP servers"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshingConfig && "animate-spin")} />
            </button>
          </div>
          {configError && (
            <div className="mx-2 mt-2 flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <p className="text-xs text-destructive" role="alert">
                MCP server discovery unavailable: {configError.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={isRefreshingConfig}
                onClick={() => void handleRefresh()}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry
              </Button>
            </div>
          )}
          {/* Server list */}
          <div
            ref={listRef}
            onKeyDown={listKeyDown}
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-2 pt-2 pb-2 outline-none"
          >
            {isLoadingConfig ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
              </div>
            ) : configError && totalServers === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <OriginalMCPIcon className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">MCP server list unavailable</p>
                <p className="text-xs text-muted-foreground">
                  Retry discovery to determine whether Claude Code or Codex has configured servers.
                </p>
              </div>
            ) : totalServers === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <OriginalMCPIcon className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">No third-party MCP servers</p>
                <p className="text-xs text-muted-foreground">
                  Add a Claude Code or Codex server. Product app-control and development
                  test-control stay separate.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => {
                    setEditingServer(null)
                    setShowAddForm(true)
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add server
                </Button>
              </div>
            ) : filteredListedServers.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">No results found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSections.map((section) => (
                  <div key={section.provider} className="space-y-0.5">
                    <div className="px-2 pb-1 pt-1">
                      <p className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">
                        {section.title}
                      </p>
                      <div className="mt-1 h-px bg-border" />
                    </div>
                    {section.servers.map((item) => {
                      const key = item.key
                      const server = item.server
                      const isDisabled = isServerDisabled(server)
                      const hideToolsCount = isCodexHttpServer(item.provider, server)
                      const isSelected = selectedServerKey === key
                      return (
                        <button
                          key={key}
                          data-item-id={key}
                          disabled={showAddForm}
                          onClick={() => setSelectedServerKey(key)}
                          className={cn(
                            "w-full text-left py-1.5 pl-2 pr-2 rounded-md cursor-pointer group relative",
                            "transition-colors duration-75",
                            "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                            isSelected
                              ? "bg-foreground/5 text-foreground"
                              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <div className="flex items-center gap-1">
                                <span
                                  className={cn(
                                    "truncate block text-sm leading-tight flex-1",
                                    isDisabled && "opacity-50",
                                  )}
                                >
                                  {server.name}
                                </span>
                                <div className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                                  <McpStatusDot status={server.status} disabled={isDisabled} />
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 min-w-0">
                                <span className="truncate flex-1 min-w-0">{item.groupName}</span>
                                {server.status !== "pending" && (
                                  <span className="flex-shrink-0">
                                    {isDisabled
                                      ? "Disabled"
                                      : server.status === "connected"
                                        ? hideToolsCount
                                          ? "Connected"
                                          : `${server.tools.length} tool${server.tools.length !== 1 ? "s" : ""}`
                                        : getStatusText(server.status)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ResizableSidebar>

      {/* Right content - detail panel */}
      <div
        className={cn(
          "flex-1 min-w-0 h-full overflow-hidden flex flex-col",
          isMobile && !selectedServer && !showAddForm && "hidden",
        )}
      >
        {isMobile && (selectedServer || showAddForm) && (
          <div className="shrink-0 border-b p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedServerKey(null)
                setShowAddForm(false)
                requestAnimationFrame(() => searchInputRef.current?.focus())
              }}
            >
              Back to servers
            </Button>
          </div>
        )}
        {actionMessage && (
          <p role="status" className="p-3 text-sm break-words">
            {actionMessage}
          </p>
        )}
        {isMobile && configError && (
          <div className="p-3 text-sm">
            <p role="alert">{configError.message}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={isRefreshingConfig}
              onClick={() => void handleRefresh()}
            >
              Retry discovery
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          {showAddForm ? (
            <CreateMcpServerForm
              onCreated={(provider) => handleRefresh(true, provider)}
              editing={editingServer}
              onCancel={() => setShowAddForm(false)}
              defaultProvider={defaultAddProvider}
              projectPath={selectedProject?.path}
              projectName={selectedProject?.name}
            />
          ) : selectedServer ? (
            <McpServerDetail
              provider={selectedServer.provider}
              server={selectedServer.server}
              scopeLabel={`${selectedServer.provider} · ${selectedServer.projectPath ?? "Global configuration"}`}
              onEdit={
                selectedServer.provider === "claude-code" && isEditableServer(selectedServer)
                  ? () => {
                      setEditingServer(selectedServer)
                      setShowAddForm(true)
                    }
                  : undefined
              }
              onAuth={() =>
                handleAuth(
                  selectedServer.provider,
                  selectedServer.server.name,
                  selectedServer.projectPath,
                )
              }
              onLogout={
                selectedServer.provider === "codex" && canCodexLogout(selectedServer.server)
                  ? () =>
                      handleCodexAuthLogout(selectedServer.server.name, selectedServer.projectPath)
                  : undefined
              }
              onDelete={
                isEditableServer(selectedServer)
                  ? () => {
                      setActionMessage(null)
                      setDeletingServer({
                        provider: selectedServer.provider,
                        server: selectedServer.server,
                        scope: getScopeFromServer(selectedServer),
                        projectPath: selectedServer.projectPath,
                      })
                    }
                  : undefined
              }
              onToggleEnabled={
                isToggleableServer(selectedServer)
                  ? (enabled) => handleToggleEnabled(selectedServer, enabled)
                  : undefined
              }
              onApproveProjectConfig={
                selectedServer.provider === "claude-code" &&
                selectedServer.server.status === "pending-approval"
                  ? () => handleApproveProjectConfig(selectedServer)
                  : undefined
              }
              isEditable={isEditableServer(selectedServer)}
              isToggleable={isToggleableServer(selectedServer)}
              isToggling={
                isRefreshingConfig ||
                updateMutation.isPending ||
                startClaudeOAuthMutation.isPending ||
                startCodexOAuthMutation.isPending ||
                logoutCodexMcpMutation.isPending ||
                approveProjectMcpMutation.isPending ||
                removeClaudeMcpMutation.isPending ||
                removeCodexMcpMutation.isPending
              }
            />
          ) : isLoadingConfig ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
            </div>
          ) : configError && totalServers === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <OriginalMCPIcon className="h-12 w-12 text-border mb-4" />
              <p className="text-sm text-muted-foreground">MCP server list unavailable</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={isRefreshingConfig}
                onClick={() => void handleRefresh()}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry discovery
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <OriginalMCPIcon className="h-12 w-12 text-border mb-4" />
              <p className="text-sm text-muted-foreground">
                {totalServers > 0
                  ? "Select a third-party provider server to view details"
                  : "No third-party MCP servers configured for Claude Code or Codex"}
              </p>
              {totalServers === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setEditingServer(null)
                    setShowAddForm(true)
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add your first server
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <DeleteServerConfirm
        error={actionMessage}
        open={!!deletingServer}
        onOpenChange={(open) => {
          if (!open) setDeletingServer(null)
        }}
        serverName={deletingServer?.server.name ?? ""}
        onConfirm={handleDelete}
        isDeleting={removeClaudeMcpMutation.isPending || removeCodexMcpMutation.isPending}
      />
    </div>
  )
}
