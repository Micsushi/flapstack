import { sendDiffFeedbackSchema, type DiffAnnotationScope } from "../../shared/diff-annotations"
import type { z } from "zod"
export type PendingDiffFeedback = z.infer<typeof sendDiffFeedbackSchema>
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">
const key = (scope: DiffAnnotationScope) =>
  `diff-feedback-pending:${JSON.stringify([scope.projectId, scope.chatId])}`

export function readPendingFeedback(
  storage: Storage,
  scope: DiffAnnotationScope,
): PendingDiffFeedback | null {
  const raw = storage.getItem(key(scope))
  if (raw === null) return null
  if (raw.length > 16384) throw new Error("Stored feedback retry exceeds its limit")
  const request = sendDiffFeedbackSchema.parse(JSON.parse(raw))
  if (request.chatId !== scope.chatId || request.projectId !== scope.projectId)
    throw new Error("Stored feedback retry belongs to another review")
  return request
}

/** Persist only IDs/versions before any send. Main's version guard also protects cross-window races. */
export function storePendingFeedback(storage: Storage, request: PendingDiffFeedback) {
  const safe = sendDiffFeedbackSchema.parse(request)
  const existing = readPendingFeedback(storage, safe)
  if (existing && JSON.stringify(existing) !== JSON.stringify(safe))
    throw new Error("Another feedback retry is pending. Refresh before sending.")
  const serialized = JSON.stringify(safe)
  storage.setItem(key(safe), serialized)
  if (storage.getItem(key(safe)) !== serialized)
    throw new Error("Feedback retry could not be saved. Nothing was sent.")
}

export function clearPendingFeedback(storage: Storage, request: PendingDiffFeedback) {
  if (readPendingFeedback(storage, request)?.id === request.id) storage.removeItem(key(request))
}
