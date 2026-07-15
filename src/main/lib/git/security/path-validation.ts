import { isAbsolute, normalize, resolve, sep } from "node:path"
import { eq } from "drizzle-orm"
import { lstatSync, realpathSync } from "node:fs"
import { getDatabase, projects, chats, filesystemRootRegistrations } from "../../db"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../../db/schema"

/**
 * Security model for desktop app filesystem access:
 *
 * THREAT MODEL:
 * While a compromised renderer can execute commands via terminal panes,
 * the File Viewer presents a distinct threat: malicious repositories can
 * contain symlinks that trick users into reading/writing sensitive files
 * (e.g., `docs/config.yml` → `~/.bashrc`). Users clicking these links
 * don't know they're accessing files outside the repo.
 *
 * PRIMARY BOUNDARY: assertRegisteredWorktree()
 * - Only worktree paths registered in localDb are accessible via tRPC
 * - Prevents direct filesystem access to unregistered paths
 *
 * SECONDARY: validateRelativePath()
 * - Rejects absolute paths and ".." traversal segments
 * - Defense in depth against path manipulation
 *
 * SYMLINK PROTECTION (secure-fs.ts):
 * - Writes: Block if realpath escapes worktree (prevents accidental overwrites)
 * - Reads: Caller can check isSymlinkEscaping() to warn users
 */

/**
 * Security error codes for path validation failures.
 */
export type PathValidationErrorCode =
  "ABSOLUTE_PATH" | "PATH_TRAVERSAL" | "UNREGISTERED_WORKTREE" | "INVALID_TARGET" | "SYMLINK_ESCAPE"

export type RegisteredFilesystemRoot = {
  path: string
  canonicalPath: string
  deviceId: string | null
  inodeId: string | null
}

/**
 * Error thrown when path validation fails.
 * Includes a code for programmatic handling.
 */
export class PathValidationError extends Error {
  constructor(
    message: string,
    public readonly code: PathValidationErrorCode,
  ) {
    super(message)
    this.name = "PathValidationError"
  }
}

/**
 * Validates that a workspace path is registered in database.
 * This is THE critical security boundary.
 *
 * Accepts:
 * - Worktree paths (from chats.worktreePath)
 * - Project paths (from projects.path)
 *
 * @throws PathValidationError if path is not registered
 */
export function assertRegisteredWorktree(workspacePath: string): RegisteredFilesystemRoot {
  const db = getDatabase()

  // Check chats.worktreePath first (most common case)
  const chatExists = db.select().from(chats).where(eq(chats.worktreePath, workspacePath)).get()

  if (chatExists) return verifyOrBindFilesystemRoot(workspacePath)

  // Check projects.path for direct project access
  const projectExists = db.select().from(projects).where(eq(projects.path, workspacePath)).get()

  if (projectExists) return verifyOrBindFilesystemRoot(workspacePath)

  throw new PathValidationError(
    "Workspace path not registered in database",
    "UNREGISTERED_WORKTREE",
  )
}

/**
 * Capture a durable root identity after the pathname has been registered as a
 * project or chat worktree. Existing bindings are immutable and are verified,
 * never silently refreshed when a directory is replaced.
 */
export function bindRegisteredFilesystemRoot(workspacePath: string): RegisteredFilesystemRoot {
  const db = getDatabase()
  const registered =
    db
      .select({ path: chats.worktreePath })
      .from(chats)
      .where(eq(chats.worktreePath, workspacePath))
      .get() ??
    db.select({ path: projects.path }).from(projects).where(eq(projects.path, workspacePath)).get()
  if (!registered) {
    throw new PathValidationError(
      "Workspace path not registered in database",
      "UNREGISTERED_WORKTREE",
    )
  }
  return bindFilesystemRootIdentity(workspacePath)
}

export function bindFilesystemRootIdentity(
  workspacePath: string,
  database: Pick<BetterSQLite3Database<typeof schema>, "insert" | "select"> = getDatabase(),
): RegisteredFilesystemRoot {
  const captured = captureFilesystemRoot(workspacePath)
  database
    .insert(filesystemRootRegistrations)
    .values({ ...captured, boundAt: new Date() })
    .onConflictDoNothing()
    .run()
  return assertRegisteredFilesystemRoot(workspacePath, database)
}

export function backfillFilesystemRootRegistrations(
  database: Pick<BetterSQLite3Database<typeof schema>, "insert" | "select">,
): number {
  const paths = new Set<string>()
  for (const row of database.select({ path: projects.path }).from(projects).all())
    paths.add(row.path)
  for (const row of database.select({ path: chats.worktreePath }).from(chats).all()) {
    if (row.path) paths.add(row.path)
  }
  let bound = 0
  for (const path of paths) {
    const existing = database
      .select({ path: filesystemRootRegistrations.path })
      .from(filesystemRootRegistrations)
      .where(eq(filesystemRootRegistrations.path, path))
      .get()
    if (existing) continue
    try {
      bindFilesystemRootIdentity(path, database)
      bound += 1
    } catch {
      // Legacy missing/inaccessible roots remain unbound and fail closed.
    }
  }
  return bound
}

function verifyOrBindFilesystemRoot(workspacePath: string): RegisteredFilesystemRoot {
  return assertRegisteredFilesystemRoot(workspacePath, getDatabase())
}

/** Verify any previously bound app-managed filesystem root. */
export function assertRegisteredFilesystemRoot(
  workspacePath: string,
  db: Pick<BetterSQLite3Database<typeof schema>, "select"> = getDatabase(),
): RegisteredFilesystemRoot {
  const existing = db
    .select()
    .from(filesystemRootRegistrations)
    .where(eq(filesystemRootRegistrations.path, workspacePath))
    .get()

  if (!existing) {
    throw new PathValidationError(
      "Registered root has no durable filesystem identity",
      "UNREGISTERED_WORKTREE",
    )
  }
  const registration = {
    path: existing.path,
    canonicalPath: existing.canonicalPath,
    deviceId: existing.deviceId,
    inodeId: existing.inodeId,
  }
  verifyFilesystemRootIdentity(registration)
  return registration
}

function captureFilesystemRoot(workspacePath: string): RegisteredFilesystemRoot {
  try {
    const lexicalPath = resolve(workspacePath)
    const info = lstatSync(lexicalPath, { bigint: true })
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new PathValidationError("Registered root must be a real directory", "SYMLINK_ESCAPE")
    }
    const canonicalPath = realpathSync(lexicalPath)
    return {
      path: workspacePath,
      canonicalPath,
      deviceId: info.dev === 0n && info.ino === 0n ? null : info.dev.toString(),
      inodeId: info.dev === 0n && info.ino === 0n ? null : info.ino.toString(),
    }
  } catch (error) {
    if (error instanceof PathValidationError) throw error
    throw new PathValidationError("Registered root identity cannot be captured", "SYMLINK_ESCAPE")
  }
}

function verifyFilesystemRootIdentity(registration: RegisteredFilesystemRoot): void {
  try {
    const lexicalPath = resolve(registration.path)
    const info = lstatSync(lexicalPath, { bigint: true })
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new PathValidationError("Registered root was replaced or symlinked", "SYMLINK_ESCAPE")
    }
    if (realpathSync(lexicalPath) !== registration.canonicalPath) {
      throw new PathValidationError("Registered root canonical path changed", "SYMLINK_ESCAPE")
    }
    if (
      registration.deviceId !== null &&
      registration.inodeId !== null &&
      (info.dev.toString() !== registration.deviceId ||
        info.ino.toString() !== registration.inodeId)
    ) {
      throw new PathValidationError("Registered root filesystem identity changed", "SYMLINK_ESCAPE")
    }
  } catch (error) {
    if (error instanceof PathValidationError) throw error
    throw new PathValidationError("Registered root identity cannot be verified", "SYMLINK_ESCAPE")
  }
}

/**
 * Gets the chat record if registered. Returns record for updates.
 *
 * @throws PathValidationError if chat is not registered
 */
export function getRegisteredChat(worktreePath: string): typeof chats.$inferSelect {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.worktreePath, worktreePath)).get()

  if (!chat) {
    throw new PathValidationError("Chat not registered in database", "UNREGISTERED_WORKTREE")
  }

  return chat
}

/**
 * Options for path validation.
 */
export interface ValidatePathOptions {
  /**
   * Allow empty/root path (resolves to worktree itself).
   * Default: false (prevents accidental worktree deletion)
   */
  allowRoot?: boolean
}

/**
 * Validates a relative file path for safety.
 * Rejects absolute paths and path traversal attempts.
 *
 * @throws PathValidationError if path is invalid
 */
export function validateRelativePath(filePath: string, options: ValidatePathOptions = {}): void {
  const { allowRoot = false } = options

  // Reject absolute paths
  if (isAbsolute(filePath)) {
    throw new PathValidationError("Absolute paths are not allowed", "ABSOLUTE_PATH")
  }

  const normalized = normalize(filePath)
  const segments = normalized.split(sep)

  // Reject ".." as a path segment (allows "..foo" directories)
  if (segments.includes("..")) {
    throw new PathValidationError("Path traversal not allowed", "PATH_TRAVERSAL")
  }

  // Reject root path unless explicitly allowed
  if (!allowRoot && (normalized === "" || normalized === ".")) {
    throw new PathValidationError("Cannot target worktree root", "INVALID_TARGET")
  }
}

/**
 * Validates and resolves a path within a worktree. Sync, simple.
 *
 * @param worktreePath - The worktree base path
 * @param filePath - The relative file path to validate
 * @param options - Validation options
 * @returns The resolved full path
 * @throws PathValidationError if path is invalid
 */
export function resolvePathInWorktree(
  worktreePath: string,
  filePath: string,
  options: ValidatePathOptions = {},
): string {
  validateRelativePath(filePath, options)
  // Use resolve to handle any worktreePath (relative or absolute)
  return resolve(worktreePath, normalize(filePath))
}

/**
 * Validates a path for git commands. Lighter check that allows root.
 *
 * @throws PathValidationError if path is invalid
 */
export function assertValidGitPath(filePath: string): void {
  validateRelativePath(filePath, { allowRoot: true })
}
