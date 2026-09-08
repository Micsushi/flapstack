import type Database from "better-sqlite3"
import { z } from "zod"
import {
  runContextHealthInputSchema,
  type RunContextHealth,
} from "../../../shared/run-context-health"
import { containsProjectVaultSecret } from "./content-safety"
import { projectVaultSectionIds } from "./registry"

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value) && !containsProjectVaultSecret(value))
const id = text(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  bytes = z
    .number()
    .int()
    .min(0)
    .max(16 * 1024 * 1024)
const status = z.enum(["included", "empty", "rejected"])
const sectionId = z.enum(projectVaultSectionIds)
const budget = z
  .object({
    maxBytes: bytes,
    maxEstimatedTokens: bytes,
    includedBytes: bytes,
    estimatedTokens: bytes,
  })
  .strict()
  .refine((v) => v.includedBytes <= v.maxBytes && v.estimatedTokens <= v.maxEstimatedTokens)
const entry = {
  title: text(500),
  sourcePath: text(2000),
  contentHash: hash,
  originalBytes: bytes,
  includedBytes: bytes,
  estimatedTokens: bytes,
  truncated: z.boolean(),
}
const rejection = z
  .object({
    sectionId: sectionId.optional(),
    nodeId: id.optional(),
    reason: z.enum([
      "secret-detected",
      "content-changed",
      "stale-generation",
      "node-not-found",
      "unsafe-path",
    ]),
  })
  .strict()
const graph = z
  .object({
    schemaVersion: z.literal(1),
    status,
    projectId: id,
    generationId: id,
    selectedNodeIds: z.array(id).max(24),
    expansion: z
      .object({
        depth: z.number().int().min(0).max(2),
        direction: z.enum(["outgoing", "incoming", "both"]),
        maxNodes: z.number().int().min(1).max(24),
      })
      .strict(),
    budget,
    entries: z
      .array(
        z
          .object({
            ...entry,
            nodeId: id,
            stableId: id.nullable(),
            reason: z.enum(["selected", "linked"]),
            depth: z.number().int().min(0).max(2),
          })
          .strict(),
      )
      .max(24),
    traversedEdges: z
      .array(
        z
          .object({
            sourceNodeId: id,
            targetNodeId: id,
            ordinal: z.number().int().nonnegative(),
            direction: z.enum(["outgoing", "incoming"]),
            depth: z.number().int().min(0).max(2),
          })
          .strict(),
      )
      .max(1024),
    omissions: z
      .array(
        z
          .object({ nodeId: id, reason: z.literal("node-limit"), discoveredFromNodeId: id })
          .strict(),
      )
      .max(1024),
    rejection: rejection.optional(),
  })
  .strict()
const manifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    status,
    harness: z.enum(["codex", "claude-code"]),
    projectId: id.nullable(),
    taskId: id.nullable(),
    runId: id.nullable(),
    selectionSource: z.enum(["run", "task", "project", "fixed-default"]),
    selectedSectionIds: z.array(sectionId).max(6),
    budget,
    entries: z
      .array(z.object({ ...entry, sectionId, version: z.number().int().positive() }).strict())
      .max(6),
    truncations: z
      .array(
        z
          .object({
            sectionId,
            originalBytes: bytes,
            includedBytes: bytes,
            reason: z.enum(["byte-budget", "token-budget", "byte-and-token-budget"]),
          })
          .strict(),
      )
      .max(6),
    graphContext: graph.optional(),
    rejection: rejection.optional(),
  })
  .strict()
const unknownCurrent = () => ({
  status: "unknown" as const,
  version: null,
  contentHash: null,
  recordedAt: null,
})

/** Metadata-only comparison: no vault creation, filesystem reads, graph rebuild, or provider receipt claim. */
export function getRunContextHealth(
  db: Database.Database,
  raw: z.input<typeof runContextHealthInputSchema>,
): RunContextHealth {
  const input = runContextHealthInputSchema.parse(raw)
  if (!id.safeParse(input.chatId).success || !id.safeParse(input.runId).success)
    throw new Error("Invalid run identity.")
  const row = db
    .prepare(
      "SELECT r.id,r.harness,c.project_id,c.task_id,CASE WHEN length(CAST(r.vault_context_manifest AS BLOB)) <= 131072 THEN r.vault_context_manifest ELSE NULL END manifest FROM agent_runs r JOIN chats c ON c.id=r.chat_id WHERE r.id=? AND r.chat_id=?",
    )
    .get(input.runId, input.chatId) as
    | {
        id: string
        harness: string
        project_id: string | null
        task_id: string | null
        manifest: string | null
      }
    | undefined
  if (!row) throw new Error("Run was not found in this chat.")
  const result: RunContextHealth = {
    ...input,
    projectId: id.nullable().safeParse(row.project_id).success ? row.project_id : null,
    taskId: id.nullable().safeParse(row.task_id).success ? row.task_id : null,
    checkedAt: Date.now(),
    status: "unavailable",
    reason: "No usable launch context manifest is available.",
    selectionSource: null,
    budget: null,
    graphGenerationId: null,
    sources: [],
    filesystemFreshness: "unverified",
    providerReceipt: "unverified",
  }
  if (!row.manifest) return result
  let parsed: z.infer<typeof manifestSchema>
  try {
    parsed = manifestSchema.parse(JSON.parse(row.manifest))
  } catch {
    return result
  }
  // Only the explicit fixed-default empty manifest may omit launch scope.
  const emptyDefault =
    parsed.status === "empty" &&
    parsed.selectionSource === "fixed-default" &&
    parsed.projectId === null &&
    parsed.taskId === null &&
    !parsed.selectedSectionIds.length &&
    !parsed.entries.length &&
    !parsed.graphContext
  if (
    (parsed.runId !== null && parsed.runId !== input.runId) ||
    parsed.harness !== row.harness ||
    (!emptyDefault &&
      (parsed.runId !== input.runId ||
        parsed.projectId !== row.project_id ||
        parsed.taskId !== row.task_id)) ||
    (parsed.status !== "empty" && !parsed.projectId) ||
    (parsed.graphContext &&
      (parsed.graphContext.projectId !== row.project_id || parsed.schemaVersion !== 2))
  )
    return result
  const allEntries = [...parsed.entries, ...(parsed.graphContext?.entries ?? [])]
  if (
    new Set(parsed.entries.map((e) => e.sectionId)).size !== parsed.entries.length ||
    new Set(parsed.selectedSectionIds).size !== parsed.selectedSectionIds.length ||
    parsed.entries.some((e) => !parsed.selectedSectionIds.includes(e.sectionId)) ||
    new Set(parsed.graphContext?.entries.map((e) => e.nodeId)).size !==
      (parsed.graphContext?.entries.length ?? 0) ||
    allEntries.some(
      (e) => e.includedBytes > e.originalBytes || e.truncated !== e.includedBytes < e.originalBytes,
    ) ||
    (parsed.status === "empty" && allEntries.length) ||
    (parsed.status === "rejected" && !parsed.rejection)
  )
    return result
  result.status = parsed.status
  result.reason =
    parsed.status === "rejected"
      ? `Launch context was rejected: ${parsed.rejection!.reason}.`
      : null
  result.selectionSource = parsed.selectionSource
  result.budget = parsed.budget
  result.graphGenerationId = parsed.graphContext?.generationId ?? null
  result.sources = parsed.entries.map((source) => {
    const current = db
      .prepare(
        "SELECT version,content_hash,relative_path,updated_at FROM project_vault_sections WHERE project_id=? AND section_id=?",
      )
      .get(row.project_id, source.sectionId) as
      | { version: number; content_hash: string; relative_path: string; updated_at: number | null }
      | undefined
    let comparison: RunContextHealth["sources"][number]["current"] = {
      ...unknownCurrent(),
      status: "missing",
    }
    if (current) {
      const safe = z
        .object({
          version: z.number().int().positive(),
          content_hash: hash,
          relative_path: text(2000),
          updated_at: z.number().int().nonnegative().max(8_640_000_000_000).nullable(),
        })
        .safeParse(current)
      comparison = safe.success
        ? {
            status:
              current.version === source.version &&
              current.content_hash === source.contentHash &&
              current.relative_path === source.sourcePath
                ? "unchanged"
                : "changed",
            version: current.version,
            contentHash: current.content_hash,
            recordedAt: current.updated_at === null ? null : current.updated_at * 1000,
          }
        : unknownCurrent()
    }
    return {
      kind: "section",
      id: source.sectionId,
      title: source.title,
      sourcePath: source.sourcePath,
      version: source.version,
      contentHash: source.contentHash,
      originalBytes: source.originalBytes,
      includedBytes: source.includedBytes,
      estimatedTokens: source.estimatedTokens,
      truncated: source.truncated,
      current: comparison,
    }
  })
  const graphSources = parsed.graphContext?.entries ?? []
  // Graph timestamps use epoch seconds, just like section metadata. Only the
  // current committed generation is evidence; a missing index is not a missing node.
  const generation = graphSources.length
    ? db
        .prepare(
          "SELECT g.id,g.committed_at FROM project_vault_graph_state s JOIN project_vault_graph_generations g ON g.id=s.current_generation_id WHERE s.project_id=? AND g.project_id=? AND g.state='committed'",
        )
        .get(row.project_id, row.project_id)
    : undefined
  const safeGeneration = z
    .object({ id, committed_at: z.number().int().nonnegative().max(8_640_000_000_000) })
    .safeParse(generation)
  const currentNodes = safeGeneration.success
    ? (db
        .prepare(
          `SELECT node_id,project_id,relative_path,content_hash FROM project_vault_graph_nodes WHERE generation_id=? AND node_id IN (${graphSources.map(() => "?").join(",")})`,
        )
        .all(safeGeneration.data.id, ...graphSources.map((source) => source.nodeId)) as Array<{
        node_id: string
        project_id: string
        relative_path: string
        content_hash: string
      }>)
    : []
  const nodesById = new Map(currentNodes.map((node) => [node.node_id, node]))
  for (const source of graphSources) {
    let current: RunContextHealth["sources"][number]["current"] = unknownCurrent()
    if (safeGeneration.success) {
      const node = nodesById.get(source.nodeId)
      if (!node)
        current = {
          ...unknownCurrent(),
          status: "missing",
          recordedAt: safeGeneration.data.committed_at * 1000,
        }
      else {
        const safe = z
          .object({ node_id: id, project_id: id, relative_path: text(2000), content_hash: hash })
          .safeParse(node)
        if (safe.success && safe.data.project_id === row.project_id)
          current = {
            status:
              safe.data.relative_path === source.sourcePath &&
              safe.data.content_hash === source.contentHash
                ? "unchanged"
                : "changed",
            version: null,
            contentHash: safe.data.content_hash,
            recordedAt: safeGeneration.data.committed_at * 1000,
          }
      }
    }
    result.sources.push({
      kind: "graph",
      id: source.nodeId,
      title: source.title,
      sourcePath: source.sourcePath,
      version: null,
      contentHash: source.contentHash,
      originalBytes: source.originalBytes,
      includedBytes: source.includedBytes,
      estimatedTokens: source.estimatedTokens,
      truncated: source.truncated,
      current,
    })
  }
  return result
}
