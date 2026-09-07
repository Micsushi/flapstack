import { z } from "zod"
import { isUtf8 } from "node:buffer"
import { router, publicProcedure, betaProcedure } from "../index"
import type {
  WorkspaceFileResult,
  WorkspaceFileSearchEvent,
} from "../../../../shared/workspace-search"
import { realpathSync } from "node:fs"
import { lstat, opendir, realpath } from "node:fs/promises"
import { join, relative, basename, extname, isAbsolute, resolve, sep } from "node:path"
import { app, shell } from "electron"
import { watch as watchFiles } from "chokidar"
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { getDatabase, subChats } from "../../db"
import {
  actOnPathInsideRoot,
  readFileInsideRoot,
  RootedReadTooLargeError,
  renamePathInsideRoot,
  writeFileInsideRoot,
} from "../../path-safety"
import { assertRegisteredWorktree } from "../../git/security/path-validation"

// Directories to ignore when scanning
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "release",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".turbo",
  ".vercel",
  ".netlify",
  "out",
  ".svelte-kit",
  ".astro",
])

function decodeTextPreview(buffer: Buffer) {
  const byteLength = buffer.byteLength
  if (buffer.includes(0)) return { ok: false as const, reason: "binary" as const, byteLength }
  if (!isUtf8(buffer))
    return { ok: false as const, reason: "unsupported-encoding" as const, byteLength }
  // Buffer preserves UTF-8 BOMs and line endings after validation.
  return { ok: true as const, content: buffer.toString("utf8"), byteLength }
}

// Files to ignore
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", ".gitkeep"])

// File extensions to ignore
const IGNORED_EXTENSIONS = new Set([
  ".log",
  ".lock", // We'll handle package-lock.json separately
  ".pyc",
  ".pyo",
  ".class",
  ".o",
  ".obj",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
])

// Lock files to keep (not ignore)
const ALLOWED_LOCK_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
])

// Entry type for files and folders
interface FileEntry {
  path: string
  type: "file" | "folder"
}

// Cache for file and folder listings (bounded LRU)
const MAX_CACHE_ENTRIES = 20
const fileListCache = new Map<string, { entries: FileEntry[]; timestamp: number }>()
const CACHE_TTL = 5000 // 5 seconds
const MAX_SCAN_ENTRIES = 20_000
const MAX_SCAN_DURATION_MS = 10_000
const pendingScans = new Map<
  string,
  {
    controller: AbortController
    users: number
    promise: Promise<FileEntry[]>
    partial: FileEntry[]
    listeners: Set<(entries: FileEntry[]) => void>
  }
>()

const rootedFileInput = z.object({
  rootPath: z.string().min(1),
  relativePath: z.string().min(1),
})
const subChatFileInput = z.object({
  subChatId: z.string().min(1),
  filePath: z.string().min(1),
})
const fileTargetInput = z.union([rootedFileInput, subChatFileInput])

function validateFileName(name: string): void {
  if (name.includes("/") || name.includes("\\")) {
    throw new Error("File name cannot contain path separators")
  }
  if (name.includes("\0")) {
    throw new Error("File name contains invalid characters")
  }
  if (name === "." || name === "..") {
    throw new Error("Invalid file name")
  }
}

/**
 * Recursively scan a directory and return all file and folder paths
 */
async function scanDirectory(
  rootPath: string,
  currentPath: string = rootPath,
  depth: number = 0,
  maxDepth: number = 15,
  budget: { remaining: number; signal: AbortSignal; onEntry?: (entry: FileEntry) => void } = {
    remaining: MAX_SCAN_ENTRIES,
    signal: AbortSignal.timeout(MAX_SCAN_DURATION_MS),
  },
): Promise<FileEntry[]> {
  budget.signal.throwIfAborted()
  if (depth > maxDepth) throw new Error("File discovery exceeded its directory depth limit")

  const entries: FileEntry[] = []

  const currentInfo = await lstat(currentPath)
  budget.signal.throwIfAborted()
  if (currentInfo.isSymbolicLink() || !currentInfo.isDirectory())
    throw new Error("File discovery root changed during scanning")
  const realRoot = await realpath(rootPath)
  const realCurrent = await realpath(currentPath)
  const relativeCurrent = relative(realRoot, realCurrent)
  if (
    relativeCurrent === ".." ||
    relativeCurrent.startsWith(`..${sep}`) ||
    isAbsolute(relativeCurrent)
  ) {
    throw new Error("File discovery escaped its registered root")
  }
  budget.signal.throwIfAborted()
  const dirEntries = await opendir(currentPath)

  for await (const entry of dirEntries) {
    budget.signal.throwIfAborted()
    // Partial results must be validated before publication, not only at scan end.
    const liveDirectory = await lstat(currentPath)
    if (
      liveDirectory.isSymbolicLink() ||
      liveDirectory.dev !== currentInfo.dev ||
      liveDirectory.ino !== currentInfo.ino ||
      (await realpath(currentPath)) !== realCurrent
    )
      throw new Error("File discovery directory changed during scanning")
    budget.signal.throwIfAborted()
    if (--budget.remaining < 0) throw new Error("File discovery exceeded its entry limit")
    const fullPath = join(currentPath, entry.name)
    const relativePath = relative(rootPath, fullPath)

    if (entry.isDirectory()) {
      // Skip ignored directories
      if (IGNORED_DIRS.has(entry.name)) continue
      // Skip hidden directories (except .github, .vscode, etc.)
      if (
        entry.name.startsWith(".") &&
        !entry.name.startsWith(".github") &&
        !entry.name.startsWith(".vscode")
      )
        continue

      // Add the folder itself to results
      entries.push({ path: relativePath, type: "folder" })
      budget.onEntry?.(entries[entries.length - 1])

      // Recurse into subdirectory
      const subEntries = await scanDirectory(rootPath, fullPath, depth + 1, maxDepth, budget)
      entries.push(...subEntries)
    } else if (entry.isFile()) {
      // Skip ignored files
      if (IGNORED_FILES.has(entry.name)) continue

      // Check extension
      const ext = entry.name.includes(".") ? "." + entry.name.split(".").pop()?.toLowerCase() : ""
      if (IGNORED_EXTENSIONS.has(ext)) {
        // Allow specific lock files
        if (!ALLOWED_LOCK_FILES.has(entry.name)) continue
      }

      entries.push({ path: relativePath, type: "file" })
      budget.onEntry?.(entries[entries.length - 1])
    }
  }
  if ((await realpath(currentPath)) !== realCurrent)
    throw new Error("File discovery root changed during scanning")
  budget.signal.throwIfAborted()

  return entries
}

/**
 * Get cached entry list or scan directory
 */
async function getEntryList(
  projectPath: string,
  signal?: AbortSignal,
  onPartial?: (entries: FileEntry[]) => void,
): Promise<FileEntry[]> {
  signal?.throwIfAborted()
  const cached = fileListCache.get(projectPath)
  const now = Date.now()

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.entries
  }

  let flight = pendingScans.get(projectPath)
  if (!flight) {
    if (pendingScans.size >= MAX_CACHE_ENTRIES)
      throw new Error("Too many file discovery scans are active")
    const controller = new AbortController()
    const created = {
      controller,
      users: 0,
      promise: Promise.resolve([] as FileEntry[]),
      partial: [] as FileEntry[],
      listeners: new Set<(entries: FileEntry[]) => void>(),
    }
    let lastProgressAt = 0
    pendingScans.set(projectPath, created)
    created.promise = scanDirectory(projectPath, projectPath, 0, 15, {
      remaining: MAX_SCAN_ENTRIES,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MAX_SCAN_DURATION_MS)]),
      onEntry: (entry) => {
        created.partial.push(entry)
        if (Date.now() - lastProgressAt >= 100) {
          lastProgressAt = Date.now()
          for (const listener of created.listeners) listener(created.partial)
        }
      },
    })
      .then((entries) => {
        if (pendingScans.get(projectPath) !== created || controller.signal.aborted) return entries

        // Evict oldest entries if cache is full
        if (fileListCache.size >= MAX_CACHE_ENTRIES) {
          let oldest: string | null = null
          let oldestTime = Infinity
          for (const [key, val] of fileListCache) {
            if (val.timestamp < oldestTime) {
              oldestTime = val.timestamp
              oldest = key
            }
          }
          if (oldest) fileListCache.delete(oldest)
        }

        fileListCache.set(projectPath, { entries, timestamp: Date.now() })
        return entries
      })
      .finally(() => {
        if (pendingScans.get(projectPath) === created) pendingScans.delete(projectPath)
      })
    flight = created
  }
  flight.users += 1
  let onAbort: (() => void) | undefined
  try {
    if (onPartial) {
      flight.listeners.add(onPartial)
      if (flight.partial.length) onPartial(flight.partial)
    }
    return await new Promise<FileEntry[]>((resolve, reject) => {
      onAbort = () => reject(signal?.reason ?? new Error("File discovery cancelled"))
      signal?.addEventListener("abort", onAbort, { once: true })
      flight.promise.then(resolve, reject)
      if (signal?.aborted) onAbort()
    })
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort)
    if (onPartial) flight.listeners.delete(onPartial)
    flight.users -= 1
    if (flight.users === 0 && pendingScans.get(projectPath) === flight) {
      pendingScans.delete(projectPath)
      flight.controller.abort()
    }
  }
}

/**
 * Filter and sort entries (files and folders) by query
 */
function filterEntries(
  entries: FileEntry[],
  query: string,
  limit: number,
  typeFilter?: "file" | "folder",
): WorkspaceFileResult[] {
  const queryLower = query.toLowerCase()

  // Filter entries that match the query and optional type filter
  let filtered = [...entries]
  if (typeFilter) {
    filtered = filtered.filter((entry) => entry.type === typeFilter)
  }
  if (query) {
    filtered = filtered.filter((entry) => {
      const name = basename(entry.path).toLowerCase()
      const pathLower = entry.path.toLowerCase()
      return name.includes(queryLower) || pathLower.includes(queryLower)
    })
  }

  // Sort by relevance (exact match > starts with > shorter match > contains > alphabetical)
  // Files and folders are treated equally
  filtered.sort((a, b) => {
    const aName = basename(a.path).toLowerCase()
    const bName = basename(b.path).toLowerCase()

    if (query) {
      // Priority 1: Exact name match
      const aExact = aName === queryLower
      const bExact = bName === queryLower
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1

      // Priority 2: Name starts with query
      const aStarts = aName.startsWith(queryLower)
      const bStarts = bName.startsWith(queryLower)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1

      // Priority 3: If both start with query, shorter name = better match
      if (aStarts && bStarts) {
        if (aName.length !== bName.length) {
          return aName.length - bName.length
        }
      }

      // Priority 4: Name contains query (but doesn't start with it)
      const aContains = aName.includes(queryLower)
      const bContains = bName.includes(queryLower)
      if (aContains && !bContains) return -1
      if (!aContains && bContains) return 1
    }

    // Alphabetical by name
    return aName.localeCompare(bName)
  })

  // Limit results
  const limited = filtered.slice(0, Math.min(limit, 5000))

  // Map to expected format with type
  return limited.map((entry) => ({
    id: `${entry.type}:local:${entry.path}`,
    label: basename(entry.path),
    path: entry.path,
    repository: "local",
    type: entry.type,
  }))
}

let activeSearchStreams = 0

export const filesRouter = router({
  searchStream: betaProcedure("streamedFileSearch")
    .input(
      z.object({
        requestId: z.string().uuid(),
        projectPath: z.string().min(1),
        query: z.string().max(512).default(""),
        limit: z.number().int().min(1).max(500).default(50),
        typeFilter: z.enum(["file", "folder"]).optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<WorkspaceFileSearchEvent>((emit) => {
        const identity = { requestId: input.requestId, provider: "filesystem" as const }
        if (activeSearchStreams >= 20) {
          emit.next({
            ...identity,
            status: "error",
            code: "failed",
            message: "Too many file searches are active. Retry after closing another search.",
          })
          emit.complete()
          return
        }
        activeSearchStreams += 1
        const controller = new AbortController()
        let disposed = false
        const publish = (entries: FileEntry[], status: "partial" | "complete") => {
          if (disposed) return
          try {
            assertRegisteredWorktree(input.projectPath)
            emit.next({
              ...identity,
              status,
              results: filterEntries(entries, input.query, input.limit, input.typeFilter),
            })
          } catch (error) {
            controller.abort(error)
          }
        }
        void (async () => {
          try {
            const root = assertRegisteredWorktree(input.projectPath)
            const entries = await getEntryList(root.canonicalPath, controller.signal, (partial) =>
              publish(partial, "partial"),
            )
            controller.signal.throwIfAborted()
            publish(entries, "complete")
            controller.signal.throwIfAborted()
          } catch (error) {
            if (!disposed)
              emit.next({
                ...identity,
                status: "error",
                code:
                  error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed",
                message:
                  error instanceof Error && error.name === "AbortError"
                    ? "File discovery was cancelled. Retry to start a fresh search."
                    : "File discovery failed. Check that the folder is readable and connected, then retry.",
              })
          } finally {
            if (!disposed) emit.complete()
          }
        })()
        return () => {
          disposed = true
          activeSearchStreams -= 1
          controller.abort()
        }
      }),
    ),
  /**
   * Search files and folders in a local project directory
   */
  search: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        query: z.string().default(""),
        limit: z.number().min(1).max(5000).default(50),
        typeFilter: z.enum(["file", "folder"]).optional(),
      }),
    )
    .query(async ({ input, signal }) => {
      const { projectPath, query, limit, typeFilter } = input

      if (!projectPath) {
        return []
      }

      try {
        const registeredRoot = assertRegisteredWorktree(projectPath)

        // Get entry list (cached or fresh scan)
        const entries = await getEntryList(registeredRoot.canonicalPath, signal)
        assertRegisteredWorktree(projectPath)

        // Filter and sort by query
        return filterEntries(entries, query, limit, typeFilter)
      } catch (error) {
        if (!signal?.aborted) console.error(`[files] Error searching files:`, error)
        throw error
      }
    }),

  /**
   * Clear the file cache for a project (useful when files change)
   */
  clearCache: publicProcedure.input(z.object({ projectPath: z.string() })).mutation(({ input }) => {
    const registeredRoot = assertRegisteredWorktree(input.projectPath)
    fileListCache.delete(registeredRoot.canonicalPath)
    pendingScans.get(registeredRoot.canonicalPath)?.controller.abort()
    pendingScans.delete(registeredRoot.canonicalPath)
    return { success: true }
  }),

  /**
   * Read file contents from filesystem
   */
  readFile: publicProcedure.input(fileTargetInput).query(async ({ input }) => {
    try {
      const target = resolveDurableFileTarget(input)
      const content = await readFileInsideRoot(target.rootPath, target.relativePath, {
        maxBytes: 2 * 1024 * 1024,
      })
      target.verifyAfterRead()
      const decoded = decodeTextPreview(content)
      if (!decoded.ok)
        throw new Error(
          decoded.reason === "binary" ? "Cannot display binary file" : "File is not valid UTF-8",
        )
      return decoded.content
    } catch (error) {
      if (error instanceof RootedReadTooLargeError)
        throw new Error("Plan exceeds the 2 MiB preview limit.")
      console.error("[files] Error reading rooted file:", error)
      throw new Error(
        `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
    }
  }),

  /**
   * Read a text file with size/binary validation
   * Returns structured result with error reasons
   */
  readTextFile: publicProcedure.input(fileTargetInput).query(async ({ input }) => {
    const MAX_SIZE = 2 * 1024 * 1024 // 2 MB

    try {
      const target = resolveDurableFileTarget(input)
      const buffer = await readFileInsideRoot(target.rootPath, target.relativePath, {
        maxBytes: MAX_SIZE,
      })
      target.verifyAfterRead()
      if (buffer.byteLength > MAX_SIZE) {
        return { ok: false as const, reason: "too-large" as const, byteLength: buffer.byteLength }
      }

      return decodeTextPreview(buffer)
    } catch (error) {
      if (error instanceof RootedReadTooLargeError) {
        return { ok: false as const, reason: "too-large" as const, byteLength: error.byteLength }
      }
      const msg = error instanceof Error ? error.message : "Unknown error"
      if (msg.includes("ENOENT") || msg.includes("no such file")) {
        return { ok: false as const, reason: "not-found" as const, byteLength: 0 }
      }
      throw new Error(`Failed to read file: ${msg}`)
    }
  }),

  /**
   * Read a binary file as base64 (for images)
   */
  readBinaryFile: publicProcedure.input(fileTargetInput).query(async ({ input }) => {
    const MAX_SIZE = 20 * 1024 * 1024 // 20 MB

    try {
      const target = resolveDurableFileTarget(input)
      const buffer = await readFileInsideRoot(target.rootPath, target.relativePath, {
        maxBytes: MAX_SIZE,
      })
      target.verifyAfterRead()
      if (buffer.byteLength > MAX_SIZE) {
        return { ok: false as const, reason: "too-large" as const, byteLength: buffer.byteLength }
      }
      const ext = extname(target.relativePath).toLowerCase()

      // Determine MIME type
      const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".bmp": "image/bmp",
      }
      const mimeType = mimeMap[ext] || "application/octet-stream"

      return {
        ok: true as const,
        data: buffer.toString("base64"),
        mimeType,
        byteLength: buffer.byteLength,
      }
    } catch (error) {
      if (error instanceof RootedReadTooLargeError) {
        return { ok: false as const, reason: "too-large" as const, byteLength: error.byteLength }
      }
      const msg = error instanceof Error ? error.message : "Unknown error"
      if (msg.includes("ENOENT") || msg.includes("no such file")) {
        return { ok: false as const, reason: "not-found" as const, byteLength: 0 }
      }
      throw new Error(`Failed to read binary file: ${msg}`)
    }
  }),

  /**
   * Watch for file changes in a project directory
   * Emits events when files are modified
   */
  watchChanges: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .subscription(({ input }) => {
      const registeredRoot = assertRegisteredWorktree(input.projectPath)
      return observable<{ filename: string; eventType: string }>((emit) => {
        const watcher = watchFiles(registeredRoot.canonicalPath, {
          followSymlinks: false,
          ignoreInitial: true,
        })
        watcher.on("all", (eventType, changedPath) => {
          try {
            assertRegisteredWorktree(input.projectPath)
            const filename = relative(registeredRoot.canonicalPath, changedPath)
            if (
              filename &&
              filename !== ".." &&
              !filename.startsWith(`..${sep}`) &&
              !isAbsolute(filename)
            ) {
              emit.next({ filename, eventType })
            }
          } catch (error) {
            void watcher.close()
            emit.error(error instanceof Error ? error : new Error("Registered root changed"))
          }
        })
        watcher.on("error", (error) => emit.error(error))

        return () => {
          void watcher.close()
        }
      })
    }),

  /**
   * Write pasted text to a file in the session's pasted directory
   * Used for large text pastes that shouldn't be embedded inline
   */
  writePastedText: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        text: z.string(),
        filename: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { subChatId, text, filename } = input

      // subChatId is both an ownership key and a path component. Require the
      // durable row first, then constrain it to one path segment.
      const subChat = getDatabase()
        .select({ id: subChats.id })
        .from(subChats)
        .where(eq(subChats.id, subChatId))
        .get()
      if (!subChat) throw new Error("Sub-chat not found")
      validateFileName(subChat.id)

      const userDataRoot = app.getPath("userData")

      // Generate filename with timestamp
      const finalFilename = filename || `pasted_${Date.now()}.txt`

      // Validate filename doesn't contain path separators or null bytes
      validateFileName(finalFilename)

      const { targetPath: filePath } = await writeFileInsideRoot(
        userDataRoot,
        join("claude-sessions", subChat.id, "pasted", finalFilename),
        { data: text },
        { overwrite: true },
      )

      console.log(`[files] Wrote pasted text to ${filePath} (${text.length} bytes)`)

      return {
        filePath,
        filename: finalFilename,
        size: text.length,
      }
    }),

  /**
   * Rename a file or folder
   */
  renameFile: publicProcedure
    .input(
      z.object({
        worktreePath: z.string(),
        relativePath: z.string(),
        newName: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      assertRegisteredWorktree(input.worktreePath)
      const { newPath } = await renamePathInsideRoot(
        input.worktreePath,
        input.relativePath,
        input.newName,
      )
      return { success: true, newPath }
    }),

  /**
   * Delete a file or folder (move to trash)
   */
  deleteFile: publicProcedure
    .input(
      z.object({
        worktreePath: z.string(),
        relativePath: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      assertRegisteredWorktree(input.worktreePath)
      await actOnPathInsideRoot(input.worktreePath, input.relativePath, (targetPath) =>
        shell.trashItem(targetPath),
      )
      return { success: true }
    }),
})

function resolveDurableFileTarget(input: z.infer<typeof fileTargetInput>): {
  rootPath: string
  relativePath: string
  verifyAfterRead: () => void
} {
  if ("rootPath" in input) {
    const registration = assertRegisteredWorktree(input.rootPath)
    return {
      rootPath: registration.canonicalPath,
      relativePath: input.relativePath,
      verifyAfterRead: () => {
        assertRegisteredWorktree(input.rootPath)
      },
    }
  }

  const subChat = getDatabase()
    .select({ id: subChats.id, chatId: subChats.chatId })
    .from(subChats)
    .where(eq(subChats.id, input.subChatId))
    .get()
  if (!subChat) throw new Error("Sub-chat not found")
  validateFileName(subChat.id)
  validateFileName(subChat.chatId)
  if (!isAbsolute(input.filePath)) throw new Error("Sub-chat file path must be absolute")

  const lexicalUserDataRoot = resolve(app.getPath("userData"))
  const userDataRoot = realpathSync(lexicalUserDataRoot)
  const absoluteTarget = resolve(input.filePath)
  const userDataRoots = [...new Set([lexicalUserDataRoot, userDataRoot])]
  const matchedUserDataRoot = userDataRoots.find((candidateRoot) =>
    [subChat.id, subChat.chatId].some((ownerId) => {
      const candidateRelative = relative(
        join(candidateRoot, "claude-sessions", ownerId),
        absoluteTarget,
      )
      return (
        candidateRelative !== ".." &&
        !candidateRelative.startsWith(`..${sep}`) &&
        !isAbsolute(candidateRelative)
      )
    }),
  )
  if (!matchedUserDataRoot) throw new Error("File is outside the durable sub-chat namespace")

  const relativePath = relative(matchedUserDataRoot, absoluteTarget)
  return {
    rootPath: userDataRoot,
    relativePath,
    verifyAfterRead: () => {
      const durable = getDatabase()
        .select({ id: subChats.id })
        .from(subChats)
        .where(eq(subChats.id, input.subChatId))
        .get()
      if (!durable) throw new Error("Sub-chat registration changed during read")
    },
  }
}
