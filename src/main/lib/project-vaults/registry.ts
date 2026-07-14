export const projectVaultSectionIds = [
  "index",
  "handoff",
  "decisions",
  "context",
  "tasks",
  "logs",
] as const

export type ProjectVaultSectionId = (typeof projectVaultSectionIds)[number]

export type ProjectVaultSectionDefinition = {
  id: ProjectVaultSectionId
  title: string
  fileName: `${string}.md`
  defaultSelected: boolean
  initialContent: string
}

export const PROJECT_VAULT_SCHEMA_VERSION = 1

export const projectVaultSectionRegistry = [
  {
    id: "index",
    title: "Index",
    fileName: "index.md",
    defaultSelected: true,
    initialContent: "# Project Knowledge\n\n",
  },
  {
    id: "handoff",
    title: "Current Handoff",
    fileName: "current-handoff.md",
    defaultSelected: true,
    initialContent: "# Current Handoff\n\n",
  },
  {
    id: "decisions",
    title: "Decision Log",
    fileName: "decisions.md",
    defaultSelected: false,
    initialContent: "# Decision Log\n\n",
  },
  {
    id: "context",
    title: "Durable Context",
    fileName: "context.md",
    defaultSelected: false,
    initialContent: "# Durable Context\n\n",
  },
  {
    id: "tasks",
    title: "Task Notes",
    fileName: "task-notes.md",
    defaultSelected: false,
    initialContent: "# Task Notes\n\n",
  },
  {
    id: "logs",
    title: "Run Logs",
    fileName: "run-logs.md",
    defaultSelected: false,
    initialContent: "# Run Logs\n\n",
  },
] as const satisfies readonly ProjectVaultSectionDefinition[]

const registryById = new Map(projectVaultSectionRegistry.map((section) => [section.id, section]))

export function getProjectVaultSectionDefinition(
  sectionId: ProjectVaultSectionId,
): ProjectVaultSectionDefinition {
  const definition = registryById.get(sectionId)
  if (!definition) throw new Error(`Unsupported project vault section: ${sectionId}`)
  return definition
}
