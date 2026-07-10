// Stage 2 Track B — U7: Cursor local access-token auto-detect (scaffold).
//
// Ports onWatch `internal/api/cursor_token.go` (+ `_unix`/`_windows`). Cursor
// stores its auth state in a per-user SQLite file (`state.vscdb`) under the
// `cursorAuth/accessToken` key. This module resolves the file location per OS
// and reads the token. The Cursor harness onboarding (Track D — D3) reuses this
// detector, so keep it dependency-light and side-effect free.
//
// Scaffold note: the SQLite read is guarded — if better-sqlite3 or the file is
// unavailable we return an honest not-detected result rather than throwing.

import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"

export type CursorTokenSource = "sqlite" | "keychain"

export interface CursorTokenResult {
  token: string | null
  source: CursorTokenSource | null
  /** Absolute path of the state DB we looked at, for diagnostics. */
  statePath: string | null
  /** Honest reason when token is null. */
  reason?: "not-installed" | "not-logged-in" | "read-failed" | "unsupported-platform"
}

/** Candidate `state.vscdb` locations for the current OS. First existing wins. */
export function cursorStateDbCandidates(): string[] {
  const home = homedir()
  switch (platform()) {
    case "darwin":
      return [
        join(
          home,
          "Library",
          "Application Support",
          "Cursor",
          "User",
          "globalStorage",
          "state.vscdb",
        ),
      ]
    case "win32": {
      const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")
      return [join(appData, "Cursor", "User", "globalStorage", "state.vscdb")]
    }
    case "linux":
      return [
        join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
        join(home, ".config", "cursor", "User", "globalStorage", "state.vscdb"),
      ]
    default:
      return []
  }
}

function resolveStateDbPath(): string | null {
  return cursorStateDbCandidates().find((p) => existsSync(p)) ?? null
}

/**
 * Detect the Cursor access token from local state. Read-only; never writes.
 * Returns an honest result object; callers decide how to surface it.
 */
export function detectCursorToken(): CursorTokenResult {
  const candidates = cursorStateDbCandidates()
  if (candidates.length === 0) {
    return { token: null, source: null, statePath: null, reason: "unsupported-platform" }
  }
  const statePath = resolveStateDbPath()
  if (!statePath) {
    return { token: null, source: null, statePath: null, reason: "not-installed" }
  }

  try {
    // Lazy require so tests / the daemon can import this module without the
    // native module present. Real read lands in U7 implementation.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3") as typeof import("better-sqlite3")
    const db = new Database(statePath, { readonly: true, fileMustExist: true })
    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = ?")
        .get("cursorAuth/accessToken") as { value?: string } | undefined
      const token = row?.value ? String(row.value).replace(/^"|"$/g, "") : null
      if (!token) {
        return { token: null, source: "sqlite", statePath, reason: "not-logged-in" }
      }
      return { token, source: "sqlite", statePath }
    } finally {
      db.close()
    }
  } catch {
    // Native module missing, locked DB, or schema drift — honest failure.
    return { token: null, source: null, statePath, reason: "read-failed" }
  }
}
