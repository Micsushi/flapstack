import { useAtomValue } from "jotai"
import { Copy, Pencil, Plus, RefreshCw, Search, ShieldOff } from "lucide-react"
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { toast } from "sonner"
import type {
  CrossHarnessCopyPreview,
  ExtensionCapability,
  ExtensionHarness,
  ExtensionKind,
  HookDraft,
  HookRecord,
  HookValidationResult,
  NativeExtensionMutationPreview,
  NativeExtensionTarget,
  ResolvedExtensionEnablement,
} from "../../../../main/lib/extension-management"
import type { ProviderExtensionManifest } from "../../../../main/lib/provider-extensions"
import { selectedChatScopeAtom, selectedProjectAtom } from "../../../features/agents/atoms"
import {
  createExtensionManagerState,
  exactPolicyDiff,
  extensionManagerHarnesses,
  extensionManagerKinds,
  extensionManagerReducer,
  extensionManagerScopes,
  extensionManagerSources,
  filterExtensionManagerRows,
  nextExtensionSelection,
  type ExtensionManagerKind,
  type ExtensionManagerRow,
} from "../../../features/settings/extension-manager-state"
import { trpc, trpcClient } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { Textarea } from "../../ui/textarea"

const harnessLabels: Record<string, string> = {
  all: "All harnesses",
  "claude-code": "Claude Code",
  codex: "Codex",
  "cursor-agent": "Cursor Agent",
  opencode: "OpenCode",
}

const kindLabels: Record<string, string> = {
  all: "All kinds",
  skill: "Skill",
  command: "Command",
  plugin: "Plugin",
  "custom-agent": "Custom agent",
  mcp: "MCP",
  hook: "Hook",
}

const sourceLabels: Record<string, string> = {
  all: "All sources",
  native: "Native files",
  plugin: "Plugin inventory",
  managed: "Managed hooks",
}

const scopeLabels: Record<string, string> = {
  all: "All native scopes",
  user: "User",
  project: "Project",
  plugin: "Plugin",
}

type NativeInventoryState = {
  extension: ProviderExtensionManifest
  resolved: ResolvedExtensionEnablement
}

type ManagerItem = ExtensionManagerRow & {
  capability: ExtensionCapability
  native?: NativeInventoryState
  hook?: HookRecord
}

type PolicyLocation =
  | { type: "user" }
  | { type: "project"; projectId: string }
  | { type: "task"; projectId: string; taskId: string }

type NativeChanges = {
  content?: string
  metadata?: Record<string, unknown>
}

type ActionPreview =
  | {
      type: "native"
      title: string
      path: string
      support: string
      diff: string
      warnings: string[]
      preview: NativeExtensionMutationPreview
      operation: "create" | "update"
      target: NativeExtensionTarget
      changes: NativeChanges
    }
  | {
      type: "copy"
      title: string
      path: string
      support: string
      diff: string
      warnings: string[]
      preview: CrossHarnessCopyPreview
      source: NativeExtensionTarget
      target: NativeExtensionTarget
      collisionPolicy: "reject" | "overwrite"
    }
  | {
      type: "policy"
      title: string
      path: string
      support: string
      diff: string
      warnings: string[]
      extensionId: string
      location: PolicyLocation
      enabled: boolean
    }
  | {
      type: "hook-import"
      title: string
      path: string
      support: string
      diff: string
      warnings: string[]
      validation: HookValidationResult
      draft: HookDraft
    }
  | {
      type: "hook-disable"
      title: string
      path: string
      support: string
      diff: string
      warnings: string[]
      hookId: string
    }

type Draft = {
  harness: ExtensionHarness
  kind: ExtensionKind
  scope: "user" | "project"
  name: string
  description: string
  content: string
  collisionPolicy: "reject" | "overwrite"
  event: string
  command: string
  timeoutMs: number
}

const emptyDraft: Draft = {
  harness: "claude-code",
  kind: "skill",
  scope: "user",
  name: "",
  description: "",
  content: "",
  collisionPolicy: "reject",
  event: "PostToolUse",
  command: "",
  timeoutMs: 5_000,
}

export function AgentsProviderExtensionsTab({
  initialKind = "all",
}: {
  initialKind?: ExtensionManagerKind
}) {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const selectedChatScope = useAtomValue(selectedChatScopeAtom)
  const [state, dispatch] = useReducer(
    extensionManagerReducer,
    initialKind,
    createExtensionManagerState,
  )
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, kind: nativeKind(initialKind) })
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [policyScope, setPolicyScope] = useState<"user" | "project" | "task">(
    selectedProject ? "project" : "user",
  )
  const [taskId, setTaskId] = useState(
    selectedChatScope?.type === "task" ? selectedChatScope.id : "",
  )
  const listRefs = useRef(new Map<string, HTMLButtonElement>())
  const searchRef = useRef<HTMLInputElement>(null)

  const tasks = trpc.tasks.list.useQuery(
    { projectId: selectedProject?.id, includeArchived: false },
    { enabled: Boolean(selectedProject) },
  )
  const resolvedState = trpc.providerExtensions.getResolvedState.useQuery({
    cwd: selectedProject?.path,
    projectId: selectedProject?.id,
    taskId: selectedProject?.id && taskId ? taskId : undefined,
  })
  const capabilities = trpc.providerExtensions.getCapabilities.useQuery()
  const hooks = trpc.hooksManagement.listInventory.useQuery(undefined)
  const applyNative = trpc.providerExtensions.applyNativeMutation.useMutation()
  const applyCopy = trpc.providerExtensions.applyCrossHarnessCopy.useMutation()
  const setPolicy = trpc.providerExtensions.setEnablementPolicy.useMutation()
  const importHook = trpc.hooksManagement.importHook.useMutation()
  const setHookEnabled = trpc.hooksManagement.setEnabled.useMutation()

  const refresh = useCallback(async () => {
    await Promise.all([resolvedState.refetch(), capabilities.refetch(), hooks.refetch()])
  }, [capabilities, hooks, resolvedState])

  useEffect(() => {
    dispatch({ type: "filter", key: "kind", value: initialKind })
    setDraft((current) => ({ ...current, kind: nativeKind(initialKind) }))
  }, [initialKind])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      event.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const items = useMemo<ManagerItem[]>(() => {
    const registry = capabilities.data?.capabilities ?? []
    const byId = new Map(registry.map((capability) => [capability.id, capability]))
    const nativeRows = (resolvedState.data ?? []).flatMap((entry) => {
      const capability = byId.get(
        `${entry.resolved.target.harness}:${entry.resolved.target.kind}:${entry.resolved.target.nativeScope}`,
      )
      if (!capability) return []
      const extension = entry.extension
      return [
        {
          id: extension.id,
          harness: capability.harness,
          kind: capability.kind,
          source: extension.source === "plugin" ? "plugin" : "native",
          scope: extension.source,
          name: extension.name,
          description: extension.description,
          path: extension.path,
          support: capability.inventory,
          runtime: capability.runtimeConsumption,
          capability,
          native: entry,
        } satisfies ManagerItem,
      ]
    })
    const hookRows = (hooks.data ?? []).flatMap((record) => {
      const capability = byId.get(`${record.definition.harness}:hook:${record.definition.scope}`)
      if (!capability) return []
      return [
        {
          id: `hook:${record.id}`,
          harness: record.definition.harness,
          kind: "hook",
          source: "managed",
          scope: record.definition.scope,
          name: record.definition.name,
          description: `${record.definition.event} · ${record.state}`,
          path:
            record.definition.scope === "project"
              ? `${record.definition.cwd} · managed hook registry`
              : "Flapstack managed user hook registry",
          support: capability.inventory,
          runtime: capability.runtimeConsumption,
          capability,
          hook: record,
        } satisfies ManagerItem,
      ]
    })
    return [...nativeRows, ...hookRows]
  }, [capabilities.data, hooks.data, resolvedState.data])

  const visibleItems = useMemo(
    () => filterExtensionManagerRows(items, state.filters) as ManagerItem[],
    [items, state.filters],
  )
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems])
  useEffect(() => {
    dispatch({ type: "reconcile", visibleIds })
  }, [visibleIds])

  const selected = items.find((item) => item.id === state.selectedId) ?? null
  const selectedTarget =
    selected?.native &&
    (selected.native.extension.capabilities.create || selected.native.extension.capabilities.update)
      ? targetFor(selected.native, selectedProject?.path)
      : null
  const policyLocation = buildPolicyLocation(policyScope, selectedProject?.id, taskId)
  const policySupported = Boolean(
    selected?.native &&
    policyLocation &&
    selected.native.resolved.support === "supported" &&
    selected.native.resolved.supportedScopes.includes(policyScope),
  )
  const pending =
    applyNative.isPending ||
    applyCopy.isPending ||
    setPolicy.isPending ||
    importHook.isPending ||
    setHookEnabled.isPending

  const beginCreate = () => {
    setPreview(null)
    setDraft({ ...emptyDraft, kind: nativeKind(state.filters.kind) })
    dispatch({ type: "begin", flow: "create" })
  }

  const beginEdit = () => {
    if (!selected?.native) return
    setPreview(null)
    setDraft({
      ...emptyDraft,
      harness: selected.harness,
      kind: selected.kind,
      scope: selected.scope === "project" ? "project" : "user",
      name: selected.name,
      description: selected.native.extension.description,
      content: selected.native.extension.content ?? "",
    })
    dispatch({ type: "begin", flow: "edit" })
  }

  const beginCopy = () => {
    if (!selected?.native) return
    const targetHarness = extensionManagerHarnesses.find(
      (harness): harness is ExtensionHarness => harness !== "all" && harness !== selected.harness,
    )!
    setPreview(null)
    setDraft({
      ...emptyDraft,
      harness: targetHarness,
      kind: selected.kind,
      scope: selected.scope === "project" ? "project" : "user",
      name: selected.name,
    })
    dispatch({ type: "begin", flow: "copy" })
  }

  const preparePreview = useCallback(async () => {
    try {
      let next: ActionPreview
      if (state.flow === "create" && draft.kind === "hook") {
        const hookDraft: HookDraft = {
          name: draft.name,
          harness: hookHarness(draft.harness),
          scope: draft.scope,
          ...(draft.scope === "project" ? { cwd: selectedProject?.path } : {}),
          event: draft.event,
          command: draft.command,
          timeoutMs: draft.timeoutMs,
        }
        const validation = await trpcClient.hooksManagement.previewCommand.query(hookDraft)
        next = {
          type: "hook-import",
          title: "Import hook disabled",
          path:
            draft.scope === "project"
              ? `${selectedProject?.path} · managed hook registry`
              : "Flapstack managed user hook registry",
          support: validation.valid ? "validated preview" : "unsupported until fixed",
          diff: `+ ${JSON.stringify({ ...hookDraft, enabled: false }, null, 2)}`,
          warnings: validation.issues.map((issue) => `${issue.path}: ${issue.message}`),
          validation,
          draft: hookDraft,
        }
      } else if (state.flow === "create") {
        const target = draftTarget(draft, selectedProject?.path)
        const changes = nativeChanges(draft)
        const result = await trpcClient.providerExtensions.previewNativeMutation.query({
          operation: "create",
          target,
          changes,
        })
        next = nativePreview("Create native extension", "create", target, changes, result)
      } else if (state.flow === "edit" && selectedTarget) {
        const changes = nativeChanges(draft)
        const result = await trpcClient.providerExtensions.previewNativeMutation.query({
          operation: "update",
          target: selectedTarget,
          changes,
        })
        next = nativePreview("Edit native extension", "update", selectedTarget, changes, result)
      } else if (state.flow === "copy" && selectedTarget) {
        const target = draftTarget({ ...draft, kind: selectedTarget.kind }, selectedProject?.path)
        const result = await trpcClient.providerExtensions.previewCrossHarnessCopy.query({
          source: selectedTarget,
          target,
          collisionPolicy: draft.collisionPolicy,
        })
        next = {
          type: "copy",
          title: "Copy extension between harnesses",
          path:
            result.targetPath ??
            (result.targetCapability.nativePaths.join(", ") || "No target path"),
          support: `${result.status} · ${result.targetCapability.inventory}`,
          diff:
            result.targetDiff || "No target diff is available because this mapping is unsupported.",
          warnings: [
            ...result.reasons,
            ...result.unsupportedFields.map((field) => `Unsupported: ${field}`),
          ],
          preview: result,
          source: selectedTarget,
          target,
          collisionPolicy: draft.collisionPolicy,
        }
      } else if (state.flow === "policy" && selected?.native && policyLocation) {
        const enabled = !selected.native.resolved.enabled
        next = {
          type: "policy",
          title: enabled ? "Enable extension policy" : "Disable extension policy",
          path: `${policyScope} policy record · ${selected.path}`,
          support: policySupported ? "supported" : "unsupported",
          diff: exactPolicyDiff({
            scope: policyScope,
            enabled,
            currentEnabled: selected.native.resolved.enabled,
            currentSource: selected.native.resolved.source,
          }),
          warnings: policySupported
            ? []
            : [
                selected.native.resolved.reason ??
                  `The ${policyScope} policy scope is unsupported.`,
              ],
          extensionId: selected.native.extension.id,
          location: policyLocation,
          enabled,
        }
      } else if (state.flow === "policy" && selected?.hook?.enabled) {
        next = {
          type: "hook-disable",
          title: "Disable managed hook",
          path: selected.path,
          support: "supported",
          diff: `- ${JSON.stringify({ enabled: true, state: selected.hook.state })}\n+ ${JSON.stringify({ enabled: false, state: "disabled" })}`,
          warnings: [],
          hookId: selected.hook.id,
        }
      } else {
        throw new Error("This action has no supported preview contract")
      }
      setPreview(next)
      dispatch({ type: "preview-ready" })
    } catch (error) {
      toast.error("Preview failed", { description: errorMessage(error) })
    }
  }, [
    draft,
    policyLocation,
    policyScope,
    policySupported,
    selected,
    selectedProject?.path,
    selectedTarget,
    state.flow,
  ])

  useEffect(() => {
    if (state.flow === "policy" && !preview) void preparePreview()
  }, [preparePreview, preview, state.flow])

  const confirmPreview = useCallback(async () => {
    if (!preview || !state.previewConfirmed) return
    try {
      if (preview.type === "native") {
        await applyNative.mutateAsync({
          operation: preview.operation,
          target: preview.target,
          changes: preview.changes,
          expectedHash: preview.preview.beforeHash,
        })
      } else if (preview.type === "copy") {
        if (
          !preview.preview.canApply ||
          !preview.preview.sourceHash ||
          !preview.preview.confirmationHash
        ) {
          throw new Error("Unsupported copy previews cannot be applied")
        }
        await applyCopy.mutateAsync({
          source: preview.source,
          target: preview.target,
          collisionPolicy: preview.collisionPolicy,
          expectedSourceHash: preview.preview.sourceHash,
          expectedTargetHash: preview.preview.targetBeforeHash,
          confirmationHash: preview.preview.confirmationHash,
        })
      } else if (preview.type === "policy") {
        if (preview.support !== "supported") throw new Error("Unsupported policy cannot be applied")
        await setPolicy.mutateAsync({
          extensionId: preview.extensionId,
          cwd: selectedProject?.path,
          location: preview.location,
          enabled: preview.enabled,
        })
      } else if (preview.type === "hook-import") {
        if (!preview.validation.valid) throw new Error("Invalid hooks cannot be imported")
        await importHook.mutateAsync(preview.draft)
      } else {
        await setHookEnabled.mutateAsync({ id: preview.hookId, enabled: false })
      }
      toast.success("Extension change applied", { description: preview.path })
      setPreview(null)
      dispatch({ type: "cancel" })
      await refresh()
    } catch (error) {
      toast.error("Extension change failed", { description: errorMessage(error) })
    }
  }, [
    applyCopy,
    applyNative,
    importHook,
    preview,
    refresh,
    selectedProject?.path,
    setHookEnabled,
    setPolicy,
    state.previewConfirmed,
  ])

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const id = nextExtensionSelection(
      visibleIds,
      state.selectedId,
      event.key as "ArrowDown" | "ArrowUp" | "Home" | "End",
    )
    dispatch({ type: "select", id })
    if (id) requestAnimationFrame(() => listRefs.current.get(id)?.focus())
  }

  return (
    <div className="flex h-full min-h-0" data-settings-id="provider-extensions">
      <aside className="flex w-96 shrink-0 flex-col border-r border-border/70">
        <div className="space-y-2 border-b border-border/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Extension Manager</h2>
              <p className="text-[10px] text-muted-foreground">
                Native truth, policy, and copy support
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh extensions">
              <RefreshCw className={cn("h-4 w-4", resolvedState.isFetching && "animate-spin")} />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={state.filters.query}
              onChange={(event) =>
                dispatch({ type: "filter", key: "query", value: event.target.value })
              }
              aria-label="Search extensions"
              placeholder="Search extensions (/)"
              className="h-8 pl-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Filter
              label="Harness"
              value={state.filters.harness}
              values={extensionManagerHarnesses}
              labels={harnessLabels}
              onChange={(value) => dispatch({ type: "filter", key: "harness", value })}
            />
            <Filter
              label="Kind"
              value={state.filters.kind}
              values={extensionManagerKinds}
              labels={kindLabels}
              onChange={(value) => dispatch({ type: "filter", key: "kind", value })}
            />
            <Filter
              label="Source"
              value={state.filters.source}
              values={extensionManagerSources}
              labels={sourceLabels}
              onChange={(value) => dispatch({ type: "filter", key: "source", value })}
            />
            <Filter
              label="Scope"
              value={state.filters.scope}
              values={extensionManagerScopes}
              labels={scopeLabels}
              onChange={(value) => dispatch({ type: "filter", key: "scope", value })}
            />
          </div>
          <p className="sr-only" aria-live="polite">
            {visibleItems.length} extensions match
          </p>
        </div>

        <div
          className="flex-1 overflow-y-auto p-2 outline-none"
          role="listbox"
          aria-label="Extension inventory"
          onKeyDown={onListKeyDown}
        >
          {resolvedState.isLoading || capabilities.isLoading || hooks.isLoading ? (
            <p className="p-3 text-xs text-muted-foreground">Discovering extensions…</p>
          ) : visibleItems.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No matching extensions.</p>
          ) : (
            visibleItems.map((item) => (
              <button
                key={item.id}
                ref={(element) => {
                  if (element) listRefs.current.set(item.id, element)
                  else listRefs.current.delete(item.id)
                }}
                type="button"
                role="option"
                aria-selected={state.selectedId === item.id}
                tabIndex={state.selectedId === item.id ? 0 : -1}
                onClick={() => dispatch({ type: "select", id: item.id })}
                className={cn(
                  "mb-1 w-full rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  state.selectedId === item.id ? "bg-foreground/8" : "hover:bg-foreground/5",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.name}</span>
                  <SupportBadge support={item.support} />
                </span>
                <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                  {harnessLabels[item.harness]} · {kindLabels[item.kind]} · {item.scope}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border/70 p-2">
          <Button variant="ghost" className="h-8 w-full justify-start" onClick={beginCreate}>
            <Plus className="mr-2 h-3.5 w-3.5" /> New extension
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {preview ? (
          <PreviewPanel
            preview={preview}
            confirmed={state.previewConfirmed}
            pending={pending}
            onConfirmed={(confirmed) => dispatch({ type: "confirm-preview", confirmed })}
            onBack={() => {
              setPreview(null)
              if (state.flow === "policy") dispatch({ type: "cancel" })
            }}
            onCancel={() => {
              setPreview(null)
              dispatch({ type: "cancel" })
            }}
            onApply={confirmPreview}
          />
        ) : state.flow === "create" || state.flow === "edit" || state.flow === "copy" ? (
          <EditorPanel
            mode={state.flow}
            draft={draft}
            capabilities={capabilities.data?.capabilities ?? []}
            hasProject={Boolean(selectedProject)}
            onDraft={setDraft}
            onCancel={() => dispatch({ type: "cancel" })}
            onPreview={preparePreview}
          />
        ) : selected ? (
          <DetailPanel
            item={selected}
            policyScope={policyScope}
            taskId={taskId}
            tasks={tasks.data ?? []}
            hasProject={Boolean(selectedProject)}
            policySupported={policySupported}
            onPolicyScope={setPolicyScope}
            onTask={setTaskId}
            onEdit={beginEdit}
            onCopy={beginCopy}
            onPolicy={() => {
              setPreview(null)
              dispatch({ type: "begin", flow: "policy" })
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
            Select an extension to inspect its native support and resolved policy.
          </div>
        )}
      </main>
    </div>
  )
}

function DetailPanel({
  item,
  policyScope,
  taskId,
  tasks,
  hasProject,
  policySupported,
  onPolicyScope,
  onTask,
  onEdit,
  onCopy,
  onPolicy,
}: {
  item: ManagerItem
  policyScope: "user" | "project" | "task"
  taskId: string
  tasks: Array<{ id: string; name: string }>
  hasProject: boolean
  policySupported: boolean
  onPolicyScope: (scope: "user" | "project" | "task") => void
  onTask: (taskId: string) => void
  onEdit: () => void
  onCopy: () => void
  onPolicy: () => void
}) {
  const editable = Boolean(
    item.native?.extension.capabilities.update && item.capability.mutations.includes("update"),
  )
  const copyable = Boolean(
    item.native?.extension.capabilities.update &&
    ["skill", "command", "custom-agent"].includes(item.kind),
  )
  const canDisable = item.hook ? item.hook.enabled : policySupported
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{item.name}</h3>
            <SupportBadge support={item.support} />
            <span className="rounded bg-foreground/8 px-1.5 py-0.5 text-[10px]">
              {item.runtime}
            </span>
          </div>
          <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{item.path}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!editable}
            onClick={onEdit}
            title={editable ? undefined : "No native edit adapter"}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!copyable}
            onClick={onCopy}
            title={copyable ? undefined : "No cross-harness copy adapter"}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <Fact label="Harness" value={harnessLabels[item.harness]} />
        <Fact label="Kind" value={kindLabels[item.kind]} />
        <Fact label="Source" value={sourceLabels[item.source]} />
        <Fact label="Native scope" value={item.scope} />
      </div>
      <div className="rounded-md border border-border p-4">
        <h4 className="text-xs font-semibold">Support contract</h4>
        <p className="mt-2 text-xs text-muted-foreground">
          Inventory: {item.capability.inventory}. Runtime consumption:{" "}
          {item.capability.runtimeConsumption}. Mutations:{" "}
          {item.capability.mutations.join(", ") || "none"}.
        </p>
        {item.capability.limitations.map((limitation) => (
          <p key={limitation} className="mt-2 text-xs text-amber-700">
            {limitation}
          </p>
        ))}
      </div>
      {item.native && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <h4 className="text-xs font-semibold">Resolved enablement policy</h4>
          <div className="grid grid-cols-3 gap-2">
            <Filter
              label="Policy scope"
              value={policyScope}
              values={["user", "project", "task"]}
              labels={{ user: "User", project: "Project", task: "Task" }}
              onChange={(value) => onPolicyScope(value as "user" | "project" | "task")}
              disabledValues={hasProject ? [] : ["project", "task"]}
            />
            {policyScope === "task" && (
              <Filter
                label="Task"
                value={taskId || "none"}
                values={["none", ...tasks.map((task) => task.id)]}
                labels={Object.fromEntries([
                  ["none", "Choose task"],
                  ...tasks.map((task) => [task.id, task.name]),
                ])}
                onChange={(value) => onTask(value === "none" ? "" : value)}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Resolved <strong>{item.native.resolved.enabled ? "enabled" : "disabled"}</strong> from{" "}
            {item.native.resolved.source}. Runtime enforcement:{" "}
            {item.native.resolved.runtimeEnforcement.support}.
          </p>
          {!policySupported && (
            <p className="text-xs text-amber-700">
              {item.native.resolved.reason ??
                `The ${policyScope} scope is unsupported or incomplete.`}
            </p>
          )}
          <Button variant="outline" size="sm" disabled={!canDisable} onClick={onPolicy}>
            <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
            {item.native.resolved.enabled ? "Preview disable" : "Preview enable"}
          </Button>
        </div>
      )}
      {item.hook && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <h4 className="text-xs font-semibold">Managed hook lifecycle</h4>
          <p className="text-xs text-muted-foreground">
            State: {item.hook.state}. Exact command: <code>{item.hook.definition.command}</code>.
          </p>
          {item.hook.enabled ? (
            <Button variant="outline" size="sm" onClick={onPolicy}>
              <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> Preview disable
            </Button>
          ) : (
            <p className="text-xs text-amber-700">
              Enablement remains unavailable here until validation, dry-run, and Tier 3 approval are
              complete.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function EditorPanel({
  mode,
  draft,
  capabilities,
  hasProject,
  onDraft,
  onCancel,
  onPreview,
}: {
  mode: "create" | "edit" | "copy"
  draft: Draft
  capabilities: ExtensionCapability[]
  hasProject: boolean
  onDraft: (draft: Draft) => void
  onCancel: () => void
  onPreview: () => void
}) {
  const isHook = draft.kind === "hook"
  const capability = capabilities.find(
    (entry) =>
      entry.harness === draft.harness && entry.kind === draft.kind && entry.scope === draft.scope,
  )
  const supported = isHook
    ? ["claude-code", "codex"].includes(draft.harness)
    : mode === "copy"
      ? capability?.mutations.includes("create")
      : capability?.mutations.includes(mode === "edit" ? "update" : "create")
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {mode === "create"
            ? "New extension"
            : mode === "edit"
              ? "Edit extension"
              : "Copy extension"}
        </h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              !supported ||
              !draft.name.trim() ||
              ((draft.kind === "skill" || draft.kind === "custom-agent") &&
                !draft.description.trim()) ||
              (draft.scope === "project" && !hasProject) ||
              (isHook && !draft.command.trim())
            }
            onClick={onPreview}
          >
            Preview exact change
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Filter
          label={mode === "copy" ? "Target harness" : "Harness"}
          value={draft.harness}
          values={extensionManagerHarnesses.slice(1)}
          labels={harnessLabels}
          onChange={(value) => onDraft({ ...draft, harness: value as ExtensionHarness })}
          disabled={mode === "edit"}
        />
        <Filter
          label="Kind"
          value={draft.kind}
          values={mode === "create" ? extensionManagerKinds.slice(1) : [draft.kind]}
          labels={kindLabels}
          onChange={(value) => onDraft({ ...draft, kind: value as ExtensionKind })}
          disabled={mode !== "create"}
        />
        <Filter
          label={mode === "copy" ? "Target scope" : "Scope"}
          value={draft.scope}
          values={["user", "project"]}
          labels={scopeLabels}
          onChange={(value) => onDraft({ ...draft, scope: value as "user" | "project" })}
          disabled={mode === "edit"}
          disabledValues={hasProject ? [] : ["project"]}
        />
      </div>
      <p
        className={cn(
          "rounded-md p-3 text-xs",
          supported ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700",
        )}
      >
        {supported
          ? `${capability?.inventory ?? "managed"} · target path and diff will be resolved before confirmation.`
          : "This combination has no supported mutation adapter. No write will be offered."}
      </p>
      <Field label="Name">
        <Input
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
          disabled={mode === "edit"}
        />
      </Field>
      {isHook ? (
        <>
          <Field label="Event">
            <Input
              value={draft.event}
              onChange={(event) => onDraft({ ...draft, event: event.target.value })}
            />
          </Field>
          <Field label="Exact command">
            <Input
              value={draft.command}
              onChange={(event) => onDraft({ ...draft, command: event.target.value })}
              className="font-mono"
            />
          </Field>
          <Field label="Dry-run timeout (ms)">
            <Input
              type="number"
              min={100}
              max={10000}
              value={draft.timeoutMs}
              onChange={(event) => onDraft({ ...draft, timeoutMs: Number(event.target.value) })}
            />
          </Field>
        </>
      ) : mode === "copy" ? (
        <Filter
          label="Collision handling"
          value={draft.collisionPolicy}
          values={["reject", "overwrite"]}
          labels={{ reject: "Reject existing target", overwrite: "Overwrite after preview" }}
          onChange={(value) =>
            onDraft({ ...draft, collisionPolicy: value as "reject" | "overwrite" })
          }
        />
      ) : (
        <>
          <Field label="Description">
            <Input
              value={draft.description}
              onChange={(event) => onDraft({ ...draft, description: event.target.value })}
            />
          </Field>
          <Field label="Instructions">
            <Textarea
              value={draft.content}
              onChange={(event) => onDraft({ ...draft, content: event.target.value })}
              rows={18}
              className="font-mono"
            />
          </Field>
        </>
      )}
    </div>
  )
}

function PreviewPanel({
  preview,
  confirmed,
  pending,
  onConfirmed,
  onBack,
  onCancel,
  onApply,
}: {
  preview: ActionPreview
  confirmed: boolean
  pending: boolean
  onConfirmed: (confirmed: boolean) => void
  onBack: () => void
  onCancel: () => void
  onApply: () => void
}) {
  const applicable =
    preview.support !== "unsupported" &&
    preview.support !== "unsupported until fixed" &&
    !(preview.type === "copy" && !preview.preview.canApply)
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6" aria-labelledby="extension-preview-title">
      <div className="flex items-center justify-between">
        <h3 id="extension-preview-title" className="text-sm font-semibold">
          {preview.title}
        </h3>
        <SupportBadge support={applicable ? "supported" : "unsupported"} />
      </div>
      <Fact label="Exact target path" value={preview.path} wrap />
      <Fact label="Support result" value={preview.support} wrap />
      {preview.warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
          {preview.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Exact resulting diff</Label>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px]">
          {preview.diff || "No changes."}
        </pre>
      </div>
      <label
        className={cn(
          "flex items-start gap-2 rounded-md border border-border p-3 text-xs",
          !applicable && "opacity-50",
        )}
      >
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!applicable}
          onChange={(event) => onConfirmed(event.target.checked)}
        />
        <span>I reviewed the exact harness, scope, path, support state, and resulting diff.</span>
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!applicable || !confirmed || pending} onClick={onApply}>
          Confirm and apply
        </Button>
      </div>
    </div>
  )
}

function Filter({
  label,
  value,
  values,
  labels,
  onChange,
  disabled = false,
  disabledValues = [],
}: {
  label: string
  value: string
  values: readonly string[]
  labels: Record<string, string>
  onChange: (value: string) => void
  disabled?: boolean
  disabledValues?: string[]
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px]">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={`${label} filter`} className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((item) => (
            <SelectItem key={item} value={item} disabled={disabledValues.includes(item)}>
              {labels[item] ?? item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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

function Fact({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xs font-medium", wrap ? "break-all" : "truncate")}>{value}</p>
    </div>
  )
}

function SupportBadge({ support }: { support: string }) {
  const positive = support === "supported"
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
        positive
          ? "bg-emerald-500/10 text-emerald-700"
          : support === "unsupported" || support === "disabled"
            ? "bg-red-500/10 text-red-700"
            : "bg-amber-500/10 text-amber-700",
      )}
    >
      {support}
    </span>
  )
}

function nativeKind(kind: ExtensionManagerKind): ExtensionKind {
  return kind === "all" || kind === "plugin" || kind === "mcp" ? "skill" : kind
}

function hookHarness(harness: ExtensionHarness): "claude-code" | "codex" {
  if (harness !== "claude-code" && harness !== "codex")
    throw new Error("Managed hooks support Claude Code and Codex only")
  return harness
}

function targetFor(entry: NativeInventoryState, cwd?: string): NativeExtensionTarget | null {
  const scope = entry.resolved.target.nativeScope
  if (scope !== "user" && scope !== "project") return null
  return {
    harness: entry.resolved.target.harness,
    kind: entry.resolved.target.kind,
    scope,
    name: entry.extension.name,
    ...(scope === "project" ? { cwd } : {}),
  }
}

function draftTarget(draft: Draft, cwd?: string): NativeExtensionTarget {
  return {
    harness: draft.harness,
    kind: draft.kind,
    scope: draft.scope,
    name: draft.name,
    ...(draft.scope === "project" ? { cwd } : {}),
  }
}

function nativeChanges(draft: Draft): NativeChanges {
  const metadata =
    draft.kind === "skill" || draft.kind === "custom-agent"
      ? { name: draft.name, description: draft.description }
      : { description: draft.description }
  return { content: draft.content, metadata }
}

function nativePreview(
  title: string,
  operation: "create" | "update",
  target: NativeExtensionTarget,
  changes: NativeChanges,
  preview: NativeExtensionMutationPreview,
): ActionPreview {
  return {
    type: "native",
    title,
    path: preview.path,
    support: preview.changed ? "supported" : "supported · no change",
    diff: preview.diff || "No changes.",
    warnings: preview.unknownFields.map((field) => `Preserved unknown field: ${field}`),
    preview,
    operation,
    target,
    changes,
  }
}

function buildPolicyLocation(
  scope: "user" | "project" | "task",
  projectId?: string,
  taskId?: string,
): PolicyLocation | null {
  if (scope === "user") return { type: "user" }
  if (!projectId) return null
  if (scope === "project") return { type: "project", projectId }
  return taskId ? { type: "task", projectId, taskId } : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
