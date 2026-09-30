import type { ProjectRecord, ProjectRecordSnapshot } from "../../../shared/project-records"

export type ProjectRecordEntry = { record: ProjectRecord; snapshot: ProjectRecordSnapshot }
export type RecordProject = { id: string; name: string; entries: ProjectRecordEntry[] }

export function projectAffectedWorkLabels(record: {
  affectedWork?: unknown
  affectedWorkRefs?: ProjectRecord["affectedWorkRefs"]
}): string[] {
  return [
    ...new Set([
      ...(Array.isArray(record.affectedWork)
        ? record.affectedWork.filter((id): id is string => typeof id === "string")
        : []),
      ...(record.affectedWorkRefs ?? []).map((ref) => `${ref.path}#${ref.recordId}`),
    ]),
  ]
}

export function projectBlockerEntries(entries: ProjectRecordEntry[]): ProjectRecordEntry[] {
  const key = (path: string, id: string) => JSON.stringify([path, id])
  const covered = new Set<string>()
  const work = entries.filter(({ record }) => record.kind === "task" || record.kind === "feature")
  for (const { record } of entries) {
    if (record.kind !== "blocker" || record.state !== "blocked") continue
    for (const ref of record.affectedWorkRefs ?? []) {
      if (
        work.some((entry) => entry.snapshot.path === ref.path && entry.record.id === ref.recordId)
      ) {
        covered.add(key(ref.path, ref.recordId))
      }
    }
    // Entries share one project. An ambiguous legacy ID must not hide either row.
    for (const id of Array.isArray(record.affectedWork) ? record.affectedWork : []) {
      const targets = work.filter((entry) => entry.record.id === id)
      if (targets.length === 1) covered.add(key(targets[0]!.snapshot.path, targets[0]!.record.id))
    }
  }
  return entries.filter(
    ({ record, snapshot }) =>
      record.kind === "blocker" ||
      (record.state === "blocked" && !covered.has(key(snapshot.path, record.id))),
  )
}

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
