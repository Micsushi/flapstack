import { EventEmitter, once } from "node:events"
import type { CodexProtocolNotification } from "./protocol-client"
import { eventRecord as record } from "../event-values"

function identity(thread: unknown, turn: unknown, item: unknown): string | null {
  if (![thread, turn, item].every((id) => typeof id === "string" && id.length > 0)) return null
  return JSON.stringify([thread, turn, item])
}

function pathLabel(value: string) {
  // Keep names on a single display line, including paths containing control or bidi characters.
  const text = value.replace(
    /[\p{Cc}\p{Cf}]/gu,
    (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`,
  )
  return text.length <= 170 ? text : text.slice(0, 65) + "…" + text.slice(-104)
}

function proposedFileChanges(changes: unknown): string | undefined {
  if (!Array.isArray(changes) || !changes.length) return undefined
  const visible = changes.slice(0, 3)
  if (!visible.some((change) => typeof record(change).path === "string" && record(change).path))
    return undefined
  const lines = visible.map((change) => {
    const { path, kind } = record(change)
    if (typeof path !== "string" || !path) return "Unspecified path"
    const operation = record(kind)
    const move = operation.move_path ?? operation.movePath
    return typeof move === "string" && move
      ? `${pathLabel(path)} → ${pathLabel(move)}`
      : pathLabel(path)
  })

  const remaining = changes.length - lines.length
  if (remaining) lines.push(`… and ${remaining} more change${remaining === 1 ? "" : "s"}`)
  return lines.join("\n")
}

export function codexFileChangeQuestion(params: Record<string, unknown>, scope: unknown): string {
  const root =
    typeof params.grantRoot === "string" && params.grantRoot ? pathLabel(params.grantRoot) : null
  const reason =
    typeof params.reason === "string" && params.reason.trim()
      ? params.reason.trim().slice(0, 300)
      : null
  return [
    "Allow this file change?",
    typeof scope === "string" && scope
      ? `Proposed files:\n${scope}`
      : "Codex did not identify the individual files.",
    root && `Requested write root: ${root}`,
    reason && `Reason: ${reason}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

// Approval RPCs and item notifications are dispatched independently by the app server.
export class CodexFileChangeApprovals {
  private readonly details = new Map<string, string>()
  private readonly available = new EventEmitter()

  observe({ method, params }: CodexProtocolNotification) {
    if (
      method !== "item/started" &&
      method !== "item/fileChange/patchUpdated" &&
      method !== "item/completed"
    )
      return
    const item = record(params.item)
    if (method !== "item/fileChange/patchUpdated" && item.type !== "fileChange") return
    const key = identity(params.threadId, params.turnId, params.itemId ?? item.id)
    if (!key) return
    if (method === "item/completed") {
      this.details.delete(key)
      return
    }
    const text = proposedFileChanges(
      method === "item/fileChange/patchUpdated" ? params.changes : item.changes,
    )
    if (!text) return
    this.details.set(key, text)
    this.available.emit(key, text)
  }

  async matching(
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const key = identity(params.threadId, params.turnId, params.itemId)
    if (!key || signal.aborted) return undefined
    const saved = this.details.get(key)
    if (saved) return saved
    try {
      const [text] = await once(this.available, key, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(750)]),
      })
      return text
    } catch {
      return undefined
    }
  }
}
