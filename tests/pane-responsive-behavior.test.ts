import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("pane-local responsive behavior", () => {
  it("stores Details and Preview visibility per chat", () => {
    expect(source("src/renderer/features/details-sidebar/atoms/index.ts")).toContain(
      "detailsSidebarOpenAtomFamily",
    )
    expect(source("src/renderer/features/agents/atoms/index.ts")).toContain(
      "agentsPreviewSidebarOpenAtomFamily",
    )
    const activeChat = source("src/renderer/features/agents/main/active-chat.tsx")
    expect(activeChat).toContain("detailsSidebarOpenAtomFamily(chatId)")
    expect(activeChat).toContain("agentsPreviewSidebarOpenAtomFamily(chatId)")
  })

  it("keeps primary controls and moves secondary actions into overflow", () => {
    const title = source("src/renderer/features/agents/ui/chat-title-editor.tsx")
    expect(title).toContain('menuLabel="More chat actions"')
    expect(title).toContain("usageRatio={1}")
    expect(title).toContain("collapseOrder={headerCollapseOrder}")
    expect(title).toContain("flattenOverflowChildren(headerActions)")
    expect(title).toContain("headerControlItems.map((_, index) => index).reverse()")
    expect(title).toContain('mode === "compact"')
    expect(title).toContain("visibleAuxiliaryTagCount")
    expect(title).toContain('forceOverflow={tagLayout.mode === "compact"}')
    const composer = source("src/renderer/features/agents/main/chat-input-area.tsx")
    expect(composer).toContain('menuLabel="More composer settings"')
    expect(composer).toContain("usageRatio={0.8}")
    expect(composer).toContain("usageRatio={0.94}")
    expect(composer).toContain("<AgentModelTuningSelector")
    expect(composer).toContain("<AgentSendButton")
  })

  it("only duplicates message toolbar actions into overflow when the toolbar is collapsed", () => {
    const message = source("src/renderer/features/agents/main/assistant-message-item.tsx")

    expect(message).toContain("includeToolbarActions")
    expect(message).toContain('className="inline-flex @[420px]:hidden"')
    expect(message).toContain('className="hidden @[420px]:inline-flex"')
    expect(message).not.toContain("pb-1 @[420px]:hidden")
  })

  it("reserves the scrollbar gutter beside the chat bottom dock", () => {
    expect(source("src/renderer/features/agents/main/active-chat.tsx")).toContain(
      'className="absolute bottom-0 left-0 right-3 z-20"',
    )
  })

  it("uses one 12px composer edge margin without divider layout inflation", () => {
    const composer = source("src/renderer/features/agents/main/chat-input-area.tsx")
    const workbench = source("src/renderer/features/agents/workbench/chat-workbench.tsx")

    expect(composer).toContain('className="px-2 pb-3 shadow-sm shadow-background relative z-10"')
    expect(workbench).toContain('? "relative w-px cursor-col-resize"')
    expect(workbench).toContain(': "relative h-px cursor-row-resize"')
    expect(workbench).toContain('data-resize-hit-area="12"')
    expect(workbench).not.toContain('"-my-1 h-3 cursor-row-resize"')
    expect(workbench).not.toContain('"-mx-1 w-3 cursor-col-resize"')
  })

  it("enforces distinct Chat and Terminal minimums and removes the old position switcher", () => {
    const workbench = source("src/renderer/features/agents/workbench/chat-workbench.tsx")
    expect(workbench).toContain("CHAT_WORKBENCH_MIN_CHAT_WIDTH = 350")
    expect(workbench).toContain("CHAT_WORKBENCH_MIN_CHAT_HEIGHT = 360")
    expect(workbench).toContain("CHAT_WORKBENCH_MIN_TERMINAL_WIDTH = 280")
    expect(source("src/renderer/features/terminal/terminal-sidebar.tsx")).not.toContain(
      "TerminalModeSwitcher",
    )
  })

  it("uses narrow scrollbars throughout the app", () => {
    const globals = source("src/renderer/styles/globals.css")
    const agents = source("src/renderer/styles/agents-styles.css")
    expect(globals).toMatch(/::-webkit-scrollbar \{\s+width: 4px;\s+height: 4px;/)
    expect(agents).toMatch(
      /\[data-agents-page\] ::-webkit-scrollbar \{\s+width: 4px;\s+height: 4px;/,
    )
  })

  it("disables floating prompts and inline message actions at compact pane heights", () => {
    const activeChat = source("src/renderer/features/agents/main/active-chat.tsx")
    const userMessage = source("src/renderer/features/agents/main/isolated-message-group.tsx")
    const assistantMessage = source("src/renderer/features/agents/main/assistant-message-item.tsx")
    const styles = source("src/renderer/styles/agents-styles.css")

    expect(activeChat).toContain(
      "const usableChatHeight = chatContainerHeightRef.current - bottomDockHeightRef.current",
    )
    expect(activeChat).toContain("usableChatHeight < 400")
    expect(userMessage).toContain("data-floating-message-jump")
    expect(userMessage).toContain("data-message-inline-action")
    expect(assistantMessage).toContain("data-message-inline-action")
    expect(styles).toContain("[data-chat-container][data-compact-chat-height]")
  })
})
