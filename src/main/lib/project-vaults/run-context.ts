import { and, eq } from "drizzle-orm"
import type { getDatabase } from "../db"
import { agentRuns, chats, projects, tasks } from "../db/schema"
import {
  getProjectVaultSectionDefinition,
  projectVaultSectionIds,
  type ProjectVaultSectionId,
} from "./registry"
import { readProjectVaultSection } from "./storage"
import { containsProjectVaultSecret } from "./content-safety"
import {
  buildProjectVaultGraphContext,
  ProjectVaultGraphContextRejectedError,
  type ProjectVaultGraphContextManifest,
  type ProjectVaultGraphExpansionDirection,
} from "./graph-context"

type Database = ReturnType<typeof getDatabase>

export const PROJECT_VAULT_CONTEXT_POLICY = {
  defaultSelection: "opt-in-none",
  precedence: ["run", "task", "project", "fixed-default"],
  maxBytes: 24_000,
  maxEstimatedTokens: 6_000,
  tokenEstimate: "ceil-utf16-chars-divided-by-4",
} as const

export type ProjectVaultContextHarness = "codex" | "claude-code"
export type ProjectVaultContextSelectionSource = "run" | "task" | "project" | "fixed-default"

export type ProjectVaultGraphContextSelection = {
  nodeIds: string[]
  expectedGenerationId: string
  expansion?: {
    depth: number
    direction: ProjectVaultGraphExpansionDirection
    maxNodes: number
  }
}

export type ProjectVaultContextManifest = {
  schemaVersion: 1 | 2
  status: "included" | "empty" | "rejected"
  harness: ProjectVaultContextHarness
  projectId: string | null
  taskId: string | null
  runId: string | null
  selectionSource: ProjectVaultContextSelectionSource
  selectedSectionIds: ProjectVaultSectionId[]
  budget: {
    maxBytes: number
    maxEstimatedTokens: number
    includedBytes: number
    estimatedTokens: number
  }
  entries: ProjectVaultContextManifestEntry[]
  truncations: Array<{
    sectionId: ProjectVaultSectionId
    originalBytes: number
    includedBytes: number
    reason: "byte-budget" | "token-budget" | "byte-and-token-budget"
  }>
  graphContext?: ProjectVaultGraphContextManifest
  rejection?: {
    sectionId?: ProjectVaultSectionId
    nodeId?: string
    reason:
      "secret-detected" | "content-changed" | "stale-generation" | "node-not-found" | "unsafe-path"
  }
}

export type ProjectVaultContextManifestEntry = {
  sectionId: ProjectVaultSectionId
  title: string
  sourcePath: string
  version: number
  contentHash: string
  originalBytes: number
  includedBytes: number
  estimatedTokens: number
  truncated: boolean
}

export type ProjectVaultRunContext = {
  context: string
  manifest: ProjectVaultContextManifest
}

export function emptyProjectVaultRunContext(input: {
  harness: ProjectVaultContextHarness
  runId?: string | null
}): ProjectVaultRunContext {
  return {
    context: "",
    manifest: {
      schemaVersion: 1,
      status: "empty",
      harness: input.harness,
      projectId: null,
      taskId: null,
      runId: input.runId ?? null,
      selectionSource: "fixed-default",
      selectedSectionIds: [],
      budget: {
        maxBytes: PROJECT_VAULT_CONTEXT_POLICY.maxBytes,
        maxEstimatedTokens: PROJECT_VAULT_CONTEXT_POLICY.maxEstimatedTokens,
        includedBytes: 0,
        estimatedTokens: 0,
      },
      entries: [],
      truncations: [],
    },
  }
}

export class ProjectVaultContextRejectedError extends Error {
  constructor(
    message: string,
    public readonly manifest: ProjectVaultContextManifest,
  ) {
    super(message)
    this.name = "ProjectVaultContextRejectedError"
  }
}

export async function buildProjectVaultRunContext(
  database: Database,
  input: {
    chatId: string
    runId?: string | null
    harness: ProjectVaultContextHarness
    runSectionIds?: readonly ProjectVaultSectionId[]
    runGraphSelection?: ProjectVaultGraphContextSelection
    budget?: { maxBytes: number; maxEstimatedTokens: number }
  },
): Promise<ProjectVaultRunContext> {
  const scope = resolveContextScope(database, input)
  const budget = normalizeBudget(input.budget)
  const baseManifest: ProjectVaultContextManifest = {
    schemaVersion: scope.graphSelection ? 2 : 1,
    status: scope.sectionIds.length > 0 || scope.graphSelection ? "included" : "empty",
    harness: input.harness,
    projectId: scope.projectId,
    taskId: scope.taskId,
    runId: input.runId ?? null,
    selectionSource: scope.source,
    selectedSectionIds: scope.sectionIds,
    budget: {
      ...budget,
      includedBytes: 0,
      estimatedTokens: 0,
    },
    entries: [],
    truncations: [],
  }
  if (scope.sectionIds.length === 0 && !scope.graphSelection) {
    return { context: "", manifest: baseManifest }
  }
  if (!scope.projectId) throw new Error("Vault context requires a project-scoped chat.")

  const loaded = [] as Array<{
    sectionId: ProjectVaultSectionId
    title: string
    sourcePath: string
    version: number
    contentHash: string
    content: string
    originalBytes: number
  }>
  for (const sectionId of scope.sectionIds) {
    const section = await readProjectVaultSection(database, {
      projectId: scope.projectId,
      sectionId,
    })
    if (section.externallyModified) {
      const manifest = rejectedManifest(baseManifest, sectionId, "content-changed")
      throw new ProjectVaultContextRejectedError(
        `Project vault context rejected: section ${sectionId} changed outside Flapstack.`,
        manifest,
      )
    }
    if (containsProjectVaultSecret(section.content)) {
      const manifest = rejectedManifest(baseManifest, sectionId, "secret-detected")
      throw new ProjectVaultContextRejectedError(
        `Project vault context rejected: detected secret-like content in section ${sectionId}.`,
        manifest,
      )
    }
    loaded.push({
      sectionId,
      title: section.title,
      sourcePath: section.relativePath,
      version: section.version,
      contentHash: section.contentHash,
      content: section.content,
      originalBytes: Buffer.byteLength(section.content, "utf8"),
    })
  }

  let remainingBytes = budget.maxBytes
  let remainingTokens = budget.maxEstimatedTokens
  const blocks: string[] = []
  for (const section of loaded) {
    const included = truncateToBudget(section.content, remainingBytes, remainingTokens)
    const includedBytes = Buffer.byteLength(included, "utf8")
    const estimatedTokens = estimateTokens(included)
    const truncated = included.length < section.content.length
    const entry: ProjectVaultContextManifestEntry = {
      sectionId: section.sectionId,
      title: section.title,
      sourcePath: section.sourcePath,
      version: section.version,
      contentHash: section.contentHash,
      originalBytes: section.originalBytes,
      includedBytes,
      estimatedTokens,
      truncated,
    }
    baseManifest.entries.push(entry)
    baseManifest.budget.includedBytes += includedBytes
    baseManifest.budget.estimatedTokens += estimatedTokens
    remainingBytes -= includedBytes
    remainingTokens -= estimatedTokens
    if (truncated) {
      baseManifest.truncations.push({
        sectionId: section.sectionId,
        originalBytes: section.originalBytes,
        includedBytes,
        reason: truncationReason(section.content, included, remainingBytes, remainingTokens),
      })
    }
    blocks.push(formatSectionBlock(section, included, truncated))
  }

  const contexts: string[] = []
  if (blocks.length > 0) {
    contexts.push(
      `--- FLAPSTACK SELECTED PROJECT VAULT CONTEXT (DO NOT QUOTE) ---\n${blocks.join(
        "\n\n",
      )}\n--- END FLAPSTACK SELECTED PROJECT VAULT CONTEXT ---`,
    )
  }
  if (scope.graphSelection) {
    try {
      const graph = await buildProjectVaultGraphContext(database, {
        projectId: scope.projectId,
        ...scope.graphSelection,
        budget: {
          maxBytes: remainingBytes,
          maxEstimatedTokens: remainingTokens,
        },
      })
      baseManifest.schemaVersion = 2
      baseManifest.graphContext = graph.manifest
      baseManifest.budget.includedBytes += graph.manifest.budget.includedBytes
      baseManifest.budget.estimatedTokens += graph.manifest.budget.estimatedTokens
      if (graph.context) contexts.push(graph.context)
    } catch (error) {
      if (error instanceof ProjectVaultGraphContextRejectedError) {
        baseManifest.schemaVersion = 2
        baseManifest.status = "rejected"
        baseManifest.graphContext = error.manifest
        baseManifest.rejection = {
          ...(error.manifest.rejection?.nodeId ? { nodeId: error.manifest.rejection.nodeId } : {}),
          reason: error.manifest.rejection?.reason ?? "content-changed",
        }
        throw new ProjectVaultContextRejectedError(error.message, baseManifest)
      }
      throw error
    }
  }

  return {
    context: contexts.join("\n\n"),
    manifest: baseManifest,
  }
}

export function persistProjectVaultContextManifest(
  database: Database,
  input: {
    runId: string
    manifest: ProjectVaultContextManifest
    runSectionIds?: readonly ProjectVaultSectionId[]
    runGraphSelection?: ProjectVaultGraphContextSelection
  },
): void {
  const update: { vaultContextManifest: string; vaultContextSections?: string } = {
    vaultContextManifest: JSON.stringify(input.manifest),
  }
  if (input.runSectionIds !== undefined || input.runGraphSelection !== undefined) {
    update.vaultContextSections = serializeProjectVaultRunSelection({
      sectionIds: input.runSectionIds ?? [],
      ...(input.runGraphSelection ? { graph: input.runGraphSelection } : {}),
    })
  }
  database.update(agentRuns).set(update).where(eq(agentRuns.id, input.runId)).run()
}

export function getProjectVaultContextSelection(
  database: Database,
  input: { projectId: string; taskId?: string },
): {
  projectSectionIds: ProjectVaultSectionId[] | null
  taskSectionIds: ProjectVaultSectionId[] | null
  effectiveSectionIds: ProjectVaultSectionId[]
  source: Exclude<ProjectVaultContextSelectionSource, "run">
} {
  const project = database
    .select({ sectionIds: projects.vaultContextSections })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get()
  if (!project) throw new Error("Project not found.")
  const projectSectionIds = parseStoredSelection(project.sectionIds)
  let taskSectionIds: ProjectVaultSectionId[] | null = null
  if (input.taskId) {
    const task = database
      .select({ sectionIds: tasks.vaultContextSections })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId)))
      .get()
    if (!task) throw new Error("Task not found in project.")
    taskSectionIds = parseStoredSelection(task.sectionIds)
  }
  return {
    projectSectionIds,
    taskSectionIds,
    effectiveSectionIds: taskSectionIds ?? projectSectionIds ?? [],
    source: taskSectionIds ? "task" : projectSectionIds ? "project" : "fixed-default",
  }
}

export function updateProjectVaultContextSelection(
  database: Database,
  input: {
    projectId: string
    taskId?: string
    sectionIds: readonly ProjectVaultSectionId[] | null
  },
): ReturnType<typeof getProjectVaultContextSelection> {
  const sectionIds =
    input.sectionIds === null ? null : JSON.stringify(uniqueSectionIds(input.sectionIds))
  if (input.taskId) {
    const updated = database
      .update(tasks)
      .set({ vaultContextSections: sectionIds, updatedAt: new Date() })
      .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId)))
      .returning({ id: tasks.id })
      .get()
    if (!updated) throw new Error("Task not found in project.")
  } else {
    if (input.sectionIds === null) throw new Error("Project context selection must be explicit.")
    const updated = database
      .update(projects)
      .set({ vaultContextSections: sectionIds, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId))
      .returning({ id: projects.id })
      .get()
    if (!updated) throw new Error("Project not found.")
  }
  return getProjectVaultContextSelection(database, input)
}

export function serializeProjectVaultRunSelection(input: {
  sectionIds: readonly ProjectVaultSectionId[]
  graph?: ProjectVaultGraphContextSelection
}): string {
  const sectionIds = uniqueSectionIds(input.sectionIds)
  if (!input.graph) return JSON.stringify(sectionIds)
  return JSON.stringify({
    schemaVersion: 2,
    sectionIds,
    graph: normalizeGraphSelection(input.graph),
  })
}

function resolveContextScope(
  database: Database,
  input: {
    chatId: string
    runId?: string | null
    runSectionIds?: readonly ProjectVaultSectionId[]
    runGraphSelection?: ProjectVaultGraphContextSelection
  },
): {
  projectId: string | null
  taskId: string | null
  sectionIds: ProjectVaultSectionId[]
  graphSelection: ProjectVaultGraphContextSelection | null
  source: ProjectVaultContextSelectionSource
} {
  const chat = database
    .select({ projectId: chats.projectId, taskId: chats.taskId })
    .from(chats)
    .where(eq(chats.id, input.chatId))
    .get()
  if (!chat) throw new Error("Chat not found.")
  const storedRun = input.runId
    ? database
        .select({ sectionIds: agentRuns.vaultContextSections })
        .from(agentRuns)
        .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.chatId, input.chatId)))
        .get()
    : null
  const storedRunSelection = storedRun ? parseStoredRunSelection(storedRun.sectionIds) : null
  const suppliedRunSelection =
    input.runSectionIds !== undefined || input.runGraphSelection !== undefined
      ? {
          sectionIds: uniqueSectionIds(input.runSectionIds ?? []),
          graphSelection: input.runGraphSelection
            ? normalizeGraphSelection(input.runGraphSelection)
            : null,
        }
      : null
  const runSelection = storedRunSelection ?? suppliedRunSelection
  if (runSelection !== null) {
    return {
      ...chat,
      sectionIds: runSelection.sectionIds,
      graphSelection: runSelection.graphSelection,
      source: "run",
    }
  }
  if (!chat.projectId) {
    return { ...chat, sectionIds: [], graphSelection: null, source: "fixed-default" }
  }
  const selection = getProjectVaultContextSelection(database, {
    projectId: chat.projectId,
    ...(chat.taskId ? { taskId: chat.taskId } : {}),
  })
  return {
    ...chat,
    sectionIds: selection.effectiveSectionIds,
    graphSelection: null,
    source: selection.source,
  }
}

function uniqueSectionIds(sectionIds: readonly ProjectVaultSectionId[]): ProjectVaultSectionId[] {
  const seen = new Set<ProjectVaultSectionId>()
  return sectionIds.map((sectionId) => {
    getProjectVaultSectionDefinition(sectionId)
    if (seen.has(sectionId))
      throw new Error(`Duplicate project vault context section: ${sectionId}`)
    seen.add(sectionId)
    return sectionId
  })
}

function parseStoredSelection(value: string | null): ProjectVaultSectionId[] | null {
  if (value === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("Stored project vault context selection is invalid.")
  }
  if (!Array.isArray(parsed)) throw new Error("Stored project vault context selection is invalid.")
  return uniqueSectionIds(
    parsed.map((sectionId) => {
      if (!projectVaultSectionIds.includes(sectionId as ProjectVaultSectionId)) {
        throw new Error("Stored project vault context selection is invalid.")
      }
      return sectionId as ProjectVaultSectionId
    }),
  )
}

function parseStoredRunSelection(value: string | null): {
  sectionIds: ProjectVaultSectionId[]
  graphSelection: ProjectVaultGraphContextSelection | null
} | null {
  if (value === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("Stored project vault context selection is invalid.")
  }
  if (Array.isArray(parsed)) {
    return {
      sectionIds: parseStoredSelection(value) ?? [],
      graphSelection: null,
    }
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 2
  ) {
    throw new Error("Stored project vault context selection is invalid.")
  }
  const object = parsed as { sectionIds?: unknown; graph?: unknown }
  if (!Array.isArray(object.sectionIds)) {
    throw new Error("Stored project vault context selection is invalid.")
  }
  const sectionIds = uniqueSectionIds(
    object.sectionIds.map((sectionId) => {
      if (!projectVaultSectionIds.includes(sectionId as ProjectVaultSectionId)) {
        throw new Error("Stored project vault context selection is invalid.")
      }
      return sectionId as ProjectVaultSectionId
    }),
  )
  if (!object.graph || typeof object.graph !== "object") {
    throw new Error("Stored project vault context selection is invalid.")
  }
  return {
    sectionIds,
    graphSelection: normalizeGraphSelection(object.graph as ProjectVaultGraphContextSelection),
  }
}

function normalizeGraphSelection(
  input: ProjectVaultGraphContextSelection,
): ProjectVaultGraphContextSelection {
  if (
    !Array.isArray(input.nodeIds) ||
    input.nodeIds.some((nodeId) => typeof nodeId !== "string") ||
    typeof input.expectedGenerationId !== "string" ||
    input.expectedGenerationId.trim().length === 0
  ) {
    throw new Error("Project vault graph context selection is invalid.")
  }
  const nodeIds = input.nodeIds.map((nodeId) => nodeId.trim())
  if (
    nodeIds.some((nodeId) => !nodeId || nodeId.length > 200) ||
    new Set(nodeIds).size !== nodeIds.length
  ) {
    throw new Error("Project vault graph context selection is invalid.")
  }
  if (input.expansion) {
    const { depth, direction, maxNodes } = input.expansion
    if (
      !Number.isInteger(depth) ||
      depth < 0 ||
      depth > 2 ||
      !["outgoing", "incoming", "both"].includes(direction) ||
      !Number.isInteger(maxNodes) ||
      maxNodes < nodeIds.length ||
      maxNodes > 24
    ) {
      throw new Error("Project vault graph context selection is invalid.")
    }
  }
  return {
    nodeIds,
    expectedGenerationId: input.expectedGenerationId.trim(),
    ...(input.expansion ? { expansion: { ...input.expansion } } : {}),
  }
}

function normalizeBudget(input?: { maxBytes: number; maxEstimatedTokens: number }) {
  const budget = input ?? {
    maxBytes: PROJECT_VAULT_CONTEXT_POLICY.maxBytes,
    maxEstimatedTokens: PROJECT_VAULT_CONTEXT_POLICY.maxEstimatedTokens,
  }
  if (!Number.isInteger(budget.maxBytes) || budget.maxBytes < 0) {
    throw new Error("Project vault context byte budget must be a non-negative integer.")
  }
  if (!Number.isInteger(budget.maxEstimatedTokens) || budget.maxEstimatedTokens < 0) {
    throw new Error("Project vault context token budget must be a non-negative integer.")
  }
  return budget
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
    if (Buffer.byteLength(prefix, "utf8") <= maxBytes && estimateTokens(prefix) <= maxTokens)
      low = next
    else high = next - 1
  }
  return safePrefix(content, low)
}

function safePrefix(content: string, length: number): string {
  const prefix = content.slice(0, length)
  const last = prefix.charCodeAt(prefix.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix
}

function truncationReason(
  original: string,
  included: string,
  remainingBytes: number,
  remainingTokens: number,
): "byte-budget" | "token-budget" | "byte-and-token-budget" {
  const byteBlocked =
    Buffer.byteLength(original, "utf8") > Buffer.byteLength(included, "utf8") + remainingBytes
  const tokenBlocked = estimateTokens(original) > estimateTokens(included) + remainingTokens
  if (byteBlocked && tokenBlocked) return "byte-and-token-budget"
  return byteBlocked ? "byte-budget" : "token-budget"
}

function formatSectionBlock(
  section: {
    sectionId: ProjectVaultSectionId
    title: string
    sourcePath: string
    contentHash: string
  },
  content: string,
  truncated: boolean,
): string {
  return `--- BEGIN SELECTED VAULT SECTION ${section.sectionId}: ${section.title} ---\nSource: ${section.sourcePath}\nSHA-256: ${section.contentHash}\n\n${content}${truncated ? "\n\n[...truncated by Flapstack vault context budget...]" : ""}\n--- END SELECTED VAULT SECTION ${section.sectionId} ---`
}

function rejectedManifest(
  manifest: ProjectVaultContextManifest,
  sectionId: ProjectVaultSectionId,
  reason: "secret-detected" | "content-changed",
): ProjectVaultContextManifest {
  return { ...manifest, status: "rejected", rejection: { sectionId, reason } }
}
