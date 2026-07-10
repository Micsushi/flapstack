// Stage 2 Track B — U7: Cursor local credential detection and refresh storage.
// Reads Cursor's state.vscdb and, on macOS, the same Keychain entries Cursor
// uses. Refreshed rotating credentials are written back to both available
// stores so the background daemon keeps working while Flapstack is closed.

import { existsSync } from "node:fs"
import { homedir, platform, userInfo } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

export type CursorTokenSource = "sqlite" | "keychain"

export interface CursorTokenResult {
  token: string | null
  source: CursorTokenSource | null
  statePath: string | null
  reason?: "not-installed" | "not-logged-in" | "read-failed" | "unsupported-platform"
}

export interface CursorCredentialsResult extends CursorTokenResult {
  refreshToken: string | null
  expiresAt: Date | null
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

export function detectCursorToken(): CursorTokenResult {
  const credentials = detectCursorCredentials()
  return {
    token: credentials.token,
    source: credentials.source,
    statePath: credentials.statePath,
    ...(credentials.reason ? { reason: credentials.reason } : {}),
  }
}

export function detectCursorCredentials(): CursorCredentialsResult {
  const candidates = cursorStateDbCandidates()
  if (candidates.length === 0) return empty("unsupported-platform", null)
  const statePath = candidates.find((path) => existsSync(path)) ?? null
  const sqliteCredentials = statePath ? readSqliteCredentials(statePath) : null
  const keychainCredentials = platform() === "darwin" ? readMacKeychainCredentials() : null
  const selected = sqliteCredentials?.token
    ? { ...sqliteCredentials, source: "sqlite" as const }
    : keychainCredentials?.token
      ? { ...keychainCredentials, source: "keychain" as const }
      : null
  if (selected) {
    return {
      token: selected.token,
      refreshToken: selected.refreshToken,
      expiresAt: jwtExpiry(selected.token!),
      source: selected.source,
      statePath,
    }
  }
  if (!statePath && !keychainCredentials) return empty("not-installed", null)
  if (sqliteCredentials === null && statePath) return empty("read-failed", statePath)
  return empty("not-logged-in", statePath)
}

/** Persist a refreshed rotating credential to every available Cursor store. */
export function persistCursorCredentials(accessToken: string, refreshToken: string | null): void {
  const statePath = cursorStateDbCandidates().find((path) => existsSync(path))
  if (statePath) {
    const Database = loadDatabase()
    if (Database) {
      const db = new Database(statePath)
      try {
        const statement = db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
        statement.run("cursorAuth/accessToken", accessToken)
        if (refreshToken) statement.run("cursorAuth/refreshToken", refreshToken)
      } finally {
        db.close()
      }
    }
  }
  if (platform() === "darwin") {
    writeMacKeychainSecret("cursor-access-token", accessToken)
    if (refreshToken) writeMacKeychainSecret("cursor-refresh-token", refreshToken)
  }
}

function readSqliteCredentials(
  path: string,
): { token: string | null; refreshToken: string | null } | null {
  const Database = loadDatabase()
  if (!Database) return null
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true })
    try {
      const read = (key: string) => {
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as
          { value?: string } | undefined
        return normalizeStoredValue(row?.value)
      }
      return {
        token: read("cursorAuth/accessToken"),
        refreshToken: read("cursorAuth/refreshToken"),
      }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

function readMacKeychainCredentials(): {
  token: string | null
  refreshToken: string | null
} | null {
  const token = readMacKeychainSecret("cursor-access-token")
  const refreshToken = readMacKeychainSecret("cursor-refresh-token")
  return token || refreshToken ? { token, refreshToken } : null
}

function readMacKeychainSecret(service: string): string | null {
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", service, "-a", userInfo().username, "-w"],
    { encoding: "utf8" },
  )
  return result.status === 0 ? result.stdout.trim() || null : null
}

function writeMacKeychainSecret(service: string, value: string): void {
  spawnSync(
    "/usr/bin/security",
    ["add-generic-password", "-s", service, "-a", userInfo().username, "-w", value, "-U"],
    { encoding: "utf8" },
  )
}

function jwtExpiry(token: string): Date | null {
  const payload = token.split(".")[1]
  if (!payload) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number
    }
    return typeof parsed.exp === "number" ? new Date(parsed.exp * 1_000) : null
  } catch {
    return null
  }
}

function normalizeStoredValue(value: string | undefined): string | null {
  if (!value) return null
  return value.trim().replace(/^"|"$/g, "") || null
}

function loadDatabase(): typeof import("better-sqlite3") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("better-sqlite3") as typeof import("better-sqlite3")
  } catch {
    return null
  }
}

function empty(
  reason: CursorCredentialsResult["reason"],
  statePath: string | null,
): CursorCredentialsResult {
  return { token: null, refreshToken: null, expiresAt: null, source: null, statePath, reason }
}
