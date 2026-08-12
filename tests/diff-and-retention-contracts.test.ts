import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const activeChat = () => readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
const chatsRouter = () => readFileSync("src/main/lib/trpc/routers/chats.ts", "utf8")
const diffView = () => readFileSync("src/renderer/features/agents/ui/agent-diff-view.tsx", "utf8")
const terminalRouter = () => readFileSync("src/main/lib/trpc/routers/terminal.ts", "utf8")

describe("parsed diff known-hash protocol", () => {
  it("lets the main process answer 'unchanged' without reading file bodies", () => {
    const router = chatsRouter()

    expect(router).toContain("knownDiffHash: z.string().optional()")
    // The early return must sit before the parse/prefetch work.
    const guardIndex = router.indexOf(
      "if (input.knownDiffHash && input.knownDiffHash === diffHash)",
    )
    const prefetchIndex = router.indexOf("// 5. Prefetch file contents")
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(prefetchIndex)
    expect(router).toContain("return { unchanged: true as const, diffHash }")
  })

  it("only claims a known hash when it also covers the requested contents", () => {
    const source = activeChat()

    expect(source).toContain(
      "applied && (applied.hasContents || !includeContents) ? applied.hash : undefined",
    )
    expect(source).toContain("if (result.unchanged) return")
  })

  it("keeps the summary and full caches separated by key", () => {
    const router = chatsRouter()

    expect(router).toContain(
      "const cacheKey = input.includeContents ? diffHash : `${diffHash}:no-contents`",
    )
    expect(router).toContain("const summary = { ...fullCached, fileContents: {} }")
  })
})

describe("diff sidebar open race", () => {
  it("queues exactly one contents-enabled retry instead of dropping the caller", () => {
    const source = activeChat()

    expect(source).toContain("pendingContentsFetchRef")
    expect(source).toContain(
      "if (isDiffSidebarOpenRef.current && !inFlightIncludesContentsRef.current)",
    )
    // Cleared before the retry runs, and the retry runs off this stack, so a
    // repeated requirement can only re-arm the same single flag.
    expect(source).toMatch(/pendingContentsFetchRef\.current = false\s*\n\s*setTimeout\(/)
    expect(source).toContain("void fetchDiffStatsSelfRef.current()")
  })

  it("keeps releasing file bodies when the sidebar closes", () => {
    const source = activeChat()

    expect(source).toContain("if (isDiffSidebarOpen) return")
    expect(source).toContain("setPrefetchedFileContents({})")
  })

  it("does not re-read bodies the parent already prefetched", () => {
    const source = diffView()

    expect(source).toContain("if (worktreePath || !sandboxId) return")
    expect(source).not.toContain("trpcClient.changes.readMultipleWorkingFiles.query")
  })

  it("does not restore large file bodies after the sidebar closes mid-request", () => {
    const source = activeChat()

    expect(source).toContain(
      "const responseIncludesContents = includeContents && isDiffSidebarOpenRef.current",
    )
    expect(source).toContain(
      "setPrefetchedFileContents(responseIncludesContents ? result.fileContents : {})",
    )
  })
})

describe("diff stats dependencies", () => {
  it("does not rebuild the fetch callback when chat metadata identity changes", () => {
    const source = activeChat()

    expect(source).toContain("}, [worktreePath, sandboxId, chatId])")
    expect(source).toContain("agentChatRef.current as any)?.remoteStats")
    // Remote stats still trigger a refetch, through their own primitive key.
    expect(source).toContain("[remoteStatsKey, sandboxId, fetchDiffStats]")
  })
})

describe("sub-chat retention", () => {
  it("retains a bounded window of recently viewed sub-chats instead of dropping each one", () => {
    const source = activeChat()

    expect(source).toContain("const RETAINED_IDLE_SUB_CHATS = 3")
    expect(source).toContain("function retireSubChat")
    // Every release path goes through the retention window.
    expect(source).not.toMatch(
      /agentChatStore\.delete\(subChatId\)\s*\n\s*clearRuntimeCachesForSubChat/,
    )
    expect(source).toContain("markSubChatLive(subChatId)")
  })

  it("still refuses to release a streaming or queued sub-chat", () => {
    const source = activeChat()

    expect(source).toContain("function isSubChatReleasable")
    expect(source).toContain("useStreamingStatusStore.getState().isStreaming(subChatId)")
    expect(source).toContain("if (!isSubChatReleasable(oldest)) continue")
  })
})

describe("terminal stream teardown", () => {
  it("flushes buffered output before disposing the batcher", () => {
    const source = terminalRouter()

    expect(source).toMatch(/if \(!completed\) batcher\.flush\(\)\s*\n\s*batcher\.dispose\(\)/)
    // Nothing may be emitted after the exit event completed the observable.
    expect(source).toContain("completed = true")
  })
})
