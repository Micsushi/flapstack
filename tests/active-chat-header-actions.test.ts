import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const activeChatSource = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
const titleEditorSource = readFileSync(
  "src/renderer/features/agents/ui/chat-title-editor.tsx",
  "utf8",
)
const subChatSelectorSource = readFileSync(
  "src/renderer/features/agents/ui/sub-chat-selector.tsx",
  "utf8",
)

describe("active chat header actions", () => {
  it("exposes the named-agent launcher in the chat toolbar", () => {
    expect(activeChatSource).toContain("StartAgentDialog")
    expect(activeChatSource).toContain('source={{ kind: "chat", chatId }}')
    expect(activeChatSource).toContain('aria-label="Start named agent from this chat"')
  })

  it("serializes chat-mode persistence and does not use a shared rollback slot", () => {
    expect(activeChatSource).toContain("modeMutationTailRef")
    expect(activeChatSource).toContain("latestRequestedModeRef.current === mode")
    expect(activeChatSource).not.toContain("previousModeRef")
  })

  it("keeps full-chat copy as a compact accessible icon action", () => {
    expect(titleEditorSource).toContain('aria-label="Copy full chat"')
    expect(titleEditorSource).toContain('title="Copy full chat"')
    expect(titleEditorSource).toContain('className="relative z-30 inline-flex h-7 w-7')
    expect(titleEditorSource).toContain("rounded-md p-0 text-foreground/70")
    expect(titleEditorSource).not.toContain(">Copy full chat</span>")
  })

  it("uses one size and spacing rhythm for desktop header controls", () => {
    expect(activeChatSource).toContain('headerPaddingSidebarOpen: "pt-2.5 pb-12 px-3 pl-2"')
    expect(titleEditorSource).toContain('className="ml-auto flex shrink-0 items-center gap-2"')
    expect(titleEditorSource).toContain("inline-flex h-7 shrink-0")
    expect(titleEditorSource).not.toContain("inline-flex h-6 shrink-0")
    expect(subChatSelectorSource).toContain(
      'className="h-7 w-7 p-0 transition-[background-color,transform]',
    )
    expect(subChatSelectorSource).toContain("hover:bg-accent hover:text-accent-foreground")
    expect(activeChatSource).toContain(
      "rounded-md p-0 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
    )
  })
})
