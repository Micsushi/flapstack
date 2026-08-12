import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("renderer hot-path contracts", () => {
  it("isolates agent-input polling from the workbench parent", () => {
    const source = readFileSync("src/renderer/features/agents/ui/agents-content.tsx", "utf8")
    const parent = source.slice(
      source.indexOf("function AgentsContentInner"),
      source.indexOf("function AgentInputPoller"),
    )

    expect(source).toContain("function AgentInputPoller")
    expect(parent).not.toContain("agentInput.listWithContext.useQuery")
  })

  it("uses one bounded agent-input poll instead of a poll per visible pane", () => {
    const content = readFileSync("src/renderer/features/agents/ui/agents-content.tsx", "utf8")
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(content).toContain("refetchInterval: isVisible ? 1_000 : false")
    expect(content).not.toContain("refetchInterval: import.meta.env.DEV ? 250 : 1_000")
    expect(activeChat).not.toContain("window.setInterval(hydrate, 500)")
  })

  it("suspends always-on pollers while the window is hidden", () => {
    const content = readFileSync("src/renderer/features/agents/ui/agents-content.tsx", "utf8")
    const approvals = readFileSync("src/renderer/features/mcp-safety/approval-bridge.tsx", "utf8")

    for (const source of [content, approvals]) {
      expect(source).toContain("useDocumentVisible")
      // Suspending is only safe if the query catches up on becoming visible,
      // because refetchOnWindowFocus is disabled globally.
      expect(source).toMatch(/if \(isVisible\) void refetch/)
    }
    expect(approvals).toContain("refetchInterval: isVisible ? 500 : false")
  })

  it("does not poll the activity list at 1 Hz during a stream", () => {
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(activeChat).not.toContain("refetchInterval: isStreaming ? 1_000 : false")
    expect(activeChat).toContain("refetchInterval: isStreaming ? 2_500 : false")
  })

  it("resolves pending agent-input parents in one query instead of N+1", () => {
    const router = readFileSync("src/main/lib/trpc/routers/agent-input.ts", "utf8")

    expect(router).toContain("inArray(subChats.id, subChatIds)")
    expect(router).not.toContain("eq(subChats.id, request.chatId)")
  })

  it("skips the diff file-content prefetch while the diff sidebar is closed", () => {
    const router = readFileSync("src/main/lib/trpc/routers/chats.ts", "utf8")
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(router).toContain("includeContents: z.boolean().default(true)")
    expect(router).toContain("if (input.includeContents) {")
    // A contents-free response must never be cached under the full-response key.
    expect(router).toContain("`${diffHash}:no-contents`")
    // Nor may it return a previously cached full payload while the sidebar is closed.
    expect(router).toContain("const summary = { ...fullCached, fileContents: {} }")
    expect(activeChat).toContain("const includeContents = isDiffSidebarOpenRef.current")
    expect(activeChat).toContain("hash: result.diffHash")
    expect(activeChat).toContain("hasContents: responseIncludesContents")
    expect(activeChat).toContain("if (isDiffSidebarOpen) return")
    expect(activeChat).toContain("hasContents: false")
  })

  it("batches PTY output before it crosses the IPC boundary", () => {
    const router = readFileSync("src/main/lib/trpc/routers/terminal.ts", "utf8")

    expect(router).toContain("createTerminalOutputBatcher")
    expect(router).not.toMatch(/const onData = \(data: string\) => \{\s*emit\.next/)
  })

  it("routes chat cache reads and writes through the same query", () => {
    const mockApi = readFileSync("src/renderer/lib/mock-api.ts", "utf8")
    const utilsAdapter = mockApi.slice(mockApi.indexOf("useUtils: () =>"))

    expect(mockApi).toContain("trpc.chats.getMetadata.useQuery")
    // The utils adapter must not target chats.get, which nothing reads.
    expect(utilsAdapter).not.toContain("utils.chats.get.")
    expect(utilsAdapter).toContain("utils.chats.getMetadata.setData")
    expect(utilsAdapter).toContain("utils.chats.getMetadata.invalidate")
  })

  it("releases persisted transcript identities with detached chat state", () => {
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(activeChat).toContain("persistedMessageCache.delete(subChatId)")
    expect(activeChat).toContain("persistedHydrationIdentities.delete(subChatId)")
    expect(activeChat).toContain("import.meta.hot?.dispose")
  })

  it("evicts an idle chat object once it falls out of the retention window", () => {
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    // Eviction now runs through a small most-recently-viewed window so that
    // A -> B -> A does not reparse a transcript, while abandoned chats still go.
    expect(activeChat).toContain("retireSubChat(subChatId)")
    expect(activeChat).toMatch(
      /agentChatStore\.delete\(oldest\)\r?\n\s+clearRuntimeCachesForSubChat\(oldest\)/,
    )
    expect(activeChat).not.toContain("currentSubChatState.activeSubChatId === subChatId")
    expect(activeChat).toContain("if ((mountedChatViewInnerCounts.get(subChatId) ?? 0) > 0) return")
    expect(activeChat).not.toContain(
      "if (workbenchActive !== undefined) return\n      const currentSelectedChatId",
    )
  })

  it("uses cache-first chat hydration", () => {
    const source = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(source).not.toContain('refetchOnMount: "always"')
    expect(source).toContain("CHAT_METADATA_STALE_TIME")
  })

  it("keeps the split transcript cache authoritative after completed runs", () => {
    const source = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(source).toContain("trpcUtils.chats.getTranscript.setData")
    expect(source).toContain("pendingInitialGenerationIdsAtom")
  })

  it("transfers chat metadata separately from the visible transcript", () => {
    const router = readFileSync("src/main/lib/trpc/routers/chats.ts", "utf8")
    const mockApi = readFileSync("src/renderer/lib/mock-api.ts", "utf8")
    const composer = readFileSync("src/renderer/features/agents/main/chat-input-area.tsx", "utf8")

    expect(router).toContain("getMetadata: publicProcedure")
    expect(router).toContain("getTranscript: publicProcedure")
    expect(mockApi).toContain("trpc.chats.getMetadata.useQuery")
    expect(composer).not.toContain("trpc.chats.get.useQuery({ id: parentChatId })")
  })

  it("loads diagnostics and Shiki only on demand", () => {
    const main = readFileSync("src/renderer/main.tsx", "utf8")
    const shiki = readFileSync("src/renderer/lib/themes/shiki-theme-loader.ts", "utf8")

    expect(main).not.toContain('import "./wdyr"')
    expect(main).not.toContain("preloadDiffHighlighter()")
    expect(shiki).not.toMatch(/^import \* as shiki/m)
    expect(shiki).toContain('import("shiki")')
  })

  it("splits dormant workbench surfaces out of the initial renderer graph", () => {
    const source = readFileSync("src/renderer/features/agents/ui/agents-content.tsx", "utf8")

    expect(source).not.toContain(
      'import { SettingsContent } from "../../settings/settings-content"',
    )
    expect(source).not.toContain('import { KanbanView } from "../../kanban"')
    expect(source).toContain('import("../../settings/settings-content")')
    expect(source).toContain('import("../../kanban/kanban-view")')
    expect(source).toContain('import("../../terminal/workbench-terminal-pane")')
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
    expect(activeChat).not.toContain('import { AgentDiffView } from "../ui/agent-diff-view"')
    expect(activeChat).toContain('import("../ui/agent-diff-view")')
    expect(activeChat).toContain('import("../../terminal/terminal-sidebar")')
  })

  it("keeps a reproducible renderer bundle report command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>
    }
    const reportScript = readFileSync("scripts/report-renderer-bundle.mjs", "utf8")

    expect(packageJson.scripts["performance:bundle"]).toBe(
      "node scripts/report-renderer-bundle.mjs",
    )
    expect(reportScript).toContain("entryDynamicImports")
    expect(reportScript).toContain("gzipBytes")
  })
})
