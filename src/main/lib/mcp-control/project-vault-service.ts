import type Database from "better-sqlite3"
import { openAppDatabase } from "../db/access"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { z } from "zod"
import * as databaseSchema from "../db/schema"
import { containsProjectVaultSecret } from "../project-vaults/content-safety"
import {
  getProjectVaultSectionDefinition,
  projectVaultSectionIds,
  type ProjectVaultSectionId,
} from "../project-vaults/registry"
import {
  createProjectVaultSection,
  listProjectVaultSections,
  ProjectVaultConflictError,
  readProjectVaultSection,
  writeProjectVaultSection,
} from "../project-vaults/storage"
import {
  ProjectVaultCustomNotes,
  ProjectVaultNoteConflictError,
} from "../project-vaults/custom-notes"
import { currentProjectVaultGraph, ProjectVaultGraphIndex } from "../project-vaults/graph-index"
import {
  buildProjectVaultGraphContext,
  type ProjectVaultGraphExpansionDirection,
} from "../project-vaults/graph-context"
import type { McpCallerIdentity, McpControlErrorCode, McpControlResponse } from "./types"

const id = z.string().trim().min(1).max(128)
const sectionId = z.enum(projectVaultSectionIds)
const content = z.string().max(200_000)
const nodeContent = z.string().max(1_048_576)
const generationId = z.string().uuid()
const nodeId = z.string().trim().min(1).max(200)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const relativePath = z.string().trim().min(1).max(1_000)
const exactTitle = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\r\n]/.test(value), "Decision title must be one line.")

const schemas = {
  list_vault_sections: z.object({ projectId: id }).strict(),
  read_vault_section: z.object({ projectId: id, sectionId }).strict(),
  create_vault_section: z
    .object({
      projectId: id,
      sectionId,
      expectedVersion: z.literal(0),
      content,
    })
    .strict(),
  update_vault_section: z
    .object({
      projectId: id,
      sectionId,
      expectedVersion: z.number().int().positive(),
      content,
    })
    .strict(),
  update_vault_handoff: z
    .object({
      projectId: id,
      sectionId: z.literal("handoff"),
      expectedVersion: z.number().int().positive(),
      content: z.string().max(100_000),
    })
    .strict(),
  record_vault_decision: z
    .object({
      projectId: id,
      sectionId: z.literal("decisions"),
      expectedVersion: z.number().int().positive(),
      title: exactTitle,
      decision: z.string().trim().min(1).max(20_000),
      rationale: z.string().trim().min(1).max(20_000).optional(),
    })
    .strict(),
  list_vault_nodes: z.object({ projectId: id, expectedGenerationId: generationId }).strict(),
  read_vault_node: z.object({ projectId: id, nodeId, expectedGenerationId: generationId }).strict(),
  create_vault_node: z
    .object({
      projectId: id,
      relativePath,
      title: z.string().trim().min(1).max(200),
      body: z.string().max(1_048_576).optional(),
    })
    .strict(),
  update_vault_node: z
    .object({
      projectId: id,
      nodeId,
      expectedGenerationId: generationId,
      expectedVersion: z.number().int().positive(),
      expectedHash: hash,
      content: nodeContent,
    })
    .strict(),
  move_vault_node: z
    .object({
      projectId: id,
      nodeId,
      expectedGenerationId: generationId,
      destinationPath: relativePath,
      expectedVersion: z.number().int().positive(),
      expectedHash: hash,
    })
    .strict(),
  link_vault_nodes: z
    .object({
      projectId: id,
      sourceNodeId: nodeId,
      targetNodeId: nodeId,
      expectedGenerationId: generationId,
      expectedVersion: z.number().int().positive(),
      expectedHash: hash,
    })
    .strict(),
  preview_vault_context: z
    .object({
      projectId: id,
      nodeIds: z.array(nodeId).max(24),
      expectedGenerationId: generationId,
      expansion: z
        .object({
          depth: z.number().int().min(0).max(2),
          direction: z.enum(["outgoing", "incoming", "both"]),
          maxNodes: z.number().int().min(1).max(24),
        })
        .strict()
        .optional(),
      budget: z
        .object({
          maxBytes: z.number().int().min(0).max(24_000),
          maxEstimatedTokens: z.number().int().min(0).max(6_000),
        })
        .strict()
        .optional(),
    })
    .strict(),
} as const

export const mcpProjectVaultInputShapes: Record<string, z.ZodRawShape> = Object.fromEntries(
  Object.entries(schemas).map(([key, value]) => [key, value.shape]),
)

export const mcpProjectVaultToolNames = new Set(Object.keys(schemas))

export type McpProjectVaultService = {
  invoke(operation: string, caller: McpCallerIdentity, input: unknown): Promise<McpControlResponse>
}

type CallerScope = { kind: string; projectId: string | null }
type Row = Record<string, unknown>

export function createMcpProjectVaultService(
  databasePath = process.env.FLAPSTACK_DB_PATH,
): McpProjectVaultService {
  if (!databasePath) throw new Error("FLAPSTACK_DB_PATH is required for MCP vault operations.")
  return {
    async invoke(operation, caller, rawInput) {
      const schema = schemas[operation as keyof typeof schemas]
      if (!schema) return fail("invalid-input", "Unsupported project vault operation.")
      const parsed = schema.safeParse(rawInput)
      if (!parsed.success) {
        return fail("invalid-input", parsed.error.issues[0]?.message ?? "Invalid input.")
      }

      const sqlite = openAppDatabase(databasePath)
      try {
        sqlite.pragma("foreign_keys = ON")
        sqlite.pragma("busy_timeout = 5000")
        const input = parsed.data as { projectId: string }
        assertProjectInCallerScope(sqlite, caller, input.projectId)
        const database = drizzle(sqlite, { schema: databaseSchema })

        switch (operation) {
          case "list_vault_sections": {
            assertVaultExists(sqlite, input.projectId)
            return {
              ok: true,
              data: {
                projectId: input.projectId,
                sections: listProjectVaultSections(database, input.projectId).map(sectionMetadata),
              },
            }
          }
          case "read_vault_section": {
            const request = parsed.data as z.infer<typeof schemas.read_vault_section>
            const section = await readProjectVaultSection(database, request)
            if (containsProjectVaultSecret(section.content)) {
              return fail(
                "secret-detected",
                "Project vault section contains detected secret material and cannot be read by an agent.",
              )
            }
            if (section.externallyModified) {
              return fail(
                "stale-target",
                "Project vault section changed outside Flapstack and must be reconciled first.",
              )
            }
            return {
              ok: true,
              data: { ...sectionMetadata(section), content: section.content },
            }
          }
          case "create_vault_section": {
            const request = parsed.data as z.infer<typeof schemas.create_vault_section>
            assertNoSecret(request.content)
            const section = await createProjectVaultSection(database, request)
            return { ok: true, data: { ...sectionMetadata(section), created: true } }
          }
          case "update_vault_section": {
            const request = parsed.data as z.infer<typeof schemas.update_vault_section>
            assertNoSecret(request.content)
            const section = await writeProjectVaultSection(database, request)
            return { ok: true, data: { ...sectionMetadata(section), changed: true } }
          }
          case "update_vault_handoff": {
            const request = parsed.data as z.infer<typeof schemas.update_vault_handoff>
            assertNoSecret(request.content)
            const section = await writeProjectVaultSection(database, request)
            return { ok: true, data: { ...sectionMetadata(section), changed: true } }
          }
          case "record_vault_decision": {
            const request = parsed.data as z.infer<typeof schemas.record_vault_decision>
            assertNoSecret(`${request.title}\n${request.decision}\n${request.rationale ?? ""}`)
            const current = await readExactSection(
              database,
              request.projectId,
              request.sectionId,
              request.expectedVersion,
            )
            const entry = [
              `## ${request.title}`,
              request.decision,
              request.rationale ? `Rationale: ${request.rationale}` : null,
            ]
              .filter((part): part is string => part !== null)
              .join("\n\n")
            const nextContent = `${current.content.trimEnd()}\n\n${entry}\n`
            assertNoSecret(nextContent)
            const section = await writeProjectVaultSection(database, {
              projectId: request.projectId,
              sectionId: request.sectionId,
              expectedVersion: request.expectedVersion,
              content: nextContent,
            })
            return { ok: true, data: { ...sectionMetadata(section), changed: true } }
          }
          case "list_vault_nodes": {
            const request = parsed.data as z.infer<typeof schemas.list_vault_nodes>
            const graph = exactGraph(sqlite, request.projectId, request.expectedGenerationId)
            return {
              ok: true,
              data: {
                projectId: request.projectId,
                generationId: graph.generationId,
                nodes: graph.nodes.map(nodeMetadata),
              },
            }
          }
          case "read_vault_node": {
            const request = parsed.data as z.infer<typeof schemas.read_vault_node>
            const node = exactCustomNode(
              sqlite,
              request.projectId,
              request.nodeId,
              request.expectedGenerationId,
            )
            const note = await new ProjectVaultCustomNotes(sqlite).read(
              request.projectId,
              node.relativePath,
            )
            if (containsProjectVaultSecret(note.content)) {
              return fail(
                "secret-detected",
                "Project vault node contains detected secret material.",
              )
            }
            if (note.externallyModified) {
              return fail("stale-target", "Project vault node changed outside Flapstack.")
            }
            return {
              ok: true,
              data: { ...nodeMetadata(node), ...note },
            }
          }
          case "create_vault_node": {
            const request = parsed.data as z.infer<typeof schemas.create_vault_node>
            assertNoSecret(`${request.title}\n${request.body ?? ""}`)
            const note = await new ProjectVaultCustomNotes(sqlite).create(request)
            const graph = await new ProjectVaultGraphIndex(sqlite).rebuild(request.projectId)
            return {
              ok: true,
              data: {
                generationId: graph.generationId,
                node: {
                  stableId: note.identity!.id,
                  relativePath: note.relativePath,
                  version: note.version,
                  contentHash: note.contentHash,
                },
              },
            }
          }
          case "update_vault_node": {
            const request = parsed.data as z.infer<typeof schemas.update_vault_node>
            assertNoSecret(request.content)
            const node = exactCustomNode(
              sqlite,
              request.projectId,
              request.nodeId,
              request.expectedGenerationId,
            )
            const note = await new ProjectVaultCustomNotes(sqlite).update({
              projectId: request.projectId,
              relativePath: node.relativePath,
              expectedVersion: request.expectedVersion,
              expectedHash: request.expectedHash,
              content: request.content,
            })
            const graph = await new ProjectVaultGraphIndex(sqlite).rebuild(request.projectId)
            return {
              ok: true,
              data: { generationId: graph.generationId, node: customNoteMetadata(note) },
            }
          }
          case "move_vault_node": {
            const request = parsed.data as z.infer<typeof schemas.move_vault_node>
            const node = exactCustomNode(
              sqlite,
              request.projectId,
              request.nodeId,
              request.expectedGenerationId,
            )
            const note = await new ProjectVaultCustomNotes(sqlite).move({
              projectId: request.projectId,
              relativePath: node.relativePath,
              destinationPath: request.destinationPath,
              expectedVersion: request.expectedVersion,
              expectedHash: request.expectedHash,
            })
            const graph = await new ProjectVaultGraphIndex(sqlite).rebuild(request.projectId)
            return {
              ok: true,
              data: { generationId: graph.generationId, node: customNoteMetadata(note) },
            }
          }
          case "link_vault_nodes": {
            const request = parsed.data as z.infer<typeof schemas.link_vault_nodes>
            const graph = exactGraph(sqlite, request.projectId, request.expectedGenerationId)
            const source = graph.nodes.find((node) => node.nodeId === request.sourceNodeId)
            const target = graph.nodes.find((node) => node.nodeId === request.targetNodeId)
            if (!source || !target) throw new Error("Project vault graph node is missing.")
            if (source.noteType !== "custom" || !source.stableId?.startsWith("custom:")) {
              throw new Error("Only custom project vault nodes can be linked by this operation.")
            }
            const current = await new ProjectVaultCustomNotes(sqlite).read(
              request.projectId,
              source.relativePath,
            )
            const targetValue = target.relativePath.replace(/\.md$/i, "")
            if (/[\]\r\n]/.test(targetValue)) {
              throw new Error("Target note path cannot be represented as a safe Wikilink.")
            }
            const note = await new ProjectVaultCustomNotes(sqlite).update({
              projectId: request.projectId,
              relativePath: source.relativePath,
              expectedVersion: request.expectedVersion,
              expectedHash: request.expectedHash,
              content: `${current.content.trimEnd()}\n\n[[${targetValue}]]\n`,
            })
            const rebuilt = await new ProjectVaultGraphIndex(sqlite).rebuild(request.projectId)
            return {
              ok: true,
              data: { generationId: rebuilt.generationId, node: customNoteMetadata(note) },
            }
          }
          case "preview_vault_context": {
            const request = parsed.data as z.infer<typeof schemas.preview_vault_context>
            const preview = await buildProjectVaultGraphContext(sqlite, {
              ...request,
              expansion: request.expansion
                ? {
                    ...request.expansion,
                    direction: request.expansion.direction as ProjectVaultGraphExpansionDirection,
                  }
                : undefined,
            })
            return { ok: true, data: { manifest: preview.manifest } }
          }
        }
        return fail("invalid-input", "Unsupported project vault operation.")
      } catch (error) {
        if (
          error instanceof ProjectVaultConflictError ||
          error instanceof ProjectVaultNoteConflictError
        ) {
          return fail("conflict", error.message)
        }
        const message = error instanceof Error ? error.message : "Project vault operation failed."
        if (message === "Caller chat is stale.") return fail("stale-caller", message)
        if (message === "Project is outside the caller scope.") return fail("out-of-scope", message)
        if (/detected secret/i.test(message)) return fail("secret-detected", message)
        if (/not scaffolded|not found|missing|archived/i.test(message)) {
          return fail("stale-target", message)
        }
        if (/registered|root|symbolic link|outside/i.test(message)) {
          return fail("forbidden-target", "Project vault storage identity is unsafe or stale.")
        }
        return fail("internal-error", "Project vault operation failed.")
      } finally {
        sqlite.close()
      }
    },
  }
}

function assertProjectInCallerScope(
  database: Database.Database,
  caller: McpCallerIdentity,
  projectId: string,
): void {
  const scope = callerScope(database, caller)
  if (scope.kind !== "global" && scope.projectId !== projectId) {
    throw new Error("Project is outside the caller scope.")
  }
  const project = database
    .prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL")
    .get(projectId)
  if (!project) throw new Error("Project is missing or archived.")
}

function callerScope(database: Database.Database, caller: McpCallerIdentity): CallerScope {
  const row = database
    .prepare(
      `SELECT c.scope, c.project_id, t.project_id AS task_project_id
       FROM chats c LEFT JOIN tasks t ON t.id = c.task_id
       WHERE c.id = ? AND c.archived_at IS NULL`,
    )
    .get(caller.chatId) as Row | undefined
  if (!row) throw new Error("Caller chat is stale.")
  const kind = String(row.scope)
  return {
    kind,
    projectId:
      kind === "task"
        ? typeof row.task_project_id === "string"
          ? row.task_project_id
          : null
        : typeof row.project_id === "string"
          ? row.project_id
          : null,
  }
}

function assertVaultExists(database: Database.Database, projectId: string): void {
  if (!database.prepare("SELECT 1 FROM project_vaults WHERE project_id = ?").get(projectId)) {
    throw new Error("Project vault is not scaffolded.")
  }
}

async function readExactSection(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  projectId: string,
  targetSectionId: ProjectVaultSectionId,
  expectedVersion: number,
) {
  const section = await readProjectVaultSection(database, {
    projectId,
    sectionId: targetSectionId,
  })
  if (containsProjectVaultSecret(section.content)) {
    throw new Error("Project vault content contains a detected secret.")
  }
  if (section.externallyModified || section.version !== expectedVersion) {
    throw new ProjectVaultConflictError(
      "Project vault section version is stale.",
      section.version,
      section.currentContentHash,
    )
  }
  return section
}

function assertNoSecret(value: string): void {
  if (containsProjectVaultSecret(value)) {
    throw new Error("Project vault content contains a detected secret.")
  }
}

function sectionMetadata(section: {
  projectId: string
  sectionId: string
  sectionType: string
  title: string
  version: number
  contentHash: string
  byteLength: number
}) {
  getProjectVaultSectionDefinition(section.sectionId as ProjectVaultSectionId)
  return {
    projectId: section.projectId,
    sectionId: section.sectionId,
    sectionType: section.sectionType,
    title: section.title,
    version: section.version,
    contentHash: section.contentHash,
    byteLength: section.byteLength,
  }
}

function exactGraph(sqlite: Database.Database, projectId: string, expectedGenerationId: string) {
  const graph = currentProjectVaultGraph(sqlite, projectId)
  if (graph.generationId !== expectedGenerationId) {
    throw new Error("Project vault graph generation is stale.")
  }
  return graph
}

function exactCustomNode(
  sqlite: Database.Database,
  projectId: string,
  targetNodeId: string,
  expectedGenerationId: string,
) {
  const graph = exactGraph(sqlite, projectId, expectedGenerationId)
  const node = graph.nodes.find((candidate) => candidate.nodeId === targetNodeId)
  if (!node) throw new Error("Project vault graph node is missing.")
  if (node.noteType !== "custom" || !node.stableId?.startsWith("custom:")) {
    throw new Error("Only custom project vault nodes are available through this operation.")
  }
  return node
}

function nodeMetadata(node: {
  nodeId: string
  stableId: string | null
  relativePath: string
  title: string
  noteType: string | null
  contentHash: string
  byteLength: number
  aliases: string[]
  tags: string[]
}) {
  return {
    nodeId: node.nodeId,
    stableId: node.stableId,
    relativePath: node.relativePath,
    title: node.title,
    noteType: node.noteType,
    contentHash: node.contentHash,
    byteLength: node.byteLength,
    aliases: node.aliases,
    tags: node.tags,
  }
}

function customNoteMetadata(note: {
  identity: { id: string; type: string | null } | null
  relativePath: string
  version: number
  contentHash: string
  title: string
}) {
  return {
    nodeId: note.identity!.id,
    stableId: note.identity!.id,
    noteType: note.identity!.type,
    relativePath: note.relativePath,
    version: note.version,
    contentHash: note.contentHash,
    title: note.title,
  }
}

function fail(code: McpControlErrorCode, message: string): McpControlResponse {
  return { ok: false, error: { code, message } }
}
