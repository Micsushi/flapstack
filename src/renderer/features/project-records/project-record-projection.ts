import type { ProjectRecord, ProjectRecordSnapshot } from "../../../shared/project-records"

export type ProjectRecordEntry = { record: ProjectRecord; snapshot: ProjectRecordSnapshot }
export type RecordProject = { id: string; name: string; entries: ProjectRecordEntry[] }

export function projectRecordGroups(snapshots: ProjectRecordSnapshot[]): RecordProject[] {
  const groups = new Map<string, RecordProject>()
  for (const snapshot of snapshots) {
    for (const record of snapshot.document.records) {
      const assigned = new Map<string, string>()
      if (Array.isArray(record.projects)) {
        for (const project of record.projects) {
          if (
            project &&
            typeof project === "object" &&
            typeof project.id === "string" &&
            project.id.trim() &&
            typeof project.name === "string" &&
            project.name.trim()
          )
            assigned.set(project.id.trim(), project.name.trim())
        }
      }
      if (!assigned.size) {
        const slug = /^projects\/([^/]+)\//.exec(snapshot.path)?.[1]
        assigned.set(
          slug ?? "shared-work",
          slug
            ? slug.replace(
                /(^|-)([a-z])/g,
                (_, separator, letter: string) => `${separator ? " " : ""}${letter.toUpperCase()}`,
              )
            : "Shared work",
        )
      }
      for (const [id, name] of assigned) {
        const group = groups.get(id) ?? { id, name, entries: [] }
        group.entries.push({ record, snapshot })
        groups.set(id, group)
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}
