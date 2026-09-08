import type {
  ProjectRecordPatch,
  ProjectRecordSnapshot,
  ProjectRecordWriteResult,
} from "../../../shared/project-records"
import { recordAppAction } from "../../lib/app-action-history"

export function retainRecordAction(input: {
  before: ProjectRecordSnapshot
  patch: ProjectRecordPatch
  read: (path: string) => Promise<ProjectRecordSnapshot>
  write: (patch: ProjectRecordPatch) => Promise<ProjectRecordWriteResult>
  changed: () => void
}) {
  const original = input.before.document.records.find(
    (record) => record.id === input.patch.recordId,
  )
  if (!original) return
  const previous = Object.fromEntries(
    Object.keys(input.patch.changes).map((key) => [key, original[key] ?? null]),
  )
  const apply = async (expected: Record<string, unknown>, changes: Record<string, unknown>) => {
    const current = await input.read(input.patch.path)
    const record = current.document.records.find((item) => item.id === input.patch.recordId)
    if (
      !record ||
      Object.entries(expected).some(
        ([key, value]) => JSON.stringify(record[key] ?? null) !== JSON.stringify(value),
      )
    ) {
      throw new Error("This record changed elsewhere. Review it before undoing.")
    }
    const result = await input.write({
      ...input.patch,
      expectedRevision: current.revision,
      changes,
    })
    if (result.conflict) throw new Error("This record changed elsewhere. Refresh and retry.")
    input.changed()
  }
  recordAppAction({
    label: `Update ${original.title}`,
    undo: () => apply(input.patch.changes, previous),
    redo: () => apply(previous, input.patch.changes),
  })
}
