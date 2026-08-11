import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const activeChatSource = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
const titleEditorSource = readFileSync(
  "src/renderer/features/agents/ui/chat-title-editor.tsx",
  "utf8",
)
const openInButtonSource = readFileSync("src/renderer/components/open-in-button.tsx", "utf8")
const subChatSelectorSource = readFileSync(
  "src/renderer/features/agents/ui/sub-chat-selector.tsx",
  "utf8",
)

describe("active chat header actions", () => {
  it("does not expose the named-agent launcher in the chat toolbar", () => {
    expect(activeChatSource).not.toContain("StartAgentDialog")
    expect(activeChatSource).not.toContain('aria-label="Start named agent from this chat"')
  })

  it("serializes chat-mode persistence and does not use a shared rollback slot", () => {
    expect(activeChatSource).toContain("modeMutationTailRef")
    expect(activeChatSource).toContain("latestRequestedModeRef.current === mode")
    expect(activeChatSource).not.toContain("previousModeRef")
  })

  it("keeps full-chat copy as a compact accessible icon action", () => {
    expect(activeChatSource).toContain('aria-label="Copy full chat"')
    expect(activeChatSource).toContain('title="Copy full chat"')
    expect(activeChatSource).toContain("rounded-md p-0 text-foreground/70")
    expect(activeChatSource).toContain("headerActions={desktopHeaderActions}")
  })

  it("uses one size and spacing rhythm for desktop header controls", () => {
    expect(activeChatSource).toContain('headerPaddingSidebarOpen: "pt-2.5 pb-12 px-3 pl-2"')
    expect(titleEditorSource).toContain('"w-[40%] max-w-[40%] flex-none"')
    expect(titleEditorSource).toContain('WebkitAppRegion: "no-drag"')
    expect(titleEditorSource).toContain('<OpenInButton path={localFolderPath} label="Open in" />')
    expect(titleEditorSource).toContain("flattenOverflowChildren(headerActions)")
    expect(titleEditorSource).toContain('menuLabel="More chat actions"')
    expect(titleEditorSource).not.toContain("reserveRestoreSpace")
    expect(titleEditorSource).toContain('forceOverflow={tagMode === "minimal"}')
    expect(titleEditorSource).not.toContain('Folder className="h-[18px] w-[18px]')
    expect(titleEditorSource).toContain("justify-center")
    expect(subChatSelectorSource).toContain(
      'className="h-7 w-7 p-0 transition-[background-color,transform]',
    )
    expect(subChatSelectorSource).toContain("hover:bg-accent hover:text-accent-foreground")
    expect(activeChatSource).toContain(
      "rounded-md p-0 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
    )
  })

  it("uses one font size and weight for desktop header labels", () => {
    expect(titleEditorSource).toContain("text-[13px] font-medium leading-none")
    expect(openInButtonSource).toContain(
      'className="text-[13px] font-medium leading-none truncate max-w-[120px]"',
    )
  })
})
