import type { getDatabase } from "../db"
import type { ProjectVaultSectionId } from "./registry"
import { redactProjectVaultSecrets } from "./content-safety"
import { listProjectVaultSections, readProjectVaultSection } from "./storage"

type Database = ReturnType<typeof getDatabase>

export type ProjectVaultSearchResult = {
  projectId: string
  sectionId: ProjectVaultSectionId
  sectionType: string
  title: string
  relativePath: string
  version: number
  snippet: string
  externallyModified: boolean
}

const SNIPPET_CONTEXT = 72
const MAX_SNIPPET_LENGTH = 220

export async function searchProjectVault(
  database: Database,
  input: { projectId: string; query: string },
): Promise<ProjectVaultSearchResult[]> {
  const query = input.query.trim()
  if (!query) return []
  const normalizedQuery = query.toLocaleLowerCase()
  const results: ProjectVaultSearchResult[] = []

  for (const metadata of listProjectVaultSections(database, input.projectId)) {
    const section = await readProjectVaultSection(database, {
      projectId: input.projectId,
      sectionId: metadata.sectionId as ProjectVaultSectionId,
    })
    const safeContent = redactProjectVaultSecrets(section.content)
    const index = safeContent.toLocaleLowerCase().indexOf(normalizedQuery)
    if (index < 0) continue
    results.push({
      projectId: input.projectId,
      sectionId: metadata.sectionId as ProjectVaultSectionId,
      sectionType: metadata.sectionType,
      title: metadata.title,
      relativePath: metadata.relativePath,
      version: metadata.version,
      snippet: makeSnippet(safeContent, index, query.length),
      externallyModified: section.externallyModified,
    })
  }

  return results
}

function makeSnippet(content: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT)
  const end = Math.min(content.length, matchIndex + queryLength + SNIPPET_CONTEXT)
  const body = content.slice(start, end).replace(/\s+/g, " ").trim()
  return `${start > 0 ? "…" : ""}${body.slice(0, MAX_SNIPPET_LENGTH)}${end < content.length ? "…" : ""}`
}
