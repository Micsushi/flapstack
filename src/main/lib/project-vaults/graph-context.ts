import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { createHash } from "node:crypto"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { readFileInsideRoot, type RootedReadOptions } from "../path-safety"
import { containsProjectVaultSecret } from "./content-safety"
import {
  currentProjectVaultGraph,
  type ProjectVaultGraphEdge,
  type ProjectVaultGraphNode,
} from "./graph-index"

export const PROJECT_VAULT_GRAPH_CONTEXT_POLICY = {
  maxDepth: 2,
  maxNodes: 24,
  maxBytes: 24_000,
  maxEstimatedTokens: 6_000,
} as const

export type ProjectVaultGraphExpansionDirection = "outgoing" | "incoming" | "both"

export type ProjectVaultGraphContextManifest = {
  schemaVersion: 1
  status: "included" | "empty" | "rejected"
  projectId: string
  generationId: string
  selectedNodeIds: string[]
  expansion: {
    depth: number
    direction: ProjectVaultGraphExpansionDirection
    maxNodes: number
  }
  budget: {
    maxBytes: number
    maxEstimatedTokens: number
    includedBytes: number
    estimatedTokens: number
  }
  entries: Array<{
    nodeId: string
    stableId: string | null
    title: string
    sourcePath: string
    contentHash: string
    originalBytes: number
    includedBytes: number
    estimatedTokens: number
    truncated: boolean
    reason: "selected" | "linked"
    depth: number
  }>
  traversedEdges: Array<{
    sourceNodeId: string
    targetNodeId: string
    ordinal: number
    direction: "outgoing" | "incoming"
    depth: number
  }>
  omissions: Array<{
    nodeId: string
    reason: "node-limit"
    discoveredFromNodeId: string
  }>
  rejection?: {
    nodeId?: string
    reason:
      "stale-generation" | "node-not-found" | "content-changed" | "secret-detected" | "unsafe-path"
  }
}

export type ProjectVaultGraphRunContext = {
  context: string
  manifest: ProjectVaultGraphContextManifest
}

export class ProjectVaultGraphContextRejectedError extends Error {
  constructor(
    message: string,
    public readonly manifest: ProjectVaultGraphContextManifest,
  ) {
    super(message)
    this.name = "ProjectVaultGraphContextRejectedError"
  }
}

export async function buildProjectVaultGraphContext(
  database: Database.Database | object,
  input: {
    projectId: string
    nodeIds: readonly string[]
    expectedGenerationId: string
    expansion?: {
      depth: number
      direction: ProjectVaultGraphExpansionDirection
      maxNodes: number
    }
    budget?: {
      maxBytes: number
      maxEstimatedTokens: number
    }
    /** Test seam for deterministic rooted-read namespace swaps. */
    rootedReadOptions?: Pick<RootedReadOptions, "beforeOpen">
  },
): Promise<ProjectVaultGraphRunContext> {
  const sqlite = rawClient(database)
  const selectedNodeIds = uniqueNodeIds(input.nodeIds)
  const expansion = normalizeExpansion(input.expansion, selectedNodeIds.length)
  const budget = normalizeBudget(input.budget)
  const graph = currentProjectVaultGraph(sqlite, input.projectId)
  const manifest: ProjectVaultGraphContextManifest = {
    schemaVersion: 1,
    status: selectedNodeIds.length === 0 ? "empty" : "included",
    projectId: input.projectId,
    generationId: graph.generationId,
    selectedNodeIds,
    expansion,
    budget: { ...budget, includedBytes: 0, estimatedTokens: 0 },
    entries: [],
    traversedEdges: [],
    omissions: [],
  }
  if (graph.generationId !== input.expectedGenerationId) {
    reject(manifest, "stale-generation", undefined, "Project vault graph generation changed.")
  }
  if (selectedNodeIds.length === 0) return { context: "", manifest }

  const nodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]))
  for (const nodeId of selectedNodeIds) {
    if (!nodesById.has(nodeId)) {
      reject(manifest, "node-not-found", nodeId, "Selected project vault graph node was not found.")
    }
  }

  const selection = expandSelection(selectedNodeIds, nodesById, graph.edges, expansion, manifest)
  const root = registeredVaultRoot(sqlite, input.projectId)
  let remainingBytes = budget.maxBytes
  let remainingTokens = budget.maxEstimatedTokens
  const blocks: string[] = []

  for (const selected of selection) {
    const node = selected.node
    const bytes = await readFileInsideRoot(root, node.relativePath, {
      ...input.rootedReadOptions,
      maxBytes: 64 * 1_048_576,
    }).catch(() =>
      reject(
        manifest,
        "unsafe-path",
        node.nodeId,
        "Project vault graph context refused an unsafe note path.",
      ),
    )
    const content = bytes.toString("utf8")
    if (sha256(content) !== node.contentHash) {
      reject(
        manifest,
        "content-changed",
        node.nodeId,
        "Project vault note changed after the selected graph generation.",
      )
    }
    if (containsProjectVaultSecret(content)) {
      reject(
        manifest,
        "secret-detected",
        node.nodeId,
        "Project vault graph context rejected secret-like note content.",
      )
    }
    const included = truncateToBudget(content, remainingBytes, remainingTokens)
    const originalBytes = Buffer.byteLength(content, "utf8")
    const includedBytes = Buffer.byteLength(included, "utf8")
    const estimatedTokens = estimateTokens(included)
    const truncated = included.length < content.length
    manifest.entries.push({
      nodeId: node.nodeId,
      stableId: node.stableId,
      title: node.title,
      sourcePath: node.relativePath,
      contentHash: node.contentHash,
      originalBytes,
      includedBytes,
      estimatedTokens,
      truncated,
      reason: selected.reason,
      depth: selected.depth,
    })
    manifest.budget.includedBytes += includedBytes
    manifest.budget.estimatedTokens += estimatedTokens
    remainingBytes -= includedBytes
    remainingTokens -= estimatedTokens
    blocks.push(formatNodeBlock(node, selected.reason, selected.depth, included, truncated))
  }

  return {
    context: `--- FLAPSTACK SELECTED PROJECT VAULT GRAPH CONTEXT (DO NOT QUOTE) ---\n${blocks.join(
      "\n\n",
    )}\n--- END FLAPSTACK SELECTED PROJECT VAULT GRAPH CONTEXT ---`,
    manifest,
  }
}

function expandSelection(
  selectedNodeIds: string[],
  nodesById: Map<string, ProjectVaultGraphNode>,
  edges: ProjectVaultGraphEdge[],
  expansion: ProjectVaultGraphContextManifest["expansion"],
  manifest: ProjectVaultGraphContextManifest,
): Array<{ node: ProjectVaultGraphNode; reason: "selected" | "linked"; depth: number }> {
  const result: Array<{
    node: ProjectVaultGraphNode
    reason: "selected" | "linked"
    depth: number
  }> = selectedNodeIds.map((nodeId) => ({
    node: nodesById.get(nodeId)!,
    reason: "selected" as const,
    depth: 0,
  }))
  const visited = new Set(selectedNodeIds)
  let frontier = [...selectedNodeIds]
  for (let depth = 1; depth <= expansion.depth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const fromNodeId of frontier) {
      for (const candidate of neighborEdges(fromNodeId, edges, expansion.direction)) {
        if (visited.has(candidate.nodeId)) continue
        if (result.length >= expansion.maxNodes) {
          const omission = {
            nodeId: candidate.nodeId,
            reason: "node-limit" as const,
            discoveredFromNodeId: fromNodeId,
          }
          if (
            !manifest.omissions.some(
              (item) =>
                item.nodeId === omission.nodeId &&
                item.discoveredFromNodeId === omission.discoveredFromNodeId,
            )
          ) {
            manifest.omissions.push(omission)
          }
          continue
        }
        const node = nodesById.get(candidate.nodeId)
        if (!node) continue
        visited.add(candidate.nodeId)
        next.push(candidate.nodeId)
        result.push({ node, reason: "linked", depth })
        manifest.traversedEdges.push({
          sourceNodeId: candidate.edge.sourceNodeId,
          targetNodeId: candidate.edge.targetNodeId!,
          ordinal: candidate.edge.ordinal,
          direction: candidate.direction,
          depth,
        })
      }
    }
    frontier = next
  }
  return result
}

function neighborEdges(
  nodeId: string,
  edges: ProjectVaultGraphEdge[],
  direction: ProjectVaultGraphExpansionDirection,
): Array<{
  nodeId: string
  edge: ProjectVaultGraphEdge
  direction: "outgoing" | "incoming"
}> {
  const candidates: Array<{
    nodeId: string
    edge: ProjectVaultGraphEdge
    direction: "outgoing" | "incoming"
  }> = []
  for (const edge of edges) {
    if (edge.status !== "resolved" || !edge.targetNodeId) continue
    if ((direction === "outgoing" || direction === "both") && edge.sourceNodeId === nodeId) {
      candidates.push({ nodeId: edge.targetNodeId, edge, direction: "outgoing" })
    }
    if ((direction === "incoming" || direction === "both") && edge.targetNodeId === nodeId) {
      candidates.push({ nodeId: edge.sourceNodeId, edge, direction: "incoming" })
    }
  }
  return candidates.sort(
    (left, right) =>
      left.edge.sourceNodeId.localeCompare(right.edge.sourceNodeId, "en-US") ||
      left.edge.ordinal - right.edge.ordinal ||
      left.direction.localeCompare(right.direction, "en-US"),
  )
}

function uniqueNodeIds(nodeIds: readonly string[]): string[] {
  const seen = new Set<string>()
  return nodeIds.map((nodeId) => {
    const normalized = nodeId.trim()
    if (!normalized || normalized.length > 200) {
      throw new Error("Project vault graph node identity is invalid.")
    }
    if (seen.has(normalized)) {
      throw new Error(`Duplicate project vault graph context node: ${normalized}`)
    }
    seen.add(normalized)
    return normalized
  })
}

function normalizeExpansion(
  value:
    | {
        depth: number
        direction: ProjectVaultGraphExpansionDirection
        maxNodes: number
      }
    | undefined,
  selectedCount: number,
): ProjectVaultGraphContextManifest["expansion"] {
  const expansion = value ?? {
    depth: 0,
    direction: "outgoing" as const,
    maxNodes: Math.max(1, selectedCount),
  }
  if (
    !Number.isInteger(expansion.depth) ||
    expansion.depth < 0 ||
    expansion.depth > PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxDepth
  ) {
    throw new Error("Project vault graph expansion depth must be between zero and two.")
  }
  if (!["outgoing", "incoming", "both"].includes(expansion.direction)) {
    throw new Error("Project vault graph expansion direction is invalid.")
  }
  if (
    !Number.isInteger(expansion.maxNodes) ||
    expansion.maxNodes < selectedCount ||
    expansion.maxNodes > PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxNodes
  ) {
    throw new Error("Project vault graph expansion node limit is invalid.")
  }
  return expansion
}

function normalizeBudget(value?: { maxBytes: number; maxEstimatedTokens: number }) {
  const budget = value ?? {
    maxBytes: PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxBytes,
    maxEstimatedTokens: PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxEstimatedTokens,
  }
  if (
    !Number.isInteger(budget.maxBytes) ||
    budget.maxBytes < 0 ||
    budget.maxBytes > PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxBytes
  ) {
    throw new Error(
      `Project vault graph context byte budget must be between zero and ${PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxBytes}.`,
    )
  }
  if (
    !Number.isInteger(budget.maxEstimatedTokens) ||
    budget.maxEstimatedTokens < 0 ||
    budget.maxEstimatedTokens > PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxEstimatedTokens
  ) {
    throw new Error(
      `Project vault graph context token budget must be between zero and ${PROJECT_VAULT_GRAPH_CONTEXT_POLICY.maxEstimatedTokens}.`,
    )
  }
  return budget
}

function registeredVaultRoot(sqlite: Database.Database, projectId: string): string {
  const row = sqlite
    .prepare("SELECT root_path FROM project_vaults WHERE project_id = ?")
    .get(projectId) as { root_path: string } | undefined
  if (!row) throw new Error("Project vault is not scaffolded.")
  return assertRegisteredFilesystemRoot(row.root_path, drizzle(sqlite, { schema })).canonicalPath
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

function truncateToBudget(content: string, maxBytes: number, maxTokens: number): string {
  let low = 0
  let high = content.length
  while (low < high) {
    const next = Math.ceil((low + high) / 2)
    const prefix = safePrefix(content, next)
    if (Buffer.byteLength(prefix, "utf8") <= maxBytes && estimateTokens(prefix) <= maxTokens) {
      low = next
    } else {
      high = next - 1
    }
  }
  return safePrefix(content, low)
}

function safePrefix(content: string, length: number): string {
  const prefix = content.slice(0, length)
  const last = prefix.charCodeAt(prefix.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix
}

function formatNodeBlock(
  node: ProjectVaultGraphNode,
  reason: "selected" | "linked",
  depth: number,
  content: string,
  truncated: boolean,
): string {
  return `--- BEGIN SELECTED VAULT GRAPH NODE ${node.nodeId}: ${node.title} ---\nSource: ${node.relativePath}\nSHA-256: ${node.contentHash}\nSelection: ${reason}; depth=${depth}\n\n${content}${truncated ? "\n\n[...truncated by Flapstack vault graph context budget...]" : ""}\n--- END SELECTED VAULT GRAPH NODE ${node.nodeId} ---`
}

function reject(
  manifest: ProjectVaultGraphContextManifest,
  reason: NonNullable<ProjectVaultGraphContextManifest["rejection"]>["reason"],
  nodeId: string | undefined,
  message: string,
): never {
  manifest.status = "rejected"
  manifest.rejection = nodeId ? { nodeId, reason } : { reason }
  throw new ProjectVaultGraphContextRejectedError(message, manifest)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function rawClient(database: Database.Database | object): Database.Database {
  return "prepare" in database
    ? (database as Database.Database)
    : (database as { $client: Database.Database }).$client
}
