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

  it("uses cache-first chat hydration", () => {
    const source = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(source).not.toContain('refetchOnMount: "always"')
    expect(source).toContain("CHAT_METADATA_STALE_TIME")
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
