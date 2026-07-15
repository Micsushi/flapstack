import {
  savedWorkspaceLayoutSchema,
  type SavedWorkspaceLayout,
} from "../../../shared/saved-workspaces"

const KEY_PREFIX = "flapstack:saved-workspace-selection:v1:"
const DRAFT_KEY_PREFIX = "flapstack:saved-workspace-draft:v1:"

export function readSavedWorkspaceSelection(projectId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(`${KEY_PREFIX}${projectId}`)
  } catch {
    return null
  }
}

export function writeSavedWorkspaceSelection(projectId: string, workspaceId: string | null): void {
  if (typeof window === "undefined") return
  try {
    const key = `${KEY_PREFIX}${projectId}`
    if (workspaceId) window.localStorage.setItem(key, workspaceId)
    else window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in hardened renderer sessions.
  }
}

export function readPendingWorkspaceLayout(
  workspaceId: string,
): { layout: SavedWorkspaceLayout; expectedVersion: number } | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${workspaceId}`)
    if (!raw) return null
    const value = JSON.parse(raw) as { layout?: unknown; expectedVersion?: unknown }
    const layout = savedWorkspaceLayoutSchema.safeParse(value.layout)
    if (
      !layout.success ||
      typeof value.expectedVersion !== "number" ||
      !Number.isInteger(value.expectedVersion) ||
      value.expectedVersion < 1
    ) {
      return null
    }
    return { layout: layout.data, expectedVersion: value.expectedVersion }
  } catch {
    return null
  }
}

export function writePendingWorkspaceLayout(
  workspaceId: string,
  draft: { layout: SavedWorkspaceLayout; expectedVersion: number } | null,
): void {
  if (typeof window === "undefined") return
  try {
    const key = `${DRAFT_KEY_PREFIX}${workspaceId}`
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft))
    else window.sessionStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in hardened renderer sessions.
  }
}
