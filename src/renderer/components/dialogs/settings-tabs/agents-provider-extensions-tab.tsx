import { useAtomValue } from "jotai"
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { selectedProjectAtom } from "../../../features/agents/atoms"
import {
  filterProviderExtensions,
  isProviderExtensionWritable,
} from "../../../features/settings/provider-extension-view"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import type { ProviderExtensionManifest } from "../../../../main/lib/provider-extensions"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { Textarea } from "../../ui/textarea"

const providers = ["all", "claude", "codex", "cursor", "opencode"] as const
const kinds = ["skill", "command", "plugin", "custom-agent", "mcp"] as const

type Provider = (typeof providers)[number]
type Kind = (typeof kinds)[number]
type Scope = "user" | "project"

const providerLabels: Record<Provider, string> = {
  all: "All providers",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
}

const kindLabels: Record<Kind, string> = {
  skill: "Skills",
  command: "Commands",
  plugin: "Plugins",
  "custom-agent": "Custom Agents",
  mcp: "Provider MCP",
}

type ExtensionItem = ProviderExtensionManifest

function canCreate(provider: Exclude<Provider, "all">, kind: Kind, scope: Scope): boolean {
  if (kind === "skill") return provider === "claude" || provider === "codex"
  if (kind === "command")
    return provider === "claude" || (provider === "cursor" && scope === "project")
  if (kind === "custom-agent") return provider === "claude"
  return false
}

export function AgentsProviderExtensionsTab({ initialKind = "skill" }: { initialKind?: Kind }) {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const [provider, setProvider] = useState<Provider>("all")
  const [kind, setKind] = useState<Kind>(initialKind)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createProvider, setCreateProvider] = useState<Exclude<Provider, "all">>("claude")
  const [createScope, setCreateScope] = useState<Scope>("user")
  const [createName, setCreateName] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")

  const inventory = trpc.providerExtensions.list.useQuery(
    selectedProject?.path ? { cwd: selectedProject.path } : undefined,
  )
  const mutation = trpc.providerExtensions.mutate.useMutation()

  useEffect(() => {
    setKind(initialKind)
    setSelectedId(null)
    setCreating(false)
  }, [initialKind])

  const items = useMemo(() => {
    return filterProviderExtensions(inventory.data ?? [], { provider, kind, query })
  }, [inventory.data, kind, provider, query])

  const selected = items.find((item) => item.id === selectedId) ?? null

  useEffect(() => {
    if (creating) return
    if (selected && items.some((item) => item.id === selected.id)) return
    setSelectedId(items[0]?.id ?? null)
  }, [creating, items, selected])

  useEffect(() => {
    if (!selected) return
    setDescription(selected.description)
    setContent(selected.content ?? "")
  }, [selected?.id])

  const resetCreate = useCallback(() => {
    setCreating(false)
    setCreateName("")
    setDescription("")
    setContent("")
  }, [])

  const refresh = useCallback(async () => {
    await inventory.refetch()
  }, [inventory])

  const submitCreate = useCallback(async () => {
    if (!canCreate(createProvider, kind, createScope)) return
    try {
      const result = await mutation.mutateAsync({
        operation: "create",
        provider: createProvider,
        kind,
        source: createScope,
        name: createName,
        description,
        content,
        cwd: selectedProject?.path,
      })
      toast.success(`${kindLabels[kind].slice(0, -1)} created`, {
        description: `${providerLabels[createProvider]} · ${result.runtimeReload}`,
      })
      resetCreate()
      await refresh()
      setProvider(createProvider)
      setSelectedId(result.id)
    } catch (error) {
      toast.error("Create failed", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    content,
    createName,
    createProvider,
    createScope,
    description,
    kind,
    mutation,
    refresh,
    resetCreate,
    selectedProject?.path,
  ])

  const saveSelected = useCallback(async () => {
    if (!selected || !selected.capabilities.update) return
    try {
      await mutation.mutateAsync({
        operation: "update",
        provider: selected.provider,
        kind: selected.kind,
        source: selected.source as Scope,
        sourceId: selected.sourceId,
        name: selected.name,
        description,
        content,
        cwd: selectedProject?.path,
      })
      toast.success("Extension saved", {
        description: `${providerLabels[selected.provider]} · next run`,
      })
      await refresh()
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [content, description, mutation, refresh, selected, selectedProject?.path])

  const deleteSelected = useCallback(async () => {
    if (!selected || !selected.capabilities.delete) return
    try {
      await mutation.mutateAsync({
        operation: "delete",
        provider: selected.provider,
        kind: selected.kind,
        source: selected.source as Scope,
        sourceId: selected.sourceId,
        name: selected.name,
        description: selected.description,
        content: selected.content ?? "",
        cwd: selectedProject?.path,
      })
      toast.success("Extension deleted", { description: selected.name })
      setSelectedId(null)
      await refresh()
    } catch (error) {
      toast.error("Delete failed", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [mutation, refresh, selected, selectedProject?.path])

  const createSupported = canCreate(createProvider, kind, createScope)

  return (
    <div className="flex h-full min-h-0" data-settings-id="provider-extensions">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border/70">
        <div className="space-y-2 border-b border-border/70 p-3">
          <div className="flex items-center gap-2">
            <Select value={provider} onValueChange={(value) => setProvider(value as Provider)}>
              <SelectTrigger aria-label="Provider filter" className="h-8 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((value) => (
                  <SelectItem key={value} value={value}>
                    {providerLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={refresh}
              aria-label="Refresh provider extensions"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", inventory.isFetching && "animate-spin")} />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search extensions"
              className="h-8 pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1" aria-label="Extension kind">
            {kinds.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setKind(value)
                  setSelectedId(null)
                  setCreating(false)
                }}
                className={cn(
                  "rounded px-2 py-1 text-[11px] font-medium",
                  kind === value
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                {kindLabels[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {inventory.isLoading ? (
            <p className="p-3 text-xs text-muted-foreground">Discovering provider extensions…</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No matching provider extensions.</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                data-settings-id={`provider-extension-${item.id}`}
                onClick={() => {
                  setSelectedId(item.id)
                  setCreating(false)
                }}
                className={cn(
                  "mb-1 w-full rounded-md px-3 py-2 text-left",
                  selectedId === item.id ? "bg-foreground/8" : "hover:bg-foreground/5",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.name}</span>
                  <ProviderBadge provider={item.provider} />
                </div>
                <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
                  <span>{item.source}</span>
                  <span>·</span>
                  <span>{item.capabilities.runtime}</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="border-t border-border/70 p-2">
          <Button
            variant="ghost"
            className="h-8 w-full justify-start"
            onClick={() => {
              setCreating(true)
              setSelectedId(null)
            }}
            disabled={kind === "plugin" || kind === "mcp"}
          >
            <Plus className="mr-2 h-3.5 w-3.5" /> New {kindLabels[kind].slice(0, -1)}
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {creating ? (
          <div className="mx-auto max-w-2xl space-y-5 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">New {kindLabels[kind].slice(0, -1)}</h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={resetCreate}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submitCreate}
                  disabled={!createSupported || !createName.trim() || mutation.isPending}
                >
                  Create
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select
                  value={createProvider}
                  onValueChange={(value) => setCreateProvider(value as Exclude<Provider, "all">)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.slice(1).map((value) => (
                      <SelectItem key={value} value={value}>
                        {providerLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select
                  value={createScope}
                  onValueChange={(value) => setCreateScope(value as Scope)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="project" disabled={!selectedProject}>
                      Project
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!createSupported && (
              <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-600">
                This provider/kind/scope has no proven writable runtime path. Creation stays
                disabled.
              </p>
            )}
            <Field label="Name">
              <Input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="lowercase-name"
              />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <Field label="Instructions">
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={16}
                className="font-mono"
              />
            </Field>
          </div>
        ) : selected ? (
          <ExtensionDetail
            item={selected}
            description={description}
            content={content}
            onDescription={setDescription}
            onContent={setContent}
            onSave={saveSelected}
            onDelete={deleteSelected}
            pending={mutation.isPending}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
            Select an extension to inspect provider scope and runtime support.
          </div>
        )}
      </main>
    </div>
  )
}

function ExtensionDetail({
  item,
  description,
  content,
  onDescription,
  onContent,
  onSave,
  onDelete,
  pending,
}: {
  item: ExtensionItem
  description: string
  content: string
  onDescription: (value: string) => void
  onContent: (value: string) => void
  onSave: () => void
  onDelete: () => void
  pending: boolean
}) {
  const writable = isProviderExtensionWritable(item)
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{item.name}</h3>
            <ProviderBadge provider={item.provider} />
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.path}</p>
        </div>
        {writable && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={pending}
              aria-label="Delete extension"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={onSave} disabled={pending}>
              Save
            </Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Fact label="Identity" value={`${item.provider} · ${item.kind}`} />
        <Fact label="Scope" value={item.source} />
        <Fact label="Runtime" value={item.capabilities.runtime} />
      </div>
      {item.limitations.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
          {item.limitations.map((limitation) => (
            <p key={limitation}>{limitation}</p>
          ))}
        </div>
      )}
      <Field label="Description">
        <Input
          value={description}
          onChange={(event) => onDescription(event.target.value)}
          readOnly={!writable}
        />
      </Field>
      {item.kind !== "plugin" && item.kind !== "mcp" && (
        <Field label="Instructions">
          <Textarea
            value={content}
            onChange={(event) => onContent(event.target.value)}
            readOnly={!writable}
            rows={18}
            className="font-mono"
          />
        </Field>
      )}
    </div>
  )
}

function ProviderBadge({ provider }: { provider: Exclude<Provider, "all"> }) {
  return (
    <span className="shrink-0 rounded bg-foreground/8 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
      {providerLabels[provider]}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  )
}
