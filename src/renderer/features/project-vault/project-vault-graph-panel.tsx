import { useMemo, useState } from "react"
import {
  GitFork,
  ListTree,
  LocateFixed,
  MessageSquarePlus,
  Minus,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import { trpc } from "../../lib/trpc"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import {
  clearProjectVaultGraphSelection,
  stageProjectVaultGraphSelection,
} from "./pending-graph-context"

export function ProjectVaultGraphPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils()
  const [query, setQuery] = useState("")
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>()
  const [mode, setMode] = useState<"graph" | "list">("list")
  const [scope, setScope] = useState<"local" | "whole">("whole")
  const [noteType, setNoteType] = useState("")
  const [tag, setTag] = useState("")
  const [folder, setFolder] = useState("")
  const [linkState, setLinkState] = useState<"" | "resolved" | "unresolved" | "ambiguous">("")
  const [zoom, setZoom] = useState(1)
  const [stagedMode, setStagedMode] = useState<"exact" | "outlinks" | null>(null)
  const [previewMode, setPreviewMode] = useState<"exact" | "outlinks" | null>(null)
  const [artifactToLink, setArtifactToLink] = useState("")
  const graph = trpc.projectVaults.getGraph.useQuery(
    {
      projectId,
      query: query.trim() || undefined,
      focusNodeId,
      scope,
      noteType: noteType || undefined,
      tag: tag || undefined,
      folder: folder || undefined,
      linkState: linkState || undefined,
    },
    { retry: false },
  )
  const rebuild = trpc.projectVaults.rebuildGraph.useMutation({
    onSuccess: async () => {
      await utils.projectVaults.getGraph.invalidate()
    },
  })
  const selected = graph.data?.nodes.find((node) => node.nodeId === focusNodeId) ?? null
  const visualHistory = trpc.visualCapture.history.useQuery(
    { projectId, archived: false },
    { enabled: Boolean(selected) },
  )
  const linkedVisuals = trpc.visualCapture.listLinked.useQuery(
    { consumerKind: "knowledge", consumerId: focusNodeId ?? "" },
    { enabled: Boolean(selected) },
  )
  const linkVisual = trpc.visualCapture.link.useMutation({
    onSuccess: async () => {
      setArtifactToLink("")
      await utils.visualCapture.listLinked.invalidate({
        consumerKind: "knowledge",
        consumerId: focusNodeId ?? "",
      })
    },
  })
  const incoming = graph.data?.edges.filter((edge) => edge.targetNodeId === focusNodeId) ?? []
  const outgoing = graph.data?.edges.filter((edge) => edge.sourceNodeId === focusNodeId) ?? []
  const previewGraphContext = trpc.projectVaults.previewGraphContext.useQuery(
    {
      projectId,
      nodeIds: selected ? [selected.nodeId] : [],
      expectedGenerationId: graph.data?.generationId ?? "00000000-0000-0000-0000-000000000000",
      expansion:
        previewMode === "outlinks" ? { depth: 1, direction: "outgoing", maxNodes: 24 } : undefined,
      budget: { maxBytes: 24_000, maxEstimatedTokens: 6_000 },
    },
    { enabled: Boolean(selected && previewMode && graph.data) },
  )
  const stagePreview = () => {
    if (!selected || !graph.data || !previewMode || !previewGraphContext.data) return
    stageProjectVaultGraphSelection(projectId, {
      nodeIds: [selected.nodeId],
      expectedGenerationId: graph.data.generationId,
      expansion:
        previewMode === "outlinks" ? { depth: 1, direction: "outgoing", maxNodes: 24 } : undefined,
    })
    setStagedMode(previewMode)
  }

  if (graph.error && /not indexed/i.test(graph.error.message)) {
    return (
      <section className="m-auto max-w-md p-6 text-center" aria-labelledby="vault-graph-empty">
        <GitFork className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 id="vault-graph-empty" className="mt-3 text-sm font-semibold">
          Knowledge graph is ready to build
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Markdown remains authoritative. The local index is derived and can be deleted or rebuilt.
        </p>
        <Button
          className="mt-4"
          size="sm"
          disabled={rebuild.isPending}
          onClick={() => rebuild.mutate({ projectId })}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Build graph index
        </Button>
        {rebuild.error && (
          <p className="mt-3 text-xs text-destructive" role="alert">
            {rebuild.error.message}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="vault-graph-heading">
      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="mr-auto">
          <h2 id="vault-graph-heading" className="text-sm font-semibold">
            Knowledge graph
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Exact generation {graph.data?.generationId.slice(0, 8) ?? "loading"}
          </p>
        </div>
        <div className="relative w-56 max-w-full">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8 text-xs"
            aria-label="Filter graph nodes"
            placeholder="Filter notes, aliases, tags…"
          />
        </div>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as "local" | "whole")}
          className="h-8 rounded border bg-background px-2 text-xs"
          aria-label="Graph scope"
        >
          <option value="whole">Whole vault</option>
          <option value="local" disabled={!focusNodeId}>
            Local graph
          </option>
        </select>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={mode === "graph"}
          onClick={() => setMode((value) => (value === "graph" ? "list" : "graph"))}
        >
          {mode === "graph" ? (
            <ListTree className="mr-2 h-4 w-4" />
          ) : (
            <GitFork className="mr-2 h-4 w-4" />
          )}
          {mode === "graph" ? "List" : "Graph"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={rebuild.isPending}
          onClick={() => rebuild.mutate({ projectId })}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Rebuild
        </Button>
      </header>
      <div className="flex flex-wrap gap-2 border-b px-3 py-2">
        <select
          value={noteType}
          onChange={(event) => setNoteType(event.target.value)}
          className="h-8 rounded border bg-background px-2 text-xs"
          aria-label="Filter by note type"
        >
          <option value="">All types</option>
          <option value="seed">Seed</option>
          <option value="custom">Custom</option>
        </select>
        <select
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          className="h-8 rounded border bg-background px-2 text-xs"
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {[...new Set((graph.data?.nodes ?? []).flatMap((node) => node.tags))].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Input
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          className="h-8 w-44 text-xs"
          aria-label="Filter by folder"
          placeholder="Folder path"
        />
        <select
          value={linkState}
          onChange={(event) =>
            setLinkState(event.target.value as "" | "resolved" | "unresolved" | "ambiguous")
          }
          className="h-8 rounded border bg-background px-2 text-xs"
          aria-label="Filter by link state"
        >
          <option value="">All links</option>
          <option value="resolved">Resolved</option>
          <option value="unresolved">Unresolved</option>
          <option value="ambiguous">Ambiguous</option>
        </select>
      </div>

      {graph.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground" role="status">
          Building graph view…
        </p>
      ) : graph.error ? (
        <p className="p-6 text-sm text-destructive" role="alert">
          {graph.error.message}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-80 min-w-0 flex-1 overflow-auto p-4 lg:min-h-0">
            {mode === "graph" ? (
              <ExactGraph
                nodes={graph.data?.nodes ?? []}
                edges={graph.data?.edges ?? []}
                focused={focusNodeId}
                zoom={zoom}
                onFocus={setFocusNodeId}
                onZoom={setZoom}
                onFit={() => {
                  if (focusNodeId) setScope("local")
                  setZoom(1)
                }}
              />
            ) : (
              <NodeList
                nodes={graph.data?.nodes ?? []}
                edges={graph.data?.edges ?? []}
                focused={focusNodeId}
                onFocus={setFocusNodeId}
              />
            )}
          </div>
          <aside
            className="max-h-80 w-full shrink-0 overflow-auto border-t p-4 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0"
            aria-label="Selected note links"
          >
            {selected ? (
              <>
                <h3 className="text-sm font-semibold">{selected.title}</h3>
                <p className="break-all text-[11px] text-muted-foreground">
                  {selected.relativePath}
                </p>
                <div className="mt-3 rounded-md border bg-muted/30 p-2">
                  <p className="text-xs font-medium">Next agent run context</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Single-use and pinned to generation {graph.data!.generationId.slice(0, 8)}.
                    Linked notes are never included implicitly.
                  </p>
                  <div className="mt-2 grid gap-1.5">
                    <Button
                      size="sm"
                      variant={previewMode === "exact" ? "secondary" : "outline"}
                      onClick={() => {
                        setPreviewMode("exact")
                        setStagedMode(null)
                      }}
                    >
                      <MessageSquarePlus className="mr-2 h-4 w-4" />
                      Preview only this note
                    </Button>
                    <Button
                      size="sm"
                      variant={previewMode === "outlinks" ? "secondary" : "outline"}
                      onClick={() => {
                        setPreviewMode("outlinks")
                        setStagedMode(null)
                      }}
                    >
                      <GitFork className="mr-2 h-4 w-4" />
                      Preview direct outlinks
                    </Button>
                    {previewGraphContext.data && previewMode && (
                      <div className="rounded border bg-background p-2 text-[11px]">
                        <p>
                          Preview includes {previewGraphContext.data.entries.length} note
                          {previewGraphContext.data.entries.length === 1 ? "" : "s"}.
                        </p>
                        <p className="text-muted-foreground">
                          {previewGraphContext.data.budget.includedBytes} bytes ·{" "}
                          {previewGraphContext.data.budget.estimatedTokens} estimated tokens
                        </p>
                        <Button className="mt-2 w-full" size="sm" onClick={stagePreview}>
                          <MessageSquarePlus className="mr-2 h-4 w-4" />
                          Stage this exact preview
                        </Button>
                      </div>
                    )}
                    {previewGraphContext.error && (
                      <p className="text-[11px] text-destructive" role="alert">
                        {previewGraphContext.error.message}
                      </p>
                    )}
                    {stagedMode && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          clearProjectVaultGraphSelection(projectId)
                          setStagedMode(null)
                        }}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Clear next-run context
                      </Button>
                    )}
                  </div>
                  {stagedMode && (
                    <p className="mt-2 text-[11px]" role="status">
                      Ready for the next Codex or Claude run in this project.
                    </p>
                  )}
                </div>
                <div className="mt-3 rounded-md border p-2">
                  <p className="text-xs font-medium">Linked visual context</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Verified artifacts linked here are available when this exact note enters a run
                    context.
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <select
                      value={artifactToLink}
                      onChange={(event) => setArtifactToLink(event.target.value)}
                      className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
                      aria-label="Visual artifact to link"
                    >
                      <option value="">Choose artifact…</option>
                      {(visualHistory.data ?? [])
                        .filter(
                          (artifact) =>
                            artifact.integrityState === "ok" &&
                            !(linkedVisuals.data ?? []).some((linked) => linked.id === artifact.id),
                        )
                        .map((artifact) => (
                          <option key={artifact.id} value={artifact.id}>
                            {artifact.id.slice(0, 8)} · {artifact.sourceClass}
                          </option>
                        ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!artifactToLink || linkVisual.isPending}
                      onClick={() =>
                        linkVisual.mutate({
                          artifactId: artifactToLink,
                          consumerKind: "knowledge",
                          consumerId: selected.nodeId,
                        })
                      }
                    >
                      Link
                    </Button>
                  </div>
                  <ul className="mt-2 space-y-1 text-[11px]">
                    {(linkedVisuals.data ?? []).map((artifact) => (
                      <li key={artifact.id} className="flex justify-between gap-2 font-mono">
                        <span>{artifact.id.slice(0, 12)}</span>
                        <span
                          className={
                            artifact.integrityState === "ok"
                              ? "text-emerald-600"
                              : "text-destructive"
                          }
                        >
                          {artifact.integrityState}
                        </span>
                      </li>
                    ))}
                    {!linkedVisuals.isFetching && (linkedVisuals.data?.length ?? 0) === 0 && (
                      <li className="font-sans text-muted-foreground">
                        No visual artifacts linked.
                      </li>
                    )}
                  </ul>
                  {linkVisual.error && (
                    <p className="mt-2 text-[11px] text-destructive" role="alert">
                      {linkVisual.error.message}
                    </p>
                  )}
                </div>
                <LinkList title="Backlinks" edges={incoming} empty="No backlinks." />
                <LinkList title="Outlinks" edges={outgoing} empty="No outlinks." />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select a note in the list to inspect exact backlinks and outlinks.
              </p>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}

type GraphNode = {
  nodeId: string
  stableId: string | null
  relativePath: string
  normalizedPath: string
  title: string
  noteType: string | null
  contentHash: string
  byteLength: number
  aliases: string[]
  tags: string[]
  diagnostics: Array<{ code: string; message: string; line: number | null }>
}

type GraphEdge = {
  sourceNodeId: string
  ordinal: number
  kind: "wikilink" | "embed" | "markdown"
  targetRaw: string
  targetNormalized: string
  targetNodeId: string | null
  heading: string | null
  blockId: string | null
  status: "resolved" | "unresolved" | "ambiguous"
  line: number
}

function NodeList({
  nodes,
  edges,
  focused,
  onFocus,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  focused: string | undefined
  onFocus: (nodeId: string) => void
}) {
  const linkCounts = useMemo(() => buildGraphLinkCounts(edges), [edges])
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Knowledge graph node list">
      {nodes.map((node) => {
        const counts = linkCounts.get(node.nodeId) ?? { incoming: 0, outgoing: 0 }
        return (
          <li key={node.nodeId} style={{ contentVisibility: "auto", containIntrinsicSize: "72px" }}>
            <button
              type="button"
              className="min-h-11 w-full rounded-md border p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={focused === node.nodeId}
              onClick={() => onFocus(node.nodeId)}
            >
              <span className="block truncate text-sm font-medium">{node.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {node.relativePath}
              </span>
              <span className="mt-2 block text-[10px] text-muted-foreground">
                {counts.incoming} backlink{counts.incoming === 1 ? "" : "s"} · {counts.outgoing}{" "}
                outlink
                {counts.outgoing === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ExactGraph({
  nodes,
  edges,
  focused,
  zoom,
  onFocus,
  onZoom,
  onFit,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  focused: string | undefined
  zoom: number
  onFocus: (nodeId: string) => void
  onZoom: (zoom: number) => void
  onFit: () => void
}) {
  const layout = useMemo(() => {
    const visible = nodes.slice(0, 100)
    const positions = new Map(
      visible.map((node, index) => {
        const angle = (index / Math.max(visible.length, 1)) * Math.PI * 2
        return [
          node.nodeId,
          { x: 300 + Math.cos(angle) * 230, y: 260 + Math.sin(angle) * 190 },
        ] as const
      }),
    )
    return { visible, positions }
  }, [nodes])
  return (
    <div>
      <div className="mb-2 flex justify-end gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Zoom out graph"
          onClick={() => onZoom(Math.max(0.5, zoom - 0.25))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" aria-label="Reset graph zoom" onClick={() => onZoom(1)}>
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Zoom in graph"
          onClick={() => onZoom(Math.min(2, zoom + 0.25))}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Fit selected graph node"
          disabled={!focused}
          onClick={onFit}
        >
          <LocateFixed className="h-4 w-4" />
        </Button>
      </div>
      {nodes.length > 100 && (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          Visual view is bounded to 100 filtered/local nodes. The list remains complete.
        </p>
      )}
      <svg
        viewBox="0 0 600 520"
        className="min-h-[420px] w-full rounded-lg border bg-muted/10"
        role="group"
        aria-label={`Knowledge graph with ${layout.visible.length} nodes and ${edges.length} indexed edges`}
      >
        <g style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>
          {edges.map((edge) => {
            const from = layout.positions.get(edge.sourceNodeId)
            const to = edge.targetNodeId ? layout.positions.get(edge.targetNodeId) : undefined
            if (!from || !to || edge.status !== "resolved") return null
            return (
              <line
                key={`${edge.sourceNodeId}:${edge.ordinal}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="stroke-border"
                strokeWidth="1.5"
              />
            )
          })}
          {layout.visible.map((node) => {
            const position = layout.positions.get(node.nodeId)!
            return (
              <g
                key={node.nodeId}
                role="button"
                tabIndex={0}
                aria-label={`Select ${node.title}, ${node.relativePath}`}
                aria-pressed={focused === node.nodeId}
                onClick={() => onFocus(node.nodeId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onFocus(node.nodeId)
                  }
                }}
                className="group cursor-pointer focus:outline-none"
              >
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={22}
                  pointerEvents="all"
                  className="graph-node-touch-target fill-transparent stroke-transparent group-focus-visible:stroke-ring group-focus-visible:stroke-2"
                />
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={focused === node.nodeId ? 9 : 6}
                  className={
                    focused === node.nodeId
                      ? "fill-primary"
                      : node.noteType
                        ? "fill-amber-500"
                        : "fill-muted-foreground"
                  }
                />
                <title>{`${node.title} — ${node.relativePath}`}</title>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

export function buildGraphLinkCounts(
  edges: readonly GraphEdge[],
): Map<string, { incoming: number; outgoing: number }> {
  const counts = new Map<string, { incoming: number; outgoing: number }>()
  const ensure = (nodeId: string) => {
    const current = counts.get(nodeId)
    if (current) return current
    const created = { incoming: 0, outgoing: 0 }
    counts.set(nodeId, created)
    return created
  }
  for (const edge of edges) {
    ensure(edge.sourceNodeId).outgoing += 1
    if (edge.targetNodeId) ensure(edge.targetNodeId).incoming += 1
  }
  return counts
}

function LinkList({ title, edges, empty }: { title: string; edges: GraphEdge[]; empty: string }) {
  return (
    <section className="mt-5">
      <h4 className="text-xs font-semibold">{title}</h4>
      {edges.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {edges.map((edge) => (
            <li key={`${edge.sourceNodeId}:${edge.ordinal}`} className="break-all">
              {edge.targetRaw}{" "}
              <span className="text-muted-foreground">
                ({edge.status}
                {edge.heading ? `, #${edge.heading}` : ""})
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}
