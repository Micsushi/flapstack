export type WorkspaceFileResult = {
  id: string
  label: string
  path: string
  repository: string
  type: "file" | "folder"
}

export type WorkspaceFileSearchEvent = {
  requestId: string
  provider: "filesystem"
} & (
  | { status: "partial" | "complete"; results: WorkspaceFileResult[] }
  | { status: "error"; code: "failed" | "cancelled"; message: string }
)
