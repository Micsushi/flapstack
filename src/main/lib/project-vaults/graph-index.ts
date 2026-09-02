import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { lstat, opendir } from "node:fs/promises"
import { basename, extname, join, posix, relative, sep } from "node:path"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { publishLocalProjectVaultGraphInvalidation } from "../mcp-control/invalidation-bridge"
import { readFileInsideRoot } from "../path-safety"
import {
  parseObsidianNote,
  type ObsidianNoteLink,
  type ParsedObsidianNote,
} from "./obsidian-markdown"
import { migrateProjectVaultSeedIdentities } from "./seed-identity"
import { containsProjectVaultSecret } from "./content-safety"

const MAX_NOTES = 10_000
const MAX_TOTAL_BYTES = 64 * 1_048_576
const IGNORED_DIRECTORIES = new Set([
  ".backups",
  ".obsidian",
  ".flapstack-backups",
  ".flapstack-trash",
])

type ScannedNode = {
  nodeId: string
  stableId: string | null
  relativePath: string
  normalizedPath: string
  title: string
  noteType: string | null
  contentHash: string
  byteLength: number
  parsed: ParsedObsidianNote
}

export type ProjectVaultGraphBuildResult = {
  generationId: string
  projectId: string
  sourceFingerprint: string
  noteCount: number
  edgeCount: number
}

export type ProjectVaultGraphNode = Omit<ScannedNode, "parsed"> & {
  aliases: string[]
  tags: string[]
  diagnostics: ParsedObsidianNote["diagnostics"]
}

export type ProjectVaultGraphEdge = {
  sourceNodeId: string
  ordinal: number
  kind: ObsidianNoteLink["kind"]
  targetRaw: string
  targetNormalized: string
  targetNodeId: string | null
  heading: string | null
  blockId: string | null
  status: "resolved" | "unresolved" | "ambiguous"
  line: number
}

type PendingRebuild = {
  timer: NodeJS.Timeout
  promises: Array<{
    resolve: (result: ProjectVaultGraphBuildResult) => void
    reject: (error: unknown) => void
  }>
}

export interface ProjectVaultWatcher {
  on(event: "all", listener: (event: string) => void): this
  on(event: "error", listener: (error: unknown) => void): this
  once(event: "ready", listener: () => void): this
  once(event: "error", listener: (error: unknown) => void): this
  off(event: "ready", listener: () => void): this
  off(event: "error", listener: (error: unknown) => void): this
  close(): Promise<void>
}

export type ProjectVaultGraphIndexOptions = {
  watchFactory?: (root: string, options: Record<string, unknown>) => ProjectVaultWatcher
  reportWatcherError?: (projectId: string, error: unknown) => void
}

const graphIndexes = new WeakMap<object, ProjectVaultGraphIndex>()

export function projectVaultGraphIndex(database: Database.Database | object) {
  const key = database as object
  const existing = graphIndexes.get(key)
  if (existing) return existing
  const created = new ProjectVaultGraphIndex(database)
  graphIndexes.set(key, created)
  return created
}

export async function closeProjectVaultGraphWatchers(
  database: Database.Database | object,
): Promise<void> {
  await graphIndexes.get(database as object)?.closeWatchers()
}

export class ProjectVaultGraphIndex {
  private readonly pending = new Map<string, PendingRebuild>()
  private readonly watchers = new Map<
    string,
    { root: string; watcher: ProjectVaultWatcher; onError: (error: unknown) => void }
  >()
  private readonly sqlite: Database.Database
  private closePromise: Promise<void> | null = null

  constructor(
    database: Database.Database | object,
    private readonly options: ProjectVaultGraphIndexOptions = {},
  ) {
    this.sqlite = rawClient(database)
  }

  async rebuild(
    projectId: string,
    options: { migrateSeedIdentities?: boolean } = {},
  ): Promise<ProjectVaultGraphBuildResult> {
    if (options.migrateSeedIdentities !== false) {
      await migrateProjectVaultSeedIdentities(this.sqlite, projectId)
    }
    const { root, seedIds } = this.requireRoot(projectId)
    const nodes = await scanNotes(root, seedIds)
    const generationId = randomUUID()
    const edges = resolveEdges(nodes)
    const sourceFingerprint = fingerprint(nodes)
    const now = Math.floor(Date.now() / 1_000)

    this.sqlite
      .transaction(() => {
        this.sqlite
          .prepare(
            `INSERT INTO project_vault_graph_generations
             (id, project_id, state, source_fingerprint, note_count, edge_count, created_at,
              committed_at)
             VALUES (?, ?, 'committed', ?, ?, ?, ?, ?)`,
          )
          .run(generationId, projectId, sourceFingerprint, nodes.length, edges.length, now, now)
        const insertNode = this.sqlite.prepare(
          `INSERT INTO project_vault_graph_nodes
           (generation_id, node_id, project_id, stable_id, relative_path, normalized_path,
            title, note_type, content_hash, byte_length, aliases_json, tags_json, diagnostics_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const node of nodes) {
          insertNode.run(
            generationId,
            node.nodeId,
            projectId,
            node.stableId,
            node.relativePath,
            node.normalizedPath,
            node.title,
            node.noteType,
            node.contentHash,
            node.byteLength,
            JSON.stringify(node.parsed.aliases),
            JSON.stringify(node.parsed.tags),
            JSON.stringify(node.parsed.diagnostics),
          )
        }
        const insertEdge = this.sqlite.prepare(
          `INSERT INTO project_vault_graph_edges
           (generation_id, source_node_id, ordinal, kind, target_raw, target_normalized,
            target_node_id, heading, block_id, status, line)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const edge of edges) {
          insertEdge.run(
            generationId,
            edge.sourceNodeId,
            edge.ordinal,
            edge.kind,
            edge.targetRaw,
            edge.targetNormalized,
            edge.targetNodeId,
            edge.heading,
            edge.blockId,
            edge.status,
            edge.line,
          )
        }
        this.sqlite
          .prepare(
            `INSERT INTO project_vault_graph_state
             (project_id, current_generation_id, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(project_id) DO UPDATE SET
               current_generation_id = excluded.current_generation_id,
               updated_at = excluded.updated_at`,
          )
          .run(projectId, generationId, now)
      })
      .immediate()

    publishLocalProjectVaultGraphInvalidation(projectId)

    return {
      generationId,
      projectId,
      sourceFingerprint,
      noteCount: nodes.length,
      edgeCount: edges.length,
    }
  }

  scheduleRebuild(projectId: string, debounceMs = 250): Promise<ProjectVaultGraphBuildResult> {
    return new Promise((resolve, reject) => {
      const existing = this.pending.get(projectId)
      if (existing) {
        clearTimeout(existing.timer)
        existing.promises.push({ resolve, reject })
        existing.timer = this.arm(projectId, debounceMs)
        return
      }
      this.pending.set(projectId, {
        timer: this.arm(projectId, debounceMs),
        promises: [{ resolve, reject }],
      })
    })
  }

  async startWatching(projectId: string): Promise<void> {
    await this.closePromise
    const { root } = this.requireRoot(projectId)
    const current = this.watchers.get(projectId)
    if (current?.root === root) return
    if (current) {
      await current.watcher.close()
      this.watchers.delete(projectId)
    }
    const watchFactory =
      this.options.watchFactory ??
      ((await import("chokidar")).watch as unknown as ProjectVaultGraphIndexOptions["watchFactory"])
    const watcher = watchFactory!(root, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 },
      ignored: (path: string) =>
        path
          .split(/[\\/]/)
          .some((part: string) => IGNORED_DIRECTORIES.has(part) || part.startsWith(".flapstack-")),
    })
    watcher.on("all", (event) => {
      if (!["add", "change", "unlink", "addDir", "unlinkDir"].includes(event)) return
      void this.scheduleRebuild(projectId).catch(() => undefined)
    })
    const onError = (error: unknown) => {
      try {
        this.options.reportWatcherError?.(projectId, error)
      } catch (reportError) {
        console.warn("[ProjectVaultGraph] Watcher error reporter failed:", reportError)
      }
    }
    watcher.on("error", onError)
    this.watchers.set(projectId, { root, watcher, onError })
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const onReady = () => {
          watcher.off("error", onStartupError)
          resolveReady()
        }
        const onStartupError = (error: unknown) => {
          watcher.off("ready", onReady)
          rejectReady(error)
        }
        watcher.once("ready", onReady)
        watcher.once("error", onStartupError)
      })
    } catch (error) {
      this.watchers.delete(projectId)
      await watcher.close().catch(() => undefined)
      throw error
    }
  }

  async closeWatchers(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closePromise = (async () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        for (const promise of pending.promises) {
          promise.reject(new Error("Project vault graph index is closing."))
        }
      }
      this.pending.clear()
      const watchers = [...this.watchers.values()]
      this.watchers.clear()
      await Promise.all(watchers.map(({ watcher }) => watcher.close()))
    })()
    try {
      await this.closePromise
    } finally {
      this.closePromise = null
    }
  }

  private arm(projectId: string, debounceMs: number): NodeJS.Timeout {
    return setTimeout(
      () => {
        const pending = this.pending.get(projectId)
        if (!pending) return
        this.pending.delete(projectId)
        void this.rebuild(projectId).then(
          (result) => pending.promises.forEach((promise) => promise.resolve(result)),
          (error) => pending.promises.forEach((promise) => promise.reject(error)),
        )
      },
      Math.max(0, Math.min(debounceMs, 5_000)),
    )
  }

  private requireRoot(projectId: string): { root: string; seedIds: Map<string, string> } {
    const row = this.sqlite
      .prepare("SELECT root_path FROM project_vaults WHERE project_id = ?")
      .get(projectId) as { root_path: string } | undefined
    if (!row) throw new Error("Project vault is not scaffolded.")
    const root = assertRegisteredFilesystemRoot(
      row.root_path,
      drizzle(this.sqlite, { schema }),
    ).canonicalPath
    const seedIds = new Map(
      (
        this.sqlite
          .prepare(
            "SELECT relative_path, section_id FROM project_vault_sections WHERE project_id = ?",
          )
          .all(projectId) as Array<{ relative_path: string; section_id: string }>
      ).map((section) => [
        section.relative_path.replace(/\\/g, "/").normalize("NFKC").toLocaleLowerCase("en-US"),
        `seed:${section.section_id}`,
      ]),
    )
    return { root, seedIds }
  }
}

export function currentProjectVaultGraph(database: Database.Database | object, projectId: string) {
  const sqlite = rawClient(database)
  const state = sqlite
    .prepare(
      `SELECT s.current_generation_id generation_id
       FROM project_vault_graph_state s
       JOIN project_vault_graph_generations g ON g.id = s.current_generation_id
       WHERE s.project_id = ? AND g.project_id = ? AND g.state = 'committed'`,
    )
    .get(projectId, projectId) as { generation_id: string } | undefined
  if (!state) throw new Error("Project vault graph is not indexed.")
  const generationId = state.generation_id
  const nodes = sqlite
    .prepare(
      `SELECT node_id, stable_id, relative_path, normalized_path, title, note_type,
              content_hash, byte_length, aliases_json, tags_json, diagnostics_json
       FROM project_vault_graph_nodes
       WHERE generation_id = ? AND project_id = ?
       ORDER BY normalized_path`,
    )
    .all(generationId, projectId)
    .map(nodeFromRow)
  const edges = sqlite
    .prepare(
      `SELECT source_node_id, ordinal, kind, target_raw, target_normalized, target_node_id,
              heading, block_id, status, line
       FROM project_vault_graph_edges
       WHERE generation_id = ?
       ORDER BY source_node_id, ordinal`,
    )
    .all(generationId)
    .map(edgeFromRow)
  return {
    generationId,
    nodes,
    edges,
    backlinks: (nodeId: string) =>
      edges.filter((edge) => edge.status === "resolved" && edge.targetNodeId === nodeId),
    search: (query: string) => {
      const needle = query.trim().normalize("NFKC").toLocaleLowerCase("en-US")
      if (!needle) return nodes
      return nodes.filter((node) =>
        [node.title, node.relativePath, ...node.aliases, ...node.tags].some((value) =>
          value.normalize("NFKC").toLocaleLowerCase("en-US").includes(needle),
        ),
      )
    },
  }
}

async function scanNotes(root: string, seedIds: Map<string, string>): Promise<ScannedNode[]> {
  const paths: string[] = []
  await collectMarkdown(root, root, paths)
  paths.sort((left, right) => left.localeCompare(right, "en-US"))
  if (paths.length > MAX_NOTES) throw new Error(`Project vault exceeds ${MAX_NOTES} notes.`)
  const nodes: ScannedNode[] = []
  let totalBytes = 0
  const stableIds = new Set<string>()
  for (const relativePath of paths) {
    const bytes = await readFileInsideRoot(root, relativePath, {
      maxBytes: MAX_TOTAL_BYTES - totalBytes,
    })
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Project vault graph scan exceeds the 64 MiB total size limit.")
    }
    const source = bytes.toString("utf8")
    if (containsProjectVaultSecret(source)) continue
    const parsed = parseObsidianNote(source, relativePath)
    const stableId =
      parsed.identity?.id ??
      seedIds.get(relativePath.normalize("NFKC").toLocaleLowerCase("en-US")) ??
      null
    if (stableId && stableIds.has(stableId)) {
      throw new Error(`Duplicate stable project note identity: ${stableId}`)
    }
    if (stableId) stableIds.add(stableId)
    const normalizedPath = relativePath.normalize("NFKC").toLocaleLowerCase("en-US")
    nodes.push({
      nodeId: stableId ?? `path-${sha256(normalizedPath).slice(0, 24)}`,
      stableId,
      relativePath,
      normalizedPath,
      title:
        parsed.headings.find((heading) => heading.depth === 1)?.text ??
        basename(relativePath, extname(relativePath)),
      noteType: parsed.identity?.type ?? null,
      contentHash: sha256(source),
      byteLength: Buffer.byteLength(source, "utf8"),
      parsed,
    })
  }
  return nodes
}

async function collectMarkdown(root: string, directory: string, paths: string[]): Promise<void> {
  const handle = await opendir(directory)
  for await (const entry of handle) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    const absolutePath = join(directory, entry.name)
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink()) {
      throw new Error("Project vault graph scan refuses symbolic links.")
    }
    if (info.isDirectory()) {
      await collectMarkdown(root, absolutePath, paths)
    } else if (info.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".md")) {
      paths.push(relative(root, absolutePath).split(sep).join("/"))
    }
  }
}

function resolveEdges(nodes: ScannedNode[]): ProjectVaultGraphEdge[] {
  const exactPaths = multiMap(nodes, (node) => node.normalizedPath)
  const shortNames = new Map<string, Set<ScannedNode>>()
  for (const node of nodes) {
    for (const candidate of [
      basename(node.normalizedPath, extname(node.normalizedPath)),
      node.title.normalize("NFKC").toLocaleLowerCase("en-US"),
      ...node.parsed.aliases.map((alias) => alias.normalize("NFKC").toLocaleLowerCase("en-US")),
    ]) {
      const matches = shortNames.get(candidate) ?? new Set()
      matches.add(node)
      shortNames.set(candidate, matches)
    }
  }

  return nodes.flatMap((source) =>
    source.parsed.links.map((link, ordinal) => {
      const candidates = candidatesForLink(link, exactPaths, shortNames)
      const target = candidates.length === 1 ? candidates[0]! : null
      const fragmentExists = target ? targetContainsFragment(target, link) : false
      const resolvedTarget = target && fragmentExists ? target : null
      return {
        sourceNodeId: source.nodeId,
        ordinal,
        kind: link.kind,
        targetRaw: link.target,
        targetNormalized: link.normalizedTarget,
        targetNodeId: resolvedTarget?.nodeId ?? null,
        heading: link.heading,
        blockId: link.blockId,
        status:
          candidates.length === 1 && fragmentExists
            ? ("resolved" as const)
            : candidates.length > 1
              ? ("ambiguous" as const)
              : ("unresolved" as const),
        line: link.line,
      }
    }),
  )
}

function candidatesForLink(
  link: ObsidianNoteLink,
  exactPaths: Map<string, ScannedNode[]>,
  shortNames: Map<string, Set<ScannedNode>>,
): ScannedNode[] {
  const exactPath = link.normalizedTarget.endsWith(".md")
    ? link.normalizedTarget
    : `${link.normalizedTarget}.md`
  const exact = exactPaths.get(exactPath)
  if (exact) return exact
  if (link.kind === "markdown" || link.target.includes("/") || /\.[a-z0-9]+$/i.test(link.target)) {
    return []
  }
  const key = link.normalizedTarget.replace(/\.md$/i, "")
  return [...(shortNames.get(key) ?? [])]
}

function targetContainsFragment(target: ScannedNode, link: ObsidianNoteLink): boolean {
  if (link.heading) {
    const heading = normalizeHeading(link.heading)
    if (
      !target.parsed.headings.some(
        (candidate) =>
          normalizeHeading(candidate.text) === heading || candidate.slug === obsidianSlug(heading),
      )
    ) {
      return false
    }
  }
  if (
    link.blockId &&
    !target.parsed.blocks.some(
      (candidate) => candidate.id.normalize("NFKC") === link.blockId!.normalize("NFKC"),
    )
  ) {
    return false
  }
  return true
}

function normalizeHeading(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

function obsidianSlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
}

function multiMap<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) {
    const itemKey = key(value)
    result.set(itemKey, [...(result.get(itemKey) ?? []), value])
  }
  return result
}

function fingerprint(nodes: ScannedNode[]): string {
  return sha256(nodes.map((node) => `${node.normalizedPath}\0${node.contentHash}`).join("\n"))
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function nodeFromRow(rowValue: unknown): ProjectVaultGraphNode {
  const row = rowValue as Record<string, unknown>
  return {
    nodeId: String(row.node_id),
    stableId: row.stable_id === null ? null : String(row.stable_id),
    relativePath: String(row.relative_path),
    normalizedPath: String(row.normalized_path),
    title: String(row.title),
    noteType: row.note_type === null ? null : String(row.note_type),
    contentHash: String(row.content_hash),
    byteLength: Number(row.byte_length),
    aliases: parseStringArray(row.aliases_json),
    tags: parseStringArray(row.tags_json),
    diagnostics: JSON.parse(String(row.diagnostics_json)) as ParsedObsidianNote["diagnostics"],
  }
}

function edgeFromRow(rowValue: unknown): ProjectVaultGraphEdge {
  const row = rowValue as Record<string, unknown>
  return {
    sourceNodeId: String(row.source_node_id),
    ordinal: Number(row.ordinal),
    kind: String(row.kind) as ProjectVaultGraphEdge["kind"],
    targetRaw: String(row.target_raw),
    targetNormalized: String(row.target_normalized),
    targetNodeId: row.target_node_id === null ? null : String(row.target_node_id),
    heading: row.heading === null ? null : String(row.heading),
    blockId: row.block_id === null ? null : String(row.block_id),
    status: String(row.status) as ProjectVaultGraphEdge["status"],
    line: Number(row.line),
  }
}

function parseStringArray(value: unknown): string[] {
  const parsed = JSON.parse(String(value)) as unknown
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []
}

function rawClient(database: Database.Database | object): Database.Database {
  return "prepare" in database
    ? (database as Database.Database)
    : (database as { $client: Database.Database }).$client
}
