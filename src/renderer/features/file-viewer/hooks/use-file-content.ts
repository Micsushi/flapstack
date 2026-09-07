import { useMemo } from "react"
import { trpc } from "../../../lib/trpc"
import { toRootedFileTarget } from "../../../lib/file-target"
import { useFileChangeRefresh } from "./use-file-change-refresh"

/**
 * Error reasons for file loading failures
 */
export type FileLoadError =
  "not-found" | "too-large" | "binary" | "unsupported-encoding" | "unknown"

/**
 * Result of file content loading
 */
export interface FileContentResult {
  content: string | null
  isLoading: boolean
  error: FileLoadError | null
  byteLength: number | null
  refetch: () => void
}

/**
 * Get user-friendly error message for file load errors
 */
export function getErrorMessage(error: FileLoadError): string {
  switch (error) {
    case "not-found":
      return "File not found"
    case "too-large":
      return "File is too large to display (max 2 MB)"
    case "binary":
      return "Cannot display binary file"
    case "unsupported-encoding":
      return "This preview requires UTF-8. Open the file in an external editor."
    case "unknown":
    default:
      return "Failed to load file"
  }
}

/**
 * Hook to fetch file content from the backend
 * Uses an explicit registered-root plus relative-path contract.
 * Auto-refetches when the file changes on disk
 */
export function useFileContent(
  projectPath: string | null,
  filePath: string | null,
): FileContentResult {
  const fileTarget = useMemo(
    () => toRootedFileTarget(projectPath, filePath),
    [projectPath, filePath],
  )
  const enabled = !!fileTarget

  const { data, isLoading, error, refetch } = trpc.files.readTextFile.useQuery(
    fileTarget ?? { rootPath: projectPath || "invalid", relativePath: "invalid" },
    {
      enabled,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  )

  useFileChangeRefresh(fileTarget, refetch)

  return useMemo((): FileContentResult => {
    if (!enabled) {
      return { content: null, isLoading: false, error: null, byteLength: null, refetch: () => {} }
    }

    if (isLoading) {
      return { content: null, isLoading: true, error: null, byteLength: null, refetch }
    }

    if (error) {
      const errorMessage = error.message?.toLowerCase() || ""
      const isNotFound =
        errorMessage.includes("enoent") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("no such file")
      return {
        content: null,
        isLoading: false,
        error: isNotFound ? "not-found" : "unknown",
        byteLength: null,
        refetch,
      }
    }

    if (!data) {
      return { content: null, isLoading: false, error: "unknown", byteLength: null, refetch }
    }

    if (data.ok) {
      return {
        content: data.content,
        isLoading: false,
        error: null,
        byteLength: data.byteLength,
        refetch,
      }
    }

    return {
      content: null,
      isLoading: false,
      error: data.reason,
      byteLength: null,
      refetch,
    }
  }, [enabled, isLoading, error, data, refetch])
}
