import { z } from "zod"
import { router, publicProcedure } from "../index"
import { readdir, stat, readFile } from "node:fs/promises"
import { join, relative, basename, extname } from "node:path"
import { app, shell } from "electron"
import { watch } from "node:fs"
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { getDatabase, subChats } from "../../db"
import { actOnPathInsideRoot, renamePathInsideRoot, writeFileInsideRoot } from "../../path-safety"
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
): Promise<FileEntry[]> {
  if (depth > maxDepth) return []

  const entries: FileEntry[] = []

  try {
    const dirEntries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of dirEntries) {
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

        // Recurse into subdirectory
        const subEntries = await scanDirectory(rootPath, fullPath, depth + 1, maxDepth)
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
      }
    }
  } catch (error) {
    // Silently skip directories we can't read
    console.warn(`[files] Could not read directory: ${currentPath}`, error)
  }

  return entries
}

/**
 * Get cached entry list or scan directory
 */
async function getEntryList(projectPath: string): Promise<FileEntry[]> {
  const cached = fileListCache.get(projectPath)
  const now = Date.now()

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.entries
  }

  const entries = await scanDirectory(projectPath)

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

  fileListCache.set(projectPath, { entries, timestamp: now })
  return entries
}

/**
 * Filter and sort entries (files and folders) by query
 */
function filterEntries(
  entries: FileEntry[],
  query: string,
  limit: number,
  typeFilter?: "file" | "folder",
): Array<{ id: string; label: string; path: string; repository: string; type: "file" | "folder" }> {
  const queryLower = query.toLowerCase()

  // Filter entries that match the query and optional type filter
  let filtered = entries
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

export const filesRouter = router({
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
    .query(async ({ input }) => {
      const { projectPath, query, limit, typeFilter } = input

      if (!projectPath) {
        return []
      }

      try {
        // Verify the path exists and is a directory
        const pathStat = await stat(projectPath)
        if (!pathStat.isDirectory()) {
          console.warn(`[files] Not a directory: ${projectPath}`)
          return []
        }

        // Get entry list (cached or fresh scan)
        const entries = await getEntryList(projectPath)

        // Filter and sort by query
        return filterEntries(entries, query, limit, typeFilter)
      } catch (error) {
        console.error(`[files] Error searching files:`, error)
        return []
      }
    }),

  /**
   * Clear the file cache for a project (useful when files change)
   */
  clearCache: publicProcedure.input(z.object({ projectPath: z.string() })).mutation(({ input }) => {
    fileListCache.delete(input.projectPath)
    return { success: true }
  }),

  /**
   * Read file contents from filesystem
   */
  readFile: publicProcedure.input(z.object({ filePath: z.string() })).query(async ({ input }) => {
    const { filePath } = input

    try {
      const content = await readFile(filePath, "utf-8")
      return content
    } catch (error) {
      console.error(`[files] Error reading file ${filePath}:`, error)
      throw new Error(
        `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
    }
  }),

  /**
   * Read a text file with size/binary validation
   * Returns structured result with error reasons
   */
  readTextFile: publicProcedure
    .input(z.object({ filePath: z.string() }))
    .query(async ({ input }) => {
      const { filePath } = input
      const MAX_SIZE = 2 * 1024 * 1024 // 2 MB

      try {
        const fileStat = await stat(filePath)

        if (fileStat.size > MAX_SIZE) {
          return { ok: false as const, reason: "too-large" as const, byteLength: fileStat.size }
        }

        const buffer = await readFile(filePath)

        // Check if binary by looking for null bytes in first 8KB
        const sample = buffer.subarray(0, 8192)
        if (sample.includes(0)) {
          return { ok: false as const, reason: "binary" as const, byteLength: fileStat.size }
        }

        const content = buffer.toString("utf-8")
        return { ok: true as const, content, byteLength: fileStat.size }
      } catch (error) {
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
  readBinaryFile: publicProcedure
    .input(z.object({ filePath: z.string() }))
    .query(async ({ input }) => {
      const { filePath } = input
      const MAX_SIZE = 20 * 1024 * 1024 // 20 MB

      try {
        const fileStat = await stat(filePath)

        if (fileStat.size > MAX_SIZE) {
          return { ok: false as const, reason: "too-large" as const, byteLength: fileStat.size }
        }

        const buffer = await readFile(filePath)
        const ext = extname(filePath).toLowerCase()

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
          byteLength: fileStat.size,
        }
      } catch (error) {
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
      return observable<{ filename: string; eventType: string }>((emit) => {
        const watcher = watch(input.projectPath, { recursive: true }, (eventType, filename) => {
          if (filename) {
            emit.next({ filename, eventType })
          }
        })

        return () => {
          watcher.close()
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
