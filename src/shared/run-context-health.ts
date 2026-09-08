import { z } from "zod"
export const runContextHealthInputSchema = z
  .object({ chatId: z.string().min(1).max(200), runId: z.string().min(1).max(200) })
  .strict()
export type RunContextHealth = {
  chatId: string
  runId: string
  projectId: string | null
  taskId: string | null
  checkedAt: number
  status: "unavailable" | "empty" | "rejected" | "included"
  reason: string | null
  selectionSource: "run" | "task" | "project" | "fixed-default" | null
  budget: {
    maxBytes: number
    maxEstimatedTokens: number
    includedBytes: number
    estimatedTokens: number
  } | null
  graphGenerationId: string | null
  sources: Array<{
    kind: "section" | "graph"
    id: string
    title: string
    sourcePath: string
    version: number | null
    contentHash: string
    originalBytes: number
    includedBytes: number
    estimatedTokens: number
    truncated: boolean
    current: {
      status: "changed" | "unchanged" | "missing" | "unknown"
      version: number | null
      contentHash: string | null
      recordedAt: number | null
    }
  }>
  filesystemFreshness: "unverified"
  providerReceipt: "unverified"
}
